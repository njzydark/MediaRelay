import { defineConfig } from "@rslib/core";

export default defineConfig({
  source: {
    entry: {
      "video-cors": "./scripts/video-cors.ts",
      "external-player": "./scripts/external-player.ts",
    },
  },
  resolve: {
    alias: {
      "@lib/shared": "../shared/mod.ts",
    },
  },
  output: {
    target: "web",
  },
  lib: [
    {
      format: "iife",
      syntax: "es2015",
    },
  ],
});
