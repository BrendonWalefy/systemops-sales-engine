/**
 * Deterministic guard against LLM-invented numbers/monetary values.
 *
 * Runs AFTER the LLM call and checks whether any integer found in the
 * proposed text was not present in the user's raw input. If unsupported
 * numbers are found in sensitive fields, the endpoint rejects or flags the
 * proposal rather than returning fabricated data to the user.
 *
 * Deterministic = no LLM call, fully testable.
 */

/**
 * Extract all integers from text, normalizing currency symbols, thousand
 * separators (`.` in Brazilian format), decimal commas, and unit suffixes
 * (reais, x, %, mil, k).
 */
function extractIntegers(text: string): Set<string> {
  const cleaned = text
    .replace(/R\$\s*/gi, "")
    .replace(/BRL\s*/gi, "")
    .replace(/\b(reais?|x|%|mil|k)\b/gi, " ");

  const numbers = new Set<string>();
  for (const match of cleaned.matchAll(/\d[\d.,]*/g)) {
    const raw = match[0].replace(/[.,]+$/, ""); // strip trailing separators
    let numStr: string;
    if (raw.includes(",")) {
      // Brazilian decimal: 1.500,00 or 1500,00 → remove thousand dots, convert comma
      numStr = raw.replace(/\./g, "").replace(",", ".");
    } else {
      // Remove dots (thousand separators)
      numStr = raw.replace(/\./g, "");
    }
    const num = parseFloat(numStr);
    if (!isNaN(num)) {
      numbers.add(Math.round(num).toString());
    }
  }
  return numbers;
}

/**
 * Returns integers found in `proposedText` that do NOT appear in `userInput`.
 * An empty array means the proposed text contains no unsupported numbers.
 */
export function findUnsupportedNumbers(proposedText: string, userInput: string): string[] {
  const inProposal = extractIntegers(proposedText);
  const inInput = extractIntegers(userInput);

  const unsupported: string[] = [];
  for (const num of inProposal) {
    if (!inInput.has(num)) {
      unsupported.push(num);
    }
  }
  return unsupported;
}
