import { error, json } from '@sveltejs/kit';

import { ensureAdmin } from '$lib/server/auth';
import { listMatcherAdminUsers } from '$lib/server/matcher-admin';

import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
  try {
    ensureAdmin(locals.user);
  } catch {
    throw error(401, 'Admin access is required.');
  }
  return json(await listMatcherAdminUsers());
};
