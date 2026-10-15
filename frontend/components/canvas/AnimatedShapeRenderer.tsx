"use client";

import React, { useEffect, useState, useRef, useCallback } from "react";
import type { TutorStep, Point, CanvasObject, Stroke } from "@/lib/types";
import { cleanLatexFormula } from "@/lib/sketchEngine";
import { safeKatexRender } from "@/lib/katexSafe";
import katex from "katex";

interface AnimatedShapeRendererProps {
  /** The step being animated — shape, stroke, or text */
  step: TutorStep;
  /** Called when this step's animation completes */
  onComplete: () => void;
  /** Called with the final committed object when a shape/text finishes */
  onObjectReady?: (obj: CanvasObject) => void;
  /** Called with the final committed stroke when a freehand stroke finishes */
  onStrokeReady?: (stroke: Stroke) => void;
  /** Real-time callback tracking the pen tip position during stroke drawing */
  onPointerMove?: (x: number, y: number) => void;
  theme?: "dark" | "light";
}

/**
 * AnimatedShapeRenderer — Progressive stroke-by-stroke / draw-in animator.
 * 
 * For shapes: uses SVG stroke-dasharray/dashoffset to trace the shape outline.
 * For strokes: progressively reveals freehand stroke points while cursor tracks tip.
 * For text: typewriter left-to-right character reveal.
 * 
 * Respects prefers-reduced-motion by finishing instantly.
 */
