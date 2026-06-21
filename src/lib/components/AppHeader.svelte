<script lang="ts">
  import { afterNavigate } from "$app/navigation";
  import { page } from "$app/stores";

  import UserMenu from "./UserMenu.svelte";

  export let currentUser:
    | {
        id?: string;
        username?: string;
        displayName?: string | null;
        role?: string;
      }
    | null
    | undefined = null;
  export let userLoaded = false;

  type NavItem = {
    href: string;
    label: string;
    kicker: string;
    match: (pathname: string) => boolean;
  };

  const navItems: NavItem[] = [
    {
      href: "/analyzer",
      label: "Deck Analyzer",
      kicker: "Add / Cut / Keep",
      match: (pathname) => pathname.startsWith("/analyzer") || pathname.startsWith("/analysis")
    },
    {
      href: "/matches",
      label: "Matcher",
      kicker: "Buyer / seller",
      match: (pathname) => pathname.startsWith("/matches")
    }
  ];

  let optimisticPath: string | null = null;

  $: currentPath = $page.url.pathname;
  $: if (optimisticPath && currentPath === optimisticPath) {
    optimisticPath = null;
  }
  $: pathname = optimisticPath ?? currentPath;
  $: visibleNavItems = currentUser || !userLoaded ? navItems : navItems.filter((item) => item.href !== "/matches");

  afterNavigate(() => {
    optimisticPath = null;
  });

  function markNavigation(href: string): void {
    if (href !== currentPath) {
      optimisticPath = href;
    }
  }
</script>

<header class="sticky top-0 z-50 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 border-b border-lime-100/10 bg-[#0f1110] px-2 py-2 sm:px-5 sm:py-3 lg:grid-cols-[260px_minmax(0,1fr)_auto] lg:gap-3">
  <a class="flex min-w-0 items-center gap-3 text-stone-100 no-underline" href="/" aria-label="Karton home">
    <img class="size-9 shrink-0 rounded border border-lime-100/20 bg-stone-950 object-contain p-1 sm:size-9" src="/icon.svg" alt="" aria-hidden="true" />
    <span class="hidden min-w-0 sm:grid">
      <strong class="truncate text-sm leading-tight">Karton</strong>
      <small class="truncate text-[0.68rem] uppercase text-stone-400">MtG tools</small>
    </span>
  </a>

  <nav class="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)] gap-1 sm:gap-2 lg:justify-self-center lg:w-[min(560px,100%)]" aria-label="Application sections">
    <a
      class={`grid h-10 min-w-10 place-items-center rounded border px-2 text-center no-underline transition sm:min-w-11 sm:px-3 ${pathname === "/" ? "border-lime-300 bg-lime-300 text-stone-950" : "border-lime-100/10 bg-stone-900 text-stone-400 hover:bg-stone-800 hover:text-stone-100"}`}
      href="/"
      on:pointerdown={() => markNavigation("/")}
      on:click={() => markNavigation("/")}
      aria-label="Home"
      aria-current={pathname === "/" ? "page" : undefined}
      title="Home"
    >
      <svg class="size-4" viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M3 10.5 12 3l9 7.5V21a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1v-10.5Z"
          fill="none"
          stroke="currentColor"
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
        />
      </svg>
    </a>
    {#each navItems as item}
      <a
        class={`grid h-10 min-w-0 place-items-center rounded border px-2 text-center no-underline transition sm:h-auto sm:px-3 sm:py-2 ${visibleNavItems.includes(item) ? "" : "invisible pointer-events-none"} ${item.match(pathname) ? "border-lime-300 bg-lime-300 text-stone-950" : "border-lime-100/10 bg-stone-900 text-stone-400 hover:bg-stone-800 hover:text-stone-100"}`}
        href={item.href}
        on:pointerdown={() => markNavigation(item.href)}
        on:click={() => markNavigation(item.href)}
        aria-current={item.match(pathname) ? "page" : undefined}
        aria-hidden={!visibleNavItems.includes(item)}
        tabindex={visibleNavItems.includes(item) ? undefined : -1}
      >
        <span class="truncate text-xs font-extrabold sm:text-sm">{item.label}</span>
        <small class="hidden truncate text-[0.66rem] uppercase sm:block">{item.kicker}</small>
      </a>
    {/each}
  </nav>

  {#if currentUser}
    <div class="justify-self-end">
      <UserMenu {currentUser} />
    </div>
  {/if}
</header>
