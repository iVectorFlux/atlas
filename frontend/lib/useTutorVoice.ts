"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { compileTeachingPerformancePlan } from "./sceneGraph/performanceParser";
import { performanceDirector } from "./sceneGraph/performanceDirector";

interface UseTutorVoiceOptions {
  /** Called when a speech sentence begins */
  onSentenceStart?: (sentence: string) => void;
  /** Called when audio playback actually starts emitting sound */
  onAudioStart?: () => void;
  /** Called when all speech finishes */
  onComplete?: () => void;
}

interface UseTutorVoiceReturn {
  /** Whether the tutor is actively speaking */
  isSpeaking: boolean;
  /** Whether tutor voice output is muted by the user */
  isMuted: boolean;
  /** Current spoken subtitle text */
  currentSubtitle: string;
  /** Speak a block of text (cleans markdown, splits into sentences, plays audio) */
  speak: (text: string) => Promise<void>;
  /** Add an incoming sentence to the speech queue immediately for low latency */
  queueSentence: (sentence: string) => void;
  /** Prefetch audio for an upcoming sentence in the background without playing it */
  prefetchSentence: (sentence: string) => void;
  /** Stop any currently playing speech immediately */
  stop: () => void;
  /** Toggle mute state */
  toggleMute: () => void;
}

/**
 * Clean text for natural speech synthesis and subtitle display
 */
export function cleanTextForSpeech(raw: string): string {
  if (!raw) return "";

  let text = raw;
  if (text.includes("```")) {
    text = text.split("```")[0];
  }
  text = text.replace(/`.*?`/g, "");

  // Strip <anchor ...>phrase</anchor> tags, keeping only the inner spoken phrase
  text = text.replace(/<anchor\b[^>]*>(.*?)<\/anchor>/gi, "$1");
  // Strip any remaining/unclosed XML or HTML tags
  text = text.replace(/<\/?[^>]+(>|$)/g, "");

  // Clean LaTeX formulas
  text = text.replace(/\$\$(.*?)\$\$/g, " $1 ");
  text = text.replace(/\$(.*?)\$/g, " $1 ");
  text = text.replace(/\\frac\{1\}\{2\}/g, "one half");
  text = text.replace(/\\frac\{1\}\{4\}/g, "one quarter");
  text = text.replace(/\\frac\{3\}\{4\}/g, "three quarters");
  text = text.replace(/\^2/g, " squared");
  text = text.replace(/\^3/g, " cubed");
  text = text.replace(/\\times/g, " times ");
  text = text.replace(/\\cdot/g, " times ");
  text = text.replace(/\\implies/g, " which means ");
  text = text.replace(/\\quad|\\qquad/g, " ");
  text = text.replace(/\\text\{([^}]+)\}/g, "$1");
  text = text.replace(/\+/g, " plus ");
  text = text.replace(/=/g, " equals ");

  // Remove markdown headers, bold, italics, links
  text = text.replace(/#{1,6}\s*/g, "");
  text = text.replace(/\*\*(.*?)\*\*/g, "$1");
  text = text.replace(/\*(.*?)\*/g, "$1");
  text = text.replace(/\[(.*?)\]\(.*?\)/g, "$1");
  text = text.replace(/^[-*+]\s+/gm, "");
  text = text.replace(/^\d+\.\s+/gm, "");

  // Clean multiple spaces and newlines
  text = text.replace(/\s+/g, " ").trim();
  return text;
}

/**
 * useTutorVoice — Pipelined, Low-Latency Real-Time Audio Playback
 *
 * Uses backend `/v1/tts` (Deepgram Aura-2 / OpenAI TTS) with:
 *  - Immediate sentence-by-sentence streaming (starts in < 500ms)
 *  - Next-sentence audio prefetching (eliminates pauses between sentences)
 *  - Automatic browser SpeechSynthesis fallback
 */
