<!--
  A parts plate.

  The drawings are Group 4 TIFFs behind a byte obfuscation, which no browser
  will render, so they are decoded here and painted to a canvas. That is the
  reason `packages/illust` exists and the reason the data needs no conversion
  before it can be served.
-->
<script lang="ts">
  import { bitmapToRgba, decodeIllustration } from "@masax/illust";
  import type { Source } from "@masax/lex";

  let { source, name }: { source: Source | undefined; name: string | undefined } = $props();

  let canvas = $state<HTMLCanvasElement | undefined>(undefined);
  let problem = $state("");
  let size = $state("");

  $effect(() => {
    const element = canvas;
    const drawing = name;
    if (!source || !drawing || !element) return;

    let cancelled = false;
    problem = "";
    size = "";

    // The first three characters of the name are the subdirectory. `1@_` is a
    // literal directory, not a placeholder.
    const path = `ILLUST/${drawing.slice(0, 3)}/${drawing}.tif`;
    void (async () => {
      try {
        const stored = await source.readFile(path);
        if (cancelled) return;
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
        size = `${image.width}×${image.height}`;
      } catch (cause) {
        if (!cancelled) problem = `${path}: ${(cause as Error).message}`;
      }
    })();

    return () => {
      cancelled = true;
    };
  });
</script>

<figure class="drawing">
  {#if problem}
    <p class="problem">{problem}</p>
  {/if}
  <canvas bind:this={canvas} aria-label={name ? `Drawing ${name}` : "No drawing selected"}
  ></canvas>
  {#if name}
    <figcaption>{name}{size ? ` — ${size}` : ""}</figcaption>
  {/if}
</figure>

<style>
  .drawing {
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    min-width: 0;
  }
  canvas {
    max-width: 100%;
    height: auto;
    background: #fff;
    border: 1px solid var(--line);
    border-radius: 4px;
  }
  figcaption {
    font: 0.75rem var(--mono);
    color: var(--dim);
  }
  .problem {
    margin: 0;
    padding: 0.5rem 0.75rem;
    background: #fdeaea;
    color: #8a1f1f;
    border-radius: 4px;
    font-size: 0.85rem;
  }
</style>
