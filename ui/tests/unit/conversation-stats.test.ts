import { describe, expect, it } from 'vitest';
import { MessageRole, MessageType } from '$lib/enums';
import type { DatabaseMessage } from '$lib/types/database';
import { computeConversationTokenStats } from '$lib/utils/conversation-stats';

function assistantMessage(overrides: Partial<DatabaseMessage> = {}): DatabaseMessage {
	return {
		id: crypto.randomUUID(),
		convId: 'conv-1',
		type: MessageType.TEXT,
		timestamp: Date.now(),
		role: MessageRole.ASSISTANT,
		content: 'hi',
		parent: null,
		children: [],
		...overrides
	};
}

function userMessage(): DatabaseMessage {
	return {
		id: crypto.randomUUID(),
		convId: 'conv-1',
		type: MessageType.TEXT,
		timestamp: Date.now(),
		role: MessageRole.USER,
		content: 'hello',
		parent: null,
		children: []
	};
}

describe('computeConversationTokenStats', () => {
	it('returns zeros for an empty conversation', () => {
		expect(computeConversationTokenStats([])).toEqual({
			promptTokens: 0,
			predictedTokens: 0,
			totalTokens: 0,
			tokensPerSecond: 0
		});
	});

	it('ignores messages without timings', () => {
		const result = computeConversationTokenStats([
			userMessage(),
			assistantMessage(),
			assistantMessage()
		]);
		expect(result).toEqual({
			promptTokens: 0,
			predictedTokens: 0,
			totalTokens: 0,
			tokensPerSecond: 0
		});
	});

	it('sums prompt and generated tokens across non-agentic messages', () => {
		const result = computeConversationTokenStats([
			userMessage(),
			assistantMessage({ timings: { prompt_n: 100, predicted_n: 200, predicted_ms: 1000 } }),
			userMessage(),
			assistantMessage({ timings: { prompt_n: 150, predicted_n: 50, predicted_ms: 500 } })
		]);
		expect(result).toEqual({
			promptTokens: 250,
			predictedTokens: 250,
			totalTokens: 500,
			tokensPerSecond: (250 / 1500) * 1000
		});
	});

	it('computes tokens/s from total generated tokens over total generation time', () => {
		const result = computeConversationTokenStats([
			assistantMessage({ timings: { predicted_n: 200, predicted_ms: 1000 } }),
			assistantMessage({ timings: { predicted_n: 300, predicted_ms: 1500 } })
		]);
		expect(result.tokensPerSecond).toBeCloseTo((500 / 2500) * 1000, 6);
	});

	it('dedupes agentic exchanges where each message carries cumulative totals', () => {
		const result = computeConversationTokenStats([
			userMessage(),
			assistantMessage({
				timings: {
					agentic: {
						turns: 1,
						toolCallsCount: 1,
						toolsMs: 100,
						toolCalls: [],
						perTurn: [],
						llm: { prompt_n: 100, prompt_ms: 500, predicted_n: 200, predicted_ms: 1000 }
					}
				}
			}),
			// tool result (no timings) between turns
			{ ...userMessage(), role: MessageRole.TOOL },
			assistantMessage({
				timings: {
					agentic: {
						turns: 2,
						toolCallsCount: 1,
						toolsMs: 100,
						toolCalls: [],
						perTurn: [],
						llm: { prompt_n: 180, prompt_ms: 900, predicted_n: 320, predicted_ms: 1600 }
					}
				}
			})
		]);
		expect(result).toEqual({
			promptTokens: 180,
			predictedTokens: 320,
			totalTokens: 500,
			tokensPerSecond: (320 / 1600) * 1000
		});
	});

	it('dedupes agentic exchanges when the first message holds the final cumulative total', () => {
		const result = computeConversationTokenStats([
			userMessage(),
			// Both messages hold the SAME final cumulative (first message overwritten on flow complete)
			assistantMessage({
				timings: {
					agentic: {
						turns: 2,
						toolCallsCount: 1,
						toolsMs: 100,
						toolCalls: [],
						perTurn: [],
						llm: { prompt_n: 180, prompt_ms: 900, predicted_n: 320, predicted_ms: 1600 }
					}
				}
			}),
			{ ...userMessage(), role: MessageRole.TOOL },
			assistantMessage({
				timings: {
					agentic: {
						turns: 2,
						toolCallsCount: 1,
						toolsMs: 100,
						toolCalls: [],
						perTurn: [],
						llm: { prompt_n: 180, prompt_ms: 900, predicted_n: 320, predicted_ms: 1600 }
					}
				}
			})
		]);
		expect(result.totalTokens).toBe(500);
		expect(result.promptTokens).toBe(180);
		expect(result.predictedTokens).toBe(320);
	});

	it('restarts agentic dedup after a user message', () => {
		const result = computeConversationTokenStats([
			assistantMessage({
				timings: {
					agentic: {
						turns: 1,
						toolCallsCount: 1,
						toolsMs: 0,
						toolCalls: [],
						perTurn: [],
						llm: { prompt_n: 100, prompt_ms: 500, predicted_n: 200, predicted_ms: 1000 }
					}
				}
			}),
			userMessage(),
			assistantMessage({
				timings: {
					agentic: {
						turns: 1,
						toolCallsCount: 1,
						toolsMs: 0,
						toolCalls: [],
						perTurn: [],
						llm: { prompt_n: 300, prompt_ms: 700, predicted_n: 400, predicted_ms: 2000 }
					}
				}
			})
		]);
		expect(result.totalTokens).toBe(1000);
		expect(result.promptTokens).toBe(400);
		expect(result.predictedTokens).toBe(600);
	});

	it('uses top-level timings for agentic messages with no tool calls', () => {
		const result = computeConversationTokenStats([
			assistantMessage({ timings: { prompt_n: 120, predicted_n: 240, predicted_ms: 1200 } })
		]);
		expect(result.totalTokens).toBe(360);
	});
});
