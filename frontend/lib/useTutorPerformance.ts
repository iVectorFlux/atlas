"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import type { TutorPerformance, TutorStep, AiPointerState, CanvasObject, Stroke } from "@/lib/types";

interface UseTutorPerformanceOptions {
  /** Called when an animated shape/text finishes and should be committed */
  onObjectCommit: (obj: CanvasObject) => void;
  /** Called when an animated stroke finishes and should be committed */
  onStrokeCommit?: (stroke: Stroke) => void;
  /** Whether tutor voice audio is currently active (controls how long beat gates wait) */
  isVoiceActive?: () => boolean;
}

interface UseTutorPerformanceReturn {
  /** Current AI pointer state for the overlay */
  pointerState: AiPointerState;
  /** The step currently being animated (null if idle) */
  activeStep: TutorStep | null;
  /** Whether a performance is currently playing */
  isPlaying: boolean;
  /** Queue a new performance for playback */
  enqueue: (performance: TutorPerformance) => void;
  /** Update pointer position in real time (e.g., following stroke tip) */
  updatePointer: (x: number, y: number) => void;
  /** Advance to next step when current step completes */
  handleStepComplete: () => void;
  /** Skip to the end of the current performance (user tap) */
  skip: () => void;
  /** Fast-path barge-in interruption with >=80% state reconciliation */
  interrupt: () => void;
  /** Cancel all queued performances */
  cancelAll: () => void;
  /** Signal that the tutor voice started a new spoken sentence (releases the next await_beat gate) */
  signalBeat: () => void;
  /** Reset pending speech beats (call when a new performance is launched in sync with audio) */
  resetBeats: () => void;
}

const IDLE_POINTER: AiPointerState = {
  x: -100,
  y: -100,
  visible: false,
  phase: "idle",
};

/**
 * useTutorPerformance — orchestrates a queue of TutorPerformance sequences.
 *
 * Each performance is a list of TutorSteps that play sequentially:
 *  1. move_pointer → spring-animate the AI cursor to a target
 *  2. draw_shape  → animate a shape appearing stroke-by-stroke
 *  3. draw_stroke → animate a freehand stroke point-by-point with cursor tracking
 *  4. type_text   → typewriter animation
 *  5. highlight   → pulse the pointer at a location with a message
 *  6. pause       → hold for a duration
 *
 * When the user taps the canvas during a skippable performance,
 * all remaining ops are committed instantly.
 */
