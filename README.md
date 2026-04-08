# TheAuthCode
**Can You Convince the Professor?**

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

### Timeline (時程規劃)
<!-- 各週預計完成的進度 -->

| Week | Milestone |
|------|-----------|
| 7 | Brainstorm idea, complete this Proposal Report, and outline the implementation plan. |
| 8–9 | Set up project scaffolding: frontend skeleton, integrate `onnxruntime-web`, load a baseline sentiment model, and verify inference runs in-browser on mobile and desktop. |
| 10 | Implement sincerity scoring logic and the grant/deny decision flow. Basic UI polish. |
| 11 | Complete the Prototype Report. Prototype should demonstrate end-to-end text → inference → verdict. |
| 12–13 | (Extended, optional) Add professor profiles, rule-based filtering, and Django backend for persistent data. |
| 14 | Final polish, cross-device testing, and bug fixes. |
| 15 | Submit the Final Report and record a 5-minute demo video. |

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

### 目前進度
<!-- 完成了什麼 -->

### 遇到的困難
<!-- 遇到什麼問題、如何解決或打算如何解決 -->

### 下一步計畫
<!-- 接下來要做什麼 -->

### 與課程的關聯
<!-- 到目前為止，你的實作中哪些部分與課程內容有關？關係是什麼？ -->

---

## Final Report

### 專案說明
<!-- 完整描述你的專案做了什麼 -->

### 使用方式
<!-- 如何編譯、執行、使用你的程式 -->

### 與課程的關聯總結
<!-- 總結你的專題與進階程式設計及資料結構課程之間的關聯 -->
