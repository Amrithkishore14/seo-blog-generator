<script setup lang="ts">
/**
 * pages/blog/[slug].vue — The single reusable blog template
 *
 * This one component handles EVERY generated blog regardless of industry.
 * It works by fetching the BlogEntry from /api/blogs/:slug and dynamically
 * rendering whichever columns exist in the dataset.
 *
 * SEO features on this page:
 *   - useSeoMeta: title, description, og:*, twitter:*
 *   - useHead: canonical link + three JSON-LD scripts (Article, ItemList, FAQPage)
 *   - Logical H1 → H2 → H3 heading hierarchy
 *   - Semantic table with <caption>, <thead>, scope attributes
 *   - Full table in server-rendered HTML (not client-only)
 *   - lang="en-GB" set globally in nuxt.config.ts
 */

import type { BlogEntry } from '../../server/utils/pipeline'
import { formatMetricCell } from '../../server/utils/formatMetricCell'

const route = useRoute()
const config = useRuntimeConfig()

// useFetch is SSR-aware: the data is fetched on the server and included in the
// initial HTML, so search engines see the full content without JavaScript.
const { data: blog, error } = await useFetch<BlogEntry>(`/api/blogs/${route.params.slug}`)

// Propagate 404s properly — Nuxt will render the error page
if (error.value || !blog.value) {
  throw createError({
    statusCode: 404,
    statusMessage: 'Blog not found. It may have been deleted or never generated.',
    fatal: true,
  })
}

// ── Canonical URL ─────────────────────────────────────────────────────────────
// Declared first so it can be reused by both useSeoMeta (og:url) and JSON-LD.
const canonicalUrl = `${config.public.siteUrl}/blog/${route.params.slug}`

// ── SEO meta ─────────────────────────────────────────────────────────────────

const ogImageUrl = `${config.public.siteUrl}/og-image.svg`

useSeoMeta({
  title: blog.value.copy.title,
  description: blog.value.copy.metaDescription,
  ogTitle: blog.value.copy.title,
  ogDescription: blog.value.copy.metaDescription,
  ogType: 'article',
  ogUrl: canonicalUrl,
  ogImage: ogImageUrl,
  twitterCard: 'summary_large_image',
  twitterTitle: blog.value.copy.title,
  twitterDescription: blog.value.copy.metaDescription,
  twitterImage: ogImageUrl,
})

// ── JSON-LD schemas ────────────────────────────────────────────────────────────
// Three structured-data schemas help search engines understand the page:
//   1. Article  — marks the page as editorial content
//   2. ItemList — the ranked list of companies (eligible for rich results)
//   3. FAQPage  — FAQ section (eligible for FAQ rich results in SERPs)

const articleSchema = {
  '@context': 'https://schema.org',
  '@type': 'Article',
  headline: blog.value.copy.h1,
  description: blog.value.copy.metaDescription,
  datePublished: blog.value.createdAt,
  dateModified: blog.value.createdAt,
  url: canonicalUrl,
  inLanguage: 'en-GB',
  keywords: blog.value.copy.keywords.join(', '),
  // author and publisher are required by Google for Article rich-result eligibility
  author: {
    '@type': 'Organization',
    name: 'BlogGen',
    url: config.public.siteUrl,
  },
  publisher: {
    '@type': 'Organization',
    name: 'BlogGen',
    url: config.public.siteUrl,
  },
}

const itemListSchema = {
  '@context': 'https://schema.org',
  '@type': 'ItemList',
  name: blog.value.copy.h1,
  numberOfItems: blog.value.stats.count,
  itemListElement: blog.value.rows
    .slice(0, 20)
    .map((row, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: blog.value!.nameHeader ? row[blog.value!.nameHeader] : '',
      url: blog.value!.websiteHeader ? row[blog.value!.websiteHeader] : undefined,
    }))
    .filter((item) => item.name),
}

const faqSchema = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: blog.value.copy.faq.map((item) => ({
    '@type': 'Question',
    name: item.q,
    acceptedAnswer: { '@type': 'Answer', text: item.a },
  })),
}

