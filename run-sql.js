const fs = require('fs');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const sql = fs.readFileSync('setup.sql', 'utf8');
  console.log('SQL generated. Executing...');
  // Prisma $executeRawUnsafe runs a single query.
  // setup.sql contains multiple statements. Prisma may require splitting them or it might just work.
  // Actually, let's use the postgres endpoint via REST API!
  // Wait, Prisma can execute multiple statements in $executeRawUnsafe on postgres!
  try {
    await prisma.$executeRawUnsafe(sql);
    console.log('Setup complete!');
  } catch(e) {
    console.error('Error executing SQL via Prisma:', e.message);
    process.exit(1);
  }
}
main().finally(() => prisma.$disconnect());
