/**
 * sketchEngine.ts — Parametric Mathematical & Scientific Diagram Sketcher
 *
 * Generates mathematically rigorous, authentic hand-sketched digital ink strokes
 * for whiteboard teaching diagrams. Zero DOM widgets, zero KaTeX cards.
 *
 * Diagram Types:
 * 1. Right-Angled Triangle (Pythagorean theorem, exact perpendicularity, 90° symbol, side labels)
 * 2. Fraction Circle (halves, quarters, shaded hatching, handwritten fractional values)
 * 3. Bohr Atom Model (nucleus, protons/neutrons, electron shells, orbiting electrons)
 * 4. Coordinate Axes (Cartesian plane with arrows, tick marks, and axis labels)
 * 5. Teacher Annotations (scribble highlight loops, arrows, underlines)
 */

import type { Stroke, Point, CanvasObject } from "@/lib/types";
import { textToStrokes, centerStrokes, getStrokesBoundingBox } from "./handwritingEngine";
import {
  createArrayModelStrokes,
  createTenFrameStrokes,
  createTapeDiagramStrokes,
} from "./elementaryMathModels";

export interface BaseSketchOptions {
  color?: string;
  strokeWidth?: number;
  pageId?: string;
}

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
    // Micro-eccentricity and hand wobble
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

// ─────────────────────────────────────────────────────────────
// 1. RIGHT-ANGLED TRIANGLE SKETCH GENERATOR
// ─────────────────────────────────────────────────────────────

export interface RightTriangleOptions extends BaseSketchOptions {
  origin?: Point;
  width?: number; // Base leg b length (px)
  height?: number; // Vertical leg a length (px)
  legALabel?: string; // e.g. "a = 3"
  legBLabel?: string; // e.g. "b = 4"
  hypotenuseLabel?: string; // e.g. "c = 5"
  formulaLabel?: string; // e.g. "a^2 + b^2 = c^2"
  accentColor?: string;
  textColor?: string;
}

export function createRightTriangleStrokes(options: RightTriangleOptions = {}): Stroke[] {
  const origin = options.origin || { x: 400, y: 220 };
  const w = options.width || 180;
  const h = options.height || 140;
  const mainColor = options.color || "#60A5FA";
  const textColor = options.textColor || "#EDEDED";
  const strokeWidth = options.strokeWidth || 2.8;
  const pageId = options.pageId || "";

  // Vertex coordinates:
  // V0: Right-angle corner (bottom-left)
  // V1: Top vertex
  // V2: Right vertex (bottom-right)
  const v0: Point = { x: origin.x, y: origin.y + h };
  const v1: Point = { x: origin.x, y: origin.y };
  const v2: Point = { x: origin.x + w, y: origin.y + h };

  const strokes: Stroke[] = [];
  const uid = Date.now().toString(36);

  // 1. Vertical leg a (top to corner)
  strokes.push(
    createHandDrawnLine(v1, v0, `tri-leg-a-${uid}`, {
      color: mainColor,
      strokeWidth,
      pageId,
    })
  );

  // 2. Horizontal base leg b (corner to right)
  strokes.push(
    createHandDrawnLine(v0, v2, `tri-leg-b-${uid}`, {
      color: mainColor,
      strokeWidth,
      pageId,
    })
  );

  // 3. Hypotenuse c (right back to top)
  strokes.push(
    createHandDrawnLine(v2, v1, `tri-hypo-${uid}`, {
      color: mainColor,
      strokeWidth: strokeWidth * 1.1,
      pageId,
    })
  );

  // 4. Right-Angle Square Marker (exact 90° corner square)
  const s = 16;
  const cornerPt1: Point = { x: v0.x, y: v0.y - s };
  const cornerPt2: Point = { x: v0.x + s, y: v0.y - s };
  const cornerPt3: Point = { x: v0.x + s, y: v0.y };

  strokes.push({
    id: `tri-corner-${uid}`,
    page_id: pageId,
    tool: "pen",
    color: "#A1A1AA",
    size: 2,
    points: [cornerPt1, cornerPt2, cornerPt3],
  });

  // 5. Handwritten Side Labels
  // Label a (left of vertical leg: right-aligned 16px to left of v0.x)
  if (options.legALabel !== undefined ? options.legALabel : true) {
    const textA = options.legALabel || "a = 3";
    const rawAStrokes = textToStrokes(
      textA,
      { x: 0, y: 0 },
      { color: textColor, size: 24, strokeWidth: 2.2, pageId }
    );
    const boxA = getStrokesBoundingBox(rawAStrokes);
    const dxA = (v0.x - 16) - boxA.maxX;
    const dyA = (origin.y + h / 2) - boxA.centerY;
    const labelAStrokes = rawAStrokes.map((s) => ({
      ...s,
      points: s.points.map((p) => ({ x: p.x + dxA, y: p.y + dyA })),
    }));
    strokes.push(...labelAStrokes);
  }

  // Label b (below horizontal leg: centered horizontally under base)
  if (options.legBLabel !== undefined ? options.legBLabel : true) {
    const textB = options.legBLabel || "b = 4";
    const rawBStrokes = textToStrokes(
      textB,
      { x: 0, y: 0 },
      { color: textColor, size: 24, strokeWidth: 2.2, pageId }
    );
    const boxB = getStrokesBoundingBox(rawBStrokes);
    const dxB = (origin.x + w / 2) - boxB.centerX;
    const dyB = (v0.y + 14) - boxB.minY;
    const labelBStrokes = rawBStrokes.map((s) => ({
      ...s,
      points: s.points.map((p) => ({ x: p.x + dxB, y: p.y + dyB })),
    }));
    strokes.push(...labelBStrokes);
  }

  // Label c (hypotenuse: perpendicular outward offset)
  if (options.hypotenuseLabel !== undefined ? options.hypotenuseLabel : true) {
    const textC = options.hypotenuseLabel || "c = 5";
    const rawCStrokes = textToStrokes(
      textC,
      { x: 0, y: 0 },
      { color: mainColor, size: 26, strokeWidth: 2.4, pageId }
    );
    const boxC = getStrokesBoundingBox(rawCStrokes);
    const hypLen = Math.hypot(w, h);
    const normX = h / hypLen;
    const normY = -w / hypLen;
    const targetX = (origin.x + w / 2) + normX * 24;
    const targetY = (origin.y + h / 2) + normY * 24;
    const dxC = targetX - boxC.centerX;
    const dyC = targetY - boxC.centerY;
    const labelCStrokes = rawCStrokes.map((s) => ({
      ...s,
      points: s.points.map((p) => ({ x: p.x + dxC, y: p.y + dyC })),
    }));
    strokes.push(...labelCStrokes);
  }

  // Formula is cleanly rendered as native KaTeX above the diagram in page.tsx
  return strokes;
}

// ─────────────────────────────────────────────────────────────
// 2. FRACTION CIRCLE SKETCH GENERATOR
// ─────────────────────────────────────────────────────────────

export interface FractionCircleOptions extends BaseSketchOptions {
  center?: Point;
  radius?: number;
  totalParts?: number;
  shadedParts?: number;
  textColor?: string;
  fractionLabel?: string;
}

