import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const results: string[] = [];

    // 1. Buscar categoría "Alquileres" (INCOME)
    const alquileresCat = await prisma.category.findFirst({
      where: {
        name: { equals: 'Alquileres', mode: 'insensitive' },
        type: 'INCOME'
      }
    });

    if (alquileresCat) {
      // Encontrar transacciones huérfanas de alquileres
      const txsToFix = await prisma.transaction.findMany({
        where: {
          description: { in: ['Alquiler del salón', 'Alquiler de casa'] },
          categoryId: null
        }
      });

      if (txsToFix.length > 0) {
        const updateResult = await prisma.transaction.updateMany({
          where: {
            id: { in: txsToFix.map(t => t.id) }
          },
          data: {
            categoryId: alquileresCat.id
          }
        });
        results.push(`Se asociaron ${updateResult.count} transacciones de alquiler a la categoría "${alquileresCat.name}"`);
      } else {
        results.push('No se encontraron transacciones huérfanas de alquiler para corregir.');
      }
    } else {
      results.push('Error: No se encontró la categoría principal "Alquileres".');
    }

    // 2. Vincular "Paseos con Antonia" y "Paseos con paula" a "Esparcimiento" (EXPENSE)
    const esparcimientoCat = await prisma.category.findFirst({
      where: {
        name: { equals: 'Esparcimiento', mode: 'insensitive' },
        type: 'EXPENSE'
      }
    });

    if (esparcimientoCat) {
      const subCats = await prisma.category.findMany({
        where: {
          name: { in: ['Paseos con Antonia', 'Paseos con paula'] },
          type: 'EXPENSE'
        }
      });

      for (const cat of subCats) {
        if (cat.parentId !== esparcimientoCat.id) {
          await prisma.category.update({
            where: { id: cat.id },
            data: { parentId: esparcimientoCat.id }
          });
          results.push(`Se asoció la categoría "${cat.name}" bajo "${esparcimientoCat.name}"`);
        } else {
          results.push(`La categoría "${cat.name}" ya estaba vinculada bajo "${esparcimientoCat.name}".`);
        }
      }
    } else {
      results.push('Error: No se encontró la categoría principal "Esparcimiento".');
    }

    return NextResponse.json({
      success: true,
      actions: results
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
