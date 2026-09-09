<script lang="ts">
  /**
   * What the vehicle's OPC stands for.
   *
   * An OPC is a pack code, not a feature: `H70` on a Pajero is 34 options. The
   * list is worth a panel of its own rather than a tooltip, because it is long
   * and because the codes matter as much as the words — a parts desk reads
   * `A28` off a build sheet and wants to confirm it.
   *
   * The provenance line is not decoration. Several `Opc` records can share a
   * `(model, opc)` and differ only by classification and date window, so the
   * panel says which one was matched and on what. When it fell back to a weaker
   * match the wording changes, because a list picked on classification alone
   * may be the wrong period's.
   */
  import X from "@lucide/svelte/icons/x";
  import Diamond from "./Diamond.svelte";
  import { formatAsaDateShort } from "@masax/core";
  import type { OptionSet } from "@masax/catalogue";
  import { i18n } from "./i18n/index.svelte";

  let {
    set,
    busy,
    onClose,
  }: { set?: OptionSet; busy: boolean; onClose: () => void } = $props();

  const t = $derived(i18n.t);

  const window_ = $derived.by(() => {
    if (!set) return "";
    const from = formatAsaDateShort(set.startDate);
    const to = formatAsaDateShort(set.endDate);
    return from || to ? `${from || "?"} – ${to || "?"}` : "";
  });

  /**
   * Said plainly, because a fallback match can be the wrong period's list.
   *
   * The `via` values are the domain's own words and double as translation keys,
   * so a new match route surfaces as a missing key rather than as silence.
   */
  const provenance = $derived(
    set
      ? t(`options.via.${set.via}`, {
          classification: set.classification ?? t("options.classification"),
        })
      : "",
  );

  const described = $derived(set?.options.filter((o) => o.name).length ?? 0);
</script>

<svelte:window onkeydown={(e) => e.key === "Escape" && onClose()} />

<div class="scrim" role="presentation">
  <button class="backdrop" onclick={onClose} aria-label="Close" tabindex="-1"></button>
  <div class="panel" role="dialog" aria-modal="true" aria-label={t("options.title")} tabindex="-1">
    <header>
      <Diamond size={11} />
      <h2>{t("options.title")}</h2>
      {#if set}
        <span class="pack code">{set.model} · {set.opc}</span>
      {/if}
      <div class="spacer"></div>
      <span class="count code">
        {#if set}{set.options.length}{/if}
      </span>
      <button class="icon" onclick={onClose} aria-label={t("settings.close")}><X size={15} /></button>
    </header>

    {#if busy}
      <p class="none">{t("options.reading")}</p>
    {:else if !set}
      <p class="none">{t("options.none")}</p>
    {:else}
      <div class="meta">
        <span>{provenance}</span>
        {#if window_}<span class="code">{window_}</span>{/if}
        {#if set.others > 0}
          <span class="fine">{t("options.otherRecords", { count: set.others })}</span>
        {/if}
      </div>

      <ul>
        {#each set.options as option (option.code)}
          <li>
            <span class="oc code">{option.code}</span>
            <span class="name" class:bare={!option.name}>
              {option.name ?? t("options.undescribed")}
            </span>
          </li>
        {/each}
      </ul>

      {#if described < set.options.length}
        <footer class="fine">
          {t("options.noDescription", { count: set.options.length - described })}
        </footer>
      {/if}
    {/if}
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
    /* The list can be 50 long, so the panel scrolls inside the viewport rather
       than growing past it. */
    display: flex;
    flex-direction: column;
    width: min(34rem, 100%);
    max-height: 100%;
    background: var(--sheet);
    border: 1px solid var(--rule);
    border-top: 2px solid var(--red);
    border-radius: var(--r-lg);
    box-shadow: 0 12px 40px -12px var(--drop);
  }
  header {
    flex: none;
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
  .pack {
    font-size: 11.5px;
    color: var(--steel);
  }
  .count {
    font-size: 11px;
    color: var(--steel-light);
  }
  .spacer {
    flex: 1;
  }
  .meta {
    flex: none;
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.5rem;
    padding: 0.5rem 0.85rem;
    border-bottom: 1px solid var(--rule-soft);
    background: var(--shade);
    font-size: 11px;
    color: var(--steel);
  }
  ul {
    flex: 1;
    min-height: 0;
    overflow: auto;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  li {
    display: grid;
    grid-template-columns: 3.4rem minmax(0, 1fr);
    gap: 0.6rem;
    padding: 0.3rem 0.85rem;
    border-bottom: 1px solid var(--rule-soft);
  }
  li:last-child {
    border-bottom: 0;
  }
  .oc {
    font-size: 12px;
    font-weight: 600;
    white-space: pre;
  }
  .name {
    font-size: 12px;
    line-height: 1.35;
  }
  .name.bare {
    color: var(--steel-light);
    font-style: italic;
  }
  .none {
    margin: 0;
    padding: 1.1rem 0.85rem;
    text-align: center;
    color: var(--steel);
    font-size: 12px;
  }
  footer {
    flex: none;
    padding: 0.55rem 0.85rem;
    border-top: 1px solid var(--rule);
    background: var(--shade);
    border-radius: 0 0 var(--r-lg) var(--r-lg);
  }
  .fine {
    color: var(--steel);
    font-size: 11px;
    line-height: 1.45;
  }
  .icon {
    display: flex;
    padding: 0.15rem;
    border: 0;
    background: none;
    color: var(--steel);
  }
  .icon:hover {
    color: var(--red);
  }
</style>
