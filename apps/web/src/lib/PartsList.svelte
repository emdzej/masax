<!--
  The parts on a plate.

  Columns follow the original's own grid (`dsPnc.cds` declares No, PNC, Part No,
  Part Name, Qty, Part Spec, Remarks), with the date window and the
  applicability fields added because they are what distinguish two part numbers
  under one part-name code.

  Nothing here is filtered by applicability. The data carries an OPC, a
  classification list, applicable codes and a date range, but how ASA combines
  them into "fits this vehicle" is not established, and a filter that is wrong
  hides a part that fits or offers one that does not. So every row is shown with
  its conditions visible.
-->
<script lang="ts">
  import type { PartRow } from "@masax/catalogue";
  import { formatAsaDateShort } from "@masax/core";

  let { parts, plateName }: { parts: PartRow[]; plateName?: string } = $props();

  const dates = (row: PartRow) => {
    const from = formatAsaDateShort(row.startDate);
    const to = formatAsaDateShort(row.endDate);
    if (!from && !to) return "";
    return `${from || "?"} – ${to || "?"}`;
  };

  let codes = $derived(new Set(parts.map((p) => p.pnc)).size);
</script>

{#if parts.length === 0}
  <p class="empty">Select a plate to see its parts.</p>
{:else}
  <div class="head">
    <h2>{plateName ?? "Parts"}</h2>
    <p>{parts.length} parts across {codes} part-name codes</p>
  </div>
  <div class="scroll">
    <table>
      <thead>
        <tr>
          <th>PNC</th>
          <th>Part number</th>
          <th class="num">Qty</th>
          <th>Name</th>
          <th>Dates</th>
          <th>Applies</th>
        </tr>
      </thead>
      <tbody>
        {#each parts as part, i (`${part.pnc}-${part.partNumber}-${i}`)}
          <tr>
            <td class="mono">{part.pnc}</td>
            <td class="mono strong">{part.partNumber ?? ""}</td>
            <td class="num">{part.quantity ?? ""}</td>
            <td>
              {part.name ?? ""}
              {#if part.feature}<span class="feature">{part.feature}</span>{/if}
            </td>
            <td class="mono small dates">{dates(part)}</td>
            <td class="small applicability">
              {#if part.opc}<span class="tag">OPC {part.opc}</span>{/if}
              {#if part.classification?.length}
                <span class="tag" title={part.classification.join(", ")}>
                  {part.classification.length === 1
                    ? part.classification[0]
                    : `${part.classification.length} cls`}
                </span>
              {/if}
              {#if part.applicableCodes?.length}
                <span class="tag" title={part.applicableCodes.join(", ")}>
                  {part.applicableCodes.length} cd
                </span>
              {/if}
              {#if part.supplyCondition}<span class="tag">{part.supplyCondition}</span>{/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/if}

<style>
  .head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 1rem;
    margin-bottom: 0.5rem;
  }
  .head h2 {
    margin: 0;
    font-size: 1rem;
  }
  .head p,
  .empty {
    margin: 0;
    color: var(--dim);
    font-size: 0.85rem;
  }
  .scroll {
    overflow-x: auto;
  }
  table {
    border-collapse: collapse;
    width: 100%;
    font-size: 0.85rem;
  }
  th {
    text-align: left;
    font-weight: 600;
    color: var(--dim);
    border-bottom: 1px solid var(--line);
    padding: 0.35rem 0.5rem;
    white-space: nowrap;
  }
  td {
    padding: 0.35rem 0.5rem;
    border-bottom: 1px solid var(--faint);
    vertical-align: top;
  }
  tbody tr:hover {
    background: var(--hover);
  }
  .mono {
    font-family: var(--mono);
  }
  td.dates {
    white-space: nowrap;
  }
  td.applicability {
    /* No min-width: it pushed the table past its container and clipped the
       column it was meant to protect. */
    line-height: 1.6;
  }
  .strong {
    font-weight: 600;
  }
  .num {
    text-align: right;
  }
  .small {
    font-size: 0.78rem;
  }
  .feature {
    display: block;
    color: var(--dim);
    font-size: 0.78rem;
  }
  .tag {
    display: inline-block;
    padding: 0.05rem 0.35rem;
    margin: 0 0.2rem 0.2rem 0;
    background: var(--faint);
    border-radius: 3px;
    font-family: var(--mono);
    white-space: nowrap;
  }
</style>
