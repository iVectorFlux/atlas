"use client";

import React from "react";
import { ThemeMode } from "@/lib/types";
import { 
  Undo2, 
  Redo2, 
  ZoomIn, 
  Download, 
  Trash2,
  Sun,
  Moon,
  Volume2,
  VolumeX,
  Sparkles,
  FileText
} from "lucide-react";

interface NavbarProps {
  theme: ThemeMode;
  onThemeToggle: () => void;
  statusText?: string;
  isAiWorking?: boolean;
  isSpeaking?: boolean;
  isMuted?: boolean;
  onToggleMute?: () => void;
  zoomLevel?: number;
  onZoomToggle?: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  onClear?: () => void;
  onExport?: () => void;
  onOpenHandwritingPractice?: () => void;
  onToggleTranscript?: () => void;
  isTranscriptOpen?: boolean;
  transcriptCount?: number;
}

export const Navbar: React.FC<NavbarProps> = ({
  theme,
  onThemeToggle,
  statusText = "Tutor Ready",
  isAiWorking = false,
  isSpeaking = false,
  isMuted = false,
  onToggleMute,
  zoomLevel = 35,
  onZoomToggle,
  onUndo,
  onRedo,
  onClear,
  onExport,
  onOpenHandwritingPractice,
  onToggleTranscript,
  isTranscriptOpen = false,
  transcriptCount = 0,
}) => {
  const isLight = theme === "light";

  return (
    <header
      className={`h-14 px-4 border-b flex items-center justify-between shrink-0 z-40 select-none transition-colors duration-200 ${
        isLight
          ? "bg-white border-black/[0.08]"
          : "bg-[#141416] border-white/[0.08]"
      }`}
    >
      {/* Brand & Identity */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-xl bg-gradient-to-tr from-blue-600 via-indigo-500 to-purple-500 flex items-center justify-center shadow-sm">
            <Sparkles className="w-3.5 h-3.5 text-white" />
          </div>
          <span
            className={`font-semibold text-sm tracking-tight transition-colors ${
              isLight ? "text-zinc-900" : "text-white"
            }`}
          >
            Zawvee
          </span>
          <span className="text-[10px] font-medium tracking-wide uppercase px-1.5 py-0.5 rounded-md bg-blue-500/10 text-blue-500 border border-blue-500/20">
            Tutor
          </span>
        </div>

        {/* Lesson Transcript Drawer Toggle */}
        {onToggleTranscript && (
          <button
            type="button"
            onClick={onToggleTranscript}
            title="Open Full Lesson Transcript & Context (Copy Transcript)"
            className={`flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-lg border transition-all active:scale-95 ${
              isTranscriptOpen
                ? "bg-blue-600 text-white border-blue-600 shadow-sm"
                : isLight
                ? "bg-zinc-100 hover:bg-zinc-200 border-black/10 text-zinc-700 hover:text-zinc-950"
                : "bg-[#1C1C20] hover:bg-[#25252A] border-white/10 text-zinc-300 hover:text-white"
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            <span>Transcript</span>
            {transcriptCount > 0 && (
              <span
                className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
                  isTranscriptOpen
                    ? "bg-white/20 text-white"
                    : isLight
                    ? "bg-zinc-200 text-zinc-800"
                    : "bg-white/15 text-zinc-200"
                }`}
              >
                {transcriptCount}
              </span>
            )}
          </button>
        )}

        {onOpenHandwritingPractice && (
          <button
            onClick={onOpenHandwritingPractice}
            className={`flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-lg border transition-all ${
              isLight
                ? "bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100"
                : "bg-blue-950/40 border-blue-500/30 text-blue-300 hover:bg-blue-900/40"
            }`}
          >
            <span>✏️</span>
            <span>Handwriting Studio</span>
          </button>
        )}
      </div>

      {/* Center: Live AI Tutor Presence Badge */}
      <div className="flex items-center gap-2">
        <div
          className={`flex items-center gap-2 px-3 py-1 rounded-full border text-xs font-medium transition-all ${
            isSpeaking
              ? isLight
                ? "bg-blue-50 border-blue-200 text-blue-700 shadow-sm"
                : "bg-blue-950/40 border-blue-500/30 text-blue-300 shadow-md"
              : isAiWorking
              ? isLight
                ? "bg-amber-50 border-amber-200 text-amber-700 shadow-sm"
                : "bg-amber-950/40 border-amber-500/30 text-amber-300 shadow-md"
              : isLight
              ? "bg-[#F4F4F5] border-black/[0.06] text-zinc-600"
              : "bg-[#1C1C20] border-white/[0.06] text-zinc-300"
          }`}
        >
          {isSpeaking ? (
            <div className="flex items-center gap-1">
              <span className="w-1.5 h-3.5 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
              <span className="w-1.5 h-4.5 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
              <span className="w-1.5 h-2.5 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
            </div>
          ) : isAiWorking ? (
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500" />
            </span>
          ) : (
            <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-sm shadow-emerald-500/50" />
          )}
          <span className="tracking-tight">{statusText}</span>

          {/* Voice Mute Toggle */}
          {onToggleMute && (
            <button
              type="button"
              onClick={onToggleMute}
              title={isMuted ? "Unmute Tutor Voice" : "Mute Tutor Voice"}
              className={`ml-1 p-0.5 rounded hover:bg-black/5 dark:hover:bg-white/10 transition-colors ${
                isMuted ? "text-red-400" : isSpeaking ? "text-blue-500" : "text-zinc-400"
              }`}
            >
              {isMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
            </button>
          )}
        </div>
      </div>

      {/* Action Buttons: Canvas Tools, Undo/Redo, Theme */}
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={onUndo}
          title="Undo"
          className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${
            isLight
              ? "text-zinc-600 hover:text-zinc-950 hover:bg-black/[0.05]"
              : "text-zinc-400 hover:text-white hover:bg-white/[0.06]"
          }`}
        >
          <Undo2 className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={onRedo}
          title="Redo"
          className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${
            isLight
              ? "text-zinc-600 hover:text-zinc-950 hover:bg-black/[0.05]"
              : "text-zinc-400 hover:text-white hover:bg-white/[0.06]"
          }`}
        >
          <Redo2 className="w-3.5 h-3.5" />
        </button>

        <div
          className={`h-4 w-[1px] mx-1 ${
            isLight ? "bg-black/[0.08]" : "bg-white/[0.08]"
          }`}
        />

        <button
          type="button"
          onClick={onZoomToggle}
          className={`h-8 px-2.5 rounded-lg flex items-center gap-1 font-mono text-xs transition-colors ${
            isLight
              ? "text-zinc-600 hover:text-zinc-950 hover:bg-black/[0.05]"
              : "text-zinc-400 hover:text-white hover:bg-white/[0.06]"
          }`}
          title="Toggle Zoom (35% Overview / 100% Detail)"
        >
          <ZoomIn className="w-3 h-3" />
          <span>{zoomLevel}%</span>
        </button>

        <div
          className={`h-4 w-[1px] mx-1 ${
            isLight ? "bg-black/[0.08]" : "bg-white/[0.08]"
          }`}
        />

        <button
          type="button"
          onClick={onClear}
          title="Clear Board"
          className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${
            isLight
              ? "text-zinc-600 hover:text-red-600 hover:bg-black/[0.05]"
              : "text-zinc-400 hover:text-red-400 hover:bg-white/[0.06]"
          }`}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>

        <button
          type="button"
          onClick={onExport}
          title="Save Whiteboard Snapshot"
          className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${
            isLight
              ? "text-zinc-600 hover:text-zinc-950 hover:bg-black/[0.05]"
              : "text-zinc-400 hover:text-white hover:bg-white/[0.06]"
          }`}
        >
          <Download className="w-3.5 h-3.5" />
        </button>

        <button
          type="button"
          onClick={onThemeToggle}
          title={`Switch to ${isLight ? "Dark" : "Light"} Paper Mode`}
          className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${
            isLight
              ? "text-zinc-600 hover:text-zinc-950 hover:bg-black/[0.05]"
              : "text-zinc-400 hover:text-white hover:bg-white/[0.06]"
          }`}
        >
          {isLight ? <Moon className="w-3.5 h-3.5" /> : <Sun className="w-3.5 h-3.5" />}
        </button>
      </div>
    </header>
  );
};
