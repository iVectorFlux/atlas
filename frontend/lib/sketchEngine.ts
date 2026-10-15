/**
 * sketchEngine.ts — Universal Pedagogical Dynamic Scene Compiler
 *
 * Converts ANY dynamic visual scene (composed of geometric primitives,
 * teacher annotations, KaTeX formulas, or foundational elementary math models)
 * into hand-sketched digital ink strokes, KaTeX math cards, and pointer choreography.
 *
 * Architecture:
 * - Primitives layer: drawingPrimitives.ts (line, circle, ellipse, arc, dot, polygon, arrow, bracket, highlighter, checkmark, cross)
 * - Composite models layer: elementaryMathModels.ts (Array, Ten-Frame, Tape Diagram, Fraction Strip, Fraction Circle, Number Line, Right Triangle, Coordinate Graph, Circle Geometry)
 * - Compiler layer: this file (DynamicScene compiler, SVG parser, LaTeX formula cleaner)
 */

import type { Stroke, Point, CanvasObject } from "@/lib/types";
import { textToStrokes, centerStrokes, getStrokesBoundingBox } from "./handwritingEngine";
import {
  BaseSketchOptions,
  createHandDrawnLine,
  createHandDrawnCircle,
  createHandDrawnEllipse,
  createHandDrawnArc,
  createHandDrawnDot,
  createHandDrawnPolygon,
  createHandDrawnArrow,
  createHandDrawnPath,
  createHandDrawnBracket,
  createHighlighterFill,
  createHandDrawnCheckmark,
  createHandDrawnCross,
  createAnnotationStrokes,
} from "./drawingPrimitives";
import {
  createArrayModelStrokes,
  createTenFrameStrokes,
  createTapeDiagramStrokes,
  createRightTriangleStrokes,
  createFractionCircleStrokes,
  createFractionBarStrokes,
  createSlopeInterceptStrokes,
  createNumberLineStrokes,
  createCircleGeometryStrokes,
} from "./elementaryMathModels";

// Re-export all primitives and composite models for seamless backward compatibility
export type { BaseSketchOptions } from "./drawingPrimitives";
export {
  createHandDrawnLine,
  createHandDrawnCircle,
  createHandDrawnEllipse,
  createHandDrawnArc,
  createHandDrawnDot,
  createHandDrawnPolygon,
  createHandDrawnArrow,
  createHandDrawnPath,
  createHandDrawnBracket,
  createHighlighterFill,
  createHandDrawnCheckmark,
  createHandDrawnCross,
  createAnnotationStrokes,
} from "./drawingPrimitives";

export {
  createArrayModelStrokes,
  createTenFrameStrokes,
  createTapeDiagramStrokes,
  createRightTriangleStrokes,
  createFractionCircleStrokes,
  createFractionBarStrokes,
  createSlopeInterceptStrokes,
  createNumberLineStrokes,
  createCircleGeometryStrokes,
} from "./elementaryMathModels";

export type {
  ArrayModelOptions,
  TenFrameOptions,
  TapeDiagramOptions,
  RightTriangleOptions,
  FractionCircleOptions,
  FractionBarOptions,
  SlopeInterceptOptions,
  NumberLineOptions,
  CircleGeometryOptions,
} from "./elementaryMathModels";

/**
 * Clean, repair, and heal LaTeX formulas for robust KaTeX rendering:
 * 1. Recovers JSON-decoded escape control characters:
 *    - \x0c (form feed) -> \f (e.g. \x0crac -> \frac)
 *    - \x08 (backspace) -> \b (e.g. \x08eta -> \beta, \x08ar -> \bar)
 *    - \t (tab) -> \t (e.g. \times, \theta, \tau, \text)
 *    - \r (carriage return) -> \r (e.g. \rho, \right)
 * 2. Restores stripped command prefixes:
 *    - "rac{" -> "\frac{"
 * 3. Restores missing backslashes for common math keywords:
 *    - frac, sqrt, cdot, times, theta, alpha, beta, gamma, delta, pi, sigma, etc.
 * 4. Normalizes multi-escaped backslashes.
 */
