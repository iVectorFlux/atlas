"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  FileText,
  Copy,
  Check,
  X,
  Trash2,
  Sparkles,
  ChevronDown,
  ChevronUp,
  Send,
  Code,
  Volume2,
  User,
  Bot,
} from "lucide-react";
import type { ChatMessage, ActionChip } from "@/lib/types";
import { safeKatexRender } from "@/lib/katexSafe";

interface LessonTranscriptDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  messages: ChatMessage[];
  streamingToken?: string;
  isStreaming?: boolean;
  onSendMessage: (text: string) => void;
  onClearHistory?: () => void;
  actionChips?: ActionChip[];
  theme?: "dark" | "light";
  isSpeaking?: boolean;
}

/**
 * Robust copy helper supporting modern Clipboard API with fallback.
 */
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Continue to fallback
  }

  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    textarea.style.top = "-9999px";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const successful = document.execCommand("copy");
    document.body.removeChild(textarea);
    return successful;
  } catch (err) {
    console.error("Failed to copy:", err);
    return false;
  }
}

/**
 * Cleans spoken text by removing XML anchors, code fences, and blackboard metadata,
 * and collapses awkward multi-line gaps into clean paragraph breaks.
 */
export function cleanSpokenContent(text: string): string {
  if (!text) return "";
  // 1. Remove ```draw ... ``` or ```svg ... ``` codeblocks completely
  let clean = text.replace(/```(?:draw|svg|json)?[\s\S]*?```/g, "");
  // 2. Strip <anchor id="..." target="...">phrase</anchor> tags, keeping the spoken phrase
  clean = clean.replace(/<anchor\b[^>]*>(.*?)<\/anchor>/gi, "$1");
  // 3. Strip any other stray XML/HTML tags
  clean = clean.replace(/<\/?[^>]+(>|$)/g, "");
  // 4. Collapse 3 or more consecutive newlines into exactly two (clean paragraph break)
  clean = clean.replace(/\n{3,}/g, "\n\n").trim();
  return clean;
}

/**
 * Formats transcript text for clean, human-readable copying:
 * Converts LaTeX formulas (\(\frac{3}{4}\)) into readable text (3/4) and standard operators.
 */
export function formatTranscriptForCopy(text: string): string {
  if (!text) return "";
  let clean = cleanSpokenContent(text);

  // Replace LaTeX fractions with clean readable fraction notation:
  // e.g. \(\frac{3}{4}\) or \frac{3}{4} -> 3/4
  clean = clean.replace(/\\?\([\\\$]?\\frac\{([^}]+)\}\{([^}]+)\}[\\\$]?\\?\)/g, "$1/$2");
  clean = clean.replace(/\\frac\{([^}]+)\}\{([^}]+)\}/g, "$1/$2");

  // Common math symbols
  clean = clean.replace(/\\times/g, "×");
  clean = clean.replace(/\\cdot/g, "·");
  clean = clean.replace(/\\div/g, "÷");
  clean = clean.replace(/\\pm/g, "±");
  clean = clean.replace(/\\le/g, "≤");
  clean = clean.replace(/\\ge/g, "≥");
  clean = clean.replace(/\\neq/g, "≠");
  clean = clean.replace(/\\approx/g, "≈");

  // Strip any lingering delimiters
  clean = clean.replace(/\\\((.*?)\\\)/g, "$1");
  clean = clean.replace(/\\\[(.*?)\\\]/g, "$1");
  clean = clean.replace(/\$([^$]+)\$/g, "$1");

  // Normalize paragraph spacing
  clean = clean.replace(/\n{3,}/g, "\n\n").trim();
  return clean;
}

/**
 * Extracts raw draw/blackboard block from message content if present.
 */
function extractDrawPayload(text: string): string | null {
  if (!text) return null;
  const match = text.match(/```(?:draw|svg|json)?\s*([\s\S]*?)```/);
  return match ? match[1].trim() : null;
}

/**
 * Renders spoken text with KaTeX formulas natively typeset inline,
 * properly formatted paragraphs, and no broken backslash delimiters.
 */
