/**
 * Constraint-Based Whiteboard Layout Engine
 * Resolves semantic layout zones in the Universal Virtual Coordinate Space (1000 x 600).
 * Enforces non-overlapping clearance guarantees between Title, Formulas, Diagrams,
 * and the student's Bottom Action Chips / Dock.
 * (Invariants 4 & 5 of JAWVEE Spatial Teaching Engine)
 */

import { BoundingBox, SemanticObject, SemanticRole } from "./types";
import { VIRTUAL_CANVAS_WIDTH, VIRTUAL_CANVAS_HEIGHT } from "./sceneManager";

export interface LayoutZone {
  name: SemanticRole;
  minY: number;
  maxY: number;
  targetY: number;
  centerX: number;
}

export const LAYOUT_ZONES: Record<SemanticRole, LayoutZone> = {
  title: {
    name: "title",
    minY: 20,
    maxY: 75,
    targetY: 45,
    centerX: 500,
  },
  primary_concept: {
    name: "primary_concept",
    minY: 85,
    maxY: 145,
    targetY: 110,
    centerX: 500,
  },
  visual_model: {
    name: "visual_model",
    minY: 155,
    maxY: 410,
    targetY: 280,
    centerX: 500,
  },
  conclusion: {
    name: "conclusion",
    minY: 420,
    maxY: 485,
    targetY: 450,
    centerX: 500,
  },
  annotation: {
    name: "annotation",
    minY: 80,
    maxY: 480,
    targetY: 280,
    centerX: 500,
  },
  axis: {
    name: "axis",
    minY: 155,
    maxY: 410,
    targetY: 280,
    centerX: 500,
  },
  counter: {
    name: "counter",
    minY: 155,
    maxY: 410,
    targetY: 280,
    centerX: 500,
  },
  slice: {
    name: "slice",
    minY: 155,
    maxY: 410,
    targetY: 280,
    centerX: 500,
  },
};

/**
 * Creates a normalized BoundingBox object.
 */
export function computeBoundingBox(
  centerX: number,
  centerY: number,
  width: number,
  height: number
): BoundingBox {
  const hw = Math.max(1, width) / 2;
  const hh = Math.max(1, height) / 2;
  return {
    minX: centerX - hw,
    maxX: centerX + hw,
    minY: centerY - hh,
    maxY: centerY + hh,
    width,
    height,
    centerX,
    centerY,
  };
}

/**
 * Computes bounding box from a list of 2D points.
 */
export function computePointsBoundingBox(points: Array<{ x: number; y: number }>): BoundingBox {
  const validPoints = (points || []).filter(
    (p) => p && Number.isFinite(p.x) && Number.isFinite(p.y)
  );

  if (validPoints.length === 0) {
    return computeBoundingBox(500, 300, 10, 10);
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const p of validPoints) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }

  if (!Number.isFinite(minX) || !Number.isFinite(maxX) || !Number.isFinite(minY) || !Number.isFinite(maxY)) {
    return computeBoundingBox(500, 300, 10, 10);
  }

  const width = Math.max(10, maxX - minX);
  const height = Math.max(10, maxY - minY);
  return {
    minX,
    maxX,
    minY,
    maxY,
    width,
    height,
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2,
  };
}

/**
 * Resolves layout coordinates for a whiteboard entity based on its semantic role.
 * Enforces vertical clearance and clamps coordinates so objects never collide
 * with top titles or bottom floating action chips (hard ceiling y <= 495).
 */
export function resolveSemanticPosition(
  role: SemanticRole,
  requestedX?: number,
  requestedY?: number,
  estimatedWidth = 160,
  estimatedHeight = 50
): { x: number; y: number; bounds: BoundingBox } {
  const zone = LAYOUT_ZONES[role] || LAYOUT_ZONES.visual_model;

  let x = requestedX !== undefined ? requestedX : zone.centerX;
  let y = requestedY !== undefined ? requestedY : zone.targetY;

  // Clamp within the designated zone bounds
  y = Math.max(zone.minY + estimatedHeight / 2, Math.min(zone.maxY - estimatedHeight / 2, y));

  // Hard safety ceiling: NEVER exceed y = 495 so cards never collide with bottom chips/dock
  if (y + estimatedHeight / 2 > 495) {
    y = 495 - estimatedHeight / 2;
  }

  // Horizontal safety margin: 40px padding on left and right
  const minSafeX = 40 + estimatedWidth / 2;
  const maxSafeX = VIRTUAL_CANVAS_WIDTH - 40 - estimatedWidth / 2;
  x = Math.max(minSafeX, Math.min(maxSafeX, x));

  return {
    x: Math.round(x),
    y: Math.round(y),
    bounds: computeBoundingBox(x, y, estimatedWidth, estimatedHeight),
  };
}
