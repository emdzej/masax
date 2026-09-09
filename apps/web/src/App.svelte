<script lang="ts">
  /**
   * The parts desk.
   *
   * Three bands, in the order the work happens: the car on top (VIN, catalogue,
   * model — set once), the tree on the left (group then plate — clicked
   * constantly, so both are filterable), and the answer on the right (the
   * drawing and the part numbers).
   */
  import { onMount } from "svelte";
  import Diamond from "./lib/Diamond.svelte";
  import Drawing from "./lib/Drawing.svelte";
  import PartsList from "./lib/PartsList.svelte";
  import SearchList, { type ListItem } from "./lib/SearchList.svelte";
  import Options from "./lib/Options.svelte";
  import Report from "./lib/Report.svelte";
  import PartsBin from "./lib/PartsBin.svelte";
  import NoteEditor from "./lib/NoteEditor.svelte";
  import { bin } from "./lib/bin.svelte";
  import About from "./lib/About.svelte";
  import Settings from "./lib/Settings.svelte";
  import Toolbar from "./lib/Toolbar.svelte";
  import { AppState } from "./lib/state.svelte";
  import { tick } from "svelte";
  import { i18n } from "./lib/i18n/index.svelte";
  import "./lib/theme.css";

  const app = new AppState();
  const t = $derived(i18n.t);

  let aboutOpen = $state(false);

  /**
   * Stamped when printing rather than read in the component.
   *
   * The report is rendered continuously once a vehicle is decoded — it has to
   * be in the DOM for the print stylesheet to reach it — so a clock read during
   * render would tick with every unrelated update.
   */
  /** The part whose note is being written, if any. */
  let noteFor = $state<{ partNumber: string; name?: string } | undefined>(undefined);

  let printedAt = $state("");

  /**
   * Which document the print stylesheet should show.
   *
   * Two are rendered — the vehicle report and the parts bin — and only one may
   * reach the paper, so `#app` carries the name of the active one. It is
   * cleared afterwards so a stray Ctrl-P prints nothing rather than whichever
   * document happened to be printed last.
   */
  let printing = $state<"report" | "bin" | undefined>(undefined);

  /*
   * `#app` is in `index.html`, not rendered here, so the attribute the print
   * stylesheet keys off is set imperatively. Both printable documents render
   * their sections as top-level nodes of this component, which makes them
   * children of `#app` and so reachable by that stylesheet.
   */
  $effect(() => {
    const root = document.getElementById("app");
    if (!root) return;
    if (printing) root.setAttribute("data-print", printing);
    else root.removeAttribute("data-print");
  });

  async function print(which: "report" | "bin"): Promise<void> {
    printedAt = new Date().toLocaleString();
    printing = which;
    // A tick, so the stamp and the attribute are in the DOM before the browser
    // snapshots the page. `window.print` is synchronous and blocking.
    await tick();
    try {
      window.print();
    } finally {
      printing = undefined;
    }
  }

  /**
   * Print the vehicle report.
   *
   * The option pack is fetched first when it is not already loaded, because the
   * report lists it and a print dialog cannot wait for a range read. Normally
   * `decodeVin` has it.
   */
  async function printReport(): Promise<void> {
    if (!app.vehicle) return;
    if (!app.optionSet) await app.loadOptions();
    await print("report");
  }

  onMount(() => {
    /*
     * `?data=<url>` opens a hosted tree, overriding whatever was saved.
     *
     * The URL is then *remembered*, so a later visit without the parameter
     * opens the same tree. That is deliberate — a link handed to a colleague
     * should set their source up, not just work once — and it is undone from
     * the settings panel like any other source.
     */
    const data = new URLSearchParams(location.search).get("data") ?? undefined;
    void app.boot(data);
  });

  const groupItems = $derived(
    app.mainGroups.map(
      (group): ListItem => ({
        key: String(group.mainGroup),
        code: String(group.mainGroup),
        name: group.name ?? "—",
      }),
    ),
  );

  const plateItems = $derived(
    app.plates.map(
      (plate, i): ListItem => ({
        key: `${plate.subGroup}-${i}`,
        code: String(plate.subGroup ?? 0).padStart(3, "0"),
        name: plate.name ?? "—",
        note: plate.note,
      }),
    ),
  );

  /** Part-name codes on this plate, so the drawing knows which callouts are live. */
  const available = $derived(new Set(app.parts.map((p) => p.pnc)));
  /** The callout currently linked, set from either side. */
  let activePnc = $state<string | undefined>(undefined);

  // A new plate invalidates the selection: the same code on another plate is a
  // different row.
  $effect(() => {
    void app.selectedPlate;
    activePnc = undefined;
  });

  const selectedPlateKey = $derived.by(() => {
    const at = app.plates.indexOf(app.selectedPlate!);
    return at === -1 ? undefined : `${app.selectedPlate?.subGroup}-${at}`;
  });
