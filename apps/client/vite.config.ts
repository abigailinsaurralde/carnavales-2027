import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
        // El backend expone las rutas sin prefijo (/judge/..., /auth/...);
        // el cliente llama con baseUrl "/api", así que se quita el prefijo.
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
});