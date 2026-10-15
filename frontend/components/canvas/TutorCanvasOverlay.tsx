"use client";

import React, { useState, useRef, useEffect } from "react";
import { Mic, MicOff, Sparkles, Volume2, VolumeX, X, CornerDownLeft, Subtitles, FastForward, ChevronDown, ChevronUp, FileText } from "lucide-react";
import type { ActionChip } from "@/lib/types";

interface TutorCanvasOverlayProps {
  /** Whether the microphone is actively listening */
  isListening: boolean;
  /** Live transcription from speech recognition */
  interimTranscript: string;
  /** Toggle microphone on/off */
  onToggleListening: () => void;
  /** Whether the tutor is currently speaking audio */
  isSpeaking: boolean;
  /** Whether the tutor is currently drawing */
  isDrawing?: boolean;
  /** Whether the user is actively drawing on the canvas */
  userIsDrawing?: boolean;
  /** Whether the tutor audio is muted */
  isMuted: boolean;
  /** Toggle audio mute */
  onToggleMute: () => void;
  /** Current spoken subtitle text */
  currentSubtitle: string;
  /** Status text (e.g. "Tutor Drawing...", "Thinking...") */
  statusText: string;
  /** Suggested contextual action chips from the tutor */
  actionChips: ActionChip[];
  /** Handler to send a prompt to the tutor */
  onSendMessage: (text: string) => void;
  /** Skip current speech and drawing animation */
  onSkip?: () => void;
  /** Current theme */
  theme?: "dark" | "light";
  /** Toggle lesson transcript drawer */
  onToggleTranscript?: () => void;
  /** Whether transcript drawer is open */
  isTranscriptOpen?: boolean;
}

