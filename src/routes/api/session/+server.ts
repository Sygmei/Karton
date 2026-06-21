import { json } from '@sveltejs/kit';

import { userToJson } from '$lib/server/auth';

import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
  return json({
    currentUser: locals.user ? userToJson(locals.user) : null
  });
};
