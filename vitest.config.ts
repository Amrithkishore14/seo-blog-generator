import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Run tests in a Node.js environment (not jsdom) since we're
    // testing server-side utility functions.
    environment: 'node',

    // Glob pattern for test files
    include: ['tests/**/*.test.ts'],

    // Show verbose output so each assertion is visible in the interview demo
    reporter: 'verbose',
  },

  // Resolve TypeScript paths so imports like '../server/utils/analyseDataset'
  // work correctly without going through Nuxt's build pipeline.
  resolve: {
    alias: {},
  },
})
