/**
 * Elementary Math Visual Models (Grades 1 to 5)
 * First-principles pedagogical representations for elementary math:
 * - Grade 1-2: Ten-Frames (making 10s, addition within 20)
 * - Grade 2-4: Array Models (rows × columns, foundation of multiplication)
 * - Grade 2-5: Tape Diagrams / Bar Models (part-whole & comparison word problems)
 * - Grade 3-5: Fraction Strips / Bars & Fraction Circles
 */

import type { Stroke, Point } from "@/lib/types";
import {
  BaseSketchOptions,
  createHandDrawnLine,
  createHandDrawnCircle,
  createHandDrawnPolygon,
  createHandDrawnEllipse,
  createHandDrawnArrow,
  createAnnotationStrokes,
} from "./drawingPrimitives";
import { textToStrokes, centerStrokes, getStrokesBoundingBox } from "./handwritingEngine";

// ─────────────────────────────────────────────────────────────
// 1. ARRAY MODEL (Multiplication & Grouping: Grade 2–4)
// ─────────────────────────────────────────────────────────────

export interface ArrayModelOptions extends BaseSketchOptions {
  center?: Point;
  rows?: number;
  cols?: number;
  spacing?: number;
  dotRadius?: number;
  label?: string;
  itemColor?: string;
  textColor?: string;
}

export function createArrayModelStrokes(options: ArrayModelOptions = {}): Stroke[] {
  const center = options.center || { x: 400, y: 250 };
  const rows = Math.min(8, Math.max(1, options.rows || 3));
  const cols = Math.min(10, Math.max(1, options.cols || 4));
  const spacing = options.spacing || 38;
  const r = options.dotRadius || 11;
  const itemColor = options.itemColor || options.color || "#38BDF8";
  const textColor = options.textColor || "#EDEDED";
  const pageId = options.pageId || "";
  const uid = Date.now().toString(36);

  const strokes: Stroke[] = [];

  const gridW = (cols - 1) * spacing;
  const gridH = (rows - 1) * spacing;
  const startX = center.x - gridW / 2;
  const startY = center.y - gridH / 2;

  // 1. Draw array of counter dots
  for (let rIdx = 0; rIdx < rows; rIdx++) {
    for (let cIdx = 0; cIdx < cols; cIdx++) {
      const cx = startX + cIdx * spacing;
      const cy = startY + rIdx * spacing;
      const dotId = `dot-${uid}-${rIdx}-${cIdx}`;

      // Outer hand-drawn circle
      strokes.push(
        createHandDrawnCircle({ x: cx, y: cy }, r, dotId, {
          color: itemColor,
          strokeWidth: 2.2,
          pageId,
        })
      );

      // Inner highlighter glow for high visual appeal
      strokes.push({
        id: `${dotId}-fill`,
        page_id: pageId,
        tool: "highlighter",
        color: itemColor,
        size: 8,
        points: [
          { x: cx - r * 0.4, y: cy },
          { x: cx + r * 0.4, y: cy },
        ],
      });
    }
  }

  // 2. Row bracket on the left: "[ 3 rows"
  const bracketLeftX = startX - r - 22;
  const topY = startY - r;
  const bottomY = startY + gridH + r;
  strokes.push(
    createHandDrawnLine({ x: bracketLeftX + 6, y: topY }, { x: bracketLeftX, y: topY }, `br-top-${uid}`, { color: "#94A3B8", strokeWidth: 1.8, pageId }),
    createHandDrawnLine({ x: bracketLeftX, y: topY }, { x: bracketLeftX, y: bottomY }, `br-v-${uid}`, { color: "#94A3B8", strokeWidth: 1.8, pageId }),
    createHandDrawnLine({ x: bracketLeftX, y: bottomY }, { x: bracketLeftX + 6, y: bottomY }, `br-bot-${uid}`, { color: "#94A3B8", strokeWidth: 1.8, pageId })
  );
  const rowLabelText = `${rows} rows`;
  const rowLabel = textToStrokes(rowLabelText, { x: bracketLeftX - 12, y: center.y }, { color: textColor, size: 14, strokeWidth: 1.6, pageId });
  strokes.push(...centerStrokes(rowLabel, { x: bracketLeftX - 32, y: center.y }));

  // 3. Column bracket on top: "4 columns"
  const bracketTopY = startY - r - 18;
  const leftX = startX - r;
  const rightX = startX + gridW + r;
  strokes.push(
    createHandDrawnLine({ x: leftX, y: bracketTopY + 5 }, { x: leftX, y: bracketTopY }, `bc-left-${uid}`, { color: "#94A3B8", strokeWidth: 1.8, pageId }),
    createHandDrawnLine({ x: leftX, y: bracketTopY }, { x: rightX, y: bracketTopY }, `bc-h-${uid}`, { color: "#94A3B8", strokeWidth: 1.8, pageId }),
    createHandDrawnLine({ x: rightX, y: bracketTopY }, { x: rightX, y: bracketTopY + 5 }, `bc-right-${uid}`, { color: "#94A3B8", strokeWidth: 1.8, pageId })
  );
  const colLabelText = `${cols} each`;
  const colLabel = textToStrokes(colLabelText, { x: center.x, y: bracketTopY - 14 }, { color: textColor, size: 14, strokeWidth: 1.6, pageId });
  strokes.push(...centerStrokes(colLabel, { x: center.x, y: bracketTopY - 14 }));

  return strokes;
}

