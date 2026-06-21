<script lang="ts">
  import "../app.css";

  import { onMount } from "svelte";

  import AppHeader from "$lib/components/AppHeader.svelte";
  import { currentUser, type CurrentUser } from "$lib/current-user";
  import { initLanguage } from "$lib/i18n";

  let currentUserLoaded = false;

  onMount(async () => {
    initLanguage();
    try {
      const response = await fetch("/api/session", {
        headers: {
          accept: "application/json"
        }
      });
      if (!response.ok) {
        currentUser.set(null);
        return;
      }
      const payload = (await response.json()) as { currentUser?: CurrentUser | null };
      currentUser.set(payload.currentUser ?? null);
    } catch {
      currentUser.set(null);
    } finally {
      currentUserLoaded = true;
    }
  });
</script>

<svelte:head>
  <link rel="icon" href="/favicon.ico" sizes="any" />
  <meta name="theme-color" content="#0f1110" />
</svelte:head>

<AppHeader currentUser={$currentUser} userLoaded={currentUserLoaded} />

<slot />
