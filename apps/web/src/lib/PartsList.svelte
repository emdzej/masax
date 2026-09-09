<!--
  The parts on a plate.

  Columns follow the original's own grid — `dsPnc.cds` declares No, PNC, Part
  No, Part Name, Qty, Part Spec, Remarks — with the date window and the
  applicability fields added, because those are what distinguish two part
  numbers sharing one part-name code.

  Part numbers are set in mono at full weight and are the largest thing in the
  table. That is deliberate: the part number is what gets read out to a
  customer, and everything else on the row exists to justify it.

  The list narrows to the decoded vehicle by default, on the build date, the
  classification and the option pack — see `applicability.ts` for the rule and
  what is measured about it. The header carries the switch, because that is
  where the row count is and the count is what changes.

  Hidden rows are counted and their reason named. That matters: the rule is
  consistent with everything measured but has not been checked against the
  original application's own output, so a row disappearing has to be visible as
  a decision rather than as an absence.
-->
<script lang="ts">
  import Check from "@lucide/svelte/icons/check";
  import Copy from "@lucide/svelte/icons/copy";
  import Info from "@lucide/svelte/icons/info";
  import { fitsVehicle, type FitFailure, type GroupRef, type PartRow, type VehicleFit } from "@masax/catalogue";
  import { formatAsaDateShort } from "@masax/core";
  import { copyText } from "./clipboard";
  import { i18n } from "./i18n/index.svelte";

  let {
    parts,
    plate,
    activePnc,
    vehicle,
    narrowed = $bindable(true),
    onSelect,
  }: {
    parts: PartRow[];
    plate?: GroupRef;
    /** Linked callout, set from here or from the drawing. */
    activePnc?: string;
    /** What to narrow by. Absent when no VIN has been decoded. */
    vehicle?: VehicleFit;
    narrowed?: boolean;
    onSelect?: (pnc: string) => void;
  } = $props();

  /** Only offer the switch when a decoded vehicle gives it something to do. */
  const canNarrow = $derived(Boolean(vehicle));

  const shown = $derived(
    canNarrow && narrowed ? parts.filter((row) => fitsVehicle(row, vehicle!).fits) : parts,
  );

  /** Why the hidden rows went, most common first, for one honest sentence. */
  const hidden = $derived.by(() => {
    if (!canNarrow || !narrowed) return { count: 0, reasons: [] as FitFailure[] };
    const tally = new Map<FitFailure, number>();
    let count = 0;
    for (const row of parts) {
      const fit = fitsVehicle(row, vehicle!);
      if (fit.fits) continue;
      count++;
      for (const reason of fit.reasons) tally.set(reason, (tally.get(reason) ?? 0) + 1);
    }
    return {
      count,
      reasons: [...tally.entries()].sort((a, b) => b[1] - a[1]).map(([reason]) => reason),
    };
  });

  /** The failure names double as translation keys; see `applicability.ts`. */
  const reasonText = $derived((reason: FitFailure) => t(`parts.reason.${reason}`));

  const t = $derived(i18n.t);

  let body = $state<HTMLTableSectionElement | undefined>(undefined);

  /**
   * Which cell was copied last, so the tick appears on that one alone.
   *
   * A key rather than a boolean: the same part number can legitimately appear
   * on two rows of one plate, and a flag would tick both.
   */
  let copied = $state("");

  async function copy(key: string, value: string, event: MouseEvent): Promise<void> {
    // The row's own click selects the callout; copying is not that.
    event.stopPropagation();
    copied = (await copyText(value)) ? key : "";
    setTimeout(() => (copied = ""), 1600);
  }

  // When the drawing picks a callout the row may be far down a list of ninety,
  // so bring it into view rather than leaving the user to hunt for it.
  $effect(() => {
    const code = activePnc;
    if (!code || !body) return;
    const row = body.querySelector<HTMLElement>(`[data-pnc="${CSS.escape(code)}"]`);
    row?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  });

  const dates = (row: PartRow) => {
    const from = formatAsaDateShort(row.startDate);
    const to = formatAsaDateShort(row.endDate);
    if (!from && !to) return "";
    return `${from || "?"} – ${to || "?"}`;
  };

  const codes = $derived(new Set(shown.map((p) => p.pnc)).size);
  /** A run of rows sharing a part-name code is one callout on the drawing. */
  const firstOfCode = $derived.by(() => {
    const seen = new Set<string>();
    return shown.map((p) => {
      const first = !seen.has(p.pnc);
      seen.add(p.pnc);
      return first;
    });
  });
