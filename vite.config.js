const path = require("path");

const react = require("@vitejs/plugin-react").default;
const { defineConfig } = require("vite");

module.exports = defineConfig({
  root: path.resolve(__dirname, "apps/admin"),
  base: "/admin/",
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/admin-api": "http://localhost:3000",
    },
  },
  build: {
    outDir: path.resolve(__dirname, "admin"),
    emptyOutDir: true,
  },
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
