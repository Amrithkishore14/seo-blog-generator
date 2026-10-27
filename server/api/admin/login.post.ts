/**
 * POST /api/admin/login
 *
 * Validates the submitted password against the ADMIN_PASSWORD secret.
 * On success, sets an HTTP-only 'auth' cookie containing a HMAC-derived
 * session token valid for 7 days.
 *
 * The endpoint is intentionally unprotected so unauthenticated users can reach it.
 */

import { computeSessionToken } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  const { password } = await readBody<{ password: string }>(event)
  const config = useRuntimeConfig(event)

  if (!config.adminPassword) {
    // Admin password not configured — should not happen in production
    throw createError({ statusCode: 500, statusMessage: 'ADMIN_PASSWORD is not configured.' })
  }

  if (!password || password !== config.adminPassword) {
    throw createError({ statusCode: 401, statusMessage: 'Incorrect password.' })
  }

  const token = await computeSessionToken(config.adminPassword)

  setCookie(event, 'auth', token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 24 * 7, // 7 days
    path: '/',
  })

  return { ok: true }
})
