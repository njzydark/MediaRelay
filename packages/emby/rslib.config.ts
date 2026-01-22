import { defineConfig } from "@rslib/core";

export default defineConfig({
  source: {
    entry: {
      "video-cros": "./scripts/video-cors.ts",
      "external-player": "./scripts/external-player.ts",
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
