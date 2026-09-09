<script lang="ts">
  /**
   * What masax is, and what it is not.
   *
   * Worth being explicit about two things a user could reasonably wonder:
   * nothing leaves the machine, and this is not Mitsubishi's software.
   */
  import X from "@lucide/svelte/icons/x";
  import Diamond from "./Diamond.svelte";
  import GithubMark from "./GithubMark.svelte";
  import { REPOSITORY, VERSION, releaseUrl } from "./build";

  let { onClose }: { onClose: () => void } = $props();
</script>

<svelte:window onkeydown={(e) => e.key === "Escape" && onClose()} />

<div class="scrim" role="presentation">
  <button class="backdrop" onclick={onClose} aria-label="Close" tabindex="-1"></button>
  <div class="panel" role="dialog" aria-modal="true" aria-label="About masax" tabindex="-1">
    <header>
      <Diamond size={11} />
      <h2>masa<span class="x">x</span></h2>
      <a class="version code" href={releaseUrl()} target="_blank" rel="noreferrer noopener">
        {VERSION}
      </a>
      <div class="spacer"></div>
      <button class="icon" onclick={onClose} aria-label="Close"><X size={15} /></button>
    </header>

    <div class="body">
      <p>
        A parts catalogue for Mitsubishi vehicles, read from your own copy of the After
        Sales Application discs. It runs entirely in the browser: the data is read where
        it lies, and nothing is uploaded.
      </p>
      <p>
        The catalogue format, the CCITT Group 4 drawings and the callout hotspots were
        worked out by reading the data, and the findings are documented in the
        repository alongside the code that reads them.
      </p>
      <p class="fine">
        Not affiliated with or endorsed by Mitsubishi. The catalogue data is Mitsubishi's
        and is not distributed with this software — you supply your own discs. masax is
        interoperability work: understanding a 2008 format so the information can be read
        on current systems.
      </p>
    </div>

    <footer>
      <a href={REPOSITORY} target="_blank" rel="noreferrer noopener">
        <GithubMark size={13} /> Source and documentation
      </a>
      <div class="spacer"></div>
      <span class="fine">PolyForm Noncommercial 1.0.0</span>
    </footer>
  </div>
</div>

<style>
  .scrim {
    position: fixed;
    inset: 0;
    background: var(--scrim);
    display: grid;
    place-items: center;
    /*
     * A definite row, so the panel's `max-height: 100%` has something to
     * resolve against. With the default `auto` row, 100% is 100% of the
     * content — the panel grows past the viewport and the scroll container
     * inside it never engages.
     */
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
    width: min(31rem, 100%);
    max-height: 100%;
    overflow: auto;
    background: var(--sheet);
    border: 1px solid var(--rule);
    border-top: 2px solid var(--red);
    border-radius: var(--r-lg);
    box-shadow: 0 12px 40px -12px var(--drop);
  }
  header {
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
  .x {
    color: var(--red);
  }
  .version {
    font-size: 11px;
    color: var(--steel);
    text-decoration: none;
  }
  .version:hover {
    color: var(--red-deep);
    text-decoration: underline;
  }
  .spacer {
    flex: 1;
  }
  .body {
    padding: 0.85rem;
    display: flex;
    flex-direction: column;
    gap: 0.7rem;
  }
  .body p {
    margin: 0;
    font-size: 12.5px;
    line-height: 1.5;
  }
  .fine {
    color: var(--steel);
    font-size: 11px !important;
    line-height: 1.5;
  }
  footer {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.6rem 0.85rem;
    border-top: 1px solid var(--rule);
    background: var(--shade);
    border-radius: 0 0 var(--r-lg) var(--r-lg);
  }
  footer a {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    color: var(--ink);
    font-size: 12px;
    text-decoration: none;
  }
  footer a:hover {
    color: var(--red-deep);
  }
  .icon {
    border: 0;
    background: none;
    padding: 0.15rem;
    color: var(--steel);
    display: flex;
  }
  .icon:hover {
    color: var(--red-deep);
  }
</style>
