import { error, redirect } from '@sveltejs/kit';

import { isAppError, type AppError } from '$lib/server/app-error';
import { consumeLoginToken, setSessionCookie } from '$lib/server/auth';

import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, cookies, url }) => {
  try {
    const { sessionToken } = await consumeLoginToken(params.token);
    setSessionCookie(cookies, sessionToken, url);
    throw redirect(303, '/matches');
  } catch (caught) {
    if (isRedirect(caught)) {
      throw caught;
    }

    if (isAppError(caught)) {
      logLoginLinkAppError(caught);
      throw error(caught.httpStatusCode, caught.userFacingError);
    }

    logUnexpectedLoginLinkError(caught);
    throw error(500, 'Could not consume this login link.');
  }
};

function isRedirect(value: unknown): boolean {
  return Boolean(value && typeof value === 'object' && 'status' in value && 'location' in value);
}

function logLoginLinkAppError(value: AppError): void {
  if (value.httpStatusCode < 500) {
    return;
  }
  console.error('[auth] failed to consume login link', {
    message: value.adminFacingError,
    type: value.errorTypeName,
    status: value.httpStatusCode
  });
}

function logUnexpectedLoginLinkError(value: unknown): void {
  const err = value as Error & {
    code?: unknown;
    cause?: unknown;
  };
  const cause = err?.cause as
    | (Error & {
        code?: unknown;
        detail?: unknown;
        hint?: unknown;
        table?: unknown;
        column?: unknown;
        constraint?: unknown;
      })
    | undefined;

  console.error('[auth] failed to consume login link', {
    message: err?.message || String(value),
    code: err?.code,
    causeMessage: cause?.message,
    causeCode: cause?.code,
    detail: cause?.detail,
    hint: cause?.hint,
    table: cause?.table,
    column: cause?.column,
    constraint: cause?.constraint
  });
}
