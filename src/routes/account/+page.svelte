<script lang="ts">
  export let data: {
    currentUser: {
      username: string;
      displayName?: string | null;
      role: string;
    };
  };
  export let form:
    | {
        error?: string;
        success?: string;
        generatedLink?: {
          connectionUrl: string;
          expiresAt: string;
          qrDataUrl: string;
        };
      }
    | undefined;
</script>

<svelte:head>
  <title>My Account - Karton</title>
</svelte:head>

<main class="account-page">
  <nav class="top-nav">
    <a href="/">Meta Analyzer</a>
    <a href="/matches">Matcher</a>
    {#if data.currentUser.role === "admin" || data.currentUser.role === "superadmin"}
      <a href="/admin">Admin</a>
    {/if}
  </nav>

  <section class="hero">
    <div>
      <p class="eyebrow">Signed in</p>
      <h1>{data.currentUser.displayName || data.currentUser.username}</h1>
      <p>@{data.currentUser.username} - {data.currentUser.role}</p>
    </div>
    <div class="hero-actions">
      <form method="POST" action="?/loginLink">
        <button type="submit">Login on another device</button>
      </form>
      <form method="POST" action="/logout">
        <button class="ghost" type="submit">Sign out</button>
      </form>
    </div>
  </section>

  {#if form?.error}
    <p class="notice error">{form.error}</p>
  {:else if form?.success}
    <p class="notice success">{form.success}</p>
  {/if}

  {#if form?.generatedLink}
    <section class="qr-panel">
      <div>
        <p class="eyebrow">Temporary access</p>
        <h2>Login on another device</h2>
        <p>Valid until {new Date(form.generatedLink.expiresAt).toLocaleString()}</p>
        <input readonly value={form.generatedLink.connectionUrl} />
      </div>
      <img src={form.generatedLink.qrDataUrl} alt="Temporary login QR code" />
    </section>
  {/if}

  <section class="profile-panel">
    <div>
      <p class="eyebrow">Profile</p>
      <h2>Account</h2>
    </div>
    <form method="POST" action="?/updateProfile">
      <label>
        <span>Display name</span>
        <input name="displayName" placeholder="Optional" value={data.currentUser.displayName || ""} />
      </label>
      <button type="submit">Save account</button>
    </form>
  </section>
</main>

<style>
  :global(body) {
    margin: 0;
    min-height: 100vh;
    background: #0d1114;
    color: #edf3ef;
    font-family: "Avenir Next", "Segoe UI", sans-serif;
  }

  .account-page {
    width: min(900px, 94vw);
    margin: 0 auto;
    padding: 1rem 0 3rem;
    display: grid;
    gap: 1rem;
  }

  .top-nav,
  .hero,
  .hero-actions,
  .profile-panel form {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  a {
    color: #74d3c0;
    text-decoration: none;
  }

  .hero,
  .notice,
  .profile-panel,
  .qr-panel {
    border: 1px solid rgba(181, 211, 203, 0.18);
    background: rgba(13, 21, 23, 0.84);
    padding: 1rem;
  }

  .hero {
    justify-content: space-between;
  }

  .eyebrow {
    margin: 0 0 0.35rem;
    color: #f3bd70;
    font-size: 0.76rem;
    font-weight: 800;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }

  h1,
  h2,
  p {
    margin: 0;
  }

  .hero p,
  .qr-panel p {
    color: #aabbb8;
  }

  .error {
    color: #ffb1a6;
  }

  .success {
    color: #74d3c0;
  }

  .profile-panel,
  .qr-panel div {
    display: grid;
    gap: 0.8rem;
  }

  .profile-panel form {
    flex-wrap: wrap;
  }

  label {
    display: grid;
    gap: 0.3rem;
  }

  input {
    border: 1px solid rgba(166, 204, 195, 0.28);
    background: rgba(5, 10, 12, 0.64);
    color: #edf3ef;
    border-radius: 3px;
    padding: 0.65rem;
    font: inherit;
  }

  button {
    border: 0;
    border-radius: 3px;
    padding: 0.65rem 0.9rem;
    color: #071111;
    background: #74d3c0;
    font: inherit;
    font-weight: 900;
    cursor: pointer;
  }

  button.ghost {
    background: rgba(116, 211, 192, 0.12);
    color: #74d3c0;
  }

  .qr-panel {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 1rem;
    align-items: center;
  }

  .qr-panel img {
    width: 180px;
    justify-self: end;
    background: white;
  }

  @media (max-width: 780px) {
    .hero,
    .qr-panel {
      grid-template-columns: 1fr;
    }

    .hero {
      align-items: flex-start;
      flex-direction: column;
    }

    .qr-panel img {
      justify-self: start;
    }
  }
</style>
