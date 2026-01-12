import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// POST - Create item
export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { statementId, description, amount, date, category, includeInProjection, projectedAmount } = body;

        if (!statementId || !description || amount === undefined || !date) {
            return NextResponse.json({ error: 'statementId, description, amount and date are required' }, { status: 400 });
        }

        const newItem = await prisma.creditCardItem.create({
            data: {
                statementId,
                description,
                amount: parseFloat(amount),
                date: new Date(date),
                category: category || 'OTROS',
                includeInProjection: includeInProjection ?? true,
                projectedAmount: projectedAmount ? parseFloat(projectedAmount) : null,
                itemType: 'PURCHASE',
                isRecurring: false,
                amountUSD: 0
            }
        });

        return NextResponse.json(newItem);
    } catch (error: any) {
        console.error(error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

// PUT - Update item
export async function PUT(request: NextRequest) {
    try {
        const body = await request.json();
        const { id, description, amount, amountUSD, installmentCurrent, installmentTotal, itemType, isRecurring, category, includeInProjection, date, projectedAmount } = body;

        if (!id) {
            return NextResponse.json({ error: 'id is required' }, { status: 400 });
        }

        // Remove observations from the main update payload to avoid "Unknown argument" error with stale client
        const dataToUpdate: any = {
            ...(description !== undefined && { description }),
            ...(amount !== undefined && { amount: parseFloat(amount) }),
            ...(amountUSD !== undefined && { amountUSD: amountUSD ? parseFloat(amountUSD) : null }),
            ...(installmentCurrent !== undefined && { installmentCurrent }),
            ...(installmentTotal !== undefined && { installmentTotal }),
            ...(itemType !== undefined && { itemType }),
            ...(isRecurring !== undefined && { isRecurring }),
            ...(category !== undefined && { category }),
            ...(includeInProjection !== undefined && { includeInProjection }),
            ...(projectedAmount !== undefined && { projectedAmount: projectedAmount ? parseFloat(projectedAmount) : null }),
            ...(date !== undefined && { date: new Date(date) }),
        };

        const updated = await prisma.creditCardItem.update({
            where: { id },
            data: dataToUpdate
        });

        // 2. RAW UPDATE for 'observations' because Client might be stale (server not restarted)
        // This bypasses the schema validation error but writes to the DB correctly.
        if (body.observations !== undefined) {
            await prisma.$executeRaw`UPDATE CreditCardItem SET observations = ${body.observations} WHERE id = ${id}`;
            // Manually add it to the returned object so UI sees the update
            (updated as any).observations = body.observations;
        }
        return NextResponse.json(updated);
    } catch (error: any) {
        console.error(error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

// DELETE - Delete item
export async function DELETE(request: NextRequest) {
    try {
        const id = request.nextUrl.searchParams.get('id');
        if (!id) {
            return NextResponse.json({ error: 'id is required' }, { status: 400 });
        }

        await prisma.creditCardItem.delete({ where: { id } });
        return NextResponse.json({ success: true });
    } catch (error: any) {
        console.error(error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
