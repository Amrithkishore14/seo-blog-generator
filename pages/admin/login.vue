<script setup lang="ts">
/**
 * pages/admin/login.vue — Admin password gate
 *
 * Shown when ADMIN_PASSWORD is set and the visitor has no auth cookie.
 * On success, navigates to /admin/upload.
 */

useSeoMeta({
  title: 'Admin Login — BlogGen',
  robots: 'noindex, nofollow',
})

const password = ref('')
const error = ref('')
const loading = ref(false)

async function submit() {
  loading.value = true
  error.value = ''
  try {
    await $fetch('/api/admin/login', { method: 'POST', body: { password: password.value } })
    await navigateTo('/admin/upload')
  } catch (err: unknown) {
    error.value =
      err && typeof err === 'object' && 'statusMessage' in err
        ? (err as { statusMessage: string }).statusMessage
        : 'Login failed.'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <main class="min-h-screen flex items-center justify-center bg-gray-50 px-4">
    <div class="bg-white border border-gray-200 rounded-2xl p-8 w-full max-w-sm shadow-sm">
      <h1 class="text-xl font-bold text-gray-900 mb-1">Admin access</h1>
      <p class="text-gray-500 text-sm mb-6">Enter the admin password to continue.</p>

      <form @submit.prevent="submit">
        <label for="password" class="block text-sm font-medium text-gray-700 mb-1">
          Password
        </label>
        <input
          id="password"
          v-model="password"
          type="password"
          autocomplete="current-password"
          class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-indigo-400"
          placeholder="••••••••"
          required
        />

        <div
          v-if="error"
          class="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2 mb-4"
        >
          {{ error }}
        </div>

        <button
          type="submit"
          :disabled="loading"
          class="w-full bg-indigo-600 text-white py-2.5 rounded-lg font-medium hover:bg-indigo-700 transition-colors disabled:opacity-50"
        >
          {{ loading ? 'Checking…' : 'Log in →' }}
        </button>
      </form>
    </div>
  </main>
</template>
