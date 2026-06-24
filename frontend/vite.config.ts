import fs from 'fs'
import path from 'path'

import vue from '@vitejs/plugin-vue'
import { noiseSuppressionAudioWorkletVitePlugin } from '@workadventure/noise-suppression/vite'
import frappeui from 'frappe-ui/vite'
import { defineConfig } from 'vite'

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
    noiseSuppressionAudioWorkletVitePlugin(),
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
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      'tailwind.config.js': path.resolve(__dirname, 'tailwind.config.js'),
    },
    // Keep single ProseMirror / Yjs / reka-ui / vue singletons across the 7
    // merged editors (drive/writer/sheets/mail collab) — see _resolved.json.
    dedupe: [
      'vue',
      'vue-router',
      'yjs',
      '@tiptap/pm',
      'prosemirror-state',
      'prosemirror-view',
      'reka-ui',
      '@vueuse/core',
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
      allow: ['..', 'node_modules', '../../..'],
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
