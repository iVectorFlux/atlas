"use client";

import React, { useState } from "react";
import { 
  ArrowRight,
  Circle, 
  Eraser, 
  MousePointer2, 
  Slash, 
  Square, 
  Star, 
  Type
} from "lucide-react";
import "./CanvasToolbar.css";

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const hold = (e: React.PointerEvent) => e.stopPropagation();

// Scribble Pencil Icon matching ChatGPT's canvas freehand draw icon
const ScribblePencil = ({ size = 17, strokeWidth = 2, ...props }: any) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={strokeWidth}
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    <path d="M17.5 2.5a2.121 2.121 0 0 1 3 3L7.5 18.5 3 20l1.5-4.5L16 4z" />
    <path d="m14.5 4.5 3 3" />
    <path d="M3 21.5c2.5-1.5 5-1.5 7.5 0s5 1.5 7.5 0" />
  </svg>
);

// Clean Modern Whiteboard Eraser Icon (universally recognized, crisp, clean)
const ModernEraserIcon = ({ size = 18, strokeWidth = 2, ...props }: any) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={strokeWidth}
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    <path d="m18 13-5 5-8-8 5-5a2.828 2.828 0 0 1 4 0l4 4a2.828 2.828 0 0 1 0 4z" />
    <path d="M3 21h18" />
    <path d="m9 14 5-5" />
  </svg>
);

export const SHAPES = [
  { key: "rect", Icon: Square, label: "Rectangle" },
  { key: "oval", Icon: Circle, label: "Circle" },
  { key: "line", Icon: Slash, label: "Line" },
  { key: "arrow", Icon: ArrowRight, label: "Arrow" },
  { key: "star", Icon: Star, label: "Star" },
];

export const STROKE_SIZES = [
  { width: 2, label: "Thin" },
  { width: 4, label: "Medium" },
  { width: 8, label: "Bold" },
  { width: 14, label: "Thick" },
];

export const DARK_COLOR_PRESETS = [
  { name: "White", hex: "#EDEDED" },
  { name: "Light Gray", hex: "#A1A1AA" },
  { name: "Zinc", hex: "#71717A" },
];

export const LIGHT_COLOR_PRESETS = [
  { name: "Charcoal", hex: "#18181B" },
  { name: "Slate", hex: "#52525B" },
  { name: "Muted", hex: "#A1A1AA" },
];

const BAR_CORNER = 15;
const BAR_MAX = 25;

interface CanvasToolbarProps {
  corner?: number;
  tool: string;
  onToolChange: (tool: string) => void;
  activeColor?: string;
  onColorChange?: (color: string) => void;
  strokeWidth?: number;
  onWidthChange?: (width: number) => void;
  theme?: "dark" | "light";
}