export const AnimatedShapeRenderer: React.FC<AnimatedShapeRendererProps> = ({
  step,
  onComplete,
  onObjectReady,
  onStrokeReady,
  onPointerMove,
  theme = "dark",
}) => {
  const [progress, setProgress] = useState(0); // 0 → 1
  const [textChars, setTextChars] = useState(0);
  const rafRef = useRef<number>(0);
  const startTimeRef = useRef<number>(0);
  const completedRef = useRef(false);
  const prefersReducedMotion = useRef(false);

  // Store callbacks in refs to prevent parent re-renders from cancelling the animation frame loop
  const onCompleteRef = useRef(onComplete);
  const onObjectReadyRef = useRef(onObjectReady);
  const onStrokeReadyRef = useRef(onStrokeReady);
  const onPointerMoveRef = useRef(onPointerMove);

  useEffect(() => {
    onCompleteRef.current = onComplete;
    onObjectReadyRef.current = onObjectReady;
    onStrokeReadyRef.current = onStrokeReady;
    onPointerMoveRef.current = onPointerMove;
  });

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    prefersReducedMotion.current = mq.matches;
  }, []);

  const duration = step.duration || getDefaultDuration(step);

  const isLight = theme === "light";
  const rawColor = step.payload?.color;
  let strokeColor = rawColor || (isLight ? "#18181B" : "#EDEDED");
  const rawLower = (rawColor || "").toLowerCase();
  if (isLight && (rawLower === "#ededed" || rawLower === "#ffffff" || rawLower === "#f4f4f5" || rawLower === "#fafafa" || rawLower === "#e4e4e7" || rawColor === "white")) {
    strokeColor = "#18181B";
  } else if (!isLight && (rawLower === "#18181b" || rawLower === "#000000" || rawLower === "#27272a" || rawLower === "#09090b" || rawColor === "black")) {
    strokeColor = "#EDEDED";
  }

  const finishStep = useCallback(() => {
    if (completedRef.current) return;
    completedRef.current = true;
    setProgress(1);

    // Emit the final committed stroke for digital ink
    if (step.type === "draw_stroke" && step.points && onStrokeReadyRef.current) {
      const stroke: Stroke = {
        id: step.payload?.id || `stroke-draw-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        page_id: step.payload?.page_id || "",
        tool: (step.payload?.tool as any) || "pen",
        color: strokeColor,
        size: step.payload?.size || step.payload?.stroke_width || 2.8,
        points: step.points,
      };
      onStrokeReadyRef.current(stroke);
    } else if (onObjectReadyRef.current && step.payload) {
      // Emit the final committed object
      const obj = buildCanvasObject(step);
      if (obj) onObjectReadyRef.current(obj);
    }

    onCompleteRef.current?.();
  }, [step, strokeColor]);

  // Main animation loop
  useEffect(() => {
    completedRef.current = false;

    if (prefersReducedMotion.current) {
      finishStep();
      return;
    }

    startTimeRef.current = performance.now();

    const tick = (now: number) => {
      const elapsed = now - startTimeRef.current;
      const t = Math.min(1, elapsed / duration);

      // Eased progress (ease-out cubic)
      const eased = 1 - Math.pow(1 - t, 3);
      setProgress(eased);

      // Typewriter for text
      if (step.type === "type_text" && step.payload?.text) {
        const chars = Math.floor(eased * step.payload.text.length);
        setTextChars(chars);
      }

      // Live pointer tracking: tip of wet ink leads cursor
      if (step.type === "draw_stroke" && step.points && step.points.length > 0) {
        const visibleCount = Math.max(1, Math.floor(eased * step.points.length));
        const tip = step.points[visibleCount - 1];
        if (tip && Number.isFinite(tip.x) && Number.isFinite(tip.y) && onPointerMoveRef.current) {
          onPointerMoveRef.current(tip.x, tip.y);
        }
      }

      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        finishStep();
      }
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [step, duration, finishStep]);

  // ─── KaTeX Math Animation (Smooth reveal) ───
  if (
    (step.type === "draw_shape" || step.type === "type_text") &&
    (step.payload?.type === "math" || step.payload?.latex)
  ) {
    const { x = 0, y = 0 } = step.payload as Partial<CanvasObject>;
    const rawLatex = step.payload.latex || "";
    const html = safeKatexRender(rawLatex, false);

    const scaleVal = 0.95 + 0.05 * progress;
    const opacityVal = Math.min(1, progress * 1.5);

    return (
      <div
        className="absolute pointer-events-none select-none"
        style={{
          left: x,
          top: y,
          transform: `translate(-50%, -50%) scale(${scaleVal})`,
          opacity: opacityVal,
        }}
      >
        <div
          className="text-lg md:text-xl px-2 py-0.5 select-none transition-all"
          style={{ color: strokeColor }}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>
    );
  }

  // ─── Text Object Animation (Fast fade-in for titles/labels) ───
  if (
    (step.type === "draw_shape" || step.type === "type_text") &&
    step.payload?.type === "text" &&
    step.payload?.text
  ) {
    const { x = 0, y = 0 } = step.payload as Partial<CanvasObject>;
    const opacityVal = Math.min(1, progress * 2);
    const isTitle = step.payload?.id?.startsWith("title-");

    return (
      <div
        className="absolute pointer-events-none select-none"
        style={{
          left: x,
          top: y,
          transform: "translate(-50%, -50%)",
          opacity: opacityVal,
        }}
      >
        {isTitle ? (
          <div
            className={`font-sans font-bold text-xs uppercase tracking-widest px-4 py-1.5 rounded-full select-none whitespace-nowrap shadow-xs ${
              isLight
                ? "bg-zinc-100 text-zinc-700 border border-zinc-300/80"
                : "bg-zinc-850 text-zinc-200 border border-zinc-700/80"
            }`}
            style={{ color: strokeColor }}
          >
            {step.payload.text}
          </div>
        ) : (
          <div
            className="font-sans font-medium text-sm px-1.5 py-0.5 select-none whitespace-nowrap"
            style={{ color: strokeColor }}
          >
            {step.payload.text}
          </div>
        )}
      </div>
    );
  }

  // ─── Shape Animation (SVG stroke-dasharray/dashoffset) ───
  if (step.type === "draw_shape" && step.payload) {
    const { x = 0, y = 0, width = 100, height = 80, type: shapeType } = step.payload as Partial<CanvasObject>;

    return (
      <svg
        className="absolute inset-0 pointer-events-none"
        style={{ overflow: "visible", width: "100%", height: "100%" }}
      >
        {renderAnimatedShape(
          shapeType || "rect",
          x,
          y,
          width,
          height,
          strokeColor,
          step.payload?.stroke_width || 2,
          progress,
          step.payload?.fill,
        )}
      </svg>
    );
  }

  // ─── Freehand Stroke Animation (progressive point reveal) ───
  if (step.type === "draw_stroke" && step.points && step.points.length > 0) {
    const totalPts = step.points.length;
    const visibleCount = totalPts >= 2 ? Math.max(2, Math.floor(progress * totalPts)) : 1;
    const visiblePoints = step.points.slice(0, Math.min(totalPts, visibleCount));
    const strokeWidth = step.payload?.size || step.payload?.stroke_width || 3;

    if (visiblePoints.length < 2) {
      if (visiblePoints.length === 1) {
        return (
          <svg
            className="absolute inset-0 pointer-events-none"
            style={{ overflow: "visible", width: "100%", height: "100%" }}
          >
            <circle
              cx={visiblePoints[0].x}
              cy={visiblePoints[0].y}
              r={strokeWidth / 2}
              fill={strokeColor}
            />
          </svg>
        );
      }
      return null;
    }

    const pathD = buildSmoothPath(visiblePoints);

    return (
      <svg
        className="absolute inset-0 pointer-events-none"
        style={{ overflow: "visible", width: "100%", height: "100%" }}
      >
        <path
          d={pathD}
          fill="none"
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ opacity: 0.95 }}
        />
      </svg>
    );
  }

  // ─── Typewriter Text Animation ───
  if (step.type === "type_text" && step.payload?.text) {
    const fullText = step.payload.text;
    const revealedText = fullText.slice(0, textChars);
    const { x = 0, y = 0 } = step.payload as Partial<CanvasObject>;

    return (
      <div
        className="absolute pointer-events-none"
        style={{
          left: x,
          top: y,
          whiteSpace: "pre",
        }}
      >
        <span
          className="font-sans font-medium text-sm px-3 py-1.5 rounded-xl border backdrop-blur-md inline-block"
          style={{
            background: isLight ? "rgba(255,255,255,0.95)" : "rgba(32,32,36,0.9)",
            borderColor: isLight ? "rgba(0,0,0,0.1)" : "rgba(255,255,255,0.1)",
            color: strokeColor,
          }}
        >
          {revealedText}
          {progress < 1 && (
            <span
              className="inline-block w-[2px] h-[14px] ml-px align-text-bottom"
              style={{
                background: strokeColor,
                animation: "ai-pointer-breathe 0.8s ease-in-out infinite",
              }}
            />
          )}
        </span>
      </div>
    );
  }

  return null;
};

// ─── Helpers ───

function getDefaultDuration(step: TutorStep): number {
  switch (step.type) {
    case "draw_shape": {
      if (step.payload?.type === "text") return 200;
      if (step.payload?.type === "math" || step.payload?.latex) return 250;
      return 180;
    }
    case "draw_stroke": {
      const ptCount = step.points?.length || 10;
      return Math.min(200, Math.max(80, ptCount * 10));
    }
    case "type_text": return (step.payload?.text?.length || 10) * 12;
    case "highlight": return 300;
    case "pause": return step.duration || 30;
    default: return 150;
  }
}

function buildCanvasObject(step: TutorStep): CanvasObject | null {
  if (!step.payload) return null;
  const p = step.payload;
  return {
    id: p.id || `tutor-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
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

/** Build a smooth SVG path from points using midpoint quadratic curves */
function buildSmoothPath(points: Point[]): string {
  if (points.length < 2) return "";

  let d = `M ${points[0].x} ${points[0].y}`;

  for (let i = 1; i < points.length - 1; i++) {
    const midX = (points[i].x + points[i + 1].x) / 2;
    const midY = (points[i].y + points[i + 1].y) / 2;
    d += ` Q ${points[i].x} ${points[i].y} ${midX} ${midY}`;
  }

  // Final segment
  const last = points[points.length - 1];
  d += ` L ${last.x} ${last.y}`;

  return d;
}

/** Render an SVG shape with animated stroke-dashoffset for draw-in effect */
function renderAnimatedShape(
  shapeType: string,
  x: number,
  y: number,
  width: number,
  height: number,
  color: string,
  strokeWidth: number,
  progress: number,
  fill?: string,
) {
  // Estimated perimeter for dash animation
  const getPerimeter = () => {
    switch (shapeType) {
      case "rect":
        return 2 * (width + height);
      case "circle":
        return Math.PI * Math.min(width, height);
      case "star": {
        const r = Math.min(width, height) / 2;
        return 10 * r * 0.8; // Rough star perimeter
      }
      default:
        return 2 * (width + height);
    }
  };

  const perimeter = getPerimeter();
  const dashOffset = perimeter * (1 - progress);
  const fillOpacity = progress > 0.85 ? (progress - 0.85) / 0.15 : 0;

  const sharedStyle: React.CSSProperties = {
    strokeDasharray: perimeter,
    strokeDashoffset: dashOffset,
    transition: "none",
  };

  switch (shapeType) {
    case "rect":
      return (
        <rect
          x={x}
          y={y}
          width={width}
          height={height}
          rx={8}
          fill={fill ? fill : "transparent"}
          fillOpacity={fill ? fillOpacity : 0}
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          style={sharedStyle}
        />
      );

    case "triangle": {
      const p1 = `${x},${y + height}`;
      const p2 = `${x + width},${y + height}`;
      const p3 = `${x},${y}`;
      return (
        <polygon
          points={`${p1} ${p2} ${p3}`}
          fill={fill ? fill : "transparent"}
          fillOpacity={fill ? fillOpacity : 0}
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinejoin="round"
          strokeLinecap="round"
          style={sharedStyle}
        />
      );
    }

    case "circle": {
      const r = Math.min(width, height) / 2;
      return (
        <circle
          cx={x + r}
          cy={y + r}
          r={r}
          fill={fill ? fill : "transparent"}
          fillOpacity={fill ? fillOpacity : 0}
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          style={sharedStyle}
        />
      );
    }

    case "star": {
      const r = Math.min(width, height) / 2;
      const cx = x + r;
      const cy = y + r;
      const innerR = r * 0.45;
      const points: string[] = [];
      for (let i = 0; i < 10; i++) {
        const radius = i % 2 === 0 ? r : innerR;
        const angle = (i * 36 - 90) * (Math.PI / 180);
        const px = cx + radius * Math.cos(angle);
        const py = cy + radius * Math.sin(angle);
        points.push(`${px.toFixed(1)},${py.toFixed(1)}`);
      }
      return (
        <polygon
          points={points.join(" ")}
          fill={fill ? fill : "transparent"}
          fillOpacity={fill ? fillOpacity : 0}
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinejoin="round"
          style={sharedStyle}
        />
      );
    }

    case "line":
    case "arrow":
      return (
        <line
          x1={x}
          y1={y}
          x2={x + width}
          y2={y + height}
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          markerEnd={shapeType === "arrow" ? "url(#arrowhead-tutor)" : undefined}
          style={sharedStyle}
        />
      );

    default:
      return (
        <rect
          x={x}
          y={y}
          width={width}
          height={height}
          rx={8}
          fill="transparent"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          style={sharedStyle}
        />
      );
  }
}
