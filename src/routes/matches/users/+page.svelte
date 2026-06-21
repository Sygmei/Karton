<script lang="ts">
  import { onMount } from "svelte";

  type UserList = {
    id: string;
    kind: "buyer" | "seller";
    label: string | null;
    url: string;
    position: number;
  };

  type DirectoryUser = {
    id: string;
    username: string;
    displayName?: string | null;
    role: string;
    lists: UserList[];
  };

  type DirectoryPayload = {
    users: DirectoryUser[];
  };

  let directoryPromise: Promise<DirectoryPayload> = pending();
  let query = "";

  $: normalizedQuery = query.trim().toLowerCase();

  onMount(() => {
    directoryPromise = fetchJson<DirectoryPayload>("/matches/users/data");
  });

  function pending<T>(): Promise<T> {
    return new Promise(() => {});
  }

  async function fetchJson<T>(url: string): Promise<T> {
    const response = await fetch(url, {
      headers: {
        accept: "application/json"
      }
    });
    if (!response.ok) {
      throw new Error((await response.text()) || "Request failed.");
    }
    return (await response.json()) as T;
  }

  function visibleUsers(users: DirectoryUser[]): DirectoryUser[] {
    if (!normalizedQuery) {
      return users;
    }
    return users.filter((user) => {
      const haystack = [
        user.username,
        user.displayName || "",
        ...user.lists.flatMap((list) => [list.label || "", list.url])
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }

  function listsByKind(user: DirectoryUser, kind: "buyer" | "seller"): UserList[] {
    return user.lists.filter((list) => list.kind === kind);
  }

  function displayName(user: DirectoryUser): string {
    return user.displayName || user.username;
  }

  const pageClass = "mx-auto grid w-[min(1180px,94vw)] gap-4 py-4 pb-12";
  const panelClass = "rounded border border-white/10 bg-stone-900/80 p-4";
  const inputClass = "w-full rounded border border-white/15 bg-stone-950 px-3 py-2 text-stone-100 placeholder:text-stone-600";
  const eyebrowClass = "text-xs font-extrabold uppercase tracking-widest text-lime-300";
  const skeletonBlockClass = "animate-pulse rounded bg-stone-950/80";
</script>

<svelte:head>
  <title>Matcher users - Karton</title>
</svelte:head>

<main class={pageClass}>
  <nav class="flex flex-wrap items-center justify-between gap-3 text-sm text-stone-400">
    <a class="text-lime-300 no-underline" href="/matches">Matcher</a>
    <span>User lists</span>
  </nav>

  <section class={`${panelClass} grid gap-3 md:grid-cols-[1fr_320px] md:items-end`}>
    <div>
      <p class={eyebrowClass}>Matcher directory</p>
      <h1 class="mt-2 text-3xl font-black">Users and saved lists</h1>
      <p class="mt-2 text-stone-400">Browse each account's looking-for and selling lists.</p>
    </div>
    <label class="grid gap-1">
      <span class="text-sm text-stone-300">Filter</span>
      <input class={inputClass} bind:value={query} placeholder="Name, username, label, URL" />
    </label>
  </section>

  {#await directoryPromise}
    <section class="grid gap-3 md:grid-cols-2">
      {#each Array(6) as _}
        <article class={`${panelClass} grid gap-3`}>
          <span class={`${skeletonBlockClass} h-6 w-40 max-w-full`}></span>
          <span class={`${skeletonBlockClass} h-4 w-28 max-w-full`}></span>
          <span class={`${skeletonBlockClass} h-16 w-full`}></span>
        </article>
      {/each}
    </section>
  {:then directory}
    {@const users = visibleUsers(directory.users)}
    <section class={`${panelClass} flex flex-wrap items-center justify-between gap-3`}>
      <span class="text-sm text-stone-300">{users.length} users shown</span>
      <span class="text-sm text-stone-400">
        {directory.users.reduce((sum, user) => sum + user.lists.length, 0)} saved lists total
      </span>
    </section>

    {#if users.length}
      <section class="grid gap-3 md:grid-cols-2">
        {#each users as user}
          {@const buyerLists = listsByKind(user, "buyer")}
          {@const sellerLists = listsByKind(user, "seller")}
          <article class={`${panelClass} grid gap-4 content-start`}>
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div class="min-w-0">
                <h2 class="truncate text-xl font-bold">{displayName(user)}</h2>
                <p class="truncate text-sm text-stone-400">@{user.username} - {user.role}</p>
              </div>
              <span class="rounded bg-stone-950 px-3 py-1 text-sm text-stone-300">{user.lists.length} lists</span>
            </div>

            <div class="grid gap-3 lg:grid-cols-2">
              <div class="grid content-start gap-2">
                <h3 class="text-sm font-bold text-lime-300">Looking for ({buyerLists.length})</h3>
                {#if buyerLists.length}
                  {#each buyerLists as list}
                    <a class="grid min-w-0 rounded border border-white/10 bg-stone-950/60 p-3 text-stone-100 no-underline hover:border-lime-300/50" href={list.url} target="_blank" rel="noreferrer">
                      <strong class="truncate">{list.label || list.url}</strong>
                      <span class="truncate text-sm text-stone-400">{list.url}</span>
                    </a>
                  {/each}
                {:else}
                  <p class="text-sm text-stone-500">No looking-for lists.</p>
                {/if}
              </div>

              <div class="grid content-start gap-2">
                <h3 class="text-sm font-bold text-lime-300">Selling ({sellerLists.length})</h3>
                {#if sellerLists.length}
                  {#each sellerLists as list}
                    <a class="grid min-w-0 rounded border border-white/10 bg-stone-950/60 p-3 text-stone-100 no-underline hover:border-lime-300/50" href={list.url} target="_blank" rel="noreferrer">
                      <strong class="truncate">{list.label || list.url}</strong>
                      <span class="truncate text-sm text-stone-400">{list.url}</span>
                    </a>
                  {/each}
                {:else}
                  <p class="text-sm text-stone-500">No selling lists.</p>
                {/if}
              </div>
            </div>
          </article>
        {/each}
      </section>
    {:else}
      <section class={`${panelClass} text-stone-400`}>No users match this filter.</section>
    {/if}
  {:catch error}
    <section class={`${panelClass} text-red-200`}>
      {error instanceof Error ? error.message : "Could not load user lists."}
    </section>
  {/await}
</main>
