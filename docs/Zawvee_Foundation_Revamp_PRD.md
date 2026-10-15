ZAWVEE
Foundation Revamp PRD
A rebuild of the K–12 AI learning environment around two core experiences: Draw and Talk / Chat.
Product thesisZawvee is a personal learning environment for children. The interface should feel alive, warm and expressive, while the underlying system remains deterministic, observable and safe. The child should be able to arrive with something they want to understand and move naturally between conversation and making.

Document status: Product + Engineering foundation | Scope: Revamp of existing codebase | Audience: Founders, Product, Design, Engineering, AI/Infrastructure
Source basis: the attached 100× Experience Blueprint, especially its “personal learning environment” thesis, Talk / Draw / Explore primitives, tutor orchestration model, and two foundational physical environments: Talk and Draw. [Source: 100× Experience Blueprint, pp. 1–2]


Zawvee should be rebuilt as a modern multimodal learning application rather than incrementally patched as a vanilla HTML/CSS product. The first release of the revamp intentionally has only two child-facing experiences: Draw, a responsive sketchboard / learning canvas, and Talk / Chat, a conversational tutor interface. Everything else is a platform capability that supports these two experiences and can later power additional learning experiences without another rewrite.
The foundation should use Next.js 16 + React + TypeScript for the web application, Tailwind CSS v4 for the visual system, shadcn/ui with Base UI for accessible primitives, and Motion for interaction animation. A Python + FastAPI service layer should own AI orchestration, long-running jobs, tool execution and realtime session coordination. Long audio/video transport should be handled by a dedicated WebRTC layer such as LiveKit rather than by ordinary request/response APIs.
Core product ruleBuild fewer visible modes, but make the two modes exceptionally good. “Thinking” is a behavior, not another screen. “Memory” is a system capability, not another navigation item. The blueprint explicitly argues for a small set of physical environments with orchestration happening underneath them. [Source: 100× Experience Blueprint, pp. 18–19]


Create a polished, responsive, child-friendly web experience that feels intentional on laptop, tablet and phone.
Create a canvas foundation that can support freehand drawing, handwriting, diagrams, math work, annotations, semantic objects and AI-generated drawing operations.
Create a conversation foundation that supports streamed answers, rich educational cards, references, images and future realtime voice.
Allow AI to perform multiple actions during one session: speak, generate content, draw, update the canvas, create or switch pages, and save state without blocking the child.
Introduce a unified design system so future components can be safely pulled from modern React component libraries without producing visual inconsistency.
Create a backend architecture that can scale concurrent sessions and move expensive AI operations into asynchronous workers.
Preserve the ability to add future learning experiences without changing the fundamental data model, session protocol or design system.

Do not build 50 new learning experiences now.
Do not create a separate navigation item for every learning behavior.
Do not optimize the product for infinite engagement or endless scrolling.
Do not rebuild the entire backend business domain if the existing services are healthy; refactor behind stable contracts first.
Do not make arbitrary LLM-generated HTML or JavaScript the rendering primitive for the canvas.
Do not require native iOS/Android implementation before the responsive web foundation is stable.

Experience
Child can
System responsibilities
MVP boundary
Draw
Draw, write, erase, select, move, zoom, pan, add text, create pages, undo/redo, ask the tutor about the canvas.
Persist scene state, understand semantic objects, stream AI canvas operations, keep drawing responsive, support page-level state.
No full collaborative whiteboard; no advanced 3D editor.
Talk / Chat
Type or speak, ask questions, see streamed responses, interact with cards/media, ask the tutor to explain or show something.
Maintain conversation context, stream output, call tools, render structured educational content, optionally update Draw state.
No giant social feed, no generic “AI assistant” marketplace.

Understanding over screen time.
Agency over automation: AI can suggest and act, but the child should understand what happened and remain able to intervene.
Visible intelligence: the tutor should point, draw, transform and manipulate rather than only produce paragraphs. The blueprint calls this “AI Pointer” and “The AI points, rather than merely tells.” [Source: 100× Experience Blueprint, pp. 4–5]
Semantic state over pixels: canvas content must remain structured enough to reason about, replay and evaluate.
Progressive disclosure: simple default surfaces, richer controls only when needed.
Warm, capable and playful: child-friendly without looking like a baby game.
Fast perception: immediate local response first; network and AI work should stream in behind it.

The design system should be defined before rebuilding individual screens. Third-party components become implementation ingredients, while Zawvee tokens determine the final visual language.

