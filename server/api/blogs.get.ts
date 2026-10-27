/**
 * GET /api/blogs
 *
 * Returns a lightweight list of all generated blogs.
 * The page index (pages/index.vue) calls this to render the blog listing.
 *
 * Returns only the metadata needed for the listing — not the full content —
 * so the response stays small even with many blogs.
 */

import type { BlogEntry } from '../utils/pipeline'

export default defineEventHandler(async () => {
  const storage = useStorage('blogs')

  // getKeys() returns all slugs stored in the 'blogs' namespace
  const keys = await storage.getKeys()

  // Fetch each blog entry and extract only the listing metadata
  const listings = await Promise.all(
    keys.map(async (key) => {
      const entry = await storage.getItem<BlogEntry>(key)
      if (!entry) return null

      return {
        slug: entry.slug,
        title: entry.copy.title,
        metaDescription: entry.copy.metaDescription,
        industry: entry.industry,
        createdAt: entry.createdAt,
        count: entry.stats.count,
        metricTotal: entry.stats.metricTotal,
        metricCurrency: entry.stats.metricCurrency,
      }
    }),
  )

  // Filter out any null entries (corrupt storage) and sort newest first
  return listings
    .filter(Boolean)
    .sort((a, b) => new Date(b!.createdAt).getTime() - new Date(a!.createdAt).getTime())
})
