/// <reference lib="webworker" />
/**
 * The service worker: the app shell, and nothing else.
 *
 * masax is two things of very different sizes — an 80 kB client and a 700 MB
 * catalogue — and only the first belongs in a cache. The catalogue is read
 * where it lies: from a picked folder, from the origin private filesystem, or
 * over HTTP with `Range`. Caching any of that would be pointless for the first
 * two and ruinous for the third.
 *
 * **The rule is a whitelist, and it has to be.** This worker answers only for
 * URLs it precached, plus navigations. Everything else is left entirely alone —
 * not passed through a cache strategy, not touched. The reason is the format:
 * a record read is "two bytes at `offset` for the length, then that many
 * bytes", issued as a `Range` request. A worker that answered one of those with
 * a cached `200` carrying the whole file would return the wrong bytes at every
 * offset, and nothing downstream would notice — the reader would decode
 * plausible garbage. A whitelist cannot make that mistake; a
 * "cache-first, network-fallback" default eventually would.
 *
 * Written out rather than generated for the same reason. This is thirty lines
 * and its behaviour is legible; a generated worker with a runtime-caching
 * config is neither, and the failure it can cause here is silent.
 */
/*
 * This file is a module, and `export {}` is what makes it one. `declare global`
 * is only allowed inside a module, and the worker imports nothing, so without
 * this line TypeScript treats the file as a script and rejects the
 * augmentation. The build emits an IIFE either way.
 */
export {};

declare global {
  /**
   * The injection point, and the spelling is not negotiable: workbox scans the
   * source for the literal `self.__WB_MANIFEST` and refuses the build without
   * it. Declared as a global rather than by redeclaring `self`, which
   * `lib.webworker` already owns.
   */
  var __WB_MANIFEST: { url: string; revision: string | null }[];
}

/**
 * `self`, as what it actually is.
 *
 * `lib.webworker` types `self` as a `WorkerGlobalScope`, which has no
 * `registration`, `clients` or `skipWaiting` — those belong to the service
 * worker scope. One named cast, rather than a redeclaration that collides with
 * the lib.
 */
const sw = self as unknown as ServiceWorkerGlobalScope;

/**
 * Versioned by the build, so a new release replaces the old shell wholesale
 * rather than serving a mix of both.
 */
const CACHE = `masax-shell-${__MASAX_VERSION__}`;

/** The precached shell, as absolute URLs, which is what `cache.match` wants. */
const SHELL = new Set(self.__WB_MANIFEST.map((entry) => new URL(entry.url, sw.location.href).href));

const INDEX = new URL("index.html", sw.registration.scope).href;

sw.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await cache.addAll([...SHELL]);
      // Take over at once. There is no half-updated state to protect: the shell
      // holds no data, and the catalogue is opened fresh on every load.
      await sw.skipWaiting();
    })(),
  );
});

sw.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name !== CACHE && name.startsWith("masax-shell-")) await caches.delete(name);
      }
      await sw.clients.claim();
    })(),
  );
});

sw.addEventListener("fetch", (event) => {
  const request = event.request;

  // Anything that is not a plain GET is somebody else's business.
  if (request.method !== "GET") return;

  // A range read is a catalogue read. Bailing here is redundant given the
  // whitelist below, and it stays because it is the mistake that would matter:
  // see the note at the top of this file.
  if (request.headers.has("range")) return;

  /*
   * A navigation is answered from the cached shell so the app opens with no
   * network at all. `index.html` and not the requested URL: the client is a
   * single page and any path within it resolves to the same document.
   */
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        const cached = await caches.match(INDEX, { cacheName: CACHE });
        return cached ?? fetch(request);
      })(),
    );
    return;
  }

  // Everything else: answered only if it is part of the shell.
  const href = new URL(request.url).href;
  if (!SHELL.has(href)) return;

  event.respondWith(
    (async () => {
      const cached = await caches.match(href, { cacheName: CACHE });
      if (cached) return cached;
      // A shell file missing from the cache means a partial install. Fetch it
      // and put it back rather than failing the load.
      const response = await fetch(request);
      if (response.ok) {
        const cache = await caches.open(CACHE);
        await cache.put(href, response.clone());
      }
      return response;
    })(),
  );
});