function FormattedSpokenContent({ text, isLight }: { text: string; isLight: boolean }) {
  const clean = cleanSpokenContent(text);
  if (!clean) return null;

  // Split into paragraphs (handling double newlines or single newlines cleanly)
  const paragraphs = clean
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  return (
    <div className="space-y-2.5">
      {paragraphs.map((paragraph, pIdx) => {
        // Regex matching inline math delimiters:
        // 1. \( ... \)
        // 2. \[ ... \]
        // 3. $ ... $
        // 4. Standalone \frac{...}{...}
        const mathRegex = /(\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]|\$[^$]+\$|\\frac\{[^{}]+\}\{[^{}]+\})/g;
        const parts = paragraph.split(mathRegex);

        return (
          <p key={pIdx} className="leading-relaxed text-[13.5px]">
            {parts.map((part, idx) => {
              if (!part) return null;

              // Check if this part is a math formula
              let latex = "";
              if (part.startsWith("\\(") && part.endsWith("\\)")) {
                latex = part.slice(2, -2).trim();
              } else if (part.startsWith("\\[") && part.endsWith("\\]")) {
                latex = part.slice(2, -2).trim();
              } else if (part.startsWith("$") && part.endsWith("$") && part.length > 2) {
                latex = part.slice(1, -1).trim();
              } else if (part.startsWith("\\frac{")) {
                latex = part.trim();
              }

              if (latex) {
                const html = safeKatexRender(latex, false);
                return (
                  <span
                    key={idx}
                    className="inline-block mx-1 align-baseline font-mono font-medium text-blue-600 dark:text-blue-400 select-all"
                    dangerouslySetInnerHTML={{ __html: html }}
                  />
                );
              }

              return <span key={idx}>{part}</span>;
            })}
          </p>
        );
      })}
    </div>
  );
}

