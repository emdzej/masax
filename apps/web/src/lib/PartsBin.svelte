<script lang="ts">
  /**
   * The parts bin, and the pick list it prints.
   *
   * Two renderings of the same entries: a dialog to work in, and a print
   * section that only reaches paper when `#app` says so. Both carry the
   * provenance — catalogue, model, plate, and the VIN that was in the toolbar
   * — because a pick list gets handed to somebody else, and "MB927991" without
   * "which car" is how the wrong hose gets ordered.
   *
   * The quantity is editable here rather than at the point of adding. A plate's
   * own Qty is the right default and usually the right answer, so adding is one
   * click; changing it is a thing you do once, looking at the whole list.
   */
  import Printer from "@lucide/svelte/icons/printer";
  import Table from "@lucide/svelte/icons/table";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import X from "@lucide/svelte/icons/x";
  import Check from "@lucide/svelte/icons/check";
  import Copy from "@lucide/svelte/icons/copy";
  import Diamond from "./Diamond.svelte";
  import { bin, download, toCsv } from "./bin.svelte";
  import { copyText } from "./clipboard";
  import { i18n } from "./i18n/index.svelte";
  import { notes } from "./notes.svelte";

  let {
    vehicle,
    printedAt,
    onPrint,
    onClose,
  }: {
    /** The vehicle in the toolbar, printed at the head of the list. */
    vehicle?: string;
    printedAt: string;
    onPrint: () => void;
    onClose: () => void;
  } = $props();

  const t = $derived(i18n.t);

  /** Insertion order, so editing a quantity does not move the line. */
  const entries = $derived([...bin.entries].sort((a, b) => a.added - b.added));

  let copied = $state("");

  async function copy(key: string, value: string, event: MouseEvent): Promise<void> {
    event.stopPropagation();
    copied = (await copyText(value)) ? key : "";
    setTimeout(() => (copied = ""), 1600);
  }

  const COLUMNS = [
    "partNumber",
    "pnc",
    "name",
    "quantity",
    "catalogue",
    "model",
    "plate",
    "vin",
    "note",
  ] as const;

  function exportCsv(): void {
    download(
      t("bin.csvFile"),
      toCsv(
        entries,
        COLUMNS.map((c) => t(`bin.column.${c}`)),
        (partNumber) => notes.get(partNumber),
      ),
      // Excel reads a BOM-less UTF-8 CSV as the system code page, which turns
      // Polish headings into mojibake.
      { bom: true },
    );
  }
</script>

<svelte:window onkeydown={(e) => e.key === "Escape" && onClose()} />

