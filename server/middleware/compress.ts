/**
 * server/middleware/compress.ts
 *
 * Adds gzip compression to all server responses.
 * Nitro's Node.js preset does not compress SSR HTML by default.
 * Without this, the 165 KB fintech blog HTML is sent uncompressed to mobile
 * browsers, producing a slow First Contentful Paint (~3 s on simulated 4G).
 * With gzip the same document compresses to ~22 KB — a 7× reduction.
 *
 * Strategy: buffer all response body chunks, then compress with gzipSync in
 * the res.end hook and send the compressed data in one write.  The synchronous
 * approach avoids the race condition that can truncate a streaming gzip when
 * Nitro calls write() and end() close together on the same tick.
 */

import { gzipSync } from 'node:zlib'

export default defineEventHandler((event) => {
  const ae = getRequestHeader(event, 'accept-encoding') ?? ''

  // Only compress if the client supports gzip (all modern browsers do).
  if (!ae.includes('gzip')) return

  const res = event.node.res

  // Capture original methods before overriding them.
  const origWrite = res.write.bind(res) as typeof res.write
  const origEnd = res.end.bind(res) as typeof res.end

  // Collect every chunk written to the response.
  const chunks: Buffer[] = []

  // Override write — accumulate instead of sending immediately.
  // @ts-expect-error — narrowing Node.js write overloads
  res.write = (chunk: unknown) => {
    if (chunk != null) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string))
    }
    return true
  }

  // Override end — compress everything at once, then send.
  // @ts-expect-error — narrowing Node.js end() overloads (chunk, encoding, callback)
  res.end = (chunk?: unknown) => {
    if (chunk != null && typeof chunk !== 'function') {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string))
    }

    try {
      const body = Buffer.concat(chunks)
      const compressed = gzipSync(body, { level: 6 })
      res.setHeader('content-encoding', 'gzip')
      res.setHeader('vary', 'Accept-Encoding')
      res.setHeader('content-length', compressed.byteLength)
      origWrite(compressed)
    } catch {
      // If compression fails (e.g. already-compressed assets), send raw
      origWrite(Buffer.concat(chunks))
    }

    origEnd()
    return res
  }
})
