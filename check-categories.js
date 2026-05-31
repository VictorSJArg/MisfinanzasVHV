const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const cats = await prisma.$queryRawUnsafe(`SELECT id, name, type, "sortOrder" FROM "Category" ORDER BY type ASC, "sortOrder" ASC`);
  console.log(JSON.stringify(cats, null, 2));
}

main().finally(() => prisma.$disconnect());
