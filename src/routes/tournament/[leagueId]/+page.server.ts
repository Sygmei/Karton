import { error, redirect } from '@sveltejs/kit';
import { canManageUsers } from '$lib/server/auth';
import { isAppError } from '$lib/server/app-error';
import { createEvent, getLeague, requireTournamentUser, tournamentFailure, updateLeague } from '$lib/server/tournaments';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
  const user = requireTournamentUser(locals.user);
  const admin = canManageUsers(user);
  try {
    return { ...await getLeague(params.leagueId, user), admin };
  } catch (caught) {
    if (isAppError(caught)) throw error(caught.httpStatusCode, caught.userFacingError);
    throw caught;
  }
};

export const actions: Actions = {
  settings: async ({ locals, params, request }) => {
    try { await updateLeague(locals.user, params.leagueId, await request.formData()); return { success: true }; }
    catch (error) { return tournamentFailure(error); }
  },
  createEvent: async ({ locals, params, request }) => {
    let id: string;
    try { id = await createEvent(locals.user, params.leagueId, await request.formData()); }
    catch (error) { return tournamentFailure(error); }
    throw redirect(303, `/tournament/${params.leagueId}/events/${id}`);
  }
};
