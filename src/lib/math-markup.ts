import katex from "katex";
export function normalizeMathDelimiters(text: string) {
  // Some model replies escape both $ delimiters while leaving TeX commands
  // inside. Recover only that unambiguous case; escaped currency stays literal.
  return text.replace(/\\\$([^$\n]+)\\\$/g, (all, body: string) =>
    /\\[a-zA-Z]+|[=+×÷]|\d\s*[-*/^]\s*\d/.test(body) ? `$${body}$` : all,
  );
}
export function mathParts(text: string) {
  const pattern = /(?<!\\)\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|(?<!\\)\$[^\n$]+?\$|\\\([^\n]+?\\\)/g;
  const value = normalizeMathDelimiters(text);
  const parts: { text: string; formula?: string; display?: boolean; incomplete?: boolean }[] = [];
  let last = 0;
  for (const match of value.matchAll(pattern)) {
    const part = match[0], display = part.startsWith("$$") || part.startsWith("\\[");
    const delimiter = part.startsWith("$") && !display ? 1 : 2;
    const formula = part.slice(delimiter, -delimiter);
    // "$3 to $4" is currency, not a pair of math delimiters.
    if (delimiter === 1 && (/\s$/.test(formula) || /^\d/.test(value.slice(match.index + part.length)))) continue;
    parts.push({ text: value.slice(last, match.index) }, { text: part, formula, display });
    last = match.index + part.length;
  }
  const tail = value.slice(last);
  const unfinished = /(?<!\\)(\$\$|\\\[|\\\(|\$)([^$]*)$/.exec(tail);
  if (unfinished && (unfinished[1] !== "$" || /\\[a-zA-Z]+|[=+×÷]|\d\s*[-*/^]\s*\d/.test(unfinished[2]))) {
    parts.push({ text: tail.slice(0, unfinished.index) }, { text: unfinished[0], formula: unfinished[2], display: ["$$", "\\["].includes(unfinished[1]), incomplete: true });
  } else parts.push({ text: tail });
  return parts;
}
export const hasMath = (text: string) => mathParts(text).some(part => part.formula !== undefined);
export const escapeHtml = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export function mathMarkup(text: string, streaming = false): string {
  return mathParts(text)
    .map((part) => {
      if (part.formula !== undefined) {
        if (part.incomplete && streaming) return "<span>公式正在生成…</span>";
        try {
          return katex.renderToString(part.formula, {
            displayMode: part.display,
            throwOnError: true,
            trust: false,
            maxExpand: 300,
            maxSize: 10,
            strict: "ignore",
            output: "htmlAndMathml",
          });
        } catch {
          return "<span>这条公式暂时无法排版，可以请老师换一种写法。</span>";
        }
      }
      return escapeHtml(part.text)
        .replace(/^#{1,6} (.+)$/gm, "<strong>$1</strong>")
        .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
        .replace(/\n/g, "<br>");
    })
    .join("");
}
