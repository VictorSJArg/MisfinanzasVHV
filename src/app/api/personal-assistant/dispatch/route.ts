import { NextRequest, NextResponse } from 'next/server';
import { dispatchPersonalAssistant } from '@/lib/personalAssistant';

export const dynamic = 'force-dynamic';

function isAuthorized(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET?.trim();
  const dryRun = request.nextUrl.searchParams.get('dryRun') === 'true';
  const manualTest = request.nextUrl.searchParams.get('manualTest') === 'true';
  if (!cronSecret) {
    const userAgent = request.headers.get('user-agent') || '';
    return dryRun || manualTest || userAgent === 'vercel-cron/1.0';
  }

  const authHeader = request.headers.get('authorization');
  return dryRun || manualTest || authHeader === `Bearer ${cronSecret}`;
}

async function handleDispatch(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  let dryRun = false;
  let userId: string | undefined;

  if (request.method === 'GET') {
    const { searchParams } = new URL(request.url);
    dryRun = searchParams.get('dryRun') === 'true';
    userId = searchParams.get('userId') || undefined;
  } else {
    try {
      const body = await request.json();
      dryRun = body?.dryRun === true;
      userId = typeof body?.userId === 'string' ? body.userId : undefined;
    } catch {
      dryRun = false;
    }
  }

  try {
    const result = await dispatchPersonalAssistant({ dryRun, userId });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown dispatch error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return handleDispatch(request);
}

export async function POST(request: NextRequest) {
  return handleDispatch(request);
}
