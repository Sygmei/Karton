<script lang="ts">
  import { enhance } from "$app/forms";

  import type { CardListMatchResult, UserContactMatchResult } from "$lib/server/types";

  type CurrentUser = {
    id: string;
    username: string;
    displayName?: string | null;
    role: string;
  };

  type AdminUser = CurrentUser & {
    lists: {
      buyer: number;
      seller: number;
    };
  };

  export let data: {
    currentUser?: CurrentUser | null;
    savedLists?: Array<{ id: string; kind: "buyer" | "seller"; label: string | null; url: string }>;
    adminUsers?: AdminUser[];
  };

  export let form:
    | {
        error?: string;
        success?: string;
        accountOutput?: UserContactMatchResult;
        adminOutput?: CardListMatchResult;
        adminContactOutput?: UserContactMatchResult;
        selectedUserIds?: string[];
        adminFocusUserId?: string;
        traceId?: string;
      }
    | undefined;

  let isSubmitting = false;

  $: accountOutput = form?.accountOutput;
  $: adminOutput = form?.adminOutput;
  $: adminContactOutput = form?.adminContactOutput;
  $: selectedUserIds = form?.selectedUserIds ?? [];
  $: adminFocusUserId = form?.adminFocusUserId ?? "";
  $: savedBuyerCount = data.savedLists?.filter((list) => list.kind === "buyer").length ?? 0;
  $: savedSellerCount = data.savedLists?.filter((list) => list.kind === "seller").length ?? 0;
  $: buyerLists = data.savedLists?.filter((list) => list.kind === "buyer") ?? [];
  $: sellerLists = data.savedLists?.filter((list) => list.kind === "seller") ?? [];
  $: adminUsers = data.adminUsers ?? [];
  $: isAdmin = data.currentUser?.role === "admin" || data.currentUser?.role === "superadmin";
  $: adminFocusUser = adminUsers.find((user) => user.id === adminFocusUserId);

  const enhanceSubmit = () => {
    isSubmitting = true;
    return async ({ update }: { update: () => Promise<void> }) => {
      await update();
      isSubmitting = false;
    };
  };

  function sourceLabel(source: string): string {
    if (source === "mythic-tools") return "Mythic Tools";
    if (source === "cardmarket") return "Cardmarket";
    if (source === "archidekt") return "Archidekt";
    return "Moxfield";
  }

  function listNames(items: Array<{ listName: string; url: string; quantity: number }>): string {
    return items.map((item) => `${item.listName} (${item.quantity})`).join(", ");
  }

  function toggleAllPeople(event: Event): void {
    const input = event.currentTarget as HTMLInputElement;
    const form = input.form;
    if (!form) return;
    for (const checkbox of Array.from(form.querySelectorAll<HTMLInputElement>('input[name="userIds"]'))) {
      checkbox.checked = input.checked;
    }
  }
</script>

<svelte:head>
  <title>Matcher - Karton</title>
</svelte:head>

