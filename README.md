# Zawvee

> **Child-First Multimodal AI Learning Environment**  
> Built around two primary learning modalities: **Draw** and **Talk**.

---

## Overview

Zawvee is a focused, distraction-free educational workspace designed to help learners explore concepts through interactive handwriting, diagramming, and natural conversation. Modeled after the 100× Experience Blueprint and informed by modern minimalist design (inspired by Bencho, DotsUI, and Cult UI), Zawvee eliminates visual noise, multi-colored AI badges, and confusing split views in favor of two dedicated, full-screen experiences.

---

## Core Modalities

### 1. Draw Mode (Canvas Workspace)
- **Fluid Handwriting Engine**: Velocity-responsive ink thinning using midpoint Bézier spline curves and `e.getCoalescedEvents()` for 120Hz Apple Pencil and stylus input.
- **Bencho-Inspired Dynamic Toolbar**:
  - Anchored at bottom-center with upward-rising flyouts.
  - Concentric radius geometry (`rail: 15px`, `tool: 11px`) with animated selection pad.
  - **Tool Order**: Scribble Pencil (first) $\to$ Select (Pointer) $\to$ Shape Slot (Rectangle, Circle, Line, Star with memory notch) $\to$ Inline Text $\to$ Wide Eraser $\to$ Ink Well & Stroke Width.
- **Native Inline Text Tool**: Click anywhere to type directly on canvas—no browser modal dialogs.
- **Wide Dual-Action Eraser**: 44px+ diameter with live canvas erasing and automatic object hit-testing.
- **Pagination Dock**: Concentric glassmorphic dock with `< Prev`, `Page X / Y`, `Next >`, and `+ Page`.

### 2. Talk Mode (AI Tutor Workspace)
- **Socratic Conversational Tutor**: Centered, distraction-free conversation canvas.
- **Interactive Learning Cards & Math**: LaTeX math rendering powered by KaTeX.
- **Canvas Diagram Generation**: The tutor places interactive geometric shapes, formulas, and pointers directly onto the student's canvas in real time.
- **Action Chips**: One-tap learning prompts for fast exploration ("Draw this on canvas", "Explain connection", "Quiz me").

### 3. Unified Dark & Light Themes
- **One-Click Theme Toggle**: Instant Sun ⇄ Moon switcher in the top navigation bar with `localStorage` persistence.
- **Charcoal Dark Mode**: Matte dark background (`#161616`), frosted glass surfaces, and chalk-white ink (`#EDEDED`).
- **Editorial Paper Light Mode**: Warm paper background (`#FAF9F6`), frosted light surfaces, and charcoal ink (`#18181B`).
- **Contrast Adaptation**: Pen ink automatically adapts contrast when toggling themes.

---

## Monorepo Architecture & Directory Structure

```
Primer v2/
├── frontend/                 # Complete Next.js 16 Web Application
│   ├── app/                  # Next.js App Router (layout.tsx, page.tsx, globals.css)
│   ├── components/           # UI Components
│   │   ├── canvas/           # CanvasWorkspace, CanvasToolbar, CanvasToolbar.css
│   │   ├── talk/             # ChatPanel conversational tutor workspace
│   │   └── zawvee/           # Navbar (Draw | Talk switcher, Theme toggle)
│   ├── lib/                  # Client API client & TypeScript domain types
│   │   ├── api.ts            # Fetch & SSE streaming client
│   │   └── types.ts          # Shared TypeScript contracts
│   ├── public/               # Public static assets
│   ├── next.config.mjs       # Next.js config with /v1/* proxy to FastAPI
│   ├── package.json          # Frontend dependencies & scripts
│   ├── postcss.config.mjs    # Tailwind v4 PostCSS config
│   └── tsconfig.json         # Strict TypeScript configuration
│
├── backend/                  # Complete Python FastAPI Service
│   ├── app.py                # FastAPI HTTP & SSE streaming endpoints
│   ├── models.py             # Pydantic schemas (Session, CanvasOp, SemanticObject)
│   ├── orchestrator.py       # AI tutor reasoning, audio anchors, and spatial diagrams
│   ├── session.py            # In-memory and local file-backed persistence
│   └── requirements.txt      # Python dependencies
│
├── docs/                     # Architectural & Product Specifications
│   ├── ARCHITECTURE.md       # Complete Spatial Teaching & Handwriting Intelligence Guide
│   ├── ZAWVEE_FOUNDATION_REVAMP_ARCHITECTURE.md
│   ├── Zawvee_Foundation_Revamp_PRD.docx
│   └── Zawvee_Foundation_Revamp_PRD.md
│
├── Public/                   # Source Deep Research PRDs
│   ├── JAWVEE_Spatial_Teaching_Engine_PRD_Deep_Research.pdf
│   └── JAWVEE_LLM_Free_Handwriting_Intelligence_Engine.pdf
│
├── local/                    # Local Runtime Data (.gitignored)
│   └── zawvee_data/          # Persistent session & canvas JSON checkpoints
│
├── .env & .env.example       # Environment configuration
├── .gitignore                # Production ignore rules
├── AGENTS.md                 # Authoritative AI Agent & Architecture Guidelines
├── package.json              # Monorepo root scripts
└── README.md                 # Project documentation & runbook
```

- **Frontend**: Next.js 16 (Turbopack, App Router), React 19, TypeScript, Tailwind CSS v4, Lucide React, KaTeX, $P Point-Cloud Recognizer.
- **Backend**: Python 3.9+ FastAPI, Uvicorn, Server-Sent Events (`sse-starlette`), Pydantic v2.
- **Architecture**: Authoritative **Semantic Scene Graph**, **Web Audio Clock Synchronization**, **0ms Fast-Path Barge-In**, and **Multimodal Reference Resolution**.
- **Documentation**: See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) and [`AGENTS.md`](AGENTS.md).

---

## Getting Started

### Prerequisites
- **Node.js** 20.3+
- **Python** 3.9+

### 1. Start the FastAPI Backend
```bash
# In project root:
npm run backend
# Or: source .venv/bin/activate && uvicorn backend.app:app --host 127.0.0.1 --port 8000 --reload
```
The backend health check is accessible at `http://127.0.0.1:8000/health`.

### 2. Start the Next.js Frontend
```bash
# In project root:
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## Available Root Scripts

| Command | Description |
| :--- | :--- |
| `npm run dev` | Launch Next.js development server (inside `frontend/`) on port 3000 |
| `npm run backend` | Launch Python FastAPI backend on port 8000 with auto-reload |
| `npm run build` | Compile optimized production build of the frontend |
| `npm run check` | Run Turbopack build & TypeScript typecheck |