export function createFractionCircleStrokes(options: FractionCircleOptions = {}): Stroke[] {
  const center = options.center || { x: 400, y: 260 };
  const r = options.radius || 85;
  const circleColor = options.color || "#EDEDED";
  const textColor = options.textColor || "#60A5FA";
  const pageId = options.pageId || "";
  const uid = Date.now().toString(36);
  const totalParts = options.totalParts || (options.fractionLabel?.includes("4") ? 4 : 2);
  const shadedParts = options.shadedParts !== undefined ? options.shadedParts : (totalParts === 4 ? 3 : 1);

  const strokes: Stroke[] = [];

  // 1. Outer circle
  strokes.push(
    createHandDrawnCircle(center, r, `frac-circle-${uid}`, {
      color: circleColor,
      strokeWidth: 2.8,
      pageId,
    })
  );

  // 2. Division lines
  // Vertical line dividing into halves
  strokes.push(
    createHandDrawnLine(
      { x: center.x, y: center.y - r },
      { x: center.x, y: center.y + r },
      `frac-div-v-${uid}`,
      { color: "#A1A1AA", strokeWidth: 2.2, pageId }
    )
  );

  if (totalParts === 4) {
    // Horizontal line dividing into quarters
    strokes.push(
      createHandDrawnLine(
        { x: center.x - r, y: center.y },
        { x: center.x + r, y: center.y },
        `frac-div-h-${uid}`,
        { color: "#A1A1AA", strokeWidth: 2.2, pageId }
      )
    );
  }

  // 3. Shading strokes (lush, dense highlighter fill for shaded partitions)
  if (totalParts === 2 && shadedParts > 0) {
    const hatchCount = 18;
    for (let i = 1; i < hatchCount; i++) {
      const yOffset = -r * 0.92 + (i / hatchCount) * (r * 1.84);
      const halfWidth = Math.sqrt(Math.max(0, r * r - yOffset * yOffset));
      const p1: Point = { x: center.x - halfWidth * 0.94, y: center.y + yOffset };
      const p2: Point = { x: center.x - 2, y: center.y + yOffset };

      strokes.push({
        id: `hatch-${uid}-${i}`,
        page_id: pageId,
        tool: "highlighter",
        color: "#38BDF8",
        size: 14,
        points: [p1, p2],
      });
    }
  } else if (totalParts === 4 && shadedParts > 0) {
    // Quadrants: 0 = Top-Left, 1 = Bottom-Left, 2 = Top-Right, 3 = Bottom-Right
    const quadrantIndices = [0, 1, 2, 3].slice(0, Math.min(4, shadedParts));
    for (const q of quadrantIndices) {
      const isTop = q === 0 || q === 2;
      const isLeft = q === 0 || q === 1;
      const hatchLines = 10;
      for (let i = 1; i < hatchLines; i++) {
        const factor = i / hatchLines;
        const yOffset = (isTop ? -1 : 1) * factor * r * 0.90;
        const xOffset = Math.sqrt(Math.max(0, r * r - yOffset * yOffset)) * 0.92;
        const p1: Point = {
          x: isLeft ? center.x - xOffset : center.x + 3,
          y: center.y + yOffset,
        };
        const p2: Point = {
          x: isLeft ? center.x - 3 : center.x + xOffset,
          y: center.y + yOffset,
        };
        strokes.push({
          id: `hatch-q${q}-${uid}-${i}`,
          page_id: pageId,
          tool: "highlighter",
          color: "#38BDF8",
          size: 12,
          points: [p1, p2],
        });
      }
    }
  }

  // 4. Handwritten stacked fraction values inside partitions (pure KaTeX math style)
  if (totalParts === 2) {
    // Left half: 1/2 (shaded partition)
    const rawLeft = textToStrokes(
      "\\frac{1}{2}",
      { x: 0, y: 0 },
      { color: textColor, size: 22, strokeWidth: 2.2, pageId }
    );
    const leftFrac = centerStrokes(rawLeft, { x: center.x - r * 0.48, y: center.y });

    // Right half: 1/2 (unshaded partition)
    const rawRight = textToStrokes(
      "\\frac{1}{2}",
      { x: 0, y: 0 },
      { color: circleColor, size: 22, strokeWidth: 2.2, pageId }
    );
    const rightFrac = centerStrokes(rawRight, { x: center.x + r * 0.48, y: center.y });

    strokes.push(...leftFrac, ...rightFrac);
  } else if (totalParts === 4) {
    // Top-Left: 1/4
    const q0 = textToStrokes("\\frac{1}{4}", { x: 0, y: 0 }, { color: 0 < shadedParts ? textColor : "#94A3B8", size: 18, strokeWidth: 2, pageId });
    // Bottom-Left: 1/4
    const q1 = textToStrokes("\\frac{1}{4}", { x: 0, y: 0 }, { color: 1 < shadedParts ? textColor : "#94A3B8", size: 18, strokeWidth: 2, pageId });
    // Top-Right: 1/4
    const q2 = textToStrokes("\\frac{1}{4}", { x: 0, y: 0 }, { color: 2 < shadedParts ? textColor : "#94A3B8", size: 18, strokeWidth: 2, pageId });
    // Bottom-Right: 1/4
    const q3 = textToStrokes("\\frac{1}{4}", { x: 0, y: 0 }, { color: 3 < shadedParts ? textColor : "#94A3B8", size: 18, strokeWidth: 2, pageId });

    strokes.push(
      ...centerStrokes(q0, { x: center.x - r * 0.46, y: center.y - r * 0.46 }),
      ...centerStrokes(q1, { x: center.x - r * 0.46, y: center.y + r * 0.46 }),
      ...centerStrokes(q2, { x: center.x + r * 0.46, y: center.y - r * 0.46 }),
      ...centerStrokes(q3, { x: center.x + r * 0.46, y: center.y + r * 0.46 })
    );
  }

  return strokes;
}

// ─────────────────────────────────────────────────────────────
// 2B. FRACTION BAR / CHOCOLATE STRIP SKETCH GENERATOR
// ─────────────────────────────────────────────────────────────

export interface FractionBarOptions extends BaseSketchOptions {
  center?: Point;
  width?: number;
  height?: number;
  totalParts?: number;
  shadedParts?: number;
  textColor?: string;
  highlightColor?: string;
  fractionLabel?: string;
  showPartLabels?: boolean;
}

export function createFractionBarStrokes(options: FractionBarOptions = {}): Stroke[] {
  const center = options.center || { x: 400, y: 250 };
  const w = options.width || 360;
  const h = options.height || 64;
  const totalParts = Math.max(1, options.totalParts || 4);
  const shadedParts = Math.min(totalParts, Math.max(0, options.shadedParts ?? 3));
  const barColor = options.color || "#EDEDED";
  const shadeColor = options.highlightColor || "#38BDF8";
  const textColor = options.textColor || "#EDEDED";
  const pageId = options.pageId || "";
  const uid = Date.now().toString(36);

  const strokes: Stroke[] = [];

  const left = center.x - w / 2;
  const top = center.y - h / 2;
  const partWidth = w / totalParts;

  // 1. Outer rectangular border (hand-drawn)
  const outerCorners: Point[] = [
    { x: left, y: top },
    { x: left + w, y: top },
    { x: left + w, y: top + h },
    { x: left, y: top + h },
  ];
  strokes.push(...createHandDrawnPolygon(outerCorners, `frac-bar-box-${uid}`, {
    color: barColor,
    strokeWidth: 2.5,
    pageId,
  }));

  // 2. Division lines between partitions
  for (let i = 1; i < totalParts; i++) {
    const divX = left + i * partWidth;
    strokes.push(
      createHandDrawnLine(
        { x: divX, y: top },
        { x: divX, y: top + h },
        `frac-bar-div-${uid}-${i}`,
        { color: "#A1A1AA", strokeWidth: 2.0, pageId }
      )
    );
  }

  // 3. Shading strokes across the shaded partitions (using highlighter tool)
  for (let p = 0; p < shadedParts; p++) {
    const pLeft = left + p * partWidth;
    const hatchCount = Math.max(3, Math.floor(partWidth / 12));
    for (let k = 1; k <= hatchCount; k++) {
      const hX = pLeft + (k / (hatchCount + 1)) * partWidth;
      strokes.push({
        id: `frac-bar-shade-${uid}-${p}-${k}`,
        page_id: pageId,
        tool: "highlighter",
        color: shadeColor,
        size: 5,
        points: [
          { x: hX, y: top + 4 },
          { x: hX, y: top + h - 4 },
        ],
      });
    }
  }

  // 4. Centered label in each partition: e.g. "1/4"
  if (options.showPartLabels !== false) {
    const partLabel = `1/${totalParts}`;
    const fontSize = Math.min(16, Math.max(11, Math.floor((partWidth - 6) / 3.2)));
    for (let p = 0; p < totalParts; p++) {
      const segCenterX = left + (p + 0.5) * partWidth;
      const segCenterY = center.y;
      const isShaded = p < shadedParts;
      const partStrokes = textToStrokes(
        partLabel,
        { x: segCenterX, y: segCenterY },
        {
          color: isShaded ? (options.color ? textColor : "#38BDF8") : "#94A3B8",
          size: fontSize,
          strokeWidth: 1.8,
          pageId,
        }
      );
      strokes.push(...centerStrokes(partStrokes, { x: segCenterX, y: segCenterY }));
    }
  }

  // 5. Clean bracket below shaded parts
  if (shadedParts > 0) {
    const shadedW = shadedParts * partWidth;
    const bracketY = top + h + 16;
    // Horizontal span line
    strokes.push(
      createHandDrawnLine(
        { x: left + 2, y: bracketY },
        { x: left + shadedW - 2, y: bracketY },
        `frac-bar-bracket-span-${uid}`,
        { color: shadeColor, strokeWidth: 1.8, pageId }
      )
    );
    // Left tick
    strokes.push(
      createHandDrawnLine(
        { x: left + 2, y: bracketY - 6 },
        { x: left + 2, y: bracketY + 4 },
        `frac-bar-bracket-left-${uid}`,
        { color: shadeColor, strokeWidth: 1.8, pageId }
      )
    );
    // Right tick
    strokes.push(
      createHandDrawnLine(
        { x: left + shadedW - 2, y: bracketY - 6 },
        { x: left + shadedW - 2, y: bracketY + 4 },
        `frac-bar-bracket-right-${uid}`,
        { color: shadeColor, strokeWidth: 1.8, pageId }
      )
    );
    // Fraction label under bracket: e.g. "3/4"
    const bracketText = options.fractionLabel ? options.fractionLabel.replace(/[\$\\]/g, "") : `${shadedParts}/${totalParts}`;
    const labelStrokes = textToStrokes(
      bracketText,
      { x: left + shadedW / 2, y: bracketY + 16 },
      { color: shadeColor, size: 16, strokeWidth: 1.8, pageId }
    );
    strokes.push(...centerStrokes(labelStrokes, { x: left + shadedW / 2, y: bracketY + 16 }));
  }

  return strokes;
}

