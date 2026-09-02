import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: './', // ensures assets load properly regardless of subdirectory / S3 path
  build: {
    sourcemap: true, // Enables JavaScript source maps (.map files) for unminified stack traces in CloudWatch RUM & DevTools
  }
})
