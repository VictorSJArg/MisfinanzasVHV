import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function DELETE(request: NextRequest) {
    try {
        const searchParams = request.nextUrl.searchParams;
        const transactionId = searchParams.get('id');
        const confirm = searchParams.get('confirm');

        if (!transactionId) {
            return NextResponse.json(
                { success: false, error: 'ID de transacción requerido' },
                { status: 400 }
            );
        }

        if (confirm !== 'true') {
            return NextResponse.json(
                { success: false, error: 'Confirmación requerida' },
                { status: 400 }
            );
        }

        // Obtener transacción
        const transaction = await prisma.transaction.findUnique({
            where: { id: transactionId },
            include: {
                category: true,
                account: true,
            },
        });

        if (!transaction) {
            return NextResponse.json(
                { success: false, error: 'Transacción no encontrada' },
                { status: 404 }
            );
        }

        // Revertir balance de cuenta
        const multiplier = transaction.type === 'INCOME' ? -1 : 1;
        await prisma.account.update({
            where: { id: transaction.accountId },
            data: {
                balance: {
                    increment: Number(transaction.amount) * multiplier,
                },
            },
        });

        // Eliminar transacción
        await prisma.transaction.delete({
            where: { id: transactionId },
        });

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
            message: '✅ Transacción eliminada exitosamente',
        });
    } catch (error) {
        console.error('Error deleting transaction:', error);
        return NextResponse.json(
            {
                success: false,
                error: 'Error al eliminar transacción',
                details: error instanceof Error ? error.message : 'Unknown error',
            },
            { status: 500 }
        );
    }
}
