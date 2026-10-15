/**
 * drawingPrimitives.ts — Low-Level Hand-Drawn Physics & Vector Primitives
 *
 * Provides organic hand-drawn stroke generation with natural human wobble,
 * pressure variance, and imperfect curvature for whiteboard markers.
 */

import type { Stroke, Point } from "@/lib/types";

export interface BaseSketchOptions {
  color?: string;
  strokeWidth?: number;
  pageId?: string;
}

/** Generates a hand-drawn line with subtle natural wobble and 6-10 points */
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

/** Hand-drawn polygon connecting vertices */
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

/** Hand-drawn directional arrow with shaft and angled head */
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

/** Hand-drawn path from point list */
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