export const LessonTranscriptDrawer: React.FC<LessonTranscriptDrawerProps> = ({
  isOpen,
  onClose,
  messages,
  streamingToken = "",
  isStreaming = false,
  onSendMessage,
  onClearHistory,
  actionChips = [],
  theme = "dark",
  isSpeaking = false,
}) => {
  const isLight = theme === "light";
  const [inputText, setInputText] = useState("");
  const [copiedAll, setCopiedAll] = useState(false);
  const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null);
  const [expandedDiagnostics, setExpandedDiagnostics] = useState<Record<string, boolean>>({});
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to bottom as new messages or streaming tokens arrive
  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [isOpen, messages, streamingToken]);

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => inputRef.current?.focus(), 150);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  const handleCopyAll = useCallback(async () => {
    const lines: string[] = [
      `# Zawvee AI Whiteboard Tutoring — Complete Session Transcript`,
      `Exported: ${new Date().toLocaleString()}`,
      `Total Turns: ${messages.length}`,
      `==================================================\n`,
    ];

    messages.forEach((msg, idx) => {
      const isUser = msg.role === "user";
      const sender = isUser ? "STUDENT" : "ZAWVEE TUTOR";
      const timeStr = msg.created_at ? new Date(msg.created_at).toLocaleTimeString() : `Turn #${idx + 1}`;
      lines.push(`## [${timeStr}] ${sender}:`);

      if (isUser) {
        lines.push(msg.content.trim());
      } else {
        const spoken = formatTranscriptForCopy(msg.content);
        lines.push(`### Spoken Teacher Explanation:\n${spoken}`);

        const drawCode = extractDrawPayload(msg.content);
        if (drawCode) {
          lines.push(`\n### Whiteboard Canvas Representation (JSON/Code):\n\`\`\`json\n${drawCode}\n\`\`\``);
        }
      }
      lines.push(`\n--------------------------------------------------\n`);
    });

    if (streamingToken) {
      lines.push(`## [IN-PROGRESS STREAMING] ZAWVEE TUTOR:`);
      lines.push(formatTranscriptForCopy(streamingToken));
      lines.push(`\n--------------------------------------------------\n`);
    }

    const fullTranscript = lines.join("\n");
    const ok = await copyToClipboard(fullTranscript);
    if (ok) {
      setCopiedAll(true);
      setTimeout(() => setCopiedAll(false), 2000);
    }
  }, [messages, streamingToken]);

  const handleCopySingle = useCallback(async (id: string, textToCopy: string) => {
    const formatted = formatTranscriptForCopy(textToCopy);
    const ok = await copyToClipboard(formatted);
    if (ok) {
      setCopiedMsgId(id);
      setTimeout(() => setCopiedMsgId(null), 1800);
    }
  }, []);

  const toggleDiagnostics = (id: string) => {
    setExpandedDiagnostics((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  const handleSend = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!inputText.trim() || isStreaming) return;
    onSendMessage(inputText.trim());
    setInputText("");
  };

  if (!isOpen) return null;

  return (
    <aside
      role="dialog"
      aria-label="Lesson Transcript"
      className={`fixed top-0 right-0 h-full w-full sm:w-[480px] md:w-[520px] z-50 flex flex-col shadow-2xl backdrop-blur-2xl transition-all duration-300 ease-out border-l ${
        isLight
          ? "bg-white/95 border-black/[0.08] text-zinc-900"
          : "bg-[#141416]/95 border-white/[0.08] text-[#EDEDED]"
      }`}
    >
      {/* ─── Top Header ─── */}
      <header
        className={`h-14 px-5 border-b flex items-center justify-between shrink-0 ${
          isLight ? "bg-white/80 border-black/[0.06]" : "bg-[#18181B]/80 border-white/[0.06]"
        }`}
      >
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-blue-600 via-indigo-500 to-purple-500 flex items-center justify-center shadow-sm">
            <FileText className="w-4 h-4 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold tracking-tight">Lesson Transcript</h2>
              <span
                className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                  isLight
                    ? "bg-blue-50 border-blue-200 text-blue-700"
                    : "bg-blue-950/50 border-blue-500/30 text-blue-300"
                }`}
              >
                {messages.length} {messages.length === 1 ? "Turn" : "Turns"}
              </span>
            </div>
            <p className={`text-[11px] ${isLight ? "text-zinc-500" : "text-zinc-400"}`}>
              Full speech log & context diagnostics
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          {/* Copy Entire Transcript Button */}
          <button
            type="button"
            onClick={handleCopyAll}
            title="Copy full lesson transcript with timestamps to clipboard"
            disabled={messages.length === 0 && !streamingToken}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all active:scale-95 ${
              copiedAll
                ? "bg-emerald-500 text-white border-emerald-500 shadow-sm"
                : messages.length === 0 && !streamingToken
                ? "opacity-40 cursor-not-allowed border-transparent"
                : isLight
                ? "bg-zinc-100 hover:bg-zinc-200 border-black/10 text-zinc-800"
                : "bg-[#222226] hover:bg-[#2A2A30] border-white/10 text-zinc-200"
            }`}
          >
            {copiedAll ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copiedAll ? "Copied All!" : "Copy Transcript"}</span>
          </button>

          {/* Clear Session */}
          {onClearHistory && messages.length > 0 && (
            <button
              type="button"
              onClick={onClearHistory}
              title="Clear transcript history"
              className={`p-1.5 rounded-lg border transition-colors ${
                isLight
                  ? "hover:bg-red-50 hover:text-red-600 border-transparent text-zinc-400"
                  : "hover:bg-red-950/30 hover:text-red-400 border-transparent text-zinc-500"
              }`}
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}

          {/* Close Drawer */}
          <button
            type="button"
            onClick={onClose}
            title="Close transcript"
            className={`p-1.5 rounded-lg transition-colors ${
              isLight
                ? "hover:bg-zinc-100 text-zinc-500 hover:text-zinc-900"
                : "hover:bg-white/10 text-zinc-400 hover:text-white"
            }`}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* ─── Pedagogical Context Tip Banner ─── */}
      <div
        className={`px-4 py-2 border-b text-xs flex items-center justify-between ${
          isLight
            ? "bg-blue-50/70 border-blue-100 text-blue-900"
            : "bg-blue-950/20 border-blue-500/10 text-blue-300"
        }`}
      >
        <div className="flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5 text-blue-500 shrink-0" />
          <span>Copy any turn to inspect how Zawvee interpreted student context.</span>
        </div>
        {isSpeaking && (
          <div className="flex items-center gap-1 text-[11px] font-semibold text-blue-500 animate-pulse">
            <Volume2 className="w-3 h-3" />
            <span>Speaking...</span>
          </div>
        )}
      </div>

      {/* ─── Scrollable Conversation Transcript ─── */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && !streamingToken && (
          <div className="h-full flex flex-col items-center justify-center text-center p-8 text-zinc-400">
            <div
              className={`w-12 h-12 rounded-2xl border flex items-center justify-center mb-3 ${
                isLight ? "bg-zinc-100 border-black/10 text-zinc-600" : "bg-[#1C1C20] border-white/10 text-zinc-400"
              }`}
            >
              <FileText className="w-6 h-6" />
            </div>
            <h3 className={`text-sm font-semibold mb-1 ${isLight ? "text-zinc-800" : "text-zinc-200"}`}>
              No conversation yet
            </h3>
            <p className="text-xs max-w-xs leading-relaxed">
              Ask a question via the microphone, pick a quick prompt below, or type a topic to start your tutoring session.
            </p>
          </div>
        )}

        {messages.map((msg, idx) => {
          const isUser = msg.role === "user";
          const drawPayload = extractDrawPayload(msg.content);
          const hasDrawing = !!drawPayload || !!msg.metadata?.hasDrawing;
          const isCopied = copiedMsgId === msg.id;
          const isDiagOpen = !!expandedDiagnostics[msg.id];
          const timeLabel = msg.created_at ? new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : `Turn #${idx + 1}`;

          return (
            <div
              key={msg.id || idx}
              className={`flex flex-col gap-1.5 ${isUser ? "items-end" : "items-start"}`}
            >
              {/* Speaker Label & Timestamp Header */}
              <div className="flex items-center gap-2 px-1 text-[11px] text-zinc-400 font-medium">
                <span className="flex items-center gap-1">
                  {isUser ? (
                    <>
                      <User className="w-3 h-3 text-indigo-400" />
                      <span className={isLight ? "text-zinc-700 font-semibold" : "text-zinc-300 font-semibold"}>You</span>
                    </>
                  ) : (
                    <>
                      <Bot className="w-3 h-3 text-blue-400" />
                      <span className="text-blue-400 font-semibold">Zawvee Tutor</span>
                    </>
                  )}
                </span>
                <span>•</span>
                <span>{timeLabel}</span>
              </div>

              {/* Message Content Bubble */}
              <div
                className={`group relative max-w-[92%] rounded-2xl px-4 py-3 text-sm leading-relaxed border transition-all ${
                  isUser
                    ? isLight
                      ? "bg-zinc-900 text-white border-zinc-800 rounded-tr-xs shadow-sm"
                      : "bg-[#25252A] text-white border-white/10 rounded-tr-xs shadow-sm"
                    : isLight
                    ? "bg-white text-zinc-800 border-black/[0.08] rounded-tl-xs shadow-sm"
                    : "bg-[#1C1C20] text-zinc-200 border-white/[0.08] rounded-tl-xs shadow-sm"
                }`}
              >
                {/* Spoken Text with Native KaTeX Typesetting */}
                {isUser ? (
                  <div className="whitespace-pre-wrap selection:bg-blue-500/30 text-[13.5px]">
                    {msg.content}
                  </div>
                ) : (
                  <FormattedSpokenContent text={msg.content} isLight={isLight} />
                )}

                {/* Whiteboard Visual Representation Indicator */}
                {!isUser && hasDrawing && (
                  <div
                    className={`mt-2.5 p-2 rounded-xl border flex items-center justify-between text-xs font-medium ${
                      isLight
                        ? "bg-blue-50/70 border-blue-200/60 text-blue-900"
                        : "bg-blue-950/30 border-blue-500/20 text-blue-300"
                    }`}
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm">🎨</span>
                      <span>Whiteboard Visual Model Drawn</span>
                    </div>

                    {drawPayload && (
                      <button
                        type="button"
                        onClick={() => toggleDiagnostics(msg.id)}
                        className={`flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md border transition-colors ${
                          isLight
                            ? "bg-white hover:bg-zinc-100 border-black/10 text-zinc-700"
                            : "bg-black/30 hover:bg-black/50 border-white/10 text-zinc-300"
                        }`}
                      >
                        <Code className="w-3 h-3" />
                        <span>{isDiagOpen ? "Hide Code" : "Inspect Code"}</span>
                        {isDiagOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                      </button>
                    )}
                  </div>
                )}

                {/* Expanded Context & Code Diagnostics Accordion */}
                {!isUser && isDiagOpen && drawPayload && (
                  <div
                    className={`mt-2 p-2.5 rounded-xl border font-mono text-[11px] overflow-x-auto ${
                      isLight
                        ? "bg-zinc-100 border-black/10 text-zinc-800"
                        : "bg-[#101012] border-white/10 text-emerald-400"
                    }`}
                  >
                    <div className="flex items-center justify-between text-[10px] text-zinc-400 mb-1 border-b pb-1 border-zinc-500/20">
                      <span>WHITEBOARD ENGINE PAYLOAD</span>
                      <button
                        type="button"
                        onClick={async () => {
                          await copyToClipboard(drawPayload);
                          setCopiedMsgId(`${msg.id}-raw`);
                          setTimeout(() => setCopiedMsgId(null), 1800);
                        }}
                        className="hover:text-white flex items-center gap-1"
                      >
                        {copiedMsgId === `${msg.id}-raw` ? <Check className="w-2.5 h-2.5 text-emerald-400" /> : <Copy className="w-2.5 h-2.5" />}
                        <span>{copiedMsgId === `${msg.id}-raw` ? "Copied" : "Copy JSON"}</span>
                      </button>
                    </div>
                    <pre className="whitespace-pre-wrap overflow-x-auto leading-relaxed">{drawPayload}</pre>
                  </div>
                )}

                {/* Per-Message Copy Button (Copies Clean Human Readable Speech Text) */}
                <div className="mt-2.5 flex items-center justify-end border-t pt-1.5 border-black/5 dark:border-white/5">
                  <button
                    type="button"
                    onClick={() => handleCopySingle(msg.id, msg.content)}
                    className={`flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-md border transition-all ${
                      isCopied
                        ? "bg-emerald-500 text-white border-emerald-500"
                        : isLight
                        ? "bg-zinc-100 hover:bg-zinc-200 border-black/5 text-zinc-600 hover:text-zinc-900"
                        : "bg-white/5 hover:bg-white/10 border-white/5 text-zinc-400 hover:text-white"
                    }`}
                  >
                    {isCopied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                    <span>{isCopied ? "Copied" : "Copy"}</span>
                  </button>
                </div>
              </div>
            </div>
          );
        })}

        {/* ─── Real-Time In-Progress Streaming Turn ─── */}
        {isStreaming && (
          <div className="flex flex-col items-start gap-1.5 animate-in fade-in duration-200">
            <div className="flex items-center gap-2 px-1 text-[11px] text-blue-400 font-medium">
              <Bot className="w-3 h-3 animate-spin" />
              <span className="font-semibold">Zawvee Tutor (Thinking & Speaking)</span>
            </div>

            <div
              className={`max-w-[92%] rounded-2xl rounded-tl-xs px-4 py-3 text-sm leading-relaxed border shadow-sm ${
                isLight
                  ? "bg-white text-zinc-800 border-blue-400/40"
                  : "bg-[#1C1C20] text-zinc-200 border-blue-500/30"
              }`}
            >
              {streamingToken ? (
                <FormattedSpokenContent text={streamingToken} isLight={isLight} />
              ) : (
                <span className="italic text-zinc-400 flex items-center gap-1.5 text-xs">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-ping" />
                  Preparing whiteboard lesson...
                </span>
              )}
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* ─── Bottom Context Action Chips & Direct Input ─── */}
      <footer
        className={`p-3.5 border-t shrink-0 flex flex-col gap-2 ${
          isLight ? "bg-white/90 border-black/[0.06]" : "bg-[#18181B]/90 border-white/[0.06]"
        }`}
      >
        {/* Suggestion Chips */}
        {actionChips.length > 0 && !isStreaming && (
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
            {actionChips.slice(0, 3).map((chip) => (
              <button
                key={chip.id}
                type="button"
                onClick={() => onSendMessage(chip.label)}
                className={`whitespace-nowrap px-2.5 py-1 rounded-full text-[11px] font-medium border transition-all active:scale-95 shrink-0 ${
                  isLight
                    ? "bg-zinc-100 hover:bg-zinc-200 border-black/10 text-zinc-700"
                    : "bg-[#222226] hover:bg-[#2A2A30] border-white/10 text-zinc-300"
                }`}
              >
                {chip.label}
              </button>
            ))}
          </div>
        )}

        {/* Input Form */}
        <form onSubmit={handleSend} className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder="Ask a question or reply to the tutor..."
            disabled={isStreaming}
            className={`flex-1 px-3.5 py-2 rounded-xl text-xs border outline-none transition-all ${
              isLight
                ? "bg-zinc-50 border-black/10 text-zinc-900 placeholder:text-zinc-400 focus:bg-white focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                : "bg-[#202024] border-white/10 text-white placeholder:text-zinc-500 focus:bg-[#25252A] focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
            }`}
          />
          <button
            type="submit"
            disabled={!inputText.trim() || isStreaming}
            title="Send Message"
            className={`p-2 rounded-xl border transition-all active:scale-95 ${
              inputText.trim() && !isStreaming
                ? "bg-blue-600 text-white border-blue-500 shadow-md hover:bg-blue-500"
                : "opacity-40 cursor-not-allowed border-transparent text-zinc-400"
            }`}
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </form>
      </footer>
    </aside>
  );
};
