import { NextRequest, NextResponse } from 'next/server';

function isExcludedPath(pathname: string) {
  return (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api/assistant') ||
    pathname.startsWith('/api/webhook') ||
    pathname.startsWith('/api/keep-alive') ||
    pathname === '/api/alerts/dispatch' ||
    pathname === '/api/personal-assistant/dispatch' ||
    pathname === '/api/personal-assistant/scheduled-alert' ||
    pathname === '/favicon.ico' ||
    /\.[a-zA-Z0-9]+$/.test(pathname)
  );
}

function hasValidBasicAuth(request: NextRequest, username: string, password: string) {
  const header = request.headers.get('authorization') || '';
  const [scheme, encoded] = header.split(' ');

  if (scheme !== 'Basic' || !encoded) return false;

  try {
    const decoded = atob(encoded);
    const separatorIndex = decoded.indexOf(':');
    if (separatorIndex === -1) return false;

    const providedUser = decoded.slice(0, separatorIndex);
    const providedPassword = decoded.slice(separatorIndex + 1);

    return providedUser === username && providedPassword === password;
  } catch {
    return false;
  }
}

export function middleware(request: NextRequest) {
  const username = process.env.APP_BASIC_AUTH_USER;
  const password = process.env.APP_BASIC_AUTH_PASSWORD;

  if (!username || !password || isExcludedPath(request.nextUrl.pathname)) {
    return NextResponse.next();
  }

  if (hasValidBasicAuth(request, username, password)) {
    return NextResponse.next();
  }

  return new NextResponse('Authentication required', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="Mis Finanzas VHV"'
    }
  });
}

export const config = {
  matcher: ['/((?!_next/static|_next/image).*)']
};
