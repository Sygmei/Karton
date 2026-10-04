import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

let vite, translateAnalyzerMessage;
before(async () => {
  vite = await createServer({ configFile: false, server: { middlewareMode: true, ws: false },
    optimizeDeps: { noDiscovery: true, include: [] }, appType: 'custom' });
  ({ translateAnalyzerMessage } = await vite.ssrLoadModule('/src/lib/analyzer-messages.ts'));
});
after(async () => { await vite?.close(); });

test('French progress preserves page numbers, counts and singular/plural wording', () => {
  const cases = [
    ['Preparing analysis request...', 'Préparation de l’analyse…'],
    ['Gathering MtGTop8 decklists (Page 2/7)', 'Chargement des listes MtgTop8 (page 2/7)'],
    ['Scanning MtgTop8 page 2/7 (1 new deck).', 'Lecture de la page MtgTop8 2/7 (1 nouveau deck).'],
    ['Scanning MtgTop8 page 2 (12 new decks).', 'Lecture de la page MtgTop8 2 (12 nouveaux decks).'],
    ['Fetching decklists on page 2/7 (3/12).', 'Chargement des listes de la page 2/7 (3/12).'],
    ['Fetched 1 MtgTop8 deck.', '1 deck MtgTop8 chargé.'],
    ['Fetched 21 MtgTop8 decks.', '21 decks MtgTop8 chargés.'],
    ['Analysis failed. Trace ID: 012abc', 'L’analyse a échoué. (Identifiant de trace : 012abc)'],
    ['Deck URL is required (Trace ID: 012abc)', 'L’URL du deck est requise. (Identifiant de trace : 012abc)']
  ];
  for (const [english, french] of cases) {
    assert.equal(translateAnalyzerMessage(english, 'fr'), french);
    assert.equal(translateAnalyzerMessage(english, 'en'), english);
  }
});

test('validation errors keep service names and actionable URL details', () => {
  assert.equal(translateAnalyzerMessage('Invalid ManaBox URL. Use manabox.app/decks/<id>.', 'fr'),
    'URL ManaBox invalide. Utilisez manabox.app/decks/<id>.');
  assert.equal(translateAnalyzerMessage('Could not detect a commander in this Archidekt deck.', 'fr'),
    'Aucun commandant n’a pu être détecté dans ce deck Archidekt.');
  assert.equal(translateAnalyzerMessage('Could not load this Moxfield deck page. Verify the URL and that the deck is public.', 'fr'),
    'Impossible de charger ce deck Moxfield. Vérifiez l’URL et assurez-vous que le deck est public.');
  assert.equal(translateAnalyzerMessage('Unexpected upstream detail: Example', 'fr'), 'Unexpected upstream detail: Example');
});
