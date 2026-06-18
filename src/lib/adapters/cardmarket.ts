import { load } from 'cheerio';
import { chromium } from 'playwright';

import { AppError } from '../server/app-error';
import type { CardList, CardMap } from '../server/types';
import { DEFAULT_USER_AGENT } from '../server/utils';

interface FetchCardmarketOptions {
  timeoutMs?: number;
  headless?: boolean;
  maxPages?: number;
}

const CARDMARKET_ALLOWED_HOSTS = new Set(['cardmarket.com', 'www.cardmarket.com']);
const SCRYFALL_NAMED_FUZZY_URL = 'https://api.scryfall.com/cards/named';
const SCRYFALL_TIMEOUT_MS = 8_000;
const CARDMARKET_PLAYWRIGHT_MAX_ATTEMPTS = 2;
const CARDMARKET_RETRY_DELAY_MS = 800;
const cardNameCache = new Map<string, string>();

export function normalizeCardmarketUserUrl(value: string): string {
  const input = String(value || '').trim();
  if (!input) {
    throw new AppError({
      userFacingError: 'Cardmarket seller URL is required.',
      adminFacingError: 'Cardmarket URL is empty.',
      errorTypeName: 'CardmarketUrlMissingError',
      httpStatusCode: 400
    });
  }

  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(input) ? input : `https://${input}`;
  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    throw new AppError({
      userFacingError: 'Invalid Cardmarket URL. Use cardmarket.com/<locale>/Magic/Users/<seller>.',
      adminFacingError: `Invalid Cardmarket URL parse failure: ${value}`,
      errorTypeName: 'CardmarketUrlInvalidError',
      httpStatusCode: 400
    });
  }

  const host = parsed.hostname.toLowerCase();
  if (!CARDMARKET_ALLOWED_HOSTS.has(host)) {
    throw new AppError({
      userFacingError: 'Invalid Cardmarket URL host. Use cardmarket.com.',
      adminFacingError: `Invalid Cardmarket host: ${parsed.hostname}`,
      errorTypeName: 'CardmarketHostInvalidError',
      httpStatusCode: 400
    });
  }

  const match = /^\/([a-z]{2})\/Magic\/Users\/([^/?#]+)/i.exec(parsed.pathname);
  if (!match?.[1] || !match?.[2]) {
    throw new AppError({
      userFacingError: 'Invalid Cardmarket URL. Use cardmarket.com/<locale>/Magic/Users/<seller>.',
      adminFacingError: `Could not parse Cardmarket seller from: ${value}`,
      errorTypeName: 'CardmarketSellerParseError',
      httpStatusCode: 400
    });
  }

  return `https://www.cardmarket.com/${match[1]}/Magic/Users/${match[2]}`;
}

export async function fetchCardmarketSellerList(
  value: string,
  options: FetchCardmarketOptions = {}
): Promise<CardList> {
  const normalizedUrl = normalizeCardmarketUserUrl(value);
  const parsed = new URL(normalizedUrl);
  const seller = parsed.pathname.split('/').filter(Boolean).pop() || 'seller';
  const timeoutMs = options.timeoutMs ?? 20_000;
  const pages = await fetchCardmarketOfferPagesWithPlaywright({
    sellerUrl: normalizedUrl,
    timeoutMs,
    headless: options.headless ?? true,
    maxPages: options.maxPages ?? 20
  });
  const cards = await parseCardmarketCards(pages, normalizedUrl);

  if (!Object.keys(cards).length) {
    throw new AppError({
      userFacingError: 'Could not extract sellable Magic cards from this Cardmarket seller page.',
      adminFacingError: `No cards parsed from Cardmarket seller page ${normalizedUrl}`,
      errorTypeName: 'CardmarketCardsMissingError',
      httpStatusCode: 422
    });
  }

  return {
    source: 'cardmarket',
    listId: decodeURIComponent(seller),
    name: decodeURIComponent(seller),
    url: normalizedUrl,
    cards
  };
}

async function fetchCardmarketOfferPagesWithPlaywright(args: {
  sellerUrl: string;
  timeoutMs: number;
  headless: boolean;
  maxPages: number;
}): Promise<string[]> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= CARDMARKET_PLAYWRIGHT_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await fetchCardmarketOfferPagesAttempt({ ...args, attempt });
    } catch (error) {
      lastError = error;
      if (attempt >= CARDMARKET_PLAYWRIGHT_MAX_ATTEMPTS || !shouldRetryCardmarketPlaywrightError(error)) {
        throw error;
      }
      await delay(CARDMARKET_RETRY_DELAY_MS);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new AppError({
        userFacingError: 'Could not load this Cardmarket seller page. Verify that the URL is public.',
        adminFacingError: `Cardmarket browser extraction failed for ${args.sellerUrl}`,
        errorTypeName: 'CardmarketBrowserExtractionError',
        httpStatusCode: 422
      });
}

