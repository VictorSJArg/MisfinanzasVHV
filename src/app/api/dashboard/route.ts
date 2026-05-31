import { NextRequest, NextResponse } from 'next/server';
import { endOfMonth, endOfWeek, format, startOfMonth, startOfWeek, subMonths, subWeeks } from 'date-fns';
import { es } from 'date-fns/locale';
import { prisma } from '@/lib/prisma';
import { CreditCardProjection, getCreditCardProjectionsForRange } from '@/lib/creditCardProjections';

const tcLabels: Record<string, string> = {
    COMBUSTIBLE: 'Combustible TC',
    ALIMENTOS: 'Alimentos TC',
    ENTRETENIMIENTO: 'Entretenimiento TC',
    SERVICIOS: 'Servicios TC',
    SEGUROS: 'Seguros TC',
    SALUD: 'Salud TC',
    GASTRONOMIA: 'Gastronomia TC',
    ROPA: 'Ropa TC',
    TRANSPORTE: 'Transporte TC',
    IMPUESTOS: 'Impuestos TC',
    CARGOS: 'Cargos TC',
    STATEMENT: 'Pago Resumen TC',
    OTROS: 'Otros TC'
};

function inRange(date: Date, start: Date, end: Date) {
    return date >= start && date <= end;
}

function projectionDate(projection: CreditCardProjection) {
    return new Date(projection.date);
}

function activeProjections(projections: CreditCardProjection[]) {
    return projections.filter((projection) => projection.status !== 'CANCELLED');
}

function sum(values: number[]) {
    return values.reduce((total, value) => total + value, 0);
}

function calcVariation(current: number, previous: number) {
    if (previous === 0) return current > 0 ? 100 : 0;
    return ((current - previous) / previous) * 100;
}

function txsInRange<T extends { date: Date }>(transactions: T[], start: Date, end: Date) {
    return transactions.filter((transaction) => inRange(transaction.date, start, end));
}

function projectionsInRange(projections: CreditCardProjection[], start: Date, end: Date) {
    return projections.filter((projection) => inRange(projectionDate(projection), start, end));
}

function effectiveType(transaction: { type: string; categoryId: string | null }, categoryTypeMap: Map<string, string>) {
    return transaction.categoryId ? categoryTypeMap.get(transaction.categoryId) || transaction.type : transaction.type;
}

function realIncome(transactions: Array<{ type: string; amount: unknown; categoryId: string | null }>, categoryTypeMap: Map<string, string>) {
    return sum(
        transactions
            .filter((transaction) => effectiveType(transaction, categoryTypeMap) === 'INCOME')
            .map((transaction) => Number(transaction.amount))
    );
}

function realExpense(transactions: Array<{ type: string; amount: unknown; status: string; categoryId: string | null }>, categoryTypeMap: Map<string, string>) {
    return sum(
        transactions
            .filter((transaction) => effectiveType(transaction, categoryTypeMap) === 'EXPENSE' && transaction.status !== 'CANCELLED')
            .map((transaction) => Number(transaction.amount))
    );
}

function projectionExpense(projections: CreditCardProjection[]) {
    return sum(activeProjections(projections).map((projection) => projection.amount));
}

function projectionCategoryName(category?: string) {
    const key = category || 'OTROS';
    return tcLabels[key] || `${key} TC`;
}

