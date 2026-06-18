<script lang="ts">
  import { enhance } from "$app/forms";

  export let data: {
    currentUser: Record<string, unknown>;
    users: Array<Record<string, unknown>>;
  };
  export let form:
    | {
        error?: string;
        success?: string;
        generatedLink?: {
          userId: string;
          connectionUrl: string;
          expiresAt: string;
          qrDataUrl: string;
          ttlMinutes?: number;
        };
      }
    | undefined;

  let creating = false;
  let selectedLoginLinkUserId = "";
  let dismissedGeneratedLinkUrl = "";

  $: activeGeneratedLink =
    form?.generatedLink && dismissedGeneratedLinkUrl !== form.generatedLink.connectionUrl ? form.generatedLink : null;
  $: generatedUser = activeGeneratedLink
    ? data.users.find((user) => user.id === activeGeneratedLink?.userId)
    : null;
  $: selectedLoginLinkUser = selectedLoginLinkUserId
    ? data.users.find((user) => user.id === selectedLoginLinkUserId)
    : null;

  const createEnhance = () => {
    creating = true;
    return async ({ update }: { update: () => Promise<void> }) => {
      await update();
      creating = false;
    };
  };

  const pageClass = "mx-auto grid w-[min(1100px,94vw)] gap-4 py-4 pb-12";
  const panelClass = "rounded border border-white/10 bg-stone-900/80 p-4";
  const inputClass = "w-full rounded border border-white/15 bg-stone-950 px-3 py-2 text-stone-100";
  const buttonClass = "h-10 rounded bg-lime-300 px-4 py-2 font-bold text-stone-950 disabled:opacity-50";
  const dangerButtonClass = "h-10 rounded bg-red-300 px-4 py-2 font-bold text-stone-950";
  const ghostButtonClass = "h-10 rounded border border-white/15 bg-transparent px-4 py-2 font-bold text-stone-100";
  const eyebrowClass = "mb-1 text-xs font-extrabold uppercase tracking-widest text-amber-300";
  const loginLinkTtlOptions = [
    { value: 5, label: "5 min" },
    { value: 15, label: "15 min" },
    { value: 30, label: "30 min" },
    { value: 60, label: "1 hour" },
    { value: 240, label: "4 hours" },
    { value: 1440, label: "1 day" }
  ];

  function formatTtl(minutes: number): string {
    if (minutes < 60) {
      return `${minutes} min`;
    }
    if (minutes % 1440 === 0) {
      return `${minutes / 1440} day${minutes === 1440 ? "" : "s"}`;
    }
    if (minutes % 60 === 0) {
      return `${minutes / 60} hour${minutes === 60 ? "" : "s"}`;
    }
    return `${minutes} min`;
  }

  function openLoginLinkModal(userId: unknown): void {
    selectedLoginLinkUserId = String(userId || "");
  }

  function closeLoginLinkModal(): void {
    selectedLoginLinkUserId = "";
  }

  function dismissGeneratedLink(): void {
    dismissedGeneratedLinkUrl = activeGeneratedLink?.connectionUrl || "";
  }
</script>

<svelte:head>
  <title>Admin - Karton</title>
</svelte:head>

