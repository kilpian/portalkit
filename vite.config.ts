import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
  publicDir: 'public',
  server: {
    port: 5175,
  },
  build: {
    rollupOptions: {
      input: {
        app: resolve(__dirname, 'app.html'),
      }
    }
  }
})
