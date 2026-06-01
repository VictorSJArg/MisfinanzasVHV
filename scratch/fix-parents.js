const { PrismaClient } = require('@prisma/client');

// Use DIRECT_URL or DATABASE_URL from environment to connect
const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: connectionString,
    },
  },
});

async function main() {
  console.log('=== INICIANDO AJUSTE DE CATEGORÍAS PADRE ===');

  // 1. Buscar la categoría padre "Esparcimiento"
  const parentCat = await prisma.category.findFirst({
    where: {
      name: { equals: 'Esparcimiento', mode: 'insensitive' },
      type: 'EXPENSE'
    }
  });

  if (!parentCat) {
    console.error('ERROR: No se encontró la categoría principal "Esparcimiento".');
    return;
  }

  console.log(`Encontrada categoría principal: "${parentCat.name}" (ID: ${parentCat.id})`);

  // 2. Buscar las subcategorías que quedaron huérfanas o sin padre
  const subCategoriesToFix = ['Paseos con Antonia', 'Paseos con paula'];

  for (const name of subCategoriesToFix) {
    const cat = await prisma.category.findFirst({
      where: {
        name: { equals: name, mode: 'insensitive' },
        type: 'EXPENSE'
      }
    });

    if (cat) {
      if (cat.parentId === parentCat.id) {
        console.log(`La categoría "${cat.name}" ya está correctamente asociada a "Esparcimiento".`);
      } else {
        console.log(`Asociando "${cat.name}" (ID: ${cat.id}) bajo "Esparcimiento"...`);
        await prisma.category.update({
          where: { id: cat.id },
          data: { parentId: parentCat.id }
        });
        console.log(`¡Éxito! "${cat.name}" ahora es subcategoría de "Esparcimiento".`);
      }
    } else {
      console.log(`No se encontró la categoría "${name}" en la base de datos (quizás aún no se cargó).`);
    }
  }

  console.log('=== PROCESO TERMINADO ===');
}

main()
  .catch(e => console.error('Error durante la ejecución:', e))
  .finally(() => prisma.$disconnect());
