import { defineConfig } from 'vitest/config'

// Visual fixtures for the Puck editor chrome. They write HTML outside the repo and
// are never part of `pnpm test`; run with `pnpm fixtures:puck-editor`.
export default defineConfig({
  test: {
    projects: [
      {
        resolve: { conditions: ['@delmaredigital/source', 'module', 'browser', 'development|production'] },
        ssr: { resolve: { conditions: ['@delmaredigital/source', 'module', 'node', 'development|production'] } },
        test: {
          name: 'plugin-fixtures',
          root: 'packages/plugin',
          globals: true,
          environment: 'node',
          include: ['tests-fixtures/**/*.fixture.tsx'],
        },
      },
    ],
  },
})
