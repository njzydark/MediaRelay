import { defineConfig } from "@rsbuild/core";
import { pluginReact } from "@rsbuild/plugin-react";
import { pluginLess } from "@rsbuild/plugin-less";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [
    pluginLess({
      parallel: true,
      lessLoaderOptions: { additionalData: `@import "@/styles/mixins.less";` },
    }),
    pluginReact(),
  ],
  source: {
    entry: {
      index: "./src/index.tsx",
    },
  },
  resolve: {
    alias: {
      "@lib/shared": path.resolve(__dirname, "../../packages/shared/mod.ts"),
    },
  },
  html: {
    template: "./index.html",
  },
  output: {
    assetPrefix: "/mediarelay/webui",
    target: "web",
    distPath: {
      root: "./dist",
      js: "",
      css: "",
    },
    legalComments: "none",
    filenameHash: false,
    cleanDistPath: true,
  },
  performance: {
    chunkSplit: {
      strategy: "all-in-one",
    },
  },
  server: {
    port: 3001,
    proxy: {
      "/mediarelay/api": "http://localhost:3000",
    },
  },
});
