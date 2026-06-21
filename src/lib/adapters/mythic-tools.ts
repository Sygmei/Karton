import { createHash } from 'node:crypto';

import { AppError } from '../server/app-error';
import type { CardList, CardMap } from '../server/types';
import { DEFAULT_USER_AGENT } from '../server/utils';

interface FetchMythicToolsOptions {
  timeoutMs?: number;
}

const MYTHIC_ALLOWED_HOSTS = new Set(['mythic.tools', 'www.mythic.tools']);
const MYTHIC_API_BASE = 'https://api.mythic.tools';
const MYTHIC_SIGNATURE_SLUG_1 = 'mythic_sloot';
const MYTHIC_SIGNATURE_SLUG_2 = 'cihtym_tools';
const SHORT_ID_ALPHABET = '23456789abcdefghijkmnpqrstuvwyzABCDEFGHJKLMNPQRSTUVWYZ';
const SHORT_ID_BASE = SHORT_ID_ALPHABET.length;
const SHORT_ID_SEPARATOR = 'X';
const SHORT_ID_MOD = 2147483647n;
const SHORT_ID_INVERSE = 1989098352n;
const MYTHIC_API_MAX_ATTEMPTS = 3;
const MYTHIC_API_RETRY_DELAY_MS = 500;

export function normalizeMythicToolsListUrl(value: string): string {
  const input = String(value || '').trim();
  if (!input) {
    throw new AppError({
      userFacingError: 'Mythic Tools list URL is required.',
      adminFacingError: 'Mythic Tools URL is empty.',
      errorTypeName: 'MythicToolsUrlMissingError',
      httpStatusCode: 400
    });
  }

  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(input) ? input : `https://${input}`;
  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    throw new AppError({
      userFacingError: 'Invalid Mythic Tools URL. Use mythic.tools/user/<id>/collection/list/<listId>.',
      adminFacingError: `Invalid Mythic Tools URL parse failure: ${value}`,
      errorTypeName: 'MythicToolsUrlInvalidError',
      httpStatusCode: 400
    });
  }

  const host = parsed.hostname.toLowerCase();
  if (!MYTHIC_ALLOWED_HOSTS.has(host)) {
    throw new AppError({
      userFacingError: 'Invalid Mythic Tools URL host. Use mythic.tools.',
      adminFacingError: `Invalid Mythic Tools host: ${parsed.hostname}`,
      errorTypeName: 'MythicToolsHostInvalidError',
      httpStatusCode: 400
    });
  }

  const ids = extractMythicToolsListIds(parsed.pathname, value);
  return `https://mythic.tools/user/${ids.encodedUserId}/collection/list/${ids.encodedListId}`;
}

export async function fetchMythicToolsList(
  value: string,
  options: FetchMythicToolsOptions = {}
): Promise<CardList> {
  const normalizedUrl = normalizeMythicToolsListUrl(value);
  const ids = extractMythicToolsListIds(new URL(normalizedUrl).pathname, normalizedUrl);
  const timeoutMs = options.timeoutMs ?? 20_000;
  const list = await fetchAllMythicToolsPages(ids.numericUserId, ids.numericListId, timeoutMs);

  return {
    source: 'mythic-tools',
    listId: ids.encodedListId,
    name: String(list.name || `Mythic Tools ${ids.encodedListId}`).trim(),
    url: normalizedUrl,
    cards: extractMythicToolsCards(list)
  };
}

function extractMythicToolsListIds(
  pathname: string,
  rawInput: string
): { encodedUserId: string; encodedListId: string; numericUserId: number; numericListId: number } {
  const match = /^\/user\/([^/]+)\/collection\/list\/([^/]+)/.exec(pathname);
  if (!match?.[1] || !match?.[2]) {
    throw new AppError({
      userFacingError: 'Invalid Mythic Tools URL. Use mythic.tools/user/<id>/collection/list/<listId>.',
      adminFacingError: `Could not parse Mythic Tools list ids from: ${rawInput}`,
      errorTypeName: 'MythicToolsListIdParseError',
      httpStatusCode: 400
    });
  }

  const numericUserId = decodeShortId(match[1]);
  const numericListId = decodeShortId(match[2]);
  if (!numericUserId || !numericListId) {
    throw new AppError({
      userFacingError: 'Invalid Mythic Tools short id in URL.',
      adminFacingError: `Could not decode Mythic Tools ids user=${match[1]} list=${match[2]}`,
      errorTypeName: 'MythicToolsShortIdDecodeError',
      httpStatusCode: 400
    });
  }

  return {
    encodedUserId: match[1],
    encodedListId: match[2],
    numericUserId,
    numericListId
  };
}