<main class={pageClass}>
  <nav class="flex flex-wrap items-center gap-3 text-sm">
    <a class="text-lime-300 no-underline" href="/analyzer">Deck Analyzer</a>
    <a class="text-lime-300 no-underline" href="/matches">Matcher</a>
    <a class="text-lime-300 no-underline" href="/account">My account</a>
  </nav>

  <section class={`${panelClass} flex flex-wrap items-center justify-between gap-4`}>
    <div>
      <p class={eyebrowClass}>Admin</p>
      <h1 class="text-2xl font-black">User accounts</h1>
    </div>
    <form method="POST" action="/logout">
      <button class={ghostButtonClass} type="submit">Sign out</button>
    </form>
  </section>

  {#if form?.error}
    <p class={`${panelClass} text-red-200`}>{form.error}</p>
  {:else if form?.success}
    <p class={`${panelClass} text-lime-300`}>{form.success}</p>
  {/if}

  <section class={`${panelClass} grid gap-4`}>
    <h2 class="text-xl font-bold">Create user</h2>
    <form class="grid gap-3 md:grid-cols-[1fr_1fr_180px_auto] md:items-end" method="POST" action="?/createUser" use:enhance={createEnhance}>
      <label class="grid gap-1">
        <span class="text-sm text-stone-300">Username</span>
        <input class={inputClass} name="username" placeholder="example: alex" required />
      </label>
      <label class="grid gap-1">
        <span class="text-sm text-stone-300">Display name</span>
        <input class={inputClass} name="displayName" placeholder="Optional" />
      </label>
      <label class="grid gap-1">
        <span class="text-sm text-stone-300">Role</span>
        <select class={inputClass} name="role">
          {#if data.currentUser.role === "superadmin"}
            <option value="admin">Admin</option>
          {/if}
          <option value="user" selected>User</option>
        </select>
      </label>
      <button class={buttonClass} type="submit" disabled={creating}>{creating ? "Creating..." : "Create user"}</button>
    </form>
  </section>

  <section class="grid gap-3 md:grid-cols-2">
    {#each data.users as user}
      <article class={`${panelClass} flex items-center justify-between gap-4`}>
        <div>
          <strong class="block">{user.displayName || user.username}</strong>
          <span class="text-sm text-stone-400">@{user.username} - {user.role}</span>
        </div>
        <div class="flex items-center gap-2">
          <button class={buttonClass} type="button" on:click={() => openLoginLinkModal(user.id)}>QR</button>
          {#if user.id !== data.currentUser.id && user.role !== "superadmin"}
            <form method="POST" action="?/deleteUser">
              <input type="hidden" name="userId" value={String(user.id)} />
              <button class={dangerButtonClass} type="submit">Delete</button>
            </form>
          {/if}
        </div>
      </article>
    {/each}
  </section>
</main>

{#if selectedLoginLinkUser}
  <div class="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4">
    <section class={`${panelClass} grid w-full max-w-md gap-4 shadow-2xl`}>
      <div>
        <p class={eyebrowClass}>Temporary access</p>
        <h2 class="text-xl font-bold">Create QR for {selectedLoginLinkUser.username}</h2>
        <p class="mt-1 text-sm text-stone-400">Choose how long this login link should remain usable.</p>
      </div>

      <form class="grid gap-4" method="POST" action="?/loginLink">
        <input type="hidden" name="userId" value={String(selectedLoginLinkUser.id)} />
        <label class="grid gap-1">
          <span class="text-sm text-stone-300">Expires after</span>
          <select class={inputClass} name="ttlMinutes">
            {#each loginLinkTtlOptions as option}
              <option value={option.value}>{option.label}</option>
            {/each}
          </select>
        </label>
        <div class="flex justify-end gap-2">
          <button class={ghostButtonClass} type="button" on:click={closeLoginLinkModal}>Cancel</button>
          <button class={buttonClass} type="submit">Generate QR</button>
        </div>
      </form>
    </section>
  </div>
{/if}

{#if activeGeneratedLink}
  <div class="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4">
    <section class={`${panelClass} grid w-full max-w-2xl gap-4 shadow-2xl md:grid-cols-[1fr_auto] md:items-center`}>
      <div class="grid gap-3">
        <p class={eyebrowClass}>Temporary access</p>
        <h2 class="text-xl font-bold">{generatedUser?.username ?? "Login link"}</h2>
        <p class="text-stone-400">
          Valid until {new Date(activeGeneratedLink.expiresAt).toLocaleString()}
          {#if activeGeneratedLink.ttlMinutes}
            ({formatTtl(activeGeneratedLink.ttlMinutes)})
          {/if}
        </p>
        <input class={inputClass} readonly value={activeGeneratedLink.connectionUrl} />
        <div>
          <button class={ghostButtonClass} type="button" on:click={dismissGeneratedLink}>Close</button>
        </div>
      </div>
      <img class="size-40 rounded bg-white p-2" src={activeGeneratedLink.qrDataUrl} alt="Temporary login QR code" />
    </section>
  </div>
{/if}
