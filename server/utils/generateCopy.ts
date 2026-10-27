/**
 * generateCopy.ts
 *
 * Calls an LLM (Google Gemini or Ollama) to write SEO blog copy.
 *
 * Design principles:
 *   1. The LLM receives only pre-computed stats — it cannot invent numbers.
 *   2. The response is validated with Zod; one retry is attempted on bad JSON.
 *   3. If the LLM fails for any reason, a deterministic fallback generates copy
 *      from templates so the demo never breaks.
 *
 * No Nuxt/Nitro imports here — this file is also used by scripts/seed.ts.
 */

import { GoogleGenerativeAI } from '@google/generative-ai'
import { z } from 'zod'
import type { DatasetStats } from './analyseDataset'
import { formatMoney, slugify } from './analyseDataset'

// ── Zod schema for the LLM JSON response ────────────────────────────────────
// Validate every field so we catch malformed AI output before it reaches users.
const CopySchema = z.object({
  title: z.string().min(1).max(80), // <title> tag
  metaDescription: z.string().min(1).max(160), // <meta description>
  slug: z.string().regex(/^[a-z0-9-]+$/, 'Slug must be URL-safe'),
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
 * Falls back to a deterministic template if the LLM is unavailable.
 */
export async function generateCopy(
  opts: GenerateCopyOptions,
): Promise<{ copy: GeneratedCopy; usedFallback: boolean }> {
  const prompt = buildPrompt(opts)

  // Skip the LLM entirely if no key is configured and provider is gemini
  const provider = opts.llmProvider ?? 'gemini'
  const hasKey = provider === 'ollama' || Boolean(opts.geminiApiKey)

  if (hasKey) {
    try {
      const raw = await callLlm(prompt, opts)
      const copy = parseAndValidate(raw)
      if (copy) return { copy, usedFallback: false }
    } catch (err) {
      // Log to server console but don't crash — fall through to template
      console.warn('[generateCopy] LLM call failed, using fallback:', err)
    }
  } else {
    console.warn('[generateCopy] No GEMINI_API_KEY set — using fallback copy')
  }

  return { copy: buildFallbackCopy(opts), usedFallback: true }
}

// ── LLM call ─────────────────────────────────────────────────────────────────

async function callLlm(prompt: string, opts: GenerateCopyOptions): Promise<string> {
  const provider = opts.llmProvider ?? 'gemini'

  if (provider === 'ollama') {
    return callOllama(prompt, opts.ollamaUrl, opts.ollamaModel)
  }
  return callGemini(prompt, opts.geminiApiKey!)
}

/** Call Google Gemini REST API via the official SDK. */
async function callGemini(prompt: string, apiKey: string): Promise<string> {
  const genAI = new GoogleGenerativeAI(apiKey)
  // gemini-2.0-flash is the current free-tier fast model
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.0-flash',
    generationConfig: {
      // Force the model to output JSON — reduces malformed responses
      responseMimeType: 'application/json',
    },
  })

  const result = await model.generateContent(prompt)
  return result.response.text()
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
    body: JSON.stringify({
      model,
      prompt,
      stream: false,
      format: 'json', // Ollama JSON mode
    }),
  })

  if (!res.ok) {
    throw new Error(`Ollama returned HTTP ${res.status}`)
  }

  const data = (await res.json()) as { response?: string }
  if (!data.response) throw new Error('Ollama returned empty response')
  return data.response
}

// ── JSON parsing + Zod validation ────────────────────────────────────────────

/**
 * Parse the LLM's text output as JSON and validate against CopySchema.
 * Returns null if parsing or validation fails (triggers fallback).
 */
function parseAndValidate(raw: string): GeneratedCopy | null {
  // Strip markdown code fences that some models add despite being told not to
  const cleaned = raw
    .replace(/^```(?:json)?\n?/m, '')
    .replace(/\n?```$/m, '')
    .trim()

  let parsed: unknown
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    console.warn('[generateCopy] Failed to parse LLM output as JSON')
    return null
  }

  const result = CopySchema.safeParse(parsed)
  if (result.success) return result.data

  console.warn('[generateCopy] Zod validation failed:', result.error.flatten())
  return null
}

// ── Prompt builder ────────────────────────────────────────────────────────────

/**
 * Build the prompt sent to the LLM.
 *
 * We pass pre-computed numbers and explicitly tell the model NOT to invent
 * any figures. This is the key accuracy guarantee of the system.
 */
