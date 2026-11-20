import path from 'node:path'
import vue from '@vitejs/plugin-vue'
import frappeui from 'frappe-ui/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  root: path.resolve(__dirname, 'frontend'),
  base: './',
  plugins: [
    frappeui({
      lucideIcons: true,
      frappeProxy: false,
      jinjaBootData: false,
      buildConfig: false,
    }),
    vue(),
  ],
  resolve: {
    alias: [
      { find: '@', replacement: path.resolve(__dirname, 'frontend/src') },
      {
        find: '~icons/lucide/chevron-down',
        replacement: path.resolve(__dirname, 'frontend/src/test/icon-stub.ts'),
      },
    ],
  },
  build: {
    outDir: 'dist-recorder',
    emptyOutDir: true,
    target: 'esnext',
    rollupOptions: { input: path.resolve(__dirname, 'frontend/recorder.html') },
  },
})
