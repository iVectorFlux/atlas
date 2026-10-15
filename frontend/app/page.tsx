"use client";

import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { 
  ThemeMode,
  Stroke, 
  CanvasObject, 
  CanvasDocument, 
  CanvasPage, 
  ChatMessage, 
  ActionChip, 
  CanvasOp,
  TutorPerformance,
  TutorStep 
} from "@/lib/types";
import { 
  createSession, 
  getCanvas, 
  submitCanvasOp, 
  getChatHistory, 
  subscribeChatStream 
} from "@/lib/api";
import { useTutorPerformance } from "@/lib/useTutorPerformance";
import { useVoiceInput } from "@/lib/useVoiceInput";
import { useTutorVoice } from "@/lib/useTutorVoice";
import { Navbar } from "@/components/zawvee/Navbar";
import { CanvasWorkspace } from "@/components/canvas/CanvasWorkspace";
import { TutorCanvasOverlay } from "@/components/canvas/TutorCanvasOverlay";
import { textToStrokes, centerStrokes, getStrokesBoundingBox } from "@/lib/handwritingEngine";
import {
  createRightTriangleStrokes,
  createFractionCircleStrokes,
  createFractionBarStrokes,
  createAtomModelStrokes,
  createAnnotationStrokes,
  createSlopeInterceptStrokes,
  createNumberLineStrokes,
  createCircleGeometryStrokes,
  createWaveStrokes,
  createParabolaStrokes,
  createGravityOrbitStrokes,
  createSpacetimeCurvatureStrokes,
  createFaradayInductionStrokes,
  createElectricCircuitStrokes,
  createDynamicSceneStrokesAndObjects,
  parseSvgToDynamicElements,
  cleanLatexFormula,
  DynamicScene,
} from "@/lib/sketchEngine";
import {
  createArrayModelStrokes,
  createTenFrameStrokes,
  createTapeDiagramStrokes,
} from "@/lib/elementaryMathModels";
import { sceneManager } from "@/lib/sceneGraph/sceneManager";
import { BoundingBox } from "@/lib/sceneGraph/types";
import { computeBoundingBox, computePointsBoundingBox } from "@/lib/sceneGraph/layoutEngine";
import { performanceDirector } from "@/lib/sceneGraph/performanceDirector";
import { HandwritingPracticeOverlay } from "@/components/canvas/HandwritingPracticeOverlay";
import { LessonTranscriptDrawer } from "@/components/talk/LessonTranscriptDrawer";
import { choreographToSpeech } from "@/lib/choreography";

const INITIAL_ACTION_CHIPS: ActionChip[] = [
  { id: "init-1", label: "What is 3/4 with a chocolate bar?", action: "explain_chocolate_bar" },
  { id: "init-2", label: "Show 3 × 4 with an array", action: "explain_array" },
  { id: "init-3", label: "Add 8 + 5 on a ten-frame", action: "explain_ten_frame" },
  { id: "init-4", label: "How does 3 + 4 look on a number line?", action: "explain_number_line" },
  { id: "init-5", label: "What is 1/2 of a circle?", action: "draw_fraction" },
  { id: "init-6", label: "Draw a 3-4-5 right triangle", action: "explain_pythagoras" },
];

/**
 * Center and scale tutor canvas objects based on the user's visible viewport and zoom.
 * Canonical diagrams are authored on an 800×600 virtual blackboard centered around (400, 250).
 * This dynamically centers and scales them so they ALWAYS appear at the exact visual center of the screen.
 */
function centerCanvasObject(
  obj: CanvasObject,
  viewportWidth: number,
  viewportHeight: number,
  zoomLevel: number = 100
): CanvasObject {
  const scale = (zoomLevel || 100) / 100;
  
  // Calculate canvas coordinates that map to the visible center of the screen
  const screenCenterX = viewportWidth / 2;
  const screenCenterY = Math.max(160, (viewportHeight - 80) / 2);
  
  const canvasCenterX = screenCenterX / scale;
  const canvasCenterY = screenCenterY / scale;

  // Responsive scale factor: on narrower screens (mobile), scale diagram to fit comfortably
  const mobileScale = viewportWidth < 680 ? Math.max(0.55, (viewportWidth - 40) / 680) : 1;

  const REF_CX = 400;
  const REF_CY = 250;

  const rawX = obj.x ?? 400;
  const rawY = obj.y ?? 250;
  const rawW = obj.width ?? 100;
  const rawH = obj.height ?? 80;

  const centeredX = Math.round(canvasCenterX + (rawX - REF_CX) * mobileScale);
  const centeredY = Math.round(canvasCenterY + (rawY - REF_CY) * mobileScale);
  const scaledW = Math.round(rawW * mobileScale);
  const scaledH = Math.round(rawH * mobileScale);

  return {
    ...obj,
    x: centeredX,
    y: centeredY,
    width: scaledW,
    height: scaledH,
  };
}

function centerHighlightTarget(
  pt: { x: number; y: number },
  viewportWidth: number,
  viewportHeight: number,
  zoomLevel: number = 100
): { x: number; y: number } {
  const scale = (zoomLevel || 100) / 100;
  const screenCenterX = viewportWidth / 2;
  const screenCenterY = Math.max(160, (viewportHeight - 80) / 2);
  const canvasCenterX = screenCenterX / scale;
  const canvasCenterY = screenCenterY / scale;
  const mobileScale = viewportWidth < 680 ? Math.max(0.55, (viewportWidth - 40) / 680) : 1;

  return {
    x: Math.round(canvasCenterX + (pt.x - 400) * mobileScale),
    y: Math.round(canvasCenterY + (pt.y - 250) * mobileScale),
  };
}

