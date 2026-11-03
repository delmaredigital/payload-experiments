import { defineConfig } from 'vitest/config'

// Visual fixtures write HTML outside the repo and are never part of `pnpm test`.
// Run with `pnpm fixtures:puck-editor` or `pnpm fixtures:admin-nav`.
export default defineConfig({
  test: {
    projects: [
      {
        resolve: { conditions: ['@delmaredigital/source', 'module', 'browser', 'development|production'] },
        ssr: { resolve: { conditions: ['@delmaredigital/source', 'module', 'node', 'development|production'] } },
        test: {
          name: 'plugin-fixtures',
          // The public UI barrel imports the cropper's stylesheet. Let Vite handle it.
          server: { deps: { inline: ['@payloadcms/ui', 'react-image-crop'] } },
          root: 'packages/plugin',
          globals: true,
          environment: 'node',
          include: ['tests-fixtures/**/*.fixture.tsx'],
        },
      },
    ],
  },
})
