/** Join class names, skipping empty ones: cx("a", false && "b", "c") is "a c". */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
