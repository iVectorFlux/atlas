/**
 * handwritingEngine.ts — Procedural Vector Handwriting Engine
 *
 * Converts mathematical formulas, equations, numbers, and text into authentic
 * digital ink strokes (`Stroke: Point[]`) with natural human kinematics,
 * Catmull-Rom curve interpolation, slight italic slant, and micro-jitter.
 *
 * Supports:
 * - Digits: 0-9
 * - Letters: a-z, A-Z, Greek θ, π
 * - Operators: +, -, ×, *, /, =, ≠, <, >, (, ), [, ], ^, √, °
 * - Exponents: x^2, y^2, z^2, a^2 + b^2 = c^2
 * - LaTeX Fractions: \frac{a}{b} and stacked fractions
 * - Dynamic Viewport Centering
 */

import type { Stroke, Point } from "@/lib/types";

// Normalized stroke coordinate: [x, y] in [0..1, 0..1.2] coordinate space
export type NormalizedPoint = [number, number];
export type GlyphStrokes = NormalizedPoint[][];

/**
 * Normalized vector stroke definitions for glyphs.
 * Baseline is at y = 0.9.
 * Cap height is y = 0.15.
 * Ascenders reach y = 0.05, descenders reach y = 1.15.
 */
const GLYPH_DATA: Record<string, GlyphStrokes> = {
  // ─── DIGITS ───
  "0": [
    [
      [0.5, 0.15], [0.25, 0.25], [0.15, 0.52], [0.22, 0.8],
      [0.5, 0.9], [0.78, 0.8], [0.85, 0.52], [0.75, 0.25], [0.5, 0.15]
    ]
  ],
  "1": [
    [[0.32, 0.32], [0.5, 0.15]],
    [[0.5, 0.15], [0.5, 0.92]],
    [[0.25, 0.92], [0.75, 0.92]]
  ],
  "2": [
    [
      [0.2, 0.35], [0.35, 0.15], [0.7, 0.15], [0.82, 0.32],
      [0.75, 0.52], [0.2, 0.9], [0.85, 0.9]
    ]
  ],
  "3": [
    [
      [0.2, 0.22], [0.72, 0.16], [0.8, 0.35], [0.5, 0.48],
      [0.82, 0.62], [0.78, 0.85], [0.48, 0.92], [0.2, 0.85]
    ]
  ],
  "4": [
    [[0.68, 0.15], [0.18, 0.64]],
    [[0.14, 0.64], [0.86, 0.64]],
    [[0.68, 0.32], [0.68, 0.92]]
  ],
  "5": [
    [
      [0.78, 0.16], [0.28, 0.16], [0.24, 0.46], [0.65, 0.44],
      [0.82, 0.62], [0.78, 0.86], [0.48, 0.92], [0.2, 0.86]
    ]
  ],
  "6": [
    [
      [0.72, 0.2], [0.42, 0.38], [0.2, 0.65], [0.25, 0.88],
      [0.55, 0.92], [0.8, 0.78], [0.78, 0.55], [0.5, 0.48], [0.22, 0.65]
    ]
  ],
  "7": [
    [[0.16, 0.16], [0.84, 0.16]],
    [[0.84, 0.16], [0.42, 0.92]]
  ],
  "8": [
    [
      [0.5, 0.5], [0.3, 0.36], [0.35, 0.2], [0.5, 0.15],
      [0.68, 0.2], [0.7, 0.36], [0.5, 0.5], [0.25, 0.68],
      [0.3, 0.88], [0.5, 0.92], [0.72, 0.88], [0.75, 0.68], [0.5, 0.5]
    ]
  ],
  "9": [
    [
      [0.78, 0.45], [0.5, 0.48], [0.22, 0.35], [0.25, 0.18],
      [0.55, 0.15], [0.78, 0.25], [0.8, 0.7], [0.65, 0.9], [0.38, 0.92]
    ]
  ],

  // ─── OPERATORS & SYMBOLS ───
  "+": [
    [[0.5, 0.18], [0.5, 0.84]],
    [[0.16, 0.51], [0.84, 0.51]]
  ],
  "-": [
    [[0.16, 0.51], [0.84, 0.51]]
  ],
  "=": [
    [[0.16, 0.42], [0.84, 0.42]],
    [[0.16, 0.62], [0.84, 0.62]]
  ],
  "≠": [
    [[0.18, 0.42], [0.82, 0.42]],
    [[0.18, 0.62], [0.82, 0.62]],
    [[0.72, 0.25], [0.28, 0.79]]
  ],
  "×": [
    [[0.22, 0.26], [0.78, 0.78]],
    [[0.78, 0.26], [0.22, 0.78]]
  ],
  "*": [
    [[0.22, 0.26], [0.78, 0.78]],
    [[0.78, 0.26], [0.22, 0.78]],
    [[0.5, 0.2], [0.5, 0.84]]
  ],
  "/": [
    [[0.2, 0.9], [0.8, 0.15]]
  ],
  "÷": [
    [[0.18, 0.52], [0.82, 0.52]],
    [[0.5, 0.32], [0.5, 0.35]],
    [[0.5, 0.69], [0.5, 0.72]]
  ],
  "<": [
    [[0.8, 0.25], [0.2, 0.52], [0.8, 0.79]]
  ],
  ">": [
    [[0.2, 0.25], [0.8, 0.52], [0.2, 0.79]]
  ],
  "(": [
    [[0.68, 0.12], [0.38, 0.48], [0.68, 0.92]]
  ],
  ")": [
    [[0.32, 0.12], [0.62, 0.48], [0.32, 0.92]]
  ],
  "[": [
    [[0.65, 0.12], [0.35, 0.12], [0.35, 0.92], [0.65, 0.92]]
  ],
  "]": [
    [[0.35, 0.12], [0.65, 0.12], [0.65, 0.92], [0.35, 0.92]]
  ],
  "^": [
    [[0.22, 0.55], [0.5, 0.2], [0.78, 0.55]]
  ],
  "√": [
    [[0.1, 0.55], [0.22, 0.78], [0.45, 0.12], [0.95, 0.12]]
  ],
  "°": [
    [[0.5, 0.15], [0.3, 0.22], [0.5, 0.3], [0.7, 0.22], [0.5, 0.15]]
  ],
  "→": [
    [[0.05, 0.52], [0.95, 0.52]],
    [[0.68, 0.28], [0.95, 0.52], [0.68, 0.76]]
  ],
  "π": [
    [[0.15, 0.32], [0.85, 0.32]],
    [[0.35, 0.32], [0.32, 0.9]],
    [[0.68, 0.32], [0.75, 0.9]]
  ],
  "θ": [
    [
      [0.5, 0.15], [0.25, 0.35], [0.25, 0.7], [0.5, 0.9],
      [0.75, 0.7], [0.75, 0.35], [0.5, 0.15]
    ],
    [[0.25, 0.52], [0.75, 0.52]]
  ],
  "²": [
    [
      [0.2, 0.3], [0.4, 0.14], [0.75, 0.14], [0.8, 0.28],
      [0.7, 0.42], [0.2, 0.56], [0.85, 0.56]
    ]
  ],
  "³": [
    [
      [0.2, 0.18], [0.75, 0.15], [0.45, 0.33],
      [0.78, 0.42], [0.65, 0.58], [0.2, 0.54]
    ]
  ],
  ".": [
    [[0.35, 0.86], [0.55, 0.82], [0.65, 0.90], [0.45, 0.94], [0.35, 0.86]]
  ],
  ",": [
    [[0.5, 0.84], [0.52, 0.92], [0.38, 1.05]]
  ],
  ":": [
    [[0.42, 0.38], [0.58, 0.38], [0.58, 0.44], [0.42, 0.44], [0.42, 0.38]],
    [[0.42, 0.78], [0.58, 0.78], [0.58, 0.84], [0.42, 0.84], [0.42, 0.78]]
  ],
  "!": [
    [[0.5, 0.15], [0.5, 0.68]],
    [[0.42, 0.84], [0.58, 0.84], [0.58, 0.92], [0.42, 0.92], [0.42, 0.84]]
  ],
  "?": [
    [[0.22, 0.3], [0.4, 0.15], [0.7, 0.18], [0.75, 0.38], [0.5, 0.58], [0.5, 0.68]],
    [[0.42, 0.84], [0.58, 0.84], [0.58, 0.92], [0.42, 0.92], [0.42, 0.84]]
  ],
  ";": [
    [[0.44, 0.42], [0.56, 0.42], [0.56, 0.48], [0.44, 0.48], [0.44, 0.42]],
    [[0.5, 0.80], [0.52, 0.88], [0.38, 1.05]]
  ],
  "'": [
    [[0.5, 0.12], [0.44, 0.32]]
  ],
  "\"": [
    [[0.36, 0.12], [0.32, 0.32]],
    [[0.64, 0.12], [0.60, 0.32]]
  ],
  "%": [
    [[0.8, 0.15], [0.2, 0.88]],
    [[0.35, 0.2], [0.25, 0.3], [0.35, 0.4], [0.45, 0.3], [0.35, 0.2]],
    [[0.65, 0.65], [0.55, 0.75], [0.65, 0.85], [0.75, 0.75], [0.65, 0.65]]
  ],
  "$": [
    [[0.75, 0.28], [0.5, 0.15], [0.28, 0.32], [0.72, 0.65], [0.5, 0.88], [0.25, 0.78]],
    [[0.5, 0.08], [0.5, 0.94]]
  ],
  "&": [
    [[0.78, 0.88], [0.32, 0.42], [0.5, 0.15], [0.68, 0.32], [0.22, 0.75], [0.45, 0.9], [0.78, 0.62]]
  ],
  "{": [
    [[0.65, 0.12], [0.42, 0.2], [0.42, 0.45], [0.25, 0.5], [0.42, 0.55], [0.42, 0.82], [0.65, 0.9]]
  ],
  "}": [
    [[0.35, 0.12], [0.58, 0.2], [0.58, 0.45], [0.75, 0.5], [0.58, 0.55], [0.58, 0.82], [0.35, 0.9]]
  ],
  "_": [
    [[0.1, 0.96], [0.9, 0.96]]
  ],
  "|": [
    [[0.5, 0.12], [0.5, 0.92]]
  ],

  // ─── LOWERCASE VARIABLES & LETTERS ───
  "a": [
    [[0.72, 0.5], [0.45, 0.42], [0.25, 0.62], [0.42, 0.9], [0.72, 0.85]],
    [[0.72, 0.42], [0.72, 0.9]]
  ],
  "b": [
    [[0.25, 0.1], [0.25, 0.9]],
    [[0.25, 0.55], [0.55, 0.42], [0.78, 0.62], [0.55, 0.9], [0.25, 0.9]]
  ],
  "c": [
    [[0.75, 0.48], [0.5, 0.42], [0.25, 0.65], [0.45, 0.9], [0.75, 0.82]]
  ],
  "d": [
    [[0.75, 0.1], [0.75, 0.9]],
    [[0.75, 0.75], [0.5, 0.9], [0.25, 0.68], [0.5, 0.44], [0.75, 0.55]]
  ],
  "e": [
    [[0.22, 0.65], [0.78, 0.65], [0.72, 0.44], [0.45, 0.42], [0.22, 0.65], [0.45, 0.9], [0.78, 0.85]]
  ],
  "f": [
    [[0.68, 0.15], [0.45, 0.1], [0.4, 0.9]],
    [[0.25, 0.45], [0.65, 0.45]]
  ],
  "g": [
    [[0.72, 0.5], [0.45, 0.42], [0.25, 0.62], [0.45, 0.9], [0.72, 0.85]],
    [[0.72, 0.42], [0.72, 1.1], [0.4, 1.18], [0.25, 1.1]]
  ],
  "h": [
    [[0.25, 0.1], [0.25, 0.9]],
    [[0.25, 0.55], [0.55, 0.42], [0.75, 0.6], [0.75, 0.9]]
  ],
  "i": [
    [[0.5, 0.42], [0.5, 0.9]],
    [[0.5, 0.22], [0.5, 0.26]]
  ],
  "j": [
    [[0.65, 0.42], [0.65, 1.1], [0.4, 1.18], [0.25, 1.1]],
    [[0.65, 0.22], [0.65, 0.26]]
  ],
  "k": [
    [[0.25, 0.1], [0.25, 0.9]],
    [[0.72, 0.42], [0.28, 0.65], [0.75, 0.9]]
  ],
  "l": [
    [[0.45, 0.1], [0.45, 0.88], [0.6, 0.9]]
  ],
  "m": [
    [[0.18, 0.44], [0.18, 0.9]],
    [[0.18, 0.58], [0.35, 0.44], [0.48, 0.62], [0.48, 0.9]],
    [[0.48, 0.58], [0.68, 0.44], [0.82, 0.62], [0.82, 0.9]]
  ],
  "n": [
    [[0.25, 0.44], [0.25, 0.9]],
    [[0.25, 0.58], [0.55, 0.44], [0.75, 0.62], [0.75, 0.9]]
  ],
  "o": [
    [[0.5, 0.42], [0.25, 0.65], [0.5, 0.9], [0.75, 0.65], [0.5, 0.42]]
  ],
  "p": [
    [[0.25, 0.42], [0.25, 1.18]],
    [[0.25, 0.55], [0.55, 0.42], [0.78, 0.62], [0.55, 0.9], [0.25, 0.85]]
  ],
  "q": [
    [[0.75, 0.75], [0.5, 0.9], [0.25, 0.68], [0.5, 0.44], [0.75, 0.55]],
    [[0.75, 0.42], [0.75, 1.18], [0.85, 1.12]]
  ],
  "r": [
    [[0.28, 0.44], [0.28, 0.9]],
    [[0.28, 0.58], [0.55, 0.44], [0.75, 0.52]]
  ],
  "s": [
    [[0.72, 0.5], [0.45, 0.42], [0.28, 0.58], [0.68, 0.74], [0.5, 0.9], [0.24, 0.84]]
  ],
  "t": [
    [[0.45, 0.22], [0.45, 0.88], [0.65, 0.9]],
    [[0.25, 0.44], [0.68, 0.44]]
  ],
  "u": [
    [[0.25, 0.44], [0.25, 0.8], [0.5, 0.9], [0.75, 0.8], [0.75, 0.44]],
    [[0.75, 0.7], [0.75, 0.9]]
  ],
  "v": [
    [[0.2, 0.44], [0.5, 0.9], [0.8, 0.44]]
  ],
  "w": [
    [[0.15, 0.44], [0.35, 0.9], [0.5, 0.62], [0.65, 0.9], [0.85, 0.44]]
  ],
  "x": [
    [[0.22, 0.44], [0.78, 0.9]],
    [[0.78, 0.44], [0.22, 0.9]]
  ],
  "y": [
    [[0.22, 0.44], [0.48, 0.82]],
    [[0.78, 0.44], [0.28, 1.18]]
  ],
  "z": [
    [[0.22, 0.44], [0.78, 0.44], [0.22, 0.9], [0.78, 0.9]]
  ],

  // ─── UPPERCASE LETTERS ───
  "A": [
    [[0.5, 0.12], [0.18, 0.9]],
    [[0.5, 0.12], [0.82, 0.9]],
    [[0.3, 0.65], [0.7, 0.65]]
  ],
  "B": [
    [[0.25, 0.12], [0.25, 0.9]],
    [[0.25, 0.12], [0.65, 0.12], [0.75, 0.32], [0.58, 0.5], [0.25, 0.5]],
    [[0.25, 0.5], [0.68, 0.5], [0.78, 0.7], [0.65, 0.9], [0.25, 0.9]]
  ],
  "C": [
    [[0.8, 0.28], [0.52, 0.12], [0.22, 0.5], [0.52, 0.9], [0.82, 0.78]]
  ],
  "D": [
    [[0.25, 0.12], [0.25, 0.9]],
    [[0.25, 0.12], [0.58, 0.12], [0.82, 0.5], [0.58, 0.9], [0.25, 0.9]]
  ],
  "E": [
    [[0.78, 0.12], [0.25, 0.12], [0.25, 0.9], [0.8, 0.9]],
    [[0.25, 0.5], [0.68, 0.5]]
  ],
  "F": [
    [[0.25, 0.9], [0.25, 0.12], [0.8, 0.12]],
    [[0.25, 0.5], [0.68, 0.5]]
  ],
  "G": [
    [[0.8, 0.28], [0.52, 0.12], [0.22, 0.5], [0.52, 0.9], [0.8, 0.75], [0.8, 0.52], [0.55, 0.52]]
  ],
  "H": [
    [[0.25, 0.12], [0.25, 0.9]],
    [[0.75, 0.12], [0.75, 0.9]],
    [[0.25, 0.5], [0.75, 0.5]]
  ],
  "I": [
    [[0.3, 0.12], [0.7, 0.12]],
    [[0.5, 0.12], [0.5, 0.9]],
    [[0.3, 0.9], [0.7, 0.9]]
  ],
  "J": [
    [[0.3, 0.12], [0.78, 0.12]],
    [[0.62, 0.12], [0.62, 0.75], [0.48, 0.9], [0.28, 0.8]]
  ],
  "K": [
    [[0.25, 0.12], [0.25, 0.9]],
    [[0.78, 0.12], [0.28, 0.52]],
    [[0.35, 0.48], [0.8, 0.9]]
  ],
  "L": [
    [[0.28, 0.12], [0.28, 0.9], [0.78, 0.9]]
  ],
  "M": [
    [[0.2, 0.9], [0.2, 0.12], [0.5, 0.65], [0.8, 0.12], [0.8, 0.9]]
  ],
  "N": [
    [[0.22, 0.9], [0.22, 0.12], [0.78, 0.9], [0.78, 0.12]]
  ],
  "O": [
    [[0.5, 0.12], [0.2, 0.5], [0.5, 0.9], [0.8, 0.5], [0.5, 0.12]]
  ],
  "P": [
    [[0.25, 0.9], [0.25, 0.12], [0.65, 0.12], [0.78, 0.35], [0.65, 0.55], [0.25, 0.55]]
  ],
  "Q": [
    [[0.5, 0.12], [0.2, 0.5], [0.5, 0.9], [0.8, 0.5], [0.5, 0.12]],
    [[0.55, 0.65], [0.85, 0.96]]
  ],
  "R": [
    [[0.25, 0.9], [0.25, 0.12], [0.65, 0.12], [0.78, 0.35], [0.65, 0.55], [0.25, 0.55]],
    [[0.5, 0.55], [0.78, 0.9]]
  ],
  "S": [
    [[0.78, 0.28], [0.52, 0.12], [0.28, 0.32], [0.72, 0.65], [0.5, 0.9], [0.22, 0.78]]
  ],
  "T": [
    [[0.18, 0.12], [0.82, 0.12]],
    [[0.5, 0.12], [0.5, 0.9]]
  ],
  "U": [
    [[0.25, 0.12], [0.25, 0.75], [0.5, 0.9], [0.75, 0.75], [0.75, 0.12]]
  ],
  "V": [
    [[0.18, 0.12], [0.5, 0.9], [0.82, 0.12]]
  ],
  "W": [
    [[0.15, 0.12], [0.32, 0.9], [0.5, 0.45], [0.68, 0.9], [0.85, 0.12]]
  ],
  "X": [
    [[0.2, 0.12], [0.8, 0.9]],
    [[0.8, 0.12], [0.2, 0.9]]
  ],
  "Y": [
    [[0.2, 0.12], [0.5, 0.5], [0.8, 0.12]],
    [[0.5, 0.5], [0.5, 0.9]]
  ],
  "Z": [
    [[0.2, 0.12], [0.8, 0.12], [0.2, 0.9], [0.8, 0.9]]
  ],
};

