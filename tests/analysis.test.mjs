import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

let vite;
let analyzeCards, reconcileAnalysisCardNames;
before(async () => {
  vite = await createServer({ configFile: false, resolve: { alias: { '$lib': new URL('../src/lib', import.meta.url).pathname } },
    server: { middlewareMode: true, ws: false }, optimizeDeps: { noDiscovery: true, include: [] }, appType: 'custom' });
  ({ analyzeCards, reconcileAnalysisCardNames } = await vite.ssrLoadModule('/src/lib/server/analysis.ts'));
});
after(async () => { await vite?.close(); });

const input = {
  source: 'moxfield', deckId: 'test', name: 'Test', url: '',
  commanders: ['Commander'], cards: { Commander: 1, 'Lightning Bolt': 1, Island: 10 }
};
const deck = (cards, eventDate = '2026-09-01') => ({
  deckName: 'Test', player: '', event: '', eventLevel: '', rank: '',
  eventDate, deckUrl: '', pageUrl: '', cards, sections: { main: cards }
});
const decks = [
  deck({ 'Lightning Bolt': 1, Island: 10, Counterspell: 1 }),
  deck({ 'Lightning Bolt': 1, Mountain: 10 }),
  deck({ Island: 10, Counterspell: 1 })
];

test('empty card filters preserve the existing analysis', () => {
  assert.deepEqual(analyzeCards(input, decks, { requiredCards: [' ', ''] }), analyzeCards(input, decks));
  assert.equal(analyzeCards(input, decks).totalDecksConsidered, 3);
});

test('every required card must match and statistics use only matching decks', () => {
  const result = analyzeCards(input, decks, { requiredCards: ['Lightning Bolt', 'Island'] });
  assert.equal(result.totalDecksConsidered, 1);
  assert.equal(result.keep.find((card) => card.card === 'Lightning Bolt').ratio, 1);
  assert.deepEqual(result.toAdd.map((card) => [card.card, card.decksWithCard, card.totalDecks]), [['Counterspell', 1, 1]]);
});

test('card names ignore case and whitespace, deduplicate, and preserve commas', () => {
  const result = analyzeCards(input, [deck({ 'Thalia, Guardian of Thraben': 1 })], {
    requiredCards: ['  Thalia, Guardian of Thraben  ', 'thalia, guardian of thraben', '']
  });
  assert.equal(result.totalDecksConsidered, 1);
  assert.equal(result.requiredCards.length, 1);
  assert.equal(analyzeCards(input, decks, { requiredCards: ['Bolt'] }).totalDecksConsidered, 0);
});

test('double-faced card names match either face and abbreviated deck names', () => {
  const full = 'Fable of the Mirror-Breaker // Reflection of Kiki-Jiki';
  for (const required of [full, 'Fable of the Mirror-Breaker', 'Reflection of Kiki-Jiki']) {
    assert.equal(analyzeCards(input, [deck({ [full]: 1 })], { requiredCards: [required] }).totalDecksConsidered, 1);
  }
  assert.equal(analyzeCards(input, [deck({ 'Fable of the Mirror-Breaker': 1 })], { requiredCards: [full] }).totalDecksConsidered, 1);
});

test('card filters combine with inclusive date boundaries', () => {
  const result = analyzeCards(input, [
    deck({ 'Lightning Bolt': 1 }, '2026-08-31'),
    deck({ 'Lightning Bolt': 1 }, '2026-09-01'),
    deck({ 'Lightning Bolt': 1 }, '2026-09-02'),
    deck({ 'Lightning Bolt': 1 }, '2026-09-03'),
    deck({ Island: 1 }, '2026-09-01')
  ], { requiredCards: ['Lightning Bolt'], startDate: new Date('2026-09-01'), endDate: new Date('2026-09-02') });
  assert.equal(result.totalDecksConsidered, 2);
});

test('no matches and zero quantities produce no misleading recommendations', () => {
  const result = analyzeCards(input, [deck({ 'Lightning Bolt': 0 })], { requiredCards: ['Lightning Bolt'] });
  assert.equal(result.totalDecksConsidered, 0);
  for (const key of ['keep', 'cut', 'toAdd', 'allStats']) assert.deepEqual(result[key], []);
  assert.deepEqual(result.requiredCards, ['Lightning Bolt']);
});

