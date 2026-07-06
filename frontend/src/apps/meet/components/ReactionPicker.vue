<template>
	<PopoverRoot :open="isOpen" @update:open="updateOpen">
		<PopoverTrigger as-child>
			<slot name="trigger" />
		</PopoverTrigger>

		<PopoverPortal>
			<PopoverContent
				:side="'top'"
				:align="'center'"
				:side-offset="12"
				class="rounded-2xl bg-surface-base p-3 shadow-xl max-w-sm w-full z-[70]"
				data-testid="reaction-picker"
			>
				<div class="grid grid-cols-7 gap-2">
					<button
						v-for="emoji in reactionEmojis"
						:key="emoji"
						type="button"
						@click="handleReactionSelect(emoji)"
						class="mx-auto flex items-center justify-center size-9 rounded-lg bg-surface-gray-2 hover:bg-surface-gray-3 transition-colors text-xl"
						:aria-label="`Send ${emoji} reaction`"
						:data-testid="`reaction-${emoji}`"
					>
						{{ emoji }}
					</button>
				</div>
			</PopoverContent>
		</PopoverPortal>
	</PopoverRoot>
</template>

<script setup lang="ts">
import {
	PopoverContent,
	PopoverPortal,
	PopoverRoot,
	PopoverTrigger,
} from "reka-ui";

const props = defineProps<{
	isOpen?: boolean;
}>();

const emit = defineEmits<{
	select: [emoji: string];
	"update:open": [value: boolean];
}>();

const reactionEmojis = [
	"👍",
	"👎",
	"💖",
	"🎉",
	"😂",
	"👏",
	"🤔",
	"😮",
	"😢",
	"🤝",
	"✨",
	"🔥",
	"💯",
	"🙏",
];

const handleReactionSelect = (emoji) => {
	emit("select", emoji);
};

const updateOpen = (value) => {
	emit("update:open", value);
};
</script>
