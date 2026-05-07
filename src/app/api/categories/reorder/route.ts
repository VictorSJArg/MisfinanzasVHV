
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// POST - Reorder categories (bulk update)
export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { orderedIds, type } = body;

        if (!orderedIds || !Array.isArray(orderedIds) || !type) {
            return NextResponse.json({ error: "orderedIds (array) and type are required" }, { status: 400 });
        }

        // Ensure sortOrder column exists (self-healing migration)
        try {
            await prisma.$executeRawUnsafe(`ALTER TABLE "Category" ADD COLUMN IF NOT EXISTS "sortOrder" INTEGER NOT NULL DEFAULT 0`);
        } catch (e) {
            // Column might already exist, ignore
        }

        // Update all categories with their new index
        for (let i = 0; i < orderedIds.length; i++) {
            const id = orderedIds[i];
            await prisma.$executeRawUnsafe(
                `UPDATE "Category" SET "sortOrder" = $1 WHERE id = $2 AND type = $3`,
                i + 1,
                id,
                type
            );
        }

        return NextResponse.json({ success: true });

    } catch (e: any) {
        console.error("Reorder Error:", e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
