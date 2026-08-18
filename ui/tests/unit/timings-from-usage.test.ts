import { describe, expect, it } from 'vitest';
import { timingsFromUsage } from '$lib/utils/timings-from-usage';

describe('timingsFromUsage', () => {
	it('maps OpenAI usage to ChatMessageTimings with measured decode time', () => {
		expect(
			timingsFromUsage({ prompt_tokens: 56, completion_tokens: 8, total_tokens: 64 }, 1200)
		).toEqual({
			prompt_n: 56,
			predicted_n: 8,
			predicted_ms: 1200
		});
	});

	it('includes cached tokens when the backend reports them', () => {
		expect(
			timingsFromUsage({
				prompt_tokens: 50,
				completion_tokens: 3,
				prompt_tokens_details: { cached_tokens: 40 }
			})
		).toEqual({
			prompt_n: 50,
			predicted_n: 3,
			cache_n: 40
		});
	});

	it('omits fields the backend did not report', () => {
		expect(timingsFromUsage({})).toEqual({});
	});

	it('preserves zero token counts (valid value, not "missing")', () => {
		expect(timingsFromUsage({ prompt_tokens: 10, completion_tokens: 0 }, 500)).toEqual({
			prompt_n: 10,
			predicted_n: 0,
			predicted_ms: 500
		});
	});
});
