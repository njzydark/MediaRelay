import { defineConfig } from "@rsbuild/core";
import { pluginReact } from "@rsbuild/plugin-react";

export default defineConfig({
  plugins: [pluginReact()],
  source: { entry: { index: "./src/index.tsx" } },
  html: { template: "./index.html", favicon: "./public/favicon.svg" },
  output: { assetPrefix: "./", distPath: { css: "" }, legalComments: "linked" },
  server: { port: 3002 },
});
