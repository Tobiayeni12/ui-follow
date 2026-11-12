// Pure helpers for the trivia game: deciding whether a chat message is the
// answer, and parsing a pasted list of questions. No I/O, so the fiddly
// part (what counts as "typed the answer") is easy to test on its own.

const MAX_ANSWERS = 6;
const MAX_ANSWER_LENGTH = 60;
const MAX_QUESTION_LENGTH = 200;
const MIN_POINTS = 1;
const MAX_POINTS = 1000;

/**
 * Lower-case, drop accents/punctuation, collapse spaces, and ignore a
 * leading "the/a/an" — so "The Eiffel Tower!!" and "eiffel tower" compare
 * equal. Apostrophes vanish ("o'clock" → "oclock"); other punctuation
 * becomes a space ("spider-man" → "spider man").
 */
function normalize(input) {
  let s = String(input == null ? '' : input)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/['’`]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  s = s.replace(/^(the|a|an) /, '');
  return s;
}

const compact = (s) => s.replace(/ /g, '');
const wordCount = (s) => (s ? s.split(' ').length : 0);

function editDistance(a, b) {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/**
 * Does this chat message answer the question?
 *  - the whole message equals an answer (ignoring case/punctuation/spaces), or
 *  - a short message contains the answer as whole words ("i think it's paris")
 *    — only for answers of 3+ characters, so "4" can't match "i have 4 dogs", or
 *  - with typo tolerance: a near miss ("pariss") — only for answers of 5+
 *    letters with no digits, one slip (two for 10+), so short answers and
 *    numbers stay strict.
 */
function isCorrect(message, answers, { typoTolerance = true } = {}) {
  const m = normalize(message);
  if (!m) return false;
  const mCompact = compact(m);
  for (const answer of answers || []) {
    const t = normalize(answer);
    if (!t) continue;
    const tCompact = compact(t);
    if (m === t || mCompact === tCompact) return true;
    if (t.length >= 3 && wordCount(m) <= wordCount(t) + 3 && ` ${m} `.includes(` ${t} `)) return true;
    // never for answers with digits: 10001 is not a typo of 10000
    if (typoTolerance && tCompact.length >= 5 && !/\d/.test(tCompact) && Math.abs(mCompact.length - tCompact.length) <= 2) {
      const allowed = tCompact.length >= 10 ? 2 : 1;
      if (editDistance(mCompact, tCompact) <= allowed) return true;
    }
  }
  return false;
}

const cleanText = (v, max) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);

/** "paris, city of light" / ["Paris", " "] → ["paris", "city of light"] (deduped, capped). */
function sanitizeAnswers(input) {
  const parts = Array.isArray(input) ? input : String(input == null ? '' : input).split(/[|,;\n]/);
  const out = [];
  const seen = new Set();
  for (const part of parts) {
    const a = cleanText(part, MAX_ANSWER_LENGTH);
    const key = normalize(a);
    if (!a || !key || seen.has(key)) continue;
    seen.add(key);
    out.push(a);
    if (out.length >= MAX_ANSWERS) break;
  }
  return out;
}

function sanitizePoints(value, fallback) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(MAX_POINTS, Math.max(MIN_POINTS, n));
}

/**
 * One question per line:  question | answer | alternate answer | ... [| 25 pts]
 * Returns { questions: [{ text, answers, points }], skipped: [line numbers] }.
 */
function parseBulk(text, defaultPoints) {
  const questions = [];
  const skipped = [];
  String(text == null ? '' : text)
    .split(/\r?\n/)
    .forEach((raw, i) => {
      const line = raw.trim();
      if (!line) return;
      const cells = line.split('|').map((c) => c.trim());
      let points = defaultPoints;
      const last = cells[cells.length - 1];
      const pts = /^(\d{1,4})\s*(pts?|points?)$/i.exec(last || '');
      if (pts && cells.length > 2) {
        points = sanitizePoints(pts[1], defaultPoints);
        cells.pop();
      }
      const [q, ...rest] = cells;
      const question = cleanText(q, MAX_QUESTION_LENGTH);
      const answers = sanitizeAnswers(rest);
      if (!question || !answers.length) skipped.push(i + 1);
      else questions.push({ text: question, answers, points });
    });
  return { questions, skipped };
}

module.exports = {
  normalize,
  isCorrect,
  editDistance,
  sanitizeAnswers,
  sanitizePoints,
  cleanText,
  parseBulk,
  MAX_QUESTION_LENGTH,
  MAX_POINTS,
  MIN_POINTS,
};
