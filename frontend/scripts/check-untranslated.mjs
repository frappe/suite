// Finds user-facing text in Vue templates that does not go through `__()`.
// It runs one ESLint rule, `vue/no-bare-strings-in-template`, on its own so
// translation debt has its own shrinking baseline (`baselines/untranslated.json`,
// keyed by file) separate from lint errors. The rule reports template text and
// the listed attributes; strings built in `<script>` (toast titles, confirm
// messages) are out of its reach, so a reviewer still reads those.

import path from 'node:path'
import process from 'node:process'
import {
  defineConfigWithVueTs,
  vueTsConfigs,
} from '@vue/eslint-config-typescript'
import { ESLint } from 'eslint'
import pluginVue from 'eslint-plugin-vue'

import { compareBaseline, frontendRoot } from './baseline.mjs'

const RULE = 'vue/no-bare-strings-in-template'

// Attributes a user reads, on any element or component. frappe-ui takes
// `label`, `description`, `placeholder` and `tooltip` as props.
const ATTRIBUTES = {
  '/.+/': [
    'title',
    'aria-label',
    'aria-placeholder',
    'aria-roledescription',
    'aria-valuetext',
    'placeholder',
    'label',
    'description',
    'alt',
    'tooltip',
  ],
}

const eslint = new ESLint({
  cwd: frontendRoot,
  overrideConfigFile: true,
  // The Vue parser plus the TypeScript parser for `<script lang="ts">`, and
  // no rules but this one.
  overrideConfig: defineConfigWithVueTs(
    // Legacy Drive code is being deleted, not translated.
    { ignores: ['src/apps/drive/legacy/**'] },
    pluginVue.configs['flat/base'],
    vueTsConfigs.base,
    {
      files: ['**/*.vue'],
      rules: { [RULE]: ['error', { attributes: ATTRIBUTES }] },
    },
  ),
})

const results = await eslint.lintFiles(['src/**/*.vue'])
const findings = new Map()
for (const result of results) {
  const file = path
    .relative(frontendRoot, result.filePath)
    .replaceAll('\\', '/')
  for (const message of result.messages) {
    if (message.ruleId !== RULE) {
      if (message.fatal)
        throw new Error(`${file}:${message.line} ${message.message}`)
      continue
    }
    if (!findings.has(file)) findings.set(file, [])
    findings
      .get(file)
      .push(`${file}:${message.line}:${message.column} ${message.message}`)
  }
}

if (compareBaseline('untranslated text', findings, 'untranslated.json')) {
  process.exitCode = 1
}
