import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts", cli: "src/cli.ts" },
  format: ["esm"],
  target: "node18",
  dts: { entry: { index: "src/index.ts" } },
  clean: true,
  sourcemap: false,
});
