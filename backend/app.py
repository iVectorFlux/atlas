"""
Zawvee Backend — FastAPI Service Entrypoint
"""

import os
from pathlib import Path
from dotenv import load_dotenv

# Load .env from project root (parent of backend/)
_env_path = Path(__file__).resolve().parent.parent / ".env"
load_dotenv(_env_path)

import json
from typing import Optional, Dict, Any, List
from fastapi import FastAPI, HTTPException, Request, BackgroundTasks, Response
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from sse_starlette.sse import EventSourceResponse

from backend.models import (
    CreateSessionRequest,
    SessionState,
    ChatRequest,
    ChatMessage,
    CanvasOp,
    CanvasDocument,
    CheckpointRequest
)
from backend.session import store
from backend.orchestrator import orchestrator
from backend.tts import synthesize_speech, open_speech_stream

app = FastAPI(
    title="Zawvee AI Learning Platform",
    description="Multimodal AI Learning Orchestrator for Draw and Talk experiences",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
def health():
    return {"status": "ok", "app": "zawvee-orchestrator", "mode": "local"}

# ---------------------------------------------------------
# Session Endpoints
# ---------------------------------------------------------
@app.post("/v1/sessions", response_model=SessionState)
def create_session(req: CreateSessionRequest):
    session = store.create_session(user_id=req.user_id or "child_local", mode=req.mode)
    return session

@app.get("/v1/sessions/{session_id}", response_model=SessionState)
def get_session(session_id: str):
    session = store.get_session(session_id)
    if not session:
        session = store.create_session(mode="draw")
    return session

# ---------------------------------------------------------
# Chat Endpoints
# ---------------------------------------------------------
@app.post("/v1/chat/messages")
def send_chat_message(req: ChatRequest):
    user_msg = ChatMessage(
        session_id=req.session_id,
        role="user",
        content=req.message
    )
    store.add_message(user_msg)
    return {"status": "received", "message": user_msg}

@app.get("/v1/chat/history/{session_id}")
def get_chat_history(session_id: str):
    return {"messages": store.get_messages(session_id)}

@app.get("/v1/chat/stream/{session_id}")
async def stream_chat_response(
    session_id: str,
    prompt: str = "",
    interruption: Optional[str] = None,
    referent: Optional[str] = None
):
    """
    Server-Sent Events endpoint streaming assistant tokens, rich cards, and canvas ops.
    Supports Fast-Path Barge-In temporal memory and Multimodal Reference Resolution.
    """
    interruption_data = None
    if interruption:
        try:
            interruption_data = json.loads(interruption)
        except Exception:
            pass

    referent_data = None
    if referent:
        try:
            referent_data = json.loads(referent)
        except Exception:
            pass

    async def event_generator():
        async for item in orchestrator.handle_user_message(
            session_id,
            prompt,
            interruption_context=interruption_data,
            active_referent=referent_data
        ):
            yield {
                "event": item["event"],
                "data": json.dumps(item["data"])
            }

    return EventSourceResponse(event_generator())

# ---------------------------------------------------------
# TTS Endpoints
# ---------------------------------------------------------
@app.get("/v1/tts")
async def get_text_to_speech(text: str):
    """Stream spoken audio (MP3) for given text — playback can begin on the first chunk."""
    if not text.strip():
        raise HTTPException(status_code=400, detail="Text cannot be empty")
    stream = await open_speech_stream(text)
    if stream is None:
        raise HTTPException(status_code=502, detail="Failed to synthesize speech")
    return StreamingResponse(
        stream,
        media_type="audio/mpeg",
        headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"},
    )

@app.post("/v1/tts")
async def post_text_to_speech(req: Request):
    """Generate spoken audio (MP3) for given JSON payload."""
    data = await req.json()
    text = data.get("text", "")
    if not text.strip():
        raise HTTPException(status_code=400, detail="Text cannot be empty")
    audio = await synthesize_speech(text)
    if not audio:
        raise HTTPException(status_code=502, detail="Failed to synthesize speech")
    return Response(content=audio, media_type="audio/mpeg")

# ---------------------------------------------------------
# Canvas Endpoints
# ---------------------------------------------------------
@app.get("/v1/canvas/{session_id}", response_model=CanvasDocument)
def get_canvas(session_id: str):
    return store.get_canvas(session_id)

@app.post("/v1/canvas/ops")
def submit_canvas_op(session_id: str, op: CanvasOp):
    updated = store.apply_canvas_op(session_id, op)
    return {"status": "ok", "version": updated.version}

@app.post("/v1/canvas/checkpoint")
def save_canvas_checkpoint(req: CheckpointRequest):
    store.save_canvas(req.session_id, req.document)
    return {"status": "persisted", "version": req.document.version}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.app:app", host="127.0.0.1", port=8000, reload=True)