// ─────────────────────────────────────────────────────────────
// 2. TEN-FRAME MODEL (Early Addition & Place Value: Grade 1–2)
// ─────────────────────────────────────────────────────────────

export interface TenFrameOptions extends BaseSketchOptions {
  center?: Point;
  count?: number;        // Primary counters (e.g. 8 in blue)
  addCount?: number;     // Secondary counters (e.g. 5 in orange)
  cellSize?: number;     // Width & height of each cell (default 36)
  primaryColor?: string;
  secondaryColor?: string;
  textColor?: string;
}

export function createTenFrameStrokes(options: TenFrameOptions = {}): Stroke[] {
  const center = options.center || { x: 400, y: 250 };
  const count = Math.max(0, options.count ?? 7);
  const addCount = Math.max(0, options.addCount ?? 0);
  const total = count + addCount;
  const cellSize = options.cellSize || 38;
  const primaryColor = options.primaryColor || "#38BDF8";
  const secondaryColor = options.secondaryColor || "#F59E0B";
  const frameColor = options.color || "#64748B";
  const pageId = options.pageId || "";
  const uid = Date.now().toString(36);

  const strokes: Stroke[] = [];

  // Determine if we need 1 or 2 ten-frames (if total > 10)
  const numFrames = total > 10 ? 2 : 1;
  const frameW = 5 * cellSize;
  const frameH = 2 * cellSize;
  const gap = 32;
  const totalW = numFrames * frameW + (numFrames - 1) * gap;
  const startX = center.x - totalW / 2;
  const startY = center.y - frameH / 2;

  let placedPrimary = 0;
  let placedSecondary = 0;

  for (let f = 0; f < numFrames; f++) {
    const fX = startX + f * (frameW + gap);
    const fY = startY;

    // Outer border of 10-frame
    const outerCorners: Point[] = [
      { x: fX, y: fY },
      { x: fX + frameW, y: fY },
      { x: fX + frameW, y: fY + frameH },
      { x: fX, y: fY + frameH },
    ];
    strokes.push(...createHandDrawnPolygon(outerCorners, `tf-outer-${uid}-${f}`, { color: frameColor, strokeWidth: 2.2, pageId }));

    // Horizontal divider dividing the 2 rows
    strokes.push(
      createHandDrawnLine({ x: fX, y: fY + cellSize }, { x: fX + frameW, y: fY + cellSize }, `tf-hdiv-${uid}-${f}`, { color: frameColor, strokeWidth: 1.8, pageId })
    );

    // Vertical dividers creating the 5 columns
    for (let c = 1; c < 5; c++) {
      const vX = fX + c * cellSize;
      strokes.push(
        createHandDrawnLine({ x: vX, y: fY }, { x: vX, y: fY + frameH }, `tf-vdiv-${uid}-${f}-${c}`, { color: frameColor, strokeWidth: 1.8, pageId })
      );
    }

    // Counters: fill row 0 left-to-right (5 items), then row 1 left-to-right (5 items)
    for (let rIdx = 0; rIdx < 2; rIdx++) {
      for (let cIdx = 0; cIdx < 5; cIdx++) {
        let dotColor: string | null = null;
        if (placedPrimary < count) {
          dotColor = primaryColor;
          placedPrimary++;
        } else if (placedSecondary < addCount) {
          dotColor = secondaryColor;
          placedSecondary++;
        }

        if (dotColor) {
          const dotCenter = {
            x: fX + (cIdx + 0.5) * cellSize,
            y: fY + (rIdx + 0.5) * cellSize,
          };
          const dotId = `tf-dot-${uid}-${f}-${rIdx}-${cIdx}`;
          strokes.push(
            createHandDrawnCircle(dotCenter, cellSize * 0.32, dotId, {
              color: dotColor,
              strokeWidth: 2,
              pageId,
            })
          );
          strokes.push({
            id: `${dotId}-glow`,
            page_id: pageId,
            tool: "highlighter",
            color: dotColor,
            size: 8,
            points: [
              { x: dotCenter.x - cellSize * 0.16, y: dotCenter.y },
              { x: dotCenter.x + cellSize * 0.16, y: dotCenter.y },
            ],
          });
        }
      }
    }
  }

  return strokes;
}

