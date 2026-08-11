import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		coverage: {
			provider: 'v8',
			include: ['src/**/*.ts'],
			exclude: ['src/**/*.test.ts', 'src/integration/**'],
			reporter: ['text', 'json-summary', 'lcov', 'cobertura'],
			reportsDirectory: 'test-results/coverage',
		},
		environment: 'node',
		retry: process.env.CI ? 2 : 0,
	},
});