<div class="scrim" role="presentation">
  <button class="backdrop" onclick={onClose} aria-label={t("settings.close")} tabindex="-1"
  ></button>
  <div class="panel" role="dialog" aria-modal="true" aria-label={t("bin.title")} tabindex="-1">
    <header>
      <Diamond size={11} />
      <h2>{t("bin.title")}</h2>
      <div class="spacer"></div>
      {#if bin.count > 0}
        <span class="count code">
          {t("bin.lines", { count: bin.count })} · {t("bin.pieces", { count: bin.pieces })}
        </span>
      {/if}
      <button class="icon" onclick={onClose} aria-label={t("settings.close")}>
        <X size={15} />
      </button>
    </header>

    {#if entries.length === 0}
      <p class="none">{t("bin.empty")}</p>
    {:else}
      <div class="scroll">
        <table>
          <thead>
            <tr>
              <th class="label">{t("bin.column.partNumber")}</th>
              <th class="label">{t("bin.column.name")}</th>
              <th class="label num">{t("bin.quantity")}</th>
              <th class="label">{t("bin.from")}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {#each entries as entry (entry.partNumber)}
              <!-- Keyed by part number: a `{@const}` has to be a block's own
                   child, and both cells want these. -->
              {@const numberKey = `n${entry.partNumber}`}
              {@const nameKey = `d${entry.partNumber}`}
              <tr>
                <td class="code part">
                  {entry.partNumber}
                  <button
                    class="reveal copy"
                    class:done={copied === numberKey}
                    onclick={(e) => void copy(numberKey, entry.partNumber, e)}
                    title={t("parts.copyValue", { value: entry.partNumber })}
                    aria-label={t("parts.copyNumber", { value: entry.partNumber })}
                  >
                    {#if copied === numberKey}<Check size={11} />{:else}<Copy size={11} />{/if}
                  </button>
                </td>
                <td class="name">
                  {entry.name ?? "—"}
                  {#if entry.name}
                    <button
                      class="reveal copy"
                      class:done={copied === nameKey}
                      onclick={(e) => void copy(nameKey, entry.name!, e)}
                      title={t("parts.copyValue", { value: entry.name })}
                      aria-label={t("parts.copyName", { value: entry.name })}
                    >
                      {#if copied === nameKey}<Check size={11} />{:else}<Copy size={11} />{/if}
                    </button>
                  {/if}
                  {#if notes.get(entry.partNumber)}
                    <span class="note-text">{notes.get(entry.partNumber)}</span>
                  {/if}
                </td>
                <td class="num">
                  <input
                    class="qty code"
                    type="number"
                    min="1"
                    max="9999"
                    value={entry.quantity}
                    aria-label={t("bin.quantity")}
                    oninput={(e) => bin.setQuantity(entry.partNumber, e.currentTarget.valueAsNumber)}
                  />
                </td>
                <td class="from code">
                  {entry.model ?? ""}{entry.plate ? ` · ${entry.plate}` : ""}
                  {#if entry.pnc}<span class="dim">{entry.pnc}</span>{/if}
                </td>
                <td class="num">
                  <button
                    class="icon"
                    onclick={() => bin.remove(entry.partNumber)}
                    aria-label={t("bin.remove", { value: entry.partNumber })}
                    title={t("bin.remove", { value: entry.partNumber })}
                  >
                    <Trash2 size={13} />
                  </button>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>

      <footer>
        <button class="text-btn" onclick={() => bin.clear()}>
          <Trash2 size={12} /> {t("bin.clear")}
        </button>
        <div class="spacer"></div>
        <button onclick={exportCsv}><Table size={13} /> {t("bin.csv")}</button>
        <button class="primary" onclick={onPrint}>
          <Printer size={13} /> {t("bin.print")}
        </button>
      </footer>
    {/if}
  </div>
</div>

<!--
  The pick list. Unscoped hooks, because `theme.css` selects on them from
  outside this component; see the note there.
-->
<section class="sheet masax-print masax-print-bin" aria-hidden="true">
  <header>
    <h1>{t("bin.title")}</h1>
    <p class="meta">
      {#if vehicle}<span class="code">{vehicle}</span> ·{/if}
      {t("bin.lines", { count: bin.count })} · {t("bin.pieces", { count: bin.pieces })} · masax ·
      {printedAt}
    </p>
  </header>

  <table>
    <thead>
      <tr>
        <th class="num">{t("bin.column.quantity")}</th>
        <th>{t("bin.column.partNumber")}</th>
        <th>{t("bin.column.name")}</th>
        <th>{t("bin.column.model")}</th>
        <th>{t("bin.column.plate")}</th>
      </tr>
    </thead>
    <tbody>
      {#each entries as entry (entry.partNumber)}
        <tr>
          <td class="num code">{entry.quantity}</td>
          <td class="code strong">{entry.partNumber}</td>
          <td>
            {entry.name ?? ""}
            {#if notes.get(entry.partNumber)}
              <span class="print-note">{notes.get(entry.partNumber)}</span>
            {/if}
          </td>
          <td class="code">{entry.model ?? ""}</td>
          <td class="code">{entry.plate ?? ""}</td>
        </tr>
      {/each}
    </tbody>
  </table>

  <footer>{t("bin.footer")}</footer>
</section>

<style>
  .scrim {
    position: fixed;
    inset: 0;
    background: var(--scrim);
    display: grid;
    place-items: center;
    grid-template-rows: minmax(0, 1fr);
    padding: 1.5rem;
    z-index: 60;
  }
  .backdrop {
    position: absolute;
    inset: 0;
    border: 0;
    background: none;
    cursor: default;
  }
  .panel {
    position: relative;
    display: flex;
    flex-direction: column;
    width: min(48rem, 100%);
    max-height: 100%;
    background: var(--sheet);
    border: 1px solid var(--rule);
    border-top: 2px solid var(--red);
    border-radius: var(--r-lg);
    box-shadow: 0 12px 40px -12px var(--drop);
  }
  header {
    flex: none;
    display: flex;
    align-items: center;
    gap: 0.45rem;
    padding: 0.7rem 0.85rem;
    border-bottom: 1px solid var(--rule);
  }
  header h2 {
    margin: 0;
    font-size: 14px;
    font-weight: 700;
    letter-spacing: 0.055em;
  }
  .count {
    font-size: 11px;
    color: var(--steel);
  }
  .spacer {
    flex: 1;
  }
  .none {
    margin: 0;
    padding: 1.4rem 0.85rem;
    text-align: center;
    color: var(--steel);
    font-size: 12px;
  }
  .scroll {
    flex: 1;
    min-height: 0;
    overflow: auto;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
  }
  th {
    position: sticky;
    top: 0;
    text-align: left;
    padding: 0.3rem 0.4rem;
    background: var(--sheet);
    border-bottom: 1px solid var(--rule);
    white-space: nowrap;
  }
  td {
    padding: 0.25rem 0.4rem;
    border-bottom: 1px solid var(--rule-soft);
    vertical-align: middle;
  }
  .num {
    text-align: right;
  }
  .part {
    font-weight: 600;
    white-space: nowrap;
  }
  .note-text {
    display: block;
    margin-top: 0.1rem;
    padding-left: 0.4rem;
    border-left: 2px solid var(--red);
    font-size: 11px;
    line-height: 1.35;
    color: var(--steel);
    white-space: pre-wrap;
  }
  .from {
    font-size: 11px;
    color: var(--steel);
    white-space: nowrap;
  }
  .dim {
    color: var(--steel-light);
  }
  .qty {
    width: 4.2rem;
    padding: 0.15rem 0.3rem;
    border: 1px solid var(--rule);
    border-radius: var(--r);
    background: var(--sheet);
    text-align: right;
    font-size: 12px;
  }
  .qty:focus {
    outline: none;
    border-color: var(--red);
  }
  /* Same reveal as the parts list: see the note in `PartsList.svelte`. */
  .reveal {
    display: inline-flex;
    vertical-align: -1px;
    margin-left: 0.3rem;
    padding: 0;
    border: 0;
    background: none;
    color: var(--steel-light);
    opacity: 0;
    pointer-events: none;
  }
  tr:hover .reveal,
  tr:focus-within .reveal,
  .reveal.done {
    opacity: 1;
    pointer-events: auto;
  }
  .reveal:hover,
  .reveal.done {
    color: var(--red);
  }
  .icon {
    display: flex;
    padding: 0.15rem;
    border: 0;
    background: none;
    color: var(--steel);
  }
  .icon:hover {
    color: var(--red);
  }
  footer {
    flex: none;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.6rem 0.85rem;
    border-top: 1px solid var(--rule);
    background: var(--shade);
    border-radius: 0 0 var(--r-lg) var(--r-lg);
  }
  footer button {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.3rem 0.6rem;
    border: 1px solid var(--rule);
    border-radius: var(--r);
    background: var(--sheet);
    font-size: 12px;
  }
  footer button:hover {
    border-color: var(--red);
    color: var(--red);
  }
  footer .primary {
    border-color: var(--red);
    background: var(--red);
    color: var(--on-red);
    font-weight: 600;
  }
  footer .primary:hover {
    background: var(--red-deep);
    border-color: var(--red-deep);
    color: var(--on-red);
  }
  .text-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0;
    border: 0;
    background: none;
    color: var(--steel);
    font-size: 11.5px;
  }
  .text-btn:hover {
    color: var(--red);
  }

  /* The printed pick list. The scaffolding is in `theme.css`. */
  @media print {
    .sheet .code {
      font-family: ui-monospace, Menlo, Consolas, monospace;
    }
    .sheet h1 {
      margin: 0;
      font-size: 16pt;
      letter-spacing: 0.02em;
    }
    .sheet header {
      display: block;
      padding: 0 0 0.4rem;
      border: 0;
      border-bottom: 2pt solid #000;
    }
    .sheet .meta {
      margin: 0.2rem 0 0;
      font-size: 9pt;
    }
    .sheet table {
      width: 100%;
      margin-top: 0.6rem;
      border-collapse: collapse;
      font-size: 10pt;
    }
    .sheet th {
      position: static;
      padding: 0.15rem 0.3rem;
      border-bottom: 0.5pt solid #000;
      background: none;
      font-size: 8.5pt;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: #444;
    }
    .sheet td {
      padding: 0.18rem 0.3rem;
      border-bottom: 0.25pt solid #999;
    }
    .sheet tr {
      break-inside: avoid;
    }
    /* A pick list is read by quantity first, so it leads and is set wide. */
    .sheet .num {
      width: 3rem;
      text-align: right;
    }
    .sheet .strong {
      font-weight: 700;
    }
    /* The note is why it was written down; on paper it belongs with the part. */
    .sheet .print-note {
      display: block;
      font-size: 8.5pt;
      font-style: italic;
      color: #333;
    }
    .sheet footer {
      display: block;
      margin-top: 0.7rem;
      padding-top: 0.3rem;
      border: 0;
      border-top: 0.5pt solid #000;
      background: none;
      font-size: 8.5pt;
      color: #444;
    }
  }
</style>
