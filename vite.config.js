import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const proxyTarget = env.VITE_OPENCLAW_PROXY_TARGET || "http://127.0.0.1:8443";

  return {
    server: {
      proxy: {
        "/openclaw": {
          target: proxyTarget,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/openclaw/, "")
        }
      }
    }
  };
});

