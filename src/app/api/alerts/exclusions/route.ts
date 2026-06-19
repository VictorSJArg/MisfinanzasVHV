import { NextRequest, NextResponse } from 'next/server';
import { autoPayReachedExcludedExpenseTransactions } from '@/lib/alertExclusions';
import { prisma } from '@/lib/prisma';

async function getDefaultUser() {
  const user = await prisma.user.findFirst();
  if (!user) {
    throw new Error('No user found');
  }
  return user;
}

function asString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const user = await getDefaultUser();
    const categoryId = asString(body.categoryId);
    const description = asString(body.description);
    const excluded = body.excluded === true;

    if (!categoryId) {
      return NextResponse.json({ success: false, error: 'categoryId requerido' }, { status: 400 });
    }

    if (excluded) {
      const exclusion = await prisma.alertExclusion.upsert({
        where: {
          userId_categoryId_description: {
            userId: user.id,
            categoryId,
            description
          }
        },
        update: {},
        create: {
          userId: user.id,
          categoryId,
          description
        }
      });

      const autoPaidCount = await autoPayReachedExcludedExpenseTransactions(user.id, {
        categoryId,
        description
      });

      return NextResponse.json({ success: true, excluded: true, exclusion, autoPaidCount });
    }

    await prisma.alertExclusion.deleteMany({
      where: {
        userId: user.id,
        categoryId,
        description
      }
    });

    return NextResponse.json({ success: true, excluded: false });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