// ─────────────────────────────────────────────────────────────
// 3. TAPE DIAGRAM / BAR MODEL (Word Problems: Grade 2–5)
// ─────────────────────────────────────────────────────────────

export interface TapeDiagramPart {
  label: string;
  value?: number;
  color?: string;
}

export interface TapeDiagramOptions extends BaseSketchOptions {
  center?: Point;
  width?: number;
  height?: number;
  parts?: TapeDiagramPart[];
  totalLabel?: string;
  textColor?: string;
}

export function createTapeDiagramStrokes(options: TapeDiagramOptions = {}): Stroke[] {
  const center = options.center || { x: 400, y: 250 };
  const w = options.width || 360;
  const h = options.height || 54;
  const parts = options.parts && options.parts.length > 0 ? options.parts : [
    { label: "Part A", value: 3, color: "#38BDF8" },
    { label: "Part B", value: 5, color: "#10B981" },
  ];
  const barColor = options.color || "#EDEDED";
  const textColor = options.textColor || "#EDEDED";
  const pageId = options.pageId || "";
  const uid = Date.now().toString(36);

  const strokes: Stroke[] = [];

  const left = center.x - w / 2;
  const top = center.y - h / 2;

  // Calculate proportional widths
  const sumValues = parts.reduce((acc, p) => acc + (p.value ?? 1), 0);
  const safeSum = Math.max(1, sumValues);

  // Outer border
  const outerCorners: Point[] = [
    { x: left, y: top },
    { x: left + w, y: top },
    { x: left + w, y: top + h },
    { x: left, y: top + h },
  ];
  strokes.push(...createHandDrawnPolygon(outerCorners, `tape-box-${uid}`, { color: barColor, strokeWidth: 2.2, pageId }));

  let currLeft = left;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const partW = ((part.value ?? 1) / safeSum) * w;
    const partColor = part.color || "#38BDF8";

    // Divider line between segments (except last)
    if (i < parts.length - 1) {
      strokes.push(
        createHandDrawnLine({ x: currLeft + partW, y: top }, { x: currLeft + partW, y: top + h }, `tape-div-${uid}-${i}`, { color: "#94A3B8", strokeWidth: 1.8, pageId })
      );
    }

    // Label inside each segment
    const segCenter = { x: currLeft + partW / 2, y: center.y };
    const labelStrokes = textToStrokes(part.label, segCenter, { color: partColor, size: 14, strokeWidth: 1.6, pageId });
    strokes.push(...centerStrokes(labelStrokes, segCenter));

    currLeft += partW;
  }

  // Underneath bracket indicating total
  const bracketY = top + h + 14;
  strokes.push(
    createHandDrawnLine({ x: left + 2, y: bracketY }, { x: left + w - 2, y: bracketY }, `tape-br-h-${uid}`, { color: "#94A3B8", strokeWidth: 1.8, pageId }),
    createHandDrawnLine({ x: left + 2, y: bracketY - 5 }, { x: left + 2, y: bracketY + 4 }, `tape-br-l-${uid}`, { color: "#94A3B8", strokeWidth: 1.8, pageId }),
    createHandDrawnLine({ x: left + w - 2, y: bracketY - 5 }, { x: left + w - 2, y: bracketY + 4 }, `tape-br-r-${uid}`, { color: "#94A3B8", strokeWidth: 1.8, pageId })
  );

  const totalText = options.totalLabel || (parts.length === 2 && parts[0].value && parts[1].value ? `Total = ${parts[0].value + parts[1].value}` : "Whole");
  const totStrokes = textToStrokes(totalText, { x: center.x, y: bracketY + 16 }, { color: textColor, size: 15, strokeWidth: 1.6, pageId });
  strokes.push(...centerStrokes(totStrokes, { x: center.x, y: bracketY + 16 }));

  return strokes;
}

