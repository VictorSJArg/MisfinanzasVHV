import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { createTransactionWithBalance, updateTransactionWithBalance } from '@/lib/transactions';

function errorMessage(error: unknown) {
    return error instanceof Error ? error.message : 'Unknown error';
}

async function getDefaultUserId(userId?: string) {
    if (userId) return userId;

    const user = await prisma.user.findFirst();
    if (!user) throw new Error('No user found');
    return user.id;
}

async function getOrCreateAccountId(userId: string, accountId?: string | null) {
    if (accountId) return accountId;

    const account = await prisma.account.findFirst({ where: { userId } });
    if (account) return account.id;

    const newAccount = await prisma.account.create({
        data: {
            name: 'General',
            type: 'CASH',
            balance: 0,
            userId
        }
    });

    return newAccount.id;
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { amount, date, type, categoryId, description, status } = body;

        if (!amount || !date || !type) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
        }

        const userId = await getDefaultUserId(body.userId);
        const accountId = await getOrCreateAccountId(userId, body.accountId);

        const transaction = await createTransactionWithBalance({
            amount,
            date,
            type,
            description,
            categoryId,
            accountId,
            userId,
            status
        });

        return NextResponse.json({ success: true, transaction });
    } catch (error: unknown) {
        console.error('TRANSACTION ERROR:', error);
        return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
    }
}

export async function PUT(request: NextRequest) {
    try {
        const body = await request.json();
        const { id, amount, date, description, categoryId, accountId, type, status } = body;

        if (!id) {
            return NextResponse.json({ error: 'Missing transaction ID' }, { status: 400 });
        }

        const transaction = await updateTransactionWithBalance(id, {
            amount,
            date,
            description,
            categoryId,
            accountId,
            type,
            status
        });

        return NextResponse.json({ success: true, transaction });
    } catch (error: unknown) {
        console.error('TRANSACTION PUT ERROR:', error);
        const status = error instanceof Error && error.message === 'Transaction not found' ? 404 : 500;
        return NextResponse.json({ error: errorMessage(error) }, { status });
    }
}
