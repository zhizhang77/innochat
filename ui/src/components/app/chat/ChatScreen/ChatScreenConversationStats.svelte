<script lang="ts">
	import { Gauge, WholeWord } from '@lucide/svelte';
	import { ChatMessageStatisticsBadge } from '$lib/components/app';
	import { activeMessages } from '$lib/stores/conversations.svelte';
	import { config } from '$lib/stores/settings.svelte';
	import { computeConversationTokenStats } from '$lib/utils';

	let showStats = $derived(config().showMessageStats === true);

	let conversationStats = $derived(computeConversationTokenStats(activeMessages()));
</script>

{#if showStats && conversationStats.totalTokens > 0}
	<div class="flex items-center justify-center gap-1 pb-1.5 text-xs text-muted-foreground">
		<ChatMessageStatisticsBadge
			class="bg-transparent"
			icon={WholeWord}
			value="{conversationStats.totalTokens.toLocaleString()} tokens total"
			tooltipLabel="Total tokens in conversation ({conversationStats.promptTokens.toLocaleString()} input + {conversationStats.predictedTokens.toLocaleString()} output)"
		/>

		<ChatMessageStatisticsBadge
			class="bg-transparent"
			icon={Gauge}
			value="{conversationStats.tokensPerSecond.toFixed(2)} t/s"
			tooltipLabel="Average generation speed"
		/>
	</div>
{/if}
