
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ParsedEmailTransaction } from '@/utils/parsers/bancoSanJuanParser';
import { addMonths, startOfDay, isBefore, isAfter, parseISO, format } from 'date-fns';

export async function POST(request: NextRequest) {
    try {
        const body: ParsedEmailTransaction = await request.json();
        const { date, amount, description, lastFour, installments, merchant, manualStatementDate } = body;

        const user = await prisma.user.findFirst();
        if (!user) {
            return NextResponse.json({ error: 'No user found' }, { status: 400 });
        }

        // 1. Find the Card
        // We match by lastFour. Note that lastFour might be null in DB if user didn't set it.
        // We try to find a best match.
        const card = await prisma.creditCard.findFirst({
            where: {
                userId: user.id,
                lastFour: { contains: lastFour } // Use contains to be safe, though exact match is better
            },
            include: {
                statements: {
                    orderBy: { closingDate: 'desc' }
                    // Removed 'take: 5' to ensure we find ANY existing statement matching the date, even if old.
                }
            }
        });

        if (!card) {
            return NextResponse.json({
                error: `No se encontró ninguna tarjeta terminada en ${lastFour}. Por favor agrégala primero.`
            }, { status: 404 });
        }

        // 2. Determine the Statement
        const transactionDate = parseISO(date);
        const cardStatements = card.statements;

        let targetStatement: any = null;
        let targetMonth: number;
        let targetYear: number;
        // Default closing day if creating new
        const latestStatement = cardStatements.sort((a, b) => b.closingDate.getTime() - a.closingDate.getTime())[0];
        const preferredClosingDay = latestStatement ? latestStatement.closingDate.getDate() : 28;

        if (manualStatementDate) {
            // Priority: Manual Override
            // User selected a specific "Due Date". We search for a statement matching this Due Date's month/year.
            const manualDate = parseISO(manualStatementDate);
            targetMonth = manualDate.getMonth();
            targetYear = manualDate.getFullYear();

            console.log(`Using Manual Statement Date: ${manualStatementDate} -> Target Due Month: ${targetMonth + 1}, Year: ${targetYear}`);

            // Define Search Range for that Month (Due Date)
            const startOfMonth = new Date(Date.UTC(targetYear, targetMonth, 1, 0, 0, 0));
            const endOfMonth = new Date(Date.UTC(targetYear, targetMonth + 1, 0, 23, 59, 59));

            // Try to find EXISTING statement by DUE DATE
            const existingStatement: any = await prisma.creditCardStatement.findFirst({
                where: {
                    creditCardId: card.id,
                    dueDate: {
                        gte: startOfMonth,
                        lte: endOfMonth
                    }
                }
            });

            if (existingStatement) {
                targetStatement = existingStatement;
                console.log(`Found existing statement by Due Date: ${targetStatement.id}`);
            } else {
                // Create new if not found.
                // We need to infer closing date. Usually 10 days before due date.
                const newDue = new Date(Date.UTC(targetYear, targetMonth, manualDate.getDate(), 12, 0, 0));
                const newClosing = new Date(newDue);
                newClosing.setDate(newClosing.getDate() - 10);

                console.log(`Creating NEW statement based on Due Date: Due ${newDue.toISOString()}, Close ${newClosing.toISOString()}`);

                try {
                    targetStatement = await prisma.creditCardStatement.create({
                        data: {
                            creditCardId: card.id,
                            closingDate: newClosing,
                            dueDate: newDue,
                            totalAmount: 0,
                            minimumPayment: 0
                        }
                    });
                } catch (e: any) {
                    // Recover logic
                    if (e.code === 'P2002') {
                        targetStatement = await prisma.creditCardStatement.findFirst({
                            where: {
                                creditCardId: card.id,
                                dueDate: { gte: startOfMonth, lte: endOfMonth }
                            }
                        });
                    }
                    if (!targetStatement) throw new Error("Failed to create statement.");
                }
            }
        } else {
            // Auto Calculation Logic (Original) based on Closing Date
            targetMonth = transactionDate.getMonth();
            targetYear = transactionDate.getFullYear();

            // Generic "20th" rule or use preferredClosingDay
            if (transactionDate.getDate() > preferredClosingDay) {
                if (targetMonth === 11) {
                    targetMonth = 0;
                    targetYear++;
                } else {
                    targetMonth++;
                }
            }

            const startOfMonth = new Date(Date.UTC(targetYear, targetMonth, 1, 0, 0, 0));
            const endOfMonth = new Date(Date.UTC(targetYear, targetMonth + 1, 0, 23, 59, 59));

            // Original Find by Closing Date
            const existingStatement: any = await prisma.creditCardStatement.findFirst({
                where: {
                    creditCardId: card.id,
                    closingDate: {
                        gte: startOfMonth,
                        lte: endOfMonth
                    }
                }
            });

            if (existingStatement) {
                targetStatement = existingStatement;
            } else {
                // Creation Logic (Original)
                const newClosing = new Date(Date.UTC(targetYear, targetMonth, preferredClosingDay, 12, 0, 0));
                const newDue = new Date(newClosing);
                newDue.setDate(newDue.getDate() + 10);

                try {
                    targetStatement = await prisma.creditCardStatement.create({
                        data: {
                            creditCardId: card.id,
                            closingDate: newClosing,
                            dueDate: newDue,
                            totalAmount: 0,
                            minimumPayment: 0
                        }
                    });
                } catch (e: any) {
                    if (e.code === 'P2002') {
                        targetStatement = await prisma.creditCardStatement.findFirst({
                            where: {
                                creditCardId: card.id,
                                closingDate: { gte: startOfMonth, lte: endOfMonth }
                            }
                        });
                    }
                    if (!targetStatement) throw new Error("Failed to create statement.");
                }
            }
        }

        // Final safety check
        if (!targetStatement) {
            throw new Error("Unable to determine or create statement.");
        }

        // 3. Create the Item
        const newItem = await prisma.creditCardItem.create({
            data: {
                statementId: targetStatement.id,
                date: transactionDate,
                description: installments > 1 ? `${merchant} (${installments} cuotas)` : merchant,
                amount: amount,
                // Handle installments logic?
                // If installments > 1, we might want to create the installment plan?
                // For now user just wants to "add the consumption". 
                // If we add it as "PURCHASE" or "INSTALLMENT" type?
                // The prisma schema has InstallmentCurrent/Total.
                itemType: installments > 1 ? 'INSTALLMENT' : 'PURCHASE',
                installmentTotal: installments > 1 ? installments : null,
                installmentCurrent: installments > 1 ? 1 : null, // Assuming this is start of plan 
                category: 'OTROS', // Default
                includeInProjection: true,
                isRecurring: false
            }
        });

        // Update statement total?
        // Usually statement total is sum of items + adjustments. 
        // But the user often sets statement total manually from the PDF header.
        // If we are building the statement item by item, we should probably update the totalAmount field to match sum?
        // Or leave it as is?
        // If it's a new statement we created (total 0), we should update it.
        // If it's an existing one, maybe we shouldn't touch the totalAmount as it might be fixed from header?
        // Actually, if we add an item, the "Total Calculated" in UI updates. "Total Amount" in DB is usually the "Official Final Total".
        // Let's leave totalAmount alone unless it's 0.
        if (Number(targetStatement.totalAmount) === 0) {
            // New statement or empty, set total
            await prisma.creditCardStatement.update({
                where: { id: targetStatement.id },
                data: { totalAmount: amount }
            });
        } else {
            // Existing statement, ADD the new amount to the existing total (preserving previous data)
            // But wait, usually 'totalAmount' in DB represents the final statement total from the bank.
            // If we are just tracking "accumulator", we should add it.
            // If the user already set a fixed total (e.g. from PDF header), adding it might break the "Difference" check.
            // However, the user request says: "Y QUE SUME EN EL MES QUE CORRESPONDA AL VENCIMIENTO EL IMPORTE DEL RESUMEN , NUEVO"
            // implying they want the total to reflect the new addition.

            const currentTotal = Number(targetStatement.totalAmount);
            await prisma.creditCardStatement.update({
                where: { id: targetStatement.id },
                data: { totalAmount: currentTotal + amount }
            });
        }

        return NextResponse.json({ success: true, item: newItem, statement: targetStatement });

    } catch (error: any) {
        console.error('Import error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
