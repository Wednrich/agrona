import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// @ts-expect-error Local Node middleware is JavaScript.
import { fieldDataMiddleware } from "./scripts/soil-server.mjs";
export default defineConfig({
  plugins: [
    react(),
    {
      name: "field-data",
      configureServer(server) {
        server.middlewares.use(fieldDataMiddleware);
      },
      configurePreviewServer(server) {
        server.middlewares.use(fieldDataMiddleware);
      },
    },
  ],
});
