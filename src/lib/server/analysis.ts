import type { AnalysisResult, CardStat, DeckRecord, AnalysisDeck } from './types';
import { formatDate, normalizeName, parseDate, toDateStart } from './utils';

interface AnalyzeOptions {
  startDate?: Date | null;
  endDate?: Date | null;
  requiredCards?: string[];
  bannedCardsNormalized?: Set<string>;
}

export function analyzeCards(
  moxfieldDeck: AnalysisDeck,
  cachedDecks: DeckRecord[],
  options: AnalyzeOptions = {}
): AnalysisResult {
  const bannedCards = options.bannedCardsNormalized || new Set<string>();
  const requiredCards = [...new Map((options.requiredCards ?? [])
    .map((card) => card.trim()).filter(Boolean)
    .map((card) => [normalizeName(card), card])).values()];
  const requiredAliases = requiredCards.map(cardNameAliases);

  const startBoundary = options.startDate ? toDateStart(options.startDate) : Number.NEGATIVE_INFINITY;
  const endBoundary = options.endDate ? toDateStart(options.endDate) : Number.POSITIVE_INFINITY;

  const commanderNormSet = new Set(moxfieldDeck.commanders.map((name) => normalizeName(name)));
  const moxfieldCardNames = Object.keys(moxfieldDeck.cards).filter(
    (card) => !commanderNormSet.has(normalizeName(card))
  );
  const moxfieldCardsByAlias = new Map<string, string>();
  for (const card of moxfieldCardNames) {
    for (const alias of cardNameAliases(card)) {
      if (!moxfieldCardsByAlias.has(alias)) {
        moxfieldCardsByAlias.set(alias, card);
      }
    }
  }

  const filteredDecks: DeckRecord[] = [];
  for (const deck of cachedDecks) {
    const parsedDate = parseDate(deck.eventDate);
    if (!parsedDate) {
      continue;
    }
    const stamp = toDateStart(parsedDate);
    if (stamp < startBoundary || stamp > endBoundary) {
      continue;
    }
    if (requiredAliases.length) {
      const deckAliases = new Set(Object.entries(deck.cards)
        .filter(([, quantity]) => quantity > 0)
        .flatMap(([card]) => [...cardNameAliases(card)]));
      if (!requiredAliases.every((aliases) => [...aliases].some((alias) => deckAliases.has(alias)))) {
        continue;
      }
    }
    filteredDecks.push(deck);
  }

  const frequencies: Record<string, number> = {};
  for (const name of moxfieldCardNames) {
    frequencies[name] = 0;
  }

  const addFrequencies = new Map<string, { card: string; decksWithCard: number }>();
  for (const deck of filteredDecks) {
    const deckMainCards = deckMainboardCardSet(deck, commanderNormSet);

    for (const normalizedName of deckMainCards.keys()) {
      const inputDeckName = moxfieldCardsByAlias.get(normalizedName);
      if (inputDeckName) {
        frequencies[inputDeckName] += 1;
      }
    }

    for (const [normalizedName, card] of deckMainCards) {
      if (moxfieldCardsByAlias.has(normalizedName)) {
        continue;
      }

      const frequency = addFrequencies.get(normalizedName);
      if (frequency) {
        frequency.decksWithCard += 1;
      } else {
        addFrequencies.set(normalizedName, { card, decksWithCard: 1 });
      }
    }
  }

  const totalDecks = filteredDecks.length;
  const keepCutStats: CardStat[] = moxfieldCardNames.map((card) =>
    buildCardStat(card, frequencies[card], totalDecks, bannedCards)
  );

  const toAddStats: CardStat[] = [...addFrequencies.values()].map(({ card, decksWithCard }) =>
    buildCardStat(card, decksWithCard, totalDecks, bannedCards)
  );

  const byDesc = (a: CardStat, b: CardStat): number => {
    if (a.decksWithCard !== b.decksWithCard) {
      return b.decksWithCard - a.decksWithCard;
    }
    return a.card.localeCompare(b.card);
  };
  const byAsc = (a: CardStat, b: CardStat): number => {
    if (a.decksWithCard !== b.decksWithCard) {
      return a.decksWithCard - b.decksWithCard;
    }
    return a.card.localeCompare(b.card);
  };

  const allStats = [...keepCutStats].sort(byDesc);
  const keep = allStats;
  const cut = [...keepCutStats].sort(byAsc);
  const toAdd = [...toAddStats].sort(byDesc);

  return reconcileAnalysisCardNames({
    startDate: options.startDate ? formatDate(options.startDate) : null,
    endDate: options.endDate ? formatDate(options.endDate) : null,
    requiredCards,
    totalDecksConsidered: totalDecks,
    keep: requiredCards.length && !totalDecks ? [] : keep,
    cut: requiredCards.length && !totalDecks ? [] : cut,
    toAdd,
    newCards: tournamentCardStats(filteredDecks, commanderNormSet, bannedCards),
    allStats: requiredCards.length && !totalDecks ? [] : allStats
  });
}

