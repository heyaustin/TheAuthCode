// =====================================================================
// TheAuthCode — app.js
// In-browser sincerity scoring with Transformers.js (multilingual) +
// a heuristic fallback, three professor personas, and per-persona
// leaderboards backed by a small Python/Django server.
// =====================================================================

import {
  pipeline,
  env,
} from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.2.4';

// ---------------------------------------------------------------------
// Transformers.js environment.
// We pull the model + its OWN tokenizer straight from the Hugging Face
// hub, so tokenization is correct for both English and Chinese (the old
// hand-rolled WordPiece tokenizer could not handle CJK). Single-thread
// WASM keeps it compatible with mobile Safari and locked-down browsers
// (no SharedArrayBuffer / cross-origin-isolation required).
// ---------------------------------------------------------------------
env.allowLocalModels = false;
try { env.backends.onnx.wasm.numThreads = 1; } catch (_) { /* shape may vary */ }

// ---------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------

// Where the leaderboard backend lives. If you serve the frontend through
// Django itself (python backend.py runserver 0.0.0.0:8000) this same
// origin is used. If you open index.html some other way (file://, VS Code
// Live Server on :5500, …), point this at your running backend instead.
const API_BASE = 'https://www.coogle.com.tw';

// A compact, genuinely multilingual sentiment model (distilled student of
// multilingual DistilBERT). Labels: positive / neutral / negative.
// Quantized (q8) weights + automatic browser caching keep the *repeat*
// experience fast; the first visit still has to download once.
const MODEL_ID = 'Xenova/distilbert-base-multilingual-cased-sentiments-student';
const MODEL_TIMEOUT_MS = 180000; // generous: slow connections, big-ish download

// Scoring knobs.
const WORD_TARGET = 50;          // letters shorter than this take a penalty
const MAX_LENGTH_PENALTY = 35;   // points removed for a (near-)empty letter

// ---------------------------------------------------------------------
// Professor personas. Switching between them never navigates — we only
// swap text + a CSS accent (see body[data-persona] in style.css).
//
// NOTE: each persona's numeric `threshold` is intentionally NOT rendered
// anywhere in the UI. The style label (Strict / Easygoing / By luck) is
// shown; the exact number is a secret.
// ---------------------------------------------------------------------
const PERSONAS = {
  strict: {
    key: 'strict',
    name: '尤林慧',
    style: '嚴格 · Strict',
    dept: '資訊管理學系 · Dept. of Information Management',
    course: '會計學原理',
    quote: '"名額有限，請給我一個經得起檢視的理由。 / Seats are limited — give me a reason that survives scrutiny."',
    threshold: 80,
    lottery: false,
  },
  easygoing: {
    key: 'easygoing',
    name: '沈俊顏',
    style: '寬鬆 · Easygoing',
    dept: '數學系 · Dept. of Mathematics',
    course: '高等危機分',
    quote: '"放輕鬆，誠意我看得出來。 / Relax — I can tell when someone genuinely means it."',
    threshold: 45,
    lottery: false,
  },
  lottery: {
    key: 'lottery',
    name: '黃卡恩',
    style: '看運氣 · By luck',
    dept: '應用數學系 · Dept. of Applied Mathematics',
    course: '初等演算法設計與分析',
    // Subtle hint that sincerity is irrelevant here — it is pure chance.
    quote: '"分數我交給骰子，信寫得再好也一樣。 / I leave every score to the dice — the finest letter sways them not at all."',
    threshold: 55,
    lottery: true,
  },
};

// ---------------------------------------------------------------------
// Lexicons for the heuristic blend / fallback scorer (EN + ZH).
// ---------------------------------------------------------------------
const COURTESY_KEYWORDS = [
  'please', 'thank you', 'thanks', 'grateful', 'appreciate', 'kindly',
  'sincerely', 'respectfully', 'regards', 'kind regards', 'best regards',
  'dear professor', 'dear prof', 'dear dr',
  'i apologize', 'sorry to bother', 'i understand', 'if possible',
  'i would be honored', 'i would be grateful', 'i hope',
  '老師', '教授', '敬愛', '敬上', '感謝', '謝謝', '麻煩', '懇請', '敬請',
  '萬分感謝', '誠摯', '不勝感激', '希望', '請容我', '若方便',
  '老师', '感谢', '谢谢', '请', '万分感谢',
];

