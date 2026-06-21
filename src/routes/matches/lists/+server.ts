import { error, json } from '@sveltejs/kit';

import { listUserCardLists } from '$lib/server/user-lists';

import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
  if (!locals.user) {
    throw error(401, 'Sign in to view saved lists.');
  }
  return json(await listUserCardLists(locals.user.id));
};
