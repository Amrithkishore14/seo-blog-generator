/**
 * generateCopy.ts
 *
 * Calls an LLM (Google Gemini or Ollama) to write SEO blog copy.
 *
 * Design principles:
 *   1. The LLM receives only pre-computed stats — it cannot invent numbers.
 *   2. The response is validated with Zod; one retry is attempted on bad JSON.
 *   3. If both attempts fail only on title/meta length, the AI body copy is
 *      preserved and the fallback title/meta is substituted — never truncated.
 *   4. Full fallback (template copy) is only used when the LLM is unavailable
 *      or returns structurally invalid JSON.
 *
 * No Nuxt/Nitro imports here — this file is also used by scripts/seed.ts.
 */

import { GoogleGenerativeAI } from '@google/generative-ai'
import { z } from 'zod'
import type { DatasetStats } from './analyseDataset'
import { formatMoney } from './analyseDataset'

// ── String helpers ────────────────────────────────────────────────────────────

/** Title-case a string: "fintech" → "Fintech", "AI healthcare" → "AI Healthcare" */
function titleCase(s: string): string {
  return s.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1))
}

/**
 * Lower-case a metric label for use in mid-sentence prose while preserving
 * acronyms (all-uppercase tokens).
 *
 * "Total Raised"     → "total raised"
 * "Funding (USD)"    → "funding (USD)"    ← USD preserved
 * "Revenue (GBP)"    → "revenue (GBP)"    ← GBP preserved
 */
function labelForSentence(label: string): string {
  return label.replace(/\b([A-Za-z][a-z]*)\b/g, (m) => m.toLowerCase())
}

// ── Zod schema for the LLM JSON response ────────────────────────────────────
// Limits match SEO best-practice ceilings.
const CopySchema = z.object({
  title: z.string().min(1).max(60), // <title> tag — keep under 60 for SERP
  metaDescription: z.string().min(1).max(155), // <meta description> — keep under 155
  h1: z.string().min(1), // Page heading
  intro: z.array(z.string().min(1)).length(2), // Two intro paragraphs
  sections: z
    .array(
      z.object({
        heading: z.string().min(1),
        body: z.string().min(1),
      }),
    )
    .min(3)
    .max(5),
  insights: z.array(z.string().min(1)).min(4).max(6),
  faq: z.array(z.object({ q: z.string(), a: z.string() })).length(3),
  keywords: z.array(z.string()).min(3),
})

export type GeneratedCopy = z.infer<typeof CopySchema>

// ── Input interface ──────────────────────────────────────────────────────────

export interface GenerateCopyOptions {
  industry: string // Human-readable industry name, e.g. "Fintech"
  stats: DatasetStats
  /** Top 10 rows, pre-formatted for the prompt. */
  top10: Array<{
    name: string
    metric: string // Already formatted, e.g. "£30.3m"
    region: string
    description: string
  }>
  geminiApiKey?: string
  llmProvider?: 'gemini' | 'ollama'
  ollamaUrl?: string
  ollamaModel?: string
}

// ── Main entry point ─────────────────────────────────────────────────────────

/**
 * Generate SEO blog copy using an LLM.
 *
 * Retry strategy:
 *   Attempt 1 — standard prompt.
 *   Attempt 2 — retry prompt that explicitly reminds the model to keep
 *               title ≤60 and metaDescription ≤120 chars.
 *   Salvage   — if both attempts produce valid AI JSON but with an
 *               over-length title/meta, substitute fallback values for
 *               those two fields and return the rest of the AI copy.
 *   Fallback  — deterministic template copy when the LLM is unavailable
 *               or returns structurally invalid JSON.
 */
export async function generateCopy(
  opts: GenerateCopyOptions,
): Promise<{ copy: GeneratedCopy; usedFallback: boolean }> {
  const provider = opts.llmProvider ?? 'gemini'
  const hasKey = provider === 'ollama' || Boolean(opts.geminiApiKey)

  if (hasKey) {
    let lastRaw: string | null = null
    const fb = buildFallbackCopy(opts)

    for (let attempt = 1; attempt <= 2; attempt++) {
      const prompt = buildPrompt(opts, attempt === 2)
      try {
        const raw = await callLlm(prompt, opts)
        lastRaw = raw
        const copy = parseAndValidate(raw)
        if (copy) return { copy: sanitiseCopyNumbers(copy, opts.stats, fb), usedFallback: false }
        console.warn(`[generateCopy] Attempt ${attempt}: Zod validation failed`)
      } catch (err) {
        console.warn(`[generateCopy] Attempt ${attempt}: LLM call failed:`, err)
        if (attempt === 2) break
      }
    }

    // Both attempts failed. Try salvaging: substitute fallback title/meta into
    // the AI JSON so the body copy is still AI-generated.
    if (lastRaw) {
      const salvaged = parseAndValidateSalvage(lastRaw, fb.title, fb.metaDescription)
      if (salvaged) {
        console.warn('[generateCopy] Substituted fallback title/meta; body copy is AI-generated')
        return { copy: sanitiseCopyNumbers(salvaged, opts.stats, fb), usedFallback: false }
      }
    }
  } else {
    console.warn('[generateCopy] No GEMINI_API_KEY set — using fallback copy')
  }

  return { copy: buildFallbackCopy(opts), usedFallback: true }
}

