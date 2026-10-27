/**
 * POST /api/preview
 *
 * Parses a CSV file and returns:
 *   - Detected column roles (with type metadata)
 *   - First 5 rows as a preview
 *   - No AI is called here — this is instant feedback for the upload UI
 *     so the user can verify and correct column mappings before generating.
 */

import { parseCsv, detectColumns } from '../utils/analyseDataset'
export default defineEventHandler(async (event) => {
  const parts = await readMultipartFormData(event)
  const filePart = parts?.find((p) => p.name === 'file')

  if (!filePart?.data) {
    throw createError({ statusCode: 400, statusMessage: 'No CSV file in upload.' })
  }

  const csvText = filePart.data.toString('utf-8')

  let headers: string[]
  let rows: Record<string, string>[]

  try {
    const parsed = parseCsv(csvText)
    headers = parsed.headers
    rows = parsed.rows
  } catch (err) {
    throw createError({
      statusCode: 422,
      statusMessage: `CSV parse error: ${err}`,
    })
  }

  if (rows.length === 0) {
    throw createError({ statusCode: 422, statusMessage: 'The CSV file has no data rows.' })
  }

  const columns = detectColumns(headers, rows)

  // Return detected roles + first 5 rows so the UI can show a preview table
  return {
    columns,
    sample: rows.slice(0, 5),
    totalRows: rows.length,
  }
})
