<!--
  The toolbar: everything that identifies *which car*.
  
  VIN, catalogue and model belong together and belong above the work, because
  they are set once and then rarely touched, while the group and plate below are
  clicked constantly. Putting the car on top also means the decoded vehicle can
  sit right under it as a strip — the answer to "which car am I looking at"
  stays on screen while you work, which is what a parts desk actually needs.
-->
<script lang="ts">
  import Settings2 from "@lucide/svelte/icons/settings-2";
  import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
  import Diamond from "./Diamond.svelte";
  import GithubMark from "./GithubMark.svelte";
  import { REPOSITORY, VERSION, releaseUrl } from "./build";
  import { formatAsaDate } from "@masax/core";
  import type { CatalogueInfo, VehicleCatalogue, VinRecord } from "@masax/catalogue";

  let {
    catalogues,
    selectedCatalogue,
    models,
    selectedModel,
    vin,
    vehicle,
    resolved,
    vinError,
    busy,
    onVin,
    onDecode,
    onCatalogue,
    onModel,
    onSettings,
    onAbout,
  }: {
    catalogues: CatalogueInfo[];
    selectedCatalogue?: string;
    models: string[];
    selectedModel?: string;
    vin: string;
    vehicle?: VinRecord;
    resolved?: VehicleCatalogue;
    vinError: string;
    busy: boolean;
    onVin: (value: string) => void;
    onDecode: () => void;
    onCatalogue: (id: string) => void;
    onModel: (model: string) => void;
    onSettings: () => void;
    onAbout: () => void;
  } = $props();
</script>

