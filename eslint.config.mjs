// @ts-check
import { createConfigForNuxt } from '@nuxt/eslint-config/flat'
import eslintConfigPrettier from 'eslint-config-prettier'

export default createConfigForNuxt({
  features: {
    stylistic: false, // Prettier handles formatting
  },
}).append(
  eslintConfigPrettier,
  {
    rules: {
      // Allow console.warn / console.error in server utilities
      'no-console': ['warn', { allow: ['warn', 'error', 'log'] }],
    },
  },
)
