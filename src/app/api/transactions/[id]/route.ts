import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { deleteTransactionWithBalance, updateTransactionWithBalance } from '@/lib/transactions';

export const dynamic = 'force-dynamic';

function errorStatus(error: unknown) {
    return error instanceof Error && error.message === 'Transaction not found' ? 404 : 500;
}

function errorMessage(error: unknown) {
    return error instanceof Error ? error.message : 'Unknown error';
}

// GET - Get a specific transaction
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;

        const transaction = await prisma.transaction.findUnique({
            where: { id },
            include: {
                category: true,
                account: true
            }
        });

        if (!transaction) {
            return NextResponse.json({ error: 'Transaccion no encontrada' }, { status: 404 });
        }

        return NextResponse.json(transaction);
    } catch (error: unknown) {
        console.error('Error fetching transaction:', error);
        return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
    }
}

// PUT - Update a transaction and keep the account balance in sync
export async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        const body = await request.json();

        const updated = await updateTransactionWithBalance(id, {
            amount: body.amount,
            description: body.description,
            date: body.date,
            categoryId: body.categoryId,
            accountId: body.accountId,
            type: body.type,
            status: body.status
        });

        return NextResponse.json(updated);
    } catch (error: unknown) {
        console.error('Error updating transaction:', error);
        return NextResponse.json({ error: errorMessage(error) }, { status: errorStatus(error) });
    }
}

// DELETE - Delete a transaction and reverse its account balance impact
export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        await deleteTransactionWithBalance(id);

        return NextResponse.json({ success: true, message: 'Transaccion eliminada' });
    } catch (error: unknown) {
        console.error('Error deleting transaction:', error);
        return NextResponse.json({ error: errorMessage(error) }, { status: errorStatus(error) });
    }
}
