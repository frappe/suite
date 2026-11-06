import { Editor } from '@tiptap/core'
import { afterEach, describe, expect, it } from 'vitest'

import { writerSchema } from '@/apps/writer/schema'

import { BLOCK_STYLES, MARKS } from './formatting'
import { INSERTS } from './inserts'

let editor: Editor | null = null

afterEach(() => {
  editor?.destroy()
  editor = null
})

function activeIn(content: string) {
  editor?.destroy()
  editor = new Editor({ extensions: writerSchema(), content })
  editor.commands.setTextSelection(3)
  const target = editor
  return BLOCK_STYLES.filter((style) => style.isActive(target)).map((style) => style.value)
}

describe('block styles', () => {
  it('names each style with its label and icon, in menu order', () => {
    expect(BLOCK_STYLES.map(({ value, label, icon }) => [value, label, icon])).toEqual([
      ['paragraph', 'Text', 'lucide-pilcrow'],
      ['h1', 'Heading 1', 'lucide-heading-1'],
      ['h2', 'Heading 2', 'lucide-heading-2'],
      ['h3', 'Heading 3', 'lucide-heading-3'],
      ['h4', 'Heading 4', 'lucide-heading-4'],
      ['bulletList', 'Bulleted list', 'lucide-list'],
      ['orderedList', 'Numbered list', 'lucide-list-ordered'],
      ['taskList', 'To-do list', 'lucide-list-checks'],
      ['codeBlock', 'Code block', 'lucide-square-code'],
      ['blockquote', 'Quote', 'lucide-quote'],
    ])
  })

  it('reads as active in the block it names, and in the blocks around it', () => {
    expect(activeIn('<p>Plain</p>')).toEqual(['paragraph'])
    expect(activeIn('<h3>Title</h3>')).toEqual(['h3'])
    expect(activeIn('<ul><li><p>Item</p></li></ul>')).toEqual(['paragraph', 'bulletList'])
    expect(activeIn('<ol><li><p>Item</p></li></ol>')).toEqual(['paragraph', 'orderedList'])
    expect(
      activeIn('<ul data-type="taskList"><li data-type="taskItem"><p>Item</p></li></ul>'),
    ).toEqual(['paragraph', 'taskList'])
    expect(activeIn('<pre><code>code</code></pre>')).toEqual(['codeBlock'])
    expect(activeIn('<blockquote><p>Said</p></blockquote>')).toEqual(['paragraph', 'blockquote'])
  })

  it('turns a line into a quote, a code block and a to-do list', () => {
    const apply = (label: string) => {
      editor?.destroy()
      editor = new Editor({ extensions: writerSchema(), content: '<p>Line</p>' })
      editor.commands.setTextSelection(3)
      BLOCK_STYLES.find((style) => style.label === label)!
        .apply(editor.chain().focus())
        .run()
      return editor.getHTML()
    }
    expect(apply('Quote')).toMatch(/^<blockquote><p[^>]*>Line<\/p><\/blockquote>$/)
    expect(apply('Code block')).toMatch(/^<pre[^>]*><code[^>]*>Line<\/code><\/pre>$/)
    expect(apply('To-do list')).toMatch(/data-type="taskList"/)
  })
})

describe('marks', () => {
  it('lists the inline marks with their shortcuts, in order', () => {
    expect(MARKS.map(({ name, label, icon, shortcut }) => [name, label, icon, shortcut])).toEqual([
      ['bold', 'Bold', 'lucide-bold', 'Mod-b'],
      ['italic', 'Italic', 'lucide-italic', 'Mod-i'],
      ['underline', 'Underline', 'lucide-underline', 'Mod-u'],
      ['strike', 'Strikethrough', 'lucide-strikethrough', 'Mod-Shift-s'],
    ])
  })
})

/** An editor that records the chained commands it is asked to run. */
function recordingEditor(commands: string[]) {
  const calls: string[] = []
  const chain: Record<string, () => unknown> = new Proxy(
    {},
    {
      get: (_target, name: string) => () => {
        calls.push(name)
        return chain
      },
    },
  )
  const fake = {
    commands: Object.fromEntries(commands.map((name) => [name, () => true])),
    chain: () => chain,
    can: () => ({ insertFromDrive: () => true }),
    state: {},
  }
  return { editor: fake as unknown as Editor, calls }
}

const COMMANDS: Record<string, string> = {
  Image: 'selectAndUploadImage',
  Video: 'selectAndUploadVideo',
  Attachment: 'selectAndUploadFile',
  Embed: 'openIframeDialog',
  Divider: 'setHorizontalRule',
  'Page break': 'setPageBreak',
  Tab: 'createTab',
}

describe('inserts', () => {
  it('names each insert with its icon and menu section, in menu order', () => {
    expect(INSERTS.map(({ label, icon, group }) => [label, icon, group])).toEqual([
      ['Image', 'lucide-image', 'Media'],
      ['Video', 'lucide-video', 'Media'],
      ['Attachment', 'lucide-paperclip', 'Media'],
      ['From Drive', 'lucide-hard-drive', 'Media'],
      ['Embed', 'lucide-code-xml', 'Media'],
      ['Table', 'lucide-table', 'Blocks'],
      ['Code block', 'lucide-square-code', 'Blocks'],
      ['Quote', 'lucide-quote', 'Blocks'],
      ['Divider', 'lucide-minus', 'Blocks'],
      ['Page break', 'lucide-separator-horizontal', 'Blocks'],
      ['Tab', 'lucide-panel-top', 'Blocks'],
    ])
  })

  it('runs its command from the focused editor', () => {
    for (const [label, command] of Object.entries(COMMANDS)) {
      const { editor: target, calls } = recordingEditor([command])
      INSERTS.find((insert) => insert.label === label)!.insert(target)
      expect(calls, label).toEqual(['focus', command, 'run'])
    }
  })

  it('is offered only when the editor has its command, except the divider and page break', () => {
    const offered = (commands: string[]) => {
      const { editor: target } = recordingEditor(commands)
      return INSERTS.filter((insert) => insert.label in COMMANDS)
        .filter((insert) => insert.isAvailable(target))
        .map((insert) => insert.label)
    }
    expect(offered([])).toEqual(['Divider', 'Page break'])
    expect(offered(Object.values(COMMANDS))).toEqual(Object.keys(COMMANDS))
  })
})
