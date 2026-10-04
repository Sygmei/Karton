import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

let vite, addCardReleaseDates;
const originalFetch = globalThis.fetch;
const calls = [];
before(async () => {
  globalThis.fetch = async (input) => {
    const url = new URL(input);
    calls.push(url);
    const q = url.searchParams.get('q');
    if (q.includes('Unavailable')) return new Response('', { status: 503 });
    if (q.includes('Missing only')) return new Response('', { status: 404 });
    if (q.includes('Batch card')) return Response.json({ data: [] });
    const page = Number(url.searchParams.get('page'));
    return Response.json({ has_more: page === 1, data: page === 1 ? [
      { name: 'Lightning Bolt', released_at: '1993-08-05', set_name: 'Limited Edition Alpha' },
      { name: 'Emeritus of Conflict // Lightning Bolt', released_at: '2026-04-24', set_name: 'Secrets of Strixhaven' },
      { name: 'Fable of the Mirror-Breaker // Reflection of Kiki-Jiki', released_at: '2022-02-18', set_name: 'Kamigawa: Neon Dynasty' }
    ] : [
      { name: 'Recent card', released_at: '2026-09-01', set_name: 'Recent set' },
      { name: 'Popular recent card', released_at: '2026-09-01' }
    ] });
  };
  vite = await createServer({ configFile: false, server: { middlewareMode: true, ws: false },
    optimizeDeps: { noDiscovery: true, include: [] }, appType: 'custom' });
  ({ addCardReleaseDates } = await vite.ssrLoadModule('/src/lib/server/card-releases.ts'));
});
after(async () => { globalThis.fetch = originalFetch; await vite?.close(); });
const stat = (card, count = 1) => ({ card, decksWithCard: count, totalDecks: 3, ratio: count / 3, banned: false });

test('original releases sort newest first, paginate, preserve counts, and place unknown dates last', async () => {
  const cards = [stat('Lightning Bolt'), stat('Missing'), stat('Recent card'),
    stat('Fable of the Mirror-Breaker'), stat('Popular recent card', 2)];
  const result = await addCardReleaseDates(cards);
  assert.deepEqual(result.map(c => c.card), [
    'Popular recent card', 'Recent card', 'Fable of the Mirror-Breaker', 'Lightning Bolt', 'Missing'
  ]);
  assert.equal(result[0].decksWithCard, 2);
  assert.equal(result[0].ratio, 2 / 3);
  assert.equal(result[3].releasedAt, '1993-08-05');
  assert.equal(result[2].setName, 'Kamigawa: Neon Dynasty');
  assert.equal(result[4].releasedAt, null);
  assert.match(calls[0].searchParams.get('q'), /prefer:oldest$/);
  assert.equal(calls[1].searchParams.get('page'), '2');
  assert.equal(cards[0].releasedAt, undefined);
  const count = calls.length;
  await addCardReleaseDates([cards[0], cards[2]]);
  assert.equal(calls.length, count);
});

test('lookup batches exact names safely and skips empty lists', async () => {
  const count = calls.length;
  assert.deepEqual(await addCardReleaseDates([]), []);
  assert.equal(calls.length, count);
  const cards = Array.from({ length: 61 }, (_, i) => stat(`Batch card ${i}`));
  cards[0] = stat('Batch card "quoted"');
  const result = await addCardReleaseDates(cards);
  assert.equal(result.length, 61);
  assert.equal(calls.length, count + 3);
  assert.ok(calls[count].searchParams.get('q').includes('!"Batch card \\"quoted\\""'));
});

test('missing metadata and upstream failures keep inclusion statistics available', async () => {
  for (const name of ['Missing only', 'Unavailable']) {
    const result = await addCardReleaseDates([stat(name)]);
    assert.deepEqual(result, [{ ...stat(name), releasedAt: null, setName: null }]);
  }
});
