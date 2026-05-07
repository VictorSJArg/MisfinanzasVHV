import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { endOfMonth } from 'date-fns';

// GET - Listar resúmenes de una tarjeta
export async function GET(request: NextRequest) {
    try {
        const cardId = request.nextUrl.searchParams.get('cardId');

        if (!cardId) {
            return NextResponse.json({ error: 'cardId is required' }, { status: 400 });
        }

        const statements = await prisma.creditCardStatement.findMany({
            where: { creditCardId: cardId },
            include: {
                items: {
                    orderBy: { date: 'asc' }
                }
            },
            orderBy: { dueDate: 'desc' }
        });

        return NextResponse.json(statements);
    } catch (error: any) {
        console.error(error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

// POST - Crear o Actualizar resumen con sus items
export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { creditCardId, closingDate, dueDate, totalAmount, minimumPayment, items } = body;

        if (!creditCardId || !closingDate || !dueDate || !totalAmount) {
            return NextResponse.json({
                error: 'creditCardId, closingDate, dueDate, and totalAmount are required'
            }, { status: 400 });
        }

        // Detectar items recurrentes y clasificar automáticamente
        const classifyItem = (description: string, amount: number) => {
            const desc = description.toUpperCase();

            // Detectar recurrentes
            const recurringPatterns = [
                'NETFLIX', 'SPOTIFY', 'CLARO', 'PERSONAL', 'MOVISTAR',
                'SEGUROS', 'BBVA', 'SEGURO', 'ENERGIA', 'DEB AUT',
                'DEBITO AUTOMATICO', 'SUSCRIPCION'
            ];

            const isRecurring = recurringPatterns.some(p => desc.includes(p));

            // Detectar tipo
            let itemType = 'PURCHASE';
            if (desc.includes('PAGO EN PESOS') || desc.includes('SU PAGO')) {
                itemType = 'PAYMENT';
            } else if (desc.includes('IMPUESTO') || desc.includes('IVA') || desc.includes('IIBB') || desc.includes('SELLOS')) {
                itemType = 'TAX';
            } else if (desc.includes('INTERES') || desc.includes('FINANCIACION')) {
                itemType = 'FEE';
            } else if (isRecurring) {
                itemType = 'RECURRING';
            }

            // Detectar categoría
            let category = 'OTROS';
            if (desc.match(/YPF|SHELL|AXION|PUMA|PETROBRAS|COMBUSTIBLE|NAFTA|GNC|ESTACION|SERVICE|AUTOSERVICE/)) {
                category = 'COMBUSTIBLE';
            } else if (desc.match(/COTO|CARREFOUR|JUMBO|DIA|CHANGOMAS|VEA|DISCO|WALMART|SUPERMERCADO/)) {
                category = 'ALIMENTOS';
            } else if (desc.match(/NETFLIX|SPOTIFY|AMAZON|DISNEY|HBO|YOUTUBE|GOOGLE|APPLE|STEAM/)) {
                category = 'ENTRETENIMIENTO';
            } else if (desc.match(/CLARO|MOVISTAR|PERSONAL|TELECENTRO|FIBERTEL|CABLEVISION|EDENOR|EDESUR|METROGAS/)) {
                category = 'SERVICIOS';
            } else if (desc.match(/SEGURO|SEGUROS|GALENO|OSDE|SWISS|SANCOR/)) {
                category = 'SEGUROS';
            } else if (desc.match(/FARMACITY|FARMACIA|DOCTOR|CONSULTORIO|HOSPITAL/)) {
                category = 'SALUD';
            } else if (desc.match(/RAPPI|PEDIDOS|UBER\s*EATS|MCDONALDS|BURGER|STARBUCKS|RESTAURANT/)) {
                category = 'GASTRONOMIA';
            } else if (desc.match(/ZARA|H&M|NIKE|ADIDAS|FALABELLA/)) {
                category = 'ROPA';
            } else if (desc.match(/CABIFY|UBER|PEAJE|AUTOPISTA/)) {
                category = 'TRANSPORTE';
            } else if (desc.includes('IMPUESTO') || desc.includes('IVA') || desc.includes('IIBB')) {
                category = 'IMPUESTOS';
            } else if (desc.includes('INTERES') || desc.includes('CARGO') || desc.includes('COMISION')) {
                category = 'CARGOS';
            }

            return { isRecurring, itemType, category };
        };

        // Parsear cuotas del formato "C.04/06"
        const parseInstallments = (description: string) => {
            const match = description.match(/C\.(\d{2})\/(\d{2})/);
            if (match) {
                return {
                    installmentCurrent: parseInt(match[1]),
                    installmentTotal: parseInt(match[2])
                };
            }
            return { installmentCurrent: null, installmentTotal: null };
        };

        // 1. Check if statement exists
        // Normalize date to avoid time drift
        const incomingClosingDate = new Date(closingDate);
        // Ensure midnight? Or strict match?
        // Let's rely on YYYY-MM-DD match
        const startOfDay = new Date(incomingClosingDate); startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(incomingClosingDate); endOfDay.setHours(23, 59, 59, 999);

        let statement = await prisma.creditCardStatement.findFirst({
            where: {
                creditCardId,
                closingDate: {
                    gte: startOfDay,
                    lte: endOfDay
                }
            },
            include: { items: true }
        });

        if (statement) {
            // MERGE MODE
            console.log(`Updating existing statement ${statement.id}`);

            // Update Headers
            await prisma.creditCardStatement.update({
                where: { id: statement.id },
                data: {
                    dueDate: new Date(dueDate),
                    totalAmount: parseFloat(totalAmount),
                    minimumPayment: minimumPayment ? parseFloat(minimumPayment) : null
                }
            });

            // Merge Items
            if (items && items.length > 0) {
                let addedCount = 0;
                for (const item of items) {
                    // Check if duplicate
                    // Criteria: Same Date, Same Amount, Description similar
                    const itemDate = new Date(item.date);
                    const itemAmount = parseFloat(item.amount);

                    const isDuplicate = statement.items.some(existing =>
                        existing.date.getTime() === itemDate.getTime() &&
                        Math.abs(Number(existing.amount) - itemAmount) < 0.01 &&
                        (existing.description === item.description || existing.description.includes(item.description))
                    );

                    if (!isDuplicate) {
                        const { isRecurring, itemType, category } = classifyItem(item.description, item.amount);
                        const { installmentCurrent, installmentTotal } = parseInstallments(item.description);

                        await prisma.creditCardItem.create({
                            data: {
                                statementId: statement.id,
                                date: itemDate,
                                description: item.description,
                                amount: itemAmount,
                                amountUSD: item.amountUSD ? parseFloat(item.amountUSD) : null,
                                installmentCurrent,
                                installmentTotal,
                                installmentAmount: installmentTotal ? itemAmount : null,
                                itemType: item.itemType || itemType,
                                isRecurring: item.isRecurring ?? isRecurring,
                                category: item.category || category,
                                includeInProjection: true
                            }
                        });
                        addedCount++;
                    }
                }
                console.log(`Merged ${addedCount} new items.`);
            }

            // Reload
            statement = await prisma.creditCardStatement.findUnique({
                where: { id: statement.id },
                include: { items: true }
            });

        } else {
            // CREATE MODE
            statement = await prisma.creditCardStatement.create({
                data: {
                    creditCardId,
                    closingDate: incomingClosingDate,
                    dueDate: new Date(dueDate),
                    totalAmount: parseFloat(totalAmount),
                    minimumPayment: minimumPayment ? parseFloat(minimumPayment) : null,
                    items: items && items.length > 0 ? {
                        create: items.map((item: any) => {
                            const { isRecurring, itemType, category } = classifyItem(item.description, item.amount);
                            const { installmentCurrent, installmentTotal } = parseInstallments(item.description);

                            return {
                                date: new Date(item.date),
                                description: item.description,
                                amount: parseFloat(item.amount),
                                amountUSD: item.amountUSD ? parseFloat(item.amountUSD) : null,
                                installmentCurrent,
                                installmentTotal,
                                installmentAmount: installmentTotal ? parseFloat(item.amount) : null,
                                itemType: item.itemType || itemType,
                                isRecurring: item.isRecurring ?? isRecurring,
                                category: item.category || category
                            };
                        })
                    } : undefined
                },
                include: { items: true }
            });
        }

        return NextResponse.json(statement, { status: 201 });
    } catch (error: any) {
        console.error(error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

// DELETE - Eliminar resumen
export async function DELETE(request: NextRequest) {
    try {
        const id = request.nextUrl.searchParams.get('id');
        if (!id) {
            return NextResponse.json({ error: 'id is required' }, { status: 400 });
        }

        await prisma.creditCardStatement.delete({ where: { id } });
        return NextResponse.json({ success: true });
    } catch (error: any) {
        console.error(error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

// PUT - Actualizar resumen
export async function PUT(request: NextRequest) {
    try {
        const body = await request.json();
        const { id, dueDate, totalAmount } = body;

        if (!id) {
            return NextResponse.json({ error: 'id is required' }, { status: 400 });
        }

        const dataToUpdate: any = {};
        if (dueDate !== undefined) dataToUpdate.dueDate = new Date(dueDate);
        if (totalAmount !== undefined) dataToUpdate.totalAmount = parseFloat(totalAmount);

        const statement = await prisma.creditCardStatement.update({
            where: { id },
            data: dataToUpdate
        });

        return NextResponse.json(statement);
    } catch (error: any) {
        console.error(error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
