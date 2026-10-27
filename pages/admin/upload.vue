<script setup lang="ts">
/**
 * pages/admin/upload.vue — CSV upload interface
 *
 * Three-step workflow:
 *   1. Drag-and-drop / file picker to select a CSV
 *   2. "Preview columns" — calls /api/preview, shows detected roles,
 *      user can override any role with a dropdown
 *   3. "Generate blog" — calls /api/generate, shows animated progress,
 *      then navigates to the new page
 *
 * This page is noindexed (admin area — not for search engines).
 */

import type { ColumnRole, ColumnInfo } from '../../server/utils/analyseDataset'

// Tell search engines not to index admin pages
useSeoMeta({
  title: 'Upload CSV — BlogGen Admin',
  robots: 'noindex, nofollow',
})

// ── State ──────────────────────────────────────────────────────────────────────

/** The selected File object */
const selectedFile = ref<File | null>(null)
/** Drag-over state for visual feedback */
const isDragging = ref(false)
/** Industry name typed by the user */
const industryName = ref('')

/** Step: 'idle' | 'previewing' | 'preview-ready' | 'generating' | 'done' | 'error' */
type Step = 'idle' | 'previewing' | 'preview-ready' | 'generating' | 'done' | 'error'
const step = ref<Step>('idle')

/** Detected columns from the preview step */
const detectedColumns = ref<Record<string, ColumnInfo>>({})
/** User overrides: { header: newRole } */
const columnOverrides = ref<Record<string, ColumnRole>>({})
/** First 5 rows for the preview table */
const sampleRows = ref<Record<string, string>[]>([])
const totalRows = ref(0)

/** Generated blog slug after a successful generate */
const generatedSlug = ref('')
/** Progress message displayed during generation */
const progressMessage = ref('')
/** Error message */
const errorMessage = ref('')

// All possible roles for the override dropdowns
const ALL_ROLES: ColumnRole[] = [
  'name',
  'rank',
  'metric',
  'region',
  'industries',
  'category',
  'size',
  'stage',
  'description',
  'website',
  'unknown',
]

// Human-readable labels for roles
const ROLE_LABELS: Record<ColumnRole, string> = {
  name: 'Company Name',
  rank: 'Rank / Position',
  metric: 'Primary Metric (funding, revenue…)',
  region: 'Region / Location',
  industries: 'Industries / Tags (multi-value)',
  category: 'Category / Sector (single value)',
  size: 'Employee Size / Headcount',
  stage: 'Stage / Round',
  description: 'Description / About',
  website: 'Website URL',
  unknown: 'Ignore / Unknown',
}

// ── File selection ─────────────────────────────────────────────────────────────

function onFileInput(event: Event) {
  const input = event.target as HTMLInputElement
  if (input.files?.[0]) handleFile(input.files[0])
}

function onDrop(event: DragEvent) {
  isDragging.value = false
  event.preventDefault()
  const file = event.dataTransfer?.files?.[0]
  if (file) handleFile(file)
}

function handleFile(file: File) {
  if (!file.name.endsWith('.csv')) {
    errorMessage.value = 'Please upload a .csv file.'
    step.value = 'error'
    return
  }
  selectedFile.value = file
  // Reset any previous state when a new file is picked
  step.value = 'idle'
  detectedColumns.value = {}
  sampleRows.value = []
  columnOverrides.value = {}
  errorMessage.value = ''
}

// ── Step 1: Preview columns ────────────────────────────────────────────────────

async function previewColumns() {
  if (!selectedFile.value) return
  step.value = 'previewing'
  errorMessage.value = ''

  const form = new FormData()
  form.append('file', selectedFile.value)

  try {
    const result = await $fetch<{
      columns: Record<string, ColumnInfo>
      sample: Record<string, string>[]
      totalRows: number
    }>('/api/preview', { method: 'POST', body: form })

    detectedColumns.value = result.columns
    sampleRows.value = result.sample
    totalRows.value = result.totalRows
    // Seed the overrides with the auto-detected roles so the dropdowns
    // show the correct starting value
    columnOverrides.value = Object.fromEntries(
      Object.entries(result.columns).map(([h, info]) => [h, info.role]),
    ) as Record<string, ColumnRole>
    step.value = 'preview-ready'
  } catch (err: unknown) {
    errorMessage.value = extractMessage(err)
    step.value = 'error'
  }
}

