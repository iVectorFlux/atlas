/**
 * Scene Graph Manager
 * Authoritative client-side runtime for managing whiteboard semantic entities,
 * hit-testing, and virtual viewport coordinate transformations.
 */

import {
  BoundingBox,
  SemanticObject,
  SceneGraph,
  SceneGraphOperation,
  VirtualViewport,
} from "./types";

export const VIRTUAL_CANVAS_WIDTH = 1000;
export const VIRTUAL_CANVAS_HEIGHT = 600;

export class SceneGraphManager {
  private graph: SceneGraph;
  private listeners: Set<(graph: SceneGraph) => void> = new Set();

  constructor() {
    this.graph = {
      version: 1,
      viewport: {
        virtualWidth: VIRTUAL_CANVAS_WIDTH,
        virtualHeight: VIRTUAL_CANVAS_HEIGHT,
        scale: 1,
        offsetX: 0,
        offsetY: 0,
      },
      objects: new Map(),
      lastUpdated: Date.now(),
    };
  }

  public getSnapshot(): SceneGraph {
    return {
      ...this.graph,
      objects: new Map(this.graph.objects),
    };
  }

  public getObjects(): SemanticObject[] {
    return Array.from(this.graph.objects.values());
  }

  public getObject(id: string): SemanticObject | undefined {
    return this.graph.objects.get(id);
  }

  public getVersion(): number {
    return this.graph.version;
  }

  /**
   * Updates the virtual viewport scale & offset to match the physical container size.
   * Ensures responsive, uniform scaling across desktop, iPad, and mobile screens.
   */
  public updateViewport(containerWidth: number, containerHeight: number, reservedBottomDock = 90): VirtualViewport {
    const usableHeight = Math.max(200, containerHeight - reservedBottomDock);
    const scaleX = containerWidth / VIRTUAL_CANVAS_WIDTH;
    const scaleY = usableHeight / VIRTUAL_CANVAS_HEIGHT;
    const scale = Math.min(scaleX, scaleY);

    const offsetX = Math.max(0, (containerWidth - VIRTUAL_CANVAS_WIDTH * scale) / 2);
    const offsetY = Math.max(0, (usableHeight - VIRTUAL_CANVAS_HEIGHT * scale) / 2);

    this.graph.viewport = {
      virtualWidth: VIRTUAL_CANVAS_WIDTH,
      virtualHeight: VIRTUAL_CANVAS_HEIGHT,
      scale,
      offsetX,
      offsetY,
    };

    return this.graph.viewport;
  }

  /**
   * Converts a physical screen coordinate (from mouse/touch/stylus) to the Virtual Canvas space.
   */
  public screenToVirtual(screenX: number, screenY: number): { x: number; y: number } {
    const { scale, offsetX, offsetY } = this.graph.viewport;
    const s = scale > 0 ? scale : 1;
    return {
      x: (screenX - offsetX) / s,
      y: (screenY - offsetY) / s,
    };
  }

  /**
   * Converts a Virtual Canvas coordinate to physical screen pixels.
   */
  public virtualToScreen(virtualX: number, virtualY: number): { x: number; y: number } {
    const { scale, offsetX, offsetY } = this.graph.viewport;
    const s = scale && scale > 0 ? scale : 1;
    const ox = offsetX || 0;
    const oy = offsetY || 0;
    return {
      x: virtualX * s + ox,
      y: virtualY * s + oy,
    };
  }

  /**
   * Applies a state mutation to the scene graph and increments version.
   */
  public applyOperation(op: SceneGraphOperation): void {
    let changed = false;

    switch (op.type) {
      case "add_object":
        this.graph.objects.set(op.object.id, op.object);
        changed = true;
        break;

      case "update_object": {
        const existing = this.graph.objects.get(op.id);
        if (existing) {
          this.graph.objects.set(op.id, {
            ...existing,
            ...op.patch,
            version: existing.version + 1,
          });
          changed = true;
        }
        break;
      }

      case "remove_object":
        if (this.graph.objects.delete(op.id)) {
          changed = true;
        }
        break;

      case "clear":
        this.graph.objects.clear();
        this.graph.activeFocusId = undefined;
        changed = true;
        break;

      case "set_focus":
        this.graph.activeFocusId = op.id;
        changed = true;
        break;
    }

    if (changed) {
      this.graph.version += 1;
      this.graph.lastUpdated = Date.now();
      this.notifyListeners();
    }
  }

  /**
   * High-speed hit-testing against scene objects (runs in <1ms).
   * Finds the closest or enclosing semantic object for a given virtual point.
   */
  public hitTest(virtualPoint: { x: number; y: number }, maxDistance = 45): SemanticObject | null {
    let bestMatch: SemanticObject | null = null;
    let closestDist = Infinity;

    for (const obj of this.graph.objects.values()) {
      if (!obj.visible || !obj.bounds) continue;

      const { minX, maxX, minY, maxY, centerX, centerY } = obj.bounds;
      const inside =
        virtualPoint.x >= minX - 8 &&
        virtualPoint.x <= maxX + 8 &&
        virtualPoint.y >= minY - 8 &&
        virtualPoint.y <= maxY + 8;

      if (inside) {
        // Enclosing hit: prioritize inner components over huge parent groups
        const area = (maxX - minX) * (maxY - minY);
        if (!bestMatch || area < (bestMatch.bounds.width * bestMatch.bounds.height)) {
          bestMatch = obj;
          closestDist = 0;
        }
      } else if (closestDist > 0) {
        // Distance check
        const dist = Math.hypot(virtualPoint.x - centerX, virtualPoint.y - centerY);
        if (dist <= maxDistance && dist < closestDist) {
          closestDist = dist;
          bestMatch = obj;
        }
      }
    }

    return bestMatch;
  }

  public subscribe(listener: (graph: SceneGraph) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notifyListeners(): void {
    const snapshot = this.getSnapshot();
    this.listeners.forEach((listener) => {
      try {
        listener(snapshot);
      } catch (err) {
        console.error("[SceneGraphManager] Listener error:", err);
      }
    });
  }
}

// Global shared singleton for the active canvas session
export const sceneManager = new SceneGraphManager();