const RUDE_KEYWORDS = [
  'gimme', 'just give', 'give me the code', 'i deserve', 'whatever',
  'idc', "don't care", "i don't care", 'lazy', 'easy a', 'gpa boost',
  'wtf', 'stupid', 'lame', 'boring class', 'waste of time',
  '隨便', '懶', '無聊',
];

const SUBSTANTIVE_KEYWORDS = [
  'graduate', 'graduation', 'requirement', 'prerequisite',
  'major', 'minor', 'research', 'thesis', 'project',
  'interest', 'passionate', 'curious', 'learn', 'study',
  'background', 'prepared', 'experience',
  '畢業', '必修', '先修', '研究', '論文', '主修', '輔系',
  '興趣', '熱忱', '好奇', '學習', '準備',
];

const POSITIVE_FALLBACK = [
  'sincere', 'respect', 'honored', 'eager', 'genuinely', 'deeply',
  'committed', 'dedicated', 'opportunity', 'apologies', 'understand',
  'value', 'appreciate', 'consider', 'hope',
];
const NEGATIVE_FALLBACK = [
  'whatever', 'lazy', 'demand', 'must', 'need it now',
  'easy', "doesn't matter", "don't care", 'worthless',
];

// ---------------------------------------------------------------------
// DOM references
// ---------------------------------------------------------------------
const $ = (id) => document.getElementById(id);
const els = {
  status: $('modelStatus'),
  statusLabel: $('modelStatus').querySelector('.status__label'),
  loadingBar: $('loadingBar'),
  loadingFill: $('loadingFill'),
  loadingText: $('loadingText'),
  fallback: $('fallbackNotice'),

  messageInput: $('messageInput'),
  wordCount: $('wordCount'),
  charCount: $('charCount'),
  submitBtn: $('submitBtn'),

  professorStyle: $('professorStyle'),
  professorName: $('professorName'),
  professorDept: $('professorDept'),
  professorCourse: $('professorCourse'),
  professorQuote: $('professorQuote'),
  portrait: $('professorPortrait'),
  mouth: $('professorMouth'),

  personaTabs: $('personaTabs'),
  lbLaunch: $('lbLaunch'),

  verdict: $('verdict'),
  verdictBackdrop: $('verdictBackdrop'),
  verdictClose: $('verdictClose'),
  granted: $('verdictGranted'),
  denied: $('verdictDenied'),
  grantedCode: $('grantedCode'),
  grantedCourse: $('grantedCourse'),
  grantedProf: $('grantedProf'),
  grantedScore: $('grantedScore'),
  deniedScore: $('deniedScore'),
  feedbackList: $('verdictFeedback'),
  msgGranted: $('verdictMsgGranted'),
  msgDenied: $('verdictMsgDenied'),
  retryBtn: $('retryBtn'),

  submitProf: $('submitProf'),
  nicknameInput: $('nicknameInput'),
  includeLetter: $('includeLetter'),
  submitLeaderboardBtn: $('submitLeaderboardBtn'),
  submitStatus: $('submitStatus'),

  leaderboard: $('leaderboard'),
  lbBackdrop: $('lbBackdrop'),
  lbClose: $('lbClose'),
  lbSeal: $('lbSeal'),
  lbTitle: $('lbTitle'),
  lbSub: $('lbSub'),
  lbBody: $('lbBody'),
  lbHint: $('lbHint'),
  lbRefresh: $('lbRefresh'),
};

// ---------------------------------------------------------------------
// State
// ---------------------------------------------------------------------
const state = {
  classifier: null,       // Transformers.js pipeline when ready
  mode: 'loading',        // 'loading' | 'ready' | 'fallback'
  loading: false,
  activePersona: 'strict',
  lastResult: null,       // { personaKey, score, granted, code, letter }
  openBoard: null,        // persona key of the currently open leaderboard
};

// =====================================================================
// 1. Word counting (English + Chinese)
// =====================================================================
//
// CJK text usually has no spaces, so whitespace splitting alone would
// count a whole Chinese sentence as "1 word". We count each CJK
// character as one word, and everything else by whitespace-separated
// tokens, then add them together.
// =====================================================================
const CJK_RE = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/gu;

