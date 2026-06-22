import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Self-contained build: CSS tokens + fonts are vendored under src/ (src/styles,
// src/fonts), so the desktop app no longer depends on the sibling site repo
// being checked out next to it. This keeps CI / cross-machine builds working.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
});
