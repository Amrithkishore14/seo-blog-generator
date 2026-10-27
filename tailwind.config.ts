import type { Config } from 'tailwindcss'

// tailwind.config.ts
// @nuxtjs/tailwindcss auto-detects Vue/TS files; this config just extends the theme.
export default {
  content: [
    './components/**/*.{js,vue,ts}',
    './layouts/**/*.vue',
    './pages/**/*.vue',
    './app.vue',
    './error.vue',
  ],
  theme: {
    extend: {
      // Custom colours could go here for different industry datasets
    },
  },
  plugins: [],
} satisfies Config
