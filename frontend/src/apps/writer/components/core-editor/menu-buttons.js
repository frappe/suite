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
import LucideForm from '~icons/lucide/sticky-note'
import LucideAlignVerticalSpacingAround from '~icons/lucide/align-vertical-space-around'
import LucideHeading from '~icons/lucide/heading'
import LucideAlignLeft from '~icons/lucide/align-left'

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
  label: 'Task List',
  icon: 'lucide-list-checks',
  action: (e) => e.chain().focus().toggleTaskList().run(),
  isActive: (e) => e.isActive('taskList'),
}

const TableOfContentsItem = {
  label: 'Table of Contents',
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
const alignItems = [AlignLeft, AlignCenter, AlignRight]

// Clusters follow the reference toolbar: type & font, then character format,
// then block format, then lists & flow, then inserts, then document tools.
export function buildMenuButtons({ editor, settings, isPainting, openSettings }) {
  return [
    // Block type selector — named in the trigger, like the reference's "Text".
    {
      label: 'Heading',
      icon: LucideHeading,
      component: h(DropdownMenuGroup, {
        items: headingItems,
        defaultIcon: LucideHeading,
        defaultLabel: 'Paragraph',
        showLabel: true,
      }),
      action: () => {},
    },
    {
      label: 'FontOptions',
      component: h(ManageFont, {
        editor,
        font_size: +settings.font_size || 15,
        font_family: settings.font_family || 'inter',
      }),
      action: () => {},
    },
    Bold,
    Italic,
    Underline,
    Strike,
    FontColor,
    Separator,
    InlineCode,
    Blockquote,
    {
      label: 'Page Break',
      icon: LucideForm,
      action: (e) => e.commands.setPageBreak(),
    },
    Separator,
    BulletList,
    OrderedList,
    TaskListItem,
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
      label: 'Custom Spacing',
      icon: LucideAlignVerticalSpacingAround,
      component: h(SpacingDialogAsync, {
        settings,
        editor,
        icon: LucideAlignVerticalSpacingAround,
      }),
      action: () => {},
    },
    DedentList,
    IndentList,
    Separator,
    InsertLink,
    InsertTable,
    TableOfContentsItem,
    Separator,
    InsertImage,
    InsertVideo,
    InsertIframe,
    Separator,
    {
      label: 'Paint Styles',
      icon: LucidePaintRoller,
      isActive: () => isPainting.value,
      action: (e) => {
        e.commands.focus()
        e.commands.storeStyles()
      },
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
    {
      icon: LucideSettings,
      label: 'Settings',
      action: openSettings,
    },
  ]
}
