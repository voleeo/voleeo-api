import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import path from "path"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  build: {
    target: "es2020",
    // Desktop app loads from disk — chunk splitting and size don't matter.
    // The store layer's dynamic imports break init cycles (workspace ↔
    // websocket/git), not chunks, so the "ineffective" warning is expected.
    chunkSizeWarningLimit: 6000,
    rollupOptions: {
      onwarn(warning, warn) {
        if (warning.code === "INEFFECTIVE_DYNAMIC_IMPORT") return
        warn(warning)
      },
    },
  },
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
})
