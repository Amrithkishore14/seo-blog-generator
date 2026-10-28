/**
 * tests/edge-cases.test.ts
 *
 * Integration tests for the full pipeline using awkward or unusual CSVs.
 * All tests pass `geminiApiKey: undefined` so the LLM is never called —
 * the deterministic fallback template is always used.
 *
 * Cases covered:
 *   1.  Different column header names + USD currency
 *   2.  Amounts written as "£2.1m" / "$450k" suffixes
 *   3.  Missing (blank) values in some cells
 *   4.  Tiny dataset — only 5 rows
 *   5.  Large dataset — 500 rows
 *   6.  No numeric column at all → NO_METRIC_COLUMN error
 *   7.  Empty file → EMPTY_CSV error
 *   8.  Non-CSV file renamed to .csv → graceful error, no crash
 *   9.  Company names containing commas, quotes, and accented characters
 *   10. Missing API key → fallback template, page still generated
 *   11. Unsorted CSV with no rank column → rows sorted, Rank injected
 *   12. Plain numeric metric with currency in header → currency detected
 *   13. "Latest Round" column → detected as stage role
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runPipeline, PipelineError } from '../server/utils/pipeline'
import { formatMoney } from '../server/utils/analyseDataset'
import { formatMetricCell } from '../server/utils/formatMetricCell'

const __dirname = dirname(fileURLToPath(import.meta.url))
const TEST_DIR = resolve(__dirname, '..', 'data', 'test-cases')

/** No-op config — forces the fallback copy template every time. */
const NO_LLM = { geminiApiKey: undefined }

/** Read a test CSV from /data/test-cases */
function readTestCsv(filename: string): string {
  return readFileSync(resolve(TEST_DIR, filename), 'utf-8')
}

