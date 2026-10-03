import { defineConfig } from "vite";
export default defineConfig({
  base: process.env.VITE_BASE ?? "/failure-lab/",
  server: { proxy: { "/api": "http://localhost:3000" } },
});
