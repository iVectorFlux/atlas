/**
 * Teaching Performance Protocol Data Contracts
 * Defines unified speech + visual action representations anchored to the audio clock.
 * (PRD Section 16 & 17)
 */

export interface PerformanceAnchor {
  id: string;
  targetObjectId: string;
  triggerWord: string;
  action: "point_to" | "pulse_highlight" | "trace" | "draw";
  startFraction?: number; // Estimated 0.0 - 1.0 fraction through the speech timeline
  durationMs?: number;
}

export interface VisualPerformanceAction {
  id: string;
  targetObjectId: string;
  action: "point_to" | "pulse_highlight" | "trace" | "draw";
  anchorId?: string;
  durationMs: number;
  label?: string;
}

export interface TeachingPerformancePlan {
  performanceId: string;
  baseWorldVersion: number;
  rawText: string;
  cleanSpeechText: string;
  anchors: PerformanceAnchor[];
  actions: VisualPerformanceAction[];
  durationEstimateMs: number;
}

export interface PerformancePlaybackState {
  isPlaying: boolean;
  currentTimeMs: number;
  totalDurationMs: number;
  activeAnchorId: string | null;
  activeTargetObjectId: string | null;
  pointerTarget: { x: number; y: number; message?: string } | null;
  highlightedObjectId: string | null;
}

export interface InterruptionSnapshot {
  timestamp: number;
  interruptedAtMs: number;
  activeAnchorId: string | null;
  targetObjectId: string | null;
  targetObjectLabel?: string;
  targetObjectRole?: string;
  progressFraction: number;
  triggerWord?: string;
}

