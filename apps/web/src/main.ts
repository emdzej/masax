import { mount } from "svelte";
import App from "./App.svelte";

/**
 * Register the service worker, if this build has one.
 *
 * By hand rather than through the plugin's helper, for two reasons. The scope
 * is `./`, because a build can be served from a subdirectory and the worker has
 * to be relative to wherever `index.html` ended up — the same reason `base` is
 * `./` by default. And a registration that fails should be visible in the
 * console rather than swallowed: the app works perfectly without a worker, so
 * this is an enhancement that must not take the page down with it.
 *
 * `import.meta.env.DEV` skips it in development, where a cached shell means
 * editing a file and being served the previous one.
 */
function registerServiceWorker(): void {
  if (import.meta.env.DEV || !("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    /*
     * `./sw.js`, resolved against the *document* and not against
     * `import.meta.url`. The bundle lives in `assets/` with a hashed name, so
     * `new URL("sw.js", import.meta.url)` asks for `assets/sw.js` and gets a
     * 404 — and a failed registration is silent unless you look for it.
     *
     * Relative, so a build served from a subdirectory registers a worker scoped
     * to that subdirectory; see `base` in the Vite config.
     */
    void navigator.serviceWorker
      .register("./sw.js", { type: "classic" })
      .catch((cause: unknown) => {
        console.warn("masax: the service worker did not register", cause);
      });
  });
}

registerServiceWorker();

export default mount(App, { target: document.getElementById("app")! });
