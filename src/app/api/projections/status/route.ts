
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { referenceId, date, status } = body;

        if (!referenceId || !date || !status) {
            return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
        }

        // Upsert status
        const projectionStatus = await prisma.projectionStatus.upsert({
            where: {
                referenceId_date: {
                    referenceId,
                    date: new Date(date)
                }
            },
            update: { status },
            create: {
                referenceId,
                date: new Date(date),
                status
            }
        });

        return NextResponse.json(projectionStatus);
    } catch (e: any) {
        console.error('Error updating projection status:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