export function cleanLatexFormula(raw: string): string {
  if (!raw || typeof raw !== "string") return "";
  let s = raw;

  // 1. Recover JSON escape characters where backslash was absorbed:
  s = s.replace(/\x0c/g, "\\f");
  s = s.replace(/\x08/g, "\\b");
  s = s.replace(/\t/g, "\\t");
  s = s.replace(/\r/g, "\\r");
  s = s.replace(/\n/g, " ");

  // 2. Catch stripped 'f' in \frac: e.g. bare "rac{" -> "\frac{"
  s = s.replace(/(^|[^\w\\])rac(?=\{)/g, "$1\\frac");

  // 3. Catch common LaTeX keywords missing their initial backslash:
  const keywords = [
    "frac", "sqrt", "cdot", "times", "theta", "alpha", "beta", "gamma",
    "delta", "lambda", "mu", "pi", "rho", "sigma", "tau", "phi", "omega",
    "sum", "int", "prod", "lim", "infty", "approx", "ne", "neq", "le", "leq",
    "ge", "geq", "pm", "mp", "partial", "nabla", "implies", "iff", "forall",
    "exists", "quad", "qquad", "mathbf", "mathit", "left", "right", "text", "boxed"
  ];
  for (const kw of keywords) {
    const regex = new RegExp("(^|[^\\w\\\\])" + kw + "(?=[^a-zA-Z]|$)", "g");
    s = s.replace(regex, "$1\\" + kw);
  }

  // 4. Normalize multiple backslashes (\\\\frac -> \frac)
  s = s.replace(/\\\\+/g, "\\");

  // 5. Clean trailing dangling backslashes (e.g. \text{\ or \ at end of string)
  s = s.replace(/\\+(?=\s*[\{\}]|$)/g, "");

  // 6. Auto-balance unclosed curly braces to prevent KaTeX parse errors
  let openBraces = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "{" && (i === 0 || s[i - 1] !== "\\")) {
      openBraces++;
    } else if (s[i] === "}" && (i === 0 || s[i - 1] !== "\\")) {
      if (openBraces > 0) openBraces--;
    }
  }
  while (openBraces > 0) {
    s += "}";
    openBraces--;
  }

  return s.trim();
}

// ─────────────────────────────────────────────────────────────
// UNIVERSAL DYNAMIC SCENE TYPES & PROTOCOL
// ─────────────────────────────────────────────────────────────

export interface DynamicElement {
  kind:
    | "line"
    | "arrow"
    | "circle"
    | "ellipse"
    | "rect"
    | "polygon"
    | "path"
    | "curve"
    | "arc"
    | "dot"
    | "bracket"
    | "highlight"
    | "circle_highlight"
    | "underline"
    | "checkmark"
    | "cross"
    | "cross_out"
    | "text"
    | "math"
    | "equation"
    | "axis"
    | "fraction_bar"
    | "fraction_circle"
    | "number_line"
    | "array_model"
    | "ten_frame"
    | "tape_diagram"
    | "slope_intercept"
    | "coordinate_plane"
    | "right_triangle"
    | "circle_geometry"
    | "diagram";
  type?: string;
  diagram?: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  width?: number;
  height?: number;
  cx?: number;
  cy?: number;
  r?: number;
  rx?: number;
  ry?: number;
  startAngle?: number;
  endAngle?: number;
  direction?: "top" | "bottom" | "left" | "right";
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
  from?: [number, number];
  to?: [number, number];
  points?: [number, number][];
  d?: string; // SVG path data
  color?: string;
  size?: number;
  strokeWidth?: number;
  label?: string;
  text?: string;
  latex?: string;
  fill?: boolean;
  totalParts?: number;
  shadedParts?: number;
  start?: number;
  end?: number;
  rows?: number;
  cols?: number;
  count?: number;
  addCount?: number;
  parts?: any[];
  slope?: number;
  intercept?: number;
  [key: string]: any;
}

export interface DynamicScene {
  title?: string;
  elements: DynamicElement[];
}

export interface DynamicSceneResult {
  strokes: Stroke[];
  objects: CanvasObject[];
  highlights: { target: Point; message: string }[];
}

/**
 * Universal dynamic scene compiler.
 * Converts ANY dynamic visual scene (geometry, foundational math, annotations, flows)
 * into hand-sketched digital ink strokes, KaTeX math objects, and pointer choreography!
 */
