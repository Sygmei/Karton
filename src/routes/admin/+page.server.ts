import { fail, redirect } from '@sveltejs/kit';

import { createUser, deleteUser, ensureAdmin, listUsers, LOGIN_LINK_TTL_MINUTES, parseUserRole, userToJson } from '$lib/server/auth';
import { createPresentedLoginLink, resolveRequestBaseUrl } from '$lib/server/login-links';
import { AppError, isAppError } from '$lib/server/app-error';

import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.user) {
    throw redirect(303, '/');
  }
  const auth = ensureAdmin(locals.user);
  const users = await listUsers();
  return {
    currentUser: userToJson(auth),
    users: users.map(userToJson)
  };
};

export const actions: Actions = {
  createUser: async ({ request, locals }) => {
    try {
      const auth = ensureAdmin(locals.user);
      const formData = await request.formData();
      await createUser({
        username: String(formData.get('username') || ''),
        role: parseUserRole(String(formData.get('role') || 'user')),
        displayName: String(formData.get('displayName') || '').trim() || null,
        createdBy: auth
      });
      return { success: 'User created.' };
    } catch (error) {
      return actionFailure(error, 'Could not create user.');
    }
  },

  deleteUser: async ({ request, locals }) => {
    try {
      const auth = ensureAdmin(locals.user);
      const formData = await request.formData();
      await deleteUser(String(formData.get('userId') || ''), auth);
      return { success: 'User deleted.' };
    } catch (error) {
      return actionFailure(error, 'Could not delete user.');
    }
  },

  loginLink: async ({ request, locals, url }) => {
    try {
      ensureAdmin(locals.user);
      const formData = await request.formData();
      const userId = String(formData.get('userId') || '').trim();
      const ttlMinutes = parseLoginLinkTtlMinutes(formData.get('ttlMinutes'));
      const link = await createPresentedLoginLink({
        userId,
        baseUrl: resolveRequestBaseUrl(url),
        ttlMinutes
      });
      return { generatedLink: { ...link, userId, ttlMinutes } };
    } catch (error) {
      return actionFailure(error, 'Could not create login link.');
    }
  }
};

function parseLoginLinkTtlMinutes(value: FormDataEntryValue | null): number {
  const raw = String(value || '').trim();
  if (!raw) {
    return LOGIN_LINK_TTL_MINUTES;
  }

  const ttlMinutes = Number(raw);
  const allowed = [5, 15, 30, 60, 240, 1440];
  if (!Number.isInteger(ttlMinutes) || !allowed.includes(ttlMinutes)) {
    throw new AppError({
      userFacingError: 'Invalid login link expiration.',
      adminFacingError: `Invalid admin login link ttl minutes: ${raw}`,
      errorTypeName: 'LoginLinkTtlInvalidError',
      httpStatusCode: 400
    });
  }
  return ttlMinutes;
}

function actionFailure(error: unknown, fallback: string) {
  const appError = isAppError(error) ? error : null;
  return fail(appError?.httpStatusCode ?? 500, {
    error: appError?.userFacingError || fallback
  });
}
