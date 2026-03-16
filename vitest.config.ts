import { defineConfig } from "vitest/config";
import path from "path";
import UnpluginTypia from "typia/lib/transform";
// import UnpluginTypia from "@typia/unplugin/vite";

export default defineConfig({
  resolve: {
    preserveSymlinks: true,
  },
  plugins: [
    UnpluginTypia({}),
    // {
    //   transform: "typia/lib/transfrom",
    //   transformPorgram: true,
    // },
  ],
  test: {
    alias: {
      // "@generated": path.resolve(__dirname, "./build/tsc/build/generated"),
    },
    env: {
      JWT_SECRET: "super-secret-key-123",
    },
    exclude: ["src/**"],
  },
});
