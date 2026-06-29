<script lang="ts">
  import "../app.css";

  import { afterNavigate } from "$app/navigation";
  import { onMount } from "svelte";

  import AppHeader from "$lib/components/AppHeader.svelte";
  import { currentUser, type CurrentUser } from "$lib/current-user";
  import { initLanguage } from "$lib/i18n";

  let currentUserLoaded = false;
  let currentUserRefreshId = 0;

  async function refreshCurrentUser(): Promise<void> {
    const refreshId = ++currentUserRefreshId;
    try {
      const response = await fetch("/api/session", {
        headers: {
          accept: "application/json"
        }
      });
      if (refreshId !== currentUserRefreshId) {
        return;
      }
      if (!response.ok) {
        currentUser.set(null);
        return;
      }
      const payload = (await response.json()) as { currentUser?: CurrentUser | null };
      if (refreshId !== currentUserRefreshId) {
        return;
      }
      currentUser.set(payload.currentUser ?? null);
    } catch {
      if (refreshId === currentUserRefreshId) {
        currentUser.set(null);
      }
    } finally {
      if (refreshId === currentUserRefreshId) {
        currentUserLoaded = true;
      }
    }
  }

  onMount(() => {
    initLanguage();
    void refreshCurrentUser();
  });

  afterNavigate(() => {
    if (currentUserLoaded) {
      void refreshCurrentUser();
    }
  });
</script>

<svelte:head>
  <link rel="icon" href="/favicon.ico" sizes="any" />
  <meta name="theme-color" content="#0f1110" />
</svelte:head>

<AppHeader currentUser={$currentUser} userLoaded={currentUserLoaded} />

<slot />
