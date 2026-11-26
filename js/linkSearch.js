export function escapeHTML(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

/** fzf-style terms: whitespace separated, each term matched independently. */
export function searchTokens(query) {
  return String(query ?? "")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

function fuzzyMatch(text, token) {
  if (!token) return null;

  // Contiguous hits outrank scattered letters, like fzf's exact/substring bonus.
  const exact = text.indexOf(token);
  if (exact !== -1) {
    const indices = Array.from({ length: token.length }, (_, i) => exact + i);
    return { indices, score: 1000 - exact * 2 - text.length * 0.1 };
  }

  const indices = [];
  let from = 0;
  for (const char of token) {
    const at = text.indexOf(char, from);
    if (at === -1) return null;
    indices.push(at);
    from = at + 1;
  }

  const gaps = indices[indices.length - 1] - indices[0] - (indices.length - 1);
  const score = 500 - indices[0] * 2 - gaps * 3 - text.length * 0.1;
  return { indices, score };
}

/** Returns -Infinity when any term is missing; higher scores rank hits first. */
export function scoreMatch(text, tokens, phrase = "") {
  const lowerText = String(text ?? "").toLowerCase();
  let total = 0;

  for (const token of tokens) {
    const match = fuzzyMatch(lowerText, token);
    if (!match) return -Infinity;
    total += match.score;
  }

  // Bonus for the whole query appearing as a phrase, so exact stays on top.
  if (phrase && lowerText.includes(phrase.toLowerCase())) total += 2000;
  return total;
}

export function highlightTokens(str, tokens, phrase = "") {
  const text = String(str ?? "");
  if (!tokens.length && !phrase) return escapeHTML(text);

  const lowerText = text.toLowerCase();
  const marked = new Uint8Array(text.length);

  if (phrase) {
    const at = lowerText.indexOf(phrase.toLowerCase());
    if (at !== -1) {
      for (let i = 0; i < phrase.length; i++) marked[at + i] = 1;
    }
  }

  for (const token of tokens) {
    const match = fuzzyMatch(lowerText, token);
    if (!match) continue;
    for (const index of match.indices) marked[index] = 1;
  }

  let html = "";
  let chunk = "";
  let inMark = false;

  for (let i = 0; i < text.length; i++) {
    if (Boolean(marked[i]) === inMark) {
      chunk += text[i];
      continue;
    }
    html += inMark ? `<mark class="links-match">${escapeHTML(chunk)}</mark>` : escapeHTML(chunk);
    chunk = text[i];
    inMark = Boolean(marked[i]);
  }
  html += inMark ? `<mark class="links-match">${escapeHTML(chunk)}</mark>` : escapeHTML(chunk);
  return html;
}
