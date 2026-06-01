const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const txs = await prisma.transaction.findMany({
    orderBy: { createdAt: 'desc' },
    take: 30,
    include: {
      category: true,
      account: true
    }
  });

  console.log('--- LATEST 30 TRANSACTIONS ---');
  for (const t of txs) {
    console.log(`ID: ${t.id}`);
    console.log(`Amount: ${t.amount}`);
    console.log(`Date: ${t.date.toISOString().split('T')[0]}`);
    console.log(`Type: ${t.type}`);
    console.log(`Description: ${t.description}`);
    console.log(`Category: ${t.category ? t.category.name : 'None'} (Parent ID: ${t.category ? t.category.parentId : 'None'})`);
    console.log(`Account: ${t.account ? t.account.name : 'None'}`);
    console.log(`Status: ${t.status}`);
    console.log(`CreatedAt: ${t.createdAt.toISOString()}`);
    console.log('------------------------------');
  }
}

main().finally(() => prisma.$disconnect());