Visual characterWarm paper-like surfaces, clear ink-like typography, soft sky blue for interaction, muted sage for calm/support, soft terracotta for emphasis, generous rounded geometry, subtle grain, and restrained motion. Avoid neon “AI” aesthetics, heavy gradients, glassmorphism everywhere, or juvenile cartoon UI.

Token family
Foundation
Usage
Background
#FBF7F0 / warm ivory
Primary app surface
Ink
#172022
Body and high-contrast text
Muted
#647174
Secondary text
Sky
#DDEEFF + #3B82F6
Primary interaction / focus / links
Sage
#CFE1D3
Success, support, calm surfaces
Terracotta
#F5B99A
Highlights, expressive accents
Line
#DCE3E0
Dividers and component borders
Dark surface
#17333A
Immersive canvas / focused sections

Role
Recommended
Desktop
Tablet / Mobile
Display
Poppins or equivalent rounded geometric family
40–52 px / 1.05
32–40 px / 1.08
H1
Same display family
30–36 px / 1.1
26–30 px / 1.12
H2
Inter / system UI
22–26 px / 1.15
20–23 px / 1.18
Body
Inter / system UI
15–17 px / 1.45
15–16 px / 1.45
Caption
Inter / system UI
12–13 px / 1.35
12–13 px / 1.35
Mono / math
Geist Mono or KaTeX / MathJax output
14–16 px
13–15 px

Token
Value
Rule
Space 1
4 px
Micro spacing
Space 2
8 px
Tight component spacing
Space 3
12 px
Control / chip spacing
Space 4
16 px
Standard inset
Space 5
24 px
Card inset
Space 6
32 px
Section gap
Space 7
48 px
Major composition
Space 8
64 px
Hero / page rhythm
Radius sm
10 px
Inputs, small controls
Radius md
16 px
Standard cards
Radius lg
24 px
Learning cards / panels
Radius xl
32 px
Hero and primary containers
Radius pill
999 px
Tags / compact actions
Shadow 1
0 2px 10px rgba(23,32,34,.06)
Default
Shadow 2
0 8px 30px rgba(23,32,34,.10)
Elevated

Card type
Width
Padding
Radius
Use
Micro card
240–320 px
16 px
16 px
Hints, quick actions, small concept cards
Standard card
320–520 px
20–24 px
20–24 px
Chat attachments, learning objects
Wide card
520–760 px
24–28 px
24–28 px
Explanations, worked examples, previews
Canvas utility panel
280–360 px
16 px
20 px
Inspector, page list, AI actions
Full learning surface
max 1200 px
28–40 px
28–32 px
Immersive content on desktop
Cards must not become the default container for every pixel of the application. The canvas should feel open; chat should feel conversational. Cards are used for moments that benefit from grouping, not as a universal chrome.

Component
Recommended height
Notes
Primary button
44–48 px
Rounded 12–16 px; strong label; subtle press motion
Secondary button
40–44 px
Lower visual weight
Icon button
40–44 px
Minimum touch target 44 px on touch devices
Chat composer
52–64 px
Auto-growing, supports attachment / voice affordances
Canvas toolbar button
40–44 px
Tool state must be visually unmistakable
Chip
30–36 px
Only for filters, state, lightweight actions

Breakpoint
Behavior
< 640 px
Single-column; bottom actions; canvas toolbar collapses; chat cards become full width; avoid fixed sidebars.
640–899 px
Tablet mode; optional compact rail; canvas gets dedicated working area with floating tools.
900–1279 px
Two-column application shell when useful; comfortable chat + utility rail.
1280 px+
Full desktop experience; max content width 1440–1600 px depending on workspace; stable side rails.

Architecture decisionUse a split frontend/backend architecture: Next.js 16 for the web application and Python/FastAPI for AI and realtime orchestration. Do not make either framework responsible for the entire system.

