<script lang="ts">
	import { Globe, Plus, Pencil, Trash2, Eye, EyeOff, Check, X } from '@lucide/svelte';
	import { settingsStore } from '$lib/stores/settings.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import type { ExternalModel } from '$lib/types';

	let showForm = $state(false);
	let editingId = $state<string | null>(null);
	let showApiKey = $state<string | null>(null);

	let formName = $state('');
	let formBaseUrl = $state('');
	let formApiKey = $state('');
	let formModelId = $state('');

	function openAddForm() {
		editingId = null;
		formName = '';
		formBaseUrl = '';
		formApiKey = '';
		formModelId = '';
		showForm = true;
	}

	function openEditForm(model: ExternalModel) {
		editingId = model.id;
		formName = model.name;
		formBaseUrl = model.baseUrl;
		formApiKey = model.apiKey;
		formModelId = model.modelId;
		showForm = true;
	}

	function cancelForm() {
		showForm = false;
		editingId = null;
	}

	function saveForm() {
		const trimmedName = formName.trim();
		const trimmedBaseUrl = formBaseUrl.trim();
		const trimmedApiKey = formApiKey.trim();
		const trimmedModelId = formModelId.trim();

		if (!trimmedName || !trimmedBaseUrl || !trimmedApiKey || !trimmedModelId) {
			return;
		}

		if (editingId) {
			settingsStore.updateExternalModel(editingId, {
				name: trimmedName,
				baseUrl: trimmedBaseUrl,
				apiKey: trimmedApiKey,
				modelId: trimmedModelId
			});
		} else {
			settingsStore.addExternalModel({
				name: trimmedName,
				baseUrl: trimmedBaseUrl,
				apiKey: trimmedApiKey,
				modelId: trimmedModelId
			});
		}

		showForm = false;
		editingId = null;
	}

	function deleteModel(id: string) {
		settingsStore.removeExternalModel(id);
	}

	function maskApiKey(key: string): string {
		if (key.length <= 8) return '••••••••';
		return '••••••••' + key.slice(-4);
	}
</script>

<div class="space-y-6">
	<div class="flex items-center justify-between">
		<p class="text-sm text-muted-foreground">
			配置外部 OpenAI 兼容 API，模型将出现在模型选择器中。
		</p>
		<Button variant="outline" size="sm" onclick={openAddForm}>
			<Plus class="mr-1.5 h-4 w-4" />
			添加外部模型
		</Button>
	</div>

	{#if showForm}
		<div class="rounded-lg border p-4 space-y-4">
			<h4 class="text-sm font-medium">
				{editingId ? '编辑外部模型' : '添加外部模型'}
			</h4>
			<div class="space-y-3">
				<div>
					<Label for="ext-name" class="text-xs">显示名称</Label>
					<Input
						id="ext-name"
						placeholder="例如: ChatGPT 4o"
						bind:value={formName}
					/>
				</div>
				<div>
					<Label for="ext-url" class="text-xs">API 地址</Label>
					<Input
						id="ext-url"
						placeholder="https://api.openai.com/v1"
						bind:value={formBaseUrl}
					/>
					<p class="mt-0.5 text-[11px] text-muted-foreground">
						输入 API 的 base URL，会自动拼接 /chat/completions
					</p>
				</div>
				<div>
					<Label for="ext-key" class="text-xs">API Key</Label>
					<Input
						id="ext-key"
						type="password"
						placeholder="sk-..."
						bind:value={formApiKey}
					/>
				</div>
				<div>
					<Label for="ext-model" class="text-xs">模型 ID</Label>
					<Input
						id="ext-model"
						placeholder="gpt-4o"
						bind:value={formModelId}
					/>
					<p class="mt-0.5 text-[11px] text-muted-foreground">
						发送给外部 API 的实际 model 名称
					</p>
				</div>
			</div>
			<div class="flex justify-end gap-2">
				<Button variant="ghost" size="sm" onclick={cancelForm}>
					<X class="mr-1 h-4 w-4" />
					取消
				</Button>
				<Button size="sm" onclick={saveForm}>
					<Check class="mr-1 h-4 w-4" />
					保存
				</Button>
			</div>
		</div>
	{/if}

	{#if settingsStore.externalModels.length === 0 && !showForm}
		<div class="py-8 text-center text-sm text-muted-foreground">
			暂未配置外部模型，点击上方按钮添加。
		</div>
	{:else if settingsStore.externalModels.length > 0}
		<div class="space-y-2">
			{#each settingsStore.externalModels as model (model.id)}
				<div
					class="flex items-center gap-3 rounded-lg border px-4 py-3"
				>
					<Globe class="h-5 w-5 shrink-0 text-blue-500" />
					<div class="min-w-0 flex-1">
						<p class="truncate text-sm font-medium">{model.name}</p>
						<p class="truncate text-xs text-muted-foreground">
							{model.baseUrl} / {model.modelId}
						</p>
					</div>
					<div class="flex items-center gap-0.5">
						<Button
							variant="ghost"
							size="icon-sm"
							onclick={() => {
								showApiKey = showApiKey === model.id ? null : model.id;
							}}
							title={showApiKey === model.id ? '隐藏 API Key' : '显示 API Key'}
						>
							{#if showApiKey === model.id}
								<EyeOff class="h-4 w-4" />
							{:else}
								<Eye class="h-4 w-4" />
							{/if}
						</Button>
						<Button
							variant="ghost"
							size="icon-sm"
							onclick={() => openEditForm(model)}
							title="编辑"
						>
							<Pencil class="h-4 w-4" />
						</Button>
						<Button
							variant="ghost"
							size="icon-sm"
							onclick={() => deleteModel(model.id)}
							title="删除"
						>
							<Trash2 class="h-4 w-4 text-destructive" />
						</Button>
					</div>
				</div>
				{#if showApiKey === model.id}
					<div class="rounded-lg bg-muted/50 px-4 py-2">
						<p class="text-xs text-muted-foreground">
							API Key: <code class="select-all">{model.apiKey}</code>
						</p>
					</div>
				{/if}
			{/each}
		</div>
	{/if}
</div>
