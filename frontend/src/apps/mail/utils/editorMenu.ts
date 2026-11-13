import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  BulletList,
  FontColor,
  InsertImage,
  InsertLink,
  Italic,
  OrderedList,
  Paragraph,
  Separator,
  type MenuItem,
} from 'frappe-ui/editor'
import { computed } from 'vue'

import EditorHeadingMenu from '@/apps/mail/components/Controls/EditorHeadingMenu.vue'
import { useScreenSize } from '@/apps/mail/utils/composables'

const HEADINGS: MenuItem = {
  label: 'Heading',
  action: () => {},
  component: EditorHeadingMenu,
}

/**
 * `dropAlignment` is the mail composer, which does without the alignment group: it was the widest
 * thing in a toolbar that has to fit a narrow docked panel, alignment in an email body is rare,
 * and mobile had already dropped it — so the composer's toolbar no longer changes shape with the
 * window it is in. The signature and vacation editors keep it, where centring a logo or a footer
 * is the point. A getter, so a caller can make it conditional.
 */
export const useEditorMenu = (dropAlignment: () => boolean = () => false) => {
  const { isMobile } = useScreenSize()
  return computed<MenuItem[]>(() => [
    Paragraph,
    HEADINGS,
    Separator,
    Bold,
    Italic,
    FontColor,
    ...(isMobile.value || dropAlignment() ? [] : [Separator, AlignLeft, AlignCenter, AlignRight]),
    Separator,
    BulletList,
    OrderedList,
    Separator,
    InsertImage,
    InsertLink,
  ])
}
