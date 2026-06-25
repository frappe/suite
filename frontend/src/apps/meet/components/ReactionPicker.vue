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
				<div class="text-center space-y-3">
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
					<button
						type="button"
						@click="handleRaiseHand"
						class="w-full py-2 px-4 rounded-lg transition-colors flex items-center justify-center gap-3 font-medium text-ink-gray-8 bg-surface-gray-2 hover:bg-surface-gray-3"
						:class="{ '!bg-surface-gray-3': isHandRaised }"
						data-testid="toggle-raise-hand"
					>
						<lucide-hand class="w-5 h-5" />
						{{ isHandRaised ? "Lower Hand" : "Raise Hand" }}
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
	isHandRaised?: boolean;
}>();

const emit = defineEmits<{
	select: [emoji: string];
	"update:open": [value: boolean];
	"toggle-raise-hand": [];
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

const handleRaiseHand = () => {
	emit("toggle-raise-hand");
	updateOpen(false);
};

const updateOpen = (value) => {
	emit("update:open", value);
};
</script>
