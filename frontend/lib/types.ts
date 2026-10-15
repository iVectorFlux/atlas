export type AppMode = "draw" | "talk";
export type ThemeMode = "dark" | "light";

export type ToolType = "pen" | "pencil" | "highlighter" | "eraser" | "select" | "shape" | "text" | "math";

export interface Point {
  x: float;
  y: float;
  pressure?: float;
}

type float = number;

export interface Stroke {
  id: string;
  page_id: string;
  tool: "pen" | "pencil" | "highlighter" | "eraser";
  color: string;
  size: number;
  points: Point[];
}

export interface CanvasObject {
  id: string;
  page_id: string;
  type: "rect" | "circle" | "triangle" | "arrow" | "line" | "star" | "text" | "math";
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  fill?: string;
  stroke_width?: number;
  text?: string;
  latex?: string;
  z_index?: number;
}

export interface CanvasPage {
  id: string;
  document_id: string;
  title: string;
  order: number;
  strokes: Stroke[];
  objects: CanvasObject[];
  version: number;
}

export interface CanvasDocument {
  id: string;
  session_id: string;
  active_page_id: string;
  pages: CanvasPage[];
  version: number;
  updated_at: number;
}

export interface ActionChip {
  id: string;
  label: string;
  action: string;
  payload?: Record<string, any>;
}

export interface ContentPart {
  type: "text" | "math" | "card" | "canvas_preview" | "diagram";
  text?: string;
  latex?: string;
  title?: string;
  description?: string;
  metadata?: Record<string, any>;
}

export interface ChatMessage {
  id: string;
  session_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  parts?: ContentPart[];
  action_chips?: ActionChip[];
  created_at?: number;
  metadata?: Record<string, any>;
}

export interface SessionState {
  id: string;
  user_id: string;
  mode: AppMode;
  title: string;
  created_at: number;
  updated_at: number;
}

export interface CanvasOp {
  op: "create_stroke" | "create_shape" | "create_text" | "create_math" | "move_object" | "highlight_object" | "delete_object" | "clear_page" | "create_page" | "set_page" | "draw_handwriting" | "draw_diagram" | "draw_scene" | "draw_svg";
  page_id?: string;
  payload: Record<string, any>;
  client_id?: string;
  timestamp?: number;
}

// ─── Tutor Animated Performance Queue ───

/** A single step the tutor performs on the canvas — move cursor, draw, type, or highlight */
export interface TutorStep {
  /** `await_beat` holds the drawing until the tutor voice starts its next sentence (duration = max wait) */
  type: "move_pointer" | "draw_shape" | "draw_stroke" | "type_text" | "highlight" | "pause" | "await_beat";
  /** Target position for pointer movement or shape origin */
  target?: { x: number; y: number };
  /** Duration of this step in ms (defaults vary by type) */
  duration?: number;
  /** Optional tooltip/speech bubble shown near the pointer */
  message?: string;
  /** Canvas operation payload (shape, stroke, text, etc.) */
  payload?: Partial<CanvasObject> & Record<string, any>;
  /** Stroke points for animated draw_stroke */
  points?: Point[];
}

/** A full choreographed sequence of tutor steps */
export interface TutorPerformance {
  id: string;
  steps: TutorStep[];
  /** If true, user tap/click skips to finished state */
  skippable?: boolean;
}

/** Live state of the AI pointer overlay */
export interface AiPointerState {
  x: number;
  y: number;
  visible: boolean;
  /** Optional short message shown as a speech label */
  message?: string;
  /** Current phase: idle, moving, drawing, highlighting */
  phase: "idle" | "moving" | "drawing" | "highlighting";
}
