<!--
  A parts plate: its drawing, its callout hotspots, and its title block.

  The drawings are Group 4 TIFFs behind a byte obfuscation, which no browser
  will render, so they are decoded here and painted to a canvas. The callouts
  come from a private TIFF tag — see `@masax/illust` — and are laid over the
  canvas as buttons, so clicking a number on the plate selects the part and
  selecting a part lights up its number.

  A drawing can serve many plates: 11,839 of the 16,332 referenced
  illustrations are used by more than one, and one is used by 235. So some
  callouts on a plate belong to a different variant, and some are `REF.`
  pointers into another group. Those are drawn but not clickable — visible,
  because they are on the paper, and inert, because they are not on this list.

  At actual size the drawing is larger than its column, so the frame scrolls and
  can be dragged. A drag that crosses a callout must not select it, so a click
  is swallowed once the pointer has travelled far enough to be a pan.

  In dark mode the plate is painted light-on-dark rather than left as a white
  rectangle. A 960x1210 sheet of pure white is the largest thing on screen and
  would undo the theme on its own. It is a repaint, not a CSS filter: the
  decoder hands back a 1-bit bitmap and `bitmapToRgba` already takes the two
  colours, so the drawing is simply painted in the theme's ink and paper. A
  filter would also invert the callout highlights.
