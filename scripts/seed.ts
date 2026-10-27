/**
 * scripts/seed.ts
 *
 * Run with:   npm run seed
 * (which executes: node --env-file=.env --import tsx/esm scripts/seed.ts)
 *
 * Seeds the blog storage with two pre-made entries:
 *   1. /blog/...  — generated from data/fintech_companies_seed.csv
 *   2. /blog/...  — generated from data/healthtech_sample.csv
 *
 * This script runs OUTSIDE of Nuxt/Nitro, so it:
 *   - Uses process.env instead of useRuntimeConfig
 *   - Uses unstorage directly instead of useStorage
 *   - Uses fs/promises to read CSV files
 *
 * The pipeline itself is the same code the API uses — same analysis,
 * same AI call, same validation.
 */

import { readFile, mkdir } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createStorage } from 'unstorage'
import fsDriver from 'unstorage/drivers/fs'
import { runPipeline } from '../server/utils/pipeline.js'

// ESM-compatible __dirname equivalent
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const ROOT = resolve(__dirname, '..')

// ── Storage: same .data/blogs directory that Nitro uses ────────────────────────
const STORAGE_BASE = resolve(ROOT, '.data', 'blogs')

async function main() {
  console.log('🌱  Seeding blog storage…\n')

  // Ensure the storage directory exists
  await mkdir(STORAGE_BASE, { recursive: true })

  const storage = createStorage({
    driver: fsDriver({ base: STORAGE_BASE }),
  })

  // Configuration: pull from process.env (loaded via --env-file=.env)
  const config = {
    geminiApiKey: process.env.GEMINI_API_KEY,
    llmProvider: (process.env.LLM_PROVIDER ?? 'gemini') as 'gemini' | 'ollama',
    ollamaUrl: process.env.OLLAMA_URL ?? 'http://localhost:11434',
  }

  if (!config.geminiApiKey) {
    console.warn(
      '⚠   GEMINI_API_KEY is not set — blogs will be generated with the fallback template.\n' +
        '    Copy .env.example to .env and add your key to get AI-generated copy.\n',
    )
  }

  // Seeds to process: [csvPath, industryName]
  const seeds: Array<{ csvPath: string; industry: string }> = [
    {
      csvPath: resolve(ROOT, 'data', 'fintech_companies_seed.csv'),
      industry: 'Fintech',
    },
    {
      csvPath: resolve(ROOT, 'data', 'healthtech_sample.csv'),
      industry: 'Healthtech',
    },
  ]

  for (const seed of seeds) {
    console.log(`📄  Processing: ${seed.csvPath}`)

    let csvText: string
    try {
      csvText = await readFile(seed.csvPath, 'utf-8')
    } catch {
      console.error(`   ✕ Could not read file: ${seed.csvPath}`)
      continue
    }

    try {
      const entry = await runPipeline({ csvText, industryName: seed.industry }, config)

      // Save the entry to storage — same key format the API uses
      await storage.setItem(entry.slug, entry)

      console.log(`   ✓ Generated: /blog/${entry.slug}`)
      console.log(`     Title:    "${entry.copy.title}"`)
      console.log(`     Companies: ${entry.stats.count}`)
      console.log(
        `     ${entry.stats.metricLabel}: ${entry.stats.metricCurrency}${entry.stats.metricTotal.toLocaleString('en-GB')}`,
      )
      console.log(`     AI copy:   ${entry.usedFallback ? 'fallback template' : 'Gemini'}`)
      console.log()
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`   ✕ Pipeline failed: ${message}\n`)
    }
  }

  console.log('✅  Seeding complete. Run `npm run dev` and open http://localhost:3000')
}

main().catch((err) => {
  console.error('Fatal seed error:', err)
  process.exit(1)
})
