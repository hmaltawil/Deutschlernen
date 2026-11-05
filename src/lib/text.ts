/** "1 day", "2 days", "1,090 sentences" (number and word never split across lines). */
export function count(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString()}\u00a0${n === 1 ? one : many}`;
}

/** Just the word: "day" for 1, "days" otherwise. */
export function noun(n: number, one: string, many = `${one}s`): string {
  return n === 1 ? one : many;
}
