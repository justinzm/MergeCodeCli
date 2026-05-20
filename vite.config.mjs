import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  base: "./",
  plugins: [react()],
  root: path.resolve("src/renderer"),
  server: {
    port: 5073,
    strictPort: true
  },
  build: {
    outDir: path.resolve("dist/renderer"),
    emptyOutDir: true
  }
});
