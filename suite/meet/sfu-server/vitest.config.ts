import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['src/**/*.test.ts'],
		retry: process.env.CI ? 2 : 0,
		silent: true,
		coverage: {
			provider: 'v8',
			include: ['src/**/*.ts'],
			exclude: ['src/**/*.test.ts', 'src/**/__tests__/**'],
			reporter: ['text', 'json-summary', 'lcov', 'cobertura'],
			reportsDirectory: 'test-results/coverage',
		},
	},
});