test('commander popular cards include cards beyond the top 50 even when seen in only one deck', () => {
  const commonCards = Object.fromEntries(Array.from({ length: 60 }, (_, index) => [`Common card ${index}`, 1]));
  const tournamentDecks = [deck(commonCards), deck({ ...commonCards, 'Singleton card': 1 })];
  const commanderInput = { ...input, source: 'commander', cards: {} };

  for (const analysisInput of [commanderInput, input]) {
    const result = analyzeCards(analysisInput, tournamentDecks);
    assert.equal(result.toAdd.length, 61);
    assert.deepEqual(result.toAdd.at(-1), {
      card: 'Singleton card', decksWithCard: 1, totalDecks: 2, ratio: 0.5, banned: false
    });
  }

});

test('New includes input cards and singleton additions with filtered deck counts', () => {
  const cards = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`Card ${i}`, 1]));
  const result = analyzeCards(input, [
    deck({ ...cards, 'Lightning Bolt': 4 }),
    deck({ Island: 10, 'Lightning Bolt': 1, 'Newest card': 1 }),
    deck({ 'Excluded card': 1 }, '2026-08-01')
  ], { startDate: new Date('2026-09-01'), requiredCards: ['Lightning Bolt'] });
  assert.equal(result.toAdd.length, 61);
  assert.equal(result.newCards.length, 63);
  assert.deepEqual(result.newCards.find(c => c.card === 'Newest card'), {
    card: 'Newest card', decksWithCard: 1, totalDecks: 2, ratio: 0.5, banned: false
  });
  assert.equal(result.newCards.find(c => c.card === 'Lightning Bolt').decksWithCard, 2);
  assert.ok(!result.newCards.some(c => c.card === 'Excluded card'));
});

test('Cut, Add and Keep return all cards beyond 50 and preserve frequency ordering and counts', () => {
  const cards = Object.fromEntries(Array.from({ length: 75 }, (_, i) => [`Input card ${i}`, 1]));
  const additions = Object.fromEntries(Array.from({ length: 80 }, (_, i) => [`Addition ${i}`, 1]));
  const result = analyzeCards({ ...input, cards }, [
    deck({ ...cards, ...additions }),
    deck({ 'Input card 74': 1, 'Addition 79': 1 })
  ]);
  assert.equal(result.keep.length, 75);
  assert.equal(result.cut.length, 75);
  assert.equal(result.toAdd.length, 80);
  assert.equal(result.keep[0].card, 'Input card 74');
  assert.equal(result.cut.at(-1).card, 'Input card 74');
  assert.equal(result.toAdd[0].card, 'Addition 79');
  assert.equal(result.toAdd[0].decksWithCard, 2);
  assert.equal(result.toAdd[0].ratio, 1);
  assert.equal(result.toAdd.at(-1).decksWithCard, 1);
  assert.equal(result.toAdd.at(-1).ratio, 0.5);
  const reloaded = reconcileAnalysisCardNames(result);
  assert.deepEqual(reloaded, result);
  // Older snapshots already retained the full input-deck stats.
  const legacy = reconcileAnalysisCardNames({ ...result, keep: result.keep.slice(0, 50), cut: result.cut.slice(0, 50) });
  assert.equal(legacy.keep.length, 75);
  assert.equal(legacy.cut.length, 75);
});

test('New counts each card once per deck, merges front-face aliases, and ignores zero quantities and sideboards', () => {
  const full = 'Fable of the Mirror-Breaker // Reflection of Kiki-Jiki';
  const first = deck({ [full]: 1, 'Fable of the Mirror-Breaker': 1, 'Zero card': 0, 'Lightning Bolt': 4 });
  first.sections.side = { 'Sideboard card': 1 };
  const result = analyzeCards(input, [first,
    deck({ 'Fable of the Mirror-Breaker': 1, 'Emeritus of Conflict // Lightning Bolt': 1 })
  ]);
  assert.equal(result.newCards.length, 3);
  assert.equal(result.newCards.find(c => c.card === full).decksWithCard, 2);
  assert.equal(result.newCards.find(c => c.card === 'Lightning Bolt').decksWithCard, 1);
  assert.deepEqual(analyzeCards(input, []).newCards, []);
  assert.deepEqual(analyzeCards(input, decks, { requiredCards: ['Absent'] }).newCards, []);
});
