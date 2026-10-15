import type { TutorStep } from "./types";

/**
 * Speech-locked whiteboard choreography.
 *
 * Splits a flat list of tutor steps into "beats" (e.g. [title + formula] →
 * [diagram ink] → [conclusion formula]) and inserts an `await_beat` gate
 * between them. Each gate releases when the tutor voice starts its next
 * spoken sentence (see useTutorPerformance.signalBeat), so each part of the
 * board appears while the teacher is talking about it.
 *
 * Ink beats are also stretched so the diagram is drawn at a natural pace
 * that roughly spans one spoken sentence, instead of finishing in <1s.
 */

const MAX_BEATS = 4;
const INK_BEAT_MIN_MS = 1800;
const INK_BEAT_MAX_MS = 4200;
const INK_STRETCH = 2.2;
const MAX_STROKE_MS = 1100;
const MAX_PAUSE_MS = 300;

function isCardStep(step: TutorStep): boolean {
  if (step.type !== "draw_shape" && step.type !== "type_text") return false;
  const p = step.payload;
  return !!p && (p.type === "math" || p.type === "text" || !!p.latex);
}

export interface ChoreographyOptions {
  /** Max time a beat gate waits for the next sentence while the voice is active */
  beatTimeoutMs?: number;
}

export function choreographToSpeech(steps: TutorStep[], opts: ChoreographyOptions = {}): TutorStep[] {
  if (steps.length === 0) return steps;

  // 1. Segment into alternating card / ink runs (pauses stick to the current run)
  const segments: TutorStep[][] = [];
  let current: TutorStep[] = [];
  let currentKind: "card" | "ink" | null = null;
  for (const step of steps) {
    if (step.type === "pause" || step.type === "await_beat") {
      if (step.type === "pause") current.push(step);
      continue;
    }
    const kind = isCardStep(step) ? "card" : "ink";
    if (currentKind !== null && kind !== currentKind && current.length > 0) {
      segments.push(current);
      current = [];
    }
    currentKind = kind;
    current.push(step);
  }
  if (current.length > 0) segments.push(current);

  // Cap the number of beats so a busy scene never stalls on too many gates
  while (segments.length > MAX_BEATS) {
    const tail = segments.pop()!;
    segments[segments.length - 1] = segments[segments.length - 1].concat(tail);
  }

  // 2. Stretch ink segments to a natural drawing pace
  const paced = segments.map((seg) => {
    if (!seg.some((s) => s.type === "draw_stroke")) return seg;
    const base = seg.reduce((sum, s) => sum + (s.duration || 0), 0);
    if (base <= 0) return seg;
    const target = Math.min(INK_BEAT_MAX_MS, Math.max(INK_BEAT_MIN_MS, base * INK_STRETCH));
    const factor = Math.max(1, target / base);
    return seg.map((s) => {
      if (!s.duration) return s;
      const cap = s.type === "draw_stroke" ? MAX_STROKE_MS : s.type === "pause" ? MAX_PAUSE_MS : s.duration;
      return { ...s, duration: Math.round(Math.min(cap, s.duration * factor)) };
    });
  });

  // 3. Join beats with speech gates
  const out: TutorStep[] = [];
  paced.forEach((seg, i) => {
    if (i > 0) out.push({ type: "await_beat", duration: opts.beatTimeoutMs ?? 4500 });
    out.push(...seg);
  });
  return out;
}
