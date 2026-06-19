import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { deleteTransactionWithBalance, deleteTransactionsWithBalance, updateTransactionWithBalance } from '@/lib/transactions';

function errorMessage(error: unknown) {
    return error instanceof Error ? error.message : 'Unknown error';
}

function errorStatus(error: unknown) {
    return error instanceof Error && error.message === 'Transaction not found' ? 404 : 500;
}

// GET - Obtener transacciones de una celda especifica.
export async function GET(request: NextRequest) {
    const searchParams = request.nextUrl.searchParams;
    const categoryId = searchParams.get('categoryId');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');

    if (!categoryId || !startDate || !endDate) {
        return NextResponse.json({ error: 'Missing parameters' }, { status: 400 });
    }

    const transactions = await prisma.transaction.findMany({
        where: {
            categoryId,
            date: {
                gte: new Date(startDate),
                lte: new Date(endDate)
            }
        },
        include: {
            category: true,
            account: true
        },
        orderBy: { date: 'desc' }
    });

    const userId = transactions[0]?.userId;
    if (!userId) {
        return NextResponse.json(transactions);
    }

    const exclusions = await prisma.alertExclusion.findMany({
        where: {
            userId,
            categoryId
        },
        select: { description: true }
    });
    const excludedCategory = exclusions.some((exclusion) => exclusion.description === '');
    const excludedDescriptions = new Set(
        exclusions
            .filter((exclusion) => exclusion.description !== '')
            .map((exclusion) => exclusion.description)
    );

    return NextResponse.json(transactions.map((transaction) => ({
        ...transaction,
        alertsExcluded: excludedCategory || excludedDescriptions.has(transaction.description?.trim() || '')
    })));
}

// PUT - Actualizar una transaccion y mantener el saldo de cuenta sincronizado.
export async function PUT(request: NextRequest) {
    try {
        const body = await request.json();
        const { id, amount, date, description, categoryId, accountId, type, status } = body;

        if (!id) {
            return NextResponse.json({ error: 'Transaction ID required' }, { status: 400 });
        }

        const updatedTx = await updateTransactionWithBalance(id, {
            amount,
            date,
            description,
            categoryId,
            accountId,
            type,
            status
        });

        return NextResponse.json(updatedTx);
    } catch (error: unknown) {
        console.error(error);
        return NextResponse.json({ error: errorMessage(error) }, { status: errorStatus(error) });
    }
}

// DELETE - Eliminar una transaccion o todas las de una celda.
export async function DELETE(request: NextRequest) {
    try {
        const searchParams = request.nextUrl.searchParams;
        const id = searchParams.get('id');
        const categoryId = searchParams.get('categoryId');
        const startDate = searchParams.get('startDate');
        const endDate = searchParams.get('endDate');

        if (id) {
            await deleteTransactionWithBalance(id);
            return NextResponse.json({ success: true });
        }

        const matchDescription = searchParams.get('matchDescription') === 'true';
        const description = searchParams.get('description');

        if (categoryId && startDate && endDate) {
            const whereClause: Prisma.TransactionWhereInput = {
                categoryId,
                date: {
                    gte: new Date(startDate),
                    lte: new Date(endDate)
                }
            };

            if (matchDescription) {
                if (description !== null && description !== '') {
                    whereClause.description = description;
                } else {
                    whereClause.OR = [
                        { description: null },
                        { description: '' },
                        { description: 'Sin descripcion' },
                        { description: 'Sin descripción' }
                    ];
                }
            }

            const count = await deleteTransactionsWithBalance(whereClause);
            return NextResponse.json({ success: true, count });
        }

        return NextResponse.json({ error: 'Missing parameters' }, { status: 400 });
    } catch (error: unknown) {
        console.error(error);
        return NextResponse.json({ error: errorMessage(error) }, { status: errorStatus(error) });
    }
}
