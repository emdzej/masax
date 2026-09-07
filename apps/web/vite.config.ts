import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [svelte()],
  // The app ships without data; a static host serves the vendor's own files, so
  // the build has to work from any path.
  base: "./",
  build: { target: "es2022" },
});
