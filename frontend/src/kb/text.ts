/** Word matching shared by kb search, Ask retrieval and condition suggestions. Pure. */

/** Lower-case words of three or more letters, in any script (Cyrillic health notes too). */
export function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}*]+/u)
    .filter((w) => w.length >= 3)
}

/** Whole word, or one word a prefix of the other when it has five letters or more (statin → statins). */
export const tokenMatch = (a: string, b: string) =>
  a === b || (a.length >= 5 && b.startsWith(a)) || (b.length >= 5 && a.startsWith(b))
