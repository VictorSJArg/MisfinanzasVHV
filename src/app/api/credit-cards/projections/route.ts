import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { addMonths, endOfMonth, format, startOfMonth } from 'date-fns';

export const dynamic = 'force-dynamic';

interface ProjectedExpense {
    date: string;
    amount: number;
    description: string;
    type: 'STATEMENT' | 'INSTALLMENT' | 'RECURRING';
    cardName: string;
    cardId: string;
    category?: string;
}

// GET - Obtener proyección de gastos de tarjeta para el Flujo
export async function GET(request: NextRequest) {
    try {
        const startDate = request.nextUrl.searchParams.get('startDate');
        const endDate = request.nextUrl.searchParams.get('endDate');
        const monthsAhead = parseInt(request.nextUrl.searchParams.get('monthsAhead') || '12');

        const user = await prisma.user.findFirst();
        if (!user) {
            return NextResponse.json({ error: 'No user found' }, { status: 400 });
        }

        // Obtener todas las tarjetas con sus últimos resúmenes
        const cards = await prisma.creditCard.findMany({
            where: { userId: user.id },
            include: {
                statements: {
                    orderBy: { dueDate: 'desc' },
                    take: 1,
                    include: {
                        items: true
                    }
                }
            }
        });

        const projections: ProjectedExpense[] = [];
        const now = new Date();

        for (const card of cards) {
            if (card.statements.length === 0) continue;

            const latestStatement = card.statements[0];

            // 1. Agregar el saldo total en la fecha de vencimiento
            projections.push({
                date: format(latestStatement.dueDate, 'yyyy-MM-dd'),
                amount: Number(latestStatement.totalAmount),
                description: `Pago TC ${card.name}`,
                type: 'STATEMENT',
                cardName: card.name,
                cardId: card.id,
                category: 'STATEMENT'
            });

            // Fetch monthly overrides
            let monthlyOverrides = new Map<string, number>();
            try {
                const overridesData = await (prisma as any).projectionMonthlyOverride.findMany();
                overridesData.forEach((o: any) => {
                    monthlyOverrides.set(`${o.itemId}-${o.yearMonth}`, Number(o.amount));
                });
            } catch (e) {
                // Table might not exist yet, ignore
            }

            // 2. Proyectar cuotas pendientes (solo items incluidos en proyección)
            // Excluir items recurrentes para evitar doble conteo
            for (const item of latestStatement.items) {
                // Skip recurring items - they're handled separately
                if ((item as any).isRecurring) continue;

                if (item.includeInProjection !== false && item.installmentCurrent && item.installmentTotal) {
                    const remainingInstallments = item.installmentTotal - item.installmentCurrent;
                    const baseAmount = Number(item.installmentAmount || item.amount);

                    for (let i = 1; i <= remainingInstallments; i++) {
                        const futureDate = addMonths(latestStatement.dueDate, i);
                        const lastDayOfMonth = endOfMonth(futureDate);
                        const yearMonth = format(lastDayOfMonth, 'yyyy-MM');

                        // Check for monthly override
                        const overrideKey = `${item.id}-${yearMonth}`;
                        const overrideAmount = monthlyOverrides.get(overrideKey);
                        const finalAmount = overrideAmount !== undefined ? overrideAmount : baseAmount;

                        projections.push({
                            date: format(lastDayOfMonth, 'yyyy-MM-dd'),
                            amount: finalAmount,
                            description: `${item.description} (${item.installmentCurrent + i}/${item.installmentTotal})`,
                            type: 'INSTALLMENT',
                            cardName: card.name,
                            cardId: card.id,
                            category: item.category || 'OTROS'
                        });
                    }
                }
            }

            // 3. Proyectar gastos recurrentes (solo items incluidos en proyección)
            const recurringItems = latestStatement.items.filter((i: any) => i.isRecurring && i.includeInProjection !== false);
            for (const item of recurringItems) {
                const baseAmount = Number((item as any).projectedAmount ?? item.amount);

                for (let i = 1; i <= monthsAhead; i++) {
                    const futureDate = addMonths(latestStatement.dueDate, i);
                    const lastDayOfMonth = endOfMonth(futureDate);
                    const yearMonth = format(lastDayOfMonth, 'yyyy-MM');

                    // Check for monthly override
                    const overrideKey = `${item.id}-${yearMonth}`;
                    const overrideAmount = monthlyOverrides.get(overrideKey);
                    const finalAmount = overrideAmount !== undefined ? overrideAmount : baseAmount;

                    projections.push({
                        date: format(lastDayOfMonth, 'yyyy-MM-dd'),
                        amount: finalAmount,
                        description: `${item.description} (recurrente)`,
                        type: 'RECURRING',
                        cardName: card.name,
                        cardId: card.id,
                        category: item.category || 'SERVICIOS'
                    });
                }
            }


        }

        // Agrupar por mes para el flujo
        const monthlyTotals: Record<string, number> = {};
        for (const p of projections) {
            const monthKey = p.date.substring(0, 7); // yyyy-MM
            monthlyTotals[monthKey] = (monthlyTotals[monthKey] || 0) + p.amount;
        }

        // Filtrar por rango de fechas si se proporciona
        let filteredProjections = projections;
        if (startDate && endDate) {
            filteredProjections = projections.filter(p =>
                p.date >= startDate && p.date <= endDate
            );
        }

        return NextResponse.json({
            projections: filteredProjections,
            monthlyTotals,
            totalCards: cards.length
        });
    } catch (error: any) {
        console.error(error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
