import { fail, redirect } from '@sveltejs/kit';

import { createPresentedLoginLink, resolveRequestBaseUrl } from '$lib/server/login-links';
import { isAppError } from '$lib/server/app-error';
import { updateUserDisplayName, userToJson } from '$lib/server/auth';

import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.user) {
    throw redirect(303, '/');
  }
  return {
    currentUser: userToJson(locals.user)
  };
};

export const actions: Actions = {
  updateProfile: async ({ request, locals }) => {
    if (!locals.user) {
      throw redirect(303, '/');
    }
    try {
      const formData = await request.formData();
      await updateUserDisplayName({
        userId: locals.user.id,
        displayName: String(formData.get('displayName') || '').trim() || null
      });
      return { success: 'Account updated.' };
    } catch (error) {
      return actionFailure(error, 'Could not update account.');
    }
  },

  loginLink: async ({ locals, url }) => {
    if (!locals.user) {
      throw redirect(303, '/');
    }
    try {
      const link = await createPresentedLoginLink({
        userId: locals.user.id,
        baseUrl: resolveRequestBaseUrl(url)
      });
      return { generatedLink: link };
    } catch (error) {
      return actionFailure(error, 'Could not create login link.');
    }
  }
};

function actionFailure(error: unknown, fallback: string) {
  const appError = isAppError(error) ? error : null;
  return fail(appError?.httpStatusCode ?? 500, {
    error: appError?.userFacingError || fallback
  });
}
