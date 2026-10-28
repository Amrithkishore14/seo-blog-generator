/**
 * analyseDataset.ts
 *
 * Pure utility functions for CSV parsing, column-role detection, and
 * statistical analysis. Zero AI involvement here — all numbers shown on
 * the generated blog page come from this file, not from the LLM.
 *
 * "Pure" means: no Nuxt/Nitro imports, no side-effects, easily unit-tested.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * The semantic role a column plays in the dataset.
 * Used to map arbitrary column names ("Funding (USD)", "Total Raised", etc.)
 * onto a consistent interface so the blog template is industry-agnostic.
 */
export type ColumnRole =
  | 'name' // Company / organisation name
  | 'rank' // Position in ranking
  | 'metric' // Primary numeric value (funding, revenue, valuation …)
  | 'region' // Geographic location
  | 'category' // Single-value tag (sector, stage, …)
  | 'industries' // Multi-value tag, semicolon-separated
  | 'size' // Employee count or band
  | 'stage' // Funding round / phase
  | 'description' // Free-text description
  | 'website' // URL
  | 'unknown' // Could not infer

/**
 * The data type of the values in a column.
 * Used both for display formatting and for driving stat calculations.
 */
export type ColumnType =
  | 'money' // Currency string: "£30,314,247" / "$2.1m" / "€500k"
  | 'number' // Plain numeric: "42", "1500"
  | 'category' // Short string: "London", "Seed"
  | 'multi_category' // Semicolon-separated tags: "Banking; Payments"
  | 'url' // HTTP(S) URL
  | 'text' // Long free-text
  | 'constant' // Every row has the same value (e.g. Stage = "Seed")

/** Full metadata for one column. */
export interface ColumnInfo {
  header: string // Original header as it appears in the CSV
  role: ColumnRole
  type: ColumnType
}

/** Map of header → column metadata, returned by detectColumns. */
export type ColumnRoles = Record<string, ColumnInfo>

/** Result of parsing a money string. */
export interface ParsedMoney {
  amount: number // Normalised to full units (e.g. 30_314_247 not pence)
  currency: string // '£' | '$' | '€' | '' (for unknown)
}

// ── parseCsv ─────────────────────────────────────────────────────────────────

/**
 * Parse raw CSV text into a list of row objects.
 *
 * Inline RFC 4180-compliant parser — replaces PapaParse to avoid a Rollup
 * parse error in the Cloudflare Pages build.  PapaParse's UMD bundle contains
 * embedded web-worker creation code that @rollup/plugin-commonjs cannot
 * parse when bundling for the Workers runtime.
 *
 * Handles: quoted fields (commas/newlines/doubled-quotes inside), BOM,
 * CRLF/LF/CR line endings, blank lines (skipped), header + cell trimming.
 */
export function parseCsv(text: string): {
  headers: string[]
  rows: Record<string, string>[]
} {
  // Strip UTF-8 BOM if present
  const src = text.startsWith('\uFEFF') ? text.slice(1) : text
  const records = parseRecords(src)
  if (records.length === 0) return { headers: [], rows: [] }

  const headers = records[0].map((h) => h.trim())
  const rows = records.slice(1).map((cells) => {
    const row: Record<string, string> = {}
    for (let i = 0; i < headers.length; i++) {
      row[headers[i]] = (cells[i] ?? '').trim()
    }
    return row
  })

  return { headers, rows }
}

