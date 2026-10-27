// nuxt.config.ts
// Central configuration for the Nuxt 3 application.
// See https://nuxt.com/docs/api/configuration/nuxt-config

// When NITRO_PRESET=cloudflare-pages, production storage switches to Cloudflare KV.
// Local dev always uses the fs driver regardless of this flag.
const isCloudflare = (process.env.NITRO_PRESET ?? '').includes('cloudflare')

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
    // Empty string = no auth required (local dev). Set via Cloudflare secret in production.
    adminPassword: process.env.ADMIN_PASSWORD ?? '',

    public: {
      siteUrl: process.env.NUXT_PUBLIC_SITE_URL ?? 'http://localhost:3000',
    },
  },

  // ── Nitro (server engine) ────────────────────────────────────────────────────
  nitro: {
    // Storage split: Cloudflare KV in production builds, fs on disk everywhere else.
    //
    //   nuxt dev                                → devStorage → fs (.data/blogs/)
    //   nuxt build (no preset)                  → storage    → fs (.data/blogs/)
    //   NITRO_PRESET=cloudflare-pages nuxt build → storage    → Cloudflare KV (binding: BLOGS)
    //
    // The KV binding name "BLOGS" must match wrangler.toml [[kv_namespaces]] binding.
    storage: isCloudflare
      ? { blogs: { driver: 'cloudflare-kv-binding', binding: 'BLOGS' } }
      : { blogs: { driver: 'fs', base: './.data/blogs' } },

    // devStorage overrides storage during `nuxt dev` only — always fs so local
    // development requires no Cloudflare account.
    devStorage: {
      blogs: { driver: 'fs', base: './.data/blogs' },
    },

    // Pre-compress public static assets (JS/CSS chunks) at build time.
    compressPublicAssets: { gzip: true, brotli: true },

    // Route rules: Cache-Control headers for CDN/browser caching.
    routeRules: {
      '/blog/**': {
        headers: { 'cache-control': 'public, max-age=60, stale-while-revalidate=3600' },
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
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        // Default og:image — individual blog pages override this via useSeoMeta.
        {
          property: 'og:image',
          content: `${process.env.NUXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'}/og-image.svg`,
        },
        {
          name: 'twitter:image',
          content: `${process.env.NUXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'}/og-image.svg`,
        },
      ],
    },
  },

  // Ensure TypeScript strict mode
  typescript: {
    strict: true,
  },

  compatibilityDate: '2024-11-01',
})
