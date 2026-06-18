import { boolean, bigserial, date, doublePrecision, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import type { AnalyzeOutput } from './types';

export const mtgtop8Commanders = pgTable(
  'mtgtop8_commanders',
  {
    slug: text('slug').primaryKey(),
    commanderName: text('commander_name').notNull(),
    commanderUrl: text('commander_url').notNull(),
    moxfieldCommanderQuery: text('moxfield_commander_query').notNull(),
    matchScore: doublePrecision('match_score').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [uniqueIndex('mtgtop8_commanders_commander_url_unique').on(table.commanderUrl)]
);

export const mtgtop8Decks = pgTable(
  'mtgtop8_decks',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    commanderSlug: text('commander_slug')
      .notNull()
      .references(() => mtgtop8Commanders.slug, { onDelete: 'cascade' }),
    deckUrl: text('deck_url').notNull(),
    pageUrl: text('page_url').notNull(),
    deckName: text('deck_name').notNull(),
    playerName: text('player_name').notNull(),
    eventName: text('event_name').notNull(),
    eventLevel: text('event_level').notNull(),
    deckRank: text('deck_rank').notNull(),
    eventDate: date('event_date', { mode: 'string' }).notNull(),
    eventDateRaw: text('event_date_raw').notNull(),
    cardsJson: jsonb('cards_json').$type<Record<string, number>>().notNull(),
    sectionsJson: jsonb('sections_json').$type<Record<string, Record<string, number>>>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex('mtgtop8_decks_deck_url_unique').on(table.deckUrl),
    index('idx_mtgtop8_decks_commander_date').on(table.commanderSlug, table.eventDate),
    index('idx_mtgtop8_decks_commander_deck_url').on(table.commanderSlug, table.deckUrl)
  ]
);

export const analysisRuns = pgTable(
  'analysis_runs',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    shareId: text('share_id').notNull(),
    moxfieldUrl: text('moxfield_url').notNull(),
    commanderName: text('commander_name'),
    ignoreBefore: date('ignore_before', { mode: 'string' }),
    ignoreAfter: date('ignore_after', { mode: 'string' }),
    clientIp: text('client_ip').notNull().default('unknown'),
    userId: text('user_id'),
    traceId: text('trace_id'),
    payloadJson: jsonb('payload_json').$type<AnalyzeOutput>().notNull(),
    inputJson: jsonb('input_json')
      .$type<{
        startDate: string;
        endDate: string;
        keepTop: string;
        cutTop: string;
        addTop: string;
      }>()
      .notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex('analysis_runs_share_id_unique').on(table.shareId),
    index('idx_analysis_runs_user_created_at').on(table.userId, table.createdAt),
    index('idx_analysis_runs_created_at').on(table.createdAt)
  ]
);

export const duelCommanderBanlistCache = pgTable(
  'duel_commander_banlist_cache',
  {
    key: text('key').primaryKey(),
    sourceUrl: text('source_url').notNull(),
    cardsJson: jsonb('cards_json').$type<string[]>().notNull(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [index('idx_duel_commander_banlist_cache_fetched_at').on(table.fetchedAt)]
);

export const users = pgTable(
  'users',
  {
    id: text('id').primaryKey(),
    username: text('username').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    isSuperadmin: boolean('is_superadmin').notNull().default(false),
    role: text('role').notNull().default('user'),
    displayName: text('display_name'),
    createdByUserId: text('created_by_user_id')
  },
  (table) => [uniqueIndex('users_username_unique').on(table.username)]
);

export const userLoginLinks = pgTable(
  'user_login_links',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    token: text('token').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true })
  },
  (table) => [
    uniqueIndex('user_login_links_token_unique').on(table.token),
    index('idx_user_login_links_user_id').on(table.userId)
  ]
);

export const userSessions = pgTable(
  'user_sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    sessionToken: text('session_token').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true })
  },
  (table) => [
    uniqueIndex('user_sessions_token_unique').on(table.sessionToken),
    index('idx_user_sessions_user_id').on(table.userId)
  ]
);

export const userCardLists = pgTable(
  'user_card_lists',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    label: text('label'),
    url: text('url').notNull(),
    position: integer('position').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index('idx_user_card_lists_user_kind').on(table.userId, table.kind),
    index('idx_user_card_lists_kind').on(table.kind)
  ]
);
