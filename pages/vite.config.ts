import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const directory = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: directory,
  base: "/Watch-with-me-/",
  define: {
    "import.meta.env.VITE_P2P_ROOMS": JSON.stringify("true"),
  },
  publicDir: path.resolve(directory, "../public"),
  resolve: {
    alias: {
      "@": path.resolve(directory, ".."),
    },
  },
  plugins: [react()],
  build: {
    outDir: path.resolve(directory, "../pages-dist"),
    emptyOutDir: true,
  },
});
