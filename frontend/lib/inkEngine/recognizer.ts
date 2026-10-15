/**
 * $P Point-Cloud Handwriting Intelligence Engine
 * Client-side browser-native ($0 GPU, <2ms CPU) character recognition
 * and early childhood letter/digit formation quality evaluator.
 * (PRD: JAWVEE LLM-Free Handwriting Intelligence Engine)
 */

import { Point, Stroke } from "../types";
import { textToStrokes } from "../handwritingEngine";

export interface ResampledPoint {
  x: number;
  y: number;
  strokeIndex: number;
}

export interface RecognitionResult {
  matchedChar: string;
  score: number; // 0.0 - 1.0 (1.0 = perfect match)
  confidence: number;
}

export interface FormationAssessment {
  char: string;
  isCorrectChar: boolean;
  confidence: number;
  expectedStrokeCount: number;
  actualStrokeCount: number;
  strokeCountMatch: boolean;
  directionScore: number; // 0.0 - 1.0
  overallQuality: number; // 0.0 - 1.0
  coachingFeedback: string;
  issues: string[];
}

const NUM_POINTS = 32;
const BOUNDING_BOX_SIZE = 100;

/**
 * Resamples stroke points into N equidistant points along the trajectory.
 */
export function resampleStrokePoints(strokes: Stroke[], n: number = NUM_POINTS): ResampledPoint[] {
  const allPts: ResampledPoint[] = [];
  for (let sIdx = 0; sIdx < strokes.length; sIdx++) {
    for (const pt of strokes[sIdx].points) {
      allPts.push({ x: pt.x, y: pt.y, strokeIndex: sIdx });
    }
  }

  if (allPts.length === 0) return [];
  if (allPts.length === 1) {
    return Array(n).fill({ ...allPts[0] });
  }

  // Calculate total path length
  let totalLength = 0;
  for (let i = 1; i < allPts.length; i++) {
    // Only calculate distance between points in the same stroke
    if (allPts[i].strokeIndex === allPts[i - 1].strokeIndex) {
      totalLength += Math.hypot(allPts[i].x - allPts[i - 1].x, allPts[i].y - allPts[i - 1].y);
    }
  }

  if (totalLength === 0) {
    return Array(n).fill({ ...allPts[0] });
  }

  const interval = totalLength / (n - 1);
  const resampled: ResampledPoint[] = [{ ...allPts[0] }];
  let accumulatedDist = 0;

  for (let i = 1; i < allPts.length; i++) {
    if (allPts[i].strokeIndex !== allPts[i - 1].strokeIndex) {
      continue;
    }

    const d = Math.hypot(allPts[i].x - allPts[i - 1].x, allPts[i].y - allPts[i - 1].y);
    if (accumulatedDist + d >= interval) {
      const qx = allPts[i - 1].x + ((interval - accumulatedDist) / d) * (allPts[i].x - allPts[i - 1].x);
      const qy = allPts[i - 1].y + ((interval - accumulatedDist) / d) * (allPts[i].y - allPts[i - 1].y);
      const newPt: ResampledPoint = { x: qx, y: qy, strokeIndex: allPts[i].strokeIndex };
      resampled.push(newPt);
      allPts.splice(i, 0, newPt);
      accumulatedDist = 0;
    } else {
      accumulatedDist += d;
    }
  }

  while (resampled.length < n) {
    resampled.push({ ...allPts[allPts.length - 1] });
  }

  return resampled.slice(0, n);
}

/**
 * Scales points uniformly to fit a standard bounding box.
 */
export function scalePointsToBox(points: ResampledPoint[], size: number = BOUNDING_BOX_SIZE): ResampledPoint[] {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }

  const w = Math.max(1e-4, maxX - minX);
  const h = Math.max(1e-4, maxY - minY);
  const scale = size / Math.max(w, h);

  return points.map((p) => ({
    x: (p.x - minX) * scale,
    y: (p.y - minY) * scale,
    strokeIndex: p.strokeIndex,
  }));
}

/**
 * Translates points so their centroid sits at (0, 0).
 */
export function translateToCentroid(points: ResampledPoint[]): ResampledPoint[] {
  let sumX = 0;
  let sumY = 0;
  for (const p of points) {
    sumX += p.x;
    sumY += p.y;
  }
  const cx = sumX / Math.max(1, points.length);
  const cy = sumY / Math.max(1, points.length);

  return points.map((p) => ({
    x: p.x - cx,
    y: p.y - cy,
    strokeIndex: p.strokeIndex,
  }));
}

/**
 * Normalized point cloud representation ready for sub-millisecond matching.
 */
export function normalizePointCloud(strokes: Stroke[]): ResampledPoint[] {
  const resampled = resampleStrokePoints(strokes, NUM_POINTS);
  const scaled = scalePointsToBox(resampled, BOUNDING_BOX_SIZE);
  return translateToCentroid(scaled);
}

/**
 * Greedy minimum Point-Cloud distance ($P Recognizer).
 * Computes average minimum Euclidean distance from each point in pts1 to pts2.
 */
function pointCloudDistance(pts1: ResampledPoint[], pts2: ResampledPoint[]): number {
  const n = pts1.length;
  const matched = new Array(n).fill(false);
  let sum = 0;

  for (let i = 0; i < n; i++) {
    let index = -1;
    let min = Infinity;
    for (let j = 0; j < n; j++) {
      if (!matched[j]) {
        const d = Math.hypot(pts1[i].x - pts2[j].x, pts1[i].y - pts2[j].y);
        if (d < min) {
          min = d;
          index = j;
        }
      }
    }
    if (index !== -1) {
      matched[index] = true;
      sum += min;
    }
  }

  return sum / n;
}

