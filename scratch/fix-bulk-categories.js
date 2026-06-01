const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('=== STARTING DATABASE CLEANUP OF DATE-SUFFIXED CATEGORIES ===');

  // 1. Fetch all categories
  const categories = await prisma.category.findMany();
  console.log(`Fetched ${categories.length} total categories.`);

  // 2. Identify categories with date suffixes (e.g. "Name - DD/MM" or "Name DD/MM")
  const dateSuffixPattern = /\s*-\s*\d{2}[/\-]\d{2}$|\s+\d{2}[/\-]\d{2}$/;
  const suffixedCategories = categories.filter(c => dateSuffixPattern.test(c.name));

  console.log(`Found ${suffixedCategories.length} categories with date suffixes:`);
  for (const cat of suffixedCategories) {
    console.log(`  - "${cat.name}" (ID: ${cat.id}, Parent ID: ${cat.parentId})`);
  }

  if (suffixedCategories.length === 0) {
    console.log('No categories to clean up.');
    return;
  }

  // 3. Process each suffixed category
  for (const cat of suffixedCategories) {
    const baseName = cat.name.replace(dateSuffixPattern, '').trim();
    
    // Find target category ID
    let targetCategoryId = null;

    if (cat.parentId) {
      // If it has a parent, move the transactions directly to the parent category!
      targetCategoryId = cat.parentId;
    } else {
      // Otherwise, look for a category with the base name (e.g. "Alimentos")
      const baseCat = categories.find(c => c.name.toLowerCase() === baseName.toLowerCase() && c.type === cat.type && c.userId === cat.userId);
      if (baseCat) {
        targetCategoryId = baseCat.id;
      }
    }

    if (!targetCategoryId) {
      console.warn(`WARNING: Could not find target category for "${cat.name}". Skipping transaction migration.`);
      continue;
    }

    const targetCat = categories.find(c => c.id === targetCategoryId);
    console.log(`Migrating transactions from "${cat.name}" to "${targetCat ? targetCat.name : targetCategoryId}"...`);

    // Fetch transactions under this suffixed category
    const txs = await prisma.transaction.findMany({ where: { categoryId: cat.id } });
    console.log(`  - Found ${txs.length} transactions.`);

    if (txs.length > 0) {
      // Update transactions to target category
      const updateResult = await prisma.transaction.updateMany({
        where: { categoryId: cat.id },
        data: { categoryId: targetCategoryId }
      });
      console.log(`  - Successfully moved ${updateResult.count} transactions.`);
    }

    // Double check if there are no more transactions under this category
    const remainingTxs = await prisma.transaction.count({ where: { categoryId: cat.id } });
    if (remainingTxs === 0) {
      // Delete the empty category
      await prisma.category.delete({ where: { id: cat.id } });
      console.log(`  - Deleted empty category "${cat.name}".`);
    } else {
      console.error(`  - ERROR: Could not delete "${cat.name}" because it still has ${remainingTxs} transactions.`);
    }
  }

  console.log('=== CLEANUP COMPLETED SUCCESSFULLY ===');
}

main()
  .catch(e => console.error('Error during cleanup:', e))
  .finally(() => prisma.$disconnect());