// ─────────────────────────────────────────────────────────────
// 3. BOHR ATOM MODEL SKETCH GENERATOR
// ─────────────────────────────────────────────────────────────

export interface AtomModelOptions extends BaseSketchOptions {
  center?: Point;
  nucleusRadius?: number;
  orbitRadius?: number;
  elementName?: string;
}

export function createAtomModelStrokes(options: AtomModelOptions = {}): Stroke[] {
  const center = options.center || { x: 400, y: 260 };
  const rNuc = options.nucleusRadius || 26;
  const rOrbit = options.orbitRadius || 80;
  const pageId = options.pageId || "";
  const uid = Date.now().toString(36);

  const strokes: Stroke[] = [];

  // Title: "Atom Model"
  const title = textToStrokes(
    options.elementName ? `${options.elementName} Atom` : "Atom Model",
    { x: center.x - 75, y: center.y - rOrbit - 40 },
    { color: "#60A5FA", size: 28, strokeWidth: 2.5, pageId }
  );
  strokes.push(...title);

  // 1. Electron Orbit Shell (large hand-drawn circle)
  strokes.push(
    createHandDrawnCircle(center, rOrbit, `orbit-${uid}`, {
      color: "#71717A",
      strokeWidth: 1.8,
      pageId,
    })
  );

  // 2. Nucleus (central circle filled with protons)
  strokes.push(
    createHandDrawnCircle(center, rNuc, `nucleus-${uid}`, {
      color: "#EF4444",
      strokeWidth: 2.5,
      pageId,
    })
  );

  // Nucleus label (+)
  const nucPlus = textToStrokes(
    "+",
    { x: center.x - 7, y: center.y - 12 },
    { color: "#EF4444", size: 22, strokeWidth: 2.4, pageId }
  );
  strokes.push(...nucPlus);

  // "Nucleus (+)" text label
  const nucLabel = textToStrokes(
    "Nucleus",
    { x: center.x - 30, y: center.y + rNuc + 14 },
    { color: "#EDEDED", size: 18, strokeWidth: 2, pageId }
  );
  strokes.push(...nucLabel);

  // 3. Electrons orbiting
  const e1Pos: Point = { x: center.x, y: center.y - rOrbit };
  const e2Pos: Point = { x: center.x, y: center.y + rOrbit };

  // Electron dots
  strokes.push(
    createHandDrawnCircle(e1Pos, 6, `e1-dot-${uid}`, {
      color: "#60A5FA",
      strokeWidth: 3,
      pageId,
    }),
    createHandDrawnCircle(e2Pos, 6, `e2-dot-${uid}`, {
      color: "#60A5FA",
      strokeWidth: 3,
      pageId,
    })
  );

  // Electron labels (-)
  const e1Label = textToStrokes(
    "e^-",
    { x: e1Pos.x + 10, y: e1Pos.y - 10 },
    { color: "#60A5FA", size: 18, strokeWidth: 2, pageId }
  );
  const e2Label = textToStrokes(
    "e^-",
    { x: e2Pos.x + 10, y: e2Pos.y - 10 },
    { color: "#60A5FA", size: 18, strokeWidth: 2, pageId }
  );
  strokes.push(...e1Label, ...e2Label);

  return strokes;
}

// ─────────────────────────────────────────────────────────────
// 4. TEACHER ANNOTATION STROKE GENERATOR
// ─────────────────────────────────────────────────────────────

export function createAnnotationStrokes(
  type: "circle_highlight" | "arrow" | "underline",
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

    // Arrowhead barb 1 & 2
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

  return [];
}

// ─────────────────────────────────────────────────────────────
// 5. SLOPE-INTERCEPT & LINEAR GRAPH GENERATOR
// ─────────────────────────────────────────────────────────────

export interface SlopeInterceptOptions extends BaseSketchOptions {
  center?: Point;
  width?: number; // Total width of axes
  height?: number; // Total height of axes
  slope?: number; // dy / dx, e.g. 0.65
  intercept?: number; // px above origin, e.g. 28
  slopeLabel?: string;
  interceptLabel?: string;
  formulaLabel?: string;
  lineColor?: string;
  textColor?: string;
}

export function createSlopeInterceptStrokes(options: SlopeInterceptOptions = {}): Stroke[] {
  const center = options.center || { x: 400, y: 260 };
  const w = options.width || 340;
  const h = options.height || 220;
  const lineColor = options.lineColor || "#38BDF8"; // Vibrant sky blue line
  const textColor = options.textColor || "#EDEDED";
  const axisColor = "#71717A"; // Crisp muted axis gray
  const interceptColor = "#F59E0B"; // Amber intercept point
  const slopeColor = "#10B981"; // Emerald slope triangle
  const pageId = options.pageId || "";
  const uid = Date.now().toString(36);

  const strokes: Stroke[] = [];

  // Formula is cleanly rendered as native KaTeX above the graph in page.tsx

  // 1. Horizontal X-Axis
  const xLeft: Point = { x: center.x - w / 2, y: center.y };
  const xRight: Point = { x: center.x + w / 2, y: center.y };
  strokes.push(
    createHandDrawnLine(xLeft, xRight, `axis-x-${uid}`, { color: axisColor, strokeWidth: 2, pageId })
  );
  // X-axis arrow >
  strokes.push({
    id: `axis-x-arrow-${uid}`,
    page_id: pageId,
    tool: "pen",
    color: axisColor,
    size: 2,
    points: [
      { x: xRight.x - 10, y: xRight.y - 6 },
      { x: xRight.x, y: xRight.y },
      { x: xRight.x - 10, y: xRight.y + 6 },
    ],
  });
  // X-axis label "x"
  const xLabel = textToStrokes("x", { x: xRight.x + 8, y: xRight.y - 8 }, { color: axisColor, size: 16, strokeWidth: 1.8, pageId });
  strokes.push(...xLabel);

  // 2. Vertical Y-Axis
  const yBottom: Point = { x: center.x, y: center.y + h / 2 };
  const yTop: Point = { x: center.x, y: center.y - h / 2 };
  strokes.push(
    createHandDrawnLine(yBottom, yTop, `axis-y-${uid}`, { color: axisColor, strokeWidth: 2, pageId })
  );
  // Y-axis arrow ^
  strokes.push({
    id: `axis-y-arrow-${uid}`,
    page_id: pageId,
    tool: "pen",
    color: axisColor,
    size: 2,
    points: [
      { x: yTop.x - 6, y: yTop.y + 10 },
      { x: yTop.x, y: yTop.y },
      { x: yTop.x + 6, y: yTop.y + 10 },
    ],
  });
  // Y-axis label "y"
  const yLabel = textToStrokes("y", { x: yTop.x + 10, y: yTop.y - 6 }, { color: axisColor, size: 16, strokeWidth: 1.8, pageId });
  strokes.push(...yLabel);

  // 3. Axis Ticks
  const tickSize = 4;
  for (let offset = -w / 2 + 35; offset <= w / 2 - 35; offset += 45) {
    if (Math.abs(offset) > 10) {
      strokes.push(
        createHandDrawnLine(
          { x: center.x + offset, y: center.y - tickSize },
          { x: center.x + offset, y: center.y + tickSize },
          `tick-x-${uid}-${offset}`,
          { color: "#52525B", strokeWidth: 1.5, pageId }
        )
      );
    }
  }
  for (let offset = -h / 2 + 30; offset <= h / 2 - 30; offset += 45) {
    if (Math.abs(offset) > 10) {
      strokes.push(
        createHandDrawnLine(
          { x: center.x - tickSize, y: center.y + offset },
          { x: center.x + tickSize, y: center.y + offset },
          `tick-y-${uid}-${offset}`,
          { color: "#52525B", strokeWidth: 1.5, pageId }
        )
      );
    }
  }

  // 4. Plotted Line (y = mx + b)
  const m = options.slope || 0.65;
  const bPx = options.intercept !== undefined ? options.intercept : 28;
  const lineP1: Point = { x: center.x - 120, y: (center.y - bPx) + 120 * m };
  const lineP2: Point = { x: center.x + 130, y: (center.y - bPx) - 130 * m };
  strokes.push(
    createHandDrawnLine(lineP1, lineP2, `plot-line-${uid}`, { color: lineColor, strokeWidth: 3.2, pageId }, 0.4)
  );

  // 5. Y-Intercept Point (0, b)
  const interceptPt: Point = { x: center.x, y: center.y - bPx };
  strokes.push(
    createHandDrawnCircle(interceptPt, 5, `pt-intercept-${uid}`, {
      color: interceptColor,
      strokeWidth: 3.5,
      pageId,
    })
  );
  // Intercept label: "b (y-intercept)" with clean clearance left of y-axis
  const bLabel = textToStrokes(
    options.interceptLabel || "b (y-intercept)",
    { x: center.x - 110, y: interceptPt.y - 10 },
    { color: interceptColor, size: 14, strokeWidth: 1.6, pageId }
  );
  strokes.push(...bLabel);
  // Pointer arrow to intercept point
  strokes.push(
    createHandDrawnLine(
      { x: center.x - 18, y: interceptPt.y - 4 },
      { x: center.x - 6, y: interceptPt.y },
      `arrow-intercept-${uid}`,
      { color: interceptColor, strokeWidth: 1.6, pageId }
    )
  );

  // 6. Slope Triangle ("Rise over Run") — spaced comfortably away from axis
  const x1 = center.x + 25;
  const y1 = (center.y - bPx) - 25 * m;
  const x2 = center.x + 95;
  const y2 = (center.y - bPx) - 95 * m;

  // Run leg (horizontal)
  strokes.push(
    createHandDrawnLine(
      { x: x1, y: y1 },
      { x: x2, y: y1 },
      `slope-run-${uid}`,
      { color: slopeColor, strokeWidth: 2.2, pageId }
    )
  );
  // Rise leg (vertical)
  strokes.push(
    createHandDrawnLine(
      { x: x2, y: y1 },
      { x: x2, y: y2 },
      `slope-rise-${uid}`,
      { color: "#EF4444", strokeWidth: 2.2, pageId }
    )
  );
  // Right angle marker for slope triangle
  const sq = 7;
  strokes.push({
    id: `slope-sq-${uid}`,
    page_id: pageId,
    tool: "pen",
    color: "#71717A",
    size: 1.5,
    points: [
      { x: x2 - sq, y: y1 },
      { x: x2 - sq, y: y1 - (y1 > y2 ? sq : -sq) },
      { x: x2, y: y1 - (y1 > y2 ? sq : -sq) },
    ],
  });

  // Label "run" comfortably below horizontal leg
  const runLabel = textToStrokes(
    "run (Δx)",
    { x: (x1 + x2) / 2 - 20, y: y1 + 18 },
    { color: slopeColor, size: 14, strokeWidth: 1.6, pageId }
  );
  strokes.push(...runLabel);

  // Label "rise" comfortably right of vertical leg
  const riseLabel = textToStrokes(
    "rise (Δy)",
    { x: x2 + 12, y: (y1 + y2) / 2 - 6 },
    { color: "#EF4444", size: 14, strokeWidth: 1.6, pageId }
  );
  strokes.push(...riseLabel);

  return strokes;
}

