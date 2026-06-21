import { randomUUID } from 'node:crypto';

import { and, eq, inArray } from 'drizzle-orm';

import { normalizeSupportedCardListUrl } from '../adapters/card-list-source';
import { AppError } from './app-error';
import { getWriteDb } from './db';
import { userCardLists, users } from './db-schema';

export type UserCardListKind = 'buyer' | 'seller';

export interface SavedUserCardList {
  id: string;
  userId: string;
  username: string;
  displayName: string | null;
  kind: UserCardListKind;
  label: string | null;
  url: string;
  position: number;
  createdAt: Date;
  updatedAt: Date;
}

export function parseListKind(value: string): UserCardListKind {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'buyer' || normalized === 'seller') {
    return normalized;
  }
  throw new AppError({
    userFacingError: 'List kind must be buyer or seller.',
    adminFacingError: `Invalid user card list kind: ${value}`,
    errorTypeName: 'UserCardListKindInvalidError',
    httpStatusCode: 400
  });
}

export async function listUserCardLists(userId: string): Promise<SavedUserCardList[]> {
  const rows = await getWriteDb()
    .select({
      id: userCardLists.id,
      userId: userCardLists.userId,
      username: users.username,
      displayName: users.displayName,
      kind: userCardLists.kind,
      label: userCardLists.label,
      url: userCardLists.url,
      position: userCardLists.position,
      createdAt: userCardLists.createdAt,
      updatedAt: userCardLists.updatedAt
    })
    .from(userCardLists)
    .innerJoin(users, eq(users.id, userCardLists.userId))
    .where(eq(userCardLists.userId, userId))
    .orderBy(userCardLists.kind, userCardLists.position, userCardLists.createdAt);
  return rows.map(rowToSavedList);
}

export async function listAllUserCardLists(kinds?: UserCardListKind[]): Promise<SavedUserCardList[]> {
  const conditions = kinds?.length ? inArray(userCardLists.kind, kinds) : undefined;
  const query = getWriteDb()
    .select({
      id: userCardLists.id,
      userId: userCardLists.userId,
      username: users.username,
      displayName: users.displayName,
      kind: userCardLists.kind,
      label: userCardLists.label,
      url: userCardLists.url,
      position: userCardLists.position,
      createdAt: userCardLists.createdAt,
      updatedAt: userCardLists.updatedAt
    })
    .from(userCardLists)
    .innerJoin(users, eq(users.id, userCardLists.userId))
    .orderBy(users.username, userCardLists.kind, userCardLists.position, userCardLists.createdAt);
  const rows = conditions ? await query.where(conditions) : await query;
  return rows.map(rowToSavedList);
}

export async function createUserCardList(input: {
  userId: string;
  kind: UserCardListKind;
  url: string;
  label?: string | null;
}): Promise<SavedUserCardList> {
  const kind = parseListKind(input.kind);
  const url = String(input.url || '').trim();
  if (!url) {
    throw new AppError({
      userFacingError: 'List URL is required.',
      adminFacingError: 'User card list URL is empty.',
      errorTypeName: 'UserCardListUrlMissingError',
      httpStatusCode: 400
    });
  }
  const normalizedUrl = normalizeSupportedCardListUrl(url).normalizedUrl;

  const now = new Date();
  const positionRows = await getWriteDb()
    .select({ position: userCardLists.position })
    .from(userCardLists)
    .where(and(eq(userCardLists.userId, input.userId), eq(userCardLists.kind, kind)))
    .orderBy(userCardLists.position);
  const position = positionRows.reduce((max, row) => Math.max(max, row.position), -1) + 1;
  const [created] = await getWriteDb()
    .insert(userCardLists)
    .values({
      id: randomUUID(),
      userId: input.userId,
      kind,
      url: normalizedUrl,
      label: input.label?.trim() || null,
      position,
      createdAt: now,
      updatedAt: now
    })
    .returning();
  const user = await getWriteDb().query.users.findFirst({ where: eq(users.id, created.userId) });
  if (!user) {
    throw new AppError({
      userFacingError: 'User not found.',
      adminFacingError: `Created list references missing user=${created.userId}`,
      errorTypeName: 'UserNotFoundError',
      httpStatusCode: 404
    });
  }
  return rowToSavedList({ ...created, username: user.username, displayName: user.displayName });
}

export async function deleteUserCardList(input: { userId: string; id: string }): Promise<void> {
  await getWriteDb()
    .delete(userCardLists)
    .where(and(eq(userCardLists.userId, input.userId), eq(userCardLists.id, input.id)));
}

function rowToSavedList(row: {
  id: string;
  userId: string;
  username: string;
  displayName: string | null;
  kind: string;
  label: string | null;
  url: string;
  position: number;
  createdAt: Date;
  updatedAt: Date;
}): SavedUserCardList {
  return {
    id: row.id,
    userId: row.userId,
    username: row.username,
    displayName: row.displayName,
    kind: parseListKind(row.kind),
    label: row.label,
    url: row.url,
    position: row.position,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}
