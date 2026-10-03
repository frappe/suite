// ESLint for the unified frontend. Formatting is Prettier's job
// (`.prettierrc`), so `eslint-config-prettier` turns every layout rule off and
// this file keeps only correctness and Vue rules.
//
// `vue/no-bare-strings-in-template` is not enabled here. `scripts/check-untranslated.mjs`
// runs that one rule on its own against a baseline, so untranslated text is
// tracked as a shrinking count rather than failing every legacy file at once.

import {
  defineConfigWithVueTs,
  vueTsConfigs,
} from '@vue/eslint-config-typescript'
import prettier from 'eslint-config-prettier'
import pluginVue from 'eslint-plugin-vue'
import globals from 'globals'

export default defineConfigWithVueTs(
  {
    ignores: [
      'dist/**',
      'dist-recorder/**',
      'node_modules/**',
      'auto-imports.d.ts',
      'components.d.ts',
      // Generated from contract.json by `yarn generate:contract`.
      'src/**/generated.ts',
      // Legacy Drive code is being deleted, not brought in line.
      'src/apps/drive/legacy/**',
    ],
  },
  {
    files: ['**/*.{js,mjs,cjs,ts,mts,tsx,vue}'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
  },
  pluginVue.configs['flat/recommended'],
  vueTsConfigs.recommended,
  {
    rules: {
      // Route pages and feature components are named by folder (`pages/FilesPage.vue`
      // is fine, but so is `shell/Rail.vue`).
      'vue/multi-word-component-names': 'off',
      // `_name` marks an argument the signature needs but the body does not.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },
  prettier,
)
