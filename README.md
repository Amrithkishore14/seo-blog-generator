Getting started
You'll need
Node.js 20+ — the seed script uses --env-file, which landed in Node 20
A Google Gemini API key (free tier is fine) — if you skip this, the app falls back to a deterministic template and still works
Install and run
bash


# clone and install
git clone https://github.com/Amrithkishore14/seo-blog-generator.git
cd seo-blog-generator
npm install

# copy the env file and drop in your key
cp .env.example .env
# open .env and set NUXT_GEMINI_API_KEY

# generate the sample blogs (fintech + healthtech)
npm run seed

# start the dev server
npm run dev
# → http://localhost:3000

Generating a blog
From the upload page
Run npm run dev and open http://localhost:3000/admin/upload
Drop in a company-ranking CSV (max 2 MB).
Optionally enter the industry name. If you leave it blank, it's taken from the filename.
Click Preview columns to see what was detected. If a column is wrong, change it in the dropdown.
Click Generate blog. With the free Gemini tier this takes around 10–20 seconds.




From the API
bash
curl -X POST http://localhost:3000/api/generate \
  -F "file=@./data/fintech_companies_seed.csv" \
  -F "industry=Fintech"
# { "slug": "top-100-fintech-companies", "url": "/blog/top-100-fintech-companies" }

What the CSV needs
A column with company names (e.g. Company, Name, Organisation)
A number or money column to rank by (e.g. Total Raised, Funding (USD), Revenue)
If a column holds several tags (like sectors), separate them with ;

The rows don't need to be sorted, and a rank column is optional. The app sorts by the money column and numbers the rows itself.



Tests
bash
npm test              # 144 Vitest tests
npm run lint
npm run format:check

Sample and edge-case CSVs are in data/ and data/test-cases/.





Tools used
Tool	Why
Nuxt 3	Required by the brief. Gives server-side rendering, server routes and file-based routing.
Tailwind CSS	Quick to build the layout and keeps the CSS small.
Own CSV parser	About 80 lines, handles quoted fields and different line endings. I started with Papa Parse, but it broke the Cloudflare Workers build.
Google Gemini	Free tier, and it can be forced to reply in JSON. Uses gemini-2.5-flash, and switches to gemini-3.5-flash-lite if the quota runs out.
Zod	Checks the AI's reply has the right shape before anything is saved.
Nitro storage	Local files in development, Cloudflare KV in production.
@nuxtjs/sitemap	Builds the sitemap from the list of saved blogs.
Vitest	Runs the TypeScript tests without starting Nuxt.
tsx	Runs the seed script as TypeScript.
Claude Code	AI coding assistant, used during development and for writing tests.



SEO
One <h1> per page, with h2 and h3 headings below it
lang="en-GB" on every page
Canonical URL on each blog page
Three JSON-LD blocks: Article, ItemList (the ranking) and FAQPage
The full ranking table is in the server-rendered HTML, so search engines can read every company without running JavaScript
External company links use rel="noopener nofollow"
Admin pages are noindex, nofollow
The sitemap updates automatically when a new blog is created

Keeping the AI accurate
Stats first. computeStats() calculates everything. Gemini only gets the finished numbers and the top 10 companies, never the raw CSV.
Prompt rules. The prompt tells the model to use only the numbers given and not to invent or round figures.
Zod check. Every reply is validated. If it fails, the app retries once.
Number check. Any number in the title, h1 or meta description is compared with the real row count. If the model writes "Top 10" for a 100-row file, that field is replaced with the template version.
Template fallback. buildFallbackCopy() writes the copy from the stats alone, so a page is always created even if Gemini is down or returns bad JSON.
Quota fallback. If gemini-2.5-flash returns a rate-limit error, the app tries gemini-3.5-flash-lite before falling back to the template.
My Approach

I approached this project by focusing on three things: making the blog generation process reusable, keeping the statistics accurate, and ensuring the generated pages are SEO friendly.

I started by building a CSV processing workflow that identifies important columns, such as company names, funding amounts and locations. I wanted the application to work with different datasets rather than being limited to fintech.

I kept the statistical calculations separate from AI content generation. The application calculates the statistics directly from the dataset and then uses an LLM to help write the blog content. This makes the numerical results more reliable while allowing the content to read naturally.

I also added a fallback template so the application can generate a blog when the AI service is unavailable or returns an invalid response. For usability, I included a CSV upload interface where users can preview automatically detected columns and adjust them before generating a blog.

Finally, I used Nuxt's server-side rendering and SEO features to make the generated pages accessible to search engines, with relevant metadata, structured data and a ranking table.

If I continued developing the project, I would focus on improving column-detection confidence, handling more unusual CSV formats and expanding the automated tests.

Known limitations
Gemini free tier. The daily limit is low. When it's reached, the app uses template copy instead of AI copy, but it doesn't break.
2 MB upload limit. That's roughly 10,000 rows. Bigger files would need streaming.
One currency per file. If a file mixes £ and $, the first symbol found is used for everything.
Gemini SDK. The project still uses @google/generative-ai. Google's newer @google/genai package has a different API, so moving to it would be a separate piece of work.
Deployment (Cloudflare Pages)
First-time setup
bash
npx wrangler login

# create the KV namespace, then copy both IDs into wrangler.toml
npx wrangler kv namespace create BLOGS
npx wrangler kv namespace create BLOGS --preview

# secrets — use the NUXT_ prefix so Nuxt reads them at runtime, not at build time
npx wrangler pages secret put NUXT_GEMINI_API_KEY --project-name seo-blog-generator
npx wrangler pages secret put NUXT_ADMIN_PASSWORD --project-name seo-blog-generator
Deploy
bash
npm run deploy

# or in two steps
npm run deploy:build
npx wrangler pages deploy dist --project-name seo-blog-generator

Cloudflare secrets only apply after a new deployment.

Seeding production
bash
npm run seed      # build the blog JSON locally
npm run seed:kv   # upload it to the production KV namespace
Where blogs are stored
Environment	Storage	Configured in
npm run dev	Local files in .data/blogs/	devStorage in nuxt.config.ts
Cloudflare Pages	Cloudflare KV (BLOGS binding)	storage when NITRO_PRESET=cloudflare-pages
Admin login

NUXT_ADMIN_PASSWORD is set as a Cloudflare Pages secret. After login, server/middleware/admin-auth.ts checks a signed session cookie (HMAC-SHA256 using the Web Crypto API, which works on both Workers and Node).

What I'd add next
Regenerate a blog automatically when new data arrives
Keep older versions of a blog, e.g. for quarterly rankings
A different preview image for each blog
Show how confident the column detection is, so users know when to check it
Export the generated copy as Markdown