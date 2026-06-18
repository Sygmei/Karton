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
        };
      }
    | undefined;

  let creating = false;

  $: generatedUser = form?.generatedLink
    ? data.users.find((user) => user.id === form.generatedLink?.userId)
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
  const buttonClass = "rounded bg-lime-300 px-4 py-2 font-bold text-stone-950 disabled:opacity-50";
  const dangerButtonClass = "rounded bg-red-300 px-4 py-2 font-bold text-stone-950";
  const ghostButtonClass = "rounded border border-white/15 bg-transparent px-4 py-2 font-bold text-stone-100";
  const eyebrowClass = "mb-1 text-xs font-extrabold uppercase tracking-widest text-amber-300";
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

  {#if form?.generatedLink}
    <section class={`${panelClass} grid gap-4 md:grid-cols-[1fr_auto] md:items-center`}>
      <div class="grid gap-3">
        <p class={eyebrowClass}>Temporary access</p>
        <h2 class="text-xl font-bold">{generatedUser?.username ?? "Login link"}</h2>
        <p class="text-stone-400">Valid until {new Date(form.generatedLink.expiresAt).toLocaleString()}</p>
        <input class={inputClass} readonly value={form.generatedLink.connectionUrl} />
      </div>
      <img class="size-36 rounded bg-white p-2" src={form.generatedLink.qrDataUrl} alt="Temporary login QR code" />
    </section>
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
          <form method="POST" action="?/loginLink">
            <input type="hidden" name="userId" value={String(user.id)} />
            <button class={buttonClass} type="submit">QR</button>
          </form>
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