export async function GET(request: NextRequest) {
    try {
        const user = await prisma.user.findFirst();
        if (!user) return NextResponse.json({ error: 'No user found' }, { status: 400 });

        const { searchParams } = new URL(request.url);
        const yearParam = searchParams.get('year');
        const monthParam = searchParams.get('month');

        const now = yearParam && monthParam
            ? new Date(parseInt(yearParam), parseInt(monthParam) - 1, 15)
            : new Date();

        const currentMonthStart = startOfMonth(now);
        const currentMonthEnd = endOfMonth(now);
        const previousMonthStart = startOfMonth(subMonths(now, 1));
        const previousMonthEnd = endOfMonth(subMonths(now, 1));
        const currentWeekStart = startOfWeek(now, { weekStartsOn: 0 });
        const currentWeekEnd = endOfWeek(now, { weekStartsOn: 0 });
        const previousWeekStart = startOfWeek(subWeeks(now, 1), { weekStartsOn: 0 });
        const previousWeekEnd = endOfWeek(subWeeks(now, 1), { weekStartsOn: 0 });
        const historyStart = startOfMonth(subMonths(now, 5));

        const [transactions, allTransactions, categories, accounts, projections] = await Promise.all([
            prisma.transaction.findMany({
                where: {
                    userId: user.id,
                    date: { gte: historyStart, lte: currentMonthEnd }
                }
            }),
            prisma.transaction.findMany({
                where: { userId: user.id, status: { not: 'CANCELLED' } },
                select: {
                    amount: true,
                    type: true,
                    status: true,
                    categoryId: true
                }
            }),
            prisma.category.findMany({ where: { userId: user.id } }),
            prisma.account.findMany({ where: { userId: user.id } }),
            getCreditCardProjectionsForRange(user.id, historyStart, currentMonthEnd)
        ]);

        const categoryMap = new Map(categories.map((category) => [category.id, category.name]));
        const categoryTypeMap = new Map(categories.map((category) => [category.id, category.type]));

        const currentMonthTxs = txsInRange(transactions, currentMonthStart, currentMonthEnd);
        const previousMonthTxs = txsInRange(transactions, previousMonthStart, previousMonthEnd);
        const currentWeekTxs = txsInRange(transactions, currentWeekStart, currentWeekEnd);
        const previousWeekTxs = txsInRange(transactions, previousWeekStart, previousWeekEnd);

        const currentMonthProjections = projectionsInRange(projections, currentMonthStart, currentMonthEnd);
        const previousMonthProjections = projectionsInRange(projections, previousMonthStart, previousMonthEnd);
        const currentWeekProjections = projectionsInRange(projections, currentWeekStart, currentWeekEnd);
        const previousWeekProjections = projectionsInRange(projections, previousWeekStart, previousWeekEnd);

        const currentMonthIncome = realIncome(currentMonthTxs, categoryTypeMap);
        const previousMonthIncome = realIncome(previousMonthTxs, categoryTypeMap);
        const currentWeekIncome = realIncome(currentWeekTxs, categoryTypeMap);
        const previousWeekIncome = realIncome(previousWeekTxs, categoryTypeMap);

        const currentMonthExpense = realExpense(currentMonthTxs, categoryTypeMap) + projectionExpense(currentMonthProjections);
        const previousMonthExpense = realExpense(previousMonthTxs, categoryTypeMap) + projectionExpense(previousMonthProjections);
        const currentWeekExpense = realExpense(currentWeekTxs, categoryTypeMap) + projectionExpense(currentWeekProjections);
        const previousWeekExpense = realExpense(previousWeekTxs, categoryTypeMap) + projectionExpense(previousWeekProjections);

        const executedRealExpense = sum(
            currentMonthTxs
                .filter((transaction) => effectiveType(transaction, categoryTypeMap) === 'EXPENSE' && (transaction.status === 'PAID' || !transaction.status))
                .map((transaction) => Number(transaction.amount))
        );
        const pendingRealExpense = sum(
            currentMonthTxs
                .filter((transaction) => effectiveType(transaction, categoryTypeMap) === 'EXPENSE' && transaction.status !== 'PAID' && transaction.status !== 'CANCELLED')
                .map((transaction) => Number(transaction.amount))
        );
        const paidProjectionsTotal = sum(currentMonthProjections.filter((projection) => projection.status === 'PAID').map((projection) => projection.amount));
        const pendingProjectionsTotal = sum(currentMonthProjections.filter((projection) => projection.status !== 'PAID' && projection.status !== 'CANCELLED').map((projection) => projection.amount));
        const executedTotal = executedRealExpense + paidProjectionsTotal;
        const pendingTotal = pendingRealExpense + pendingProjectionsTotal;
        const remainingBalance = currentMonthIncome - executedTotal - pendingTotal;

        const categoryBreakdownMap = new Map<string, { category: string; amount: number; isTC: boolean }>();
        for (const transaction of currentMonthTxs) {
            if (effectiveType(transaction, categoryTypeMap) !== 'EXPENSE' || transaction.status === 'CANCELLED') continue;
            const name = categoryMap.get(transaction.categoryId || '') || 'Sin categoria';
            const current = categoryBreakdownMap.get(`real:${name}`) || { category: name, amount: 0, isTC: false };
            current.amount += Number(transaction.amount);
            categoryBreakdownMap.set(`real:${name}`, current);
        }
        for (const projection of activeProjections(currentMonthProjections)) {
            const name = projectionCategoryName(projection.category);
            const current = categoryBreakdownMap.get(`tc:${name}`) || { category: name, amount: 0, isTC: true };
            current.amount += projection.amount;
            categoryBreakdownMap.set(`tc:${name}`, current);
        }

        const categoryBreakdown = Array.from(categoryBreakdownMap.values())
            .filter((item) => item.amount > 0)
            .sort((a, b) => b.amount - a.amount);

        const topExpenses = categoryBreakdown.slice(0, 5).map((item) => ({
            category: item.category,
            amount: item.amount
        }));

        const monthlyHistory = [];
        const categoryHistory = [];

        for (let i = 5; i >= 0; i--) {
            const monthStart = startOfMonth(subMonths(now, i));
            const monthEnd = endOfMonth(subMonths(now, i));
            const monthTxs = txsInRange(transactions, monthStart, monthEnd);
            const monthProjections = projectionsInRange(projections, monthStart, monthEnd);
            const income = realIncome(monthTxs, categoryTypeMap);
            const expense = realExpense(monthTxs, categoryTypeMap) + projectionExpense(monthProjections);

            monthlyHistory.push({
                label: format(monthStart, 'MMM yyyy', { locale: es }),
                income,
                expense,
                balance: income - expense
            });

            const monthData: Record<string, number | string> = {
                month: format(monthStart, 'MMM', { locale: es }),
                fullLabel: format(monthStart, 'MMM yyyy', { locale: es }),
                Ingresos: income
            };

            for (const transaction of monthTxs) {
                if (effectiveType(transaction, categoryTypeMap) !== 'EXPENSE' || transaction.status === 'CANCELLED') continue;
                const name = categoryMap.get(transaction.categoryId || '') || 'Sin categoria';
                monthData[name] = Number(monthData[name] || 0) + Number(transaction.amount);
            }

            for (const projection of activeProjections(monthProjections)) {
                const name = projectionCategoryName(projection.category);
                monthData[name] = Number(monthData[name] || 0) + projection.amount;
            }

            categoryHistory.push(monthData);
        }

        const allTimeIncomeValue = realIncome(allTransactions, categoryTypeMap);
        const allTimeExpenseValue = realExpense(allTransactions, categoryTypeMap);

        return NextResponse.json({
            currentMonth: {
                label: format(currentMonthStart, 'MMMM yyyy', { locale: es }),
                income: currentMonthIncome,
                expense: currentMonthExpense,
                balance: currentMonthIncome - currentMonthExpense,
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
                income: allTimeIncomeValue,
                expense: allTimeExpenseValue,
                balance: allTimeIncomeValue - allTimeExpenseValue
            },
            topExpenses,
            accounts: accounts.map((account) => ({
                name: account.name,
                type: account.type,
                balance: Number(account.balance)
            })),
            monthlyHistory,
            categoryHistory,
            categoryBreakdown
        });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error(error);
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
