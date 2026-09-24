import test from 'node:test';
import assert from 'node:assert/strict';
import { bo3Outcome, correctRoundResults, updateMatchScore, pairSwissRound, setRoundResults, swissStandings } from '../src/lib/swiss.ts';
const score = (aWins, bWins, finished = false) => ({ aWins, bWins, finished });
const stateFor = (count, roundCount) => ({ players: Array.from({ length: count }, (_, i) => ({ memberId: `p${i}`, name: `Player ${i}`, commanders: '' })), roundCount, rounds: [], finished: false });

test('Swiss scoring, draws, byes and Buchholz stay separate from league awards', () => {
  const state = stateFor(3, 2);
  state.rounds = [{ number: 1, pairedAt: '2026-09-23T10:00:00Z', matches: [{ a: 'p0', b: 'p1', outcome: 'draw' }, { a: 'p2', b: null, outcome: 'bye' }] }];
  let rows = swissStandings(state);
  assert.deepEqual(rows.map((p) => [p.memberId, p.points, p.buchholz]), [['p2', 3, 0], ['p0', 1, 1], ['p1', 1, 1]]);
  state.rounds.push({ number: 2, pairedAt: '2026-09-23T11:00:00Z', matches: [{ a: 'p2', b: 'p0', outcome: 'b' }, { a: 'p1', b: null, outcome: 'bye' }] });
  rows = swissStandings(state);
  assert.deepEqual(rows.map((p) => p.memberId), ['p0', 'p1', 'p2']);
  assert.equal(rows[0].points, 4);
  assert.equal(rows[0].buchholz, 7);
  assert.equal(rows[0].wins, 1);
});

test('fields of 2–32 players complete recommended rounds without repeats or duplicate byes', () => {
  for (let n = 2; n <= 32; n++) {
    let state = stateFor(n, Math.ceil(Math.log2(n)));
    const opponents = new Set(), byes = new Set();
    while (state.rounds.length < state.roundCount) {
      const round = pairSwissRound(state, '2026-09-23T10:00:00Z');
      assert.equal(new Set(round.matches.flatMap((m) => m.b ? [m.a, m.b] : [m.a])).size, n);
      for (const match of round.matches) {
        if (!match.b) { assert.ok(!byes.has(match.a)); byes.add(match.a); }
        else { const key = [match.a, match.b].sort().join('|'); assert.ok(!opponents.has(key)); opponents.add(key); }
      }
      state.rounds.push(round);
      state = setRoundResults(state, round.matches.map((m, i) => m.b ? (i % 3 === 0 ? score(1, 1, true) : i % 2 ? score(2, 1) : score(0, 2)) : null));
    }
    assert.throws(() => pairSwissRound(state, new Date().toISOString()));
  }
});

test('incomplete rounds, malformed outcomes, duplicate fields and finished state are rejected', () => {
  let state = stateFor(3, 2);
  state.rounds.push(pairSwissRound(state, '2026-09-23T10:00:00Z'));
  assert.throws(() => pairSwissRound(state, 'now'), /every match/);
  assert.throws(() => setRoundResults(state, ['a']), /each match/);
  assert.throws(() => setRoundResults(state, ['invalid', null]), /best-of-three/);
  assert.throws(() => setRoundResults(state, [score(2, 0), score(2, 0)]), /bye/);
  assert.equal(state.rounds[0].matches[0].outcome, null);
  state = setRoundResults(state, [score(2, 0), null]);
  state.finished = true;
  assert.throws(() => setRoundResults(state, [score(0, 2), null]));
  const duplicate = stateFor(2, 1); duplicate.players[1].memberId = 'p0';
  assert.throws(() => pairSwissRound(duplicate, 'now'));
});

test('pairing search backtracks instead of introducing an avoidable rematch', () => {
  const state = stateFor(4, 3);
  state.rounds = [{ number: 1, pairedAt: '', matches: [{ a: 'p0', b: 'p2', outcome: 'a' }, { a: 'p1', b: 'p3', outcome: 'a' }] },
    { number: 2, pairedAt: '', matches: [{ a: 'p0', b: 'p3', outcome: 'a' }, { a: 'p1', b: 'p2', outcome: 'a' }] }];
  const next = pairSwissRound(state, 'now');
  assert.deepEqual(next.matches.map((m) => [m.a, m.b]), [['p0', 'p1'], ['p2', 'p3']]);
});


test('BO3 scores infer winners, incomplete matches and explicitly finished draws', () => {
  for (const [a, b, expected] of [[2, 0, 'a'], [2, 1, 'a'], [0, 2, 'b'], [1, 2, 'b'], [0, 0, null], [1, 0, null], [0, 1, null], [1, 1, null]]) {
    assert.equal(bo3Outcome(score(a, b)), expected);
  }
  assert.equal(bo3Outcome(score(1, 0, true)), 'a');
  assert.equal(bo3Outcome(score(0, 1, true)), 'b');
  assert.equal(bo3Outcome(score(1, 1, true)), 'draw');
  assert.equal(bo3Outcome(score(0, 0, true)), 'draw');
  for (const invalid of [null, 'a', {}, score(2, 2), score(3, 0), score(-1, 0), score(1.5, 0), score('2', 0), score(NaN, 0), { aWins: 1, bWins: 1, finished: 'true' }]) {
    assert.throws(() => bo3Outcome(invalid), /best-of-three/);
  }
});

