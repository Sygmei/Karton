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
</script>

<svelte:head>
  <title>Admin - Karton</title>
</svelte:head>

<main class="admin-page">
  <nav class="top-nav">
    <a href="/">Meta Analyzer</a>
    <a href="/matches">Matcher</a>
    <a href="/account">My account</a>
  </nav>

  <section class="hero">
    <div>
      <p class="eyebrow">Admin</p>
      <h1>User accounts</h1>
    </div>
    <form method="POST" action="/logout">
      <button class="ghost" type="submit">Sign out</button>
    </form>
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
        <h2>{generatedUser?.username ?? "Login link"}</h2>
        <p>Valid until {new Date(form.generatedLink.expiresAt).toLocaleString()}</p>
        <input readonly value={form.generatedLink.connectionUrl} />
      </div>
      <img src={form.generatedLink.qrDataUrl} alt="Temporary login QR code" />
    </section>
  {/if}

  <section class="create-panel">
    <h2>Create user</h2>
    <form method="POST" action="?/createUser" use:enhance={createEnhance}>
      <label>
        <span>Username</span>
        <input name="username" placeholder="example: alex" required />
      </label>
      <label>
        <span>Display name</span>
        <input name="displayName" placeholder="Optional" />
      </label>
      <label>
        <span>Role</span>
        <select name="role">
          {#if data.currentUser.role === "superadmin"}
            <option value="admin">Admin</option>
          {/if}
          <option value="user" selected>User</option>
        </select>
      </label>
      <button type="submit" disabled={creating}>{creating ? "Creating..." : "Create user"}</button>
    </form>
  </section>

  <section class="users-grid">
    {#each data.users as user}
      <article>
        <div>
          <strong>{user.displayName || user.username}</strong>
          <span>@{user.username} - {user.role}</span>
        </div>
        <div class="row-actions">
          <form method="POST" action="?/loginLink">
            <input type="hidden" name="userId" value={String(user.id)} />
            <button type="submit">QR</button>
          </form>
          {#if user.id !== data.currentUser.id && user.role !== "superadmin"}
            <form method="POST" action="?/deleteUser">
              <input type="hidden" name="userId" value={String(user.id)} />
              <button class="danger" type="submit">Delete</button>
            </form>
          {/if}
        </div>
      </article>
    {/each}
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

  .admin-page {
    width: min(1100px, 94vw);
    margin: 0 auto;
    padding: 1rem 0 3rem;
    display: grid;
    gap: 1rem;
  }

  .top-nav,
  .hero,
  .create-panel form,
  .row-actions {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .top-nav {
    justify-content: flex-start;
  }

  a {
    color: #74d3c0;
    text-decoration: none;
  }

  .hero {
    justify-content: space-between;
    border: 1px solid rgba(181, 211, 203, 0.18);
    background: rgba(13, 21, 23, 0.84);
    padding: 1rem;
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

  .notice,
  .create-panel,
  .qr-panel,
  .users-grid article {
    border: 1px solid rgba(181, 211, 203, 0.18);
    background: rgba(13, 21, 23, 0.84);
    padding: 1rem;
  }

  .error {
    color: #ffb1a6;
  }

  .success {
    color: #74d3c0;
  }

  .create-panel {
    display: grid;
    gap: 0.8rem;
  }

  .create-panel form {
    flex-wrap: wrap;
  }

  label {
    display: grid;
    gap: 0.3rem;
  }

  label span,
  article span,
  .qr-panel p {
    color: #aabbb8;
  }

  input,
  select {
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

  button.danger {
    background: rgba(255, 128, 112, 0.18);
    color: #ffb1a6;
  }

  .qr-panel {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 1rem;
    align-items: center;
  }

  .qr-panel div {
    display: grid;
    gap: 0.7rem;
  }

  .qr-panel img {
    width: 180px;
    aspect-ratio: 1;
    background: white;
  }

  .users-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 0.75rem;
  }

  .users-grid article {
    display: grid;
    gap: 0.8rem;
  }

  .users-grid article > div:first-child {
    display: grid;
    gap: 0.2rem;
  }
</style>
