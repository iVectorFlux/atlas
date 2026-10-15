/**
 * Audio-Clock Performance Director
 * Schedules and synchronizes visual drawing, laser pointer tracking, and
 * object highlights directly against the Web Audio media playback clock.
 * (PRD Section 17 & 18 - Audio-Clock Synchronization & Teaching Director)
 */

import {
  PerformancePlaybackState,
  TeachingPerformancePlan,
  PerformanceAnchor,
  InterruptionSnapshot,
} from "./performanceTypes";
import { sceneManager } from "./sceneManager";

export class PerformanceDirector {
  private activePlan: TeachingPerformancePlan | null = null;
  private lastInterruptionSnapshot: InterruptionSnapshot | null = null;
  private state: PerformancePlaybackState = {
    isPlaying: false,
    currentTimeMs: 0,
    totalDurationMs: 0,
    activeAnchorId: null,
    activeTargetObjectId: null,
    pointerTarget: null,
    highlightedObjectId: null,
  };

  private listeners: Set<(state: PerformancePlaybackState) => void> = new Set();
  private triggeredAnchors: Set<string> = new Set();

  /**
   * Sets and arms a new TeachingPerformancePlan for audio-clock execution.
   */
  public armPlan(plan: TeachingPerformancePlan, actualAudioDurationMs?: number): void {
    this.activePlan = plan;
    this.triggeredAnchors.clear();
    const duration = actualAudioDurationMs || plan.durationEstimateMs;

    this.state = {
      isPlaying: true,
      currentTimeMs: 0,
      totalDurationMs: duration,
      activeAnchorId: null,
      activeTargetObjectId: null,
      pointerTarget: null,
      highlightedObjectId: null,
    };

    this.notify();
  }

  /**
   * Called continuously by Web Audio or HTMLAudioElement timeupdate / requestAnimationFrame.
   * This is the authoritative media clock that drives visual performance actions.
   */
  public tick(currentTimeMs: number, totalDurationMs?: number): void {
    if (!this.activePlan || !this.state.isPlaying) return;

    const total = totalDurationMs || this.state.totalDurationMs || this.activePlan.durationEstimateMs;
    const progressFraction = Math.max(0, Math.min(1, currentTimeMs / Math.max(1, total)));

    this.state.currentTimeMs = currentTimeMs;
    this.state.totalDurationMs = total;

    // Check if any anchors have been reached along the speech timeline
    const anchors = this.activePlan.anchors;
    let currentAnchor: PerformanceAnchor | null = null;

    for (let i = anchors.length - 1; i >= 0; i--) {
      const a = anchors[i];
      const startFrac = a.startFraction ?? 0;
      if (progressFraction >= startFrac) {
        currentAnchor = a;
        break;
      }
    }

    if (currentAnchor && currentAnchor.id !== this.state.activeAnchorId) {
      this.activateAnchor(currentAnchor);
    }

    // Auto-complete when audio finishes
    if (progressFraction >= 1.0) {
      this.complete();
    }
  }

