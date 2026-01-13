import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(request: NextRequest) {
    try {
        const searchParams = request.nextUrl.searchParams;

        // Parámetros de búsqueda
        const query = searchParams.get('query');
        const category = searchParams.get('category');
        const type = searchParams.get('type') as 'INCOME' | 'EXPENSE' | null;
        const startDate = searchParams.get('startDate');
        const endDate = searchParams.get('endDate');
        const minAmount = searchParams.get('minAmount');
        const maxAmount = searchParams.get('maxAmount');
        const limit = parseInt(searchParams.get('limit') || '20');

        // Si viene query con múltiples palabras, hacer búsqueda flexible
        let transactions: any[] = [];
        let totalCount = 0;

        if (query && query.trim()) {
            // Dividir query en palabras y buscar cada una
            const words = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);

            if (words.length > 0) {
                // Construir condiciones OR para cada palabra
                const orConditions = words.map(word => ({
                    description: {
                        contains: word,
                        mode: 'insensitive' as const,
                    }
                }));

                // Construir filtros base
                const baseWhere: any = {};

                if (type) {
                    baseWhere.type = type;
                }

                if (category) {
                    baseWhere.category = {
                        name: {
                            contains: category,
                            mode: 'insensitive',
                        },
                    };
                }

                if (startDate || endDate) {
                    baseWhere.date = {};
                    if (startDate) {
                        baseWhere.date.gte = new Date(startDate).toISOString();
                    }
                    if (endDate) {
                        const end = new Date(endDate);
                        end.setHours(23, 59, 59, 999);
                        baseWhere.date.lte = end.toISOString();
                    }
                }

                if (minAmount || maxAmount) {
                    baseWhere.amount = {};
                    if (minAmount) {
                        baseWhere.amount.gte = parseFloat(minAmount);
                    }
                    if (maxAmount) {
                        baseWhere.amount.lte = parseFloat(maxAmount);
                    }
                }

                // Combinar OR conditions con filtros base
                const finalWhere = {
                    ...baseWhere,
                    OR: orConditions,
                };

                // Buscar transacciones
                const allTransactions = await prisma.transaction.findMany({
                    where: finalWhere,
                    include: {
                        category: true,
                        account: true,
                    },
                    orderBy: {
                        date: 'desc',
                    },
                });

                // Rankear por número de palabras encontradas
                const rankedTransactions = allTransactions.map(t => {
                    const desc = (t.description || '').toLowerCase();
                    const matchCount = words.filter(word => desc.includes(word)).length;
                    return { transaction: t, score: matchCount };
                });

                // Ordenar por score (más coincidencias primero)
                rankedTransactions.sort((a, b) => b.score - a.score);

                // Tomar límite
                transactions = rankedTransactions.slice(0, limit).map(r => r.transaction);
                totalCount = allTransactions.length;
            }
        } else {
            // Búsqueda sin query text (solo por otros filtros)
            const where: any = {};

            if (type) {
                where.type = type;
            }

            if (category) {
                where.category = {
                    name: {
                        contains: category,
                        mode: 'insensitive',
                    },
                };
            }

            if (startDate || endDate) {
                where.date = {};
                if (startDate) {
                    where.date.gte = new Date(startDate).toISOString();
                }
                if (endDate) {
                    const end = new Date(endDate);
                    end.setHours(23, 59, 59, 999);
                    where.date.lte = end.toISOString();
                }
            }

            if (minAmount || maxAmount) {
                where.amount = {};
                if (minAmount) {
                    where.amount.gte = parseFloat(minAmount);
                }
                if (maxAmount) {
                    where.amount.lte = parseFloat(maxAmount);
                }
            }

            transactions = await prisma.transaction.findMany({
                where,
                include: {
                    category: true,
                    account: true,
                },
                orderBy: {
                    date: 'desc',
                },
                take: limit,
            });

            totalCount = await prisma.transaction.count({ where });
        }

        // Calcular total
        const total = transactions.reduce((sum, t) => sum + Number(t.amount), 0);

        return NextResponse.json({
            success: true,
            data: {
                transactions: transactions.map(t => ({
                    id: t.id,
                    date: t.date,
                    description: t.description,
                    amount: Number(t.amount),
                    type: t.type,
                    category: t.category?.name,
                    account: t.account?.name,
                })),
                totalFound: totalCount,
                totalAmount: total,
                query: query || category || 'todas',
                filters: {
                    query,
                    category,
                    type,
                    startDate,
                    endDate,
                    minAmount,
                    maxAmount,
                },
            },
            metadata: {
                timestamp: new Date().toISOString(),
                queryType: 'search_transactions',
            },
        });
    } catch (error) {
        console.error('Transaction search error:', error);
        return NextResponse.json(
            {
                success: false,
                error: 'Error al buscar transacciones',
                details: error instanceof Error ? error.message : 'Unknown error',
            },
            { status: 500 }
        );
    }
}
