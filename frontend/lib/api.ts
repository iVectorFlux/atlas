import { AppMode, SessionState, CanvasDocument, ChatMessage, CanvasOp } from "./types";

const API_BASE = typeof window !== "undefined" ? "" : "http://127.0.0.1:8000";

export async function createSession(mode: AppMode = "draw"): Promise<SessionState> {
  const res = await fetch(`${API_BASE}/v1/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode }),
  });
  if (!res.ok) throw new Error("Failed to create session");
  return res.json();
}

export async function getSession(sessionId: string): Promise<SessionState> {
  const res = await fetch(`${API_BASE}/v1/sessions/${sessionId}`);
  if (!res.ok) throw new Error("Failed to get session");
  return res.json();
}

export async function getCanvas(sessionId: string): Promise<CanvasDocument> {
  const res = await fetch(`${API_BASE}/v1/canvas/${sessionId}`);
  if (!res.ok) throw new Error("Failed to get canvas");
  return res.json();
}

export async function submitCanvasOp(sessionId: string, op: CanvasOp): Promise<{ status: string; version: number }> {
  const res = await fetch(`${API_BASE}/v1/canvas/ops?session_id=${sessionId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(op),
  });
  if (!res.ok) throw new Error("Failed to submit canvas op");
  return res.json();
}

export async function getChatHistory(sessionId: string): Promise<ChatMessage[]> {
  const res = await fetch(`${API_BASE}/v1/chat/history/${sessionId}`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.messages || [];
}

export interface ChatStreamOptions {
  interruptionContext?: any;
  activeReferent?: any;
}

export function subscribeChatStream(
  sessionId: string,
  prompt: string,
  callbacks: {
    onStatus?: (status: { status: string; icon?: string }) => void;
    onToken?: (tokenData: { token: string; accumulated: string }) => void;
    onPart?: (part: any) => void;
    onCanvasOp?: (op: CanvasOp) => void;
    onActionChips?: (chips: any[]) => void;
    onComplete?: (message: ChatMessage) => void;
    onError?: (err: any) => void;
  },
  options?: ChatStreamOptions
): () => void {
  let url = `${API_BASE}/v1/chat/stream/${sessionId}?prompt=${encodeURIComponent(prompt)}`;
  if (options?.interruptionContext) {
    url += `&interruption=${encodeURIComponent(JSON.stringify(options.interruptionContext))}`;
  }
  if (options?.activeReferent) {
    url += `&referent=${encodeURIComponent(JSON.stringify(options.activeReferent))}`;
  }
  const eventSource = new EventSource(url);

  eventSource.addEventListener("status", (e) => {
    try { callbacks.onStatus?.(JSON.parse(e.data)); } catch (err) { console.error("[SSE] Error handling status:", err); }
  });

  eventSource.addEventListener("token", (e) => {
    try { callbacks.onToken?.(JSON.parse(e.data)); } catch (err) { console.error("[SSE] Error handling token:", err); }
  });

  eventSource.addEventListener("part", (e) => {
    try { callbacks.onPart?.(JSON.parse(e.data)); } catch (err) { console.error("[SSE] Error handling part:", err); }
  });

  eventSource.addEventListener("canvas_op", (e) => {
    try { callbacks.onCanvasOp?.(JSON.parse(e.data)); } catch (err) { console.error("[SSE] Error handling canvas_op:", err); }
  });

  eventSource.addEventListener("action_chips", (e) => {
    try { callbacks.onActionChips?.(JSON.parse(e.data)); } catch (err) { console.error("[SSE] Error handling action_chips:", err); }
  });

  eventSource.addEventListener("complete", (e) => {
    try {
      callbacks.onComplete?.(JSON.parse(e.data));
    } catch (err) {
      console.error("[SSE] Error handling complete:", err);
    }
    eventSource.close();
  });

  eventSource.onerror = (err) => {
    callbacks.onError?.(err);
    eventSource.close();
  };

  return () => eventSource.close();
}