  /**
   * Activates a visual action bound to a speech anchor.
   */
  private activateAnchor(anchor: PerformanceAnchor): void {
    this.state.activeAnchorId = anchor.id;
    this.state.activeTargetObjectId = anchor.targetObjectId;

    // Resolve target coordinates using the authoritative Scene Graph
    let targetX = 400;
    let targetY = 250;
    let message = anchor.triggerWord;

    const targetObj = sceneManager.getObject(anchor.targetObjectId);
    if (targetObj && targetObj.bounds) {
      if (Number.isFinite(targetObj.bounds.centerX)) targetX = targetObj.bounds.centerX;
      if (Number.isFinite(targetObj.bounds.centerY)) targetY = targetObj.bounds.centerY;
      if (targetObj.label) message = targetObj.label;
    } else {
      // Fallback: check if target is a generic role or semanticType
      const tid = (anchor.targetObjectId || "").toLowerCase();
      const allObjs = sceneManager.getObjects().filter((o) => o.visible !== false);
      const matched = allObjs.find((o) => {
        const oRole = (o.role || "").toLowerCase();
        const oType = (o.type || "").toLowerCase();
        const oSem = (o.semanticType || "").toLowerCase();
        return (
          o.id === anchor.targetObjectId ||
          oRole === tid ||
          oType === tid ||
          oSem.includes(tid) ||
          (tid === "visual_model" && (oType === "diagram" || oRole === "visual_model")) ||
          (tid === "equation" && (oType === "equation" || oType === "math" || oRole === "primary_concept")) ||
          (tid === "conclusion" && oRole === "conclusion") ||
          (tid === "title" && (oRole === "title" || oSem.includes("title")))
        );
      });

      if (matched && matched.bounds) {
        if (Number.isFinite(matched.bounds.centerX)) targetX = matched.bounds.centerX;
        if (Number.isFinite(matched.bounds.centerY)) targetY = matched.bounds.centerY;
        if (matched.label) message = matched.label;
      } else if (allObjs.length > 0) {
        // If specific target not found, pick the visual model or first prominent object
        const prominent = allObjs.find((o) => o.role === "visual_model" || o.type === "diagram") || allObjs[0];
        if (prominent && prominent.bounds) {
          if (Number.isFinite(prominent.bounds.centerX)) targetX = prominent.bounds.centerX;
          if (Number.isFinite(prominent.bounds.centerY)) targetY = prominent.bounds.centerY;
          if (prominent.label) message = prominent.label;
        }
      }
    }

    // Set pointerTarget in virtual canvas coordinates (1:1 with canvas objects & strokes)
    const finalX = Number.isFinite(targetX) ? Math.round(targetX) : 400;
    const finalY = Number.isFinite(targetY) ? Math.round(targetY) : 250;
    this.state.pointerTarget = {
      x: finalX,
      y: finalY,
      message,
    };

    if (anchor.action === "pulse_highlight" || anchor.action === "point_to") {
      this.state.highlightedObjectId = anchor.targetObjectId;
    }

    this.notify();
  }

  /**
   * Gracefully completes the active performance.
   */
  public complete(): void {
    this.state.isPlaying = false;
    this.state.activeAnchorId = null;
    this.state.activeTargetObjectId = null;
    this.state.pointerTarget = null;
    this.state.highlightedObjectId = null;
    this.notify();
  }

  /**
   * Immediate interruption (barge-in): instantly halts speech tracking,
   * hides the laser pointer, clears highlights, and records an InterruptionSnapshot.
   */
  public interrupt(): InterruptionSnapshot | null {
    if (this.state.isPlaying || this.activePlan) {
      const targetObj = this.state.activeTargetObjectId
        ? sceneManager.getObject(this.state.activeTargetObjectId)
        : undefined;

      const progress = Math.min(
        1,
        Math.max(0, this.state.currentTimeMs / Math.max(1, this.state.totalDurationMs))
      );

      this.lastInterruptionSnapshot = {
        timestamp: Date.now(),
        interruptedAtMs: Math.round(this.state.currentTimeMs),
        activeAnchorId: this.state.activeAnchorId,
        targetObjectId: this.state.activeTargetObjectId,
        targetObjectLabel: targetObj?.label || (targetObj?.properties as any)?.text || targetObj?.semanticType,
        targetObjectRole: targetObj?.role,
        progressFraction: Number(progress.toFixed(3)),
        triggerWord: this.state.pointerTarget?.message,
      };
    }
    this.activePlan = null;
    this.complete();
    return this.lastInterruptionSnapshot;
  }

  public getLastInterruption(): InterruptionSnapshot | null {
    return this.lastInterruptionSnapshot;
  }

  public clearLastInterruption(): void {
    this.lastInterruptionSnapshot = null;
  }

  public getState(): PerformancePlaybackState {
    return { ...this.state };
  }

  public subscribe(listener: (state: PerformancePlaybackState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    const copy = this.getState();
    this.listeners.forEach((l) => {
      try {
        l(copy);
      } catch (err) {
        console.error("[PerformanceDirector] Listener error:", err);
      }
    });
  }
}

// Global shared singleton for teaching performance orchestration
export const performanceDirector = new PerformanceDirector();
