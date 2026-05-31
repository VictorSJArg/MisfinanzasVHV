import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { balanceMultiplier } from '@/lib/transactions';

interface BulkInputTransaction {
    categoryId?: string;
    amount?: number | string;
    date?: string;
    type?: string;
    description?: string;
    status?: string;
}

function errorMessage(error: unknown) {
    return error instanceof Error ? error.message : 'Unknown error';
}

function buildWhere(request: NextRequest, userId: string) {
    const searchParams = request.nextUrl.searchParams;
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const categoryId = searchParams.get('categoryId');
    const type = searchParams.get('type');

    if (!startDate || !endDate) {
        return { error: 'startDate and endDate are required' };
    }

    const where: Prisma.TransactionWhereInput = {
        userId,
        date: {
            gte: new Date(startDate),
            lte: new Date(endDate)
        }
    };

    if (categoryId) where.categoryId = categoryId;
    if (type === 'INCOME' || type === 'EXPENSE') where.type = type;

    return { where };
}

function validateBulkTransactions(transactions: BulkInputTransaction[]) {
    const errors: string[] = [];

    transactions.forEach((transaction, index) => {
        if (!transaction.categoryId || !transaction.amount || !transaction.date || !transaction.type) {
            errors.push(`Fila ${index + 1}: Faltan campos obligatorios`);
            return;
        }

        if (transaction.type !== 'INCOME' && transaction.type !== 'EXPENSE') {
            errors.push(`Fila ${index + 1}: Tipo invalido`);
        }

        if (!Number.isFinite(Number(transaction.amount))) {
            errors.push(`Fila ${index + 1}: Monto invalido`);
        }

        const parsedDate = new Date(transaction.date);
        if (Number.isNaN(parsedDate.getTime())) {
            errors.push(`Fila ${index + 1}: Fecha invalida`);
        }
    });

    return errors;
}

// GET - Preview transactions to be deleted (for bulk delete preview)
export async function GET(request: NextRequest) {
    try {
        const user = await prisma.user.findFirst();
        if (!user) return NextResponse.json({ error: 'No user found' }, { status: 400 });

        const result = buildWhere(request, user.id);
        if ('error' in result) {
            return NextResponse.json({ error: result.error }, { status: 400 });
        }

        const transactions = await prisma.transaction.findMany({
            where: result.where,
            include: {
                category: { select: { name: true, type: true } }
            },
            orderBy: { date: 'desc' }
        });

        const grouped: Record<string, { categoryName: string, type: string, count: number, total: number }> = {};

        transactions.forEach((transaction) => {
            const catName = transaction.category?.name || 'Sin categoria';
            const catType = transaction.category?.type || 'UNKNOWN';
            if (!grouped[catName]) {
                grouped[catName] = { categoryName: catName, type: catType, count: 0, total: 0 };
            }
            grouped[catName].count++;
            grouped[catName].total += Number(transaction.amount);
        });

        return NextResponse.json({
            preview: Object.values(grouped),
            totalCount: transactions.length,
            totalAmount: transactions.reduce((sum, transaction) => sum + Number(transaction.amount), 0)
        });
    } catch (error: unknown) {
        console.error(error);
        return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
    }
}

// DELETE - Bulk delete transactions atomically
export async function DELETE(request: NextRequest) {
    try {
        const user = await prisma.user.findFirst();
        if (!user) return NextResponse.json({ error: 'No user found' }, { status: 400 });

        const result = buildWhere(request, user.id);
        if ('error' in result) {
            return NextResponse.json({ error: result.error }, { status: 400 });
        }

        const deletedCount = await prisma.$transaction(async (tx) => {
            const transactions = await tx.transaction.findMany({ where: result.where });
            const balanceDeltas = new Map<string, number>();

            for (const transaction of transactions) {
                const delta = Number(transaction.amount) * -balanceMultiplier(transaction.type);
                balanceDeltas.set(transaction.accountId, (balanceDeltas.get(transaction.accountId) || 0) + delta);
            }

            for (const [accountId, delta] of balanceDeltas) {
                await tx.account.update({
                    where: { id: accountId },
                    data: { balance: { increment: delta } }
                });
            }

            const deleteResult = await tx.transaction.deleteMany({ where: result.where });
            return deleteResult.count;
        });

        return NextResponse.json({
            success: true,
            deletedCount
        });
    } catch (error: unknown) {
        console.error(error);
        return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
    }
}

// POST - Bulk create transactions atomically
export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const transactions = body.transactions as BulkInputTransaction[] | undefined;

        if (!transactions || !Array.isArray(transactions) || transactions.length === 0) {
            return NextResponse.json({ error: 'transactions array is required' }, { status: 400 });
        }

        const errors = validateBulkTransactions(transactions);
        if (errors.length > 0) {
            return NextResponse.json({ success: false, errors }, { status: 400 });
        }

        const user = await prisma.user.findFirst();
        if (!user) return NextResponse.json({ error: 'No user found' }, { status: 400 });

        const account = await prisma.account.findFirst({ where: { userId: user.id } });
        if (!account) return NextResponse.json({ error: 'No account found' }, { status: 400 });

        const createdCount = await prisma.$transaction(async (tx) => {
            let count = 0;
            let accountDelta = 0;

            for (const transaction of transactions) {
                const amount = Number(transaction.amount);
                await tx.transaction.create({
                    data: {
                        amount,
                        date: new Date(transaction.date as string),
                        type: transaction.type as string,
                        description: transaction.description || null,
                        categoryId: transaction.categoryId as string,
                        accountId: account.id,
                        userId: user.id,
                        status: transaction.status || 'PAID'
                    }
                });

                accountDelta += amount * balanceMultiplier(transaction.type as string);
                count++;
            }

            await tx.account.update({
                where: { id: account.id },
                data: { balance: { increment: accountDelta } }
            });

            return count;
        });

        return NextResponse.json({
            success: true,
            createdCount
        });
    } catch (error: unknown) {
        console.error(error);
        return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
    }
}
