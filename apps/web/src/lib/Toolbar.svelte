<!--
  The toolbar: everything that identifies *which car*.
  
  VIN, catalogue and model belong together and belong above the work, because
  they are set once and then rarely touched, while the group and plate below are
  clicked constantly. Putting the car on top also means the decoded vehicle can
  sit right under it as a strip — the answer to "which car am I looking at"
  stays on screen while you work, which is what a parts desk actually needs.
-->
<script lang="ts">
  import Cog from "@lucide/svelte/icons/cog";
  import Printer from "@lucide/svelte/icons/printer";
  import ShoppingCart from "@lucide/svelte/icons/shopping-cart";
  import Monitor from "@lucide/svelte/icons/monitor";
  import Moon from "@lucide/svelte/icons/moon";
  import Sun from "@lucide/svelte/icons/sun";
  import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
  import Diamond from "./Diamond.svelte";
  import GithubMark from "./GithubMark.svelte";
  import { REPOSITORY, VERSION, releaseUrl } from "./build";
  import { theme } from "./theme.svelte";
  import { i18n, segments, slot } from "./i18n/index.svelte";
  import ComboBox, { type ComboItem } from "./ComboBox.svelte";
  import { bin } from "./bin.svelte";
  import { formatAsaDate, formatAsaDateShort } from "@masax/core";
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
    onOptions,
    onReport,
    onBin,
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
    onOptions: () => void;
    onReport: () => void;
    onBin: () => void;
  } = $props();

  const t = $derived(i18n.t);
  /**
   * The catalogues, each with what tells it apart from its namesakes.
   *
   * Sixteen of the 52 share a name: `PAJERO/MONTERO(EUR)` is four entries, the
   * Pajero 1 through 4. What separates them is the production span, so that is
   * the hint — it is also what a user is actually choosing between, since the
   * model codes underneath differ completely between generations.
   */
  const catalogueItems = $derived<ComboItem[]>(
    catalogues.map((info) => {
      const from = formatAsaDateShort(info.startDate);
      const to = formatAsaDateShort(info.endDate);
      return {
        key: info.id,
        label: info.name ?? info.id,
        hint: from || to ? `${from || "?"} – ${to || ""}`.trimEnd() : info.id,
      };
    }),
  );

  const modelItems = $derived<ComboItem[]>(models.map((model) => ({ key: model, label: model })));

  /** Names the state the control is in, not the one it will move to. */
  const themeLabel = $derived(t(`theme.current.${theme.choice}`));

  /**
   * "opened PAJERO/MONTERO(EUR) from model and classification", with the
   * catalogue name in mono.
   *
   * Built through `segments` because Polish moves the styled fragment:
   * `otwarto X na podstawie: modelu`. Splitting the sentence into three
   * translated pieces would fix the English word order into every language.
   */
  const openedParts = $derived(
    resolved
      ? segments(
          t("strip.opened", {
            catalogue: slot("catalogue"),
            via: t(`via.${resolved.via}`),
          }),
        )
      : [],
  );
</script>

