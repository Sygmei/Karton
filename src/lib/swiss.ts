/** Karton's match-level Swiss rules (3/1/0), independent of league awards. */
export type SwissPlayer = { memberId: string; name: string; commanders: string };
export type SwissOutcome = 'a' | 'b' | 'draw' | 'bye' | null;
export type SwissScore = { aWins: number; bWins: number; finished: boolean };
export type SwissMatch = { score?: SwissScore; revision?: number; a: string; b: string | null; outcome: SwissOutcome; rematch?: boolean };
export type SwissRound = { number: number; pairedAt: string; matches: SwissMatch[]; correctedEarlierRounds?: number[] };
export type SwissState = { players: SwissPlayer[]; roundCount: number; rounds: SwissRound[]; finished: boolean };

export function swissStandings(state: SwissState) {
  const rows = state.players.map((player, seed) => ({ ...player, seed, points: 0, wins: 0, draws: 0, losses: 0, byes: 0, opponents: [] as string[], buchholz: 0 }));
  const byId = new Map(rows.map((row) => [row.memberId, row]));
  for (const round of state.rounds) for (const match of round.matches) {
    if (!match.outcome) continue;
    const a = byId.get(match.a)!;
    if (!match.b) { a.points += 3; a.byes++; continue; }
    const b = byId.get(match.b)!;
    a.opponents.push(b.memberId); b.opponents.push(a.memberId);
    if (match.outcome === 'draw') { a.points++; b.points++; a.draws++; b.draws++; }
    else {
      const [winner, loser] = match.outcome === 'a' ? [a, b] : [b, a];
      winner.points += 3; winner.wins++; loser.losses++;
    }
  }
  for (const row of rows) row.buchholz = row.opponents.reduce((sum, id) => sum + byId.get(id)!.points, 0);
  return rows.sort((a, b) => b.points - a.points || b.buchholz - a.buchholz || b.wins - a.wins || a.seed - b.seed)
    .map((row, index) => ({ ...row, rank: index + 1 }));
}

export function roundComplete(round: SwissRound) { return round.matches.every((match) => match.outcome !== null); }

export function pairSwissRound(state: SwissState, pairedAt: string): SwissRound {
  if (state.finished || state.rounds.length >= state.roundCount) throw new Error('All scheduled rounds have been paired.');
  if (state.rounds.some((round) => !roundComplete(round))) throw new Error('Enter every match result before generating the next round.');
  if (state.players.length < 2 || state.players.length > 128 || new Set(state.players.map((p) => p.memberId)).size !== state.players.length) {
    throw new Error('Select 2–128 different players.');
  }
  const rows = swissStandings(state);
  const met = new Set(state.rounds.flatMap((r) => r.matches.filter((m) => m.b).flatMap((m) => [`${m.a}|${m.b}`, `${m.b}|${m.a}`])));
  let steps = 0;
  function search(pool: typeof rows): SwissMatch[] | null {
    if (!pool.length) return [];
    if (++steps > 200000) throw new Error('Pairing search exceeded its limit. Reduce the field or scheduled rounds.');
    const [first, ...rest] = pool;
    const candidates = rest.filter((p) => !met.has(`${first.memberId}|${p.memberId}`))
      .sort((a, b) => Math.abs(a.points - first.points) - Math.abs(b.points - first.points) || a.rank - b.rank);
    for (const other of candidates) {
      const remaining = search(rest.filter((p) => p !== other));
      if (remaining) return [{ a: first.memberId, b: other.memberId, outcome: null }, ...remaining];
    }
    return null;
  }
  const byeCandidates = rows.length % 2 ? [...rows].sort((a, b) => a.byes - b.byes || b.rank - a.rank).filter((r, _, all) => r.byes === all[0].byes) : [null];
  for (const bye of byeCandidates) {
    const matches = search(rows.filter((p) => p !== bye));
    if (matches) return { number: state.rounds.length + 1, pairedAt, matches: [...matches, ...(bye ? [{ a: bye.memberId, b: null, outcome: 'bye' as const }] : [])] };
  }
  // If prior pairings make a repeat unavoidable, expose it explicitly to the organizer.
  const bye = byeCandidates[0];
  const pool = rows.filter((p) => p !== bye);
  const matches: SwissMatch[] = [];
  while (pool.length) {
    const first = pool.shift()!;
    pool.sort((a, b) => Number(met.has(`${first.memberId}|${a.memberId}`)) - Number(met.has(`${first.memberId}|${b.memberId}`)) || Math.abs(a.points - first.points) - Math.abs(b.points - first.points));
    const other = pool.shift()!;
    matches.push({ a: first.memberId, b: other.memberId, outcome: null, rematch: met.has(`${first.memberId}|${other.memberId}`) });
  }
  if (bye) matches.push({ a: bye.memberId, b: null, outcome: 'bye' });
  return { number: state.rounds.length + 1, pairedAt, matches };
}

