<script lang="ts">
  import { onMount } from 'svelte';
  import { t } from '$lib/i18n';
  export let id: string;
  export let label: string;
  export let players: { id: string; name: string; username: string }[];
  export let excluded: string[] = [];
  export let value = '';
  let query = '';
  let selected = '';
  let open = false;
  let active = -1;
  let input: HTMLInputElement;
  let above = false;
  let menuHeight = 220;
  function positionMenu() {
    if (!input) return;
    const rect = input.getBoundingClientRect();
    const viewport = window.visualViewport;
    const top = rect.top - (viewport?.offsetTop ?? 0);
    const bottom = (viewport?.height ?? window.innerHeight) + (viewport?.offsetTop ?? 0) - rect.bottom;
    above = bottom < 180 && top > bottom;
    menuHeight = Math.max(60, Math.min(220, (above ? top : bottom) - 12));
  }
  onMount(() => {
    window.addEventListener('resize', positionMenu);
    window.addEventListener('scroll', positionMenu, true);
    window.visualViewport?.addEventListener('resize', positionMenu);
    return () => {
      window.removeEventListener('resize', positionMenu);
      window.removeEventListener('scroll', positionMenu, true);
      window.visualViewport?.removeEventListener('resize', positionMenu);
    };
  });
  $: if (value !== selected) {
    selected = value;
    query = players.find((player) => player.id === value)?.name ?? '';
  }
  $: options = players.filter((player) => !excluded.includes(player.id) && `${player.name} ${player.username}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())).slice(0, 30);
  function choose(player: typeof players[number]) {
    value = selected = player.id; query = player.name; open = false; active = -1;
  }
</script>

<div class="picker" on:focusout={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) open = false; }}>
  <label class="t-label" for={id}>{label}</label>
  <div class="player-input">
  <input bind:this={input} {id} class="t-input" role="combobox" aria-autocomplete="list" aria-expanded={open}
    aria-controls={`${id}-options`} aria-activedescendant={open && active >= 0 ? `${id}-option-${active}` : undefined}
    autocomplete="off" placeholder={$t('tournament.selectPlayer')} bind:value={query}
    on:focus={() => { positionMenu(); open = true; active = -1; }}
    on:input={() => { value = selected = ''; open = true; active = -1; }}
    on:keydown={(event) => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault(); open = true;
        active = options.length ? (active + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length : -1;
        document.getElementById(`${id}-option-${active}`)?.scrollIntoView({ block: 'nearest' });
      } else if (event.key === 'Enter' && open) {
        event.preventDefault(); if (options[active]) choose(options[active]);
      } else if (event.key === 'Escape') { open = false; active = -1; }
    }} />
  {#if open}
    <div id={`${id}-options`} role="listbox" aria-label={label} class="options" class:above style:max-height={`${menuHeight}px`}>
      {#each options as player, index}
        <button type="button" id={`${id}-option-${index}`} role="option" aria-selected={active === index} class:highlight={active === index}
          on:mousedown={(event) => event.preventDefault()} on:click={() => choose(player)}>
          <strong>{player.name}</strong>{#if player.username}<small>@{player.username}</small>{/if}
        </button>
      {:else}<p class="t-muted p-3">{$t('tournament.noPlayersFound')}</p>{/each}
    </div>
  {/if}
  </div>
</div>

<style>
  .picker { position: relative; min-width: 0; display: grid; gap: .4rem; }
  .player-input { position: relative; min-width: 0; }
  .options.above { top: auto; bottom: 100%; }
  .options { position: absolute; top: 100%; left: 0; right: 0; z-index: 30; max-height: 220px; overflow-y: auto; border: 1px solid #ffffff30; border-radius: .375rem; background: var(--canvas); box-shadow: 0 12px 25px #0006; }
  .options button { display: grid; gap: .2rem; width: 100%; text-align: left; padding: .75rem; overflow-wrap: anywhere; cursor: pointer; }
  .options button:hover, .options .highlight { background: #ffffff15; }
  small { color: #a8a29e; }
</style>
