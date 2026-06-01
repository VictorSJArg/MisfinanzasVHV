const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  // Find all transactions created today, 2026-05-31.
  const todayStart = new Date('2026-05-31T00:00:00Z');
  const txs = await prisma.transaction.findMany({
    where: {
      createdAt: { gte: todayStart }
    },
    include: {
      category: true
    }
  });

  console.log(`Found ${txs.length} transactions created today.`);

  // Let's resolve the categories first
  const otrosIngresosCat = await prisma.category.findFirst({
    where: { name: 'Otros Ingresos', type: 'INCOME' }
  });
  const deliveryCat = await prisma.category.findFirst({
    where: { name: 'Restaurantes/Delivery', type: 'EXPENSE' }
  });

  console.log('Otros Ingresos Category ID:', otrosIngresosCat ? otrosIngresosCat.id : 'NOT FOUND');
  console.log('Restaurantes/Delivery Category ID:', deliveryCat ? deliveryCat.id : 'NOT FOUND');

  if (!otrosIngresosCat || !deliveryCat) {
    console.error('Required categories not found!');
    return;
  }

  let updatedCount = 0;
  for (const t of txs) {
    const currentYear = t.date.getFullYear();
    const currentMonth = t.date.getMonth(); // 0-indexed: 5 is June
    const currentDay = t.date.getDate();

    // If month is June (5), we want to change it to May (4)
    if (currentMonth === 5 && currentYear === 2026) {
      const newDate = new Date(t.date);
      newDate.setMonth(4); // May

      let newDesc = t.description;
      if (newDesc && newDesc.includes('/06')) {
        newDesc = newDesc.replace('/06', '/05');
      }

      let newCategoryId = t.categoryId;
      if (t.type === 'INCOME' && (!t.categoryId || t.category.name === 'Varios')) {
        newCategoryId = otrosIngresosCat.id;
      } else if (t.type === 'EXPENSE' && (t.description.toLowerCase().includes('delivery') || t.description.toLowerCase().includes('varios'))) {
        newCategoryId = deliveryCat.id;
        // If the description has "Varios", let's rename it to "Pedido ya" or "Delivery"
        if (newDesc && newDesc.toLowerCase().includes('varios')) {
          newDesc = newDesc.replace(/Varios/i, 'Pedido ya');
        }
      }

      console.log(`Updating Transaction ${t.id}:`);
      console.log(`  Old Date: ${t.date.toISOString().split('T')[0]} -> New Date: ${newDate.toISOString().split('T')[0]}`);
      console.log(`  Old Desc: "${t.description}" -> New Desc: "${newDesc}"`);
      console.log(`  Old Cat: ${t.category ? t.category.name : 'None'} -> New Cat ID: ${newCategoryId}`);

      await prisma.transaction.update({
        where: { id: t.id },
        data: {
          date: newDate,
          description: newDesc,
          categoryId: newCategoryId
        }
      });
      updatedCount++;
    }
  }

  console.log(`Successfully updated ${updatedCount} transactions.`);
}

main().finally(() => prisma.$disconnect());