<header class="bar">
  <div class="brand">
    <button class="wordmark" onclick={onAbout} title={t("toolbar.about")}>
      <Diamond size={12} />
      <span>masa<span class="x">x</span></span>
    </button>
    <a
      class="version code"
      href={releaseUrl()}
      target="_blank"
      rel="noreferrer noopener"
      title={t("toolbar.release", { version: VERSION })}
    >
      {VERSION}
    </a>
    <a
      class="repo"
      href={REPOSITORY}
      target="_blank"
      rel="noreferrer noopener"
      aria-label={t("toolbar.repo")}
      title={t("toolbar.repo")}
    >
      <GithubMark size={14} />
    </a>
  </div>

  <div class="group">
    <label class="label" for="vin">{t("toolbar.vehicle")}</label>
    <div class="vin">
      <input
        id="vin"
        class="code"
        value={vin}
        oninput={(e) => onVin(e.currentTarget.value)}
        onkeydown={(e) => e.key === "Enter" && onDecode()}
        placeholder={t("toolbar.vin")}
        spellcheck="false"
        autocomplete="off"
      />
      <button onclick={onDecode} disabled={busy || !vin}>{t("toolbar.decode")}</button>
    </div>
  </div>

  <div class="group grow">
    <label class="label" for="catalogue">{t("toolbar.catalogue")}</label>
    <ComboBox
      id="catalogue"
      items={catalogueItems}
      value={selectedCatalogue}
      placeholder={t("toolbar.choose")}
      onSelect={onCatalogue}
    />
  </div>

  <div class="group model">
    <label class="label" for="model">{t("toolbar.model")}</label>
    <ComboBox
      id="model"
      items={modelItems}
      value={selectedModel}
      placeholder={models.length === 0 ? t("toolbar.none") : t("toolbar.choose")}
      disabled={models.length === 0}
      mono
      onSelect={onModel}
    />
  </div>

  <!--
    Pushed to the far right by `.tools`, away from the fields: these two are
    chrome, not part of identifying a car, and the eye should skip them while
    working. The theme sits left of the cog because the cog is the one people
    reach for by muscle memory, so it keeps the corner.
  -->
  <div class="tools">
    <!--
      The count is the point of having it in the bar: a bin you have forgotten
      about is worse than no bin. It reads as a number rather than a dot,
      because "how many lines" is the thing being tracked.
    -->
    <button class="icon basket" class:full={bin.count > 0} onclick={onBin} title={t("bin.openTitle")}>
      <ShoppingCart size={15} />
      {#if bin.count > 0}<span class="badge code">{bin.count}</span>{/if}
      <span class="sr">{t("bin.inBin", { count: bin.count })}</span>
    </button>
    <!-- Named classes, not positions: these three are addressed by tests and by
         the stylesheet, and inserting one shifted every positional selector. -->
    <button class="icon theme" onclick={() => theme.cycle()} title={themeLabel}>
      <!--
        The icon shows the *current* state rather than the next one. A monitor
        for auto, because auto is "whatever that screen says"; and the label
        carries the detail, since three states cannot be read off one glyph.
      -->
      {#if theme.choice === "auto"}<Monitor size={15} />
      {:else if theme.choice === "light"}<Sun size={15} />
      {:else}<Moon size={15} />{/if}
      <span class="sr">{themeLabel}. {t("theme.change")}</span>
    </button>
    <button class="icon cog" onclick={onSettings} aria-label={t("toolbar.settings")}>
      <Cog size={15} />
    </button>
  </div>
</header>

{#if vehicle || vinError}
  <div class="strip" class:bad={Boolean(vinError)}>
    {#if vinError}
      <TriangleAlert size={13} />
      <span>{vinError}</span>
    {:else if vehicle}
      <dl>
        <dt class="label">{t("strip.model")}</dt>
        <dd class="code strong">{vehicle.model ?? "—"}</dd>
        <dt class="label">{t("strip.class")}</dt>
        <dd class="code">{vehicle.classification ?? "—"}</dd>
        <dt class="label">{t("strip.built")}</dt>
        <dd class="code">{formatAsaDate(vehicle.productionDate) || "—"}</dd>
        <dt class="label">{t("strip.opc")}</dt>
        <dd class="code">
          <!--
            The OPC is a key, not a reading: `H70` stands for 34 options. So the
            value itself is the button rather than an icon beside it — there is
            nothing else here a user would want to click, and the underline says
            it leads somewhere.
          -->
          {#if vehicle.opc}
            <button
              class="opc code"
              onclick={onOptions}
              title={t("strip.opcTitle", { opc: vehicle.opc })}
            >
              {vehicle.opc}
            </button>
          {:else}
            —
          {/if}
        </dd>
        <dt class="label">{t("strip.paint")}</dt>
        <dd class="code">{vehicle.paint ?? "—"}</dd>
        <dt class="label">{t("strip.trim")}</dt>
        <dd class="code">{vehicle.interior ?? "—"}</dd>
      </dl>
      <!--
        On the strip rather than in the bar above, because what it prints *is*
        the strip: the vehicle, not the catalogue or the plate. It sits after
        the values so it reads as an action on them.
      -->
      <button class="report" onclick={onReport} title={t("strip.reportTitle")}>
        <Printer size={13} />
        <span>{t("strip.report")}</span>
      </button>
      <span class="via">
        {#if resolved}
          {#each openedParts as part, i (i)}
            {#if "slot" in part}
              <span class="code">{resolved.name ?? resolved.catalogue}</span>
            {:else}{part.text}{/if}
          {/each}{#if resolved.alternatives.length}, {t("strip.openedMore", {
              count: resolved.alternatives.length,
            })}{/if}
        {:else}
          {t("strip.noCatalogue")}
        {/if}
        {#if vehicle.specFrom}
          · {t("strip.specFrom")} <span class="code">{vehicle.specFrom}</span>
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
  /* Takes the slack, so the two controls sit against the right edge however
     wide the window is. */
  .tools {
    display: flex;
    align-items: center;
    gap: 0.15rem;
    margin-left: auto;
    padding-bottom: 0.1rem;
  }
  .basket {
    position: relative;
  }
  .basket.full {
    color: var(--red);
  }
  .badge {
    position: absolute;
    top: -0.1rem;
    right: -0.15rem;
    min-width: 0.85rem;
    padding: 0 0.15rem;
    border-radius: 0.5rem;
    background: var(--red);
    color: var(--on-red);
    font-size: 9px;
    font-weight: 700;
    line-height: 1.5;
    text-align: center;
  }

  /* Present for a screen reader, absent for everyone else. */
  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
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
  /* Enough for a model code and its chevron, and no more. */
  .model {
    width: 7.5rem;
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
    color: var(--on-red);
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
  .report {
    display: inline-flex;
    align-items: center;
    gap: 0.28rem;
    flex: none;
    padding: 0.15rem 0.4rem;
    border: 1px solid var(--rule);
    border-radius: var(--r);
    background: var(--sheet);
    color: var(--steel);
    font: 600 10px/1 var(--ui);
    letter-spacing: 0.07em;
    text-transform: uppercase;
  }
  .report:hover {
    border-color: var(--red);
    color: var(--red);
  }

  .opc {
    padding: 0;
    border: 0;
    background: none;
    color: inherit;
    font-weight: inherit;
    text-decoration: underline;
    text-decoration-style: dotted;
    text-underline-offset: 2px;
    text-decoration-color: var(--steel-light);
  }
  .opc:hover {
    color: var(--red);
    text-decoration-color: var(--red);
  }

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
