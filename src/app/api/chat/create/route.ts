import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { amount, description, type, categoryId, categoryName, accountId, date } = body;

        // Validación
        if (!amount || !type) {
            return NextResponse.json(
                { success: false, error: 'Monto y tipo son requeridos' },
                { status: 400 }
            );
        }

        // Obtener usuario por defecto
        const user = await prisma.user.findFirst();
        if (!user) {
            return NextResponse.json(
                { success: false, error: 'Usuario no encontrado' },
                { status: 404 }
            );
        }

        // Obtener cuenta por defecto si no se especificó
        let finalAccountId = accountId;
        if (!finalAccountId) {
            const account = await prisma.account.findFirst({
                where: { userId: user.id },
            });
            if (!account) {
                return NextResponse.json(
                    { success: false, error: 'No se encontró cuenta' },
                    { status: 404 }
                );
            }
            finalAccountId = account.id;
        }

        // Obtener o crear categoría
        let finalCategoryId = categoryId;
        if (!finalCategoryId && categoryName) {
            // Buscar categoría existente por nombre (case-insensitive)
            let category = await prisma.category.findFirst({
                where: {
                    name: {
                        equals: categoryName,
                        mode: 'insensitive'
                    },
                    userId: user.id,
                },
            });

            // Si no existe, crearla
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

        // Crear transacción con status PENDING por defecto
        const transaction = await prisma.transaction.create({
            data: {
                amount: Number(amount),
                description: description || null,
                type,
                categoryId: finalCategoryId || null,
                accountId: finalAccountId,
                userId: user.id,
                date: date ? new Date(date) : new Date(),
                status: 'PENDING', // Por defecto no pagado
            },
            include: {
                category: true,
                account: true,
            },
        });

        // Actualizar balance de cuenta
        const multiplier = type === 'INCOME' ? 1 : -1;
        await prisma.account.update({
            where: { id: finalAccountId },
            data: {
                balance: {
                    increment: Number(amount) * multiplier,
                },
            },
        });

        return NextResponse.json({
            success: true,
            data: {
                transaction: {
                    id: transaction.id,
                    amount: Number(transaction.amount),
                    description: transaction.description,
                    type: transaction.type,
                    category: transaction.category?.name,
                    account: transaction.account?.name,
                    date: transaction.date,
                },
            },
            message: '✅ Transacción creada exitosamente',
        });
    } catch (error) {
        console.error('Error creating transaction:', error);
        return NextResponse.json(
            {
                success: false,
                error: 'Error al crear transacción',
                details: error instanceof Error ? error.message : 'Unknown error',
            },
            { status: 500 }
        );
    }
}
