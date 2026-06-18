import { fail, redirect } from '@sveltejs/kit';

import { isAppError } from '$lib/server/app-error';
import { ensureAdmin, listUsers, userToJson } from '$lib/server/auth';
import { getTraceId, withSpan } from '$lib/server/otel';
import { computeSavedCardListMatches, computeUserContactMatches } from '$lib/server/trade-matcher';
import {
  createUserCardList,
  deleteUserCardList,
  listAllUserCardLists,
  listUserCardLists,
  parseListKind
} from '$lib/server/user-lists';

import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.user) {
    throw redirect(303, '/');
  }
  const isAdmin = locals.user?.role === 'admin' || locals.user?.role === 'superadmin';
  return {
    savedLists: listUserCardLists(locals.user.id),
    adminUsers: isAdmin ? listMatcherAdminUsers() : Promise.resolve([])
  };
};

async function listMatcherAdminUsers() {
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

export const actions: Actions = {
  addList: async ({ request, locals }) => {
    if (!locals.user) {
      throw redirect(303, '/');
    }
    try {
      const formData = await request.formData();
      await createUserCardList({
        userId: locals.user.id,
        kind: parseListKind(String(formData.get('kind') || 'buyer')),
        label: String(formData.get('label') || '').trim() || null,
        url: String(formData.get('url') || '').trim()
      });
      return { success: 'List added.' };
    } catch (error) {
      return actionFailure(error, 'Could not add list.');
    }
  },

  deleteList: async ({ request, locals }) => {
    if (!locals.user) {
      throw redirect(303, '/');
    }
    try {
      const formData = await request.formData();
      await deleteUserCardList({
        userId: locals.user.id,
        id: String(formData.get('listId') || '').trim()
      });
      return { success: 'List deleted.' };
    } catch (error) {
      return actionFailure(error, 'Could not delete list.');
    }
  },

  saved: async ({ locals }) => {
    if (!locals.user) {
      return fail(401, {
        error: 'Sign in to compute matches from saved lists.'
      });
    }
    let matchesTraceId = normalizeTraceId(getTraceId());
    try {
      const output = await withSpan(
        'matches.saved.execute',
        {
          'matches.user_id': locals.user.id,
          'matches.username': locals.user.username
        },
        async (span) => {
          matchesTraceId = normalizeTraceId(getTraceId(span));
          const lists = await listAllUserCardLists(['buyer', 'seller']);
          span.setAttribute('matches.saved_list_count', lists.length);
          const result = await computeUserContactMatches({
            currentUserId: locals.user!.id,
            lists,
            headless: true
          });
          span.setAttribute('matches.sellers_to_contact_cards', result.sellersToContact.totals.matchedCards);
          span.setAttribute('matches.buyers_to_contact_cards', result.buyersToContact.totals.matchedCards);
          return result;
        }
      );
      return {
        accountOutput: output
      };
    } catch (error) {
      const traceId = matchesTraceId || normalizeTraceId(getTraceId());
      const appError = isAppError(error) ? error : null;
      console.error(
        `[matches] saved failed trace_id=${traceId || 'unavailable'} status=${appError?.httpStatusCode ?? 500} type=${appError?.errorTypeName ?? 'UnhandledSavedMatchError'} admin_error=${appError?.adminFacingError || getErrorMessage(error)}`,
        error
      );
      return fail(appError?.httpStatusCode ?? 500, {
        error: appError?.userFacingError || 'Could not compute saved-list matches.',
        traceId: traceId || undefined
      });
    }
  },

  adminSet: async ({ request, locals }) => {
    let selectedUserIds: string[] = [];
    let focusUserId = '';
    let matchesTraceId = normalizeTraceId(getTraceId());
    try {
      ensureAdmin(locals.user);
      const formData = await request.formData();
      selectedUserIds = uniqueStrings(formData.getAll('userIds').map((value) => String(value || '').trim()));
      focusUserId = String(formData.get('focusUserId') || '').trim();
      if (focusUserId && !selectedUserIds.includes(focusUserId)) {
        selectedUserIds.push(focusUserId);
      }
      if (selectedUserIds.length < 2) {
        return fail(400, {
          error: 'Select at least two people for an admin match compute.',
          selectedUserIds,
          adminFocusUserId: focusUserId || undefined
        });
      }

      const allLists = await listAllUserCardLists(['buyer', 'seller']);
      const lists = allLists.filter((list) => selectedUserIds.includes(list.userId));
      const buyerCount = lists.filter((list) => list.kind === 'buyer').length;
      const sellerCount = lists.filter((list) => list.kind === 'seller').length;
      if (!buyerCount || !sellerCount) {
        return fail(400, {
          error: 'The selected people need at least one looking-for list and one selling list.',
          selectedUserIds,
          adminFocusUserId: focusUserId || undefined
        });
      }

      if (focusUserId) {
        const focusLists = lists.filter((list) => list.userId === focusUserId);
        if (!focusLists.length) {
          return fail(400, {
            error: 'The selected "Search matches as" user has no saved lists.',
            selectedUserIds,
            adminFocusUserId: focusUserId
          });
        }

        const output = await withSpan(
          'matches.admin_set_as_user.execute',
          {
            'matches.admin_focus_user_id': focusUserId,
            'matches.admin_selected_user_count': selectedUserIds.length,
            'matches.admin_selected_user_ids': selectedUserIds.join(','),
            'matches.saved_list_count': lists.length,
            'matches.saved_buyer_list_count': buyerCount,
            'matches.saved_seller_list_count': sellerCount
          },
          async (span) => {
            matchesTraceId = normalizeTraceId(getTraceId(span));
            const result = await computeUserContactMatches({
              currentUserId: focusUserId,
              lists,
              headless: true
            });
            span.setAttribute('matches.sellers_to_contact_cards', result.sellersToContact.totals.matchedCards);
            span.setAttribute('matches.buyers_to_contact_cards', result.buyersToContact.totals.matchedCards);
            return result;
          }
        );

        return {
          adminContactOutput: output,
          selectedUserIds,
          adminFocusUserId: focusUserId
        };
      }

      const output = await withSpan(
        'matches.admin_set.execute',
        {
          'matches.admin_selected_user_count': selectedUserIds.length,
          'matches.admin_selected_user_ids': selectedUserIds.join(','),
          'matches.saved_list_count': lists.length,
          'matches.saved_buyer_list_count': buyerCount,
          'matches.saved_seller_list_count': sellerCount
        },
        async (span) => {
          matchesTraceId = normalizeTraceId(getTraceId(span));
          const result = await computeSavedCardListMatches({
            lists,
            headless: true
          });
          span.setAttribute('matches.matched_cards', result.totals.matchedCards);
          span.setAttribute('matches.matched_quantity', result.totals.matchedQuantity);
          return result;
        }
      );

      return {
        adminOutput: output,
        selectedUserIds,
        adminFocusUserId: undefined
      };
    } catch (error) {
      const traceId = matchesTraceId || normalizeTraceId(getTraceId());
      const appError = isAppError(error) ? error : null;
      console.error(
        `[matches] admin set failed trace_id=${traceId || 'unavailable'} status=${appError?.httpStatusCode ?? 500} type=${appError?.errorTypeName ?? 'UnhandledAdminSetMatchError'} admin_error=${appError?.adminFacingError || getErrorMessage(error)}`,
        error
      );
      return fail(appError?.httpStatusCode ?? 500, {
        error: appError?.userFacingError || 'Could not compute admin matches.',
        traceId: traceId || undefined,
        selectedUserIds,
        adminFocusUserId: focusUserId || undefined
      });
    }
  }
};

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message || '';
  }
  if (typeof error === 'string') {
    return error;
  }
  return '';
}

function normalizeTraceId(value: string | null | undefined): string | null {
  const candidate = String(value || '').trim();
  if (/^[0-9a-f]{32}$/.test(candidate) && !/^0+$/.test(candidate)) {
    return candidate;
  }
  return null;
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function actionFailure(error: unknown, fallback: string) {
  const appError = isAppError(error) ? error : null;
  return fail(appError?.httpStatusCode ?? 500, {
    error: appError?.userFacingError || fallback
  });
}