export function reconcileAnalysisCardNames(analysis: AnalysisResult): AnalysisResult {
  const totalDecks = analysis.totalDecksConsidered;
  const allStatsByNormalizedName = new Map<string, CardStat>();
  const allStatsByAlias = new Map<string, CardStat>();

  for (const stat of analysis.allStats) {
    const normalizedName = normalizeName(stat.card);
    const aliases = cardNameAliases(stat.card);
    const existing = [...aliases]
      .map((alias) => allStatsByAlias.get(alias))
      .find((candidate) => candidate !== undefined);
    if (existing) {
      existing.decksWithCard = Math.max(existing.decksWithCard, stat.decksWithCard);
      existing.ratio = totalDecks > 0 ? existing.decksWithCard / totalDecks : 0;
      existing.banned ||= stat.banned;
      for (const alias of aliases) {
        allStatsByAlias.set(alias, existing);
      }
    } else {
      const storedStat = { ...stat };
      allStatsByNormalizedName.set(normalizedName, storedStat);
      for (const alias of aliases) {
        allStatsByAlias.set(alias, storedStat);
      }
    }
  }

  const additionsByNormalizedName = new Map<string, CardStat>();
  const additionsByAlias = new Map<string, CardStat>();
  for (const addition of analysis.toAdd) {
    const normalizedName = normalizeName(addition.card);
    const aliases = cardNameAliases(addition.card);
    const inputDeckStat = [...aliases]
      .map((alias) => allStatsByAlias.get(alias))
      .find((candidate) => candidate !== undefined);
    if (inputDeckStat) {
      inputDeckStat.decksWithCard = Math.min(
        totalDecks,
        inputDeckStat.decksWithCard + addition.decksWithCard
      );
      inputDeckStat.ratio = totalDecks > 0 ? inputDeckStat.decksWithCard / totalDecks : 0;
      inputDeckStat.banned ||= addition.banned;
      continue;
    }

    const existingAddition = [...aliases]
      .map((alias) => additionsByAlias.get(alias))
      .find((candidate) => candidate !== undefined);
    if (existingAddition) {
      existingAddition.decksWithCard = Math.min(
        totalDecks,
        existingAddition.decksWithCard + addition.decksWithCard
      );
      existingAddition.ratio = totalDecks > 0 ? existingAddition.decksWithCard / totalDecks : 0;
      existingAddition.banned ||= addition.banned;
      for (const alias of aliases) {
        additionsByAlias.set(alias, existingAddition);
      }
    } else {
      const storedAddition = { ...addition };
      additionsByNormalizedName.set(normalizedName, storedAddition);
      for (const alias of aliases) {
        additionsByAlias.set(alias, storedAddition);
      }
    }
  }

  const byDesc = (a: CardStat, b: CardStat): number => {
    if (a.decksWithCard !== b.decksWithCard) {
      return b.decksWithCard - a.decksWithCard;
    }
    return a.card.localeCompare(b.card);
  };
  const byAsc = (a: CardStat, b: CardStat): number => {
    if (a.decksWithCard !== b.decksWithCard) {
      return a.decksWithCard - b.decksWithCard;
    }
    return a.card.localeCompare(b.card);
  };

  const allStats = [...allStatsByNormalizedName.values()].sort(byDesc);
  const toAdd = [...additionsByNormalizedName.values()].sort(byDesc);

  return {
    ...analysis,
    allStats,
    keep: allStats,
    cut: [...allStats].sort(byAsc),
    toAdd
  };
}

function deckMainboardCardSet(
  deck: DeckRecord,
  commanderNormSet: Set<string>
): Map<string, string> {
  const main = deck.sections.main;
  if (main && Object.keys(main).length) {
    return cardNamesByNormalizedName(Object.keys(main).filter((name) => main[name] > 0));
  }

  return cardNamesByNormalizedName(
    Object.keys(deck.cards).filter((name) => deck.cards[name] > 0 && !commanderNormSet.has(normalizeName(name)))
  );
}

function tournamentCardStats(
  decks: DeckRecord[],
  commanderNames: Set<string>,
  bannedCards: Set<string>
): CardStat[] {
  const mainboards = decks.map((deck) => deckMainboardCardSet(deck, commanderNames));
  const namesByAlias = new Map<string, string>();
  // Register full multi-face names first so abbreviated names resolve to the same card.
  const names = [...new Set(mainboards.flatMap((cards) => [...cards.values()]))]
    .sort((a, b) => b.length - a.length || a.localeCompare(b));
  for (const name of names) {
    // MtgTop8 abbreviates multi-face cards to the front face. A back face can
    // share a name with a separate card (for example Lightning Bolt).
    for (const alias of [normalizeName(name), normalizeName(name.split(/\s*\/{1,2}\s*/)[0])]) {
      if (!namesByAlias.has(alias)) namesByAlias.set(alias, name);
    }
  }
  const counts = new Map<string, number>();
  for (const mainboard of mainboards) {
    const cards = new Set([...mainboard.keys()].map((name) => namesByAlias.get(name)!));
    for (const card of cards) counts.set(card, (counts.get(card) ?? 0) + 1);
  }
  return [...counts].map(([card, count]) => buildCardStat(card, count, decks.length, bannedCards));
}

function cardNamesByNormalizedName(cardNames: string[]): Map<string, string> {
  return new Map(cardNames.map((card) => [normalizeName(card), card]));
}

function cardNameAliases(cardName: string): Set<string> {
  const aliases = new Set([normalizeName(cardName)]);
  const faces = cardName.split(/\s*\/{1,2}\s*/).filter(Boolean);
  if (faces.length > 1) {
    for (const face of faces) {
      aliases.add(normalizeName(face));
    }
  }
  return aliases;
}

function buildCardStat(
  card: string,
  decksWithCard: number,
  totalDecks: number,
  bannedCardsNormalized: Set<string>
): CardStat {
  return {
    card,
    decksWithCard,
    totalDecks,
    ratio: totalDecks > 0 ? decksWithCard / totalDecks : 0,
    banned: bannedCardsNormalized.has(normalizeName(card))
  };
}
