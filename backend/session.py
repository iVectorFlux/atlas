"""
Zawvee Backend — Local Session Store
In-memory and file-backed persistence for local testing without external Redis or Postgres.
"""

import json
import os
import time
from typing import Dict, List, Optional
from backend.models import SessionState, ChatMessage, CanvasDocument, CanvasPage, CanvasOp

DATA_DIR = os.path.join(os.path.dirname(__file__), "../local/zawvee_data")
os.makedirs(DATA_DIR, exist_ok=True)

class LocalSessionStore:
    def __init__(self):
        self.sessions: Dict[str, SessionState] = {}
        self.messages: Dict[str, List[ChatMessage]] = {}
        self.canvas_docs: Dict[str, CanvasDocument] = {}
        self.event_queues: Dict[str, list] = {}
        self._load_local_cache()

    def _load_local_cache(self):
        try:
            cache_file = os.path.join(DATA_DIR, "sessions.json")
            if os.path.exists(cache_file):
                with open(cache_file, "r") as f:
                    data = json.load(f)
                    for item in data:
                        s = SessionState(**item)
                        self.sessions[s.id] = s
        except Exception:
            pass

    def _persist_sessions(self):
        try:
            cache_file = os.path.join(DATA_DIR, "sessions.json")
            with open(cache_file, "w") as f:
                json.dump([s.model_dump() for s in self.sessions.values()], f, indent=2)
        except Exception:
            pass

    def create_session(self, user_id: str = "child_local", mode: str = "draw") -> SessionState:
        session = SessionState(user_id=user_id, mode=mode)
        self.sessions[session.id] = session
        
        # Initialize corresponding blank canvas document with Page 1
        page1 = CanvasPage(
            document_id=session.id,
            title="Page 1",
            order=0
        )
        doc = CanvasDocument(
            session_id=session.id,
            active_page_id=page1.id,
            pages=[page1]
        )
        self.canvas_docs[session.id] = doc
        self.messages[session.id] = []
        self.event_queues[session.id] = []
        self._persist_sessions()
        return session

    def get_session(self, session_id: str) -> Optional[SessionState]:
        return self.sessions.get(session_id)

    def get_messages(self, session_id: str) -> List[ChatMessage]:
        return self.messages.get(session_id, [])

    def add_message(self, message: ChatMessage):
        if message.session_id not in self.messages:
            self.messages[message.session_id] = []
        self.messages[message.session_id].append(message)

    def get_canvas(self, session_id: str) -> CanvasDocument:
        if session_id not in self.canvas_docs:
            page = CanvasPage(document_id=session_id, title="Page 1", order=0)
            self.canvas_docs[session_id] = CanvasDocument(
                session_id=session_id,
                active_page_id=page.id,
                pages=[page]
            )
        return self.canvas_docs[session_id]

    def save_canvas(self, session_id: str, doc: CanvasDocument):
        doc.updated_at = time.time()
        self.canvas_docs[session_id] = doc

    def apply_canvas_op(self, session_id: str, op: CanvasOp) -> CanvasDocument:
        doc = self.get_canvas(session_id)
        page_id = op.page_id or doc.active_page_id
        target_page = next((p for p in doc.pages if p.id == page_id), None)
        if not target_page and doc.pages:
            target_page = doc.pages[0]

        if target_page:
            if op.op == "create_stroke":
                target_page.strokes.append(op.payload)
            elif op.op in ("create_shape", "create_text", "create_math"):
                target_page.objects.append(op.payload)
            elif op.op == "delete_object":
                obj_id = op.payload.get("id")
                target_page.objects = [o for o in target_page.objects if (isinstance(o, dict) and o.get("id") != obj_id)]
            elif op.op == "clear_page":
                target_page.strokes = []
                target_page.objects = []
            elif op.op == "create_page":
                new_page = CanvasPage(
                    document_id=doc.id,
                    title=op.payload.get("title", f"Page {len(doc.pages)+1}"),
                    order=len(doc.pages)
                )
                doc.pages.append(new_page)
                doc.active_page_id = new_page.id
            elif op.op == "set_page":
                doc.active_page_id = op.payload.get("page_id", doc.active_page_id)

            doc.version += 1
            doc.updated_at = time.time()

        return doc

store = LocalSessionStore()