useHead({
  link: [{ rel: 'canonical', href: canonicalUrl }],
  script: [
    { type: 'application/ld+json', innerHTML: JSON.stringify(articleSchema) },
    { type: 'application/ld+json', innerHTML: JSON.stringify(itemListSchema) },
    { type: 'application/ld+json', innerHTML: JSON.stringify(faqSchema) },
  ],
})

// ── Client-side table sorting & search (progressive enhancement) ──────────────
// These refs are reactive — Vue updates the displayed rows without a page reload.
// The INITIAL server-rendered HTML contains ALL rows; JS enhances them.
const searchQuery = ref('')
const sortCol = ref<string | null>(null)
const sortDir = ref<'asc' | 'desc'>('asc')

function setSort(col: string) {
  if (sortCol.value === col) {
    // Toggle direction on a second click of the same column
    sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
  } else {
    sortCol.value = col
    sortDir.value = 'asc'
  }
}

/** All rows, filtered and sorted based on current UI state. */
const displayRows = computed(() => {
  if (!blog.value) return []
  let rows = [...blog.value.rows]

  // Search: case-insensitive match against any cell value
  if (searchQuery.value.trim()) {
    const q = searchQuery.value.toLowerCase()
    rows = rows.filter((row) => Object.values(row).some((v) => v.toLowerCase().includes(q)))
  }

  // Sort
  if (sortCol.value) {
    const col = sortCol.value
    const dir = sortDir.value === 'asc' ? 1 : -1
    rows = [...rows].sort((a, b) => {
      const av = parseNumeric(a[col] ?? '')
      const bv = parseNumeric(b[col] ?? '')
      // Numeric sort if both values look like numbers; string sort otherwise
      if (av !== null && bv !== null) return (av - bv) * dir
      return (a[col] ?? '').localeCompare(b[col] ?? '') * dir
    })
  }

  return rows
})

/** Attempt to parse a cell value as a number (handles money strings). */
function parseNumeric(value: string): number | null {
  const stripped = value.replace(/[£$€,\s]/g, '').replace(/[kmbn]+$/i, '')
  const n = parseFloat(stripped)
  if (isNaN(n)) return null
  if (/bn$/i.test(value)) return n * 1_000_000_000
  if (/m$/i.test(value)) return n * 1_000_000
  if (/k$/i.test(value)) return n * 1_000
  return n
}

// ── Formatting helpers ────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

function formatCompact(amount: number, currency: string): string {
  if (amount >= 1_000_000_000) return `${currency}${(amount / 1_000_000_000).toFixed(1)}bn`
  if (amount >= 1_000_000) return `${currency}${(amount / 1_000_000).toFixed(1)}m`
  if (amount >= 1_000) return `${currency}${(amount / 1_000).toFixed(0)}k`
  return `${currency}${amount.toLocaleString('en-GB')}`
}

// Percentage for CSS bar chart widths (clamped to 0–100)
function pct(value: number, max: number): number {
  if (max === 0) return 0
  return Math.min(100, Math.max(0, (value / max) * 100))
}

// The columns to show in the table, in a sensible order
const tableHeaders = computed(() => {
  if (!blog.value) return []
  const b = blog.value
  // Build ordered list: rank → name → metric → region → industries → description
  return [
    b.rankHeader,
    b.nameHeader,
    b.metricHeader,
    b.regionHeader,
    b.industriesHeader,
    b.descriptionHeader,
  ].filter((h): h is string => h !== null && h !== undefined)
})
</script>

