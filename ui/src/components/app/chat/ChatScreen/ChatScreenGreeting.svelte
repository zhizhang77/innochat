<script lang="ts">
	import { fadeInView } from '$lib/actions/fade-in-view.svelte';
	import { GREETING, SUBTITLE, SUBTITLE_AUDIO } from '$lib/constants';
	import { serverStore } from '$lib/stores/server.svelte';

	interface Props {
		isEmpty: boolean;
	}

	let { isEmpty = false }: Props = $props();
</script>

<div
	class={[
		'pointer-events-none mb-4 hidden px-4 text-center',
		isEmpty && 'pointer-events-auto block!'
	]}
	use:fadeInView={{ duration: 300 }}
>
	<h1 class="mb-2 text-2xl font-semibold tracking-tight md:text-3xl">{GREETING}</h1>

	<p class="text-muted-foreground md:text-lg">
		{serverStore.props?.modalities?.audio ? SUBTITLE_AUDIO : SUBTITLE}
	</p>
</div>