// ─────────────────────────────────────────────────────────────
// 4. RIGHT-ANGLED TRIANGLE (Geometry & Pythagorean: Grade 4–5)
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
    const labelAStrokes = rawAStrokes.map((stk) => ({
      ...stk,
      points: stk.points.map((p) => ({ x: p.x + dxA, y: p.y + dyA })),
    }));
    strokes.push(...labelAStrokes);
  }

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
    const labelBStrokes = rawBStrokes.map((stk) => ({
      ...stk,
      points: stk.points.map((p) => ({ x: p.x + dxB, y: p.y + dyB })),
    }));
    strokes.push(...labelBStrokes);
  }

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
    const labelCStrokes = rawCStrokes.map((stk) => ({
      ...stk,
      points: stk.points.map((p) => ({ x: p.x + dxC, y: p.y + dyC })),
    }));
    strokes.push(...labelCStrokes);
  }

  return strokes;
}

// ─────────────────────────────────────────────────────────────
// 5. FRACTION CIRCLE (Partitions & Wholes: Grade 3–5)
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
  strokes.push(
    createHandDrawnLine(
      { x: center.x, y: center.y - r },
      { x: center.x, y: center.y + r },
      `frac-div-v-${uid}`,
      { color: "#A1A1AA", strokeWidth: 2.2, pageId }
    )
  );

  if (totalParts === 4) {
    strokes.push(
      createHandDrawnLine(
        { x: center.x - r, y: center.y },
        { x: center.x + r, y: center.y },
        `frac-div-h-${uid}`,
        { color: "#A1A1AA", strokeWidth: 2.2, pageId }
      )
    );
  }

  // 3. Shading strokes
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

  // 4. Handwritten stacked fraction values inside partitions
  if (totalParts === 2) {
    const rawLeft = textToStrokes(
      "\\frac{1}{2}",
      { x: 0, y: 0 },
      { color: textColor, size: 22, strokeWidth: 2.2, pageId }
    );
    const leftFrac = centerStrokes(rawLeft, { x: center.x - r * 0.48, y: center.y });

    const rawRight = textToStrokes(
      "\\frac{1}{2}",
      { x: 0, y: 0 },
      { color: circleColor, size: 22, strokeWidth: 2.2, pageId }
    );
    const rightFrac = centerStrokes(rawRight, { x: center.x + r * 0.48, y: center.y });

    strokes.push(...leftFrac, ...rightFrac);
  } else if (totalParts === 4) {
    const q0 = textToStrokes("\\frac{1}{4}", { x: 0, y: 0 }, { color: 0 < shadedParts ? textColor : "#94A3B8", size: 18, strokeWidth: 2, pageId });
    const q1 = textToStrokes("\\frac{1}{4}", { x: 0, y: 0 }, { color: 1 < shadedParts ? textColor : "#94A3B8", size: 18, strokeWidth: 2, pageId });
    const q2 = textToStrokes("\\frac{1}{4}", { x: 0, y: 0 }, { color: 2 < shadedParts ? textColor : "#94A3B8", size: 18, strokeWidth: 2, pageId });
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
// 6. FRACTION BAR / STRIP (Length Model: Grade 3–5)
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

  // 3. Shading strokes across the shaded partitions
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
    strokes.push(
      createHandDrawnLine(
        { x: left + 2, y: bracketY },
        { x: left + shadedW - 2, y: bracketY },
        `frac-bar-bracket-span-${uid}`,
        { color: shadeColor, strokeWidth: 1.8, pageId }
      )
    );
    strokes.push(
      createHandDrawnLine(
        { x: left + 2, y: bracketY - 6 },
        { x: left + 2, y: bracketY + 4 },
        `frac-bar-bracket-left-${uid}`,
        { color: shadeColor, strokeWidth: 1.8, pageId }
      )
    );
    strokes.push(
      createHandDrawnLine(
        { x: left + shadedW - 2, y: bracketY - 6 },
        { x: left + shadedW - 2, y: bracketY + 4 },
        `frac-bar-bracket-right-${uid}`,
        { color: shadeColor, strokeWidth: 1.8, pageId }
      )
    );
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
// 7. SLOPE-INTERCEPT & COORDINATE GRAPH (Intro Algebra: Grade 5+)
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
  const lineColor = options.lineColor || "#38BDF8";
  const axisColor = "#71717A";
  const interceptColor = "#F59E0B";
  const slopeColor = "#10B981";
  const pageId = options.pageId || "";
  const uid = Date.now().toString(36);

  const strokes: Stroke[] = [];

  // 1. Horizontal X-Axis
  const xLeft: Point = { x: center.x - w / 2, y: center.y };
  const xRight: Point = { x: center.x + w / 2, y: center.y };
  strokes.push(
    createHandDrawnLine(xLeft, xRight, `axis-x-${uid}`, { color: axisColor, strokeWidth: 2, pageId })
  );
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
  const xLabel = textToStrokes("x", { x: xRight.x + 8, y: xRight.y - 8 }, { color: axisColor, size: 16, strokeWidth: 1.8, pageId });
  strokes.push(...xLabel);

  // 2. Vertical Y-Axis
  const yBottom: Point = { x: center.x, y: center.y + h / 2 };
  const yTop: Point = { x: center.x, y: center.y - h / 2 };
  strokes.push(
    createHandDrawnLine(yBottom, yTop, `axis-y-${uid}`, { color: axisColor, strokeWidth: 2, pageId })
  );
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
  const bLabel = textToStrokes(
    options.interceptLabel || "b (y-intercept)",
    { x: center.x - 110, y: interceptPt.y - 10 },
    { color: interceptColor, size: 14, strokeWidth: 1.6, pageId }
  );
  strokes.push(...bLabel);
  strokes.push(
    createHandDrawnLine(
      { x: center.x - 18, y: interceptPt.y - 4 },
      { x: center.x - 6, y: interceptPt.y },
      `arrow-intercept-${uid}`,
      { color: interceptColor, strokeWidth: 1.6, pageId }
    )
  );

  // 6. Slope Triangle ("Rise over Run")
  const x1 = center.x + 25;
  const y1 = (center.y - bPx) - 25 * m;
  const x2 = center.x + 95;
  const y2 = (center.y - bPx) - 95 * m;

  strokes.push(
    createHandDrawnLine(
      { x: x1, y: y1 },
      { x: x2, y: y1 },
      `slope-run-${uid}`,
      { color: slopeColor, strokeWidth: 2.2, pageId }
    )
  );
  strokes.push(
    createHandDrawnLine(
      { x: x2, y: y1 },
      { x: x2, y: y2 },
      `slope-rise-${uid}`,
      { color: "#EF4444", strokeWidth: 2.2, pageId }
    )
  );
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

  const runLabel = textToStrokes(
    "run (Δx)",
    { x: (x1 + x2) / 2 - 20, y: y1 + 18 },
    { color: slopeColor, size: 14, strokeWidth: 1.6, pageId }
  );
  strokes.push(...runLabel);

  const riseLabel = textToStrokes(
    "rise (Δy)",
    { x: x2 + 12, y: (y1 + y2) / 2 - 6 },
    { color: "#EF4444", size: 14, strokeWidth: 1.6, pageId }
  );
  strokes.push(...riseLabel);

  return strokes;
}

