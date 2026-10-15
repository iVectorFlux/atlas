/**
 * Canonical Scene Graph Data Contracts
 * Defines authoritative, typed representations for whiteboard teaching entities.
 * (Invariants 1, 2, 3 of JAWVEE Spatial Teaching Engine)
 */

export interface BoundingBox {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
}

export type SemanticRole = 
  | "title" 
  | "primary_concept" 
  | "visual_model" 
  | "conclusion" 
  | "annotation" 
  | "axis" 
  | "counter" 
  | "slice";

export type RelationType = 
  | "contains" 
  | "part_of" 
  | "labels" 
  | "perpendicular_to" 
  | "parallel_to" 
  | "adjacent_to" 
  | "points_to";

export interface SemanticRelation {
  type: RelationType;
  targetId: string;
  metadata?: Record<string, any>;
}

export interface SemanticObject {
  id: string;
  type: "equation" | "shape" | "diagram" | "label" | "group";
  semanticType: string; // e.g. "multiplication_array", "fraction_slice", "ten_frame", "number_line", "right_triangle"
  role: SemanticRole;
  bounds: BoundingBox;
  properties: Record<string, any>;
  relations: SemanticRelation[];
  version: number;
  visible: boolean;
  color?: string;
  label?: string;
  latex?: string;
  sourceEventId?: string;
}

export interface VirtualViewport {
  virtualWidth: 1000;
  virtualHeight: 600;
  scale: number;
  offsetX: number;
  offsetY: number;
}

export interface SceneGraph {
  version: number;
  viewport: VirtualViewport;
  objects: Map<string, SemanticObject>;
  activeFocusId?: string;
  lastUpdated: number;
}

export type SceneGraphOperation =
  | { type: "add_object"; object: SemanticObject }
  | { type: "update_object"; id: string; patch: Partial<SemanticObject> }
  | { type: "remove_object"; id: string }
  | { type: "clear" }
  | { type: "set_focus"; id?: string };
