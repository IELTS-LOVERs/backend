/**
 * Extract an ObjectId string from a raw ObjectId, a populated document
 * (`{ _id }`), or a plain string. Returns "" for null/undefined so callers can
 * filter falsy values safely.
 */
export function extractMediaId(item: unknown): string {
  if (item === null || item === undefined) return "";

  if (typeof item === "object" && "_id" in item) {
    const id = (item as { _id?: unknown })._id;
    return id === null || id === undefined ? "" : String(id);
  }

  return String(item);
}
