import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// In development the browser calls /api/..., and Vite forwards it to the backend without the /api prefix.
// In Docker, nginx does the same job.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: process.env.API_URL ?? 'http://localhost:4000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
})
