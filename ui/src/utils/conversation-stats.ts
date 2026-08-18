import { MS_PER_SECOND } from '$lib/constants/formatters';
import { MessageRole } from '$lib/enums';
import type { ChatMessageAgenticTimings } from '$lib/types/chat';
import type { DatabaseMessage } from '$lib/types/database';

export interface ConversationTokenStats {
	promptTokens: number;
	predictedTokens: number;
	totalTokens: number;
	tokensPerSecond: number;
}

/**
 * Aggregates token usage across a conversation's messages (input + output).
 *
 * Non-agentic assistant messages carry their own prompt/generated totals at the
 * top level. Agentic exchanges are trickier: every assistant message in the run
 * snapshots the *cumulative* agentic.llm totals (turn 0, then turn 0+1, ...), so
 * naively summing them over-counts. We dedupe by adding the delta between each
 * agentic message and the previous one in the same run — this also stays correct
 * when the first message is later overwritten with the final cumulative total.
 */
export function computeConversationTokenStats(messages: DatabaseMessage[]): ConversationTokenStats {
	let promptTokens = 0;
	let predictedTokens = 0;
	let predictedMs = 0;
	let prevAgentic: ChatMessageAgenticTimings['llm'] | null = null;

	for (const message of messages) {
		const timings = message.timings;

		if (message.role !== MessageRole.ASSISTANT || !timings) {
			// A user message starts a fresh exchange; stop linking agentic deltas.
			if (message.role === MessageRole.USER) prevAgentic = null;
			continue;
		}

		const agentic = timings.agentic;
		if (agentic && agentic.toolCallsCount > 0) {
			const cum = agentic.llm;
			promptTokens += prevAgentic
				? Math.max(0, (cum.prompt_n || 0) - (prevAgentic.prompt_n || 0))
				: cum.prompt_n || 0;
			predictedTokens += prevAgentic
				? Math.max(0, (cum.predicted_n || 0) - (prevAgentic.predicted_n || 0))
				: cum.predicted_n || 0;
			predictedMs += prevAgentic
				? Math.max(0, (cum.predicted_ms || 0) - (prevAgentic.predicted_ms || 0))
				: cum.predicted_ms || 0;
			prevAgentic = cum;
		} else {
			promptTokens += timings.prompt_n || 0;
			predictedTokens += timings.predicted_n || 0;
			predictedMs += timings.predicted_ms || 0;
			prevAgentic = null;
		}
	}

	const totalTokens = promptTokens + predictedTokens;
	const tokensPerSecond = predictedMs > 0 ? (predictedTokens / predictedMs) * MS_PER_SECOND : 0;
	return { promptTokens, predictedTokens, totalTokens, tokensPerSecond };
}
