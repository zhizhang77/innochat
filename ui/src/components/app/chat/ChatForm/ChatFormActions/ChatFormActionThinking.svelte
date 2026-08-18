<script lang="ts">
	import { Gauge, Lightbulb } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import * as Select from '$lib/components/ui/select';
	import { SETTINGS_KEYS } from '$lib/constants';
	import { config, settingsStore } from '$lib/stores/settings.svelte';

	interface Props {
		class?: string;
		disabled?: boolean;
	}

	// 'default' sends no reasoning_effort so the backend default applies.
	// low/medium/xhigh are the only values this backend accepts (verified against the
	// qwen3.6-flash/vLLM channel — high/max are rejected with 400).
	const THINKING_EFFORT_OPTIONS = [
		{ value: 'default', label: 'Auto' },
		{ value: 'low', label: 'Low' },
		{ value: 'medium', label: 'Medium' },
		{ value: 'xhigh', label: 'XHigh' }
	];

	let { class: className = '', disabled = false }: Props = $props();

	// Default to enabled so a missing/stale config value keeps thinking on (backend default).
	let thinkingEnabled = $derived(config().thinkingEnabled !== false);

	// Normalize any stale/unexpected value (e.g. legacy 'high') back to 'default'
	// so the select never shows an orphan value and the request never 400s.
	let thinkingEffort = $derived(
		THINKING_EFFORT_OPTIONS.some((o) => o.value === config().thinkingEffort)
			? config().thinkingEffort
			: 'default'
	);
	let effortLabel = $derived(
		THINKING_EFFORT_OPTIONS.find((o) => o.value === thinkingEffort)?.label ?? 'Auto'
	);

	function toggleThinking() {
		settingsStore.updateConfig(SETTINGS_KEYS.THINKING_ENABLED, !thinkingEnabled);
	}
</script>

<div class="flex items-center gap-1 {className}">
	<Tooltip.Root>
		<Tooltip.Trigger>
			<Button
				class="h-8 w-8 rounded-full p-0 {thinkingEnabled
					? 'fill-amber-400 text-amber-400 hover:bg-amber-400/10'
					: 'text-muted-foreground hover:bg-muted'}"
				disabled={disabled}
				onclick={toggleThinking}
				type="button"
			>
				<span class="sr-only">{thinkingEnabled ? 'Disable thinking' : 'Enable thinking'}</span>

				<Lightbulb
					class="h-4 w-4 {thinkingEnabled ? 'fill-amber-400 text-amber-400' : ''}"
				/>
			</Button>
		</Tooltip.Trigger>

		<Tooltip.Content>
			<p>{thinkingEnabled ? 'Disable thinking' : 'Enable thinking'}</p>
		</Tooltip.Content>
	</Tooltip.Root>

	{#if thinkingEnabled}
		<Select.Root
			type="single"
			value={thinkingEffort}
			onValueChange={(value) =>
				settingsStore.updateConfig(SETTINGS_KEYS.THINKING_EFFORT, value)
			}
		>
			<Select.Trigger
				size="sm"
				variant="plain"
				class="h-8 w-auto justify-center rounded-full px-2.5 hover:bg-muted data-[state=open]:bg-muted"
				disabled={disabled}
			>
				<Gauge class="size-3.5" />
				{effortLabel}
			</Select.Trigger>

			<Select.Content align="end">
				{#each THINKING_EFFORT_OPTIONS as option (option.value)}
					<Select.Item value={option.value} label={option.label}>
						{option.label}
					</Select.Item>
				{/each}
			</Select.Content>
		</Select.Root>
	{/if}
</div>
