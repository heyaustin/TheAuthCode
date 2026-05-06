// =====================================================================
// TheAuthCode — app.js
// In-browser sincerity scoring with onnxruntime-web + heuristic fallback.
// =====================================================================

import * as ort from 'https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/esm/ort.min.js';

// Tell ORT where to find its WASM files (matches the ESM bundle above).
ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/';
// Be conservative on threading — single-thread is the most compatible choice
// across mobile Safari and locked-down corporate browsers.
ort.env.wasm.numThreads = 1;
ort.env.wasm.simd = true;

// ---------------------------------------------------------------------
// Model configuration.
// We use the quantized DistilBERT SST-2 from the Xenova HF mirror.
// The repo also exposes vocab.txt so we can do WordPiece tokenization
// in vanilla JS without pulling in @huggingface/transformers.
// ---------------------------------------------------------------------
const MODEL_BASE = 'https://huggingface.co/Xenova/distilbert-base-uncased-finetuned-sst-2-english/resolve/main';
const MODEL_URL = `${MODEL_BASE}/onnx/model_quantized.onnx`;
const VOCAB_URL = `${MODEL_BASE}/vocab.txt`;
const MODEL_TIMEOUT_MS = 25000;

// WordPiece special tokens (DistilBERT uncased convention).
const CLS_TOKEN = '[CLS]';
const SEP_TOKEN = '[SEP]';
const PAD_TOKEN = '[PAD]';
const UNK_TOKEN = '[UNK]';
const MAX_SEQ_LEN = 128;

// ---------------------------------------------------------------------
// Lexicons used for heuristic adjustments and the fallback scorer.
// All lowercased; we also accept Traditional Chinese variants.
// ---------------------------------------------------------------------
const COURTESY_KEYWORDS = [
  // English politeness
  'please', 'thank you', 'thanks', 'grateful', 'appreciate', 'kindly',
  'sincerely', 'respectfully', 'regards', 'kind regards', 'best regards',
  'dear professor', 'dear prof', 'dear dr',
  'i apologize', 'sorry to bother', 'i understand', 'if possible',
  'i would be honored', 'i would be grateful', 'i hope',
  // Chinese politeness (Traditional & Simplified)
  '老師', '教授', '敬愛', '敬上', '感謝', '謝謝', '麻煩', '懇請', '敬請',
  '萬分感謝', '誠摯', '不勝感激', '希望', '請容我', '若方便',
  '老师', '感谢', '谢谢', '请', '万分感谢',
];

const RUDE_KEYWORDS = [
  'gimme', 'just give', 'give me the code', 'i deserve', 'whatever',
  'idc', "don't care", "i don't care", 'lazy', 'easy a', 'gpa boost',
  // Mild profanity / dismissive patterns. Kept short on purpose.
  'wtf', 'stupid', 'lame', 'boring class', 'waste of time',
  '隨便', '懶', '無聊',
];

const SUBSTANTIVE_KEYWORDS = [
  // Reasons that suggest a thoughtful request
  'graduate', 'graduation', 'requirement', 'prerequisite',
  'major', 'minor', 'research', 'thesis', 'project',
  'interest', 'passionate', 'curious', 'learn', 'study',
  'background', 'prepared', 'experience',
  '畢業', '必修', '先修', '研究', '論文', '主修', '輔系',
  '興趣', '熱忱', '好奇', '學習', '準備',
];