function countWords(text) {
  const t = (text || '').trim();
  if (!t) return 0;
  const cjk = (t.match(CJK_RE) || []).length;
  const rest = t.replace(CJK_RE, ' ').trim();
  const latin = rest ? rest.split(/\s+/).filter(Boolean).length : 0;
  return cjk + latin;
}

// =====================================================================
// 2. Model loading (progress + timeout + graceful fallback)
// =====================================================================

const progressFiles = new Map(); // file -> { loaded, total }

function onProgress(p) {
  if (!p) return;
  if (p.status === 'progress' && p.file) {
    progressFiles.set(p.file, { loaded: p.loaded || 0, total: p.total || 0 });
    let loaded = 0, total = 0;
    for (const f of progressFiles.values()) { loaded += f.loaded; total += f.total; }
    const pct = total > 0 ? Math.round((loaded / total) * 100) : 0;
    setLoadingProgress(pct, `Downloading model… ${pct}%`);
  } else if (p.status === 'ready') {
    setLoadingProgress(100, 'Model ready');
  }
}

async function initModel() {
  if (state.loading) return;
  state.loading = true;
  showLoadingBar(true);
  setStatus('loading', 'Loading model…');
  setLoadingProgress(3, 'Downloading model…');

  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    enterFallback();
  }, MODEL_TIMEOUT_MS);

  try {
    const classifier = await pipeline('sentiment-analysis', MODEL_ID, {
      dtype: 'q8',
      progress_callback: onProgress,
    });
    if (timedOut) return; // fallback already engaged; ignore late success
    state.classifier = classifier;
    state.mode = 'ready';
    setStatus('ready', 'Model ready');
    showLoadingBar(false);
  } catch (err) {
    if (!timedOut) {
      console.warn('[TheAuthCode] model load failed, using heuristic mode:', err);
      enterFallback();
    }
  } finally {
    clearTimeout(timeout);
    state.loading = false;
  }
}

function enterFallback() {
  state.mode = 'fallback';
  setStatus('fallback', 'Heuristic mode');
  showLoadingBar(false);
  els.fallback.hidden = false;
}

// =====================================================================
// 3. Scoring
// =====================================================================
//
//   base  = 0.6 * model + 0.4 * heuristic          (each in 0..1)
//   final = clamp( round(base*100 - lengthPenalty), 0, 100 )
//
// The lottery professor ignores all of this: the score is a uniform
// random integer in [0, 100].
// =====================================================================

async function runModel(text) {
  // Returns a positivity score in [0, 1]: positive=1, neutral=0.5, negative=0.
  const out = await state.classifier(text, { top_k: 5 });
  const arr = Array.isArray(out) ? out : [out];
  let pos = 0, neu = 0, neg = 0;
  for (const r of arr) {
    const label = String(r && r.label || '').toLowerCase();
    const s = typeof (r && r.score) === 'number' ? r.score : 0;
    if (label.startsWith('pos')) pos = s;
    else if (label.startsWith('neu')) neu = s;
    else if (label.startsWith('neg')) neg = s;
  }
  return pos * 1.0 + neu * 0.5 + neg * 0.0;
}

function heuristicScore(text) {
  // Returns { score: 0..1, signals: {...} }.
  const lower = text.toLowerCase();
  const length = text.trim().length;

  const courtesy = COURTESY_KEYWORDS.reduce(
    (acc, kw) => acc + (lower.includes(kw.toLowerCase()) ? 1 : 0), 0);
  const rude = RUDE_KEYWORDS.reduce(
    (acc, kw) => acc + (lower.includes(kw.toLowerCase()) ? 1 : 0), 0);
  const substantive = SUBSTANTIVE_KEYWORDS.reduce(
    (acc, kw) => acc + (lower.includes(kw.toLowerCase()) ? 1 : 0), 0);

  const hasSalutation =
    /^(dear|hello|hi|hey)\b/i.test(text.trim()) ||
    /(老師|教授)/.test(text);
  const hasSignoff =
    /(sincerely|regards|thanks|thank you|敬上|謝謝|感謝)/i.test(text);

  // Mild internal length curve (chars) — the *primary* length rule is the
  // word-count penalty applied in computeScore().
  let lengthBonus;
  if (length < 30) lengthBonus = 0.0;
  else if (length < 80) lengthBonus = 0.25;
  else if (length < 150) lengthBonus = 0.5;
  else if (length < 600) lengthBonus = 0.7;
  else lengthBonus = 0.55;

  let s = 0.0;
  s += lengthBonus * 0.40;
  s += Math.min(courtesy, 5) * 0.08;
  s += Math.min(substantive, 4) * 0.06;
  s -= Math.min(rude, 3) * 0.20;
  s += hasSalutation ? 0.10 : 0;
  s += hasSignoff ? 0.07 : 0;

  for (const w of POSITIVE_FALLBACK) if (lower.includes(w)) s += 0.02;
  for (const w of NEGATIVE_FALLBACK) if (lower.includes(w)) s -= 0.04;

  s = Math.max(0, Math.min(1, s));
  return {
    score: s,
    signals: { length, courtesy, rude, substantive, hasSalutation, hasSignoff },
  };
}

