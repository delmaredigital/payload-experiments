import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      {
        resolve: {
          conditions: ['@delmaredigital/source', 'module', 'browser', 'development|production'],
        },
        ssr: {
          resolve: {
            conditions: ['@delmaredigital/source', 'module', 'node', 'development|production'],
          },
        },
        test: {
          name: 'plugin-integration',
          root: 'packages/plugin',
          include: ['tests-integration/**/*.itest.ts'],
          environment: 'node',
          globals: true,
          pool: 'forks',
          fileParallelism: false,
          testTimeout: 60_000,
          hookTimeout: 60_000,
          env: { NODE_ENV: 'test' },
        },
      },
    ],
  },
})
