import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Build straight into the backend package so a single Debian package ships
// backend + kiosk + control UI, and FastAPI serves everything (§6).
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "../backend/tl_commissioning_source/static",
    emptyOutDir: true,
  },
  server: {
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8808",
        ws: true,
      },
      "/health": "http://127.0.0.1:8808",
    },
  },
});
