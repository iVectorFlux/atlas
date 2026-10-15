"use client";

import React, { useRef, useEffect, useState, useCallback } from "react";
import { Point, Stroke, CanvasObject, CanvasPage, ThemeMode, TutorStep, AiPointerState } from "@/lib/types";
import { CanvasToolbar } from "./CanvasToolbar";
import { AiPointerOverlay } from "./AiPointerOverlay";
import { AnimatedShapeRenderer } from "./AnimatedShapeRenderer";
import { ChevronLeft, ChevronRight, Plus, Trash2 } from "lucide-react";
import { cleanLatexFormula } from "@/lib/sketchEngine";
import { safeKatexRender } from "@/lib/katexSafe";
import { sceneManager } from "@/lib/sceneGraph/sceneManager";
import katex from "katex";

interface TimedPoint extends Point {
  time: number;
  width?: number;
}

interface CanvasWorkspaceProps {
  tool: string;
  onToolChange: (tool: string) => void;
  color: string;
  onColorChange: (color: string) => void;
  size: number;
  onSizeChange: (size: number) => void;
  zoomLevel: number;
  onZoomToggle: () => void;
  currentPage: CanvasPage;
  totalPages: number;
  currentPageNumber: number;
  onNewPage: () => void;
  onPrevPage?: () => void;
  onNextPage?: () => void;
  onPageUpdate?: (page: CanvasPage) => void;
  onSwitchPage: (pageId: string) => void;
  onStrokeComplete: (stroke: Stroke) => void;
  onObjectAdd: (obj: CanvasObject) => void;
  aiPointer?: { x: number; y: number; message?: string } | null;
  /** Live state of the animated tutor pointer */
  tutorPointer?: AiPointerState | null;
  /** The step currently being animated by the tutor */
  tutorActiveStep?: TutorStep | null;
  /** Whether the tutor performance queue is playing */
  tutorIsPlaying?: boolean;
  /** Callback when an animated step completes */
  onTutorStepComplete?: () => void;
  /** Callback when user taps to skip the performance */
  onTutorSkip?: () => void;
  /** Real-time callback tracking pen tip while tutor writes ink */
  onTutorPointerMove?: (x: number, y: number) => void;
  /** Spatial hit-testing callback for multimodal reference resolution */
  onReferentSelect?: (referent: { objectId: string; semanticType: string; label?: string; role?: string } | null) => void;
  /** Callback fired when user drawing stroke begins or ends */
  onUserDrawingChange?: (isDrawing: boolean) => void;
  theme?: ThemeMode;
}

// 5-pointed star generator for SVG polygon
function getStarPoints(cx: number, cy: number, r: number): string {
  const innerR = r * 0.45;
  const points: string[] = [];
  for (let i = 0; i < 10; i++) {
    const radius = i % 2 === 0 ? r : innerR;
    const angle = (i * 36 - 90) * (Math.PI / 180);
    const x = cx + radius * Math.cos(angle);
    const y = cy + radius * Math.sin(angle);
    points.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  }
  return points.join(" ");
}

