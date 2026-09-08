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
  import About from "./lib/About.svelte";
  import Settings from "./lib/Settings.svelte";
  import Toolbar from "./lib/Toolbar.svelte";
  import { AppState } from "./lib/state.svelte";
  import "./lib/theme.css";

  const app = new AppState();
  let aboutOpen = $state(false);

  onMount(() => {
    const tree = new URLSearchParams(location.search).get("tree") ?? undefined;
    void app.boot(tree);
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
  />

  <div class="work">
    <aside>
      <SearchList
        label="Group"
        items={groupItems}
        selectedKey={app.selectedMainGroup === undefined
          ? undefined
          : String(app.selectedMainGroup)}
        onSelect={(item) => app.selectMainGroup(Number(item.code))}
        placeholder="Filter groups"
        emptyHint="Choose a catalogue and model."
      />
      <SearchList
        label="Plate"
        items={plateItems}
        selectedKey={selectedPlateKey}
        onSelect={(item) => {
          const at = plateItems.indexOf(item);
          const plate = app.plates[at];
          if (plate) void app.selectPlate(plate);
        }}
        placeholder="Filter plates"
        emptyHint="Choose a group."
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
        onSelect={(pnc) => (activePnc = activePnc === pnc ? undefined : pnc)}
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
    <p>Mitsubishi parts catalogue</p>
  </div>
{/if}

{#if aboutOpen}
  <About onClose={() => (aboutOpen = false)} />
{/if}

{#if app.settingsOpen}
  <Settings
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