// ── Step 2: Generate blog ──────────────────────────────────────────────────────

/** Fake progress messages shown while the API call is in-flight */
const PROGRESS_STEPS = [
  'Analysing column structure…',
  'Computing statistics…',
  'Calling AI to write the copy…',
  'Validating and saving…',
]

async function generateBlog() {
  if (!selectedFile.value) return
  step.value = 'generating'
  errorMessage.value = ''
  progressMessage.value = PROGRESS_STEPS[0]

  // Cycle through progress messages every 3 seconds for UX feedback
  let msgIndex = 0
  const timer = setInterval(() => {
    msgIndex = Math.min(msgIndex + 1, PROGRESS_STEPS.length - 1)
    progressMessage.value = PROGRESS_STEPS[msgIndex]
  }, 3000)

  const form = new FormData()
  form.append('file', selectedFile.value)
  if (industryName.value.trim()) {
    form.append('industry', industryName.value.trim())
  }
  // Send overrides as a JSON string
  form.append('columnOverrides', JSON.stringify(columnOverrides.value))

  try {
    const result = await $fetch<{ slug: string; url: string; usedFallback: boolean }>(
      '/api/generate',
      { method: 'POST', body: form },
    )
    clearInterval(timer)
    generatedSlug.value = result.slug
    step.value = 'done'
  } catch (err: unknown) {
    clearInterval(timer)
    errorMessage.value = extractMessage(err)
    step.value = 'error'
  }
}

function reset() {
  selectedFile.value = null
  step.value = 'idle'
  detectedColumns.value = {}
  sampleRows.value = []
  columnOverrides.value = {}
  industryName.value = ''
  errorMessage.value = ''
  generatedSlug.value = ''
}

/** Pull a human-readable message from a fetch error or unknown value. */
function extractMessage(err: unknown): string {
  if (err && typeof err === 'object' && 'statusMessage' in err) {
    return (err as { statusMessage: string }).statusMessage
  }
  if (err instanceof Error) return err.message
  return 'An unexpected error occurred.'
}

const headers = computed(() => Object.keys(detectedColumns.value))
</script>

