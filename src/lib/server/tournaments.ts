import { randomUUID, randomInt } from 'node:crypto';
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import { redirect, fail } from '@sveltejs/kit';
import { bo3Outcome, updateMatchScore, pairSwissRound, roundComplete, setRoundResults, correctRoundResults, swissStandings, type SwissState } from '../swiss';
import { rankStandings, scorePlacements, SCORING_VERSION, type Placement } from '../tournament';
import { AppError, isAppError } from './app-error';
import { ensureAdmin, type AppUser } from './auth';
import { getWriteDb } from './db';
import { tournamentLeagues as leagues, tournamentMembers as members, tournamentEvents as events,
  tournamentResults as results, tournamentEventHistory as history, users, type TournamentSnapshot } from './db-schema';

function invalid(message: string, status = 400): never {
  throw new AppError({ userFacingError: message, adminFacingError: message, errorTypeName: 'TournamentError', httpStatusCode: status });
}

export function requireTournamentUser(user: AppUser | null | undefined): AppUser {
  if (!user) throw redirect(303, '/');
  return user;
}

export function tournamentFailure(error: unknown) {
  if (isAppError(error)) return fail(error.httpStatusCode, { error: error.userFacingError });
  console.error('[tournament] action failed', error);
  return fail(500, { error: 'Could not save changes. Please retry.' });
}

function textField(value: FormDataEntryValue | null, label: string, max: number, optional = false): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if ((!optional && !text) || text.length > max) invalid(`${label} must be ${optional ? '0' : '1'}–${max} characters.`);
  return text;
}

