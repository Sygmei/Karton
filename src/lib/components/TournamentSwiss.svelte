<script lang="ts">
  import { onMount } from 'svelte';
  import { enhance } from '$app/forms';
  import { invalidateAll } from '$app/navigation';
  import { t } from '$lib/i18n';
  import { bo3Outcome, swissStandings, type SwissScore, type SwissState } from '$lib/swiss';
  export let state: SwissState | null;
  export let revision: number;
  export let editable: boolean;
  export let correctionEditable = false;
  export let published = false;
  export let myMemberId: string | null = null;
  export let playerEditable = false;
  let saving = false;
  let dirty = false;
  let now = Date.now();
  let loadedRevision = -1;
  let selectedRound = 0;
  let loadedRound = 0;
  let scores: (SwissScore | null)[] = [];
  const emptyScore = (): SwissScore => ({ aWins: 0, bWins: 0, finished: false });
  function cycleScore(index: number, side: 'aWins' | 'bWins') {
    const score = { ...(scores[index] ?? emptyScore()) };
    score[side] = (score[side] + 1) % 3;
    const opponent = side === 'aWins' ? 'bWins' : 'aWins';
    if (score[side] === 2 && score[opponent] === 2) score[opponent] = 1;
    score.finished = false;
    bo3Outcome(score);
    scores[index] = score;
    dirty = true;
  }
  $: current = state?.rounds[state.rounds.length - 1];
  $: selected = state?.rounds.find((round) => round.number === selectedRound) ?? current;
  $: correcting = correctionEditable && !!selected && (!!state?.finished || selected.number !== current?.number);
  $: myMatchIndex = selected?.matches.findIndex((match) => match.b !== null && (match.a === myMemberId || match.b === myMemberId)) ?? -1;
  $: canReport = playerEditable && !state?.finished && selected === current && myMatchIndex >= 0;
  $: if (revision !== loadedRevision || selected?.number !== loadedRound) {
    scores = selected?.matches.map((match) => match.b === null || (!match.score && match.outcome) ? null : { ...(match.score ?? emptyScore()) }) ?? [];
    loadedRevision = revision;
    loadedRound = selected?.number ?? 0;
    dirty = false;
  }
  $: outcomes = selected?.matches.map((match, index) => match.b === null ? 'bye' : scores[index] ? bo3Outcome({ ...scores[index]!, finished: scores[index]!.finished || (correcting && scores[index]!.aWins + scores[index]!.bWins > 0) }) : match.outcome) ?? [];
  $: standings = state ? swissStandings(state) : [];
  $: elapsed = current ? Math.max(0, Math.floor((now - Date.parse(current.pairedAt)) / 1000)) : 0;
  $: timer = `${String(Math.floor(elapsed / 3600)).padStart(2, '0')}:${String(Math.floor(elapsed / 60) % 60).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`;
  onMount(() => {
    const tick = setInterval(() => now = Date.now(), 1000);
    let refreshing = false;
    const refresh = setInterval(async () => {
      if (dirty || saving || refreshing || (editable && (!state || state.finished)) || document.visibilityState !== 'visible') return;
      refreshing = true;
      try { await invalidateAll(); } catch { /* Keep the current scores during a network outage. */ } finally { refreshing = false; }
    }, 15000);
    return () => { clearInterval(tick); clearInterval(refresh); };
  });
  const name = (id: string) => state?.players.find((player) => player.memberId === id)?.name ?? '';
</script>

