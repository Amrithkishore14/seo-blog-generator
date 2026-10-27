/**
 * GET /api/blogs/:slug
 *
 * Returns the full BlogEntry for a single generated blog.
 * The blog page (pages/blog/[slug].vue) calls this via useFetch.
 *
 * Returns 404 if the slug doesn't exist in storage.
 */

import type { BlogEntry } from '../../utils/pipeline'

export default defineEventHandler(async (event) => {
  // getRouterParam extracts the [slug] segment from the URL
  const slug = getRouterParam(event, 'slug')

  if (!slug) {
    throw createError({ statusCode: 400, statusMessage: 'Slug is required.' })
  }

  const storage = useStorage('blogs')
  const entry = await storage.getItem<BlogEntry>(slug)

  if (!entry) {
    throw createError({
      statusCode: 404,
      statusMessage: `No blog found for slug: ${slug}`,
    })
  }

  return entry
})
