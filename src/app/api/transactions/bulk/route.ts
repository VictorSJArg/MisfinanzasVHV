import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// GET - Preview transactions to be deleted (for bulk delete preview)
export async function GET(request: NextRequest) {
    const searchParams = request.nextUrl.searchParams;
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const categoryId = searchParams.get('categoryId');
    const type = searchParams.get('type'); // INCOME | EXPENSE | null (all)

    if (!startDate || !endDate) {
        return NextResponse.json({ error: "startDate and endDate are required" }, { status: 400 });
    }

    const where: any = {
        date: {
            gte: new Date(startDate),
            lte: new Date(endDate)
        }
    };

    if (categoryId) {
        where.categoryId = categoryId;
    }

    if (type && (type === 'INCOME' || type === 'EXPENSE')) {
        where.type = type;
    }

    try {
        const transactions = await prisma.transaction.findMany({
            where,
            include: {
                category: { select: { name: true, type: true } }
            },
            orderBy: { date: 'desc' }
        });

        // Group by category for preview
        const grouped: Record<string, { categoryName: string, type: string, count: number, total: number }> = {};

        transactions.forEach(tx => {
            const catName = tx.category?.name || 'Sin categoría';
            const catType = tx.category?.type || 'UNKNOWN';
            if (!grouped[catName]) {
                grouped[catName] = { categoryName: catName, type: catType, count: 0, total: 0 };
            }
            grouped[catName].count++;
            grouped[catName].total += Number(tx.amount);
        });

        return NextResponse.json({
            preview: Object.values(grouped),
            totalCount: transactions.length,
            totalAmount: transactions.reduce((sum, tx) => sum + Number(tx.amount), 0)
        });
    } catch (e: any) {
        console.error(e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}

// DELETE - Bulk delete transactions
export async function DELETE(request: NextRequest) {
    const searchParams = request.nextUrl.searchParams;
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const categoryId = searchParams.get('categoryId');
    const type = searchParams.get('type');

    if (!startDate || !endDate) {
        return NextResponse.json({ error: "startDate and endDate are required" }, { status: 400 });
    }

    const where: any = {
        date: {
            gte: new Date(startDate),
            lte: new Date(endDate)
        }
    };

    if (categoryId) {
        where.categoryId = categoryId;
    }

    if (type && (type === 'INCOME' || type === 'EXPENSE')) {
        where.type = type;
    }

    try {
        // First, get all transactions to update account balances
        const transactions = await prisma.transaction.findMany({ where });

        // Revert balances
        for (const tx of transactions) {
            if (tx.accountId) {
                const multiplier = tx.type === 'INCOME' ? -1 : 1;
                await prisma.account.update({
                    where: { id: tx.accountId },
                    data: { balance: { increment: Number(tx.amount) * multiplier } }
                });
            }
        }

        // Delete all matching transactions
        const result = await prisma.transaction.deleteMany({ where });

        return NextResponse.json({
            success: true,
            deletedCount: result.count
        });
    } catch (e: any) {
        console.error(e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}

// POST - Bulk create transactions
export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { transactions } = body;

        if (!transactions || !Array.isArray(transactions) || transactions.length === 0) {
            return NextResponse.json({ error: "transactions array is required" }, { status: 400 });
        }

        // Get default user and account
        const user = await prisma.user.findFirst();
        if (!user) return NextResponse.json({ error: "No user found" }, { status: 400 });

        const account = await prisma.account.findFirst({ where: { userId: user.id } });
        if (!account) return NextResponse.json({ error: "No account found" }, { status: 400 });

        const created: any[] = [];
        const errors: string[] = [];

        for (let i = 0; i < transactions.length; i++) {
            const tx = transactions[i];

            if (!tx.categoryId || !tx.amount || !tx.date || !tx.type) {
                errors.push(`Fila ${i + 1}: Faltan campos obligatorios`);
                continue;
            }

            try {
                const newTx = await prisma.transaction.create({
                    data: {
                        amount: Number(tx.amount),
                        date: new Date(tx.date),
                        type: tx.type,
                        description: tx.description || null,
                        categoryId: tx.categoryId,
                        accountId: account.id,
                        userId: user.id,
                        status: tx.status || 'PAID'
                    }
                });

                // Update account balance
                const multiplier = tx.type === 'INCOME' ? 1 : -1;
                await prisma.account.update({
                    where: { id: account.id },
                    data: { balance: { increment: Number(tx.amount) * multiplier } }
                });

                created.push(newTx);
            } catch (err: any) {
                errors.push(`Fila ${i + 1}: ${err.message}`);
            }
        }

        return NextResponse.json({
            success: true,
            createdCount: created.length,
            errors: errors.length > 0 ? errors : undefined
        });
    } catch (e: any) {
        console.error(e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
