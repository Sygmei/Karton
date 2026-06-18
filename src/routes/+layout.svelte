<script lang="ts">
  import "../app.css";

  import AppHeader from "$lib/components/AppHeader.svelte";

  export let data: {
    currentUser?: {
      username?: string;
      displayName?: string | null;
      role?: string;
    } | null;
  };

</script>

<svelte:head>
  <link rel="icon" href="/favicon.ico" sizes="any" />
  <meta name="theme-color" content="#0f1110" />
</svelte:head>

<AppHeader currentUser={data.currentUser} />

<slot />
