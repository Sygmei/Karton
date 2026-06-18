<script lang="ts">
  import type { CardStat } from '$lib/server/types';

  export let cards: CardStat[] = [];

  type PreviewStatus = 'hidden' | 'loading' | 'ready' | 'error';

  type ScryfallCardPreview = {
    name: string;
    imageUrl: string;
    scryfallUrl: string;
  };

  type ScryfallResponse = {
    name?: string;
    scryfall_uri?: string;
    image_uris?: Record<string, string>;
    card_faces?: Array<{
      image_uris?: Record<string, string>;
    }>;
  };

  const previewCache = new Map<string, ScryfallCardPreview | null>();
  const previewInflight = new Map<string, Promise<ScryfallCardPreview | null>>();

  let previewStatus: PreviewStatus = 'hidden';
  let previewCard: ScryfallCardPreview | null = null;
  let previewLabel = '';
  let previewError = '';
  let activeCard = '';
  let previewSequence = 0;

  function toPercent(ratio: number): string {
    return `${(ratio * 100).toFixed(1)}%`;
  }

  function normalizeCardKey(cardName: string): string {
    return cardName.trim().toLowerCase();
  }

  function extractImageUrl(payload: ScryfallResponse): string | null {
    return (
      payload.image_uris?.normal ??
      payload.image_uris?.large ??
      payload.image_uris?.png ??
      payload.card_faces?.[0]?.image_uris?.normal ??
      payload.card_faces?.[0]?.image_uris?.large ??
      payload.card_faces?.[0]?.image_uris?.png ??
      null
    );
  }

  async function fetchScryfallCard(cardName: string): Promise<ScryfallCardPreview | null> {
    const exactUrl = `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(cardName)}`;
    const fuzzyUrl = `https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(cardName)}`;
    const endpoints = [exactUrl, fuzzyUrl];

    for (const endpoint of endpoints) {
      const response = await fetch(endpoint);
      if (!response.ok) {
        continue;
      }

      const payload = (await response.json()) as ScryfallResponse;
      const imageUrl = extractImageUrl(payload);
      const scryfallUrl = payload.scryfall_uri;
      const foundName = payload.name ?? cardName;
      if (!imageUrl || !scryfallUrl) {
        continue;
      }

      return {
        name: foundName,
        imageUrl,
        scryfallUrl
      };
    }

    return null;
  }

  async function resolvePreview(cardName: string): Promise<ScryfallCardPreview | null> {
    const key = normalizeCardKey(cardName);
    const cached = previewCache.get(key);
    if (cached !== undefined) {
      return cached;
    }

    const inflight = previewInflight.get(key);
    if (inflight) {
      return inflight;
    }

    const request = fetchScryfallCard(cardName)
      .then((result) => {
        previewCache.set(key, result);
        return result;
      })
      .finally(() => {
        previewInflight.delete(key);
      });

    previewInflight.set(key, request);
    return request;
  }

  async function openPreview(cardName: string): Promise<void> {
    previewSequence += 1;
    const sequence = previewSequence;
    activeCard = cardName;
    previewLabel = cardName;
    previewError = '';
    previewCard = null;
    previewStatus = 'loading';

    try {
      const result = await resolvePreview(cardName);
      if (sequence !== previewSequence || activeCard !== cardName) {
        return;
      }

      if (result) {
        previewCard = result;
        previewStatus = 'ready';
        return;
      }

      previewError = 'Preview unavailable on Scryfall for this card.';
      previewStatus = 'error';
    } catch {
      if (sequence !== previewSequence || activeCard !== cardName) {
        return;
      }
      previewError = 'Could not fetch preview from Scryfall.';
      previewStatus = 'error';
    }
  }

  function closePreview(): void {
    previewStatus = 'hidden';
    previewCard = null;
    previewError = '';
    previewLabel = '';
    activeCard = '';
  }

  const tableWrapClass = "overflow-auto rounded border border-white/10 bg-stone-950/50";
  const cellClass = "border-b border-white/10 px-3 py-2 text-left align-top";
  const numericCellClass = `${cellClass} w-28 whitespace-nowrap text-stone-300`;
</script>

{#if cards.length === 0}
  <p class="text-sm text-stone-400">No cards found for this section in the selected date range.</p>
{:else}
  <div class={tableWrapClass}>
    <table class="w-full table-fixed border-collapse text-sm">
      <thead class="bg-stone-900 text-xs uppercase tracking-wider text-stone-400">
        <tr>
          <th class={cellClass}>Card</th>
          <th class={numericCellClass}>Decks</th>
          <th class={`${cellClass} w-24 whitespace-nowrap`}>Ratio</th>
        </tr>
      </thead>
      <tbody>
        {#each cards as row}
          <tr class="hover:bg-white/5">
            <td class={cellClass}>
              <button
                type="button"
                class="inline-flex max-w-full items-center gap-2 border-0 bg-transparent p-0 text-left text-lime-300 underline-offset-4 hover:underline"
                on:mouseenter={() => openPreview(row.card)}
                on:focus={() => openPreview(row.card)}
              >
                <span class={`truncate ${row.banned ? "text-red-200 line-through decoration-red-300" : ""}`}>{row.card}</span>
                {#if row.banned}
                  <span
                    class="grid size-5 shrink-0 place-items-center rounded bg-red-300 text-xs text-stone-950"
                    title="Banned in Duel Commander"
                    aria-label="Banned in Duel Commander"
                  >
                    ⚠
                  </span>
                {/if}
              </button>
            </td>
            <td class={numericCellClass}>{row.decksWithCard} / {row.totalDecks}</td>
            <td class={`${cellClass} w-24 whitespace-nowrap text-stone-300`}>{toPercent(row.ratio)}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/if}

{#if previewStatus !== 'hidden'}
  <div class="fixed inset-0 z-50 grid place-items-end bg-black/45 p-4 sm:place-items-center">
    <aside class="grid max-h-[90vh] w-full max-w-sm gap-3 overflow-auto rounded border border-white/15 bg-stone-950 p-4 shadow-2xl" aria-live="polite" aria-busy={previewStatus === 'loading'}>
      <div class="flex items-center justify-between gap-3">
        <p class="font-bold">Scryfall Preview</p>
        <button class="rounded bg-lime-300 px-3 py-1.5 text-sm font-bold text-stone-950" type="button" on:click={closePreview} aria-label="Close card preview">Close</button>
      </div>

      {#if previewStatus === 'loading'}
        <p class="text-sm text-stone-400">Loading Scryfall preview for <strong>{previewLabel}</strong>...</p>
      {:else if previewStatus === 'error'}
        <p class="text-sm text-red-200">{previewError}</p>
      {:else if previewCard}
        <img class="mx-auto max-h-[70vh] rounded" src={previewCard.imageUrl} alt={`Scryfall preview for ${previewCard.name}`} loading="lazy" />
        <div class="grid gap-1 text-center">
          <p class="font-bold">{previewCard.name}</p>
          <a class="text-lime-300 no-underline hover:underline" href={previewCard.scryfallUrl} target="_blank" rel="noreferrer">Open on Scryfall</a>
        </div>
      {/if}
    </aside>
  </div>
{/if}
