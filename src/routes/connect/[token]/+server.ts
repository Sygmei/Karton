import { redirect } from '@sveltejs/kit';

import { consumeLoginToken, setSessionCookie } from '$lib/server/auth';

import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, cookies, url }) => {
  const { sessionToken } = await consumeLoginToken(params.token);
  setSessionCookie(cookies, sessionToken, url);
  throw redirect(303, '/matches');
};