export function useTutorPerformance({
  onObjectCommit,
  onStrokeCommit,
  isVoiceActive,
}: UseTutorPerformanceOptions): UseTutorPerformanceReturn {
  const [pointerState, setPointerState] = useState<AiPointerState>(IDLE_POINTER);
  const [activeStep, setActiveStep] = useState<TutorStep | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  const queueRef = useRef<TutorPerformance[]>([]);
  const currentPerformanceRef = useRef<TutorPerformance | null>(null);
  const stepIndexRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Speech beat gating: sentence starts that arrived before a gate are banked as credits
  const beatCreditsRef = useRef(0);
  const beatWaiterRef = useRef<(() => void) | null>(null);
  const isVoiceActiveRef = useRef(isVoiceActive);
  isVoiceActiveRef.current = isVoiceActive;

  const playStepRef = useRef<(step: TutorStep) => void>(() => {});
  const advanceStepRef = useRef<() => void>(() => {});

  // Advance to next step in current performance, or next performance in queue
  const advanceStep = useCallback(() => {
    const perf = currentPerformanceRef.current;
    if (!perf) {
      // Try next performance in queue
      if (queueRef.current.length > 0) {
        const next = queueRef.current.shift()!;
        currentPerformanceRef.current = next;
        stepIndexRef.current = 0;
        setIsPlaying(true);
        playStepRef.current(next.steps[0]);
      } else {
        // All done
        setIsPlaying(false);
        setActiveStep(null);
        setPointerState((prev) => ({ ...prev, visible: false, phase: "idle" }));
      }
      return;
    }

    const nextIdx = stepIndexRef.current + 1;
    if (nextIdx < perf.steps.length) {
      stepIndexRef.current = nextIdx;
      playStepRef.current(perf.steps[nextIdx]);
    } else {
      // Performance complete
      currentPerformanceRef.current = null;
      stepIndexRef.current = 0;
      advanceStepRef.current(); // Try next in queue
    }
  }, []);

  // Play a single step
  const playStep = useCallback((step: TutorStep) => {
    setActiveStep(step);

    switch (step.type) {
      case "move_pointer": {
        const mx = Number.isFinite(step.target?.x) ? (step.target!.x as number) : 0;
        const my = Number.isFinite(step.target?.y) ? (step.target!.y as number) : 0;
        setPointerState({
          x: mx,
          y: my,
          visible: true,
          message: step.message,
          phase: "moving",
        });
        // Fast glide to position
        timerRef.current = setTimeout(() => {
          setPointerState((prev) => ({ ...prev, phase: "idle" }));
          advanceStepRef.current();
        }, step.duration || 35);
        break;
      }

      case "draw_stroke": {
        // Move pointer to the start of the stroke immediately
        if (step.points && step.points.length > 0) {
          const first = step.points[0];
          const fx = Number.isFinite(first?.x) ? first.x : 0;
          const fy = Number.isFinite(first?.y) ? first.y : 0;
          setPointerState((prev) => ({
            ...prev,
            x: fx,
            y: fy,
            visible: true,
            message: step.message,
            phase: "drawing",
          }));
        } else if (step.target) {
          const tx = Number.isFinite(step.target?.x) ? step.target.x : 0;
          const ty = Number.isFinite(step.target?.y) ? step.target.y : 0;
          setPointerState((prev) => ({
            ...prev,
            x: tx,
            y: ty,
            visible: true,
            message: step.message,
            phase: "drawing",
          }));
        }
        // AnimatedShapeRenderer calls advanceStep via onComplete
        break;
      }

      case "draw_shape":
      case "type_text": {
        const isCard = step.payload?.type === "math" || step.payload?.latex || step.payload?.type === "text";
        if (isCard) {
          // KaTeX formulas and text cards reveal smoothly without drawing cursor pretending to draw ink
          setPointerState((prev) => ({
            ...prev,
            visible: false,
            phase: "idle",
          }));
        } else {
          if (step.target && Number.isFinite(step.target.x) && Number.isFinite(step.target.y)) {
            setPointerState((prev) => ({
              ...prev,
              x: step.target!.x,
              y: step.target!.y,
              visible: true,
              message: step.message,
              phase: "drawing",
            }));
          } else if (step.payload) {
            setPointerState((prev) => {
              const rawX = (step.payload as any).x;
              const rawY = (step.payload as any).y;
              const px = Number.isFinite(rawX) ? rawX : (Number.isFinite(prev.x) ? prev.x : 0);
              const py = Number.isFinite(rawY) ? rawY : (Number.isFinite(prev.y) ? prev.y : 0);
              return {
                ...prev,
                x: px,
                y: py,
                visible: true,
                message: step.message,
                phase: "drawing",
              };
            });
          }
        }
        // AnimatedShapeRenderer calls advanceStep via onComplete
        break;
      }

      case "highlight": {
        const hx = Number.isFinite(step.target?.x) ? step.target!.x : 0;
        const hy = Number.isFinite(step.target?.y) ? step.target!.y : 0;
        setPointerState({
          x: hx,
          y: hy,
          visible: true,
          message: step.message,
          phase: "highlighting",
        });
        timerRef.current = setTimeout(() => {
          advanceStepRef.current();
        }, step.duration || 500);
        break;
      }

      case "pause":
        timerRef.current = setTimeout(() => {
          advanceStepRef.current();
        }, step.duration || 40);
        break;

      case "await_beat": {
        // Hold the marker until the teacher starts the next sentence
        setPointerState((prev) => ({ ...prev, visible: false, phase: "idle" }));
        if (beatCreditsRef.current > 0) {
          beatCreditsRef.current -= 1;
          timerRef.current = setTimeout(() => advanceStepRef.current(), 0);
          break;
        }
        const voiceActive = isVoiceActiveRef.current?.() ?? false;
        const maxWait = voiceActive ? step.duration || 4500 : 350;
        let released = false;
        const release = () => {
          if (released) return;
          released = true;
          beatWaiterRef.current = null;
          if (timerRef.current) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
          }
          advanceStepRef.current();
        };
        beatWaiterRef.current = release;
        timerRef.current = setTimeout(release, maxWait);
        break;
      }
    }
  }, []);

  advanceStepRef.current = advanceStep;
  playStepRef.current = playStep;

  // Real-time pointer tracker (called as wet ink path advances)
  const updatePointer = useCallback((x: number, y: number) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    setPointerState((prev) => ({
      ...prev,
      x,
      y,
      visible: true,
      phase: "drawing",
    }));
  }, []);

  const signalBeat = useCallback(() => {
    if (beatWaiterRef.current) {
      beatWaiterRef.current();
    } else if (currentPerformanceRef.current) {
      beatCreditsRef.current += 1;
    }
  }, []);

  const resetBeats = useCallback(() => {
    beatCreditsRef.current = 0;
  }, []);

  const clearBeatState = () => {
    beatWaiterRef.current = null;
    beatCreditsRef.current = 0;
  };

  // Enqueue a new performance
  const enqueue = useCallback((performance: TutorPerformance) => {
    if (!currentPerformanceRef.current) {
      // Start immediately
      currentPerformanceRef.current = performance;
      stepIndexRef.current = 0;
      setIsPlaying(true);
      playStepRef.current(performance.steps[0]);
    } else {
      // Add to queue
      queueRef.current.push(performance);
    }
  }, []);

  // Skip to end — instantly commit all remaining steps
  const skip = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    clearBeatState();

    const commitStep = (step: TutorStep, idx: number) => {
      if (step.type === "draw_stroke" && step.points && onStrokeCommit) {
        onStrokeCommit({
          id: step.payload?.id || `stroke-skip-${Date.now().toString(36)}-${idx}`,
          page_id: step.payload?.page_id || "",
          tool: (step.payload?.tool as any) || "pen",
          color: step.payload?.color || "#60A5FA",
          size: step.payload?.size || 2.8,
          points: step.points,
        });
      } else if ((step.type === "draw_shape" || step.type === "type_text") && step.payload) {
        const obj = buildSkipObject(step);
        if (obj) onObjectCommit(obj);
      }
    };

    const perf = currentPerformanceRef.current;
    if (perf && perf.skippable !== false) {
      for (let i = stepIndexRef.current; i < perf.steps.length; i++) {
        commitStep(perf.steps[i], i);
      }
    }

    // Also commit all queued performances
    for (const qPerf of queueRef.current) {
      for (let i = 0; i < qPerf.steps.length; i++) {
        commitStep(qPerf.steps[i], i);
      }
    }

    queueRef.current = [];
    currentPerformanceRef.current = null;
    stepIndexRef.current = 0;
    setIsPlaying(false);
    setActiveStep(null);
    setPointerState(IDLE_POINTER);
  }, [onObjectCommit, onStrokeCommit]);

  // Fast-path barge-in interruption with state reconciliation
  const interrupt = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    clearBeatState();

    const perf = currentPerformanceRef.current;
    if (perf && perf.steps.length > 0) {
      const currentIdx = stepIndexRef.current;
      const progressFraction = (currentIdx + 1) / perf.steps.length;

      // If >= 80% complete, cleanly commit the object so what was almost finished stays
      if (progressFraction >= 0.8) {
        for (let i = currentIdx; i < perf.steps.length; i++) {
          const step = perf.steps[i];
          if (step.type === "draw_stroke" && step.points && onStrokeCommit) {
            onStrokeCommit({
              id: step.payload?.id || `stroke-int-${Date.now().toString(36)}-${i}`,
              page_id: step.payload?.page_id || "",
              tool: (step.payload?.tool as any) || "pen",
              color: step.payload?.color || "#60A5FA",
              size: step.payload?.size || 2.8,
              points: step.points,
            });
          } else if ((step.type === "draw_shape" || step.type === "type_text") && step.payload) {
            const obj = buildSkipObject(step);
            if (obj) onObjectCommit(obj);
          }
        }
      }
    }

    queueRef.current = [];
    currentPerformanceRef.current = null;
    stepIndexRef.current = 0;
    setIsPlaying(false);
    setActiveStep(null);
    setPointerState(IDLE_POINTER);
  }, [onObjectCommit, onStrokeCommit]);

  // Cancel without committing
  const cancelAll = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    clearBeatState();
    queueRef.current = [];
    currentPerformanceRef.current = null;
    stepIndexRef.current = 0;
    setIsPlaying(false);
    setActiveStep(null);
    setPointerState(IDLE_POINTER);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return {
    pointerState,
    activeStep,
    isPlaying,
    enqueue,
    updatePointer,
    handleStepComplete: advanceStep,
    skip,
    interrupt,
    cancelAll,
    signalBeat,
    resetBeats,
  };
}

function buildSkipObject(step: TutorStep): CanvasObject | null {
  if (!step.payload) return null;
  const p = step.payload;
  return {
    id: p.id || `tutor-skip-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    page_id: p.page_id || "",
    type: (p.type as CanvasObject["type"]) || "rect",
    x: p.x || 0,
    y: p.y || 0,
    width: p.width || 100,
    height: p.height || 80,
    color: p.color || "#EDEDED",
    fill: p.fill,
    stroke_width: p.stroke_width,
    text: p.text,
    latex: p.latex,
  };
}
