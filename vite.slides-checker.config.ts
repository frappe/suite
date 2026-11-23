import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { defineConfig, type Plugin, type UserConfig } from 'vite'

import { jsdomInBundle, noCanvas, publishedAliases } from './vite.checker.config'

// Slides' Node builds, each one file with the browsers' Yjs, y-tiptap and the editor schema: the
// checker, which the server runs on demand to judge rows (suite/content/checker.py), and with
// `--mode converter` the converter, which turns an old deck into a collaborative one
const frontend = path.resolve(__dirname, 'frontend')
const requireFromRoot = createRequire(path.resolve(__dirname, 'package.json'))
const yjsVersion = requireFromRoot('yjs/package.json').version

// The editor setup reaches this only for its one url helper, and it drags in frappe-ui and the stores
const noMediaUploads: Plugin = {
  name: 'no-media-uploads',
  enforce: 'pre',
  resolveId: (id) => (/\/mediaUploads$/.test(id) ? '\0no-media-uploads' : null),
  load: (id) => (id === '\0no-media-uploads' ? "export const getAttachmentUrl = () => ''" : null),
}

const converterVersion = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, 'suite/slides/content/converter-version.json'), 'utf8'),
).version
const builds = {
  checker: { plugins: [noMediaUploads], aliases: [] },
  converter: { plugins: [noMediaUploads, noCanvas, jsdomInBundle], aliases: publishedAliases },
}

const define = {
  __CHECKER_YJS__: JSON.stringify(yjsVersion),
  __CONVERTER_VERSION__: JSON.stringify(converterVersion),
}

function slidesBuild(name: keyof typeof builds): UserConfig {
  const { plugins, aliases } = builds[name]
  return {
    root: frontend,
    define,
    publicDir: false,
    configFile: false,
    plugins,
    resolve: {
      alias: [{ find: '@', replacement: path.resolve(frontend, 'src') }, ...aliases],
      dedupe: ['vue', 'yjs', '@tiptap/pm'],
    },
    ssr: { noExternal: true, target: 'node' },
    build: {
      ssr: path.resolve(frontend, `src/apps/slides/collab/${name}-entry.ts`),
      outDir: '../suite/slides/content/dist',
      // Later builds write only their own file, so none clears another's
      emptyOutDir: false,
      minify: false,
      sourcemap: false,
      rollupOptions: { output: { format: 'cjs', entryFileNames: `${name}.cjs` } },
    },
  }
}

export default defineConfig(({ mode }) =>
  slidesBuild(mode === 'converter' ? 'converter' : 'checker'),
)
