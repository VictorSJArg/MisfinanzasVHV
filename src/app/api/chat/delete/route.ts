import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { deleteTransactionWithBalance } from '@/lib/transactions';

function errorMessage(error: unknown) {
    return error instanceof Error ? error.message : 'Unknown error';
}

export async function DELETE(request: NextRequest) {
    try {
        const searchParams = request.nextUrl.searchParams;
        const transactionId = searchParams.get('id');
        const confirm = searchParams.get('confirm');

        if (!transactionId) {
            return NextResponse.json(
                { success: false, error: 'ID de transaccion requerido' },
                { status: 400 }
            );
        }

        if (confirm !== 'true') {
            return NextResponse.json(
                { success: false, error: 'Confirmacion requerida' },
                { status: 400 }
            );
        }

        const transaction = await prisma.transaction.findUnique({
            where: { id: transactionId },
            include: {
                category: true,
                account: true,
            },
        });

        if (!transaction) {
            return NextResponse.json(
                { success: false, error: 'Transaccion no encontrada' },
                { status: 404 }
            );
        }

        await deleteTransactionWithBalance(transactionId);

        return NextResponse.json({
            success: true,
            data: {
                deletedTransaction: {
                    id: transaction.id,
                    amount: Number(transaction.amount),
                    description: transaction.description,
                    type: transaction.type,
                    category: transaction.category?.name,
                    date: transaction.date,
                },
            },
            message: 'Transaccion eliminada exitosamente',
        });
    } catch (error: unknown) {
        console.error('Error deleting transaction:', error);
        return NextResponse.json(
            {
                success: false,
                error: 'Error al eliminar transaccion',
                details: errorMessage(error),
            },
            { status: 500 }
        );
    }
}