// English wordlist used by the fallback (no-model) scorer.
const POSITIVE_FALLBACK = [
  'sincere', 'respect', 'honored', 'eager', 'genuinely', 'deeply',
  'committed', 'dedicated', 'opportunity', 'apologies', 'understand',
  'value', 'appreciate', 'consider', 'hope',
];
const NEGATIVE_FALLBACK = [
  'whatever', 'lazy', 'demand', 'must', 'need it now',
  'easy', 'doesn\'t matter', 'don\'t care', 'worthless',
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
  charCount: $('charCount'),
  submitBtn: $('submitBtn'),
  professorName: $('professorName'),
  professorQuote: $('professorQuote'),
  portrait: $('professorPortrait'),
  mouth: $('professorMouth'),

  verdict: $('verdict'),
  verdictBackdrop: $('verdictBackdrop'),
  verdictClose: $('verdictClose'),
  granted: $('verdictGranted'),
  denied: $('verdictDenied'),
  grantedCode: $('grantedCode'),
  grantedScore: $('grantedScore'),
  grantedProf: $('grantedProf'),
  deniedScore: $('deniedScore'),
  feedbackList: $('verdictFeedback'),
  msgGranted: $('verdictMsgGranted'),
  msgDenied: $('verdictMsgDenied'),
  retryBtn: $('retryBtn'),
};

// ---------------------------------------------------------------------
// State
// ---------------------------------------------------------------------
const state = {
  session: null,        // ort.InferenceSession when ready
  vocab: null,        // Map<string, number> when ready
  mode: 'loading',   // 'loading' | 'ready' | 'fallback'
  loading: false,
};

// =====================================================================
// 1. Tiny WordPiece tokenizer (DistilBERT uncased)
// =====================================================================
//
// This is a deliberately compact implementation. It does:
//   - lowercase
//   - whitespace + punctuation splitting
//   - greedy longest-match WordPiece for each "word"
//   - mapping to vocab IDs with [UNK] fallback
//
// It does NOT do full BERT-style accent stripping, which means accented
// English/European characters can hit [UNK]. That's acceptable for a
// prototype; the heuristic adjustments still apply on top.
//
// This is also a perfect classroom example of the "hash-table lookup
// for tokenizer vocabulary" point in the DSAP relevance section.
// =====================================================================

function isPunctuation(ch) {
  const cp = ch.codePointAt(0);
  if (
    (cp >= 33 && cp <= 47) ||  // ! " # $ % & ' ( ) * + , - . /
    (cp >= 58 && cp <= 64) ||  // : ; < = > ? @
    (cp >= 91 && cp <= 96) ||  // [ \ ] ^ _ `
    (cp >= 123 && cp <= 126)     // { | } ~
  ) return true;
  // Rough check for general punctuation block & CJK punctuation
  return /\p{P}/u.test(ch);
}

function basicTokenize(text) {
  // Lowercase + split on whitespace, then split out punctuation as
  // standalone tokens. (Non-CJK words become tokens; CJK gets char-split
  // by the punctuation rule via single-character handling.)
  const lower = text.toLowerCase().trim();
  if (!lower) return [];

  // Split CJK characters into individual tokens — DistilBERT uncased
  // English vocab won't actually know them, but we keep the structure
  // correct so that punctuation logic still works.
  const expanded = [];
  for (const ch of lower) {
    const cp = ch.codePointAt(0);
    const isCJK =
      (cp >= 0x4E00 && cp <= 0x9FFF) ||
      (cp >= 0x3400 && cp <= 0x4DBF) ||
      (cp >= 0x3000 && cp <= 0x303F) ||
      (cp >= 0xFF00 && cp <= 0xFFEF);
    if (isCJK) expanded.push(' ', ch, ' ');
    else if (isPunctuation(ch)) expanded.push(' ', ch, ' ');
    else expanded.push(ch);
  }
  return expanded.join('').split(/\s+/).filter(Boolean);
}

function wordpieceTokenize(word, vocab) {
  // Greedy longest-match WordPiece. Returns an array of subword strings.
  if (word.length > 100) return [UNK_TOKEN];
  const subTokens = [];
  let start = 0;
  while (start < word.length) {
    let end = word.length;
    let cur = null;
    while (start < end) {
      let piece = word.slice(start, end);
      if (start > 0) piece = '##' + piece;
      if (vocab.has(piece)) { cur = piece; break; }
      end -= 1;
    }
    if (cur === null) return [UNK_TOKEN];
    subTokens.push(cur);
    start = end;
  }
  return subTokens;
}

