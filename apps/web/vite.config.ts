import { readFileSync } from "node:fs";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

/**
 * The version and repository come from the root `package.json` at build time.
 *
 * Read rather than hard-coded so a release cannot ship a stale number, and
 * injected rather than imported so the JSON does not end up in the bundle.
 */
const root = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
  version: string;
  repository?: { url?: string };
};
const repository = (root.repository?.url ?? "https://github.com/emdzej/masax").replace(
  /\.git$/,
  "",
);

export default defineConfig({
  plugins: [
    svelte(),
    /*
     * Installable, and opens with no network.
     *
     * `injectManifest`, not `generateSW`: the worker is written out in
     * `src/sw.ts` because what it must *not* do matters more than what it does
     * — see the note at the top of that file. This plugin's job here is only to
     * hand it the list of built shell files and to emit the manifest.
     */
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      // Registered by hand in `main.ts`, so the failure is visible and the
      // scope is ours to reason about.
      injectRegister: null,
      registerType: "autoUpdate",
      injectManifest: {
        // The shell only. The catalogue is never a build artifact, but the
        // icons and the index are.
        globPatterns: ["**/*.{js,css,html,png,webmanifest}"],
        /*
         * A classic worker, not an ES module. Module workers are still not
         * supported in Firefox, and this one imports nothing, so the module
         * format buys nothing and costs that browser the whole feature.
         * `main.ts` registers it with a matching `type`.
         */
        rollupFormat: "iife",
      },
      manifest: {
        name: "masax — Mitsubishi parts catalogue",
        short_name: "masax",
        description:
          "A parts catalogue for Mitsubishi vehicles, read from your own copy of the After Sales Application discs.",
        // Matching the interface's own accent and sheet, so the splash and the
        // title bar are not a different product to the app.
        theme_color: "#e60012",
        background_color: "#ffffff",
        display: "standalone",
        orientation: "any",
        start_url: ".",
        scope: ".",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          // Android crops an icon to the launcher's shape; a maskable one is
          // drawn with the margin that survives it.
          {
            src: "icon-maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  define: {
    __MASAX_VERSION__: JSON.stringify(root.version),
    __MASAX_REPOSITORY__: JSON.stringify(repository),
  },
  /*
   * Where the site will live.
   *
   * A custom domain serves at the root; the default `<user>.github.io/<repo>/`
   * serves under a prefix. This is baked in at build time and a build cannot be
   * relocated afterwards, so CI decides it and passes it in. `./` is the local
   * default, which works from a file path or any directory.
   */
  base: process.env["BASE_PATH"] ?? "./",
  build: { target: "es2022" },
});
