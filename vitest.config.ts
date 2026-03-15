import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    alias: {
      "@generated": path.resolve(__dirname, "./build/tsc/build/generated"),
    },
    env: {
      JWT_SECRET: "super-secret-key-123",
    },
  },
});
