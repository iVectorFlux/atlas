# Zawvee Foundation Revamp — Architecture & Implementation Guide

> **Document Status**: Production Architecture & System Blueprint  
> **Source PRD**: `docs/Zawvee_Foundation_Revamp_PRD.docx` (100× Experience Blueprint)  
> **Target Experiences**: **Draw** (Learning Canvas) and **Talk** (Conversational AI Tutor)  
> **Architecture Pattern**: Full Monorepo Separation (`frontend/` for Next.js 16 UI vs. `backend/` for FastAPI Python service).

---

## 1. Product Thesis & Architecture Principles

Zawvee is a child-first personal learning environment. The child moves fluidly between **making (Draw)** and **conversation (Talk)** without cognitive overload or cluttered interfaces.

### Core Architectural Mandates
1. **Two Focused Experiences (No Split View)**:
   - **Draw**: Infinite-feeling learning canvas featuring Bencho-styled bottom floating toolbar, freehand inking (pen, pencil, highlighter, eraser), inline semantic shapes (rectangle, circle, arrow, line), editable text, and top pagination dock.
   - **Talk**: Distraction-free conversational tutor interface streaming pedagogic explanations, KaTeX math formulas, structured concept cards, and contextual action chips.
2. **Clean Full-Stack Monorepo Separation**:
   - **`frontend/`**: Contains the entire Next.js 16 application—App Router routes (`app/`), UI components (`components/canvas/`, `components/talk/`, `components/zawvee/`), API client and types (`lib/`), and static assets (`public/`).
   - **`backend/`**: Pure Python FastAPI service managing session state, canvas document tree, Server-Sent Events (SSE) streaming, and AI pedagogical orchestration.
   - **Root Level**: Minimal orchestrator with convenience scripts (`npm run dev`, `npm run backend`, `npm run build`), environment configuration, and documentation.
3. **Monochrome Tactile Aesthetics**:
   - Neutral, high-contrast Dark & Light mode system.
   - Bencho glassmorphism toolbar tokens with frosted backdrop blurs and subtle border highlights.
   - Zero distracting rainbow or neon "AI sparkle" decorations.
4. **Idempotent Canvas Operations (`CanvasOp`)**:
   - Drawing and AI mutations are represented as typed data structures (`CanvasOp`) rather than raw pixel diffs, enabling live AI diagramming and conflict-free updates.

---

## 2. System Architecture & Component Mapping

```
┌────────────────────────────────────────────────────────────────────────┐
│                        FRONTEND (frontend/)                            │
├──────────────────────────────────┬─────────────────────────────────────┤
│  Talk View (ChatPanel.tsx)       │  Draw View (CanvasWorkspace.tsx)    │
│  - SSE EventSource consumer      │  - HTML5 Canvas Inking engine       │
│  - KaTeX LaTeX renderer          │  - Wide Eraser & Gesture Handler    │
│  - Dynamic Action Chips          │  - Bottom Bencho Toolbar            │
│  - Pedagogical concept cards     │  - Top Page Navigation Dock         │
└──────────────────────────────────┴─────────────────────────────────────┘
                                  │
                       Next.js Rewrite Proxy:
                       /v1/*  -->  http://127.0.0.1:8000/v1/*
                                  │
                                  ▼
┌────────────────────────────────────────────────────────────────────────┐
│                        BACKEND (backend/)                              │
├────────────────────────────────────────────────────────────────────────┤
│  app.py: FastAPI HTTP & SSE Streaming Endpoints                        │
│  orchestrator.py: Pedagogical AI reasoning, LaTeX cards & canvas ops   │
│  session.py: Local in-memory session manager with JSON backup          │
│  models.py: Strict Pydantic contracts for sessions, messages, canvas  │
│  requirements.txt: Standalone Python dependencies                      │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Technology Stack & Directory Structure

```
Primer v2/
├── frontend/                 # Complete Next.js 16 Web Application
│   ├── app/
│   │   ├── globals.css       # Tailwind v4 theme variables & Bencho tokens
│   │   ├── layout.tsx        # Root HTML layout with viewport & metadata
│   │   └── page.tsx          # Draw ⇄ Talk mode switching container
│   ├── components/           # UI Components
│   │   ├── canvas/           # CanvasWorkspace, CanvasToolbar, CanvasToolbar.css
│   │   ├── talk/             # ChatPanel conversational tutor workspace
│   │   └── zawvee/           # Navbar (Draw | Talk switcher, Theme toggle)
│   ├── lib/                  # Client API & TypeScript types
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
│   ├── models.py             # Pydantic schemas (Session, CanvasOp, ChatMessage)
│   ├── orchestrator.py       # AI tutor reasoning and dynamic canvas diagram generation
│   ├── session.py            # In-memory and local file-backed persistence
│   └── requirements.txt      # Python dependencies
│
├── docs/                     # Architectural & Product Specifications
│   ├── ZAWVEE_FOUNDATION_REVAMP_ARCHITECTURE.md
│   ├── Zawvee_Foundation_Revamp_PRD.docx
│   └── Zawvee_Foundation_Revamp_PRD.md
│
├── local/                    # Local Runtime Data (.gitignored)
│   └── zawvee_data/          # Persistent session & canvas JSON checkpoints
│
├── .env & .env.example       # Environment configuration
├── .gitignore                # Production ignore rules
├── AGENTS.md                 # Next.js guidelines
├── package.json              # Monorepo root scripts
└── README.md                 # Project documentation & runbook
```

---

## 4. Draw Experience Details

The **Draw** workspace provides a responsive, low-latency creative learning canvas:
- **Bottom Bencho Floating Toolbar**:
  - Ink tools: Pen, Pencil, Highlighter, Wide Eraser.
  - Geometry shapes: Rectangle, Circle, Arrow, Line.
  - Mixed media: Inline editable Text.
  - Palette popover: Color selection and stroke width sliders.
  - Clear canvas with confirmation safeguard.
- **Wide Eraser**:
  - Circular visual indicator (32px radius) following cursor coordinates.
  - Erases freehand stroke segments and intersects canvas objects simultaneously.
- **Top Pagination Dock**:
  - Multi-page navigation (e.g., `Page 1 of 3`).
  - Seamless page creation (`+` button) and page switching.
  - Each page maintains independent strokes and semantic objects.
- **Tutor Diagram Integration**:
  - AI tutor operations sent via `canvas_op` stream directly instantiate shapes and math cards on the active page.

---

## 5. Talk Experience Details

The **Talk** view offers a focused, child-friendly conversational tutor:
- **Pedagogical Streaming**:
  - Real-time token streaming with realistic pace.
  - Embedded KaTeX rendering for math equations (e.g. fractions, Pythagorean theorem).
  - Concept cards providing structured definitions and explanations.
- **Contextual Action Chips**:
  - Interactive suggestions after tutor responses (e.g., *"Draw this on canvas"*, *"Try a quick puzzle"*, *"Show 1/4"*).
  - Clicking a chip triggers relevant actions, dispatches canvas ops, or switches the user into Draw mode to view newly illustrated diagrams.
- **Speech & Text Input**:
  - Text input composer with auto-focus.
  - Voice indicator toggle for child speech interactions.

---

## 6. Development & Run Commands

```bash
# In repository root:

# Start Next.js Frontend (port 3000)
npm run dev

# Start FastAPI Backend (port 8000)
npm run backend

# Run build & TypeScript check
npm run check
```
