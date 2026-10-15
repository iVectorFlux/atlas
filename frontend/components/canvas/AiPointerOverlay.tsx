"use client";

import React, { useRef, useEffect, useState, useCallback } from "react";
import type { AiPointerState } from "@/lib/types";

interface AiPointerOverlayProps {
  pointer: AiPointerState;
  theme?: "dark" | "light";
}

/**
 * The Living AI Pointer — a spring-physics animated tutor cursor
 * with organic movement, breathing glow, and speech bubble labels.
 * Respects prefers-reduced-motion.
 */
export const AiPointerOverlay: React.FC<AiPointerOverlayProps> = ({
  pointer,
  theme = "dark",
}) => {
  const safeTargetX = Number.isFinite(pointer?.x) ? pointer.x : 0;
  const safeTargetY = Number.isFinite(pointer?.y) ? pointer.y : 0;

  const rafRef = useRef<number>(0);
  const posRef = useRef({ x: safeTargetX, y: safeTargetY });
  const velRef = useRef({ x: 0, y: 0 });
  const [displayPos, setDisplayPos] = useState({ x: safeTargetX, y: safeTargetY });
  const [isVisible, setIsVisible] = useState(false);
  const [showMessage, setShowMessage] = useState(false);
  const prefersReducedMotion = useRef(false);

  // Check reduced motion preference
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    prefersReducedMotion.current = mq.matches;
    const handler = (e: MediaQueryListEvent) => {
      prefersReducedMotion.current = e.matches;
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  // Spring physics animation loop
  const animate = useCallback(() => {
    const tx = Number.isFinite(pointer?.x) ? pointer.x : 0;
    const ty = Number.isFinite(pointer?.y) ? pointer.y : 0;

    if (prefersReducedMotion.current) {
      // Instant positioning for reduced motion
      posRef.current = { x: tx, y: ty };
      velRef.current = { x: 0, y: 0 };
      setDisplayPos({ x: tx, y: ty });
      return;
    }

    // Recover if posRef got corrupted with NaN
    if (!Number.isFinite(posRef.current.x) || !Number.isFinite(posRef.current.y)) {
      posRef.current = { x: tx, y: ty };
      velRef.current = { x: 0, y: 0 };
    }
    if (!Number.isFinite(velRef.current.x) || !Number.isFinite(velRef.current.y)) {
      velRef.current = { x: 0, y: 0 };
    }

    const stiffness = 0.08; // Spring tension
    const damping = 0.72;   // Velocity decay (higher = more damping)
    const threshold = 0.15; // Sub-pixel snap threshold

    const dx = tx - posRef.current.x;
    const dy = ty - posRef.current.y;

    // Spring force
    velRef.current.x += dx * stiffness;
    velRef.current.y += dy * stiffness;

    // Damping
    velRef.current.x *= damping;
    velRef.current.y *= damping;

    // Apply velocity
    posRef.current.x += velRef.current.x;
    posRef.current.y += velRef.current.y;

    // Guard against any runaway NaN
    if (!Number.isFinite(posRef.current.x) || !Number.isFinite(posRef.current.y)) {
      posRef.current = { x: tx, y: ty };
      velRef.current = { x: 0, y: 0 };
      setDisplayPos({ x: tx, y: ty });
      return;
    }

    // Snap when close enough
    const distSq = dx * dx + dy * dy;
    if (distSq < threshold * threshold && Math.abs(velRef.current.x) < threshold && Math.abs(velRef.current.y) < threshold) {
      posRef.current = { x: tx, y: ty };
      velRef.current = { x: 0, y: 0 };
      setDisplayPos({ x: tx, y: ty });
    } else {
      setDisplayPos({ x: posRef.current.x, y: posRef.current.y });
      rafRef.current = requestAnimationFrame(animate);
    }
  }, [pointer?.x, pointer?.y]);

  // Restart animation when target changes
  useEffect(() => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafRef.current);
  }, [animate]);

  // Fade in/out with slight delay for the message bubble
  useEffect(() => {
    if (pointer?.visible) {
      setIsVisible(true);
      if (pointer.message) {
        const timer = setTimeout(() => setShowMessage(true), 200);
        return () => clearTimeout(timer);
      } else {
        setShowMessage(false);
      }
    } else {
      setShowMessage(false);
      const timer = setTimeout(() => setIsVisible(false), 300);
      return () => clearTimeout(timer);
    }
  }, [pointer?.visible, pointer?.message]);

  if (!isVisible) return null;

  const isLight = theme === "light";
  const isHighlighting = pointer?.phase === "highlighting";
  const isDrawing = pointer?.phase === "drawing";

  const renderLeft = Number.isFinite(displayPos.x) ? displayPos.x : safeTargetX;
  const renderTop = Number.isFinite(displayPos.y) ? displayPos.y : safeTargetY;

  return (
    <div
      className="absolute z-40 pointer-events-none"
      style={{
        left: renderLeft,
        top: renderTop,
        opacity: pointer?.visible ? 1 : 0,
        transition: "opacity 0.3s ease",
      }}
    >
      {/* Focal Halo — expands when highlighting */}
      <div
        className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{
          width: isHighlighting ? 56 : 24,
          height: isHighlighting ? 56 : 24,
          background: isLight
            ? "radial-gradient(circle, rgba(59,130,246,0.12) 0%, transparent 70%)"
            : "radial-gradient(circle, rgba(147,197,253,0.12) 0%, transparent 70%)",
          transition: "width 0.5s cubic-bezier(0.34, 1.56, 0.64, 1), height 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)",
          animation: prefersReducedMotion.current ? "none" : "ai-pointer-breathe 2.4s ease-in-out infinite",
        }}
      />

      {/* Core Cursor Dot */}
      <div
        className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full shadow-lg"
        style={{
          width: isDrawing ? 6 : 10,
          height: isDrawing ? 6 : 10,
          background: isLight
            ? "linear-gradient(135deg, #1e293b 0%, #334155 100%)"
            : "linear-gradient(135deg, #f1f5f9 0%, #cbd5e1 100%)",
          border: `2px solid ${isLight ? "rgba(255,255,255,0.9)" : "rgba(0,0,0,0.4)"}`,
          boxShadow: isLight
            ? "0 1px 6px rgba(0,0,0,0.18), 0 0 0 3px rgba(59,130,246,0.15)"
            : "0 1px 8px rgba(0,0,0,0.4), 0 0 0 3px rgba(147,197,253,0.12)",
          transition: "width 0.25s ease, height 0.25s ease",
        }}
      />

      {/* Tutor Identity Tag */}
      <div
        className="absolute whitespace-nowrap text-[9px] font-semibold tracking-wider uppercase"
        style={{
          left: 8,
          top: -6,
          color: isLight ? "rgba(59,130,246,0.7)" : "rgba(147,197,253,0.6)",
          letterSpacing: "0.06em",
          opacity: isHighlighting || pointer.message ? 1 : 0.5,
          transition: "opacity 0.3s ease",
        }}
      >
        Tutor
      </div>

      {/* Speech Bubble Message */}
      {pointer.message && showMessage && (
        <div
          className="absolute whitespace-nowrap"
          style={{
            left: 14,
            top: 8,
            animation: prefersReducedMotion.current ? "none" : "ai-pointer-bubble-in 0.35s cubic-bezier(0.34, 1.56, 0.64, 1)",
          }}
        >
          <div
            className="text-xs font-medium px-3 py-1.5 rounded-xl shadow-md border backdrop-blur-sm"
            style={{
              background: isLight ? "rgba(255,255,255,0.95)" : "rgba(28,28,32,0.95)",
              borderColor: isLight ? "rgba(0,0,0,0.08)" : "rgba(255,255,255,0.1)",
              color: isLight ? "#18181B" : "#e2e8f0",
            }}
          >
            {pointer.message}
          </div>
        </div>
      )}
    </div>
  );
};
