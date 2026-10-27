<template>
  <!--
    app.vue — the root component for the entire application.
    NuxtPage renders whichever page component matches the current URL route.
    The <html lang="en-GB"> attribute is set in nuxt.config.ts → app.head.
  -->
  <div class="min-h-screen bg-gray-50 text-gray-900">
    <!-- Global nav -->
    <header class="bg-white border-b border-gray-200 sticky top-0 z-50">
      <div class="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
        <NuxtLink to="/" class="text-lg font-bold text-indigo-600 hover:text-indigo-700">
          BlogGen
        </NuxtLink>
        <nav class="flex gap-4 text-sm">
          <NuxtLink to="/" class="text-gray-600 hover:text-gray-900">Blogs</NuxtLink>
          <NuxtLink to="/admin/upload" class="bg-indigo-600 text-white px-3 py-1 rounded-md hover:bg-indigo-700">
            Upload CSV
          </NuxtLink>
        </nav>
      </div>
    </header>

    <!-- Page content is injected here by the router -->
    <NuxtPage />

    <!-- Global footer -->
    <footer class="border-t border-gray-200 mt-16 py-8 text-center text-sm text-gray-500">
      <p>Data sourced from Beauhurst. Generated with AI copy — statistics computed from raw data.</p>
    </footer>
  </div>
</template>
