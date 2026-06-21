import { error, json } from '@sveltejs/kit';

import { ensureAdmin, listUsers, userToJson } from '$lib/server/auth';

import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
  try {
    ensureAdmin(locals.user);
  } catch {
    throw error(401, 'Admin access is required.');
  }
  const users = await listUsers();
  return json(users.map(userToJson));
};