<header class="bar">
  <div class="brand">
    <button class="wordmark" onclick={onAbout} title="About masax">
      <Diamond size={12} />
      <span>masa<span class="x">x</span></span>
    </button>
    <a
      class="version code"
      href={releaseUrl()}
      target="_blank"
      rel="noreferrer noopener"
      title={`Release notes for v${VERSION}`}
    >
      v{VERSION}
    </a>
    <a
      class="repo"
      href={REPOSITORY}
      target="_blank"
      rel="noreferrer noopener"
      aria-label="masax on GitHub"
      title="masax on GitHub"
    >
      <GithubMark size={14} />
    </a>
  </div>

  <div class="group">
    <label class="label" for="vin">Vehicle</label>
    <div class="vin">
      <input
        id="vin"
        class="code"
        value={vin}
        oninput={(e) => onVin(e.currentTarget.value)}
        onkeydown={(e) => e.key === "Enter" && onDecode()}
        placeholder="Chassis + serial"
        spellcheck="false"
        autocomplete="off"
      />
      <button onclick={onDecode} disabled={busy || !vin}>Decode</button>
    </div>
  </div>

  <div class="group grow">
    <label class="label" for="catalogue">Catalogue</label>
    <select
      id="catalogue"
      value={selectedCatalogue ?? ""}
      onchange={(e) => onCatalogue(e.currentTarget.value)}
    >
      <option value="" disabled>Choose…</option>
      {#each catalogues as info (info.id)}
        <option value={info.id}>{info.name ?? info.id}</option>
      {/each}
    </select>
  </div>

  <div class="group">
    <label class="label" for="model">Model</label>
    <select
      id="model"
      class="code"
      value={selectedModel ?? ""}
      onchange={(e) => onModel(e.currentTarget.value)}
      disabled={models.length === 0}
    >
      <option value="" disabled>{models.length === 0 ? "—" : "Choose…"}</option>
      {#each models as model (model)}
        <option value={model}>{model}</option>
      {/each}
    </select>
  </div>

  <button class="icon" onclick={onSettings} aria-label="Data location and settings">
    <Settings2 size={15} />
  </button>
</header>

{#if vehicle || vinError}
  <div class="strip" class:bad={Boolean(vinError)}>
    {#if vinError}
      <TriangleAlert size={13} />
      <span>{vinError}</span>
    {:else if vehicle}
      <dl>
        <dt class="label">Model</dt>
        <dd class="code strong">{vehicle.model ?? "—"}</dd>
        <dt class="label">Class</dt>
        <dd class="code">{vehicle.classification ?? "—"}</dd>
        <dt class="label">Built</dt>
        <dd class="code">{formatAsaDate(vehicle.productionDate) || "—"}</dd>
        <dt class="label">OPC</dt>
        <dd class="code">{vehicle.opc ?? "—"}</dd>
        <dt class="label">Paint</dt>
        <dd class="code">{vehicle.paint ?? "—"}</dd>
        <dt class="label">Trim</dt>
        <dd class="code">{vehicle.interior ?? "—"}</dd>
      </dl>
      <span class="via">
        {#if resolved}
          opened <span class="code">{resolved.name ?? resolved.catalogue}</span> from
          {resolved.via}{#if resolved.alternatives.length}, over {resolved.alternatives
              .length} other{resolved.alternatives.length === 1 ? "" : "s"}{/if}
        {:else}
          no catalogue listed for this model
        {/if}
        {#if vehicle.specFrom}
          · spec from serial <span class="code">{vehicle.specFrom}</span>
        {/if}
      </span>
    {/if}
  </div>
{/if}

<style>
  .bar {
    display: flex;
    align-items: flex-end;
    gap: 0.85rem;
    padding: 0.5rem 0.75rem 0.45rem;
    background: var(--sheet);
    border-bottom: 2px solid var(--red);
  }
  .brand {
    display: flex;
    align-items: baseline;
    gap: 0.4rem;
    padding-bottom: 0.28rem;
    margin-right: 0.15rem;
  }
  .wordmark {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    border: 0;
    background: none;
    padding: 0;
    color: inherit;
  }
  .wordmark span {
    font-size: 13.5px;
    font-weight: 700;
    letter-spacing: 0.055em;
    text-transform: lowercase;
  }
  /* The one letter that carries the accent, so the mark reads as a mark. */
  .x {
    color: var(--red);
  }
  .wordmark:hover span {
    color: var(--red-deep);
  }
  .wordmark:hover .x {
    color: var(--red);
  }
  .version {
    font-size: 10.5px;
    color: var(--steel-light);
    text-decoration: none;
  }
  .version:hover {
    color: var(--red-deep);
    text-decoration: underline;
  }
  .repo {
    display: flex;
    align-self: center;
    color: var(--steel-light);
  }
  .repo:hover {
    color: var(--red-deep);
  }

  .group {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    min-width: 0;
  }
  .grow {
    flex: 1;
    max-width: 20rem;
  }

  .vin {
    display: flex;
    gap: 0.3rem;
  }
  .vin input {
    width: 15rem;
    min-width: 0;
    padding: 0.28rem 0.45rem;
    border: 1px solid var(--rule);
    border-radius: var(--r);
    background: var(--sheet);
    font-size: 12.5px;
    letter-spacing: 0.02em;
  }
  .vin input:focus {
    outline: none;
    border-color: var(--red);
  }
  .vin input::placeholder {
    color: var(--steel-light);
    letter-spacing: 0;
    font-family: var(--ui);
  }
  .vin button {
    border: 1px solid var(--red);
    border-radius: var(--r);
    background: var(--red);
    color: #fff;
    font-size: 12px;
    font-weight: 600;
    padding: 0.28rem 0.6rem;
    white-space: nowrap;
  }
  .vin button:hover:not(:disabled) {
    background: var(--red-deep);
    border-color: var(--red-deep);
  }
  .vin button:disabled {
    opacity: 0.4;
    cursor: default;
  }

  select {
    width: 100%;
    padding: 0.28rem 0.4rem;
    border: 1px solid var(--rule);
    border-radius: var(--r);
    background: var(--sheet);
    font-size: 12.5px;
  }
  select:focus {
    outline: none;
    border-color: var(--red);
  }
  select:disabled {
    color: var(--steel-light);
  }

  .icon {
    border: 0;
    background: none;
    color: var(--steel);
    padding: 0.3rem;
    display: flex;
    margin-bottom: 0.15rem;
  }
  .icon:hover {
    color: var(--red);
  }

  /* The vehicle strip: the answer to "which car", kept on screen. */
  .strip {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.4rem 1.4rem;
    padding: 0.4rem 0.8rem;
    background: var(--shade);
    border-bottom: 1px solid var(--rule);
    font-size: 12px;
  }
  .strip.bad {
    background: var(--red-wash);
    color: var(--red-deep);
    gap: 0.4rem;
  }
  dl {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.25rem 1.4rem;
    margin: 0;
  }
  dt {
    margin: 0;
  }
  dd {
    margin: 0 0 0 -1.15rem;
  }
  .strong {
    font-weight: 600;
  }
  .via {
    color: var(--steel);
    font-size: 11px;
  }
</style>