export function CanvasToolbar({
  corner = BAR_CORNER,
  tool,
  onToolChange,
  activeColor,
  onColorChange,
  strokeWidth = 4,
  onWidthChange,
  theme = "dark",
}: CanvasToolbarProps) {
  const presets = theme === "light" ? LIGHT_COLOR_PRESETS : DARK_COLOR_PRESETS;
  const currentColor = activeColor || (theme === "light" ? "#18181B" : "#EDEDED");
  const [shape, setShape] = useState(SHAPES[0]);
  const [shapeOpen, setShapeOpen] = useState(false);
  const [sizeOpen, setSizeOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  const pickShape = (s: (typeof SHAPES)[number]) => {
    setShape(s);
    onToolChange("shape:" + s.key);
    setShapeOpen(false);
  };

  const isShapeActive = tool.startsWith("shape");

  const closeAllFlyouts = () => {
    setShapeOpen(false);
    setSizeOpen(false);
    setPaletteOpen(false);
  };

  const Btn = ({ k, Icon, label }: { k: string; Icon: any; label?: string }) => (
    <button
      className="bar-tool"
      data-on={tool === k}
      onClick={() => {
        onToolChange(k);
        closeAllFlyouts();
      }}
      onPointerDown={hold}
      aria-label={label || k}
      title={label || k}
    >
      <Icon size={17} strokeWidth={2} />
    </button>
  );

  return (
    <div
      className="canvas-toolbar-container"
      data-theme={theme}
      style={{
        "--bar-r": `${clamp(corner, 0, BAR_MAX)}px`,
        "--bar-tool-r": `${Math.max(0, clamp(corner, 0, BAR_MAX) - 4)}px`,
      } as React.CSSProperties}
    >
      <div className="bar-well">
        {/* Shape flyout */}
        {shapeOpen && (
          <div className="bar-flyout gpane" onPointerDown={hold}>
            {SHAPES.map((s) => (
              <button
                key={s.key}
                className="bar-tool"
                data-on={shape.key === s.key && isShapeActive}
                onClick={() => pickShape(s)}
                onPointerDown={hold}
                aria-label={s.key}
                title={s.label}
              >
                <s.Icon size={17} strokeWidth={2} />
              </button>
            ))}
          </div>
        )}

        {/* Size flyout */}
        {sizeOpen && (
          <div className="bar-size-flyout gpane" onPointerDown={hold}>
            {STROKE_SIZES.map((sz) => (
              <button
                key={sz.width}
                type="button"
                className="bar-size-btn"
                data-selected={strokeWidth === sz.width}
                onClick={() => {
                  onWidthChange?.(sz.width);
                  setSizeOpen(false);
                }}
                onPointerDown={hold}
                title={`${sz.label} (${sz.width}px)`}
              >
                <span
                  className="rounded-full bg-current block"
                  style={{ width: Math.max(3, sz.width), height: Math.max(3, sz.width) }}
                />
                <span>{sz.width}px</span>
              </button>
            ))}
          </div>
        )}

        {/* Color Palette flyout */}
        {paletteOpen && (
          <div className="bar-palette-flyout gpane" onPointerDown={hold}>
            {presets.map((c) => (
              <button
                key={c.hex}
                type="button"
                className="bar-palette-swatch"
                data-selected={currentColor.toLowerCase() === c.hex.toLowerCase()}
                style={{ backgroundColor: c.hex, color: c.hex }}
                onClick={() => {
                  onColorChange?.(c.hex);
                  setPaletteOpen(false);
                }}
                onPointerDown={hold}
                title={c.name}
              />
            ))}
          </div>
        )}

        {/* Main Rail */}
        <div className="bar-rail gpane">
          {/* Scribble Pencil (First!) */}
          <Btn k="pen" Icon={ScribblePencil} label="Pencil" />

          {/* Pointer / Select & Move */}
          <Btn k="move" Icon={MousePointer2} label="Select" />

          {/* Shape slot with easy click & notch */}
          <span className="bar-slot" data-on={isShapeActive}>
            <button
              className="bar-tool"
              data-on={isShapeActive}
              onClick={() => {
                if (isShapeActive) {
                  setShapeOpen((o) => !o);
                } else {
                  onToolChange("shape:" + shape.key);
                }
                setSizeOpen(false);
                setPaletteOpen(false);
              }}
              onPointerDown={hold}
              aria-label={shape.key}
              title={`${shape.label} (Click to open shapes)`}
            >
              <shape.Icon size={17} strokeWidth={2} />
            </button>
            <button
              className="bar-notch"
              data-open={shapeOpen}
              onClick={() => {
                setShapeOpen((o) => !o);
                setSizeOpen(false);
                setPaletteOpen(false);
              }}
              onPointerDown={hold}
              aria-label="More shapes"
              title="More shapes"
            />
          </span>

          {/* Text Tool */}
          <Btn k="text" Icon={Type} label="Text" />

          <span className="bar-split" />

          {/* Eraser Tool */}
          <Btn k="eraser" Icon={ModernEraserIcon} label="Eraser" />

          <span className="bar-split" />

          {/* Stroke Size Selector */}
          <button
            className="bar-tool"
            data-on={sizeOpen}
            onClick={() => {
              setSizeOpen((o) => !o);
              setShapeOpen(false);
              setPaletteOpen(false);
            }}
            onPointerDown={hold}
            aria-label="Stroke width"
            title={`Stroke Width: ${strokeWidth}px (Click to change)`}
          >
            <span
              className="rounded-full bg-current block transition-all"
              style={{
                width: Math.min(14, Math.max(4, strokeWidth)),
                height: Math.min(14, Math.max(4, strokeWidth)),
              }}
            />
          </button>

          {/* Active Ink Well dot */}
          <button
            className="bar-tool"
            data-on={paletteOpen}
            onClick={() => {
              setPaletteOpen((o) => !o);
              setShapeOpen(false);
              setSizeOpen(false);
            }}
            onPointerDown={hold}
            aria-label="Ink color"
            title="Ink color"
          >
            <span
              className="bar-color-dot"
              style={{ backgroundColor: currentColor, color: currentColor }}
            />
          </button>
        </div>
      </div>
    </div>
  );
}
