
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// GET - Obtener transacciones de una celda específica (categoría + período)
export async function GET(request: NextRequest) {
    const searchParams = request.nextUrl.searchParams;
    const categoryId = searchParams.get('categoryId');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');

    if (!categoryId || !startDate || !endDate) {
        return NextResponse.json({ error: "Missing parameters" }, { status: 400 });
    }

    const transactions = await prisma.transaction.findMany({
        where: {
            categoryId,
            date: {
                gte: new Date(startDate),
                lte: new Date(endDate)
            }
        },
        include: {
            category: true,
            account: true
        },
        orderBy: { date: 'desc' }
    });

    return NextResponse.json(transactions);
}

// PUT - Actualizar una transacción
export async function PUT(request: NextRequest) {
    try {
        const body = await request.json();
        const { id, amount, date, description, categoryId, accountId } = body;

        if (!id) {
            return NextResponse.json({ error: "Transaction ID required" }, { status: 400 });
        }

        // Obtener transacción actual para ajustar balance
        const currentTx = await prisma.transaction.findUnique({
            where: { id }
        });

        if (!currentTx) {
            return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
        }

        // Revertir el balance anterior
        const oldMultiplier = currentTx.type === 'INCOME' ? -1 : 1;
        await prisma.account.update({
            where: { id: currentTx.accountId },
            data: { balance: { increment: Number(currentTx.amount) * oldMultiplier } }
        });

        // Actualizar transacción
        const updatedTx = await prisma.transaction.update({
            where: { id },
            data: {
                amount: amount !== undefined ? Number(amount) : undefined,
                date: date ? new Date(date) : undefined,
                description: description !== undefined ? description : undefined,
                categoryId: categoryId !== undefined ? categoryId : undefined,
                accountId: accountId !== undefined ? accountId : undefined
            }
        });

        // Aplicar nuevo balance
        const newMultiplier = updatedTx.type === 'INCOME' ? 1 : -1;
        await prisma.account.update({
            where: { id: updatedTx.accountId },
            data: { balance: { increment: Number(updatedTx.amount) * newMultiplier } }
        });

        return NextResponse.json(updatedTx);
    } catch (e: any) {
        console.error(e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}

// DELETE - Eliminar una transacción
// DELETE - Eliminar una transacción o todas las de una celda
export async function DELETE(request: NextRequest) {
    try {
        const searchParams = request.nextUrl.searchParams;
        const id = searchParams.get('id');
        const categoryId = searchParams.get('categoryId');
        const startDate = searchParams.get('startDate');
        const endDate = searchParams.get('endDate');

        if (id) {
            // Eliminar una sola transacción
            const tx = await prisma.transaction.findUnique({ where: { id } });
            if (!tx) return NextResponse.json({ error: "Transaction not found" }, { status: 404 });

            // Revertir balance
            const multiplier = tx.type === 'INCOME' ? -1 : 1;
            await prisma.account.update({
                where: { id: tx.accountId },
                data: { balance: { increment: Number(tx.amount) * multiplier } }
            });

            await prisma.transaction.delete({ where: { id } });
            return NextResponse.json({ success: true });
        }

        const matchDescription = searchParams.get('matchDescription') === 'true';
        const description = searchParams.get('description');

        if (categoryId && startDate && endDate) {
            // Construir filtro
            const whereClause: any = {
                categoryId,
                date: {
                    gte: new Date(startDate),
                    lte: new Date(endDate)
                }
            };

            // Filtrado opcional por descripción si se solicita explícitamente (para borrar subcategorías específicas)
            if (matchDescription) {
                if (description !== null && description !== '') {
                    whereClause.description = description;
                } else {
                    // Si se activa matchDescription pero no se envia valor, buscamos description = null
                    // También incluimos "Sin descripción" por compatibilidad con datos corruptos antiguos
                    whereClause.OR = [
                        { description: null },
                        { description: '' },
                        { description: 'Sin descripción' }
                    ];
                    delete whereClause.description; // Remove simple description filter if exists
                }
            }

            // Eliminar transacciones que coincidan con el filtro
            const transactions = await prisma.transaction.findMany({
                where: whereClause
            });

            // Procesar cada transacción (idealmente en una transacción de DB, pero iteramos por simplicidad con update de cuentas)
            for (const tx of transactions) {
                if (tx.accountId) {
                    const multiplier = tx.type === 'INCOME' ? -1 : 1;
                    await prisma.account.update({
                        where: { id: tx.accountId },
                        data: { balance: { increment: Number(tx.amount) * multiplier } }
                    });
                }
            }

            await prisma.transaction.deleteMany({ where: whereClause });

            return NextResponse.json({ success: true, count: transactions.length });
        }

        return NextResponse.json({ error: "Missing parameters" }, { status: 400 });
    } catch (e: any) {
        console.error(e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
