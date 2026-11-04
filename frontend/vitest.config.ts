import path from 'node:path'
import vue from '@vitejs/plugin-vue'
import { lucideIconsPlugin } from 'frappe-ui/vite/lucideIconsPlugin'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [vue(), lucideIconsPlugin()],
  resolve: {
    alias: [
      { find: '@', replacement: path.resolve(__dirname, 'src') },
      {
        find: 'frappe-ui/experimental',
        replacement: path.resolve(__dirname, 'src/test/frappe-ui-experimental-stub.ts'),
      },
      // Keep the test adapter scoped to the root; package subpaths such as
      // frappe-ui/editor and frappe-ui/style.css must use the real dependency.
      { find: /^frappe-ui$/, replacement: path.resolve(__dirname, 'recorder/frappeUi.ts') },
    ],
  },
  test: {
    environment: 'jsdom',
    passWithNoTests: true,
    setupFiles: ['src/test/setup.ts'],
    // The binding is linked in from frontend/packages, so Vite loads it; its
    // importers must load through Vite too or they get a second copy
    server: { deps: { inline: [/@tiptap\/extension-collaboration/] } },
    retry: process.env.CI ? 2 : 0,
    silent: true,
    projects: [
      {
        extends: true,
        test: {
          name: 'unified',
          include: [
            'src/{api,shell,platform,composition}/**/*.test.{js,ts}',
            'src/apps/drive/{files,client}/**/*.test.{js,ts}',
            'src/apps/{writer,sheets,slides}/surface/**/*.test.{js,ts}',
            'packages/collab-client/src/**/*.test.ts',
          ],
        },
      },
      {
        extends: true,
        test: {
          name: 'legacy',
          include: ['src/**/*.test.{js,ts}', 'recorder/**/*.test.{js,ts}'],
          exclude: [
            'src/{api,shell,platform,composition}/**/*.test.{js,ts}',
            'src/apps/drive/{files,client}/**/*.test.{js,ts}',
            'src/apps/{writer,sheets,slides}/surface/**/*.test.{js,ts}',
          ],
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reportOnFailure: true,
      include: ['src/**/*.{js,ts,vue}', 'recorder/**/*.{ts,vue}'],
      exclude: [
        '**/*.test.{js,ts}',
        '**/test-utils.{js,ts}',
        '**/*.d.ts',
        '**/__fixtures__/**',
        'recorder/frappeUi.ts',
        'src/apps/sheets/core/ironcalc-gate/**',
        'src/test/**',
      ],
      reporter: ['text', 'json-summary', 'lcov', 'cobertura'],
      reportsDirectory: 'test-results/coverage',
    },
  },
})
