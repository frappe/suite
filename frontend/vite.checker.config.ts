import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import vue from '@vitejs/plugin-vue'
import { defineConfig, type Plugin, type UserConfig } from 'vite'

// Writer's Node builds, each one file with the browsers' Yjs, y-tiptap and the editor schema: the
// checker, which the server runs on demand to judge rows (suite/content/checker.py), and with
// `--mode converter` the converter, which turns an old document into a collaborative one
const requireFromFrontend = createRequire(path.resolve(__dirname, 'package.json'))
const yjsVersion = requireFromFrontend('yjs/package.json').version
const converterVersion = JSON.parse(
  fs.readFileSync(
    path.resolve(__dirname, '../suite/writer/content/converter-version.json'),
    'utf8',
  ),
).version

// jsdom draws no canvas without the optional native package
const noCanvas: Plugin = {
  name: 'no-canvas',
  resolveId: (id) => (id === 'canvas' ? '\0no-canvas' : null),
  load: (id) => (id === '\0no-canvas' ? 'module.exports = null' : null),
}

const jsdomRoot = path.dirname(requireFromFrontend.resolve('jsdom/package.json'))
const jsdomFiles = [
  {
    // The --permission sandbox allows reading only the bundle, so the default stylesheet goes inside it
    file: 'lib/jsdom/living/css/helpers/computed-style.js',
    edits: [
      [
        'fs.readFileSync(\n  path.resolve(__dirname, "../../../browser/default-stylesheet.css"),\n  { encoding: "utf-8" }\n)',
        JSON.stringify(
          fs.readFileSync(path.join(jsdomRoot, 'lib/jsdom/browser/default-stylesheet.css'), 'utf8'),
        ),
      ],
    ],
  },
  {
    // The --permission sandbox allows reading only the bundle, so the sync XHR worker file can't load
    file: 'lib/jsdom/living/xhr/XMLHttpRequest-impl.js',
    edits: [
      ['require.resolve("./xhr-sync-worker.js")', 'null'],
      [
        'syncWorker = new Worker(syncWorkerFile);',
        'throw new Error("the converter has no synchronous XMLHttpRequest");',
      ],
    ],
  },
]
const editedFiles = new Set<string>()

// The --permission sandbox allows reading only the bundle, so a package whose ESM build reads files
// as it loads comes from its own published CJS build, whose requires the bundler inlines
const publishedBuilds = [
  {
    name: 'css-tree',
    build: requireFromFrontend.resolve('css-tree'),
    unbundled: path.join(path.dirname(requireFromFrontend.resolve('css-tree/package.json')), 'lib'),
  },
]

// Fails the build when an edit's text is gone or an ESM build comes back, so an upgrade can't skip one
const jsdomInBundle: Plugin = {
  name: 'jsdom-in-bundle',
  transform(code, id) {
    const unbundled = publishedBuilds.find((build) => id.startsWith(build.unbundled + path.sep))
    if (unbundled) {
      this.error(`${unbundled.name} is bundled from ${unbundled.unbundled}, not its CJS build`)
    }

    const target = jsdomFiles.find(({ file }) => id === path.join(jsdomRoot, file))
    if (!target) {
      return null
    }

    let edited = code
    for (const [from, to] of target.edits) {
      if (!edited.includes(from)) {
        const quoted = JSON.stringify(from)
        this.error(`jsdom's ${target.file} no longer holds ${quoted}`)
      }

      edited = edited.replace(from, to)
    }

    editedFiles.add(target.file)
    return { code: edited, map: null }
  },
  buildEnd() {
    const missed = jsdomFiles.filter(({ file }) => !editedFiles.has(file))
    if (missed.length) {
      const files = missed.map(({ file }) => file).join(', ')
      this.error(`jsdom files not bundled: ${files}`)
    }
  },
}

const publishedAliases = publishedBuilds.map(({ name, build }) => {
  const find = new RegExp(`^${name}$`)
  return { find, replacement: build }
})
const builds = {
  checker: { plugins: [vue()], aliases: [] },
  converter: { plugins: [vue(), noCanvas, jsdomInBundle], aliases: publishedAliases },
}

const define = {
  __CHECKER_YJS__: JSON.stringify(yjsVersion),
  __CONVERTER_VERSION__: JSON.stringify(converterVersion),
}

function writerBuild(name: keyof typeof builds): UserConfig {
  const { plugins, aliases } = builds[name]
  const entry = path.resolve(__dirname, `src/apps/writer/collab/${name}-entry.ts`)
  const fileName = `${name}.cjs`
  return {
    root: __dirname,
    define,
    publicDir: false,
    configFile: false,
    plugins,
    resolve: {
      alias: [{ find: '@', replacement: path.resolve(__dirname, 'src') }, ...aliases],
      dedupe: ['vue', 'yjs', '@tiptap/pm'],
    },
    ssr: { noExternal: true, target: 'node' },
    build: {
      ssr: entry,
      outDir: '../suite/writer/content/dist',
      // Each build writes only its own file, so neither clears the other's
      emptyOutDir: false,
      minify: false,
      sourcemap: false,
      rollupOptions: { output: { format: 'cjs', entryFileNames: fileName } },
    },
  }
}

export default defineConfig(({ mode }) =>
  writerBuild(mode === 'converter' ? 'converter' : 'checker'),
)
