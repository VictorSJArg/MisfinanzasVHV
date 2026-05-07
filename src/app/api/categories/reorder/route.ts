
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// POST - Reorder categories (swap positions)
export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { categoryId, direction, type } = body;

        if (!categoryId || !direction || !type) {
            return NextResponse.json({ error: "categoryId, direction, and type are required" }, { status: 400 });
        }

        // Ensure sortOrder column exists (self-healing migration)
        try {
            await prisma.$executeRawUnsafe(`ALTER TABLE "Category" ADD COLUMN IF NOT EXISTS "sortOrder" INTEGER NOT NULL DEFAULT 0`);
        } catch (e) {
            // Column might already exist, ignore
        }

        // Get all categories of this type, ordered by sortOrder then name
        const categories = await prisma.$queryRawUnsafe(
            `SELECT id, name, "sortOrder" FROM "Category" WHERE type = $1 ORDER BY "sortOrder" ASC, name ASC`,
            type
        ) as any[];

        // Check if any have sortOrder = 0 (uninitialized) - if so, initialize them
        const needsInit = categories.every(c => c.sortOrder === 0) || 
                          new Set(categories.map(c => c.sortOrder)).size !== categories.length;
        
        if (needsInit) {
            // Initialize sortOrder sequentially
            for (let i = 0; i < categories.length; i++) {
                await prisma.$executeRawUnsafe(
                    `UPDATE "Category" SET "sortOrder" = $1 WHERE id = $2`,
                    i + 1,
                    categories[i].id
                );
                categories[i].sortOrder = i + 1;
            }
        }

        // Find current index
        const currentIndex = categories.findIndex(c => c.id === categoryId);
        if (currentIndex === -1) {
            return NextResponse.json({ error: "Category not found" }, { status: 404 });
        }

        const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
        if (targetIndex < 0 || targetIndex >= categories.length) {
            return NextResponse.json({ error: "Cannot move further" }, { status: 400 });
        }

        // Swap sortOrder values
        const currentOrder = categories[currentIndex].sortOrder;
        const targetOrder = categories[targetIndex].sortOrder;

        await prisma.$executeRawUnsafe(
            `UPDATE "Category" SET "sortOrder" = $1 WHERE id = $2`,
            targetOrder,
            categories[currentIndex].id
        );

        await prisma.$executeRawUnsafe(
            `UPDATE "Category" SET "sortOrder" = $1 WHERE id = $2`,
            currentOrder,
            categories[targetIndex].id
        );

        return NextResponse.json({ success: true });

    } catch (e: any) {
        console.error("Reorder Error:", e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
