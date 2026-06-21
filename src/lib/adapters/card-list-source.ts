import {
  fetchArchidektCardList,
  fetchArchidektFolderList,
  normalizeArchidektDeckUrl,
  normalizeArchidektFolderUrl
} from './archidekt';
import { fetchMoxfieldDeck, normalizeMoxfieldDeckUrl } from './moxfield';
import { fetchMythicToolsList, normalizeMythicToolsListUrl } from './mythic-tools';
import { AppError } from '../server/app-error';
import type { CardList, CardListSource } from '../server/types';

interface FetchCardListOptions {
  headless?: boolean;
}

interface ResolvedCardListUrl {
  source: CardListSource;
  normalizedUrl: string;
}

const SUPPORTED_CARD_LIST_SOURCE_TEXT = 'Moxfield, Archidekt, or Mythic Tools';

export function normalizeSupportedCardListUrl(value: string): ResolvedCardListUrl {
  const input = String(value || '').trim();
  if (!input) {
    throw new AppError({
      userFacingError: 'List URL is required.',
      adminFacingError: 'Card list URL is empty.',
      errorTypeName: 'CardListUrlMissingError',
      httpStatusCode: 400
    });
  }

  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(input) ? input : `https://${input}`;
  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    throw new AppError({
      userFacingError: `Invalid list URL. Use ${SUPPORTED_CARD_LIST_SOURCE_TEXT}.`,
      adminFacingError: `Card list URL parse failure: ${value}`,
      errorTypeName: 'CardListUrlInvalidError',
      httpStatusCode: 400
    });
  }

  const host = parsed.hostname.toLowerCase();
  if (host === 'moxfield.com' || host === 'www.moxfield.com') {
    return { source: 'moxfield', normalizedUrl: normalizeMoxfieldDeckUrl(input) };
  }
  if (host === 'archidekt.com' || host === 'www.archidekt.com') {
    if (/^\/folders\/\d+/.test(parsed.pathname)) {
      return { source: 'archidekt', normalizedUrl: normalizeArchidektFolderUrl(input) };
    }
    return { source: 'archidekt', normalizedUrl: normalizeArchidektDeckUrl(input) };
  }
  if (host === 'mythic.tools' || host === 'www.mythic.tools') {
    return { source: 'mythic-tools', normalizedUrl: normalizeMythicToolsListUrl(input) };
  }

  throw new AppError({
    userFacingError: `Unsupported list host. Use ${SUPPORTED_CARD_LIST_SOURCE_TEXT}.`,
    adminFacingError: `Unsupported card list host: ${host} input=${value}`,
    errorTypeName: 'CardListHostUnsupportedError',
    httpStatusCode: 400
  });
}

export async function fetchCardListFromUrl(value: string, options: FetchCardListOptions = {}): Promise<CardList> {
  const resolved = normalizeSupportedCardListUrl(value);
  if (resolved.source === 'moxfield') {
    const deck = await fetchMoxfieldDeck(resolved.normalizedUrl, { headless: options.headless ?? true });
    return { source: deck.source, listId: deck.deckId, name: deck.name, url: deck.url, cards: deck.cards };
  }
  if (resolved.source === 'archidekt') {
    if (/\/folders\/\d+/.test(new URL(resolved.normalizedUrl).pathname)) {
      return await fetchArchidektFolderList(resolved.normalizedUrl);
    }
    return await fetchArchidektCardList(resolved.normalizedUrl);
  }
  return await fetchMythicToolsList(resolved.normalizedUrl);
}
