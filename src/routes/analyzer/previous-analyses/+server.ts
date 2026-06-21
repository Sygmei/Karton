import { error, json } from '@sveltejs/kit';

import { listAnalysisRunsForUser } from '$lib/server/analysis-runs-repo';

import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
  if (!locals.user) {
    throw error(401, 'Sign in to view previous analyses.');
  }
  return json(await listAnalysisRunsForUser(locals.user.id));
};