async function fetchCardmarketOfferPagesAttempt(args: {
  sellerUrl: string;
  timeoutMs: number;
  headless: boolean;
  maxPages: number;
  attempt: number;
}): Promise<string[]> {
  const browser = await launchCardmarketBrowser(args.sellerUrl, args.attempt, args.headless);
  let context: Awaited<ReturnType<typeof browser.newContext>> | null = null;
  try {
    context = await browser.newContext({
      userAgent: process.env.MOXFIELD_USER_AGENT?.trim() || DEFAULT_USER_AGENT,
      locale: localeFromCardmarketUrl(args.sellerUrl)
    });
    const page = await context.newPage();
    const firstUrl = buildCardmarketOffersUrl(args.sellerUrl);
    const pending = [firstUrl];
    const seen = new Set<string>();
    const htmlPages: string[] = [];

    while (pending.length && htmlPages.length < args.maxPages) {
      const url = pending.shift() || '';
      if (!url || seen.has(url)) {
        continue;
      }
      seen.add(url);
      await gotoCardmarketOffersPage(page, url, args.timeoutMs, args.attempt);
      await waitForCardmarketOfferSignal(page, Math.min(args.timeoutMs, 10_000));
      await page.waitForLoadState('networkidle', { timeout: Math.min(args.timeoutMs, 5_000) }).catch(() => null);
      const html = await page.content();
      if (isCloudflareChallenge(html)) {
        throw new AppError({
          userFacingError: 'Cardmarket blocked the browser session before the seller offers could be read. Please retry.',
          adminFacingError: `Cardmarket Cloudflare challenge after Playwright navigation url=${url}`,
          errorTypeName: 'CardmarketCloudflareChallengeError',
          httpStatusCode: 422
        });
      }
      htmlPages.push(html);

      for (const nextUrl of extractNextOfferPageUrls(html, url)) {
        if (!seen.has(nextUrl) && pending.length + htmlPages.length < args.maxPages) {
          pending.push(nextUrl);
        }
      }
    }

    return htmlPages;
  } finally {
    if (context) {
      await context.close().catch(() => null);
    }
    await browser.close().catch(() => null);
  }
}

async function launchCardmarketBrowser(url: string, attempt: number, headless: boolean): Promise<any> {
  try {
    return await chromium.launch({ headless });
  } catch (error) {
    throw new AppError({
      userFacingError: 'Cardmarket browser session could not start. Please retry.',
      adminFacingError: `Playwright browser launch failed for Cardmarket url=${url} attempt=${attempt} cause=${error instanceof Error ? error.message : String(error)}`,
      errorTypeName: 'CardmarketBrowserLaunchError',
      httpStatusCode: 502,
      cause: error
    });
  }
}

async function gotoCardmarketOffersPage(page: any, url: string, timeoutMs: number, attempt: number): Promise<void> {
  try {
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    const status = response?.status?.() ?? 0;
    if (status >= 400) {
      throw new AppError({
        userFacingError: 'Could not load this Cardmarket seller page. Verify that the URL is public.',
        adminFacingError: `Cardmarket navigation returned status=${status} url=${url} attempt=${attempt}`,
        errorTypeName: 'CardmarketNavigationHttpError',
        httpStatusCode: status === 404 ? 404 : 422
      });
    }
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError({
      userFacingError: 'Could not load this Cardmarket seller page. Verify that the URL is public.',
      adminFacingError: `Playwright failed to load Cardmarket page ${url} attempt=${attempt} cause=${error instanceof Error ? error.message : String(error)}`,
      errorTypeName: 'CardmarketPageLoadError',
      httpStatusCode: 422,
      cause: error
    });
  }
}