// ── LLM call ─────────────────────────────────────────────────────────────────

async function callLlm(prompt: string, opts: GenerateCopyOptions): Promise<string> {
  const provider = opts.llmProvider ?? 'gemini'
  if (provider === 'ollama') return callOllama(prompt, opts.ollamaUrl, opts.ollamaModel)
  return callGemini(prompt, opts.geminiApiKey!)
}

/** Call Google Gemini REST API via the official SDK.
 *
 * Retry strategy on quota errors (HTTP 429):
 *   1. Try gemini-2.5-flash (primary model)
 *   2. On 429 → retry with gemini-2.5-flash-lite (lighter free-tier model)
 *   3. On any other error, or if the lite model also fails → throw
 */
async function callGemini(prompt: string, apiKey: string): Promise<string> {
  const modelsToTry = ['gemini-2.5-flash', 'gemini-2.5-flash-lite']
  let lastErr: unknown

  for (const modelName of modelsToTry) {
    const genAI = new GoogleGenerativeAI(apiKey)
    const model = genAI.getGenerativeModel({
      model: modelName,
      generationConfig: { responseMimeType: 'application/json' },
    })
    try {
      console.log(`[callGemini] Using model: ${modelName}`)
      const result = await model.generateContent(prompt)
      return result.response.text()
    } catch (err) {
      lastErr = err
      const is429 =
        err instanceof Error &&
        (err.message.includes('429') || /quota|rate.limit/i.test(err.message))
      if (is429) {
        console.warn(`[callGemini] ${modelName} quota exceeded — trying next model`)
        continue
      }
      // Non-quota error: don't retry with a different model
      throw err
    }
  }
  throw lastErr
}