Frontend responsibility: rendering, interaction, local optimistic state, canvas, accessibility, responsive layout, routing, authentication UI, streaming presentation and device APIs.
Backend responsibility: AI orchestration, model routing, tool calling, memory, session state, policy enforcement, persistence, asynchronous jobs, telemetry, evaluation hooks and integrations.
Layer
Technology
Responsibilities
Web app
Next.js 16 + React + TypeScript
App shell, routes, server/client boundaries, streaming UI, auth UI, SEO where relevant
Styling
Tailwind CSS v4
Tokens, responsive utilities, component styling
Primitives
shadcn/ui + Base UI
Accessible controls and composable primitives
Animation
Motion
Component and layout animation; reduced-motion support
Canvas renderer
SVG + Canvas hybrid abstraction
Freehand strokes + semantic shapes/text/math
AI API
Python + FastAPI
Agent orchestration, tool APIs, session endpoints, streaming
Realtime media
WebRTC / LiveKit-ready interface
Long-running voice/video; audio/data events
Queue / state
Redis
Ephemeral sessions, pub/sub, queues, rate limits
Database
PostgreSQL
Users, sessions, pages, objects, messages, memory, telemetry
Object storage
S3
Images, audio, exported canvas snapshots, generated assets
Backend packaging
Docker → Amazon ECR
Immutable backend images
Backend runtime
AWS ECS/Fargate behind ALB
Stateless API / worker services with horizontal scaling
Frontend hosting
Vercel
Next.js deployment, edge caching where appropriate

Recommended repository structure:
app/ (routes and layouts)
components/ui/ (shadcn/Base UI primitives)
components/zawvee/ (product-specific components)
components/canvas/ (renderer, tools, object inspectors, pages)
components/talk/ (messages, composer, rich content cards, voice controls)
lib/design/ (tokens, class helpers, motion presets)
lib/api/ (typed API client)
lib/session/ (frontend session state)
lib/telemetry/ (client events)
types/ (shared schemas and domain types)
Rule for external UI librariesCopy or registry-install components into the repository, then wrap them in Zawvee components. Do not import visual components directly across the product. This keeps the design system coherent and lets the team replace a library later without touching product code.


Draw Mode is the primary spatial workspace. It is not simply a whiteboard. It is a structured learning surface on which the child and AI can create and manipulate knowledge.

Responsive infinite-feeling workspace with a page-oriented mental model.
Freehand pen, pencil, highlighter and eraser.
Text, shapes, arrows, connectors and basic semantic objects.
Select, move, resize, duplicate, group, delete, undo and redo.
Zoom and pan with pointer, mouse and touch gestures.
Multiple pages within one session; page thumbnails and page creation.
Local-first interaction: stroke and transform feedback should happen immediately on-device.
Autosave with debounced persistence; never wait on the network before allowing drawing.
Structured object IDs and z-order so AI can reference exact objects.
Exportable scene state, not only a flattened PNG.

Recommended implementationUse a layered renderer: HTML Canvas for high-frequency freehand strokes; SVG or DOM-backed semantic layers for shapes, text, arrows and math; a transparent interaction layer for hit-testing, selection and gestures. This gives the product both freehand performance and semantic structure.


The AI should never receive permission to execute arbitrary frontend code. It emits typed canvas operations validated against a schema.
Operation
Example payload
Purpose
create_page
{pageId, title}
Add a page
create_text
{objectId, x, y, text, style}
Place explanation / label
create_shape
{objectId, type, bounds, props}
Create circle, rectangle, line, etc.
create_stroke
{objectId, points, style}
Draw an AI stroke
move_object
{objectId, dx, dy}
Reposition
highlight_object
{objectId, mode}
Focus the child’s attention
delete_object
{objectId}
Remove generated content
replace_object
{objectId, patch}
Update existing semantic object
set_page
{pageId}
Switch active page
create_math
{objectId, latex, bounds}
Render a math expression
All operations should be idempotent where possible, versioned, validated server-side and replayable from an event log. This allows AI actions to happen concurrently with the child’s drawing without corrupting the document state.

State
Visual response
Input rule
Idle
Clean canvas
Normal drawing
Drawing
Immediate local stroke
Pointer/touch captured locally
AI working
Small activity indicator near affected area
Canvas remains interactive
AI drawing
Subtle cursor/pen visualization; strokes animate in
Child can continue observing or drawing
Selecting
Clear outline + handles
Keyboard and touch supported
Conflict
Do not silently overwrite
Merge or rebase operation against current scene version

Talk / Chat should feel familiar like ChatGPT, but it must behave like a learning environment: the response can include explanation, questions, images, math, diagrams, a canvas action, and next-step choices.

Element
Desktop
Mobile
Top bar
72 px; compact identity + session context
56–64 px
Message column
640–760 px readable width
Full width with 16 px inset
Assistant rich card
320–760 px depending content
Full width minus 16–24 px
Composer
52–64 px fixed near bottom
56–64 px + safe-area inset
Context rail
280–340 px optional
Hidden by default; opened as sheet

