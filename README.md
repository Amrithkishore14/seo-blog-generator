# seo-blog-generator

A Nuxt 3 system that turns any company-ranking CSV into a server-rendered, SEO-optimised blog page using Google Gemini. Built as a take-home test for Beauhurst.

---

## Overview

Upload a CSV → the system detects columns automatically → computes statistics in code → sends the stats to an LLM to write the blog copy → saves the result → renders a fully SSR blog page with structured data, a ranking table, and CSS bar charts.

The key design principle: **numbers are computed in code, not by AI**. This prevents hallucination while still letting the LLM write compelling, varied prose.

---

## How It Works

```mermaid
flowchart LR
    A([CSV Upload]) --> B[parseCsv\ninline RFC-4180]
    B --> C[detectColumns\nname/rank/metric/region/…]
    C --> D[computeStats\ntotal · mean · median · buckets · regions · tags]
    D --> E{LLM Available?}
    E -- Yes --> F[Gemini / Ollama\nstrictly JSON prompt]
    E -- No --> G[Deterministic\nfallback template]
    F --> H{Zod valid?}
    H -- Yes --> I[BlogEntry saved\nto .data/blogs/]
    H -- No, retry --> F
    H -- Fail --> G
    G --> I
    I --> J([blog/slug page\nSSR + JSON-LD])
```

---

## Setup

### Prerequisites

