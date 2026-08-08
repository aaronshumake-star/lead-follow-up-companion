import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import { assertSupabaseBuildEnv } from "./src/config/build-env.ts";

export default defineConfig(({ mode }) => {
  assertSupabaseBuildEnv(loadEnv(mode, process.cwd(), "VITE_"));

  return {
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        // Prompt, never auto-reload: a salesperson may have an unsaved note.
        // updateSW(true) activates once and cleanupOutdatedCaches removes the old
        // shell, preventing the stale Phase-1 cache problem without a reload loop.
        registerType: "prompt",
        injectRegister: false,
        includeAssets: [
          "favicon.svg",
          "robots.txt",
          "icons/apple-touch-icon-180.png",
        ],
        manifest: {
          name: "Lead Follow-Up Companion",
          short_name: "Follow-Up",
          description:
            "Private follow-up companion that keeps RV dealership leads from being forgotten.",
          theme_color: "#0f172a",
          background_color: "#0f172a",
          display: "standalone",
          orientation: "portrait-primary",
          start_url: "/",
          scope: "/",
          icons: [
            { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
            { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
            {
              src: "icons/icon-maskable-512.png",
              sizes: "512x512",
              type: "image/png",
              purpose: "maskable",
            },
          ],
        },
        workbox: {
          globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
          // Customer data must never be written into the service worker cache, so
          // only same-origin build output is precached and nothing is runtime-cached.
          navigateFallbackDenylist: [/^\/api\//],
          cleanupOutdatedCaches: true,
        },
        devOptions: {
          enabled: false,
        },
      }),
    ],
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
      },
    },
    build: {
      rollupOptions: {
        output: {
          // Split the two large dependencies out of the app chunk. They change far
          // less often than feature code, so a deploy does not invalidate them.
          manualChunks(id: string) {
            if (id.includes("node_modules/@supabase")) return "supabase";
            if (
              /node_modules\/(react|react-dom|react-router|scheduler)\//.test(
                id,
              )
            )
              return "react";
            return undefined;
          },
        },
      },
    },
    server: {
      port: 5173,
    },
    test: {
      environment: "jsdom",
      globals: true,
      setupFiles: ["./vitest.setup.ts"],
      css: true,
      include: ["src/**/*.{test,spec}.{ts,tsx}"],
      exclude: ["e2e/**", "node_modules/**"],
    },
  };
});
