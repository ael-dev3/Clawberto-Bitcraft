export function formatMaybe(value: number | null | undefined): string {
  return Number.isFinite(value) ? Number(value).toFixed(3) : '-';
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
