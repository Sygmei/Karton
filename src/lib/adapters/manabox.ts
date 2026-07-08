import { load } from 'cheerio';

import { AppError } from '../server/app-error';
import type { CardList, CardMap, InputDeck } from '../server/types';
import { DEFAULT_USER_AGENT } from '../server/utils';

interface FetchManaBoxOptions {
  timeoutMs?: number;
}

const MANABOX_ALLOWED_HOSTS = new Set(['manabox.app', 'www.manabox.app']);
const MANABOX_COMMANDER_CATEGORIES = new Set([0, 1, 2, 'commander', 'oathbreaker', 'signaturespell', 'signature_spell']);
const MANABOX_EXCLUDED_LIST_CATEGORIES = new Set([4, 5, 'sideboard', 'maybeboard']);

export function normalizeManaBoxDeckUrl(value: string): string {
  const input = String(value || '').trim();
  if (!input) {
    throw new AppError({
      userFacingError: 'ManaBox URL is required.',
      adminFacingError: 'ManaBox URL is empty.',
      errorTypeName: 'ManaBoxUrlMissingError',
      httpStatusCode: 400
    });
  }

  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(input) ? input : `https://${input}`;
  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    throw new AppError({
      userFacingError: 'Invalid ManaBox URL. Use manabox.app/decks/<id>.',
      adminFacingError: `Invalid ManaBox URL parse failure: ${value}`,
      errorTypeName: 'ManaBoxUrlInvalidError',
      httpStatusCode: 400
    });
  }

  const host = parsed.hostname.toLowerCase();
  if (!MANABOX_ALLOWED_HOSTS.has(host)) {
    throw new AppError({
      userFacingError: 'Invalid ManaBox URL host. Use manabox.app.',
      adminFacingError: `Invalid ManaBox host: ${parsed.hostname}`,
      errorTypeName: 'ManaBoxHostInvalidError',
      httpStatusCode: 400
    });
  }

  const deckId = extractManaBoxDeckIdFromPath(parsed.pathname, value);
  return `https://manabox.app/decks/${deckId}`;
}

export function extractManaBoxDeckId(deckUrl: string): string {
  const normalized = normalizeManaBoxDeckUrl(deckUrl);
  return extractManaBoxDeckIdFromPath(new URL(normalized).pathname, normalized);
}

export async function fetchManaBoxDeck(value: string, options: FetchManaBoxOptions = {}): Promise<InputDeck> {
  const normalizedDeckUrl = normalizeManaBoxDeckUrl(value);
  const deckId = extractManaBoxDeckId(normalizedDeckUrl);
  const html = await fetchManaBoxDeckHtml(normalizedDeckUrl, options.timeoutMs ?? 20_000);
  const payload = extractManaBoxDeckPayload(html, deckId, normalizedDeckUrl);
  const parsed = parseManaBoxDeckPayload(payload, {
    deckId,
    normalizedDeckUrl,
    requireCommander: true
  });

  return {
    source: 'manabox',
    deckId,
    name: parsed.name,
    url: normalizedDeckUrl,
    commanders: parsed.commanders,
    cards: parsed.cards
  };
}

export async function fetchManaBoxCardList(value: string, options: FetchManaBoxOptions = {}): Promise<CardList> {
  const normalizedDeckUrl = normalizeManaBoxDeckUrl(value);
  const deckId = extractManaBoxDeckId(normalizedDeckUrl);
  const html = await fetchManaBoxDeckHtml(normalizedDeckUrl, options.timeoutMs ?? 20_000);
  const payload = extractManaBoxDeckPayload(html, deckId, normalizedDeckUrl);
  const parsed = parseManaBoxDeckPayload(payload, {
    deckId,
    normalizedDeckUrl,
    requireCommander: false
  });

  return {
    source: 'manabox',
    listId: deckId,
    name: parsed.name,
    url: normalizedDeckUrl,
    cards: parsed.cards
  };
}

