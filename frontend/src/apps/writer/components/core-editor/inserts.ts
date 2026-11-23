import type { Editor } from '@tiptap/core'
import { isInTable } from '@tiptap/pm/tables'

import { BLOCK_STYLES } from './formatting'
import { openTableSizePicker } from './table/tableSizePicker'

export interface Insert {
  /** English; translate it where it renders */
  label: string
  icon: string
  /** English menu section */
  group: 'Media' | 'Blocks'
  isAvailable: (editor: Editor) => boolean
  /** Inserts at the selection; media entries open a picker first */
  insert: (editor: Editor) => void
}

type InsertCommand =
  | 'selectAndUploadImage'
  | 'selectAndUploadVideo'
  | 'selectAndUploadFile'
  | 'openIframeDialog'
  | 'setHorizontalRule'
  | 'setPageBreak'
  | 'createTab'

const has = (command: string) => (editor: Editor) => command in editor.commands
const always = () => true

/** An insert that runs one command. Without `isAvailable`, it is offered when the command exists. */
function command(
  label: string,
  icon: string,
  group: Insert['group'],
  name: InsertCommand,
  isAvailable = has(name),
): Insert {
  return {
    label,
    icon,
    group,
    isAvailable,
    insert: (editor) => editor.chain().focus()[name]().run(),
  }
}

function fromStyle(value: string): Insert {
  const style = BLOCK_STYLES.find((block) => block.value === value)
  if (!style) throw new Error(`Unknown block style: ${value}`)
  return {
    label: style.label,
    icon: style.icon,
    group: 'Blocks',
    isAvailable: always,
    insert: (editor) => style.apply(editor.chain().focus()).run(),
  }
}

/** What the Insert menu and the slash menu add to a document, with one name each, in menu order. */
export const INSERTS: readonly Insert[] = [
  command('Image', 'lucide-image', 'Media', 'selectAndUploadImage'),
  command('Video', 'lucide-video', 'Media', 'selectAndUploadVideo'),
  command('Attachment', 'lucide-paperclip', 'Media', 'selectAndUploadFile'),
  {
    label: 'From Drive',
    icon: 'lucide-hard-drive',
    group: 'Media',
    isAvailable: (editor) => has('insertFromDrive')(editor) && editor.can().insertFromDrive(),
    insert: (editor) => editor.chain().focus().insertFromDrive().run(),
  },
  command('Embed', 'lucide-code-xml', 'Media', 'openIframeDialog'),
  {
    label: 'Table',
    icon: 'lucide-table',
    group: 'Blocks',
    // A table does not nest in a cell
    isAvailable: (editor) => !isInTable(editor.state),
    insert: (editor) => openTableSizePicker(editor),
  },
  fromStyle('codeBlock'),
  fromStyle('blockquote'),
  command('Divider', 'lucide-minus', 'Blocks', 'setHorizontalRule', always),
  command('Page break', 'lucide-separator-horizontal', 'Blocks', 'setPageBreak', always),
  command('Tab', 'lucide-panel-top', 'Blocks', 'createTab'),
]