/** Core RFC 4180 tokeniser — returns a 2-D array of raw cell strings. */
function parseRecords(src: string): string[][] {
  const records: string[][] = []
  let pos = 0
  const len = src.length

  while (pos < len) {
    const record = parseRecord()
    // Skip blank lines (a single empty field with no content)
    if (record.length > 1 || (record.length === 1 && record[0] !== '')) {
      records.push(record)
    }
  }

  return records

  function parseRecord(): string[] {
    const fields: string[] = []
    while (pos < len) {
      fields.push(parseField())
      if (pos < len && src[pos] === ',') {
        pos++ // comma → another field follows
      } else {
        // End of record: consume optional CRLF / LF / CR
        if (pos < len && src[pos] === '\r') pos++
        if (pos < len && src[pos] === '\n') pos++
        break
      }
    }
    return fields
  }

  function parseField(): string {
    if (pos < len && src[pos] === '"') {
      // Quoted field — may contain commas, newlines, doubled-quote escapes
      pos++ // consume opening quote
      let value = ''
      while (pos < len) {
        if (src[pos] === '"') {
          if (pos + 1 < len && src[pos + 1] === '"') {
            value += '"' // escaped quote ("" → ")
            pos += 2
          } else {
            pos++ // closing quote
            break
          }
        } else {
          value += src[pos++]
        }
      }
      return value
    }

    // Unquoted field — read until comma, CR, LF, or EOF
    const start = pos
    while (pos < len && src[pos] !== ',' && src[pos] !== '\r' && src[pos] !== '\n') {
      pos++
    }
    return src.slice(start, pos)
  }
}

// ── parseMoney ────────────────────────────────────────────────────────────────

/**
 * Convert a human-readable money string into a numeric amount.
 *
 * Handles:
 *   "£30,314,247"  → { amount: 30_314_247, currency: '£' }
 *   "$2.1m"        → { amount: 2_100_000,  currency: '$' }
 *   "€500k"        → { amount: 500_000,    currency: '€' }
 *   "£1.5bn"       → { amount: 1_500_000_000, currency: '£' }
 *   "N/A" / ""     → null
 */
export function parseMoney(value: string): ParsedMoney | null {
  if (!value) return null
  const v = value.trim()
  if (v === '' || v.toLowerCase() === 'n/a' || v === '-') return null

  // Detect currency symbol — default to £ if none found (UK context)
  let currency = ''
  if (v.startsWith('£')) currency = '£'
  else if (v.startsWith('$')) currency = '$'
  else if (v.startsWith('€')) currency = '€'
  // Some datasets put the symbol elsewhere; scan the string
  else if (v.includes('£')) currency = '£'
  else if (v.includes('$')) currency = '$'
  else if (v.includes('€')) currency = '€'

  // Strip currency symbols and thousands commas
  let numStr = v.replace(/[£$€,\s]/g, '')

  // Handle k / m / bn suffix (case-insensitive)
  let multiplier = 1
  if (/bn$/i.test(numStr)) {
    multiplier = 1_000_000_000
    numStr = numStr.replace(/bn$/i, '')
  } else if (/m$/i.test(numStr)) {
    multiplier = 1_000_000
    numStr = numStr.replace(/m$/i, '')
  } else if (/k$/i.test(numStr)) {
    multiplier = 1_000
    numStr = numStr.replace(/k$/i, '')
  }

  const amount = parseFloat(numStr)
  if (isNaN(amount) || amount < 0) return null

  return { amount: amount * multiplier, currency }
}

// ── detectColumns ─────────────────────────────────────────────────────────────

/**
 * Infer the role and type of every column in the CSV.
 *
 * Strategy (two-pass):
 *   1. Sniff value patterns from the first 20 rows → determine ColumnType
 *   2. Match the header name against keyword lists → determine ColumnRole
 *
 * The caller can override any role assignment from the upload UI.
 */
export function detectColumns(headers: string[], rows: Record<string, string>[]): ColumnRoles {
  const roles: ColumnRoles = {}

  for (const header of headers) {
    // Collect up to 20 non-empty sample values for this column
    const samples = rows
      .slice(0, 20)
      .map((r) => r[header] ?? '')
      .filter(Boolean)

    const type = classifyColumnType(header, samples, rows.length)
    const role = classifyColumnRole(header, type, samples)

    roles[header] = { header, role, type }
  }

  return roles
}

/**
 * Determine the data type of a column from a sample of its values.
 */
