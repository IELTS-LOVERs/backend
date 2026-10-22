/**
 * Escapes a cell value for CSV output according to RFC 4180.
 * If the value contains quotes, commas, or line breaks, wraps it in quotes and escapes internal quotes.
 */
export function csvEscape(value: unknown): string {
  let text = value === null || value === undefined ? "" : String(value);
  // Excel/LibreOffice formula injection protection for user-controlled text.
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) {
    text = `'${text}`;
  }
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}
