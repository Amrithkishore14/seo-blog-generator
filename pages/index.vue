<script setup lang="ts">
/**
 * pages/index.vue — Blog index page
 *
 * Lists all generated blogs, server-rendered via useFetch.
 * Search engines see the full list in the initial HTML response.
 */

// useFetch calls the API at request time — the result is available in SSR
const { data: blogs } = await useFetch('/api/blogs')

// Page-level SEO
useSeoMeta({
  title: 'Company Ranking Blogs — BlogGen',
  description: 'Industry-specific company rankings and funding analysis, powered by real data.',
  ogTitle: 'Company Ranking Blogs',
  ogDescription: 'Industry company rankings turned into SEO-optimised blog pages.',
})

/** Format a number as compact money, e.g. £30.3m */
function formatCompact(amount: number, currency: string): string {
  if (amount >= 1_000_000_000) return `${currency}${(amount / 1_000_000_000).toFixed(1)}bn`
  if (amount >= 1_000_000) return `${currency}${(amount / 1_000_000).toFixed(1)}m`
  if (amount >= 1_000) return `${currency}${(amount / 1_000).toFixed(0)}k`
  return `${currency}${amount}`
}

/** Format an ISO date string as a readable date */
function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}
</script>

<template>
  <main class="max-w-4xl mx-auto px-4 py-12">
    <h1 class="text-3xl font-bold text-gray-900 mb-2">Company Ranking Blogs</h1>
    <p class="text-gray-500 mb-8">
      Each blog is generated from a CSV upload — statistics computed from real data, copy written by
      AI.
    </p>

    <!-- Empty state -->
    <div v-if="!blogs?.length" class="bg-white border border-gray-200 rounded-xl p-12 text-center">
      <p class="text-gray-500 text-lg mb-4">No blogs generated yet.</p>
      <NuxtLink
        to="/admin/upload"
        class="inline-flex items-center gap-2 bg-indigo-600 text-white px-5 py-2.5 rounded-lg hover:bg-indigo-700 font-medium"
      >
        Upload your first CSV
      </NuxtLink>
    </div>

    <!-- Blog listing -->
    <ul v-else class="space-y-4">
      <li
        v-for="blog in blogs"
        :key="blog!.slug"
        class="bg-white border border-gray-200 rounded-xl p-6 hover:border-indigo-300 hover:shadow-sm transition-all"
      >
        <NuxtLink :to="`/blog/${blog!.slug}`" class="group block">
          <!-- Industry badge -->
          <span
            class="inline-block text-xs font-semibold uppercase tracking-wide text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded mb-2"
          >
            {{ blog!.industry }}
          </span>

          <!-- Title -->
          <h2
            class="text-xl font-semibold text-gray-900 group-hover:text-indigo-600 transition-colors mb-1"
          >
            {{ blog!.title }}
          </h2>

          <!-- Meta description -->
          <p class="text-gray-500 text-sm mb-3 line-clamp-2">
            {{ blog!.metaDescription }}
          </p>

          <!-- Stats row -->
          <div class="flex flex-wrap gap-4 text-sm text-gray-600">
            <span>
              <strong class="font-medium text-gray-800">{{ blog!.count }}</strong> companies
            </span>
            <span v-if="blog!.metricTotal">
              <strong class="font-medium text-gray-800">
                {{ formatCompact(blog!.metricTotal, blog!.metricCurrency ?? '£') }}
              </strong>
              total raised
            </span>
            <span class="text-gray-400">
              {{ formatDate(blog!.createdAt) }}
            </span>
          </div>
        </NuxtLink>
      </li>
    </ul>

    <!-- Upload CTA -->
    <div class="mt-10 text-center">
      <NuxtLink
        to="/admin/upload"
        class="inline-flex items-center gap-2 bg-indigo-600 text-white px-5 py-2.5 rounded-lg hover:bg-indigo-700 font-medium"
      >
        Generate a new blog →
      </NuxtLink>
    </div>
  </main>
</template>
