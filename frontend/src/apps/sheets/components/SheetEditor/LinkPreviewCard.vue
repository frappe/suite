<template>
	<div
		v-if="open"
		class="sn-lp-card absolute z-40 w-[340px] overflow-hidden rounded-6 border border-outline-gray-1 bg-surface-base shadow-2xl"
		:style="style"
		@mouseenter="$emit('enter')"
		@mouseleave="$emit('leave')"
		@mousedown.stop
		@click.stop
	>
		<div class="flex items-center gap-2.5 p-2.5 pl-3">
			<span
				class="flex h-7 w-7 shrink-0 items-center justify-center rounded-4 bg-surface-gray-2 text-ink-gray-5"
			>
				<img
					v-if="preview.favicon && !faviconFailed"
					:src="preview.favicon"
					alt=""
					class="h-5 w-5 rounded-1"
					@error="faviconFailed = true"
				/>
				<Spinner v-else-if="preview.loading" class="h-3.5 w-3.5" />
				<LucideGlobe v-else class="h-4 w-4" />
			</span>

			<div class="min-w-0 flex-1">
				<a
					class="block truncate text-sm font-medium text-ink-gray-8 hover:underline"
					:href="url"
					target="_blank"
					rel="noopener noreferrer"
					:title="url"
					@click.prevent="$emit('open')"
				>{{ titleText }}</a>
				<div class="truncate text-xs text-ink-gray-5">{{ hostText }}</div>
			</div>

			<div class="flex shrink-0 items-center gap-0.5">
				<Button
					variant="ghost"
					size="sm"
					:icon="copied ? 'lucide-check' : 'lucide-copy'"
					:tooltip="copied ? 'Copied' : 'Copy link'"
					@click="copyUrl"
				/>
				<Button
					v-if="canEdit"
					variant="ghost"
					size="sm"
					icon="lucide-pencil"
					tooltip="Edit link"
					@click="$emit('edit')"
				/>
				<Button
					v-if="canEdit"
					variant="ghost"
					size="sm"
					icon="lucide-unlink"
					tooltip="Remove link"
					@click="$emit('unlink')"
				/>
			</div>
		</div>

		<p
			v-if="preview.description"
			class="line-clamp-2 px-3 pb-2.5 text-xs leading-relaxed text-ink-gray-6"
		>
			{{ preview.description }}
		</p>

		<div
			v-if="showReplaceOffer"
			class="flex items-center justify-between gap-2 border-t border-outline-gray-2 bg-surface-gray-1 px-3 py-2"
		>
			<span class="text-xs text-ink-gray-6">Replace URL with its title?</span>
			<Button variant="subtle" size="sm" label="Replace" @click="$emit('replace')" />
		</div>
	</div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { Button, Spinner } from 'frappe-ui'
import LucideGlobe from '~icons/lucide/globe'

const props = defineProps({
	open:    { type: Boolean, default: false },
	anchor:  { type: Object,  default: null },   // { x, y } canvas-local px
	url:     { type: String,  default: '' },
	// { loading, error, title, description, favicon, host }
	preview: { type: Object,  default: () => ({}) },
	canEdit: { type: Boolean, default: false },
	// True when the cell's text is just the raw URL — the replace-with-title
	// offer only makes sense then.
	offerReplace: { type: Boolean, default: false },
})
defineEmits(['open', 'edit', 'unlink', 'replace', 'enter', 'leave'])

const copied        = ref(false)
const faviconFailed = ref(false)

watch(() => props.url, () => { copied.value = false; faviconFailed.value = false })

const titleText = computed(() => props.preview.title || props.url)

const hostText = computed(() => {
	if (props.preview.loading) return 'Loading preview…'
	if (props.preview.host) return props.preview.host
	// mailto: / unreachable pages — show the bare target, minus the scheme.
	return props.url.replace(/^(https?:\/\/|mailto:)/i, '')
})

const showReplaceOffer = computed(() =>
	props.offerReplace && props.canEdit && !!props.preview.title && !props.preview.loading)

function copyUrl() {
	navigator.clipboard?.writeText(props.url).catch(() => {})
	copied.value = true
	setTimeout(() => { copied.value = false }, 1500)
}

const style = computed(() => {
	if (!props.anchor) return { display: 'none' }
	return { left: `${props.anchor.x}px`, top: `${props.anchor.y}px` }
})
</script>

<style scoped>
/* Entrance only — everything visual is espresso Tailwind utilities. Matches
   the rise used by the other Sheets popovers. */
.sn-lp-card {
	transform-origin: top left;
	animation: sn-lp-rise 120ms ease-out;
	/* Paint the fill with a literal colour, NOT the bg-surface-base utility.
	   That utility compiles to color-mix(in srgb, var(--surface-white,#fff) …);
	   in the production runtime --surface-white resolves to an EMPTY value in
	   this context, and an empty var defeats even the #fff fallback, so the
	   color-mix is invalid and the whole background-color is dropped — the card
	   goes transparent and the canvas cell text shows through. A literal colour
	   can't collapse; !important + the scoped selector's specificity beat the
	   utility's own !important declaration. */
	background-color: #fff !important;
}
[data-theme='dark'] .sn-lp-card {
	background-color: #0f0f0f !important;
}
@keyframes sn-lp-rise {
	from { transform: translateY(-4px) scale(0.98); opacity: 0; }
	to   { transform: translateY(0)    scale(1);    opacity: 1; }
}
</style>
