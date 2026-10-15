/**
 * drawingPrimitives.ts — Low-Level Hand-Drawn Vector Primitives
 *
 * Single source of truth for all organic hand-drawn stroke generation.
 * Provides natural human wobble, pressure variance, and imperfect curvature
 * for whiteboard marker aesthetics.
 *
 * Every shape on the Zawvee whiteboard is composed from these primitives.
 */

import type { Stroke, Point } from "@/lib/types";

export interface BaseSketchOptions {
  color?: string;
  strokeWidth?: number;
  pageId?: string;
}

// ─── LINE ─────────────────────────────────────────────────────

/** Generates a hand-drawn line with subtle natural wobble and 10 sample points */
export function createHandDrawnLine(
  p1: Point,
  p2: Point,
  strokeId: string,
  options: BaseSketchOptions,
  jitterAmount = 0.6
): Stroke {
  const points: Point[] = [];
  const count = 10;
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const len = Math.hypot(dx, dy);

  // Normal vector for perpendicular jitter
  const nx = len > 0 ? -dy / len : 0;
  const ny = len > 0 ? dx / len : 0;

  for (let i = 0; i <= count; i++) {
    const t = i / count;
    // Bell curve so endpoints connect accurately, wobble in the middle
    const bell = Math.sin(t * Math.PI);
    const jitter = Math.sin(t * 14.5 + p1.x * 0.1) * jitterAmount * bell;

    points.push({
      x: p1.x + dx * t + nx * jitter,
      y: p1.y + dy * t + ny * jitter,
    });
  }

  return {
    id: strokeId,
    page_id: options.pageId || "",
    tool: "pen",
    color: options.color || "#60A5FA",
    size: options.strokeWidth || 2.8,
    points,
  };
}

// ─── CIRCLE ───────────────────────────────────────────────────

/** Generates a hand-drawn closed circle with authentic human curvature */
export function createHandDrawnCircle(
  center: Point,
  radius: number,
  strokeId: string,
  options: BaseSketchOptions,
  jitterAmount = 0.8
): Stroke {
  const points: Point[] = [];
  const segments = 48;

  // Start at top (-PI/2) and draw full clockwise circle with slight overlap
  const totalAngle = Math.PI * 2 + 0.15;
  const startAngle = -Math.PI / 2;

  for (let i = 0; i <= segments; i++) {
    const angle = startAngle + (i / segments) * totalAngle;
    const wobble = Math.sin(angle * 3.2) * jitterAmount + Math.cos(angle * 5.1) * (jitterAmount * 0.4);
    const r = radius + wobble;

    points.push({
      x: center.x + Math.cos(angle) * r,
      y: center.y + Math.sin(angle) * r,
    });
  }

  return {
    id: strokeId,
    page_id: options.pageId || "",
    tool: "pen",
    color: options.color || "#EDEDED",
    size: options.strokeWidth || 2.5,
    points,
  };
}

// ─── ELLIPSE ──────────────────────────────────────────────────

/** Hand-drawn ellipse with natural organic wobble */
export function createHandDrawnEllipse(
  center: Point,
  rx: number,
  ry: number,
  strokeId: string,
  options: BaseSketchOptions,
  jitterAmount = 0.6
): Stroke {
  const points: Point[] = [];
  const segments = 40;
  const totalAngle = Math.PI * 2 + 0.12;
  const startAngle = -Math.PI / 2;

  for (let i = 0; i <= segments; i++) {
    const angle = startAngle + (i / segments) * totalAngle;
    const wobble = Math.sin(angle * 3.5) * jitterAmount;
    points.push({
      x: center.x + Math.cos(angle) * (rx + wobble),
      y: center.y + Math.sin(angle) * (ry + wobble),
    });
  }

  return {
    id: strokeId,
    page_id: options.pageId || "",
    tool: "pen",
    color: options.color || "#38BDF8",
    size: options.strokeWidth || 2.5,
    points,
  };
}

// ─── ARC ──────────────────────────────────────────────────────

