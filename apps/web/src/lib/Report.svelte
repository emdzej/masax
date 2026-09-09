<script lang="ts">
  /**
   * Everything the data knows about one vehicle, on paper.
   *
   * A print stylesheet rather than a popup window. Opening a window and writing
   * markup into it means re-inlining the stylesheet, and popup blockers refuse
   * it often enough to be a support problem; a `@media print` block reuses the
   * page's own tokens and cannot be blocked. The cost is that the report has to
   * live in the DOM, so it is `hidden` on screen and every sibling is hidden
   * when printing — see the rules at the bottom.
   *
   * Printed in black on white regardless of the interface theme. Paper is
   * white, and a dark-themed report would waste a cartridge saying so.
   */
  import { formatAsaDate } from "@masax/core";
  import type { OptionSet, VehicleCatalogue, VinRecord } from "@masax/catalogue";
  import { VERSION } from "./build";
  import { i18n } from "./i18n/index.svelte";

  let {
    vin,
    vehicle,
    resolved,
    options,
    printedAt,
  }: {
    vin: string;
    vehicle: VinRecord;
    resolved?: VehicleCatalogue;
    options?: OptionSet;
    /** Passed in rather than read here, so the value is fixed when printing. */
    printedAt: string;
  } = $props();

  /**
   * Every field the record carries, with the empty ones dropped.
   *
   * `Vin` has more fields than the strip shows — SEF, BCC, BCF, CFC — and their
   * meaning is not established. They are printed anyway under their own codes:
   * on a report the honest thing is to show what the record holds and let the
   * reader recognise it, rather than hide a value because this software cannot
   * name it.
   */
  const t = $derived(i18n.t);

  const rows = $derived(
    [
      ["vin", vin],
      ["chassis", vehicle.chassis],
      ["serial", vehicle.serial],
      ["model", vehicle.model],
      ["classification", vehicle.classification],
      ["built", formatAsaDate(vehicle.productionDate)],
      ["modelYear", vehicle.modelYearCode?.toString()],
      ["opc", vehicle.opc],
      ["paint", vehicle.paint],
      ["trim", vehicle.interior],
      ["exterior", vehicle.exterior],
      ["sef", vehicle.sef],
      ["bcc", vehicle.bcc],
      ["bcf", vehicle.bcf],
      ["cfc", vehicle.cfc],
      [
        "specFrom",
        vehicle.specFrom ? t("report.field.specFromValue", { serial: vehicle.specFrom }) : undefined,
      ],
      ["half", vehicle.half],
    ].filter(([, value]) => value !== undefined && value !== "") as [string, string][],
  );

  const catalogue = $derived(
    resolved
      ? ([
          ["catalogueName", resolved.name ?? resolved.catalogue],
          ["catalogueId", resolved.catalogue],
          ["model", resolved.model],
          ["vnc", resolved.vnc],
          ["matchedOn", t(`via.${resolved.via}`)],
        ].filter(([, v]) => v !== undefined && v !== "") as [string, string][])
      : [],
  );
</script>

<!--
  `masax-report` is an unscoped hook, and it has to be: the print rules reach
  out of this component with `:global`, and a Svelte-scoped `.report` class
  loses to `#app > *` on specificity even with `!important` — an id beats a
  class, so the report stayed hidden while everything else was hidden too.
  Excluding it from the hide rule is what fixes it, rather than trying to
  out-shout that rule.
