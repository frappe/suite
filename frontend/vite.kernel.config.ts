import { createRequire } from 'node:module'
import path from 'node:path'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

// The Writer collab kernel: one Node file with the browsers' Yjs, y-tiptap and the editor schema,
// which the server runs on demand to judge rows (suite_core/content/kernel.py)
const yjs = createRequire(path.resolve(__dirname, 'package.json'))('yjs/package.json').version

export default defineConfig({
  root: __dirname,
  define: { __KERNEL_YJS__: JSON.stringify(yjs) },
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
    outDir: '../suite/writer/content/dist',
    emptyOutDir: true,
    minify: false,
    sourcemap: false,
    rollupOptions: { output: { format: 'cjs', entryFileNames: 'kernel.cjs' } },
  },
})
