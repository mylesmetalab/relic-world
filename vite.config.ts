import { defineConfig } from "vite";

// Relative base so the same build serves from a domain root or a sub-path
// (GitHub Pages, Sites, a folder on any static host).
export default defineConfig({
  base: "./",
  build: { target: "es2022", sourcemap: false },
});