function decodeShortId(value: string): number {
  const token = value.split(SHORT_ID_SEPARATOR)[0];
  let decoded = 0;
  for (const char of token) {
    const index = SHORT_ID_ALPHABET.indexOf(char);
    if (index < 0) {
      break;
    }
    decoded = decoded * SHORT_ID_BASE + index;
  }
  return Number((BigInt(decoded) * SHORT_ID_INVERSE) % SHORT_ID_MOD);
}

async function fetchAllMythicToolsPages(
  userId: number,
  listId: number,
  timeoutMs: number
): Promise<Record<string, unknown>> {
  const cards: Record<string, unknown>[] = [];
  let listPayload: Record<string, unknown> | null = null;
  let page = 1;
  let totalPages = 1;

  while (page <= totalPages && page <= 100) {
    const payload = await fetchMythicToolsPage(userId, listId, page, timeoutMs);
    const list = getRecord(payload.list) || payload;
    if (!listPayload) {
      listPayload = { ...list };
    }
    cards.push(...extractPageCards(list));
    const pagination = getRecord(payload.pagination) || getRecord(list.pagination);
    totalPages = Math.max(1, Math.min(100, Number(pagination?.total_pages || pagination?.totalPages || 1) || 1));
    page += 1;
  }

  if (!listPayload) {
    throw new AppError({
      userFacingError: 'Could not fetch this Mythic Tools list. Verify that it is public or unlisted.',
      adminFacingError: `Mythic Tools list fetch returned no list user=${userId} list=${listId}`,
      errorTypeName: 'MythicToolsListFetchEmptyError',
      httpStatusCode: 422
    });
  }

  return { ...listPayload, cards };
}

async function fetchMythicToolsPage(
  userId: number,
  listId: number,
  page: number,
  timeoutMs: number
): Promise<Record<string, unknown>> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= MYTHIC_API_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await fetchMythicToolsPageAttempt(userId, listId, page, timeoutMs, attempt);
    } catch (error) {
      lastError = error;
      if (attempt >= MYTHIC_API_MAX_ATTEMPTS || !shouldRetryMythicToolsPageError(error)) {
        throw error;
      }
      await delay(MYTHIC_API_RETRY_DELAY_MS * attempt);
    }
  }
  throw lastError;
}

async function fetchMythicToolsPageAttempt(
  userId: number,
  listId: number,
  page: number,
  timeoutMs: number,
  attempt: number
): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const url = new URL(`${MYTHIC_API_BASE}/user/${userId}/list/${listId}`);
  url.searchParams.set('limit', '250');
  url.searchParams.set('page', String(page));
  url.searchParams.set('order_by', 'added_at');
  url.searchParams.set('order_direction', 'asc');
  url.searchParams.set('ignore_basic_lands', 'true');
  url.searchParams.set('marketplace', 'mythictools');

  try {
    const timestamp = Date.now();
    const apiKey = getRequiredMythicToolsSecret('MYTHIC_TOOLS_API_KEY');
    const webKey = getRequiredMythicToolsSecret('MYTHIC_TOOLS_WEB_KEY');
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'user-agent': process.env.MOXFIELD_USER_AGENT?.trim() || DEFAULT_USER_AGENT,
        origin: 'https://mythic.tools',
        referer: 'https://mythic.tools/',
        'x-api-key': apiKey,
        'x-app-locale': 'en',
        'x-mythic-device': 'web',
        'x-mythic-signature': createMythicSignature(timestamp, webKey),
        'x-mythic-timestamp': String(timestamp)
      },
      signal: controller.signal
    });
    if (!response.ok) {
      throw new AppError({
        userFacingError: 'Could not fetch this Mythic Tools list. Verify that it is public or unlisted.',
        adminFacingError: `Mythic Tools API fetch failed status=${response.status} url=${url.toString()} attempt=${attempt}`,
        errorTypeName: 'MythicToolsListFetchError',
        httpStatusCode: mythicToolsErrorStatusCode(response.status)
      });
    }
    const payload = (await response.json()) as unknown;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new AppError({
        userFacingError: 'Mythic Tools returned an unexpected response.',
        adminFacingError: `Mythic Tools API returned invalid payload for url=${url.toString()} attempt=${attempt}`,
        errorTypeName: 'MythicToolsListPayloadError',
        httpStatusCode: 422
      });
    }
    return payload as Record<string, unknown>;
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError({
      userFacingError: 'Could not fetch this Mythic Tools list. Verify that it is public or unlisted.',
      adminFacingError: `Mythic Tools API request failed url=${url.toString()} attempt=${attempt} cause=${error instanceof Error ? error.message : String(error)}`,
      errorTypeName: 'MythicToolsListRequestError',
      httpStatusCode: 422,
      cause: error
    });
  } finally {
    clearTimeout(timer);
  }
}

