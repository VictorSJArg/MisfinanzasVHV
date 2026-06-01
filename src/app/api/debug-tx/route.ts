import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const txs = await prisma.transaction.findMany({
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: {
        category: true,
        account: true
      }
    });

    const categories = await prisma.category.findMany({
      orderBy: { name: 'asc' }
    });

    return NextResponse.json({
      success: true,
      latestTransactions: txs.map(t => ({
        id: t.id,
        amount: Number(t.amount),
        date: t.date,
        description: t.description,
        category: t.category ? { id: t.category.id, name: t.category.name, parentId: t.category.parentId } : null,
        account: t.account ? t.account.name : null,
        status: t.status,
        createdAt: t.createdAt
      })),
      categories: categories.map(c => ({
        id: c.id,
        name: c.name,
        type: c.type,
        parentId: c.parentId
      }))
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
