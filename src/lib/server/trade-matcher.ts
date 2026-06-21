import { fetchCardListFromUrl } from '../adapters/card-list-source';
import { AppError, isAppError } from './app-error';
import { withSpan } from './otel';
import type { CardList, CardListMatchResult, CardListWarning, CardMap, MatchedCard, UserContactMatchResult } from './types';
import type { SavedUserCardList } from './user-lists';
import { normalizeName } from './utils';

interface ComputeCardListMatchesInput {
  buyerUrls: string[];
  sellerUrls: string[];
  headless?: boolean;
}

interface CardDemand {
  canonicalName: string;
  quantity: number;
  lists: Array<{ listName: string; url: string; quantity: number }>;
}

interface FetchedSavedCardLists {
  lists: CardList[];
  warnings: CardListWarning[];
}

export async function computeCardListMatches(input: ComputeCardListMatchesInput): Promise<CardListMatchResult> {
  const [buyers, sellers] = await Promise.all([
    fetchCardLists(input.buyerUrls, 'buyer', input.headless),
    fetchCardLists(input.sellerUrls, 'seller', input.headless)
  ]);

  const buyerIndex = indexCardLists(buyers);
  const sellerIndex = indexCardLists(sellers);
  const matches: MatchedCard[] = [];

  for (const [key, buyer] of buyerIndex.entries()) {
    const seller = sellerIndex.get(key);
    if (!seller) {
      continue;
    }
    matches.push({
      card: buyer.canonicalName,
      buyerQuantity: buyer.quantity,
      sellerQuantity: seller.quantity,
      matchedQuantity: Math.min(buyer.quantity, seller.quantity),
      buyers: buyer.lists,
      sellers: seller.lists
    });
  }

  matches.sort((a, b) => b.matchedQuantity - a.matchedQuantity || a.card.localeCompare(b.card));

  return {
    buyers,
    sellers,
    matches,
    warnings: [],
    totals: {
      buyerLists: buyers.length,
      sellerLists: sellers.length,
      buyerCards: countCards(buyers),
      sellerCards: countCards(sellers),
      uniqueBuyerCards: buyerIndex.size,
      uniqueSellerCards: sellerIndex.size,
      matchedCards: matches.length,
      matchedQuantity: matches.reduce((sum, item) => sum + item.matchedQuantity, 0)
    }
  };
}

export async function computeUserContactMatches(input: {
  currentUserId: string;
  lists: SavedUserCardList[];
  headless?: boolean;
}): Promise<UserContactMatchResult> {
  const ownBuyers = input.lists.filter((list) => list.userId === input.currentUserId && list.kind === 'buyer');
  const ownSellers = input.lists.filter((list) => list.userId === input.currentUserId && list.kind === 'seller');
  const otherBuyers = input.lists.filter((list) => list.userId !== input.currentUserId && list.kind === 'buyer');
  const otherSellers = input.lists.filter((list) => list.userId !== input.currentUserId && list.kind === 'seller');

  const [buyerDemand, sellerSupply, ownSupply, otherDemand] = await Promise.all([
    fetchSavedCardLists(ownBuyers, 'buyer', input.headless ?? true),
    fetchSavedCardLists(otherSellers, 'seller', input.headless ?? true),
    fetchSavedCardLists(ownSellers, 'seller', input.headless ?? true),
    fetchSavedCardLists(otherBuyers, 'buyer', input.headless ?? true)
  ]);

  return {
    sellersToContact: buildMatchResult(buyerDemand.lists, sellerSupply.lists, [
      ...buyerDemand.warnings,
      ...sellerSupply.warnings
    ]),
    buyersToContact: buildMatchResult(otherDemand.lists, ownSupply.lists, [
      ...otherDemand.warnings,
      ...ownSupply.warnings
    ])
  };
}

export async function computeSavedCardListMatches(input: {
  lists: SavedUserCardList[];
  headless?: boolean;
}): Promise<CardListMatchResult> {
  const buyers = input.lists.filter((list) => list.kind === 'buyer');
  const sellers = input.lists.filter((list) => list.kind === 'seller');
  const [buyerDemand, sellerSupply] = await Promise.all([
    fetchSavedCardLists(buyers, 'buyer', input.headless ?? true),
    fetchSavedCardLists(sellers, 'seller', input.headless ?? true)
  ]);
  return buildMatchResult(buyerDemand.lists, sellerSupply.lists, [...buyerDemand.warnings, ...sellerSupply.warnings]);
}

function fetchCardLists(urls: string[], role: 'buyer' | 'seller', headless = true): Promise<CardList[]> {
  return Promise.all(urls.map((url) => fetchCardListWithContext(url, role, headless)));
}

