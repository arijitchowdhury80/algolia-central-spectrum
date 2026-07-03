import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Tests live alongside the source they cover (src/**/*.test.ts).
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
