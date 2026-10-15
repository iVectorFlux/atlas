"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import { Point, Stroke, ThemeMode } from "@/lib/types";
import { textToStrokes } from "@/lib/handwritingEngine";
import { evaluateFormationQuality, FormationAssessment } from "@/lib/inkEngine/recognizer";
import { CheckCircle2, RotateCcw, X, Sparkles, ChevronRight, Award } from "lucide-react";

interface HandwritingPracticeOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  theme?: ThemeMode;
}

const PRACTICE_ITEMS = ["3", "4", "5", "8", "A", "B", "C", "D", "M", "S"];

export const HandwritingPracticeOverlay: React.FC<HandwritingPracticeOverlayProps> = ({
  isOpen,
  onClose,
  theme = "dark",
}) => {
  const [selectedChar, setSelectedChar] = useState<string>("3");
  const [userStrokes, setUserStrokes] = useState<Stroke[]>([]);
  const [currentPoints, setCurrentPoints] = useState<Point[]>([]);
  const [isDrawing, setIsDrawing] = useState(false);
  const [assessment, setAssessment] = useState<FormationAssessment | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Clear student strokes
  const handleClear = useCallback(() => {
    setUserStrokes([]);
    setCurrentPoints([]);
    setAssessment(null);
  }, []);

  // Switch to next practice character
  const handleNextChar = useCallback(() => {
    const idx = PRACTICE_ITEMS.indexOf(selectedChar);
    const nextIdx = (idx + 1) % PRACTICE_ITEMS.length;
    setSelectedChar(PRACTICE_ITEMS[nextIdx]);
    handleClear();
  }, [selectedChar, handleClear]);

  // Redraw canvas with ruled handwriting guidelines and student ink
  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const width = canvas.width / dpr;
    const height = canvas.height / dpr;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.scale(dpr, dpr);

    // 1. Ruled guidelines (standard early childhood 3-line paper)
    const headlineY = 55;
    const midlineY = 125;
    const baselineY = 195;

    // Top Headline (Sky line)
    ctx.strokeStyle = theme === "dark" ? "rgba(96, 165, 250, 0.4)" : "rgba(59, 130, 246, 0.5)";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(30, headlineY);
    ctx.lineTo(width - 30, headlineY);
    ctx.stroke();

    // Midline (Fence line)
    ctx.strokeStyle = theme === "dark" ? "rgba(245, 158, 11, 0.4)" : "rgba(217, 119, 6, 0.5)";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.moveTo(30, midlineY);
    ctx.lineTo(width - 30, midlineY);
    ctx.stroke();

    // Baseline (Grass line)
    ctx.strokeStyle = theme === "dark" ? "rgba(244, 63, 94, 0.45)" : "rgba(225, 29, 72, 0.55)";
    ctx.lineWidth = 2;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(30, baselineY);
    ctx.lineTo(width - 30, baselineY);
    ctx.stroke();

    // 2. Faint template guide of the target letter
    try {
      const templateStrokes = textToStrokes(selectedChar, { x: width / 2 - 40, y: midlineY - 10 }, {
        size: 130,
        color: theme === "dark" ? "rgba(255, 255, 255, 0.12)" : "rgba(0, 0, 0, 0.08)",
        strokeWidth: 16,
      });

      for (const tStroke of templateStrokes) {
        if (tStroke.points.length < 2) continue;
        ctx.strokeStyle = theme === "dark" ? "rgba(255, 255, 255, 0.12)" : "rgba(0, 0, 0, 0.1)";
        ctx.lineWidth = 14;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.beginPath();
        ctx.moveTo(tStroke.points[0].x, tStroke.points[0].y);
        for (let i = 1; i < tStroke.points.length; i++) {
          ctx.lineTo(tStroke.points[i].x, tStroke.points[i].y);
        }
        ctx.stroke();

        // Green starting dot on the first stroke
        if (tStroke === templateStrokes[0]) {
          const startPt = tStroke.points[0];
          ctx.fillStyle = "#10B981";
          ctx.beginPath();
          ctx.arc(startPt.x, startPt.y, 6.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    } catch {}

    // 3. User finished strokes
    for (const stroke of userStrokes) {
      if (stroke.points.length < 2) continue;
      ctx.strokeStyle = stroke.color || "#38BDF8";
      ctx.lineWidth = stroke.size || 4.5;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
      for (let i = 1; i < stroke.points.length; i++) {
        ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
      }
      ctx.stroke();
    }

    // 4. Current in-progress stroke
    if (currentPoints.length >= 2) {
      ctx.strokeStyle = "#38BDF8";
      ctx.lineWidth = 4.5;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(currentPoints[0].x, currentPoints[0].y);
      for (let i = 1; i < currentPoints.length; i++) {
        ctx.lineTo(currentPoints[i].x, currentPoints[i].y);
      }
      ctx.stroke();
    }

    ctx.restore();
  }, [selectedChar, userStrokes, currentPoints, theme]);

  // Handle canvas sizing on mount / resize
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = 440 * dpr;
    canvas.height = 250 * dpr;
    canvas.style.width = "440px";
    canvas.style.height = "250px";
    redraw();
  }, [redraw]);

  // Pointer event handlers for drawing
  const getCanvasPoint = (e: React.PointerEvent): Point => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setIsDrawing(true);
    const pt = getCanvasPoint(e);
    setCurrentPoints([pt]);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDrawing) return;
    const pt = getCanvasPoint(e);
    setCurrentPoints((prev) => [...prev, pt]);
  };

  const handlePointerUp = () => {
    if (!isDrawing || currentPoints.length < 2) {
      setIsDrawing(false);
      setCurrentPoints([]);
      return;
    }

    const newStroke: Stroke = {
      id: `user-ink-${Date.now().toString(36)}`,
      page_id: "practice",
      tool: "pen",
      color: "#38BDF8",
      size: 4.5,
      points: currentPoints,
    };

    const updatedStrokes = [...userStrokes, newStroke];
    setUserStrokes(updatedStrokes);
    setCurrentPoints([]);
    setIsDrawing(false);

    // Run sub-millisecond formation quality evaluator (<1ms on CPU)
    const result = evaluateFormationQuality(updatedStrokes, selectedChar);
    setAssessment(result);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className={`relative w-full max-w-lg rounded-2xl shadow-2xl border p-6 flex flex-col items-center ${
        theme === "dark" 
          ? "bg-zinc-900 border-zinc-700/80 text-zinc-100" 
          : "bg-white border-zinc-200 text-zinc-900"
      }`}>
        {/* Header */}
        <div className="w-full flex items-center justify-between pb-3 border-b border-zinc-700/30">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-500/20 text-blue-400 flex items-center justify-center">
              <Sparkles size={18} />
            </div>
            <div>
              <h2 className="text-base font-semibold">Handwriting Intelligence Studio</h2>
              <p className="text-xs text-zinc-400">Zero-lag local browser stroke assessment ($0 GPU)</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Character Selection Pills */}
        <div className="w-full flex items-center gap-2 overflow-x-auto py-3 no-scrollbar">
          {PRACTICE_ITEMS.map((ch) => (
            <button
              key={ch}
              onClick={() => {
                setSelectedChar(ch);
                handleClear();
              }}
              className={`px-3 py-1 rounded-lg text-sm font-bold transition-all ${
                selectedChar === ch
                  ? "bg-blue-600 text-white shadow-md shadow-blue-500/30 scale-105"
                  : "bg-zinc-800/60 text-zinc-400 hover:bg-zinc-700/60 hover:text-zinc-200"
              }`}
            >
              {ch}
            </button>
          ))}
        </div>

        {/* Ruled Practice Canvas */}
        <div className="relative rounded-xl border border-zinc-700/50 overflow-hidden shadow-inner my-2 bg-zinc-950/40 cursor-crosshair">
          <canvas
            ref={canvasRef}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            className="touch-none select-none"
          />
        </div>

        {/* Real-Time Assessment Coaching Card */}
        <div className="w-full min-h-[58px] mt-2 p-3 rounded-xl bg-zinc-800/40 border border-zinc-700/40 flex items-center justify-between gap-3">
          {assessment ? (
            <div className="flex items-center gap-3">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                assessment.overallQuality >= 0.75 
                  ? "bg-emerald-500/20 text-emerald-400" 
                  : "bg-amber-500/20 text-amber-400"
              }`}>
                {assessment.overallQuality >= 0.75 ? <CheckCircle2 size={18} /> : <Award size={18} />}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-zinc-300">
                    Formation: {Math.round(assessment.overallQuality * 100)}%
                  </span>
                  <span className="text-[11px] text-zinc-500">•</span>
                  <span className="text-[11px] text-zinc-400">
                    Match: {assessment.confidence}%
                  </span>
                </div>
                <p className="text-xs text-zinc-300 font-medium">
                  {assessment.coachingFeedback}
                </p>
              </div>
            </div>
          ) : (
            <p className="text-xs text-zinc-400 italic">
              Trace or write <strong className="text-zinc-200">{selectedChar}</strong> starting from the green dot at the top headline!
            </p>
          )}

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={handleClear}
              title="Clear strokes"
              className="p-2 rounded-lg bg-zinc-700/40 hover:bg-zinc-700/80 text-zinc-300 hover:text-white transition-colors"
            >
              <RotateCcw size={15} />
            </button>
            <button
              onClick={handleNextChar}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-md transition-colors"
            >
              <span>Next</span>
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
