// What an attached file's card says about it: its kind in a word, and its size.

const KINDS = [
  [/^image\//, /\.(png|jpe?g|webp|gif)$/i, "Image", "image"],
  [/pdf$/, /\.pdf$/i, "PDF", "document"],
  [/csv$/, /\.csv$/i, "CSV", "table"],
  [/json$/, /\.json$/i, "JSON", "document"],
  [/markdown$/, /\.(md|markdown)$/i, "Markdown", "document"],
  [/^text\//, /\.txt$/i, "Text", "document"],
]

/** `{ label, icon }` from the type the browser reported, or failing that the file's extension. */
export function fileKind(name = "", mimeType = "") {
  const match = KINDS.find(([type]) => type.test(String(mimeType))) || KINDS.find(([, extension]) => extension.test(String(name)))
  return match ? { label: match[2], icon: match[3] } : { label: "File", icon: "document" }
}

export function fileSize(bytes) {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes < 0) return ""
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