Plain conversation message.
Rich explanation card.
Math card using KaTeX or MathJax.
Image / visual card.
Interactive preview that can open in Draw Mode.
Suggested action chips: “show me”, “draw this”, “try one”, “explain another way”.
System activity state: thinking / generating / drawing, without exposing internal chain-of-thought.
Voice message or live voice session event when realtime is enabled.

Text should stream incrementally. Rich components should appear as soon as their typed payload is complete rather than waiting for the entire assistant response. Canvas operations should travel over a separate action channel so a long explanation never blocks drawing.

A central requirement is that conversation, AI generation and canvas activity must be able to happen concurrently. The application therefore uses an event-driven session model instead of a single sequential request.
Channel
Transport
Examples
Chat stream
HTTP streaming / SSE or equivalent
Assistant text chunks, status events
Tool events
Typed backend events
Search result ready, math artifact ready, canvas op ready
Canvas state
WebSocket or realtime data channel
Object updates, page changes, acknowledgements
Voice/video
WebRTC
Microphone, speaker, camera, long-running session
Durable events
PostgreSQL event table / object state
Message saved, page checkpoint, session close
Async jobs
Redis queue + workers
Image generation, document parsing, exports, heavy computations
Example concurrent session: child asks a science question → assistant starts speaking/text streaming → agent decides to create a visual → canvas operation is sent independently → renderer animates the object locally → conversation continues → the final scene is checkpointed. No step should require the previous step to finish before the next can begin.

The AI layer should be designed as an orchestrator with tools, not a single monolithic prompt. The blueprint identifies an “Experience Orchestrator” as the strategically important intelligence layer. [Source: 100× Experience Blueprint, pp. 25–26]
Component
Responsibility
Session Orchestrator
Maintains current learning context and chooses which tool/action to invoke
Conversation Agent
Generates conversational responses and questions
Canvas Agent / Toolset
Translates intent into validated canvas operations
Content Toolset
Creates structured explanations, examples and math content
Memory Service
Stores and retrieves durable learning-relevant context
Policy / Safety Layer
Age-appropriate constraints, content filtering, data minimization
Event Router
Routes model/tool events to chat, canvas, persistence and telemetry
Worker Pool
Executes long-running / asynchronous tasks
Do not expose chain-of-thoughtThe UI may show lightweight statuses such as “Working on your diagram” or “Checking that equation,” but should not reveal hidden reasoning traces. User-visible reasoning should be expressed as concise explanations, evidence, steps and artifacts.


Entity
Key fields
Notes
User
id, ageBand, grade, guardianId, preferences
Separate child and guardian permissions
Session
id, userId, mode, status, startedAt, endedAt
A logical learning session
Conversation
id, sessionId
Talk history container
Message
id, conversationId, role, content, contentParts, createdAt
Structured content parts, not markdown-only
CanvasDocument
id, sessionId, activePageId, version
Top-level sketchboard document
CanvasPage
id, documentId, title, order, version
Independent page state
CanvasObject
id, pageId, type, geometry, props, zIndex, version
Semantic object
CanvasEvent
id, documentId, clientId, op, payload, version, createdAt
Replay / conflict handling
Artifact
id, sessionId, type, uri, metadata
Generated images, files, exports
Memory
id, userId, type, value, evidence, confidence
Durable learning context; not everything in chat becomes memory
TelemetryEvent
id, sessionId, name, payload, createdAt
Performance + product analytics

All public APIs should have typed request/response schemas and versioned event contracts. The frontend should never depend on raw model-provider responses.
Endpoint / channel
Purpose
POST /v1/sessions
Create learning session
GET /v1/sessions/:id
Fetch session state
POST /v1/chat/messages
Send user message
GET /v1/chat/stream/:id
Stream assistant events
POST /v1/canvas/ops
Submit validated canvas ops
GET /v1/canvas/:id
Fetch canvas document
POST /v1/canvas/checkpoint
Persist scene checkpoint
WS /v1/sessions/:id/events
Realtime structured events
POST /v1/realtime/token
Mint short-lived voice/video token
POST /v1/memory/query
Retrieve relevant durable context
POST /v1/memory/write
Persist approved memory candidate

