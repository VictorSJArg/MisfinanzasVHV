
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// GET - Obtener todas las categorías
export async function GET(request: NextRequest) {
    const user = await prisma.user.findFirst();
    if (!user) return NextResponse.json([]);

    const categories = await prisma.category.findMany({
        where: { userId: user.id },
        orderBy: { name: 'asc' }
    });

    return NextResponse.json(categories);
}

// POST - Crear nueva categoría
export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { name, type } = body;

        if (!name || !type) {
            return NextResponse.json({ error: "Name and type are required" }, { status: 400 });
        }

        const user = await prisma.user.findFirst();
        if (!user) return NextResponse.json({ error: "No user found" }, { status: 400 });

        // Check if category already exists
        const existing = await prisma.category.findFirst({
            where: { userId: user.id, name, type }
        });

        if (existing) {
            return NextResponse.json({ error: "Category already exists" }, { status: 409 });
        }

        const category = await prisma.category.create({
            data: {
                name,
                type,
                userId: user.id
            }
        });

        return NextResponse.json(category);
    } catch (e: any) {
        console.error(e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}

// DELETE - Borrar categoría y sus transacciones (revertiendo saldos)
export async function DELETE(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const id = searchParams.get('id');

        if (!id) return NextResponse.json({ error: "ID required" }, { status: 400 });

        // Obtener transacciones para revertir saldos
        const transactions = await prisma.transaction.findMany({ where: { categoryId: id } });

        await prisma.$transaction(async (tx) => {
            // 1. Revertir saldos de cuentas afectadas
            for (const t of transactions) {
                if (!t.accountId) continue;

                const account = await tx.account.findUnique({ where: { id: t.accountId } });
                if (account) {
                    const amount = Number(t.amount);
                    // Si era INGRESO, restamos al saldo. Si era GASTO, sumamos.
                    const newBalance = t.type === 'INCOME'
                        ? Number(account.balance) - amount
                        : Number(account.balance) + amount;

                    await tx.account.update({
                        where: { id: account.id },
                        data: { balance: newBalance }
                    });
                }
            }

            // 2. Borrar transacciones
            await tx.transaction.deleteMany({ where: { categoryId: id } });

            // 3. Borrar categoría
            await tx.category.delete({ where: { id } });
        });

        return NextResponse.json({ success: true });

    } catch (e: any) {
        console.error("Delete Error:", e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
