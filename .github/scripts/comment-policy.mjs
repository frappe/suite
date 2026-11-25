import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { extname } from 'node:path'
import { parse as parseJavaScript } from '@babel/parser'
import { parse as parseHtml } from 'parse5'
import { Input } from 'postcss'
import tokenizeCss from 'postcss/lib/tokenize'
import { parse as parseVue } from 'vue/compiler-sfc'

const scriptExtensions = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts'])
const supported = (path) => scriptExtensions.has(extname(path)) || /\.(py|vue|html|css)$/.test(path)

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
}

function pythonComments(files) {
  if (!files.length) return {}
  return JSON.parse(
    execFileSync(
      'python3',
      [
        '-c',
        `
import io
import json
import sys
import tokenize

result = {}
for path, source in json.load(sys.stdin):
    lines = io.StringIO(source).readlines()
    try:
        result[path] = [
            [token.start[0], token.start[0], token.string,
             not lines[token.start[0] - 1][:token.start[1]].strip()]
            for token in tokenize.generate_tokens(iter(lines).__next__)
            if token.type == tokenize.COMMENT
        ]
    except (tokenize.TokenError, IndentationError) as error:
        raise SystemExit(f"{path}: {error}")
json.dump(result, sys.stdout)
`,
      ],
      {
        input: JSON.stringify(files),
        encoding: 'utf8',
        maxBuffer: 32 * 1024 * 1024,
      },
    ),
  )
}

function scan(path, source) {
  const comments = []
  const lineStarts = [0, ...Array.from(source.matchAll(/\n/g), ({ index }) => index + 1)]
  const lineAt = (offset) => {
    let low = 0
    let high = lineStarts.length
    while (low + 1 < high) {
      const middle = (low + high) >>> 1
      if (lineStarts[middle] <= offset) low = middle
      else high = middle
    }
    return low + 1
  }
  const add = (start, end) => {
    const first = lineAt(start)
    const last = lineAt(end - 1)
    const standalone =
      !source.slice(lineStarts[first - 1], start).trim() &&
      !source.slice(end, lineStarts[last] ?? source.length).trim()
    comments.push([first, last, source.slice(start, end), standalone])
  }
  const script = (content, offset, language) => {
    const plugins = ['decorators-legacy']
    if (/^(ts|tsx|mts|cts)$/.test(language)) plugins.push('typescript')
    if (/^(jsx|tsx)$/.test(language)) plugins.push('jsx')
    const parsed = parseJavaScript(content, {
      sourceType: 'unambiguous',
      plugins,
      allowUndeclaredExports: true,
      errorRecovery: true,
    })
    for (const comment of parsed.comments) add(offset + comment.start, offset + comment.end)
  }
  const style = (content, offset) => {
    const tokenizer = tokenizeCss(new Input(content))
    while (!tokenizer.endOfFile()) {
      const [type, , start, end] = tokenizer.nextToken()
      if (type === 'comment') add(offset + start, offset + end + 1)
    }
  }
  const html = (node, markup) => {
    const location = node.sourceCodeLocation
    if (node.nodeName === '#comment') add(location.startOffset, location.endOffset)
    if (location?.endTag && (node.tagName === 'script' || node.tagName === 'style')) {
      const start = location.startTag.endOffset
      const content = markup.slice(start, location.endTag.startOffset)
      const type = node.attrs.find(({ name }) => name === 'type')?.value
      if (node.tagName === 'style' && (!type || type === 'text/css')) style(content, start)
      if (
        node.tagName === 'script' &&
        (!type || /^(module|(?:text|application)\/(?:java|ecma)script)$/.test(type))
      ) {
        script(content, start, 'js')
      }
    }
    for (const child of node.childNodes ?? []) html(child, markup)
    if (node.content) html(node.content, markup)
  }
  const extension = extname(path)
  if (extension === '.vue') {
    const { descriptor } = parseVue(source, { filename: path })
    for (const block of [descriptor.script, descriptor.scriptSetup]) {
      if (block) script(block.content, block.loc.start.offset, block.lang ?? 'js')
    }
    for (const block of descriptor.styles) {
      style(block.content, block.loc.start.offset)
    }
    const template = (node) => {
      if (node.type === 3) add(node.loc.start.offset, node.loc.end.offset)
      for (const child of node.children ?? []) {
        if (typeof child === 'object') template(child)
      }
    }
    if (descriptor.template?.ast) template(descriptor.template.ast)
    const blocks = [
      descriptor.template,
      descriptor.script,
      descriptor.scriptSetup,
      ...descriptor.styles,
      ...descriptor.customBlocks,
    ].filter(Boolean)
    const topLevel = parseHtml(source, { sourceCodeLocationInfo: true })
    const visit = (node) => {
      if (node.nodeName === '#comment') {
        const { startOffset, endOffset } = node.sourceCodeLocation
        if (
          !blocks.some(({ loc }) => startOffset >= loc.start.offset && endOffset <= loc.end.offset)
        ) {
          add(startOffset, endOffset)
        }
      }
      for (const child of node.childNodes ?? []) visit(child)
    }
    visit(topLevel)
  } else if (extension === '.html') {
    const markup = path.startsWith('suite/')
      ? source.replace(/{#[\s\S]*?#}|{%[\s\S]*?%}|{{[\s\S]*?}}/g, (tag, start) => {
          if (tag.startsWith('{#')) add(start, start + tag.length)
          const blank = tag.replace(/[^\r\n]/g, ' ')
          return tag.startsWith('{{') ? '0' + blank.slice(1) : blank
        })
      : source
    html(parseHtml(markup, { sourceCodeLocationInfo: true }), markup)
  } else if (extension === '.css') style(source, 0)
  else script(source, 0, extension.slice(1))
  return comments.sort((a, b) => a[0] - b[0])
}

