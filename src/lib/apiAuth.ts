import { NextRequest, NextResponse } from 'next/server';

const ASSISTANT_SECRET_ENV_NAMES = ['ASSISTANT_WEBHOOK_SECRET', 'N8N_WEBHOOK_SECRET'];

function getConfiguredSecret() {
  for (const envName of ASSISTANT_SECRET_ENV_NAMES) {
    const value = process.env[envName]?.trim();
    if (value) return value;
  }
  return null;
}

function extractBearerToken(request: NextRequest) {
  const authHeader = request.headers.get('authorization') || '';
  if (authHeader.toLowerCase().startsWith('bearer ')) {
    return authHeader.slice(7).trim();
  }
  return request.headers.get('x-assistant-secret') || '';
}

export function requireAssistantAuth(request: NextRequest) {
  const expectedSecret = getConfiguredSecret();

  if (!expectedSecret) {
    return NextResponse.json(
      { success: false, error: 'Assistant webhook secret is not configured' },
      { status: 503 }
    );
  }

  const providedSecret = extractBearerToken(request);
  if (!providedSecret || providedSecret !== expectedSecret) {
    return NextResponse.json(
      { success: false, error: 'Unauthorized' },
      { status: 401 }
    );
  }

  return null;
}

export function normalizePhone(value: unknown) {
  return String(value || '').replace(/[^\d]/g, '');
}

export function isAllowedAssistantPhone(value: unknown) {
  const configured = process.env.ASSISTANT_ALLOWED_PHONE?.trim();
  if (!configured) return true;

  const incoming = normalizePhone(value);
  const allowedPhones = configured
    .split(',')
    .map(normalizePhone)
    .filter(Boolean);

  return allowedPhones.length === 0 || allowedPhones.includes(incoming);
}