<section class="t-panel t-stack">
  <div class="t-row t-between">
    <h2 class="t-heading">{$t('tournament.swiss')}</h2>
    {#if current}<span class="t-badge">{$t('tournament.round')} {current.number} / {state?.roundCount}</span>{/if}
  </div>
  {#if state && current}
    <div class="t-row t-between">
      <div><p class="t-muted">{$t('tournament.sincePairing')}</p><time class="t-stat t-accent" aria-label={$t('tournament.sincePairing')}>{timer}</time></div>
      {#if state.finished}<span class="t-badge">{$t('tournament.swissFinished')}</span>{/if}
    </div>
    <details><summary class="t-muted">{$t('tournament.swissScoring')}</summary><p class="t-muted mt-2">{$t('tournament.swissRules')}</p></details>
    {#if state.rounds.length > 1}
      <label class="t-label">{$t('tournament.round')}
        <select class="t-input" aria-label={$t('tournament.round')} value={selected?.number} disabled={dirty || saving}
          on:change={(event) => selectedRound = Number(event.currentTarget.value) === current.number ? 0 : Number(event.currentTarget.value)}>
          {#each state.rounds as round}<option value={round.number}>{$t('tournament.round')} {round.number}</option>{/each}
        </select>
      </label>
    {/if}
    {#if selected?.correctedEarlierRounds?.length}
      <p class="pairing-warning" role="status">{$t('tournament.pairingCorrectionWarning')} {selected.correctedEarlierRounds.join(', ')}.</p>
    {/if}
    {#if correcting}<p class="t-muted">{$t('tournament.correctRoundHelp')}{#if state.finished} {$t('tournament.correctFinalHelp')}{/if}</p>{/if}
    {#key `${revision}:${selected?.number}`}
      <form method="POST" action={editable || correcting ? '?/swiss' : '?/reportScore'} class="t-stack" use:enhance={() => {
        saving = true; return async ({ update }) => { try { await update({ reset: false }); } finally { saving = false; } };
      }}>
        <input type="hidden" name="revision" value={revision} />
        {#if correcting}<input type="hidden" name="round" value={selected?.number} />{/if}
        {#if !editable && canReport}
          <input type="hidden" name="round" value={current.number} />
          <input type="hidden" name="match" value={myMatchIndex} />
          <input type="hidden" name="matchRevision" value={current.matches[myMatchIndex].revision ?? 0} />
        {/if}
        {#each selected?.matches ?? [] as match, index}
          <div class="match border border-white/10 rounded p-2">
            <div class="t-row t-between"><span class="t-muted">{$t('tournament.table')} {index + 1}{#if index === myMatchIndex} · {$t('tournament.yourMatch')}{/if}</span>{#if match.rematch}<span class="t-badge">{$t('tournament.rematch')}</span>{/if}</div>
            {#if !match.b}
              <strong class="break-words">{name(match.a)} — {$t('tournament.bye')}</strong>
              <input type="hidden" name={`score:${index}`} value="null" /><p class="t-muted">{$t('tournament.byeHelp')}</p>
            {:else if correcting || (!state.finished && ((editable && selected === current) || (canReport && index === myMatchIndex)))}
              <input type="hidden" name={editable || correcting ? `score:${index}` : 'score'} value={JSON.stringify(scores[index])} />
              <div class="scoreboard" data-scoreboard={index}>
                {#each ['aWins', 'bWins'] as side, playerIndex}
                  {@const wins = scores[index]?.[side as 'aWins' | 'bWins'] ?? 0}
                  {@const playerName = name(playerIndex === 0 ? match.a : match.b)}
                  <div class="score-player" class:reverse={playerIndex === 1} class:winner={wins === 2}>
                    <strong class="player-name">{playerName}</strong>
                    <button class="score-button" type="button" aria-label={`${playerName} — ${$t('tournament.gameWins')}: ${scores[index] ? wins : '—'}`}
                      title={$t('tournament.cycleWins')} disabled={saving}
                      on:click={() => cycleScore(index, side as 'aWins' | 'bWins')}>{scores[index] ? wins : '—'}</button>
                  </div>
                {/each}
              </div>
              {#if !scores[index]}<p class="t-muted">{$t('tournament.legacyScore')}</p>{/if}
              <p class="sr-only" role="status" data-match-outcome={index}>{outcomes[index] === 'draw' ? $t('tournament.draw') : outcomes[index] ? `${name(outcomes[index] === 'a' ? match.a : match.b)} — ${$t('tournament.win')}` : $t('tournament.inProgress')}</p>
              {#if !editable && !correcting}
                <div class="t-row justify-end"><button class="t-button t-button-secondary" type="submit" disabled={saving || !dirty}>{$t('tournament.saveMyScore')}</button></div>
              {/if}
            {:else}
              <strong class="break-words">{name(match.a)} {match.score ? `${match.score.aWins}–${match.score.bWins}` : '—'} {name(match.b)}</strong>
              <p class="t-muted">{match.outcome === 'draw' ? $t('tournament.draw') : match.outcome ? `${name(match.outcome === 'a' ? match.a : match.b)} — ${$t('tournament.win')}` : $t('tournament.inProgress')}</p>
            {/if}
          </div>
        {/each}
        {#if correcting}
          {#if published}<label class="t-label">{$t('tournament.reason')}<input class="t-input" name="reason" maxlength="1000" required /></label>{/if}
          <div class="t-row"><button class="t-button" name="operation" value="correct" disabled={saving || !dirty || outcomes.some((outcome) => !outcome)}>{$t('tournament.saveRoundCorrection')}</button></div>
        {:else if editable && !state.finished && selected === current}
          <div class="t-row">
            <button class="t-button t-button-secondary" name="operation" value="save" disabled={saving}>{$t('tournament.saveRound')}</button>
            <button class="t-button" name="operation" value={current.number < state.roundCount ? 'next' : 'finish'} disabled={saving || outcomes.some((outcome, index) => !outcome && !(scores[index] && (scores[index]!.aWins + scores[index]!.bWins > 0)))}>{$t(current.number < state.roundCount ? 'tournament.nextRound' : 'tournament.reviewStandings')}</button>
          </div>
          <p class="t-muted">{$t('tournament.roundLockHelp')}</p>
        {/if}
        {#if dirty}<button class="t-button t-button-secondary self-start" type="button" disabled={saving} on:click={() => loadedRevision = -1}>{$t('tournament.cancel')}</button>{/if}
      </form>
    {/key}
    <div class="t-table-wrap"><table class="t-table" aria-label={$t('tournament.swissStandings')}>
      <thead><tr><th>#</th><th>{$t('tournament.player')}</th><th>{$t('tournament.matchPoints')}</th><th class="hidden sm:table-cell">{$t('tournament.record')}</th><th>Buchholz</th></tr></thead>
      <tbody>{#each standings as row}<tr><td>{row.rank}</td><td>{row.name}<small class="block t-muted sm:hidden">{row.wins}–{row.draws}–{row.losses}{#if row.byes} (+{row.byes} {$t('tournament.bye')}){/if}</small></td><td>{row.points}</td><td class="hidden sm:table-cell">{row.wins}–{row.draws}–{row.losses}{#if row.byes} (+{row.byes} {$t('tournament.bye')}){/if}</td><td>{row.buchholz}</td></tr>{/each}</tbody>
    </table></div>

  {/if}
</section>

<style>
  .pairing-warning { border-left: 2px solid #eab308; padding: .5rem .75rem; color: #fde68a; font-size: .875rem; }
  .match { display: grid; gap: .375rem; }
  .scoreboard { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .375rem; }
  .score-player { min-width: 0; display: flex; align-items: center; gap: .5rem; padding: .25rem; border-radius: .375rem; }
  .score-player.reverse { flex-direction: row-reverse; }
  .player-name { min-width: 0; flex: 1; text-align: right; overflow-wrap: anywhere; font-size: .875rem; }
  .reverse .player-name { text-align: left; }
  .score-button { flex: 0 0 44px; min-height: 44px; border: 1px solid #ffffff30; border-radius: .375rem; font-size: 1.25rem; font-weight: 600; font-variant-numeric: tabular-nums; cursor: pointer; }
  .score-button:hover:not(:disabled) { background: #ffffff15; }
  .winner { background: #ffc8b814; color: #ffc8b8; }
  .winner .score-button { background: #ffc8b8; border-color: #ffc8b8; color: #171412; }
  .winner .score-button:hover:not(:disabled) { background: #ffdbcF; }
</style>