- **Node.js 20+** (required for `--env-file` flag in the seed script)
- A free [Google Gemini API key](https://aistudio.google.com/apikey) — the system works without one using the fallback template

### Installation

```bash
# 1. Clone / navigate to the project
cd seo-blog-generator

# 2. Install dependencies
npm install

# 3. Set up environment variables
cp .env.example .env
# Edit .env and add your GEMINI_API_KEY

# 4. Seed initial blogs (fintech + healthtech samples)
npm run seed

# 5. Start the dev server
npm run dev
# → open http://localhost:3000
```

### Environment variables

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `GEMINI_API_KEY` | Recommended | — | Google Gemini free-tier key |
| `LLM_PROVIDER` | No | `gemini` | `gemini` or `ollama` |
| `OLLAMA_URL` | No | `http://localhost:11434` | Ollama server (if using local LLM) |
| `NUXT_PUBLIC_SITE_URL` | No | `http://localhost:3000` | Used for canonical URLs and JSON-LD |
| `ADMIN_PASSWORD` | No | — | Protects `/admin/upload` and `POST /api/generate`. When unset (local dev), no auth is required. |

---

## How to Generate a New Blog

### Via the upload UI

1. Start the dev server: `npm run dev`
2. Go to [http://localhost:3000/admin/upload](http://localhost:3000/admin/upload)
3. Drag and drop any company-ranking CSV (up to 2 MB)
4. Enter an industry name (optional — inferred from filename if blank)
5. Click **Preview columns** to see what was auto-detected; adjust any roles with the dropdowns
6. Click **Generate blog** — takes 10–20 seconds on the free Gemini tier

### Via the API directly

```bash
curl -X POST http://localhost:3000/api/generate \
  -F "file=@./data/fintech_companies_seed.csv" \
  -F "industry=Fintech"
# → { "slug": "top-100-fintech-companies", "url": "/blog/top-100-fintech-companies" }
```

### Requirements for the CSV

- At least one column that looks like a company name (`Company`, `Name`, `Organisation`, etc.)
- At least one numeric or money column (`Total Raised`, `Funding (USD)`, `Revenue`, etc.)
- Any column separator pattern; multi-value tags should use `;` as the delimiter

---

## Run Tests

```bash
npm test          # run the full Vitest suite (144 tests)
npm run lint      # ESLint
npm run format:check  # Prettier dry-run
```

---

## Tools Used and Why

| Tool | Why |
|---|---|
| **Nuxt 3** | SSR out of the box; Nitro server handles uploads + storage; file-based routing |
| **Tailwind CSS** | Utility-first; rapid prototyping without bloating the CSS bundle |
| **Inline RFC-4180 parser** | ~80-line zero-dependency CSV parser; handles quoted fields, BOM, CRLF/LF/CR. Replaces PapaParse which caused a Rollup parse error in the Cloudflare Workers build. |
| **Google Gemini (gemini-2.5-flash)** | Free tier; fast; supports `responseMimeType: 'application/json'` which reduces malformed output. Falls back to `gemini-3.5-flash-lite` on quota errors (HTTP 429). |
| **Zod** | Runtime schema validation of LLM output; catches the inevitable occasional garbage response |
| **Nitro storage** | `fs` driver locally; `cloudflare-kv-binding` driver in production. Split via build-time `isCloudflare` flag in `nuxt.config.ts`. |
| **@nuxtjs/sitemap** | Auto-generates `/sitemap.xml` from a dynamic URL source |
| **Vitest** | Fast unit test runner; runs pure TS files directly without Nuxt context |
| **tsx** | Runs the seed script as TypeScript without a separate compile step |
| **Claude Code** | AI coding assistant (Anthropic) used for iterative development and test writing |

---

## SEO Decisions

- **Single `<h1>` per page**, logical `h2`/`h3` hierarchy
- **`lang="en-GB"`** set globally in `nuxt.config.ts → app.head.htmlAttrs`
- **Canonical links** via `useHead` to prevent duplicate-content penalties
- **Three JSON-LD schemas**: `Article`, `ItemList` (eligible for rich-result carousel), `FAQPage` (eligible for FAQ accordions in SERPs)
- **Full table in server HTML** — search engines can index every ranked company without executing JavaScript
- **`rel="noopener nofollow"`** on external company links — passes no PageRank to third-party sites
- **`/admin` pages are `noindex`** — set via `useSeoMeta({ robots: 'noindex, nofollow' })`
- **Dynamic sitemap** — `@nuxtjs/sitemap` fetches `/api/__sitemap__/urls` which lists every generated blog slug

---

## How AI Accuracy Is Maintained

1. **Numbers computed in code** — `computeStats()` in `analyseDataset.ts` calculates every figure. The LLM never sees raw data, only the pre-computed results.
2. **Explicit instruction in prompt** — "Use ONLY the numbers provided. Do NOT invent, round, or approximate any figures."
3. **Zod schema validation** — the LLM response is parsed and validated against a strict schema. If it fails, a single retry is attempted.
4. **Post-validation number guard** — after Zod passes, every integer in the title, h1, and meta description is checked against `stats.count`. If the AI hallucinated "Top 10" for a 100-row dataset, those fields are replaced with the deterministic fallback values.
5. **Deterministic fallback** — if the LLM fails (invalid JSON, rate limit, missing API key), `buildFallbackCopy()` generates template-based copy entirely from the `stats` object. The demo never breaks.
6. **Quota resilience** — on HTTP 429 from `gemini-2.5-flash`, the system retries automatically with `gemini-3.5-flash-lite` before falling back to the template.

---

## My Approach

I approached this project by focusing on three things: making the blog generation process reusable, keeping the statistics accurate, and ensuring the generated pages are SEO friendly.

I started by building a CSV processing workflow that identifies important columns, such as company names, funding amounts and locations. I wanted the application to work with different datasets rather than being limited to fintech.

I kept the statistical calculations separate from AI content generation. The application calculates the statistics directly from the dataset and then uses an LLM to help write the blog content. This makes the numerical results more reliable while allowing the content to read naturally.

I also added a fallback template so the application can generate a blog when the AI service is unavailable or returns an invalid response. For usability, I included a CSV upload interface where users can preview automatically detected columns and adjust them before generating a blog.

Finally, I used Nuxt's server-side rendering and SEO features to make the generated pages accessible to search engines, with relevant metadata, structured data and a ranking table.

If I continued developing the project, I would focus on improving column-detection confidence, handling more unusual CSV formats and expanding the automated tests.

---

## Limitations

- **Gemini free-tier rate limits** — 20 requests per day on the free tier. On quota exhaustion the system automatically retries with `gemini-3.5-flash-lite`, then falls back to the deterministic template.
- **CSV size cap** at 2 MB — sufficient for datasets up to ~10,000 rows. Very large CSVs would need streaming parsing.
- **Single currency per dataset** — if a CSV mixes `£` and `$` values, the first currency found wins.
- **Gemini SDK version** — uses `@google/generative-ai` (v0.x). The newer `@google/genai` (v2.x) has a different API surface. Migrating is a low-priority refactor once the new SDK stabilises.

---

## Deployment (Cloudflare Pages)

**Live URL:** https://seo-blog-generator-772.pages.dev

### First-time setup

```bash
# 1. Authenticate
npx wrangler login

# 2. Create KV namespace (only once)
npx wrangler kv namespace create BLOGS
npx wrangler kv namespace create BLOGS --preview
# Paste the returned ids into wrangler.toml

# 3. Set secrets (never commit these)
npx wrangler pages secret put GEMINI_API_KEY  --project-name seo-blog-generator
npx wrangler pages secret put ADMIN_PASSWORD  --project-name seo-blog-generator
```

### Deploy

```bash
npm run deploy          # builds + deploys in one step
# or separately:
npm run deploy:build    # NITRO_PRESET=cloudflare-pages npm run build
npx wrangler pages deploy dist --project-name seo-blog-generator
```

### Seed production KV

```bash
# 1. Generate local blog data
npm run seed

# 2. Push to production KV
npm run seed:kv
```

### How storage works

| Environment | Driver | Configured by |
|---|---|---|
| `npm run dev` | `fs` (`.data/blogs/`) | `devStorage` in `nuxt.config.ts` |
| Cloudflare Pages | `cloudflare-kv-binding` (`BLOGS`) | `storage` when `NITRO_PRESET=cloudflare-pages` |

### Admin auth

Set `ADMIN_PASSWORD` as a Cloudflare Pages secret. The middleware (`server/middleware/admin-auth.ts`) guards `/admin/upload` and `POST /api/generate` using an HMAC-SHA256 session token (Web Crypto API — runs identically on Workers and Node.js 20+). When `ADMIN_PASSWORD` is unset (local dev), all requests pass through.

---

## Future Improvements

- **Scheduled regeneration** — a cron job to refresh AI copy as new CSV uploads arrive
- **Multiple datasets per industry** — version history for the same industry (quarterly rankings)
- **Image generation** — use Gemini's image API or DALL-E to generate a hero image per blog
- **Column-detection confidence scores** — show the user how confident the auto-detection is
- **Export to Markdown** — let users download the generated content for use in other CMSes