function dateField(value: FormDataEntryValue | null): string {
  const raw = String(value || '');
  const date = new Date(`${raw}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== raw) {
    invalid('Enter a valid date.');
  }
  return raw;
}

function leagueInput(form: FormData) {
  const input = { name: textField(form.get('name'), 'League name', 120), description: textField(form.get('description'), 'Description', 3000, true),
    startsOn: dateField(form.get('startsOn')), endsOn: dateField(form.get('endsOn')) };
  if (input.endsOn < input.startsOn) invalid('The end date must be on or after the start date.');
  return input;
}

export async function createLeague(user: AppUser | null, form: FormData) {
  ensureAdmin(user);
  const id = randomUUID();
  await getWriteDb().insert(leagues).values({ id, ...leagueInput(form) });
  return id;
}

type Transaction = Parameters<Parameters<ReturnType<typeof getWriteDb>['transaction']>[0]>[0];
async function lockLeague(tx: Transaction, id: string, allowArchived = false) {
  const [league] = await tx.select().from(leagues).where(eq(leagues.id, id)).for('update');
  if (!league) invalid('League not found.', 404);
  if (league.archived && !allowArchived) invalid('Reopen this league before making changes.');
  return league;
}

export async function updateLeague(user: AppUser | null, id: string, form: FormData) {
  ensureAdmin(user);
  const input = leagueInput(form);
  await getWriteDb().transaction(async (tx) => {
    await lockLeague(tx, id, true);
    const existingEvents = await tx.select({ date: events.eventDate }).from(events).where(and(eq(events.leagueId, id), isNull(events.deletedAt)));
    if (existingEvents.some((event) => event.date < input.startsOn || event.date > input.endsOn)) {
      invalid('League dates must include all existing events.');
    }
    await tx.update(leagues).set({ ...input, archived: form.get('archived') === 'on' }).where(eq(leagues.id, id));
  });
}

export async function createEvent(user: AppUser | null, leagueId: string, form: FormData) {
  const admin = ensureAdmin(user);
  const name = textField(form.get('name'), 'Event name', 120);
  const eventDate = dateField(form.get('eventDate'));
  const id = randomUUID();
  await getWriteDb().transaction(async (tx) => {
    const league = await lockLeague(tx, leagueId);
    if (eventDate < league.startsOn || eventDate > league.endsOn) invalid('The event date must fall within the league dates.');
    await tx.insert(events).values({ id, leagueId, name, eventDate });
    await tx.insert(history).values({ id: randomUUID(), eventId: id, revision: 0, actorId: admin.id, actorName: admin.displayName || admin.username,
      snapshot: { name, eventDate, status: 'draft', scoringVersion: SCORING_VERSION, results: [] } });
  });
  return id;
}

export async function deleteEvent(user: AppUser | null, leagueId: string, eventId: string, form: FormData) {
  const admin = ensureAdmin(user);
  const revision = Number(form.get('revision'));
  if (form.get('confirm') !== 'delete' || !form.has('revision') || !Number.isInteger(revision) || revision < 0) invalid('Confirm tournament deletion.');
  await getWriteDb().transaction(async (tx) => {
    await lockLeague(tx, leagueId);
    const [event] = await tx.select().from(events).where(and(eq(events.id, eventId), eq(events.leagueId, leagueId), isNull(events.deletedAt))).for('update');
    if (!event) invalid('Event not found.', 404);
    if (event.revision !== revision) invalid('This tournament changed. Reload before deleting it.', 409);
    const saved = await tx.select({ memberId: results.memberId, rank: results.rank, points: results.points, commanders: results.commanders,
      name: sql<string>`coalesce(nullif(${users.displayName}, ''), ${users.username}, ${members.name})` })
      .from(results).innerJoin(members, eq(results.memberId, members.id)).leftJoin(users, eq(members.userId, users.id))
      .where(eq(results.eventId, eventId)).orderBy(asc(results.rank));
    const snapshot: TournamentSnapshot = { name: event.name, eventDate: event.eventDate, status: event.status,
      scoringVersion: event.scoringVersion, swiss: event.swiss, results: saved, deleted: true };
    const now = new Date();
    await tx.update(events).set({ deletedAt: now, updatedAt: now, revision: revision + 1 }).where(eq(events.id, eventId));
    await tx.insert(history).values({ id: randomUUID(), eventId, revision: revision + 1, actorId: admin.id,
      actorName: admin.displayName || admin.username, reason: 'Tournament deleted', snapshot });
  });
}

export async function saveEvent(user: AppUser | null, leagueId: string, eventId: string, form: FormData) {
  const admin = ensureAdmin(user);
  const name = textField(form.get('name'), 'Event name', 120);
  const eventDate = dateField(form.get('eventDate'));
  const reason = textField(form.get('reason'), 'Correction reason', 1000, true);
  const status = String(form.get('status'));
  const revision = Number(form.get('revision'));
  if (!['draft', 'published'].includes(status) || !form.has('revision') || !Number.isInteger(revision) || revision < 0) invalid('Invalid event state.');
  const placements: Placement[] = [];
  for (const [key, value] of form.entries()) {
    if (key.startsWith('rank:') && String(value).trim()) placements.push({ memberId: key.slice(5), rank: Number(value) });
  }
  let scored: ReturnType<typeof scorePlacements>;
  try { scored = scorePlacements(placements); } catch (error) { invalid((error as Error).message); }
  if (status === 'published' && scored.length < 2) invalid('An event needs at least two participants to publish results.');
  await getWriteDb().transaction(async (tx) => {
    const league = await lockLeague(tx, leagueId);
    const [event] = await tx.select().from(events).where(and(eq(events.id, eventId), eq(events.leagueId, leagueId), isNull(events.deletedAt))).for('update');
    if (!event) invalid('Event not found.', 404);
    if (event.revision !== revision) invalid('Another person changed this event. Reload the page before saving.', 409);
    if (event.swiss && !event.swiss.finished) invalid('Finish Swiss rounds before editing final placements.');
    if (event.scoringVersion !== SCORING_VERSION) invalid('This event uses an unsupported scoring version.');
    if (event.status === 'published' && !reason) invalid('Explain the correction or why results are being unpublished.');
    if (eventDate < league.startsOn || eventDate > league.endsOn) invalid('The event date must fall within the league dates.');
    // Resolve registered accounts within the same transaction as their results.
    for (const row of scored) {
      if (!row.memberId.startsWith('user:')) continue;
      const userId = row.memberId.slice(5);
      const [player] = await tx.select().from(users).where(eq(users.id, userId));
      if (!player) invalid('Select a registered Karton player.');
      const [member] = await tx.insert(members).values({ id: randomUUID(), leagueId, userId, name: player.displayName || player.username })
        .onConflictDoUpdate({ target: [members.leagueId, members.userId], set: { active: true } }).returning();
      const sourceId = row.memberId;
      row.memberId = member.id;
      if (form.has(`commanders:${sourceId}`)) form.set(`commanders:${member.id}`, String(form.get(`commanders:${sourceId}`)));
    }
    try { scored = scorePlacements(scored); } catch (error) { invalid((error as Error).message); }
    const roster = await tx.select({ id: members.id, userId: members.userId, active: members.active,
      name: sql<string>`coalesce(nullif(${users.displayName}, ''), ${users.username}, ${members.name})` })
      .from(members).leftJoin(users, eq(members.userId, users.id)).where(eq(members.leagueId, leagueId));
    const oldResults = await tx.select({ memberId: results.memberId, commanders: results.commanders }).from(results).where(eq(results.eventId, eventId));
    const oldIds = new Set(oldResults.map((row) => row.memberId));
    const eligible = new Map(roster.filter((member) => member.userId || oldIds.has(member.id)).map((member) => [member.id, member]));
    if (scored.some((row) => !eligible.has(row.memberId))) invalid('Select registered Karton players or preserve existing historical results.');
    const previousCommanders = new Map(oldResults.map((row) => [row.memberId, row.commanders]));
    const awards = scored.map((row) => ({
      ...row,
      commanders: form.has(`commanders:${row.memberId}`)
        ? textField(form.get(`commanders:${row.memberId}`), 'Commander names', 300, true)
        : previousCommanders.get(row.memberId) ?? ''
    }));
    const snapshot: TournamentSnapshot = { swiss: event.swiss, name, eventDate, status: status as 'draft' | 'published', scoringVersion: event.scoringVersion,
      results: awards.map((row) => ({ ...row, name: eligible.get(row.memberId)!.name })) };
    await tx.delete(results).where(eq(results.eventId, eventId));
    if (awards.length) await tx.insert(results).values(awards.map((row) => ({ ...row, id: randomUUID(), leagueId, eventId })));
    await tx.update(events).set({ name, eventDate, status: snapshot.status, revision: revision + 1, updatedAt: new Date() }).where(eq(events.id, eventId));
    await tx.insert(history).values({ id: randomUUID(), eventId, revision: revision + 1, actorId: admin.id,
      actorName: admin.displayName || admin.username, reason, snapshot });
  });
}

export async function changeSwiss(user: AppUser | null, leagueId: string, eventId: string, form: FormData) {
  const admin = ensureAdmin(user);
  const action = String(form.get('operation'));
  const revision = Number(form.get('revision'));
  if (!form.has('revision') || !Number.isInteger(revision) || revision < 0) invalid('Invalid event revision.');
  await getWriteDb().transaction(async (tx) => {
    await lockLeague(tx, leagueId);
    const [event] = await tx.select().from(events).where(and(eq(events.id, eventId), eq(events.leagueId, leagueId), isNull(events.deletedAt))).for('update');
    if (!event) invalid('Event not found.', 404);
    if (event.revision !== revision) invalid('Another person changed this event. Reload the page before saving.', 409);
    if (event.status === 'published' && action !== 'correct') invalid('Published results cannot be changed through Swiss rounds.');
    const correctionReason = action === 'correct' ? textField(form.get('reason'), 'Correction reason', 1000, true) : '';
    if (event.status === 'published' && !correctionReason) invalid('Explain the score correction.');
    let state: SwissState;
    if (action === 'start') {
      if (event.swiss) invalid('Swiss rounds have already started.');
      const existing = await tx.select().from(results).where(eq(results.eventId, eventId));
      if (existing.length) invalid('This event already has results. Create a separate event for Swiss rounds.');
      const ids = form.getAll('player').map(String);
      const roundCount = Number(form.get('roundCount'));
      if (ids.length < 2 || ids.length > 128 || new Set(ids).size !== ids.length) invalid('Select 2–128 different registered players.');
      if (!Number.isInteger(roundCount) || roundCount < 1 || roundCount > Math.min(16, ids.length - 1)) invalid('Choose between 1 and min(16, players − 1) rounds.');
      const players: SwissState['players'] = [];
      for (const id of ids) {
        const [account] = await tx.select().from(users).where(eq(users.id, id));
        if (!account) invalid('Select registered Karton players.');
        const [member] = await tx.insert(members).values({ id: randomUUID(), leagueId, userId: id, name: account.displayName || account.username })
          .onConflictDoUpdate({ target: [members.leagueId, members.userId], set: { active: true } }).returning();
        players.push({ memberId: member.id, name: account.displayName || account.username,
          commanders: textField(form.get(`commanders:${id}`), 'Commander names', 300, true) });
      }
      // Persist a random seed order once; pairing and standings remain stable on reload.
      for (let i = players.length - 1; i > 0; i--) { const j = randomInt(i + 1); [players[i], players[j]] = [players[j], players[i]]; }
      state = { players, roundCount, rounds: [], finished: false };
      state.rounds.push(pairSwissRound(state, new Date().toISOString()));
    } else {
      if (!event.swiss || (event.swiss.finished && action !== 'correct')) invalid('This event has no active Swiss rounds.');
      state = structuredClone(event.swiss);
      if (!['save', 'next', 'finish', 'correct'].includes(action)) invalid('Unknown Swiss action.');
      try {
        const roundNumber = action === 'correct' ? Number(form.get('round')) : state.rounds.length;
        const round = state.rounds.find((round) => round.number === roundNumber);
        if (!round) invalid('Select a valid round.');
        const scores = round.matches.map((_, index) => {
          const raw = form.get(`score:${index}`);
          if (typeof raw !== 'string') invalid('Submit each match score.');
          try { return JSON.parse(raw); } catch { invalid('Invalid match score.'); }
        });
        state = action === 'correct' ? correctRoundResults(state, roundNumber, scores) : setRoundResults(state, scores, action !== 'save');
        if (action === 'next') state.rounds.push(pairSwissRound(state, new Date().toISOString()));
        if (action === 'finish') {
          if (state.rounds.length !== state.roundCount || !state.rounds.every(roundComplete)) invalid('Complete all scheduled rounds before reviewing final standings.');
          state.finished = true;
        }
      } catch (error) { if (isAppError(error)) throw error; invalid((error as Error).message); }
      if (action === 'finish' || (action === 'correct' && state.finished)) {
        if (event.scoringVersion !== SCORING_VERSION) invalid('This event uses an unsupported scoring version.');
        const awards = scorePlacements(swissStandings(state));
        const savedCommanders = new Map((await tx.select().from(results).where(eq(results.eventId, eventId)))
          .map((row) => [row.memberId, row.commanders]));
        await tx.delete(results).where(eq(results.eventId, eventId));
        await tx.insert(results).values(awards.map((row) => ({ id: randomUUID(), leagueId, eventId, memberId: row.memberId, rank: row.rank, points: row.points,
          commanders: savedCommanders.get(row.memberId) ?? state.players.find((player) => player.memberId === row.memberId)!.commanders })));
      }
    }
    await persistSwiss(tx, event, state, admin, action === 'correct'
      ? `Swiss: corrected round ${form.get('round')}${correctionReason ? ` — ${correctionReason}` : ''}` : `Swiss: ${action}`);
  });
}

async function persistSwiss(tx: Transaction, event: typeof events.$inferSelect, state: SwissState, actor: AppUser, reason: string) {
  const savedResults = await tx.select().from(results).where(eq(results.eventId, event.id)).orderBy(asc(results.rank));
  const snapshot: TournamentSnapshot = { name: event.name, eventDate: event.eventDate, status: event.status, scoringVersion: event.scoringVersion, swiss: state,
    results: savedResults.map((row) => ({ memberId: row.memberId, rank: row.rank, points: row.points, commanders: row.commanders,
      name: state.players.find((player) => player.memberId === row.memberId)!.name })) };
  await tx.update(events).set({ swiss: state, revision: event.revision + 1, updatedAt: new Date() }).where(eq(events.id, event.id));
  await tx.insert(history).values({ id: randomUUID(), eventId: event.id, revision: event.revision + 1, actorId: actor.id,
    actorName: actor.displayName || actor.username, reason, snapshot });
}

export async function reportMatchScore(user: AppUser | null, leagueId: string, eventId: string, form: FormData) {
  if (!user) invalid('Sign in to enter your match score.', 401);
  const roundNumber = Number(form.get('round'));
  const matchIndex = Number(form.get('match'));
  const matchRevision = Number(form.get('matchRevision'));
  if (!['round', 'match', 'matchRevision'].every((field) => form.has(field)) || !Number.isInteger(roundNumber) || roundNumber < 1
    || !Number.isInteger(matchIndex) || matchIndex < 0 || !Number.isInteger(matchRevision) || matchRevision < 0) invalid('Invalid match.');
  await getWriteDb().transaction(async (tx) => {
    await lockLeague(tx, leagueId);
    const [event] = await tx.select().from(events).where(and(eq(events.id, eventId), eq(events.leagueId, leagueId), isNull(events.deletedAt))).for('update');
    if (!event) invalid('Event not found.', 404);
    if (event.status !== 'draft' || !event.swiss || event.swiss.finished) invalid('This tournament no longer accepts match scores.');
    const state = structuredClone(event.swiss);
    const round = state.rounds[state.rounds.length - 1];
    if (round.number !== roundNumber) invalid('The round has changed. Reload before entering a score.', 409);
    const match = round.matches[matchIndex];
    const [member] = await tx.select({ id: members.id }).from(members).where(and(eq(members.leagueId, leagueId), eq(members.userId, user.id)));
    if (!match || !match.b || !member || (member.id !== match.a && member.id !== match.b)) invalid('You can only enter a score for your own current match.', 403);
    if ((match.revision ?? 0) !== matchRevision) invalid('This match score changed. Reload before saving.', 409);
    try {
      const score = JSON.parse(String(form.get('score') ?? ''));
      bo3Outcome(score);
      // Only the organizer can finalize partial scores by advancing the round.
      round.matches[matchIndex] = updateMatchScore(match, { ...score, finished: false });
    } catch (error) { invalid(error instanceof SyntaxError ? 'Invalid match score.' : (error as Error).message); }
    await persistSwiss(tx, event, state, user, `Swiss: player score, round ${roundNumber}, table ${matchIndex + 1}`);
  });
}

async function leagueRoster(leagueId?: string) {
  return getWriteDb().select({ id: members.id, leagueId: members.leagueId, userId: members.userId, active: members.active,
    name: sql<string>`coalesce(nullif(${users.displayName}, ''), ${users.username}, ${members.name})` })
    .from(members).leftJoin(users, eq(members.userId, users.id)).where(leagueId ? eq(members.leagueId, leagueId) : undefined).orderBy(asc(members.name));
}

async function publishedTotals(leagueId?: string) {
  return getWriteDb().select({ memberId: results.memberId, points: sql<number>`coalesce(sum(${results.points}), 0)::int`, attendance: sql<number>`count(*)::int` })
    .from(results).innerJoin(events, eq(results.eventId, events.id))
    .where(and(isNull(events.deletedAt), eq(events.status, 'published'), leagueId ? eq(events.leagueId, leagueId) : undefined)).groupBy(results.memberId);
}

function standingsFor(roster: Awaited<ReturnType<typeof leagueRoster>>, totals: Awaited<ReturnType<typeof publishedTotals>>) {
  const totalsById = new Map(totals.map((row) => [row.memberId, row]));
  return rankStandings(roster.map((member) => ({ ...member, memberId: member.id, points: totalsById.get(member.id)?.points ?? 0,
    attendance: totalsById.get(member.id)?.attendance ?? 0 })).filter((row) => row.attendance > 0));
}

export async function listLeagues(user: AppUser) {
  const db = getWriteDb();
  const [all, roster, totals] = await Promise.all([db.select().from(leagues).orderBy(asc(leagues.archived), desc(leagues.startsOn)), leagueRoster(), publishedTotals()]);
  return all.map((league) => {
    const leagueMembers = roster.filter((member) => member.leagueId === league.id);
    const standings = standingsFor(leagueMembers, totals);
    return { ...league, memberCount: standings.length,
      mine: standings.find((row) => row.userId === user.id) ?? null };
  }).sort((a, b) => Number(a.archived) - Number(b.archived) || Number(Boolean(b.mine)) - Number(Boolean(a.mine)) || b.startsOn.localeCompare(a.startsOn));
}

export async function getLeague(leagueId: string, user: AppUser) {
  const db = getWriteDb();
  const [league] = await db.select().from(leagues).where(eq(leagues.id, leagueId));
  if (!league) invalid('League not found.', 404);
  const [roster, totals, leagueEvents] = await Promise.all([leagueRoster(leagueId), publishedTotals(leagueId),
    db.select().from(events).where(and(eq(events.leagueId, leagueId), isNull(events.deletedAt))).orderBy(desc(events.eventDate), asc(events.id))]);
  const standings = standingsFor(roster, totals);
  const mine = standings.find((row) => row.userId === user.id) ?? null;
  const myHistory = mine ? await db.select({ eventId: events.id, eventName: events.name, eventDate: events.eventDate, rank: results.rank, points: results.points, commanders: results.commanders })
    .from(results).innerJoin(events, eq(results.eventId, events.id))
    .where(and(eq(results.memberId, mine.memberId), eq(events.status, 'published'), isNull(events.deletedAt))).orderBy(desc(events.eventDate), asc(events.id)) : [];
  return { league, roster, standings, events: leagueEvents, mine, myHistory };
}

export async function getEvent(leagueId: string, eventId: string, user: AppUser) {
  const db = getWriteDb();
  const admin = user.role === 'admin' || user.role === 'superadmin';
  const [league] = await db.select().from(leagues).where(eq(leagues.id, leagueId));
  const [event] = await db.select().from(events).where(and(eq(events.leagueId, leagueId), eq(events.id, eventId), isNull(events.deletedAt)));
  if (!league || !event) invalid('Event not found.', 404);
  const roster = await leagueRoster(leagueId);
  const eventResults = admin || event.status === 'published' ? await db.select().from(results).where(eq(results.eventId, eventId)).orderBy(asc(results.rank)) : [];
  const resultIds = new Set(eventResults.map((row) => row.memberId));
  const revisions = admin ? await db.select().from(history).where(eq(history.eventId, eventId)).orderBy(desc(history.revision)) : [];
  const accounts = admin ? await db.select({ id: users.id, name: sql<string>`coalesce(nullif(${users.displayName}, ''), ${users.username})`, username: users.username }).from(users).orderBy(asc(users.username)) : [];
  return { league, event, myMemberId: roster.find((member) => member.userId === user.id)?.id ?? null, results: eventResults.map((row) => ({ ...row, name: roster.find((member) => member.id === row.memberId)!.name })),
    roster: admin ? [...accounts.map((account) => ({ id: roster.find((member) => member.userId === account.id)?.id ?? `user:${account.id}`, userId: account.id, name: account.name, username: account.username })), ...roster.filter((row) => !row.userId && (resultIds.has(row.id) || event.swiss?.players.some((player) => player.memberId === row.id))).map((row) => ({ ...row, username: '' }))] : [], history: revisions };
}
