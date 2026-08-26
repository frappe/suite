<template>
	<TransitionGroup
		name="floating-reaction"
		tag="div"
		class="absolute inset-0 pointer-events-none z-50"
	>
		<div
			v-for="reaction in floatingReactions"
			:key="reaction.id"
			class="absolute flex flex-col items-center animate-float-up"
			:style="{
				left: `${reaction.position.x}px`,
				top: `${reaction.position.y}px`,
			}"
		>
			<div class="text-4xl mb-1 animate-bounce-in">
				{{ reaction.emoji }}
			</div>

			<!-- NamePill component won't work here due to it's positioning -->
			<div class="bg-black/70 text-white text-xs px-2 py-1 rounded-4 whitespace-nowrap">
				{{ reaction.userName }}
			</div>
		</div>
	</TransitionGroup>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";

interface Reaction {
	id?: string;
	uniqueId?: string;
	userId: string;
	userName: string;
	emoji: string;
	timestamp: number;
	expiresAt: number;
	position?: { x: number; y: number };
}

const props = defineProps<{
	reactions?: Reaction[];
	containerRef?: { getBoundingClientRect: () => DOMRect };
}>();

const positionAssignments = ref(new Map<string, number>());
const usedPositions = ref(new Set<number>());

const getReactionKey = (reaction: Reaction): string => {
	return (
		reaction.uniqueId ||
		reaction.id ||
		`${reaction.userId}-${reaction.emoji}-${reaction.timestamp}`
	);
};

interface ReactionWithPosition extends Reaction {
	id: string;
	position: { x: number; y: number };
}

const floatingReactions = computed<ReactionWithPosition[]>(() => {
	const currentReactionKeys = new Set<string>();

	for (const reaction of props.reactions) {
		const reactionKey = getReactionKey(reaction);
		currentReactionKeys.add(reactionKey);
	}

	for (const [key, position] of positionAssignments.value) {
		if (!currentReactionKeys.has(key)) {
			positionAssignments.value.delete(key);
			usedPositions.value.delete(position);
		}
	}

	// Assigning positions to new reactions
	for (const reaction of props.reactions) {
		const reactionKey = getReactionKey(reaction);
		if (!positionAssignments.value.has(reactionKey)) {
			let positionIndex = 0;
			while (usedPositions.value.has(positionIndex) && positionIndex < 6) {
				positionIndex++;
			}
			positionAssignments.value.set(reactionKey, positionIndex);
			usedPositions.value.add(positionIndex);
		}
	}

	return props.reactions.map((reaction) => {
		const containerRect = props.containerRef?.getBoundingClientRect?.() || {
			width: window.innerWidth,
			height: window.innerHeight,
			left: 0,
			top: 0,
		};

		// staggered positions near the bottom-right
		const baseX = containerRect.width - 120;
		const baseY = containerRect.height - 100;

		const reactionKey = getReactionKey(reaction);
		const positionIndex = positionAssignments.value.get(reactionKey) || 0;

		const offsetX = (positionIndex % 2) * 80;
		const offsetY = Math.floor(positionIndex / 2) * 60;

		return {
			...reaction,
			id: reactionKey,
			position: {
				x: Math.max(20, baseX - offsetX),
				y: Math.max(20, baseY - offsetY),
			},
		};
	});
});
</script>

<style scoped>
@keyframes float-up {
	0% {
		opacity: 0;
		transform: translateY(20px) scale(0.8);
	}
	10% {
		opacity: 1;
		transform: translateY(0) scale(1);
	}
	90% {
		opacity: 1;
		transform: translateY(-40px) scale(1);
	}
	100% {
		opacity: 0;
		transform: translateY(-60px) scale(0.9);
	}
}

@keyframes bounce-in {
	0% {
		transform: scale(0.3);
		opacity: 0;
	}
	50% {
		transform: scale(1.1);
		opacity: 1;
	}
	100% {
		transform: scale(1);
		opacity: 1;
	}
}

.animate-float-up {
	animation: float-up 4s ease-out forwards;
}

.animate-bounce-in {
	animation: bounce-in 0.6s ease-out;
}

/* Transition for entering/leaving reactions */
.floating-reaction-enter-active {
	transition: all 0.3s ease-out;
}

.floating-reaction-leave-active {
	transition: all 0.3s ease-in;
}

.floating-reaction-enter-from {
	opacity: 0;
	transform: translateY(20px) scale(0.8);
}

.floating-reaction-leave-to {
	opacity: 0;
	transform: translateY(-20px) scale(0.9);
}
</style>
