import { error, json } from '@sveltejs/kit';

import { ensureAdmin, findUserById, parseUserRole, updateUserByAdmin, userToJson } from '$lib/server/auth';
import { isAppError } from '$lib/server/app-error';
import { listAnalysisRunsForUser } from '$lib/server/analysis-runs-repo';
import { createUserCardList, deleteUserCardList, listUserCardLists, parseListKind } from '$lib/server/user-lists';

import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, params }) => {
  try {
    ensureAdmin(locals.user);
  } catch {
    throw error(401, 'Admin access is required.');
  }
  const user = await findUserById(params.id);
  if (!user) {
    throw error(404, 'User not found.');
  }
  const [analyses, lists] = await Promise.all([listAnalysisRunsForUser(user.id, 50), listUserCardLists(user.id)]);
  return json({
    user: userToJson(user),
    analyses,
    lists
  });
};

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
  let auth;
  try {
    auth = ensureAdmin(locals.user);
  } catch {
    throw error(401, 'Admin access is required.');
  }
  try {
    const body = await request.json().catch(() => ({}));
    const updated = await updateUserByAdmin(params.id, auth, {
      displayName: typeof body.displayName === 'string' ? body.displayName : null,
      role: body.role ? parseUserRole(String(body.role)) : undefined
    });
    return json({ user: userToJson(updated) });
  } catch (caught) {
    throw requestError(caught, 'Could not update user.');
  }
};

export const POST: RequestHandler = async ({ locals, params, request }) => {
  try {
    ensureAdmin(locals.user);
  } catch {
    throw error(401, 'Admin access is required.');
  }
  try {
    const body = await request.json().catch(() => ({}));
    const list = await createUserCardList({
      userId: params.id,
      kind: parseListKind(String(body.kind || 'buyer')),
      label: typeof body.label === 'string' ? body.label : null,
      url: String(body.url || '')
    });
    return json({ list }, { status: 201 });
  } catch (caught) {
    throw requestError(caught, 'Could not add list.');
  }
};

export const DELETE: RequestHandler = async ({ locals, params, request }) => {
  try {
    ensureAdmin(locals.user);
  } catch {
    throw error(401, 'Admin access is required.');
  }
  try {
    const body = await request.json().catch(() => ({}));
    const listId = String(body.listId || '').trim();
    if (!listId) {
      throw error(400, 'List id is required.');
    }
    await deleteUserCardList({ userId: params.id, id: listId });
    return json({ success: true });
  } catch (caught) {
    throw requestError(caught, 'Could not delete list.');
  }
};

function requestError(caught: unknown, fallback: string): ReturnType<typeof error> {
  if (isAppError(caught)) {
    return error(caught.httpStatusCode, caught.userFacingError);
  }
  if (caught && typeof caught === 'object' && 'status' in caught && 'body' in caught) {
    throw caught;
  }
  return error(500, fallback);
}
