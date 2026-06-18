import { userToJson } from '$lib/server/auth';

import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals }) => {
  return {
    currentUser: locals.user ? userToJson(locals.user) : null
  };
};
