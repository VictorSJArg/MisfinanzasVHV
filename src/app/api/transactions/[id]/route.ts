import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

// GET - Get a specific transaction
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;

        const transaction = await prisma.transaction.findUnique({
            where: { id },
            include: {
                category: true,
                account: true
            }
        });

        if (!transaction) {
            return NextResponse.json({ error: 'Transacción no encontrada' }, { status: 404 });
        }

        return NextResponse.json(transaction);
    } catch (error: any) {
        console.error('Error fetching transaction:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

// PUT - Update a transaction
export async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        const body = await request.json();

        console.log('Updating transaction:', id, body);

        // Validate the transaction exists
        const existing = await prisma.transaction.findUnique({ where: { id } });
        if (!existing) {
            return NextResponse.json({ error: 'Transacción no encontrada' }, { status: 404 });
        }

        // Build update data
        const updateData: any = {};
        if (body.amount !== undefined) updateData.amount = Number(body.amount);
        if (body.description !== undefined) updateData.description = body.description;
        if (body.date !== undefined) updateData.date = new Date(body.date);
        if (body.categoryId !== undefined) updateData.categoryId = body.categoryId;
        if (body.status !== undefined) updateData.status = body.status;

        const updated = await prisma.transaction.update({
            where: { id },
            data: updateData
        });

        console.log('Transaction updated:', updated);
        return NextResponse.json(updated);
    } catch (error: any) {
        console.error('Error updating transaction:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

// DELETE - Delete a transaction
export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;

        console.log('Deleting transaction:', id);

        // Validate the transaction exists
        const existing = await prisma.transaction.findUnique({ where: { id } });
        if (!existing) {
            return NextResponse.json({ error: 'Transacción no encontrada' }, { status: 404 });
        }

        await prisma.transaction.delete({ where: { id } });

        console.log('Transaction deleted:', id);
        return NextResponse.json({ success: true, message: 'Transacción eliminada' });
    } catch (error: any) {
        console.error('Error deleting transaction:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
