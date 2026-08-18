import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

import { defineConfig, searchForWorkspaceRoot } from 'vite';
import devtoolsJson from 'vite-plugin-devtools-json';
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
import { llamaCppBuildPlugin } from './scripts/vite-plugin-llama-cpp-build';

const __dirname = dirname(fileURLToPath(import.meta.url));

// The storybookTest() plugin and the client/ui setup files throw at config load
// when their supporting files are absent. Guard each project behind what it
// needs so one missing suite can never block the others (e.g. `npm run test:unit`).
const hasClientSetup = existsSync(join(__dirname, 'vitest-setup-client.ts'));
const hasStorybookConfig =
	existsSync(join(__dirname, '.storybook', 'main.ts')) ||
	existsSync(join(__dirname, '.storybook', 'main.js'));
const hasStorybookSetup = existsSync(join(__dirname, '.storybook', 'vitest.setup.ts'));
const hasStorybook = hasStorybookConfig && hasStorybookSetup;

if (!hasClientSetup) {
	console.warn('[vitest] Skipping "client" project: vitest-setup-client.ts not found.');
}
if (!hasStorybook) {
	console.warn('[vitest] Skipping "ui" (storybook) project: .storybook/ config not found.');
}

export default defineConfig({
	resolve: {
		alias: {
			$lib: resolve('src'),
			'katex-fonts': resolve('node_modules/katex/dist/fonts')
		}
	},

	build: {
		assetsInlineLimit: 32000,
		chunkSizeWarningLimit: 3072,
		minify: true
	},

	plugins: [tailwindcss(), sveltekit(), devtoolsJson(), llamaCppBuildPlugin()],

	test: {
		projects: [
			// Browser-based component tests (needs vitest-setup-client.ts)
			...(hasClientSetup
				? [
						{
							extends: './vite.config.ts',
							test: {
								name: 'client',
								environment: 'browser',
								browser: {
									enabled: true,
									provider: 'playwright',
									instances: [{ browser: 'chromium' }]
								},
								include: ['tests/client/**/*.svelte.{test,spec}.{js,ts}'],
								setupFiles: ['./vitest-setup-client.ts']
							}
						}
					]
				: []),

			// Node-based unit tests
			{
				extends: './vite.config.ts',
				test: {
					name: 'unit',
					environment: 'node',
					include: ['tests/unit/**/*.{test,spec}.{js,ts}']
				}
			},

			// Storybook-based visual tests (needs .storybook/)
			...(hasStorybook
				? [
						{
							extends: './vite.config.ts',
							test: {
								name: 'ui',
								environment: 'browser',
								browser: {
									enabled: true,
									provider: 'playwright',
									instances: [{ browser: 'chromium', headless: true }]
								},
								include: ['tests/stories/**/*.stories.{js,ts,svelte}'],
								setupFiles: ['./.storybook/vitest.setup.ts']
							},
							plugins: [
								storybookTest({
									storybookScript: 'pnpm run storybook --no-open'
								})
							]
						}
					]
				: [])
		]
	},

	server: {
		proxy: {
			'/v1': 'http://localhost:8080',
			'/props': 'http://localhost:8080',
			'/models': 'http://localhost:8080',
			'/tools': 'http://localhost:8080',
			'/slots': 'http://localhost:8080',
			'/cors-proxy': 'http://localhost:8080'
		},
		headers: {
			'Cross-Origin-Embedder-Policy': 'require-corp',
			'Cross-Origin-Opener-Policy': 'same-origin'
		},
		fs: {
			allow: [searchForWorkspaceRoot(process.cwd()), resolve(__dirname, 'tests')]
		}
	}
});
