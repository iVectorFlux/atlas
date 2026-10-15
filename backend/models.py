"""
Zawvee Backend — Domain Models & Schemas
Typed Pydantic contracts for Session, Chat, Canvas Operations, and Memory.
"""

from typing import List, Optional, Dict, Any, Union, Literal
from pydantic import BaseModel, Field
import time
import uuid

# ---------------------------------------------------------
# Session Models
# ---------------------------------------------------------
class CreateSessionRequest(BaseModel):
    user_id: Optional[str] = "child_local"
    grade: Optional[str] = "4"
    mode: Literal["draw", "talk"] = "draw"

class SessionState(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str = "child_local"
    mode: Literal["draw", "talk"] = "draw"
    title: str = "New Exploration"
    created_at: float = Field(default_factory=time.time)
    updated_at: float = Field(default_factory=time.time)

# ---------------------------------------------------------
# Chat Models
# ---------------------------------------------------------
class ActionChip(BaseModel):
    id: str
    label: str
    action: str  # e.g., "draw_this", "explain_another_way", "try_one", "show_me"
    payload: Optional[Dict[str, Any]] = None

class ContentPart(BaseModel):
    type: Literal["text", "math", "card", "canvas_preview", "diagram"]
    text: Optional[str] = None
    latex: Optional[str] = None
    title: Optional[str] = None
    description: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None

class ChatMessage(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    session_id: str
    role: Literal["user", "assistant", "system"]
    content: str
    parts: List[ContentPart] = []
    action_chips: List[ActionChip] = []
    created_at: float = Field(default_factory=time.time)

class ChatRequest(BaseModel):
    session_id: str
    message: str
    context_mode: Literal["draw", "talk"] = "talk"
    canvas_snapshot_summary: Optional[str] = None

# ---------------------------------------------------------
# Canvas Models
# ---------------------------------------------------------
class Point(BaseModel):
    x: float
    y: float
    pressure: Optional[float] = 0.5

class Stroke(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    page_id: str
    tool: Literal["pen", "pencil", "highlighter", "eraser"] = "pen"
    color: str = "#EDEDED"
    size: float = 6.0
    points: List[Point] = []
    created_at: float = Field(default_factory=time.time)

class CanvasObject(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    page_id: str
    type: Literal["rect", "circle", "arrow", "line", "star", "text", "math"]
    x: float
    y: float
    width: float
    height: float
    color: str = "#EDEDED"
    fill: Optional[str] = "transparent"
    stroke_width: float = 2.0
    text: Optional[str] = None
    latex: Optional[str] = None
    z_index: int = 0
    props: Optional[Dict[str, Any]] = None

class CanvasPage(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    document_id: str
    title: str = "Page 1"
    order: int = 0
    strokes: List[Stroke] = []
    objects: List[CanvasObject] = []
    version: int = 1

class CanvasDocument(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    session_id: str
    active_page_id: str
    pages: List[CanvasPage] = []
    version: int = 1
    updated_at: float = Field(default_factory=time.time)

class CanvasOp(BaseModel):
    op: Literal[
        "create_stroke",
        "create_shape",
        "create_text",
        "create_math",
        "move_object",
        "highlight_object",
        "delete_object",
        "clear_page",
        "create_page",
        "set_page",
        "draw_handwriting",
        "draw_diagram",
        "draw_scene",
        "draw_svg"
    ]
    page_id: Optional[str] = None
    payload: Dict[str, Any]
    client_id: Optional[str] = "user"
    timestamp: float = Field(default_factory=time.time)

class CheckpointRequest(BaseModel):
    session_id: str
    document: CanvasDocument

# ---------------------------------------------------------
# Semantic Scene Graph Models (Spatial Teaching Engine)
# ---------------------------------------------------------
class BoundingBox(BaseModel):
    minX: float
    maxX: float
    minY: float
    maxY: float
    width: float
    height: float
    centerX: float
    centerY: float

class SemanticRelation(BaseModel):
    type: Literal["contains", "part_of", "labels", "perpendicular_to", "parallel_to", "adjacent_to", "points_to"]
    targetId: str
    metadata: Optional[Dict[str, Any]] = None

class SemanticObject(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    type: Literal["equation", "shape", "diagram", "label", "group"]
    semanticType: str
    role: Literal["title", "primary_concept", "visual_model", "conclusion", "annotation", "axis", "counter", "slice"] = "visual_model"
    bounds: Optional[BoundingBox] = None
    properties: Dict[str, Any] = {}
    relations: List[SemanticRelation] = []
    version: int = 1
    visible: bool = True
    color: Optional[str] = "#EDEDED"
    label: Optional[str] = None
    latex: Optional[str] = None
