import { error, json } from '@sveltejs/kit';

import { listUsers, userToJson } from '$lib/server/auth';
import { listAllUserCardLists } from '$lib/server/user-lists';

import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
  if (!locals.user) {
    throw error(401, 'Sign in to view user lists.');
  }

  const [users, lists] = await Promise.all([listUsers(), listAllUserCardLists(['buyer', 'seller'])]);
  const listsByUserId = new Map<string, typeof lists>();
  for (const list of lists) {
    const grouped = listsByUserId.get(list.userId) || [];
    grouped.push(list);
    listsByUserId.set(list.userId, grouped);
  }

  return json({
    users: users.map((user) => {
      const userLists = listsByUserId.get(user.id) || [];
      return {
        ...userToJson(user),
        lists: userLists.map((list) => ({
          id: list.id,
          kind: list.kind,
          label: list.label,
          url: list.url,
          position: list.position
        }))
      };
    })
  });
};
