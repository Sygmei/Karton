import { request, quote } from './scryfall-client';
import type { CardStat } from './types';
import { normalizeName, parseDate } from './utils';

type Release = { releasedAt: string; setName: string | null };
type ScryfallRelease = { name: string; released_at: string; set_name?: string };
const cache = new Map<string, { release: Release; expires: number }>();

export async function addCardReleaseDates(cards: CardStat[]): Promise<CardStat[]> {
  const releases = new Map<string, Release>();
  const missing: string[] = [];
  for (const { card } of cards) {
    const cached = cache.get(card);
    if (cached && cached.expires > Date.now()) releases.set(card, cached.release);
    else missing.push(card);
  }

  // Batch exact names instead of issuing an upstream request for every card.
  for (let offset = 0; offset < missing.length; offset += 30) {
    const names = missing.slice(offset, offset + 30);
    const q = `(${names.map((name) => `!${quote(name)}`).join(' or ')}) prefer:oldest`;
    const matches: ScryfallRelease[] = [];
    try {
      let page = 1;
      while (true) {
        const result = await request(`/cards/search?${new URLSearchParams({
          q, unique: 'cards', order: 'released', dir: 'asc', page: String(page)
        })}`);
        matches.push(...(result?.data ?? []));
        if (!result?.has_more) break;
        page += 1;
      }
    } catch (error) {
      // Keep the analysis usable during upstream outages. Unknown dates sort last.
      console.warn('[analysis] Card release lookup unavailable', error);
      break;
    }
    for (const name of names) {
      const key = normalizeName(name);
      const valid = matches.filter((card) => typeof card.released_at === 'string' && parseDate(card.released_at));
      const exact = valid.filter((card) => normalizeName(card.name) === key);
      const candidates = exact.length ? exact : valid.filter((card) =>
        normalizeName(card.name.split(/\s*\/{1,2}\s*/)[0]) === key);
      const first = candidates.sort((a, b) => a.released_at.localeCompare(b.released_at))[0];
      if (!first) continue;
      const release = { releasedAt: first.released_at, setName: first.set_name ?? null };
      releases.set(name, release);
      if (cache.size >= 5000) cache.delete(cache.keys().next().value!);
      cache.set(name, { release, expires: Date.now() + 24 * 60 * 60 * 1000 });
    }
  }

  return cards.map((card) => ({
    ...card, releasedAt: null, setName: null, ...releases.get(card.card)
  })).sort((a, b) =>
    (b.releasedAt ?? '').localeCompare(a.releasedAt ?? '') ||
    b.decksWithCard - a.decksWithCard || a.card.localeCompare(b.card));
}