function encode(text, vocab, maxLen = MAX_SEQ_LEN) {
  const words = basicTokenize(text);
  const tokens = [CLS_TOKEN];
  for (const w of words) {
    for (const t of wordpieceTokenize(w, vocab)) {
      if (tokens.length >= maxLen - 1) break;
      tokens.push(t);
    }
    if (tokens.length >= maxLen - 1) break;
  }
  tokens.push(SEP_TOKEN);

  const ids = tokens.map(t => vocab.get(t) ?? vocab.get(UNK_TOKEN) ?? 100);
  const mask = new Array(ids.length).fill(1);

  // Pad to maxLen so the input shape is fixed.
  while (ids.length < maxLen) {
    ids.push(vocab.get(PAD_TOKEN) ?? 0);
    mask.push(0);
  }

  return { input_ids: ids, attention_mask: mask };
}

// =====================================================================
// 2. Model loading (with progress + timeout + fallback)
// =====================================================================

async function fetchWithProgress(url, label, signal) {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`${label}: HTTP ${res.status}`);
  const total = Number(res.headers.get('content-length')) || 0;
  if (!total || !res.body) return new Uint8Array(await res.arrayBuffer());

  const reader = res.body.getReader();
  const chunks = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    const pct = Math.round((received / total) * 100);
    setLoadingProgress(pct, `${label}: ${pct}%`);
  }
  const buf = new Uint8Array(received);
  let off = 0;
  for (const c of chunks) { buf.set(c, off); off += c.length; }
  return buf;
}

async function loadVocab(signal) {
  setLoadingProgress(0, 'Downloading vocabulary…');
  const res = await fetch(VOCAB_URL, { signal });
  if (!res.ok) throw new Error(`vocab.txt: HTTP ${res.status}`);
  const text = await res.text();
  const vocab = new Map();
  text.split('\n').forEach((line, idx) => {
    const tok = line.replace(/\r$/, '');
    if (tok.length === 0 && idx > 0) return; // skip stray blanks
    vocab.set(tok, idx);
  });
  return vocab;
}

async function initModel() {
  if (state.loading) return;
  state.loading = true;
  showLoadingBar(true);
  setStatus('loading', 'Loading model…');

  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), MODEL_TIMEOUT_MS);

  try {
    state.vocab = await loadVocab(ctrl.signal);

    setLoadingProgress(0, 'Downloading model…');
    const modelBytes = await fetchWithProgress(MODEL_URL, 'Model', ctrl.signal);

    setLoadingProgress(100, 'Initializing inference session…');
    state.session = await ort.InferenceSession.create(modelBytes, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    });

    state.mode = 'ready';
    setStatus('ready', 'Model ready');
    showLoadingBar(false);
  } catch (err) {
    console.warn('[TheAuthCode] Falling back to heuristic mode:', err);
    state.mode = 'fallback';
    setStatus('fallback', 'Heuristic mode');
    showLoadingBar(false);
    els.fallback.hidden = false;
  } finally {
    clearTimeout(timeout);
    state.loading = false;
  }
}

// =====================================================================
// 3. Sincerity scoring
// =====================================================================
//
// Final score = clamp( 100 * (0.7 * modelPositive + 0.3 * heuristic), 0, 100 )
//
// modelPositive:  P(positive) from DistilBERT softmax, in [0, 1]
// heuristic:      length, courtesy keywords, salutation, etc., in [0, 1]
// =====================================================================

