<script lang="ts">
  import { env } from "$env/dynamic/public";
  import { page } from "$app/stores";
  import { onMount } from "svelte";

  export let data: {
    currentUser?: {
      username?: string;
      displayName?: string | null;
      role?: string;
    } | null;
  };

  type NavItem = {
    href: string;
    label: string;
    kicker: string;
    match: (pathname: string) => boolean;
  };

  const navItems: NavItem[] = [
    {
      href: "/",
      label: "Deck Analyzer",
      kicker: "Add / Cut / Keep",
      match: (pathname) => pathname === "/" || pathname.startsWith("/analysis")
    },
    {
      href: "/matches",
      label: "Matcher",
      kicker: "Buyer / seller",
      match: (pathname) => pathname.startsWith("/matches")
    }
  ];

  $: pathname = $page.url.pathname;
  $: currentName = data.currentUser?.displayName || data.currentUser?.username || "";
  $: currentInitial = (currentName || "?").slice(0, 1).toUpperCase();

  onMount(() => {
    void initFaro();
  });

  async function initFaro(): Promise<void> {
    if (!isEnabled(env.PUBLIC_FARO_ENABLED)) {
      return;
    }
    if (typeof window === "undefined") {
      return;
    }

    const url = (env.PUBLIC_FARO_URL || "").trim();
    if (!url) {
      console.warn("[faro] PUBLIC_FARO_ENABLED=true but PUBLIC_FARO_URL is empty");
      return;
    }

    if ((window as Window & { __mtgMetaFaroInitialized?: boolean }).__mtgMetaFaroInitialized) {
      return;
    }
    (window as Window & { __mtgMetaFaroInitialized?: boolean }).__mtgMetaFaroInitialized = true;

    try {
      const { getWebInstrumentations, initializeFaro } = await import("@grafana/faro-web-sdk");
      initializeFaro({
        url,
        app: {
          name: (env.PUBLIC_FARO_APP_NAME || "mtg-meta-analyzer-web").trim() || "mtg-meta-analyzer-web",
          version: (env.PUBLIC_FARO_APP_VERSION || "0.1.0").trim() || "0.1.0"
        },
        instrumentations: [...getWebInstrumentations()]
      });
      console.info("[faro] initialized");
    } catch (error) {
      (window as Window & { __mtgMetaFaroInitialized?: boolean }).__mtgMetaFaroInitialized = false;
      console.error("[faro] initialization failed", error);
    }
  }

  function isEnabled(raw: string | undefined): boolean {
    const value = (raw || "").trim().toLowerCase();
    return value === "1" || value === "true" || value === "yes" || value === "on";
  }
</script>

<svelte:head>
  <meta name="theme-color" content="#0f1110" />
</svelte:head>

