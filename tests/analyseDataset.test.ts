/**
 * tests/analyseDataset.test.ts
 *
 * Unit tests for the pure utility functions in analyseDataset.ts.
 * Run with: npm test
 *
 * Why test these specific functions?
 *   - parseMoney handles a wide range of formats; edge cases are easy to miss
 *   - detectColumns is the "magic" of the system; regressions break new CSVs
 *   - computeStats produces every number shown on the page; accuracy is critical
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  parseMoney,
  detectColumns,
  computeStats,
  formatMoney,
  slugify,
  parseCsv,
} from '../server/utils/analyseDataset'
import { buildFallbackCopy } from '../server/utils/generateCopy'

const __dirname = dirname(fileURLToPath(import.meta.url))

// ── parseMoney ─────────────────────────────────────────────────────────────────

describe('parseMoney', () => {
  it('parses a GBP amount with commas', () => {
    const result = parseMoney('£30,314,247')
    expect(result).not.toBeNull()
    expect(result!.amount).toBe(30_314_247)
    expect(result!.currency).toBe('£')
  })

  it('parses a USD amount with "m" suffix', () => {
    const result = parseMoney('$2.1m')
    expect(result).not.toBeNull()
    expect(result!.amount).toBeCloseTo(2_100_000)
    expect(result!.currency).toBe('$')
  })

  it('parses an EUR amount with "k" suffix', () => {
    const result = parseMoney('€500k')
    expect(result).not.toBeNull()
    expect(result!.amount).toBe(500_000)
    expect(result!.currency).toBe('€')
  })

  it('parses a "bn" suffix', () => {
    const result = parseMoney('£1.5bn')
    expect(result).not.toBeNull()
    expect(result!.amount).toBeCloseTo(1_500_000_000)
  })

  it('returns null for "N/A"', () => {
    expect(parseMoney('N/A')).toBeNull()
  })

  it('returns null for an empty string', () => {
    expect(parseMoney('')).toBeNull()
  })

  it('returns null for a non-numeric string', () => {
    expect(parseMoney('unknown')).toBeNull()
  })

  it('handles USD without commas', () => {
    const result = parseMoney('$4200000')
    expect(result).not.toBeNull()
    expect(result!.amount).toBe(4_200_000)
    expect(result!.currency).toBe('$')
  })

  it('handles amounts with spaces around the symbol', () => {
    // Some CSVs have trailing spaces
    const result = parseMoney('  £5,000,000  ')
    expect(result).not.toBeNull()
    expect(result!.amount).toBe(5_000_000)
  })
})

// ── detectColumns ──────────────────────────────────────────────────────────────

describe('detectColumns', () => {
  // Simulate the fintech CSV structure
  const fintechHeaders = [
    'Rank',
    'Company',
    'Region',
    'Stage',
    'Employees',
    'Total Raised',
    'Description',
    'Website',
    'Industries',
  ]
  const fintechRows = [
    {
      Rank: '1',
      Company: 'Nevis',
      Region: 'London',
      Stage: 'Seed',
      Employees: '5-9',
      'Total Raised': '£30,314,247',
      Description: 'Nevis develops an AI platform for wealth management.',
      Website: 'https://www.neviswealth.com/',
      Industries: 'Application software; Wealth, asset and investment management',
    },
    {
      Rank: '2',
      Company: 'Januus.io',
      Region: 'London',
      Stage: 'Seed',
      Employees: '5-9',
      'Total Raised': '£27,949,436',
      Description: 'Januus.io develops a cryptowallet-to-identity database.',
      Website: 'https://januus.io/',
      Industries: 'Application software; Data management; Risk and compliance',
    },
    {
      Rank: '3',
      Company: 'Adfin',
      Region: 'London',
      Stage: 'Seed',
      Employees: '25-49',
      'Total Raised': '£24,222,973',
      Description: 'Adfin develops an online platform for invoicing.',
      Website: 'https://www.adfin.com/',
      Industries: 'Application software; Payment processing',
    },
  ]

  it('detects "Company" as the name column', () => {
    const cols = detectColumns(fintechHeaders, fintechRows)
    expect(cols['Company'].role).toBe('name')
  })

  it('detects "Rank" as the rank column', () => {
    const cols = detectColumns(fintechHeaders, fintechRows)
    expect(cols['Rank'].role).toBe('rank')
  })

  it('detects "Total Raised" as the metric column', () => {
    const cols = detectColumns(fintechHeaders, fintechRows)
    expect(cols['Total Raised'].role).toBe('metric')
    expect(cols['Total Raised'].type).toBe('money')
  })

  it('detects "Region" as the region column', () => {
    const cols = detectColumns(fintechHeaders, fintechRows)
    expect(cols['Region'].role).toBe('region')
  })

  it('detects "Industries" as the industries column (multi_category type)', () => {
    const cols = detectColumns(fintechHeaders, fintechRows)
    expect(cols['Industries'].role).toBe('industries')
    expect(cols['Industries'].type).toBe('multi_category')
  })

  it('detects "Stage" as constant type (all rows have "Seed")', () => {
    const cols = detectColumns(fintechHeaders, fintechRows)
    expect(cols['Stage'].type).toBe('constant')
  })

  it('detects "Website" as URL type', () => {
    const cols = detectColumns(fintechHeaders, fintechRows)
    expect(cols['Website'].type).toBe('url')
    expect(cols['Website'].role).toBe('website')
  })

  it('detects "Description" as text type', () => {
    const cols = detectColumns(fintechHeaders, fintechRows)
    expect(cols['Description'].type).toBe('text')
    expect(cols['Description'].role).toBe('description')
  })

  // Simulate the healthtech CSV with DIFFERENT column names
  it('detects "Name" as name column even with different header', () => {
    const cols = detectColumns(
      ['Name', 'Location', 'Funding (USD)'],
      [
        { Name: 'MediScan AI', Location: 'London', 'Funding (USD)': '$4200000' },
        { Name: 'CareLoop', Location: 'Manchester', 'Funding (USD)': '$3800000' },
      ],
    )
    expect(cols['Name'].role).toBe('name')
  })

  it('detects "Location" as region column', () => {
    const cols = detectColumns(
      ['Name', 'Location', 'Funding (USD)'],
      [
        { Name: 'MediScan AI', Location: 'London', 'Funding (USD)': '$4200000' },
        { Name: 'CareLoop', Location: 'Manchester', 'Funding (USD)': '$3800000' },
      ],
    )
    expect(cols['Location'].role).toBe('region')
  })

  it('detects "Funding (USD)" as metric with money type', () => {
    const cols = detectColumns(
      ['Name', 'Location', 'Funding (USD)'],
      [
        { Name: 'MediScan AI', Location: 'London', 'Funding (USD)': '$4200000' },
        { Name: 'CareLoop', Location: 'Manchester', 'Funding (USD)': '$3800000' },
      ],
    )
    expect(cols['Funding (USD)'].role).toBe('metric')
    expect(cols['Funding (USD)'].type).toBe('money')
  })
})

// ── computeStats ───────────────────────────────────────────────────────────────

describe('computeStats', () => {
  // Build a small predictable dataset for deterministic assertions
  const headers = ['Rank', 'Company', 'Region', 'Total Raised', 'Industries']
  const rows = [
    {
      Rank: '1',
      Company: 'Alpha',
      Region: 'London',
      'Total Raised': '£10,000,000',
      Industries: 'Fintech; Payments',
    },
    {
      Rank: '2',
      Company: 'Beta',
      Region: 'London',
      'Total Raised': '£6,000,000',
      Industries: 'Fintech; Banking',
    },
    {
      Rank: '3',
      Company: 'Gamma',
      Region: 'Manchester',
      'Total Raised': '£4,000,000',
      Industries: 'Fintech; Lending',
    },
    {
      Rank: '4',
      Company: 'Delta',
      Region: 'Manchester',
      'Total Raised': '£2,000,000',
      Industries: 'Fintech; Insurance',
    },
    {
      Rank: '5',
      Company: 'Epsilon',
      Region: 'Bristol',
      'Total Raised': '£1,000,000',
      Industries: 'Fintech; Payments',
    },
  ]
  const cols = detectColumns(headers, rows)
  const stats = computeStats(rows, cols)

  it('computes the correct total', () => {
    // 10 + 6 + 4 + 2 + 1 = 23 million
    expect(stats.metricTotal).toBe(23_000_000)
  })

  it('computes the correct mean', () => {
    // 23_000_000 / 5 = 4_600_000
    expect(stats.metricMean).toBeCloseTo(4_600_000)
  })

  it('computes the correct median', () => {
    // Sorted: 1, 2, 4, 6, 10 — middle value is 4
    expect(stats.metricMedian).toBe(4_000_000)
  })

  it('computes the correct min and max', () => {
    expect(stats.metricMin).toBe(1_000_000)
    expect(stats.metricMax).toBe(10_000_000)
  })

  it('identifies the top company', () => {
    expect(stats.topCompany).toBe('Alpha')
  })

  it('computes the gap between #1 and #2', () => {
    // 10m - 6m = 4m
    expect(stats.gapTop1Top2).toBe(4_000_000)
  })

  it('computes the correct top-10 share (all 5 companies = 100%)', () => {
    expect(stats.top10Share).toBeCloseTo(100)
  })

  it('groups region breakdown correctly', () => {
    const london = stats.regionBreakdown.find((r) => r.region === 'London')
    expect(london).toBeDefined()
    expect(london!.count).toBe(2)
    expect(london!.total).toBe(16_000_000)
  })

  it('excludes tags present in 90%+ of rows from topCategories', () => {
    // "Fintech" appears in all 5 rows (100%) → should be excluded
    const fintechTag = stats.topCategories.find((t) => t.tag === 'Fintech')
    expect(fintechTag).toBeUndefined()
  })

  it('includes less-common tags in topCategories', () => {
    // "Payments" appears in 2 of 5 rows (40%) → should be included
    const paymentsTag = stats.topCategories.find((t) => t.tag === 'Payments')
    expect(paymentsTag).toBeDefined()
    expect(paymentsTag!.count).toBe(2)
  })

  it('records the correct count', () => {
    expect(stats.count).toBe(5)
  })
})

// ── formatMoney ────────────────────────────────────────────────────────────────

describe('formatMoney', () => {
  it('formats a full GBP amount with thousands separators', () => {
    expect(formatMoney(30_314_247, '£')).toBe('£30,314,247')
  })

  it('formats compact billions', () => {
    expect(formatMoney(1_500_000_000, '£', true)).toBe('£1.5bn')
  })

  it('formats compact millions', () => {
    expect(formatMoney(4_200_000, '$', true)).toBe('$4.2m')
  })

  it('formats compact thousands', () => {
    expect(formatMoney(500_000, '€', true)).toBe('€500k')
  })

  it('works without a currency symbol', () => {
    expect(formatMoney(1234, '')).toBe('1,234')
  })
})

// ── slugify ────────────────────────────────────────────────────────────────────

describe('slugify', () => {
  it('converts spaces to hyphens', () => {
    expect(slugify('Top Fintech Companies')).toBe('top-fintech-companies')
  })

  it('removes special characters and collapses resulting hyphens', () => {
    // '&' is stripped; surrounding spaces each become '-'; consecutive hyphens
    // are then collapsed → 'uk-fintech-payments' (one hyphen, not two)
    expect(slugify('UK Fintech & Payments')).toBe('uk-fintech-payments')
  })

  it('collapses multiple hyphens', () => {
    expect(slugify('top--fintech')).toBe('top-fintech')
  })

  it('lowercases the result', () => {
    expect(slugify('HEALTHTECH')).toBe('healthtech')
  })
})

// ── parseCsv ──────────────────────────────────────────────────────────────────

describe('parseCsv', () => {
  it('parses a simple CSV correctly', () => {
    const csv = 'Name,Region\nAlpha,London\nBeta,Manchester'
    const { headers, rows } = parseCsv(csv)
    expect(headers).toEqual(['Name', 'Region'])
    expect(rows).toHaveLength(2)
    expect(rows[0].Name).toBe('Alpha')
  })

  it('trims header whitespace', () => {
    const csv = ' Company , Region \nAlpha,London'
    const { headers } = parseCsv(csv)
    expect(headers[0]).toBe('Company')
    expect(headers[1]).toBe('Region')
  })

  it('handles quoted fields with commas', () => {
    const csv = 'Company,Industries\nAcme,"Banking, Payments"'
    const { rows } = parseCsv(csv)
    expect(rows[0].Industries).toBe('Banking, Payments')
  })

  it('skips blank lines', () => {
    const csv = 'Name,Region\nAlpha,London\n\nBeta,Manchester\n'
    const { rows } = parseCsv(csv)
    expect(rows).toHaveLength(2)
  })
})

// ── computeStats — ground-truth against real fintech CSV ──────────────────────
// These numbers were independently verified by parsing the CSV outside the app.
// If any of these fail, a code change broke the accuracy guarantee.

describe('computeStats — real fintech CSV ground truth', () => {
  // Load the actual fintech CSV once for the whole describe block
  const csvText = readFileSync(resolve(__dirname, '../data/fintech_companies_seed.csv'), 'utf-8')
  const { headers, rows } = parseCsv(csvText)
  const cols = detectColumns(headers, rows)
  const stats = computeStats(rows, cols)

  it('total raised matches £622,301,270', () => {
    expect(stats.metricTotal).toBe(622_301_270)
  })

  it('count is 100', () => {
    expect(stats.count).toBe(100)
  })

  it('median is £4,146,786 (average of 50th and 51st sorted values)', () => {
    // 50th = £4,095,373 (Tangible), 51st = £4,198,199 (The London BTC Company)
    expect(stats.metricMedian).toBe(4_146_786)
  })

  it('top-10 share is approximately 33%', () => {
    expect(stats.top10Share).toBeCloseTo(33.004, 2)
  })

  it('topCompany is Nevis', () => {
    expect(stats.topCompany).toBe('Nevis')
  })

  it('London has 78 companies', () => {
    const london = stats.regionBreakdown.find((r) => r.region === 'London')
    expect(london?.count).toBe(78)
  })

  it('currency is £', () => {
    expect(stats.metricCurrency).toBe('£')
  })

  it('datasetTraits includes Stage: Seed (constant column)', () => {
    // Stage = "Seed" for all 100 rows → should be flagged as a dataset trait
    expect(stats.datasetTraits.some((t) => t.includes('Seed'))).toBe(true)
  })

  it('fundingBuckets cover all 100 companies', () => {
    const total = stats.fundingBuckets.reduce((s, b) => s + b.count, 0)
    expect(total).toBe(100)
  })

  it('Application software excluded from topCategories (>90% threshold)', () => {
    // "Application software" appears in ~95%+ of rows → should be excluded
    const tag = stats.topCategories.find((t) => t.tag === 'Application software')
    expect(tag).toBeUndefined()
  })
})

// ── computeStats — plain numeric metric (not money) ───────────────────────────

describe('computeStats — plain number metric', () => {
  const headers = ['Name', 'Score', 'Region']
  const rows = [
    { Name: 'Alpha', Score: '90', Region: 'London' },
    { Name: 'Beta', Score: '70', Region: 'Manchester' },
    { Name: 'Gamma', Score: '80', Region: 'London' },
    { Name: 'Delta', Score: '60', Region: 'Bristol' },
  ]
  // Give Score the 'metric' role explicitly since it's a plain number
  // detectColumns will classify Score as 'number' type, and since there is
  // no money column, we need to check that 'metric' role requires a header override
  // Actually: let's override by hand to test the path
  const cols = detectColumns(headers, rows)
  // Override Score → metric (detectColumns won't pick a plain 'Score' column as metric
  // without a keyword match; here we simulate the user correcting it)
  cols['Score'] = { ...cols['Score'], role: 'metric', type: 'number' }

  const stats = computeStats(rows, cols)

  it('sums plain numbers correctly', () => {
    expect(stats.metricTotal).toBe(300)
  })

  it('computes mean of plain numbers', () => {
    expect(stats.metricMean).toBe(75)
  })

  it('computes median of plain numbers', () => {
    // Sorted: 60, 70, 80, 90 → avg of 70 and 80 = 75
    expect(stats.metricMedian).toBe(75)
  })

  it('currency is empty string for plain numbers', () => {
    expect(stats.metricCurrency).toBe('')
  })
})

// ── computeStats — datasetTraits ──────────────────────────────────────────────

describe('computeStats — datasetTraits from constant columns', () => {
  const headers = ['Company', 'Total Raised', 'Stage']
  const rows = [
    { Company: 'A', 'Total Raised': '£1,000,000', Stage: 'Seed' },
    { Company: 'B', 'Total Raised': '£2,000,000', Stage: 'Seed' },
    { Company: 'C', 'Total Raised': '£3,000,000', Stage: 'Seed' },
  ]
  const cols = detectColumns(headers, rows)
  const stats = computeStats(rows, cols)

  it('records Stage: Seed as a dataset trait', () => {
    expect(stats.datasetTraits).toContain('Stage: Seed')
  })
})

// ── detectColumns — healthtech-style headers ──────────────────────────────────

describe('detectColumns — healthtech CSV header variations', () => {
  const htHeaders = [
    'Name',
    'Location',
    'Funding (USD)',
    'Headcount',
    'Sector',
    'Funding Round',
    'Description',
    'Website',
  ]
  const htRows = [
    {
      Name: 'MediScan AI',
      Location: 'London',
      'Funding (USD)': '$4200000',
      Headcount: '28',
      Sector: 'Medical imaging; AI diagnostics',
      'Funding Round': 'Seed',
      Description: 'MediScan AI develops deep-learning software for automated radiology analysis.',
      Website: 'https://mediscan.example.ai',
    },
    {
      Name: 'CareLoop',
      Location: 'Manchester',
      'Funding (USD)': '$3800000',
      Headcount: '15',
      Sector: 'Remote patient monitoring; Chronic disease',
      'Funding Round': 'Seed',
      Description:
        'CareLoop builds wearable-integrated software for continuous patient monitoring.',
      Website: 'https://careloop.example.io',
    },
    {
      Name: 'GenomixPro',
      Location: 'Cambridge',
      'Funding (USD)': '$12100000',
      Headcount: '67',
      Sector: 'Genomics; Drug discovery',
      'Funding Round': 'Seed',
      Description:
        'GenomixPro develops a cloud platform for genomic data analysis and drug targets.',
      Website: 'https://genomixpro.example.com',
    },
  ]

  const cols = detectColumns(htHeaders, htRows)

  it('detects "Headcount" as size role', () => {
    expect(cols['Headcount'].role).toBe('size')
  })

  it('detects "Sector" as industries role (multi_category with semicolons)', () => {
    expect(cols['Sector'].role).toBe('industries')
    expect(cols['Sector'].type).toBe('multi_category')
  })

  it('detects "Funding Round" as stage role', () => {
    expect(cols['Funding Round'].role).toBe('stage')
  })

  it('detects "Funding (USD)" containing "funding" keyword as metric role', () => {
    expect(cols['Funding (USD)'].role).toBe('metric')
  })

  it('detects "Website" URLs as website role', () => {
    expect(cols['Website'].role).toBe('website')
    expect(cols['Website'].type).toBe('url')
  })
})

// ── fundingBuckets — dynamic bucket scaling ───────────────────────────────────

describe('computeStats — fundingBuckets', () => {
  it('generates buckets that cover all rows', () => {
    const headers = ['Company', 'Total Raised']
    const rows = [
      { Company: 'A', 'Total Raised': '£30,000,000' },
      { Company: 'B', 'Total Raised': '£8,000,000' },
      { Company: 'C', 'Total Raised': '£3,000,000' },
      { Company: 'D', 'Total Raised': '£1,000,000' },
    ]
    const cols = detectColumns(headers, rows)
    const stats = computeStats(rows, cols)
    const total = stats.fundingBuckets.reduce((s, b) => s + b.count, 0)
    expect(total).toBe(4)
  })

  it('uses "+" suffix for the top bucket', () => {
    const headers = ['Company', 'Total Raised']
    const rows = [
      { Company: 'A', 'Total Raised': '£100,000,000' },
      { Company: 'B', 'Total Raised': '£5,000,000' },
    ]
    const cols = detectColumns(headers, rows)
    const stats = computeStats(rows, cols)
    const topBucket = stats.fundingBuckets[stats.fundingBuckets.length - 1]
    expect(topBucket.label).toContain('+')
  })
})

// ── buildFallbackCopy ─────────────────────────────────────────────────────────

describe('buildFallbackCopy', () => {
  // Build a minimal stats object to test the fallback copy generator
  const mockStats = {
    count: 10,
    metricTotal: 50_000_000,
    metricMean: 5_000_000,
    metricMedian: 4_000_000,
    metricMin: 1_000_000,
    metricMax: 12_000_000,
    metricCurrency: '£',
    topCompany: 'Alpha Corp',
    gapTop1Top2: 2_000_000,
    top10Share: 100,
    regionBreakdown: [
      { region: 'London', count: 7, total: 38_000_000, share: 76 },
      { region: 'Manchester', count: 3, total: 12_000_000, share: 24 },
    ],
    sizeBandBreakdown: [],
    stageBreakdown: [],
    topCategories: [
      { tag: 'Payments', count: 5 },
      { tag: 'Banking', count: 3 },
    ],
    fundingBuckets: [],
    datasetTraits: ['Stage: Seed'],
    metricLabel: 'Total Raised',
    nameLabel: 'Company',
  }

  const result = buildFallbackCopy({
    industry: 'Fintech',
    stats: mockStats,
    top10: [],
  })

  it('produces a title ≤ 60 characters', () => {
    expect(result.title.length).toBeLessThanOrEqual(60)
  })

  it('produces a metaDescription ≤ 155 characters', () => {
    expect(result.metaDescription.length).toBeLessThanOrEqual(155)
  })

  it('produces exactly 2 intro paragraphs', () => {
    expect(result.intro).toHaveLength(2)
  })

  it('produces 3–5 sections', () => {
    expect(result.sections.length).toBeGreaterThanOrEqual(3)
    expect(result.sections.length).toBeLessThanOrEqual(5)
  })

  it('produces exactly 3 FAQ items', () => {
    expect(result.faq).toHaveLength(3)
  })

  it('produces 4–6 insights', () => {
    expect(result.insights.length).toBeGreaterThanOrEqual(4)
    expect(result.insights.length).toBeLessThanOrEqual(6)
  })

  it('slug is URL-safe (lowercase, hyphens only)', () => {
    expect(result.slug).toMatch(/^[a-z0-9-]+$/)
  })

  it('includes the industry name in the title', () => {
    expect(result.title.toLowerCase()).toContain('fintech')
  })

  it('mentions correct total in FAQ answer', () => {
    // The FAQ answer about total raised should include the actual total
    const totalFaq = result.faq.find((f) => f.q.toLowerCase().includes('total'))
    expect(totalFaq?.a).toContain('50,000,000')
  })
})