Concern
Target architecture
Frontend
Vercel; preview deployments for every PR; production with observability
Backend image
Docker image pushed to Amazon ECR
Backend runtime
ECS/Fargate service behind ALB; stateless API pods/tasks; autoscaling on CPU, memory and request metrics
AI workers
Separate ECS worker service using same image or worker-specific image
Redis
Managed Redis / ElastiCache or existing managed Redis during early stage
Database
Managed PostgreSQL; automated backups; read replicas later if required
Storage
S3 with signed URLs; lifecycle policies for temporary assets
Secrets
AWS Secrets Manager / Parameter Store; never shipped to frontend
CDN
Vercel for web assets; S3/CloudFront when large media requires it
Observability
Central logs, traces, request IDs, model latency, token usage, WebRTC session health
ECR clarificationAmazon ECR is the container registry, not the application runtime. The PRD therefore treats ECR as the image store and ECS/Fargate as the initial AWS runtime target.


Metric
Initial target
First meaningful UI
< 2 seconds on a mid-range modern device
Interaction response
< 100 ms for local canvas input
Canvas drawing
No visible network dependency per stroke
Composer input
No perceptible lag while typing
First streamed text
As early as model/provider permits; UI must display progress immediately
Canvas AI operation
Begin rendering as soon as validated operation arrives
State save
Debounced; target < 500 ms acknowledgement under normal conditions
Reconnection
Resume session without losing already persisted state
Mobile memory
Avoid unbounded in-memory conversation / canvas growth

Animation should communicate state, spatial continuity and delight. It must never delay essential interaction.
Pattern
Duration
Guidance
Press / hover
100–160 ms
Scale or elevation only; subtle
Panel enter
180–260 ms
Opacity + small translate
Shared layout
240–420 ms
Use Motion when moving content between locations
AI drawing
Perceptual / stroke-based
Animate generation in spatial sequence, not random jitter
Page switch
180–280 ms
Slide / fade with clear direction
Loading
Continuous
Prefer meaningful activity indicators over generic spinners
Reduced motion
Respect OS setting
Disable nonessential movement

Touch targets should be at least 44 × 44 px.
Keyboard navigation must work for every non-canvas control.
Focus states must remain visible against warm backgrounds.
Canvas should offer alternate text or semantic descriptions for generated objects where appropriate.
Do not rely only on color to communicate state.
Support reduced motion.
Use plain, encouraging language and avoid anthropomorphic claims that imply the AI is a human friend.
Keep privacy and guardian controls separate from the child’s learning workspace.
Avoid manipulative engagement patterns such as endless feed mechanics or dark patterns.
The source blueprint specifically cautions against positioning the tutor as an AI “best friend” and instead describes a warm, patient mentor who can sometimes direct a child back to a teacher, book or parent. [Source: 100× Experience Blueprint, p. 23]

Short-lived auth/session tokens; server-side authorization for every child resource.
Isolate child data by tenant/account and user scope.
Rate limit chat, canvas operations and expensive generation endpoints.
Validate every model-generated structured action before execution.
Do not let LLM output directly call arbitrary network endpoints or execute code.
Redact secrets and personal data from logs.
Create explicit data retention rules for audio/video and generated artifacts.
Audit important AI actions through structured event logs.
Provide guardian/admin controls separately from child controls.

The safest approach is a strangler rebuild of the frontend rather than a gradual accumulation of new CSS conventions.
Freeze the existing frontend’s visual scope; preserve backend contracts that are working.
Create the new Next.js 16 application shell and design tokens.
Introduce shadcn/Base UI and the Zawvee component wrapper layer.
Build the responsive application shell and routing.
Rebuild Talk / Chat against typed API contracts.
Rebuild Draw against the new canvas document model and renderer abstraction.
Connect realtime event routing and persistence.
Migrate authentication/session integration.
Run side-by-side visual and behavior QA against the legacy product.
Switch routes progressively and remove legacy CSS only after replacement surfaces are stable.

Area
Requirement
Type safety
Strict TypeScript; generated API types or shared schema package where possible
Validation
Pydantic / JSON Schema at backend boundaries; runtime validation for model actions
Testing
Unit tests for reducers/protocols; integration tests for chat/canvas; browser tests for critical flows
Canvas correctness
Replay tests: identical event stream must recreate identical semantic scene
Visual QA
Screenshot regression for major breakpoints
Performance QA
Mid-range laptop + mid-range Android/iOS testing
Failure handling
Every streaming session must have retry, cancellation and reconnection states
Deployment
Preview on PR; immutable backend images; migration scripts reviewed separately