/** Hand-drawn partial arc (portion of a circle/ellipse) */
export function createHandDrawnArc(
  center: Point,
  rx: number,
  ry: number,
  startAngle: number,
  endAngle: number,
  strokeId: string,
  options: BaseSketchOptions,
  jitterAmount = 0.5
): Stroke {
  const points: Point[] = [];
  const segments = Math.max(12, Math.ceil(Math.abs(endAngle - startAngle) * 10));

  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const angle = startAngle + t * (endAngle - startAngle);
    const wobble = Math.sin(angle * 4.2) * jitterAmount * Math.sin(t * Math.PI);
    points.push({
      x: center.x + Math.cos(angle) * (rx + wobble),
      y: center.y + Math.sin(angle) * (ry + wobble),
    });
  }

  return {
    id: strokeId,
    page_id: options.pageId || "",
    tool: "pen",
    color: options.color || "#38BDF8",
    size: options.strokeWidth || 2.5,
    points,
  };
}

// ─── DOT ──────────────────────────────────────────────────────

/** Hand-drawn filled dot/point marker (small circle with inner glow) */
export function createHandDrawnDot(
  center: Point,
  radius: number,
  strokeId: string,
  options: BaseSketchOptions
): Stroke[] {
  const strokes: Stroke[] = [];
  // Outer circle
  strokes.push(
    createHandDrawnCircle(center, radius, strokeId, {
      color: options.color || "#38BDF8",
      strokeWidth: Math.max(2, (options.strokeWidth || 2.5)),
      pageId: options.pageId,
    })
  );
  // Inner highlighter glow fill
  strokes.push({
    id: `${strokeId}-fill`,
    page_id: options.pageId || "",
    tool: "highlighter",
    color: options.color || "#38BDF8",
    size: Math.max(4, radius * 0.8),
    points: [
      { x: center.x - radius * 0.4, y: center.y },
      { x: center.x + radius * 0.4, y: center.y },
    ],
  });
  return strokes;
}

// ─── POLYGON ──────────────────────────────────────────────────

/** Hand-drawn polygon connecting vertices in order, closing back to first */
export function createHandDrawnPolygon(
  vertices: Point[],
  strokeId: string,
  options: BaseSketchOptions
): Stroke[] {
  const strokes: Stroke[] = [];
  if (vertices.length < 2) return strokes;
  for (let i = 0; i < vertices.length; i++) {
    const p1 = vertices[i];
    const p2 = vertices[(i + 1) % vertices.length];
    strokes.push(createHandDrawnLine(p1, p2, `${strokeId}-e${i}`, options));
  }
  return strokes;
}

// ─── ARROW ────────────────────────────────────────────────────

/** Hand-drawn directional arrow with shaft and angled barb head */
export function createHandDrawnArrow(
  from: Point,
  to: Point,
  strokeId: string,
  options: BaseSketchOptions
): Stroke[] {
  const strokes: Stroke[] = [];
  strokes.push(createHandDrawnLine(from, to, `${strokeId}-shaft`, options));
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const headLen = 13;
  const barb1 = {
    x: to.x - headLen * Math.cos(angle - Math.PI / 6),
    y: to.y - headLen * Math.sin(angle - Math.PI / 6),
  };
  const barb2 = {
    x: to.x - headLen * Math.cos(angle + Math.PI / 6),
    y: to.y - headLen * Math.sin(angle + Math.PI / 6),
  };
  strokes.push({
    id: `${strokeId}-head`,
    page_id: options.pageId || "",
    tool: "pen",
    color: options.color || "#38BDF8",
    size: options.strokeWidth || 2.4,
    points: [barb1, to, barb2],
  });
  return strokes;
}

// ─── PATH ─────────────────────────────────────────────────────

/** Hand-drawn path from a list of points (no wobble — raw polyline) */
export function createHandDrawnPath(
  points: Point[],
  strokeId: string,
  options: BaseSketchOptions
): Stroke {
  return {
    id: strokeId,
    page_id: options.pageId || "",
    tool: "pen",
    color: options.color || "#38BDF8",
    size: options.strokeWidth || 2.5,
    points,
  };
}

