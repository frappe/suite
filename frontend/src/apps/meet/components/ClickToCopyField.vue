<template>
	<div
		class="relative rounded-lg border border-outline-gray-2 bg-surface-gray-2 p-3"
	>
		<div class="select-all break-all text-xs text-ink-gray-8">
			<pre
				:class="{
					'whitespace-pre-wrap': breakLines,
					'overflow-x-auto': !breakLines,
				}"
				:style="
					!breakLines
						? 'scrollbar-width: none; -ms-overflow-style: none; -webkit-scrollbar: none;'
						: ''
				"
				>{{ textContent }}</pre>
		</div>
		<button
			type="button"
			class="absolute right-2 top-2 rounded-sm border border-outline-gray-2 bg-surface-gray-1 px-2 py-1 text-xs text-ink-gray-7 hover:bg-surface-gray-3"
			@click="copyTextContentToClipboard"
		>
			{{ copied ? "copied" : "copy" }}
		</button>
	</div>
</template>

<script setup lang="ts">
import { toast } from "frappe-ui";
import { ref } from "vue";

const props = defineProps<{
	textContent: string;
	breakLines?: boolean;
}>();

const copied = ref(false);

function copyTextContentToClipboard() {
	const clipboard = window.navigator.clipboard;
	clipboard.writeText(props.textContent).then(() => {
		copied.value = true;
		setTimeout(() => {
			copied.value = false;
		}, 4000);
		toast.success("Copied to clipboard!");
	});
}
</script>
