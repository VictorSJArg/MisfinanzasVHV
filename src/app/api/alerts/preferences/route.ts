import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  ALERT_DEFAULT_DAYS_BEFORE,
  ALERT_DEFAULT_NOTIFY_HOUR,
  ALERT_DEFAULT_WINDOW_DAYS,
  ALERT_DEFAULT_TIMEZONE,
  normalizeAlertPreference
} from '@/lib/alerts';

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

function asBoolean(value: unknown) {
  return value === true || value === 'true';
}

function asNumber(value: unknown) {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export async function GET() {
  try {
    const user = await getDefaultUser();
    const preference = await prisma.alertPreference.findUnique({
      where: { userId: user.id }
    });

    return NextResponse.json({
      success: true,
      preference: normalizeAlertPreference(preference)
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const user = await getDefaultUser();

    const phone = asString(body.phone);
    const enabled = asBoolean(body.enabled);
    const daysBefore = asNumber(body.daysBefore) ?? ALERT_DEFAULT_DAYS_BEFORE;
    const alertWindowDays = asNumber(body.alertWindowDays) ?? ALERT_DEFAULT_WINDOW_DAYS;
    const notifyHour = asNumber(body.notifyHour) ?? ALERT_DEFAULT_NOTIFY_HOUR;
    const timezone = asString(body.timezone) || ALERT_DEFAULT_TIMEZONE;

    if (daysBefore < 0 || daysBefore > 30) {
      return NextResponse.json({ success: false, error: 'daysBefore debe estar entre 0 y 30' }, { status: 400 });
    }

    if (alertWindowDays < 1 || alertWindowDays > 365) {
      return NextResponse.json({ success: false, error: 'alertWindowDays debe estar entre 1 y 365' }, { status: 400 });
    }

    if (notifyHour < 0 || notifyHour > 23) {
      return NextResponse.json({ success: false, error: 'notifyHour debe estar entre 0 y 23' }, { status: 400 });
    }

    const saved = await prisma.alertPreference.upsert({
      where: { userId: user.id },
      update: {
        enabled,
        phone: phone || null,
        daysBefore,
        alertWindowDays,
        notifyHour,
        timezone
      },
      create: {
        userId: user.id,
        enabled,
        phone: phone || null,
        daysBefore,
        alertWindowDays,
        notifyHour,
        timezone
      }
    });

    return NextResponse.json({
      success: true,
      preference: normalizeAlertPreference(saved)
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
