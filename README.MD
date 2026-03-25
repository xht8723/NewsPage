# NewsPage

NewsPage is a desktop AI news reader built with Tauri, Rust, and React. It fetches current headlines, enriches them locally with Ollama, and presents structured summaries and tags in a fast native-style UI.

<img src="image/README/1774438004542.png" alt="NewsPage UI" style="width: 100%; max-width: 800px; height: auto;" />

## Key Features

- Local AI enrichment with Ollama (model: `qwen2.5:3b`)
- News ingestion through SerpAPI, then article parsing/enrichment in Rust
- SQLite-backed storage with staged enrichment flow
- Real-time frontend updates while enrichment is running
- Thumbnail caching to app data for faster reloads
- Detail view with structured AI summary and quick link to the original article

## Stack

- Frontend: React + TypeScript + Vite + Tailwind
- Desktop shell: Tauri 2
- Backend: Rust + Tokio + SQLx (SQLite)
- AI runtime: Ollama via `ollama-rs`

## Quick Start

The full setup, build, and Ollama guide is in [NewsPage/README.md](NewsPage/README.md).

In short:

1. Install Node.js, Rust, and WebView2 runtime.
2. Install and run Ollama, then pull `qwen2.5:3b`.
3. Create `.env` with `SERP_API=...`.
4. Run the app with `npm run tauri dev` inside `NewsPage`.

## Project Layout

- `NewsPage/`: Tauri application source
- `image/README/`: documentation images
