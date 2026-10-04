<script lang="ts">
  import AnalysisPanels from '$lib/components/AnalysisPanels.svelte';
  import { t, locale } from '$lib/i18n';
  import type { AnalyzeOutput } from '$lib/server/types';

  export let data: {
    shareId: string;
    shareUrl: string;
    createdAt: string;
    commanderName: string;
    ignoreBefore: string | null;
    ignoreAfter: string | null;
    output: AnalyzeOutput;
  };

  $: deckSourceLabel =
    data.output.moxfieldDeck.source === 'manabox'
      ? 'ManaBox'
      : data.output.moxfieldDeck.source === 'archidekt'
        ? 'Archidekt'
        : 'Moxfield';

  const pageClass = "mx-auto grid w-[min(1200px,94vw)] gap-4 py-4 pb-12";
  const panelClass = "rounded border border-white/10 bg-stone-900/80 p-4";
  const eyebrowClass = "text-xs font-extrabold uppercase tracking-widest text-primary-300";
  const statLabelClass = "text-xs font-bold uppercase tracking-wider text-stone-400";
  const statValueClass = "mt-1 text-lg font-black text-stone-100";
  const linkButtonClass = "rounded border border-primary-200/30 px-3 py-2 text-sm font-bold text-primary-300 no-underline hover:bg-primary-300 hover:text-stone-950";
</script>

<svelte:head>
  <title>{$t('analyzer.sharedAnalysis')} - Karton</title>
</svelte:head>

<main class={pageClass}>
  <section class={panelClass}>
    <p class={eyebrowClass}>{$t('analyzer.sharedAnalysis')}</p>
    <h1 class="mt-2 text-2xl font-black">{data.output.moxfieldDeck.name}</h1>
    <p class="mt-2 text-stone-400">
      {$t('analyzer.commander')}: {data.output.moxfieldDeck.commanders.join(' / ')} - {$t('analyzer.analyzedAt', { date: new Date(data.output.analyzedAt).toLocaleString($locale) })}
    </p>
    {#if data.ignoreBefore || data.ignoreAfter}
      <p class="mt-3 flex flex-wrap items-center gap-2 text-stone-400">
        {#if data.ignoreBefore}
          <span>{$t('analyzer.ignoreDecksBefore')}</span>
          <code class="rounded bg-stone-950 px-2 py-1 text-primary-300">{data.ignoreBefore}</code>
        {/if}
        {#if data.ignoreAfter}
          <span>{$t('analyzer.ignoreDecksAfter')}</span>
          <code class="rounded bg-stone-950 px-2 py-1 text-primary-300">{data.ignoreAfter}</code>
        {/if}
      </p>
    {/if}
    <p class="mt-2 text-stone-400">
      {$t('analyzer.shareId')}: <code class="rounded bg-stone-950 px-2 py-1 text-primary-300">{data.shareId}</code>
    </p>
    {#if data.output.analysis.requiredCards?.length}
      <p class="mt-3 text-sm text-stone-300">{$t("analyzer.requiredCards")}: {data.output.analysis.requiredCards.join(' · ')}</p>
      {#if data.output.analysis.totalDecksConsidered === 0}
        <p class="mt-2 text-sm text-amber-200" role="status">{$t("analyzer.noMatchingDecks")}</p>
      {/if}
    {/if}
    <div class="mt-4 flex flex-wrap gap-2">
      <a class={linkButtonClass} href="/analyzer" rel="noreferrer">{$t('analyzer.newAnalysis')}</a>
      {#if data.output.moxfieldDeck.source !== "commander"}
      <a class={linkButtonClass} href={data.output.moxfieldDeck.url} target="_blank" rel="noreferrer">{$t('analyzer.openSource', { source: deckSourceLabel })}</a>
      {/if}
      <a class={linkButtonClass} href={data.shareUrl} target="_blank" rel="noreferrer">{$t('analyzer.permalink')}</a>
    </div>
  </section>

  <section class={panelClass}>
    <div class="grid gap-3 md:grid-cols-3">
      <article class="rounded border border-white/10 bg-stone-950/60 p-4">
        <p class={statLabelClass}>{$t('analyzer.mtgtop8Commander')}</p>
        <p class={statValueClass}>
          <a class="text-primary-300 no-underline" href={data.output.commander.url} target="_blank" rel="noreferrer">{data.commanderName}</a>
        </p>
      </article>
      <article class="rounded border border-white/10 bg-stone-950/60 p-4">
        <p class={statLabelClass}>{$t('analyzer.decksConsidered')}</p>
        <p class={statValueClass}>{data.output.analysis.totalDecksConsidered}</p>
      </article>
      <article class="rounded border border-white/10 bg-stone-950/60 p-4">
        <p class={statLabelClass}>{$t('analyzer.cachedDecks')}</p>
        <p class={statValueClass}>{data.output.cache.totalCachedDeckRows}</p>
      </article>
    </div>
  </section>

  <section class={`${panelClass} grid gap-4`}>
    <AnalysisPanels analysis={data.output.analysis} commanderOnly={data.output.moxfieldDeck.source === 'commander'} />
  </section>
</main>
