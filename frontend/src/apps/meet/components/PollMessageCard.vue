<template>
    <div class="border border-gray-200 rounded-lg p-3">
        <div class="mb-4">
    <h3 class="text-base font-semibold text-gray-900 leading-snug">{{ livePoll.question }}</h3>
</div>
        
        <div class="space-y-2">
            <button
    v-for="option in livePoll.options"
    :key="option.id"
    @click="handleVote(option.id)"
    :disabled="hasVoted"
    class="relative w-full text-left rounded-full overflow-hidden transition-colors focus:outline-none"
    :class="{ 
        'hover:bg-gray-200 cursor-pointer bg-gray-100': !hasVoted,
        'bg-purple-100': hasVoted && localVotedOption === option.id,
        'bg-gray-100 cursor-default': hasVoted && localVotedOption !== option.id
    }"
>
                <div 
    class="absolute inset-y-0 left-0 transition-all duration-500 ease-out"
    :class="hasVoted && localVotedOption === option.id ? 'bg-purple-200' : 'bg-gray-200'"
    :style="{ width: `${getPercentage(option.votes)}%` }"
></div>
                
                <div class="relative px-4 py-2.5 flex justify-between items-center text-sm z-10">
    <div class="flex items-center gap-2 truncate pr-2">
        <span class="font-medium text-gray-900">
            {{ option.text }}
        </span>
        <lucide-circle-check-big 
            v-if="hasVoted && localVotedOption === option.id" 
            class="w-3 h-3 text-gray-800 shrink-0" 
        />
    </div>
    
    <div class="flex items-center gap-2 shrink-0">
        <span class="text-gray-600 text-sm font-medium" v-if="hasVoted">
            {{ option.votes }} {{ option.votes === 1 ? 'vote' : 'votes' }} • {{ getPercentage(option.votes) }}%
        </span>
    </div>
</div>
            </button>
        </div>

        <div class="mt-4 text-sm text-gray-600">
    {{ totalVotes }} {{ totalVotes === 1 ? 'vote' : 'votes' }}
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

const hasVoted = computed(() => !!livePoll.value.hasVoted);

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