</script>

<section class="panel">
  <header>
    <span class="label">{t("parts.title")}</span>
    <div class="spacer"></div>
    {#if canNarrow}
      <label class="switch" title={t("parts.thisVehicleTitle")}>
        <input type="checkbox" bind:checked={narrowed} />
        <span>{t("parts.thisVehicle")}</span>
      </label>
    {/if}
    {#if shown.length > 0}
      <!--
        Named, not bare. `19 / 11 codes` reads as "19 of 11", which is
        nonsense: the two numbers count different things, and the code count
        stays put while rows come and go because one code can hold several
        period rows. When rows are hidden the count says so, which is the
        question the switch raises.
      -->
      <span class="count code">
        {#if hidden.count > 0}
          {t("parts.rowsOf", { shown: shown.length, total: parts.length })}
        {:else}
          {t("parts.rows", { count: shown.length })}
        {/if}
        · {t("parts.codes", { count: codes })}
      </span>
    {/if}
  </header>

  {#if shown.length === 0}
    <p class="none">
      {#if !plate}
        {t("parts.choosePlate")}
      {:else if parts.length > 0}
        {t("parts.noneFit", { count: parts.length, label: t("parts.thisVehicle") })}
      {:else}
        {t("parts.noParts")}
      {/if}
    </p>
  {:else}
    <div class="scroll">
      <table>
        <thead>
          <tr>
            <th class="label">{t("parts.pnc")}</th>
            <th class="label">{t("parts.partNumber")}</th>
            <th class="label num">{t("parts.qty")}</th>
            <th class="label">{t("parts.name")}</th>
            <th class="label">{t("parts.period")}</th>
            <th class="label">{t("parts.applies")}</th>
          </tr>
        </thead>
        <tbody bind:this={body}>
          {#each shown as part, i (`${part.pnc}-${part.partNumber}-${i}`)}
            <tr
              data-pnc={part.pnc}
              class:group-start={firstOfCode[i] && i > 0}
              class:linked={part.pnc === activePnc}
              onclick={() => onSelect?.(part.pnc)}
            >
              <td class="code pnc">{firstOfCode[i] ? part.pnc : ""}</td>
              <!--
                The copy control lives in the cell it copies, so there is no
                guessing what it takes. It is in the flow at zero opacity rather
                than absent, so revealing it shifts nothing.
              -->
              <td class="code part">
                {part.partNumber ?? ""}
                {#if part.partNumber}
                  {@const key = `n${i}`}
                  <button
                    class="copy"
                    class:done={copied === key}
                    onclick={(e) => void copy(key, part.partNumber!, e)}
                    title={t("parts.copyValue", { value: part.partNumber })}
                    aria-label={t("parts.copyNumber", { value: part.partNumber })}
                  >
                    {#if copied === key}<Check size={11} />{:else}<Copy size={11} />{/if}
                  </button>
                {/if}
              </td>
              <td class="code num">{part.quantity ?? ""}</td>
              <td class="name">
                {part.name ?? ""}
                {#if part.name}
                  {@const key = `d${i}`}
                  <button
                    class="copy"
                    class:done={copied === key}
                    onclick={(e) => void copy(key, part.name!, e)}
                    title={t("parts.copyValue", { value: part.name })}
                    aria-label={t("parts.copyName", { value: part.name })}
                  >
                    {#if copied === key}<Check size={11} />{:else}<Copy size={11} />{/if}
                  </button>
                {/if}
                {#if part.feature}<span class="feature">{part.feature}</span>{/if}
              </td>
              <td class="code period">{dates(part)}</td>
              <td class="applies">
                {#if part.opc}<span class="tag opc code">{part.opc}</span>{/if}
                {#if part.classification?.length}
                  <span class="tag code" title={part.classification.join(", ")}>
                    {part.classification.length === 1
                      ? part.classification[0]
                      : t("parts.clsCount", { count: part.classification.length })}
                  </span>
                {/if}
                {#if part.applicableCodes?.length}
                  <span class="tag code" title={part.applicableCodes.join(", ")}>
                    {t("parts.codeCount", { count: part.applicableCodes.length })}
                  </span>
                {/if}
                {#if part.supplyCondition}
                  <span class="tag code">{part.supplyCondition}</span>
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    <footer>
      <Info size={12} />
      <span>
        {#if hidden.count > 0}
          {t("parts.hidden", {
            count: hidden.count,
            reasons: hidden.reasons.map(reasonText).join(", "),
          })}
        {:else}
          {t("parts.hint")}
        {/if}
      </span>
    </footer>
  {/if}
</section>

<style>
  /*
   * Revealed, not added. Ninety rows each carrying two visible buttons is a
   * wall of icons, so they sit at zero opacity and appear for the row in
   * question — on hover where there is a hovering pointer, and on the selected
   * row where there is not, because a touch user's only way to indicate a row
   * is to tap it, which is already what selects a callout.
   *
   * `pointer-events: none` while hidden matters: an invisible button that is
   * still clickable would put a copy control over every part number on the
   * plate. Keyboard focus is unaffected by it, so tabbing in still reveals
   * them through `:focus-within`.
   */
  .copy {
    display: inline-flex;
    vertical-align: -1px;
    margin-left: 0.3rem;
    padding: 0;
    border: 0;
    background: none;
    color: var(--steel-light);
    opacity: 0;
    pointer-events: none;
    transition: opacity 90ms linear;
  }
  tr.linked .copy,
  tr:focus-within .copy {
    opacity: 1;
    pointer-events: auto;
  }
  @media (hover: hover) and (pointer: fine) {
    tr:hover .copy {
      opacity: 1;
      pointer-events: auto;
    }
  }
  .copy:hover {
    color: var(--red);
  }
  .copy.done {
    color: var(--red);
    opacity: 1;
  }
  @media (prefers-reduced-motion: reduce) {
    .copy {
      transition: none;
    }
  }

  .spacer {
    flex: 1;
  }
  /*
   * A checkbox rather than a button: it is a state the user is holding, not an
   * action, and the label has to name what is being narrowed to. Small and
   * quiet, because the count beside it is what people actually read.
   */
  .switch {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    font: 600 10px/1 var(--ui);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--steel);
    cursor: pointer;
    user-select: none;
  }
  .switch:hover {
    color: var(--ink);
  }
  /*
   * Drawn rather than native. A native checkbox is 11px tall in Chrome and
   * larger still in Safari and Firefox, which enforce a minimum regardless of
   * `width`/`height` — against 7.25px cap height that reads as misaligned even
   * when the boxes are centred to a hundredth of a pixel. Sizing it to the cap
   * height is the only way to make it look right, and that needs
   * `appearance: none`. It also makes the control identical in every browser
   * and lets it take the theme's own accent.
   */
  .switch input {
    appearance: none;
    -webkit-appearance: none;
    position: relative;
    flex: none;
    margin: 0;
    width: 9px;
    height: 9px;
    border: 1px solid var(--rule);
    border-radius: 1px;
    background: var(--sheet);
    cursor: pointer;
  }
  .switch input:checked {
    border-color: var(--red);
    background: var(--red);
  }
  /* The tick: two borders of a box, rotated. Small enough that a glyph would
     not survive the scaling. */
  .switch input:checked::after {
    content: "";
    position: absolute;
    left: 1px;
    top: 0;
    width: 3px;
    height: 5px;
    border: solid var(--on-red);
    border-width: 0 1.5px 1.5px 0;
    transform: rotate(42deg);
  }
  .switch input:focus-visible {
    outline: 2px solid var(--red);
    outline-offset: 1px;
  }
  .switch:has(input:checked) {
    color: var(--red);
  }

  .panel {
    display: flex;
    flex-direction: column;
    /* Fills the column and scrolls its own body, so the drawing beside it
       stays put. */
    max-height: 100%;
    min-height: 0;
    min-width: 0;
    background: var(--sheet);
    border: 1px solid var(--rule);
    border-radius: var(--r-lg);
    overflow: hidden;
  }
  header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.6rem;
    padding: 0.4rem 0.6rem;
    border-bottom: 1px solid var(--rule);
    background: var(--shade);
  }
  .count {
    font-size: 10.5px;
    color: var(--steel);
  }
  .none {
    margin: 0;
    padding: 1.2rem 0.6rem;
    color: var(--steel);
    font-size: 12px;
  }

  .scroll {
    flex: 1;
    min-height: 0;
    overflow: auto;
  }
  table {
    border-collapse: collapse;
    width: 100%;
    font-size: 12px;
  }
  th {
    text-align: left;
    /*
     * Tighter than it looks like it wants to be, and deliberately: six columns
     * of nowrap headers plus a date range in mono is a wide minimum, and Polish
     * headers are longer than English ones. At 0.5rem the table overflowed its
     * pane in Polish at a 1500px window — the pane scrolls, so nothing is lost,
     * but a clipped column header reads as broken.
     */
    padding: 0.3rem 0.38rem;
    border-bottom: 1px solid var(--rule);
    white-space: nowrap;
    background: var(--sheet);
    position: sticky;
    top: 0;
  }
  td {
    /* Matches the header's horizontal rhythm; see the note there. */
    padding: 0.28rem 0.38rem;
    border-bottom: 1px solid var(--rule-soft);
    vertical-align: top;
  }
  tbody tr {
    cursor: pointer;
  }
  tbody tr:hover td {
    background: var(--shade);
  }
  /* Linked to the callout showing on the drawing. */
  tbody tr.linked td {
    background: var(--red-wash);
  }
  tbody tr.linked .pnc {
    color: var(--red-deep);
    font-weight: 600;
  }
  /* A new part-name code starts a new callout, so give it a visible edge. */
  tr.group-start td {
    border-top: 1px solid var(--rule);
  }

  .pnc {
    color: var(--steel);
    font-size: 11px;
    white-space: nowrap;
  }
  .part {
    font-weight: 600;
    font-size: 12.5px;
    white-space: nowrap;
  }
  .num {
    text-align: right;
  }
  .period {
    font-size: 11px;
    white-space: nowrap;
    color: var(--steel);
  }
  .name {
    min-width: 10rem;
  }
  .feature {
    display: block;
    font-size: 10.5px;
    color: var(--steel);
    margin-top: 0.05rem;
  }
  .applies {
    line-height: 1.7;
  }
  .tag {
    display: inline-block;
    padding: 0 0.28rem;
    margin-right: 0.2rem;
    border: 1px solid var(--rule);
    border-radius: var(--r);
    background: var(--shade);
    font-size: 10.5px;
    white-space: nowrap;
    color: var(--steel);
  }
  /* An option code is the one condition that names a specific build, so it is
     the only tag that gets the accent. */
  .tag.opc {
    border-color: color-mix(in srgb, var(--red) 35%, var(--rule));
    background: var(--red-wash);
    color: var(--red-deep);
  }

  footer {
    display: flex;
    align-items: flex-start;
    gap: 0.35rem;
    padding: 0.35rem 0.6rem;
    border-top: 1px solid var(--rule);
    background: var(--shade);
    color: var(--steel);
    font-size: 10.5px;
    line-height: 1.4;
  }
</style>
