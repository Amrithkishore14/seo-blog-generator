/**
 * POST /api/admin/logout
 *
 * Clears the auth cookie.
 */

export default defineEventHandler((event) => {
  deleteCookie(event, 'auth', { path: '/' })
  return sendRedirect(event, '/admin/login', 302)
})
