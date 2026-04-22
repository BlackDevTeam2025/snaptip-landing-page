const path = require("path");

const react = require("@vitejs/plugin-react").default;
const { defineConfig } = require("vitest/config");

module.exports = defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "apps/admin/src"),
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: [path.resolve(__dirname, "vitest.setup.mjs")],
    include: [
      "apps/admin/src/**/*.test.{js,jsx}",
      "tests/**/*.test.js",
    ],
  },
});
