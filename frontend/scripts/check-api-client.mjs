import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

// These are protocols with owner-selected transport, not ordinary API alternatives.
// Owners and removal gates are recorded in wayfinder/suite-api-client/implementation.md.
const protocols = new Set([
  'boot/start.ts',
  'platform/session/index.ts',
  'platform/translation/index.ts',
  'platform/pwa/frappe-push-notification.ts',
  'apps/drive/client/links.ts',
  'apps/drive/client/uploads.ts',
  'apps/drive/client/session.ts',
  'apps/drive/files/features/preview/textContent.ts',
  'apps/writer/surface/exports.ts',
  'apps/writer/utils/docxexporter.js',
  'apps/slides/service-worker.js',
  'apps/slides/stores/offlineCopy.js',
  'apps/slides/stores/element.js',
])
const resources = new Set([
  'createResource',
  'createDocumentResource',
  'createListResource',
  'frappeRequest',
  'call',
  'useCall',
  'useDoc',
])
const builders = new Set(['query', 'mutation', 'infinite', 'upload', 'driveOperation'])

export function checkApiClient(sourceRoot) {
  const failures = []
  for (const file of files(sourceRoot)) {
    const relative = path.relative(sourceRoot, file).split(path.sep).join('/')
    if (
      /\.(test|spec)\.[jt]s$/.test(relative) ||
      relative.includes('/__fixtures__/') ||
      relative.endsWith('/testClient.ts')
    )
      continue
    const content = fs.readFileSync(file, 'utf8')
    const scripts = file.endsWith('.vue')
      ? [...content.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map((match) => match[1])
      : [content]
    for (const script of scripts) {
      const source = ts.createSourceFile(
        file,
        script,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS,
      )
      const internal =
        relative.startsWith('platform/server-state/') || relative.startsWith('platform/transport/')
      const report = (node) =>
        failures.push(
          `${relative}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`,
        )
      function visit(node) {
        if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
          const from = node.moduleSpecifier.text
          const clause = node.importClause
          if (
            clause &&
            !clause.isTypeOnly &&
            clause.namedBindings &&
            ts.isNamedImports(clause.namedBindings)
          ) {
            for (const item of clause.namedBindings.elements) {
              if (item.isTypeOnly) continue
              const name = (item.propertyName ?? item.name).text
              if (
                (from === 'frappe-ui' && resources.has(name)) ||
                (from.includes('server-state') && builders.has(name))
              )
                report(item)
              if (
                from === '@/platform/transport' &&
                ['transport', 'createTransport'].includes(name) &&
                !internal &&
                !protocols.has(relative)
              )
                report(item)
            }
          }
        }
        if (ts.isCallExpression(node) && !internal && !protocols.has(relative)) {
          const call = node.expression.getText(source)
          if (
            ['fetch', 'globalThis.fetch', 'window.fetch', 'frappe.call', 'frappe.request'].includes(
              call,
            )
          )
            report(node)
        }
        ts.forEachChild(node, visit)
      }
      visit(source)
    }
  }
  if (failures.length) throw new Error(`Ordinary calls must use @/api:\n${failures.join('\n')}`)
  console.log(
    'API client boundary passed (no ordinary resource factories, descriptor builders, or direct transport).',
  )
}
function* files(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name)
    if (entry.isDirectory()) yield* files(file)
    else if (/\.(vue|[cm]?[jt]sx?)$/.test(entry.name)) yield file
  }
}