function classifyColumnType(header: string, samples: string[], _totalRows: number): ColumnType {
  if (samples.length === 0) return 'text'

  // --- Header-name shortcut: well-known long-text headers are always 'text' ---
  // This fires before content sniffing so short test samples don't fool us.
  if (/^(description|about|summary|overview|bio|blurb|detail)$/i.test(header)) return 'text'

  // --- Constant: all sampled values are identical ---
  // Require at least 2 samples to avoid single-row false positives.
  const unique = new Set(samples)
  if (unique.size === 1 && samples.length >= 2) return 'constant'

  // --- URL ---
  const urlCount = samples.filter((v) => /^https?:\/\//i.test(v)).length
  if (urlCount / samples.length > 0.7) return 'url'

  // --- Money ---
  // Matches leading currency symbol OR trailing currency letter suffixes
  const moneyCount = samples.filter((v) => /^[£$€]/.test(v) || /\d[kmbn]+$/i.test(v)).length
  if (moneyCount / samples.length > 0.5) return 'money'

  // --- Multi-category: contains semicolons ---
  const multiCount = samples.filter((v) => v.includes(';')).length
  if (multiCount / samples.length > 0.3) return 'multi_category'

  // --- Number: pure numeric values ---
  const numCount = samples.filter((v) => v !== '' && !isNaN(Number(v))).length
  if (numCount / samples.length > 0.7) return 'number'

  // --- Text: long average character length ---
  const avgLen = samples.reduce((s, v) => s + v.length, 0) / samples.length
  if (avgLen > 60) return 'text'

  return 'category'
}

/**
 * Map a column header + type onto a semantic role.
 *
 * PRIORITY ORDER (highest first):
 *   1. Name / Rank / URL / Description  — structural columns, very specific keywords
 *   2. Size (employees / headcount)     — checked BEFORE metric to prevent
 *      'headcount' matching /count/ in the metric regex
 *   3. Stage / Round                    — checked BEFORE metric to prevent
 *      'Funding Round' matching /funding/ in the metric regex
 *   4. Region, Industries, Category
 *   5. Metric                           — broad catch for numeric/money columns
 *   6. Unknown
 */
function classifyColumnRole(header: string, type: ColumnType, _samples: string[]): ColumnRole {
  const h = header.toLowerCase()

  // 1a. Name column ──────────────────────────────────────────────────────────
  if (/^(company|name|organisation|organization|startup|firm|business)$/.test(h)) return 'name'
  if (h.includes('compan') || h.includes('name') || h.includes('org')) return 'name'

  // 1b. Rank column ──────────────────────────────────────────────────────────
  if (/^(rank|position|pos|no\.|#|number)$/.test(h)) return 'rank'

  // 1c. Website / URL ────────────────────────────────────────────────────────
  if (type === 'url') return 'website'
  if (/^(website|url|link|web|site|homepage|domain)$/.test(h)) return 'website'

  // 1d. Description ──────────────────────────────────────────────────────────
  if (type === 'text') return 'description'
  if (/^(description|about|summary|overview|bio|blurb|detail)$/.test(h)) return 'description'

  // 2. Employee size — MUST come before metric ──────────────────────────────
  // 'headcount' contains 'count' which would otherwise match the metric regex.
  if (
    /^(employees|headcount|size|staff|team|workers|people)$/.test(h) ||
    h.includes('employ') ||
    h.includes('headcount') ||
    h.includes('staff')
  )
    return 'size'

  // 3. Stage / funding round — MUST come before metric ──────────────────────
  // 'funding round' contains 'funding' which would otherwise match the metric regex.
  if (
    /^(stage|round|series|phase)$/.test(h) ||
    /funding.round|investment.stage|funding stage|latest.round/i.test(h)
  )
    return 'stage'

  // 4a. Region ───────────────────────────────────────────────────────────────
  if (
    /^(region|location|city|area|country|geography|place|headquarter|hq|based)$/.test(h) ||
    h.includes('region') ||
    h.includes('location') ||
    h.includes('city') ||
    h.includes('country')
  )
    return 'region'

  // 4b. Multi-value category (industries, tags) ─────────────────────────────
  if (type === 'multi_category') return 'industries'
  if (/^(industries|sectors|tags|vertical|categories)$/.test(h)) return 'industries'

  // 4c. Single-value category ───────────────────────────────────────────────
  if (/^(sector|category|type|kind|industry)$/.test(h)) return 'category'

  // 5. Metric: primary numeric/money ranking column ─────────────────────────
  // Checked last so specific roles (size, stage) take precedence.
  if (/total.raised|funding|raised|revenue|valuation|investment|amount|capital/i.test(h))
    return 'metric'
  if (type === 'money') return 'metric' // Any money column is a metric candidate
  // Plain numbers — only match generic score/value headers, not 'headcount' etc.
  if (type === 'number' && /^(score|value|metric|total|amount)$/i.test(h)) return 'metric'

  return 'unknown'
}

// ── computeStats ──────────────────────────────────────────────────────────────

/** The full set of statistics computed from the dataset. */
export interface DatasetStats {
  // Headline numbers
  count: number // Total rows
  metricTotal: number // Sum of metric values
  metricMean: number // Average
  metricMedian: number // Median (more robust than mean for skewed data)
  metricMin: number
  metricMax: number
  metricCurrency: string // '£' | '$' | '€' | ''

  // Ranking insights
  topCompany: string // Company name at rank 1
  gapTop1Top2: number // Funding gap between #1 and #2
  top10Share: number // % of total held by top 10

  // Breakdowns
  regionBreakdown: Array<{
    region: string
    count: number
    total: number
    share: number // share of total metric (%)
  }>
  sizeBandBreakdown: Array<{ band: string; count: number }>
  stageBreakdown: Array<{ stage: string; count: number }>

  // Tag analysis
  topCategories: Array<{ tag: string; count: number }>

  // Funding distribution buckets
  fundingBuckets: Array<{
    label: string
    min: number
    max: number // Infinity for the top bucket
    count: number
  }>

  // Traits that are the same for every row (e.g. "Stage: Seed")
  datasetTraits: string[]

  // Column labels for display — set to the original CSV headers
  metricLabel: string
  nameLabel: string
}

/**
 * Compute all statistics from rows + detected column roles.
 *
 * WHY do this in code rather than letting the LLM compute it?
 * LLMs hallucinate numbers. By computing everything here and passing only
 * the results to the AI, we guarantee accuracy.
 */
export function computeStats(rows: Record<string, string>[], roles: ColumnRoles): DatasetStats {
  // Find the column for each semantic role
  const colByRole = (role: ColumnRole) => Object.values(roles).find((c) => c.role === role)

  const metricCol = colByRole('metric')
  const regionCol = colByRole('region')
  const sizeCol = colByRole('size')
  const stageCol = colByRole('stage')
  // Industries (multi-value) or category (single-value) for tag analysis
  const tagsCol = colByRole('industries') ?? colByRole('category')
  const nameCol = colByRole('name')
  const rankCol = colByRole('rank')

  // ── Parse metric values ─────────────────────────────────────────────────────
  let currency = ''
  type MetricRow = { row: Record<string, string>; amount: number }
  const metricRows: MetricRow[] = []

  if (metricCol) {
    for (const row of rows) {
      const raw = row[metricCol.header] ?? ''

      // A metric column can be either money ("£30m") or a plain number ("42")
      if (metricCol.type === 'money') {
        const parsed = parseMoney(raw)
        if (parsed && parsed.amount >= 0) {
          if (parsed.currency) currency = parsed.currency
          metricRows.push({ row, amount: parsed.amount })
        }
      } else if (metricCol.type === 'number') {
        const amount = parseFloat(raw)
        if (!isNaN(amount)) metricRows.push({ row, amount })
      }
    }
  }

  // Infer currency from the metric column header when values carry no symbol
  if (!currency && metricCol) {
    const mh = metricCol.header
    if (/\(USD\)|USD|\$/i.test(mh)) currency = '$'
    else if (/\(EUR\)|EUR|€/i.test(mh)) currency = '€'
    else if (/\(GBP\)|GBP|£/i.test(mh)) currency = '£'
  }

  // Sort descending so index 0 is the top company
  metricRows.sort((a, b) => b.amount - a.amount)
  const amounts = metricRows.map((m) => m.amount)

  // ── Aggregate metrics ───────────────────────────────────────────────────────
  const count = rows.length
  const total = amounts.reduce((s, v) => s + v, 0)
  const mean = amounts.length > 0 ? total / amounts.length : 0

  // Median: sort ascending, pick middle value(s)
  const sorted = [...amounts].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const median =
    sorted.length === 0
      ? 0
      : sorted.length % 2 === 0
        ? (sorted[mid - 1] + sorted[mid]) / 2
        : sorted[mid]

  const min = amounts.length > 0 ? Math.min(...amounts) : 0
  const max = amounts.length > 0 ? Math.max(...amounts) : 0

  // ── Top company ─────────────────────────────────────────────────────────────
  // Prefer the explicit rank=1 row; fall back to highest-metric row
  let topCompany = ''
  if (rankCol && nameCol) {
    const rank1 = rows.find((r) => r[rankCol.header]?.trim() === '1')
    topCompany = rank1?.[nameCol.header] ?? ''
  }
  if (!topCompany && metricRows.length > 0 && nameCol) {
    topCompany = metricRows[0].row[nameCol.header] ?? ''
  }

  const gapTop1Top2 = amounts.length >= 2 ? amounts[0] - amounts[1] : 0

  // Top-10 share of total funding
  const top10Sum = amounts.slice(0, 10).reduce((s, v) => s + v, 0)
  const top10Share = total > 0 ? (top10Sum / total) * 100 : 0

  // ── Region breakdown ─────────────────────────────────────────────────────────
  const regionMap = new Map<string, { count: number; total: number }>()
  for (const row of rows) {
    const region = regionCol ? row[regionCol.header]?.trim() || 'Unknown' : 'Unknown'
    const metricEntry = metricRows.find((m) => m.row === row)
    const existing = regionMap.get(region) ?? { count: 0, total: 0 }
    regionMap.set(region, {
      count: existing.count + 1,
      total: existing.total + (metricEntry?.amount ?? 0),
    })
  }

  const regionBreakdown = [...regionMap.entries()]
    .map(([region, data]) => ({
      region,
      count: data.count,
      total: data.total,
      share: total > 0 ? (data.total / total) * 100 : 0,
    }))
    .sort((a, b) => b.total - a.total)

  // ── Size band breakdown ──────────────────────────────────────────────────────
  const sizeMap = new Map<string, number>()
  if (sizeCol) {
    for (const row of rows) {
      const band = row[sizeCol.header]?.trim() || 'Unknown'
      sizeMap.set(band, (sizeMap.get(band) ?? 0) + 1)
    }
  }
  const sizeBandBreakdown = [...sizeMap.entries()]
    .map(([band, count]) => ({ band, count }))
    .sort((a, b) => b.count - a.count)

  // ── Stage breakdown ──────────────────────────────────────────────────────────
  const stageMap = new Map<string, number>()
  if (stageCol) {
    for (const row of rows) {
      const stage = row[stageCol.header]?.trim() || 'Unknown'
      stageMap.set(stage, (stageMap.get(stage) ?? 0) + 1)
    }
  }
  const stageBreakdown = [...stageMap.entries()]
    .map(([stage, count]) => ({ stage, count }))
    .sort((a, b) => b.count - a.count)

  // ── Top category tags ────────────────────────────────────────────────────────
  const tagMap = new Map<string, number>()
  if (tagsCol) {
    for (const row of rows) {
      const raw = row[tagsCol.header] ?? ''
      // Split on ';' for multi-value columns; single-value just wraps in array
      const tags = raw.includes(';')
        ? raw
            .split(';')
            .map((t) => t.trim())
            .filter(Boolean)
        : raw
          ? [raw.trim()]
          : []

      for (const tag of tags) {
        tagMap.set(tag, (tagMap.get(tag) ?? 0) + 1)
      }
    }
  }

  // Exclude tags that appear in more than 90% of rows — they carry no signal
  // (e.g. "Application software" appears in almost every row of the fintech set)
  const threshold = rows.length * 0.9
  const topCategories = [...tagMap.entries()]
    .filter(([, cnt]) => cnt <= threshold)
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 15) // Keep the most useful 15

  // ── Funding buckets ──────────────────────────────────────────────────────────
  const fundingBuckets = buildFundingBuckets(amounts, currency)

  // ── Dataset traits ───────────────────────────────────────────────────────────
  // Constant columns (same value for every row) make good copy context
  const datasetTraits = Object.values(roles)
    .filter((c) => c.type === 'constant')
    .map((c) => `${c.header}: ${rows[0]?.[c.header] ?? ''}`)

  return {
    count,
    metricTotal: total,
    metricMean: mean,
    metricMedian: median,
    metricMin: min,
    metricMax: max,
    metricCurrency: currency,
    topCompany,
    gapTop1Top2,
    top10Share,
    regionBreakdown,
    sizeBandBreakdown,
    stageBreakdown,
    topCategories,
    fundingBuckets,
    datasetTraits,
    metricLabel: metricCol?.header ?? 'Metric',
    nameLabel: nameCol?.header ?? 'Company',
  }
}

/**
 * Build dynamic bucket boundaries based on the dataset's max value.
 * This ensures the buckets make sense whether the metric is in thousands
 * or billions.
 */
function buildFundingBuckets(amounts: number[], currency: string): DatasetStats['fundingBuckets'] {
  if (amounts.length === 0) return []

  const max = Math.max(...amounts)

  // Choose boundaries dynamically based on scale
  let boundaries: number[]
  if (max >= 1_000_000_000) {
    boundaries = [0, 50_000_000, 100_000_000, 500_000_000, Infinity]
  } else if (max >= 100_000_000) {
    boundaries = [0, 10_000_000, 25_000_000, 50_000_000, Infinity]
  } else if (max >= 10_000_000) {
    boundaries = [0, 2_500_000, 5_000_000, 10_000_000, Infinity]
  } else if (max >= 1_000_000) {
    boundaries = [0, 500_000, 1_000_000, 2_500_000, Infinity]
  } else {
    boundaries = [0, 100_000, 250_000, 500_000, Infinity]
  }

  return boundaries
    .slice(0, -1)
    .map((lower, i) => {
      const upper = boundaries[i + 1]
      const label =
        upper === Infinity
          ? `${currency}${compactNum(lower)}+`
          : `${currency}${compactNum(lower)}–${compactNum(upper)}`

      return {
        label,
        min: lower,
        max: upper,
        count: amounts.filter((a) => a >= lower && (upper === Infinity || a < upper)).length,
      }
    })
    .filter((b) => b.count > 0)
}

// ── Formatting helpers ─────────────────────────────────────────────────────────

/** Format a raw amount as a human-readable money string. */
export function formatMoney(amount: number, currency: string, compact = false): string {
  if (compact) {
    if (amount >= 1_000_000_000) return `${currency}${(amount / 1_000_000_000).toFixed(1)}bn`
    if (amount >= 1_000_000) return `${currency}${(amount / 1_000_000).toFixed(1)}m`
    if (amount >= 1_000) return `${currency}${(amount / 1_000).toFixed(0)}k`
    return `${currency}${amount.toFixed(0)}`
  }

  // Full format with thousands separator
  const formatted = amount.toLocaleString('en-GB', {
    maximumFractionDigits: 0,
  })
  return currency ? `${currency}${formatted}` : formatted
}

/** Compact number without currency (used for bucket labels). */
function compactNum(n: number): string {
  if (n >= 1_000_000_000) return `${n / 1_000_000_000}bn`
  if (n >= 1_000_000) return `${n / 1_000_000}m`
  if (n >= 1_000) return `${n / 1_000}k`
  return n.toString()
}

/** Convert a string to a URL-safe slug. */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '') // Remove non-alphanumeric chars
    .replace(/\s+/g, '-') // Spaces → hyphens
    .replace(/-+/g, '-') // Collapse multiple hyphens
    .replace(/^-|-$/g, '') // Trim leading/trailing hyphens
}
