/**
 * tests/generateCopy.test.ts
 *
 * Unit tests for generateCopy.ts that use vi.mock so NO real Gemini API
 * calls are made. Covers:
 *
 *   Task 1 — sanitiseCopyNumbers: title/h1/meta with wrong integers are
 *             replaced with the deterministic fallback value.
 *   Task 3 — 429 retry: callGemini retries with gemini-2.5-flash-lite
 *             when the primary model returns a quota error, then falls back
 *             to the template if both models fail.
 */

import { vi, describe, it, expect, beforeEach } from 'vitest'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { sanitiseCopyNumbers, generateCopy } from '../server/utils/generateCopy'
import type { GeneratedCopy, GenerateCopyOptions } from '../server/utils/generateCopy'
import type { DatasetStats } from '../server/utils/analyseDataset'

// Mock the SDK at module level so it is hoisted and applies to all tests
vi.mock('@google/generative-ai')

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeCopy(overrides: Partial<GeneratedCopy> = {}): GeneratedCopy {
  return {
    title: 'Top 100 Fintech Companies by Funding',
    metaDescription: 'The top 100 fintech companies ranked by total funding raised.',
    h1: 'The 100 Best-Funded Fintech Companies',
    intro: ['Para 1.', 'Para 2.'],
    sections: [
      { heading: 'Biggest Raises', body: 'Body 1.' },
      { heading: 'Where Based', body: 'Body 2.' },
      { heading: 'What Building', body: 'Body 3.' },
    ],
    insights: ['Insight 1', 'Insight 2', 'Insight 3', 'Insight 4'],
    faq: [
      { q: 'Q1?', a: 'A1.' },
      { q: 'Q2?', a: 'A2.' },
      { q: 'Q3?', a: 'A3.' },
    ],
    keywords: ['fintech', 'fintech funding', 'uk fintech'],
    ...overrides,
  }
}

function makeStats(count: number): DatasetStats {
  return {
    count,
    metricTotal: 622_000_000,
    metricMean: 6_220_000,
    metricMedian: 4_000_000,
    metricMin: 500_000,
    metricMax: 80_000_000,
    metricCurrency: '£',
    metricLabel: 'Total Raised',
    topCompany: 'Acme Corp',
    top10Share: 45.2,
    gapTop1Top2: 20_000_000,
    regionBreakdown: [{ region: 'London', count: 40, total: 200_000_000, share: 32 }],
    sizeBandBreakdown: [],
    stageBreakdown: [],
    topCategories: [],
    fundingBuckets: [],
    datasetTraits: [],
    nameLabel: 'Company',
  }
}

/** Valid copy JSON returned by the mocked lite model. */
function validLiteCopyJson(count: number) {
  return JSON.stringify({
    title: `Top ${count} Fintech Companies by Funding`,
    metaDescription: `The top ${count} fintech companies ranked by total funding raised.`,
    h1: `The ${count} Best-Funded Fintech Companies`,
    intro: ['Para 1.', 'Para 2.'],
    sections: [
      { heading: 'Biggest Raises', body: 'Body 1.' },
      { heading: 'Where Based', body: 'Body 2.' },
      { heading: 'What Building', body: 'Body 3.' },
    ],
    insights: ['I1', 'I2', 'I3', 'I4'],
    faq: [
      { q: 'Q1?', a: 'A1.' },
      { q: 'Q2?', a: 'A2.' },
      { q: 'Q3?', a: 'A3.' },
    ],
    keywords: ['fintech', 'fintech funding', 'uk fintech'],
  })
}

