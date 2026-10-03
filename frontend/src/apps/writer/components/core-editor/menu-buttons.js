import { h, defineAsyncComponent } from 'vue'
import ManageFont from '@/apps/writer/components/ManageFont.vue'
import DropdownMenuGroup from '@/apps/writer/components/core-editor/DropdownMenuGroup.vue'
import {
  Bold,
  Italic,
  Strike,
  InsertLink,
  FontColor,
  AlignLeft,
  AlignCenter,
  AlignRight,
  BulletList,
  OrderedList,
  Blockquote,
  InlineCode,
  InsertImage,
  InsertVideo,
  InsertIframe,
  InsertTable,
  Paragraph,
  H1,
  H2,
  H3,
  H4,
  Separator,
} from 'frappe-ui/editor'

import LucidePaintRoller from '~icons/lucide/paint-roller'
import LucideBrushCleaning from '~icons/lucide/brush-cleaning'
import LucideSettings from '~icons/lucide/settings'
import LucideSeparatorHorizontal from '~icons/lucide/separator-horizontal'
import LucideAlignVerticalSpacingAround from '~icons/lucide/align-vertical-space-around'
import LucideHeading from '~icons/lucide/heading'
import LucideAlignLeft from '~icons/lucide/align-left'

// frappe-ui's editor commands carry Title Case labels; Writer uses sentence case.
const relabel = (item, label) => ({ ...item, label })
const FontColorItem = relabel(FontColor, 'Font color')
export const BulletListItem = relabel(BulletList, 'Bullet list')
export const OrderedListItem = relabel(OrderedList, 'Numbered list')
const InsertImageItem = relabel(InsertImage, 'Image')

const SpacingDialogAsync = defineAsyncComponent(() =>
  import('@/apps/writer/components/SpacingDialog.vue'),
)

const Underline = {
  label: 'Underline',
  icon: 'lucide-underline',
  action: (e) => e.chain().focus().toggleUnderline().run(),
  isActive: (e) => e.isActive('underline'),
  isAvailable: (e) => !!e.can().toggleUnderline?.(),
}

const TaskListItem = {
  label: 'Task list',
  icon: 'lucide-list-checks',
  action: (e) => e.chain().focus().toggleTaskList().run(),
  isActive: (e) => e.isActive('taskList'),
}

const TableOfContentsItem = {
  label: 'Table of contents',
  icon: 'lucide-table-of-contents',
  action: (e) => { e.commands.insertTableOfContentsNode(); return true },
  isAvailable: (e) => typeof e.commands.insertTableOfContentsNode === 'function',
}

const DedentList = {
  label: 'Dedent',
  icon: 'lucide-indent-decrease',
  action: (e) => e.chain().focus().liftListItem('listItem').run(),
  isAvailable: (e) => e.can().liftListItem('listItem'),
}

const IndentList = {
  label: 'Indent',
  icon: 'lucide-indent-increase',
  action: (e) => e.chain().focus().sinkListItem('listItem').run(),
  isAvailable: (e) => e.can().sinkListItem('listItem'),
}

// Dropdown group items
const headingItems = [Paragraph, H1, H2, H3, H4]
const alignItems = [
  relabel(AlignLeft, 'Align left'),
  relabel(AlignCenter, 'Align center'),
  relabel(AlignRight, 'Align right'),
]

export function buildMenuButtons({ editor, settings, isPainting, openSettings }) {
  return [
    // Heading type selector — dropdown group
    {
      label: 'Heading',
      icon: LucideHeading,
      component: h(DropdownMenuGroup, {
        items: headingItems,
        defaultIcon: LucideHeading,
        defaultLabel: 'Heading',
      }),
      action: () => {},
    },
    Separator,
    Bold,
    Italic,
    Underline,
    Strike,
    InsertLink,
    FontColorItem,
    // Alignment — dropdown group
    {
      label: 'Align',
      icon: LucideAlignLeft,
      component: h(DropdownMenuGroup, {
        items: alignItems,
        defaultIcon: LucideAlignLeft,
        defaultLabel: 'Align',
      }),
      action: () => {},
    },
    {
      label: 'Paint styles',
      icon: LucidePaintRoller,
      isActive: () => isPainting.value,
      // One chain, so the transaction it ends with shows the armed painter.
      action: (e) => e.chain().focus().storeStyles().run(),
    },
    {
      label: 'Clear formatting',
      icon: LucideBrushCleaning,
      isActive: () => false,
      action: (e) => {
        e.commands.focus()
        e.commands.clearStyles()
        e.commands.cleanStyles()
      },
    },
    Separator,
    {
      label: 'Font options',
      component: h(ManageFont, {
        editor,
        font_size: +settings.font_size || 15,
        font_family: settings.font_family || 'inter',
      }),
      action: () => {},
    },
    Separator,
    BulletListItem,
    OrderedListItem,
    TaskListItem,
    Blockquote,
    InlineCode,
    Separator,
    InsertImageItem,
    InsertVideo,
    InsertIframe,
    Separator,
    InsertTable,
    TableOfContentsItem,
    Separator,
    {
      label: 'Page break',
      icon: LucideSeparatorHorizontal,
      action: (e) => e.commands.setPageBreak(),
    },
    {
      label: 'Custom spacing',
      icon: LucideAlignVerticalSpacingAround,
      component: h(SpacingDialogAsync, {
        settings,
        editor,
        icon: LucideAlignVerticalSpacingAround,
      }),
      action: () => {},
    },
    {
      icon: LucideSettings,
      label: 'Settings',
      action: openSettings,
    },
    Separator,
    DedentList,
    IndentList,
  ]
}
