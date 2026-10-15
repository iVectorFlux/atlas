"use client";

import { useState, useRef, useCallback, useEffect } from "react";

interface UseVoiceInputOptions {
  /** Called when transcription is complete */
  onResult: (transcript: string) => void;
  /** Called immediately when voice activity begins or interim text is heard (Barge-In) */
  onSpeechDetected?: (interim: string) => void;
  /** Language for speech recognition */
  lang?: string;
}

interface UseVoiceInputReturn {
  /** Whether the mic is currently listening */
  isListening: boolean;
  /** Start recording */
  startListening: () => void;
  /** Stop recording */
  stopListening: () => void;
  /** Toggle recording */
  toggleListening: () => void;
  /** Whether Web Speech API is available */
  isSupported: boolean;
  /** Interim transcript while speaking */
  interimText: string;
}

/**
 * useVoiceInput — Browser-native speech-to-text using the Web Speech API.
 * Zero-cost, no API keys needed, works in Chrome/Edge/Safari.
 */
export function useVoiceInput({
  onResult,
  onSpeechDetected,
  lang = "en-US",
}: UseVoiceInputOptions): UseVoiceInputReturn {
  const [isListening, setIsListening] = useState(false);
  const [interimText, setInterimText] = useState("");
  const [isSupported, setIsSupported] = useState(false);
  const recognitionRef = useRef<any>(null);
  const onSpeechDetectedRef = useRef(onSpeechDetected);
  onSpeechDetectedRef.current = onSpeechDetected;

  useEffect(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    setIsSupported(!!SpeechRecognition);

    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang = lang;
      recognition.maxAlternatives = 1;

      recognition.onspeechstart = () => {
        onSpeechDetectedRef.current?.("");
      };

      recognition.onsoundstart = () => {
        onSpeechDetectedRef.current?.("");
      };

      recognition.onresult = (event: any) => {
        let interim = "";
        let final = "";

        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            final += transcript;
          } else {
            interim += transcript;
          }
        }

        setInterimText(interim);
        if (interim) {
          onSpeechDetectedRef.current?.(interim);
        }

        if (final) {
          setInterimText("");
          onResult(final.trim());
        }
      };

      recognition.onend = () => {
        setIsListening(false);
        setInterimText("");
      };

      recognition.onerror = (event: any) => {
        console.warn("[VoiceInput] Error:", event.error);
        setIsListening(false);
        setInterimText("");
      };

      recognitionRef.current = recognition;
    }

    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch {}
      }
    };
  }, [lang, onResult]);

  const startListening = useCallback(() => {
    if (!recognitionRef.current || isListening) return;
    try {
      recognitionRef.current.start();
      setIsListening(true);
    } catch (e) {
      console.warn("[VoiceInput] Failed to start:", e);
    }
  }, [isListening]);

  const stopListening = useCallback(() => {
    if (!recognitionRef.current || !isListening) return;
    try {
      recognitionRef.current.stop();
    } catch {}
    setIsListening(false);
  }, [isListening]);

  const toggleListening = useCallback(() => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  }, [isListening, startListening, stopListening]);

  return {
    isListening,
    startListening,
    stopListening,
    toggleListening,
    isSupported,
    interimText,
  };
}
