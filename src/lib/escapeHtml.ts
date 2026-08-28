// Escapes a value for safe interpolation into raw HTML strings (print-view
// popups built via document.write, etc). These bypass React's normal JSX
// escaping entirely, so any user-controlled text (names, contract content)
// must be escaped by hand before going into the markup.
export function escapeHtml(value: string | null | undefined): string {
  if (value === null || value === undefined) return ''
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
