import { NextRequest, NextResponse } from 'next/server';
import { getPendingAlertsForUser, normalizeAlertPreference } from '@/lib/alerts';
import { prisma } from '@/lib/prisma';

async function getDefaultUser() {
  const user = await prisma.user.findFirst({
    include: { alertPreference: true }
  });
  if (!user) {
    throw new Error('No user found');
  }
  return user;
}

function asNumber(value: string | null, fallback: number) {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function GET(request: NextRequest) {
  try {
    const user = await getDefaultUser();
    const { searchParams } = new URL(request.url);
    const preference = normalizeAlertPreference(user.alertPreference);
    const daysAhead = asNumber(searchParams.get('daysAhead'), preference.alertWindowDays);
    const daysBack = asNumber(searchParams.get('daysBack'), 30);

    const pending = await getPendingAlertsForUser(user.id, {
      daysAhead,
      daysBack,
      timeZone: preference.timezone
    });

    return NextResponse.json({
      success: true,
      ...pending,
      preference
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
