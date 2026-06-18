<script lang="ts">
  export let currentUser: {
    username?: string;
    displayName?: string | null;
    role?: string;
  };

  $: currentName = currentUser.displayName || currentUser.username || "";
  $: currentInitial = (currentName || "?").slice(0, 1).toUpperCase();
</script>

<details class="relative">
  <summary
    class="flex cursor-pointer list-none items-center gap-2 rounded border border-lime-100/10 bg-stone-900 p-1 pr-3 text-stone-100 [&::-webkit-details-marker]:hidden"
    aria-label="User menu"
    title="User menu"
  >
    <span class="grid size-9 shrink-0 place-items-center rounded border border-lime-200 bg-lime-300 text-sm font-black text-stone-950">{currentInitial}</span>
    <span class="hidden min-w-0 sm:grid">
      <strong class="truncate text-sm leading-tight">{currentName}</strong>
      <small class="truncate text-[0.68rem] uppercase text-stone-400">{currentUser.role}</small>
    </span>
  </summary>
  <div class="absolute right-0 top-full mt-2 min-w-64 overflow-hidden rounded border border-lime-100/20 bg-stone-950 shadow-2xl">
    <div class="flex items-center gap-3 border-b border-white/10 p-4">
      <span class="grid size-11 shrink-0 place-items-center rounded border border-lime-200 bg-lime-300 text-sm font-black text-stone-950">{currentInitial}</span>
      <div class="grid min-w-0">
        <strong class="truncate">{currentName}</strong>
        <small class="truncate text-stone-400">{currentUser.username}</small>
      </div>
    </div>
    <a class="block border-t border-white/10 px-4 py-3 text-stone-100 no-underline hover:bg-lime-300 hover:text-stone-950" href="/account">Account</a>
    {#if currentUser.role === "admin" || currentUser.role === "superadmin"}
      <a class="block border-t border-white/10 px-4 py-3 text-stone-100 no-underline hover:bg-lime-300 hover:text-stone-950" href="/admin">User administration</a>
    {/if}
    <form method="POST" action="/logout">
      <button class="block w-full border-0 border-t border-white/10 bg-transparent px-4 py-3 text-left text-stone-100 hover:bg-lime-300 hover:text-stone-950" type="submit">Sign out</button>
    </form>
  </div>
</details>
