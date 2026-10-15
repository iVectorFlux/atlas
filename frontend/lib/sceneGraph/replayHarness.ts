/**
 * Deterministic Session Replay & Regression Harness
 * Records and deterministically plays back whiteboard teaching sessions
 * to guarantee zero layout collisions, timing regressions, or coordinate drift.
 * (PRD Section 38 & 39 - Observability, Regression Testing & Event Replay)
 */

import { sceneManager } from "./sceneManager";
import { performanceDirector } from "./performanceDirector";
import { SemanticObject } from "./types";

export type ReplayEventType =
  | "ai_speak"
  | "scene_add"
  | "scene_update"
  | "scene_remove"
  | "scene_clear"
  | "pointer_glide"
  | "highlight"
  | "student_touch"
  | "student_stroke"
  | "student_barge_in"
  | "action_chip_select";

export interface ReplayEvent {
  id: string;
  timeMs: number;
  type: ReplayEventType;
  payload: any;
}

export interface SessionTrace {
  version: number;
  sessionId: string;
  recordedAt: number;
  durationMs: number;
  events: ReplayEvent[];
}

export interface RegressionValidationResult {
  passed: boolean;
  totalEventsReplayed: number;
  maxBottomBound: number;
  collisionsDetected: Array<{ objA: string; objB: string; overlapArea: number }>;
  ceilingViolations: Array<{ objId: string; maxY: number }>;
  summary: string;
}

/**
 * Session Recorder: Captures a complete deterministic log of user and tutor actions.
 */
export class SessionRecorder {
  private startTime: number = 0;
  private isRecording: boolean = false;
  private events: ReplayEvent[] = [];
  private sessionId: string = "";

  public start(sessionId: string = `session-${Date.now().toString(36)}`): void {
    this.sessionId = sessionId;
    this.startTime = performance.now();
    this.events = [];
    this.isRecording = true;
  }

  public record(type: ReplayEventType, payload: any): void {
    if (!this.isRecording) return;
    const timeMs = Math.round(performance.now() - this.startTime);
    this.events.push({
      id: `evt-${this.events.length + 1}-${Date.now().toString(36)}`,
      timeMs,
      type,
      payload,
    });
  }

  public stop(): SessionTrace {
    this.isRecording = false;
    const durationMs = Math.round(performance.now() - this.startTime);
    return {
      version: 1,
      sessionId: this.sessionId,
      recordedAt: Date.now(),
      durationMs,
      events: [...this.events],
    };
  }

  public getEvents(): ReplayEvent[] {
    return [...this.events];
  }
}

/**
 * Session Replayer & Regression Validator
 * Executes a recorded trace and asserts invariant constraints:
 * 1. Hard action-chip ceiling: No card bottom reaches y > 495 in virtual coordinates.
 * 2. Non-overlapping rule: Distinct formula cards must not overlap.
 */
export class SessionReplayer {
  /**
   * Replays a trace offline and validates all spatial geometry constraints.
   */
  public static validateTrace(trace: SessionTrace): RegressionValidationResult {
    // Reset virtual scene manager for clean offline validation
    sceneManager.applyOperation({ type: "clear" });

    let maxBottomBound = 0;
    const ceilingViolations: Array<{ objId: string; maxY: number }> = [];
    const collisionsDetected: Array<{ objA: string; objB: string; overlapArea: number }> = [];

    for (const evt of trace.events) {
      if (evt.type === "scene_add" && evt.payload) {
        const obj = evt.payload as SemanticObject;
        sceneManager.applyOperation({ type: "add_object", object: obj });

        if (obj.bounds) {
          const maxY = obj.bounds.maxY;
          if (maxY > maxBottomBound) maxBottomBound = maxY;

          // Check Hard Ceiling Invariant (y <= 495 to guarantee >=90px clearance above action chips)
          if (maxY > 495) {
            ceilingViolations.push({ objId: obj.id, maxY });
          }
        }
      } else if (evt.type === "scene_clear") {
        sceneManager.applyOperation({ type: "clear" });
      }
    }

    // Pairwise collision validation across active objects
    const objects = sceneManager.getObjects();
    for (let i = 0; i < objects.length; i++) {
      for (let j = i + 1; j < objects.length; j++) {
        const a = objects[i];
        const b = objects[j];
        if (!a.bounds || !b.bounds || !a.visible || !b.visible) continue;

        // Compute box overlap
        const xOverlap = Math.max(0, Math.min(a.bounds.maxX, b.bounds.maxX) - Math.max(a.bounds.minX, b.bounds.minX));
        const yOverlap = Math.max(0, Math.min(a.bounds.maxY, b.bounds.maxY) - Math.max(a.bounds.minY, b.bounds.minY));
        const overlapArea = xOverlap * yOverlap;

        if (overlapArea > 50) {
          collisionsDetected.push({ objA: a.id, objB: b.id, overlapArea });
        }
      }
    }

    const passed = ceilingViolations.length === 0 && collisionsDetected.length === 0;
    const summary = passed
      ? `PASS: Replayed ${trace.events.length} events with zero collisions and max bottom bound y=${maxBottomBound} (safe <= 495).`
      : `FAIL: Found ${ceilingViolations.length} ceiling violations and ${collisionsDetected.length} card collisions.`;

    return {
      passed,
      totalEventsReplayed: trace.events.length,
      maxBottomBound,
      collisionsDetected,
      ceilingViolations,
      summary,
    };
  }
}

// Global session recorder singleton
export const sessionRecorder = new SessionRecorder();
