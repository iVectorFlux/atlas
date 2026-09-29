# Atlas

Atlas is an infinite whiteboard canvas featuring smooth handwriting ink, rich formatting, learner onboarding, user profile management, and board snapshot persistence.

## Features

- **Infinite Whiteboard Canvas**: Smooth pen strokes, ink colors, eraser, undo/redo, pan and zoom.
- **Precision Drawing Tools**:
  - Pen with intuitive vertical size slider rail
  - Ink well with curated colors and custom color picker
  - Lasso selection for moving, scaling, and deleting content
  - Eraser with stroke awareness
  - Hand tool for canvas panning and moving placed objects
  - Text tool supporting Markdown and LaTeX formatting
  - Image/photo placement with place, merge, and transform options
- **User Onboarding & Profile**:
  - 3-step onboarding flow collecting learner details (name, class/grade, interests)
  - User profile modal for reviewing and updating learner information
  - Supabase authentication integration for seamless cloud profile persistence with local storage fallback
- **Board Persistence & Sharing**:
  - Save and restore board snapshots locally or on the server
  - Export canvas as PNG
  - Share modal for links and export options
- **Clean Apple-inspired UI**: Minimalist, distraction-free aesthetic with system typography and sleek modal interfaces.

## Project Structure

```
├── docs/
│   ├── PRIMER-ORCHESTRATION.md
│   └── PRIMER-PRD.md
├── public/
│   ├── css/
│   │   ├── app.css           # Bundled canvas stylesheet
│   │   └── login.css         # Sign-in styling
│   ├── js/
│   │   ├── auth/
│   │   │   ├── onboard.js    # 3-step learner onboarding & profile modal
│   │   │   └── supabase-auth.js # Supabase client authentication
│   │   ├── vendor/           # MathJax & vendor helpers
│   │   └── board.js          # Compiled whiteboard canvas engine
│   ├── index.html            # Main canvas application shell
│   └── login.html            # Sign-in page
├── scripts/
│   └── build-web.js          # Client bundler for CSS & Board modules
├── src/
│   ├── board/                # Modular whiteboard canvas engine
│   ├── server/               # Lightweight Node static & API server
│   └── web/css/              # CSS design tokens, shell, and board styles
├── package.json
└── server.js
```

## Getting Started

### Prerequisites

- Node.js 20.3 or newer

### Installation & Run

```bash
# Start the local server
npm start
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Scripts

| Command | Purpose |
| --- | --- |
| `npm start` | Run the Atlas server |
| `npm run dev` | Run development server |
| `npm run build` | Recompile client bundles (`public/css/app.css` & `public/js/board.js`) |
| `npm run check` | Run JavaScript syntax check across all source files |

### Configuration (Optional)

Atlas works out of the box with local storage. To enable Supabase authentication and cloud profile sync, create a `.env` file:

```env
PORT=3000
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
```
