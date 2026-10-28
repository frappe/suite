import type { Editor } from '@tiptap/core'
import { SlashCommands, type CommandItem } from 'frappe-ui/editor'

import { BLOCK_STYLES, type BlockStyle } from '@/apps/writer/components/core-editor/formatting'
import { INSERTS, type Insert } from '@/apps/writer/components/core-editor/inserts'
import { translate as __ } from '@/platform/translation'

const LISTS = ['bulletList', 'orderedList', 'taskList']

/**
 * The slash menu, with the names and blocks the toolbar's style select and Insert menu use.
 * The stock menu's embed shortcuts for known sites (YouTube and others) follow Embed.
 */
export const WriterSlashCommands = SlashCommands.extend({
  addOptions() {
    const stock = this.parent?.()
    const stockItems = stock?.suggestion.items
    if (!stock || !stockItems) throw new Error('The stock slash menu has no items')
    return {
      ...stock,
      suggestion: {
        ...stock.suggestion,
        items: async (props: Parameters<typeof stockItems>[0]) => {
          const siteEmbeds = (await stockItems(props)).filter(
            (item) => item.group === 'Embeds' && item.title !== 'Embed',
          )
          return writerSlashItems(props.editor, siteEmbeds, props.query)
        },
      },
    }
  },
})

/** The slash menu's items for `query`, in menu order. */
export function writerSlashItems(
  editor: Editor,
  siteEmbeds: CommandItem[],
  query: string,
): CommandItem[] {
  const media = INSERTS.filter((insert) => insert.group === 'Media')
  const blocks = INSERTS.filter((insert) => insert.group === 'Blocks' && !isStyle(insert))
  const items = [
    ...BLOCK_STYLES.filter((style) => !LISTS.includes(style.value)).map(styleItem('Text')),
    ...BLOCK_STYLES.filter((style) => LISTS.includes(style.value)).map(styleItem('Lists')),
    ...media.filter((insert) => insert.isAvailable(editor)).map(insertItem),
    ...siteEmbeds.map((item) => ({ ...item, group: __('Media') })),
    linkItem(),
    ...blocks.filter((insert) => insert.isAvailable(editor)).map(insertItem),
  ]
  const needle = query.toLowerCase()
  return items.filter((item) => item.title.toLowerCase().includes(needle))
}

function isStyle(insert: Insert) {
  return BLOCK_STYLES.some((style) => style.label === insert.label)
}

function styleItem(group: string) {
  return (style: BlockStyle): CommandItem => ({
    title: __(style.label),
    icon: style.icon,
    group: __(group),
    command: ({ editor, range }) => style.apply(editor.chain().focus().deleteRange(range)).run(),
  })
}

function insertItem(insert: Insert): CommandItem {
  return {
    title: __(insert.label),
    icon: insert.icon,
    group: insert.group === 'Media' ? __('Media') : __('Insert'),
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).run()
      insert.insert(editor)
    },
  }
}

function linkItem(): CommandItem {
  return {
    title: __('Link'),
    icon: 'lucide-link',
    group: __('Insert'),
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).run()
      editor.commands.openLinkEditor()
    },
  }
}
