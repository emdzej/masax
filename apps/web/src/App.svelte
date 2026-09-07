<script lang="ts">
  import { formatAsaDate } from "@masax/core";
  import Drawing from "./lib/Drawing.svelte";
  import PartsList from "./lib/PartsList.svelte";
  import { HttpSource } from "./lib/http-source";
  import { LocalSource } from "./lib/local-source";
  import { AppState, LANGUAGES } from "./lib/state.svelte";

  const app = new AppState();
  const canPickDirectory = "showDirectoryPicker" in window;

  async function pickDirectory() {
    try {
      const handle = await (
        window as unknown as {
          showDirectoryPicker: (o?: object) => Promise<FileSystemDirectoryHandle>;
        }
      ).showDirectoryPicker({ id: "masax", mode: "read" });
      await app.openSource(new LocalSource(handle), handle.name);
    } catch {
      // The user dismissed the picker.
    }
  }

  let remote = $state("");
  async function openRemote() {
    if (!remote) return;
    try {
      await app.openSource(await HttpSource.load(remote), remote);
    } catch (cause) {
      app.error = (cause as Error).message;
    }
  }
</script>

<header>
  <h1>masax</h1>
  <p class="sub">Mitsubishi parts catalogue</p>
  <div class="spacer"></div>
  {#if app.catalogue}
    <label class="lang">
      Language
      <select
        value={app.language}
        onchange={(e) => app.setLanguage(e.currentTarget.value as never)}
      >
        {#each LANGUAGES as language (language.code)}
          <option value={language.code}>{language.label}</option>
        {/each}
      </select>
    </label>
  {/if}
</header>

{#if !app.catalogue}
  <main class="open">
    <h2>Open a catalogue</h2>
    <p>
      masax ships without data. Point it at an ASA module directory — the folder
      containing <code>EPC</code> and <code>ILLUST</code> — from a mounted disc or an
      installation. Nothing is uploaded; the files are read in the browser.
    </p>
    {#if canPickDirectory}
      <button onclick={pickDirectory} disabled={app.busy}>Choose a folder…</button>
    {:else}
      <p class="problem">
        This browser has no File System Access API, so a local folder cannot be opened.
        Chrome or Edge can; Firefox and Safari cannot. A static tree over HTTP works
        anywhere.
      </p>
    {/if}
    <div class="remote">
      <label>
        …or a static tree over HTTP
        <input bind:value={remote} placeholder="https://example.org/asa/M60/" />
      </label>
      <button onclick={openRemote} disabled={app.busy || !remote}>Open</button>
    </div>
    {#if app.error}<p class="problem">{app.error}</p>{/if}
  </main>
{:else}
  <div class="layout">
    <aside>
      <section class="vin">
        <h2>Vehicle</h2>
        <div class="row">
          <input
            bind:value={app.vinInput}
            placeholder="17-character VIN"
            spellcheck="false"
            onkeydown={(e) => e.key === "Enter" && app.lookupVin()}
          />
          <button onclick={() => app.lookupVin()} disabled={app.busy}>Decode</button>
        </div>
        {#if app.vinResult?.matches.length}
          {#each app.vinResult.matches as vehicle (vehicle.chassis + vehicle.half)}
            <dl class="vehicle">
              <dt>Model</dt>
              <dd>{vehicle.model ?? "—"}</dd>
              <dt>Class</dt>
              <dd>{vehicle.classification ?? "—"}</dd>
              <dt>Built</dt>
              <dd>{formatAsaDate(vehicle.productionDate) || "—"}</dd>
              <dt>OPC</dt>
              <dd>{vehicle.opc ?? "—"}</dd>
              <dt>Paint</dt>
              <dd>{vehicle.paint ?? "—"}</dd>
              <dt>Interior</dt>
              <dd>{vehicle.interior ?? "—"}</dd>
            </dl>
          {/each}
        {/if}
      </section>

      <section>
        <h2>Catalogue</h2>
        <select
          size="8"
          onchange={(e) => app.selectCatalogue(e.currentTarget.value)}
        >
          {#each app.catalogues as info (info.id)}
            <option value={info.id} selected={info.id === app.selectedCatalogue}>
              {info.name ?? info.id}
            </option>
          {/each}
        </select>
      </section>

      {#if app.models.length}
        <section>
          <h2>Model</h2>
          <div class="chips">
            {#each app.models as model (model)}
              <button
                class:selected={model === app.selectedModel}
                onclick={() => app.selectModel(model)}>{model}</button
              >
            {/each}
          </div>
        </section>
      {/if}

      {#if app.mainGroups.length}
        <section>
          <h2>Group</h2>
          <ul class="groups">
            {#each app.mainGroups as group (group.mainGroup)}
              <li>
                <button
                  class:selected={group.mainGroup === app.selectedMainGroup}
                  onclick={() => app.selectMainGroup(group.mainGroup)}
                >
                  <span class="code">{group.mainGroup}</span>
                  {group.name ?? "—"}
                </button>
              </li>
            {/each}
          </ul>
        </section>
      {/if}

      {#if app.plates.length}
        <section>
          <h2>Plate</h2>
          <ul class="groups">
            {#each app.plates as plate, i (`${plate.subGroup}-${i}`)}
              <li>
                <button
                  class:selected={plate === app.selectedPlate}
                  onclick={() => app.selectPlate(plate)}
                >
                  <span class="code">{String(plate.subGroup).padStart(3, "0")}</span>
                  {plate.name ?? "—"}
                  {#if plate.note}<em>{plate.note}</em>{/if}
                </button>
              </li>
            {/each}
          </ul>
        </section>
      {/if}
    </aside>

    <main>
      {#if app.error}<p class="problem">{app.error}</p>{/if}
      <div class="plate">
        <Drawing source={app.source} name={app.selectedPlate?.illustration} />
        <div class="parts">
          <PartsList parts={app.parts} plateName={app.selectedPlate?.name} />
        </div>
      </div>
    </main>
  </div>
{/if}

<footer>
  {app.busy ? "Working…" : app.status}
</footer>

<style>
  :global(:root) {
    --bg: #fafafa;
    --panel: #fff;
    --ink: #1a1a1a;
    --dim: #6a6a6a;
    --line: #d4d4d4;
    --faint: #ededed;
    --hover: #f2f6fb;
    --accent: #0b5fa5;
    --mono: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  :global(body) {
    margin: 0;
    background: var(--bg);
    color: var(--ink);
    font:
      14px/1.45 system-ui,
      sans-serif;
  }
  :global(button) {
    font: inherit;
    padding: 0.3rem 0.6rem;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 4px;
    cursor: pointer;
  }
  :global(button:hover:not(:disabled)) {
    border-color: var(--accent);
    color: var(--accent);
  }
  :global(button:disabled) {
    opacity: 0.5;
    cursor: default;
  }
  :global(input),
  :global(select) {
    font: inherit;
    padding: 0.3rem 0.4rem;
    border: 1px solid var(--line);
    border-radius: 4px;
    background: var(--panel);
  }

  header {
    display: flex;
    align-items: baseline;
    gap: 0.6rem;
    padding: 0.6rem 1rem;
    background: var(--panel);
    border-bottom: 1px solid var(--line);
  }
  header h1 {
    margin: 0;
    font-size: 1.05rem;
    letter-spacing: 0.02em;
  }
  .sub {
    margin: 0;
    color: var(--dim);
    font-size: 0.85rem;
  }
  .spacer {
    flex: 1;
  }
  .lang {
    font-size: 0.85rem;
    color: var(--dim);
  }

  .open {
    max-width: 40rem;
    margin: 3rem auto;
    padding: 0 1rem;
  }
  .open h2 {
    margin-top: 0;
  }
  .open code {
    font-family: var(--mono);
    background: var(--faint);
    padding: 0 0.2rem;
    border-radius: 3px;
  }
  .remote {
    margin-top: 1.5rem;
    display: flex;
    gap: 0.5rem;
    align-items: flex-end;
  }
  .remote label {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    flex: 1;
    font-size: 0.85rem;
    color: var(--dim);
  }

  .layout {
    display: grid;
    grid-template-columns: minmax(15rem, 22rem) 1fr;
    gap: 1rem;
    padding: 1rem;
    align-items: start;
  }
  aside {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    position: sticky;
    top: 1rem;
    max-height: calc(100vh - 5rem);
    overflow-y: auto;
  }
  section {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 0.7rem;
  }
  section h2 {
    margin: 0 0 0.5rem;
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--dim);
  }
  .row {
    display: flex;
    gap: 0.4rem;
  }
  .row input {
    flex: 1;
    min-width: 0;
    font-family: var(--mono);
  }
  .vehicle {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 0.15rem 0.6rem;
    margin: 0.6rem 0 0;
    font-size: 0.82rem;
  }
  .vehicle dt {
    color: var(--dim);
  }
  .vehicle dd {
    margin: 0;
    font-family: var(--mono);
  }
  select[size] {
    width: 100%;
    box-sizing: border-box;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
  }
  .chips button {
    font-family: var(--mono);
    font-size: 0.8rem;
  }
  .groups {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }
  .groups button {
    width: 100%;
    text-align: left;
    border: 0;
    background: none;
    padding: 0.25rem 0.35rem;
    border-radius: 3px;
    font-size: 0.85rem;
  }
  .groups button:hover {
    background: var(--hover);
  }
  .groups .selected {
    background: var(--accent);
    color: #fff;
  }
  .groups .selected:hover {
    background: var(--accent);
    color: #fff;
  }
  .code {
    font-family: var(--mono);
    color: var(--dim);
    margin-right: 0.4rem;
  }
  .groups .selected .code {
    color: #cfe3f5;
  }
  .groups em {
    display: block;
    font-style: normal;
    font-size: 0.75rem;
    color: var(--dim);
    padding-left: 2.1rem;
  }
  .groups .selected em {
    color: #cfe3f5;
  }

  main {
    min-width: 0;
  }
  .plate {
    display: grid;
    /* The drawing is a fixed aspect; the table is what needs the slack, so it
       gets the fraction and the drawing a ceiling. */
    grid-template-columns: minmax(16rem, 28rem) minmax(30rem, 1fr);
    gap: 1rem;
    align-items: start;
  }
  .parts {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 0.7rem;
    min-width: 0;
  }
  @media (max-width: 70rem) {
    .layout,
    .plate {
      grid-template-columns: 1fr;
    }
    aside {
      position: static;
      max-height: none;
    }
  }

  .problem {
    padding: 0.5rem 0.75rem;
    background: #fdeaea;
    color: #8a1f1f;
    border-radius: 4px;
    font-size: 0.85rem;
  }
  footer {
    padding: 0.4rem 1rem;
    border-top: 1px solid var(--line);
    background: var(--panel);
    color: var(--dim);
    font-size: 0.8rem;
  }
</style>
