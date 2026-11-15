import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// @ts-expect-error Local Node middleware is JavaScript.
import { soilMiddleware } from "./scripts/soil-server.mjs";
export default defineConfig({
  plugins: [
    react(),
    {
      name: "field-soil",
      configureServer(server) {
        server.middlewares.use(soilMiddleware);
      },
      configurePreviewServer(server) {
        server.middlewares.use(soilMiddleware);
      },
    },
  ],
});
