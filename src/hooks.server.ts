import type { Handle } from '@sveltejs/kit';

import { resolveSessionUser } from '$lib/server/auth';
import { initOpenTelemetry, withSpan } from '$lib/server/otel';

initOpenTelemetry();

export const handle: Handle = async ({ event, resolve }) => {
  const clientIp = resolveClientIp(event);
  const requestKind = classifyRequest(event.request.method, event.url.pathname);
  event.locals.user = await resolveSessionUser(event.cookies).catch((error) => {
    console.error('[auth] failed to resolve session user', error);
    return null;
  });

  if (requestKind === 'analysis_progress_poll') {
    return await resolve(event);
  }

  const spanName = `http.${requestKind}`;
  return await withSpan(
    spanName,
    {
      'http.method': event.request.method,
      'http.route': event.url.pathname,
      'client.address': clientIp,
      'app.request.kind': requestKind
    },
    async (span) => {
      const response = await resolve(event);
      span.setAttribute('http.status_code', response.status);
      return response;
    }
  );
};

function resolveClientIp(event: Parameters<Handle>[0]['event']): string {
  const headers = event.request.headers;
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded
      .split(',')
      .map((item) => item.trim())
      .find(Boolean);
    if (first) {
      return first;
    }
  }

  const realIp = headers.get('x-real-ip');
  if (realIp?.trim()) {
    return realIp.trim();
  }

  const cfIp = headers.get('cf-connecting-ip');
  if (cfIp?.trim()) {
    return cfIp.trim();
  }

  try {
    const addr = event.getClientAddress();
    if (addr?.trim()) {
      return addr.trim();
    }
  } catch {
    // may be unavailable in some runtimes
  }

  return 'unknown';
}

function classifyRequest(method: string, pathname: string): string {
  const verb = method.toUpperCase();
  if (verb === 'GET' && pathname === '/') {
    return 'home_view';
  }
  if (verb === 'POST' && pathname === '/') {
    return 'analysis_submit';
  }
  if (verb === 'GET' && /^\/analysis\/[^/]+$/.test(pathname)) {
    return 'analysis_share_view';
  }
  if (verb === 'GET' && /^\/api\/progress\/[^/]+$/.test(pathname)) {
    return 'analysis_progress_poll';
  }
  if (verb === 'GET' && /^\/connect\/[^/]+$/.test(pathname)) {
    return 'auth_connect';
  }
  if (pathname.startsWith('/admin')) {
    return 'admin';
  }
  if (pathname.startsWith('/account')) {
    return 'account';
  }
  if (pathname.startsWith('/matches')) {
    return 'matches';
  }
  return 'other';
}