// ─────────────────────────────────────────────────────────────
// 6. NUMBER LINE ARITHMETIC GENERATOR
// ─────────────────────────────────────────────────────────────

export interface NumberLineOptions extends BaseSketchOptions {
  center?: Point;
  width?: number;
  start?: number;
  end?: number;
  jumps?: { from: number; to: number; label: string; color?: string }[];
  highlightNumber?: number;
  equation?: string;
  textColor?: string;
}

export function createNumberLineStrokes(options: NumberLineOptions = {}): Stroke[] {
  const center = options.center || { x: 400, y: 260 };
  const w = options.width || 340;
  const axisColor = "#71717A";
  const textColor = options.textColor || "#EDEDED";
  const pageId = options.pageId || "";
  const uid = Date.now().toString(36);

  let calcStart = options.start ?? 0;
  let calcEnd = options.end ?? 7;
  let parsedJumps = options.jumps;
  let parsedHighlight = options.highlightNumber;

  // Intelligently parse equation if supplied (e.g. "3 + 4 = 7" or "1.2 + 0.3 = 1.5")
  if (options.equation) {
    const eqMatch = options.equation.match(/([0-9.]+)\s*([\+\-])\s*([0-9.]+)\s*=\s*([0-9.]+)/);
    if (eqMatch) {
      const a = parseFloat(eqMatch[1]);
      const sign = eqMatch[2];
      const b = parseFloat(eqMatch[3]);
      const c = parseFloat(eqMatch[4]);

      if (!isNaN(a) && !isNaN(b) && !isNaN(c)) {
        parsedHighlight = c;
        if (options.end === undefined) {
          calcEnd = Math.max(Math.ceil(c + (c < 3 ? 1 : 2)), 5);
        }
        if (!parsedJumps) {
          if (sign === "+") {
            parsedJumps = [
              { from: 0, to: a, label: `+${a}`, color: "#38BDF8" },
              { from: a, to: c, label: `+${b}`, color: "#10B981" },
            ];
          } else {
            parsedJumps = [
              { from: 0, to: a, label: `+${a}`, color: "#38BDF8" },
              { from: a, to: c, label: `-${b}`, color: "#F87171" },
            ];
          }
        }
      }
    }
  }

  // Fallback jumps within valid bounds if not defined
  if (!parsedJumps) {
    if (calcEnd >= 7) {
      parsedJumps = [
        { from: 0, to: 3, label: "+3", color: "#38BDF8" },
        { from: 3, to: 7, label: "+4", color: "#10B981" },
      ];
      parsedHighlight = parsedHighlight ?? 7;
    } else if (calcEnd > 1) {
      const mid = Math.round(calcEnd / 2);
      parsedJumps = [
        { from: 0, to: mid, label: `+${mid}`, color: "#38BDF8" },
        { from: mid, to: calcEnd, label: `+${calcEnd - mid}`, color: "#10B981" },
      ];
      parsedHighlight = parsedHighlight ?? calcEnd;
    } else {
      parsedJumps = [];
    }
  }

  // Safety filter: never draw jump arcs that overshoot the end of the number line
  const safeJumps = parsedJumps.filter(
    (j) => j.from >= calcStart && j.to <= calcEnd && j.from !== j.to
  );

  const count = Math.max(1, calcEnd - calcStart);
  const stepPx = w / count;

  const strokes: Stroke[] = [];

  // Equation Title: centered 92px above axis (well clear of arcs)
  if (options.equation) {
    const rawEqStrokes = textToStrokes(
      options.equation,
      { x: center.x, y: center.y - 92 },
      { color: "#60A5FA", size: 30, strokeWidth: 2.6, pageId }
    );
    const eqStrokes = centerStrokes(rawEqStrokes, { x: center.x, y: center.y - 92 });
    strokes.push(...eqStrokes);
  }

  // 1. Horizontal Axis Line
  const x1 = center.x - w / 2 - 20;
  const x2 = center.x + w / 2 + 20;
  strokes.push(
    createHandDrawnLine({ x: x1, y: center.y }, { x: x2, y: center.y }, `numline-axis-${uid}`, {
      color: axisColor,
      strokeWidth: 2.2,
      pageId,
    })
  );

  // Left arrow <
  strokes.push({
    id: `numline-arrow-l-${uid}`,
    page_id: pageId,
    tool: "pen",
    color: axisColor,
    size: 2,
    points: [
      { x: x1 + 10, y: center.y - 6 },
      { x: x1, y: center.y },
      { x: x1 + 10, y: center.y + 6 },
    ],
  });

  // Right arrow >
  strokes.push({
    id: `numline-arrow-r-${uid}`,
    page_id: pageId,
    tool: "pen",
    color: axisColor,
    size: 2,
    points: [
      { x: x2 - 10, y: center.y - 6 },
      { x: x2, y: center.y },
      { x: x2 - 10, y: center.y + 6 },
    ],
  });

  // 2. Ticks and Numbers
  const tickStep = count > 12 ? 2 : 1;
  for (let i = 0; i <= count; i += tickStep) {
    const val = calcStart + i;
    const xPos = center.x - w / 2 + i * stepPx;
    // Tick
    strokes.push(
      createHandDrawnLine(
        { x: xPos, y: center.y - 6 },
        { x: xPos, y: center.y + 6 },
        `numline-tick-${uid}-${val}`,
        { color: axisColor, strokeWidth: 1.8, pageId }
      )
    );
    // Number label
    const rawNumStrokes = textToStrokes(
      val.toString(),
      { x: xPos, y: center.y + 14 },
      { color: val === parsedHighlight ? "#F59E0B" : textColor, size: 20, strokeWidth: 2, pageId }
    );
    const boxNum = getStrokesBoundingBox(rawNumStrokes);
    const centeredNum = rawNumStrokes.map((s) => ({
      ...s,
      points: s.points.map((p) => ({ x: p.x + (xPos - boxNum.centerX), y: p.y })),
    }));
    strokes.push(...centeredNum);
  }

  // 3. Jump Arcs
  for (let j = 0; j < safeJumps.length; j++) {
    const jump = safeJumps[j];
    const jFromX = center.x - w / 2 + (jump.from - calcStart) * stepPx;
    const jToX = center.x - w / 2 + (jump.to - calcStart) * stepPx;
    const arcHeight = Math.min(45, Math.max(22, Math.abs(jToX - jFromX) * 0.4));
    const jMidX = (jFromX + jToX) / 2;
    const jMidY = center.y - arcHeight;

    const arcPoints: Point[] = [];
    const segments = 20;
    for (let s = 0; s <= segments; s++) {
      const t = s / segments;
      arcPoints.push({
        x: jFromX + (jToX - jFromX) * t,
        y: center.y - 4 * arcHeight * t * (1 - t),
      });
    }

    strokes.push({
      id: `numline-jump-${uid}-${j}`,
      page_id: pageId,
      tool: "pen",
      color: jump.color || "#38BDF8",
      size: 2.2,
      points: arcPoints,
    });

    // Arrow tip pointing down at destination
    strokes.push({
      id: `numline-jump-arrow-${uid}-${j}`,
      page_id: pageId,
      tool: "pen",
      color: jump.color || "#38BDF8",
      size: 2,
      points: [
        { x: jToX - 5, y: center.y - 10 },
        { x: jToX, y: center.y - 2 },
        { x: jToX - 8, y: center.y - 4 },
      ],
    });

    // Label for jump
    const rawLabelStrokes = textToStrokes(
      jump.label,
      { x: jMidX, y: jMidY - 14 },
      { color: jump.color || "#38BDF8", size: 19, strokeWidth: 2.2, pageId }
    );
    const boxLabel = getStrokesBoundingBox(rawLabelStrokes);
    const centeredLabel = rawLabelStrokes.map((s) => ({
      ...s,
      points: s.points.map((p) => ({ x: p.x + (jMidX - boxLabel.centerX), y: p.y })),
    }));
    strokes.push(...centeredLabel);
  }

  // 4. Circle highlight around final answer
  if (parsedHighlight !== undefined && parsedHighlight >= calcStart && parsedHighlight <= calcEnd) {
    const targetX = center.x - w / 2 + (parsedHighlight - calcStart) * stepPx;
    strokes.push(
      ...createAnnotationStrokes("circle_highlight", { x: targetX, y: center.y + 24 }, {
        color: "#F59E0B",
        width: 30,
        height: 30,
        pageId,
      })
    );
  }

  return strokes;
}