-->
<section class="report masax-report" aria-hidden="true">
  <header>
    <h1>{t("report.title")}</h1>
    <p class="meta">
      <span class="code">{vin}</span> · {t("report.meta")} · masax {VERSION} · {printedAt}
    </p>
  </header>

  <h2>{t("report.vehicle")}</h2>
  <table>
    <tbody>
      {#each rows as [field, value] (field)}
        <tr>
          <th>{t(`report.field.${field}`)}</th>
          <td class="code">{value}</td>
        </tr>
      {/each}
    </tbody>
  </table>

  {#if catalogue.length > 0}
    <h2>{t("report.catalogue")}</h2>
    <table>
      <tbody>
        {#each catalogue as [field, value] (field)}
          <tr>
            <th>{t(`report.field.${field}`)}</th>
            <td class="code">{value}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}

  {#if options}
    <h2>
      {t("report.options", { opc: vehicle.opc })}
      <span class="fine">
        {t("report.optionsMeta", {
          count: options.options.length,
          via: t(`options.viaShort.${options.via}`),
        })}
      </span>
    </h2>
    <ul class="options">
      {#each options.options as option (option.code)}
        <li><span class="code">{option.code}</span> {option.name ?? "—"}</li>
      {/each}
    </ul>
  {:else if vehicle.opc}
    <h2>{t("report.options", { opc: vehicle.opc })}</h2>
    <p class="fine">{t("report.optionsNone")}</p>
  {/if}

  <footer class="fine">{t("report.footer")}</footer>
</section>

<style>
  /* Present in the DOM for printing, and never on screen. */
  .report {
    display: none;
  }

  @media print {
    /*
     * Hide the interface, show the report. Every direct child of the mount
     * point is hidden and the report is pulled out to full width — a selector
     * on the interface's own class names would break the next time one is
     * renamed.
     */
    :global(#app > *:not(.masax-report)) {
      display: none !important;
    }
    :global(#app),
    :global(html),
    :global(body) {
      height: auto !important;
      overflow: visible !important;
      display: block !important;
      background: #fff !important;
    }

    :global(.masax-report) {
      display: block !important;
      /* Black on white: paper has no theme. */
      color: #000;
      background: #fff;
      font:
        11pt/1.4 system-ui,
        sans-serif;
    }
    .report .code {
      font-family: ui-monospace, Menlo, Consolas, monospace;
    }
    .report h1 {
      margin: 0;
      font-size: 16pt;
      letter-spacing: 0.02em;
    }
    .report header {
      padding-bottom: 0.4rem;
      border-bottom: 2pt solid #000;
    }
    .report .meta {
      margin: 0.2rem 0 0;
      font-size: 9pt;
    }
    .report h2 {
      margin: 0.8rem 0 0.25rem;
      font-size: 11pt;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      border-bottom: 0.5pt solid #000;
      /* Never leave a heading alone at the foot of a page. */
      break-after: avoid;
    }
    .report table {
      width: 100%;
      border-collapse: collapse;
    }
    .report th {
      width: 12rem;
      padding: 0.07rem 0.4rem 0.07rem 0;
      text-align: left;
      font-weight: 400;
      vertical-align: top;
      /* The label is context; the value is the answer. */
      color: #444;
    }
    .report td {
      padding: 0.07rem 0;
      font-weight: 600;
    }
    .report tr {
      break-inside: avoid;
    }
    .report .options {
      margin: 0;
      padding: 0;
      list-style: none;
      /* Two columns: 35 options is otherwise a page of its own. */
      columns: 2;
      column-gap: 1.5rem;
      font-size: 10pt;
    }
    /*
     * A grid, not an indent. `AUTO SPEED CONTROL (= CRUISE CONTROL)` wraps, and
     * with the code as an inline-block the second line returned to the left
     * margin and sat under the code column — which in two columns reads as a
     * different option. The description keeps its own column instead.
     */
    .report .options li {
      display: grid;
      grid-template-columns: 3.2rem minmax(0, 1fr);
      padding: 0.02rem 0;
      break-inside: avoid;
    }
    .report .options .code {
      font-weight: 600;
    }
    .report .fine {
      font-size: 8.5pt;
      font-weight: 400;
      color: #444;
    }
    /* Tight, so a one-vehicle report stays one sheet. */
    .report footer {
      margin-top: 0.7rem;
      padding-top: 0.3rem;
      border-top: 0.5pt solid #000;
    }
  }
</style>
