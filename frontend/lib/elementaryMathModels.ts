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
} from "./drawingPrimitives";
import { textToStrokes, centerStrokes } from "./handwritingEngine";

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
