<!--
  The mark: one diamond.

  Mitsubishi's own is three, and reproducing it would imply this is their
  software, which it is not. A single diamond keeps the geometry and drops the
  claim. It doubles as the selection marker throughout, so "current" reads the
  same everywhere.
-->
<script lang="ts">
  let { size = 10, muted = false }: { size?: number; muted?: boolean } = $props();
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 10 10"
  aria-hidden="true"
  class:muted
  class="diamond"
>
  <path d="M5 0 L10 5 L5 10 L0 5 Z" />
</svg>

<style>
  .diamond {
    display: block;
    flex: none;
    fill: var(--red);
  }
  .muted {
    fill: var(--steel-light);
  }
</style>
