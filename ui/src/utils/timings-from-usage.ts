import type { ApiUsage } from '$lib/types/api';
import type { ChatMessageTimings } from '$lib/types/chat';

/**
 * Maps an OpenAI-standard `usage` object to the app's ChatMessageTimings shape.
 *
 * OpenAI-compatible backends (vLLM, etc.) don't emit llama.cpp-style `timings` in
 * stream chunks — they only provide `usage` (prompt/completion/cached token counts)
 * in the final chunk. `predictedMs` is measured client-side (wall-clock decode time)
 * since the backend gives no timing for it.
 */
export function timingsFromUsage(usage: ApiUsage, predictedMs?: number): ChatMessageTimings {
	const timings: ChatMessageTimings = {};

	if (usage.prompt_tokens !== undefined) timings.prompt_n = usage.prompt_tokens;
	if (usage.completion_tokens !== undefined) timings.predicted_n = usage.completion_tokens;
	if (predictedMs !== undefined) timings.predicted_ms = predictedMs;

	const cached = usage.prompt_tokens_details?.cached_tokens;
	if (cached !== undefined) timings.cache_n = cached;

	return timings;
}
