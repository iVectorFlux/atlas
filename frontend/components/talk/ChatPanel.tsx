"use client";

import React, { useState, useRef, useEffect } from "react";
import { ChatMessage, ActionChip, ThemeMode } from "@/lib/types";
import { Send, Mic, MicOff, MessageSquare, BookOpen, PenTool } from "lucide-react";
import { cleanLatexFormula } from "@/lib/sketchEngine";
import { safeKatexRender } from "@/lib/katexSafe";
import katex from "katex";

interface ChatPanelProps {
  messages: ChatMessage[];
  onSendMessage: (text: string) => void;
  onChipClick: (chip: ActionChip) => void;
  isStreaming: boolean;
  streamingToken: string;
  onSwitchToDraw?: () => void;
  theme?: ThemeMode;
  voiceIsListening?: boolean;
  voiceInterimText?: string;
  onVoiceToggle?: () => void;
  voiceSupported?: boolean;
}

export const ChatPanel: React.FC<ChatPanelProps> = ({
  messages,
  onSendMessage,
  onChipClick,
  isStreaming,
  streamingToken,
  onSwitchToDraw,
  theme = "dark",
  voiceIsListening = false,
  voiceInterimText = "",
  onVoiceToggle,
  voiceSupported = false,
}) => {
  const [inputText, setInputText] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const isLight = theme === "light";

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingToken]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || isStreaming) return;
    onSendMessage(inputText.trim());
    setInputText("");
  };

  const renderMath = (latex: string) => {
    return safeKatexRender(latex, false);
  };

  const cleanMessageText = (text: string) => {
    if (!text) return "";
    let clean = text.split("```")[0];
    clean = clean.replace(/<anchor\b[^>]*>(.*?)<\/anchor>/gi, "$1");
    clean = clean.replace(/<\/?[^>]+(>|$)/g, "");
    return clean.trim();
  };

  return (
    <div
      className={`flex flex-col h-full w-full relative overflow-hidden select-none transition-colors duration-200 ${
        isLight ? "bg-[#F7F7F8]" : "bg-[#141416]"
      }`}
    >
      {/* Top Header */}
      <div
        className={`h-14 px-6 border-b flex items-center justify-between shrink-0 transition-colors ${
          isLight
            ? "bg-white border-black/[0.08]"
            : "bg-[#18181B] border-white/[0.08]"
        }`}
      >
        <div className="flex items-center gap-2.5">
          <div
            className={`w-7 h-7 rounded-lg border flex items-center justify-center transition-colors ${
              isLight
                ? "bg-[#F4F4F5] border-black/10 text-zinc-700"
                : "bg-[#222226] border-white/10 text-zinc-300"
            }`}
          >
            <MessageSquare className="w-3.5 h-3.5" />
          </div>
          <div>
            <h2
              className={`text-sm font-semibold tracking-tight transition-colors ${
                isLight ? "text-zinc-900" : "text-white"
              }`}
            >
              Zawvee Talk
            </h2>
          </div>
        </div>

        {onSwitchToDraw && (
          <button
            type="button"
            onClick={onSwitchToDraw}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all active:scale-95 ${
              isLight
                ? "bg-[#F4F4F5] hover:bg-zinc-200 border-black/10 text-zinc-700 hover:text-zinc-950"
                : "bg-[#222226] hover:bg-[#2A2A30] border-white/10 text-zinc-300 hover:text-white"
            }`}
          >
            <PenTool className="w-3.5 h-3.5 opacity-70" />
            <span>Open Draw Canvas</span>
          </button>
        )}
      </div>

      {/* Messages Column (Centered for distraction-free learning) */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
        <div className="max-w-3xl mx-auto w-full space-y-4 h-full flex flex-col justify-start">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center text-center p-8 my-auto h-full">
              <div
                className={`w-12 h-12 rounded-2xl border flex items-center justify-center mb-4 transition-colors ${
                  isLight
                    ? "bg-white border-black/10 text-zinc-700 shadow-sm"
                    : "bg-[#1C1C20] border-white/10 text-zinc-300"
                }`}
              >
                <MessageSquare className="w-6 h-6" />
              </div>
              <h3
                className={`font-semibold text-lg transition-colors ${
                  isLight ? "text-zinc-900" : "text-white"
                }`}
              >
                Ask your tutor anything
              </h3>
              <p
                className={`text-xs max-w-sm mt-1.5 leading-relaxed transition-colors ${
                  isLight ? "text-zinc-500" : "text-zinc-400"
                }`}
              >
                Explore math, science, and concepts. Your tutor can explain step-by-step or draw diagrams directly onto your canvas.
              </p>
              <div className="flex flex-wrap gap-2 mt-6 justify-center max-w-md">
                {[
                  "How do fractions work?",
                  "Draw the Pythagorean theorem",
                  "Explain photosynthesis step-by-step",
                  "Draw an atom diagram",
                ].map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => onSendMessage(suggestion)}
                    className={`px-3.5 py-1.5 rounded-full text-xs font-medium border transition-all ${
                      isLight
                        ? "bg-white border-black/10 hover:border-black/25 text-zinc-700 hover:text-zinc-950 shadow-sm"
                        : "bg-[#1C1C20] border-white/10 hover:border-white/25 text-zinc-300 hover:text-white shadow-sm"
                    }`}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex flex-col ${msg.role === "user" ? "items-end" : "items-start"}`}
            >
              <div
                className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                  msg.role === "user"
                    ? isLight
                      ? "bg-[#18181B] text-white rounded-br-xs border border-black/10 shadow-sm"
                      : "bg-[#27272A] text-white rounded-br-xs border border-white/10 shadow-sm"
                    : isLight
                    ? "bg-white text-zinc-800 border border-black/[0.08] rounded-bl-xs shadow-sm"
                    : "bg-[#1C1C20] text-zinc-200 border border-white/[0.08] rounded-bl-xs shadow-sm"
                }`}
              >
                <div className="whitespace-pre-wrap">{cleanMessageText(msg.content)}</div>

                {/* Render Math and Structured Parts */}
                {msg.parts && msg.parts.length > 0 && (
                  <div className="mt-3 space-y-2">
                    {msg.parts.map((part, idx) => {
                      if (part.type === "math" && part.latex) {
                        return (
                          <div
                            key={idx}
                            className={`p-3 rounded-xl border text-center overflow-x-auto my-2 font-mono ${
                              isLight
                                ? "bg-[#F4F4F5] border-black/10 text-zinc-900"
                                : "bg-[#141416] border-white/10 text-white"
                            }`}
                            dangerouslySetInnerHTML={{ __html: renderMath(part.latex) }}
                          />
                        );
                      }
                      if (part.type === "card") {
                        return (
                          <div
                            key={idx}
                            className={`p-3 rounded-xl border mt-2 ${
                              isLight
                                ? "bg-[#F4F4F5] border-black/[0.08]"
                                : "bg-[#18181B] border-white/[0.08]"
                            }`}
                          >
                            {part.title && (
                              <div
                                className={`flex items-center gap-1.5 font-semibold text-xs mb-1 ${
                                  isLight ? "text-zinc-900" : "text-white"
                                }`}
                              >
                                <BookOpen className="w-3.5 h-3.5 opacity-70" />
                                {part.title}
                              </div>
                            )}
                            {part.description && (
                              <p
                                className={`text-xs leading-normal ${
                                  isLight ? "text-zinc-600" : "text-zinc-400"
                                }`}
                              >
                                {part.description}
                              </p>
                            )}
                          </div>
                        );
                      }
                      return null;
                    })}
                  </div>
                )}
              </div>

              {/* Action Chips */}
              {msg.action_chips && msg.action_chips.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2 ml-1">
                  {msg.action_chips.map((chip) => (
                    <button
                      key={chip.id}
                      type="button"
                      onClick={() => onChipClick(chip)}
                      className={`px-3 py-1 rounded-full text-xs font-medium border transition-all active:scale-95 ${
                        isLight
                          ? "bg-white border-black/10 text-zinc-700 hover:text-zinc-950 hover:border-black/20 shadow-sm"
                          : "bg-[#1C1C20] border-white/10 text-zinc-300 hover:text-white hover:border-white/20"
                      }`}
                    >
                      {chip.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}

          {/* Live streaming bubble */}
          {isStreaming && (
            <div className="flex flex-col items-start">
              <div
                className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed border rounded-bl-xs shadow-sm ${
                  isLight
                    ? "bg-white text-zinc-800 border-black/15"
                    : "bg-[#1C1C20] text-zinc-200 border-white/15"
                }`}
              >
                <div className="whitespace-pre-wrap">
                  {cleanMessageText(streamingToken) || "Thinking..."}
                  <span
                    className={`inline-block w-1.5 h-3.5 ml-1 animate-pulse ${
                      isLight ? "bg-zinc-900" : "bg-white"
                    }`}
                  />
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Composer Area */}
      <div
        className={`p-4 border-t transition-colors ${
          isLight
            ? "bg-white border-black/[0.08]"
            : "bg-[#18181B] border-white/[0.08]"
        }`}
      >
        <form onSubmit={handleSubmit} className="max-w-3xl mx-auto flex items-center gap-2">
          <button
            type="button"
            onClick={onVoiceToggle}
            className={`w-11 h-11 rounded-xl border flex items-center justify-center transition-all active:scale-95 shrink-0 ${
              voiceIsListening
                ? "bg-red-500 border-red-400 text-white shadow-md shadow-red-500/20"
                : isLight
                ? "bg-[#F4F4F5] border-black/10 hover:bg-zinc-200 text-zinc-600 hover:text-zinc-950"
                : "bg-[#222226] border-white/10 hover:bg-[#2A2A30] text-zinc-400 hover:text-white"
            }`}
            title={voiceIsListening ? "Stop listening" : "Speak to tutor"}
          >
            {voiceIsListening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
          </button>

          <input
            type="text"
            value={voiceIsListening ? voiceInterimText : inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder={voiceIsListening ? "🎤 Listening..." : "Ask your tutor or type 'Draw a triangle'..."}
            className={`flex-1 h-11 px-4 rounded-xl border text-sm transition-all focus:outline-none ${
              isLight
                ? "bg-[#F4F4F5] border-black/10 text-zinc-900 placeholder:text-zinc-400 focus:border-black/30"
                : "bg-[#1C1C20] border-white/10 text-white placeholder:text-zinc-500 focus:border-white/30"
            }`}
          />

          <button
            type="submit"
            disabled={!inputText.trim() || isStreaming}
            className={`h-11 px-4 rounded-xl font-medium text-xs flex items-center gap-1.5 shadow-sm disabled:opacity-40 disabled:pointer-events-none transition-all active:scale-95 shrink-0 ${
              isLight
                ? "bg-[#18181B] hover:bg-black text-white"
                : "bg-white hover:bg-zinc-200 text-zinc-950"
            }`}
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
      </div>
    </div>
  );
};
