/**
 * GET /api/__sitemap__/urls
 *
 * Called by @nuxtjs/sitemap during sitemap.xml generation.
 * Returns one { loc } object per generated blog so search engines
 * can discover all dynamically created pages.
 *
 * The path /api/__sitemap__/urls is the convention used by @nuxtjs/sitemap v4+.
 * It is configured as a source in nuxt.config.ts → sitemap.sources.
 */

import type { BlogEntry } from '../../utils/pipeline'

export default defineEventHandler(async () => {
  const storage = useStorage('blogs')
  const keys = await storage.getKeys()

  const entries = await Promise.all(keys.map((key) => storage.getItem<BlogEntry>(key)))

  return entries.filter(Boolean).map((entry) => ({
    loc: `/blog/${entry!.slug}`,
    lastmod: entry!.createdAt,
    changefreq: 'monthly',
    priority: 0.8,
  }))
})