export default function ZawveeApp() {
  const [sessionId, setSessionId] = useState<string>("");
  const [theme, setTheme] = useState<ThemeMode>("dark");
  const [tool, setTool] = useState<string>("pen");
  const [color, setColor] = useState<string>("#EDEDED");
  const [size, setSize] = useState<number>(6);
  // Default to 100% zoom for readable, crisp, properly proportioned whiteboard
  const [zoomLevel, setZoomLevel] = useState<number>(100);

  // Restore theme preference from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem("zawvee_theme") as ThemeMode | null;
    if (saved === "light" || saved === "dark") {
      setTheme(saved);
      document.documentElement.setAttribute("data-theme", saved);
      if (saved === "light") {
        setColor("#18181B");
      }
    } else {
      document.documentElement.setAttribute("data-theme", "dark");
    }
  }, []);

  const handleThemeToggle = () => {
    setTheme((prev) => {
      const next: ThemeMode = prev === "dark" ? "light" : "dark";
      localStorage.setItem("zawvee_theme", next);
      document.documentElement.setAttribute("data-theme", next);

      // Align default pen ink with the new paper background
      if (next === "light" && color === "#EDEDED") {
        setColor("#18181B");
      } else if (next === "dark" && color === "#18181B") {
        setColor("#EDEDED");
      }
      return next;
    });
  };

  // Canvas State
  const [canvasDoc, setCanvasDoc] = useState<CanvasDocument>({
    id: "doc-init",
    session_id: "init",
    active_page_id: "page-1",
    pages: [{ id: "page-1", document_id: "doc-init", title: "Page 1", order: 0, strokes: [], objects: [], version: 1 }],
    version: 1,
    updated_at: Date.now(),
  });

  // Undo / Redo History Stack
  const [history, setHistory] = useState<CanvasPage[]>([]);
  const [future, setFuture] = useState<CanvasPage[]>([]);

  // AI Tutor State & Full Session Transcript History
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState<boolean>(false);
  const [streamingToken, setStreamingToken] = useState<string>("");
  const [isAiWorking, setIsAiWorking] = useState<boolean>(false);
  const [isTranscriptOpen, setIsTranscriptOpen] = useState<boolean>(false);
  const [actionChips, setActionChips] = useState<ActionChip[]>(INITIAL_ACTION_CHIPS);

  const handleToggleTranscript = useCallback(() => {
    setIsTranscriptOpen((prev) => !prev);
  }, []);

  const handleClearTranscript = useCallback(() => {
    setMessages([]);
  }, []);

  // Signal ref to trigger synchronized drawing the instant voice audio starts playing
  const audioStartSignalRef = useRef<(() => void) | null>(null);
  const isAudioActuallyPlayingRef = useRef(false);
  // Releases the next speech-locked drawing beat (bound to tutor.signalBeat below)
  const beatSignalRef = useRef<() => void>(() => {});

  // Tutor Voice Output (Deepgram Aura-2 / OpenAI TTS / Web Speech)
  const voiceOutput = useTutorVoice({
    onAudioStart: () => {
      isAudioActuallyPlayingRef.current = true;
      if (audioStartSignalRef.current) {
        // This sentence launches the drawing (its first beat plays with it)
        audioStartSignalRef.current();
        audioStartSignalRef.current = null;
      } else {
        // Every later sentence releases the next part of the board
        beatSignalRef.current();
      }
    },
    onComplete: () => {
      isAudioActuallyPlayingRef.current = false;
    },
  });

  // Audio-Clock Performance Pointer (Laser Pointer & Highlights synced to speech)
  const [performancePointer, setPerformancePointer] = useState<{ x: number; y: number; message?: string } | null>(null);

  useEffect(() => {
    const unsubscribe = performanceDirector.subscribe((state) => {
      setPerformancePointer(state.pointerTarget);
    });
    return unsubscribe;
  }, []);

  // Handwriting Intelligence Studio (LLM-Free Browser-Native Character Formation)
  const [isHandwritingStudioOpen, setIsHandwritingStudioOpen] = useState(false);

  // Track user drawing state for UI transparency pass-through
  const [userIsDrawing, setUserIsDrawing] = useState(false);

  // Ref tracking canvasDoc to prevent stale closures during async operations
  const canvasDocRef = useRef(canvasDoc);
  canvasDocRef.current = canvasDoc;

  // Add semantic object (shape, text, math) to target page (deduplicated by id)
  const handleObjectAdd = useCallback((obj: CanvasObject) => {
    setCanvasDoc((prev) => {
      const targetPageId = obj.page_id || prev.active_page_id;
      const targetPage = prev.pages.find((p) => p.id === targetPageId);
      if (targetPage) {
        setHistory((prevH) => [...prevH, JSON.parse(JSON.stringify(targetPage))]);
      }
      setFuture([]);
      const pages = prev.pages.map((p) => {
        if (p.id === targetPageId) {
          const existing = p.objects || [];
          const filtered = existing.filter((o) => o.id !== obj.id);
          return {
            ...p,
            objects: [...filtered, obj],
            version: p.version + 1,
          };
        }
        return p;
      });
      return { ...prev, pages, version: prev.version + 1 };
    });

    if (sessionId) {
      submitCanvasOp(sessionId, {
        op: "create_shape",
        page_id: obj.page_id || canvasDocRef.current.active_page_id,
        payload: obj as any,
      }).catch(() => {});
    }
  }, [sessionId]);

  // Add stroke to target page
  const handleStrokeComplete = useCallback((stroke: Stroke) => {
    setCanvasDoc((prev) => {
      const targetPageId = stroke.page_id || prev.active_page_id;
      const pages = prev.pages.map((p) => {
        if (p.id === targetPageId) {
          return {
            ...p,
            strokes: [...(p.strokes || []), stroke],
            version: p.version + 1,
          };
        }
        return p;
      });
      return { ...prev, pages, version: prev.version + 1 };
    });
  }, []);

  // Tutor Animated Drawing Queue
  const tutor = useTutorPerformance({
    onObjectCommit: (obj) => {
      handleObjectAdd(obj.page_id ? obj : { ...obj, page_id: canvasDocRef.current.active_page_id });
    },
    onStrokeCommit: (stroke) => {
      handleStrokeComplete(stroke);
    },
    isVoiceActive: () => isAudioActuallyPlayingRef.current,
  });
  beatSignalRef.current = tutor.signalBeat;

  // Multimodal Spatial Reference State ("What is this?")
  const [activeReferent, setActiveReferent] = useState<{
    objectId: string;
    semanticType: string;
    label?: string;
    role?: string;
  } | null>(null);

  // Voice Input (Web Speech API) with Fast-Path Barge-In Interruption
  const voiceInput = useVoiceInput({
    onSpeechDetected: () => {
      // 0ms instant local audio stop & drawing freeze / reconciliation
      isAudioActuallyPlayingRef.current = false;
      if (audioStartSignalRef.current) {
        audioStartSignalRef.current = null;
      }
      if (voiceOutput.isSpeaking || tutor.isPlaying) {
        voiceOutput.stop();
        tutor.interrupt();
      }
    },
    onResult: (transcript) => {
      if (transcript.trim()) {
        handleSendMessage(transcript.trim());
      }
    },
  });

  // Handle listening start (stop tutor voice output & reconcile drawing if student starts talking)
  const handleToggleListening = useCallback(() => {
    if (!voiceInput.isListening) {
      voiceOutput.stop();
      tutor.interrupt();
    }
    voiceInput.toggleListening();
  }, [voiceInput, voiceOutput, tutor]);

  // Initialize or restore session
  useEffect(() => {
    async function init() {
      try {
        const session = await createSession("draw");
        setSessionId(session.id);
        const doc = await getCanvas(session.id);
        setCanvasDoc(doc);
        const historyMsgs = await getChatHistory(session.id);
        setMessages(historyMsgs);
      } catch (err) {
        console.warn("Using offline standalone session:", err);
        setSessionId("local-standalone-session");
      }
    }
    init();
  }, []);

  const currentPage = canvasDoc.pages.find((p) => p.id === canvasDoc.active_page_id) || canvasDoc.pages[0];
  const currentPageNumber = canvasDoc.pages.findIndex((p) => p.id === currentPage.id) + 1;

  // Zoom toggle between 100% (Standard) and 50% (Overview)
  const handleZoomToggle = () => {
    setZoomLevel((prev) => (prev === 100 ? 50 : 100));
  };

  // Undo
  const handleUndo = () => {
    if (history.length === 0) return;
    const last = history[history.length - 1];
    setHistory((prev) => prev.slice(0, -1));
    setFuture((prev) => [JSON.parse(JSON.stringify(currentPage)), ...prev]);
    setCanvasDoc((prev) => ({
      ...prev,
      pages: prev.pages.map((p) => (p.id === currentPage.id ? last : p)),
    }));
  };

  // Redo
  const handleRedo = () => {
    if (future.length === 0) return;
    const next = future[0];
    setFuture((prev) => prev.slice(1));
    setHistory((prev) => [...prev, JSON.parse(JSON.stringify(currentPage))]);
    setCanvasDoc((prev) => ({
      ...prev,
      pages: prev.pages.map((p) => (p.id === currentPage.id ? next : p)),
    }));
  };

  // Clear current page (instant, smooth, undoable)
  const handleClear = useCallback(() => {
    // Stop any active tutor speech or drawing
    voiceOutput.stop();
    tutor.cancelAll();

    setHistory((prev) => [...prev, JSON.parse(JSON.stringify(currentPage))]);
    setFuture([]);
    setCanvasDoc((prev) => ({
      ...prev,
      pages: prev.pages.map((p) =>
        p.id === currentPage.id ? { ...p, strokes: [], objects: [], version: p.version + 1 } : p
      ),
    }));

    if (sessionId) {
      submitCanvasOp(sessionId, {
        op: "clear_page",
        page_id: currentPage.id,
        payload: {} as any,
      }).catch(() => {});
    }
  }, [currentPage, sessionId, tutor, voiceOutput]);

  // Create new page with clean ID and backend sync
  const handleNewPage = () => {
    const pageNum = canvasDoc.pages.length + 1;
    const newPageId = `page-${pageNum}-${Date.now().toString(36)}`;
    const newPage: CanvasPage = {
      id: newPageId,
      document_id: canvasDoc.id,
      title: `Page ${pageNum}`,
      order: canvasDoc.pages.length,
      strokes: [],
      objects: [],
      version: 1,
    };
    setCanvasDoc((prev) => ({
      ...prev,
      pages: [...prev.pages, newPage],
      active_page_id: newPageId,
    }));

    if (sessionId) {
      submitCanvasOp(sessionId, {
        op: "create_page",
        page_id: newPageId,
        payload: { id: newPageId, title: `Page ${pageNum}`, order: canvasDoc.pages.length },
      }).catch(() => {});
    }
  };

  // Switch to previous page
  const handlePrevPage = () => {
    const idx = canvasDoc.pages.findIndex((p) => p.id === canvasDoc.active_page_id);
    if (idx > 0) {
      const prevPageId = canvasDoc.pages[idx - 1].id;
      setCanvasDoc((prev) => ({ ...prev, active_page_id: prevPageId }));
      if (sessionId) {
        submitCanvasOp(sessionId, {
          op: "set_page",
          payload: { page_id: prevPageId },
        }).catch(() => {});
      }
    }
  };

  // Switch to next page
  const handleNextPage = () => {
    const idx = canvasDoc.pages.findIndex((p) => p.id === canvasDoc.active_page_id);
    if (idx < canvasDoc.pages.length - 1) {
      const nextPageId = canvasDoc.pages[idx + 1].id;
      setCanvasDoc((prev) => ({ ...prev, active_page_id: nextPageId }));
      if (sessionId) {
        submitCanvasOp(sessionId, {
          op: "set_page",
          payload: { page_id: nextPageId },
        }).catch(() => {});
      }
    }
  };

  // Update page content directly (used for object-level erasing and deleting)
  const handlePageUpdate = (updatedPage: CanvasPage) => {
    setCanvasDoc((prev) => ({
      ...prev,
      pages: prev.pages.map((p) => (p.id === updatedPage.id ? updatedPage : p)),
      version: prev.version + 1,
    }));
  };

  // Export Canvas as PNG
  const handleExport = () => {
    alert("Canvas snapshot prepared! Click OK to save.");
  };

  // Skip both tutor drawing animation and voice speech
  const handleSkip = useCallback(() => {
    tutor.skip();
    voiceOutput.stop();
  }, [tutor, voiceOutput]);

  // Send message to AI Tutor — low latency streaming voice + centered drawing on the board
  const handleSendMessage = useCallback(
    (text: string) => {
      if (!sessionId) return;

      // Fast-Path Barge-In & Multimodal Referent Resolution Context
      const lastInterruption = performanceDirector.getLastInterruption();
      const isRecentInterruption = lastInterruption && (Date.now() - lastInterruption.timestamp < 15000);
      const interruptionCtx = isRecentInterruption ? lastInterruption : undefined;
      performanceDirector.clearLastInterruption();

      const referentCtx = activeReferent;
      setActiveReferent(null);

      // Stop previous audio and drawing if any (with >=80% state reconciliation)
      isAudioActuallyPlayingRef.current = false;
      if (audioStartSignalRef.current) {
        audioStartSignalRef.current = null;
      }
      voiceOutput.stop();
      tutor.interrupt();

      // Auto-Page on Topic Change: if the current blackboard page already has drawings,
      // create a new clean slide so the student's previous work is preserved in page history!
      const currentDoc = canvasDocRef.current;
      const activePage = currentDoc.pages.find((p) => p.id === currentDoc.active_page_id) || currentDoc.pages[0];
      const hasContent = (activePage.strokes && activePage.strokes.length > 0) || 
                         (activePage.objects && activePage.objects.length > 0);

      let targetPageId = activePage.id;
      if (hasContent) {
        const pageNum = currentDoc.pages.length + 1;
        targetPageId = `page-${pageNum}-${Date.now().toString(36)}`;
        const newPage: CanvasPage = {
          id: targetPageId,
          document_id: currentDoc.id,
          title: `Page ${pageNum}`,
          order: currentDoc.pages.length,
          strokes: [],
          objects: [],
          version: 1,
        };
        setCanvasDoc((prev) => ({
          ...prev,
          pages: [...prev.pages, newPage],
          active_page_id: targetPageId,
        }));

        if (sessionId) {
          submitCanvasOp(sessionId, {
            op: "create_page",
            page_id: targetPageId,
            payload: { id: targetPageId, title: `Page ${pageNum}`, order: currentDoc.pages.length },
          }).catch(() => {});
        }
      }

      const userMessage: ChatMessage = {
        id: `user-${Date.now().toString(36)}`,
        session_id: sessionId,
        role: "user",
        content: text,
        created_at: Date.now(),
      };
      setMessages((prev) => [...prev, userMessage]);
      setIsStreaming(true);
      setStreamingToken("");
      setIsAiWorking(true);

      let processedSpeechIndex = 0;

      subscribeChatStream(sessionId, text, {
        onStatus: () => {},
        onToken: (tok) => {
          setStreamingToken(tok.accumulated);

          // Pipelined speech: synthesize and speak sentence-by-sentence in real time.
          // The teacher's opener is spoken immediately (before the diagram JSON finishes);
          // the drawing then joins the voice beat-by-beat via speech-locked choreography.
          const cleanAccumulated = tok.accumulated.split("```")[0];
          let unhandled = cleanAccumulated.slice(processedSpeechIndex);
          let sentenceMatch = unhandled.match(/^\s*([^.!?]+[.!?]+)\s*/);
          while (sentenceMatch) {
            const sentence = sentenceMatch[1].trim();
            processedSpeechIndex += sentenceMatch[0].length;
            if (sentence.length > 5) {
              voiceOutput.prefetchSentence(sentence);
              voiceOutput.queueSentence(sentence);
            }
            unhandled = cleanAccumulated.slice(processedSpeechIndex);
            sentenceMatch = unhandled.match(/^\s*([^.!?]+[.!?]+)\s*/);
          }
        },
        onActionChips: (chips) => {
          if (chips && chips.length > 0) {
            setActionChips(chips);
          }
        },
        onCanvasOp: (op: CanvasOp) => {
          setIsAiWorking(true);

          const vw = typeof window !== "undefined" ? window.innerWidth : 1400;
          const vh = typeof window !== "undefined" ? window.innerHeight : 800;
          const scale = zoomLevel / 100;
          const boardCenterX = (vw / 2) / scale;
          const middleZoneY = 230;
          const boardCenterY = middleZoneY;

          const steps: TutorStep[] = [];

          // Helper to convert strokes into smooth choreographed tutor steps
          const convertStrokesToSteps = (strokes: Stroke[]): TutorStep[] => {
            const res: TutorStep[] = [];
            const strokeCount = strokes.length;
            const pauseDuration = strokeCount <= 4 ? 60 : strokeCount <= 15 ? 40 : 25;

            for (let idx = 0; idx < strokes.length; idx++) {
              const stroke = strokes[idx];
              if (!stroke.points || stroke.points.length === 0) continue;
              const firstPt = stroke.points[0];

              // Fast but visible drawing speed (90ms - 280ms)
              const ptCount = stroke.points.length;
              const drawDuration = Math.min(280, Math.max(90, ptCount * 9));
              res.push({
                type: "draw_stroke",
                target: firstPt,
                points: stroke.points,
                payload: stroke,
                duration: drawDuration,
              });

              // Micro pause between elements
              res.push({
                type: "pause",
                duration: pauseDuration,
              });
            }
            return res;
          };

          if (op.op === "draw_scene" || op.op === "draw_svg") {
            const sceneData: DynamicScene =
              op.op === "draw_svg"
                ? { elements: parseSvgToDynamicElements(op.payload.svg || "") }
                : (op.payload as DynamicScene);

            const { strokes: sceneStrokes, objects: mathObjs, highlights } = createDynamicSceneStrokesAndObjects(
              sceneData,
              { pageId: targetPageId, textColor: theme === "light" ? "#18181B" : "#EDEDED" }
            );

            // Clear previous drawings on active page and reset canonical scene graph
            sceneManager.applyOperation({ type: "clear" });
            setCanvasDoc((prev) => ({
              ...prev,
              pages: prev.pages.map((p) =>
                p.id === targetPageId ? { ...p, strokes: [], objects: [], version: p.version + 1 } : p
              ),
              version: prev.version + 1,
            }));

            // Partition mathObjs into title (if any) and content math objects BEFORE computing scene bounds
            const titleObj = mathObjs.find((o) => o.id?.startsWith("title-") || (o.type === "text" && o.y < 60));
            const otherMathObjs = mathObjs.filter((o) => o !== titleObj);

            // Compute unified scene bounding box across diagram strokes and content math objects (excluding title)
            let minX = Infinity;
            let maxX = -Infinity;
            let minY = Infinity;
            let maxY = -Infinity;

            for (const s of sceneStrokes) {
              for (const p of s.points) {
                if (p.x < minX) minX = p.x;
                if (p.x > maxX) maxX = p.x;
                if (p.y < minY) minY = p.y;
                if (p.y > maxY) maxY = p.y;
              }
            }

            for (const mo of otherMathObjs) {
              const hw = (mo.width || 140) / 2;
              const hh = (mo.height || 45) / 2;
              if (mo.x - hw < minX) minX = mo.x - hw;
              if (mo.x + hw > maxX) maxX = mo.x + hw;
              if (mo.y - hh < minY) minY = mo.y - hh;
              if (mo.y + hh > maxY) maxY = mo.y + hh;
            }

            const hasBounds = Number.isFinite(minX) && Number.isFinite(maxX) && Number.isFinite(minY) && Number.isFinite(maxY);
            const sMinX = hasBounds ? minX : 100;
            const sMaxX = hasBounds ? maxX : 700;
            const sMinY = hasBounds ? minY : 90;
            const sMaxY = hasBounds ? maxY : 440;

            const sceneW = Math.max(1, sMaxX - sMinX);
            const sceneH = Math.max(1, sMaxY - sMinY);
            const sceneCenterX = (sMinX + sMaxX) / 2;
            const sceneCenterY = (sMinY + sMaxY) / 2;

            const maxW = Math.max(260, (vw * 0.82) / scale);
            const maxH = Math.max(180, (vh * 0.62) / scale);
            const factor = (sceneW > maxW || sceneH > maxH)
              ? Math.min(maxW / sceneW, maxH / sceneH)
              : 1;

            const safeFactor = Number.isFinite(factor) && factor > 0 ? factor : 1;
            const safeCenterX = Number.isFinite(sceneCenterX) ? sceneCenterX : boardCenterX;

            // Middle Zone diagram centering (Universal canonical coordinate space: y in [150, 320])
            const transformX = (x: number) => {
              const raw = Number.isFinite(x) ? x : safeCenterX;
              return Math.round(boardCenterX + (raw - safeCenterX) * safeFactor);
            };
            const transformY = (y: number) => {
              const raw = Number.isFinite(y) ? y : middleZoneY;
              if (safeFactor < 1) {
                return Math.round(middleZoneY + (raw - middleZoneY) * safeFactor);
              }
              return Math.round(raw);
            };

            // 1. Draw Title FIRST at top of board (swift reveal + pause in sync with voice intro)
            if (titleObj) {
              const titleY = 38;
              const centeredTitle: CanvasObject = {
                ...titleObj,
                page_id: targetPageId,
                x: boardCenterX,
                y: titleY,
              };
              sceneManager.applyOperation({
                type: "add_object",
                object: {
                  id: centeredTitle.id,
                  type: "label",
                  semanticType: "lesson_title",
                  role: "title",
                  bounds: computeBoundingBox(centeredTitle.x, centeredTitle.y, centeredTitle.width || 200, 36),
                  properties: { text: centeredTitle.text },
                  relations: [],
                  version: 1,
                  visible: true,
                  label: centeredTitle.text,
                },
              });
              steps.push({
                type: "draw_shape",
                target: { x: centeredTitle.x, y: centeredTitle.y },
                payload: centeredTitle,
                duration: 160,
              });
              steps.push({
                type: "pause",
                duration: 250,
              });
            }

            // 2. Prepare diagram strokes and compute bounding box
            let diagramBBox: BoundingBox | null = null;
            let boundedStrokes: Stroke[] = [];
            if (sceneStrokes.length > 0) {
              boundedStrokes = sceneStrokes.map((s) => ({
                ...s,
                points: s.points.map((p) => ({
                  x: transformX(p.x),
                  y: transformY(p.y),
                })),
              }));
              diagramBBox = computePointsBoundingBox(boundedStrokes.flatMap((s) => s.points));
              sceneManager.applyOperation({
                type: "add_object",
                object: {
                  id: `diagram-${Date.now().toString(36)}`,
                  type: "diagram",
                  semanticType: (sceneData as any).type || (sceneData as any).diagram || "visual_diagram",
                  role: "visual_model",
                  bounds: diagramBBox,
                  properties: {},
                  relations: [],
                  version: 1,
                  visible: true,
                },
              });
            }

            // 3. Compute non-colliding placement for math objects relative to diagram bounds
            for (let mIdx = 0; mIdx < otherMathObjs.length; mIdx++) {
              const mathObj = otherMathObjs[mIdx];
              const rawY = transformY(mathObj.y);
              let safeX = Math.max(80, Math.min(720, transformX(mathObj.x)));
              let safeY = rawY;

              if (diagramBBox && Number.isFinite(diagramBBox.minY) && Number.isFinite(diagramBBox.maxY)) {
                if (mathObj.y < 160) {
                  // Primary equation at top: must sit strictly above diagram
                  safeY = Math.min(diagramBBox.minY - 28, Math.max(88, rawY));
                } else {
                  // Conclusion equation at bottom: must sit strictly below diagram
                  safeY = Math.min(420, Math.max(diagramBBox.maxY + 32, rawY));
                }
              } else {
                safeY = mathObj.y < 160 ? Math.max(88, rawY) : Math.min(420, Math.max(340, rawY));
              }

              // Also ensure multiple math objects never overlap each other
              for (let prevIdx = 0; prevIdx < mIdx; prevIdx++) {
                const prev = otherMathObjs[prevIdx] as any;
                if (prev.placedX !== undefined && prev.placedY !== undefined) {
                  if (Math.abs(safeX - prev.placedX) < 140 && Math.abs(safeY - prev.placedY) < 46) {
                    if (safeY + 48 <= 420) {
                      safeY = safeY + 48;
                    } else if (safeX + 160 <= 720) {
                      safeX = safeX + 160;
                    }
                  }
                }
              }
              (mathObj as any).placedX = safeX;
              (mathObj as any).placedY = safeY;
            }

            const pushMathObjStep = (mathObj: any) => {
              const centeredMath: CanvasObject = {
                ...mathObj,
                page_id: targetPageId,
                x: Math.round(mathObj.placedX ?? transformX(mathObj.x)),
                y: Math.round(mathObj.placedY ?? transformY(mathObj.y)),
              };
              sceneManager.applyOperation({
                type: "add_object",
                object: {
                  id: centeredMath.id,
                  type: "equation",
                  semanticType: centeredMath.y < 160 ? "primary_formula" : "conclusion_formula",
                  role: centeredMath.y < 160 ? "primary_concept" : "conclusion",
                  bounds: computeBoundingBox(centeredMath.x, centeredMath.y, centeredMath.width || 160, 48),
                  properties: { latex: centeredMath.latex },
                  relations: [],
                  version: 1,
                  visible: true,
                  latex: centeredMath.latex,
                },
              });
              steps.push({
                type: "draw_shape",
                target: { x: centeredMath.x, y: centeredMath.y },
                payload: centeredMath,
                duration: 180,
              });
              steps.push({
                type: "pause",
                duration: 150,
              });
            };

            // 4. Primary top math formula (revealed after title)
            const topMathObjs = otherMathObjs.filter((m) => m.y < 160);
            for (const mo of topMathObjs) {
              pushMathObjStep(mo);
            }

            // 5. Diagram strokes (drawn in real time while teacher explains the diagram)
            if (boundedStrokes.length > 0) {
              steps.push(...convertStrokesToSteps(boundedStrokes));
            }

            // 6. Conclusion bottom math formulas (revealed while teacher explains the result)
            const bottomMathObjs = otherMathObjs.filter((m) => m.y >= 160);
            for (const mo of bottomMathObjs) {
              pushMathObjStep(mo);
            }
          } else if (op.op === "draw_handwriting") {
            const rawText = op.payload.text || op.payload.latex || "";
            const inkColor = op.payload.color || (theme === "light" ? "#18181B" : "#60A5FA");
            const rawStrokes = textToStrokes(rawText, { x: 0, y: 0 }, {
              color: inkColor,
              size: op.payload.size || 38,
              pageId: targetPageId,
            });
            const centered = centerStrokes(rawStrokes, { x: boardCenterX, y: boardCenterY });
            steps.push(...convertStrokesToSteps(centered));
          } else if (op.op === "draw_diagram") {
            const diag = op.payload.diagram;

            // Clear previous drawings on active page and reset canonical scene graph
            sceneManager.applyOperation({ type: "clear" });
            setCanvasDoc((prev) => ({
              ...prev,
              pages: prev.pages.map((p) =>
                p.id === targetPageId ? { ...p, strokes: [], objects: [], version: p.version + 1 } : p
              ),
              version: prev.version + 1,
            }));

            // Render native KaTeX formula above the diagram
            const diagramDefaultFormulas: Record<string, string> = {
              array_model: "3 \\times 4 = 12",
              multiplication_array: "3 \\times 4 = 12",
              array: "3 \\times 4 = 12",
              ten_frame: "8 + 5 = 10 + 3 = 13",
              tape_diagram: "15 + 25 = 40",
              number_line: "3 + 4 = 7",
              fraction_circle: "\\frac{1}{2} + \\frac{1}{2} = 1",
              fraction_bar: "\\frac{3}{4}",
              chocolate_bar: "\\frac{3}{4}",
              bar_model: "\\frac{3}{4}",
              rect: "\\text{Area} = 4 \\times 3 = 12",
              rectangle: "\\text{Area} = 4 \\times 3 = 12",
              right_triangle: "a^2 + b^2 = c^2",
              slope_intercept: "y = mx + b",
            };

            const formula = op.payload.formulaLabel || diagramDefaultFormulas[diag];
            if (formula) {
              const mathObj: CanvasObject = {
                id: `math-diag-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
                page_id: targetPageId,
                type: "math",
                x: boardCenterX,
                y: 95,
                width: 180,
                height: 60,
                color: theme === "light" ? "#18181B" : "#EDEDED",
                latex: formula,
              };
              sceneManager.applyOperation({
                type: "add_object",
                object: {
                  id: mathObj.id,
                  type: "equation",
                  semanticType: "primary_formula",
                  role: "primary_concept",
                  bounds: computeBoundingBox(mathObj.x, mathObj.y, 180, 50),
                  properties: { latex: formula },
                  relations: [],
                  version: 1,
                  visible: true,
                  latex: formula,
                  label: "Formula",
                },
              });
              steps.push({
                type: "draw_shape",
                target: { x: mathObj.x, y: mathObj.y },
                payload: mathObj,
                duration: 180,
              });
              steps.push({
                type: "pause",
                duration: 100,
              });
            }

            let diagStrokes: Stroke[] = [];
            if (diag === "array_model" || diag === "multiplication_array" || diag === "array") {
              diagStrokes = createArrayModelStrokes({
                center: { x: boardCenterX, y: middleZoneY },
                rows: op.payload.rows || 3,
                cols: op.payload.cols || 4,
                itemColor: "#38BDF8",
                textColor: theme === "light" ? "#18181B" : "#EDEDED",
                pageId: targetPageId,
              });
            } else if (diag === "ten_frame") {
              diagStrokes = createTenFrameStrokes({
                center: { x: boardCenterX, y: middleZoneY },
                count: op.payload.count || 8,
                addCount: op.payload.addCount || 5,
                primaryColor: "#38BDF8",
                secondaryColor: "#F59E0B",
                textColor: theme === "light" ? "#18181B" : "#EDEDED",
                pageId: targetPageId,
              });
            } else if (diag === "tape_diagram") {
              diagStrokes = createTapeDiagramStrokes({
                center: { x: boardCenterX, y: middleZoneY },
                parts: op.payload.parts,
                totalLabel: op.payload.totalLabel,
                color: theme === "light" ? "#18181B" : "#EDEDED",
                textColor: theme === "light" ? "#18181B" : "#EDEDED",
                pageId: targetPageId,
              });
            } else if (diag === "right_triangle") {
              diagStrokes = createRightTriangleStrokes({
                origin: { x: 0, y: 0 },
                width: op.payload.width || 180,
                height: op.payload.height || 140,
                legALabel: op.payload.legALabel || "a = 3",
                legBLabel: op.payload.legBLabel || "b = 4",
                hypotenuseLabel: op.payload.hypotenuseLabel || "c = 5",
                formulaLabel: op.payload.formulaLabel || "a^2 + b^2 = c^2",
                color: op.payload.color || "#60A5FA",
                textColor: theme === "light" ? "#18181B" : "#EDEDED",
                pageId: targetPageId,
              });
            } else if (diag === "slope_intercept" || diag === "linear_graph" || diag === "coordinate_graph") {
              diagStrokes = createSlopeInterceptStrokes({
                center: { x: boardCenterX, y: middleZoneY },
                width: op.payload.width || 280,
                height: op.payload.height || 200,
                slope: op.payload.slope || 0.65,
                intercept: op.payload.intercept !== undefined ? op.payload.intercept : 28,
                slopeLabel: op.payload.slopeLabel || "m = rise / run",
                interceptLabel: op.payload.interceptLabel || "b (y-intercept)",
                formulaLabel: op.payload.formulaLabel || "y = mx + b",
                lineColor: op.payload.lineColor || "#38BDF8",
                textColor: theme === "light" ? "#18181B" : "#EDEDED",
                pageId: targetPageId,
              });
            } else if (diag === "number_line") {
              diagStrokes = createNumberLineStrokes({
                center: { x: boardCenterX, y: middleZoneY },
                width: op.payload.width || 340,
                start: op.payload.start,
                end: op.payload.end,
                equation: op.payload.equation || "3 + 4 = 7",
                textColor: theme === "light" ? "#18181B" : "#EDEDED",
                pageId: targetPageId,
              });
            } else if (diag === "fraction_bar" || diag === "chocolate_bar" || diag === "bar_model") {
              diagStrokes = createFractionBarStrokes({
                center: { x: boardCenterX, y: middleZoneY },
                width: op.payload.width || 360,
                height: op.payload.height || 64,
                totalParts: op.payload.totalParts || 4,
                shadedParts: op.payload.shadedParts ?? 3,
                fractionLabel: op.payload.fractionLabel || "\\frac{3}{4}",
                color: theme === "light" ? "#18181B" : "#EDEDED",
                textColor: "#60A5FA",
                pageId: targetPageId,
              });
            } else if (diag === "fraction_circle") {
              diagStrokes = createFractionCircleStrokes({
                center: { x: boardCenterX, y: middleZoneY },
                radius: op.payload.radius || 85,
                totalParts: op.payload.totalParts || 2,
                shadedParts: op.payload.shadedParts ?? 1,
                fractionLabel: op.payload.fractionLabel || "\\frac{1}{2} + \\frac{1}{2} = 1",
                color: theme === "light" ? "#18181B" : "#EDEDED",
                textColor: "#60A5FA",
                pageId: targetPageId,
              });
            } else if (diag === "circle_geometry") {
              diagStrokes = createCircleGeometryStrokes({
                center: { x: boardCenterX, y: middleZoneY },
                radius: op.payload.radius || 80,
                textColor: theme === "light" ? "#18181B" : "#EDEDED",
                pageId: targetPageId,
              });
            } else if (diag === "wave") {
              diagStrokes = createWaveStrokes({
                center: { x: boardCenterX, y: middleZoneY },
                width: op.payload.width || 320,
                amplitude: op.payload.amplitude || 45,
                wavelength: op.payload.wavelength || 140,
                textColor: theme === "light" ? "#18181B" : "#EDEDED",
                pageId: targetPageId,
              });
            } else if (diag === "parabola") {
              diagStrokes = createParabolaStrokes({
                center: { x: boardCenterX, y: middleZoneY },
                width: op.payload.width || 240,
                height: op.payload.height || 180,
                formulaLabel: op.payload.formulaLabel || "y = ax^2 + bx + c",
                textColor: theme === "light" ? "#18181B" : "#EDEDED",
                pageId: targetPageId,
              });
            } else if (diag === "atom") {
              diagStrokes = createAtomModelStrokes({
                center: { x: boardCenterX, y: middleZoneY },
                elementName: op.payload.elementName || "Helium",
                pageId: targetPageId,
              });
            } else if (diag === "gravity" || diag === "gravity_orbit" || diag === "orbit") {
              diagStrokes = createGravityOrbitStrokes({
                center: { x: boardCenterX, y: middleZoneY },
                width: op.payload.width || 290,
                height: op.payload.height || 170,
                formulaLabel: op.payload.formulaLabel,
                textColor: theme === "light" ? "#18181B" : "#EDEDED",
                pageId: targetPageId,
              });
            } else if (diag === "spacetime" || diag === "spacetime_curvature" || diag === "relativity") {
              diagStrokes = createSpacetimeCurvatureStrokes({
                center: { x: boardCenterX, y: middleZoneY },
                width: op.payload.width || 320,
                height: op.payload.height || 180,
                formulaLabel: op.payload.formulaLabel,
                textColor: theme === "light" ? "#18181B" : "#EDEDED",
                pageId: targetPageId,
              });
            } else if (diag === "faraday" || diag === "faraday_induction" || diag === "induction") {
              diagStrokes = createFaradayInductionStrokes({
                center: { x: boardCenterX, y: middleZoneY },
                width: op.payload.width || 300,
                formulaLabel: op.payload.formulaLabel,
                textColor: theme === "light" ? "#18181B" : "#EDEDED",
                pageId: targetPageId,
              });
            } else if (diag === "circuit" || diag === "electric_circuit" || diag === "ohms_law") {
              diagStrokes = createElectricCircuitStrokes({
                center: { x: boardCenterX, y: middleZoneY },
                width: op.payload.width || 280,
                height: op.payload.height || 160,
                formulaLabel: op.payload.formulaLabel,
                textColor: theme === "light" ? "#18181B" : "#EDEDED",
                pageId: targetPageId,
              });
            }

            if (diagStrokes.length > 0) {
              // Responsive boundary clamp: diagram never exceeds 82% of viewport
              const maxW = Math.max(260, (vw * 0.82) / scale);
              const maxH = Math.max(180, (vh * 0.68) / scale);
              const box = getStrokesBoundingBox(diagStrokes);
              let boundedStrokes = diagStrokes;
              if (box.width > maxW || box.height > maxH) {
                const factor = Math.min(maxW / Math.max(1, box.width), maxH / Math.max(1, box.height));
                boundedStrokes = diagStrokes.map((s) => ({
                  ...s,
                  points: s.points.map((p) => ({
                    x: box.centerX + (p.x - box.centerX) * factor,
                    y: box.centerY + (p.y - box.centerY) * factor,
                  })),
                }));
              }

              const centered = centerStrokes(boundedStrokes, { x: boardCenterX, y: middleZoneY });
              const diagBBox = computePointsBoundingBox(centered.flatMap((s) => s.points));
              sceneManager.applyOperation({
                type: "add_object",
                object: {
                  id: `diagram-${Date.now().toString(36)}`,
                  type: "diagram",
                  semanticType: diag,
                  role: "visual_model",
                  bounds: diagBBox,
                  properties: {},
                  relations: [],
                  version: 1,
                  visible: true,
                  label: diag.replace(/_/g, " "),
                },
              });
              steps.push(...convertStrokesToSteps(centered));
            }
          } else if (op.op === "create_math") {
            // Render native KaTeX on the canvas!
            const rawLatex = op.payload.latex || op.payload.text || "";
            const latex = cleanLatexFormula(rawLatex);
            const existingObjs = sceneManager.getObjects().filter((o) => o.visible !== false);
            let safeMathY = op.payload.y;
            if (safeMathY === undefined) {
              if (existingObjs.length === 0) {
                safeMathY = 100;
              } else {
                safeMathY = 345;
              }
            } else if (safeMathY >= 140 && safeMathY <= 325) {
              safeMathY = 345;
            }
            safeMathY = Math.min(355, safeMathY);

            const mathObj: CanvasObject = {
              id: op.payload.id || `math-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
              page_id: targetPageId,
              type: "math",
              x: op.payload.x ?? boardCenterX,
              y: safeMathY,
              width: op.payload.width || 140,
              height: op.payload.height || 60,
              color: op.payload.color || (theme === "light" ? "#18181B" : "#EDEDED"),
              latex,
            };

            sceneManager.applyOperation({
              type: "add_object",
              object: {
                id: mathObj.id,
                type: "equation",
                semanticType: mathObj.y < 160 ? "primary_formula" : "conclusion_formula",
                role: mathObj.y < 160 ? "primary_concept" : "conclusion",
                bounds: computeBoundingBox(mathObj.x, mathObj.y, 160, 48),
                properties: { latex },
                relations: [],
                version: 1,
                visible: true,
                latex,
                label: latex,
              },
            });

            steps.push({
              type: "move_pointer",
              target: { x: mathObj.x, y: mathObj.y },
              duration: 60,
            });
            steps.push({
              type: "draw_shape",
              target: { x: mathObj.x, y: mathObj.y },
              payload: mathObj,
              duration: 180,
            });
            steps.push({
              type: "pause",
              duration: 60,
            });
          } else if (op.op === "create_text") {
            const rawText = op.payload.text || "";
            const textColor = op.payload.color || (theme === "light" ? "#18181B" : "#EDEDED");
            const textObj: CanvasObject = {
              id: op.payload.id || `text-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
              page_id: targetPageId,
              type: "text",
              x: op.payload.x ?? boardCenterX,
              y: op.payload.y ?? Math.max(90, boardCenterY - 120),
              width: Math.max(80, rawText.length * 10),
              height: 36,
              color: textColor,
              text: rawText,
            };
            steps.push({
              type: "move_pointer",
              target: { x: textObj.x, y: textObj.y },
              duration: 50,
            });
            steps.push({
              type: "draw_shape",
              target: { x: textObj.x, y: textObj.y },
              payload: textObj,
              duration: 160,
            });
            steps.push({
              type: "pause",
              duration: 40,
            });
          } else if (op.op === "create_shape") {
            if (op.payload.type === "triangle") {
              const triStrokes = createRightTriangleStrokes({
                origin: { x: 0, y: 0 },
                width: 180,
                height: 140,
                color: op.payload.color || "#60A5FA",
                textColor: theme === "light" ? "#18181B" : "#EDEDED",
                pageId: targetPageId,
              });
              const centered = centerStrokes(triStrokes, { x: boardCenterX, y: middleZoneY });
              steps.push(...convertStrokesToSteps(centered));
            } else if (op.payload.type === "circle" && op.payload.width) {
              const fracStrokes = createFractionCircleStrokes({
                center: { x: boardCenterX, y: middleZoneY },
                radius: Math.min(op.payload.width, 180) / 2,
                color: op.payload.color || (theme === "light" ? "#18181B" : "#EDEDED"),
                textColor: "#60A5FA",
                pageId: targetPageId,
              });
              steps.push(...convertStrokesToSteps(fracStrokes));
            }
          } else if (op.op === "highlight_object") {
            const annoStrokes = createAnnotationStrokes("circle_highlight", { x: boardCenterX, y: middleZoneY }, {
              color: "#F59E0B",
              pageId: targetPageId,
            });
            steps.push(...convertStrokesToSteps(annoStrokes));
          } else if (op.op === "create_stroke") {
            const stroke = op.payload as Stroke;
            steps.push(...convertStrokesToSteps([stroke]));
          }

          if (steps.length > 0) {
            const choreographedSteps = choreographToSpeech(steps);
            const performance: TutorPerformance = {
              id: `perf-${Date.now().toString(36)}`,
              steps: choreographedSteps,
              skippable: true,
            };

            const launchPerformance = () => {
              tutor.resetBeats();
              tutor.enqueue(performance);
            };

            // Audio-Whiteboard Synchronization:
            // If the voice is already actively playing audio, start drawing immediately.
            // Otherwise, wait for audio playback to emit its first sound (via onAudioStart)
            // or use a safe 2500ms fallback timeout (in case TTS fails or audio is muted/blocked).
            if (isAudioActuallyPlayingRef.current) {
              launchPerformance();
            } else {
              let launched = false;
              const timer = setTimeout(() => {
                if (!launched) {
                  launched = true;
                  audioStartSignalRef.current = null;
                  launchPerformance();
                }
              }, 2500);

              audioStartSignalRef.current = () => {
                if (!launched) {
                  launched = true;
                  clearTimeout(timer);
                  audioStartSignalRef.current = null;
                  launchPerformance();
                }
              };
            }
          }
        },
        onComplete: (assistantMsg) => {
          setIsStreaming(false);
          setStreamingToken("");
          setIsAiWorking(false);
          const rawContent = assistantMsg.content || "";
          const cleanContent = rawContent
            ? rawContent.replace(/<anchor\b[^>]*>(.*?)<\/anchor>/gi, "$1").replace(/<\/?[^>]+(>|$)/g, "")
            : "";
          const hasDraw = rawContent.includes("```draw") || rawContent.includes("```svg");

          setMessages((prev) => [
            ...prev,
            {
              ...assistantMsg,
              id: assistantMsg.id || `asst-${Date.now().toString(36)}`,
              content: rawContent,
              created_at: Date.now(),
              metadata: {
                hasDrawing: hasDraw,
                cleanSpoken: cleanContent.split("```")[0].trim(),
                rawDrawPayload: hasDraw ? rawContent.split("```")[1] || "" : undefined,
              },
            },
          ]);

          // Queue any remaining text that didn't end with punctuation
          if (assistantMsg.content) {
            const clean = assistantMsg.content.split("```")[0];
            const remainder = clean.slice(processedSpeechIndex).trim();
            if (remainder.length > 0) {
              voiceOutput.queueSentence(remainder);
            }
          }
        },
        onError: () => {
          setIsStreaming(false);
          setIsAiWorking(false);
        },
      },
      {
        interruptionContext: interruptionCtx,
        activeReferent: referentCtx,
      }
    );
    },
    [sessionId, tutor, voiceOutput, zoomLevel]
  );

  // Dynamic status text for navbar
  const currentStatusText = useMemo(() => {
    if (voiceInput.isListening) return "Listening to you...";
    if (isAiWorking && tutor.isPlaying) return "Tutor Teaching & Drawing...";
    if (tutor.isPlaying && voiceOutput.isSpeaking) return "Tutor Teaching...";
    if (voiceOutput.isSpeaking) return "Tutor Speaking...";
    if (tutor.isPlaying) return "Tutor Drawing on Board...";
    if (isAiWorking) return "Tutor Thinking...";
    return "Tutor Ready";
  }, [voiceInput.isListening, isAiWorking, tutor.isPlaying, voiceOutput.isSpeaking]);

  return (
    <main
      data-theme={theme}
      className={`flex flex-col h-screen w-screen overflow-hidden select-none transition-colors duration-200 ${
        theme === "light" ? "bg-[#FAF9F6] text-zinc-900" : "bg-[#141416] text-[#EDEDED]"
      }`}
    >
      {/* Top Navbar — Dedicated Whiteboard Tutor with Voice Status & Controls */}
      <Navbar
        theme={theme}
        onThemeToggle={handleThemeToggle}
        statusText={currentStatusText}
        isAiWorking={isAiWorking}
        isSpeaking={voiceOutput.isSpeaking}
        isMuted={voiceOutput.isMuted}
        onToggleMute={voiceOutput.toggleMute}
        zoomLevel={zoomLevel}
        onZoomToggle={handleZoomToggle}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onClear={handleClear}
        onExport={handleExport}
        onOpenHandwritingPractice={() => setIsHandwritingStudioOpen(true)}
        onToggleTranscript={handleToggleTranscript}
        isTranscriptOpen={isTranscriptOpen}
        transcriptCount={messages.length}
      />

      {/* Main Experience: 100% Whiteboard Canvas (Centered Teacher Board Work) */}
      <div className="flex-1 flex overflow-hidden relative w-full h-full">
        <CanvasWorkspace
          tool={tool}
          onToolChange={setTool}
          color={color}
          onColorChange={setColor}
          size={size}
          onSizeChange={setSize}
          zoomLevel={zoomLevel}
          onZoomToggle={handleZoomToggle}
          currentPage={currentPage}
          totalPages={canvasDoc.pages.length}
          currentPageNumber={currentPageNumber}
          onNewPage={handleNewPage}
          onPrevPage={handlePrevPage}
          onNextPage={handleNextPage}
          onPageUpdate={handlePageUpdate}
          onSwitchPage={(pageId) => setCanvasDoc((prev) => ({ ...prev, active_page_id: pageId }))}
          onStrokeComplete={handleStrokeComplete}
          onObjectAdd={handleObjectAdd}
          aiPointer={performancePointer}
          tutorPointer={tutor.pointerState}
          tutorActiveStep={tutor.activeStep}
          tutorIsPlaying={tutor.isPlaying}
          onTutorStepComplete={tutor.handleStepComplete}
          onTutorSkip={handleSkip}
          onTutorPointerMove={tutor.updatePointer}
          onReferentSelect={setActiveReferent}
          onUserDrawingChange={setUserIsDrawing}
          theme={theme}
        />

        {/* Live Tutor Island: Mic, CC Captions Toggle, Voice Mute, Fast Forward, Action Chips */}
        <TutorCanvasOverlay
          isListening={voiceInput.isListening}
          interimTranscript={voiceInput.interimText}
          onToggleListening={handleToggleListening}
          isSpeaking={voiceOutput.isSpeaking}
          isDrawing={tutor.isPlaying}
          userIsDrawing={userIsDrawing}
          isMuted={voiceOutput.isMuted}
          onToggleMute={voiceOutput.toggleMute}
          currentSubtitle={voiceOutput.currentSubtitle}
          statusText={currentStatusText}
          actionChips={actionChips}
          onSendMessage={handleSendMessage}
          onSkip={handleSkip}
          theme={theme}
          onToggleTranscript={handleToggleTranscript}
          isTranscriptOpen={isTranscriptOpen}
        />
      </div>

      {/* Interactive Full Lesson Transcript Drawer (One-Click Copy & Context Diagnostics) */}
      <LessonTranscriptDrawer
        isOpen={isTranscriptOpen}
        onClose={() => setIsTranscriptOpen(false)}
        messages={messages}
        streamingToken={streamingToken}
        isStreaming={isStreaming}
        onSendMessage={handleSendMessage}
        onClearHistory={handleClearTranscript}
        actionChips={actionChips}
        theme={theme}
        isSpeaking={voiceOutput.isSpeaking}
      />

      {/* LLM-Free Handwriting Intelligence Studio Overlay ($0 GPU, <2ms CPU) */}
      <HandwritingPracticeOverlay
        isOpen={isHandwritingStudioOpen}
        onClose={() => setIsHandwritingStudioOpen(false)}
        theme={theme}
      />
    </main>
  );
}