</script>

{#if app.catalogue}
  <Toolbar
    catalogues={app.catalogues}
    selectedCatalogue={app.selectedCatalogue}
    models={app.models}
    selectedModel={app.selectedModel}
    vin={app.vinInput}
    vehicle={app.vehicle}
    resolved={app.vehicleCatalogue}
    vinError={app.vinError}
    busy={Boolean(app.busy)}
    onVin={(v) => (app.vinInput = v)}
    onDecode={() => app.decodeVin()}
    onCatalogue={(id) => app.selectCatalogue(id)}
    onModel={(m) => app.selectModel(m)}
    onSettings={() => (app.settingsOpen = true)}
    onAbout={() => (aboutOpen = true)}
    onOptions={() => void app.showOptions()}
    onReport={() => void printReport()}
    onBin={() => (bin.open = true)}
  />

  <div class="work">
    <aside>
      <SearchList
        label={t("rail.group")}
        items={groupItems}
        selectedKey={app.selectedMainGroup === undefined
          ? undefined
          : String(app.selectedMainGroup)}
        onSelect={(item) => app.selectMainGroup(Number(item.code))}
        placeholder={t("rail.filterGroups")}
        emptyHint={t("rail.chooseCatalogue")}
      />
      <SearchList
        label={t("rail.plate")}
        items={plateItems}
        selectedKey={selectedPlateKey}
        onSelect={(item) => {
          const at = plateItems.indexOf(item);
          const plate = app.plates[at];
          if (plate) void app.selectPlate(plate);
        }}
        placeholder={t("rail.filterPlates")}
        emptyHint={t("rail.chooseGroup")}
      />
    </aside>

    <main>
      <Drawing
        catalogue={app.catalogue}
        plate={app.selectedPlate}
        model={app.selectedModel}
        {available}
        {activePnc}
        onPick={(pnc) => (activePnc = pnc)}
      />
      <PartsList
        parts={app.parts}
        plate={app.selectedPlate}
        {activePnc}
        vehicle={app.vehicleFit}
        bind:narrowed={app.narrowed}
        provenance={{
          catalogue: app.selectedCatalogue,
          catalogueName: app.catalogues.find((c) => c.id === app.selectedCatalogue)?.name,
          model: app.selectedModel,
          plate: app.selectedPlate
            ? `${app.selectedPlate.mainGroup}-${String(app.selectedPlate.subGroup ?? 0).padStart(3, "0")}`
            : undefined,
          vin: app.vehicle ? app.vinInput : undefined,
        }}
        onSelect={(pnc) => (activePnc = activePnc === pnc ? undefined : pnc)}
        onNote={(partNumber, name) => (noteFor = { partNumber, name })}
      />
    </main>
  </div>

  <footer>
    <span class="status">{app.busy || app.error}</span>
    <span class="ident code">
      {app.selectedCatalogue ?? ""}
    </span>
  </footer>
{:else}
  <div class="boot">
    <div class="mark"><Diamond size={16} /> <span>masa<span class="accent">x</span></span></div>
    <p>{t("app.tagline")}</p>
  </div>
{/if}

{#if aboutOpen}
  <About onClose={() => (aboutOpen = false)} />
{/if}

{#if app.vehicle}
  <Report
    vin={app.vinInput}
    vehicle={app.vehicle}
    resolved={app.vehicleCatalogue}
    options={app.optionSet}
    {printedAt}
  />
{/if}

{#if noteFor}
  <NoteEditor
    partNumber={noteFor.partNumber}
    name={noteFor.name}
    onClose={() => (noteFor = undefined)}
  />
{/if}

{#if bin.open}
  <PartsBin
    vehicle={app.vehicle ? app.vinInput : undefined}
    {printedAt}
    onPrint={() => void print("bin")}
    onClose={() => (bin.open = false)}
  />
{/if}

{#if app.optionsOpen}
  <Options
    set={app.optionSet}
    busy={app.optionsBusy}
    onClose={() => (app.optionsOpen = false)}
  />
{/if}

{#if app.settingsOpen}
  <Settings
    {app}
    saved={app.saved}
    discs={app.discs}
    conflicts={app.conflicts}
    needsPermission={app.needsPermission}
    firstRun={app.firstRun}
    folderSupported={app.folderSupported}
    busy={app.busy}
    error={app.error}
    languages={app.languages}
    language={app.language}
    onAddFolder={() => app.addFolder()}
    onRemoveDisc={(name) => app.removeDisc(name)}
    onOpen={() => app.open()}
    onOpenUrl={(url) => app.openUrl(url)}
    onReopen={() => app.reopenSaved()}
    onForget={() => app.forget()}
    onLanguage={(code) => app.setLanguage(code as never)}
    onClose={() => (app.settingsOpen = false)}
  />
{/if}

<style>
  .work {
    display: grid;
    grid-template-columns: minmax(13rem, 17rem) minmax(0, 1fr);
    gap: 1px;
    background: var(--rule);
    align-items: stretch;
    /* Fills whatever the toolbar and footer leave. `min-height: 0` is the part
       that matters: without it a grid item refuses to shrink below its content
       and the inner scrollers never engage. */
    flex: 1;
    min-height: 0;
  }
  aside {
    display: flex;
    flex-direction: column;
    gap: 0.9rem;
    padding: 0.6rem 0.5rem;
    background: var(--sheet);
    min-height: 0;
    overflow-y: auto;
  }
  main {
    display: grid;
    /* The drawing is the thing being read, so it gets the larger share; the
       table needs a floor wide enough for its six columns. */
    grid-template-columns: minmax(0, 1.05fr) minmax(31rem, 1fr);
    gap: 0.6rem;
    align-items: stretch;
    padding: 0.6rem;
    background: var(--panel);
    min-width: 0;
    min-height: 0;
  }

  footer {
    display: flex;
    align-items: center;
    gap: 0.8rem;
    padding: 0.3rem 0.75rem;
    background: var(--sheet);
    border-top: 1px solid var(--rule);
    font-size: 11px;
    color: var(--steel);
  }
  .status {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ident {
    color: var(--steel-light);
  }

  .boot {
    height: 100vh;
    display: grid;
    place-content: center;
    justify-items: center;
    gap: 0.3rem;
  }
  .mark {
    display: flex;
    align-items: center;
    gap: 0.45rem;
  }
  .mark span {
    font-size: 17px;
    font-weight: 700;
    letter-spacing: 0.06em;
  }
  .accent {
    color: var(--red);
  }
  .boot p {
    margin: 0;
    color: var(--steel);
    font-size: 12px;
  }

  @media (max-width: 68rem) {
    .work {
      grid-template-columns: 1fr;
      min-height: 0;
    }
    aside,
    main {
      overflow: visible;
      min-height: auto;
    }
    main {
      grid-template-columns: 1fr;
      align-items: start;
    }
  }
</style>
