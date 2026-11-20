import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/** Android gets a client-only static shell; the Vercel config stays separate. */
export default defineConfig({
  base: "./",
  resolve: { tsconfigPaths: true },
  plugins: [
    {
      name: "drop-bundled-basis",
      generateBundle(_options, bundle) {
        for (const name of Object.keys(bundle)) {
          if (name.includes("basis_transcoder")) delete bundle[name];
        }
      },
    },
    tailwindcss(),
    tanstackStart({
      spa: {
        enabled: true,
        prerender: {
          outputPath: "/index.html",
          crawlLinks: false,
          retryCount: 0,
        },
      },
    }),
    viteReact(),
  ],
  build: {
    outDir: "dist-android",
    emptyOutDir: true,
  },
});