// ─── Standard Glyph Template Database ───
// Built directly from the vector handwriting engine for 100% mathematical consistency
const TEMPLATE_CHARS = [
  "0", "1", "2", "3", "4", "5", "6", "7", "8", "9",
  "A", "B", "C", "D", "E", "F", "G", "H", "I", "J",
  "K", "L", "M", "N", "O", "P", "Q", "R", "S", "T",
  "U", "V", "W", "X", "Y", "Z"
];

// Pre-compiled normalized point clouds
const TEMPLATE_CACHE: Map<string, { cloud: ResampledPoint[]; strokeCount: number }> = new Map();

function getTemplate(char: string): { cloud: ResampledPoint[]; strokeCount: number } | null {
  if (TEMPLATE_CACHE.has(char)) {
    return TEMPLATE_CACHE.get(char)!;
  }

  try {
    const strokes = textToStrokes(char, { x: 100, y: 100 }, { size: 100 });
    if (!strokes || strokes.length === 0) return null;
    const cloud = normalizePointCloud(strokes);
    const entry = { cloud, strokeCount: strokes.length };
    TEMPLATE_CACHE.set(char, entry);
    return entry;
  } catch {
    return null;
  }
}

// Pre-warm common elementary characters
for (const ch of TEMPLATE_CHARS) {
  getTemplate(ch);
}

/**
 * Recognizes a character from freehand strokes in <2ms on CPU.
 */
export function recognizeHandwriting(strokes: Stroke[]): RecognitionResult {
  if (!strokes || strokes.length === 0) {
    return { matchedChar: "", score: 0, confidence: 0 };
  }

  const candidateCloud = normalizePointCloud(strokes);
  let bestChar = "";
  let minDistance = Infinity;

  for (const ch of TEMPLATE_CHARS) {
    const tmpl = getTemplate(ch);
    if (!tmpl) continue;

    const dist = pointCloudDistance(candidateCloud, tmpl.cloud);
    if (dist < minDistance) {
      minDistance = dist;
      bestChar = ch;
    }
  }

  // Score mapping: distance 0 -> 1.0; distance 40 -> 0.0
  const score = Math.max(0, Math.min(1, 1 - minDistance / 40));
  const confidence = Math.round(score * 100);

  return {
    matchedChar: bestChar,
    score,
    confidence,
  };
}

/**
 * Evaluates the formation quality of student strokes against an expected character.
 * Analyzes stroke count, writing direction (top-to-bottom), and closure.
 */
export function evaluateFormationQuality(strokes: Stroke[], targetChar: string): FormationAssessment {
  const recognition = recognizeHandwriting(strokes);
  const tmpl = getTemplate(targetChar.toUpperCase());
  const expectedStrokes = tmpl ? tmpl.strokeCount : 1;
  const actualStrokes = strokes.length;
  const strokeCountMatch = actualStrokes === expectedStrokes;

  const issues: string[] = [];

  // 1. Stroke count assessment
  if (actualStrokes < expectedStrokes) {
    issues.push(`Expected ${expectedStrokes} strokes, but found ${actualStrokes}. Did you miss a stroke?`);
  } else if (actualStrokes > expectedStrokes + 1) {
    issues.push(`Too many separate strokes (${actualStrokes}). Try writing with smoother continuous strokes.`);
  }

  // 2. Stroke direction assessment (top-to-bottom rule)
  let directionScore = 1.0;
  if (strokes.length > 0 && strokes[0].points.length >= 2) {
    const firstStroke = strokes[0].points;
    const startY = firstStroke[0].y;
    const endY = firstStroke[firstStroke.length - 1].y;

    // In Latin letters & digits, most main stems start at the top and move down
    const shouldStartAtTop = !["O", "0", "8", "6", "S"].includes(targetChar.toUpperCase());
    if (shouldStartAtTop && startY > endY + 20) {
      directionScore = 0.45;
      issues.push("Remember to start your stroke at the top headline and move downward.");
    }
  }

  // 3. Closure assessment for loops (0, O, 8, 6, D, B)
  const isLoopChar = ["0", "O", "D", "8", "6", "B"].includes(targetChar.toUpperCase());
  if (isLoopChar && strokes.length > 0) {
    const loopStroke = strokes[0].points;
    if (loopStroke.length >= 4) {
      const startPt = loopStroke[0];
      const endPt = loopStroke[loopStroke.length - 1];
      const gap = Math.hypot(startPt.x - endPt.x, startPt.y - endPt.y);
      if (gap > 45) {
        issues.push("Make sure to close the loop all the way back to the start.");
      }
    }
  }

  // Overall Quality: weighted combination of shape match, stroke count, and direction
  const isCorrectChar = recognition.matchedChar.toUpperCase() === targetChar.toUpperCase();
  const shapeScore = isCorrectChar ? recognition.score : recognition.score * 0.4;
  const strokeBonus = strokeCountMatch ? 1.0 : actualStrokes === expectedStrokes + 1 ? 0.8 : 0.6;
  const overallQuality = Math.min(1, Math.max(0, shapeScore * 0.5 + strokeBonus * 0.3 + directionScore * 0.2));

  let coachingFeedback = "Super job! Your letter formation looks wonderful.";
  if (issues.length > 0) {
    coachingFeedback = issues[0];
  } else if (overallQuality < 0.65) {
    coachingFeedback = `Good effort! Take your time to follow the lines smoothly.`;
  }

  return {
    char: targetChar,
    isCorrectChar,
    confidence: recognition.confidence,
    expectedStrokeCount: expectedStrokes,
    actualStrokeCount: actualStrokes,
    strokeCountMatch,
    directionScore,
    overallQuality: Number(overallQuality.toFixed(2)),
    coachingFeedback,
    issues,
  };
}