export function createDynamicSceneStrokesAndObjects(
  scene: DynamicScene,
  options: { pageId?: string; textColor?: string } = {}
): DynamicSceneResult {
  const pageId = options.pageId || "";
  const textColor = options.textColor || "#EDEDED";
  const strokes: Stroke[] = [];
  const objects: CanvasObject[] = [];
  const highlights: { target: Point; message: string }[] = [];
  const uid = Math.random().toString(36).substring(2, 7);

  // Registry of occupied text bounding boxes to prevent overlapping text labels
  const occupiedTextBoxes: { minX: number; maxX: number; minY: number; maxY: number }[] = [];

  const addTextStrokesWithCollisionAvoidance = (
    text: string,
    anchor: Point,
    opts: { color: string; size: number; strokeWidth: number; pageId: string },
    centerAroundAnchor: boolean = true
  ) => {
    let currentOpts = { ...opts };
    let raw = textToStrokes(text, anchor, currentOpts);
    if (centerAroundAnchor) {
      raw = centerStrokes(raw, anchor);
    }
    let box = getStrokesBoundingBox(raw);
    if (box.width === 0 || box.height === 0) {
      strokes.push(...raw);
      return;
    }

    // Check collision against all existing text & math boxes
    let shiftY = 0;
    let passes = 0;
    while (passes < 8) {
      let collided = false;
      const currMinY = box.minY + shiftY;
      const currMaxY = box.maxY + shiftY;
      for (const existing of occupiedTextBoxes) {
        const xOverlap = !(box.maxX < existing.minX - 6 || box.minX > existing.maxX + 6);
        const yOverlap = !(currMaxY < existing.minY - 4 || currMinY > existing.maxY + 4);
        if (xOverlap && yOverlap) {
          const existingCenterY = (existing.minY + existing.maxY) / 2;
          const isSameRow = Math.abs(anchor.y - existingCenterY) < 16;

          if (isSameRow) {
            // For items on the same row, shrink font instead of creating staircases
            if (currentOpts.size > 11) {
              const newSize = Math.max(10, Math.floor(currentOpts.size * 0.8));
              currentOpts = { ...currentOpts, size: newSize, strokeWidth: Math.max(1.3, currentOpts.strokeWidth * 0.85) };
              raw = textToStrokes(text, anchor, currentOpts);
              if (centerAroundAnchor) {
                raw = centerStrokes(raw, anchor);
              }
              box = getStrokesBoundingBox(raw);
            }
            collided = false;
            break;
          } else {
            collided = true;
            shiftY = existing.maxY + 10 - box.minY;
            break;
          }
        }
      }
      if (!collided) break;
      passes++;
    }

    if (shiftY !== 0) {
      raw = raw.map((s) => ({
        ...s,
        points: s.points.map((p) => ({ ...p, y: p.y + shiftY })),
      }));
      box.minY += shiftY;
      box.maxY += shiftY;
    }

    occupiedTextBoxes.push({ minX: box.minX, maxX: box.maxX, minY: box.minY, maxY: box.maxY });
    strokes.push(...raw);
  };

  // Optional Title at top — render as a clean topic header badge
  if (scene.title && scene.title.trim()) {
    const titleText = scene.title.trim();
    const titleEstWidth = Math.max(120, titleText.length * 11);
    occupiedTextBoxes.push({
      minX: 400 - titleEstWidth / 2 - 12,
      maxX: 400 + titleEstWidth / 2 + 12,
      minY: 15,
      maxY: 55,
    });
    objects.push({
      id: `title-${uid}`,
      page_id: pageId,
      type: "text" as any,
      x: 400,
      y: 35,
      width: titleEstWidth,
      height: 32,
      color: textColor,
      text: titleText,
    });
  }

  const registerStrokesBounds = (stk: Stroke[]) => {
    if (stk && stk.length > 0) {
      const b = getStrokesBoundingBox(stk);
      if (Number.isFinite(b.minX) && Number.isFinite(b.maxX) && Number.isFinite(b.minY) && Number.isFinite(b.maxY)) {
        occupiedTextBoxes.push({
          minX: b.minX - 12,
          maxX: b.maxX + 12,
          minY: b.minY - 12,
          maxY: b.maxY + 12,
        });
      }
    }
  };

  const toPoint = (v: any, fallbackX: number, fallbackY: number): Point => {
    if (Array.isArray(v) && v.length >= 2) return { x: v[0], y: v[1] };
    if (v && typeof v === "object" && typeof v.x === "number") return { x: v.x, y: v.y ?? fallbackY };
    return { x: fallbackX, y: fallbackY };
  };

  const elements = scene.elements || [];
  elements.forEach((elem, idx) => {
    const elemId = `dyn-${uid}-${idx}`;
    const color = elem.color || "#38BDF8";
    const strokeWidth = elem.size || elem.strokeWidth || 2.5;

    let targetPt: Point = { x: 400, y: 250 };

    const effectiveKind = (
      elem.diagram ||
      (elem.kind === "diagram" ? elem.diagram : elem.kind || elem.type)
    ) as string;

    switch (effectiveKind) {
      // ─── COMPOSITE PEDAGOGICAL MODELS ───────────────────────
      case "fraction_bar":
      case "chocolate_bar":
      case "bar_model": {
        const cx = elem.cx ?? elem.x ?? 400;
        const cy = elem.cy ?? elem.y ?? 250;
        const barStrokes = createFractionBarStrokes({
          center: { x: cx, y: cy },
          width: elem.w ?? elem.width ?? 360,
          height: elem.h ?? elem.height ?? 64,
          totalParts: elem.totalParts ?? 4,
          shadedParts: elem.shadedParts ?? 3,
          fractionLabel: elem.label || elem.text,
          color: elem.color || textColor,
          textColor,
          pageId,
        });
        strokes.push(...barStrokes);
        registerStrokesBounds(barStrokes);
        targetPt = { x: cx, y: cy };
        break;
      }

      case "fraction_circle": {
        const cx = elem.cx ?? elem.x ?? 400;
        const cy = elem.cy ?? elem.y ?? 250;
        const circleStrokes = createFractionCircleStrokes({
          center: { x: cx, y: cy },
          radius: elem.r ?? 85,
          totalParts: elem.totalParts ?? 4,
          shadedParts: elem.shadedParts ?? 3,
          fractionLabel: elem.label || elem.text,
          color: elem.color || textColor,
          textColor: "#60A5FA",
          pageId,
        });
        strokes.push(...circleStrokes);
        registerStrokesBounds(circleStrokes);
        targetPt = { x: cx, y: cy };
        break;
      }

      case "number_line": {
        const cx = elem.cx ?? elem.x ?? 400;
        const cy = elem.cy ?? elem.y ?? 250;
        const eqText = elem.equation || elem.formulaLabel || elem.text || elem.label;
        const lineStrokes = createNumberLineStrokes({
          center: { x: cx, y: cy },
          width: elem.w ?? elem.width ?? 340,
          start: elem.start ?? 0,
          end: elem.end,
          equation: eqText,
          textColor,
          pageId,
        });
        strokes.push(...lineStrokes);
        registerStrokesBounds(lineStrokes);
        targetPt = { x: cx, y: cy };
        break;
      }

      case "array_model":
      case "multiplication_array":
      case "array": {
        const cx = elem.cx ?? elem.x ?? 400;
        const cy = elem.cy ?? elem.y ?? 250;
        const arrStrokes = createArrayModelStrokes({
          center: { x: cx, y: cy },
          rows: elem.rows || 3,
          cols: elem.cols || 4,
          itemColor: elem.color || "#38BDF8",
          textColor,
          pageId,
        });
        strokes.push(...arrStrokes);
        registerStrokesBounds(arrStrokes);
        targetPt = { x: cx, y: cy };
        break;
      }

      case "ten_frame": {
        const cx = elem.cx ?? elem.x ?? 400;
        const cy = elem.cy ?? elem.y ?? 250;
        const tfStrokes = createTenFrameStrokes({
          center: { x: cx, y: cy },
          count: elem.count || 8,
          addCount: elem.addCount || 5,
          primaryColor: elem.color || "#38BDF8",
          textColor,
          pageId,
        });
        strokes.push(...tfStrokes);
        registerStrokesBounds(tfStrokes);
        targetPt = { x: cx, y: cy };
        break;
      }

      case "tape_diagram": {
        const cx = elem.cx ?? elem.x ?? 400;
        const cy = elem.cy ?? elem.y ?? 250;
        const tdStrokes = createTapeDiagramStrokes({
          center: { x: cx, y: cy },
          width: elem.w ?? elem.width ?? 360,
          parts: elem.parts,
          color: elem.color || textColor,
          textColor,
          pageId,
        });
        strokes.push(...tdStrokes);
        registerStrokesBounds(tdStrokes);
        targetPt = { x: cx, y: cy };
        break;
      }

      case "coordinate_plane":
      case "slope_intercept":
      case "linear_graph":
      case "coordinate_graph": {
        const cx = elem.cx ?? elem.x ?? 400;
        const cy = elem.cy ?? elem.y ?? 250;
        const w = elem.w ?? elem.width ?? 280;
        const h = elem.h ?? elem.height ?? 200;
        const siStrokes = createSlopeInterceptStrokes({
          center: { x: cx, y: cy },
          width: w,
          height: h,
          slope: elem.slope ?? 0.65,
          intercept: elem.intercept ?? 28,
          slopeLabel: elem.slopeLabel || "m (slope)",
          interceptLabel: elem.interceptLabel || "b (intercept)",
          formulaLabel: elem.formulaLabel || "y = mx + b",
          lineColor: elem.color || "#38BDF8",
          textColor,
          pageId,
        });
        strokes.push(...siStrokes);
        registerStrokesBounds(siStrokes);
        targetPt = { x: cx, y: cy };
        break;
      }

      case "right_triangle":
      case "triangle": {
        const cx = elem.cx ?? elem.x ?? 400;
        const cy = elem.cy ?? elem.y ?? 230;
        const w = elem.w ?? elem.width ?? 180;
        const h = elem.h ?? elem.height ?? 130;
        const triStrokes = createRightTriangleStrokes({
          origin: { x: cx - w / 2, y: cy - h / 2 },
          width: w,
          height: h,
          legALabel: elem.legALabel || "a = 3",
          legBLabel: elem.legBLabel || "b = 4",
          hypotenuseLabel: elem.hypotenuseLabel || "c = 5",
          formulaLabel: elem.formulaLabel || "a^2 + b^2 = c^2",
          color: elem.color || "#60A5FA",
          textColor,
          pageId,
        });
        strokes.push(...triStrokes);
        registerStrokesBounds(triStrokes);
        targetPt = { x: cx, y: cy };
        break;
      }

      case "circle_geometry": {
        const cx = elem.cx ?? elem.x ?? 400;
        const cy = elem.cy ?? elem.y ?? 250;
        const geomStrokes = createCircleGeometryStrokes({
          center: { x: cx, y: cy },
          radius: elem.r ?? 80,
          color: elem.color || "#60A5FA",
          textColor,
          pageId,
        });
        strokes.push(...geomStrokes);
        registerStrokesBounds(geomStrokes);
        targetPt = { x: cx, y: cy };
        break;
      }

      // ─── GEOMETRIC PRIMITIVES ──────────────────────────────
      case "circle":
      case "ellipse": {
        const cx = elem.cx ?? elem.x ?? 400;
        const cy = elem.cy ?? elem.y ?? 250;
        const rx = elem.rx ?? elem.r ?? elem.w ?? 50;
        const ry = elem.ry ?? elem.r ?? elem.h ?? rx;
        targetPt = { x: cx, y: cy };
        const circleShapeStrokes = [
          createHandDrawnEllipse({ x: cx, y: cy }, rx, ry, elemId, { color, strokeWidth, pageId }),
        ];
        strokes.push(...circleShapeStrokes);
        registerStrokesBounds(circleShapeStrokes);

        if (elem.label) {
          const lY = cy + ry + 16;
          addTextStrokesWithCollisionAvoidance(
            elem.label,
            { x: cx, y: lY },
            { color: textColor, size: 18, strokeWidth: 2, pageId },
            true
          );
        }
        break;
      }

      case "arc": {
        const cx = elem.cx ?? elem.x ?? 400;
        const cy = elem.cy ?? elem.y ?? 250;
        const r = elem.r ?? elem.w ?? 50;
        const sAngle = elem.startAngle ?? 0;
        const eAngle = elem.endAngle ?? Math.PI;
        targetPt = { x: cx, y: cy };
        const arcStroke = createHandDrawnArc({ x: cx, y: cy }, r, r, sAngle, eAngle, elemId, { color, strokeWidth, pageId });
        strokes.push(arcStroke);
        registerStrokesBounds([arcStroke]);

        if (elem.label) {
          addTextStrokesWithCollisionAvoidance(
            elem.label,
            { x: cx, y: cy - r - 12 },
            { color: textColor, size: 16, strokeWidth: 1.8, pageId },
            true
          );
        }
        break;
      }

      case "dot":
      case "point": {
        const cx = elem.cx ?? elem.x ?? 400;
        const cy = elem.cy ?? elem.y ?? 250;
        const r = elem.r ?? elem.size ?? 6;
        targetPt = { x: cx, y: cy };
        const dotStrokes = createHandDrawnDot({ x: cx, y: cy }, r, elemId, { color, strokeWidth, pageId });
        strokes.push(...dotStrokes);

        if (elem.label) {
          addTextStrokesWithCollisionAvoidance(
            elem.label,
            { x: cx, y: cy - r - 10 },
            { color: textColor, size: 15, strokeWidth: 1.6, pageId },
            true
          );
        }
        break;
      }

      case "rect": {
        const x = elem.x ?? 350;
        const y = elem.y ?? 200;
        const w = elem.w ?? elem.width ?? 100;
        const h = elem.h ?? elem.height ?? 60;
        targetPt = { x: x + w / 2, y: y + h / 2 };

        if (elem.fill) {
          strokes.push(...createHighlighterFill(x, y, w, h, `${elemId}-fill`, { color, pageId }));
        }

        const corners: Point[] = [
          { x, y },
          { x: x + w, y },
          { x: x + w, y: y + h },
          { x, y: y + h },
        ];
        const rectStrokes = createHandDrawnPolygon(corners, elemId, { color, strokeWidth, pageId });
        strokes.push(...rectStrokes);
        registerStrokesBounds(rectStrokes);

        if (elem.label) {
          if (w >= 36 && h >= 24) {
            const fitSize = Math.min(16, Math.max(10, Math.floor((w - 8) / Math.max(1, elem.label.length * 0.72))));
            const insideStrokes = textToStrokes(
              elem.label,
              { x: x + w / 2, y: y + h / 2 },
              { color: textColor, size: fitSize, strokeWidth: 1.8, pageId }
            );
            const centered = centerStrokes(insideStrokes, { x: x + w / 2, y: y + h / 2 });
            strokes.push(...centered);
            const b = getStrokesBoundingBox(centered);
            occupiedTextBoxes.push({ minX: b.minX, maxX: b.maxX, minY: b.minY, maxY: b.maxY });
          } else {
            const lY = y + h + 14;
            addTextStrokesWithCollisionAvoidance(
              elem.label,
              { x: x + w / 2, y: lY },
              { color: textColor, size: 14, strokeWidth: 1.6, pageId },
              true
            );
          }
        }
        break;
      }

      case "line": {
        const p1: Point = elem.from ? toPoint(elem.from, 300, 250) : { x: elem.x1 ?? 300, y: elem.y1 ?? 250 };
        const p2: Point = elem.to ? toPoint(elem.to, 500, 250) : { x: elem.x2 ?? 500, y: elem.y2 ?? 250 };
        targetPt = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
        strokes.push(createHandDrawnLine(p1, p2, elemId, { color, strokeWidth, pageId }));

        if (elem.label) {
          const midX = (p1.x + p2.x) / 2;
          const isHorizontal = Math.abs(p1.y - p2.y) < 10;
          const midY = isHorizontal ? Math.max(p1.y, p2.y) + 16 : (p1.y + p2.y) / 2 - 14;
          addTextStrokesWithCollisionAvoidance(
            elem.label,
            { x: midX, y: midY },
            { color: elem.color || textColor, size: 17, strokeWidth: 1.8, pageId },
            true
          );
        }
        break;
      }

      case "arrow": {
        const p1: Point = elem.from ? toPoint(elem.from, 300, 250) : { x: elem.x1 ?? 300, y: elem.y1 ?? 250 };
        const p2: Point = elem.to ? toPoint(elem.to, 500, 250) : { x: elem.x2 ?? 500, y: elem.y2 ?? 250 };
        targetPt = p2;
        strokes.push(...createHandDrawnArrow(p1, p2, elemId, { color, strokeWidth, pageId }));

        if (elem.label) {
          const midX = (p1.x + p2.x) / 2;
          const isHorizontal = Math.abs(p1.y - p2.y) < 10;
          const midY = isHorizontal ? Math.min(p1.y, p2.y) - 16 : (p1.y + p2.y) / 2 - 14;
          addTextStrokesWithCollisionAvoidance(
            elem.label,
            { x: midX, y: midY },
            { color: elem.color || textColor, size: 17, strokeWidth: 1.8, pageId },
            true
          );
        }
        break;
      }

      case "bracket": {
        const p1: Point = elem.from ? toPoint(elem.from, 300, 250) : { x: elem.x1 ?? (elem.x ?? 300), y: elem.y1 ?? (elem.y ?? 250) };
        const p2: Point = elem.to ? toPoint(elem.to, 500, 250) : { x: elem.x2 ?? ((elem.x ?? 300) + (elem.w || 120)), y: elem.y2 ?? (elem.y ?? 250) };
        const dir: "left" | "right" | "top" | "bottom" =
          elem.direction === "top" || elem.direction === "left" || elem.direction === "right"
            ? elem.direction
            : "bottom";
        strokes.push(...createHandDrawnBracket(p1, p2, dir, elemId, { color, strokeWidth, pageId }));
        targetPt = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };

        if (elem.label) {
          const offset = dir === "top" ? -18 : dir === "bottom" ? 18 : 0;
          addTextStrokesWithCollisionAvoidance(
            elem.label,
            { x: targetPt.x, y: targetPt.y + offset },
            { color: elem.color || textColor, size: 16, strokeWidth: 1.8, pageId },
            true
          );
        }
        break;
      }

      case "polygon": {
        const pts = (elem.points || []).map(([px, py]) => ({ x: px, y: py }));
        if (pts.length > 0) {
          let sumX = 0;
          let sumY = 0;
          pts.forEach((p) => {
            sumX += p.x;
            sumY += p.y;
          });
          targetPt = { x: sumX / pts.length, y: sumY / pts.length };
          strokes.push(...createHandDrawnPolygon(pts, elemId, { color, strokeWidth, pageId }));

          if (elem.label) {
            addTextStrokesWithCollisionAvoidance(
              elem.label,
              targetPt,
              { color: textColor, size: 18, strokeWidth: 2, pageId },
              true
            );
          }
        }
        break;
      }

      case "path":
      case "curve": {
        let pts: Point[] = [];
        if (elem.points && elem.points.length > 0) {
          pts = elem.points.map(([px, py]) => ({ x: px, y: py }));
        } else if (elem.d && typeof document !== "undefined") {
          try {
            const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
            p.setAttribute("d", elem.d);
            const total = p.getTotalLength();
            const count = Math.min(60, Math.max(10, Math.ceil(total / 8)));
            for (let i = 0; i <= count; i++) {
              const pt = p.getPointAtLength((i / count) * total);
              pts.push({ x: Math.round(pt.x), y: Math.round(pt.y) });
            }
          } catch {}
        }
        if (pts.length > 0) {
          targetPt = pts[Math.floor(pts.length / 2)];
          strokes.push(createHandDrawnPath(pts, elemId, { color, strokeWidth, pageId }));

          if (elem.label) {
            addTextStrokesWithCollisionAvoidance(
              elem.label,
              { x: targetPt.x, y: targetPt.y - 16 },
              { color: textColor, size: 17, strokeWidth: 1.8, pageId },
              true
            );
          }
        }
        break;
      }

      case "axis": {
        const ox = elem.x ?? 400;
        const oy = elem.y ?? 280;
        const w = elem.w ?? elem.width ?? 240;
        const h = elem.h ?? elem.height ?? 160;
        strokes.push(...createHandDrawnArrow({ x: ox - w / 2, y: oy }, { x: ox + w / 2, y: oy }, `${elemId}-xaxis`, { color: "#64748B", strokeWidth: 2, pageId }));
        strokes.push(...createHandDrawnArrow({ x: ox, y: oy + h / 2 }, { x: ox, y: oy - h / 2 }, `${elemId}-yaxis`, { color: "#64748B", strokeWidth: 2, pageId }));
        addTextStrokesWithCollisionAvoidance("x", { x: ox + w / 2 + 10, y: oy + 4 }, { color: textColor, size: 16, strokeWidth: 1.8, pageId }, false);
        addTextStrokesWithCollisionAvoidance("y", { x: ox - 4, y: oy - h / 2 - 14 }, { color: textColor, size: 16, strokeWidth: 1.8, pageId }, false);
        targetPt = { x: ox, y: oy };
        break;
      }

      // ─── TEACHER ANNOTATIONS ───────────────────────────────
      case "highlight":
      case "circle_highlight": {
        const cx = elem.cx ?? elem.x ?? 400;
        const cy = elem.cy ?? elem.y ?? 250;
        const w = elem.w ?? elem.width ?? 80;
        const h = elem.h ?? elem.height ?? 40;
        targetPt = { x: cx, y: cy };
        const annoStrokes = createAnnotationStrokes("circle_highlight", targetPt, {
          color: elem.color || "#F59E0B",
          width: w,
          height: h,
          strokeWidth,
          pageId,
        });
        strokes.push(...annoStrokes);
        break;
      }

      case "underline": {
        const cx = elem.cx ?? elem.x ?? 400;
        const cy = elem.cy ?? elem.y ?? 250;
        const w = elem.w ?? elem.width ?? 120;
        targetPt = { x: cx, y: cy };
        const annoStrokes = createAnnotationStrokes("underline", targetPt, {
          color: elem.color || "#F59E0B",
          width: w,
          strokeWidth,
          pageId,
        });
        strokes.push(...annoStrokes);
        break;
      }

      case "checkmark": {
        const cx = elem.cx ?? elem.x ?? 400;
        const cy = elem.cy ?? elem.y ?? 250;
        const s = elem.size ?? elem.w ?? 36;
        targetPt = { x: cx, y: cy };
        strokes.push(createHandDrawnCheckmark(targetPt, s, elemId, {
          color: elem.color || "#10B981",
          strokeWidth: strokeWidth || 3,
          pageId,
        }));
        break;
      }

      case "cross":
      case "cross_out": {
        const cx = elem.cx ?? elem.x ?? 400;
        const cy = elem.cy ?? elem.y ?? 250;
        const s = elem.size ?? elem.w ?? 36;
        targetPt = { x: cx, y: cy };
        strokes.push(...createHandDrawnCross(targetPt, s, elemId, {
          color: elem.color || "#EF4444",
          strokeWidth: strokeWidth || 2.8,
          pageId,
        }));
        break;
      }

      // ─── TEXT & MATH CARDS ─────────────────────────────────
      case "text": {
        const text = elem.text || elem.label || "";
        const pos = { x: elem.x ?? 400, y: elem.y ?? 250 };
        targetPt = pos;
        if (text) {
          const fontSize = Math.min(elem.size || 15, 18);
          const fontStrokeWidth = Math.min(elem.strokeWidth || 1.6, 2.0);
          addTextStrokesWithCollisionAvoidance(
            text,
            pos,
            { color: elem.color || textColor, size: fontSize, strokeWidth: fontStrokeWidth, pageId },
            true
          );
        }
        break;
      }

      case "math":
      case "equation": {
        const rawLatex = elem.latex || elem.text || "";
        const latex = cleanLatexFormula(rawLatex);
        const posX = elem.x ?? 400;
        let posY = elem.y ?? 95;

        if (scene.title && posY < 95) {
          posY = 95;
        }

        if (posY >= 140 && posY <= 325) {
          posY = 345;
        }

        const mathHalfW = 90;
        const mathHalfH = 24;
        let passes = 0;
        while (passes < 6) {
          let collided = false;
          for (const box of occupiedTextBoxes) {
            const xOverlap = !(posX + mathHalfW < box.minX - 10 || posX - mathHalfW > box.maxX + 10);
            const yOverlap = !((posY + mathHalfH) < box.minY - 8 || (posY - mathHalfH) > box.maxY + 8);
            if (xOverlap && yOverlap) {
              collided = true;
              posY = box.maxY + mathHalfH + 16;
              break;
            }
          }
          if (!collided) break;
          passes++;
        }

        if (posY >= 140 && posY <= 325) {
          posY = 345;
        }

        // Hard action-chip clearance ceiling
        posY = Math.min(355, posY);
        targetPt = { x: posX, y: posY };

        if (latex) {
          occupiedTextBoxes.push({
            minX: posX - mathHalfW,
            maxX: posX + mathHalfW,
            minY: posY - mathHalfH,
            maxY: posY + mathHalfH,
          });

          objects.push({
            id: `math-${uid}-${idx}`,
            page_id: pageId,
            type: "math",
            x: posX,
            y: posY,
            width: 170,
            height: 50,
            color: elem.color || textColor,
            latex,
          });
        }
        break;
      }
    }

    if (elem.label) {
      highlights.push({ target: targetPt, message: elem.label });
    }
  });

  return { strokes, objects, highlights };
}