async function waitForCardmarketOfferSignal(page: any, timeoutMs: number): Promise<void> {
  await page
    .waitForFunction(
      () => {
        const text = document.body?.innerText || '';
        return (
          document.querySelectorAll('a[href*="/Magic/Products/Singles/"]').length > 0 ||
          /\b(?:Results|Ergebnisse|Resultados|Risultati)\b/i.test(text) ||
          /cloudflare|just a moment|enable javascript and cookies/i.test(text)
        );
      },
      undefined,
      { timeout: timeoutMs }
    )
    .catch(() => null);
}

async function parseCardmarketCards(htmlPages: string[], baseUrl: string): Promise<CardMap> {
  const cards: CardMap = {};

  for (const html of htmlPages) {
    const $ = load(html);

    for (const anchor of $('a[href*="/Magic/Products/Singles/"]').toArray()) {
      const href = String($(anchor).attr('href') || '').trim();
      const displayName = $(anchor).text().replace(/\s+/g, ' ').trim();
      const name = await resolveCardmarketProductName(href, displayName);
      if (!name || name.length > 140) {
        continue;
      }

      const row = findOfferRow($, anchor);
      const quantity = extractQuantityFromText(row.text()) || 1;
      cards[name] = (cards[name] || 0) + quantity;
    }

    if (!Object.keys(cards).length) {
      const scriptCards = extractCardsFromJsonScripts($);
      for (const [name, quantity] of Object.entries(scriptCards)) {
        cards[name] = (cards[name] || 0) + quantity;
      }
    }
  }

  if (Object.keys(cards).length) {
    return cards;
  }

  const lastPage = htmlPages[htmlPages.length - 1] || '';
  const $ = load(lastPage);
  const canonical = $('link[rel="canonical"]').attr('href') || baseUrl;
  if (canonical && !canonical.includes('/Users/') && !canonical.includes('/Offers/Singles')) {
    return {};
  }
  return cards;
}

function findOfferRow($: ReturnType<typeof load>, anchor: any): any {
  let current = $(anchor).parent();
  let best = $(anchor).closest('.article-row, tr, li, .row');
  for (let depth = 0; depth < 8 && current.length; depth += 1) {
    const text = current.text().replace(/\s+/g, ' ').trim();
    if (extractQuantityFromText(text) || /[\u20ac$]\s*\d|\d+[,.]\d+\s*[\u20ac$]/.test(text)) {
      best = current;
    }
    current = current.parent();
  }
  return best;
}

function extractCardsFromJsonScripts($: ReturnType<typeof load>): CardMap {
  const cards: CardMap = {};
  $('script[type="application/ld+json"], script:not([src])').each((_, script) => {
    const text = $(script).text().trim();
    if (!text || !text.includes('Magic')) {
      return;
    }
    for (const match of text.matchAll(/"name"\s*:\s*"([^"]+)"/g)) {
      const name = decodeJsonString(match[1]).trim();
      if (!name || name.length > 140 || /cardmarket|magic:/i.test(name)) {
        continue;
      }
      cards[name] = (cards[name] || 0) + 1;
    }
  });
  return cards;
}

function extractQuantityFromText(text: string): number {
  const normalized = text.replace(/\s+/g, ' ').trim();
  const patterns = [
    /\bQty\.?\s*:?\s*(\d+)\b/i,
    /\bQuantity\s*:?\s*(\d+)\b/i,
    /\b(\d+)\s*x\b/i,
    /(?:\u20ac|EUR)\s*\d+(?:[,.]\d+)?\s+(\d+)\s*$/i,
    /\d+(?:[,.]\d+)?\s*(?:\u20ac|EUR)\s+(\d+)\s*$/i
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(normalized);
    if (match?.[1]) {
      const parsed = Number(match[1]);
      if (Number.isFinite(parsed) && parsed > 0) {
        return Math.trunc(parsed);
      }
    }
  }
  return 0;
}

