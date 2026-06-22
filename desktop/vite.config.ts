import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// Resolve the site repo (ground truth for CSS tokens + fonts). Override with
// DEX_SITE_ROOT when the repos live elsewhere.
const SITE_ROOT = process.env.DEX_SITE_ROOT || "/Users/seb/dexdsl.github.io";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  resolve: {
    alias: {
      "@site": SITE_ROOT,
    },
  },
  server: {
    strictPort: true,
    fs: {
      // Allow importing the site repo's CSS/fonts from outside the project root.
      allow: [path.resolve(__dirname), SITE_ROOT],
    },
  },
});