<main class="match-stage">
  <nav class="top-nav">
    <a href="/">Meta Analyzer</a>
    <span>Karton Matcher</span>
  </nav>

  <section class="match-hero">
    <div>
      <p class="eyebrow">Buyer and seller overlap</p>
      <h1>Match cards across public lists</h1>
    </div>
    <p>
      Uses saved looking-for and selling lists from Karton accounts, then ranks exact card-name
      overlaps so each user knows who to contact.
    </p>
  </section>

  {#if data.currentUser}
    <section class="saved-panel">
      <div>
        <p class="eyebrow">My saved lists</p>
        <h2>Find people to contact</h2>
        <p>
          Uses your {savedBuyerCount} looking-for lists and {savedSellerCount} selling lists against
          all other saved user lists.
        </p>
      </div>
      <div class="saved-actions">
        <form method="POST" action="?/saved" use:enhance={enhanceSubmit}>
          <button type="submit" disabled={isSubmitting || (!savedBuyerCount && !savedSellerCount)}>
            {isSubmitting ? "Matching..." : "Find people to contact"}
          </button>
        </form>
      </div>
    </section>
  {/if}

  <section class="add-panel" id="lists">
    <div>
      <p class="eyebrow">Saved lists</p>
      <h2>Add a list</h2>
    </div>
    <form method="POST" action="?/addList">
      <label>
        <span>Type</span>
        <select name="kind">
          <option value="buyer">I'm looking for</option>
          <option value="seller">I'm selling</option>
        </select>
      </label>
      <label>
        <span>Label</span>
        <input name="label" placeholder="Optional" />
      </label>
      <label class="url-field">
        <span>URL</span>
        <input name="url" placeholder="Moxfield, Archidekt, Cardmarket, Mythic Tools" required />
      </label>
      <button type="submit">Add list</button>
    </form>
  </section>

  <section class="list-columns">
    <div>
      <h2>I'm looking for</h2>
      {@render ListColumn(buyerLists)}
    </div>
    <div>
      <h2>I'm selling</h2>
      {@render ListColumn(sellerLists)}
    </div>
  </section>

  {#if isAdmin}
    <section class="admin-match-panel">
      <div class="admin-panel-head">
        <div>
          <p class="eyebrow">Admin compute</p>
          <h2>Run a match for selected people</h2>
          <p>Select accounts, then compute buyer and seller overlap only inside that set.</p>
        </div>
      </div>
      <form method="POST" action="?/adminSet" use:enhance={enhanceSubmit}>
        <div class="admin-controls">
          <label class="select-all-row">
            <input
              type="checkbox"
              on:change={toggleAllPeople}
              checked={adminUsers.length > 0 && selectedUserIds.length === adminUsers.length}
            />
            <span>Select all</span>
          </label>

          <label class="focus-field">
            <span>Search matches as</span>
            <select name="focusUserId">
              <option value="" selected={!adminFocusUserId}>Group overlap</option>
              {#each adminUsers as user}
                <option value={user.id} selected={adminFocusUserId === user.id}>
                  {user.displayName || user.username}
                </option>
              {/each}
            </select>
          </label>
        </div>

        <div class="people-grid">
          {#each adminUsers as user}
            <label>
              <input type="checkbox" name="userIds" value={user.id} checked={selectedUserIds.includes(user.id)} />
              <span>
                <strong>{user.displayName || user.username}</strong>
                <small>{user.lists.buyer} looking / {user.lists.seller} selling</small>
              </span>
            </label>
          {/each}
        </div>
        <div class="form-actions">
          <button type="submit" disabled={isSubmitting || adminUsers.length < 2}>
            {isSubmitting ? "Matching..." : "Compute selected people"}
          </button>
        </div>
      </form>
    </section>
  {/if}

  {#if form?.error}
    <section class="notice error-panel">
      <p class="error">{form.error}</p>
      {#if form?.traceId}
        <p class="error-trace">Trace ID: <code>{form.traceId}</code></p>
      {/if}
    </section>
  {:else if form?.success}
    <section class="notice success-panel">
      <p class="success">{form.success}</p>
    </section>
  {/if}

  {#if accountOutput}
    <section class="contact-results">
      {@render MatchResult("Sellers to contact", accountOutput.sellersToContact, "No sellers currently match your looking-for lists.")}
      {@render MatchResult("Buyers to contact", accountOutput.buyersToContact, "No buyers currently match your selling lists.")}
    </section>
  {/if}

  {#if adminOutput}
    {@render CardListResult("Selected people matches", adminOutput, "No exact card-name overlap found for the selected people.")}
  {/if}

  {#if adminContactOutput}
    <section class="contact-results">
      {@render MatchResult(`Sellers to contact for ${adminFocusUser?.displayName || adminFocusUser?.username || "selected user"}`, adminContactOutput.sellersToContact, "No sellers currently match this user's looking-for lists.")}
      {@render MatchResult(`Buyers to contact for ${adminFocusUser?.displayName || adminFocusUser?.username || "selected user"}`, adminContactOutput.buyersToContact, "No buyers currently match this user's selling lists.")}
    </section>
  {/if}
</main>

{#snippet ListColumn(lists: Array<{ id: string; label: string | null; url: string }>)}
  {#if lists.length}
    {#each lists as list}
      <article class="saved-list-row">
        <a class="saved-list-link" href={list.url} target="_blank" rel="noreferrer">
          <strong>{list.label || list.url}</strong>
          <span>{list.url}</span>
        </a>
        <form method="POST" action="?/deleteList">
          <input type="hidden" name="listId" value={list.id} />
          <button class="danger" type="submit">Delete</button>
        </form>
      </article>
    {/each}
  {:else}
    <p class="empty">No lists yet.</p>
  {/if}
{/snippet}

{#snippet MatchListItems(items: Array<{ listName: string; url: string; quantity: number }>)}
  <div class="match-list-links">
    {#each items as item}
      <a href={item.url} target="_blank" rel="noreferrer">{item.listName} ({item.quantity})</a>
    {/each}
  </div>
{/snippet}

{#snippet CardListResult(title: string, result: CardListMatchResult, empty: string)}
  <section class="summary-band">
    <article>
      <span>Matches</span>
      <strong>{result.totals.matchedCards}</strong>
      <small>{result.totals.matchedQuantity} total copies</small>
    </article>
    <article>
      <span>Buyer demand</span>
      <strong>{result.totals.uniqueBuyerCards}</strong>
      <small>{result.totals.buyerCards} copies across {result.totals.buyerLists} lists</small>
    </article>
    <article>
      <span>Seller supply</span>
      <strong>{result.totals.uniqueSellerCards}</strong>
      <small>{result.totals.sellerCards} copies across {result.totals.sellerLists} lists</small>
    </article>
  </section>

  <section class="loaded-lists">
    <div>
      <h2>Buyers</h2>
      {#each result.buyers as list}
        <a href={list.url} target="_blank" rel="noreferrer">
          <span>{list.name}</span>
          <small>{sourceLabel(list.source)} - {Object.keys(list.cards).length} cards</small>
        </a>
      {/each}
    </div>
    <div>
      <h2>Sellers</h2>
      {#each result.sellers as list}
        <a href={list.url} target="_blank" rel="noreferrer">
          <span>{list.name}</span>
          <small>{sourceLabel(list.source)} - {Object.keys(list.cards).length} cards</small>
        </a>
      {/each}
    </div>
  </section>

  {@render MatchResult(title, result, empty)}
{/snippet}

{#snippet MatchResult(title: string, result: CardListMatchResult, empty: string)}
  <section class="matches-table">
    <div class="table-head">
      <h2>{title}</h2>
      <span>{result.matches.length} rows</span>
    </div>

    {#if result.matches.length}
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Card</th>
              <th>Matched</th>
              <th>Buyers</th>
              <th>Sellers</th>
            </tr>
          </thead>
          <tbody>
            {#each result.matches as match}
              <tr>
                <td>
                  <strong>{match.card}</strong>
                  <small>{match.buyerQuantity} wanted / {match.sellerQuantity} available</small>
                </td>
                <td>{match.matchedQuantity}</td>
                <td title={listNames(match.buyers)}>{@render MatchListItems(match.buyers)}</td>
                <td title={listNames(match.sellers)}>{@render MatchListItems(match.sellers)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {:else}
      <p class="empty">{empty}</p>
    {/if}
  </section>
{/snippet}

<style>
  :global(body) {
    margin: 0;
    min-height: 100vh;
    background: #0d1114;
    color: #edf3ef;
    font-family: "Avenir Next", "Segoe UI", sans-serif;
  }

  .match-stage {
    width: min(1180px, 94vw);
    margin: 0 auto;
    padding: 1rem 0 3rem;
    display: grid;
    gap: 1rem;
  }

  .top-nav {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
    color: #aabbb8;
    font-size: 0.86rem;
  }

  .top-nav a,
  a {
    color: #74d3c0;
    text-decoration: none;
  }

  .top-nav a:hover,
  a:hover {
    text-decoration: underline;
  }

  .match-hero,
  .saved-panel,
  .add-panel,
  .list-columns > div,
  .admin-match-panel,
  .matches-table,
  .loaded-lists,
  .notice {
    border: 1px solid rgba(181, 211, 203, 0.18);
    background: rgba(13, 21, 23, 0.84);
    box-shadow: 0 22px 60px rgba(0, 0, 0, 0.28);
  }

  .match-hero {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(260px, 460px);
    gap: 1.5rem;
    align-items: end;
    padding: 1.4rem;
  }

  .saved-panel {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    align-items: center;
    padding: 1rem;
  }

  .saved-panel h2 {
    font-size: 1.2rem;
  }

  .saved-panel p {
    color: #b8c9c5;
    margin-top: 0.35rem;
  }

  .saved-actions {
    display: flex;
    align-items: center;
    gap: 0.8rem;
    flex-wrap: wrap;
  }

  .add-panel {
    display: grid;
    gap: 0.8rem;
    padding: 1rem;
  }

  .add-panel form {
    display: flex;
    align-items: end;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  label {
    display: grid;
    gap: 0.3rem;
  }

  label span {
    color: #d9e5e0;
    font-weight: 800;
  }

  .url-field {
    flex: 1 1 320px;
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

  .list-columns {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 1rem;
  }

  .list-columns > div {
    display: grid;
    align-content: start;
    gap: 0.75rem;
    padding: 1rem;
  }

  .saved-list-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 0.75rem;
    align-items: center;
    padding: 0.7rem;
    border: 1px solid rgba(181, 211, 203, 0.14);
    background: rgba(10, 18, 20, 0.92);
  }

  .saved-list-link {
    min-width: 0;
    display: grid;
    gap: 0.2rem;
    color: inherit;
    text-decoration: none;
  }

  .saved-list-link span {
    overflow-wrap: anywhere;
    color: #aabbb8;
  }

  .saved-list-link:hover strong,
  .saved-list-link:hover span {
    text-decoration: underline;
  }

  .contact-results {
    display: grid;
    gap: 1rem;
  }

  .admin-match-panel {
    display: grid;
    gap: 1rem;
    padding: 1rem;
  }

  .admin-panel-head {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    align-items: end;
  }

  .admin-panel-head p:not(.eyebrow) {
    color: #b8c9c5;
    margin-top: 0.35rem;
  }

  .admin-match-panel form {
    display: grid;
    gap: 1rem;
  }

  .admin-controls {
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    justify-content: space-between;
    gap: 0.8rem;
  }

  .select-all-row {
    display: inline-flex;
    align-items: center;
    gap: 0.55rem;
    min-height: 2.55rem;
    padding: 0.55rem 0.7rem;
    border: 1px solid rgba(181, 211, 203, 0.18);
    background: rgba(10, 18, 20, 0.92);
    color: #edf3ef;
    font-weight: 800;
  }

  .select-all-row input,
  .people-grid input {
    width: 1rem;
    height: 1rem;
    flex: 0 0 auto;
    accent-color: #74d3c0;
  }

  .focus-field {
    display: grid;
    gap: 0.35rem;
    min-width: min(100%, 320px);
  }

  .focus-field span {
    color: #aabbb8;
    font-size: 0.78rem;
    font-weight: 800;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .focus-field select {
    min-height: 2.55rem;
    border: 1px solid rgba(166, 204, 195, 0.28);
    border-radius: 3px;
    background: rgba(5, 10, 12, 0.64);
    color: #edf3ef;
    font: inherit;
    padding: 0.55rem 0.7rem;
  }

  .people-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 0.6rem;
  }

  .people-grid label {
    display: flex;
    gap: 0.65rem;
    align-items: center;
    min-width: 0;
    padding: 0.7rem;
    border: 1px solid rgba(181, 211, 203, 0.18);
    background: rgba(10, 18, 20, 0.92);
  }

  .people-grid span {
    display: grid;
    min-width: 0;
  }

  .people-grid strong,
  .people-grid small {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .people-grid small {
    color: #aabbb8;
  }

  .eyebrow {
    margin: 0 0 0.45rem;
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

  h1 {
    font-size: clamp(2rem, 4vw, 3.35rem);
    line-height: 1;
  }

  .match-hero > p {
    color: #b8c9c5;
    line-height: 1.5;
  }

  .form-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.8rem;
  }

  button {
    border: 0;
    border-radius: 3px;
    padding: 0.72rem 1rem;
    color: #071111;
    background: #74d3c0;
    font: inherit;
    font-weight: 900;
    cursor: pointer;
  }

  button:disabled {
    cursor: wait;
    opacity: 0.72;
  }

  button.danger {
    background: rgba(255, 128, 112, 0.18);
    color: #ffb1a6;
  }

  .error {
    color: #ffb1a6;
    font-weight: 800;
  }

  .success {
    color: #74d3c0;
    font-weight: 800;
  }

  .error-trace {
    color: #aabbb8;
    font-size: 0.86rem;
  }

  .error-trace code {
    color: #edf3ef;
  }

  .summary-band {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 1px;
    overflow: hidden;
    border: 1px solid rgba(181, 211, 203, 0.18);
    background: rgba(181, 211, 203, 0.18);
  }

  .summary-band article {
    display: grid;
    gap: 0.35rem;
    padding: 1rem;
    background: rgba(10, 18, 20, 0.92);
  }

  .summary-band span,
  .summary-band small {
    color: #aabbb8;
  }

  .summary-band strong {
    font-size: 2rem;
    line-height: 1;
  }

  .loaded-lists {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 1px;
    padding: 0;
    overflow: hidden;
    background: rgba(181, 211, 203, 0.18);
  }

  .loaded-lists > div {
    display: grid;
    align-content: start;
    gap: 0.5rem;
    padding: 1rem;
    background: rgba(13, 21, 23, 0.92);
  }

  .loaded-lists h2,
  .matches-table h2 {
    font-size: 1rem;
  }

  .loaded-lists a {
    display: grid;
    gap: 0.15rem;
    padding: 0.55rem 0;
    border-top: 1px solid rgba(181, 211, 203, 0.12);
  }

  .loaded-lists small {
    color: #9fb1ad;
  }

  .matches-table {
    padding: 1rem;
  }

  .table-head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 1rem;
    margin-bottom: 0.8rem;
  }

  .table-head span,
  td small {
    color: #aabbb8;
  }

  .table-wrap {
    overflow-x: auto;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    min-width: 760px;
  }

  th,
  td {
    padding: 0.7rem;
    border-top: 1px solid rgba(181, 211, 203, 0.14);
    text-align: left;
    vertical-align: top;
  }

  th {
    color: #f3bd70;
    font-size: 0.76rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  td:nth-child(2) {
    color: #74d3c0;
    font-weight: 900;
    font-size: 1.1rem;
  }

  .match-list-links {
    display: grid;
    gap: 0.25rem;
  }

  .match-list-links a {
    overflow-wrap: anywhere;
    color: #74d3c0;
  }

  td strong,
  td small {
    display: block;
  }

  .empty {
    color: #b8c9c5;
  }

  @media (max-width: 780px) {
    .match-hero,
    .saved-panel,
    .list-columns,
    .admin-panel-head,
    .summary-band,
    .loaded-lists {
      grid-template-columns: 1fr;
    }

    .match-hero {
      padding: 1rem;
    }
  }
</style>
