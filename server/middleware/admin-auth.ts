/**
 * server/middleware/admin-auth.ts
 *
 * Guards /admin/** (except /admin/login) and POST /api/generate behind
 * an HTTP-only auth cookie.
 *
 * Fail-closed: when ADMIN_PASSWORD is not set and NODE_ENV !== 'development',
 * protected routes return 503 (API) or redirect to /admin/login (pages).
 * Local dev (NODE_ENV=development) is the only context where a missing password
 * is treated as "no auth required".
 * In production, set the secret via:
 *   wrangler pages secret put ADMIN_PASSWORD --project-name seo-blog-generator
 *
 * Cookie flow:
 *   1. Visitor hits /admin/upload → this middleware redirects to /admin/login
 *   2. User submits password → POST /api/admin/login sets the 'auth' cookie
 *   3. Subsequent requests include the cookie → middleware allows through
 */

import { computeSessionToken } from '../utils/auth'

export default defineEventHandler(async (event) => {
  const path = getRequestURL(event).pathname

  // Guard admin pages and the blog-generation/preview endpoints
  const isProtected =
    (path.startsWith('/admin/') && path !== '/admin/login') ||
    path === '/api/generate' ||
    path === '/api/preview'

  if (!isProtected) return

  const { adminPassword } = useRuntimeConfig(event)

  // Fail-closed: if no password is configured outside of local dev, block access.
  // This prevents a missing Cloudflare secret from silently opening protected routes.
  if (!adminPassword) {
    if (process.env.NODE_ENV === 'development') return
    if (path.startsWith('/api/')) {
      throw createError({
        statusCode: 503,
        statusMessage: 'Service misconfigured — ADMIN_PASSWORD secret not set',
      })
    }
    return sendRedirect(event, '/admin/login', 302)
  }

  const cookie = getCookie(event, 'auth')
  const expected = await computeSessionToken(adminPassword)

  if (cookie !== expected) {
    if (path.startsWith('/api/')) {
      throw createError({ statusCode: 401, statusMessage: 'Unauthorized — visit /admin/login' })
    }
    return sendRedirect(event, '/admin/login', 302)
  }
})