async function runModel(text) {
  // Returns probability of "positive" class in [0, 1].
  const { input_ids, attention_mask } = encode(text, state.vocab);
  const ids = BigInt64Array.from(input_ids.map(BigInt));
  const mask = BigInt64Array.from(attention_mask.map(BigInt));

  const feeds = {
    input_ids: new ort.Tensor('int64', ids, [1, MAX_SEQ_LEN]),
    attention_mask: new ort.Tensor('int64', mask, [1, MAX_SEQ_LEN]),
  };

  const out = await state.session.run(feeds);
  // Output is a logits tensor of shape [1, 2]. SST-2 convention:
  // index 0 = NEGATIVE, index 1 = POSITIVE.
  const logitsName = state.session.outputNames[0];
  const logits = out[logitsName].data; // Float32Array length 2
  const [neg, pos] = [logits[0], logits[1]];
  const m = Math.max(neg, pos);
  const expN = Math.exp(neg - m), expP = Math.exp(pos - m);
  return expP / (expN + expP);
}

function heuristicScore(text) {
  // Returns { score: 0..1, signals: {...} } for use both as a blend with
  // the model and as a standalone fallback.
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

  // Length curve: too-short hurts, ~150-400 chars feels sincere,
  // very long doesn't help further.
  let lengthBonus;
  if (length < 30) lengthBonus = 0.0;
  else if (length < 80) lengthBonus = 0.25;
  else if (length < 150) lengthBonus = 0.5;
  else if (length < 600) lengthBonus = 0.7;
  else lengthBonus = 0.55;

  // Combine signals into [0, 1].
  let s = 0.0;
  s += lengthBonus * 0.40;
  s += Math.min(courtesy, 5) * 0.08;
  s += Math.min(substantive, 4) * 0.06;
  s -= Math.min(rude, 3) * 0.20;
  s += hasSalutation ? 0.10 : 0;
  s += hasSignoff ? 0.07 : 0;

  // Pure-text fallback uses these word lists too, with smaller weights.
  for (const w of POSITIVE_FALLBACK) if (lower.includes(w)) s += 0.02;
  for (const w of NEGATIVE_FALLBACK) if (lower.includes(w)) s -= 0.04;

  s = Math.max(0, Math.min(1, s));

  return {
    score: s,
    signals: {
      length, courtesy, rude, substantive,
      hasSalutation, hasSignoff,
    },
  };
}

async function scoreMessage(text) {
  const heur = heuristicScore(text);
  let modelP = null;

  if (state.mode === 'ready') {
    try {
      modelP = await runModel(text);
    } catch (err) {
      console.warn('[TheAuthCode] inference failed, using heuristic only:', err);
    }
  }

  // Blend: 70% model, 30% heuristic when the model is available;
  // otherwise heuristic alone.
  const blended = modelP !== null
    ? 0.7 * modelP + 0.3 * heur.score
    : heur.score;

  return {
    final: Math.round(blended * 100),
    modelP,                      // for transparency / debug
    heuristic: heur.score,
    signals: heur.signals,
  };
}

// =====================================================================
// 4. Verdict + UI feedback
// =====================================================================

const PROFESSOR = {
  name: '林教授',
  threshold: { grant: 70, borderline: 50 },
};

function buildFeedback(text, signals, finalScore) {
  const tips = [];
  if (signals.length < 30) tips.push('Your message is too short to seem sincere — give the professor a real reason.');
  if (!signals.hasSalutation) tips.push('Try opening with a salutation (e.g., "Dear Professor Lin," or "敬愛的林老師：").');
  if (!signals.hasSignoff) tips.push('Sign off politely (e.g., "Sincerely," "敬上") so the message feels complete.');
  if (signals.courtesy === 0) tips.push('Adding courtesy phrases like "thank you" or "I would be grateful" goes a long way.');
  if (signals.substantive === 0) tips.push('Explain *why* you need the course — graduation, prerequisites, or genuine interest.');
  if (signals.rude > 0) tips.push('Some phrases came across as dismissive. Tone matters when asking for a favor.');
  if (tips.length === 0 && finalScore < 70) {
    tips.push('The professor felt your message was polite but not specific enough. Be concrete about your situation.');
  }
  return tips.slice(0, 4);
}