/**
 * Parses raw SVG string into DynamicElement array so the AI can output
 * native SVG diagrams which turn into hand-drawn whiteboard ink.
 */
export function parseSvgToDynamicElements(svgString: string): DynamicElement[] {
  const elements: DynamicElement[] = [];
  if (!svgString || typeof svgString !== "string") return elements;

  // Circles
  const circleRegex = /<circle\b([^>]*)\/?>/gi;
  let match;
  while ((match = circleRegex.exec(svgString)) !== null) {
    const attrs = match[1];
    const cx = parseFloat(attrs.match(/cx=["']([^"']+)["']/i)?.[1] || "400");
    const cy = parseFloat(attrs.match(/cy=["']([^"']+)["']/i)?.[1] || "250");
    const r = parseFloat(attrs.match(/r=["']([^"']+)["']/i)?.[1] || "40");
    const color = attrs.match(/stroke=["']([^"']+)["']/i)?.[1] || attrs.match(/fill=["']([^"']+)["']/i)?.[1] || "#38BDF8";
    elements.push({ kind: "circle", cx, cy, r, color });
  }

  // Ellipses
  const ellipseRegex = /<ellipse\b([^>]*)\/?>/gi;
  while ((match = ellipseRegex.exec(svgString)) !== null) {
    const attrs = match[1];
    const cx = parseFloat(attrs.match(/cx=["']([^"']+)["']/i)?.[1] || "400");
    const cy = parseFloat(attrs.match(/cy=["']([^"']+)["']/i)?.[1] || "250");
    const rx = parseFloat(attrs.match(/rx=["']([^"']+)["']/i)?.[1] || "50");
    const ry = parseFloat(attrs.match(/ry=["']([^"']+)["']/i)?.[1] || "30");
    const color = attrs.match(/stroke=["']([^"']+)["']/i)?.[1] || "#38BDF8";
    elements.push({ kind: "ellipse", cx, cy, rx, ry, color });
  }

  // Rects
  const rectRegex = /<rect\b([^>]*)\/?>/gi;
  while ((match = rectRegex.exec(svgString)) !== null) {
    const attrs = match[1];
    const x = parseFloat(attrs.match(/x=["']([^"']+)["']/i)?.[1] || "350");
    const y = parseFloat(attrs.match(/y=["']([^"']+)["']/i)?.[1] || "200");
    const w = parseFloat(attrs.match(/width=["']([^"']+)["']/i)?.[1] || "100");
    const h = parseFloat(attrs.match(/height=["']([^"']+)["']/i)?.[1] || "60");
    const color = attrs.match(/stroke=["']([^"']+)["']/i)?.[1] || "#10B981";
    elements.push({ kind: "rect", x, y, w, h, color });
  }

  // Lines
  const lineRegex = /<line\b([^>]*)\/?>/gi;
  while ((match = lineRegex.exec(svgString)) !== null) {
    const attrs = match[1];
    const x1 = parseFloat(attrs.match(/x1=["']([^"']+)["']/i)?.[1] || "300");
    const y1 = parseFloat(attrs.match(/y1=["']([^"']+)["']/i)?.[1] || "250");
    const x2 = parseFloat(attrs.match(/x2=["']([^"']+)["']/i)?.[1] || "500");
    const y2 = parseFloat(attrs.match(/y2=["']([^"']+)["']/i)?.[1] || "250");
    const color = attrs.match(/stroke=["']([^"']+)["']/i)?.[1] || "#EDEDED";
    elements.push({ kind: "line", x1, y1, x2, y2, color });
  }

  // Paths
  const pathRegex = /<path\b([^>]*)\/?>/gi;
  while ((match = pathRegex.exec(svgString)) !== null) {
    const attrs = match[1];
    const d = attrs.match(/d=["']([^"']+)["']/i)?.[1] || "";
    const color = attrs.match(/stroke=["']([^"']+)["']/i)?.[1] || "#EC4899";
    if (d) {
      elements.push({ kind: "path", d, color });
    }
  }

  // Polygons
  const polyRegex = /<polygon\b([^>]*)\/?>/gi;
  while ((match = polyRegex.exec(svgString)) !== null) {
    const attrs = match[1];
    const ptsRaw = attrs.match(/points=["']([^"']+)["']/i)?.[1] || "";
    const color = attrs.match(/stroke=["']([^"']+)["']/i)?.[1] || "#38BDF8";
    if (ptsRaw) {
      const coords = ptsRaw.trim().split(/[\s,]+/).map(Number);
      const points: [number, number][] = [];
      for (let i = 0; i < coords.length - 1; i += 2) {
        if (!isNaN(coords[i]) && !isNaN(coords[i + 1])) {
          points.push([coords[i], coords[i + 1]]);
        }
      }
      if (points.length >= 3) {
        elements.push({ kind: "polygon", points, color });
      }
    }
  }

  // Text
  const textRegex = /<text\b([^>]*)>(.*?)<\/text>/gi;
  while ((match = textRegex.exec(svgString)) !== null) {
    const attrs = match[1];
    const content = match[2].trim();
    const x = parseFloat(attrs.match(/x=["']([^"']+)["']/i)?.[1] || "400");
    const y = parseFloat(attrs.match(/y=["']([^"']+)["']/i)?.[1] || "250");
    const color = attrs.match(/fill=["']([^"']+)["']/i)?.[1] || attrs.match(/stroke=["']([^"']+)["']/i)?.[1] || "#EDEDED";
    elements.push({ kind: "text", x, y, text: content, color });
  }

  return elements;
}