async function fetchManaBoxDeckHtml(url: string, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'user-agent': process.env.MOXFIELD_USER_AGENT?.trim() || DEFAULT_USER_AGENT,
        accept: 'text/html,application/xhtml+xml'
      },
      signal: controller.signal
    });
    if (!response.ok) {
      throw new AppError({
        userFacingError: 'Could not fetch this ManaBox deck. Verify the URL and that the deck is public.',
        adminFacingError: `ManaBox deck fetch failed url=${url} status=${response.status}`,
        errorTypeName: 'ManaBoxDeckFetchError',
        httpStatusCode: response.status === 404 ? 404 : 422
      });
    }
    return await response.text();
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError({
      userFacingError: 'Could not fetch this ManaBox deck. Verify the URL and that the deck is public.',
      adminFacingError: `ManaBox deck request failed url=${url} cause=${error instanceof Error ? error.message : String(error)}`,
      errorTypeName: 'ManaBoxDeckRequestError',
      httpStatusCode: 422,
      cause: error
    });
  } finally {
    clearTimeout(timer);
  }
}

function extractManaBoxDeckPayload(html: string, deckId: string, normalizedDeckUrl: string): Record<string, unknown> {
  const $ = load(html);
  const title = $('title').first().text().trim();
  const pageText = $('body').text().replace(/\s+/g, ' ').trim();
  if (/does not exist|has been removed/i.test(pageText)) {
    throw new AppError({
      userFacingError: 'This ManaBox deck does not exist or has been removed.',
      adminFacingError: `ManaBox deck missing deck=${deckId} url=${normalizedDeckUrl} title=${title}`,
      errorTypeName: 'ManaBoxDeckMissingError',
      httpStatusCode: 404
    });
  }

  for (const island of $('astro-island').toArray()) {
    const props = $(island).attr('props');
    if (!props) {
      continue;
    }
    const parsed = parseAstroProps(props);
    const deck = findDeckLikePayload(parsed);
    if (deck) {
      return deck;
    }
  }

  throw new AppError({
    userFacingError: 'Could not extract this ManaBox deck. Verify the URL and that the deck is public.',
    adminFacingError: `No ManaBox deck payload found deck=${deckId} url=${normalizedDeckUrl} title=${title}`,
    errorTypeName: 'ManaBoxDeckExtractionError',
    httpStatusCode: 422
  });
}

function parseManaBoxDeckPayload(
  payload: Record<string, unknown>,
  context: { deckId: string; normalizedDeckUrl: string; requireCommander: boolean }
): { name: string; commanders: string[]; cards: CardMap } {
  const cardsPayload = Array.isArray(payload.cards) ? payload.cards.filter(isRecord) : [];
  const cards: CardMap = {};
  const commanders: string[] = [];
  const commanderSeen = new Set<string>();

  for (const entry of cardsPayload) {
    const quantity = safeInt(entry.quantity ?? entry.count ?? entry.qty);
    const name = extractManaBoxCardName(entry);
    if (quantity <= 0 || !name) {
      continue;
    }

    const category = normalizeBoardCategory(entry.boardCategory ?? entry.board_category ?? entry.category);
    if (!MANABOX_EXCLUDED_LIST_CATEGORIES.has(category)) {
      cards[name] = (cards[name] || 0) + quantity;
    }
    if (MANABOX_COMMANDER_CATEGORIES.has(category) && !commanderSeen.has(name)) {
      commanderSeen.add(name);
      commanders.push(name);
    }
  }

  if (!Object.keys(cards).length) {
    throw new AppError({
      userFacingError: 'Could not extract cards from this ManaBox deck.',
      adminFacingError: `No card entries parsed for ManaBox deck ${context.deckId} (${context.normalizedDeckUrl})`,
      errorTypeName: 'ManaBoxDeckCardsMissingError',
      httpStatusCode: 422
    });
  }

  if (context.requireCommander && !commanders.length) {
    throw new AppError({
      userFacingError: 'Could not detect a commander in this ManaBox deck.',
      adminFacingError: `Commander detection failed for ManaBox deck ${context.deckId}`,
      errorTypeName: 'ManaBoxCommanderMissingError',
      httpStatusCode: 422
    });
  }

  return {
    name: String(payload.name || payload.title || `ManaBox Deck ${context.deckId}`).trim(),
    commanders,
    cards
  };
}

