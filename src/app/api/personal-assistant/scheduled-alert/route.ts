import { NextRequest, NextResponse } from 'next/server';
import { sendScheduledPersonalAlert } from '@/lib/personalAssistant';

export const dynamic = 'force-dynamic';

function schedulerToken() {
  return process.env.N8N_PERSONAL_SCHEDULER_TOKEN?.trim() || process.env.N8N_ALERT_WEBHOOK_TOKEN?.trim() || '';
}

function isAuthorized(request: NextRequest) {
  const token = schedulerToken();
  if (!token) return false;
  return request.headers.get('authorization') === `Bearer ${token}`;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unknown scheduled alert error';
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const result = await sendScheduledPersonalAlert(body || {});
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 500 });
  }
}
