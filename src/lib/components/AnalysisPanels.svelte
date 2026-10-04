<script lang="ts">
  import CardTable from './CardTable.svelte';
  import Icon, { type IconName } from './Icon.svelte';
  import { t } from '$lib/i18n';
  import type { AnalysisResult } from '$lib/server/types';

  export let analysis: AnalysisResult;
  export let commanderOnly = false;

  type Tab = 'cut' | 'add' | 'keep' | 'new';
  let active: Tab = commanderOnly ? 'add' : 'cut';
  $: if (commanderOnly && (active === 'cut' || active === 'keep')) active = 'add';
  $: tabs = (commanderOnly ? ['add', 'new'] : ['cut', 'add', 'keep', 'new']) as Tab[];
  $: labels = { cut: $t('analyzer.cut'), add: commanderOnly ? $t('analyzer.popularCards') : $t('analyzer.add'), keep: $t('analyzer.keep'), new: $t('analyzer.new') };
  const icons: Record<Tab, IconName> = { cut: 'minus', add: 'plus', keep: 'check', new: 'calendar' };

  function moveTab(event: KeyboardEvent, tab: Tab) {
    let index = tabs.indexOf(tab);
    if (event.key === 'ArrowRight') index = (index + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') index = (index + tabs.length - 1) % tabs.length;
    else if (event.key === 'Home') index = 0;
    else if (event.key === 'End') index = tabs.length - 1;
    else return;
    event.preventDefault();
    active = tabs[index];
    document.getElementById(`analysis-tab-${active}`)?.focus();
  }
</script>

<div class="grid rounded border border-white/10 bg-stone-950 p-1" class:grid-cols-2={commanderOnly} class:grid-cols-4={!commanderOnly} role="tablist" aria-label={$t('analyzer.views')}>
  {#each tabs as tab}
    <button
      id={`analysis-tab-${tab}`}
      class={`min-w-0 select-none rounded px-1 py-2 text-xs font-bold sm:px-3 sm:text-base ${active === tab ? 'bg-primary-300 text-stone-950' : 'text-stone-300 hover:bg-stone-800'}`}
      type="button"
      role="tab"
      aria-selected={active === tab}
      aria-controls={`analysis-panel-${tab}`}
      tabindex={active === tab ? 0 : -1}
      on:pointerdown={(event) => { if (event.button === 0) active = tab; }}
      on:click={() => (active = tab)}
      on:keydown={(event) => moveTab(event, tab)}
    >
      <span class="ui-action"><span class="hidden sm:inline-flex"><Icon name={icons[tab]} /></span>{labels[tab]}</span>
    </button>
  {/each}
</div>

<div id={`analysis-panel-${active}`} class="grid min-w-0 gap-3" role="tabpanel" aria-labelledby={`analysis-tab-${active}`} tabindex="0">
  {#if active === 'new'}
    <h2 class="text-xl font-bold">{$t('analyzer.newCards')}</h2>
    <p class="text-sm text-stone-400">{$t('analyzer.newCardsHelp')}</p>
    {#if analysis.newCards === undefined}
      <p class="text-sm text-stone-400">{$t('analyzer.newCardsLegacy')}</p>
    {:else}
      {#if analysis.newCards.some((card) => !card.releasedAt)}
        <p class="text-sm text-amber-200" role="status">{$t('analyzer.releaseDatesUnavailable')}</p>
      {/if}
      <CardTable cards={analysis.newCards} showReleaseDate />
    {/if}
  {:else if active === 'cut'}
    <h2 class="text-xl font-bold">{$t('analyzer.cardsToCut')}</h2>
    <CardTable cards={analysis.cut} />
  {:else if active === 'add'}
    <h2 class="text-xl font-bold">{commanderOnly ? $t('analyzer.popularCards') : $t('analyzer.cardsToAdd')}</h2>
    <CardTable cards={analysis.toAdd} />
  {:else}
    <h2 class="text-xl font-bold">{$t('analyzer.cardsToKeep')}</h2>
    <CardTable cards={analysis.keep} />
  {/if}
</div>