// ─────────────────────────────────────────────────────────────
// 7. CIRCLE GEOMETRY (RADIUS, DIAMETER, FORMULAS)
// ─────────────────────────────────────────────────────────────

export interface CircleGeometryOptions extends BaseSketchOptions {
  center?: Point;
  radius?: number;
  textColor?: string;
  formulaLabel?: string;
}

export function createCircleGeometryStrokes(options: CircleGeometryOptions = {}): Stroke[] {
  const center = options.center || { x: 400, y: 260 };
  const r = options.radius || 80;
  const circleColor = options.color || "#60A5FA";
  const pageId = options.pageId || "";
  const uid = Date.now().toString(36);

  const strokes: Stroke[] = [];

  // 1. Circle perimeter
  strokes.push(createHandDrawnCircle(center, r, `geom-circ-${uid}`, { color: circleColor, strokeWidth: 2.8, pageId }));

  // 2. Center dot
  strokes.push(createHandDrawnCircle(center, 4, `geom-circ-center-${uid}`, { color: "#F59E0B", strokeWidth: 3, pageId }));

  // 3. Radius line from center to right edge
  const rEdge: Point = { x: center.x + r, y: center.y };
  strokes.push(createHandDrawnLine(center, rEdge, `geom-circ-radius-${uid}`, { color: "#F59E0B", strokeWidth: 2.2, pageId }));

  // Radius label: "r"
  const rLabel = textToStrokes("r", { x: center.x + r / 2 - 4, y: center.y - 18 }, { color: "#F59E0B", size: 22, strokeWidth: 2.2, pageId });
  strokes.push(...rLabel);

  // 4. Diameter dashed line from left to center
  const dEdge: Point = { x: center.x - r, y: center.y };
  strokes.push(createHandDrawnLine(dEdge, center, `geom-circ-diam-${uid}`, { color: "#71717A", strokeWidth: 1.8, pageId }));

  // Diameter label: "d = 2r"
  const dLabel = textToStrokes("d = 2r", { x: center.x - r * 0.75, y: center.y + 14 }, { color: "#71717A", size: 18, strokeWidth: 1.8, pageId });
  strokes.push(...dLabel);

  return strokes;
}

// ─────────────────────────────────────────────────────────────
// 8. WAVE PHYSICS (SINE WAVE, WAVELENGTH, AMPLITUDE)
// ─────────────────────────────────────────────────────────────

export interface WaveOptions extends BaseSketchOptions {
  center?: Point;
  width?: number;
  amplitude?: number;
  wavelength?: number;
  textColor?: string;
  formulaLabel?: string;
}

export function createWaveStrokes(options: WaveOptions = {}): Stroke[] {
  const center = options.center || { x: 400, y: 260 };
  const w = options.width || 320;
  const A = options.amplitude || 45;
  const lambda = options.wavelength || 140;
  const waveColor = options.color || "#38BDF8";
  const axisColor = "#71717A";
  const pageId = options.pageId || "";
  const uid = Date.now().toString(36);

  const strokes: Stroke[] = [];

  // Center axis line
  strokes.push(
    createHandDrawnLine(
      { x: center.x - w / 2, y: center.y },
      { x: center.x + w / 2, y: center.y },
      `wave-axis-${uid}`,
      { color: axisColor, strokeWidth: 1.8, pageId }
    )
  );

  // Sinusoidal wave points
  const points: Point[] = [];
  const segments = 64;
  for (let i = 0; i <= segments; i++) {
    const x = center.x - w / 2 + (i / segments) * w;
    const angle = ((x - (center.x - w / 2)) / lambda) * Math.PI * 2;
    const y = center.y - Math.sin(angle) * A;
    points.push({ x, y });
  }

  strokes.push({
    id: `wave-curve-${uid}`,
    page_id: pageId,
    tool: "pen",
    color: waveColor,
    size: 2.8,
    points,
  });

  // Wavelength marker between two crests
  const crest1X = center.x - w / 2 + lambda * 0.25;
  const crest2X = center.x - w / 2 + lambda * 1.25;
  const crestY = center.y - A - 10;

  strokes.push(
    createHandDrawnLine({ x: crest1X, y: crestY }, { x: crest2X, y: crestY }, `wave-lambda-line-${uid}`, {
      color: "#F59E0B",
      strokeWidth: 1.8,
      pageId,
    })
  );
  const lambdaLabel = textToStrokes(
    "Wavelength λ",
    { x: (crest1X + crest2X) / 2 - 38, y: crestY - 14 },
    { color: "#F59E0B", size: 17, strokeWidth: 2, pageId }
  );
  strokes.push(...lambdaLabel);

  // Amplitude marker
  strokes.push(
    createHandDrawnLine({ x: crest1X, y: center.y }, { x: crest1X, y: center.y - A }, `wave-amp-line-${uid}`, {
      color: "#10B981",
      strokeWidth: 1.8,
      pageId,
    })
  );
  const ampLabel = textToStrokes(
    "Amplitude A",
    { x: crest1X + 8, y: center.y - A / 2 - 8 },
    { color: "#10B981", size: 17, strokeWidth: 2, pageId }
  );
  strokes.push(...ampLabel);

  return strokes;
}

// ─────────────────────────────────────────────────────────────
// 9. PARABOLA QUADRATIC CURVE GENERATOR
// ─────────────────────────────────────────────────────────────

export interface ParabolaOptions extends BaseSketchOptions {
  center?: Point;
  width?: number;
  height?: number;
  formulaLabel?: string;
  textColor?: string;
}

export function createParabolaStrokes(options: ParabolaOptions = {}): Stroke[] {
  const center = options.center || { x: 400, y: 260 };
  const w = options.width || 240;
  const h = options.height || 180;
  const curveColor = options.color || "#818CF8";
  const axisColor = "#71717A";
  const pageId = options.pageId || "";
  const uid = Date.now().toString(36);

  const strokes: Stroke[] = [];

  // Axes
  strokes.push(
    createHandDrawnLine({ x: center.x - w / 2, y: center.y + 30 }, { x: center.x + w / 2, y: center.y + 30 }, `parab-axis-x-${uid}`, {
      color: axisColor,
      strokeWidth: 2,
      pageId,
    }),
    createHandDrawnLine({ x: center.x, y: center.y + h / 2 + 10 }, { x: center.x, y: center.y - h / 2 }, `parab-axis-y-${uid}`, {
      color: axisColor,
      strokeWidth: 2,
      pageId,
    })
  );

  // Parabola points: vertex at (center.x, center.y + 10)
  const vertex: Point = { x: center.x, y: center.y + 10 };
  const points: Point[] = [];
  const segments = 40;
  const aCoeff = 0.018;

  for (let i = -segments / 2; i <= segments / 2; i++) {
    const dx = (i / (segments / 2)) * (w * 0.42);
    const dy = aCoeff * dx * dx;
    points.push({
      x: vertex.x + dx,
      y: vertex.y - (h * 0.7 - dy),
    });
  }

  strokes.push({
    id: `parab-curve-${uid}`,
    page_id: pageId,
    tool: "pen",
    color: curveColor,
    size: 3,
    points,
  });

  // Vertex marker
  strokes.push(createHandDrawnCircle(vertex, 5, `parab-vertex-${uid}`, { color: "#F59E0B", strokeWidth: 3, pageId }));
  const vertexLabel = textToStrokes(
    "Vertex (h, k)",
    { x: vertex.x + 10, y: vertex.y + 16 },
    { color: "#F59E0B", size: 17, strokeWidth: 2, pageId }
  );
  strokes.push(...vertexLabel);

  return strokes;
}