// ─── BRACKET ──────────────────────────────────────────────────

/** Hand-drawn square bracket (vertical or horizontal) for grouping */
export function createHandDrawnBracket(
  from: Point,
  to: Point,
  direction: "left" | "right" | "top" | "bottom",
  strokeId: string,
  options: BaseSketchOptions
): Stroke[] {
  const strokes: Stroke[] = [];
  const tickLen = 6;
  const isVertical = direction === "left" || direction === "right";

  if (isVertical) {
    // Span line
    strokes.push(
      createHandDrawnLine(from, to, `${strokeId}-span`, options)
    );
    // Top tick
    const tickDir = direction === "left" ? 1 : -1;
    strokes.push(
      createHandDrawnLine(
        from,
        { x: from.x + tickDir * tickLen, y: from.y },
        `${strokeId}-tick1`,
        options
      )
    );
    // Bottom tick
    strokes.push(
      createHandDrawnLine(
        to,
        { x: to.x + tickDir * tickLen, y: to.y },
        `${strokeId}-tick2`,
        options
      )
    );
  } else {
    // Horizontal span line
    strokes.push(
      createHandDrawnLine(from, to, `${strokeId}-span`, options)
    );
    // Left tick
    const tickDir = direction === "top" ? 1 : -1;
    strokes.push(
      createHandDrawnLine(
        from,
        { x: from.x, y: from.y + tickDir * tickLen },
        `${strokeId}-tick1`,
        options
      )
    );
    // Right tick
    strokes.push(
      createHandDrawnLine(
        to,
        { x: to.x, y: to.y + tickDir * tickLen },
        `${strokeId}-tick2`,
        options
      )
    );
  }

  return strokes;
}

// ─── HIGHLIGHTER FILL ─────────────────────────────────────────

/** Dense highlighter hatching inside a rectangular region */
export function createHighlighterFill(
  left: number,
  top: number,
  width: number,
  height: number,
  strokeId: string,
  options: BaseSketchOptions & { density?: number }
): Stroke[] {
  const strokes: Stroke[] = [];
  const lineSpacing = options.density || 12;
  const count = Math.max(2, Math.floor(width / lineSpacing));

  for (let i = 1; i <= count; i++) {
    const x = left + (i / (count + 1)) * width;
    strokes.push({
      id: `${strokeId}-${i}`,
      page_id: options.pageId || "",
      tool: "highlighter",
      color: options.color || "#38BDF8",
      size: Math.min(lineSpacing * 0.8, 14),
      points: [
        { x, y: top + 3 },
        { x, y: top + height - 3 },
      ],
    });
  }

  return strokes;
}

// ─── CHECKMARK ────────────────────────────────────────────────

/** Hand-drawn checkmark (✓) at a target point */
export function createHandDrawnCheckmark(
  center: Point,
  size: number,
  strokeId: string,
  options: BaseSketchOptions
): Stroke {
  const s = size / 2;
  return {
    id: strokeId,
    page_id: options.pageId || "",
    tool: "pen",
    color: options.color || "#10B981",
    size: options.strokeWidth || 3,
    points: [
      { x: center.x - s * 0.6, y: center.y },
      { x: center.x - s * 0.1, y: center.y + s * 0.6 },
      { x: center.x + s * 0.8, y: center.y - s * 0.7 },
    ],
  };
}

// ─── CROSS (✗) ────────────────────────────────────────────────

/** Hand-drawn cross-out (✗) at a target point */
export function createHandDrawnCross(
  center: Point,
  size: number,
  strokeId: string,
  options: BaseSketchOptions
): Stroke[] {
  const s = size / 2;
  return [
    createHandDrawnLine(
      { x: center.x - s, y: center.y - s },
      { x: center.x + s, y: center.y + s },
      `${strokeId}-1`,
      { ...options, color: options.color || "#EF4444" }
    ),
    createHandDrawnLine(
      { x: center.x + s, y: center.y - s },
      { x: center.x - s, y: center.y + s },
      `${strokeId}-2`,
      { ...options, color: options.color || "#EF4444" }
    ),
  ];
}

