import { AsyncLocalStorage } from 'async_hooks'
import fs from 'fs'
import path from 'path'

import vue from '@vitejs/plugin-vue'
import frappeui from 'frappe-ui/vite'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

import { devBootFlags } from './src/platform/boot/devFlips'

// Local frappe-ui work: when the submodule is checked out, public component
// imports resolve to its source instead of the pinned package, so edits show up
// without a publish/reinstall. Same wiring as the mail app.
//
// The find is anchored so ONLY the bare specifier is rewritten — `frappe-ui/vite`,
// `frappe-ui/tailwind` and `frappe-ui/style.css` must keep resolving through node
// (a bare-prefix alias would break the vite plugin and the Tailwind preset).
//
// Note this covers the Vite door only: tailwind.config.js loads the preset through
// node and globs `node_modules/frappe-ui/src`, so with the submodule ahead of the
// pin, components come from the checkout while tokens come from the package. Run
// `yarn dev:frappe-ui` to point node at the checkout too and keep them in step.
const frappeUIPath = path.resolve(__dirname, '../frappe-ui/src/index.ts')
const frappeUIExperimentalPath = path.resolve(__dirname, '../frappe-ui/experimental.ts')

const emitSlidesServiceWorker = () => ({
  name: 'slides-service-worker',
  apply: 'build' as const,
  writeBundle() {
    const swSource = path.resolve(__dirname, 'src/apps/slides/service-worker.js')
    const swOutput = path.resolve(__dirname, '../suite/www/service-worker.js')
    fs.mkdirSync(path.dirname(swOutput), { recursive: true })
    fs.copyFileSync(swSource, swOutput)
  },
})

