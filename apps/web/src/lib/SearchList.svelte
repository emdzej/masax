<!--
  A filterable rail of coded items — main groups, or the plates within one.

  Both lists are long (25 main groups, up to 30-odd plates) and both are keyed
  by a number the user often already knows, so the filter matches the code as
  well as the name: "13" finds FUEL, "tank" finds FUEL TANK. The count of
  matches is shown rather than hidden, because a filter that silently empties a
  list is how you lose confidence in a tool.
-->
<script lang="ts">
  import { Search, X } from "@lucide/svelte";
  import Diamond from "./Diamond.svelte";

  export interface ListItem {
    /** Stable identity for keying and selection. */
    key: string;
    /** The number: a main group, or a subgroup. Shown in mono. */
    code: string;
    name: string;
    /** Qualifier line, e.g. `ALL` or `CANVAS,METAL TOP`. */
    note?: string;
  }

  let {
    label,
    items,
    selectedKey,
    onSelect,
    placeholder = "Filter",
    emptyHint = "Nothing here yet.",
  }: {
    label: string;
    items: ListItem[];
    selectedKey?: string;
    onSelect: (item: ListItem) => void;
    placeholder?: string;
    emptyHint?: string;
  } = $props();

  let query = $state("");

  const matches = $derived.by(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (item) =>
        item.code.toLowerCase().includes(q) ||
        item.name.toLowerCase().includes(q) ||
        (item.note ?? "").toLowerCase().includes(q),
    );
  });

  function onKey(event: KeyboardEvent) {
    if (event.key === "Enter" && matches.length > 0) {
      onSelect(matches[0]!);
    } else if (event.key === "Escape") {
      query = "";
    }
  }
</script>

<section class="rail">
  <header>
    <span class="label">{label}</span>
    <span class="count code">
      {query.trim() && matches.length !== items.length
        ? `${matches.length}/${items.length}`
        : items.length || ""}
    </span>
  </header>

  {#if items.length > 0}
    <div class="find">
      <Search size={13} strokeWidth={2} />
      <input bind:value={query} {placeholder} onkeydown={onKey} spellcheck="false" />
      {#if query}
        <button class="clear" onclick={() => (query = "")} aria-label="Clear filter">
          <X size={12} strokeWidth={2.5} />
        </button>
      {/if}
    </div>
  {/if}

  {#if items.length === 0}
    <p class="hint">{emptyHint}</p>
  {:else if matches.length === 0}
    <p class="hint">No match for “{query}”.</p>
  {:else}
    <ul>
      {#each matches as item (item.key)}
        <li>
          <button
            class="row pressable"
            class:on={item.key === selectedKey}
            onclick={() => onSelect(item)}
          >
            <span class="mark">
              {#if item.key === selectedKey}<Diamond size={7} />{/if}
            </span>
            <span class="num code">{item.code}</span>
            <span class="text">
              {item.name}
              {#if item.note}<em>{item.note}</em>{/if}
            </span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .rail {
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0 0 0.35rem;
    border-bottom: 1px solid var(--rule);
  }
  .count {
    font-size: 10px;
    color: var(--steel-light);
  }

  .find {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.3rem 0.4rem;
    border-bottom: 1px solid var(--rule-soft);
    color: var(--steel-light);
  }
  .find input {
    flex: 1;
    min-width: 0;
    border: 0;
    background: none;
    padding: 0;
    font-size: 12px;
  }
  .find input::placeholder {
    color: var(--steel-light);
  }
  .find input:focus {
    outline: none;
  }
  .find:focus-within {
    color: var(--red);
  }
  .clear {
    border: 0;
    background: none;
    padding: 0;
    display: flex;
    color: var(--steel-light);
  }
  .clear:hover {
    color: var(--ink);
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    overflow-y: auto;
    min-height: 0;
  }
  .row {
    display: grid;
    grid-template-columns: 10px 2.6em 1fr;
    align-items: baseline;
    gap: 0.4rem;
    width: 100%;
    text-align: left;
    border: 0;
    border-left: 2px solid transparent;
    background: none;
    padding: 0.28rem 0.4rem 0.28rem 0.3rem;
    font-size: 12px;
    line-height: 1.3;
  }
  .row:hover {
    background: var(--shade);
  }
  .row.on {
    background: var(--red-wash);
    border-left-color: var(--red);
  }
  .mark {
    display: flex;
    align-items: center;
    height: 1em;
  }
  .num {
    font-size: 11px;
    color: var(--steel);
  }
  .row.on .num {
    color: var(--red-deep);
    font-weight: 600;
  }
  .text em {
    display: block;
    font-style: normal;
    font-size: 10.5px;
    color: var(--steel);
    margin-top: 0.1rem;
  }
  .hint {
    margin: 0.6rem 0.4rem;
    font-size: 11.5px;
    color: var(--steel);
  }
</style>