<template>
  <main class="max-w-3xl mx-auto px-4 py-12">
    <h1 class="text-2xl font-bold text-gray-900 mb-1">Generate a New Blog</h1>
    <p class="text-gray-500 mb-8 text-sm">
      Upload any company-ranking CSV. The system detects columns automatically.
    </p>

    <!-- ── Error banner ─────────────────────────────────────────────────── -->
    <div
      v-if="step === 'error'"
      class="bg-red-50 border border-red-200 rounded-xl p-4 mb-6 flex items-start gap-3"
    >
      <span class="text-red-500 text-lg mt-0.5">✕</span>
      <div>
        <p class="font-medium text-red-800">Something went wrong</p>
        <p class="text-red-700 text-sm mt-1">{{ errorMessage }}</p>
        <button class="mt-2 text-sm text-red-600 underline" @click="reset">Try again</button>
      </div>
    </div>

    <!-- ── Done state ───────────────────────────────────────────────────── -->
    <div
      v-if="step === 'done'"
      class="bg-green-50 border border-green-200 rounded-xl p-6 text-center"
    >
      <p class="text-green-800 font-semibold text-lg mb-2">Blog generated successfully!</p>
      <NuxtLink
        :to="`/blog/${generatedSlug}`"
        class="inline-block bg-green-600 text-white px-6 py-2.5 rounded-lg hover:bg-green-700 font-medium mb-3"
      >
        View blog →
      </NuxtLink>
      <br />
      <button class="text-sm text-gray-500 underline" @click="reset">Generate another</button>
    </div>

    <!-- ── Generating state ─────────────────────────────────────────────── -->
    <div
      v-else-if="step === 'generating'"
      class="bg-white border border-gray-200 rounded-xl p-8 text-center"
    >
      <!-- Animated spinner -->
      <div
        class="inline-block w-10 h-10 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin mb-4"
      />
      <p class="text-gray-700 font-medium">{{ progressMessage }}</p>
      <p class="text-gray-400 text-sm mt-1">This can take 10–20 seconds on the free Gemini tier.</p>
    </div>

    <!-- ── Upload + form ────────────────────────────────────────────────── -->
    <template v-else>
      <!-- Drop zone -->
      <div
        class="border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors mb-6"
        :class="
          isDragging
            ? 'border-indigo-400 bg-indigo-50'
            : 'border-gray-300 hover:border-indigo-300 bg-white'
        "
        @dragover.prevent="isDragging = true"
        @dragleave="isDragging = false"
        @drop="onDrop"
        @click="($refs.fileInput as HTMLInputElement).click()"
      >
        <input
          ref="fileInput"
          type="file"
          accept=".csv,text/csv"
          class="hidden"
          @change="onFileInput"
        />
        <p v-if="selectedFile" class="text-indigo-700 font-medium">
          {{ selectedFile.name }}
          <span class="text-gray-400 font-normal text-sm"
            >({{ (selectedFile.size / 1024).toFixed(0) }} KB)</span
          >
        </p>
        <p v-else class="text-gray-500">
          <span class="font-medium text-indigo-600">Click to choose</span> or drag &amp; drop a CSV
          file here
        </p>
        <p class="text-xs text-gray-400 mt-1">
          Max 2 MB · must have a company name column and a numeric metric column
        </p>
      </div>

      <!-- Industry name field -->
      <div class="mb-4">
        <label for="industry" class="block text-sm font-medium text-gray-700 mb-1">
          Industry name
          <span class="text-gray-400 font-normal"
            >(optional — inferred from filename if blank)</span
          >
        </label>
        <input
          id="industry"
          v-model="industryName"
          type="text"
          placeholder="e.g. Fintech, Healthtech, Climate Tech"
          class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
        />
      </div>

      <!-- Step 1: Preview button -->
      <button
        :disabled="!selectedFile || step === 'previewing'"
        class="w-full py-2.5 rounded-lg font-medium text-sm transition-colors mb-4 disabled:opacity-50 disabled:cursor-not-allowed"
        :class="
          step === 'preview-ready'
            ? 'bg-gray-100 text-gray-700 border border-gray-300'
            : 'bg-indigo-100 text-indigo-700 hover:bg-indigo-200'
        "
        @click="previewColumns"
      >
        <span v-if="step === 'previewing'">Analysing columns…</span>
        <span v-else-if="step === 'preview-ready'">Re-run column detection</span>
        <span v-else>1. Preview &amp; map columns</span>
      </button>

      <!-- Column mapping table (shown after preview) -->
      <div v-if="step === 'preview-ready'" class="mb-6">
        <h2 class="text-sm font-semibold text-gray-700 mb-3 uppercase tracking-wide">
          Column Mapping — {{ totalRows }} rows detected
        </h2>
        <div class="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <table class="w-full text-sm">
            <thead class="bg-gray-50 text-gray-600 text-xs uppercase tracking-wide">
              <tr>
                <th class="text-left px-4 py-2 font-semibold">Column</th>
                <th class="text-left px-4 py-2 font-semibold">Sample value</th>
                <th class="text-left px-4 py-2 font-semibold">Detected type</th>
                <th class="text-left px-4 py-2 font-semibold">Role</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="header in headers" :key="header" class="border-t border-gray-100">
                <td class="px-4 py-2 font-medium text-gray-800">{{ header }}</td>
                <td class="px-4 py-2 text-gray-500 truncate max-w-[140px]">
                  {{ sampleRows[0]?.[header] ?? '—' }}
                </td>
                <td class="px-4 py-2">
                  <span class="bg-gray-100 text-gray-600 text-xs px-2 py-0.5 rounded">
                    {{ detectedColumns[header]?.type }}
                  </span>
                </td>
                <td class="px-4 py-2">
                  <!-- Dropdown to override the auto-detected role -->
                  <select
                    v-model="columnOverrides[header]"
                    class="border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-400 bg-white"
                  >
                    <option v-for="role in ALL_ROLES" :key="role" :value="role">
                      {{ ROLE_LABELS[role] }}
                    </option>
                  </select>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Step 2: Generate button -->
      <button
        v-if="step === 'preview-ready'"
        class="w-full bg-indigo-600 text-white py-2.5 rounded-lg font-medium hover:bg-indigo-700 transition-colors"
        @click="generateBlog"
      >
        2. Generate blog with AI →
      </button>
    </template>
  </main>
</template>