function buildPrompt(opts: GenerateCopyOptions): string {
  const { industry, stats } = opts

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

  return `You are a professional tech-industry content writer. Write SEO blog copy for a ranking of ${industry} companies.

CRITICAL RULES:
- Use ONLY the numbers provided below. Do NOT invent, round, or approximate any figures.
- Write in UK English (use "whilst", "organise", "analyse" etc.).
- Return ONLY valid JSON. No markdown, no code fences, no commentary.

The JSON must match this exact structure:
{
  "title": "(max 60 chars, include '${industry}' and a number)",
  "metaDescription": "(max 155 chars, compelling search-result snippet)",
  "slug": "(URL-safe slug, e.g. 'top-fintech-seed-companies-2024')",
  "h1": "(page heading — slightly different phrasing from title)",
  "intro": ["paragraph 1 (2-3 sentences)", "paragraph 2 (2-3 sentences)"],
  "sections": [
    { "heading": "The Biggest Raises", "body": "2-3 sentences using only the provided numbers." },
    { "heading": "Where They're Based", "body": "2-3 sentences." },
    { "heading": "What They're Building", "body": "2-3 sentences on the top sector tags." },
    { "heading": "Trends to Watch", "body": "2-3 sentences, forward-looking, no invented statistics." }
  ],
  "insights": ["one-line insight 1", "...", "(4 to 6 total)"],
  "faq": [
    { "q": "How much have ${industry} companies raised in total?", "a": "Answer using exact total." },
    { "q": "Which ${industry} company has raised the most?", "a": "..." },
    { "q": "What is the average raise for a seed-stage ${industry} company?", "a": "..." }
  ],
  "keywords": ["${industry}", "${industry} funding", "seed stage ${industry}", "(4-8 total)"]
}

--- DATASET STATISTICS (use ONLY these numbers) ---

Industry: ${industry}
Total companies: ${stats.count}
${traitLines}

${stats.metricLabel} — Total: ${formatMoney(stats.metricTotal, stats.metricCurrency)}
${stats.metricLabel} — Average: ${formatMoney(stats.metricMean, stats.metricCurrency)}
${stats.metricLabel} — Median: ${formatMoney(stats.metricMedian, stats.metricCurrency)}
${stats.metricLabel} — Highest: ${formatMoney(stats.metricMax, stats.metricCurrency)} (${stats.topCompany})
Top 10 companies' share of total: ${stats.top10Share.toFixed(1)}%
Gap between #1 and #2: ${formatMoney(stats.gapTop1Top2, stats.metricCurrency)}

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
 * Used when the LLM is unavailable or returns invalid output.
 *
 * All numbers come from the pre-computed stats object, so this output
 * is always accurate even though it's less varied than AI copy.
 */
export function buildFallbackCopy(opts: GenerateCopyOptions): GeneratedCopy {
  const { industry, stats } = opts
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

  const slug = slugify(`top-${stats.count}-${industry}-companies`)

  return {
    title: `Top ${stats.count} ${industry} Companies by ${stats.metricLabel}`.slice(0, 60),
    metaDescription:
      `Explore the top ${stats.count} ${industry} companies ranked by ${stats.metricLabel.toLowerCase()}. Collectively they have raised ${total} at the seed stage.`.slice(
        0,
        155,
      ),
    slug,
    h1: `The ${stats.count} Best-Funded ${industry} Companies`,
    intro: [
      `This analysis covers ${stats.count} ${industry} companies at the seed stage, which have collectively raised ${total} in funding. The dataset spans ${stats.regionBreakdown.length} distinct region${stats.regionBreakdown.length !== 1 ? 's' : ''}.`,
      `${stats.topCompany} leads the ranking with ${maxRaise}, whilst the average raise across the dataset is ${avg} and the median is ${median}. The top ten companies account for ${stats.top10Share.toFixed(1)}% of total funding.`,
    ],
    sections: [
      {
        heading: 'The Biggest Raises',
        body: `The top ten companies in this dataset have collectively claimed ${stats.top10Share.toFixed(1)}% of all funding raised. ${stats.topCompany} sits at the top with ${maxRaise}, a gap of ${formatMoney(stats.gapTop1Top2, cur, true)} ahead of the second-placed company. The average raise of ${avg} suggests a healthy spread of investor interest across the cohort.`,
      },
      {
        heading: `Where They're Based`,
        body: `${topRegion} is the dominant hub, accounting for ${stats.regionBreakdown[0]?.count ?? 0} of the ${stats.count} companies and ${formatMoney(stats.regionBreakdown[0]?.total ?? 0, cur, true)} in funding. ${stats.regionBreakdown.length > 1 ? `The dataset spans ${stats.regionBreakdown.length} regions in total, highlighting the geographic spread of ${industry} activity.` : ''}`,
      },
      {
        heading: `What They're Building`,
        body: topTags
          ? `The most common sector tags across the dataset are: ${topTags}. These themes reflect the core technological and commercial focus of the current ${industry} cohort.`
          : `The companies span a wide variety of sub-sectors within ${industry}, reflecting the breadth of innovation at the seed stage.`,
      },
      {
        heading: 'Trends to Watch',
        body: `With ${stats.count} companies at the seed stage raising a combined ${total}, the ${industry} sector is demonstrating strong investor appetite. The concentration of activity in ${topRegion} underscores the importance of established tech ecosystems, whilst the median raise of ${median} suggests most founders are securing meaningful capital without relying on outlier rounds.`,
      },
    ],
    insights: [
      `${stats.count} ${industry} companies have collectively raised ${total}.`,
      `The top 10 companies account for ${stats.top10Share.toFixed(1)}% of all funding raised.`,
      `${topRegion} is the leading hub with ${stats.regionBreakdown[0]?.count ?? 0} companies.`,
      `Average raise: ${avg} · Median raise: ${median}.`,
      `${stats.topCompany} leads the ranking with ${maxRaise}.`,
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
      {
        q: `What is the average raise for a seed-stage ${industry} company?`,
        a: `The average raise across the ${stats.count} companies is ${avg}, with a median of ${median}.`,
      },
    ],
    keywords: [
      industry,
      `${industry} funding`,
      `${industry} companies`,
      `seed stage ${industry}`,
      `top ${industry} startups`,
    ],
  }
}