export const CanvasWorkspace: React.FC<CanvasWorkspaceProps> = ({
  tool,
  onToolChange,
  color,
  onColorChange,
  size,
  onSizeChange,
  zoomLevel,
  onZoomToggle,
  currentPage,
  totalPages,
  currentPageNumber,
  onNewPage,
  onPrevPage,
  onNextPage,
  onPageUpdate,
  onSwitchPage,
  onStrokeComplete,
  onObjectAdd,
  aiPointer,
  tutorPointer,
  tutorActiveStep,
  tutorIsPlaying,
  onTutorStepComplete,
  onTutorSkip,
  onTutorPointerMove,
  onReferentSelect,
  onUserDrawingChange,
  theme = "dark",
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const baseCanvasRef = useRef<HTMLCanvasElement>(null);
  const activeCanvasRef = useRef<HTMLCanvasElement>(null);
  const inlineInputRef = useRef<HTMLInputElement>(null);

  const [isDrawing, setIsDrawing] = useState(false);
  const currentPointsRef = useRef<TimedPoint[]>([]);
  const currentWidthRef = useRef<number>(size);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const lastPanRef = useRef({ x: 0, y: 0 });

  // Floating cursor position for angled studio eraser
  const [cursorPos, setCursorPos] = useState<{ x: number; y: number } | null>(null);
  const lastErasePtRef = useRef<Point | null>(null);

  // Object Selection & Dragging State
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
  const [draggingObject, setDraggingObject] = useState<{
    id: string;
    initialX: number;
    initialY: number;
    startPointerX: number;
    startPointerY: number;
  } | null>(null);

  // Interactive Shape Drawing State
  const [drawingShape, setDrawingShape] = useState<{
    type: string;
    startX: number;
    startY: number;
    currentX: number;
    currentY: number;
  } | null>(null);

  // Floating Page Notification Toast
  const [pageToast, setPageToast] = useState<string | null>(null);
  const prevPageIdRef = useRef<string>(currentPage.id);

  // Inline text editing state
  const [inlineText, setInlineText] = useState<{
    x: number;
    y: number;
    value: string;
  } | null>(null);

  const isLight = theme === "light";

  const getObjectColor = (c: string) => {
    if (isLight && (c === "#EDEDED" || c.toLowerCase() === "#ffffff")) return "#18181B";
    if (!isLight && (c === "#18181B" || c.toLowerCase() === "#000000")) return "#EDEDED";
    return c;
  };

  // Commit typed inline text to canvas
  const commitInlineText = () => {
    if (inlineText && inlineText.value.trim()) {
      onObjectAdd({
        id: Math.random().toString(36).substring(2, 9),
        page_id: currentPage.id,
        type: "text",
        x: inlineText.x,
        y: inlineText.y,
        width: Math.max(120, inlineText.value.length * 9),
        height: 35,
        color: isLight ? "#18181B" : "#EDEDED",
        text: inlineText.value.trim(),
      });
    }
    setInlineText(null);
  };

  // Auto-focus inline text input when opened
  useEffect(() => {
    if (inlineText) {
      setTimeout(() => inlineInputRef.current?.focus(), 20);
    }
  }, [inlineText]);

  // Page Switch and Creation Toast Notification
  useEffect(() => {
    if (prevPageIdRef.current !== currentPage.id) {
      prevPageIdRef.current = currentPage.id;
      setSelectedObjectId(null);
      setInlineText(null);

      // Clear active overlay canvas immediately
      const activeCanvas = activeCanvasRef.current;
      if (activeCanvas) {
        const ctx = activeCanvas.getContext("2d");
        if (ctx) ctx.clearRect(0, 0, activeCanvas.width, activeCanvas.height);
      }

      // Show clear page notification toast
      setPageToast(`Page ${currentPageNumber} of ${totalPages}`);
      const timer = setTimeout(() => setPageToast(null), 2000);
      return () => clearTimeout(timer);
    }
  }, [currentPage.id, currentPageNumber, totalPages]);

  // Keyboard shortcut to delete selected object (Backspace / Delete)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if ((e.key === "Backspace" || e.key === "Delete") && selectedObjectId) {
        e.preventDefault();
        if (onPageUpdate) {
          onPageUpdate({
            ...currentPage,
            objects: (currentPage.objects || []).filter((o) => o.id !== selectedObjectId),
          });
        }
        setSelectedObjectId(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedObjectId, currentPage, onPageUpdate]);

  // Calculate velocity-responsive tapered stroke width: "the ink thins with speed"
  const computePointWidth = (p1: TimedPoint, p2: TimedPoint, baseSize: number): number => {
    const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    const dt = Math.max(1, p2.time - p1.time);
    const speed = dist / dt;
    const speedFactor = 1 / (1 + speed * 0.18);
    const targetWidth = baseSize * Math.max(0.35, Math.min(1.2, speedFactor));
    const smoothed = currentWidthRef.current * 0.65 + targetWidth * 0.35;
    currentWidthRef.current = smoothed;
    return smoothed;
  };

  // Render ultra-smooth tapered curves using midpoint Bézier interpolation
  const renderSmoothCurve = (
    ctx: CanvasRenderingContext2D,
    points: TimedPoint[],
    strokeTool: string,
    strokeColor: string,
    baseSize: number
  ) => {
    if (!points || points.length === 0) return;

    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    if (strokeTool === "highlighter") {
      ctx.globalAlpha = 0.28;
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = baseSize * 2.5;
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) {
        ctx.lineTo(points[i].x, points[i].y);
      }
      ctx.stroke();
      ctx.restore();
      return;
    }

    if (strokeTool === "eraser") {
      ctx.restore();
      return;
    }

    ctx.strokeStyle = strokeColor;
    ctx.fillStyle = strokeColor;

    if (points.length === 1) {
      ctx.beginPath();
      ctx.arc(points[0].x, points[0].y, baseSize / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      return;
    }

    if (points.length === 2) {
      ctx.beginPath();
      ctx.lineWidth = points[1].width || baseSize;
      ctx.moveTo(points[0].x, points[0].y);
      ctx.lineTo(points[1].x, points[1].y);
      ctx.stroke();
      ctx.restore();
      return;
    }

    // Midpoint Bézier curve interpolation for smooth ink
    for (let i = 0; i < points.length - 1; i++) {
      const p1 = points[i];
      const p2 = points[i + 1];
      const midX = (p1.x + p2.x) / 2;
      const midY = (p1.y + p2.y) / 2;
      const width = p2.width || computePointWidth(p1, p2, baseSize);

      ctx.beginPath();
      ctx.lineWidth = width;
      if (i === 0) {
        ctx.moveTo(p1.x, p1.y);
      } else {
        const prevMidX = (points[i - 1].x + p1.x) / 2;
        const prevMidY = (points[i - 1].y + p1.y) / 2;
        ctx.moveTo(prevMidX, prevMidY);
      }
      ctx.quadraticCurveTo(p1.x, p1.y, midX, midY);
      ctx.stroke();
    }

    // Connect final segment to the last point
    const last = points[points.length - 1];
    const prev = points[points.length - 2];
    const finalMidX = (prev.x + last.x) / 2;
    const finalMidY = (prev.y + last.y) / 2;
    ctx.beginPath();
    ctx.lineWidth = last.width || baseSize;
    ctx.moveTo(finalMidX, finalMidY);
    ctx.lineTo(last.x, last.y);
    ctx.stroke();
    ctx.restore();
  };

  // Redraw all committed strokes on the base canvas
  const redrawBaseCanvas = useCallback(() => {
    const canvas = baseCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);

    const scale = zoomLevel / 100;
    ctx.save();
    ctx.translate(pan.x, pan.y);
    ctx.scale(scale, scale);

    for (const stroke of currentPage.strokes || []) {
      let strokeColor = stroke.color;
      const lower = (stroke.color || "").toLowerCase();
      if (theme === "light" && (lower === "#ededed" || lower === "#ffffff" || lower === "#f4f4f5" || lower === "#fafafa" || lower === "#e4e4e7" || stroke.color === "white")) {
        strokeColor = "#18181B";
      } else if (theme === "dark" && (lower === "#18181b" || lower === "#000000" || lower === "#27272a" || lower === "#09090b" || stroke.color === "black")) {
        strokeColor = "#EDEDED";
      }
      const pts = stroke.points.map((p) => ({ ...p, time: 0, width: stroke.size }));
      renderSmoothCurve(ctx, pts, stroke.tool, strokeColor, stroke.size);
    }
    ctx.restore();
  }, [currentPage.id, currentPage.strokes, pan, zoomLevel, theme]);

  // Adjust canvas resolutions for crisp Retina/HiDPI
  useEffect(() => {
    const handleResize = () => {
      const container = containerRef.current;
      const baseCanvas = baseCanvasRef.current;
      const activeCanvas = activeCanvasRef.current;
      if (!container || !baseCanvas || !activeCanvas) return;

      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;

      baseCanvas.width = Math.round(rect.width * dpr);
      baseCanvas.height = Math.round(rect.height * dpr);
      baseCanvas.style.width = `${rect.width}px`;
      baseCanvas.style.height = `${rect.height}px`;

      activeCanvas.width = Math.round(rect.width * dpr);
      activeCanvas.height = Math.round(rect.height * dpr);
      activeCanvas.style.width = `${rect.width}px`;
      activeCanvas.style.height = `${rect.height}px`;

      // Update Canonical Scene Graph Viewport matrix
      sceneManager.updateViewport(rect.width, rect.height, 90);

      redrawBaseCanvas();
    };

    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [redrawBaseCanvas]);

  useEffect(() => {
    redrawBaseCanvas();
  }, [redrawBaseCanvas]);

  // Viewport point to canvas point
  const getCanvasPoint = (e: React.PointerEvent | PointerEvent): TimedPoint => {
    const container = containerRef.current;
    if (!container) return { x: 0, y: 0, time: performance.now() };
    const rect = container.getBoundingClientRect();
    const scale = zoomLevel / 100;
    const clientX = e.clientX - rect.left;
    const clientY = e.clientY - rect.top;
    return {
      x: (clientX - pan.x) / scale,
      y: (clientY - pan.y) / scale,
      pressure: (e as any).pressure || 0.5,
      time: performance.now(),
    };
  };

  // Find topmost canvas object at point
  const findObjectAtPoint = (pt: Point): CanvasObject | null => {
    const objs = currentPage.objects || [];
    for (let i = objs.length - 1; i >= 0; i--) {
      const obj = objs[i];
      if (obj.type === "line" || obj.type === "arrow") {
        const x1 = obj.x;
        const y1 = obj.y;
        const x2 = obj.x + obj.width;
        const y2 = obj.y + obj.height;
        const len = Math.hypot(x2 - x1, y2 - y1);
        if (len === 0) continue;
        const t = Math.max(0, Math.min(1, ((pt.x - x1) * (x2 - x1) + (pt.y - y1) * (y2 - y1)) / (len * len)));
        const projX = x1 + t * (x2 - x1);
        const projY = y1 + t * (y2 - y1);
        if (Math.hypot(pt.x - projX, pt.y - projY) <= 14) return obj;
      } else {
        if (pt.x >= obj.x && pt.x <= obj.x + obj.width && pt.y >= obj.y && pt.y <= obj.y + obj.height) {
          return obj;
        }
      }
    }
    return null;
  };

  // Squared distance from point p to segment v-w
  const distToSegmentSq = (p: Point, v: Point, w: Point): number => {
    const l2 = (v.x - w.x) ** 2 + (v.y - w.y) ** 2;
    if (l2 === 0) return (p.x - v.x) ** 2 + (p.y - v.y) ** 2;
    let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
    t = Math.max(0, Math.min(1, t));
    const projX = v.x + t * (w.x - v.x);
    const projY = v.y + t * (w.y - v.y);
    return (p.x - projX) ** 2 + (p.y - projY) ** 2;
  };

  // Check if segment (p1, p2) intersects segment (p3, p4)
  const segmentsIntersect = (p1: Point, p2: Point, p3: Point, p4: Point): boolean => {
    const ccw = (a: Point, b: Point, c: Point) => (c.y - a.y) * (b.x - a.x) > (b.y - a.y) * (c.x - a.x);
    return ccw(p1, p3, p4) !== ccw(p2, p3, p4) && ccw(p1, p2, p3) !== ccw(p1, p2, p4);
  };

  // Erase touched strokes and objects intersecting sweep from pPrev to pCurr
  const performStrokeErase = (pPrev: Point, pCurr: Point) => {
    let modified = false;
    let nextStrokes = currentPage.strokes || [];
    let nextObjects = currentPage.objects || [];

    // Erase threshold scaled with size (default ~14px)
    const threshold = Math.max(14, size * 1.6);
    const threshSq = threshold * threshold;

    // Hit test strokes with continuous sweep intersection
    if (nextStrokes.length > 0) {
      const filtered = nextStrokes.filter((stroke) => {
        const pts = stroke.points;
        if (!pts || pts.length === 0) return false;
        if (pts.length === 1) {
          return distToSegmentSq(pts[0], pPrev, pCurr) > threshSq;
        }
        for (let i = 0; i < pts.length - 1; i++) {
          const a = pts[i];
          const b = pts[i + 1];
          if (segmentsIntersect(pPrev, pCurr, a, b)) return false;
          if (distToSegmentSq(pCurr, a, b) <= threshSq) return false;
          if (distToSegmentSq(pPrev, a, b) <= threshSq) return false;
          if (distToSegmentSq(a, pPrev, pCurr) <= threshSq) return false;
        }
        return true;
      });
      if (filtered.length !== nextStrokes.length) {
        nextStrokes = filtered;
        modified = true;
      }
    }

    // Hit test objects
    if (nextObjects.length > 0) {
      const filtered = nextObjects.filter((obj) => {
        const minX = obj.x - threshold;
        const maxX = obj.x + obj.width + threshold;
        const minY = obj.y - threshold;
        const maxY = obj.y + obj.height + threshold;

        if (
          (pCurr.x >= minX && pCurr.x <= maxX && pCurr.y >= minY && pCurr.y <= maxY) ||
          (pPrev.x >= minX && pPrev.x <= maxX && pPrev.y >= minY && pPrev.y <= maxY)
        ) {
          sceneManager.applyOperation({ type: "remove_object", id: obj.id });
          return false;
        }

        const tl = { x: minX, y: minY };
        const tr = { x: maxX, y: minY };
        const br = { x: maxX, y: maxY };
        const bl = { x: minX, y: maxY };
        if (
          segmentsIntersect(pPrev, pCurr, tl, tr) ||
          segmentsIntersect(pPrev, pCurr, tr, br) ||
          segmentsIntersect(pPrev, pCurr, br, bl) ||
          segmentsIntersect(pPrev, pCurr, bl, tl)
        ) {
          sceneManager.applyOperation({ type: "remove_object", id: obj.id });
          return false;
        }
        return true;
      });
      if (filtered.length !== nextObjects.length) {
        nextObjects = filtered;
        modified = true;
      }
    }

    if (modified && onPageUpdate) {
      onPageUpdate({
        ...currentPage,
        strokes: nextStrokes,
        objects: nextObjects,
      });
    }
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    // Capture pointer events on the container so drawing strokes NEVER get cut off when passing over DOM overlays!
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {}

    const pt = getCanvasPoint(e);

    // Multimodal Spatial Reference Resolution: Hit-test scene graph (<1ms)
    const container = containerRef.current;
    if (container && onReferentSelect) {
      const rect = container.getBoundingClientRect();
      const screenX = e.clientX - rect.left;
      const screenY = e.clientY - rect.top;
      const vPt = sceneManager.screenToVirtual(screenX, screenY);
      const hitObj = sceneManager.hitTest(vPt, 45);
      if (hitObj) {
        onReferentSelect({
          objectId: hitObj.id,
          semanticType: hitObj.semanticType,
          label: hitObj.label || (hitObj.properties as any)?.text || (hitObj.properties as any)?.latex,
          role: hitObj.role,
        });
      }
    }

    // Pan mode (middle click or alt key drag)
    if (e.button === 1 || e.altKey) {
      setIsPanning(true);
      lastPanRef.current = { x: e.clientX, y: e.clientY };
      return;
    }

    // Select / Move tool
    if (tool === "move") {
      const hit = findObjectAtPoint(pt);
      if (hit) {
        setSelectedObjectId(hit.id);
        setDraggingObject({
          id: hit.id,
          initialX: hit.x,
          initialY: hit.y,
          startPointerX: pt.x,
          startPointerY: pt.y,
        });
      } else {
        setSelectedObjectId(null);
        setIsPanning(true);
        lastPanRef.current = { x: e.clientX, y: e.clientY };
      }
      return;
    }

    // Shape drawing mode (supports drag-to-draw!)
    if (tool.startsWith("shape")) {
      const shapeType = tool.split(":")[1] || "rect";
      setDrawingShape({
        type: shapeType,
        startX: pt.x,
        startY: pt.y,
        currentX: pt.x,
        currentY: pt.y,
      });
      setIsDrawing(true);
      onUserDrawingChange?.(true);
      return;
    }

    // Text tool: inline typing right on canvas
    if (tool === "text") {
      if (inlineText && inlineText.value.trim()) {
        commitInlineText();
      }
      setInlineText({
        x: pt.x,
        y: pt.y,
        value: "",
      });
      return;
    }

    // Eraser down: start instant stroke erase
    if (tool === "eraser") {
      setIsDrawing(true);
      onUserDrawingChange?.(true);
      lastErasePtRef.current = pt;
      performStrokeErase(pt, pt);
      return;
    }

    // Pen / Pencil / Highlighter drawing
    setIsDrawing(true);
    onUserDrawingChange?.(true);
    currentWidthRef.current = size;
    pt.width = size;
    currentPointsRef.current = [pt];

    const activeCanvas = activeCanvasRef.current;
    if (activeCanvas) {
      const ctx = activeCanvas.getContext("2d");
      const dpr = window.devicePixelRatio || 1;
      const scale = zoomLevel / 100;
      if (ctx) {
        ctx.save();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.translate(pan.x, pan.y);
        ctx.scale(scale, scale);
        renderSmoothCurve(ctx, [pt], tool, color, size);
        ctx.restore();
      }
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    // Keep track of cursor for wide eraser ring indicator
    if (tool === "eraser") {
      const container = containerRef.current;
      if (container) {
        const rect = container.getBoundingClientRect();
        setCursorPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
      }
    }

    // Pan viewport
    if (isPanning) {
      const dx = e.clientX - lastPanRef.current.x;
      const dy = e.clientY - lastPanRef.current.y;
      setPan((prev) => ({ x: prev.x + dx, y: prev.y + dy }));
      lastPanRef.current = { x: e.clientX, y: e.clientY };
      return;
    }

    const pt = getCanvasPoint(e);

    // Dragging selected object
    if (draggingObject && onPageUpdate) {
      const dx = pt.x - draggingObject.startPointerX;
      const dy = pt.y - draggingObject.startPointerY;
      const updatedObjects = (currentPage.objects || []).map((obj) => {
        if (obj.id === draggingObject.id) {
          return {
            ...obj,
            x: Math.round(draggingObject.initialX + dx),
            y: Math.round(draggingObject.initialY + dy),
          };
        }
        return obj;
      });
      onPageUpdate({
        ...currentPage,
        objects: updatedObjects,
      });
      return;
    }

    // Updating interactive shape preview
    if (drawingShape) {
      setDrawingShape((prev) => (prev ? { ...prev, currentX: pt.x, currentY: pt.y } : null));
      return;
    }

    if (!isDrawing) return;

    // Live erasing
    if (tool === "eraser") {
      const prevPt = lastErasePtRef.current || pt;
      performStrokeErase(prevPt, pt);
      lastErasePtRef.current = pt;
      return;
    }

    // Use Coalesced events for high-frequency 120Hz stylus/pen input
    const coalescedEvents = (e.nativeEvent as any).getCoalescedEvents
      ? (e.nativeEvent as any).getCoalescedEvents()
      : [e];

    const activeCanvas = activeCanvasRef.current;
    if (!activeCanvas) return;
    const ctx = activeCanvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const scale = zoomLevel / 100;

    for (const evt of coalescedEvents) {
      const cPt = getCanvasPoint(evt);
      currentPointsRef.current.push(cPt);
    }

    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, activeCanvas.width / dpr, activeCanvas.height / dpr);
    ctx.translate(pan.x, pan.y);
    ctx.scale(scale, scale);

    renderSmoothCurve(ctx, currentPointsRef.current, tool, color, size);
    ctx.restore();
  };

  const handlePointerUp = (e?: React.PointerEvent) => {
    if (e && e.currentTarget) {
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {}
    }

    // End canvas pan
    if (isPanning) {
      setIsPanning(false);
      return;
    }

    // End object drag
    if (draggingObject) {
      setDraggingObject(null);
      return;
    }

    // Commit interactive shape drawing
    if (drawingShape) {
      let w = Math.abs(drawingShape.currentX - drawingShape.startX);
      let h = Math.abs(drawingShape.currentY - drawingShape.startY);
      let minX = Math.min(drawingShape.startX, drawingShape.currentX);
      let minY = Math.min(drawingShape.startY, drawingShape.currentY);

      // If clicked without dragging, provide default dimensions
      if (w < 12 && h < 12) {
        if (drawingShape.type === "oval" || drawingShape.type === "circle" || drawingShape.type === "star") {
          w = 100;
          h = 100;
        } else if (drawingShape.type === "line" || drawingShape.type === "arrow") {
          w = 120;
          h = 0;
        } else {
          w = 120;
          h = 80;
        }
        minX = drawingShape.startX - w / 2;
        minY = drawingShape.startY - (h === 0 ? 0 : h / 2);
      }

      const shapeType =
        drawingShape.type === "oval"
          ? "circle"
          : drawingShape.type === "star"
          ? "star"
          : drawingShape.type === "arrow"
          ? "arrow"
          : drawingShape.type === "line"
          ? "line"
          : "rect";

      const newObj: CanvasObject = {
        id: Math.random().toString(36).substring(2, 9),
        page_id: currentPage.id,
        type: shapeType as any,
        x: Math.round(minX),
        y: Math.round(minY),
        width: Math.round(w),
        height: Math.round(h),
        color: color,
        stroke_width: size,
        fill: "transparent",
      };

      onObjectAdd(newObj);
      setSelectedObjectId(newObj.id);
      setDrawingShape(null);
      setIsDrawing(false);
      onUserDrawingChange?.(false);
      return;
    }

    if (!isDrawing) return;
    setIsDrawing(false);
    onUserDrawingChange?.(false);

    if (tool === "eraser") {
      lastErasePtRef.current = null;
      currentPointsRef.current = [];
      return;
    }

    // Commit inking stroke
    if (currentPointsRef.current.length > 0) {
      const stroke: Stroke = {
        id: Math.random().toString(36).substring(2, 9),
        page_id: currentPage.id,
        tool: tool as any,
        color: color,
        size: size,
        points: currentPointsRef.current.map((p) => ({
          x: p.x,
          y: p.y,
          pressure: p.pressure,
        })),
      };
      onStrokeComplete(stroke);
    }

    currentPointsRef.current = [];

    // Clear active overlay canvas after stroke commitment
    const activeCanvas = activeCanvasRef.current;
    if (activeCanvas) {
      const ctx = activeCanvas.getContext("2d");
      const dpr = window.devicePixelRatio || 1;
      if (ctx) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, activeCanvas.width / dpr, activeCanvas.height / dpr);
      }
    }
  };

  // Deduplicate objects defensively to prevent React duplicate key warnings
  const uniqueObjects = React.useMemo(() => {
    const seen = new Set<string>();
    return (currentPage.objects || []).filter((obj, idx) => {
      const key = obj.id || `obj-${idx}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [currentPage.objects]);

  const selectedObject = uniqueObjects.find((o) => o.id === selectedObjectId);

  // Handle canvas tap to skip tutor performance
  const handleCanvasTap = (e: React.PointerEvent) => {
    if (tutorIsPlaying && onTutorSkip) {
      onTutorSkip();
      return; // Don't process as normal canvas interaction
    }
    handlePointerDown(e);
  };

  return (
    <div
      ref={containerRef}
      onPointerDown={handleCanvasTap}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={() => {
        if (!isDrawing) {
          setCursorPos(null);
        }
      }}
      onPointerCancel={(e) => {
        if (e && e.currentTarget) {
          try {
            (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
          } catch {}
        }
        setCursorPos(null);
        if (isDrawing) {
          setIsDrawing(false);
          onUserDrawingChange?.(false);
        }
      }}
      className={`relative flex-1 w-full h-full overflow-hidden select-none touch-none transition-colors duration-200 ${
        tool === "eraser" ? "cursor-none" : tool === "move" ? "cursor-default" : "cursor-crosshair"
      } ${isLight ? "bg-[#FAF9F6]" : "bg-[#161616]"}`}
    >
      {/* Floating Page Creation & Switch Toast */}
      {pageToast && (
        <div className="absolute top-6 left-1/2 -translate-x-1/2 z-40 pointer-events-none animate-in fade-in zoom-in-95 duration-200">
          <div
            className={`px-4 py-1.5 rounded-full text-xs font-mono font-medium backdrop-blur-md border shadow-lg ${
              isLight
                ? "bg-white/95 border-black/10 text-zinc-800 shadow-sm"
                : "bg-[#1E1E22]/95 border-white/10 text-zinc-200 shadow-xl"
            }`}
          >
            {pageToast}
          </div>
        </div>
      )}

      {/* Floating Canvas Toolbar from Bencho — Relocated to Bottom Center */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-40 pointer-events-auto">
        <CanvasToolbar
          tool={tool}
          onToolChange={onToolChange}
          activeColor={color}
          onColorChange={onColorChange}
          strokeWidth={size}
          onWidthChange={onSizeChange}
          theme={theme}
        />
      </div>

      {/* Redesigned Pagination Dock at Bottom Left */}
      <div
        className={`absolute bottom-6 left-6 z-30 flex items-center gap-1.5 backdrop-blur-md px-2 py-1.5 rounded-2xl border shadow-lg transition-colors select-none ${
          isLight
            ? "bg-white/95 border-black/[0.08] text-zinc-700 shadow-sm"
            : "bg-[#1C1C20]/90 border-white/[0.08] text-zinc-300 shadow-xl"
        }`}
      >
        <button
          type="button"
          onClick={onPrevPage}
          disabled={currentPageNumber <= 1}
          className={`w-7 h-7 rounded-lg flex items-center justify-center transition-colors disabled:opacity-30 disabled:pointer-events-none ${
            isLight ? "hover:bg-black/5 text-zinc-700" : "hover:bg-white/10 text-zinc-300"
          }`}
          title="Previous Page"
          aria-label="Previous Page"
        >
          <ChevronLeft size={15} />
        </button>

        <div className="px-1.5 text-xs font-medium font-mono tracking-tight flex items-center gap-1">
          <span>Page</span>
          <span className="font-semibold">{currentPageNumber}</span>
          <span className="opacity-40">/</span>
          <span className="opacity-70">{totalPages}</span>
        </div>

        <button
          type="button"
          onClick={onNextPage}
          disabled={currentPageNumber >= totalPages}
          className={`w-7 h-7 rounded-lg flex items-center justify-center transition-colors disabled:opacity-30 disabled:pointer-events-none ${
            isLight ? "hover:bg-black/5 text-zinc-700" : "hover:bg-white/10 text-zinc-300"
          }`}
          title="Next Page"
          aria-label="Next Page"
        >
          <ChevronRight size={15} />
        </button>

        <div className={`w-[1px] h-3.5 mx-0.5 ${isLight ? "bg-black/10" : "bg-white/10"}`} />

        <button
          type="button"
          onClick={onNewPage}
          className={`flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg transition-colors ${
            isLight
              ? "bg-zinc-900 text-white hover:bg-black"
              : "bg-white/10 hover:bg-white/20 text-white"
          }`}
          title="Add New Page"
        >
          <Plus size={13} strokeWidth={2.5} />
          <span>Page</span>
        </button>
      </div>

      {/* Layer 1: Base HTML5 Canvas for permanent committed strokes */}
      <canvas ref={baseCanvasRef} className="absolute inset-0 z-10 pointer-events-none" />

      {/* Layer 2: Active Overlay Canvas for real-time smooth drawing */}
      <canvas ref={activeCanvasRef} className="absolute inset-0 z-15 pointer-events-none" />

      {/* Clean Modern Whiteboard Eraser Cursor */}
      {tool === "eraser" && cursorPos && (
        <div
          className="pointer-events-none absolute z-50 -translate-x-1/2 -translate-y-1/2 rounded-full border border-zinc-400/80 bg-zinc-400/20 shadow-sm backdrop-blur-[1px] transition-transform duration-75"
          style={{
            left: cursorPos.x,
            top: cursorPos.y,
            width: Math.max(22, (size || 3) * 3),
            height: Math.max(22, (size || 3) * 3),
          }}
        />
      )}

      {/* Layer 3: Semantic SVG / Math DOM Layer */}
      <div
        className="absolute inset-0 z-20 pointer-events-none origin-top-left"
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoomLevel / 100})`,
        }}
      >
        <svg className="w-[5000px] h-[5000px] pointer-events-none">
          <defs>
            <marker
              id="arrowhead-light"
              markerWidth="9"
              markerHeight="6"
              refX="8"
              refY="3"
              orient="auto"
            >
              <polygon points="0 0, 9 3, 0 6" fill="#18181B" />
            </marker>
            <marker
              id="arrowhead-dark"
              markerWidth="9"
              markerHeight="6"
              refX="8"
              refY="3"
              orient="auto"
            >
              <polygon points="0 0, 9 3, 0 6" fill="#EDEDED" />
            </marker>
          </defs>

          {/* Render Committed Objects */}
          {uniqueObjects.map((obj, idx) => {
            const key = `${obj.id || "shape"}-${idx}`;
            if (obj.type === "rect") {
              return (
                <rect
                  key={key}
                  x={obj.x}
                  y={obj.y}
                  width={obj.width}
                  height={obj.height}
                  rx={8}
                  fill={obj.fill || "transparent"}
                  stroke={getObjectColor(obj.color)}
                  strokeWidth={obj.stroke_width || 2}
                  className="transition-all"
                />
              );
            }
            if (obj.type === "triangle") {
              const p1 = `${obj.x},${obj.y + obj.height}`;
              const p2 = `${obj.x + obj.width},${obj.y + obj.height}`;
              const p3 = `${obj.x},${obj.y}`;
              return (
                <polygon
                  key={key}
                  points={`${p1} ${p2} ${p3}`}
                  fill={obj.fill || "transparent"}
                  stroke={getObjectColor(obj.color)}
                  strokeWidth={obj.stroke_width || 2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  className="transition-all"
                />
              );
            }
            if (obj.type === "circle") {
              const r = Math.min(obj.width, obj.height) / 2;
              return (
                <circle
                  key={key}
                  cx={obj.x + r}
                  cy={obj.y + r}
                  r={r}
                  fill={obj.fill || "transparent"}
                  stroke={getObjectColor(obj.color)}
                  strokeWidth={obj.stroke_width || 2}
                  className="transition-all"
                />
              );
            }
            if (obj.type === "line") {
              return (
                <line
                  key={key}
                  x1={obj.x}
                  y1={obj.y}
                  x2={obj.x + obj.width}
                  y2={obj.y + obj.height}
                  stroke={getObjectColor(obj.color)}
                  strokeWidth={obj.stroke_width || 2}
                  strokeLinecap="round"
                />
              );
            }
            if (obj.type === "arrow") {
              return (
                <line
                  key={key}
                  x1={obj.x}
                  y1={obj.y}
                  x2={obj.x + obj.width}
                  y2={obj.y + obj.height}
                  stroke={getObjectColor(obj.color)}
                  strokeWidth={obj.stroke_width || 2}
                  strokeLinecap="round"
                  markerEnd={isLight ? "url(#arrowhead-light)" : "url(#arrowhead-dark)"}
                />
              );
            }
            if (obj.type === "star") {
              const r = Math.min(obj.width, obj.height) / 2;
              return (
                <polygon
                  key={key}
                  points={getStarPoints(obj.x + r, obj.y + r, r)}
                  fill={obj.fill || "transparent"}
                  stroke={getObjectColor(obj.color)}
                  strokeWidth={obj.stroke_width || 2}
                  strokeLinejoin="round"
                />
              );
            }
            return null;
          })}

          {/* Live Drag-to-Draw Shape Preview */}
          {drawingShape && (() => {
            const w = Math.abs(drawingShape.currentX - drawingShape.startX);
            const h = Math.abs(drawingShape.currentY - drawingShape.startY);
            const minX = Math.min(drawingShape.startX, drawingShape.currentX);
            const minY = Math.min(drawingShape.startY, drawingShape.currentY);
            const previewColor = getObjectColor(color);

            if (drawingShape.type === "oval" || drawingShape.type === "circle") {
              const r = Math.min(w, h) / 2;
              return (
                <circle
                  cx={minX + r}
                  cy={minY + r}
                  r={r}
                  fill="transparent"
                  stroke={previewColor}
                  strokeWidth={size}
                  strokeDasharray="4 4"
                />
              );
            }
            if (drawingShape.type === "line") {
              return (
                <line
                  x1={drawingShape.startX}
                  y1={drawingShape.startY}
                  x2={drawingShape.currentX}
                  y2={drawingShape.currentY}
                  stroke={previewColor}
                  strokeWidth={size}
                  strokeDasharray="4 4"
                />
              );
            }
            if (drawingShape.type === "arrow") {
              return (
                <line
                  x1={drawingShape.startX}
                  y1={drawingShape.startY}
                  x2={drawingShape.currentX}
                  y2={drawingShape.currentY}
                  stroke={previewColor}
                  strokeWidth={size}
                  strokeDasharray="4 4"
                  markerEnd={isLight ? "url(#arrowhead-light)" : "url(#arrowhead-dark)"}
                />
              );
            }
            if (drawingShape.type === "star") {
              const r = Math.min(w, h) / 2;
              return (
                <polygon
                  points={getStarPoints(minX + r, minY + r, r)}
                  fill="transparent"
                  stroke={previewColor}
                  strokeWidth={size}
                  strokeDasharray="4 4"
                />
              );
            }
            return (
              <rect
                x={minX}
                y={minY}
                width={w}
                height={h}
                rx={6}
                fill="transparent"
                stroke={previewColor}
                strokeWidth={size}
                strokeDasharray="4 4"
              />
            );
          })()}
        </svg>

        {/* Selected Object Bounding Box with Delete Action */}
        {selectedObject && (
          <div
            className="absolute z-30 pointer-events-auto border-2 border-dashed border-blue-500 rounded-lg"
            style={{
              left: selectedObject.x - 4,
              top: selectedObject.y - 4,
              width: (selectedObject.width || 40) + 8,
              height: (selectedObject.height || 30) + 8,
            }}
          >
            {/* Corner resize indicators */}
            <span className="absolute -top-1 -left-1 w-2.5 h-2.5 bg-blue-500 rounded-sm shadow-sm" />
            <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-blue-500 rounded-sm shadow-sm" />
            <span className="absolute -bottom-1 -left-1 w-2.5 h-2.5 bg-blue-500 rounded-sm shadow-sm" />
            <span className="absolute -bottom-1 -right-1 w-2.5 h-2.5 bg-blue-500 rounded-sm shadow-sm" />

            {/* Quick Delete Floating Button */}
            <button
              type="button"
              onPointerDown={(e) => {
                e.stopPropagation();
                e.preventDefault();
                if (onPageUpdate) {
                  onPageUpdate({
                    ...currentPage,
                    objects: (currentPage.objects || []).filter((o) => o.id !== selectedObject.id),
                  });
                }
                setSelectedObjectId(null);
              }}
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                if (onPageUpdate) {
                  onPageUpdate({
                    ...currentPage,
                    objects: (currentPage.objects || []).filter((o) => o.id !== selectedObject.id),
                  });
                }
                setSelectedObjectId(null);
              }}
              className="absolute -top-3.5 -right-3.5 w-6 h-6 rounded-full bg-red-500 text-white flex items-center justify-center shadow-md hover:bg-red-600 active:scale-90 transition-all cursor-pointer z-50 pointer-events-auto"
              title="Delete selected object"
              aria-label="Delete object"
            >
              <Trash2 size={12} strokeWidth={2.5} />
            </button>
          </div>
        )}

        {/* DOM Objects: Text & Math */}
        {uniqueObjects.map((obj, idx) => {
          const key = `${obj.id || "dom"}-${idx}`;
          if (obj.type === "text" && obj.text) {
            const isTitle = obj.id?.startsWith("title-");
            return (
              <div
                key={key}
                className={`absolute select-none pointer-events-auto transition-transform ${
                  selectedObjectId === obj.id ? "ring-2 ring-blue-500 rounded-xl" : ""
                }`}
                style={{
                  left: obj.x,
                  top: obj.y,
                  transform: "translate(-50%, -50%)",
                }}
              >
                {isTitle ? (
                  <div
                    className={`font-sans font-bold text-xs uppercase tracking-widest px-4 py-1.5 rounded-full select-none transition-all shadow-xs whitespace-nowrap ${
                      isLight
                        ? "bg-zinc-100 text-zinc-700 border border-zinc-300/80"
                        : "bg-zinc-850 text-zinc-200 border border-zinc-700/80"
                    }`}
                    style={{
                      color: getObjectColor(obj.color),
                    }}
                  >
                    {obj.text}
                  </div>
                ) : (
                  <div
                    className="font-sans font-medium text-sm px-1.5 py-0.5 select-none transition-all whitespace-nowrap"
                    style={{
                      color: getObjectColor(obj.color),
                    }}
                  >
                    {obj.text}
                  </div>
                )}
              </div>
            );
          }

          if (obj.type === "math" && obj.latex) {
            const renderedHtml = safeKatexRender(obj.latex, false);

            return (
              <div
                key={key}
                className={`absolute select-none pointer-events-auto transition-transform ${
                  selectedObjectId === obj.id ? "ring-2 ring-blue-500 rounded-lg" : ""
                }`}
                style={{
                  left: obj.x,
                  top: obj.y,
                  transform: "translate(-50%, -50%)",
                }}
              >
                <div
                  className="text-lg md:text-xl px-2 py-0.5 select-none transition-all"
                  style={{
                    color: getObjectColor(obj.color),
                  }}
                  dangerouslySetInnerHTML={{ __html: renderedHtml }}
                />
              </div>
            );
          }
          return null;
        })}

        {/* Inline On-Canvas Text Input (No prompt()!) */}
        {inlineText && (
          <div
            className="absolute z-30 pointer-events-auto"
            style={{ left: inlineText.x, top: inlineText.y }}
          >
            <input
              ref={inlineInputRef}
              type="text"
              value={inlineText.value}
              placeholder="Type label here..."
              onChange={(e) =>
                setInlineText((prev) => (prev ? { ...prev, value: e.target.value } : null))
              }
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitInlineText();
                } else if (e.key === "Escape") {
                  setInlineText(null);
                }
              }}
              onBlur={commitInlineText}
              className={`px-3 py-1.5 rounded-xl border text-sm font-medium outline-none shadow-lg backdrop-blur-md min-w-[150px] ${
                isLight
                  ? "bg-white border-zinc-400 text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-900"
                  : "bg-[#202024] border-zinc-600 text-white placeholder:text-zinc-500 focus:border-white"
              }`}
            />
          </div>
        )}

        {/* Living AI Pointer Overlay (Spring-Animated for BOTH drawing and speech anchor performance!) */}
        {tutorPointer && tutorPointer.visible && Number.isFinite(tutorPointer.x) && Number.isFinite(tutorPointer.y) ? (
          <AiPointerOverlay pointer={tutorPointer} theme={theme} />
        ) : aiPointer && Number.isFinite(aiPointer.x) && Number.isFinite(aiPointer.y) ? (
          <AiPointerOverlay
            pointer={{
              x: aiPointer.x,
              y: aiPointer.y,
              visible: true,
              message: aiPointer.message,
              phase: "highlighting",
            }}
            theme={theme}
          />
        ) : null}

        {/* Animated Shape/Stroke Renderer — stroke-by-stroke tutor drawing */}
        {tutorActiveStep && (
          tutorActiveStep.type === "draw_shape" ||
          tutorActiveStep.type === "draw_stroke" ||
          tutorActiveStep.type === "type_text"
        ) && (
          <div className="absolute inset-0 z-25 pointer-events-none">
            <AnimatedShapeRenderer
              step={tutorActiveStep}
              onComplete={onTutorStepComplete || (() => {})}
              onObjectReady={onObjectAdd}
              onStrokeReady={onStrokeComplete}
              onPointerMove={onTutorPointerMove}
              theme={theme}
            />
          </div>
        )}

        {/* Tutor Drawing Skip Hint */}
        {tutorIsPlaying && (
          <div
            className="absolute bottom-20 left-1/2 -translate-x-1/2 z-50 pointer-events-none"
            style={{ animation: "tutor-skip-hint 3s ease forwards" }}
          >
            <div
              className={`text-[10px] font-medium px-3 py-1 rounded-full border backdrop-blur-md ${
                isLight
                  ? "bg-white/90 border-black/10 text-zinc-500"
                  : "bg-[#1C1C20]/90 border-white/10 text-zinc-400"
              }`}
            >
              Tap canvas to skip
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
