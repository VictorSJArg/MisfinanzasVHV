
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { startOfMonth, endOfMonth, subMonths, startOfWeek, endOfWeek, subWeeks, format } from 'date-fns';
import { es } from 'date-fns/locale';

export async function GET(request: NextRequest) {
    try {
        const user = await prisma.user.findFirst();
        if (!user) return NextResponse.json({ error: "No user found" }, { status: 400 });

        // Obtener mes/año de los query params, o usar la fecha actual
        const { searchParams } = new URL(request.url);
        const yearParam = searchParams.get('year');
        const monthParam = searchParams.get('month');

        let now: Date;
        if (yearParam && monthParam) {
            // Construir fecha basada en los parámetros (día 15 para evitar problemas de timezone)
            now = new Date(parseInt(yearParam), parseInt(monthParam) - 1, 15);
        } else {
            now = new Date();
        }

        // Período actual y anterior (mes)
        const currentMonthStart = startOfMonth(now);
        const currentMonthEnd = endOfMonth(now);
        const previousMonthStart = startOfMonth(subMonths(now, 1));
        const previousMonthEnd = endOfMonth(subMonths(now, 1));

        // Período actual y anterior (semana)
        const currentWeekStart = startOfWeek(now, { weekStartsOn: 0 });
        const currentWeekEnd = endOfWeek(now, { weekStartsOn: 0 });
        const previousWeekStart = startOfWeek(subWeeks(now, 1), { weekStartsOn: 0 });
        const previousWeekEnd = endOfWeek(subWeeks(now, 1), { weekStartsOn: 0 });

        // Obtener transacciones del período actual y anterior
        const [currentMonthTxs, previousMonthTxs, currentWeekTxs, previousWeekTxs, allTimeIncome, allTimeExpense] = await Promise.all([
            prisma.transaction.findMany({
                where: { userId: user.id, date: { gte: currentMonthStart, lte: currentMonthEnd } }
            }),
            prisma.transaction.findMany({
                where: { userId: user.id, date: { gte: previousMonthStart, lte: previousMonthEnd } }
            }),
            prisma.transaction.findMany({
                where: { userId: user.id, date: { gte: currentWeekStart, lte: currentWeekEnd } }
            }),
            prisma.transaction.findMany({
                where: { userId: user.id, date: { gte: previousWeekStart, lte: previousWeekEnd } }
            }),
            prisma.transaction.aggregate({
                where: { userId: user.id, type: 'INCOME' },
                _sum: { amount: true }
            }),
            prisma.transaction.aggregate({
                where: { userId: user.id, type: 'EXPENSE' },
                _sum: { amount: true }
            })
        ]);

        // Calcular totales del mes actual
        const currentMonthIncome = currentMonthTxs
            .filter(t => t.type === 'INCOME')
            .reduce((sum, t) => sum + Number(t.amount), 0);
        const currentMonthExpense = currentMonthTxs
            .filter(t => t.type === 'EXPENSE' && (t as any).status !== 'CANCELLED')
            .reduce((sum, t) => sum + Number(t.amount), 0);

        const executedRealExpense = currentMonthTxs
            .filter(t => t.type === 'EXPENSE' && ((t as any).status === 'PAID' || !(t as any).status))
            .reduce((sum, t) => sum + Number(t.amount), 0);

        const pendingRealExpense = currentMonthTxs
            .filter(t => t.type === 'EXPENSE' && (t as any).status !== 'PAID' && (t as any).status !== 'CANCELLED')
            .reduce((sum, t) => sum + Number(t.amount), 0);

        // Calcular totales del mes anterior
        const previousMonthIncome = previousMonthTxs
            .filter(t => t.type === 'INCOME')
            .reduce((sum, t) => sum + Number(t.amount), 0);
        const previousMonthExpense = previousMonthTxs
            .filter(t => t.type === 'EXPENSE')
            .reduce((sum, t) => sum + Number(t.amount), 0);

        // Calcular totales de la semana actual
        const currentWeekIncome = currentWeekTxs
            .filter(t => t.type === 'INCOME')
            .reduce((sum, t) => sum + Number(t.amount), 0);
        const currentWeekExpense = currentWeekTxs
            .filter(t => t.type === 'EXPENSE')
            .reduce((sum, t) => sum + Number(t.amount), 0);

        // Calcular totales de la semana anterior
        const previousWeekIncome = previousWeekTxs
            .filter(t => t.type === 'INCOME')
            .reduce((sum, t) => sum + Number(t.amount), 0);
        const previousWeekExpense = previousWeekTxs
            .filter(t => t.type === 'EXPENSE')
            .reduce((sum, t) => sum + Number(t.amount), 0);

        // Calcular variaciones
        const calcVariation = (current: number, previous: number) => {
            if (previous === 0) return current > 0 ? 100 : 0;
            return ((current - previous) / previous) * 100;
        };

        // Top 5 categorías de gastos del mes
        const topExpenseCategories = await prisma.transaction.groupBy({
            by: ['categoryId'],
            where: {
                userId: user.id,
                type: 'EXPENSE',
                date: { gte: currentMonthStart, lte: currentMonthEnd }
            },
            _sum: { amount: true },
            orderBy: { _sum: { amount: 'desc' } },
            take: 5
        });

        // Obtener nombres de categorías
        const categoryIds = topExpenseCategories.map(c => c.categoryId).filter(Boolean) as string[];
        const categories = await prisma.category.findMany({
            where: { id: { in: categoryIds } }
        });
        const categoryMap = new Map(categories.map(c => [c.id, c.name]));

        const topExpenses = topExpenseCategories.map(c => ({
            category: categoryMap.get(c.categoryId || '') || 'Sin categoría',
            amount: Number(c._sum.amount) || 0
        }));

        // Fetch Credit Card Projections for Current Month to calculate Executed vs Pending
        let paidProjectionsTotal = 0;
        let pendingProjectionsTotal = 0;

        try {
            const cards = await prisma.creditCard.findMany({
                where: { userId: user.id },
                include: {
                    statements: {
                        where: { dueDate: { gte: currentMonthStart, lte: currentMonthEnd } },
                        include: { items: true }
                    }
                }
            });

            // Fetch statuses for current month
            const statuses = await prisma.projectionStatus.findMany({
                where: { date: { gte: currentMonthStart, lte: currentMonthEnd } }
            });
            const statusMap = new Map(statuses.map((s: any) => [`${s.referenceId}-${s.date.toISOString()}`, s.status]));

            for (const card of cards) {
                // ... (Logic similar to flow/route.ts to generate projections and check status)
                // Simplified for dashboard: just check items due in this range
                for (const statement of card.statements) {
                    // Full statement payment logic (simplified for now, assuming if date passed it's 'executed' or using status if we track statement payments)
                    // For granularity, let's look at items if we want item-level status, OR just statement total.
                    // The user request asked for "gastos proyectados como cancelados". This usually implies specific items.
                    // However, the dashboard usually shows the *sum*.
                    // Strategy: Sum all "PAID" projections + Real Expenses = Executed.
                    // Sum "PENDING" projections = Pending.

                    // Iterate items to replicate granular projection logic matches flow view
                    for (const item of statement.items) {
                        // ... (Installments & Recurring logic that falls in current month) ...
                        // For simplicity in this iteration, we fallback to:
                        // Real Transactions = Executed (Already done)
                        // TC Payments: If date < now, assume executed? No, use status.
                    }
                }
            }
            // RE-IMPLEMENTATION: safer to re-use the logic or just fetch simple sum if possible.
            // Given complexity, let's just add the 'pending/paid' separation to the response based on a simpler pass.
        } catch (e) {
            console.error("Error calc projections for dashboard", e);
        }

        // --- SIMPLIFIED APPROACH:
        // We need to know the *Projected* amount for the current month to split it.
        // We already have `currentMonthExpense` which is strictly Real Transactions (Executed).
        // Use the same logic as flow/route.ts to get *All* projections for this month.
        // Then check their status.

        // ... [Insert Logic to Generate Projections for Current Month Only] ...
        // (Copying minimal logic for reliability)
        const getProjectionsForRange = async (start: Date, end: Date) => {
            const projections = [];
            const cards = await prisma.creditCard.findMany({
                where: { userId: user.id },
                include: { statements: { include: { items: true }, orderBy: { dueDate: 'desc' }, take: 2 } } // Take recent statements
            });
            const statuses = await prisma.projectionStatus.findMany({ where: { date: { gte: start, lte: end } } });
            const statusMap = new Map(statuses.map((s: any) => [`${s.referenceId}-${s.date.toISOString()}`, s.status]));

            for (const card of cards) {
                for (const statement of card.statements) {
                    // Check installments
                    for (const item of statement.items) {
                        if (item.installmentCurrent && item.installmentTotal) {
                            const remaining = item.installmentTotal - item.installmentCurrent;
                            const amount = Number(item.installmentAmount || item.amount);
                            for (let i = 1; i <= remaining; i++) {
                                const fDate = endOfMonth(subMonths(startOfMonth(statement.dueDate), -i)); // Robust add
                                if (fDate >= start && fDate <= end) {
                                    const key = `${item.id}-${fDate.toISOString()}`;
                                    const status = statusMap.get(key) || 'PENDING';
                                    projections.push({ amount, status });
                                }
                            }
                        }
                        // Check recurring
                        if (item.isRecurring) {
                            for (let i = 1; i <= 12; i++) {
                                const fDate = endOfMonth(subMonths(startOfMonth(statement.dueDate), -i));
                                if (fDate >= start && fDate <= end) {
                                    const key = `${item.id}-${fDate.toISOString()}`;
                                    const status = statusMap.get(key) || 'PENDING';
                                    projections.push({ amount: Number(item.amount), status });
                                }
                            }
                        }
                    }
                }
            }
            return projections;
        };

        const projections = await getProjectionsForRange(currentMonthStart, currentMonthEnd);
        paidProjectionsTotal = projections.filter(p => p.status === 'PAID').reduce((sum, p) => sum + p.amount, 0);
        pendingProjectionsTotal = projections.filter(p => p.status !== 'PAID' && p.status !== 'CANCELLED').reduce((sum, p) => sum + p.amount, 0);

        // Calculate "Executed" and "Pending"
        // Executed = Real Transactions (Executed) + Paid Projections
        // Pending = Pending Real Transactions + Pending Projections
        const executedTotal = executedRealExpense + paidProjectionsTotal;
        const pendingTotal = pendingRealExpense + pendingProjectionsTotal;
        const remainingBalance = (currentMonthIncome - executedTotal) - pendingTotal; // "Saldo Remanente" considers everything

        const accounts = await prisma.account.findMany({
            where: { userId: user.id }
        });

        // Historial de 6 meses y Desglose por Categoría
        const monthlyHistory = [];
        const categoryHistory: any[] = [];
        const allCategories = await prisma.category.findMany({ where: { userId: user.id } });
        const allCatMap = new Map(allCategories.map(c => [c.id, c.name]));

        const tcLabels: Record<string, string> = {
            'COMBUSTIBLE': '⛽ Combustible TC',
            'ALIMENTOS': '🛒 Alimentos TC',
            'ENTRETENIMIENTO': '🎬 Entretenimiento TC',
            'SERVICIOS': '📱 Servicios TC',
            'SEGUROS': '🛡️ Seguros TC',
            'SALUD': '💊 Salud TC',
            'GASTRONOMIA': '🍔 Gastronomía TC',
            'ROPA': '👕 Ropa TC',
            'TRANSPORTE': '🚗 Transporte TC',
            'IMPUESTOS': '📋 Impuestos TC',
            'CARGOS': '💸 Cargos TC',
            'OTROS': '📦 Otros TC'
        };

        for (let i = 5; i >= 0; i--) {
            const monthStart = startOfMonth(subMonths(now, i));
            const monthEnd = endOfMonth(subMonths(now, i));

            // Real Transactions
            const txs = await prisma.transaction.findMany({
                where: { userId: user.id, date: { gte: monthStart, lte: monthEnd } }
            });
            const income = txs.filter(t => t.type === 'INCOME').reduce((sum, t) => sum + Number(t.amount), 0);
            const expense = txs.filter(t => t.type === 'EXPENSE').reduce((sum, t) => sum + Number(t.amount), 0);

            monthlyHistory.push({
                label: format(monthStart, 'MMM yyyy', { locale: es }),
                income,
                expense,
                balance: income - expense
            });

            // Category breakdown for this month
            const monthData: any = {
                month: format(monthStart, 'MMM', { locale: es }),
                fullLabel: format(monthStart, 'MMM yyyy', { locale: es }),
                'Ingresos': income // Add Income to the dataset
            };

            // 1. Direct expenses (Real Transactions)
            const catGroups = txs.filter(t => t.type === 'EXPENSE');
            catGroups.forEach(t => {
                const name = allCatMap.get(t.categoryId || '') || 'Sin categoría';
                monthData[name] = (monthData[name] || 0) + Number(t.amount);
            });

            // 2. TC expenses (Projections/Items)
            try {
                const cards = await prisma.creditCard.findMany({
                    where: { userId: user.id },
                    include: {
                        statements: {
                            where: { dueDate: { gte: monthStart, lte: monthEnd } },
                            include: { items: true }
                        }
                    }
                });

                cards.forEach(card => {
                    card.statements.forEach(st => {
                        st.items.forEach(item => {
                            const name = tcLabels[item.category || ''] || item.category || 'Otros TC';
                            monthData[name] = (monthData[name] || 0) + Number(item.amount);
                        });
                    });
                });
            } catch (e) {
                // Ignore if TC tables missing
            }

            categoryHistory.push(monthData);
        }

        // Category Breakdown (gastos directos vs TC)
        const categoryBreakdown: { category: string; amount: number; isTC: boolean }[] = [];

        // Direct expenses by category (non-TC)
        for (const cat of topExpenseCategories) {
            const catName = categoryMap.get(cat.categoryId || '') || 'Sin categoría';
            categoryBreakdown.push({
                category: catName,
                amount: Number(cat._sum.amount) || 0,
                isTC: false
            });
        }

        // TC expenses by category
        try {
            const cards = await prisma.creditCard.findMany({
                where: { userId: user.id },
                include: {
                    statements: {
                        where: {
                            dueDate: { gte: currentMonthStart, lte: currentMonthEnd }
                        },
                        include: { items: true }
                    }
                }
            });

            const tcCategorySums: Record<string, number> = {};
            for (const card of cards) {
                for (const statement of card.statements) {
                    for (const item of statement.items) {
                        const cat = item.category || 'Otros TC';
                        tcCategorySums[cat] = (tcCategorySums[cat] || 0) + Number(item.amount);
                    }
                }
            }

            for (const [cat, amount] of Object.entries(tcCategorySums)) {
                const catLabels: Record<string, string> = {
                    'COMBUSTIBLE': '⛽ Combustible TC',
                    'ALIMENTOS': '🛒 Alimentos TC',
                    'ENTRETENIMIENTO': '🎬 Entretenimiento TC',
                    'SERVICIOS': '📱 Servicios TC',
                    'SEGUROS': '🛡️ Seguros TC',
                    'SALUD': '💊 Salud TC',
                    'GASTRONOMIA': '🍔 Gastronomía TC',
                    'ROPA': '👕 Ropa TC',
                    'TRANSPORTE': '🚗 Transporte TC',
                    'IMPUESTOS': '📋 Impuestos TC',
                    'CARGOS': '💸 Cargos TC',
                    'OTROS': '📦 Otros TC'
                };
                categoryBreakdown.push({
                    category: catLabels[cat] || cat,
                    amount,
                    isTC: true
                });
            }
        } catch (e) {
            // If credit card tables don't exist yet, skip TC breakdown
            console.log('TC breakdown skipped:', e);
        }

        return NextResponse.json({
            currentMonth: {
                label: format(currentMonthStart, 'MMMM yyyy', { locale: es }),
                income: currentMonthIncome,
                expense: currentMonthExpense,
                balance: currentMonthIncome - currentMonthExpense,
                // New Fields
                executed: executedTotal,
                pending: pendingTotal,
                remaining: remainingBalance
            },
            previousMonth: {
                label: format(previousMonthStart, 'MMMM yyyy', { locale: es }),
                income: previousMonthIncome,
                expense: previousMonthExpense,
                balance: previousMonthIncome - previousMonthExpense
            },
            monthlyVariation: {
                income: calcVariation(currentMonthIncome, previousMonthIncome),
                expense: calcVariation(currentMonthExpense, previousMonthExpense),
                balance: calcVariation(currentMonthIncome - currentMonthExpense, previousMonthIncome - previousMonthExpense)
            },
            currentWeek: {
                income: currentWeekIncome,
                expense: currentWeekExpense,
                balance: currentWeekIncome - currentWeekExpense
            },
            previousWeek: {
                income: previousWeekIncome,
                expense: previousWeekExpense,
                balance: previousWeekIncome - previousWeekExpense
            },
            weeklyVariation: {
                income: calcVariation(currentWeekIncome, previousWeekIncome),
                expense: calcVariation(currentWeekExpense, previousWeekExpense),
                balance: calcVariation(currentWeekIncome - currentWeekExpense, previousWeekIncome - previousWeekExpense)
            },
            allTime: {
                income: Number(allTimeIncome._sum.amount) || 0,
                expense: Number(allTimeExpense._sum.amount) || 0,
                balance: (Number(allTimeIncome._sum.amount) || 0) - (Number(allTimeExpense._sum.amount) || 0)
            },
            topExpenses,
            accounts: accounts.map(a => ({
                name: a.name,
                type: a.type,
                balance: Number(a.balance)
            })),
            monthlyHistory,
            categoryHistory,
            categoryBreakdown: categoryBreakdown.filter(c => c.amount > 0).sort((a, b) => b.amount - a.amount)
        });
    } catch (e: any) {
        console.error(e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
