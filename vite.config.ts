import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

// Vite drives the renderer; Tauri wraps it. `tauri dev` spawns this dev server
// via `beforeDevCommand` and points the webview at `devUrl`.
export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src/renderer/src')
    }
  },
  server: {
    port: 5173,
    strictPort: true,
    host: '127.0.0.1',
    hmr: {
      protocol: 'ws',
      host: '127.0.0.1',
      port: 5173
    }
  },
  clearScreen: false,
  envPrefix: ['VITE_', 'TAURI_ENV_*'],
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
    target: ['es2021', 'chrome105', 'safari13'],
    minify: 'esbuild',
    sourcemap: false
  }
})