/** Call a local Ollama server. */
async function callOllama(
  prompt: string,
  baseUrl = 'http://localhost:11434',
  model = 'llama3.2',
): Promise<string> {
  const res = await fetch(`${baseUrl}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, prompt, stream: false, format: 'json' }),
  })
  if (!res.ok) throw new Error(`Ollama returned HTTP ${res.status}`)
  const data = (await res.json()) as { response?: string }
  if (!data.response) throw new Error('Ollama returned empty response')
  return data.response
}

// ── JSON parsing + Zod validation ────────────────────────────────────────────

/** Strip markdown fences and parse JSON. Returns null on parse failure. */
function tryParseJson(raw: string): Record<string, unknown> | null {
  const cleaned = raw
    .replace(/^```(?:json)?\n?/m, '')
    .replace(/\n?```$/m, '')
    .trim()
  try {
    return JSON.parse(cleaned) as Record<string, unknown>
  } catch {
    console.warn('[generateCopy] Failed to parse LLM output as JSON')
    return null
  }
}

/**
 * Parse and validate the LLM response against CopySchema.
 * No auto-correction: if title or metaDescription are over-length the model
 * must retry rather than receiving a silently truncated result.
 */
function parseAndValidate(raw: string): GeneratedCopy | null {
  const obj = tryParseJson(raw)
  if (!obj) return null
  const result = CopySchema.safeParse(obj)
  if (result.success) return result.data
  console.warn('[generateCopy] Zod validation failed:', result.error.flatten())
  return null
}

/**
 * Salvage AI JSON by substituting the fallback title and metaDescription.
 * Used when both LLM attempts produce valid body copy but over-length head fields.
 * The rest of the AI copy (intro, sections, insights, FAQ, keywords) is preserved.
 */
function parseAndValidateSalvage(
  raw: string,
  fallbackTitle: string,
  fallbackMeta: string,
): GeneratedCopy | null {
  const obj = tryParseJson(raw)
  if (!obj) return null
  // Substitute only the length-constrained fields
  obj.title = fallbackTitle
  obj.metaDescription = fallbackMeta
  const result = CopySchema.safeParse(obj)
  if (result.success) return result.data
  console.warn('[generateCopy] Salvage validation failed:', result.error.flatten())
  return null
}

// ── Number accuracy guard ─────────────────────────────────────────────────────

/**
 * After Zod validation, check that every small integer (< 10 000, not a
 * year) in the title, h1, and metaDescription matches the real row count.
 * This catches cases where the LLM says "Top 10" for a 100-row dataset.
 *
 * If a field contains a wrong integer, the deterministic fallback value is
 * substituted for that field only; the rest of the AI copy is kept.
 *
 * Exported so it can be unit-tested without calling the real Gemini API.
 */
export function sanitiseCopyNumbers(
  copy: GeneratedCopy,
  stats: DatasetStats,
  fallback: GeneratedCopy,
): GeneratedCopy {
  function hasWrongInteger(text: string): boolean {
    const matches = [...text.matchAll(/\b(\d{1,5})\b/g)]
    return matches.some((m) => {
      const n = parseInt(m[1], 10)
      if (n >= 1900 && n <= 2099) return false // allow years
      return n !== stats.count
    })
  }
  return {
    ...copy,
    title: hasWrongInteger(copy.title) ? fallback.title : copy.title,
    h1: hasWrongInteger(copy.h1) ? fallback.h1 : copy.h1,
    metaDescription: hasWrongInteger(copy.metaDescription)
      ? fallback.metaDescription
      : copy.metaDescription,
  }
}

// ── Dataset trait helpers ─────────────────────────────────────────────────────

/**
 * Return true if a trait's column header looks like a stage/round column.
 * Mirrors the regex used in classifyColumnRole so both stay in sync.
 */
function isStageHeader(header: string): boolean {
  const h = header.trim()
  return (
    /^(stage|round|series|phase)$/i.test(h) ||
    /funding.round|investment.stage|funding stage|latest.round/i.test(h)
  )
}

/**
 * Find the constant stage value from traits, matching any stage-role header
 * (Stage, Funding Round, Latest Round, etc.) — not just a literal "stage:" prefix.
 */
function stageValue(traits: string[]): string {
  const stageTrait = traits.find((t) => {
    const header = t.split(':')[0] ?? ''
    return isStageHeader(header)
  })
  if (!stageTrait) return ''
  return stageTrait.split(':')[1]?.trim().toLowerCase() ?? ''
}

function stageLabel(traits: string[]): string {
  const val = stageValue(traits)
  return val ? `${val}-stage` : ''
}

function stageQualifier(traits: string[]): string {
  const val = stageValue(traits)
  return val ? ` at ${val} stage` : ''
}

// ── Prompt builder ────────────────────────────────────────────────────────────

/**
 * Build the prompt sent to the LLM.
 *
 * Key design decisions:
 *  - Pass both compact (£622.3m) AND exact (£622,301,270) figures; instruct the
 *    model to use compact form in prose and exact form only in FAQ answers.
 *  - Prohibit temporal/growth language: this is a single-point-in-time snapshot.
 *  - Prohibit hype words that inflate claims beyond what the data supports.
 *  - Preserve acronym casing in metric labels (Funding (USD), not funding (usd)).
 *  - isRetry=true adds an explicit reminder to keep title ≤60 and meta ≤120 chars.
 */
function buildPrompt(opts: GenerateCopyOptions, isRetry = false): string {
  const { stats } = opts
  const industry = titleCase(opts.industry)

  const regionLines = stats.regionBreakdown
    .slice(0, 5)
    .map(
      (r) =>
        `  - ${r.region}: ${r.count} companies, ${formatMoney(r.total, stats.metricCurrency, true)} (${r.share.toFixed(1)}% of total)`,
    )
    .join('\n')

  const tagLines = stats.topCategories
    .slice(0, 8)
    .map((t) => `  - ${t.tag}: ${t.count} companies`)
    .join('\n')

  const companyLines = opts.top10
    .map(
      (c, i) =>
        `  ${i + 1}. ${c.name} — ${c.metric}${c.region ? ` (${c.region})` : ''}: ${c.description}`,
    )
    .join('\n')

  const traitLines = stats.datasetTraits.length
    ? `Dataset traits (constants): ${stats.datasetTraits.join(' | ')}`
    : ''

  const stage = stageLabel(stats.datasetTraits)
  const faqQ3 = stage
    ? `What is the average raise for a ${stage} ${industry} company?`
    : `What is the average ${labelForSentence(stats.metricLabel)} for a ${industry} company in this dataset?`

  const stageKeyword = stage ? `${stage} ${industry}` : ''
  const keywordsInstruction = stageKeyword
    ? `["${industry}", "${industry} funding", "${stageKeyword}", "(4-8 total)"]`
    : `["${industry}", "${industry} funding", "${industry} companies", "(4-8 total)"]`

  // Pass both compact and exact figures so the model uses compact form in prose
  const fmt = (n: number) =>
    `${formatMoney(n, stats.metricCurrency, true)} (exact: ${formatMoney(n, stats.metricCurrency)})`

  const retryNote = isRetry
    ? `RETRY NOTE: Your previous title was over 60 characters or your metaDescription was over 155 characters. Count carefully: title MUST be ≤60 chars; metaDescription MUST be a complete sentence of ≤120 characters.\n\n`
    : ''

  return `${retryNote}You are a professional tech-industry content writer. Write SEO blog copy for a ranking of ${industry} companies.

CRITICAL RULES:
- Use ONLY the numbers provided below. Do NOT invent, round, or approximate any figures.
- This data is a single point-in-time snapshot. Do NOT imply growth trends, trajectories,
  "continued" momentum, or how the sector is evolving over time.
- Avoid hype words: no "staggering", "robust", "groundbreaking", "remarkable", "booming",
  "exciting", "significant" (unless quoting a figure), or similar superlatives.
- Write in a neutral, factual UK English tone (use "whilst", "organise", "analyse" etc.).
  Let the numbers speak for themselves.
- In prose, use the compact number format (e.g. £622.3m). In FAQ answers you may use the
  exact figure.
- Preserve acronym casing in the metric label "${stats.metricLabel}" exactly as written —
  never lower-case it to "${labelForSentence(stats.metricLabel)}".
- Return ONLY valid JSON. No markdown, no code fences, no commentary.

The JSON must match this exact structure:
{
  "title": "(max 60 chars — count carefully; include '${industry}' and a number)",
  "metaDescription": "(complete sentence, max 155 chars — count carefully; no ellipsis)",
  "h1": "(page heading — slightly different phrasing from title)",
  "intro": ["paragraph 1 (2-3 sentences)", "paragraph 2 (2-3 sentences)"],
  "sections": [
    { "heading": "The Biggest Raises", "body": "2-3 sentences using only the provided numbers." },
    { "heading": "Where They're Based", "body": "2-3 sentences." },
    { "heading": "What They're Building", "body": "2-3 sentences on the top sector tags." },
    { "heading": "Notable Companies", "body": "2-3 sentences on the top-ranked companies." }
  ],
  "insights": ["one-line insight 1", "...", "(4 to 6 total)"],
  "faq": [
    { "q": "How much have ${industry} companies raised in total?", "a": "Answer using exact total." },
    { "q": "Which ${industry} company has raised the most?", "a": "..." },
    { "q": "${faqQ3}", "a": "..." }
  ],
  "keywords": ${keywordsInstruction}
}

--- DATASET STATISTICS (use ONLY these numbers) ---

Industry: ${industry}
Total companies: ${stats.count}
${traitLines}

${stats.metricLabel} — Total: ${fmt(stats.metricTotal)}
${stats.metricLabel} — Average: ${fmt(stats.metricMean)}
${stats.metricLabel} — Median: ${fmt(stats.metricMedian)}
${stats.metricLabel} — Highest: ${fmt(stats.metricMax)} (${stats.topCompany})
Top 10 companies' share of total: ${stats.top10Share.toFixed(1)}%
Gap between #1 and #2: ${fmt(stats.gapTop1Top2)}

Top regions:
${regionLines}

Top sector tags:
${tagLines}

--- TOP 10 COMPANIES ---
${companyLines}

Now output the JSON object:`
}

// ── Deterministic fallback copy ───────────────────────────────────────────────

/**
 * Template-based copy generator — no AI required.
 * Used when the LLM is unavailable or returns invalid JSON.
 * Also used as the source of fallback title/metaDescription when the AI
 * returns valid body copy but over-length head fields.
 */
export function buildFallbackCopy(opts: GenerateCopyOptions): GeneratedCopy {
  const { stats } = opts
  const industry = titleCase(opts.industry)
  const cur = stats.metricCurrency
  const total = formatMoney(stats.metricTotal, cur, true)
  const avg = formatMoney(stats.metricMean, cur, true)
  const median = formatMoney(stats.metricMedian, cur, true)
  const maxRaise = formatMoney(stats.metricMax, cur, true)
  const topRegion = stats.regionBreakdown[0]?.region ?? 'London'
  const topTags = stats.topCategories
    .slice(0, 5)
    .map((t) => t.tag)
    .join(', ')

  const stageQ = stageQualifier(stats.datasetTraits)
  const stage = stageLabel(stats.datasetTraits)

  const metricInSentence = labelForSentence(stats.metricLabel)

  const faqQ3 = stage
    ? `What is the average raise for a ${stage} ${industry} company?`
    : `What is the average ${metricInSentence} for a ${industry} company in this dataset?`
  const faqA3 = stage
    ? `The average raise across the ${stats.count} companies${stageQ} is ${avg}, with a median of ${median}.`
    : `The average ${metricInSentence} across the ${stats.count} companies is ${avg}, with a median of ${median}.`

  const keywords: string[] = [
    industry,
    `${industry} funding`,
    `${industry} companies`,
    `top ${industry} startups`,
  ]
  if (stage) keywords.splice(2, 0, `${stage} ${industry}`)

  return {
    title: `Top ${stats.count} ${industry} Companies by ${stats.metricLabel}`.slice(0, 60),
    metaDescription:
      `The top ${stats.count} ${industry} companies ranked by ${metricInSentence}, with a combined ${total}${stageQ}.`.slice(
        0,
        155,
      ),
    h1: `The ${stats.count} Best-Funded ${industry} Companies`,
    intro: [
      `This dataset covers ${stats.count} ${industry} companies${stageQ}, which have collectively raised ${total}. The data spans ${stats.regionBreakdown.length} distinct region${stats.regionBreakdown.length !== 1 ? 's' : ''}.`,
      `${stats.topCompany} leads with ${maxRaise}. The average across the dataset is ${avg} and the median is ${median}. The top ten companies account for ${stats.top10Share.toFixed(1)}% of total funding.`,
    ],
    sections: [
      {
        heading: 'The Biggest Raises',
        body: `The top ten companies in this dataset account for ${stats.top10Share.toFixed(1)}% of all funding. ${stats.topCompany} leads with ${maxRaise}, a gap of ${formatMoney(stats.gapTop1Top2, cur, true)} ahead of the second-placed company. The average of ${avg} indicates a spread of investor interest across the cohort.`,
      },
      {
        heading: `Where They're Based`,
        body: `${topRegion} is the leading location, with ${stats.regionBreakdown[0]?.count ?? 0} of the ${stats.count} companies and ${formatMoney(stats.regionBreakdown[0]?.total ?? 0, cur, true)} in funding. ${stats.regionBreakdown.length > 1 ? `The dataset covers ${stats.regionBreakdown.length} regions in total.` : ''}`,
      },
      {
        heading: `What They're Building`,
        body: topTags
          ? `The most common sector tags are: ${topTags}. These reflect the core focus areas of the ${industry} companies in this dataset.`
          : `The companies cover a range of sub-sectors within ${industry}.`,
      },
      {
        heading: 'Notable Companies',
        body: `${stats.topCompany} raised the most${stageQ} at ${maxRaise}. The median of ${median} shows that most companies in this dataset secured meaningful capital. The top ten collectively hold ${stats.top10Share.toFixed(1)}% of all funding recorded.`,
      },
    ],
    insights: [
      `${stats.count} ${industry} companies have collectively raised ${total}.`,
      `The top 10 companies account for ${stats.top10Share.toFixed(1)}% of all funding.`,
      `${topRegion} is the leading location with ${stats.regionBreakdown[0]?.count ?? 0} companies.`,
      `Average: ${avg} · Median: ${median}.`,
      `${stats.topCompany} leads with ${maxRaise}.`,
      ...(stats.topCategories.length > 0
        ? [
            `Most common sector: "${stats.topCategories[0].tag}" (${stats.topCategories[0].count} companies).`,
          ]
        : []),
    ].slice(0, 6),
    faq: [
      {
        q: `How much have ${industry} companies raised in total?`,
        a: `The ${stats.count} companies in this dataset have collectively raised ${formatMoney(stats.metricTotal, cur)}.`,
      },
      {
        q: `Which ${industry} company has raised the most funding?`,
        a: `${stats.topCompany} leads the ranking with ${maxRaise} in total funding raised.`,
      },
      { q: faqQ3, a: faqA3 },
    ],
    keywords,
  }
}