// ─────────────────────────────────────────────────────────────
// 10. GRAVITATIONAL ORBIT GENERATOR (NEWTONIAN GRAVITY)
// ─────────────────────────────────────────────────────────────

export interface GravityOrbitOptions extends BaseSketchOptions {
  center?: Point;
  width?: number;
  height?: number;
  formulaLabel?: string;
  textColor?: string;
}

export function createGravityOrbitStrokes(options: GravityOrbitOptions = {}): Stroke[] {
  const center = options.center || { x: 400, y: 260 };
  const rx = (options.width || 280) / 2;
  const ry = (options.height || 170) / 2;
  const orbitColor = "#71717A";
  const sunColor = "#F59E0B";
  const planetColor = "#38BDF8";
  const forceColor = "#EF4444";
  const velocityColor = "#10B981";
  const textColor = options.textColor || "#EDEDED";
  const pageId = options.pageId || "";
  const uid = Date.now().toString(36);

  const strokes: Stroke[] = [];

  // Central Star / Sun (Mass M)
  strokes.push(
    createHandDrawnCircle(center, 22, `sun-body-${uid}`, { color: sunColor, strokeWidth: 3.2, pageId }),
    createHandDrawnCircle(center, 30, `sun-glow-${uid}`, { color: "#FBBF24", strokeWidth: 1.6, pageId })
  );
  const sunLabel = textToStrokes("M", { x: center.x - 7, y: center.y + 6 }, { color: sunColor, size: 20, strokeWidth: 2.2, pageId });
  strokes.push(...sunLabel);

  // Elliptical Orbit Track
  const orbitPts: Point[] = [];
  const segments = 48;
  for (let i = 0; i <= segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    orbitPts.push({
      x: center.x + Math.cos(angle) * rx,
      y: center.y + Math.sin(angle) * ry,
    });
  }
  strokes.push({
    id: `orbit-ellipse-${uid}`,
    page_id: pageId,
    tool: "pen",
    color: orbitColor,
    size: 1.8,
    points: orbitPts,
  });

  // Orbiting Planet (Mass m) at angle 45°
  const planetAngle = Math.PI * 0.28;
  const planetX = center.x + Math.cos(planetAngle) * rx;
  const planetY = center.y + Math.sin(planetAngle) * ry;
  const planetPos: Point = { x: planetX, y: planetY };

  strokes.push(
    createHandDrawnCircle(planetPos, 9, `planet-body-${uid}`, { color: planetColor, strokeWidth: 2.8, pageId })
  );
  const planetLabel = textToStrokes("m", { x: planetX + 12, y: planetY + 8 }, { color: planetColor, size: 18, strokeWidth: 2, pageId });
  strokes.push(...planetLabel);

  // Radius distance line r from Sun to Planet
  strokes.push(
    createHandDrawnLine(center, planetPos, `orbit-radius-${uid}`, { color: "#52525B", strokeWidth: 1.5, pageId })
  );
  const rLabel = textToStrokes("r", { x: (center.x + planetX) / 2 + 6, y: (center.y + planetY) / 2 - 8 }, { color: textColor, size: 18, strokeWidth: 2, pageId });
  strokes.push(...rLabel);

  // Gravitational Inward Force vector F_g (pointing toward Sun)
  const fLen = 38;
  const angleToSun = Math.atan2(center.y - planetY, center.x - planetX);
  const fTipX = planetX + Math.cos(angleToSun) * fLen;
  const fTipY = planetY + Math.sin(angleToSun) * fLen;
  strokes.push(
    createHandDrawnLine(planetPos, { x: fTipX, y: fTipY }, `vector-fg-${uid}`, { color: forceColor, strokeWidth: 2.6, pageId }),
    {
      id: `vector-fg-arrow-${uid}`,
      page_id: pageId,
      tool: "pen",
      color: forceColor,
      size: 2.2,
      points: [
        { x: fTipX - Math.cos(angleToSun - 0.4) * 10, y: fTipY - Math.sin(angleToSun - 0.4) * 10 },
        { x: fTipX, y: fTipY },
        { x: fTipX - Math.cos(angleToSun + 0.4) * 10, y: fTipY - Math.sin(angleToSun + 0.4) * 10 },
      ],
    }
  );
  const fLabel = textToStrokes("F_g", { x: fTipX + 8, y: fTipY - 8 }, { color: forceColor, size: 19, strokeWidth: 2.2, pageId });
  strokes.push(...fLabel);

  // Tangent Velocity vector v
  const vAngle = planetAngle + Math.PI / 2;
  const vLen = 42;
  const vTipX = planetX + Math.cos(vAngle) * vLen;
  const vTipY = planetY + Math.sin(vAngle) * vLen;
  strokes.push(
    createHandDrawnLine(planetPos, { x: vTipX, y: vTipY }, `vector-v-${uid}`, { color: velocityColor, strokeWidth: 2.4, pageId }),
    {
      id: `vector-v-arrow-${uid}`,
      page_id: pageId,
      tool: "pen",
      color: velocityColor,
      size: 2,
      points: [
        { x: vTipX - Math.cos(vAngle - 0.45) * 9, y: vTipY - Math.sin(vAngle - 0.45) * 9 },
        { x: vTipX, y: vTipY },
        { x: vTipX - Math.cos(vAngle + 0.45) * 9, y: vTipY - Math.sin(vAngle + 0.45) * 9 },
      ],
    }
  );
  const vLabel = textToStrokes("v", { x: vTipX + 6, y: vTipY + 12 }, { color: velocityColor, size: 19, strokeWidth: 2.2, pageId });
  strokes.push(...vLabel);

  return strokes;
}

// ─────────────────────────────────────────────────────────────
// 11. GENERAL RELATIVITY / SPACETIME CURVATURE GENERATOR
// ─────────────────────────────────────────────────────────────

export interface SpacetimeCurvatureOptions extends BaseSketchOptions {
  center?: Point;
  width?: number;
  height?: number;
  formulaLabel?: string;
  textColor?: string;
}

export function createSpacetimeCurvatureStrokes(options: SpacetimeCurvatureOptions = {}): Stroke[] {
  const center = options.center || { x: 400, y: 260 };
  const w = options.width || 320;
  const h = options.height || 180;
  const gridColor = "#52525B";
  const massColor = "#38BDF8";
  const lightColor = "#F59E0B";
  const pageId = options.pageId || "";
  const uid = Date.now().toString(36);

  const strokes: Stroke[] = [];

  // Perspective 3D warped grid lines
  const gridRows = 6;
  const gridCols = 8;
  const wellDepth = 55;

  // Horizontal curved mesh lines
  for (let r = 0; r <= gridRows; r++) {
    const normY = (r / gridRows) * 2 - 1; // -1 to +1
    const baseY = center.y + normY * (h * 0.42);
    const pts: Point[] = [];
    for (let c = 0; c <= gridCols * 3; c++) {
      const normX = (c / (gridCols * 3)) * 2 - 1;
      const x = center.x + normX * (w * 0.48);
      const distFromCenter = Math.hypot(normX * 1.2, normY * 1.6);
      const dip = Math.exp(-distFromCenter * 2.2) * wellDepth;
      pts.push({ x, y: baseY + dip });
    }
    strokes.push({
      id: `mesh-row-${uid}-${r}`,
      page_id: pageId,
      tool: "pen",
      color: gridColor,
      size: 1.5,
      points: pts,
    });
  }

  // Vertical perspective mesh lines
  for (let c = 0; c <= gridCols; c++) {
    const normX = (c / gridCols) * 2 - 1;
    const pts: Point[] = [];
    for (let r = 0; r <= gridRows * 3; r++) {
      const normY = (r / (gridRows * 3)) * 2 - 1;
      const x = center.x + normX * (w * 0.48);
      const baseY = center.y + normY * (h * 0.42);
      const distFromCenter = Math.hypot(normX * 1.2, normY * 1.6);
      const dip = Math.exp(-distFromCenter * 2.2) * wellDepth;
      pts.push({ x, y: baseY + dip });
    }
    strokes.push({
      id: `mesh-col-${uid}-${c}`,
      page_id: pageId,
      tool: "pen",
      color: gridColor,
      size: 1.5,
      points: pts,
    });
  }

  // Dense massive body at the bottom of the gravity funnel
  const wellCenter: Point = { x: center.x, y: center.y + wellDepth * 0.7 };
  strokes.push(
    createHandDrawnCircle(wellCenter, 18, `gravity-mass-${uid}`, { color: massColor, strokeWidth: 3.5, pageId }),
    createHandDrawnCircle(wellCenter, 24, `gravity-ring-${uid}`, { color: "#60A5FA", strokeWidth: 1.6, pageId })
  );
  const massLabel = textToStrokes("Mass (M)", { x: wellCenter.x - 30, y: wellCenter.y + 32 }, { color: massColor, size: 18, strokeWidth: 2, pageId });
  strokes.push(...massLabel);

  // Deflected Light Geodesic (Gravitational Lensing)
  const lightPts: Point[] = [];
  const lightSteps = 30;
  for (let i = 0; i <= lightSteps; i++) {
    const t = (i / lightSteps) * 2 - 1; // -1 to +1
    const lx = center.x + t * (w * 0.46);
    const bend = Math.exp(-t * t * 4) * 26;
    const ly = center.y - 45 + bend;
    lightPts.push({ x: lx, y: ly });
  }
  strokes.push({
    id: `light-geodesic-${uid}`,
    page_id: pageId,
    tool: "pen",
    color: lightColor,
    size: 2.4,
    points: lightPts,
  });
  const lightLabel = textToStrokes("Light Geodesic (Lensing)", { x: center.x - 70, y: center.y - 65 }, { color: lightColor, size: 17, strokeWidth: 2, pageId });
  strokes.push(...lightLabel);

  return strokes;
}

