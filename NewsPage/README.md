# NewsPage App Guide

This folder contains the Tauri desktop app for NewsPage.

## What This App Does

NewsPage collects current news, enriches each article with local AI, and displays:

- category
- tags
- one-line snippet
- structured AI summary
- thumbnail
- link to the original source

The enrichment model is currently fixed in Rust as `qwen2.5:3b`.

## Features

- Local inference through Ollama (`ollama-rs` in the backend)
- SQLite persistence for enriched and unenriched article flows
- Incremental enrichment with frontend progress updates
- Cached thumbnails in app data storage
- Tauri commands/events connecting Rust and React

## Prerequisites

Install these before running the app:

1. Node.js 20+
2. Rust toolchain (stable)
3. Microsoft WebView2 Runtime (Windows)
4. Ollama
5. SerpAPI key

## 1) Install Ollama

### Windows

1. Download installer from https://ollama.com/download/windows
2. Install and launch Ollama
3. Verify it is available:

```powershell
ollama --version
```

If command is not found, restart terminal after installation.

### Start Ollama service

Usually Ollama runs automatically after installation. If needed, start it manually:

```powershell
ollama serve
```

Keep it running while using NewsPage.

## 2) Pull and test model qwen2.5:3b

Run:

```powershell
ollama pull qwen2.5:3b
```

Optional quick test:

```powershell
ollama run qwen2.5:3b "Summarize: Rust and Tauri are used to build desktop apps."
```

## 3) Configure environment variables

Create a `.env` file in `NewsPage/` with your SerpAPI key:

```env
SERP_API=your_serpapi_key_here
```

The backend reads this value to fetch article sources.

## 4) Install dependencies

From this folder (`NewsPage/`):

```bash
npm install
```

## 5) Run in development

```bash
npm run tauri dev
```

This starts the Vite frontend and the Tauri Rust backend together.

## Build for production

```bash
npm run tauri build
```

Output artifacts are generated under `src-tauri/target/release/`.

## Helpful Commands

```bash
# Frontend-only dev server
npm run dev

# Frontend production build check
npm run build

# Rust compile check
cd src-tauri
cargo check
```

## Troubleshooting

- App cannot enrich news:
	- verify Ollama is running
	- verify `qwen2.5:3b` exists via `ollama list`
- SerpAPI errors:
	- check `.env` has valid `SERP_API`
- Blank or stale content:
	- regenerate news from the UI and wait for sync completion event

## Recommended VS Code Extensions

- Tauri
- rust-analyzer
- ESLint