function shouldRetryMythicToolsPageError(error: unknown): boolean {
  if (!(error instanceof AppError)) {
    return true;
  }
  return (
    error.errorTypeName === 'MythicToolsListRequestError' ||
    error.httpStatusCode === 429 ||
    error.httpStatusCode >= 500
  );
}

function mythicToolsErrorStatusCode(status: number): number {
  if (status === 404) {
    return 404;
  }
  if (status === 429) {
    return 429;
  }
  if (status >= 500) {
    return 502;
  }
  return 422;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getRequiredMythicToolsSecret(name: 'MYTHIC_TOOLS_API_KEY' | 'MYTHIC_TOOLS_WEB_KEY'): string {
  const value = process.env[name]?.trim();
  if (value) {
    return value;
  }

  throw new AppError({
    userFacingError: 'Mythic Tools import is not configured yet.',
    adminFacingError: `Missing required Mythic Tools environment variable: ${name}`,
    errorTypeName: 'MythicToolsConfigMissingError',
    httpStatusCode: 500
  });
}

function createMythicSignature(timestamp: number, webKey: string): string {
  return createHash('sha256')
    .update(`${MYTHIC_SIGNATURE_SLUG_1}+/${timestamp}.${webKey}/+${MYTHIC_SIGNATURE_SLUG_2}!`)
    .digest('hex');
}

function extractMythicToolsCards(list: Record<string, unknown>): CardMap {
  const cards: CardMap = {};
  for (const entry of extractPageCards(list)) {
    const name = extractCardName(entry);
    const quantity = extractQuantity(entry);
    if (!name || quantity <= 0) {
      continue;
    }
    cards[name] = (cards[name] || 0) + quantity;
  }

  if (!Object.keys(cards).length) {
    throw new AppError({
      userFacingError: 'Could not extract cards from this Mythic Tools list.',
      adminFacingError: `No cards parsed from Mythic Tools list payload name=${String(list.name || '')}`,
      errorTypeName: 'MythicToolsCardsMissingError',
      httpStatusCode: 422
    });
  }

  return cards;
}

function extractPageCards(list: Record<string, unknown>): Record<string, unknown>[] {
  const candidates = [list.cards, list.grouped_cards, list.groupedCards];
  const cards: Record<string, unknown>[] = [];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      for (const item of candidate) {
        const record = getRecord(item);
        if (!record) {
          continue;
        }
        if (Array.isArray(record.cards)) {
          cards.push(...record.cards.filter(isRecord));
        } else {
          cards.push(record);
        }
      }
    }
  }
  return cards;
}

function extractQuantity(entry: Record<string, unknown>): number {
  const values = [entry.quantity, entry.qty, entry.count, entry.amount];
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.trunc(parsed);
    }
  }
  return 1;
}

function extractCardName(entry: Record<string, unknown>): string {
  const candidates = [
    entry.name,
    entry.printed_name,
    entry.card_name,
    getRecord(entry.card)?.name,
    getRecord(entry.card)?.printed_name
  ];

  for (const candidate of candidates) {
    const name = String(candidate || '').trim();
    if (name) {
      return name;
    }
  }
  return '';
}

function getRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
