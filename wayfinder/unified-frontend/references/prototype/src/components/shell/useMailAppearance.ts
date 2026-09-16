// What the message list looks like: how tall a row is, and whether the
// reading pane sits beside the list or replaces it.
//
// The two settle each other. Dense is the single line every mail client has
// drawn since Gmail, and it only earns its keep in a full-width list — in a
// 24rem column beside a reading pane there is nothing left for the snippet
// after the sender and the subject, which is the very thing Compact was
// written to avoid. So Density and Layout live together, in one panel.
import { computed, ref, watch } from 'vue'

export type MailDensity = 'dense' | 'compact' | 'cozy'

export const MAIL_DENSITIES: { label: string; value: MailDensity }[] = [
  { label: 'Dense', value: 'dense' },
  { label: 'Compact', value: 'compact' },
  { label: 'Cozy', value: 'cozy' },
]

export const mailDensity = ref<MailDensity>('cozy')

/**
 * Row padding, the matching top padding for the columns beside it, and the
 * avatar size the row has room for.
 *
 * Compact and Cozy are padded rather than fixed: the row is as tall as its
 * two or three lines plus its padding, which is what keeps them reading as
 * cards sized to their contents. Dense is the exception — one line in a fixed
 * 48px box, centred, which is why it carries no padding of its own here.
 */
export const DENSITY_PAD: Record<
  MailDensity,
  { y: string; top: string; avatar: 'sm' | 'md' | 'lg' }
> = {
  dense: { y: '', top: '', avatar: 'lg' },
  compact: { y: 'py-3', top: 'pt-3', avatar: 'md' },
  cozy: { y: 'py-3.5', top: 'pt-3.5', avatar: 'lg' },
}

/**
 * Whether rows carry the sender's face.
 *
 * Off, the square it occupies does not close up: it becomes the checkbox,
 * shown on every row rather than waiting for the pointer. The row keeps its
 * shape either way, and there is still somewhere to click to select.
 */
export const showAvatars = ref(true)

export type MailLayout = 'split' | 'full'

export const MAIL_LAYOUTS: { label: string; value: MailLayout }[] = [
  { label: 'Split view', value: 'split' },
  { label: 'Full-width list', value: 'full' },
]

export const mailLayout = ref<MailLayout>('full')

/**
 * The densities worth offering for the layout in play. Dense puts the sender,
 * the subject and the message on one line, which needs the window's width —
 * in the 24rem column beside a reading pane the message has nowhere to go, so
 * the split view does not offer it at all rather than offering a view that
 * arrives broken.
 */
export const availableDensities = computed(() =>
  mailLayout.value === 'split'
    ? MAIL_DENSITIES.filter((option) => option.value !== 'dense')
    : MAIL_DENSITIES,
)

// Someone reading a dense list who switches to the split view has picked a
// combination that no longer exists. Compact is where they land: it is the
// nearest thing still on offer, and it keeps the message visible.
watch(mailLayout, (layout) => {
  if (layout === 'split' && mailDensity.value === 'dense') mailDensity.value = 'compact'
})

export const mailSettingsOpen = ref(false)
