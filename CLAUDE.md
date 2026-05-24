# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A desktop JSON utility app built with **Tauri 2** (Rust backend) + **React 19 / TypeScript** (Vite frontend) + **Ant Design 6**. Provides JSON formatting, minification, validation, schema validation, key/value search, diff, and JSONPath querying.

## Commands

```bash
# Frontend dev server (Vite HMR)
npm run dev

# TypeScript type-check + Vite build
npm run build

# Lint
npm run lint

# Preview production build
npm run preview

# Tauri dev (launches desktop window — runs `npm run dev` automatically)
cd src-tauri && cargo tauri dev

# Tauri production build
cd src-tauri && cargo tauri build
```

## Architecture

### Backend (Rust — `src-tauri/src/lib.rs`)

The entire backend is in `lib.rs`. It registers 7 Tauri commands as the app's API:

| Command | Purpose |
|---|---|
| `format_json` | Pretty-print with configurable indent |
| `minify_json` | Remove whitespace |
| `validate_json` | Syntax check, returns line/column errors |
| `validate_schema` | Validate JSON against a JSON Schema |
| `search_json` | Recursive key/value search with case-sensitivity toggle |
| `diff_json` | Deep recursive comparison of two JSON values |
| `query_jsonpath` | JSONPath expression evaluation |

Key Rust crates: `serde_json` (with `preserve_order`), `jsonschema` 0.26, `jsonpath-rust` 0.7.

### Frontend (React — `src/`)

Single `App.tsx` component (~536 lines) contains all app state and UI. It uses a `Splitter` layout with an input panel and a tabbed output panel.

- **Input panel**: CodeMirror editor (via `@uiw/react-codemirror` with `@codemirror/lang-json`)
- **Output tabs**: formatted output (CodeMirror read-only), tree view (Ant Design `Tree`), search results table, validation result, JSONPath query with results
- **Diff mode**: replaces the single-input layout with a 3-panel splitter (left JSON, right JSON, diff results table)

All JSON processing is invoked via `invoke<T>()` from `@tauri-apps/api/core`, which calls the Rust commands. Shared types between frontend and backend are defined in both `src/types.ts` and `lib.rs` (no shared code generation).

### State flow

User types JSON → `onChange` calls `parseTree()` locally to update the tree view. Operations (format, validate, search, etc.) call `invoke()` which executes Rust commands and returns results to React state. Results render in the tabbed output panel.

## Tauri Configuration

- `src-tauri/tauri.conf.json`: window size 1400x900, dev URL `http://localhost:5173`, builds from `../dist`
- `src-tauri/capabilities/default.json`: permissions for `core:default` and `log:default`
- CSP is set to `null` (disabled) for development flexibility
