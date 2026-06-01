const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const sessions = await prisma.assistantSession.findMany({
    orderBy: { createdAt: 'desc' }
  });
  console.log('--- SESSIONS ---');
  console.log(JSON.stringify(sessions, null, 2));

  const history = await prisma.assistantHistory.findMany();
  console.log('--- HISTORY ---');
  console.log(JSON.stringify(history, null, 2));
}

main().finally(() => prisma.$disconnect());