function lengthPenalty(words) {
  if (words >= WORD_TARGET) return 0;
  // Linear: 0 points at WORD_TARGET words, MAX_LENGTH_PENALTY at 0 words.
  return ((WORD_TARGET - words) / WORD_TARGET) * MAX_LENGTH_PENALTY;
}

async function computeScore(text, persona) {
  const words = countWords(text);

  if (persona.lottery) {
    // Pure chance — sincerity is irrelevant.
    return {
      final: Math.floor(Math.random() * 101),
      lottery: true,
      signals: null,
      words,
      penalty: 0,
    };
  }

  const heur = heuristicScore(text);
  let modelP = null;
  if (state.mode === 'ready') {
    try {
      modelP = await runModel(text);
    } catch (err) {
      console.warn('[TheAuthCode] inference failed, heuristic only:', err);
    }
  }

  const base01 = modelP !== null ? 0.6 * modelP + 0.4 * heur.score : heur.score;
  const penalty = lengthPenalty(words);
  const final = Math.max(0, Math.min(100, Math.round(base01 * 100 - penalty)));

  return { final, lottery: false, signals: heur.signals, words, penalty: Math.round(penalty), modelP, base01 };
}

// =====================================================================
// 4. Verdict + feedback
// =====================================================================

function buildFeedback(signals, finalScore, words) {
  const tips = [];
  if (words < WORD_TARGET) {
    tips.push(`Your message is quite short (${words} words). Aim for at least ${WORD_TARGET} — a fuller letter reads as more sincere.`);
  }
  if (!signals.hasSalutation) {
    tips.push(`Open with a salutation (e.g., "Dear Professor," or "敬愛的教授：").`);
  }
  if (!signals.hasSignoff) {
    tips.push(`Sign off politely (e.g., "Sincerely," or "敬上") so the message feels complete.`);
  }
  if (signals.courtesy === 0) {
    tips.push(`Courtesy phrases like "thank you" or "I would be grateful" go a long way.`);
  }
  if (signals.substantive === 0) {
    tips.push(`Explain *why* you need the course — graduation, prerequisites, or genuine interest.`);
  }
  if (signals.rude > 0) {
    tips.push(`Some phrasing came across as dismissive. Tone matters when asking for a favor.`);
  }
  if (tips.length === 0) {
    tips.push(`Polite, but not quite specific enough yet. Be concrete about your situation.`);
  }
  return tips.slice(0, 4);
}

function lotteryFeedback() {
  return [
    `黃教授 leaves every verdict to chance — your wording made no difference.`,
    `Feeling unlucky? Press "Try Again" for a fresh roll.`,
  ];
}

function grantedMessage(persona, final) {
  if (persona.lottery) {
    return `"運氣站在你這邊 — ${final} 分！拿去吧。 / Fortune smiled on you today. The code is yours." — ${persona.name}`;
  }
  if (persona.key === 'easygoing') {
    return `"寫得不錯，授權碼給你。 / Nicely done — the code is yours." — ${persona.name}`;
  }
  return `"A well-argued request. The code is yours — make the most of it." — ${persona.name}`;
}

function deniedMessage(persona, final) {
  if (persona.lottery) {
    return `"骰子今天不賞臉。 / The dice did not favor you this time." — ${persona.name}`;
  }
  if (final >= persona.threshold - 15) {
    return `"You're close. Try again — be a little more specific." — ${persona.name}`;
  }
  return `"I'm afraid this request doesn't convince me." — ${persona.name}`;
}

