<template>
    <div class="border border-gray-200 rounded-lg p-3">
        <div class="flex items-start gap-2 mb-3 text-gray-900 font-medium">
            <lucide-bar-chart-2 class="w-4 h-4 mt-0.5 text-gray-900 shrink-0" />
            <h4 class="text-sm leading-tight">{{ livePoll.question }}</h4>
        </div>
        
        <div class="space-y-2">
            <button
                v-for="option in livePoll.options"
                :key="option.id"
                @click="handleVote(option.id)"
                :disabled="hasVoted"
                class="relative w-full text-left rounded-md overflow-hidden border border-gray-200 transition-colors focus:outline-none bg-gray-50"
                :class="{ 
                    'hover:border-gray-400 hover:bg-gray-100 cursor-pointer': !hasVoted,
                    'border-gray-900 ring-1 ring-gray-900': localVotedOption === option.id,
                    'opacity-75 cursor-default': hasVoted && localVotedOption !== option.id
                }"
            >
                <div 
                    class="absolute inset-y-0 left-0 bg-gray-200 transition-all duration-500 ease-out"
                    :style="{ width: `${getPercentage(option.votes)}%` }"
                ></div>
                
                <div class="relative px-3 py-2 flex justify-between items-center text-sm z-10">
                    <span class="font-medium text-gray-900 truncate pr-2">
                        {{ option.text }}
                    </span>
                    <span class="text-gray-600 text-xs shrink-0 font-medium">
                        {{ getPercentage(option.votes) }}% 
                        <span class="text-gray-400 font-normal">({{ option.votes }})</span>
                    </span>
                </div>
            </button>
        </div>

        <div class="mt-3 text-xs text-gray-500 flex justify-between items-center">
            <span>Live Poll</span>
            <span>{{ totalVotes }} {{ totalVotes === 1 ? 'vote' : 'votes' }}</span>
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed, inject, ref } from "vue";
import { PollPayloadFE } from "../types";
import { usePollStore } from "../composables/usePollStore";

const props = defineProps<{
	poll: PollPayloadFE
}>();

const pollService = inject("poll") as any;
const pollStore = usePollStore()

const localVotedOption = ref<string | null>(null);

const livePoll = computed(() => {
    const storePolls = Object.values(pollStore.polls) as PollPayloadFE[];
    const foundInStore = storePolls?.find(p => p.pollId === props.poll.pollId);    
    return foundInStore || props.poll;
});

const hasVoted = computed(() => {
    return localVotedOption.value !== null || !!livePoll.value.hasVoted;
});

const handleVote = async (optionId: string) => {
    if (hasVoted.value) return; 

    localVotedOption.value = optionId;

    if (pollService) {
        try {
            await pollService.submitVote(livePoll.value.pollId, optionId);
        } catch (error) {
            localVotedOption.value = null;
        }
    }
};

const totalVotes = computed(() => {
    return livePoll.value.options.reduce((sum, opt) => sum + opt.votes, 0);
});

const getPercentage = (votes: number) => {
	if (totalVotes.value === 0) return 0;
	return Math.round((votes / totalVotes.value) * 100);
};

</script>