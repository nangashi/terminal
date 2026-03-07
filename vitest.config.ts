import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Claude Code sandbox sets TMPDIR=/tmp/claude which doesn't exist.
// Redirect to a writable path so jsdom can initialize.
if (process.env.TMPDIR === "/tmp/claude") {
  process.env.TMPDIR = "/tmp/claude-1000";
}

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    root: ".",
    pool: "threads",
  },
});
