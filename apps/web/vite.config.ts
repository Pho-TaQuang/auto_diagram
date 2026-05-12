import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const webRoot = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = path.resolve(webRoot, "../..");

export default defineConfig({
  root: webRoot,
  plugins: [react()],
  publicDir: false,
  build: {
    outDir: path.resolve(repoRoot, "dist/apps/web-build"),
    emptyOutDir: true
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    fs: {
      allow: [repoRoot]
    }
  },
  preview: {
    host: "127.0.0.1",
    port: 4173
  }
});
