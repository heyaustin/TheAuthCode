# TheAuthCode
**Can You Convince the Professor?**

**Demo:** [https://coogle.com.tw](https://coogle.com.tw)

## Proposal Report

### Motivation & Objectives (動機與目標)
<!-- 說明為什麼想做這個專題 -->

At NTU and many universities, students might need an authorization code (授權碼) from a professor to enroll in a course. The process often involves writing an email or making a verbal request, and the outcome depends heavily on how sincere and well-structured that request is.

**TheAuthCode** turns this real-world scenario into a lightweight, gamified web experience. Users type a persuasive message (language support: TBD) attempting to convince a virtual professor to grant them an authorization code. The web app evaluates the sincerity and quality of the input using in-browser sentiment analysis powered by an ONNX model, then decides whether to "grant" the code.

As most students know, the authorization codes override nearly all other course enrollment options (授權碼大於一切). This makes our web app essential, focusing on the following goals:
1. Help students practice writing sincere, respectful requests — a transferable communication skill.
2. Promote good social etiquette and courtesy in academic interactions (促進善良風俗).
3. (Optional) With leaderboards and user profiles, students can connect, share, and strengthen their friendships (促進同儕友誼).
4. Deliver the experience entirely client-side (model inference in the browser) to minimize server costs.

### Competitor Analysis (競品比較)
<!-- 比較目前已經存在可取得的類似工具或應用 -->

To the best of our knowledge, **no existing product directly tackles the "convince a professor for an authorization code" scenario** as a gamified persuasion-writing experience. The closest tools fall into a few adjacent categories, each with notable gaps:

| Category | Representative Tools | What They Do | Gap vs. TheAuthCode |
|----------|---------------------|--------------|---------------------|
| **AI email writers / generators** | Grammarly's tone suggestions, ChatGPT, Gemini, Taskade's "Course Enrollment Email" generator | Help users *draft* polite emails or letters by generating text from a short prompt. | They write the message *for* the user. TheAuthCode is the inverse — the user writes, and the system *judges*. The goal is practice and feedback, not delegation. |
| **General sentiment analyzers** | AllTools AI Sentiment Analyzer, Hugging Face Spaces demos, MonkeyLearn | Classify arbitrary text as positive / negative / neutral, often in-browser via Transformers.js. | They are general-purpose demos with no domain framing, no decision outcome, and no replayability. There is no "professor" persona, no narrative stakes, no leaderboard. |
| **Persuasion / negotiation games** | "Detroit: Become Human"-style choice games, dialogue trees in RPGs, *Suspect*, *Phoenix Wright* | Embed persuasion in a fictional setting through pre-written dialogue choices. | These are scripted multiple-choice systems. The player is not actually composing free-form persuasive text, so there is no transferable real-world writing practice. |
| **Writing-feedback platforms** | Grammarly, ProWritingAid, Hemingway Editor | Score grammar, readability, and tone. | They evaluate writing quality in the abstract but do not simulate a *recipient* with an opinion, do not produce a binary outcome, and lack the gamified, scenario-specific framing. |
| **Course-enrollment utilities** | NTU Cool / NOL aids, Reddit/PTT scripts that auto-refresh quotas | Help students grab seats once a course opens, or organize information about courses. | These solve a *logistical* problem (getting in once a slot exists). They do nothing for the social problem of writing a convincing personal request to the instructor — the exact gap TheAuthCode fills. |

**Summary.** TheAuthCode occupies a niche that combines four elements rarely found together: (1) a culturally specific scenario (Taiwanese university authorization codes), (2) free-form user-composed text input rather than canned choices, (3) a model-driven verdict that produces a clear win/lose outcome, and (4) entirely in-browser inference for cost-free deployment. The combination of practice-oriented writing feedback with a playful, replayable game loop is, as far as we have found, original.

### Expected Features (預期功能)
<!-- 列出預計實作的功能 -->

**Core (Prototype)**
- Text input area where users compose a message to "convince" a professor.
- In-browser sentiment/sincerity analysis using `onnxruntime-web` with a pre-trained or fine-tuned model (e.g., a Hugging Face transformer exported to ONNX).
- A sincerity score and binary verdict: code granted or denied.
- Responsive design — works on phones, tablets, and desktops.

**Extended (If Time Permits)**
- Professor profiles with distinct personalities and granting styles (e.g., "grants everyone," "lottery-based," "sophomores first," "seniors first").
- A challenge mode letting users pick a professor to persuade.
- Leaderboard, user profile, or history of attempts (stored via Django backend + database).
- Multiplayer Mode: Real-time competition where students compete to secure one or few available authorization codes.

### Tech Stack (使用技術)
<!-- 使用的語言、框架、工具等 -->

| Layer | Technology |
|-------|------------|
| Frontend | HTML / CSS / JavaScript (vanilla or lightweight framework) |
| ML Inference | `onnxruntime-web` (WebAssembly backend) running an ONNX sentiment model in the browser |
| ONNX conversion | Python scripts to fine-tune the model and export it to ONNX for web deployment |
| Model Source | Hugging Face (pre-trained) or custom fine-tuned model exported to ONNX |
| Backend (optional) | Python, Django, SQLite or PostgreSQL |
| Hosting | Oracle Cloud Free Tier — Ubuntu 22.04 VM (Best possible config is ARM, 4 OCPUs, 24 GB RAM, no GPU) |

**Why client-side inference?** Since I'm not rich and want to stick to a free VM, I will use the Oracle Cloud free tier, which is generous with CPU and RAM but offers no GPU. Running ML models on the server would not scale under concurrent load. By shipping the ONNX model to the browser via `onnxruntime-web`, each user's own device handles inference, keeping the server's job limited to serving static files (and optionally a lightweight Django API for profiles/leaderboards).

### Goals for Prototype (Prototype 預計可驗證內容)
<!-- Prototype 階段預計驗證的核心功能與技術可行性 -->

The prototype focuses on validating the **technical feasibility** and **core gameplay loop** of TheAuthCode before any backend work begins. Specifically, the prototype must demonstrate:

| # | Goal | Why It Matters |
|---|------|----------------|
| 1 | **End-to-end pipeline works in the browser.** A user types a message → the message is tokenized → an ONNX model runs inference via `onnxruntime-web` → a verdict is rendered, all without any server-side ML. | This is the highest-risk technical assumption of the entire project. If in-browser inference is too slow, too large to download, or unreliable across devices, the architecture must be redesigned. |
| 2 | **Sincerity scoring produces sensible results.** Sincere, polite, well-reasoned messages should score higher than rude, empty, or obviously sarcastic ones across a small hand-curated test set. | Validates that the chosen model (or scoring heuristic) is actually fit for the persuasion-evaluation task, not just generic positive/negative sentiment. |
| 3 | **The grant/deny decision flow is engaging.** A clear verdict screen with feedback that makes users want to retry. | The product is a *game*. If the loop is not fun on the first playthrough, the rest of the features won't save it. |
| 4 | **Cross-device responsiveness.** The UI works correctly on a phone (portrait), tablet, and desktop, with model inference completing within a reasonable time on a mid-range mobile device. | Most NTU students will open this on a phone first. Mobile performance is a hard requirement, not a polish item. |
| 5 | **Graceful degradation.** When the model fails to load (e.g., slow network, blocked CDN), the app falls back to a heuristic scorer so the game is still playable. | A user-facing prototype that can break entirely on a flaky connection is not really a prototype. |

**Out of scope for the prototype** (deferred to later milestones): Django backend, user accounts, persistent leaderboards, professor profiles with distinct policies, and multiplayer. The prototype is intentionally backend-free — everything runs in a single static HTML page.

### Relevance to the Course DSAP (與課程的關聯)
<!-- 你的專題可能涉及哪些資料結構或演算法概念？為什麼？ -->

| Concept | Where It Appears |
|---------|-----------------|
| **Data Structures** | This project utilizes most common data structures, such as arrays and lists. |
| **Trees / Graphs** | Transformer-based NLP models rely on tree-structured attention and graph-based computation graphs. Understanding how `onnxruntime-web` traverses the ONNX computation graph to execute inference connects directly to graph traversal algorithms (BFS/DFS). |
| **Hash Tables / Dictionaries** | Tokenizer vocabulary lookup (token → ID mapping) is essentially a hash map operation. Professor profile and rule storage also use dictionary structures. |
| **String Processing** | Tokenization, text normalization, and input validation involve string parsing algorithms — a core topic in advanced programming. |
| **Keyword Detection** | Rule-based filtering layered on top of sentiment analysis to simulate each professor's policy.
| **Queue / Concurrency Patterns** | If a backend leaderboard is implemented, handling concurrent submissions involves queue-based patterns and race-condition awareness. |
| **Sorting** | The leaderboard would also need sorting algorithms to rank users by various criteria, such as alphabetical order or success rates. |

---

## Prototype Report

### Current Progress (目前進度)
<!-- 完成了什麼 -->

The prototype is a single-page web application (`index.html` + `style.css` + `app.js`) that runs entirely in the browser with **no backend at all**. All five Prototype Goals from the proposal have been at least partially met:

**1. End-to-end in-browser pipeline ✅**
- `onnxruntime-web` is loaded via ESM from jsDelivr (`import * as ort from 'https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/esm/ort.min.js'`).
- On first input, the app downloads a quantized DistilBERT SST-2 sentiment model (`Xenova/distilbert-base-uncased-finetuned-sst-2-english`, INT8 quantized, ~67MB) and the matching tokenizer vocabulary directly from the Hugging Face CDN.
- A WordPiece tokenizer is implemented in vanilla JavaScript (no transformers.js dependency) that converts the user's message into `input_ids` and `attention_mask` tensors.
- The model's logits are passed through softmax to produce a "positive" probability, which is interpreted as the sincerity score.

**2. Sincerity scoring ✅**
- Sincerity is computed as a weighted blend of the model's positive-class probability and a small set of heuristic adjustments: length penalty (too short → unconvincing), profanity penalty, and "courtesy keyword" bonus (please, thank you, sincerely, kind regards, dear professor, etc., plus their Traditional Chinese counterparts).
- Verdict thresholds: ≥ 70 → 授權碼 granted; 50–69 → "borderline, professor wants more"; < 50 → denied.

**3. Engaging grant/deny verdict UI ✅**
- The verdict screen reveals an animated authorization-code card on success, complete with a randomly generated 8-character code and a "stamp" effect.
- On denial, the professor's portrait shakes and a critique is displayed (e.g., "Too short to be sincere", "Try addressing me by name").
- A "Try Again" button resets the state without reloading the model.

**4. Responsive layout ✅**
- The layout uses CSS Grid + Flexbox with mobile-first breakpoints; tested at 360×640 (small phone), 768×1024 (tablet), and 1440×900 (desktop).
- On mobile the professor portrait collapses above the input; on desktop they sit side-by-side like a chat / interview view.

**5. Graceful degradation ✅**
- If the model or tokenizer fails to download (offline, blocked CDN, etc.), the app automatically falls back to a pure heuristic scorer based on the courtesy keyword list, length, and a basic positive/negative wordlist.
- A small banner informs the user when fallback mode is active so behavior is transparent.

The prototype is hosted as a static page (no build step, no bundler) and can be served with `python -m http.server` for local testing.

### Challenges Encountered (遇到的困難)
<!-- 遇到什麼問題、如何解決或打算如何解決 -->

**1. Tokenization without Transformers.js.**
The biggest unexpected hurdle was that `onnxruntime-web` only handles model inference — it does *not* tokenize text. Most online tutorials silently rely on `@huggingface/transformers` (Transformers.js) to do tokenization, but adding that library defeats the goal of a minimal direct-`ort` integration. The fix was to implement a small WordPiece tokenizer from scratch in JavaScript: it loads `vocab.txt` from the model's Hugging Face repo, performs basic Unicode normalization and whitespace splitting, then greedily matches the longest prefix in the vocabulary for each word. This is roughly 80 lines of code and was educational — it directly mirrors the hash-table lookup pattern listed in the DSAP relevance section.

**2. Model size on slow connections.**
The quantized DistilBERT model is ~67MB, which can take 10+ seconds to download on a poor mobile network. To keep the prototype usable, the app shows a loading progress bar and the heuristic-fallback scorer activates if the download fails or times out (15s timeout). For the final version, a smaller distilled or fine-tuned model (~20MB) would be ideal.

**3. Sentiment ≠ Sincerity.**
A pure SST-2 sentiment model rates "I love this class so much!!!" higher than "Dear Professor Lin, I respectfully ask…" even though only the latter is appropriate. This is exactly the gap that motivates fine-tuning in the proposal. As a stopgap, the prototype layers heuristic adjustments (courtesy keywords, length, salutation detection) on top of the model output. A proper solution will require collecting a small labeled dataset of authentic vs. inauthentic authorization-code requests and fine-tuning DistilBERT on it.

**4. CSS variables for dark/light themes on mobile Safari.**
A minor but annoying issue — Safari's auto dark-mode rendered some colored gradients incorrectly. Solved by explicitly defining both light and dark palettes via `prefers-color-scheme` media query rather than relying on color-mix functions.

### Next Steps (下一步計畫)
<!-- 接下來要做什麼 -->

**Short term (Weeks 12–13):**

1. Collect a small labeled dataset (~200 examples) of "authorization-code request" emails with sincerity labels, then fine-tune DistilBERT and re-export to ONNX. This should significantly close the sentiment-vs-sincerity gap noted above.
2. Add 3–5 professor personas (e.g., 嚴格教授, 佛系教授, 抽籤教授) each with their own grant threshold and personalized critique messages. This makes replays feel meaningfully different.
3. Add Traditional Chinese tokenization support — currently the model is English-only, so Chinese input is downgraded to the heuristic scorer.

**Medium term (Week 14):**

4. Stand up a minimal Django + SQLite backend on the Oracle Cloud free-tier VM exposing two endpoints: `POST /attempts` (record an attempt) and `GET /leaderboard` (top scores). The frontend remains static and only calls the backend for these two non-blocking actions.
5. Cross-browser testing: Chrome (Android), Safari (iOS), Firefox, Edge.

**Final polish (Week 15):**

6. Record the 5-minute demo video.
7. Write the Final Report.

---

## Final Report

### 專案說明
<!-- 完整描述你的專案做了什麼 -->

### 使用方式
<!-- 如何編譯、執行、使用你的程式 -->

### 與課程的關聯總結
<!-- 總結你的專題與進階程式設計及資料結構課程之間的關聯 -->