<header class="app-header">
  <a class="brand" href="/" aria-label="Karton home">
    <span class="brand-mark">K</span>
    <span class="brand-copy">
      <strong>Karton</strong>
      <small>MtG tools</small>
    </span>
  </a>

  <nav class="app-tabs" aria-label="Application sections">
    {#each navItems as item}
      <a class:active={item.match(pathname)} href={item.href}>
        <span>{item.label}</span>
        <small>{item.kicker}</small>
      </a>
    {/each}
  </nav>

  <div class="user-zone">
    {#if data.currentUser}
      <details class="user-menu">
        <summary aria-label="User menu" title="User menu">
          <span class="avatar">{currentInitial}</span>
          <span class="user-label">
            <strong>{currentName}</strong>
            <small>{data.currentUser.role}</small>
          </span>
        </summary>
        <div class="menu-card">
          <div class="identity">
            <span class="avatar large">{currentInitial}</span>
            <div>
              <strong>{currentName}</strong>
              <small>{data.currentUser.username}</small>
            </div>
          </div>
          <a href="/account">Account</a>
          {#if data.currentUser.role === "admin" || data.currentUser.role === "superadmin"}
            <a href="/admin">User administration</a>
          {/if}
          <form method="POST" action="/logout">
            <button type="submit">Sign out</button>
          </form>
        </div>
      </details>
    {:else}
      <a class="login-pill" href="/account">
        <span class="avatar">?</span>
        <span>Sign in</span>
      </a>
    {/if}
  </div>
</header>

<slot />

<style>
  :global(*) {
    box-sizing: border-box;
    background-image: none !important;
  }

  :global(body) {
    --page-bg: #0f1110;
    --panel-bg: #151816;
    --panel-bg-strong: #0b0d0c;
    --line-soft: #30362f;
    --line-strong: #4b5548;
    --text-main: #f3f5ee;
    --text-muted: #9ca69a;
    --mint: #a7f06d;
    --gold: #e6bd63;
    --red: #ff806f;

    margin: 0 !important;
    min-height: 100vh;
    background: var(--page-bg) !important;
    color: var(--text-main) !important;
    font-family: "Bahnschrift", "Aptos", "Segoe UI", sans-serif !important;
    letter-spacing: 0 !important;
    overflow-x: hidden;
  }

  :global(body::before) {
    display: none;
  }

  .app-header {
    position: sticky;
    top: 0;
    z-index: 900;
    display: grid;
    grid-template-columns: minmax(190px, 280px) minmax(0, 1fr) auto;
    align-items: center;
    gap: 1rem;
    padding: 0.75rem clamp(0.75rem, 2vw, 1.5rem);
    border-bottom: 1px solid var(--line-soft);
    background: #0f1110;
    box-shadow: none;
  }

  .brand,
  .login-pill,
  .app-tabs a,
  .menu-card a {
    text-decoration: none;
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 0.7rem;
    min-width: 0;
    color: var(--text-main);
  }

  .brand-mark,
  .avatar {
    width: 2.35rem;
    height: 2.35rem;
    display: grid;
    place-items: center;
    flex: 0 0 auto;
    border: 1px solid #c9ff80;
    border-radius: 3px;
    background: var(--mint);
    color: #0f1110;
    font-weight: 950;
    box-shadow: none;
  }

  .brand-copy,
  .user-label {
    display: grid;
    min-width: 0;
  }

  .brand-copy strong,
  .user-label strong {
    overflow: hidden;
    color: var(--text-main);
    font-size: 0.92rem;
    line-height: 1.1;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .brand-copy small,
  .user-label small {
    overflow: hidden;
    color: var(--text-muted);
    font-size: 0.72rem;
    line-height: 1.2;
    text-overflow: ellipsis;
    text-transform: uppercase;
    white-space: nowrap;
  }

  .app-tabs {
    justify-self: center;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    width: min(560px, 100%);
    padding: 0.25rem;
    border: 1px solid var(--line-soft);
    border-radius: 4px;
    background: #141715;
  }

  .app-tabs a {
    display: grid;
    gap: 0.1rem;
    min-width: 0;
    padding: 0.62rem 0.9rem;
    border-radius: 2px;
    color: var(--text-muted);
    text-align: center;
    transition:
      background 140ms ease,
      color 140ms ease,
      box-shadow 140ms ease;
  }

  .app-tabs a span {
    overflow: hidden;
    font-size: 0.92rem;
    font-weight: 850;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .app-tabs a small {
    overflow: hidden;
    font-size: 0.68rem;
    text-overflow: ellipsis;
    text-transform: uppercase;
    white-space: nowrap;
  }

  .app-tabs a:hover,
  .app-tabs a.active {
    color: #0f1110;
    background: var(--mint);
  }

  .app-tabs a.active {
    box-shadow: none;
  }

  .user-zone {
    justify-self: end;
    min-width: 0;
  }

  .user-menu {
    position: relative;
  }

  .user-menu summary,
  .login-pill {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    min-height: 2.85rem;
    max-width: 230px;
    padding: 0.25rem 0.65rem 0.25rem 0.25rem;
    border: 1px solid var(--line-soft);
    border-radius: 4px;
    background: #141715;
    color: var(--text-main);
    cursor: pointer;
    list-style: none;
  }

  .user-menu summary::-webkit-details-marker {
    display: none;
  }

  .avatar {
    width: 2.25rem;
    height: 2.25rem;
    border-radius: 3px;
    font-size: 0.9rem;
  }

  .avatar.large {
    width: 2.65rem;
    height: 2.65rem;
  }

  .login-pill span:last-child {
    padding-right: 0.25rem;
    font-size: 0.86rem;
    font-weight: 800;
  }

  .menu-card {
    position: absolute;
    top: calc(100% + 0.65rem);
    right: 0;
    min-width: 250px;
    overflow: hidden;
    border: 1px solid var(--line-strong);
    border-radius: 4px;
    background: #111411;
    box-shadow: 0 18px 44px rgba(0, 0, 0, 0.38);
  }

  .identity {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.9rem;
    border-bottom: 1px solid var(--line-soft);
  }

  .identity div {
    display: grid;
    gap: 0.15rem;
    min-width: 0;
  }

  .identity strong,
  .identity small {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .identity small {
    color: var(--text-muted);
  }

  .menu-card a,
  .menu-card button {
    display: block;
    width: 100%;
    padding: 0.82rem 0.95rem;
    border: 0;
    border-top: 1px solid rgba(210, 230, 214, 0.1);
    background: transparent;
    color: var(--text-main);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .menu-card a:hover,
  .menu-card button:hover {
    background: var(--mint);
    color: #0f1110;
  }

  :global(.top-nav),
  :global(.section-link) {
    display: none !important;
  }

  :global(.progress-shell) {
    top: 5.6rem !important;
    z-index: 500 !important;
  }

  :global(.stage),
  :global(.match-stage),
  :global(.account-page),
  :global(.admin-page) {
    width: min(1180px, calc(100vw - 32px)) !important;
    padding-top: clamp(1.1rem, 2vw, 1.8rem) !important;
  }

  :global(.panel),
  :global(.match-hero),
  :global(.matcher-form),
  :global(.admin-match-panel),
  :global(.matches-table),
  :global(.loaded-lists),
  :global(.saved-panel),
  :global(.summary-band),
  :global(.hero),
  :global(.notice),
  :global(.add-panel),
  :global(.profile-panel),
  :global(.qr-panel),
  :global(.create-panel),
  :global(.users-grid article),
  :global(.list-columns > div),
  :global(.account-page article) {
    border-color: var(--line-soft) !important;
    border-radius: 4px !important;
    background: var(--panel-bg) !important;
    box-shadow: none !important;
  }

  :global(input),
  :global(textarea),
  :global(select) {
    border-color: rgba(210, 230, 214, 0.24) !important;
    border-radius: 3px !important;
    background: #0c0f0d !important;
  }

  :global(button) {
    border-radius: 3px !important;
    background-color: var(--mint) !important;
    color: #0f1110 !important;
    box-shadow: none !important;
  }

  :global(.progress-track),
  :global(.progress-fill),
  :global(.metro-pill),
  :global(.analysis-tabs),
  :global(.analysis-tabs button),
  :global(.summary-band) {
    border-radius: 3px !important;
  }

  :global(.progress-fill),
  :global(.metro-step.active .metro-pill),
  :global(.metro-step.done .metro-pill),
  :global(.analysis-tabs button.active) {
    background: var(--mint) !important;
    color: #0f1110 !important;
    animation: none !important;
  }

  :global(.metro-step::after),
  :global(.metro-step.done::after) {
    background: var(--line-strong) !important;
  }

  @media (max-width: 880px) {
    .app-header {
      grid-template-columns: minmax(0, 1fr) auto;
      grid-template-areas:
        "brand user"
        "tabs tabs";
      gap: 0.65rem;
      padding: 0.65rem 0.75rem;
    }

    .brand {
      grid-area: brand;
    }

    .app-tabs {
      grid-area: tabs;
      justify-self: stretch;
      width: 100%;
    }

    .user-zone {
      grid-area: user;
    }

    .user-label {
      display: none;
    }

    .user-menu summary,
    .login-pill {
      padding: 0.2rem;
      min-height: auto;
    }

    .login-pill span:last-child {
      display: none;
    }

    :global(.stage),
    :global(.match-stage),
    :global(.account-page),
    :global(.admin-page) {
      width: min(100vw - 20px, 1180px) !important;
    }

    :global(.progress-shell) {
      top: 6.6rem !important;
    }
  }

  @media (max-width: 520px) {
    .brand-copy small,
    .app-tabs a small {
      display: none;
    }

    .brand-mark {
      width: 2.15rem;
      height: 2.15rem;
    }

    .brand-copy strong {
      font-size: 0.84rem;
    }

    .app-tabs a {
      padding: 0.58rem 0.45rem;
    }

    .app-tabs a span {
      font-size: 0.82rem;
    }

    .menu-card {
      position: fixed;
      top: 6.7rem;
      right: 0.75rem;
      left: 0.75rem;
      min-width: 0;
    }
  }
</style>