function isCloudflareChallenge(html: string): boolean {
  return /cf_chl|challenge-platform|enable javascript and cookies|just a moment/i.test(html);
}

function shouldRetryCardmarketPlaywrightError(error: unknown): boolean {
  if (!(error instanceof AppError)) {
    return false;
  }
  return (
    error.errorTypeName === 'CardmarketBrowserLaunchError' ||
    error.errorTypeName === 'CardmarketPageLoadError' ||
    error.errorTypeName === 'CardmarketNavigationHttpError'
  );
}

function buildCardmarketOffersUrl(sellerUrl: string): string {
  return `${sellerUrl.replace(/\/+$/, '')}/Offers/Singles`;
}

function localeFromCardmarketUrl(value: string): string {
  const match = /^\/([a-z]{2})\//i.exec(new URL(value).pathname);
  const locale = (match?.[1] || 'en').toLowerCase();
  const map: Record<string, string> = {
    en: 'en-US',
    fr: 'fr-FR',
    de: 'de-DE',
    es: 'es-ES',
    it: 'it-IT'
  };
  return map[locale] || 'en-US';
}

function extractNextOfferPageUrls(html: string, currentUrl: string): string[] {
  const $ = load(html);
  const current = new URL(currentUrl);
  const urls = new Set<string>();
  $('a[href]').each((_, anchor) => {
    const href = String($(anchor).attr('href') || '').trim();
    if (!href) {
      return;
    }
    const target = new URL(href, currentUrl);
    if (target.origin !== current.origin || target.pathname !== current.pathname) {
      return;
    }
    if (target.toString() === current.toString()) {
      return;
    }
    if (!/[?&](?:site|page)=\d+/i.test(target.search)) {
      return;
    }
    urls.add(target.toString());
  });
  return [...urls];
}

async function resolveCardmarketProductName(href: string, displayName: string): Promise<string> {
  const hint = extractCardNameHintFromProductHref(href);
  if (!hint) {
    return stripCardmarketVariantSuffix(displayName);
  }
  return (await resolveScryfallCanonicalName(hint)) || hint;
}

function extractCardNameHintFromProductHref(href: string): string {
  if (!href) {
    return '';
  }
  let parsed: URL;
  try {
    parsed = new URL(href, 'https://www.cardmarket.com');
  } catch {
    return '';
  }
  const parts = parsed.pathname.split('/').filter(Boolean);
  const slug = decodeURIComponent(parts[parts.length - 1] || '');
  if (!slug) {
    return '';
  }
  return stripCardmarketVariantSuffix(slug.replace(/-/g, ' '));
}

function stripCardmarketVariantSuffix(value: string): string {
  return String(value || '')
    .replace(/\s*\(V\.?\s*\d+\)\s*$/i, '')
    .replace(/\s+V\d+\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function resolveScryfallCanonicalName(nameHint: string): Promise<string | null> {
  const key = nameHint.toLowerCase();
  if (!key) {
    return null;
  }
  if (cardNameCache.has(key)) {
    return cardNameCache.get(key) || null;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SCRYFALL_TIMEOUT_MS);
  try {
    const url = new URL(SCRYFALL_NAMED_FUZZY_URL);
    url.searchParams.set('fuzzy', nameHint);
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'user-agent': process.env.MOXFIELD_USER_AGENT?.trim() || DEFAULT_USER_AGENT
      },
      signal: controller.signal
    });
    if (!response.ok) {
      return null;
    }
    const payload = (await response.json()) as unknown;
    const name = extractScryfallCardName(payload);
    if (name) {
      cardNameCache.set(key, name);
    }
    return name;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function extractScryfallCardName(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const item = payload as Record<string, unknown>;
  const name = String(item.name || '').trim();
  return name || null;
}

async function delay(ms: number): Promise<void> {
  if (ms <= 0) {
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function decodeJsonString(value: string): string {
  try {
    return JSON.parse(`"${value.replace(/"/g, '\\"')}"`) as string;
  } catch {
    return value;
  }
}
