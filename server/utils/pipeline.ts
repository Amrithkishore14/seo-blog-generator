/**
 * pipeline.ts
 *
 * Orchestrates the full CSV → Blog pipeline:
 *   1. Parse CSV text into rows
 *   2. Detect column roles automatically (+ apply any manual overrides)
 *   3. Compute statistics (pure code — no AI)
 *   4. Generate SEO copy via LLM (or fallback template)
 *   5. Return a structured BlogEntry ready to be stored and rendered
 *
 * This function is called by both:
 *   - server/api/generate.post.ts (via useStorage for persistence)
 *   - scripts/seed.ts (via direct fs write)
 *
 * Having the pipeline in a separate file means the API route and seed script
 * share exactly the same logic — no duplication.
 */

import { parseCsv, detectColumns, computeStats, formatMoney, slugify } from './analyseDataset'
import { generateCopy } from './generateCopy'
import type { ColumnRoles, ColumnRole, DatasetStats } from './analyseDataset'
import type { GeneratedCopy } from './generateCopy'

// ── BlogEntry: the document saved to storage & served to the page ─────────────

export interface BlogEntry {
  slug: string
  industry: string
  createdAt: string // ISO 8601 timestamp

  copy: GeneratedCopy // AI-generated (or fallback) prose
  stats: DatasetStats // All numbers, computed in code
  columns: ColumnRoles // Detected column metadata
  rows: Record<string, string>[] // ALL original rows (for the table)

  // Resolved column headers used by the blog template for display
  nameHeader: string
  rankHeader: string | null
  metricHeader: string | null
  regionHeader: string | null
  descriptionHeader: string | null
  websiteHeader: string | null
  industriesHeader: string | null

  usedFallback: boolean // true if LLM failed and template was used
}

// ── PipelineInput ─────────────────────────────────────────────────────────────

export interface PipelineInput {
  csvText: string
  industryName?: string // Provided by the user; inferred from filename if absent
  /** Override detected column roles: { "Funding (USD)": "metric", "Name": "name" } */
  columnOverrides?: Record<string, ColumnRole>
}

export interface PipelineConfig {
  geminiApiKey?: string
  llmProvider?: 'gemini' | 'ollama'
  ollamaUrl?: string
}

// ── Validation errors ─────────────────────────────────────────────────────────

export class PipelineError extends Error {
  constructor(
    message: string,
    public readonly code: 'NO_NAME_COLUMN' | 'NO_METRIC_COLUMN' | 'EMPTY_CSV' | 'PARSE_ERROR',
  ) {
    super(message)
    this.name = 'PipelineError'
  }
}

// ── Main pipeline function ────────────────────────────────────────────────────