export function useTutorVoice({
  onSentenceStart,
  onAudioStart,
  onComplete,
}: UseTutorVoiceOptions = {}): UseTutorVoiceReturn {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [currentSubtitle, setCurrentSubtitle] = useState("");

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playQueueRef = useRef<string[]>([]);
  const isPlayingRef = useRef(false);
  const isMutedRef = useRef(false);
  const prefetchCacheRef = useRef<Map<string, HTMLAudioElement>>(new Map());

  // Keep isMutedRef in sync
  useEffect(() => {
    isMutedRef.current = isMuted;
    if (isMuted) {
      stop();
    }
  }, [isMuted]);

  // Stop playback immediately
  const stop = useCallback(() => {
    performanceDirector.interrupt();
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current = null;
    }
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    prefetchCacheRef.current.clear();
    playQueueRef.current = [];
    isPlayingRef.current = false;
    setIsSpeaking(false);
    setCurrentSubtitle("");
  }, []);

  const toggleMute = useCallback(() => {
    setIsMuted((prev) => !prev);
  }, []);

  // Play next item in the sentence queue
  const playNextInQueue = useCallback(async () => {
    if (isMutedRef.current || playQueueRef.current.length === 0) {
      performanceDirector.complete();
      isPlayingRef.current = false;
      setIsSpeaking(false);
      setCurrentSubtitle("");
      onComplete?.();
      return;
    }

    const rawSentence = playQueueRef.current.shift()!;
    const plan = compileTeachingPerformancePlan(rawSentence);
    performanceDirector.armPlan(plan);

    const sentence = cleanTextForSpeech(plan.cleanSpeechText || rawSentence);
    isPlayingRef.current = true;
    setIsSpeaking(true);
    setCurrentSubtitle(sentence);
    onSentenceStart?.(sentence);

    // Prefetch the NEXT sentence in queue while this one plays to eliminate pauses
    if (playQueueRef.current.length > 0) {
      const nextRaw = playQueueRef.current[0];
      const nextPlan = compileTeachingPerformancePlan(nextRaw);
      const nextSentence = cleanTextForSpeech(nextPlan.cleanSpeechText || nextRaw);
      if (!prefetchCacheRef.current.has(nextSentence)) {
        try {
          const prefetchAudio = new Audio(`/v1/tts?text=${encodeURIComponent(nextSentence)}`);
          prefetchAudio.preload = "auto";
          prefetchCacheRef.current.set(nextSentence, prefetchAudio);
        } catch {}
      }
    }

    // Try backend /v1/tts first (using prefetched audio if available)
    try {
      let audio: HTMLAudioElement;
      if (prefetchCacheRef.current.has(sentence)) {
        audio = prefetchCacheRef.current.get(sentence)!;
        prefetchCacheRef.current.delete(sentence);
      } else {
        const ttsUrl = `/v1/tts?text=${encodeURIComponent(sentence)}`;
        audio = new Audio(ttsUrl);
      }

      audioRef.current = audio;

      // Authoritative Web Audio Media Clock Synchronization (PRD Section 17)
      audio.ontimeupdate = () => {
        performanceDirector.tick(audio.currentTime * 1000, (audio.duration || 1) * 1000);
      };

      audio.onplay = () => {
        onAudioStart?.();
      };

      await new Promise<void>((resolve, reject) => {
        audio.onended = () => {
          performanceDirector.complete();
          resolve();
        };
        audio.onerror = (e) => reject(e);
        audio.play().catch((err) => reject(err));
      });

      audioRef.current = null;
      playNextInQueue();
    } catch {
      // Fallback: Browser Web SpeechSynthesis
      if (typeof window !== "undefined" && window.speechSynthesis && !isMutedRef.current) {
        try {
          const utterance = new SpeechSynthesisUtterance(sentence);
          utterance.rate = 1.05;
          utterance.pitch = 1.02;
          utterance.lang = "en-US";

          const voices = window.speechSynthesis.getVoices();
          const naturalVoice = voices.find(
            (v) => v.lang.startsWith("en") && (v.name.includes("Natural") || v.name.includes("Google") || v.name.includes("Samantha"))
          ) || voices.find((v) => v.lang.startsWith("en"));
          if (naturalVoice) utterance.voice = naturalVoice;

          utterance.onstart = () => {
            onAudioStart?.();
          };

          utterance.onboundary = (e: any) => {
            if (e.name === "word") {
              performanceDirector.tick(e.elapsedTime);
            }
          };

          utterance.onend = () => {
            performanceDirector.complete();
            playNextInQueue();
          };
          utterance.onerror = () => {
            performanceDirector.complete();
            playNextInQueue();
          };
          window.speechSynthesis.speak(utterance);
        } catch {
          performanceDirector.complete();
          playNextInQueue();
        }
      } else {
        performanceDirector.complete();
        playNextInQueue();
      }
    }
  }, [onSentenceStart, onComplete]);

  // Queue a single sentence immediately (low-latency streaming)
  const queueSentence = useCallback((sentence: string) => {
    const trimmed = sentence?.trim();
    if (!trimmed || isMutedRef.current) return;

    playQueueRef.current.push(trimmed);
    if (!isPlayingRef.current) {
      playNextInQueue();
    }
  }, [playNextInQueue]);

  // Speak full text or sentences
  const speak = useCallback(
    async (text: string) => {
      const clean = cleanTextForSpeech(text);
      if (!clean || isMutedRef.current) return;

      stop();

      const rawSentences = clean.match(/[^.!?]+[.!?]+|\S[^.!?]*$/g) || [clean];
      const sentences: string[] = [];

      for (const s of rawSentences) {
        const trimmed = s.trim();
        if (trimmed.length > 0) {
          if (trimmed.length > 180) {
            const parts = trimmed.split(/,\s+/);
            sentences.push(...parts.filter((p) => p.trim().length > 0));
          } else {
            sentences.push(trimmed);
          }
        }
      }

      if (sentences.length === 0) return;

      playQueueRef.current = sentences;
      playNextInQueue();
    },
    [stop, playNextInQueue]
  );

  // Prefetch a single sentence in the background without playing immediately
  const prefetchSentence = useCallback((sentence: string) => {
    const clean = cleanTextForSpeech(sentence);
    if (!clean || isMutedRef.current || prefetchCacheRef.current.has(clean)) return;
    try {
      const prefetchAudio = new Audio(`/v1/tts?text=${encodeURIComponent(clean)}`);
      prefetchAudio.preload = "auto";
      prefetchCacheRef.current.set(clean, prefetchAudio);
    } catch {}
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stop();
    };
  }, [stop]);

  return {
    isSpeaking,
    isMuted,
    currentSubtitle,
    speak,
    queueSentence,
    prefetchSentence,
    stop,
    toggleMute,
  };
}