async function fetchSavedCardLists(
  lists: SavedUserCardList[],
  role: 'buyer' | 'seller',
  headless = true
): Promise<FetchedSavedCardLists> {
  const fetched: CardList[] = [];
  const warnings: CardListWarning[] = [];
  for (const list of lists) {
    try {
      fetched.push(await fetchSavedCardListWithContext(list, role, headless));
    } catch (error) {
      warnings.push(buildSavedListWarning(list, role, error));
    }
  }
  return { lists: fetched, warnings };
}

async function fetchCardListWithContext(url: string, role: 'buyer' | 'seller', headless: boolean): Promise<CardList> {
  const trimmedUrl = String(url || '').trim();
  return await withSpan(
    'matches.list.fetch',
    {
      'matches.list.role': role,
      'matches.list.url': trimmedUrl
    },
    async (span) => {
      try {
        const list = await fetchCardListFromUrl(url, { headless });
        span.setAttribute('matches.list.source', list.source);
        span.setAttribute('matches.list.name', list.name);
        span.setAttribute('matches.list.card_count', Object.keys(list.cards).length);
        span.setAttribute('matches.list.copy_count', countCardMap(list.cards));
        return list;
      } catch (error) {
        const appError = isAppError(error) ? error : null;
        const sourceMessage = appError?.userFacingError || 'Could not load this list.';
        const adminMessage = appError?.adminFacingError || (error instanceof Error ? error.message : String(error));
        throw new AppError({
          userFacingError: `Could not load ${role} list: ${trimmedUrl}. ${sourceMessage}`,
          adminFacingError: `Could not load ${role} list url=${trimmedUrl} cause=${adminMessage}`,
          errorTypeName: appError?.errorTypeName || 'CardListLoadError',
          httpStatusCode: appError?.httpStatusCode || 422,
          cause: error
        });
      }
    }
  );
}

async function fetchSavedCardListWithContext(
  savedList: SavedUserCardList,
  role: 'buyer' | 'seller',
  headless: boolean
): Promise<CardList> {
  const fetched = await fetchCardListWithContext(savedList.url, role, headless);
  const ownerName = savedList.displayName || savedList.username;
  return {
    ...fetched,
    listId: savedList.id,
    name: `${ownerName}: ${savedList.label || fetched.name}`,
    url: savedList.url
  };
}

function buildSavedListWarning(savedList: SavedUserCardList, role: 'buyer' | 'seller', error: unknown): CardListWarning {
  const appError = isAppError(error) ? error : null;
  const ownerName = savedList.displayName || savedList.username;
  return {
    role,
    listName: `${ownerName}: ${savedList.label || savedList.url}`,
    url: savedList.url,
    message: appError?.userFacingError || 'Could not load this list.'
  };
}

function buildMatchResult(buyers: CardList[], sellers: CardList[], warnings: CardListWarning[] = []): CardListMatchResult {
  const buyerIndex = indexCardLists(buyers);
  const sellerIndex = indexCardLists(sellers);
  const matches: MatchedCard[] = [];

  for (const [key, buyer] of buyerIndex.entries()) {
    const seller = sellerIndex.get(key);
    if (!seller) {
      continue;
    }
    matches.push({
      card: buyer.canonicalName,
      buyerQuantity: buyer.quantity,
      sellerQuantity: seller.quantity,
      matchedQuantity: Math.min(buyer.quantity, seller.quantity),
      buyers: buyer.lists,
      sellers: seller.lists
    });
  }

  matches.sort((a, b) => b.matchedQuantity - a.matchedQuantity || a.card.localeCompare(b.card));

  return {
    buyers,
    sellers,
    matches,
    warnings,
    totals: {
      buyerLists: buyers.length,
      sellerLists: sellers.length,
      buyerCards: countCards(buyers),
      sellerCards: countCards(sellers),
      uniqueBuyerCards: buyerIndex.size,
      uniqueSellerCards: sellerIndex.size,
      matchedCards: matches.length,
      matchedQuantity: matches.reduce((sum, item) => sum + item.matchedQuantity, 0)
    }
  };
}

function indexCardLists(lists: CardList[]): Map<string, CardDemand> {
  const index = new Map<string, CardDemand>();
  for (const list of lists) {
    for (const [card, quantity] of Object.entries(list.cards)) {
      const key = normalizeName(card);
      if (!key || quantity <= 0) {
        continue;
      }
      const current = index.get(key);
      if (current) {
        current.quantity += quantity;
        current.lists.push({ listName: list.name, url: list.url, quantity });
      } else {
        index.set(key, {
          canonicalName: card,
          quantity,
          lists: [{ listName: list.name, url: list.url, quantity }]
        });
      }
    }
  }
  return index;
}

function countCards(lists: CardList[]): number {
  return lists.reduce((sum, list) => sum + countCardMap(list.cards), 0);
}

function countCardMap(cards: CardMap): number {
  return Object.values(cards).reduce((sum, quantity) => sum + quantity, 0);
}
