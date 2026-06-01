const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const todayStart = new Date('2026-05-31T00:00:00Z');
  
  // Find recent transactions with "Transporte - UBER" description containing "/06"
  const txs = await prisma.transaction.findMany({
    where: {
      createdAt: { gte: todayStart },
      description: { contains: 'Transporte - UBER' }
    }
  });

  console.log(`Found ${txs.length} UBER transactions.`);

  let updatedCount = 0;
  for (const t of txs) {
    const currentMonth = t.date.getMonth(); // 5 is June
    if (currentMonth === 5) {
      const newDate = new Date(t.date);
      newDate.setMonth(4); // May

      let newDesc = t.description;
      if (newDesc && newDesc.includes('/06')) {
        newDesc = newDesc.replace('/06', '/05');
      }

      console.log(`Updating Transaction ${t.id}:`);
      console.log(`  Old Date: ${t.date.toISOString().split('T')[0]} -> New Date: ${newDate.toISOString().split('T')[0]}`);
      console.log(`  Old Desc: "${t.description}" -> New Desc: "${newDesc}"`);

      await prisma.transaction.update({
        where: { id: t.id },
        data: {
          date: newDate,
          description: newDesc
        }
      });
      updatedCount++;
    }
  }

  console.log(`Successfully updated ${updatedCount} UBER transactions.`);
}

main().finally(() => prisma.$disconnect());
