import { nitro } from "nitro/vite";
import vinext from "vinext";
import { defineConfig } from "vite";

export default defineConfig({
  // Nitro's package chunks create a cycle between Supabase SSR and the
  // CommonJS cookie helper. One server bundle preserves initialization order.
  plugins: [vinext(), nitro({ inlineDynamicImports: true })],
  optimizeDeps: {
    exclude: ["vinext/dist/shims/internal/app-prefetch-fetch-queue.js"],
  },
});