// ─────────────────────────────────────────────────────────────
// 12. FARADAY ELECTROMAGNETIC INDUCTION GENERATOR
// ─────────────────────────────────────────────────────────────

export interface FaradayInductionOptions extends BaseSketchOptions {
  center?: Point;
  width?: number;
  height?: number;
  formulaLabel?: string;
  textColor?: string;
}

export function createFaradayInductionStrokes(options: FaradayInductionOptions = {}): Stroke[] {
  const center = options.center || { x: 400, y: 260 };
  const w = options.width || 300;
  const magnetColor = "#EF4444";
  const coilColor = "#F59E0B";
  const bFieldColor = "#38BDF8";
  const pageId = options.pageId || "";
  const uid = Date.now().toString(36);

  const strokes: Stroke[] = [];

  // Bar Magnet on the left (North and South poles)
  const magX = center.x - 120;
  const magY = center.y - 20;
  const magW = 75;
  const magH = 40;

  // North pole (Red)
  strokes.push({
    id: `magnet-n-${uid}`,
    page_id: pageId,
    tool: "pen",
    color: magnetColor,
    size: 2.6,
    points: [
      { x: magX + magW / 2, y: magY },
      { x: magX + magW, y: magY },
      { x: magX + magW, y: magY + magH },
      { x: magX + magW / 2, y: magY + magH },
      { x: magX + magW / 2, y: magY },
    ],
  });
  const nLabel = textToStrokes("N", { x: magX + magW * 0.7, y: magY + 28 }, { color: magnetColor, size: 24, strokeWidth: 2.4, pageId });
  strokes.push(...nLabel);

  // South pole (Blue/Gray)
  strokes.push({
    id: `magnet-s-${uid}`,
    page_id: pageId,
    tool: "pen",
    color: "#60A5FA",
    size: 2.6,
    points: [
      { x: magX, y: magY },
      { x: magX + magW / 2, y: magY },
      { x: magX + magW / 2, y: magY + magH },
      { x: magX, y: magY + magH },
      { x: magX, y: magY },
    ],
  });
  const sLabel = textToStrokes("S", { x: magX + 10, y: magY + 28 }, { color: "#60A5FA", size: 24, strokeWidth: 2.4, pageId });
  strokes.push(...sLabel);

  // Velocity arrow of magnet moving into the coil
  const vArrowX = magX + magW + 8;
  strokes.push(
    createHandDrawnLine({ x: vArrowX, y: center.y }, { x: vArrowX + 26, y: center.y }, `magnet-v-${uid}`, { color: "#10B981", strokeWidth: 2.6, pageId }),
    {
      id: `magnet-v-arrow-${uid}`,
      page_id: pageId,
      tool: "pen",
      color: "#10B981",
      size: 2,
      points: [
        { x: vArrowX + 18, y: center.y - 6 },
        { x: vArrowX + 26, y: center.y },
        { x: vArrowX + 18, y: center.y + 6 },
      ],
    }
  );
  const vLabel = textToStrokes("v", { x: vArrowX + 6, y: center.y - 12 }, { color: "#10B981", size: 18, strokeWidth: 2, pageId });
  strokes.push(...vLabel);

  // Wire Coil Loops on the right
  const coilX = center.x + 40;
  const loopRadiusY = 32;
  const loopRadiusX = 14;
  const numLoops = 4;

  for (let l = 0; l < numLoops; l++) {
    const lx = coilX + l * 24;
    const loopPts: Point[] = [];
    for (let i = 0; i <= 24; i++) {
      const angle = (i / 24) * Math.PI * 2;
      loopPts.push({
        x: lx + Math.cos(angle) * loopRadiusX,
        y: center.y + Math.sin(angle) * loopRadiusY,
      });
    }
    strokes.push({
      id: `coil-loop-${uid}-${l}`,
      page_id: pageId,
      tool: "pen",
      color: coilColor,
      size: 2.6,
      points: loopPts,
    });
  }

  // Magnetic Field Lines B
  for (let f = -1; f <= 1; f++) {
    const bPts: Point[] = [];
    const bY = center.y + f * 18;
    for (let step = 0; step <= 20; step++) {
      const bx = magX + magW + step * 9;
      bPts.push({ x: bx, y: bY });
    }
    strokes.push({
      id: `b-field-${uid}-${f}`,
      page_id: pageId,
      tool: "pen",
      color: bFieldColor,
      size: 1.6,
      points: bPts,
    });
  }
  const bLabel = textToStrokes("B", { x: coilX - 25, y: center.y - 28 }, { color: bFieldColor, size: 20, strokeWidth: 2.2, pageId });
  strokes.push(...bLabel);

  // Induced Current I Arrow
  const currentLabel = textToStrokes("Induced Current I", { x: coilX + 15, y: center.y + loopRadiusY + 22 }, { color: coilColor, size: 17, strokeWidth: 2, pageId });
  strokes.push(...currentLabel);

  return strokes;
}

// ─────────────────────────────────────────────────────────────
// 13. ELECTRIC CIRCUIT GENERATOR (OHM'S LAW: V = IR)
// ─────────────────────────────────────────────────────────────

export interface ElectricCircuitOptions extends BaseSketchOptions {
  center?: Point;
  width?: number;
  height?: number;
  formulaLabel?: string;
  textColor?: string;
}

export function createElectricCircuitStrokes(options: ElectricCircuitOptions = {}): Stroke[] {
  const center = options.center || { x: 400, y: 260 };
  const w = options.width || 280;
  const h = options.height || 160;
  const wireColor = "#71717A";
  const batteryColor = "#F59E0B";
  const resistorColor = "#38BDF8";
  const pageId = options.pageId || "";
  const uid = Date.now().toString(36);

  const strokes: Stroke[] = [];

  const left = center.x - w / 2;
  const right = center.x + w / 2;
  const top = center.y - h / 2;
  const bottom = center.y + h / 2;

  // 1. Top wire with Resistor R in the middle
  const rStart = center.x - 40;
  const rEnd = center.x + 40;
  strokes.push(
    createHandDrawnLine({ x: left, y: top }, { x: rStart, y: top }, `wire-t1-${uid}`, { color: wireColor, strokeWidth: 2.2, pageId }),
    createHandDrawnLine({ x: rEnd, y: top }, { x: right, y: top }, `wire-t2-${uid}`, { color: wireColor, strokeWidth: 2.2, pageId })
  );

  // Zigzag Resistor
  const zigZagPts: Point[] = [
    { x: rStart, y: top },
    { x: rStart + 10, y: top - 12 },
    { x: rStart + 23, y: top + 12 },
    { x: rStart + 36, y: top - 12 },
    { x: rStart + 49, y: top + 12 },
    { x: rStart + 62, y: top - 12 },
    { x: rStart + 72, y: top + 12 },
    { x: rEnd, y: top },
  ];
  strokes.push({
    id: `resistor-zigzag-${uid}`,
    page_id: pageId,
    tool: "pen",
    color: resistorColor,
    size: 2.6,
    points: zigZagPts,
  });
  const rLabel = textToStrokes("R", { x: center.x - 7, y: top - 24 }, { color: resistorColor, size: 22, strokeWidth: 2.4, pageId });
  strokes.push(...rLabel);

  // 2. Right wire
  strokes.push(
    createHandDrawnLine({ x: right, y: top }, { x: right, y: bottom }, `wire-r-${uid}`, { color: wireColor, strokeWidth: 2.2, pageId })
  );

  // 3. Bottom wire with Battery in the middle
  const bMidX = center.x;
  strokes.push(
    createHandDrawnLine({ x: right, y: bottom }, { x: bMidX + 16, y: bottom }, `wire-b1-${uid}`, { color: wireColor, strokeWidth: 2.2, pageId }),
    createHandDrawnLine({ x: bMidX - 16, y: bottom }, { x: left, y: bottom }, `wire-b2-${uid}`, { color: wireColor, strokeWidth: 2.2, pageId })
  );

  // Battery Plates: Long positive plate (left), short thick negative plate (right)
  strokes.push(
    createHandDrawnLine({ x: bMidX - 8, y: bottom - 18 }, { x: bMidX - 8, y: bottom + 18 }, `bat-plus-${uid}`, { color: batteryColor, strokeWidth: 2.8, pageId }),
    createHandDrawnLine({ x: bMidX + 8, y: bottom - 10 }, { x: bMidX + 8, y: bottom + 10 }, `bat-minus-${uid}`, { color: batteryColor, strokeWidth: 4.2, pageId })
  );
  const batLabel = textToStrokes("V", { x: bMidX - 6, y: bottom + 32 }, { color: batteryColor, size: 22, strokeWidth: 2.4, pageId });
  strokes.push(...batLabel);

  // 4. Left wire
  strokes.push(
    createHandDrawnLine({ x: left, y: bottom }, { x: left, y: top }, `wire-l-${uid}`, { color: wireColor, strokeWidth: 2.2, pageId })
  );

  // Current Direction Arrow I
  const iX = right + 18;
  const iY = center.y;
  strokes.push(
    createHandDrawnLine({ x: iX, y: iY - 18 }, { x: iX, y: iY + 18 }, `arrow-i-${uid}`, { color: "#10B981", strokeWidth: 2.2, pageId }),
    {
      id: `arrow-i-tip-${uid}`,
      page_id: pageId,
      tool: "pen",
      color: "#10B981",
      size: 2,
      points: [
        { x: iX - 5, y: iY + 10 },
        { x: iX, y: iY + 18 },
        { x: iX + 5, y: iY + 10 },
      ],
    }
  );
  const iLabel = textToStrokes("I", { x: iX + 8, y: iY + 6 }, { color: "#10B981", size: 19, strokeWidth: 2, pageId });
  strokes.push(...iLabel);

  return strokes;
}

