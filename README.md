# seo-blog-generator

Drop in a CSV of ranked companies, get back a fully server-rendered, SEO-ready blog page — copy written by Gemini, numbers computed in code. Built for the Beauhurst take-home test.

---

## What it does

Upload a CSV → columns are auto-detected → stats are computed in TypeScript → those stats go into a Gemini prompt → the LLM writes the copy → the result is saved → Nuxt SSR renders a blog page with structured data, a ranking table, and bar charts.

The rule I kept throughout: **the AI writes prose, never numbers**. Every figure in the copy comes from `computeStats()`, not from the model. This sidesteps hallucination without sacrificing readable copy.

---

## How it fits together

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

## Getting started

### You'll need

- **Node.js 20+** — the seed script uses `--env-file`, which landed in Node 20
- A [Google Gemini API key](https://aistudio.google.com/apikey) (free tier is fine) — if you skip this, the app falls back to a deterministic template and still works

### Install and run

```bash
# clone and install
cd seo-blog-generator
npm install

# copy the env file and drop in your key
cp .env.example .env
# open .env and set GEMINI_API_KEY

# generate the sample blogs (fintech + healthtech)
npm run seed

# start the dev server
npm run dev
# → http://localhost:3000
```

### Environment variables

| Variable | Required | Default | What it does |
|---|---|---|---|
| `GEMINI_API_KEY` | Recommended | — | Gemini free-tier key |
| `LLM_PROVIDER` | No | `gemini` | `gemini` or `ollama` |
| `OLLAMA_URL` | No | `http://localhost:11434` | Point this at your local Ollama instance |
| `NUXT_PUBLIC_SITE_URL` | No | `http://localhost:3000` | Baked into canonical URLs and JSON-LD |
| `ADMIN_PASSWORD` | No | — | Locks down `/admin/upload` and `POST /api/generate`. Leave it unset in local dev and the middleware lets everything through. |

---

## Generating a blog

### Through the UI

1. `npm run dev`
2. Open [http://localhost:3000/admin/upload](http://localhost:3000/admin/upload)
3. Drag in any company-ranking CSV (up to 2 MB)
4. Optionally type an industry name — if you leave it blank it's inferred from the filename
5. Hit **Preview columns** to check what was auto-detected; fix any wrong roles with the dropdowns
6. Hit **Generate blog** — on the free Gemini tier expect 10–20 seconds

### Through the API

```bash
curl -X POST http://localhost:3000/api/generate \
  -F "file=@./data/fintech_companies_seed.csv" \
  -F "industry=Fintech"
# returns: { "slug": "top-100-fintech-companies", "url": "/blog/top-100-fintech-companies" }
```

### What the CSV needs

- At least one column that reads like a company name (`Company`, `Name`, `Organisation`, …)
- At least one numeric or money column (`Total Raised`, `Funding (USD)`, `Revenue`, …)
- Multi-value tag columns (sectors, industries) should delimit values with `;`

---

## Tests

```bash
npm test              # Vitest suite — 144 tests
npm run lint          # ESLint
npm run format:check  # Prettier dry-run
```

---

## Tech choices

| Tool | Why I picked it |
|---|---|
| **Nuxt 3** | SSR with zero config, Nitro handles the server routes and storage, file-based routing keeps things tidy |
| **Tailwind CSS** | Fast to iterate with, doesn't grow the CSS bundle unnecessarily |
| **Inline RFC-4180 CSV parser** | ~80 lines, no dependencies, handles quoted fields, BOM, and all three line-ending styles. PapaParse was my first choice but it threw a Rollup parse error inside the Cloudflare Workers build |
| **Google Gemini (`gemini-2.5-flash`)** | Free, fast, and supports `responseMimeType: 'application/json'` which cuts down on malformed output significantly. Falls back to `gemini-3.5-flash-lite` on HTTP 429 |
| **Zod** | Validates the LLM response against a strict schema before anything gets saved — necessary because models occasionally return garbage |
| **Nitro storage** | `fs` driver in dev, `cloudflare-kv-binding` in production. Switched at build time via the `isCloudflare` flag in `nuxt.config.ts` |
| **@nuxtjs/sitemap** | Generates `/sitemap.xml` from a dynamic URL list — no manual maintenance |
| **Vitest** | Runs TypeScript test files directly without needing the full Nuxt context |
| **tsx** | Lets the seed script run as TypeScript without a separate compile step |
| **Claude Code** | Used throughout for iterative development and writing tests |

---

## SEO

- One `<h1>` per page, logical `h2` → `h3` hierarchy underneath
- `lang="en-GB"` set globally in `nuxt.config.ts`
- Canonical URLs via `useHead` to avoid duplicate-content issues
- Three JSON-LD schemas per page: `Article`, `ItemList` (carousel-eligible), `FAQPage` (FAQ accordion-eligible)
- The full ranking table is in the server HTML — crawlers can index every company without running JS
- External company links use `rel="noopener nofollow"` — no PageRank leaking out
- `/admin` routes are `noindex, nofollow`
- Sitemap is built dynamically from the list of stored blog slugs

---

## Keeping the AI honest

This was the part I thought about most. Six layers:

1. **Compute first, prompt second** — `computeStats()` calculates everything. The model only ever sees pre-computed numbers, never the raw CSV.
2. **Hard instruction in the prompt** — "Use ONLY the numbers provided. Do NOT invent, round, or approximate any figures."
3. **Zod validation** — every response is validated against a typed schema. One retry is attempted on failure.
4. **Post-validation number guard** — after Zod passes, every small integer in the title, `h1`, and meta description is checked against `stats.count`. If the model wrote "Top 10" for a 100-row dataset, that field gets replaced with the deterministic fallback.
5. **Deterministic fallback** — `buildFallbackCopy()` generates copy entirely from the stats object. If Gemini is down, rate-limited, or returns bad JSON, the page still generates cleanly.
6. **Quota fallback model** — on HTTP 429 from `gemini-2.5-flash`, the system automatically retries with `gemini-3.5-flash-lite` before giving up and using the template.

---

## My Approach

I approached this project by focusing on three things: making the blog generation process reusable, keeping the statistics accurate, and ensuring the generated pages are SEO friendly.

I started by building a CSV processing workflow that identifies important columns, such as company names, funding amounts and locations. I wanted the application to work with different datasets rather than being limited to fintech.

I kept the statistical calculations separate from AI content generation. The application calculates the statistics directly from the dataset and then uses an LLM to help write the blog content. This makes the numerical results more reliable while allowing the content to read naturally.

I also added a fallback template so the application can generate a blog when the AI service is unavailable or returns an invalid response. For usability, I included a CSV upload interface where users can preview automatically detected columns and adjust them before generating a blog.

Finally, I used Nuxt's server-side rendering and SEO features to make the generated pages accessible to search engines, with relevant metadata, structured data and a ranking table.

If I continued developing the project, I would focus on improving column-detection confidence, handling more unusual CSV formats and expanding the automated tests.

---

## Known limitations

- **Gemini free-tier cap** — 20 requests per day. The quota fallback and deterministic template mean the app doesn't break when this is hit, but you'll get template copy instead of AI copy.
- **2 MB CSV limit** — fine for datasets up to roughly 10,000 rows. Anything bigger would need streaming parsing.
- **One currency per dataset** — if a CSV mixes `£` and `$` values, the first symbol found is used for the whole dataset.
- **Gemini SDK** — still on `@google/generative-ai` (v0.x). The newer `@google/genai` (v2.x) has a different API. Low-priority migration once the new SDK settles.

---

## Deployment (Cloudflare Pages)

**Live:** https://seo-blog-generator-772.pages.dev

### First-time setup

```bash
# authenticate
npx wrangler login

# create the KV namespace (one-off)
npx wrangler kv namespace create BLOGS
npx wrangler kv namespace create BLOGS --preview
# paste both returned IDs into wrangler.toml

# set secrets — never put these in the repo
npx wrangler pages secret put GEMINI_API_KEY --project-name seo-blog-generator
npx wrangler pages secret put ADMIN_PASSWORD  --project-name seo-blog-generator
```

### Deploy

```bash
npm run deploy       # build + deploy in one step

# or step by step:
npm run deploy:build
npx wrangler pages deploy dist --project-name seo-blog-generator
```

### Seeding production

```bash
npm run seed      # generate blog JSON locally
npm run seed:kv   # push it to the production KV namespace
```

### Storage at a glance

| Environment | Storage driver | Set by |
|---|---|---|
| `npm run dev` | `fs` → `.data/blogs/` | `devStorage` in `nuxt.config.ts` |
| Cloudflare Pages | `cloudflare-kv-binding` (`BLOGS`) | `storage` when `NITRO_PRESET=cloudflare-pages` |

### Admin auth

Set `ADMIN_PASSWORD` as a Cloudflare Pages secret. The middleware at `server/middleware/admin-auth.ts` validates an HMAC-SHA256 session token (Web Crypto API, works identically on Workers and Node 20+). In local dev with no password set, everything passes through.

---

## Things I'd add next

- **Scheduled regeneration** — cron job to refresh copy when new CSV data comes in
- **Version history** — keep previous runs for the same industry (useful for quarterly rankings)
- **Per-blog hero image** — generate something with Gemini's image API or DALL-E
- **Column-detection confidence** — surface a confidence score in the UI so users know when to override
- **Markdown export** — let users download the generated copy for use in other tools
