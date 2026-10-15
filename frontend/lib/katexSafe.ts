import katex from "katex";
import { cleanLatexFormula } from "./sketchEngine";

/**
 * Robustly renders LaTeX formulas via KaTeX with zero red parse error dumps.
 * If KaTeX fails or produces a syntax error, it automatically heals it,
 * or safely converts it to clean, readable mathematical notation.
 */
export function safeKatexRender(rawLatex: string, displayMode = false): string {
  if (!rawLatex || typeof rawLatex !== "string") return "";

  const cleanLatex = cleanLatexFormula(rawLatex);
  if (!cleanLatex) return "";

  // 1. First pass: try standard KaTeX rendering
  try {
    const html = katex.renderToString(cleanLatex, {
      throwOnError: false,
      displayMode,
    });
    if (!html.includes("katex-error")) {
      return html;
    }
  } catch {}

  // 2. Second pass: KaTeX encountered an error.
  // Transform problematic LaTeX commands into safe text equivalents:
  let safeText = cleanLatex
    .replace(/\\frac\{([^}]+)\}\{([^}]+)\}/g, "($1 / $2)")
    .replace(/\\text\{([^}]+)\}/g, "$1")
    .replace(/\\times/g, "×")
    .replace(/\\cdot/g, "·")
    .replace(/\\approx/g, "≈")
    .replace(/\\leq/g, "≤")
    .replace(/\\geq/g, "≥")
    .replace(/\\neq/g, "≠")
    .replace(/\\pm/g, "±")
    .replace(/\\boxed\{([^}]+)\}/g, "$1")
    .replace(/\\[a-zA-Z]+/g, "")
    .replace(/[{}\\]/g, "")
    .trim();

  // Try re-rendering simplified formula
  try {
    const retryHtml = katex.renderToString(safeText, {
      throwOnError: false,
      displayMode,
    });
    if (!retryHtml.includes("katex-error")) {
      return retryHtml;
    }
  } catch {}

  // 3. Guaranteed clean fallback: clean text span with zero red error formatting
  const escaped = safeText
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<span class="font-sans font-medium tracking-wide">${escaped}</span>`;
}
