<script lang="ts">
  import TournamentSwiss from '$lib/components/TournamentSwiss.svelte';
  import TournamentPlayerPicker from '$lib/components/TournamentPlayerPicker.svelte';
  import Icon from "$lib/components/Icon.svelte";
  import { enhance } from '$app/forms';
  import { t } from '$lib/i18n';
  import { scorePlacements } from '$lib/tournament';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import TournamentRules from '$lib/components/TournamentRules.svelte';
  import TournamentCommanderPicker from '$lib/components/TournamentCommanderPicker.svelte';
  import type { PageData, ActionData } from './$types';
  export let data: PageData;
  export let form: ActionData;
  let entries: { key: number; memberId: string }[] = [];
  let nextKey = 0;
  let commanders: Record<string, string> = {};
  let loadedVersion = '';
  let saving = false;
  let entryMode: 'players' | 'results' | 'swiss' = 'players';
  let roundCount = 1;
  let confirmingDelete = false;
  let deleting = false;
  $: if (loadedVersion !== `${data.event.id}:${data.event.revision}`) {
    if (!loadedVersion.startsWith(`${data.event.id}:`)) entryMode = 'players';
    if (data.results.length || data.event.swiss?.finished) entryMode = 'results';
    commanders = Object.fromEntries(data.results.map((row) => [row.memberId, row.commanders]));
    entries = data.results.map((row) => ({ key: nextKey++, memberId: row.memberId }));
    if (!entries.length) entries = [{ key: nextKey++, memberId: '' }, { key: nextKey++, memberId: '' }];
    loadedVersion = `${data.event.id}:${data.event.revision}`;
  }
  $: choosingMode = !data.event.swiss && !data.results.length && data.event.status === 'draft';
  $: manualResults = !choosingMode || entryMode === 'results';
  $: playersValid = entries.length >= 2 && entries.every((entry) => entry.memberId) && new Set(entries.map((entry) => entry.memberId)).size === entries.length;
  $: swissValid = playersValid && entries.length <= 128 && entries.every((entry) => data.roster.some((player) => player.id === entry.memberId && player.userId));
  $: maxRounds = Math.max(1, Math.min(16, entries.length - 1));
  $: if (roundCount > maxRounds) roundCount = maxRounds;
  $: preview = getPreview(entries);
  $: participantCount = entries.filter((entry) => entry.memberId).length;
  function moveEntry(index: number, direction: number) {
    const next = [...entries];
    [next[index], next[index + direction]] = [next[index + direction], next[index]];
    entries = next;
  }
  function getPreview(values: typeof entries) {
    if (values.some((entry) => !entry.memberId)) return null;
    try { return scorePlacements(values.map((entry, index) => ({ memberId: entry.memberId, rank: index + 1 }))); }
    catch { return null; }
  }

</script>

