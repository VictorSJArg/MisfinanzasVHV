
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';


export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { amount, date, type, categoryId, description } = body;
        let { accountId } = body;

        // Validation (basic)
        if (!amount || !date || !type) {
            return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
        }

        let userId = body.userId;
        if (!userId) {
            const user = await prisma.user.findFirst();
            if (!user) return NextResponse.json({ error: "No user found" }, { status: 400 });
            userId = user.id;
        }

        // Si no hay accountId, usar la primera cuenta disponible o crear una por defecto
        if (!accountId) {
            const account = await prisma.account.findFirst({
                where: { userId }
            });
            if (!account) {
                // Crear cuenta default si no existe ninguna
                const newAccount = await prisma.account.create({
                    data: {
                        name: "General",
                        type: "CASH",
                        balance: 0,
                        userId
                    }
                });
                accountId = newAccount.id;
            } else {
                accountId = account.id;
            }
        }

        // Create
        console.log('Creating transaction:', { amount, date, type, description, categoryId, accountId, userId });
        const tx = await prisma.transaction.create({
            data: {
                amount: Number(amount),
                date: new Date(date),
                type,
                description: description || null,
                categoryId: categoryId || null,
                accountId,
                userId
            }
        });

        // Update Account Balance
        const multiplier = type === 'INCOME' ? 1 : -1;
        await prisma.account.update({
            where: { id: accountId },
            data: { balance: { increment: Number(amount) * multiplier } }
        });

        return NextResponse.json({ success: true, transaction: tx });
    } catch (e: any) {
        console.error('TRANSACTION ERROR:', e);
        return NextResponse.json({ error: e.message, stack: e.stack }, { status: 500 });
    }
}

// PUT - Actualizar una transacción existente (por ejemplo, descripción)
export async function PUT(request: NextRequest) {
    try {
        const body = await request.json();
        const { id, amount, date, description, categoryId, accountId, type } = body;

        if (!id) {
            return NextResponse.json({ error: "Missing transaction ID" }, { status: 400 });
        }

        // Si hay cambio de monto o cuenta, habría que ajustar balances, pero por ahora asumimos
        // que el uso principal es cambiar descripción o corregir datos simples.

        // Para simplificar, si cambia el amount, hacemos la reversión
        const existing = await prisma.transaction.findUnique({ where: { id } });
        if (!existing) return NextResponse.json({ error: "Transaction not found" }, { status: 404 });

        if ((amount !== undefined && Number(amount) !== Number(existing.amount)) || (accountId && accountId !== existing.accountId)) {
            // Revertir anterior
            const oldMult = existing.type === 'INCOME' ? -1 : 1;
            await prisma.account.update({
                where: { id: existing.accountId },
                data: { balance: { increment: Number(existing.amount) * oldMult } }
            });

            // Aplicar nuevo (si viene amount usa ese, sino el viejo)
            const newAmount = amount !== undefined ? Number(amount) : Number(existing.amount);
            const newAccountId = accountId || existing.accountId;
            const newType = type || existing.type;
            const newMult = newType === 'INCOME' ? 1 : -1;

            await prisma.account.update({
                where: { id: newAccountId },
                data: { balance: { increment: newAmount * newMult } }
            });
        }

        const updated = await prisma.transaction.update({
            where: { id },
            data: {
                amount: amount !== undefined ? Number(amount) : undefined,
                date: date ? new Date(date) : undefined,
                description,
                categoryId,
                accountId: accountId || undefined,
                type
            }
        });

        return NextResponse.json({ success: true, transaction: updated });
    } catch (e: any) {
        console.error('TRANSACTION PUT ERROR:', e);
        return NextResponse.json({ error: e.message, stack: e.stack }, { status: 500 });
    }
}
