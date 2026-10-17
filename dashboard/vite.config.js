import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Vite replaces import.meta.env.VITE_API_URL at build time.
// Default: http://localhost:8000 (the stub/real API).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    strictPort: true,
  },
  define: {
    "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV || "development"),
  },
});