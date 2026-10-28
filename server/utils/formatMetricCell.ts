/**
 * Format a raw metric cell value for display in the blog ranking table.
 *
 * - Compact suffix values (e.g. "£3.2m") are returned as-is.
 * - Plain integers or currency-prefixed integers without separators
 *   (e.g. "14200000", "$15400000") are formatted with the supplied
 *   currency symbol and thousands separators: "$15,400,000".
 * - Already-formatted values (e.g. "£30,314,247") are re-parsed and
 *   re-emitted so the output is always consistent.
 * - Blank cells return an em-dash.
 */
export function formatMetricCell(raw: string, currency: string): string {
  if (!raw || !raw.trim()) return '—'
  // Compact suffix (e.g. "£3.2m") — leave as-is
  if (/[kmbn]$/i.test(raw.trim())) return raw
  // Strip any leading currency symbol, then strip commas/whitespace before parsing
  const stripped = raw.replace(/^[£$€]/, '').replace(/[,\s]/g, '')
  const n = Number(stripped)
  if (!isFinite(n) || isNaN(n)) return raw
  return `${currency}${n.toLocaleString('en-GB')}`
}