/** Configure GoogleGenerativeAI mock with per-model behaviour. */
function setupGeminiMock(flashBehaviour: 'ok' | '429', liteBehaviour: 'ok' | '429', count = 100) {
  vi.mocked(GoogleGenerativeAI).mockImplementation(
    () =>
      ({
        getGenerativeModel: ({ model }: { model: string }) => ({
          generateContent: vi.fn().mockImplementation(async () => {
            const is429 =
              (model === 'gemini-2.5-flash' && flashBehaviour === '429') ||
              (model === 'gemini-2.5-flash-lite' && liteBehaviour === '429')
            if (is429) throw new Error('429 Too Many Requests: quota exceeded')
            return { response: { text: () => validLiteCopyJson(count) } }
          }),
        }),
      }) as ReturnType<typeof GoogleGenerativeAI>,
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Task 1 — sanitiseCopyNumbers
// ─────────────────────────────────────────────────────────────────────────────

describe('sanitiseCopyNumbers — title accuracy guard', () => {
  it('replaces title when AI says "Top 10" for a 100-row dataset', () => {
    const stats = makeStats(100)
    const aiCopy = makeCopy({ title: 'Top 10 Fintech Companies by Funding' })
    const fallback = makeCopy({ title: 'Top 100 Fintech Companies by Total Raised' })

    const result = sanitiseCopyNumbers(aiCopy, stats, fallback)
    expect(result.title).toBe('Top 100 Fintech Companies by Total Raised')
  })

  it('keeps title when count matches', () => {
    const stats = makeStats(100)
    const aiCopy = makeCopy({ title: 'Top 100 Fintech Companies by Funding' })
    const fallback = makeCopy({ title: 'Fallback title should not be used' })

    const result = sanitiseCopyNumbers(aiCopy, stats, fallback)
    expect(result.title).toBe('Top 100 Fintech Companies by Funding')
  })

  it('replaces h1 with wrong integer', () => {
    const stats = makeStats(100)
    const aiCopy = makeCopy({ h1: 'The 10 Best-Funded Fintech Companies' })
    const fallback = makeCopy({ h1: 'The 100 Best-Funded Fintech Companies' })

    const result = sanitiseCopyNumbers(aiCopy, stats, fallback)
    expect(result.h1).toBe('The 100 Best-Funded Fintech Companies')
  })

  it('replaces metaDescription with wrong integer', () => {
    const stats = makeStats(100)
    const aiCopy = makeCopy({
      metaDescription: 'The top 10 fintech companies ranked by funding.',
    })
    const fallback = makeCopy({
      metaDescription: 'The top 100 fintech companies ranked by funding.',
    })

    const result = sanitiseCopyNumbers(aiCopy, stats, fallback)
    expect(result.metaDescription).toBe('The top 100 fintech companies ranked by funding.')
  })

  it('does not replace fields that contain no integers', () => {
    const stats = makeStats(100)
    const aiCopy = makeCopy({
      title: 'Best Fintech Companies by Funding',
      h1: 'Best-Funded Fintech Companies',
      metaDescription: 'A ranking of fintech companies by total funding raised.',
    })
    const fallback = makeCopy({
      title: 'Fallback title',
      h1: 'Fallback H1',
      metaDescription: 'Fallback meta.',
    })

    const result = sanitiseCopyNumbers(aiCopy, stats, fallback)
    expect(result.title).toBe('Best Fintech Companies by Funding')
    expect(result.h1).toBe('Best-Funded Fintech Companies')
    expect(result.metaDescription).toBe('A ranking of fintech companies by total funding raised.')
  })

  it('allows year-like integers (2024) without triggering replacement', () => {
    const stats = makeStats(100)
    const aiCopy = makeCopy({
      title: 'Top 100 Fintech Companies — 2024 Edition',
    })
    const fallback = makeCopy({ title: 'Fallback title should not be used' })

    // "100" matches stats.count; "2024" is a year — no replacement
    const result = sanitiseCopyNumbers(aiCopy, stats, fallback)
    expect(result.title).toBe('Top 100 Fintech Companies — 2024 Edition')
  })

  it('preserves body copy (intro, sections, faq, insights) unchanged', () => {
    const stats = makeStats(100)
    const aiCopy = makeCopy({ title: 'Top 10 Fintech Companies by Funding' })
    const fallback = makeCopy({ title: 'Fallback title' })

    const result = sanitiseCopyNumbers(aiCopy, stats, fallback)
    expect(result.intro).toBe(aiCopy.intro)
    expect(result.sections).toBe(aiCopy.sections)
    expect(result.faq).toBe(aiCopy.faq)
    expect(result.insights).toBe(aiCopy.insights)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Task 3 — 429 retry
// ─────────────────────────────────────────────────────────────────────────────

describe('generateCopy — 429 quota retry', () => {
  beforeEach(() => {
    vi.mocked(GoogleGenerativeAI).mockReset()
  })

  it('retries with gemini-2.5-flash-lite when primary model returns 429', async () => {
    setupGeminiMock('429', 'ok', 100)

    const opts: GenerateCopyOptions = {
      industry: 'Fintech',
      stats: makeStats(100),
      top10: [],
      geminiApiKey: 'fake-key',
    }

    const result = await generateCopy(opts)
    expect(result.usedFallback).toBe(false)
    expect(result.copy.title).toContain('100')
  })

  it('falls back to template when both models return 429', async () => {
    setupGeminiMock('429', '429')

    const opts: GenerateCopyOptions = {
      industry: 'Fintech',
      stats: makeStats(50),
      top10: [],
      geminiApiKey: 'fake-key',
    }

    const result = await generateCopy(opts)
    expect(result.usedFallback).toBe(true)
  })

  it('succeeds on first attempt when flash is available', async () => {
    setupGeminiMock('ok', 'ok', 100)

    const opts: GenerateCopyOptions = {
      industry: 'Fintech',
      stats: makeStats(100),
      top10: [],
      geminiApiKey: 'fake-key',
    }

    const result = await generateCopy(opts)
    expect(result.usedFallback).toBe(false)
  })
})
