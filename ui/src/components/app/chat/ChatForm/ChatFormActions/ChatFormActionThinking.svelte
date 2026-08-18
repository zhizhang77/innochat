<script lang="ts">
	import { Lightbulb } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import { SETTINGS_KEYS } from '$lib/constants';
	import { config, settingsStore } from '$lib/stores/settings.svelte';

	interface Props {
		class?: string;
		disabled?: boolean;
	}

	let { class: className = '', disabled = false }: Props = $props();

	// Default to enabled so a missing/stale config value keeps thinking on (backend default).
	let thinkingEnabled = $derived(config().thinkingEnabled !== false);

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
</div>
