<template>
	<div>
		<template v-for="(segment, index) in segments" :key="index">
			<template v-if="segment.kind === 'quote'">
				<button
					class="bg-surface-gray-2 text-ink-gray-6 hover:bg-surface-gray-3 my-3 rounded-6 px-1.5 leading-4"
					:aria-expanded="expanded.has(index)"
					:aria-label="__('Show quoted text')"
					@click="toggle(index)"
				>
					&middot;&middot;&middot;
				</button>
				<div v-if="expanded.has(index)">
					<LinkifiedText
						v-for="(block, level) in segment.blocks"
						:key="level"
						:text="block.text"
						class="border-outline-gray-2 text-ink-gray-6 my-1 border-l pl-3"
						:style="{ marginLeft: (block.depth - 1) * 12 + 'px' }"
					/>
				</div>
			</template>
			<LinkifiedText
				v-else-if="segment.kind === 'signature'"
				:text="segment.blocks[0].text"
				class="text-ink-gray-5 mt-3"
			/>
			<LinkifiedText v-else :text="segment.blocks[0].text" />
		</template>
	</div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { groupPlainText } from '@/apps/mail/utils/plainTextBlocks'
import LinkifiedText from '@/components/LinkifiedText.vue'

const { text } = defineProps<{ text?: string | null }>()
const segments = computed(() => groupPlainText(text ?? ''))
const expanded = ref(new Set<number>())

// Opening another message reuses this component, and the indices mean something else there.
watch(
	() => text,
	() => (expanded.value = new Set()),
)

const toggle = (index: number) => {
	const next = new Set(expanded.value)
	if (!next.delete(index)) next.add(index)
	expanded.value = next
}
</script>