// ─────────────────────────────────────────────────────────────
// 8. NUMBER LINE ARITHMETIC (Addition, Subtraction, Hops: Grade 1–4)
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

  const safeJumps = parsedJumps.filter(
    (j) => j.from >= calcStart && j.to <= calcEnd && j.from !== j.to
  );

  const count = Math.max(1, calcEnd - calcStart);
  const stepPx = w / count;

  const strokes: Stroke[] = [];

  // Equation Title: centered 92px above axis
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
    strokes.push(
      createHandDrawnLine(
        { x: xPos, y: center.y - 6 },
        { x: xPos, y: center.y + 6 },
        `numline-tick-${uid}-${val}`,
        { color: axisColor, strokeWidth: 1.8, pageId }
      )
    );
    const rawNumStrokes = textToStrokes(
      val.toString(),
      { x: xPos, y: center.y + 14 },
      { color: val === parsedHighlight ? "#F59E0B" : textColor, size: 20, strokeWidth: 2, pageId }
    );
    const boxNum = getStrokesBoundingBox(rawNumStrokes);
    const centeredNum = rawNumStrokes.map((stk) => ({
      ...stk,
      points: stk.points.map((p) => ({ x: p.x + (xPos - boxNum.centerX), y: p.y })),
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

    const rawLabelStrokes = textToStrokes(
      jump.label,
      { x: jMidX, y: jMidY - 14 },
      { color: jump.color || "#38BDF8", size: 19, strokeWidth: 2.2, pageId }
    );
    const boxLabel = getStrokesBoundingBox(rawLabelStrokes);
    const centeredLabel = rawLabelStrokes.map((stk) => ({
      ...stk,
      points: stk.points.map((p) => ({ x: p.x + (jMidX - boxLabel.centerX), y: p.y })),
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
// 9. CIRCLE GEOMETRY (Radius & Diameter: Grade 4–5)
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

  const rLabel = textToStrokes("r", { x: center.x + r / 2 - 4, y: center.y - 18 }, { color: "#F59E0B", size: 22, strokeWidth: 2.2, pageId });
  strokes.push(...rLabel);

  // 4. Diameter dashed line from left to center
  const dEdge: Point = { x: center.x - r, y: center.y };
  strokes.push(createHandDrawnLine(dEdge, center, `geom-circ-diam-${uid}`, { color: "#71717A", strokeWidth: 1.8, pageId }));

  const dLabel = textToStrokes("d = 2r", { x: center.x - r * 0.75, y: center.y + 14 }, { color: "#71717A", size: 18, strokeWidth: 1.8, pageId });
  strokes.push(...dLabel);

  return strokes;
}