function inventory(files) {
  const python = pythonComments(files.filter(([path]) => path.endsWith('.py')))
  return files.map(([path, source]) => {
    try {
      return [path, python[path] ?? scan(path, source)]
    } catch (error) {
      throw new Error(`${path}: ${error.message}`, { cause: error })
    }
  })
}

function requiredComment(path, start, text) {
  return (
    (path.endsWith('.py') && start === 1 && text.startsWith('#!')) ||
    (/\.(?:[cm]?ts|tsx|vue)$/.test(path) && /^(?:\/\/|\/\*)[ \t]*SAFETY:[ \t]*\S/.test(text))
  )
}

const [mode, base = 'HEAD'] = process.argv.slice(2)
if (mode !== 'inventory' && mode !== 'check') {
  console.error('Usage: node .github/scripts/comment-policy.mjs inventory | check [base-ref]')
  process.exit(2)
}

const paths = [...new Set(git('ls-files', '-z', '--cached').split('\0'))].filter(supported)
const baseline = mode === 'check' ? git('merge-base', base, 'HEAD').trim() : undefined
const changed =
  baseline && new Set(git('diff', '--no-renames', '--name-only', '-z', baseline).split('\0'))
const currentFiles = paths
  .filter((path) => !changed || changed.has(path))
  .flatMap((path) => {
    try {
      return [[path, readFileSync(path, 'utf8')]]
    } catch (error) {
      if (error.code === 'ENOENT') return []
      throw error
    }
  })

const current = inventory(currentFiles)
if (mode === 'inventory') {
  for (const [path, comments] of current) {
    for (const [start, end, text, standalone] of comments) {
      console.log(JSON.stringify({ path, start, end, text, standalone }))
    }
  }
} else {
  const previousPaths = new Set(git('ls-tree', '-r', '--name-only', '-z', baseline).split('\0'))
  const previous = new Map(
    inventory(
      currentFiles
        .filter(([path]) => previousPaths.has(path))
        .map(([path]) => [path, git('show', `${baseline}:${path}`)]),
    ),
  )
  for (const [path, comments] of current) {
    const existing = new Map()
    for (const [, , text] of previous.get(path) ?? []) {
      existing.set(text, (existing.get(text) ?? 0) + 1)
    }
    for (const [start, , text] of comments) {
      if (requiredComment(path, start, text)) continue
      const count = existing.get(text) ?? 0
      if (count) existing.set(text, count - 1)
      else {
        console.error(`${path}:${start}: new code comment`)
        process.exitCode = 1
      }
    }
  }
}