/** Serve suite/public/noise-suppression at /noise-suppression in Vite dev (not via publicDir — that would re-emit 17MB into the SPA build). */
const serveNoiseSuppressionAssets = () => {
  const noiseDir = path.resolve(__dirname, '../suite/public/noise-suppression')
  return {
    name: 'serve-noise-suppression-assets',
    apply: 'serve' as const,
    configureServer(server: { middlewares: { use: (path: string, fn: (req: any, res: any, next: () => void) => void) => void } }) {
      server.middlewares.use('/noise-suppression', (req, res, next) => {
        const rel = (req.url || '/').split('?')[0].replace(/^\//, '') || 'audio-worklet-processor.js'
        const filePath = path.resolve(noiseDir, rel)
        // Directory containment (not string prefix): avoid
        // /noise-suppression/../noise-suppression-sibling/secret.js escapes.
        const relative = path.relative(noiseDir, filePath)
        if (
          relative.startsWith('..') ||
          path.isAbsolute(relative) ||
          !fs.existsSync(filePath)
        ) {
          next()
          return
        }
        res.statusCode = 200
        res.setHeader('Content-Type', 'text/javascript')
        res.setHeader('Cache-Control', 'no-cache')
        fs.createReadStream(filePath).pipe(res)
      })
    },
  }
}

/**
 * frappe-ui injects the server boot only into the production build, so under
 * Vite dev the flip flags are missing and the rail is empty. This sets the two
 * flip flags from the site config on every HTML request, so a `bench
 * set-config` applies on reload. It sets nothing else: the dev page must still
 * read as having no server boot.
 */
const serveDevBootFlags = () => {
  // The site is the request host, as in Frappe and the frappe-ui proxy.
  // transformIndexHtml gets no request, so a middleware carries the host to it.
  const requestHost = new AsyncLocalStorage<string>()
  const readConfig = (file: string) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf-8')) : {})
  // The bench is the nearest folder above with `sites` and `apps` (a worktree sits deeper than the app).
  let bench = __dirname
  while (!(fs.existsSync(path.join(bench, 'sites')) && fs.existsSync(path.join(bench, 'apps'))) && bench !== path.dirname(bench)) {
    bench = path.dirname(bench)
  }
  return {
    name: 'suite-dev-boot-flags',
    apply: 'serve' as const,
    configureServer(server: { middlewares: { use: (fn: (req: { headers: { host?: string } }, res: unknown, next: () => void) => void) => void } }) {
      server.middlewares.use((req, _res, next) => requestHost.run(req.headers.host?.split(':')[0] ?? '', next))
    },
    transformIndexHtml() {
      const site = requestHost.getStore()
      if (!site || site.includes('/') || site.startsWith('.')) return
      const flags = devBootFlags(
        readConfig(path.join(bench, 'sites/common_site_config.json')),
        readConfig(path.join(bench, 'sites', site, 'site_config.json')),
      )
      const script = Object.entries(flags).map(([flag, on]) => `window[${JSON.stringify(flag)}] = ${on};`).join(' ')
      return [{ tag: 'script', children: script, injectTo: 'head-prepend' as const }]
    },
  }
}

const benchRoot = path.resolve(__dirname, '../../..')
const commonSiteConfigPath = path.join(benchRoot, 'sites/common_site_config.json')
// Allow static tooling to load this config in a standalone checkout/worktree.
const commonSiteConfig = fs.existsSync(commonSiteConfigPath)
  ? JSON.parse(fs.readFileSync(commonSiteConfigPath, 'utf-8'))
  : {}
const defaultSite = commonSiteConfig.default_site || 'localhost'

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  define: {
    __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false',
    __SITE_NAME__: JSON.stringify(defaultSite),
    __SOCKETIO_PORT__: JSON.stringify(commonSiteConfig.socketio_port || 9000),
  },
  // Served by Frappe at /assets/suite/frontend/ (build output lands in
  // ../suite/public/frontend -> exposed as /assets/suite/frontend).
  base: mode === 'production' ? '/assets/suite/frontend/' : '/',
  plugins: [
    // Noise-suppression worklet lives under suite/public/noise-suppression
    // (see scripts/copy-noise-suppression-assets.mjs + src/shims/...).
    // Do not reintroduce @workadventure/noise-suppression/vite — that path
    // re-pulls the processor into the Rollup graph via import.meta.url.
    serveNoiseSuppressionAssets(),
    serveDevBootFlags(),
    frappeui({
      // frappe-ui/vite wires the dev proxy to the local bench, injects the
      // CSRF/boot data, and emits the Jinja-templated index html.
      // `/files` is Frappe's public upload path. `/f/<blob>/...` is Frappe's
      // signed blob URL, where the content API redirects. `/l/<token>` and its
      // old address `/drive/l/<token>` are server pages, not SPA routes (ticket 011).
      frappeProxy: { source: '^/(desk|app|login|api|assets|files|private|f/|(drive/)?l/)' },
      lucideIcons: true,
      jinjaBootData: true,
      buildConfig: {
        outDir: '../suite/public/frontend',
        baseUrl: '/assets/suite/frontend/',
        indexHtmlPath: '../suite/www/suite.html',
        emptyOutDir: true,
        sourcemap: true,
      },
    }),
    vue(),
    emitSlidesServiceWorker(),
    // Bundles mail's Firebase Cloud Messaging service worker (src/apps/mail/sw.ts)
    // into sw.js at the build root -> served at /assets/suite/frontend/sw.js, which
    // the platform (src/platform/pwa) registers. Scoped to FCM only: precaching
    // is disabled (injectionPoint: undefined). Registration is manual
    // (injectRegister: null).
    // `manifest: false`: the webmanifest is NOT generated here. It lives at
    // public/pwa/suite/ and the platform links it on every route at runtime
    // (see src/platform/pwa setPwaTags).
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src/apps/mail',
      filename: 'sw.ts',
      injectRegister: null,
      injectManifest: {
        injectionPoint: undefined,
      },
      manifest: false,
      devOptions: {
        // Serves the dev SW stub so installability is testable locally. The FCM
        // SW itself stays build-only: registration targets the
        // production-absolute path, which the dev server never has.
        enabled: true,
        type: 'module',
      },
    }),
  ],
  resolve: {
    alias: [
      { find: '@', replacement: path.resolve(__dirname, 'src') },
      {
        find: 'tailwind.config.js',
        replacement: path.resolve(__dirname, 'tailwind.config.js'),
      },
      ...(fs.existsSync(frappeUIPath)
        ? [
            { find: /^frappe-ui$/, replacement: frappeUIPath },
            { find: /^frappe-ui\/experimental$/, replacement: frappeUIExperimentalPath },
          ]
        : []),
    ],
    // Keep single ProseMirror / Yjs / reka-ui / vue singletons across the 7
    // merged editors (drive/writer/sheets/mail collab) — see _resolved.json.
    // @vueuse/core must NOT be deduped: frappe-ui needs v10 while reka-ui
    // ships with its own nested v14, and collapsing them onto one copy breaks
    // reka-ui (e.g. TabsIndicator's useResizeObserver call under vueuse 10).
    dedupe: [
      'vue',
      'vue-router',
      'yjs',
      '@tiptap/pm',
      // The frappe-ui submodule's editor imports @tiptap/pm/* subpaths directly;
      // without deduping each one, its copy of prosemirror-tables registers the
      // 'cell' selection JSON ID a second time and the app dies at boot with
      // "Duplicate use of selection JSON ID cell".
      '@tiptap/pm/model',
      '@tiptap/pm/state',
      '@tiptap/pm/tables',
      '@tiptap/pm/view',
      'prosemirror-state',
      'prosemirror-view',
      'prosemirror-model',
      'prosemirror-tables',
      'reka-ui',
    ],
  },
  build: {
    // outDir/baseUrl/indexHtmlPath are owned by frappeui buildConfig above.
    sourcemap: true,
    target: 'esnext',
    commonjsOptions: {
      include: [/tailwind.config.js/, /node_modules/],
    },
  },
  server: {
    port: 8085,
    allowedHosts: [defaultSite, 'suite.localhost', ...(process.env.VITE_ALLOWED_HOSTS || '').split(',').map((host) => host.trim()).filter(Boolean)],
    fs: {
      // Allow the bench + frappe-ui source paths used by the dev proxy/build.
      allow: ['..', 'node_modules', '../../..', '../frappe-ui'],
    },
  },
  optimizeDeps: {
    include: [
      'debug',
      // Imported from @iframe-resizer/vue's raw .vue source, which is never pre-bundled, so
      // left alone Vite resolves it through its `browser` field to a UMD build that has no
      // default export, and the page fails to load.
      '@iframe-resizer/core',
      // Legacy frappe-ui FeatherIcon imports the CommonJS package as a default;
      // pre-bundle it so Vite provides the interop instead of serving raw CJS as ESM.
      'feather-icons',
      'frappe-ui > lowlight',
      'yjs',
      'tailwind.config.js',
      // Pre-bundle these so the aliased frappe-ui source and the app share ONE
      // instance. Vite serves bare imports from a linked/aliased dep raw, while
      // node_modules importers get the optimized chunk — two copies otherwise.
      '@tiptap/pm/model',
      '@tiptap/pm/state',
      '@tiptap/pm/tables',
      '@tiptap/pm/view',
    ],
    exclude: mode === 'production' ? [] : ['frappe-ui'],
  },
}))