// ─────────────────────────────────────────────────────────────────────────────
// Case 1: Different column header names + USD ($) currency
// Columns: Organization, HQ, Total Investment (USD), Team Size, Domain, Tags
// ─────────────────────────────────────────────────────────────────────────────
describe('Case 1 — unusual column names + USD currency', () => {
  it('succeeds and returns a valid BlogEntry', async () => {
    const csv = readTestCsv('aliases-usd.csv')
    const entry = await runPipeline({ csvText: csv, industryName: 'Finance' }, NO_LLM)

    expect(entry.stats.count).toBe(15)
    // Organization → name column
    expect(entry.nameHeader).toBe('Organization')
    // Total Investment (USD) → metric column (contains "investment")
    expect(entry.metricHeader).toBe('Total Investment (USD)')
    // HQ → region column
    expect(entry.regionHeader).toBe('HQ')
    // Currency detected as $
    expect(entry.stats.metricCurrency).toBe('$')
    expect(entry.stats.metricTotal).toBeGreaterThan(0)
  })

  it('top company has the highest investment', async () => {
    const csv = readTestCsv('aliases-usd.csv')
    const entry = await runPipeline({ csvText: csv, industryName: 'Finance' }, NO_LLM)

    // OakStreet Capital has $130m, HorizonBank has $210m — HorizonBank is top
    expect(entry.stats.topCompany).toBe('HorizonBank')
  })

  it('uses fallback copy when no API key is set', async () => {
    const csv = readTestCsv('aliases-usd.csv')
    const entry = await runPipeline({ csvText: csv, industryName: 'Finance' }, NO_LLM)
    expect(entry.usedFallback).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Case 2: Funding amounts with k / m / bn suffixes
// e.g. "£2.1m", "£450k", "£1.2bn"
// ─────────────────────────────────────────────────────────────────────────────
describe('Case 2 — k/m/bn suffix amounts', () => {
  it('parses suffix amounts and sums them correctly', async () => {
    const csv = readTestCsv('suffix-amounts.csv')
    const entry = await runPipeline({ csvText: csv, industryName: 'Tech' }, NO_LLM)

    expect(entry.stats.count).toBe(15)
    expect(entry.stats.metricCurrency).toBe('£')
    // Largest is DeltaFinance at £1.2bn
    expect(entry.stats.metricMax).toBeCloseTo(1_200_000_000)
    // Smallest is ThetaMedia at £350k
    expect(entry.stats.metricMin).toBeCloseTo(350_000)
    // Total must be > 0 and in the right ballpark
    expect(entry.stats.metricTotal).toBeGreaterThan(1_200_000_000)
  })

  it('detects Funding column as metric', async () => {
    const csv = readTestCsv('suffix-amounts.csv')
    const entry = await runPipeline({ csvText: csv, industryName: 'Tech' }, NO_LLM)
    expect(entry.metricHeader).toBe('Funding')
  })

  it('detects City as region', async () => {
    const csv = readTestCsv('suffix-amounts.csv')
    const entry = await runPipeline({ csvText: csv, industryName: 'Tech' }, NO_LLM)
    expect(entry.regionHeader).toBe('City')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Case 3: Missing values in some cells
// Row "Indigo Capital" has only a Company name and nothing else
// ─────────────────────────────────────────────────────────────────────────────
describe('Case 3 — missing values in some cells', () => {
  it('succeeds without crashing', async () => {
    const csv = readTestCsv('missing-values.csv')
    await expect(
      runPipeline({ csvText: csv, industryName: 'UK Tech' }, NO_LLM),
    ).resolves.toBeDefined()
  })

  it('stats.count equals total rows (including rows with missing metric)', async () => {
    const csv = readTestCsv('missing-values.csv')
    const entry = await runPipeline({ csvText: csv, industryName: 'UK Tech' }, NO_LLM)
    // CSV has 15 data rows
    expect(entry.stats.count).toBe(15)
  })

  it('metricTotal excludes rows where funding cell is blank', async () => {
    const csv = readTestCsv('missing-values.csv')
    const entry = await runPipeline({ csvText: csv, industryName: 'UK Tech' }, NO_LLM)
    // Several rows have empty Total Raised — total must be positive but < all rows summed
    expect(entry.stats.metricTotal).toBeGreaterThan(0)
    // Rows with data (4 rows have blank funding — Dawnlight, Indigo + 2 empty cells):
    // Albatross(5.2m), Birchwood(3.1m), Colibri(8.8m), Ember(1.5m), Fern(12.4m),
    // Gust(6.7m), Harrow(0.95m), Jasper(4.3m), Kestrel(7.1m), Larkspur(2.2m),
    // Meadow(19.8m), Nightjar(0.88m), Osprey(35m) = 13 rows with data → total = 107.93m
    expect(entry.stats.metricTotal).toBeCloseTo(107_930_000, -4)
  })

  it('full rows array preserves all 15 rows including sparse ones', async () => {
    const csv = readTestCsv('missing-values.csv')
    const entry = await runPipeline({ csvText: csv, industryName: 'UK Tech' }, NO_LLM)
    expect(entry.rows).toHaveLength(15)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Case 4: Tiny dataset — only 5 rows
// ─────────────────────────────────────────────────────────────────────────────
describe('Case 4 — tiny 5-row dataset', () => {
  it('generates a valid entry from only 5 companies', async () => {
    const csv = readTestCsv('tiny-5-rows.csv')
    const entry = await runPipeline({ csvText: csv, industryName: 'UK Tech' }, NO_LLM)

    expect(entry.stats.count).toBe(5)
    expect(entry.stats.metricTotal).toBeGreaterThan(0)
    expect(entry.stats.topCompany).toBe('Cedar Analytics') // highest revenue £9.5m
  })

  it('median is the middle value for an odd-count dataset', async () => {
    const csv = readTestCsv('tiny-5-rows.csv')
    const entry = await runPipeline({ csvText: csv, industryName: 'UK Tech' }, NO_LLM)
    // Sorted: 1.8m, 3.3m, [4.2m], 6.1m, 9.5m → median = 4.2m
    expect(entry.stats.metricMedian).toBeCloseTo(4_200_000)
  })

  it('fallback copy title contains the industry name', async () => {
    const csv = readTestCsv('tiny-5-rows.csv')
    const entry = await runPipeline({ csvText: csv, industryName: 'UK Tech' }, NO_LLM)
    expect(entry.copy.title.toLowerCase()).toContain('uk tech')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Case 5: Large dataset — 500 rows
// ─────────────────────────────────────────────────────────────────────────────
describe('Case 5 — large 500-row dataset', () => {
  it('processes all 500 rows', async () => {
    const csv = readTestCsv('large-500-rows.csv')
    const entry = await runPipeline({ csvText: csv, industryName: 'Tech' }, NO_LLM)
    expect(entry.stats.count).toBe(500)
  })

  it('stage and size breakdowns are populated', async () => {
    const csv = readTestCsv('large-500-rows.csv')
    const entry = await runPipeline({ csvText: csv, industryName: 'Tech' }, NO_LLM)
    expect(entry.stats.stageBreakdown.length).toBeGreaterThan(0)
    expect(entry.stats.sizeBandBreakdown.length).toBeGreaterThan(0)
  })

  it('region breakdown covers multiple cities', async () => {
    const csv = readTestCsv('large-500-rows.csv')
    const entry = await runPipeline({ csvText: csv, industryName: 'Tech' }, NO_LLM)
    expect(entry.stats.regionBreakdown.length).toBeGreaterThan(5)
  })

  it('top-10 share is a sensible percentage', async () => {
    const csv = readTestCsv('large-500-rows.csv')
    const entry = await runPipeline({ csvText: csv, industryName: 'Tech' }, NO_LLM)
    expect(entry.stats.top10Share).toBeGreaterThan(0)
    expect(entry.stats.top10Share).toBeLessThanOrEqual(100)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Case 6: No numeric column — should throw PipelineError
// Columns: Company, Location, Stage, Sector, Website (all text/url/category)
// ─────────────────────────────────────────────────────────────────────────────
describe('Case 6 — no numeric column', () => {
  it('throws PipelineError with code NO_METRIC_COLUMN', async () => {
    const csv = readTestCsv('no-numeric-column.csv')
    await expect(runPipeline({ csvText: csv, industryName: 'Tech' }, NO_LLM)).rejects.toMatchObject(
      {
        name: 'PipelineError',
        code: 'NO_METRIC_COLUMN',
      },
    )
  })

  it('error message mentions the column-mapping tool', async () => {
    const csv = readTestCsv('no-numeric-column.csv')
    try {
      await runPipeline({ csvText: csv, industryName: 'Tech' }, NO_LLM)
    } catch (err) {
      expect(err).toBeInstanceOf(PipelineError)
      expect((err as PipelineError).message).toMatch(/column-mapping/i)
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Case 7: Empty file — should throw PipelineError
// ─────────────────────────────────────────────────────────────────────────────
describe('Case 7 — empty CSV file', () => {
  it('throws PipelineError with code EMPTY_CSV', async () => {
    const csv = readTestCsv('empty.csv')
    await expect(runPipeline({ csvText: csv, industryName: 'Tech' }, NO_LLM)).rejects.toMatchObject(
      {
        name: 'PipelineError',
        code: 'EMPTY_CSV',
      },
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Case 8: Non-CSV file renamed to .csv (HTML content)
// Should throw a PipelineError — not an unhandled crash
// ─────────────────────────────────────────────────────────────────────────────
describe('Case 8 — non-CSV file renamed to .csv', () => {
  it('throws a PipelineError rather than an unhandled exception', async () => {
    const csv = readTestCsv('fake-not-csv.csv')
    await expect(
      runPipeline({ csvText: csv, industryName: 'Tech' }, NO_LLM),
    ).rejects.toBeInstanceOf(PipelineError)
  })

  it('error code is NO_NAME_COLUMN or EMPTY_CSV', async () => {
    const csv = readTestCsv('fake-not-csv.csv')
    try {
      await runPipeline({ csvText: csv, industryName: 'Tech' }, NO_LLM)
    } catch (err) {
      expect(err).toBeInstanceOf(PipelineError)
      const code = (err as PipelineError).code
      expect(['NO_NAME_COLUMN', 'NO_METRIC_COLUMN', 'EMPTY_CSV']).toContain(code)
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Case 9: Company names with commas, quotes, and accented characters
// PapaParse should handle RFC 4180 quoting correctly
// ─────────────────────────────────────────────────────────────────────────────
describe('Case 9 — special characters in company names', () => {
  it('succeeds and preserves all 15 companies', async () => {
    const csv = readTestCsv('special-names.csv')
    const entry = await runPipeline({ csvText: csv, industryName: 'Europe Tech' }, NO_LLM)
    expect(entry.rows).toHaveLength(15)
  })

  it('preserves company name with comma (quoted in CSV)', async () => {
    const csv = readTestCsv('special-names.csv')
    const entry = await runPipeline({ csvText: csv, industryName: 'Europe Tech' }, NO_LLM)
    const names = entry.rows.map((r) => r[entry.nameHeader])
    expect(names).toContain('Müller, Schmidt & Sons')
  })

  it("preserves company name with apostrophe (O'Brien)", async () => {
    const csv = readTestCsv('special-names.csv')
    const entry = await runPipeline({ csvText: csv, industryName: 'Europe Tech' }, NO_LLM)
    const names = entry.rows.map((r) => r[entry.nameHeader])
    expect(names).toContain("O'Brien Capital")
  })

  it('preserves accented characters in company names (Zürich, Ångström, etc.)', async () => {
    const csv = readTestCsv('special-names.csv')
    const entry = await runPipeline({ csvText: csv, industryName: 'Europe Tech' }, NO_LLM)
    const names = entry.rows.map((r) => r[entry.nameHeader])
    expect(names).toContain('Zürich Analytics AG')
    expect(names).toContain('Ångström Energy AB')
  })

  it('stats are computed from all 15 rows', async () => {
    const csv = readTestCsv('special-names.csv')
    const entry = await runPipeline({ csvText: csv, industryName: 'Europe Tech' }, NO_LLM)
    expect(entry.stats.count).toBe(15)
    expect(entry.stats.metricTotal).toBeGreaterThan(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Case 10: Missing Gemini API key → fallback template produces a full page
// ─────────────────────────────────────────────────────────────────────────────
describe('Case 10 — missing API key uses fallback template', () => {
  it('sets usedFallback: true when geminiApiKey is undefined', async () => {
    const csv = readTestCsv('suffix-amounts.csv')
    const entry = await runPipeline(
      { csvText: csv, industryName: 'UK Tech' },
      { geminiApiKey: undefined },
    )
    expect(entry.usedFallback).toBe(true)
  })

  it('fallback copy has a valid title, metaDescription, h1, intro, sections, faq', async () => {
    const csv = readTestCsv('suffix-amounts.csv')
    const entry = await runPipeline(
      { csvText: csv, industryName: 'UK Tech' },
      { geminiApiKey: undefined },
    )
    const { copy } = entry
    expect(copy.title).toBeTruthy()
    expect(copy.metaDescription).toBeTruthy()
    expect(copy.h1).toBeTruthy()
    expect(copy.intro).toHaveLength(2)
    expect(copy.sections.length).toBeGreaterThanOrEqual(3)
    expect(copy.faq).toHaveLength(3)
    expect(copy.insights.length).toBeGreaterThanOrEqual(4)
  })

  it('fallback slug is URL-safe', async () => {
    const csv = readTestCsv('suffix-amounts.csv')
    const entry = await runPipeline(
      { csvText: csv, industryName: 'UK Tech' },
      { geminiApiKey: undefined },
    )
    expect(entry.slug).toMatch(/^[a-z0-9-]+$/)
  })

  it('works even when the API key is an empty string', async () => {
    const csv = readTestCsv('suffix-amounts.csv')
    const entry = await runPipeline({ csvText: csv, industryName: 'UK Tech' }, { geminiApiKey: '' })
    expect(entry.usedFallback).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Case 11: Unsorted CSV with no rank column → rows sorted by metric, Rank injected
// CSV has 5 rows in random order; Alpha Inc has the highest funding (5 000 000)
// ─────────────────────────────────────────────────────────────────────────────
describe('Case 11 — unsorted CSV with no rank column', () => {
  it('rows[0] is the top-funded company after sort', async () => {
    const csv = readTestCsv('unsorted-no-rank.csv')
    const entry = await runPipeline({ csvText: csv, industryName: 'Tech' }, NO_LLM)
    expect(entry.rows[0][entry.nameHeader]).toBe('Alpha Inc')
  })

  it('injects a computed Rank column', async () => {
    const csv = readTestCsv('unsorted-no-rank.csv')
    const entry = await runPipeline({ csvText: csv, industryName: 'Tech' }, NO_LLM)
    expect(entry.rankHeader).toBe('Rank')
  })

  it('Rank values run 1..n in metric-descending order', async () => {
    const csv = readTestCsv('unsorted-no-rank.csv')
    const entry = await runPipeline({ csvText: csv, industryName: 'Tech' }, NO_LLM)
    const ranks = entry.rows.map((r) => r['Rank'])
    expect(ranks).toEqual(['1', '2', '3', '4', '5'])
    // Last row (Acme Corp, 500 000) is rank 5
    expect(entry.rows[4][entry.nameHeader]).toBe('Acme Corp')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Case 12: Plain numeric metric with currency symbol in header → currency detected
// ─────────────────────────────────────────────────────────────────────────────
describe('Case 12 — currency inferred from metric header', () => {
  it('"Funding (EUR)" header → metricCurrency is €', async () => {
    const csv = readTestCsv('plain-eur.csv')
    const entry = await runPipeline({ csvText: csv, industryName: 'Tech' }, NO_LLM)
    expect(entry.stats.metricCurrency).toBe('€')
  })

  it('"Amount (USD)" header → metricCurrency is $', async () => {
    const csv = readTestCsv('plain-usd-header.csv')
    const entry = await runPipeline({ csvText: csv, industryName: 'Tech' }, NO_LLM)
    expect(entry.stats.metricCurrency).toBe('$')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Case 13: "Latest Round" column header → detected as stage role
// ─────────────────────────────────────────────────────────────────────────────
describe('Case 13 — "Latest Round" detected as stage', () => {
  it('columns["Latest Round"].role is "stage"', async () => {
    const csv = readTestCsv('latest-round-stage.csv')
    const entry = await runPipeline({ csvText: csv, industryName: 'Tech' }, NO_LLM)
    expect(entry.columns['Latest Round'].role).toBe('stage')
  })

  it('stage breakdown is populated from "Latest Round" values', async () => {
    const csv = readTestCsv('latest-round-stage.csv')
    const entry = await runPipeline({ csvText: csv, industryName: 'Tech' }, NO_LLM)
    expect(entry.stats.stageBreakdown.length).toBeGreaterThan(0)
    const stages = entry.stats.stageBreakdown.map((s) => s.stage)
    expect(stages).toContain('Series A')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Case 14: Constant "Latest Round" column → produces stage wording in copy
// Uses latest-round-const.csv where all 5 rows have "Latest Round: Seed"
// so the column becomes a datasetTrait and stageValue() should return "seed".
// ─────────────────────────────────────────────────────────────────────────────
describe('Case 14 — constant "Latest Round" stage trait in copy', () => {
  it('datasetTraits contains "Latest Round: Seed"', async () => {
    const csv = readTestCsv('latest-round-const.csv')
    const entry = await runPipeline({ csvText: csv, industryName: 'Tech' }, NO_LLM)
    const traitNames = entry.stats.datasetTraits
    expect(
      traitNames.some((t) => /latest.round/i.test(t) && t.toLowerCase().includes('seed')),
    ).toBe(true)
  })

  it('fallback copy title includes row count (not a stage-specific integer)', async () => {
    const csv = readTestCsv('latest-round-const.csv')
    const entry = await runPipeline({ csvText: csv, industryName: 'Tech' }, NO_LLM)
    expect(entry.copy.title).toContain('5')
  })

  it('fallback copy metaDescription contains "seed" stage qualifier', async () => {
    const csv = readTestCsv('latest-round-const.csv')
    const entry = await runPipeline({ csvText: csv, industryName: 'Tech' }, NO_LLM)
    // stageQualifier should inject "at seed stage" or "seed-stage"
    const allCopy = [
      entry.copy.metaDescription,
      ...entry.copy.intro,
      ...entry.copy.sections.map((s) => s.body),
    ].join(' ')
    expect(allCopy.toLowerCase()).toMatch(/seed/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Case 15: Plain-integer metric values stored in rows; formatMoney formats them
// EdTech CSV has values like "14200000" (no currency symbol in cell).
// Confirms pipeline stores the raw cell value and formatMoney produces the
// display form used by the metric cell branch in the blog table.
// ─────────────────────────────────────────────────────────────────────────────
describe('Case 15 — plain integer metric cells + formatMoney display', () => {
  it('pipeline stores the raw plain integer in rows (no currency prefix added)', async () => {
    const csv = readTestCsv('edtech_europe_eur.csv')
    const entry = await runPipeline({ csvText: csv, industryName: 'EdTech' }, NO_LLM)
    const metricHeader = entry.metricHeader!
    // The top row (highest metric) should have a plain integer as the raw cell value
    const topMetricRaw = entry.rows[0][metricHeader]
    expect(topMetricRaw).toMatch(/^\d+$/) // pure digits — no currency symbol
  })

  it('formatMoney(14200000, "€") returns "€14,200,000" (thousands-separated, full precision)', () => {
    expect(formatMoney(14_200_000, '€')).toBe('€14,200,000')
  })

  it('formatMoney(9800000, "€") returns "€9,800,000"', () => {
    expect(formatMoney(9_800_000, '€')).toBe('€9,800,000')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Case 16: formatMetricCell — currency-prefixed integers without separators
// Reproduces the healthtech bug where "$15400000" was displayed as-is.
// ─────────────────────────────────────────────────────────────────────────────
describe('Case 16 — formatMetricCell table display formatting', () => {
  it('formats a plain integer with the supplied currency symbol', () => {
    expect(formatMetricCell('14200000', '€')).toBe('€14,200,000')
  })

  it('formats a $-prefixed integer that lacks thousands separators', () => {
    expect(formatMetricCell('$15400000', '$')).toBe('$15,400,000')
  })

  it('formats a £-prefixed integer that lacks thousands separators', () => {
    expect(formatMetricCell('£30314247', '£')).toBe('£30,314,247')
  })

  it('re-formats an already-separated value consistently', () => {
    expect(formatMetricCell('£30,314,247', '£')).toBe('£30,314,247')
  })

  it('returns an em-dash for blank input', () => {
    expect(formatMetricCell('', '$')).toBe('—')
    expect(formatMetricCell('   ', '$')).toBe('—')
  })

  it('leaves compact-suffix values unchanged', () => {
    expect(formatMetricCell('£3.2m', '£')).toBe('£3.2m')
    expect(formatMetricCell('$500k', '$')).toBe('$500k')
  })

  it('returns non-numeric strings unchanged', () => {
    expect(formatMetricCell('N/A', '$')).toBe('N/A')
  })
})
