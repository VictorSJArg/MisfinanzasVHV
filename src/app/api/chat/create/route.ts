import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { createTransactionWithBalance } from '@/lib/transactions';

function errorMessage(error: unknown) {
    return error instanceof Error ? error.message : 'Unknown error';
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { amount, description, type, categoryId, categoryName, accountId, date } = body;

        if (!amount || !type) {
            return NextResponse.json(
                { success: false, error: 'Monto y tipo son requeridos' },
                { status: 400 }
            );
        }

        const user = await prisma.user.findFirst();
        if (!user) {
            return NextResponse.json(
                { success: false, error: 'Usuario no encontrado' },
                { status: 404 }
            );
        }

        let finalAccountId = accountId;
        if (!finalAccountId) {
            const account = await prisma.account.findFirst({
                where: { userId: user.id },
            });
            if (!account) {
                return NextResponse.json(
                    { success: false, error: 'No se encontro cuenta' },
                    { status: 404 }
                );
            }
            finalAccountId = account.id;
        }

        let finalCategoryId = categoryId;
        if (!finalCategoryId && categoryName) {
            let category = await prisma.category.findFirst({
                where: {
                    name: {
                        equals: categoryName,
                        mode: 'insensitive'
                    },
                    userId: user.id,
                    type,
                },
            });

            if (!category) {
                category = await prisma.category.create({
                    data: {
                        name: categoryName.charAt(0).toUpperCase() + categoryName.slice(1).toLowerCase(),
                        userId: user.id,
                        type,
                    },
                });
            }

            finalCategoryId = category.id;
        }

        const created = await createTransactionWithBalance({
            amount,
            description: description || null,
            type,
            categoryId: finalCategoryId || null,
            accountId: finalAccountId,
            userId: user.id,
            date: date ? new Date(date) : new Date(),
            status: 'PENDING',
        });

        const transaction = await prisma.transaction.findUnique({
            where: { id: created.id },
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
            message: 'Transaccion creada exitosamente',
        });
    } catch (error: unknown) {
        console.error('Error creating transaction:', error);
        return NextResponse.json(
            {
                success: false,
                error: 'Error al crear transaccion',
                details: errorMessage(error),
            },
            { status: 500 }
        );
    }
}
