import { error, fail, redirect } from '@sveltejs/kit';

import { isAppError, type AppError } from '$lib/server/app-error';
import { consumeLoginToken, previewLoginToken, setSessionCookie } from '$lib/server/auth';

import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
  try {
    const { user, expiresAt } = await previewLoginToken(params.token);
    return {
      loginUser: {
        username: user.username,
        displayName: user.displayName,
        role: user.role
      },
      expiresAt: expiresAt.toISOString()
    };
  } catch (caught) {
    if (isAppError(caught)) {
      logLoginLinkAppError(caught, 'preview');
      throw error(caught.httpStatusCode, caught.userFacingError);
    }

    logUnexpectedLoginLinkError(caught, 'preview');
    throw error(500, 'Could not read this login link.');
  }
};

export const actions: Actions = {
  default: async ({ params, cookies, url }) => {
    try {
      const { sessionToken } = await consumeLoginToken(params.token);
      setSessionCookie(cookies, sessionToken, url);
      throw redirect(303, '/matches');
    } catch (caught) {
      if (isRedirect(caught)) {
        throw caught;
      }

      if (isAppError(caught)) {
        logLoginLinkAppError(caught, 'consume');
        return fail(caught.httpStatusCode, {
          error: caught.userFacingError
        });
      }

      logUnexpectedLoginLinkError(caught, 'consume');
      return fail(500, {
        error: 'Could not consume this login link.'
      });
    }
  }
};

function isRedirect(value: unknown): boolean {
  return Boolean(value && typeof value === 'object' && 'status' in value && 'location' in value);
}

function logLoginLinkAppError(value: AppError, stage: 'preview' | 'consume'): void {
  if (value.httpStatusCode < 500) {
    return;
  }
  console.error('[auth] failed to use login link', {
    stage,
    message: value.adminFacingError,
    type: value.errorTypeName,
    status: value.httpStatusCode
  });
}

function logUnexpectedLoginLinkError(value: unknown, stage: 'preview' | 'consume'): void {
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

  console.error('[auth] failed to use login link', {
    stage,
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
