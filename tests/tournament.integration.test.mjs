import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { createServer } from 'vite';

const testUrl = process.env.TEST_DATABASE_URL;
const form = (data) => { const value = new FormData(); for (const [key, field] of Object.entries(data)) value.set(key, String(field)); return value; };
const rejects = (fn, status) => assert.rejects(fn, (error) => error.httpStatusCode === status);

test('tournament database lifecycle and permissions', { skip: !testUrl }, async (t) => {
  process.env.DATABASE_URL_RW = testUrl;
  process.env.DATABASE_URL_RO = testUrl;
  const db = postgres(testUrl, { max: 1 });
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
  const service = await vite.ssrLoadModule('/src/lib/server/tournaments.ts');
  const { swissStandings } = await vite.ssrLoadModule('/src/lib/swiss.ts');
  const { scorePlacements } = await vite.ssrLoadModule('/src/lib/tournament.ts');
  const dbModule = await vite.ssrLoadModule('/src/lib/server/db.ts');
  const accounts = Array.from({ length: 8 }, (_, index) => ({ id: randomUUID(), username: `tournament-test-${randomUUID().slice(0, 8)}`,
    displayName: `Player ${index}`, role: index === 0 ? 'admin' : 'user', isSuperadmin: false, createdAt: new Date(), createdByUserId: null }));
  const [admin, player] = accounts;
  // Legacy roster fixtures verify compatibility with leagues created before automatic membership.
  const seedMember = async (_admin, league, fields) => {
    const account = accounts.find((a) => a.id === fields.get('userId'));
    await db`INSERT INTO tournament_members (id, league_id, user_id, name) VALUES (${randomUUID()}, ${league}, ${account.id}, ${account.displayName}) ON CONFLICT DO NOTHING`;
  };
  const ids = [];
  let leagueId, otherId, eventId, roster;
  const settings = { name: 'Test League', description: 'Independent dates', startsOn: '2026-09-01', endsOn: '2027-06-30' };
  const eventForm = (revision, status = 'published', overrides = {}) => form({ name: 'Opening event', eventDate: '2026-09-12', revision, status,
    ...Object.fromEntries(roster.slice(0, 6).map((member, i) => [`rank:${member.id}`, i + 1])), ...overrides });
  try {
    for (const user of accounts) await db`INSERT INTO users (id, username, display_name, role) VALUES (${user.id}, ${user.username}, ${user.displayName}, ${user.role})`;
    await t.test('only admins can mutate leagues', async () => {
      await rejects(() => service.createLeague(null, form(settings)), 401);
      await rejects(() => service.createLeague(player, form(settings)), 401);
      await rejects(() => service.createLeague(admin, form({ ...settings, endsOn: '2026-02-30' })), 400);
      leagueId = await service.createLeague(admin, form(settings)); ids.push(leagueId);
      otherId = await service.createLeague(admin, form({ ...settings, name: 'Other League' })); ids.push(otherId);
      assert.equal(service.addMember, undefined);
      assert.equal(service.removeMember, undefined);
      for (const user of accounts.slice(0, 6)) await seedMember(admin, leagueId, form({ userId: user.id }));
      await seedMember(admin, leagueId, form({ userId: player.id }));
      roster = (await service.getLeague(leagueId, admin)).roster;
      assert.equal(roster.length, 6);
    });
    await t.test('draft scores are hidden and excluded; invalid ranks and cross-league players rejected', async () => {
      await rejects(() => service.createEvent(admin, leagueId, form({ name: 'Bad date', eventDate: '2028-01-01' })), 400);
      eventId = await service.createEvent(admin, leagueId, form({ name: 'Opening event', eventDate: '2026-09-12' }));
      await rejects(() => service.saveEvent(player, leagueId, eventId, eventForm(0)), 401);
      await rejects(() => service.saveEvent(admin, leagueId, eventId, eventForm(0, 'published', { [`rank:${roster[1].id}`]: 1 })), 400);
      await seedMember(admin, otherId, form({ userId: accounts[7].id }));
      const stranger = (await service.getLeague(otherId, admin)).roster[0];
      await rejects(() => service.saveEvent(admin, leagueId, eventId, eventForm(0, 'published', { [`rank:${stranger.id}`]: 7 })), 400);
      await service.saveEvent(admin, leagueId, eventId, eventForm(0, 'draft'));
      assert.equal((await service.getEvent(leagueId, eventId, player)).results.length, 0);
      assert.equal((await service.getEvent(leagueId, eventId, player)).history.length, 0);
      assert.ok((await service.getLeague(leagueId, player)).standings.every((row) => row.points === 0));
    });
    await t.test('publication awards exactly once and stale submissions cannot overwrite', async () => {
      await service.saveEvent(admin, leagueId, eventId, eventForm(1));
      const view = await service.getLeague(leagueId, player);
      assert.deepEqual(view.standings.map((row) => row.points), [7, 4, 3, 2, 1, 1]);
      assert.deepEqual(view.standings.map((row) => row.rank), [1, 2, 3, 4, 5, 5]);
      assert.equal(view.myHistory.length, 1);
      await rejects(() => service.saveEvent(admin, leagueId, eventId, eventForm(1)), 409);
      await rejects(() => service.saveEvent(admin, leagueId, eventId, eventForm(2)), 400);
    });
    await t.test('corrections are atomic, auditable, and preserve earlier awards', async () => {
      await service.saveEvent(admin, leagueId, eventId, eventForm(2, 'published', { reason: 'Corrected the top two', [`rank:${roster[0].id}`]: 2, [`rank:${roster[1].id}`]: 1 }));
      const event = await service.getEvent(leagueId, eventId, admin);
      assert.equal(event.results[0].memberId, roster[1].id);
      assert.equal(event.history.length, 4);
      assert.equal(event.history[1].snapshot.results[0].memberId, roster[0].id);
      assert.equal(event.history[0].reason, 'Corrected the top two');
      const attempts = await Promise.allSettled([
        service.saveEvent(admin, leagueId, eventId, eventForm(3, 'published', { reason: 'Concurrent A' })),
        service.saveEvent(admin, leagueId, eventId, eventForm(3, 'published', { reason: 'Concurrent B' }))
      ]);
      assert.equal(attempts.filter((result) => result.status === 'fulfilled').length, 1);
      assert.equal(attempts.find((result) => result.status === 'rejected').reason.httpStatusCode, 409);
    });
    await t.test('unpublishing removes totals; republishing restores them without duplication', async () => {
      await service.saveEvent(admin, leagueId, eventId, eventForm(4, 'draft', { reason: 'Review results' }));
      assert.ok((await service.getLeague(leagueId, player)).standings.every((row) => row.points === 0));
      await service.saveEvent(admin, leagueId, eventId, eventForm(5));
      assert.deepEqual((await service.getLeague(leagueId, player)).standings.map((row) => row.points), [7, 4, 3, 2, 1, 1]);
    });
    await t.test('absent members do not affect the participant count', async () => {
      await seedMember(admin, leagueId, form({ userId: accounts[6].id }));
      await service.saveEvent(admin, leagueId, eventId, eventForm(6, 'published', { reason: 'Confirmed attendance' }));
      const view = await service.getLeague(leagueId, player);
      assert.equal(view.standings.find((row) => row.userId === accounts[6].id), undefined);
      assert.equal(view.standings[0].points, 7);
    });
    await t.test('commanders belong to an event, survive omitted fields, and are audited on correction', async () => {
      await seedMember(admin, otherId, form({ userId: accounts[1].id }));
      await seedMember(admin, otherId, form({ userId: accounts[2].id }));
      const otherRoster = (await service.getLeague(otherId, admin)).roster.filter((row) => [accounts[1].id, accounts[2].id].includes(row.userId));
      const id = await service.createEvent(admin, otherId, form({ name: 'Commander test', eventDate: '2026-10-01' }));
      const fields = { name: 'Commander test', eventDate: '2026-10-01', status: 'draft', revision: 0,
        [`rank:${otherRoster[0].id}`]: 1, [`rank:${otherRoster[1].id}`]: 2 };
      const pair = "Yoshimaru, Ever Faithful + Kraum, Ludevic's Opus";
      await rejects(() => service.saveEvent(admin, otherId, id, form({ ...fields, [`commanders:${otherRoster[0].id}`]: 'x'.repeat(301) })), 400);
      await service.saveEvent(admin, otherId, id, form({ ...fields, [`commanders:${otherRoster[0].id}`]: `  ${pair}  `,
        [`commanders:${otherRoster[1].id}`]: 'Nissa, Resurgent Animist' }));
      assert.equal((await service.getEvent(otherId, id, player)).results.length, 0);
      await service.saveEvent(admin, otherId, id, form({ ...fields, revision: 1, status: 'published' }));
      let view = await service.getEvent(otherId, id, player);
      assert.equal(view.results[0].commanders, pair);
      assert.equal(view.results[1].commanders, 'Nissa, Resurgent Animist');
      await service.saveEvent(admin, otherId, id, form({ ...fields, revision: 2, status: 'published', reason: 'Corrected commander names',
        [`commanders:${otherRoster[0].id}`]: 'Asmoranomardicadaistinaculdacar', [`commanders:${otherRoster[1].id}`]: '' }));
      view = await service.getEvent(otherId, id, admin);
      assert.equal(view.results[0].commanders, 'Asmoranomardicadaistinaculdacar');
      assert.equal(view.results[1].commanders, '');
      assert.deepEqual(view.results.map((row) => row.points), [3, 1]);
      assert.equal(view.history[1].snapshot.results[0].commanders, pair);
      assert.equal(view.history[0].snapshot.results[0].commanders, 'Asmoranomardicadaistinaculdacar');
      const participant = accounts.find((account) => account.id === otherRoster[0].userId);
      assert.equal((await service.getLeague(otherId, participant)).myHistory[0].commanders, 'Asmoranomardicadaistinaculdacar');
      assert.ok((await service.getEvent(leagueId, eventId, player)).results.every((row) => row.commanders === ''));
    });
    await t.test('deleted accounts preserve historical results and cannot enter new events', async () => {
      await db`DELETE FROM users WHERE id = ${roster[5].userId}`;
      assert.equal((await service.getLeague(leagueId, player)).standings.find((row) => row.memberId === roster[0].id).points, 7);
      const newEvent = await service.createEvent(admin, leagueId, form({ name: 'Second event', eventDate: '2026-09-19' }));
      await rejects(() => service.saveEvent(admin, leagueId, newEvent, eventForm(0)), 400);
      const preserved = (await service.getLeague(leagueId, player)).standings.find((row) => row.memberId === roster[5].id);
      assert.equal(preserved.userId, null);
      assert.equal(preserved.points, 1);
    });
    await t.test('registered accounts enter results without prior league membership', async () => {
      const id = await service.createLeague(admin, form(settings)); ids.push(id);
      const event = await service.createEvent(admin, id, form({ name: 'Direct entry', eventDate: '2026-09-23' }));
      const fields = { name: 'Direct entry', eventDate: '2026-09-23', revision: 0, status: 'published',
        [`rank:user:${accounts[6].id}`]: 1, [`rank:user:${accounts[7].id}`]: 2, [`commanders:user:${accounts[6].id}`]: 'Nissa' };
      await rejects(() => service.saveEvent(admin, id, event, form({ ...fields, 'rank:user:missing': 3 })), 400);
      assert.equal((await service.getLeague(id, admin)).roster.length, 0);
      const duplicate = form(fields); duplicate.append(`rank:user:${accounts[6].id}`, '3');
      await rejects(() => service.saveEvent(admin, id, event, duplicate), 400);
      await service.saveEvent(admin, id, event, form(fields));
      const view = await service.getLeague(id, player);
      assert.equal(view.standings.length, 2);
      assert.deepEqual(view.standings.map((p) => p.points), [3, 1]);
      assert.equal((await service.getEvent(id, event, admin)).results[0].commanders, 'Nissa');
      const samePlayer = view.standings[0];
      await rejects(() => service.saveEvent(admin, id, event, form({ ...fields, revision: 1, reason: 'Duplicate aliases', [`rank:${samePlayer.memberId}`]: 3 })), 400);
    });
    await t.test('Swiss rounds save atomically, reject stale edits and prepare a publishable draft', async () => {
      const id = await service.createEvent(admin, otherId, form({ name: 'Swiss event', eventDate: '2026-09-23' }));
      const start = () => { const f = form({ operation: 'start', revision: 0, roundCount: 3 }); for (const a of accounts.slice(0, 5)) f.append('player', a.id); return f; };
      await rejects(() => service.changeSwiss(player, otherId, id, start()), 401);
      const duplicate = start(); duplicate.append('player', accounts[1].id);
      await rejects(() => service.changeSwiss(admin, otherId, id, duplicate), 400);
      await service.changeSwiss(admin, otherId, id, start());
      let view = await service.getEvent(otherId, id, player);
      assert.equal(view.event.swiss.rounds.length, 1);
      assert.equal(view.results.length, 0);
      await rejects(() => service.changeSwiss(admin, otherId, id, start()), 409);
      await rejects(() => service.saveEvent(admin, otherId, id, form({ name: 'Swiss event', eventDate: '2026-09-23', revision: 1, status: 'draft' })), 400);
      const partial = form({ operation: 'next', revision: 1 });
      view.event.swiss.rounds[0].matches.forEach((m, i) => partial.set(`score:${i}`, JSON.stringify(m.b ? { aWins: 0, bWins: 0, finished: false } : null)));
      await rejects(() => service.changeSwiss(admin, otherId, id, partial), 400);
      assert.equal((await service.getEvent(otherId, id, admin)).event.revision, 1);
      const invalidScore = new FormData(); for (const [key, value] of partial) invalidScore.set(key, value);
      invalidScore.set('operation', 'save'); invalidScore.set('score:0', JSON.stringify({ aWins: 2, bWins: 2, finished: true }));
      await rejects(() => service.changeSwiss(admin, otherId, id, invalidScore), 400);
      partial.set('operation', 'save');
      partial.set('score:0', JSON.stringify({ aWins: 1, bWins: 0, finished: false }));
      await service.changeSwiss(admin, otherId, id, partial);
      const savedPartial = await service.getEvent(otherId, id, admin);
      assert.deepEqual(savedPartial.event.swiss.rounds[0].matches[0].score, { aWins: 1, bWins: 0, finished: false });
      assert.equal(savedPartial.event.swiss.rounds[0].matches[0].outcome, null);
      assert.equal(savedPartial.history[0].snapshot.swiss.rounds[0].matches[0].score.aWins, 1);
      for (let round = 1; round <= 3; round++) {
        view = await service.getEvent(otherId, id, admin);
        const input = form({ operation: round < 3 ? 'next' : 'finish', revision: view.event.revision });
        view.event.swiss.rounds.at(-1).matches.forEach((m, i) => input.set(`score:${i}`, JSON.stringify(m.b ? { aWins: i % 2 ? 1 : 2, bWins: 1, finished: false } : null)));
        await service.changeSwiss(admin, otherId, id, input);
      }
      view = await service.getEvent(otherId, id, admin);
      assert.equal(view.event.swiss.finished, true);
      assert.equal(view.event.status, 'draft');
      assert.equal(view.results.length, 5);
      assert.equal(view.history[0].snapshot.swiss.rounds.length, 3);
      const publish = form({ name: view.event.name, eventDate: view.event.eventDate, revision: view.event.revision, status: 'published' });
      view.results.forEach((row) => publish.set(`rank:${row.memberId}`, String(row.rank)));
      await service.saveEvent(admin, otherId, id, publish);
      view = await service.getEvent(otherId, id, player);
      assert.equal(view.results.length, 5);
      assert.equal(view.event.status, 'published');
      await rejects(() => service.changeSwiss(admin, otherId, id, form({ operation: 'save', revision: view.event.revision })), 400);
    });
    await t.test('organizers correct earlier rounds, preserving pairings and recalculating published awards', async () => {
      const league = await service.createLeague(admin, form(settings)); ids.push(league);
      const event = await service.createEvent(admin, league, form({ name: 'Corrections', eventDate: '2026-09-23' }));
      const start = form({ operation: 'start', revision: 0, roundCount: 3 });
      accounts.slice(0, 5).forEach((account) => start.append('player', account.id));
      await service.changeSwiss(admin, league, event, start);
      let view = await service.getEvent(league, event, admin);
      const input = (operation, round = view.event.swiss.rounds.length, reverse = false) => {
        const value = form({ operation, round, revision: view.event.revision });
        view.event.swiss.rounds[round - 1].matches.forEach((m, i) => value.set(`score:${i}`, JSON.stringify(m.b ? { aWins: reverse ? 0 : 2, bWins: reverse ? 2 : 0, finished: false } : null)));
        return value;
      };
      for (let i = 0; i < 2; i++) {
        await service.changeSwiss(admin, league, event, input('next'));
        view = await service.getEvent(league, event, admin);
      }
      await service.changeSwiss(admin, league, event, input('save'));
      view = await service.getEvent(league, event, admin);
      const before = structuredClone(view);
      const correction = input('correct', 1, true);
      await rejects(() => service.changeSwiss(player, league, event, correction), 401);
      const invalid = input('correct', 1); invalid.set('score:0', JSON.stringify({ aWins: 0, bWins: 0, finished: false }));
      await rejects(() => service.changeSwiss(admin, league, event, invalid), 400);
      const invalidRound = input('correct', 1); invalidRound.set('round', '4');
      await rejects(() => service.changeSwiss(admin, league, event, invalidRound), 400);
      await service.changeSwiss(admin, league, event, correction);
      await rejects(() => service.changeSwiss(admin, league, event, correction), 409);
      view = await service.getEvent(league, event, admin);
      assert.equal(view.event.revision, before.event.revision + 1);
      assert.equal(view.results.length, 0);
      for (let i = 1; i < 3; i++) assert.deepEqual(view.event.swiss.rounds[i], { ...before.event.swiss.rounds[i], correctedEarlierRounds: [1] });
      assert.equal(view.history[0].snapshot.swiss.rounds[0].matches[0].outcome, 'b');
      assert.equal(view.history[1].snapshot.swiss.rounds[0].matches[0].outcome, 'a');
      assert.equal(view.history[0].actorId, admin.id);
      await service.changeSwiss(admin, league, event, input('finish'));
      view = await service.getEvent(league, event, admin);
      await service.changeSwiss(admin, league, event, input('correct', 3, true));
      view = await service.getEvent(league, event, admin);
      const publish = form({ name: view.event.name, eventDate: view.event.eventDate, revision: view.event.revision, status: 'published' });
      view.results.forEach((row) => publish.set(`rank:${row.memberId}`, String(row.rank)));
      await service.saveEvent(admin, league, event, publish);
      view = await service.getEvent(league, event, admin);
      await db`UPDATE tournament_results SET commanders = 'Updated commander' WHERE event_id = ${event}`;
      const publishedCorrection = input('correct', 1);
      await rejects(() => service.changeSwiss(admin, league, event, publishedCorrection), 400);
      publishedCorrection.set('reason', 'Corrected a reported winner');
      await service.updateLeague(admin, league, form({ ...settings, archived: 'on' }));
      await rejects(() => service.changeSwiss(admin, league, event, publishedCorrection), 400);
      await service.updateLeague(admin, league, form(settings));
      await service.changeSwiss(admin, league, event, publishedCorrection);
      view = await service.getEvent(league, event, admin);
      assert.equal(view.event.status, 'published'); assert.equal(view.event.swiss.finished, true);
      assert.ok(view.results.every((row) => row.commanders === 'Updated commander'));
      const expected = scorePlacements(swissStandings(view.event.swiss)).map(({ memberId, rank, points }) => ({ memberId, rank, points }));
      assert.deepEqual(view.results.map(({ memberId, rank, points }) => ({ memberId, rank, points })), expected);
      const leagueView = await service.getLeague(league, player);
      for (const row of expected) assert.equal(leagueView.standings.find((p) => p.memberId === row.memberId).points, row.points);
      assert.match(view.history[0].reason, /Corrected a reported winner/);
      assert.deepEqual(view.history[0].snapshot.results.map(({ memberId, rank, points }) => ({ memberId, rank, points })), expected);
    });
    await t.test('players report only their current match with independent conflict protection; deletion removes awards', async () => {
      const league = await service.createLeague(admin, form(settings)); ids.push(league);
      const event = await service.createEvent(admin, league, form({ name: 'Player reports', eventDate: '2026-09-23' }));
      const start = form({ operation: 'start', revision: 0, roundCount: 2 });
      accounts.slice(0, 4).forEach((account) => start.append('player', account.id));
      await service.changeSwiss(admin, league, event, start);
      let view = await service.getEvent(league, event, admin);
      const roster = (await service.getLeague(league, admin)).roster;
      const actor = (memberId) => accounts.find((account) => account.id === roster.find((member) => member.id === memberId).userId);
      const report = (index, score = { aWins: 2, bWins: 0, finished: false }) => form({ round: view.event.swiss.rounds.at(-1).number,
        match: index, matchRevision: view.event.swiss.rounds.at(-1).matches[index].revision ?? 0, score: JSON.stringify(score) });
      const [first, second] = view.event.swiss.rounds[0].matches;
      const firstActor = actor(first.a), secondActor = actor(second.a), opponent = actor(first.b);
      const firstInput = report(0), secondInput = report(1);
      await rejects(() => service.reportMatchScore(null, league, event, firstInput), 401);
      await rejects(() => service.reportMatchScore(accounts[6], league, event, firstInput), 403);
      await rejects(() => service.reportMatchScore(firstActor, league, event, secondInput), 403);
      await rejects(() => service.reportMatchScore(firstActor, league, event, report(0, { aWins: 2, bWins: 2, finished: false })), 400);
      await Promise.all([service.reportMatchScore(firstActor, league, event, firstInput), service.reportMatchScore(secondActor, league, event, secondInput)]);
      view = await service.getEvent(league, event, firstActor);
      assert.equal(view.myMemberId, first.a);
      assert.deepEqual(view.event.swiss.rounds[0].matches.map((match) => match.outcome), ['a', 'a']);
      await rejects(() => service.reportMatchScore(opponent, league, event, firstInput), 409);
      const concurrent = report(0, { aWins: 0, bWins: 2, finished: false });
      const attempts = await Promise.allSettled([service.reportMatchScore(firstActor, league, event, concurrent), service.reportMatchScore(opponent, league, event, concurrent)]);
      assert.equal(attempts.filter((attempt) => attempt.status === 'fulfilled').length, 1);
      assert.equal(attempts.find((attempt) => attempt.status === 'rejected').reason.httpStatusCode, 409);
      view = await service.getEvent(league, event, admin);
      assert.equal(view.history[0].snapshot.swiss.rounds[0].matches[0].outcome, 'b');
      assert.ok([firstActor.id, opponent.id].includes(view.history[0].actorId));
      const beforeAdmin = report(0);
      const roundInput = (operation) => {
        const input = form({ operation, revision: view.event.revision });
        view.event.swiss.rounds.at(-1).matches.forEach((match, index) => input.set(`score:${index}`, JSON.stringify(match.b ? { aWins: 2, bWins: 1, finished: false } : null)));
        return input;
      };
      await service.changeSwiss(admin, league, event, roundInput('save'));
      await rejects(() => service.reportMatchScore(firstActor, league, event, beforeAdmin), 409);
      view = await service.getEvent(league, event, admin);
      const beforeNext = report(0);
      await service.changeSwiss(admin, league, event, roundInput('next'));
      await rejects(() => service.reportMatchScore(firstActor, league, event, beforeNext), 409);
      view = await service.getEvent(league, event, admin);
      const lastActor = actor(view.event.swiss.rounds.at(-1).matches[0].a), beforeFinish = report(0);
      await service.changeSwiss(admin, league, event, roundInput('finish'));
      await rejects(() => service.reportMatchScore(lastActor, league, event, beforeFinish), 400);
      view = await service.getEvent(league, event, admin);
      const publish = form({ name: view.event.name, eventDate: view.event.eventDate, revision: view.event.revision, status: 'published' });
      view.results.forEach((row) => publish.set(`rank:${row.memberId}`, String(row.rank)));
      await service.saveEvent(admin, league, event, publish);
      view = await service.getEvent(league, event, admin);
      assert.equal((await service.getLeague(league, admin)).standings.length, 4);
      const deletion = form({ revision: view.event.revision, confirm: 'delete' });
      await rejects(() => service.deleteEvent(player, league, event, deletion), 401);
      await rejects(() => service.deleteEvent(admin, league, event, form({ revision: view.event.revision })), 400);
      await rejects(() => service.deleteEvent(admin, league, event, form({ revision: 0, confirm: 'delete' })), 409);
      await rejects(() => service.deleteEvent(admin, otherId, event, deletion), 404);
      await service.updateLeague(admin, league, form({ ...settings, archived: 'on' }));
      await rejects(() => service.deleteEvent(admin, league, event, deletion), 400);
      await service.updateLeague(admin, league, form(settings));
      await service.deleteEvent(admin, league, event, deletion);
      await rejects(() => service.getEvent(league, event, admin), 404);
      await rejects(() => service.deleteEvent(admin, league, event, deletion), 404);
      await rejects(() => service.reportMatchScore(lastActor, league, event, beforeFinish), 404);
      await rejects(() => service.saveEvent(admin, league, event, publish), 404);
      await rejects(() => service.changeSwiss(admin, league, event, form({ operation: 'save', revision: view.event.revision })), 404);
      const after = await service.getLeague(league, admin);
      assert.equal(after.events.length, 0); assert.equal(after.standings.length, 0); assert.equal(after.myHistory.length, 0);
      assert.equal((await service.listLeagues(admin)).find((row) => row.id === league).memberCount, 0);
      const [audit] = await db`SELECT snapshot FROM tournament_event_history WHERE event_id = ${event} ORDER BY revision DESC LIMIT 1`;
      assert.equal(audit.snapshot.deleted, true); assert.equal(audit.snapshot.results.length, 4);
      const draft = await service.createEvent(admin, league, form({ name: 'Delete draft', eventDate: '2026-09-23' }));
      await service.deleteEvent(admin, league, draft, form({ revision: 0, confirm: 'delete' }));
      const active = await service.createEvent(admin, league, form({ name: 'Delete active event', eventDate: '2026-09-23' }));
      const oddStart = form({ operation: 'start', revision: 0, roundCount: 1 });
      accounts.slice(0, 3).forEach((account) => oddStart.append('player', account.id));
      await service.changeSwiss(admin, league, active, oddStart);
      const odd = await service.getEvent(league, active, admin);
      const byeIndex = odd.event.swiss.rounds[0].matches.findIndex((match) => !match.b);
      const byeActor = actor(odd.event.swiss.rounds[0].matches[byeIndex].a);
      await rejects(() => service.reportMatchScore(byeActor, league, active, form({ round: 1, match: byeIndex, matchRevision: 0, score: JSON.stringify({ aWins: 2, bWins: 0, finished: false }) })), 403);
      await service.deleteEvent(admin, league, active, form({ revision: 1, confirm: 'delete' }));
    });
    await t.test('archiving prevents writes, and date edits must include events', async () => {
      await rejects(() => service.updateLeague(admin, leagueId, form({ ...settings, endsOn: '2026-09-11' })), 400);
      await service.updateLeague(admin, leagueId, form({ ...settings, archived: 'on' }));
      await rejects(() => service.createEvent(admin, leagueId, form({ name: 'Archived', eventDate: '2026-09-20' })), 400);
      await rejects(() => service.saveEvent(admin, leagueId, eventId, eventForm(7, 'published', { reason: 'Archived' })), 400);
      await service.updateLeague(admin, leagueId, form(settings));
      assert.equal((await service.getLeague(leagueId, player)).league.archived, false);
    });
  } finally {
    for (const id of ids) {
      await db`DELETE FROM tournament_event_history WHERE event_id IN (SELECT id FROM tournament_events WHERE league_id = ${id})`;
      await db`DELETE FROM tournament_results WHERE league_id = ${id}`;
      await db`DELETE FROM tournament_events WHERE league_id = ${id}`;
      await db`DELETE FROM tournament_members WHERE league_id = ${id}`;
      await db`DELETE FROM tournament_leagues WHERE id = ${id}`;
    }
    for (const user of accounts) await db`DELETE FROM users WHERE id = ${user.id}`;
    await dbModule.getSqlClient().end();
    await vite.close();
    await db.end();
  }
});
