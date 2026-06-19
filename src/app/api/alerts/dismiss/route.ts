import { NextRequest, NextResponse } from 'next/server';
import { parseDateKey } from '@/lib/alerts';
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

    const alertKey = asString(body.alertKey);
    const sourceType = asString(body.sourceType);
    const sourceId = asString(body.sourceId);
    const title = asString(body.title);
    const dueDate = asString(body.dueDate);

    if (!alertKey || !sourceType || !sourceId || !title || !dueDate) {
      return NextResponse.json({ success: false, error: 'Faltan datos de la alerta' }, { status: 400 });
    }

    const dismissal = await prisma.alertDismissal.upsert({
      where: {
        userId_alertKey: {
          userId: user.id,
          alertKey
        }
      },
      update: {
        sourceType,
        sourceId,
        title,
        dueDate: parseDateKey(dueDate)
      },
      create: {
        userId: user.id,
        alertKey,
        sourceType,
        sourceId,
        title,
        dueDate: parseDateKey(dueDate)
      }
    });

    return NextResponse.json({ success: true, dismissal });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
