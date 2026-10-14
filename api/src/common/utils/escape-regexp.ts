/**
 * Escapes RegExp metacharacters in user-supplied input so it can be embedded in
 * `new RegExp(...)` for Mongo `$regex` queries without:
 *  - throwing on invalid patterns (e.g. `[` → 500), or
 *  - enabling catastrophic backtracking / ReDoS on the database side.
 */
export function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