function makeAuthCode() {
  // 8 chars as XXXX-XXXX, uppercase, no easily-confused glyphs (0/O, 1/I/L).
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 8; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

function setMouth(mode) {
  if (!els.mouth) return;
  const paths = {
    neutral: 'M 88 122 Q 100 126 112 122',
    smile: 'M 86 120 Q 100 134 114 120',
    frown: 'M 86 128 Q 100 116 114 128',
  };
  els.mouth.setAttribute('d', paths[mode] || paths.neutral);
}

function showVerdict(result, persona, letter) {
  const { final } = result;
  const granted = final >= persona.threshold;
  const code = granted ? makeAuthCode() : null;

  // Remember this attempt so the user can optionally submit it.
  state.lastResult = {
    personaKey: persona.key,
    score: final,
    granted,
    code,
    letter,
  };

  els.granted.hidden = !granted;
  els.denied.hidden = granted;

  if (granted) {
    setMouth('smile');
    els.grantedCode.textContent = code;
    els.grantedScore.textContent = String(final);
    els.grantedCourse.textContent = persona.course;
    els.grantedProf.textContent = persona.name;
    els.msgGranted.textContent = grantedMessage(persona, final);
  } else {
    setMouth('frown');
    els.portrait.classList.remove('shake');
    void els.portrait.offsetWidth; // restart animation
    els.portrait.classList.add('shake');

    els.deniedScore.textContent = String(final);
    els.feedbackList.innerHTML = '';
    const tips = persona.lottery
      ? lotteryFeedback()
      : buildFeedback(result.signals, final, result.words);
    for (const tip of tips) {
      const li = document.createElement('li');
      li.textContent = tip;
      els.feedbackList.appendChild(li);
    }
    els.msgDenied.textContent = deniedMessage(persona, final);
  }

  resetSubmitBox(persona);

  els.verdict.hidden = false;
  els.verdict.setAttribute('aria-hidden', 'false');
}

function hideVerdict() {
  els.verdict.hidden = true;
  els.verdict.setAttribute('aria-hidden', 'true');
  setMouth('neutral');
}

// =====================================================================
// 5. Leaderboard submission (opt-in)
// =====================================================================

function setSubmitStatus(text, st) {
  els.submitStatus.textContent = text;
  if (st) els.submitStatus.dataset.state = st;
  else els.submitStatus.removeAttribute('data-state');
}

function resetSubmitBox(persona) {
  els.submitProf.textContent = persona.name;
  setSubmitStatus('', null);
  els.submitLeaderboardBtn.disabled = false;
  els.submitLeaderboardBtn.dataset.mode = 'submit';
  delete els.submitLeaderboardBtn.dataset.viewKey;
  els.submitLeaderboardBtn.textContent = '送出到排行榜 · Submit';
}

function showViewBoardButton(key) {
  els.submitLeaderboardBtn.disabled = false;
  els.submitLeaderboardBtn.dataset.mode = 'view';
  els.submitLeaderboardBtn.dataset.viewKey = key;
  els.submitLeaderboardBtn.textContent = '查看排行榜 · View board →';
}

async function submitToLeaderboard() {
  if (!state.lastResult) return;
  const persona = PERSONAS[state.lastResult.personaKey];
  const nickname = (els.nicknameInput.value || '').trim() || 'Anonymous';
  const includeLetter = els.includeLetter.checked;

  const payload = {
    persona: state.lastResult.personaKey,
    nickname,
    letter: includeLetter ? (state.lastResult.letter || '') : '',
    score: state.lastResult.score,
    granted: state.lastResult.granted,
    code: state.lastResult.granted ? (state.lastResult.code || '') : '',
  };

  els.submitLeaderboardBtn.disabled = true;
  setSubmitStatus('送出中… / Submitting…', null);

  try {
    const res = await fetch(`${API_BASE}/api/submit/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const rank = data && data.rank ? data.rank : '—';
    setSubmitStatus(`已上榜 · You're #${rank} on ${persona.name}'s board!`, 'ok');
    showViewBoardButton(persona.key);
  } catch (err) {
    console.warn('[TheAuthCode] submit failed:', err);
    setSubmitStatus('送出失敗 — 後端未啟動？ / Submit failed — is the backend running?', 'error');
    els.submitLeaderboardBtn.disabled = false;
  }
}

// =====================================================================
// 6. Leaderboard viewing
// =====================================================================

function accentVarFor(key) {
  if (key === 'easygoing') return 'var(--moss)';
  if (key === 'lottery') return 'var(--gold)';
  return 'var(--crimson)';
}

async function openLeaderboard(key) {
  const persona = PERSONAS[key];
  if (!persona) return;

  state.openBoard = key;
  els.lbSeal.textContent = '授';
  els.lbTitle.textContent = `${persona.name} · 排行榜`;
  els.lbSub.textContent = `${persona.style} · ${persona.course}`;
  // Tint the modal to this professor's colour, independent of the
  // currently-selected professor on the main page.
  els.leaderboard.style.setProperty('--accent', accentVarFor(key));

  els.lbBody.innerHTML = '<div class="lb__loading">Loading… / 載入中…</div>';
  els.leaderboard.hidden = false;
  els.leaderboard.setAttribute('aria-hidden', 'false');

  await loadLeaderboard(key);
}

function hideLeaderboard() {
  els.leaderboard.hidden = true;
  els.leaderboard.setAttribute('aria-hidden', 'true');
  state.openBoard = null;
}

async function loadLeaderboard(key) {
  try {
    const res = await fetch(`${API_BASE}/api/leaderboard/${key}/`, { method: 'GET' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const entries = Array.isArray(data.entries) ? data.entries.slice() : [];
    // The server already sorts by score desc; re-sort defensively.
    entries.sort((a, b) => (b.score || 0) - (a.score || 0));
    renderLeaderboard(entries);
  } catch (err) {
    console.warn('[TheAuthCode] leaderboard fetch failed:', err);
    renderLeaderboardError();
  }
}

function renderLeaderboard(entries) {
  els.lbBody.innerHTML = '';

  if (!entries.length) {
    const d = document.createElement('div');
    d.className = 'lb__empty';
    d.textContent = '還沒有人上榜 — 成為第一個吧！ / No entries yet — be the first!';
    els.lbBody.appendChild(d);
    return;
  }

  entries.forEach((e, i) => {
    const row = document.createElement('div');
    row.className = 'lb__row' + (i < 3 ? ' lb__row--top' : '');

    const rank = document.createElement('div');
    rank.className = 'lb__rank';
    rank.textContent = String(i + 1);

    const nick = document.createElement('div');
    nick.className = 'lb__nick';
    nick.textContent = e.nickname || 'Anonymous';

    const score = document.createElement('div');
    score.className = 'lb__score';
    score.textContent = `${Number(e.score) || 0} / 100`;

    const meta = document.createElement('div');
    meta.className = 'lb__meta';
    const badge = document.createElement('span');
    badge.className = 'lb__badge ' + (e.granted ? 'lb__badge--granted' : 'lb__badge--denied');
    badge.textContent = e.granted ? '✓ Granted' : '✗ Denied';
    meta.appendChild(badge);
    if (e.granted && e.code) {
      const code = document.createElement('span');
      code.className = 'lb__code';
      code.textContent = e.code;
      meta.appendChild(code);
    }

    row.appendChild(rank);
    row.appendChild(nick);
    row.appendChild(score);
    row.appendChild(meta);

    if (e.letter && String(e.letter).trim()) {
      const letter = document.createElement('p');
      letter.className = 'lb__letter';
      letter.textContent = e.letter;
      row.appendChild(letter);
    }

    els.lbBody.appendChild(row);
  });
}

function renderLeaderboardError() {
  els.lbBody.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'lb__error';

  const p1 = document.createElement('p');
  p1.textContent = 'Could not reach the leaderboard server. / 無法連線到排行榜伺服器。';
  wrap.appendChild(p1);

  const p2 = document.createElement('p');
  p2.style.marginTop = '0.6rem';
  p2.style.fontSize = '0.85rem';
  p2.appendChild(document.createTextNode('Start it with '));
  const code = document.createElement('code');
  code.textContent = 'python backend.py runserver';
  p2.appendChild(code);
  p2.appendChild(document.createTextNode(' (then check API_BASE in app.js).'));
  wrap.appendChild(p2);

  els.lbBody.appendChild(wrap);
}

// =====================================================================
// 7. Persona switching (no navigation)
// =====================================================================

function setPersona(key) {
  const persona = PERSONAS[key];
  if (!persona) return;
  state.activePersona = key;
  document.body.dataset.persona = key;

  for (const tab of els.personaTabs.querySelectorAll('.persona-tab')) {
    const active = tab.dataset.persona === key;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', active ? 'true' : 'false');
  }

  els.professorStyle.textContent = persona.style;
  els.professorName.textContent = persona.name;
  els.professorDept.textContent = persona.dept;
  els.professorCourse.textContent = persona.course;
  els.professorQuote.textContent = persona.quote;

  // Keep the granted-card preview consistent with the active professor.
  els.grantedCourse.textContent = persona.course;
  els.grantedProf.textContent = persona.name;

  setMouth('neutral');
}

// =====================================================================
// 8. UI plumbing
// =====================================================================

function setStatus(mode, label) {
  els.status.classList.remove('status--loading', 'status--ready', 'status--fallback');
  els.status.classList.add(`status--${mode}`);
  els.statusLabel.textContent = label;
}

function showLoadingBar(visible) {
  els.loadingBar.hidden = !visible;
}

function setLoadingProgress(pct, label) {
  els.loadingFill.style.width = `${Math.max(0, Math.min(100, pct))}%`;
  if (label) els.loadingText.textContent = label;
}

function updateCounts() {
  const v = els.messageInput.value;
  els.charCount.textContent = String(v.length);
  els.wordCount.textContent = String(countWords(v));
}

async function handleSubmit() {
  const text = els.messageInput.value.trim();
  if (!text) {
    els.messageInput.focus();
    return;
  }
  const persona = PERSONAS[state.activePersona];
  els.submitBtn.disabled = true;
  const labelEl = els.submitBtn.querySelector('.btn__label');
  const original = labelEl.textContent;
  labelEl.textContent = persona.lottery ? 'Drawing…' : 'Reading…';

  try {
    const result = await computeScore(text, persona);
    showVerdict(result, persona, text);
  } catch (err) {
    console.error(err);
    alert('Something went wrong while scoring your message. Please try again.');
  } finally {
    labelEl.textContent = original;
    els.submitBtn.disabled = false;
  }
}

function bindEvents() {
  els.messageInput.addEventListener('input', updateCounts);
  els.submitBtn.addEventListener('click', handleSubmit);

  // Persona tabs (event delegation) — switches in place, no navigation.
  els.personaTabs.addEventListener('click', (e) => {
    const tab = e.target.closest('.persona-tab');
    if (tab && tab.dataset.persona) setPersona(tab.dataset.persona);
  });

  // Leaderboard launch buttons (event delegation).
  els.lbLaunch.addEventListener('click', (e) => {
    const btn = e.target.closest('.lb-launch__btn');
    if (btn && btn.dataset.persona) openLeaderboard(btn.dataset.persona);
  });

  // Verdict controls.
  els.retryBtn.addEventListener('click', () => {
    hideVerdict();
    els.messageInput.focus();
  });
  els.verdictClose.addEventListener('click', hideVerdict);
  els.verdictBackdrop.addEventListener('click', hideVerdict);

  // Submit button doubles as a "view board" button after a successful post.
  els.submitLeaderboardBtn.addEventListener('click', () => {
    if (els.submitLeaderboardBtn.dataset.mode === 'view') {
      const key = els.submitLeaderboardBtn.dataset.viewKey;
      hideVerdict();
      openLeaderboard(key);
    } else {
      submitToLeaderboard();
    }
  });

  // Leaderboard modal controls.
  els.lbClose.addEventListener('click', hideLeaderboard);
  els.lbBackdrop.addEventListener('click', hideLeaderboard);
  els.lbRefresh.addEventListener('click', () => {
    if (state.openBoard) {
      els.lbBody.innerHTML = '<div class="lb__loading">Loading… / 載入中…</div>';
      loadLeaderboard(state.openBoard);
    }
  });

  // Keyboard shortcuts.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!els.leaderboard.hidden) { hideLeaderboard(); return; }
      if (!els.verdict.hidden) { hideVerdict(); return; }
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      if (els.verdict.hidden && els.leaderboard.hidden) {
        e.preventDefault();
        handleSubmit();
      }
    }
  });
}

// =====================================================================
// 9. Boot
// =====================================================================

bindEvents();
setPersona('strict');
updateCounts();

// Start downloading the model in the background. The user can type — and
// even submit — before it finishes: until it is ready we score with the
// heuristic, then upgrade automatically once the model loads.
initModel();