export async function runPipeline(
  input: PipelineInput,
  config: PipelineConfig = {},
): Promise<BlogEntry> {
  // Step 1: Parse CSV ──────────────────────────────────────────────────────────
  let headers: string[]
  let rows: Record<string, string>[]

  try {
    const parsed = parseCsv(input.csvText)
    headers = parsed.headers
    rows = parsed.rows
  } catch (err) {
    throw new PipelineError(`Failed to parse CSV: ${err}`, 'PARSE_ERROR')
  }

  if (rows.length === 0) {
    throw new PipelineError('The CSV file is empty or has no data rows.', 'EMPTY_CSV')
  }

  // Step 2: Detect column roles ────────────────────────────────────────────────
  const columns = detectColumns(headers, rows)

  // Apply any manual overrides from the upload UI dropdown
  if (input.columnOverrides) {
    for (const [header, role] of Object.entries(input.columnOverrides)) {
      if (columns[header]) {
        columns[header] = { ...columns[header], role }
      }
    }
  }

  // Validate that we have the minimum required columns
  const hasNameCol = Object.values(columns).some((c) => c.role === 'name')
  const hasMetricCol = Object.values(columns).some((c) => c.role === 'metric')

  if (!hasNameCol) {
    throw new PipelineError(
      'Could not detect a company/name column. Please use the column-mapping tool to mark the name column.',
      'NO_NAME_COLUMN',
    )
  }
  if (!hasMetricCol) {
    throw new PipelineError(
      'Could not detect a numeric metric column (e.g. funding, revenue). Please use the column-mapping tool to mark the metric column.',
      'NO_METRIC_COLUMN',
    )
  }

  // Step 3: Compute stats ──────────────────────────────────────────────────────
  const stats = computeStats(rows, columns)

  // Step 4: Build top-10 rows for the AI prompt ────────────────────────────────
  const nameHeader = Object.values(columns).find((c) => c.role === 'name')?.header ?? headers[0]
  const rankHeader = Object.values(columns).find((c) => c.role === 'rank')?.header ?? null
  const metricHeader = Object.values(columns).find((c) => c.role === 'metric')?.header ?? null
  const regionHeader = Object.values(columns).find((c) => c.role === 'region')?.header ?? null
  const descriptionHeader =
    Object.values(columns).find((c) => c.role === 'description')?.header ?? null
  const websiteHeader = Object.values(columns).find((c) => c.role === 'website')?.header ?? null
  const industriesHeader =
    Object.values(columns).find((c) => c.role === 'industries')?.header ??
    Object.values(columns).find((c) => c.role === 'category')?.header ??
    null

  // Sort rows by metric descending and take the top 10 for the prompt
  const rowsSortedByMetric = [...rows].sort((a, b) => {
    const av = metricHeader ? parseMetricValue(a[metricHeader] ?? '') : 0
    const bv = metricHeader ? parseMetricValue(b[metricHeader] ?? '') : 0
    return bv - av
  })

  const top10 = rowsSortedByMetric.slice(0, 10).map((row) => ({
    name: row[nameHeader] ?? '',
    metric: metricHeader
      ? formatMoney(parseMetricValue(row[metricHeader] ?? ''), stats.metricCurrency, true)
      : '',
    region: regionHeader ? (row[regionHeader] ?? '') : '',
    description: descriptionHeader ? (row[descriptionHeader] ?? '').slice(0, 120) : '',
  }))

  // Infer the industry name from the input or generate a sensible default
  const industry = input.industryName?.trim() || inferIndustry(stats, columns) || 'Technology'

  // Step 5: Generate LLM copy ──────────────────────────────────────────────────
  const { copy, usedFallback } = await generateCopy({
    industry,
    stats,
    top10,
    geminiApiKey: config.geminiApiKey,
    llmProvider: config.llmProvider,
    ollamaUrl: config.ollamaUrl,
  })

  // Step 6: Build the BlogEntry document ───────────────────────────────────────
  const slug = copy.slug || slugify(`${industry}-companies`)
  const createdAt = new Date().toISOString()

  return {
    slug,
    industry,
    createdAt,
    copy,
    stats,
    columns,
    rows,
    nameHeader,
    rankHeader,
    metricHeader,
    regionHeader,
    descriptionHeader,
    websiteHeader,
    industriesHeader,
    usedFallback,
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Parse a raw cell value as a number, supporting both money strings and
 * plain numbers.  Returns 0 for unparseable values.
 */
function parseMetricValue(raw: string): number {
  if (!raw) return 0
  // Try money format first (strips currency symbols, handles k/m/bn)
  const stripped = raw.replace(/[£$€,\s]/g, '')
  let num = parseFloat(stripped.replace(/[kmbn]+$/i, ''))
  if (isNaN(num)) return 0
  if (/bn$/i.test(stripped)) num *= 1_000_000_000
  else if (/m$/i.test(stripped)) num *= 1_000_000
  else if (/k$/i.test(stripped)) num *= 1_000
  return num
}

/**
 * Attempt to guess the industry name from the most common category tag.
 * E.g. if "Fintech" appears frequently, we use that.
 * This is a last resort — the user-supplied name always takes priority.
 */
function inferIndustry(stats: DatasetStats, _columns: ColumnRoles): string | null {
  // The topCategories list is already filtered to exclude near-universal tags.
  // Use the first tag as a rough proxy for the industry.
  if (stats.topCategories.length > 0) {
    return stats.topCategories[0].tag
  }
  return null
}
