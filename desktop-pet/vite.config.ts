import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

const configuredDevPort = Number.parseInt(process.env.MMD_PET_DEV_PORT ?? "5174", 10);
const devPort = Number.isFinite(configuredDevPort) ? configuredDevPort : 5174;

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: devPort,
    strictPort: true,
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("../web/src", import.meta.url)),
    },
  },
  define: {
    "process.env.NEXT_PUBLIC_API_BASE_URL": JSON.stringify("http://127.0.0.1:8000"),
  },
  test: {
    exclude: ["**/node_modules/**", "**/dist/**", "**/dist-electron/**"],
  },
});
