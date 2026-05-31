
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { balanceMultiplier } from '@/lib/transactions';

// GET - Obtener todas las categorías
export async function GET() {
    const user = await prisma.user.findFirst();
    if (!user) return NextResponse.json([]);

    let categories: unknown[];
    try {
        categories = await prisma.$queryRaw`
            SELECT id, name, type, icon, color, "parentId", "sortOrder", "userId"
            FROM "Category"
            WHERE "userId" = ${user.id}
            ORDER BY "sortOrder" ASC, name ASC
        `;
    } catch {
        categories = await prisma.$queryRaw`
            SELECT id, name, type, icon, color, "parentId", 0 AS "sortOrder", "userId"
            FROM "Category"
            WHERE "userId" = ${user.id}
            ORDER BY name ASC
        `;
    }

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
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error(error);
        return NextResponse.json({ error: message }, { status: 500 });
    }
}

// DELETE - Borrar categoría y sus transacciones (revertiendo saldos)
export async function DELETE(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const id = searchParams.get('id');

        if (!id) return NextResponse.json({ error: "ID required" }, { status: 400 });

        await prisma.$transaction(async (tx) => {
            const transactions = await tx.transaction.findMany({ where: { categoryId: id } });
            const balanceDeltas = new Map<string, number>();

            for (const transaction of transactions) {
                const delta = Number(transaction.amount) * -balanceMultiplier(transaction.type);
                balanceDeltas.set(transaction.accountId, (balanceDeltas.get(transaction.accountId) || 0) + delta);
            }

            for (const [accountId, delta] of balanceDeltas) {
                await tx.account.update({
                    where: { id: accountId },
                    data: { balance: { increment: delta } }
                });
            }

            // 2. Borrar transacciones
            await tx.transaction.deleteMany({ where: { categoryId: id } });

            // 3. Borrar categoría
            await tx.category.delete({ where: { id } });
        });

        return NextResponse.json({ success: true });

    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error("Delete Error:", error);
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
