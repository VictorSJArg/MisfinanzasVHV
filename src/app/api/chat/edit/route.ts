import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { updateTransactionWithBalance } from '@/lib/transactions';

function errorMessage(error: unknown) {
    return error instanceof Error ? error.message : 'Unknown error';
}

export async function PUT(request: NextRequest) {
    try {
        const body = await request.json();
        const { transactionId, amount, description, categoryId, date } = body;

        if (!transactionId) {
            return NextResponse.json(
                { success: false, error: 'ID de transaccion requerido' },
                { status: 400 }
            );
        }

        const existing = await prisma.transaction.findUnique({
            where: { id: transactionId },
        });

        if (!existing) {
            return NextResponse.json(
                { success: false, error: 'Transaccion no encontrada' },
                { status: 404 }
            );
        }

        const updated = await updateTransactionWithBalance(transactionId, {
            amount,
            description,
            categoryId,
            date,
        });

        const transaction = await prisma.transaction.findUnique({
            where: { id: updated.id },
            include: {
                category: true,
                account: true,
            },
        });

        return NextResponse.json({
            success: true,
            data: {
                transaction: {
                    id: transaction?.id,
                    amount: Number(transaction?.amount || 0),
                    description: transaction?.description,
                    type: transaction?.type,
                    category: transaction?.category?.name,
                    account: transaction?.account?.name,
                    date: transaction?.date,
                },
            },
            message: 'Transaccion actualizada exitosamente',
        });
    } catch (error: unknown) {
        console.error('Error updating transaction:', error);
        return NextResponse.json(
            {
                success: false,
                error: 'Error al actualizar transaccion',
                details: errorMessage(error),
            },
            { status: 500 }
        );
    }
}
