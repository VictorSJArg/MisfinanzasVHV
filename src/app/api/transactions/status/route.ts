
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { id, status } = body;

        if (!id || !status) {
            return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
        }

        const transaction = await prisma.transaction.update({
            where: { id },
            data: { status }
        });

        return NextResponse.json(transaction);
    } catch (e: any) {
        console.error('Error updating transaction status:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