function parseAstroProps(rawProps: string): unknown {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawProps);
  } catch (error) {
    throw new AppError({
      userFacingError: 'ManaBox returned an unexpected deck response.',
      adminFacingError: `ManaBox Astro props JSON parse failed cause=${error instanceof Error ? error.message : String(error)}`,
      errorTypeName: 'ManaBoxPropsParseError',
      httpStatusCode: 422,
      cause: error
    });
  }

  return deserializeAstroValue(parsed);
}

function deserializeAstroValue(value: unknown): unknown {
  if (!Array.isArray(value) || value.length !== 2 || typeof value[0] !== 'number') {
    if (Array.isArray(value)) {
      return value.map(deserializeAstroValue);
    }
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [key, nested] of Object.entries(value)) {
        out[key] = deserializeAstroValue(nested);
      }
      return out;
    }
    return value;
  }

  const [type, payload] = value;
  if (type === 0 && payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(payload)) {
      out[key] = deserializeAstroValue(nested);
    }
    return out;
  }
  if (type === 1 && Array.isArray(payload)) {
    return payload.map(deserializeAstroValue);
  }
  if (type === 3) {
    return new Date(String(payload));
  }
  if (type === 4 && Array.isArray(payload)) {
    return new Map(payload.map((entry) => deserializeAstroValue(entry) as [unknown, unknown]));
  }
  if (type === 5 && Array.isArray(payload)) {
    return new Set(payload.map(deserializeAstroValue));
  }
  if (type === 6) {
    return BigInt(String(payload));
  }
  if (type === 7) {
    return new URL(String(payload));
  }
  if (type === 11) {
    return Number(payload) * Infinity;
  }
  return payload;
}

function findDeckLikePayload(root: unknown): Record<string, unknown> | null {
  const stack: unknown[] = [root];
  const seen = new Set<object>();

  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== 'object') {
      continue;
    }
    if (seen.has(node)) {
      continue;
    }
    seen.add(node);

    if (!Array.isArray(node) && looksLikeManaBoxDeck(node as Record<string, unknown>)) {
      return node as Record<string, unknown>;
    }

    if (Array.isArray(node)) {
      stack.push(...node);
    } else if (node instanceof Map) {
      stack.push(...node.values());
    } else if (node instanceof Set) {
      stack.push(...node.values());
    } else {
      stack.push(...Object.values(node));
    }
  }

  return null;
}

function looksLikeManaBoxDeck(value: Record<string, unknown>): boolean {
  if (!Array.isArray(value.cards) || !value.cards.length) {
    return false;
  }
  return value.cards.some((entry) => {
    if (!isRecord(entry)) {
      return false;
    }
    return Boolean(extractManaBoxCardName(entry) && safeInt(entry.quantity ?? entry.count ?? entry.qty) > 0);
  });
}

function extractManaBoxCardName(entry: Record<string, unknown>): string {
  const candidates = [
    entry.name,
    entry.cardName,
    entry.card_name,
    getNested(entry, ['card', 'name']),
    getNested(entry, ['oracleCard', 'name']),
    getNested(entry, ['card', 'oracleCard', 'name'])
  ];
  for (const candidate of candidates) {
    const name = String(candidate || '').trim();
    if (name) {
      return name;
    }
  }
  return '';
}

function normalizeBoardCategory(value: unknown): number | string {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  const text = String(value || '').trim();
  const numeric = Number(text);
  if (Number.isFinite(numeric) && text !== '') {
    return Math.trunc(numeric);
  }
  return text.toLowerCase();
}

function extractManaBoxDeckIdFromPath(pathname: string, rawInput: string): string {
  const match = /^\/decks\/([A-Za-z0-9_-]+)/.exec(pathname);
  if (!match?.[1]) {
    throw new AppError({
      userFacingError: 'Invalid ManaBox URL. Use manabox.app/decks/<id>.',
      adminFacingError: `Could not parse ManaBox deck id from: ${rawInput}`,
      errorTypeName: 'ManaBoxDeckIdParseError',
      httpStatusCode: 400
    });
  }
  return match[1];
}

function safeInt(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return Math.trunc(parsed);
}

function getNested(source: Record<string, unknown>, path: string[]): unknown {
  let current: unknown = source;
  for (const key of path) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
