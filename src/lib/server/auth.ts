import { randomBytes, randomUUID } from 'node:crypto';

import { and, eq, gt, isNull, or } from 'drizzle-orm';
import type { Cookies } from '@sveltejs/kit';

import { AppError } from './app-error';
import { getWriteDb } from './db';
import { userLoginLinks, userSessions, users } from './db-schema';

export const SESSION_COOKIE_NAME = 'mtg_meta_session';
export const LOGIN_LINK_TTL_MINUTES = 5;

export type UserRole = 'superadmin' | 'admin' | 'user';

export interface AppUser {
  id: string;
  username: string;
  displayName: string | null;
  role: UserRole;
  isSuperadmin: boolean;
  createdAt: Date;
  createdByUserId: string | null;
}

export interface CreatedLoginLink {
  connectionUrl: string;
  expiresAt: Date;
}

export function normalizeUsername(value: string): string {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!normalized || normalized.length < 2 || normalized.length > 48) {
    throw new AppError({
      userFacingError: 'Username must be 2 to 48 characters and use letters, numbers, dots, dashes, or underscores.',
      adminFacingError: `Invalid username: ${value}`,
      errorTypeName: 'UsernameInvalidError',
      httpStatusCode: 400
    });
  }
  return normalized;
}

export function parseUserRole(value: string): UserRole {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'superadmin' || normalized === 'admin' || normalized === 'user') {
    return normalized;
  }
  throw new AppError({
    userFacingError: 'Unknown user role.',
    adminFacingError: `Invalid user role: ${value}`,
    errorTypeName: 'UserRoleInvalidError',
    httpStatusCode: 400
  });
}

export function canManageUsers(user: AppUser | null | undefined): boolean {
  return user?.role === 'superadmin' || user?.role === 'admin';
}

export function canCreateRole(auth: AppUser, role: UserRole): boolean {
  if (role === 'superadmin') {
    return false;
  }
  if (auth.role === 'superadmin') {
    return role === 'admin' || role === 'user';
  }
  if (auth.role === 'admin') {
    return role === 'user';
  }
  return false;
}

export function ensureAdmin(user: AppUser | null | undefined): AppUser {
  if (!user || !canManageUsers(user)) {
    throw new AppError({
      userFacingError: 'Admin access is required.',
      adminFacingError: 'Missing admin user context.',
      errorTypeName: 'AdminAccessRequiredError',
      httpStatusCode: 401
    });
  }
  return user;
}

export async function ensureSuperadminUser(username = process.env.SUPERADMIN_USERNAME || 'superadmin'): Promise<AppUser> {
  const db = getWriteDb();
  const existing = await db.query.users.findFirst({
    where: or(eq(users.role, 'superadmin'), eq(users.isSuperadmin, true))
  });
  if (existing) {
    return rowToUser(existing);
  }

  const normalizedUsername = normalizeUsername(username);
  const existingUsername = await findUserByUsername(normalizedUsername);
  const finalUsername = existingUsername ? `${normalizedUsername}-${generateAuthToken(6).toLowerCase()}` : normalizedUsername;
  const [created] = await db
    .insert(users)
    .values({
      id: randomUUID(),
      username: finalUsername,
      role: 'superadmin',
      isSuperadmin: true
    })
    .returning();

  return rowToUser(created);
}

export async function findUserById(id: string): Promise<AppUser | null> {
  const row = await getWriteDb().query.users.findFirst({ where: eq(users.id, id) });
  return row ? rowToUser(row) : null;
}

export async function findUserByUsername(username: string): Promise<AppUser | null> {
  const row = await getWriteDb().query.users.findFirst({ where: eq(users.username, username) });
  return row ? rowToUser(row) : null;
}

export async function findUserByLookup(lookup: string): Promise<AppUser | null> {
  const value = String(lookup || '').trim();
  if (!value) {
    return null;
  }
  return (await findUserByUsername(value)) || (await findUserById(value));
}

export async function listUsers(): Promise<AppUser[]> {
  const rows = await getWriteDb().query.users.findMany({
    orderBy: (table, { asc }) => [asc(table.username)]
  });
  return rows.map(rowToUser);
}

export async function createUser(input: {
  username: string;
  role: UserRole;
  createdBy: AppUser;
  displayName?: string | null;
}): Promise<AppUser> {
  const username = normalizeUsername(input.username);
  const role = parseUserRole(input.role);
  if (!canCreateRole(input.createdBy, role)) {
    throw new AppError({
      userFacingError: 'You are not allowed to create that role.',
      adminFacingError: `User ${input.createdBy.id} cannot create role=${role}`,
      errorTypeName: 'UserRoleCreationForbiddenError',
      httpStatusCode: 401
    });
  }
  if (await findUserByUsername(username)) {
    throw new AppError({
      userFacingError: 'That username already exists.',
      adminFacingError: `Duplicate username: ${username}`,
      errorTypeName: 'UsernameConflictError',
      httpStatusCode: 409
    });
  }

  const [created] = await getWriteDb()
    .insert(users)
    .values({
      id: randomUUID(),
      username,
      role,
      isSuperadmin: false,
      displayName: input.displayName?.trim() || null,
      createdByUserId: input.createdBy.id
    })
    .returning();
  return rowToUser(created);
}

