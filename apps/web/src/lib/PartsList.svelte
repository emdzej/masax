<!--
  The parts on a plate.

  Columns follow the original's own grid — `dsPnc.cds` declares No, PNC, Part
  No, Part Name, Qty, Part Spec, Remarks — with the date window and the
  applicability fields added, because those are what distinguish two part
  numbers sharing one part-name code.

  Part numbers are set in mono at full weight and are the largest thing in the
  table. That is deliberate: the part number is what gets read out to a
  customer, and everything else on the row exists to justify it.

  Nothing here is filtered by applicability. The data carries an OPC, a
  classification list, applicable codes and a date range, but how ASA combines
  them into "fits this vehicle" has not been established, and a filter that is
  wrong hides a part that fits or offers one that does not. So every row is
  shown with its conditions visible.
-->
<script lang="ts">
  import Info from "@lucide/svelte/icons/info";
  import type { GroupRef, PartRow } from "@masax/catalogue";
  import { formatAsaDateShort } from "@masax/core";

  let { parts, plate }: { parts: PartRow[]; plate?: GroupRef } = $props();

  const dates = (row: PartRow) => {
    const from = formatAsaDateShort(row.startDate);
    const to = formatAsaDateShort(row.endDate);
    if (!from && !to) return "";
    return `${from || "?"} – ${to || "?"}`;
  };

  const codes = $derived(new Set(parts.map((p) => p.pnc)).size);
  /** A run of rows sharing a part-name code is one callout on the drawing. */
  const firstOfCode = $derived.by(() => {
    const seen = new Set<string>();
    return parts.map((p) => {
      const first = !seen.has(p.pnc);
      seen.add(p.pnc);
      return first;
    });
  });
</script>

<section class="panel">
  <header>
    <span class="label">Parts</span>
    {#if parts.length > 0}
      <span class="count code">{parts.length} / {codes} codes</span>
    {/if}
  </header>

  {#if parts.length === 0}
    <p class="none">
      {plate ? "No parts on this plate." : "Choose a plate to see its parts."}
    </p>
  {:else}
    <div class="scroll">
      <table>
        <thead>
          <tr>
            <th class="label">PNC</th>
            <th class="label">Part number</th>
            <th class="label num">Qty</th>
            <th class="label">Name</th>
            <th class="label">Period</th>
            <th class="label">Applies</th>
          </tr>
        </thead>
        <tbody>
          {#each parts as part, i (`${part.pnc}-${part.partNumber}-${i}`)}
            <tr class:group-start={firstOfCode[i] && i > 0}>
              <td class="code pnc">{firstOfCode[i] ? part.pnc : ""}</td>
              <td class="code part">{part.partNumber ?? ""}</td>
              <td class="code num">{part.quantity ?? ""}</td>
              <td class="name">
                {part.name ?? ""}
                {#if part.feature}<span class="feature">{part.feature}</span>{/if}
              </td>
              <td class="code period">{dates(part)}</td>
              <td class="applies">
                {#if part.opc}<span class="tag opc code">{part.opc}</span>{/if}
                {#if part.classification?.length}
                  <span class="tag code" title={part.classification.join(", ")}>
                    {part.classification.length === 1
                      ? part.classification[0]
                      : `${part.classification.length} cls`}
                  </span>
                {/if}
                {#if part.applicableCodes?.length}
                  <span class="tag code" title={part.applicableCodes.join(", ")}>
                    {part.applicableCodes.length} cd
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
        Every part on the plate is listed. Conditions are shown, not applied — how ASA
        combines them is not established.
      </span>
    </footer>
  {/if}
</section>

<style>
  .panel {
    display: flex;
    flex-direction: column;
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
    overflow-x: auto;
  }
  table {
    border-collapse: collapse;
    width: 100%;
    font-size: 12px;
  }
  th {
    text-align: left;
    padding: 0.3rem 0.5rem;
    border-bottom: 1px solid var(--rule);
    white-space: nowrap;
    background: var(--sheet);
    position: sticky;
    top: 0;
  }
  td {
    padding: 0.28rem 0.5rem;
    border-bottom: 1px solid var(--rule-soft);
    vertical-align: top;
  }
  tbody tr:hover td {
    background: var(--shade);
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
