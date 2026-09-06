import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Browser preview must use the same automatic JSX runtime as Electron's renderer.
export default defineConfig({
  plugins: [react()],
});
