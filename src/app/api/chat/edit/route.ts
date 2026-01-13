import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function PUT(request: NextRequest) {
    try {
        const body = await request.json();
        const { transactionId, amount, description, categoryId, date } = body;

        if (!transactionId) {
            return NextResponse.json(
                { success: false, error: 'ID de transacción requerido' },
                { status: 400 }
            );
        }

        // Obtener transacción existente
        const existing = await prisma.transaction.findUnique({
            where: { id: transactionId },
        });

        if (!existing) {
            return NextResponse.json(
                { success: false, error: 'Transacción no encontrada' },
                { status: 404 }
            );
        }

        // Si cambia el monto, ajustar balance de cuenta
        if (amount !== undefined && Number(amount) !== Number(existing.amount)) {
            // Revertir monto anterior
            const oldMultiplier = existing.type === 'INCOME' ? -1 : 1;
            await prisma.account.update({
                where: { id: existing.accountId },
                data: {
                    balance: {
                        increment: Number(existing.amount) * oldMultiplier,
                    },
                },
            });

            // Aplicar nuevo monto
            const newMultiplier = existing.type === 'INCOME' ? 1 : -1;
            await prisma.account.update({
                where: { id: existing.accountId },
                data: {
                    balance: {
                        increment: Number(amount) * newMultiplier,
                    },
                },
            });
        }

        // Actualizar transacción
        const updated = await prisma.transaction.update({
            where: { id: transactionId },
            data: {
                amount: amount !== undefined ? Number(amount) : undefined,
                description: description !== undefined ? description : undefined,
                categoryId: categoryId !== undefined ? categoryId : undefined,
                date: date ? new Date(date) : undefined,
            },
            include: {
                category: true,
                account: true,
            },
        });

        return NextResponse.json({
            success: true,
            data: {
                transaction: {
                    id: updated.id,
                    amount: Number(updated.amount),
                    description: updated.description,
                    type: updated.type,
                    category: updated.category?.name,
                    account: updated.account?.name,
                    date: updated.date,
                },
            },
            message: '✅ Transacción actualizada exitosamente',
        });
    } catch (error) {
        console.error('Error updating transaction:', error);
        return NextResponse.json(
            {
                success: false,
                error: 'Error al actualizar transacción',
                details: error instanceof Error ? error.message : 'Unknown error',
            },
            { status: 500 }
        );
    }
}
