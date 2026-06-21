import { listUsers, userToJson } from './auth';
import { listAllUserCardLists } from './user-lists';

export async function listMatcherAdminUsers() {
  const [adminUsers, allLists] = await Promise.all([listUsers(), listAllUserCardLists(['buyer', 'seller'])]);
  const adminUserListCounts = new Map<string, { buyer: number; seller: number }>();
  for (const list of allLists) {
    const counts = adminUserListCounts.get(list.userId) || { buyer: 0, seller: 0 };
    counts[list.kind] += 1;
    adminUserListCounts.set(list.userId, counts);
  }
  return adminUsers.map((user) => ({
    ...userToJson(user),
    lists: adminUserListCounts.get(user.id) || { buyer: 0, seller: 0 }
  }));
}
