// nuxt.config.ts
// Central configuration for the Nuxt 3 application.
// See https://nuxt.com/docs/api/configuration/nuxt-config

export default defineNuxtConfig({
  devtools: { enabled: true },

  // ── Modules ─────────────────────────────────────────────────────────────────
  modules: [
    '@nuxtjs/tailwindcss', // Tailwind CSS integration
    '@nuxtjs/sitemap', // Auto-generates /sitemap.xml
  ],

  // ── Site URL (read by @nuxtjs/sitemap via nuxt-site-config) ─────────────────
  // @nuxtjs/sitemap v5 reads `site.url` (not runtimeConfig.public.siteUrl) to
  // build absolute <loc> entries.  Without this the module falls back to the
  // request host, which produces malformed IPv6-style URLs in dev.
  site: {
    url: process.env.NUXT_PUBLIC_SITE_URL ?? 'http://localhost:3000',
  },

  // ── Sitemap ──────────────────────────────────────────────────────────────────
  // Tell @nuxtjs/sitemap where to fetch dynamic URLs.
  // The source endpoint returns one { loc } object per generated blog.
  // Exclude /admin/** — noindexed pages should not appear in the sitemap at all
  // (a noindexed URL in the sitemap triggers a Google Search Console warning).
  sitemap: {
    exclude: ['/admin/**'],
    sources: ['/api/__sitemap__/urls'],
  },

  // ── Runtime config ───────────────────────────────────────────────────────────
  // `runtimeConfig` splits secrets from public values.
  // Keys under the top-level object are SERVER-ONLY (never sent to the browser).
  // Keys under `public` are shared with the client bundle.
  runtimeConfig: {
    geminiApiKey: process.env.GEMINI_API_KEY ?? '', // secret — stays on server
    llmProvider: process.env.LLM_PROVIDER ?? 'gemini', // 'gemini' | 'ollama'
    ollamaUrl: process.env.OLLAMA_URL ?? 'http://localhost:11434',

    public: {
      siteUrl: process.env.NUXT_PUBLIC_SITE_URL ?? 'http://localhost:3000',
    },
  },

  // ── Nitro (server engine) ────────────────────────────────────────────────────
  // Register a named storage bucket called "blogs".
  // The `fs` driver persists JSON files to ./.data/blogs/ on disk.
  // In production on serverless platforms, swap the driver for
  // Netlify Blobs, Vercel KV, or Cloudflare KV.
  nitro: {
    storage: {
      blogs: {
        driver: 'fs',
        base: './.data/blogs',
      },
    },

    // Pre-compress public static assets (JS/CSS chunks) at build time.
    // The node-server preset will serve the .gz versions automatically when
    // the client sends Accept-Encoding: gzip.
    compressPublicAssets: { gzip: true, brotli: true },

    // Route rules: add Cache-Control headers so CDN/browser can cache blog pages.
    // We deliberately avoid `swr:` here — Nitro's SWR proxy serves cached HTML
    // via sendStream which bypasses the compression middleware's res.write hooks.
    routeRules: {
      '/blog/**': {
        headers: {
          'cache-control': 'public, max-age=60, stale-while-revalidate=3600',
        },
      },
      '/api/blogs/**': {
        headers: { 'cache-control': 'public, max-age=60, stale-while-revalidate=3600' },
      },
    },
  },

  // ── App head defaults ────────────────────────────────────────────────────────
  // Set lang="en-GB" once globally so every page is correctly attributed.
  app: {
    head: {
      htmlAttrs: { lang: 'en-GB' },
      meta: [{ name: 'viewport', content: 'width=device-width, initial-scale=1' }],
    },
  },

  // Ensure TypeScript strict mode
  typescript: {
    strict: true,
  },

  compatibilityDate: '2024-11-01',
})
