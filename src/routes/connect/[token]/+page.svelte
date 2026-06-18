<script lang="ts">
  import { enhance } from "$app/forms";

  export let data: {
    loginUser: {
      username: string;
      displayName?: string | null;
      role: string;
    };
    expiresAt: string;
  };

  export let form:
    | {
        error?: string;
      }
    | undefined;

  let isSubmitting = false;

  $: loginName = data.loginUser.displayName || data.loginUser.username;

  const panelClass = "rounded border border-white/10 bg-stone-900/95 p-5 shadow-2xl";
  const buttonClass = "h-10 rounded bg-lime-300 px-4 py-2 font-bold text-stone-950 disabled:opacity-50";
  const ghostButtonClass = "h-10 rounded border border-white/15 bg-transparent px-4 py-2 font-bold text-stone-100 no-underline";

  const confirmEnhance = () => {
    isSubmitting = true;
    return async ({ update }: { update: () => Promise<void> }) => {
      await update();
      isSubmitting = false;
    };
  };
</script>

<svelte:head>
  <title>Login - Karton</title>
  <meta name="robots" content="noindex,nofollow" />
  <meta property="og:title" content="Karton login link" />
  <meta property="og:description" content="Open Karton to confirm this login link." />
</svelte:head>

<main class="grid min-h-[calc(100vh-64px)] place-items-center px-4 py-10">
  <section class={`${panelClass} grid w-full max-w-sm gap-4`}>
    <div>
      <p class="text-xs font-extrabold uppercase tracking-widest text-lime-300">Temporary access</p>
      <h1 class="mt-2 text-2xl font-black">Do you want to login as {loginName}?</h1>
      <p class="mt-2 text-sm text-stone-400">
        @{data.loginUser.username} - expires {new Date(data.expiresAt).toLocaleString()}
      </p>
    </div>

    {#if form?.error}
      <p class="rounded border border-red-300/20 bg-red-950/30 p-3 text-sm text-red-200">{form.error}</p>
    {/if}

    <form class="flex flex-wrap justify-end gap-2" method="POST" use:enhance={confirmEnhance}>
      <a class={ghostButtonClass} href="/">Cancel</a>
      <button class={buttonClass} type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Logging in..." : "Confirm"}
      </button>
    </form>
  </section>
</main>
