import path from 'node:path'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

// The Writer collab kernel: one Node file with the browsers' Yjs, y-tiptap and the editor schema,
// which the server runs on demand to judge rows (suite_core/collab/kernel.py)
export default defineConfig({
  root: __dirname,
  publicDir: false,
  configFile: false,
  plugins: [vue()],
  resolve: {
    alias: [{ find: '@', replacement: path.resolve(__dirname, 'src') }],
    dedupe: ['vue', 'yjs', '@tiptap/pm'],
  },
  ssr: { noExternal: true, target: 'node' },
  build: {
    ssr: path.resolve(__dirname, 'src/apps/writer/collab/kernel-entry.ts'),
    outDir: '../suite/writer/collab/dist',
    emptyOutDir: true,
    minify: false,
    sourcemap: false,
    rollupOptions: { output: { format: 'cjs', entryFileNames: 'kernel.cjs' } },
  },
})
