/** Split a streamed string without cutting a UTF-16 surrogate pair. */
export function splitDelta(value: string, maxChars: number): readonly string[] {
  if (value.length <= maxChars) return [value];
  const parts: string[] = [];
  let offset = 0;
  while (offset < value.length) {
    let end = Math.min(offset + maxChars, value.length);
    if (end < value.length && isHighSurrogate(value.charCodeAt(end - 1))) {
      end -= 1;
    }
    parts.push(value.slice(offset, end));
    offset = end;
  }
  return parts;
}

/** Return the longest prefix within maxChars without cutting a surrogate pair. */
export function truncateDelta(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  if (maxChars <= 0) return "";
  const end = isHighSurrogate(value.charCodeAt(maxChars - 1))
    ? maxChars - 1
    : maxChars;
  return value.slice(0, end);
}

function isHighSurrogate(value: number): boolean {
  return value >= 0xd800 && value <= 0xdbff;
}