// ─── TEACHER ANNOTATION STROKE GENERATOR ─────────────────────

export type AnnotationType =
  | "circle_highlight"
  | "arrow"
  | "underline"
  | "checkmark"
  | "cross_out"
  | "bracket_group";

export function createAnnotationStrokes(
  type: AnnotationType | string,
  target: Point,
  options: BaseSketchOptions & { width?: number; height?: number; message?: string } = {}
): Stroke[] {
  const uid = Date.now().toString(36);
  const color = options.color || "#F59E0B"; // Energetic teacher amber
  const strokeWidth = options.strokeWidth || 2.5;
  const pageId = options.pageId || "";

  if (type === "circle_highlight") {
    // Loop drawn around target with an overlapping tail
    const rx = (options.width || 80) / 2 + 15;
    const ry = (options.height || 40) / 2 + 10;
    const points: Point[] = [];
    const segments = 36;
    const totalAngle = Math.PI * 2 + 0.35; // Slight overlap tail

    for (let i = 0; i <= segments; i++) {
      const angle = (i / segments) * totalAngle;
      points.push({
        x: target.x + Math.cos(angle) * rx,
        y: target.y + Math.sin(angle) * ry,
      });
    }

    return [
      {
        id: `anno-circle-${uid}`,
        page_id: pageId,
        tool: "pen",
        color,
        size: strokeWidth,
        points,
      },
    ];
  }

  if (type === "underline") {
    const w = options.width || 120;
    const y1 = target.y + 6;
    const y2 = target.y + 11;

    return [
      createHandDrawnLine(
        { x: target.x - w / 2, y: y1 },
        { x: target.x + w / 2, y: y1 },
        `anno-under-1-${uid}`,
        { color, strokeWidth, pageId }
      ),
      createHandDrawnLine(
        { x: target.x - w / 2 + 4, y: y2 },
        { x: target.x + w / 2 - 2, y: y2 },
        `anno-under-2-${uid}`,
        { color, strokeWidth: strokeWidth * 0.85, pageId }
      ),
    ];
  }

  if (type === "arrow") {
    // Curved arrow pointing down to target
    const startX = target.x + 60;
    const startY = target.y - 50;
    const midX = target.x + 35;
    const midY = target.y - 15;

    const shaftPoints: Point[] = [
      { x: startX, y: startY },
      { x: (startX + midX) / 2, y: (startY + midY) / 2 - 5 },
      { x: midX, y: midY },
      { x: target.x, y: target.y },
    ];

    const barb1: Point = { x: target.x + 12, y: target.y - 12 };
    const barb2: Point = { x: target.x + 16, y: target.y - 2 };

    return [
      {
        id: `anno-arrow-shaft-${uid}`,
        page_id: pageId,
        tool: "pen",
        color,
        size: strokeWidth,
        points: shaftPoints,
      },
      {
        id: `anno-arrow-head-${uid}`,
        page_id: pageId,
        tool: "pen",
        color,
        size: strokeWidth,
        points: [barb1, target, barb2],
      },
    ];
  }

  if (type === "checkmark") {
    return [
      createHandDrawnCheckmark(target, options.width || 36, `anno-check-${uid}`, {
        color: options.color || "#10B981",
        strokeWidth,
        pageId,
      }),
    ];
  }

  if (type === "cross_out") {
    return createHandDrawnCross(target, options.width || 36, `anno-cross-${uid}`, {
      color: options.color || "#EF4444",
      strokeWidth,
      pageId,
    });
  }

  if (type === "bracket_group") {
    const w = options.width || 100;
    return createHandDrawnBracket(
      { x: target.x - w / 2, y: target.y },
      { x: target.x + w / 2, y: target.y },
      "bottom",
      `anno-bracket-${uid}`,
      { color, strokeWidth, pageId }
    );
  }

  return [];
}

