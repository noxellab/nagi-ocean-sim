import { readFileSync } from "node:fs";
import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  plugins: [
    {
      name: "license-files",
      generateBundle() {
        for (const name of ["LICENSE", "THIRD_PARTY_NOTICES.txt"]) {
          this.emitFile({
            type: "asset",
            fileName: name,
            source: readFileSync(new URL(name, import.meta.url), "utf8"),
          });
        }
      },
    },
  ],
});
