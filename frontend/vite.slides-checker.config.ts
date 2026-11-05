import { createRequire } from 'node:module'
import path from 'node:path'
import { defineConfig, type Plugin } from 'vite'

// Slides' Node build, one file with the browsers' Yjs, y-tiptap and the editor schema: the checker,
// which the server runs on demand to judge rows (suite/content/checker.py)
const requireFromFrontend = createRequire(path.resolve(__dirname, 'package.json'))
const yjsVersion = requireFromFrontend('yjs/package.json').version

// The editor setup reaches this only for its one url helper, and it drags in frappe-ui and the stores
const noMediaUploads: Plugin = {
  name: 'no-media-uploads',
  enforce: 'pre',
  resolveId: (id) => (/\/mediaUploads$/.test(id) ? '\0no-media-uploads' : null),
  load: (id) => (id === '\0no-media-uploads' ? "export const getAttachmentUrl = () => ''" : null),
}

export default defineConfig({
  root: __dirname,
  define: { __CHECKER_YJS__: JSON.stringify(yjsVersion) },
  publicDir: false,
  configFile: false,
  plugins: [noMediaUploads],
  resolve: {
    alias: [{ find: '@', replacement: path.resolve(__dirname, 'src') }],
    dedupe: ['vue', 'yjs', '@tiptap/pm'],
  },
  ssr: { noExternal: true, target: 'node' },
  build: {
    ssr: path.resolve(__dirname, 'src/apps/slides/collab/checker-entry.ts'),
    outDir: '../suite/slides/content/dist',
    // Later builds write only their own file, so none clears another's
    emptyOutDir: false,
    minify: false,
    sourcemap: false,
    rollupOptions: { output: { format: 'cjs', entryFileNames: 'checker.cjs' } },
  },
})