<svelte:head><title>{data.event.name} - {data.league.name} - Karton</title></svelte:head>
<main class="t-page">
  <a class="t-muted" href={`/tournament/${data.league.id}`}>← {$t('tournament.viewLeague')} · {data.league.name}</a>
  <PageHeader title={data.event.name} subtitle={`${data.event.eventDate} · ${data.league.name}`}>
    <div slot="actions" class="t-row">
      <span class="t-badge">{$t(data.event.status === 'published' ? 'tournament.published' : 'tournament.draft')}</span>
      {#if data.admin && !data.league.archived}
        <button type="button" class="ui-icon-button ui-icon-danger" aria-label={$t('tournament.deleteEvent')} title={$t('tournament.deleteEvent')}
          on:click={() => confirmingDelete = !confirmingDelete}><Icon name="trash" /></button>
      {/if}
    </div>
  </PageHeader>
  {#if confirmingDelete && data.admin && !data.league.archived}
    <form method="POST" action="?/delete" class="t-panel t-stack" use:enhance={() => {
      deleting = true; return async ({ update }) => { try { await update(); } finally { deleting = false; } };
    }}>
      <input type="hidden" name="revision" value={data.event.revision} />
      <p class="font-bold">{$t('tournament.deleteEvent')} — {data.event.name}</p>
      <p class="t-muted">{$t('tournament.deleteEventHelp')}</p>
      <div class="t-row">
        <button class="t-button" name="confirm" value="delete" disabled={deleting}>{$t('tournament.confirmDelete')}</button>
        <button class="t-button t-button-secondary" type="button" disabled={deleting} on:click={() => confirmingDelete = false}>{$t('tournament.cancel')}</button>
      </div>
    </form>
  {/if}
  {#if form && 'error' in form}<div class="t-error" role="alert"><p>{form.error}</p><a class="underline" href={`/tournament/${data.league.id}/events/${data.event.id}`} data-sveltekit-reload>{$t('tournament.reload')}</a></div>{/if}
  {#if form && 'success' in form}<p class="t-success" role="status">{$t('tournament.saved')}</p>{/if}
  {#if data.league.archived}<p class="t-panel t-muted">{$t('tournament.archiveHint')}</p>{/if}

  {#if data.event.status === 'published'}
    <section class="t-panel t-stack">
      <div class="t-row t-between"><h2 class="t-heading">{$t('tournament.results')}</h2><span class="t-muted">{data.results.length} {$t('tournament.participants')}</span></div>
      <div class="t-table-wrap"><table class="t-table" aria-label={$t('tournament.results')}>
        <thead><tr><th>{$t('tournament.rank')}</th><th>{$t('tournament.player')}</th><th>{$t('tournament.points')}</th></tr></thead>
        <tbody>{#each data.results as result}<tr><td class="font-bold" class:t-accent={result.rank <= 3}>#{result.rank}</td><td>{result.name}{#if result.commanders}<span class="block t-muted mt-1">{result.commanders}</span>{/if}</td><td class="font-bold">+{result.points}</td></tr>{/each}</tbody>
      </table></div>
    </section>
  {:else if !data.admin}<p class="t-panel t-muted">{$t('tournament.noResults')}</p>{/if}

  {#if data.event.swiss}
    <TournamentSwiss state={data.event.swiss} revision={data.event.revision} editable={data.admin && !data.league.archived && data.event.status !== 'published'} correctionEditable={data.admin && !data.league.archived} published={data.event.status === 'published'} myMemberId={data.myMemberId} playerEditable={!data.league.archived && data.event.status === 'draft'} />
  {/if}

  {#if data.admin && !data.league.archived && (!data.event.swiss || data.event.swiss.finished)}
    {#key loadedVersion}
      <form method="POST" action={choosingMode && entryMode === 'swiss' ? '?/swiss' : '?/save'} class="t-stack" use:enhance={({ cancel }) => {
        if (choosingMode && entryMode === 'players') { cancel(); return; }
        saving = true;
        return async ({ update }) => { try { await update({ reset: false }); } finally { saving = false; } };
      }}>
        <input type="hidden" name="revision" value={data.event.revision} />
        <section class="t-panel t-stack">
          <h2 class="t-heading">{$t(!manualResults ? 'tournament.playerList' : data.event.status === 'published' ? 'tournament.editPublished' : 'tournament.editResults')}</h2>
          {#if manualResults}
          <div class="t-grid">
            <label class="t-label">{$t('tournament.name')}<input class="t-input" name="name" value={data.event.name} required maxlength="120" /></label>
            <label class="t-label">{$t('tournament.eventDate')}<input class="t-input" name="eventDate" type="date" value={data.event.eventDate} min={data.league.startsOn} max={data.league.endsOn} required /></label>
          </div>
          <p class="t-muted">{$t('tournament.entryHelp')}</p>
          {:else}<p class="t-muted">{$t('tournament.playerListHelp')}</p>{/if}
          <p class="t-muted">{$t('tournament.commandersHelp')}</p>
          <div class="t-stack">
            {#each entries as entry, index (entry.key)}
              <div class="t-stack content-start rounded border border-white/10 p-3">
                <div class="t-row">
                  {#if manualResults}<strong class="t-accent">#{index + 1}</strong>{/if}
                  <div class="flex-1 min-w-0">
                    <TournamentPlayerPicker id={`placement-${entry.key}`} label={`${$t('tournament.player')} ${manualResults ? '#' : ''}${index + 1}`}
                      players={data.roster} excluded={entries.filter((row) => row !== entry).map((row) => row.memberId)} bind:value={entry.memberId} />
                  </div>
                  <button type="button" class="ui-icon-button ui-icon-danger" aria-label={`${$t('tournament.removePlayer')} #${index + 1}`}
                    on:click={() => entries = entries.filter((row) => row !== entry)}><Icon name="trash" /></button>
                </div>
                {#if entry.memberId}
                  {#if manualResults}<input type="hidden" name={`rank:${entry.memberId}`} value={index + 1} />{/if}
                  {#if manualResults}
                    <div class="t-row">
                      <button class="ui-icon-button" type="button" aria-label={`${$t('tournament.moveUp')} #${index + 1}`} disabled={saving || index === 0} on:click={() => moveEntry(index, -1)}>↑</button>
                      <button class="ui-icon-button" type="button" aria-label={`${$t('tournament.moveDown')} #${index + 1}`} disabled={saving || index === entries.length - 1} on:click={() => moveEntry(index, 1)}>↓</button>
                    </div>
                  {/if}
                  {#key entry.memberId}
                    <TournamentCommanderPicker memberId={entry.memberId} playerName={data.roster.find((member) => member.id === entry.memberId)?.name ?? ''}
                      fieldName={`commanders:${choosingMode && entryMode === 'swiss' ? data.roster.find((member) => member.id === entry.memberId)?.userId : entry.memberId}`}
                      bind:value={commanders[entry.memberId]} />
                  {/key}
                {/if}
              </div>
            {/each}
          </div>
          <div><button class="t-button t-button-secondary" type="button" on:click={() => entries = [...entries, { key: nextKey++, memberId: '' }]}><Icon name="plus" />{$t('tournament.addPlayer')}</button></div>
        </section>
        {#if choosingMode}
          <div class="t-row" role="group" aria-label={$t('tournament.eventMode')}>
            <button type="button" class="t-button" class:t-button-secondary={entryMode !== 'results'} aria-pressed={entryMode === 'results'} disabled={saving || !playersValid} on:click={() => entryMode = 'results'}>{$t('tournament.editResults')}</button>
            <button type="button" class="t-button" class:t-button-secondary={entryMode !== 'swiss'} aria-pressed={entryMode === 'swiss'} disabled={saving || !swissValid} on:click={() => entryMode = 'swiss'}>{$t('tournament.runSwiss')}</button>
          </div>
        {/if}
        {#if choosingMode && entryMode === 'swiss'}
          <section class="t-panel t-stack">
            <h2 class="t-heading">{$t('tournament.swiss')}</h2>
            <p class="t-muted">{$t('tournament.swissSetupHelp')}</p>
            {#each entries as entry}<input type="hidden" name="player" value={data.roster.find((member) => member.id === entry.memberId)?.userId ?? ''} />{/each}
            <label class="t-label">{$t('tournament.roundCount')}<input class="t-input" type="number" name="roundCount" min="1" max={maxRounds} step="1" bind:value={roundCount} required /></label>
            <div><button class="t-button" name="operation" value="start" disabled={saving || !swissValid}>{$t('tournament.startSwiss')}</button></div>
          </section>
        {:else if manualResults}
        <section class="t-panel t-stack" aria-live="polite">
          <div class="t-row t-between"><h2 class="t-heading">{$t('tournament.preview')}</h2><span class="t-muted">{participantCount} {$t('tournament.participants')}</span></div>
          <p class="t-muted">{$t('tournament.previewHelp')}</p>
          {#if preview === null}<p class="t-error">{$t('tournament.invalidRanks')}</p>
          {:else if preview.length}
            <div class="t-table-wrap"><table class="t-table" aria-label={$t('tournament.preview')}>
              <thead><tr><th>{$t('tournament.rank')}</th><th>{$t('tournament.player')}</th><th>{$t('tournament.points')}</th></tr></thead>
              <tbody>{#each preview as row}<tr><td>#{row.rank}</td><td>{data.roster.find((member) => member.id === row.memberId)?.name}{#if commanders[row.memberId]}<span class="block t-muted mt-1">{commanders[row.memberId]}</span>{/if}</td><td class="font-bold t-accent">+{row.points}</td></tr>{/each}</tbody>
            </table></div>
          {/if}
          {#if participantCount < 2}<p class="t-muted">{$t('tournament.minPlayers')}</p>{/if}
          {#if data.event.status === 'published'}
            <label class="t-label">{$t('tournament.reason')}<textarea class="t-input" name="reason" rows="2" maxlength="1000" required></textarea></label>
          {/if}
          <div class="t-row">
            <button class="t-button" type="submit" name="status" value="published" disabled={saving || !preview || participantCount < 2}><Icon name={saving ? "loader" : "publish"} />{$t(saving ? 'tournament.saving' : data.event.status === 'published' ? 'tournament.saveCorrections' : 'tournament.publish')}</button>
            <button class="t-button t-button-secondary" type="submit" name="status" value="draft" disabled={saving || !preview}><Icon name="save" />{$t(data.event.status === 'published' ? 'tournament.unpublish' : 'tournament.saveDraft')}</button>
          </div>
        </section>
        {/if}
      </form>
    {/key}
  {/if}
  <TournamentRules />
  {#if data.admin}
    <section class="t-stack">
      <h2 class="t-heading">{$t('tournament.history')}</h2>
      {#each data.history as change}
        <details class="t-panel">
          <summary><span class="font-bold">{$t('tournament.revision')} {change.revision}</span> · {change.actorName} · {$t(change.snapshot.status === 'published' ? 'tournament.published' : 'tournament.draft')}<span class="block t-muted mt-1">{new Date(change.createdAt).toISOString().replace('T', ' ').slice(0, 19)} UTC</span></summary>
          <div class="t-stack mt-4">
            <p>{change.reason || (change.revision === 0 ? $t('tournament.initialDraft') : '—')}</p>
            <p class="t-muted">{change.snapshot.name} · {change.snapshot.eventDate}</p>
            {#if change.snapshot.swiss}
              {#each change.snapshot.swiss.rounds as round}
                <div class="t-stack">
                  <h3 class="font-bold">{$t('tournament.round')} {round.number}</h3>
                  <p class="t-muted">{round.pairedAt}</p>
                  {#each round.matches as match}
                    <p class="t-muted">{change.snapshot.swiss.players.find((p) => p.memberId === match.a)?.name} {match.score ? `${match.score.aWins}–${match.score.bWins}` : '—'} {match.b ? change.snapshot.swiss.players.find((p) => p.memberId === match.b)?.name : $t('tournament.bye')} · {match.outcome === 'draw' ? $t('tournament.draw') : !match.outcome ? $t('tournament.pending') : `${change.snapshot.swiss.players.find((p) => p.memberId === (match.outcome === 'b' ? match.b : match.a))?.name} — ${$t('tournament.win')}`}</p>
                  {/each}
                </div>
              {/each}
            {/if}
            <div class="t-table-wrap"><table class="t-table">
              <thead><tr><th>{$t('tournament.rank')}</th><th>{$t('tournament.player')}</th><th>{$t('tournament.points')}</th></tr></thead>
              <tbody>{#each change.snapshot.results as row}<tr><td>#{row.rank}</td><td>{row.name}{#if row.commanders}<span class="block t-muted mt-1">{row.commanders}</span>{/if}</td><td>{row.points}</td></tr>{/each}</tbody>
            </table></div>
          </div>
        </details>
      {/each}
    </section>
  {/if}
</main>
