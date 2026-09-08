import { readFileSync } from "node:fs";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";

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
  plugins: [svelte()],
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