export async function deleteUser(targetId: string, auth: AppUser): Promise<void> {
  const target = await findUserById(targetId);
  if (!target) {
    throw new AppError({
      userFacingError: 'User not found.',
      adminFacingError: `Delete user missing id=${targetId}`,
      errorTypeName: 'UserNotFoundError',
      httpStatusCode: 404
    });
  }
  if (target.id === auth.id || target.role === 'superadmin') {
    throw new AppError({
      userFacingError: 'This account cannot be deleted.',
      adminFacingError: `Forbidden delete target=${target.id} requester=${auth.id}`,
      errorTypeName: 'UserDeleteForbiddenError',
      httpStatusCode: 400
    });
  }
  if (auth.role !== 'superadmin' && target.role !== 'user') {
    throw new AppError({
      userFacingError: 'Admins can only delete standard users.',
      adminFacingError: `Admin ${auth.id} tried to delete role=${target.role}`,
      errorTypeName: 'UserDeleteRoleForbiddenError',
      httpStatusCode: 401
    });
  }
  await getWriteDb().delete(users).where(eq(users.id, target.id));
}

export async function updateUserDisplayName(input: { userId: string; displayName: string | null }): Promise<AppUser> {
  const value = input.displayName?.trim() || null;
  const [updated] = await getWriteDb()
    .update(users)
    .set({ displayName: value })
    .where(eq(users.id, input.userId))
    .returning();
  if (!updated) {
    throw new AppError({
      userFacingError: 'User not found.',
      adminFacingError: `Display name update missing user=${input.userId}`,
      errorTypeName: 'UserNotFoundError',
      httpStatusCode: 404
    });
  }
  return rowToUser(updated);
}

export async function createLoginLink(input: {
  userId: string;
  baseUrl: string;
  ttlMinutes?: number;
}): Promise<CreatedLoginLink> {
  const user = await findUserById(input.userId);
  if (!user) {
    throw new AppError({
      userFacingError: 'User not found.',
      adminFacingError: `Login link target missing user=${input.userId}`,
      errorTypeName: 'UserNotFoundError',
      httpStatusCode: 404
    });
  }

  const ttlMinutes = input.ttlMinutes ?? LOGIN_LINK_TTL_MINUTES;
  const token = generateAuthToken(48);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlMinutes * 60_000);
  await getWriteDb().insert(userLoginLinks).values({
    id: randomUUID(),
    userId: user.id,
    token,
    createdAt: now,
    expiresAt
  });

  const baseUrl = input.baseUrl.replace(/\/+$/, '');
  return {
    connectionUrl: `${baseUrl}/connect/${encodeURIComponent(token)}`,
    expiresAt
  };
}

export async function consumeLoginToken(token: string): Promise<{ user: AppUser; sessionToken: string }> {
  const trimmed = String(token || '').trim();
  if (!trimmed) {
    throw new AppError({
      userFacingError: 'Missing login token.',
      adminFacingError: 'Empty login token.',
      errorTypeName: 'LoginTokenMissingError',
      httpStatusCode: 400
    });
  }

  const now = new Date();
  const db = getWriteDb();
  const [link] = await db
    .update(userLoginLinks)
    .set({ consumedAt: now })
    .where(and(eq(userLoginLinks.token, trimmed), isNull(userLoginLinks.consumedAt), gt(userLoginLinks.expiresAt, now)))
    .returning();
  if (!link) {
    throw new AppError({
      userFacingError: 'This login link is invalid or expired.',
      adminFacingError: `Invalid or expired login token.`,
      errorTypeName: 'LoginTokenInvalidError',
      httpStatusCode: 401
    });
  }

  const user = await findUserById(link.userId);
  if (!user) {
    throw new AppError({
      userFacingError: 'User not found.',
      adminFacingError: `Login token points to missing user=${link.userId}`,
      errorTypeName: 'UserNotFoundError',
      httpStatusCode: 404
    });
  }

  const sessionToken = generateAuthToken(64);
  await db.insert(userSessions).values({
    id: randomUUID(),
    userId: user.id,
    sessionToken,
    createdAt: now,
    expiresAt: null
  });
  return { user, sessionToken };
}

export async function resolveSessionUser(cookies: Cookies): Promise<AppUser | null> {
  const sessionToken = cookies.get(SESSION_COOKIE_NAME)?.trim();
  if (!sessionToken) {
    return null;
  }
  const now = new Date();
  const [row] = await getWriteDb()
    .select({ user: users })
    .from(userSessions)
    .innerJoin(users, eq(users.id, userSessions.userId))
    .where(and(eq(userSessions.sessionToken, sessionToken), or(isNull(userSessions.expiresAt), gt(userSessions.expiresAt, now))))
    .limit(1);
  if (!row) {
    cookies.delete(SESSION_COOKIE_NAME, { path: '/' });
    return null;
  }
  return rowToUser(row.user);
}

export async function logout(cookies: Cookies): Promise<void> {
  const sessionToken = cookies.get(SESSION_COOKIE_NAME)?.trim();
  if (sessionToken) {
    await getWriteDb().delete(userSessions).where(eq(userSessions.sessionToken, sessionToken));
  }
  cookies.delete(SESSION_COOKIE_NAME, { path: '/' });
}

export function setSessionCookie(cookies: Cookies, sessionToken: string, url?: URL): void {
  cookies.set(SESSION_COOKIE_NAME, sessionToken, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: url ? url.protocol === 'https:' : true,
    maxAge: 60 * 60 * 24 * 365
  });
}

export function userToJson(user: AppUser): Record<string, unknown> {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    isSuperadmin: user.isSuperadmin,
    createdAt: user.createdAt.toISOString(),
    createdByUserId: user.createdByUserId
  };
}

function rowToUser(row: typeof users.$inferSelect): AppUser {
  return {
    id: row.id,
    username: row.username,
    displayName: row.displayName ?? null,
    role: parseUserRole(row.role),
    isSuperadmin: row.isSuperadmin,
    createdAt: row.createdAt,
    createdByUserId: row.createdByUserId ?? null
  };
}

function generateAuthToken(byteLength: number): string {
  return randomBytes(byteLength).toString('base64url');
}
