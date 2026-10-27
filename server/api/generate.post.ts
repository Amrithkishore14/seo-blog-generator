/**
 * POST /api/generate
 *
 * Accepts a multipart form upload with:
 *   - file:    the CSV file (required)
 *   - industry: human-readable industry name (optional)
 *   - columnOverrides: JSON string of { [header]: ColumnRole } (optional)
 *
 * Pipeline: CSV → parse → detect columns → stats → AI copy → save → return slug
 */

import { runPipeline, PipelineError } from '../utils/pipeline'
import type { ColumnRole } from '../utils/analyseDataset'

export default defineEventHandler(async (event) => {
  // ── Read multipart form data ───────────────────────────────────────────────
  const parts = await readMultipartFormData(event)
  if (!parts || parts.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'No form data received.' })
  }

  // Extract each field by name
  const filePart = parts.find((p) => p.name === 'file')
  const industryPart = parts.find((p) => p.name === 'industry')
  const overridesPart = parts.find((p) => p.name === 'columnOverrides')

  // ── Validate the file ──────────────────────────────────────────────────────
  if (!filePart?.data) {
    throw createError({ statusCode: 400, statusMessage: 'No CSV file found in the upload.' })
  }

  // Check file type: must be .csv or text/csv
  const filename = filePart.filename ?? ''
  const mime = filePart.type ?? ''
  if (!filename.endsWith('.csv') && !mime.includes('csv') && !mime.includes('text/plain')) {
    throw createError({
      statusCode: 415,
      statusMessage: 'Only CSV files are accepted (.csv).',
    })
  }

  // Reject files larger than 2 MB — prevents memory exhaustion
  const MAX_BYTES = 2 * 1024 * 1024 // 2 MB
  if (filePart.data.length > MAX_BYTES) {
    throw createError({
      statusCode: 413,
      statusMessage: `File too large (${(filePart.data.length / 1024 / 1024).toFixed(1)} MB). Maximum is 2 MB.`,
    })
  }

  const csvText = filePart.data.toString('utf-8')

  // ── Parse optional fields ──────────────────────────────────────────────────
  const industryName = industryPart?.data.toString('utf-8').trim() || undefined

  let columnOverrides: Record<string, ColumnRole> | undefined
  if (overridesPart?.data) {
    try {
      columnOverrides = JSON.parse(overridesPart.data.toString('utf-8'))
    } catch {
      throw createError({
        statusCode: 400,
        statusMessage: 'columnOverrides must be valid JSON.',
      })
    }
  }

  // ── Infer industry name from filename as a last resort ─────────────────────
  // e.g. "fintech_companies_seed.csv" → "fintech"
  const inferredIndustry =
    industryName ||
    filename
      .replace(/[_-]/g, ' ')
      .replace(/\.csv$/i, '')
      .split(' ')[0] ||
    undefined

  // ── Run the full pipeline ──────────────────────────────────────────────────
  const config = useRuntimeConfig(event)

  let entry
  try {
    entry = await runPipeline(
      { csvText, industryName: inferredIndustry, columnOverrides },
      {
        geminiApiKey: config.geminiApiKey as string,
        llmProvider: (config.llmProvider as 'gemini' | 'ollama') ?? 'gemini',
        ollamaUrl: config.ollamaUrl as string,
      },
    )
  } catch (err) {
    if (err instanceof PipelineError) {
      // Known validation errors → 422 with a clear message for the UI
      throw createError({ statusCode: 422, statusMessage: err.message })
    }
    // Unexpected errors
    console.error('[/api/generate] Pipeline error:', err)
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to generate blog. Please try again.',
    })
  }

  // ── Persist to storage ─────────────────────────────────────────────────────
  // useStorage('blogs') uses the Nitro fs driver configured in nuxt.config.ts.
  // The entry is serialised to JSON automatically.
  const storage = useStorage('blogs')
  await storage.setItem(entry.slug, entry)

  return {
    slug: entry.slug,
    url: `/blog/${entry.slug}`,
    usedFallback: entry.usedFallback,
  }
})
