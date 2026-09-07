<!--
  A parts plate, and its title block.

  The drawings are Group 4 TIFFs behind a byte obfuscation, which no browser
  will render, so they are decoded here and painted to a canvas.

  Underneath sits a title block. Real engineering drawings carry one — and so do
  these: every ASA plate prints its own stamp in the corner (`3KC1A02`) and a
  cross-reference (`REF. 13-020`). Repeating that language in the interface
  means the drawing id, the group it belongs to and its date window read the way
  the sheet itself reads, rather than as a caption bolted underneath.
-->
<script lang="ts">
  import ImageOff from "@lucide/svelte/icons/image-off";
  import Maximize2 from "@lucide/svelte/icons/maximize-2";
  import Minimize2 from "@lucide/svelte/icons/minimize-2";
  import { bitmapToRgba, decodeIllustration } from "@masax/illust";
  import { formatAsaDateShort } from "@masax/core";
  import type { AsaCatalogue, GroupRef } from "@masax/catalogue";

  let {
    catalogue,
    plate,
    model,
  }: {
    catalogue: AsaCatalogue | undefined;
    plate: GroupRef | undefined;
    model: string | undefined;
  } = $props();

  let canvas = $state<HTMLCanvasElement | undefined>(undefined);
  let problem = $state("");
  let dimensions = $state("");
  let loading = $state(false);
  /**
   * Fit to the column, or show the drawing at its own resolution.
   *
   * A plate is 960px wide and the callout numbers are small type inside the
   * image, so any downscaling costs legibility — and reading callouts off the
   * plate is the whole job. Fit is the default because it shows the whole
   * assembly at once; actual size is one click away for when a number matters.
   */
  let actual = $state(false);

  const name = $derived(plate?.illustration);

  const window_ = $derived.by(() => {
    if (!plate) return "";
    const from = formatAsaDateShort(plate.startDate);
    const to = formatAsaDateShort(plate.endDate);
    return from || to ? `${from || "?"} – ${to || "?"}` : "";
  });

  $effect(() => {
    const element = canvas;
    const drawing = name;
    if (!catalogue || !drawing || !element) return;

    let cancelled = false;
    problem = "";
    dimensions = "";
    loading = true;

    void (async () => {
      try {
        const stored = await catalogue.readIllustration(drawing);
        if (cancelled) return;
        if (!stored) throw new Error("not in this data");
        const image = decodeIllustration(stored);
        const context = element.getContext("2d");
        if (!context) throw new Error("no 2d context");
        element.width = image.width;
        element.height = image.height;
        context.putImageData(
          new ImageData(bitmapToRgba(image), image.width, image.height),
          0,
          0,
        );
        dimensions = `${image.width}×${image.height}`;
      } catch (cause) {
        if (!cancelled) problem = (cause as Error).message;
      } finally {
        if (!cancelled) loading = false;
      }
    })();

    return () => {
      cancelled = true;
    };
  });
</script>

<figure class="sheet">
  <div class="frame" class:empty={!name} class:actual>
    {#if !name}
      <p class="none">Choose a plate.</p>
    {:else if problem}
      <p class="none"><ImageOff size={16} /> {name}: {problem}</p>
    {/if}
    <canvas
      bind:this={canvas}
      class:hidden={!name || Boolean(problem)}
      aria-label={name ? `Drawing ${name}` : "No plate selected"}
    ></canvas>
    {#if name && !problem}
      <button
        class="zoom"
        onclick={() => (actual = !actual)}
        title={actual ? "Fit to the column" : "Show at actual size"}
        aria-label={actual ? "Fit to the column" : "Show at actual size"}
      >
        {#if actual}<Minimize2 size={13} />{:else}<Maximize2 size={13} />{/if}
      </button>
    {/if}
  </div>

  {#if plate}
    <figcaption class="block">
      <div class="cell name">
        <span class="label">Plate</span>
        <span class="value">{plate.name ?? "—"}</span>
        {#if plate.note}<span class="sub">{plate.note}</span>{/if}
      </div>
      <div class="cell">
        <span class="label">Group</span>
        <span class="value code nowrap">
          {plate.mainGroup}-{String(plate.subGroup ?? 0).padStart(3, "0")}
          <span class="dim">/ {model ?? "—"}</span>
        </span>
        {#if window_}<span class="sub code">{window_}</span>{/if}
      </div>
      <div class="cell">
        <span class="label">Drawing</span>
        <span class="value code nowrap">{name ?? "—"}</span>
        <span class="sub code">
          {#if loading}decoding…{:else if dimensions}{dimensions}{/if}
        </span>
      </div>
    </figcaption>
  {/if}
</figure>

<style>
  .sheet {
    margin: 0;
    display: flex;
    flex-direction: column;
    min-width: 0;
    background: var(--sheet);
    border: 1px solid var(--rule);
    border-radius: var(--r-lg);
    overflow: hidden;
  }
  .frame {
    position: relative;
    padding: 0.5rem;
    display: grid;
    place-items: center;
    min-height: 12rem;
  }
  .frame.actual {
    place-items: start;
    overflow: auto;
    max-height: 78vh;
  }
  .frame.actual canvas {
    max-width: none;
  }
  .zoom {
    position: absolute;
    top: 0.4rem;
    right: 0.4rem;
    display: flex;
    padding: 0.25rem;
    border: 1px solid var(--rule);
    border-radius: var(--r);
    background: color-mix(in srgb, var(--sheet) 88%, transparent);
    color: var(--steel);
  }
  .zoom:hover {
    border-color: var(--red);
    color: var(--red);
  }
  .frame.empty {
    min-height: 16rem;
  }
  canvas {
    max-width: 100%;
    height: auto;
    display: block;
  }
  .hidden {
    display: none;
  }
  .none {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin: 0;
    color: var(--steel);
    font-size: 12px;
  }

  /* The title block: hairline-separated cells, mono values, borrowed from the
     stamp the drawings already print in their own corner. */
  .block {
    display: grid;
    grid-template-columns: minmax(0, 1.5fr) auto auto;
    border-top: 1px solid var(--rule);
    background: var(--shade);
  }
  .cell {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    padding: 0.35rem 0.5rem;
    border-left: 1px solid var(--rule-soft);
    min-width: 0;
  }
  .cell:first-child {
    border-left: 0;
  }
  .value {
    font-size: 12px;
    line-height: 1.25;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .name .value {
    font-weight: 600;
  }
  .nowrap {
    white-space: nowrap;
  }
  .dim {
    color: var(--steel);
  }
  .sub {
    font-size: 10px;
    color: var(--steel);
    overflow: hidden;
    text-overflow: ellipsis;
  }
  @media (max-width: 52rem) {
    .block {
      grid-template-columns: 1fr;
    }
    .cell {
      border-top: 1px solid var(--rule-soft);
    }
  }
</style>
