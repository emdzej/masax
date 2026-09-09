<!--
  A searchable dropdown for the toolbar.

  A native `<select>` cannot be filtered, and both of these lists are long
  enough to need it: 52 catalogues, and up to 19 models under one of them. Worse
  for the catalogue, **sixteen of the 52 share a name with another** — the four
  `PAJERO/MONTERO(EUR)` entries are the Pajero 1 through 4 — so a plain list of
  names is not just slow to scan, it is ambiguous. Each option therefore carries
  a hint, and the filter matches it along with the label and the key.

  Editable rather than a button with a popup: the fastest path for someone who
  knows what they want is to type three letters. On blur or Escape the input
  reverts to the selected label, so a half-typed query never looks like a
  selection that did not take.
-->
<script lang="ts">
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import { i18n } from "./i18n/index.svelte";

  export interface ComboItem {
    /** The value reported on selection. */
    key: string;
    label: string;
    /** What tells this option apart from a same-named one. */
    hint?: string;
  }

  let {
    id,
    items,
    value,
    placeholder,
    disabled = false,
    mono = false,
    onSelect,
  }: {
    id: string;
    items: ComboItem[];
    value?: string;
    placeholder: string;
    disabled?: boolean;
    /** The model codes are read as codes, so they are set in mono. */
    mono?: boolean;
    onSelect: (key: string) => void;
  } = $props();

  const t = $derived(i18n.t);

  let input = $state<HTMLInputElement | undefined>(undefined);
  let list = $state<HTMLUListElement | undefined>(undefined);
  let open = $state(false);
  let query = $state("");
  /** Index into `matches`, or -1 for nothing highlighted. */
  let at = $state(-1);

  const selected = $derived(items.find((i) => i.key === value));

  /**
   * While closed the input shows the selection; while open it shows the query.
   *
   * Keeping them separate is what lets Escape put the selection back without
   * having to remember it anywhere else.
   */
  const shown = $derived(open ? query : (selected?.label ?? ""));

  const matches = $derived.by(() => {
    const q = query.trim().toLowerCase();
    // An open box with an untouched query lists everything: the user clicked to
    // browse, not to search.
    if (!open || !q || q === selected?.label.toLowerCase()) return items;
    return items.filter(
      (item) =>
        item.label.toLowerCase().includes(q) ||
        item.key.toLowerCase().includes(q) ||
        (item.hint ?? "").toLowerCase().includes(q),
    );
  });

  function show(): void {
    if (disabled) return;
    open = true;
    query = "";
    at = matches.findIndex((i) => i.key === value);
  }

  function close(): void {
    open = false;
    query = "";
    at = -1;
  }

  function pick(item: ComboItem): void {
    onSelect(item.key);
    close();
    input?.blur();
  }

  function move(by: number): void {
    if (!open) {
      show();
      return;
    }
    if (matches.length === 0) return;
    at = (at + by + matches.length) % matches.length;
  }

  function onKey(event: KeyboardEvent): void {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        move(1);
        break;
      case "ArrowUp":
        event.preventDefault();
        move(-1);
        break;
      case "Enter": {
        // Enter with nothing highlighted takes the only match, which is what
        // typing a whole model code and pressing Enter should do.
        const item = matches[at] ?? (matches.length === 1 ? matches[0] : undefined);
        if (item) {
          event.preventDefault();
          pick(item);
        }
        break;
      }
      case "Escape":
        if (open) {
          event.stopPropagation();
          close();
          input?.blur();
        }
        break;
      case "Tab":
        close();
        break;
    }
  }

  // Keep the highlighted option in view: 52 catalogues do not fit the popup.
  $effect(() => {
    if (!open || at < 0 || !list) return;
    list.querySelector<HTMLElement>(`[data-at="${at}"]`)?.scrollIntoView({ block: "nearest" });
  });
</script>

<div class="combo" class:open>
  <input
    {id}
    {placeholder}
    {disabled}
    bind:this={input}
    class:code={mono}
    value={shown}
    role="combobox"
    aria-expanded={open}
    aria-controls={`${id}-list`}
    aria-autocomplete="list"
    aria-activedescendant={open && at >= 0 ? `${id}-opt-${at}` : undefined}
    autocomplete="off"
    spellcheck="false"
    data-value={value ?? ""}
    oninput={(e) => {
      open = true;
      query = e.currentTarget.value;
      at = -1;
    }}
    onmousedown={() => (open ? close() : show())}
    onfocus={show}
    onblur={close}
    onkeydown={onKey}
  />
  <ChevronDown size={13} />

  <!-- `mousedown` rather than `click`: the input's blur fires first and would
       have closed the list before a click could land. -->
  <ul
    class="popup"
    class:hidden={!open}
    id={`${id}-list`}
    role="listbox"
    bind:this={list}
    aria-label={placeholder}
  >
    {#each matches as item, i (item.key)}
      <li
        id={`${id}-opt-${i}`}
        data-at={i}
        role="option"
        aria-selected={item.key === value}
        class:on={item.key === value}
        class:at={i === at}
        onmousedown={(e) => {
          e.preventDefault();
          pick(item);
        }}
      >
        <span class="text" class:code={mono}>{item.label}</span>
        {#if item.hint}<span class="hint code">{item.hint}</span>{/if}
      </li>
    {/each}
    {#if matches.length === 0}
      <li class="empty" role="presentation">{t("rail.noMatch", { query })}</li>
    {/if}
  </ul>
</div>

<style>
  .combo {
    position: relative;
    display: flex;
    align-items: center;
    min-width: 0;
  }
  .combo :global(svg) {
    position: absolute;
    right: 0.35rem;
    pointer-events: none;
    color: var(--steel-light);
  }
  .combo.open :global(svg) {
    color: var(--red);
  }
  input {
    width: 100%;
    min-width: 0;
    padding: 0.25rem 1.4rem 0.25rem 0.4rem;
    border: 1px solid var(--rule);
    border-radius: var(--r);
    background: var(--sheet);
    font-size: 12.5px;
    text-overflow: ellipsis;
  }
  input:disabled {
    color: var(--steel-light);
    background: var(--shade);
  }
  input:hover:not(:disabled) {
    border-color: var(--steel);
  }
  .combo.open input {
    border-color: var(--red);
  }

  .popup {
    position: absolute;
    top: calc(100% + 2px);
    left: 0;
    /* Wider than the field when it can be: a catalogue name plus its date range
       does not fit the model box. */
    min-width: 100%;
    width: max-content;
    max-width: min(28rem, 80vw);
    max-height: 20rem;
    overflow-y: auto;
    z-index: 40;
    margin: 0;
    padding: 0.15rem;
    list-style: none;
    background: var(--sheet);
    border: 1px solid var(--rule);
    border-radius: var(--r-lg);
    box-shadow: 0 10px 30px -10px var(--drop);
  }
  .popup.hidden {
    display: none;
  }
  li {
    display: flex;
    align-items: baseline;
    gap: 0.6rem;
    padding: 0.25rem 0.4rem;
    border-radius: var(--r);
    font-size: 12.5px;
    cursor: pointer;
  }
  .text {
    flex: 1;
    white-space: nowrap;
  }
  .hint {
    flex: none;
    font-size: 10.5px;
    color: var(--steel);
  }
  li.at {
    background: var(--shade);
  }
  li.on {
    color: var(--red);
    font-weight: 600;
  }
  li.on .hint {
    color: var(--red-deep);
  }
  li.at.on,
  li:hover {
    background: var(--red-wash);
  }
  .empty {
    color: var(--steel);
    cursor: default;
  }
  .empty:hover {
    background: none;
  }
</style>
