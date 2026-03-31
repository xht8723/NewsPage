# NewsPage

NewsPage is a desktop news reader that fetches headlines from multiple sources, compresses them into bite-sized updates, and ranks them by what matters to you.

The biggest value of NewsPage is personalized semantic sorting. Instead of only sorting by date or keyword matching, NewsPage uses embedding models to understand meaning, compare each story against your liked/disliked interests, and prioritize the most relevant news first.

<img src="image/README/1774438004542.png" alt="NewsPage UI" style="width: 100%; max-width: 800px; height: auto;" />

## Key Features

- Interest-first feed: semantic ranking powered by embeddings
- Clear reading: headlines are enriched into concise, structured snippets
- Local-first workflow: desktop app with local storage and responsive UI
- Configurable AI stack: provider settings are adjustable in-app

## Tech Stack

- Frontend: React + TypeScript + Vite
- Desktop shell: Tauri 2
- Backend: Rust + Tokio + SQLx (SQLite)
- LLM/Embeddings: provider abstraction with semantic embedding-based ranking

## Prerequisites

Before building/running, install:

1. Node.js 20+ and npm
2. Rust toolchain (stable) via rustup
3. Tauri system dependencies
4. Microsoft WebView2 Runtime (Windows)
5. Optional local AI runtime only if you choose a local provider setup

Notes:

- This repository's app root is `newspage_app/` (nested workspace layout).
- Run npm commands from `f:/dev/NewsPage/newspage_app`.

## Install Dependencies

From `newspage_app/`:

```bash
npm install
```

## Run in Development

1. In `newspage_app/`, start the Tauri app:

```bash
npm run tauri dev
```

This launches Vite + Rust backend together through Tauri. If your selected provider is local, start that local runtime before generating news.

## Build Frontend Only

From `newspage_app/`:

```bash
npm run build
```

This runs TypeScript compile + Vite production build and outputs to `newspage_app/dist/`.

## Build Desktop App (Release)

From `newspage_app/`:

```bash
npm run tauri build
```

Expected output artifacts are generated under:

- `newspage_app/src-tauri/target/release/`
- `newspage_app/src-tauri/target/release/bundle/`

Bundle targets are configured as `all` in `src-tauri/tauri.conf.json`.

## Useful Scripts

From `newspage_app/package.json`:

- `npm run dev`: run Vite frontend dev server
- `npm run build`: TypeScript + Vite production build
- `npm run test`: run Vitest tests
- `npm run preview`: preview production frontend build
- `npm run tauri dev`: run desktop app in development
- `npm run tauri build`: build release desktop bundle

## Project Layout

- `newspage_app/`: Tauri application source (frontend + Rust backend)
- `newspage_app/src/`: React frontend
- `newspage_app/src-tauri/`: Rust backend and Tauri config
- `image/README/`: documentation images
