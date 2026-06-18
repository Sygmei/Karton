import { userToJson } from '$lib/server/auth';

import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
  return {
    currentUser: locals.user ? userToJson(locals.user) : null
  };
};
