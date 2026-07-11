<script lang="ts">
  import type { CardStat } from '$lib/server/types';

  export let cards: CardStat[] = [];

  type PreviewStatus = 'hidden' | 'loading' | 'ready' | 'error';
  type VisiblePreviewStatus = Exclude<PreviewStatus, 'hidden'>;

  type ScryfallCardPreview = {
    name: string;
    imageUrl: string;
    scryfallUrl: string;
  };

  type FloatingPreview = {
    id: number;
    cardName: string;
    status: VisiblePreviewStatus;
    card: ScryfallCardPreview | null;
    error: string;
    left: number;
    top: number;
    zIndex: number;
    trigger: HTMLElement;
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
  let previewError = '';
  let activeCard = '';
  let previewSequence = 0;
  let hoverLeft = 0;
  let hoverTop = 0;
  let hoverNotchTop = 22;
  let hoverSide: 'left' | 'right' = 'right';
  let floatingPreviews: FloatingPreview[] = [];
  let nextPreviewId = 1;
  let nextZIndex = 50;
  let dragPreviewId: number | null = null;
  let dragPointerId: number | null = null;
  let dragOffsetX = 0;
  let dragOffsetY = 0;

  const viewportPadding = 16;
  const hoverViewportPadding = 6;
  const hoverPreviewWidth = 260;
  const hoverPreviewHeight = 364;
  const floatingPreviewWidth = 288;

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

  async function loadHoverPreview(cardName: string): Promise<void> {
    previewSequence += 1;
    const sequence = previewSequence;
    activeCard = cardName;
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

  function positionHoverPreview(target: HTMLElement): void {
    const bounds = target.getBoundingClientRect();
    const spaceOnRight = window.innerWidth - bounds.right;
    hoverSide = spaceOnRight >= hoverPreviewWidth + viewportPadding ? 'right' : 'left';
    const preferredLeft = hoverSide === 'right'
      ? bounds.right + 12
      : bounds.left - hoverPreviewWidth - 12;

    hoverLeft = Math.max(
      viewportPadding,
      Math.min(preferredLeft, window.innerWidth - hoverPreviewWidth - viewportPadding)
    );
    hoverTop = Math.max(
      hoverViewportPadding,
      Math.min(bounds.top - 12, window.innerHeight - hoverPreviewHeight - hoverViewportPadding)
    );
    hoverNotchTop = Math.max(
      14,
      Math.min(bounds.top + bounds.height / 2 - hoverTop, hoverPreviewHeight - 14)
    );
  }

  function openHoverPreview(event: MouseEvent | FocusEvent, cardName: string): void {
    positionHoverPreview(event.currentTarget as HTMLElement);
    void loadHoverPreview(cardName);
  }

  function closeHoverPreview(cardName: string): void {
    if (activeCard === cardName) {
      closeHover();
    }
  }

  function closeHover(): void {
    previewSequence += 1;
    previewStatus = 'hidden';
    previewCard = null;
    previewError = '';
    activeCard = '';
  }

  function bringPreviewToFront(id: number): void {
    nextZIndex += 1;
    floatingPreviews = floatingPreviews.map((preview) =>
      preview.id === id ? { ...preview, zIndex: nextZIndex } : preview
    );
  }

  function handleCardNameClick(event: MouseEvent, cardName: string): void {
    const target = event.currentTarget as HTMLElement;
    const selection = window.getSelection();
    if (
      selection &&
      !selection.isCollapsed &&
      selection.anchorNode &&
      target.contains(selection.anchorNode)
    ) {
      return;
    }

    void openFloatingPreview(target, cardName);
  }

  function handleCardNameKeydown(event: KeyboardEvent, cardName: string): void {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return;
    }

    event.preventDefault();
    void openFloatingPreview(event.currentTarget as HTMLElement, cardName);
  }

  async function openFloatingPreview(trigger: HTMLElement, cardName: string): Promise<void> {
    closeHover();
    const key = normalizeCardKey(cardName);
    const existing = floatingPreviews.find((preview) => normalizeCardKey(preview.cardName) === key);
    if (existing) {
      bringPreviewToFront(existing.id);
      return;
    }

    const id = nextPreviewId;
    nextPreviewId += 1;
    nextZIndex += 1;
    const cascadeOffset = (floatingPreviews.length % 8) * 24;
    const left = Math.max(
      viewportPadding,
      Math.min(
        (window.innerWidth - Math.min(floatingPreviewWidth, window.innerWidth - viewportPadding * 2)) / 2 + cascadeOffset,
        window.innerWidth - Math.min(floatingPreviewWidth, window.innerWidth - viewportPadding * 2) - viewportPadding
      )
    );

    floatingPreviews = [
      ...floatingPreviews,
      {
        id,
        cardName,
        status: 'loading',
        card: null,
        error: '',
        left,
        top: viewportPadding + cascadeOffset,
        zIndex: nextZIndex,
        trigger
      }
    ];

    try {
      const card = await resolvePreview(cardName);
      floatingPreviews = floatingPreviews.map((preview) =>
        preview.id === id
          ? card
            ? { ...preview, status: 'ready', card }
            : { ...preview, status: 'error', error: 'Preview unavailable on Scryfall for this card.' }
          : preview
      );
    } catch {
      floatingPreviews = floatingPreviews.map((preview) =>
        preview.id === id
          ? { ...preview, status: 'error', error: 'Could not fetch preview from Scryfall.' }
          : preview
      );
    }
  }

  function closeFloatingPreview(id: number): void {
    const preview = floatingPreviews.find((item) => item.id === id);
    floatingPreviews = floatingPreviews.filter((item) => item.id !== id);
    if (dragPreviewId === id) {
      dragPreviewId = null;
      dragPointerId = null;
    }
    preview?.trigger.focus();
  }

  function startDragging(event: PointerEvent, id: number): void {
    const target = event.target as HTMLElement;
    if (event.button !== 0 || !target.closest('[data-drag-handle]') || target.closest('a, button')) {
      return;
    }

    const preview = floatingPreviews.find((item) => item.id === id);
    if (!preview) {
      return;
    }

    bringPreviewToFront(id);
    dragPreviewId = id;
    dragPointerId = event.pointerId;
    dragOffsetX = event.clientX - preview.left;
    dragOffsetY = event.clientY - preview.top;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  function dragModal(event: PointerEvent): void {
    if (dragPointerId !== event.pointerId || dragPreviewId === null) {
      return;
    }

    const element = event.currentTarget as HTMLElement;
    const left = Math.max(
      viewportPadding,
      Math.min(event.clientX - dragOffsetX, window.innerWidth - element.offsetWidth - viewportPadding)
    );
    const top = Math.max(
      viewportPadding,
      Math.min(event.clientY - dragOffsetY, window.innerHeight - element.offsetHeight - viewportPadding)
    );
    floatingPreviews = floatingPreviews.map((preview) =>
      preview.id === dragPreviewId ? { ...preview, left, top } : preview
    );
  }

  function stopDragging(event: PointerEvent): void {
    if (dragPointerId === event.pointerId) {
      dragPreviewId = null;
      dragPointerId = null;
    }
  }

  function handleWindowKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && floatingPreviews.length > 0) {
      const topPreview = floatingPreviews.reduce((top, preview) =>
        preview.zIndex > top.zIndex ? preview : top
      );
      closeFloatingPreview(topPreview.id);
    }
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
              <span
                role="button"
                tabindex="0"
                class="card-name-trigger inline-flex max-w-full cursor-text select-text items-center gap-2 text-left text-primary-300 underline-offset-4 hover:underline"
                on:mouseenter={(event) => openHoverPreview(event, row.card)}
                on:mouseleave={() => closeHoverPreview(row.card)}
                on:focus={(event) => openHoverPreview(event, row.card)}
                on:blur={() => closeHoverPreview(row.card)}
                on:click={(event) => handleCardNameClick(event, row.card)}
                on:keydown={(event) => handleCardNameKeydown(event, row.card)}
                aria-haspopup="dialog"
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
              </span>
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
  <aside
    class={`card-hover-preview pointer-events-none fixed z-40 w-[260px] rounded border border-white/10 bg-stone-950/95 shadow-2xl ${previewStatus === 'ready' ? 'p-px' : 'p-3'} ${hoverSide === 'right' ? 'points-left' : 'points-right'}`}
    style={`left: ${hoverLeft}px; top: ${hoverTop}px; --notch-top: ${hoverNotchTop}px;`}
    aria-live="polite"
    aria-busy={previewStatus === 'loading'}
  >
    {#if previewStatus === 'loading'}
      <p class="text-sm text-stone-400">Loading preview...</p>
    {:else if previewStatus === 'error'}
      <p class="text-sm text-red-200">{previewError}</p>
    {:else if previewCard}
      <img class="card-image block w-full" src={previewCard.imageUrl} alt={`Scryfall preview for ${previewCard.name}`} />
    {/if}
  </aside>
{/if}

{#each floatingPreviews as floating (floating.id)}
    <div
      class="fixed grid max-h-[calc(100vh-2rem)] min-w-0 w-[calc(100vw-2rem)] max-w-[18rem] grid-cols-[minmax(0,1fr)] gap-3 overflow-auto rounded border border-white/15 bg-stone-950 p-3 shadow-2xl"
      style={`left: ${floating.left}px; top: ${floating.top}px; z-index: ${floating.zIndex};`}
      role="dialog"
      tabindex="-1"
      aria-label={`Scryfall preview for ${floating.cardName}`}
      aria-live="polite"
      aria-busy={floating.status === 'loading'}
      on:mousedown={() => bringPreviewToFront(floating.id)}
      on:pointerdown={(event) => startDragging(event, floating.id)}
      on:pointermove={dragModal}
      on:pointerup={stopDragging}
      on:pointercancel={stopDragging}
    >
      <div
        data-drag-handle
        class="flex min-w-0 cursor-move touch-none select-none items-center justify-between gap-3 border-b border-white/10 pb-3"
      >
        <div class="flex min-w-0 items-center gap-2">
          <svg class="size-4 shrink-0 text-stone-500" viewBox="0 0 16 16" aria-hidden="true">
            <title>Drag to move</title>
            <circle cx="5" cy="3" r="1.25" fill="currentColor" />
            <circle cx="11" cy="3" r="1.25" fill="currentColor" />
            <circle cx="5" cy="8" r="1.25" fill="currentColor" />
            <circle cx="11" cy="8" r="1.25" fill="currentColor" />
            <circle cx="5" cy="13" r="1.25" fill="currentColor" />
            <circle cx="11" cy="13" r="1.25" fill="currentColor" />
          </svg>
          {#if floating.card}
            <a
              class="truncate font-bold text-primary-300 no-underline hover:underline"
              href={floating.card.scryfallUrl}
              target="_blank"
              rel="noreferrer"
              on:pointerdown={(event) => event.stopPropagation()}
            >{floating.card.name}</a>
          {:else}
            <p class="truncate font-bold">{floating.cardName}</p>
          {/if}
        </div>
        <button
          class="grid size-9 shrink-0 cursor-pointer place-items-center rounded border border-white/15 bg-stone-900 text-xl leading-none text-stone-300 transition hover:border-primary-300/60 hover:text-primary-300"
          type="button"
          on:pointerdown={(event) => event.stopPropagation()}
          on:click={() => closeFloatingPreview(floating.id)}
          aria-label={`Close preview for ${floating.cardName}`}
          title="Close preview"
        >
          &times;
        </button>
      </div>

      {#if floating.status === 'loading'}
        <p class="text-sm text-stone-400">Loading Scryfall preview for <strong>{floating.cardName}</strong>...</p>
      {:else if floating.status === 'error'}
        <p class="text-sm text-red-200">{floating.error}</p>
      {:else if floating.card}
        <img class="card-image mx-auto block h-auto min-w-0 max-h-[65vh] w-full max-w-full object-contain" src={floating.card.imageUrl} alt={`Scryfall preview for ${floating.card.name}`} />
      {/if}
    </div>
{/each}

<svelte:window on:keydown={handleWindowKeydown} />

<style>
  .card-name-trigger,
  .card-name-trigger * {
    -webkit-user-select: text !important;
    user-select: text !important;
  }

  .card-image {
    border-radius: 4.75% / 3.4%;
  }

  .card-hover-preview::before {
    position: absolute;
    top: var(--notch-top);
    width: 0;
    height: 0;
    border-top: 7px solid transparent;
    border-bottom: 7px solid transparent;
    content: '';
    transform: translateY(-50%);
  }

  .card-hover-preview.points-left::before {
    left: -7px;
    border-right: 7px solid #0c0a09;
  }

  .card-hover-preview.points-right::before {
    right: -7px;
    border-left: 7px solid #0c0a09;
  }
</style>
