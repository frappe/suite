import fs from 'fs'
import path from 'path'

import vue from '@vitejs/plugin-vue'
import frappeui from 'frappe-ui/vite'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

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

const benchRoot = path.resolve(__dirname, '../../..')
const commonSiteConfig = JSON.parse(
  fs.readFileSync(path.join(benchRoot, 'sites/common_site_config.json'), 'utf-8'),
)
const defaultSite = commonSiteConfig.default_site || 'localhost'
const webserverPort = commonSiteConfig.webserver_port || 8000
const frappeBackendUrl = `http://${defaultSite}:${webserverPort}`

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
    frappeui({
      // frappe-ui/vite wires the dev proxy to the local bench, injects the
      // CSRF/boot data, and emits the Jinja-templated index html.
      frappeProxy: true,
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
    // MailLayout.registerServiceWorker() registers. Scoped to FCM only: precaching
    // is disabled (injectionPoint: undefined). Registration is manual
    // (injectRegister: null).
    // `manifest: false`: the webmanifest is NOT generated here. All seven apps
    // share one HTML shell, so a <link rel="manifest"> injected into <head> at
    // build time would make drive/calendar/... install as Frappe Mail too. It
    // lives at public/pwa/mail/ instead and is linked at runtime only
    // while the route is inside /mail (see router/index.ts setPwaTags).
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
    alias: {
      '@': path.resolve(__dirname, 'src'),
      'tailwind.config.js': path.resolve(__dirname, 'tailwind.config.js'),
    },
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
      'prosemirror-state',
      'prosemirror-view',
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
    allowedHosts: [defaultSite, 'suite.localhost'],
    fs: {
      // Allow the bench + frappe-ui source paths used by the dev proxy/build.
      allow: ['..', 'node_modules', '../../..', '../frappe-ui'],
    },
  },
  optimizeDeps: {
    include: [
      'frappe-ui > feather-icons',
      'frappe-ui > lowlight',
      'yjs',
      'tailwind.config.js',
    ],
    exclude: mode === 'production' ? [] : ['frappe-ui'],
  },
}))
