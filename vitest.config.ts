import { defineConfig } from "vitest/config";

// Tests do not need CSS processing; skipping the PostCSS/Tailwind config keeps them independent of the Node version.
export default defineConfig({ css: { postcss: { plugins: [] } }, test: { testTimeout: 30000 } });
