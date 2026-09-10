import { nitro } from "nitro/vite";
import vinext from "vinext";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [vinext(), nitro()],
  optimizeDeps: {
    exclude: ["vinext/dist/shims/internal/app-prefetch-fetch-queue.js"],
  },
});