A child can enter Zawvee, choose Draw or Talk / Chat, and begin without configuration complexity.
Talk streams responses smoothly and renders text, math and rich content without layout jumps.
The child can ask the tutor to create a diagram and see the result appear in Draw.
The child can draw continuously while AI processing is occurring.
AI canvas operations are structured, validated and persisted.
Canvas pages, objects and versions survive refresh and session recovery.
The application behaves cleanly at mobile, tablet and desktop breakpoints.
No visual component directly imports a third-party library implementation when a Zawvee wrapper should exist.
Backend APIs remain stateless at the request layer; long-running work is delegated to realtime or worker services.
Logs and telemetry include session IDs and correlation IDs without leaking sensitive child data.

Phase
Build
Phase 0 — Foundation
Repository setup; Next.js app; Tailwind; shadcn/Base UI; design tokens; CI; deployment environments; API client; observability.
Phase 1 — Talk / Chat
Chat shell; streaming; messages; rich content parts; session persistence; basic tool event protocol.
Phase 2 — Draw
Canvas renderer; tools; pages; persistence; undo/redo; semantic object model.
Phase 3 — AI Canvas
Typed canvas operations; AI pointer/highlight primitives; synchronized chat + canvas event routing.
Phase 4 — Realtime
Voice session abstraction; LiveKit/WebRTC integration; realtime interruptions and tool events.
Phase 5 — Hardening
Performance, accessibility, child-safety controls, device QA, failure recovery, production scaling.

The following are intentionally architecture hooks, not current feature commitments: interactive experiments, immersive reading, memory-based retrieval, adaptive experience orchestration, richer simulation, generative transformations, knowledge maps, and additional learning surfaces. The existing blueprint describes these as future experiences around the same underlying orchestrator. [Source: 100× Experience Blueprint, pp. 19–21]
Experience registry: a typed way to introduce another learning surface later.
Artifact schema: common representation for diagrams, math, text, images and interactive objects.
Tool registry: model-visible tools with explicit permissions and structured outputs.
Memory service: durable child model separated from raw chat logs.
Event protocol: one session bus capable of routing chat, canvas, voice and future modalities.


What we are actually buildingZawvee is not “ChatGPT for kids with a drawing tool.” The foundation is a multimodal learning environment in which conversation and making are first-class, the AI can coordinate across them, and the interface stays quiet enough for the child’s attention to remain on the thing they are trying to understand.

The 100× blueprint’s final principle is that the quality of the product comes from making the right small decision at the right moment, not from accumulating 100 features. This PRD therefore treats the first rebuild as infrastructure for that intelligence: a responsive UI system, a semantic canvas, a streamed conversation surface, and an event-driven AI backend. [Source: 100× Experience Blueprint, p. 28]

Category
Choice
Why
Web
Next.js 16 + React 19 + TypeScript
Best fit for the React component ecosystem and interactive app shell
CSS
Tailwind CSS v4
Utility-first styling and token-driven responsive system
UI primitives
shadcn/ui + Base UI
Composable, accessible, source-owned components
Motion
Motion
React-native interaction and layout animation
Canvas
Custom SVG + Canvas hybrid
Semantic objects + fast freehand input
Math
KaTeX / MathJax
Reliable formula rendering
Backend
Python + FastAPI
Async APIs, AI orchestration and realtime-friendly services
Realtime
LiveKit / WebRTC
Long-running audio/video/data sessions
Database
PostgreSQL
Durable relational product state
Cache / queue
Redis
Ephemeral state, pub/sub and worker queues
Object storage
S3
Generated assets and exports
Container registry
Amazon ECR
Immutable backend image storage
Runtime
AWS ECS/Fargate
Managed container runtime with horizontal scaling
Frontend hosting
Vercel
Fast deployment and CDN-backed web delivery

                 ZAWVEE WEB APP
   Next.js 16 / React / Tailwind / shadcn / Motion
            ┌─────────────┬──────────────┐
            │ Talk / Chat │ Draw / Canvas │
            └──────┬──────┴───────┬──────┘
                         │ typed events │
                         ▼              ▼
                 FASTAPI ORCHESTRATOR
        chat • tools • canvas ops • memory • policy
                         │
             ┌───────────┼───────────┐
             ▼           ▼           ▼
          Postgres     Redis       S3
             │           │
             └──────┬────┘
                    ▼
              AWS WORKERS
                    │
             LiveKit / WebRTC