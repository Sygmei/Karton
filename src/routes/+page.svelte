<script lang="ts">
  export let data: {
    currentUser?: {
      username: string;
      displayName?: string | null;
      role: string;
    } | null;
  };

  const cardClass =
    "rounded border border-white/10 bg-stone-900/80 p-5 text-stone-100 no-underline transition hover:border-lime-300/50 hover:bg-stone-900";
  const eyebrowClass =
    "text-xs font-extrabold uppercase tracking-widest text-lime-300";
</script>

<svelte:head>
  <title>Karton</title>
</svelte:head>

<main class="mx-auto grid w-[min(980px,94vw)] gap-5 py-8 pb-12">
  <section class="rounded border border-white/10 bg-stone-900/80 p-6">
    <p class={eyebrowClass}>Karton</p>
    <h1 class="mt-2 text-3xl font-black">Pick a tool</h1>
  </section>

  <section class="grid gap-4 md:grid-cols-2">
    <a class={cardClass} href="/analyzer">
      <p class={eyebrowClass}>Deck Analyzer</p>
      <h2 class="mt-2 text-xl font-bold">Find cards to keep, cut, and add</h2>
      <p class="mt-2 text-sm text-stone-400">
        Paste a Moxfield or Archidekt deck and compare it to recent Duel
        Commander trends.
      </p>
    </a>

    {#if data.currentUser}
      <a class={cardClass} href="/matches">
        <p class={eyebrowClass}>Matcher</p>
        <h2 class="mt-2 text-xl font-bold">Match wanted and selling lists</h2>
        <p class="mt-2 text-sm text-stone-400">
          Use saved public lists to find people with exact card-name overlap.
        </p>
      </a>
    {:else}
      <article class={`${cardClass} opacity-60`}>
        <div class="flex flex-wrap items-center gap-2">
          <p class={eyebrowClass}>Matcher</p>
          <span
            class="rounded-full border border-amber-200/30 bg-amber-300/10 px-2 py-0.5 text-[0.68rem] font-bold uppercase tracking-wide text-amber-200"
          >
            Available only for registered users
          </span>
        </div>
        <h2 class="mt-2 text-xl font-bold">Match wanted and selling lists</h2>
        <p class="mt-2 text-sm text-stone-400">
          Use saved public lists to find people with exact card-name overlap.
        </p>
      </article>
    {/if}
  </section>
</main>