// ─────────────────────────────────────────────────────────────
// 13. GENERATIVE DYNAMIC SCENE ENGINE (ARBITRARY VISUALS & SVG)
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
    | "text"
    | "math"
    | "axis"
    | "fraction_bar"
    | "fraction_circle"
    | "number_line"
    | "array_model"
    | "ten_frame"
    | "tape_diagram"
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
  totalParts?: number;
  shadedParts?: number;
  start?: number;
  end?: number;
  rows?: number;
  cols?: number;
  count?: number;
  addCount?: number;
  parts?: any[];
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

/** Hand-drawn ellipse with natural organic wobble */
function createHandDrawnEllipse(
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

/** Hand-drawn arrow with shaft and barb head */
function createHandDrawnArrow(
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

/** Hand-drawn path from point list */
function createHandDrawnPath(
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

/**
 * Universal dynamic scene compiler.
 * Converts ANY dynamic visual scene (geometry, mechanisms, science, flows)
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
        // Horizontal overlap test with 6px margin
        const xOverlap = !(box.maxX < existing.minX - 6 || box.minX > existing.maxX + 6);
        // Vertical overlap test with 4px margin
        const yOverlap = !(currMaxY < existing.minY - 4 || currMinY > existing.maxY + 4);
        if (xOverlap && yOverlap) {
          const existingCenterY = (existing.minY + existing.maxY) / 2;
          const isSameRow = Math.abs(anchor.y - existingCenterY) < 16;

          if (isSameRow) {
            // For items on the same horizontal row (e.g. adjacent column labels, tick mark values),
            // DO NOT shift Y downwards! Shifting downward creates an ugly diagonal staircase.
            // Instead, shrink the font size to fit without overlapping!
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
            // Shift down below this existing box with a comfortable margin
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
    // Reserve space in collision registry at the very top (Header Zone)
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

  const elements = scene.elements || [];
  elements.forEach((elem, idx) => {
    const elemId = `dyn-${uid}-${idx}`;
    const color = elem.color || "#38BDF8";
    const strokeWidth = elem.size || elem.strokeWidth || 2.5;

    let targetPt: Point = { x: 400, y: 250 };

    const effectiveKind = (
      elem.diagram ||
      (elem.kind === "diagram" ? (elem as any).diagram : elem.kind || elem.type)
    ) as string;

    switch (effectiveKind) {
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
        const eqText = (elem as any).equation || (elem as any).formulaLabel || elem.text || elem.label;
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
        const anyElem = elem as any;
        const cx = elem.cx ?? elem.x ?? 400;
        const cy = elem.cy ?? elem.y ?? 250;
        const w = elem.w ?? elem.width ?? 280;
        const h = elem.h ?? elem.height ?? 200;
        const siStrokes = createSlopeInterceptStrokes({
          center: { x: cx, y: cy },
          width: w,
          height: h,
          slope: anyElem.slope ?? 0.65,
          intercept: anyElem.intercept ?? 28,
          slopeLabel: anyElem.slopeLabel || "m (slope)",
          interceptLabel: anyElem.interceptLabel || "b (intercept)",
          formulaLabel: anyElem.formulaLabel || "y = mx + b",
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
        const anyElem = elem as any;
        const cx = elem.cx ?? elem.x ?? 400;
        const cy = elem.cy ?? elem.y ?? 230;
        const w = elem.w ?? elem.width ?? 180;
        const h = elem.h ?? elem.height ?? 130;
        const triStrokes = createRightTriangleStrokes({
          origin: { x: cx - w / 2, y: cy - h / 2 },
          width: w,
          height: h,
          legALabel: anyElem.legALabel || "a = 3",
          legBLabel: anyElem.legBLabel || "b = 4",
          hypotenuseLabel: anyElem.hypotenuseLabel || "c = 5",
          formulaLabel: anyElem.formulaLabel || "a^2 + b^2 = c^2",
          color: elem.color || "#60A5FA",
          textColor,
          pageId,
        });
        strokes.push(...triStrokes);
        registerStrokesBounds(triStrokes);
        targetPt = { x: cx, y: cy };
        break;
      }

      case "circle":
      case "ellipse": {
        const cx = elem.cx ?? elem.x ?? 400;
        const cy = elem.cy ?? elem.y ?? 250;
        const rx = elem.rx ?? elem.r ?? elem.w ?? 50;
        const ry = elem.ry ?? elem.r ?? elem.h ?? rx;
        targetPt = { x: cx, y: cy };
        const circleShapeStrokes = [createHandDrawnEllipse({ x: cx, y: cy }, rx, ry, elemId, { color, strokeWidth, pageId })];
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

      case "rect": {
        const x = elem.x ?? 350;
        const y = elem.y ?? 200;
        const w = elem.w ?? elem.width ?? 100;
        const h = elem.h ?? elem.height ?? 60;
        targetPt = { x: x + w / 2, y: y + h / 2 };
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
          // If the box is roomy enough (w >= 36 and h >= 24), place the label neatly INSIDE the box!
          // Auto-scale font size to fit inside the box width and height
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
        const toPt = (v: any, fx: number, fy: number): Point =>
          Array.isArray(v) ? { x: v[0], y: v[1] } : v && typeof v === "object" ? { x: v.x ?? fx, y: v.y ?? fy } : { x: fx, y: fy };
        const p1: Point = elem.from ? toPt(elem.from, 300, 250) : { x: elem.x1 ?? 300, y: elem.y1 ?? 250 };
        const p2: Point = elem.to ? toPt(elem.to, 500, 250) : { x: elem.x2 ?? 500, y: elem.y2 ?? 250 };
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
        const toPt = (v: any, fx: number, fy: number): Point =>
          Array.isArray(v) ? { x: v[0], y: v[1] } : v && typeof v === "object" ? { x: v.x ?? fx, y: v.y ?? fy } : { x: fx, y: fy };
        const p1: Point = elem.from ? toPt(elem.from, 300, 250) : { x: elem.x1 ?? 300, y: elem.y1 ?? 250 };
        const p2: Point = elem.to ? toPt(elem.to, 500, 250) : { x: elem.x2 ?? 500, y: elem.y2 ?? 250 };
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
        // X axis
        strokes.push(...createHandDrawnArrow({ x: ox - w / 2, y: oy }, { x: ox + w / 2, y: oy }, `${elemId}-xaxis`, { color: "#64748B", strokeWidth: 2, pageId }));
        // Y axis
        strokes.push(...createHandDrawnArrow({ x: ox, y: oy + h / 2 }, { x: ox, y: oy - h / 2 }, `${elemId}-yaxis`, { color: "#64748B", strokeWidth: 2, pageId }));
        // Labels
        addTextStrokesWithCollisionAvoidance("x", { x: ox + w / 2 + 10, y: oy + 4 }, { color: textColor, size: 16, strokeWidth: 1.8, pageId }, false);
        addTextStrokesWithCollisionAvoidance("y", { x: ox - 4, y: oy - h / 2 - 14 }, { color: textColor, size: 16, strokeWidth: 1.8, pageId }, false);
        targetPt = { x: ox, y: oy };
        break;
      }

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

        // If a title is present at top (y: 35) and this equation is near the top (y < 95),
        // enforce at least 60px vertical clearance so it NEVER collides with the title!
        if (scene.title && posY < 95) {
          posY = 95;
        }

        // If equation is placed in the diagram zone (y: 140 - 325), route it to Zone 4 (Conclusion Zone: y >= 340)
        if (posY >= 140 && posY <= 325) {
          posY = 345;
        }

        // Avoid collision with title or existing math/text bounding boxes
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

        // If after collision checks it still falls in diagram territory (y: 140 - 325), push to Zone 4
        if (posY >= 140 && posY <= 325) {
          posY = 345;
        }

        // Hard action-chip clearance: ensure math cards never extend past y = 355
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