test('partial scores persist, corrections recalculate awards and legacy results retain unknown game scores', () => {
  let state = stateFor(2, 1);
  state.rounds.push(pairSwissRound(state, '2026-09-23T10:00:00Z'));
  state = setRoundResults(state, [score(1, 0)]);
  assert.deepEqual(state.rounds[0].matches[0].score, score(1, 0));
  assert.equal(state.rounds[0].matches[0].outcome, null);
  assert.deepEqual(swissStandings(state).map((p) => p.points), [0, 0]);
  state = setRoundResults(state, [score(2, 0)]);
  assert.equal(state.rounds[0].matches[0].outcome, 'a');
  state = setRoundResults(state, [score(1, 0)]);
  assert.equal(state.rounds[0].matches[0].outcome, null);
  assert.deepEqual(swissStandings(state).map((p) => p.points), [0, 0]);
  assert.throws(() => setRoundResults(state, [null]));
  delete state.rounds[0].matches[0].score;
  state.rounds[0].matches[0].outcome = 'b';
  state = setRoundResults(state, [null]);
  assert.equal(state.rounds[0].matches[0].outcome, 'b');
  assert.equal(state.rounds[0].matches[0].score, undefined);
  state = setRoundResults(state, [score(2, 1)]);
  assert.equal(state.rounds[0].matches[0].outcome, 'a');
});


test('advancing finalizes entered scores while saving preserves partial matches', () => {
  const state = stateFor(2, 2);
  state.rounds.push(pairSwissRound(state, 'now'));
  for (const [a, b, outcome] of [[1, 0, 'a'], [0, 1, 'b'], [1, 1, 'draw']]) {
    assert.equal(setRoundResults(state, [score(a, b)]).rounds[0].matches[0].outcome, null);
    assert.equal(setRoundResults(state, [score(a, b)], true).rounds[0].matches[0].outcome, outcome);
  }
  const empty = setRoundResults(state, [score(0, 0)], true);
  assert.equal(empty.rounds[0].matches[0].outcome, null);
  assert.throws(() => pairSwissRound(empty, 'later'), /every match/);
});


test('match revisions only change when that match changes', () => {
  const original = { a: 'a', b: 'b', outcome: null };
  const changed = updateMatchScore(original, score(1, 0));
  assert.equal(changed.revision, 1);
  assert.equal(original.revision, undefined);
  assert.equal(updateMatchScore(changed, score(1, 0)).revision, 1);
  assert.equal(updateMatchScore(changed, score(2, 1)).revision, 2);
});


test('earlier corrections preserve played rounds and flag only pairings based on changed outcomes', () => {
  let state = stateFor(6, 4);
  for (let i = 0; i < 3; i++) {
    state.rounds.push(pairSwissRound(state, `2026-09-23T1${i}:00:00Z`));
    state = setRoundResults(state, state.rounds.at(-1).matches.map(() => score(2, 0)), true);
  }
  const scores = state.rounds[0].matches.map((m) => m.score);
  const unchangedOutcome = correctRoundResults(state, 1, [score(2, 1), ...scores.slice(1)]);
  assert.deepEqual(unchangedOutcome.rounds.slice(1), state.rounds.slice(1));
  const corrected = correctRoundResults(state, 1, [score(0, 2), ...scores.slice(1)]);
  assert.equal(state.rounds[0].matches[0].outcome, 'a');
  assert.equal(corrected.rounds[0].matches[0].outcome, 'b');
  for (let i = 1; i < 3; i++) {
    assert.deepEqual(corrected.rounds[i], { ...state.rounds[i], correctedEarlierRounds: [1] });
  }
  assert.notDeepEqual(swissStandings(corrected), swissStandings(state));
  assert.throws(() => correctRoundResults(state, 1, [score(0, 0), ...scores.slice(1)]), /completed score/);
  assert.throws(() => correctRoundResults(state, 1, [{ aWins: 2, bWins: 0, finished: 'invalid' }, ...scores.slice(1)]), /best-of-three/);
  const historicalDraw = structuredClone(state);
  historicalDraw.rounds[0].matches[0] = updateMatchScore(historicalDraw.rounds[0].matches[0], score(0, 0, true));
  assert.equal(correctRoundResults(historicalDraw, 1, [score(0, 0, true), ...scores.slice(1)]).rounds[0].matches[0].outcome, 'draw');
  assert.throws(() => correctRoundResults(state, 0, scores), /completed round/);
  assert.throws(() => correctRoundResults(state, 3, scores), /completed round/);
  assert.equal(pairSwissRound(corrected, 'later').correctedEarlierRounds, undefined);
  corrected.finished = true;
  const final = correctRoundResults(corrected, 3, corrected.rounds[2].matches.map(() => score(1, 1)));
  assert.ok(final.finished);
  assert.ok(final.rounds[2].matches.every((m) => m.outcome === 'draw'));
});