<template>
  <main>
    <!-- <main> provides the required ARIA landmark that screen readers use to jump to content -->
    <article v-if="blog" class="max-w-4xl mx-auto px-4 py-10">
      <!-- ── Header ─────────────────────────────────────────────────────────── -->
      <header class="mb-8">
        <!-- Industry badge -->
        <span
          class="inline-block text-xs font-semibold uppercase tracking-wide text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded mb-3"
        >
          {{ blog.industry.charAt(0).toUpperCase() + blog.industry.slice(1) }}
        </span>

        <!-- One H1 per page — required for good SEO and accessibility -->
        <h1 class="text-3xl md:text-4xl font-bold text-gray-900 leading-tight mb-3">
          {{ blog.copy.h1 }}
        </h1>

        <p class="text-gray-500 text-sm">
          Published {{ formatDate(blog.createdAt) }} · {{ blog.stats.count }} companies ·
          <!-- amber-700 meets WCAG AA on gray-50 (#b45309 ≈ 4.6:1) -->
          <!-- green-700 meets WCAG AA on gray-50 (#15803d ≈ 5.2:1); green-600 fails at 3.15:1 -->
          <span v-if="blog.usedFallback" class="text-amber-700"
            >Template copy (AI unavailable)</span
          >
          <span v-else class="text-green-700">AI-generated copy</span>
        </p>
      </header>

      <!-- ── Intro ──────────────────────────────────────────────────────────── -->
      <section class="mb-8 prose prose-gray max-w-none">
        <p
          v-for="(para, i) in blog.copy.intro"
          :key="i"
          class="text-lg text-gray-700 leading-relaxed mb-4"
        >
          {{ para }}
        </p>
      </section>

      <!-- ── Stat cards ─────────────────────────────────────────────────────── -->
      <section aria-label="Key statistics" class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-10">
        <div class="bg-white border border-gray-200 rounded-xl p-4">
          <p class="text-xs text-gray-500 uppercase tracking-wide font-semibold mb-1">
            {{
              blog.stats.metricLabel.toLowerCase().startsWith('total')
                ? blog.stats.metricLabel
                : `Total ${blog.stats.metricLabel}`
            }}
          </p>
          <p class="text-2xl font-bold text-gray-900">
            {{ formatCompact(blog.stats.metricTotal, blog.stats.metricCurrency) }}
          </p>
        </div>
        <div class="bg-white border border-gray-200 rounded-xl p-4">
          <p class="text-xs text-gray-500 uppercase tracking-wide font-semibold mb-1">Average</p>
          <p class="text-2xl font-bold text-gray-900">
            {{ formatCompact(blog.stats.metricMean, blog.stats.metricCurrency) }}
          </p>
        </div>
        <div class="bg-white border border-gray-200 rounded-xl p-4">
          <p class="text-xs text-gray-500 uppercase tracking-wide font-semibold mb-1">Median</p>
          <p class="text-2xl font-bold text-gray-900">
            {{ formatCompact(blog.stats.metricMedian, blog.stats.metricCurrency) }}
          </p>
        </div>
        <div class="bg-white border border-gray-200 rounded-xl p-4">
          <p class="text-xs text-gray-500 uppercase tracking-wide font-semibold mb-1">
            Top-10 share
          </p>
          <p class="text-2xl font-bold text-gray-900">{{ blog.stats.top10Share.toFixed(1) }}%</p>
        </div>
      </section>

      <!-- ── AI sections ─────────────────────────────────────────────────────── -->
      <section class="mb-10 space-y-8">
        <div v-for="section in blog.copy.sections" :key="section.heading">
          <h2 class="text-xl font-semibold text-gray-900 mb-2">{{ section.heading }}</h2>
          <p class="text-gray-700 leading-relaxed">{{ section.body }}</p>
        </div>
      </section>

      <!-- ── Key insights ───────────────────────────────────────────────────── -->
      <section class="bg-indigo-50 border border-indigo-100 rounded-xl p-6 mb-10">
        <h2 class="text-lg font-semibold text-indigo-900 mb-4">Key Insights</h2>
        <ul class="space-y-2">
          <li
            v-for="insight in blog.copy.insights"
            :key="insight"
            class="flex items-start gap-2 text-indigo-800"
          >
            <span class="text-indigo-400 mt-0.5 flex-shrink-0">▸</span>
            <span>{{ insight }}</span>
          </li>
        </ul>
      </section>

      <!-- ── Bar chart: Funding by region ──────────────────────────────────── -->
      <section
        v-if="blog.stats.regionBreakdown.length > 1"
        class="bg-white border border-gray-200 rounded-xl p-6 mb-6"
        aria-label="Funding by region"
      >
        <h2 class="text-lg font-semibold text-gray-900 mb-4">
          {{ blog.stats.metricLabel }} by Region
        </h2>
        <div class="space-y-3">
          <div
            v-for="r in blog.stats.regionBreakdown.slice(0, 8)"
            :key="r.region"
            class="flex items-center gap-3"
          >
            <!-- Region name — fixed width so bars align -->
            <span class="text-sm text-gray-700 w-28 flex-shrink-0 truncate">{{ r.region }}</span>
            <!-- Bar — width is percentage of the top region's total (not overall total) -->
            <div class="flex-1 bg-gray-100 rounded-full h-4 overflow-hidden">
              <div
                class="bg-indigo-500 h-full rounded-full"
                :style="{ width: `${pct(r.total, blog.stats.regionBreakdown[0].total)}%` }"
              />
            </div>
            <span class="text-sm font-medium text-gray-800 w-16 text-right flex-shrink-0">
              {{ formatCompact(r.total, blog.stats.metricCurrency) }}
            </span>
            <!-- gray-600 meets WCAG AA on white (#4b5563 ≈ 7.4:1 vs #f3f4f6 background) -->
            <span class="text-xs text-gray-600 w-8 text-right flex-shrink-0"> ×{{ r.count }} </span>
          </div>
        </div>
      </section>

      <!-- ── Bar chart: Top category tags ───────────────────────────────────── -->
      <section
        v-if="blog.stats.topCategories.length > 1"
        class="bg-white border border-gray-200 rounded-xl p-6 mb-10"
        aria-label="Top sector tags"
      >
        <h2 class="text-lg font-semibold text-gray-900 mb-4">Top Sector Tags</h2>
        <div class="space-y-2">
          <div
            v-for="tag in blog.stats.topCategories.slice(0, 10)"
            :key="tag.tag"
            class="flex items-center gap-3"
          >
            <span class="text-sm text-gray-700 w-48 flex-shrink-0 truncate">{{ tag.tag }}</span>
            <div class="flex-1 bg-gray-100 rounded-full h-3 overflow-hidden">
              <div
                class="bg-violet-500 h-full rounded-full"
                :style="{ width: `${pct(tag.count, blog.stats.topCategories[0].count)}%` }"
              />
            </div>
            <span class="text-sm text-gray-500 w-8 text-right flex-shrink-0">{{ tag.count }}</span>
          </div>
        </div>
      </section>

      <!-- ── Full ranking table ─────────────────────────────────────────────── -->
      <section class="mb-10">
        <div class="flex flex-wrap items-center justify-between gap-3 mb-3">
          <h2 class="text-xl font-semibold text-gray-900">
            Full Rankings ({{ displayRows.length }} of {{ blog.stats.count }})
          </h2>
          <!-- Search input — progressive enhancement; table still works without JS -->
          <input
            v-model="searchQuery"
            type="search"
            placeholder="Search companies…"
            aria-label="Search the rankings table"
            class="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 w-48"
          />
        </div>

        <!-- Table wrapper: horizontal scroll on small screens -->
        <div class="overflow-x-auto rounded-xl border border-gray-200">
          <table class="w-full text-sm">
            <caption class="sr-only">
              {{
                blog.copy.h1
              }}
              — complete ranking table with
              {{
                blog.stats.count
              }}
              companies
            </caption>

            <thead class="bg-gray-50 text-gray-600 text-xs uppercase tracking-wide">
              <tr>
                <th
                  v-for="header in tableHeaders"
                  :key="header"
                  scope="col"
                  class="px-4 py-3 text-left font-semibold whitespace-nowrap"
                  :aria-sort="
                    sortCol === header ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'
                  "
                >
                  <!-- <button> makes the header keyboard-focusable and activatable with Enter/Space -->
                  <button
                    type="button"
                    class="flex items-center gap-1 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded"
                    @click="setSort(header)"
                  >
                    {{ header }}
                    <span aria-hidden="true" class="ml-0.5">
                      <template v-if="sortCol === header">{{
                        sortDir === 'asc' ? '↑' : '↓'
                      }}</template>
                      <template v-else>↕</template>
                    </span>
                  </button>
                </th>
              </tr>
            </thead>

            <tbody class="divide-y divide-gray-100">
              <tr v-for="(row, i) in displayRows" :key="i" class="hover:bg-gray-50">
                <td v-for="header in tableHeaders" :key="header" class="px-4 py-3 text-gray-700">
                  <!-- Company name cell — plain text, no special rendering needed -->
                  <template v-if="header === blog.nameHeader">
                    <span class="font-medium text-gray-900">{{ row[header] }}</span>
                  </template>

                  <!-- Website cell — external link with security attributes -->
                  <template v-else-if="header === blog.websiteHeader && row[header]">
                    <a
                      :href="row[header]"
                      target="_blank"
                      rel="noopener nofollow"
                      class="text-indigo-600 hover:underline truncate block max-w-[160px]"
                      :aria-label="`Visit ${blog.nameHeader ? row[blog.nameHeader] : 'company'} website (opens in new tab)`"
                    >
                      {{ row[header].replace(/^https?:\/\//, '') }}
                    </a>
                  </template>

                  <!-- Description cell — truncated to keep the table readable -->
                  <template v-else-if="header === blog.descriptionHeader">
                    <span class="text-gray-500 block max-w-xs truncate" :title="row[header]">
                      {{ row[header] }}
                    </span>
                  </template>

                  <!-- Metric cell — format plain integers with currency + thousands separator -->
                  <template v-else-if="blog.metricHeader && header === blog.metricHeader">
                    {{ formatMetricCell(row[header] ?? '', blog.stats.metricCurrency) }}
                  </template>

                  <!-- Default cell -->
                  <template v-else>
                    {{ row[header] ?? '—' }}
                  </template>
                </td>
              </tr>

              <!-- Empty state when search returns no results -->
              <tr v-if="displayRows.length === 0">
                <td :colspan="tableHeaders.length" class="px-4 py-8 text-center text-gray-400">
                  No companies match "{{ searchQuery }}"
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- ── FAQ ────────────────────────────────────────────────────────────── -->
      <section class="mb-10">
        <h2 class="text-xl font-semibold text-gray-900 mb-4">Frequently Asked Questions</h2>
        <div class="space-y-4">
          <div
            v-for="item in blog.copy.faq"
            :key="item.q"
            class="bg-white border border-gray-200 rounded-xl p-5"
          >
            <h3 class="font-semibold text-gray-900 mb-1">{{ item.q }}</h3>
            <p class="text-gray-600 text-sm leading-relaxed">{{ item.a }}</p>
          </div>
        </div>
      </section>

      <!-- ── Methodology note ───────────────────────────────────────────────── -->
      <aside
        class="bg-gray-50 border border-gray-200 rounded-xl p-5 text-sm text-gray-500"
        aria-label="Methodology and data source"
      >
        <h2 class="font-semibold text-gray-700 mb-1">Methodology &amp; Data Source</h2>
        <p>
          Statistics on this page (total, average, median, regional breakdowns) are computed
          directly from the uploaded CSV using deterministic code — no AI is involved in number
          generation. The written copy was
          {{
            blog.usedFallback
              ? 'generated using a deterministic template (AI was unavailable)'
              : 'written by Google Gemini based solely on the pre-computed figures'
          }}. Data was uploaded on {{ formatDate(blog.createdAt) }}.
        </p>
        <p v-if="blog.stats.datasetTraits.length" class="mt-2">
          Dataset traits: {{ blog.stats.datasetTraits.join(' · ') }}.
        </p>
      </aside>
    </article>
  </main>
</template>