export const TutorCanvasOverlay: React.FC<TutorCanvasOverlayProps> = ({
  isListening,
  interimTranscript,
  onToggleListening,
  isSpeaking,
  isDrawing = false,
  userIsDrawing = false,
  isMuted,
  onToggleMute,
  currentSubtitle,
  statusText,
  actionChips,
  onSendMessage,
  onSkip,
  theme = "dark",
  onToggleTranscript,
  isTranscriptOpen = false,
}) => {
  const isLight = theme === "light";
  const [inputText, setInputText] = useState("");
  const [isInputExpanded, setIsInputExpanded] = useState(false);
  const [showCaptions, setShowCaptions] = useState(false); // Default OFF per user instruction
  const [isPromptsCollapsed, setIsPromptsCollapsed] = useState(false);
  const chipPointerDownRef = useRef<{ x: number; y: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!inputText.trim()) return;
    onSendMessage(inputText.trim());
    setInputText("");
    setIsInputExpanded(false);
  };

  const handleChipPointerDown = (e: React.PointerEvent) => {
    chipPointerDownRef.current = { x: e.clientX, y: e.clientY };
  };

  const handleChipClick = (label: string, e: React.MouseEvent) => {
    if (chipPointerDownRef.current) {
      const dx = e.clientX - chipPointerDownRef.current.x;
      const dy = e.clientY - chipPointerDownRef.current.y;
      if (Math.hypot(dx, dy) > 6) {
        // Detected drag or stroke across chip: do not fire message
        return;
      }
    }
    onSendMessage(label);
  };

  useEffect(() => {
    if (isInputExpanded && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isInputExpanded]);

  const isTutorActive = isSpeaking || isDrawing;

  return (
    <div className="absolute bottom-6 right-6 z-40 flex flex-col items-end gap-2.5 pointer-events-none select-none">
      {/* ─── Contextual Action Chips (Floating above dock, collapsible to clear canvas) ─── */}
      {actionChips && actionChips.length > 0 && !isListening && (
        <div
          className={`transition-all duration-200 ${
            userIsDrawing ? "opacity-20 pointer-events-none" : "opacity-100"
          }`}
        >
          {isPromptsCollapsed ? (
            /* Minimized subtle pill */
            <div className="flex justify-end mb-1">
              <button
                type="button"
                onClick={() => setIsPromptsCollapsed(false)}
                className={`text-xs font-medium px-2.5 py-1.5 rounded-xl border backdrop-blur-md shadow-sm flex items-center gap-1.5 transition-all hover:scale-105 active:scale-95 pointer-events-auto ${
                  isLight
                    ? "bg-white/95 border-black/10 text-zinc-700 hover:text-blue-600 hover:bg-white"
                    : "bg-[#1C1C20]/95 border-white/10 text-zinc-300 hover:text-blue-400 hover:bg-[#25252A]"
                }`}
                title="Expand quick prompts"
              >
                <Sparkles className="w-3 h-3 text-blue-500" />
                <span>Quick Prompts ({actionChips.length})</span>
                <ChevronUp className="w-3.5 h-3.5 text-zinc-400" />
              </button>
            </div>
          ) : (
            /* Expanded chips with clear collapse header */
            <div className="flex flex-col items-end gap-1.5 max-w-sm mb-0.5">
              <div className="flex items-center justify-between w-full px-1">
                <span
                  className={`text-[10px] font-semibold uppercase tracking-wider flex items-center gap-1 ${
                    isLight ? "text-zinc-500" : "text-zinc-400"
                  }`}
                >
                  <Sparkles className="w-2.5 h-2.5 text-blue-500" />
                  Quick Prompts
                </span>
                <button
                  type="button"
                  onClick={() => setIsPromptsCollapsed(true)}
                  className={`text-[10px] font-medium px-2 py-0.5 rounded-md transition-colors flex items-center gap-1 pointer-events-auto ${
                    isLight
                      ? "text-zinc-500 hover:text-zinc-800 hover:bg-black/5"
                      : "text-zinc-400 hover:text-zinc-200 hover:bg-white/5"
                  }`}
                  title="Collapse prompts to free up canvas for writing"
                >
                  <span>Hide</span>
                  <ChevronDown className="w-3 h-3" />
                </button>
              </div>
              <div className="flex flex-wrap justify-end gap-1.5 pointer-events-auto">
                {actionChips.map((chip) => (
                  <button
                    key={chip.id}
                    type="button"
                    onPointerDown={handleChipPointerDown}
                    onClick={(e) => handleChipClick(chip.label, e)}
                    className={`text-xs font-medium px-3 py-1.5 rounded-xl border backdrop-blur-md transition-all active:scale-95 hover:scale-[1.02] shadow-sm ${
                      isLight
                        ? "bg-white/95 border-black/10 text-zinc-700 hover:bg-white hover:text-blue-600 shadow-sm"
                        : "bg-[#1C1C20]/95 border-white/10 text-zinc-300 hover:bg-[#25252A] hover:text-blue-400 shadow-md"
                    }`}
                  >
                    ✨ {chip.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─── User Speech Bubble while mic is actively listening ─── */}
      {isListening && interimTranscript && (
        <div
          className={`max-w-[280px] text-xs font-medium px-3.5 py-2.5 rounded-2xl border backdrop-blur-md shadow-xl transition-all pointer-events-auto ${
            isLight
              ? "bg-white/95 border-red-200 text-zinc-800"
              : "bg-[#1C1C20]/95 border-red-500/30 text-zinc-200"
          }`}
          style={{ animation: "ai-pointer-bubble-in 0.2s ease" }}
        >
          <div className="flex items-center gap-1.5 text-[10px] font-bold tracking-wide uppercase text-red-500 mb-1">
            <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-ping" />
            Listening...
          </div>
          <p className="italic">"{interimTranscript}"</p>
        </div>
      )}

      {/* ─── Optional Captions Drawer (Only shown when user enables CC) ─── */}
      {showCaptions && currentSubtitle && (
        <div
          className={`max-w-md w-auto text-xs px-3.5 py-2.5 rounded-2xl border backdrop-blur-xl shadow-lg transition-all pointer-events-auto ${
            isLight
              ? "bg-white/95 border-black/10 text-zinc-800"
              : "bg-[#1C1C20]/95 border-white/10 text-zinc-200"
          }`}
          style={{ animation: "ai-pointer-bubble-in 0.2s ease" }}
        >
          <div className="flex items-center justify-between gap-3 mb-1">
            <span className="text-[10px] font-bold tracking-wide uppercase text-blue-500 flex items-center gap-1">
              <Sparkles className="w-2.5 h-2.5" />
              Tutor Voice Caption
            </span>
            <button
              type="button"
              onClick={() => setShowCaptions(false)}
              className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 text-[10px]"
            >
              Hide CC
            </button>
          </div>
          <p className="font-medium leading-relaxed">{currentSubtitle}</p>
        </div>
      )}

      {/* ─── Main Tutor Island ─── */}
      <div
        className={`flex items-center gap-2 p-1.5 rounded-2xl border backdrop-blur-xl shadow-xl transition-all pointer-events-auto ${
          isLight
            ? "bg-white/95 border-black/10 shadow-zinc-300/40"
            : "bg-[#18181C]/95 border-white/10 shadow-black/50"
        }`}
      >
        {/* Quick Text Input (Expandable) */}
        {isInputExpanded ? (
          <form onSubmit={handleSubmit} className="flex items-center gap-1.5 pl-2">
            <input
              ref={inputRef}
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder="Ask teacher or type to draw..."
              className={`w-52 sm:w-64 text-xs bg-transparent outline-none py-1.5 ${
                isLight ? "text-zinc-900 placeholder:text-zinc-400" : "text-white placeholder:text-zinc-500"
              }`}
            />
            <button
              type="submit"
              disabled={!inputText.trim()}
              className={`p-1.5 rounded-xl transition-all disabled:opacity-30 ${
                isLight
                  ? "bg-blue-600 text-white hover:bg-blue-700 shadow-sm"
                  : "bg-blue-500 text-white hover:bg-blue-600 shadow-sm"
              }`}
              title="Send to Teacher"
            >
              <CornerDownLeft className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setIsInputExpanded(false)}
              className="p-1 rounded-lg text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setIsInputExpanded(true)}
            className={`px-3 py-1.5 rounded-xl text-xs font-medium flex items-center gap-1.5 transition-colors ${
              isLight
                ? "text-zinc-500 hover:text-zinc-900 hover:bg-black/5"
                : "text-zinc-400 hover:text-white hover:bg-white/5"
            }`}
            title="Type to ask or draw"
          >
            <Sparkles className="w-3.5 h-3.5 text-blue-500" />
            <span>Ask tutor...</span>
          </button>
        )}

        <div className={`h-4 w-[1px] ${isLight ? "bg-black/10" : "bg-white/10"}`} />

        {/* Full Lesson Transcript Toggle Button */}
        {onToggleTranscript && (
          <button
            type="button"
            onClick={onToggleTranscript}
            className={`p-2 rounded-xl transition-colors ${
              isTranscriptOpen
                ? "text-blue-500 bg-blue-500/10 font-bold"
                : isLight
                ? "text-zinc-400 hover:bg-black/5 hover:text-zinc-700"
                : "text-zinc-500 hover:bg-white/5 hover:text-zinc-300"
            }`}
            title="Open Full Lesson Transcript & Copy"
          >
            <FileText className="w-4 h-4" />
          </button>
        )}

        {/* Captions (CC) Toggle Button */}
        <button
          type="button"
          onClick={() => setShowCaptions((prev) => !prev)}
          className={`p-2 rounded-xl transition-colors ${
            showCaptions
              ? "text-blue-500 bg-blue-500/10 font-bold"
              : isLight
              ? "text-zinc-400 hover:bg-black/5 hover:text-zinc-700"
              : "text-zinc-500 hover:bg-white/5 hover:text-zinc-300"
          }`}
          title={showCaptions ? "Hide Captions (CC)" : "Show Captions (CC)"}
        >
          <Subtitles className="w-4 h-4" />
        </button>

        {/* Voice Mute/Unmute Toggle */}
        <button
          type="button"
          onClick={onToggleMute}
          className={`p-2 rounded-xl transition-colors ${
            isMuted
              ? "text-red-400 hover:bg-red-500/10"
              : isSpeaking
              ? "text-blue-500 bg-blue-500/10"
              : isLight
              ? "text-zinc-400 hover:bg-black/5 hover:text-zinc-700"
              : "text-zinc-400 hover:bg-white/5 hover:text-zinc-300"
          }`}
          title={isMuted ? "Unmute Teacher Voice" : "Mute Teacher Voice"}
        >
          {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
        </button>

        {/* Skip Animation / Speech Button (Only visible while tutor is active) */}
        {isTutorActive && onSkip && (
          <button
            type="button"
            onClick={onSkip}
            className={`p-2 rounded-xl transition-colors ${
              isLight
                ? "text-zinc-600 hover:bg-black/5 hover:text-zinc-950"
                : "text-zinc-300 hover:bg-white/10 hover:text-white"
            }`}
            title="Fast forward drawing"
          >
            <FastForward className="w-4 h-4" />
          </button>
        )}

        {/* Big Microphone Talk Button */}
        <button
          type="button"
          onClick={onToggleListening}
          className={`relative p-2.5 rounded-xl border flex items-center justify-center transition-all active:scale-95 ${
            isListening
              ? "bg-red-500 border-red-400 text-white shadow-lg shadow-red-500/30 scale-105"
              : isLight
              ? "bg-zinc-900 border-zinc-800 text-white hover:bg-zinc-800 shadow-md"
              : "bg-blue-600 border-blue-500 text-white hover:bg-blue-500 shadow-md"
          }`}
          title={isListening ? "Stop listening" : "Talk to Teacher"}
        >
          {isListening ? (
            <>
              <MicOff className="w-4 h-4" />
              <span className="absolute -inset-1 rounded-xl bg-red-500/30 animate-ping pointer-events-none" />
            </>
          ) : (
            <Mic className="w-4 h-4" />
          )}
        </button>
      </div>
    </div>
  );
};
