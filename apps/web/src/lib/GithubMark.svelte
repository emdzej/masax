<!--
  The GitHub mark, inline.

  Lucide dropped brand icons, and this is the one link where the mark is
  clearer than any word would be.
-->
<script lang="ts">
  let { size = 14 }: { size?: number } = $props();
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 16 16"
  fill="currentColor"
  aria-hidden="true"
  class="mark"
>
  <path
    d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38
       0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13
       -.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66
       .07-.52.28-.87.51-1.07-1.78-.2-2.92-.88-2.92-2.85 0-.83.3-1.51.79-2.04
       -.08-.2-.34-1 .08-2.08 0 0 .61-.19 2 .77a4.7 4.7 0 0 1 2.55 0c1.39-.97 2-.77 2-.77
       .42 1.08.16 1.88.08 2.08.49.53.79 1.21.79 2.04 0 1.98-1.15 2.65-2.93 2.85
       .3.26.56.76.56 1.54 0 1.11-.01 2.02-.01 2.29 0 .21.15.46.55.38A7.99 7.99 0 0 0 16 8
       c0-4.42-3.58-8-8-8Z"
  />
</svg>

<style>
  .mark {
    display: block;
  }
</style>
