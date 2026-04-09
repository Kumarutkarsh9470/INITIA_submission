import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { nodePolyfills } from "vite-plugin-node-polyfills";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    nodePolyfills({
      include: ["buffer", "process", "stream", "util", "crypto"],
      globals: { Buffer: true, process: true },
    }),
  ],
  resolve: {
    alias: {
      "@": "/src",
    },
  },
  server: {
    proxy: {
      // In dev mode, proxy API calls to the production Contabo server.
      // Contributors don't need a local chain — just `npm run dev`.
      "/evm-rpc": {
        target: "http://207.180.203.32:8080",
        changeOrigin: true,
      },
      "/faucet": {
        target: "http://207.180.203.32:8080",
        changeOrigin: true,
      },
      "/cosmos-rpc": {
        target: "http://207.180.203.32:8080",
        changeOrigin: true,
      },
      "/cosmos-rest": {
        target: "http://207.180.203.32:8080",
        changeOrigin: true,
      },
    },
  },
});
