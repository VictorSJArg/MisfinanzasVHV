import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { startOfMonth, endOfMonth, subMonths, format } from 'date-fns';
import { es } from 'date-fns/locale';

const prisma = new PrismaClient();

export async function GET(request: NextRequest) {
    const searchParams = request.nextUrl.searchParams;
    const queryType = searchParams.get('type');

    try {
        switch (queryType) {
            case 'summary':
                return handleSummary(searchParams);
            case 'category':
                return handleCategory(searchParams);
            case 'comparison':
                return handleComparison(searchParams);
            case 'cards':
                return handleCards(searchParams);
            case 'trends':
                return handleTrends(searchParams);
            default:
                return NextResponse.json(
                    { success: false, error: 'Invalid query type. Use: summary, category, comparison, cards, or trends' },
                    { status: 400 }
                );
        }
    } catch (error) {
        console.error('Analytics error:', error);
        return NextResponse.json(
            { success: false, error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' },
            { status: 500 }
        );
    }
}

async function handleSummary(params: URLSearchParams) {
    const month = parseInt(params.get('month') || (new Date().getMonth() + 1).toString());
    const year = parseInt(params.get('year') || new Date().getFullYear().toString());

    const startDate = startOfMonth(new Date(year, month - 1));
    const endDate = endOfMonth(new Date(year, month - 1));

    // Obtener transacciones del mes
    const transactions = await prisma.transaction.findMany({
        where: {
            date: {
                gte: startDate.toISOString(),
                lte: endDate.toISOString(),
            },
        },
        include: {
            category: true,
        },
    });

    const income = transactions
        .filter(t => t.category && t.category.type === 'INCOME')
        .reduce((sum, t) => sum + Number(t.amount), 0);

    const expense = transactions
        .filter(t => t.category && t.category.type === 'EXPENSE')
        .reduce((sum, t) => sum + Number(t.amount), 0);

    // Obtener mes anterior para comparación
    const prevMonth = subMonths(startDate, 1);
    const prevTransactions = await prisma.transaction.findMany({
        where: {
            date: {
                gte: startOfMonth(prevMonth).toISOString(),
                lte: endOfMonth(prevMonth).toISOString(),
            },
        },
        include: {
            category: true,
        },
    });

    const prevIncome = prevTransactions
        .filter(t => t.category && t.category.type === 'INCOME')
        .reduce((sum, t) => sum + Number(t.amount), 0);

    const prevExpense = prevTransactions
        .filter(t => t.category && t.category.type === 'EXPENSE')
        .reduce((sum, t) => sum + Number(t.amount), 0);

    return NextResponse.json({
        success: true,
        data: {
            summary: {
                income,
                expense,
                balance: income - expense,
                period: format(startDate, 'MMMM yyyy', { locale: es }),
            },
            comparison: {
                current: {
                    income,
                    expense,
                },
                previous: {
                    income: prevIncome,
                    expense: prevExpense,
                },
                difference: {
                    income: income - prevIncome,
                    expense: expense - prevExpense,
                },
                percentageChange: {
                    income: prevIncome > 0 ? ((income - prevIncome) / prevIncome) * 100 : 0,
                    expense: prevExpense > 0 ? ((expense - prevExpense) / prevExpense) * 100 : 0,
                },
            },
            insights: generateInsights(income, expense, prevIncome, prevExpense),
        },
        metadata: {
            timestamp: new Date().toISOString(),
            queryType: 'summary',
        },
    });
}

async function handleCategory(params: URLSearchParams) {
    const categoryName = params.get('category');
    const month = parseInt(params.get('month') || (new Date().getMonth() + 1).toString());
    const year = parseInt(params.get('year') || new Date().getFullYear().toString());

    if (!categoryName) {
        return NextResponse.json(
            { success: false, error: 'Category name is required' },
            { status: 400 }
        );
    }

    const startDate = startOfMonth(new Date(year, month - 1));
    const endDate = endOfMonth(new Date(year, month - 1));

    const transactions = await prisma.transaction.findMany({
        where: {
            date: {
                gte: startDate.toISOString(),
                lte: endDate.toISOString(),
            },
            category: {
                name: {
                    contains: categoryName,
                    mode: 'insensitive',
                },
            },
        },
        include: {
            category: true,
        },
        orderBy: {
            date: 'desc',
        },
    });

    const total = transactions.reduce((sum, t) => sum + Number(t.amount), 0);

    // Obtener mes anterior para comparación
    const prevMonth = subMonths(startDate, 1);
    const prevTransactions = await prisma.transaction.findMany({
        where: {
            date: {
                gte: startOfMonth(prevMonth).toISOString(),
                lte: endOfMonth(prevMonth).toISOString(),
            },
            category: {
                name: {
                    contains: categoryName,
                    mode: 'insensitive',
                },
            },
        },
    });

    const prevTotal = prevTransactions.reduce((sum, t) => sum + Number(t.amount), 0);

    return NextResponse.json({
        success: true,
        data: {
            category: categoryName,
            total,
            transactionCount: transactions.length,
            transactions: transactions.slice(0, 10).map(t => ({
                date: format(new Date(t.date), 'dd/MM/yyyy'),
                amount: Number(t.amount),
                description: t.description,
            })),
            comparison: {
                current: total,
                previous: prevTotal,
                difference: total - prevTotal,
                percentageChange: prevTotal > 0 ? ((total - prevTotal) / prevTotal) * 100 : 0,
            },
        },
        metadata: {
            timestamp: new Date().toISOString(),
            queryType: 'category',
        },
    });
}

async function handleCards(params: URLSearchParams) {
    // Obtener todas las categorías de tipo tarjeta de crédito
    const categories = await prisma.category.findMany({
        where: {
            type: 'EXPENSE',
        },
    });

    // Filtrar las que parecen ser tarjetas (nombres comunes)
    const cardKeywords = ['visa', 'mastercard', 'amex', 'naranja', 'tc', 'tarjeta', 'card'];
    const cardCategories = categories.filter(cat =>
        cardKeywords.some(keyword => cat.name.toLowerCase().includes(keyword))
    );

    // Para cada tarjeta, obtener transacciones pendientes y próximos vencimientos
    const cardData = await Promise.all(
        cardCategories.map(async (card) => {
            // Obtener transacciones del mes actual
            const startDate = startOfMonth(new Date());
            const endDate = endOfMonth(new Date());

            const transactions = await prisma.transaction.findMany({
                where: {
                    categoryId: card.id,
                    date: {
                        gte: startDate.toISOString(),
                        lte: endDate.toISOString(),
                    },
                },
            });

            const balance = transactions.reduce((sum, t) => sum + Number(t.amount), 0);

            return {
                cardName: card.name,
                balance,
                transactionCount: transactions.length,
                categoryId: card.id,
            };
        })
    );

    return NextResponse.json({
        success: true,
        data: {
            cards: cardData.filter(c => c.balance > 0 || c.transactionCount > 0),
            totalBalance: cardData.reduce((sum, c) => sum + c.balance, 0),
            period: format(new Date(), 'MMMM yyyy', { locale: es }),
        },
        metadata: {
            timestamp: new Date().toISOString(),
            queryType: 'cards',
        },
    });
}

async function handleComparison(params: URLSearchParams) {
    const startDateStr = params.get('startDate');
    const endDateStr = params.get('endDate');
    const compareWithStr = params.get('compareWith');

    if (!startDateStr || !endDateStr) {
        return NextResponse.json(
            { success: false, error: 'startDate and endDate are required' },
            { status: 400 }
        );
    }

    const startDate = new Date(startDateStr);
    const endDate = new Date(endDateStr);

    // Obtener transacciones del período principal
    const transactions = await prisma.transaction.findMany({
        where: {
            date: {
                gte: startDate.toISOString(),
                lte: endDate.toISOString(),
            },
        },
        include: {
            category: true,
        },
    });

    const income = transactions
        .filter(t => t.category && t.category.type === 'INCOME')
        .reduce((sum, t) => sum + Number(t.amount), 0);

    const expense = transactions
        .filter(t => t.category && t.category.type === 'EXPENSE')
        .reduce((sum, t) => sum + Number(t.amount), 0);

    // Si hay período de comparación
    let comparison = null;
    if (compareWithStr) {
        const compareStart = new Date(compareWithStr);
        const daysDiff = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
        const compareEnd = new Date(compareStart.getTime() + daysDiff * 24 * 60 * 60 * 1000);

        const compareTransactions = await prisma.transaction.findMany({
            where: {
                date: {
                    gte: compareStart.toISOString(),
                    lte: compareEnd.toISOString(),
                },
            },
            include: {
                category: true,
            },
        });

        const compareIncome = compareTransactions
            .filter(t => t.category && t.category.type === 'INCOME')
            .reduce((sum, t) => sum + Number(t.amount), 0);

        const compareExpense = compareTransactions
            .filter(t => t.category && t.category.type === 'EXPENSE')
            .reduce((sum, t) => sum + Number(t.amount), 0);

        comparison = {
            income: compareIncome,
            expense: compareExpense,
            balance: compareIncome - compareExpense,
            difference: {
                income: income - compareIncome,
                expense: expense - compareExpense,
            },
            percentageChange: {
                income: compareIncome > 0 ? ((income - compareIncome) / compareIncome) * 100 : 0,
                expense: compareExpense > 0 ? ((expense - compareExpense) / compareExpense) * 100 : 0,
            },
        };
    }

    return NextResponse.json({
        success: true,
        data: {
            current: {
                income,
                expense,
                balance: income - expense,
                period: `${format(startDate, 'dd/MM/yyyy')} - ${format(endDate, 'dd/MM/yyyy')}`,
            },
            comparison,
        },
        metadata: {
            timestamp: new Date().toISOString(),
            queryType: 'comparison',
        },
    });
}

async function handleTrends(params: URLSearchParams) {
    const categoryName = params.get('category');
    const months = parseInt(params.get('months') || '6');

    const trends = [];
    const now = new Date();

    for (let i = 0; i < months; i++) {
        const monthDate = subMonths(now, i);
        const startDate = startOfMonth(monthDate);
        const endDate = endOfMonth(monthDate);

        const whereClause: any = {
            date: {
                gte: startDate.toISOString(),
                lte: endDate.toISOString(),
            },
        };

        if (categoryName) {
            whereClause.category = {
                name: {
                    contains: categoryName,
                    mode: 'insensitive',
                },
            };
        }

        const transactions = await prisma.transaction.findMany({
            where: whereClause,
            include: {
                category: true,
            },
        });

        const income = transactions
            .filter(t => t.category && t.category.type === 'INCOME')
            .reduce((sum, t) => sum + Number(t.amount), 0);

        const expense = transactions
            .filter(t => t.category && t.category.type === 'EXPENSE')
            .reduce((sum, t) => sum + Number(t.amount), 0);

        trends.unshift({
            month: format(monthDate, 'MMM yyyy', { locale: es }),
            income,
            expense,
            balance: income - expense,
        });
    }

    return NextResponse.json({
        success: true,
        data: {
            category: categoryName || 'Todos',
            trends,
            average: {
                income: trends.reduce((sum, t) => sum + t.income, 0) / trends.length,
                expense: trends.reduce((sum, t) => sum + t.expense, 0) / trends.length,
            },
        },
        metadata: {
            timestamp: new Date().toISOString(),
            queryType: 'trends',
        },
    });
}

function generateInsights(
    income: number,
    expense: number,
    prevIncome: number,
    prevExpense: number
): string[] {
    const insights: string[] = [];
    const balance = income - expense;
    const expenseRatio = income > 0 ? (expense / income) * 100 : 0;

    // Análisis de ratio de gastos
    if (expenseRatio > 95) {
        insights.push('🚨 ALERTA: Estás gastando más del 95% de tus ingresos');
    } else if (expenseRatio > 80) {
        insights.push('⚠️ Estás gastando más del 80% de tus ingresos. Considera reducir gastos.');
    } else if (expenseRatio < 50) {
        insights.push('💪 ¡Excelente! Estás ahorrando más del 50% de tus ingresos');
    }

    // Análisis de tendencias de gastos
    if (expense > prevExpense) {
        const increase = ((expense - prevExpense) / prevExpense) * 100;
        if (increase > 20) {
            insights.push(`📈 ATENCIÓN: Tus gastos aumentaron ${increase.toFixed(1)}% respecto al mes anterior`);
        } else {
            insights.push(`📊 Tus gastos aumentaron ${increase.toFixed(1)}% respecto al mes anterior`);
        }
    } else if (expense < prevExpense) {
        const decrease = ((prevExpense - expense) / prevExpense) * 100;
        insights.push(`📉 ¡Muy bien! Redujiste tus gastos en ${decrease.toFixed(1)}%`);
    }

    // Análisis de ingresos
    if (income > prevIncome) {
        const increase = ((income - prevIncome) / prevIncome) * 100;
        insights.push(`💰 Tus ingresos aumentaron ${increase.toFixed(1)}%`);
    } else if (income < prevIncome) {
        const decrease = ((prevIncome - income) / prevIncome) * 100;
        insights.push(`⚠️ Tus ingresos disminuyeron ${decrease.toFixed(1)}%`);
    }

    // Análisis de balance
    if (balance > 0) {
        insights.push(`✅ Balance positivo de $${balance.toLocaleString('es-AR')}`);
    } else if (balance < 0) {
        insights.push(`❌ Balance negativo de $${Math.abs(balance).toLocaleString('es-AR')}`);
    }

    return insights;
}