-->
<script lang="ts">
  import { tick } from "svelte";
  import Check from "@lucide/svelte/icons/check";
  import Copy from "@lucide/svelte/icons/copy";
  import ImageOff from "@lucide/svelte/icons/image-off";
  import Maximize2 from "@lucide/svelte/icons/maximize-2";
  import Minimize2 from "@lucide/svelte/icons/minimize-2";
  import {
    HOTSPOT_TAG,
    bitmapToRgba,
    decodeIllustration,
    type Bitmap,
    deobfuscate,
    hotspotsFromTiff,
    readIfd,
    type Hotspot,
  } from "@masax/illust";
  import { formatAsaDateShort } from "@masax/core";
  import { theme } from "./theme.svelte";
  import { canvasToPng, copyImage } from "./clipboard";
  import type { AsaCatalogue, GroupRef } from "@masax/catalogue";

  let {
    catalogue,
    plate,
    model,
    /** Part-name codes the current parts list contains. */
    available = new Set<string>(),
    /** The code selected in the parts list, highlighted on the plate. */
    activePnc,
    onPick,
  }: {
    catalogue: AsaCatalogue | undefined;
    plate: GroupRef | undefined;
    model: string | undefined;
    available?: Set<string>;
    activePnc?: string;
    onPick?: (pnc: string) => void;
  } = $props();

  const PADDING = 8;

  let frame = $state<HTMLDivElement | undefined>(undefined);
  let canvas = $state<HTMLCanvasElement | undefined>(undefined);
  let problem = $state("");
  let loading = $state(false);
  let natural = $state({ width: 0, height: 0 });
  let hotspots = $state<Hotspot[]>([]);
  /** Fit to the column, or show the plate at its own resolution. */
  let actual = $state(false);
  /** Displayed size of the image, which the hotspot overlay must match exactly. */
  let stage = $state({ width: 0, height: 0 });

  /** True while a drag is panning the frame, which also suppresses the click. */
  let panning = $state(false);

  /** "" | "ok" | "no" — the result of the last copy, shown briefly on the button. */
  let copied = $state("");

  /**
   * Copy the plate as a PNG.
   *
   * The canvas is copied as painted, so it carries the current theme — a plate
   * copied in dark mode is light-on-dark, which is what was on screen and what
   * the user asked for. The blob is produced inside the call rather than
   * awaited first, because Safari only accepts a pending promise handed to
   * `ClipboardItem` from within the gesture.
   */
  async function copyDrawing(): Promise<void> {
    const element = canvas;
    if (!element) return;
    copied = (await copyImage(() => canvasToPng(element))) ? "ok" : "no";
    setTimeout(() => (copied = ""), 1800);
  }

  /**
   * The decoded bitmap, held so a theme change is a repaint rather than a
   * re-read: the file is up to a megabyte and the Group 4 decode is the
   * expensive part of opening a plate.
   */
  let bitmap = $state<Bitmap | undefined>(undefined);

  const name = $derived(plate?.illustration);

  const window_ = $derived.by(() => {
    if (!plate) return "";
    const from = formatAsaDateShort(plate.startDate);
    const to = formatAsaDateShort(plate.endDate);
    return from || to ? `${from || "?"} – ${to || "?"}` : "";
  });

  const scale = $derived(natural.width > 0 ? stage.width / natural.width : 1);

  /** Size the stage so the overlay lines up with the pixels, in either mode. */
  function measure(): void {
    if (!natural.width || !natural.height) return;
    if (actual) {
      stage = { width: natural.width, height: natural.height };
      return;
    }
    const box = frame?.getBoundingClientRect();
    if (!box) return;
    const room = {
      width: Math.max(0, box.width - PADDING * 2),
      height: Math.max(0, box.height - PADDING * 2),
    };
    const factor = Math.min(room.width / natural.width, room.height / natural.height);
    stage = {
      width: Math.max(1, Math.floor(natural.width * factor)),
      height: Math.max(1, Math.floor(natural.height * factor)),
    };
  }

  $effect(() => {
    const element = frame;
    if (!element) return;
    // The column width changes with the window and with the rail, so the stage
    // is measured rather than assumed.
    const observer = new ResizeObserver(() => measure());
    observer.observe(element);
    return () => observer.disconnect();
  });

  $effect(() => {
    // Re-measure when the mode or the image changes.
    void actual;
    void natural;
    measure();
  });

  $effect(() => {
    const element = canvas;
    const drawing = name;
    if (!catalogue || !drawing || !element) return;

    let cancelled = false;
    problem = "";
    loading = true;
    hotspots = [];
    bitmap = undefined;

    void (async () => {
      try {
        const stored = await catalogue.readIllustration(drawing);
        if (cancelled) return;
        if (!stored) throw new Error("not in this data");

        const image = decodeIllustration(stored);
        const tiff = deobfuscate(stored);
        const found = hotspotsFromTiff(tiff, readIfd(tiff).offsets.get(HOTSPOT_TAG));
        if (cancelled) return;
        natural = { width: image.width, height: image.height };
        hotspots = found.hotspots;
        bitmap = image;
        measure();
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

  /**
   * Drag to pan, once the drawing is bigger than its frame.
   *
   * The threshold is what keeps the callouts usable: without it, the few pixels
   * of travel in an ordinary click would scroll the plate out from under the
   * pointer, and every click would land on the wrong number. Below it the
   * gesture is a click and the hotspot gets it; above it the gesture is a pan
   * and the click is swallowed in the capture phase, before any button sees it.
   */
  const PAN_THRESHOLD = 4;

  let drag: { x: number; y: number; left: number; top: number } | undefined;

  function startPan(event: PointerEvent): void {
    if (!actual || !frame || event.button !== 0) return;
    drag = { x: event.clientX, y: event.clientY, left: frame.scrollLeft, top: frame.scrollTop };
  }

  function movePan(event: PointerEvent): void {
    if (!drag || !frame) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (!panning && Math.hypot(dx, dy) < PAN_THRESHOLD) return;
    panning = true;
    // Capture the pointer only once it is a pan, so a plain click on a callout
    // is never stolen from the button.
    frame.setPointerCapture(event.pointerId);
    frame.scrollLeft = drag.left - dx;
    frame.scrollTop = drag.top - dy;
    event.preventDefault();
  }

  function endPan(event: PointerEvent): void {
    if (frame?.hasPointerCapture(event.pointerId)) frame.releasePointerCapture(event.pointerId);
    drag = undefined;
  }

  function swallowClickAfterPan(event: MouseEvent): void {
    if (!panning) return;
    panning = false;
    event.stopPropagation();
    event.preventDefault();
  }

  /**
   * Centre the plate when zooming in, so the middle of the fitted view is kept.
   *
   * After `tick()`, not in a frame callback: the stage is resized by an effect
   * and the centre depends on `scrollWidth`, which is still the fitted width
   * until that effect has flushed and the DOM has caught up.
   */
  async function toggleActual(): Promise<void> {
    actual = !actual;
    if (!actual) return;
    await tick();
    if (!frame) return;
    frame.scrollLeft = (frame.scrollWidth - frame.clientWidth) / 2;
    frame.scrollTop = (frame.scrollHeight - frame.clientHeight) / 2;
  }

  $effect(() => {
    // Depends on the bitmap and on the theme, so switching to dark repaints the
    // plate already on screen without touching the disc.
    const image = bitmap;
    const element = canvas;
    const { ink, paper } = theme.surface;
    if (!image || !element) return;
    const context = element.getContext("2d");
    if (!context) return;
    element.width = image.width;
    element.height = image.height;
    context.putImageData(
      new ImageData(bitmapToRgba(image, { black: ink, white: paper }), image.width, image.height),
      0,
      0,
    );
  });

  const pickable = (spot: Hotspot) => available.has(spot.pnc);
</script>

<figure class="sheet">
  <!--
    The pan listeners live on the frame because the frame is the scroll port.
    `onclickcapture` runs before the callout buttons, which is the only place a
    drag can be told apart from a click in time to stop it.
  -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="frame"
    bind:this={frame}
    class:empty={!name}
    class:actual
    class:panning
    onpointerdown={startPan}
    onpointermove={movePan}
    onpointerup={endPan}
    onpointercancel={endPan}
    onclickcapture={swallowClickAfterPan}
  >
    {#if !name}
      <p class="none">Choose a plate.</p>
    {:else if problem}
      <p class="none"><ImageOff size={16} /> {name}: {problem}</p>
    {/if}

    <div
      class="stage"
      class:hidden={!name || Boolean(problem)}
      style="width:{stage.width}px;height:{stage.height}px"
    >
      <canvas bind:this={canvas} aria-label={name ? `Drawing ${name}` : "No plate selected"}
      ></canvas>
      {#each hotspots as spot, i (`${spot.pnc}-${spot.x}-${spot.y}-${i}`)}
        {@const live = pickable(spot)}
        <button
          class="spot"
          class:live
          class:on={live && spot.pnc === activePnc}
          disabled={!live}
          title={live ? `${spot.label} — select this part` : `${spot.label} — not on this list`}
          aria-label={`Callout ${spot.label}`}
          onclick={() => live && onPick?.(spot.pnc)}
          style="left:{spot.x * scale}px;top:{spot.y * scale}px;width:{spot.width *
            scale}px;height:{spot.height * scale}px"
        ></button>
      {/each}
    </div>

  </div>

  <!--
    Outside the frame on purpose: the frame is the scroll port at actual size,
    so a button positioned inside it scrolls away with the drawing.
  -->
  {#if name && !problem}
    <button
      class="zoom copy"
      class:ok={copied === "ok"}
      class:no={copied === "no"}
      onclick={() => void copyDrawing()}
      title={copied === "no" ? "The browser refused the clipboard" : "Copy the plate as an image"}
      aria-label="Copy the plate as an image"
    >
      {#if copied === "ok"}<Check size={13} />{:else}<Copy size={13} />{/if}
    </button>
    <button
      class="zoom"
      onclick={toggleActual}
      title={actual ? "Fit to the column" : "Show at actual size, and drag to pan"}
      aria-label={actual ? "Fit to the column" : "Show at actual size"}
    >
      {#if actual}<Minimize2 size={13} />{:else}<Maximize2 size={13} />{/if}
    </button>
  {/if}

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
          {#if loading}
            decoding…
          {:else if natural.width}
            {natural.width}×{natural.height}{hotspots.length
              ? ` · ${hotspots.length} callouts`
              : ""}
          {/if}
        </span>
      </div>
    </figcaption>
  {/if}
</figure>

<style>
  .sheet {
    margin: 0;
    /* Anchors the zoom button, which must not scroll with the drawing. */
    position: relative;
    display: flex;
    flex-direction: column;
    /*
     * Stretches to its column, and that is load-bearing: with a content-based
     * height there is no definite height to fit the drawing into.
     */
    min-height: 0;
    min-width: 0;
    background: var(--sheet);
    border: 1px solid var(--rule);
    border-radius: var(--r-lg);
    overflow: hidden;
  }
  .frame {
    position: relative;
    display: grid;
    place-items: center;
    /* Takes the space the title block does not, and no more. */
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }
  .frame.empty {
    min-height: 16rem;
  }
  /* Actual size scrolls inside the frame, so the title block stays put. */
  .frame.actual {
    place-items: start;
    overflow: auto;
    padding: 0.5rem;
    cursor: grab;
    /* A drag on the plate pans it; it must not select the drawing as text. */
    user-select: none;
    /* Pinch-zoom and wheel still work, but a touch drag pans instead of scrolling
       the page away. */
    touch-action: pan-x pan-y;
  }
  .frame.actual.panning {
    cursor: grabbing;
  }
  /* The plate is smaller than the frame in one axis often enough that a grab
     cursor over dead space would be a lie, so it sits on the stage too. */
  .frame.actual .stage {
    margin: auto;
  }

  /*
   * The stage is sized in script to the displayed pixels, so a hotspot at
   * (x, y) lands on the number printed at (x, y). Letting CSS letterbox the
   * canvas instead would leave the overlay guessing where the image starts.
   */
  .stage {
    position: relative;
    flex: none;
  }
  .stage.hidden {
    display: none;
  }
  canvas {
    display: block;
    width: 100%;
    height: 100%;
  }

  .spot {
    position: absolute;
    padding: 0;
    border: 1px solid transparent;
    border-radius: 1px;
    background: none;
  }
  .spot.live:hover {
    border-color: var(--red);
    background: color-mix(in srgb, var(--red) 12%, transparent);
  }
  .spot.on {
    border-color: var(--red);
    background: color-mix(in srgb, var(--red) 20%, transparent);
    box-shadow: 0 0 0 1px var(--red);
  }
  .spot:disabled {
    cursor: default;
  }

  .none {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
    margin: 0;
    padding: 0 1rem;
    text-align: center;
    color: var(--steel);
    font-size: 12px;
  }
  .zoom {
    position: absolute;
    top: 0.4rem;
    right: 0.4rem;
    z-index: 1;
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
  /* Left of the zoom control, which keeps the corner it already had. */
  .copy {
    right: 2.05rem;
  }
  .copy.ok {
    border-color: var(--red);
    color: var(--red);
  }
  .copy.no {
    border-color: var(--steel-light);
    text-decoration: line-through;
  }

  .block {
    flex: none;
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