function makeAuthCode() {
  // 8-character authorization code in the style XXXX-XXXX,
  // alphanumeric, uppercase, no easily-confused chars (0/O, 1/I/L).
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 8; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

function setMouth(mode) {
  // mode: 'neutral' | 'smile' | 'frown'
  if (!els.mouth) return;
  const paths = {
    neutral: 'M 88 122 Q 100 126 112 122',
    smile: 'M 86 120 Q 100 134 114 120',
    frown: 'M 86 128 Q 100 116 114 128',
  };
  els.mouth.setAttribute('d', paths[mode] || paths.neutral);
}

function showVerdict(result) {
  const { final, signals } = result;
  const granted = final >= PROFESSOR.threshold.grant;

  els.granted.hidden = !granted;
  els.denied.hidden = granted;

  if (granted) {
    setMouth('smile');
    els.grantedCode.textContent = makeAuthCode();
    els.grantedScore.textContent = String(final);
    els.grantedProf.textContent = PROFESSOR.name;
    els.msgGranted.textContent =
      `"A well-written request. The code is yours — make the most of it." — ${PROFESSOR.name}`;
  } else {
    setMouth('frown');
    els.portrait.classList.remove('shake');
    // restart the animation
    void els.portrait.offsetWidth;
    els.portrait.classList.add('shake');

    els.deniedScore.textContent = String(final);
    els.feedbackList.innerHTML = '';
    const tips = buildFeedback(els.messageInput.value, signals, final);
    for (const tip of tips) {
      const li = document.createElement('li');
      li.textContent = tip;
      els.feedbackList.appendChild(li);
    }

    if (final >= PROFESSOR.threshold.borderline) {
      els.msgDenied.textContent =
        `"You're close. Give it another try — be more specific." — ${PROFESSOR.name}`;
    } else {
      els.msgDenied.textContent =
        `"I'm afraid this request doesn't convince me." — ${PROFESSOR.name}`;
    }
  }

  els.verdict.hidden = false;
  els.verdict.setAttribute('aria-hidden', 'false');
}

function hideVerdict() {
  els.verdict.hidden = true;
  els.verdict.setAttribute('aria-hidden', 'true');
  setMouth('neutral');
}

// =====================================================================
// 5. UI plumbing
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

function updateCharCount() {
  els.charCount.textContent = String(els.messageInput.value.length);
}

async function handleSubmit() {
  const text = els.messageInput.value.trim();
  if (text.length === 0) {
    els.messageInput.focus();
    return;
  }
  // If the model is still loading we just use the heuristic for now.
  els.submitBtn.disabled = true;
  const original = els.submitBtn.querySelector('.btn__label').textContent;
  els.submitBtn.querySelector('.btn__label').textContent = 'Reading…';

  try {
    const result = await scoreMessage(text);
    showVerdict(result);
  } catch (err) {
    console.error(err);
    alert('Something went wrong while scoring your message. Please try again.');
  } finally {
    els.submitBtn.querySelector('.btn__label').textContent = original;
    els.submitBtn.disabled = false;
  }
}

function bindEvents() {
  els.messageInput.addEventListener('input', updateCharCount);
  els.submitBtn.addEventListener('click', handleSubmit);

  els.retryBtn.addEventListener('click', () => {
    hideVerdict();
    els.messageInput.focus();
  });
  els.verdictClose.addEventListener('click', hideVerdict);
  els.verdictBackdrop.addEventListener('click', hideVerdict);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !els.verdict.hidden) hideVerdict();
    // Cmd/Ctrl + Enter as a power-user shortcut.
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    }
  });
}

// =====================================================================
// 6. Boot
// =====================================================================

bindEvents();
updateCharCount();
els.professorName.textContent = PROFESSOR.name;

// Kick off model loading in the background. The user can start typing
// (and even submit) before it finishes — the app will use heuristics
// until the model is ready, then upgrade automatically.
initModel();