export interface HandwritingOptions {
  color?: string;
  size?: number; // font height in px (e.g. 36)
  strokeWidth?: number; // line thickness (e.g. 2.5)
  slant?: number; // italic angle (e.g. 0.08)
  jitter?: number; // micro-variation (e.g. 0.6)
  pageId?: string;
}

/** Catmull-Rom spline interpolation between points */
function interpolateSpline(points: Point[], segmentsPerSpan = 4): Point[] {
  if (points.length < 2) return points;
  if (points.length === 2) {
    const p1 = points[0];
    const p2 = points[1];
    const res: Point[] = [];
    const count = 8;
    for (let s = 0; s <= count; s++) {
      const t = s / count;
      res.push({
        x: p1.x + (p2.x - p1.x) * t,
        y: p1.y + (p2.y - p1.y) * t,
      });
    }
    return res;
  }

  const result: Point[] = [];
  result.push(points[0]);

  for (let i = 0; i < points.length - 1; i++) {
    const p0 = i > 0 ? points[i - 1] : points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = i < points.length - 2 ? points[i + 2] : p2;

    for (let s = 1; s <= segmentsPerSpan; s++) {
      const t = s / segmentsPerSpan;
      const t2 = t * t;
      const t3 = t2 * t;

      // Catmull-Rom basis
      const x =
        0.5 *
        (2 * p1.x +
          (-p0.x + p2.x) * t +
          (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
          (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);
      const y =
        0.5 *
        (2 * p1.y +
          (-p0.y + p2.y) * t +
          (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
          (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3);

      result.push({ x, y });
    }
  }

  return result;
}

/** Simple pseudo-random hash generator for deterministic subtle jitter */
function pseudoJitter(seed: number, amplitude: number): number {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return (x - Math.floor(x) - 0.5) * 2 * amplitude;
}

/**
 * Convert a single glyph into real `Stroke` objects at position (x, y)
 */
function renderGlyphStrokes(
  char: string,
  originX: number,
  originY: number,
  scale: number,
  options: Required<HandwritingOptions>,
  seedOffset = 0
): { strokes: Stroke[]; advanceWidth: number } {
  const glyph = GLYPH_DATA[char] || GLYPH_DATA[char.toLowerCase()] || GLYPH_DATA[" "];
  const charWidth = scale * (
    char === " " ? 0.45 :
    char === "." ? 0.16 :
    char === "," ? 0.20 :
    char === ":" ? 0.25 :
    char === "→" ? 1.1 :
    char === "²" || char === "³" ? 0.42 :
    char === "m" || char === "w" || char === "W" || char === "M" ? 1.05 :
    0.72
  );

  if (!glyph || char === " ") {
    return { strokes: [], advanceWidth: charWidth };
  }

  const strokes: Stroke[] = [];
  const slant = options.slant;
  const jitterAmp = options.jitter;

  glyph.forEach((segment, segIdx) => {
    const rawPoints: Point[] = segment.map(([nx, ny], ptIdx) => {
      const baseY = originY + ny * scale;
      // Italic slant: x shifts right as y descends from top
      const slantOffset = (1 - ny) * scale * slant;
      const seed = seedOffset + segIdx * 10 + ptIdx;
      const jx = pseudoJitter(seed, jitterAmp);
      const jy = pseudoJitter(seed + 99, jitterAmp * 0.7);

      return {
        x: originX + nx * charWidth + slantOffset + jx,
        y: baseY + jy,
      };
    });

    const smoothedPoints = interpolateSpline(rawPoints, 3);

    strokes.push({
      id: `stroke-hw-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      page_id: options.pageId,
      tool: "pen",
      color: options.color,
      size: options.strokeWidth,
      points: smoothedPoints,
    });
  });

  const spacing = char === "." || char === "," ? scale * 0.08 : scale * 0.15;
  return { strokes, advanceWidth: charWidth + spacing };
}

function cleanLatexForHandwriting(raw: string): string {
  if (!raw) return "";
  let s = raw;

  // Strip math delimiter wrappers e.g. \( ... \), \[ ... \], $$ ... $$
  s = s.replace(/\\\[(.*?)\\\]/gs, "$1");
  s = s.replace(/\\\((.*?)\\\)/gs, "$1");
  s = s.replace(/\$\$(.*?)\$\$/gs, "$1");
  s = s.replace(/\$(.*?)\$/gs, "$1");

  // Replace \text{...}, \mathrm{...}, \mathbf{...}, \mathcal{...}, \boxed{...}
  s = s.replace(/\\?text\{([^}]+)\}/g, "$1");
  s = s.replace(/\\?mathrm\{([^}]+)\}/g, "$1");
  s = s.replace(/\\?mathbf\{([^}]+)\}/g, "$1");
  s = s.replace(/\\?mathcal\{([^}]+)\}/g, "$1");
  s = s.replace(/\\?mathcal\s+([A-Za-z])/g, "$1");
  s = s.replace(/\\?boxed\{([^}]+)\}/g, "$1");

  // \sqrt{...}
  s = s.replace(/\\?sqrt\{([^}]+)\}/g, "√($1)");

  // Arrow notation -> real arrow glyph (never spell out the word "arrow")
  s = s.replace(/\\(?:longrightarrow|Longrightarrow|rightarrow|Rightarrow|to|implies)(?![A-Za-z])/g, " → ");
  s = s.replace(/-->|->|=>|⟶|⇒/g, " → ");
  s = s.replace(/(?<=[^A-Za-z\s]|\s)\s*\barrows?\b\s*(?=[^A-Za-z]|\s)/gi, " → ");
  s = s.replace(/[ \t]{2,}(?=→)|(?<=→)[ \t]{2,}/g, " ");

  // Clean LaTeX spacing commands and punctuation
  s = s.replace(/\\quad/g, "  ");
  s = s.replace(/\\qquad/g, "   ");
  s = s.replace(/\\,/g, " ");
  s = s.replace(/\\;/g, " ");
  s = s.replace(/\\cdot/g, "·");
  s = s.replace(/\\times/g, "×");
  s = s.replace(/\\left|\\right/g, "");

  // Greek & math symbols
  s = s.replace(/\\?Phi_B\b/g, "Φ");
  s = s.replace(/\\?Phi\b/g, "Φ");
  s = s.replace(/\\?phi\b/g, "φ");
  s = s.replace(/\\?lambda\b/g, "λ");
  s = s.replace(/\\?theta\b/g, "θ");
  s = s.replace(/\\?pi\b/g, "π");
  s = s.replace(/\\?mu\b/g, "μ");
  s = s.replace(/\\?nu\b/g, "ν");
  s = s.replace(/\\?Delta\b/g, "Δ");
  s = s.replace(/\\?approx\b/g, "≈");
  s = s.replace(/\\?le\b/g, "≤");
  s = s.replace(/\\?ge\b/g, "≥");
  s = s.replace(/\\?neq\b/g, "≠");

  // Remove any remaining backslash commands except \frac which textToStrokes parses
  s = s.replace(/\\(?!frac\b)[A-Za-z]+/g, "");

  return s;
}

/**
 * Synthesizes genuine handwritten digital ink strokes for text or math expressions.
 * Supports superscript notation (e.g., "x^2 + y^2 = z^2" or "3^2 + 4^2 = 5^2").
 */
export function textToStrokes(
  text: string,
  origin: { x: number; y: number },
  options?: HandwritingOptions
): Stroke[] {
  const opts: Required<HandwritingOptions> = {
    color: options?.color || "#60A5FA",
    size: options?.size || 38,
    strokeWidth: options?.strokeWidth || 2.8,
    slant: options?.slant ?? 0.08,
    jitter: options?.jitter ?? 0.55,
    pageId: options?.pageId || "",
  };

  const sanitizedText = cleanLatexForHandwriting(text);
  const lines = sanitizedText.split("\n");
  const allStrokes: Stroke[] = [];
  const lineHeight = opts.size * 1.5;

  lines.forEach((line, lineIdx) => {
    let cursorX = origin.x;
    const cursorY = origin.y + lineIdx * lineHeight;
    let i = 0;

    while (i < line.length) {
      // Check for LaTeX fraction \frac{a}{b}
      if (line.slice(i).startsWith("\\frac")) {
        const fracMatch = line.slice(i).match(/^\\frac\{([^}]+)\}\{([^}]+)\}/);
        if (fracMatch) {
          const numText = fracMatch[1];
          const denText = fracMatch[2];
          const fracScale = opts.size * 0.65;

          // Render numerator above
          const numStrokes = textToStrokes(numText, { x: cursorX + 6, y: cursorY - opts.size * 0.35 }, {
            ...opts,
            size: fracScale,
            strokeWidth: opts.strokeWidth * 0.85,
          });
          const numBox = getStrokesBoundingBox(numStrokes);

          // Render denominator below
          const denStrokes = textToStrokes(denText, { x: cursorX + 6, y: cursorY + opts.size * 0.4 }, {
            ...opts,
            size: fracScale,
            strokeWidth: opts.strokeWidth * 0.85,
          });
          const denBox = getStrokesBoundingBox(denStrokes);

          const barWidth = Math.max(numBox.width, denBox.width, opts.size * 0.6) + 12;
          const barY = cursorY + opts.size * 0.45;

          // Fraction bar stroke
          const barStroke: Stroke = {
            id: `stroke-bar-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
            page_id: opts.pageId,
            tool: "pen",
            color: opts.color,
            size: opts.strokeWidth,
            points: [
              { x: cursorX, y: barY },
              { x: cursorX + barWidth * 0.5, y: barY + pseudoJitter(i, 0.4) },
              { x: cursorX + barWidth, y: barY },
            ],
          };

          allStrokes.push(...numStrokes, barStroke, ...denStrokes);
          cursorX += barWidth + opts.size * 0.2;
          i += fracMatch[0].length;
          continue;
        }
      }

      // Check for exponent/superscript e.g. ^2, ^3, ^{12}
      if (line[i] === "^") {
        let expText = "";
        let skipLen = 1;
        if (line[i + 1] === "{") {
          const closeIdx = line.indexOf("}", i + 2);
          if (closeIdx !== -1) {
            expText = line.slice(i + 2, closeIdx);
            skipLen = closeIdx - i + 1;
          }
        } else if (i + 1 < line.length) {
          expText = line[i + 1];
          skipLen = 2;
        }

        if (expText) {
          const expScale = opts.size * 0.58;
          const expStrokes = textToStrokes(expText, { x: cursorX, y: cursorY - opts.size * 0.42 }, {
            ...opts,
            size: expScale,
            strokeWidth: opts.strokeWidth * 0.8,
          });
          allStrokes.push(...expStrokes);
          const expBox = getStrokesBoundingBox(expStrokes);
          cursorX += (expBox.width || expScale * 0.6) + opts.size * 0.08;
          i += skipLen;
          continue;
        }
      }

      const char = line[i];
      const { strokes, advanceWidth } = renderGlyphStrokes(
        char,
        cursorX,
        cursorY,
        opts.size,
        opts,
        lineIdx * 100 + i
      );
      allStrokes.push(...strokes);
      cursorX += advanceWidth;
      i++;
    }
  });

  return allStrokes;
}

/** Compute tight axis-aligned bounding box for a set of strokes */
export function getStrokesBoundingBox(strokes: Stroke[]): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
} {
  if (strokes.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0, centerX: 0, centerY: 0 };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const s of strokes) {
    for (const p of s.points) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }

  const width = Math.max(0, maxX - minX);
  const height = Math.max(0, maxY - minY);

  return {
    minX,
    minY,
    maxX,
    maxY,
    width,
    height,
    centerX: minX + width / 2,
    centerY: minY + height / 2,
  };
}

/**
 * Translate a collection of strokes so its center aligns with `targetCenter`.
 * Essential for placing handwritten content precisely in the center of the viewport.
 */
export function centerStrokes(
  strokes: Stroke[],
  targetCenter: { x: number; y: number }
): Stroke[] {
  const box = getStrokesBoundingBox(strokes);
  if (box.width === 0 && box.height === 0) return strokes;

  const dx = targetCenter.x - box.centerX;
  const dy = targetCenter.y - box.centerY;

  return strokes.map((s) => ({
    ...s,
    points: s.points.map((p) => ({
      ...p,
      x: p.x + dx,
      y: p.y + dy,
    })),
  }));
}