/** Partial BO3 scores do not award match points until two wins or an explicit end. */
export function bo3Outcome(score: SwissScore): Exclude<SwissOutcome, 'bye'> {
  if (!score || typeof score !== 'object' || !Number.isInteger(score.aWins) || !Number.isInteger(score.bWins)
    || score.aWins < 0 || score.bWins < 0 || score.aWins > 2 || score.bWins > 2
    || score.aWins + score.bWins > 3 || typeof score.finished !== 'boolean') {
    throw new Error('Enter a valid best-of-three score: 0–2 game wins per player, at most 3 total.');
  }
  if (score.aWins < 2 && score.bWins < 2 && !score.finished) return null;
  return score.aWins === score.bWins ? 'draw' : score.aWins > score.bWins ? 'a' : 'b';
}

export function setRoundResults(state: SwissState, scores: (SwissScore | null)[], finalize = false): SwissState {
  if (state.finished || !state.rounds.length) throw new Error('This tournament has no editable round.');
  const next = structuredClone(state);
  const round = next.rounds[next.rounds.length - 1];
  if (scores.length !== round.matches.length) throw new Error('Submit each match exactly once.');
  round.matches = round.matches.map((match, index) => updateMatchScore(match, scores[index], finalize));
  return next;
}

/** Correct completed results without regenerating any pairings or changing their timestamps. */
export function correctRoundResults(state: SwissState, roundNumber: number, scores: (SwissScore | null)[]): SwissState {
  const next = structuredClone(state);
  const round = next.rounds.find((round) => round.number === roundNumber);
  if (!round || (!state.finished && round === next.rounds.at(-1))) throw new Error('Select a completed round to correct.');
  if (scores.length !== round.matches.length) throw new Error('Submit each match exactly once.');
  const originalOutcomes = round.matches.map((match) => match.outcome);
  round.matches = round.matches.map((match, index) => updateMatchScore(match, scores[index], true));
  if (!roundComplete(round)) throw new Error('Enter a completed score for every match in this round.');
  if (round.matches.some((match, index) => match.outcome !== originalOutcomes[index])) {
    for (const later of next.rounds.filter((later) => later.number > roundNumber)) {
      later.correctedEarlierRounds = [...new Set([...(later.correctedEarlierRounds ?? []), roundNumber])].sort((a, b) => a - b);
    }
  }
  return next;
}

export function updateMatchScore(original: SwissMatch, score: SwissScore | null, finalize = false): SwissMatch {
  const match = structuredClone(original);
  if (match.b === null) {
    if (score !== null) throw new Error('A bye is an automatic win without a game score.');
    match.outcome = 'bye';
  } else if (score === null && !match.score && match.outcome !== null) {
    // Preserve older outcome-only results without inventing a historical game score.
  } else {
    bo3Outcome(score!);
    match.score = { aWins: score!.aWins, bWins: score!.bWins,
      finished: score!.finished || (finalize && score!.aWins + score!.bWins > 0) };
    match.outcome = bo3Outcome(match.score);
  }
  if (match.outcome !== original.outcome || match.score?.aWins !== original.score?.aWins
    || match.score?.bWins !== original.score?.bWins || match.score?.finished !== original.score?.finished) {
    match.revision = (original.revision ?? 0) + 1;
  }
  return match;
}
