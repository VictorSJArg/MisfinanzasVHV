const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
    // Step 1: Add sortOrder column if not exists
    try {
        await prisma.$executeRawUnsafe(`ALTER TABLE "Category" ADD COLUMN IF NOT EXISTS "sortOrder" INTEGER NOT NULL DEFAULT 0`);
        console.log('✅ Column sortOrder added (or already exists)');
    } catch (e) {
        console.log('Column might already exist:', e.message);
    }

    // Step 2: Initialize sortOrder based on current alphabetical order, partitioned by type
    try {
        await prisma.$executeRawUnsafe(`
            WITH ordered AS (
                SELECT id, type, ROW_NUMBER() OVER (PARTITION BY type ORDER BY name ASC) AS rn
                FROM "Category"
            )
            UPDATE "Category" c
            SET "sortOrder" = o.rn
            FROM ordered o
            WHERE c.id = o.id
        `);
        console.log('✅ sortOrder initialized alphabetically per type');
    } catch (e) {
        console.error('Error initializing sortOrder:', e.message);
    }

    // Verify
    const categories = await prisma.$queryRawUnsafe(`SELECT name, type, "sortOrder" FROM "Category" ORDER BY type, "sortOrder"`);
    console.log('\nCategories with sortOrder:');
    categories.forEach(c => console.log(`  [${c.type}] ${c.sortOrder}: ${c.name}`));
}

main().catch(console.error).finally(() => prisma.$disconnect());
