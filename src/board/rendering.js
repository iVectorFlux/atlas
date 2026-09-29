  function fit() {
    const r = view.getBoundingClientRect(),
      d = devicePixelRatio || 1;
    screen.width = Math.round(r.width * d);
    screen.height = Math.round(r.height * d);
    animationLayer.width = screen.width;
    animationLayer.height = screen.height;
    inkLayer.width = screen.width;
    inkLayer.height = screen.height;
    interactionLayer.width = screen.width;
    interactionLayer.height = screen.height;
    state.animationFullRedraw = true;
    if (!state.viewInitialized && r.width > 0 && r.height > 0) {
      state.scale = 0.35;
      state.panX = (r.width - SIZE * state.scale) / 2;
      state.panY = (r.height - SIZE * state.scale) / 2;
      state.viewInitialized = true;
    }
    updateCoordinates();
    requestRender();
  }
  function renderInkLayer(region = null) {
    const d = devicePixelRatio || 1,
      r = view.getBoundingClientRect(),
      visible = region || {
        x:Math.max(0, -state.panX / state.scale),
        y:Math.max(0, -state.panY / state.scale),
        w:Math.min(SIZE, (r.width - state.panX) / state.scale) - Math.max(0, -state.panX / state.scale),
        h:Math.min(SIZE, (r.height - state.panY) / state.scale) - Math.max(0, -state.panY / state.scale),
      };
    inkCtx.setTransform(d, 0, 0, d, 0, 0);
    inkCtx.clearRect(0, 0, r.width, r.height);
    if (visible.w <= 0 || visible.h <= 0) return;
    inkCtx.save();
    inkCtx.translate(state.panX, state.panY);
    inkCtx.scale(state.scale, state.scale);
    inkCtx.beginPath();
    inkCtx.rect(0, 0, SIZE, SIZE);
    inkCtx.clip();
    forTiles(visible.x, visible.y, visible.w, visible.h, (canvas, tx, ty) => inkCtx.drawImage(canvas, tx * TILE, ty * TILE), false);
    drawSharpOverlays(inkCtx, visible);
    inkCtx.restore();
  }
  function updateCoordinates() {
    coords.textContent = `${Math.round(state.scale * 100)}%`;
  }
  function render() {
    const d = devicePixelRatio || 1,
      r = view.getBoundingClientRect();
    ctx.setTransform(d, 0, 0, d, 0, 0);
    ctx.clearRect(0, 0, r.width, r.height);
    ctx.fillStyle = state.paint.outside;
    ctx.fillRect(0, 0, r.width, r.height);
    ctx.save();
    ctx.translate(state.panX, state.panY);
    ctx.scale(state.scale, state.scale);
    ctx.fillStyle = state.paint.paper;
    ctx.fillRect(0, 0, SIZE, SIZE);
    const l = Math.max(0, -state.panX / state.scale),
      t = Math.max(0, -state.panY / state.scale),
      rr = Math.min(SIZE, (r.width - state.panX) / state.scale),
      b = Math.min(SIZE, (r.height - state.panY) / state.scale);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, SIZE, SIZE);
    ctx.clip();
    if (state.gridVisible) {
      ctx.strokeStyle = state.paint.paperGrid;
      ctx.lineWidth = 1 / state.scale;
      ctx.beginPath();
      for (let x = Math.floor(l / 500) * 500; x < rr; x += 500) {
        ctx.moveTo(x, t);
        ctx.lineTo(x, b);
      }
      for (let y = Math.floor(t / 500) * 500; y < b; y += 500) {
        ctx.moveTo(l, y);
        ctx.lineTo(rr, y);
      }
      ctx.stroke();
    }
    drawImagesToContext(ctx, { x:l, y:t, w:rr - l, h:b - t });
    drawTextBoxesToContext(ctx, { x:l, y:t, w:rr - l, h:b - t });
    ctx.restore();
    ctx.strokeStyle = state.paint.border;
    ctx.lineWidth = 2 / state.scale;
    ctx.strokeRect(0, 0, SIZE, SIZE);
    ctx.restore();
    renderInkLayer({ x:l, y:t, w:rr - l, h:b - t });
    renderInteractionLayer();
    positionWidgets();
    positionTextEditors();
    updateSelectionToolbar();
  }
  function drawSelectedAnimation(context) {
    const selected = pluginEnabled("animation") && animationEditChromeVisible() ? selectedAnimation() : null;
    if (!selected) return;
    const box = animationBox(selected),
      unit = 1 / state.scale,
      handle = 14 * unit;
    context.save();
    context.strokeStyle = "#2679b8";
    context.lineWidth = 2 * unit;
    context.setLineDash([7 * unit, 6 * unit]);
    context.strokeRect(box.x, box.y, box.w, box.h);
    context.setLineDash([]);
    context.beginPath();
    drawResizeHandle(context, box, handle);
    context.moveTo(box.x + box.w + handle * 0.08, box.y + box.h / 2 - handle * 0.48);
    context.lineTo(box.x + box.w + handle * 0.08, box.y + box.h / 2 + handle * 0.48);
    context.moveTo(box.x + box.w / 2 - handle * 0.48, box.y + box.h + handle * 0.08);
    context.lineTo(box.x + box.w / 2 + handle * 0.48, box.y + box.h + handle * 0.08);
    context.stroke();
    context.restore();
  }
  function drawHandModeOutlines(context) {
    if (state.mode !== "hand") return;
    const unit = 1 / state.scale,
      boxes = [
        ...visibleImages().map(imageBox),
        ...visibleAnimations().map(animationBox),
        ...visibleTextBoxes().map(textBoxBox),
        ...visibleWidgets().map(widgetBox),
      ];
    if (!boxes.length) return;
    context.save();
    context.globalAlpha = 0.42;
    context.strokeStyle = "#2679b8";
    context.lineWidth = unit;
    context.setLineDash([4 * unit, 5 * unit]);
    for (const box of boxes) context.strokeRect(box.x, box.y, box.w, box.h);
    context.restore();
  }
  function getCanvasOccupiedBoxes(excludeItem = null) {
    const boxes = [];
    if (typeof visibleWidgets === "function") {
      for (const w of visibleWidgets()) {
        if (w !== excludeItem && !w.hiddenForReplacement) {
          boxes.push(widgetBox(w));
        }
      }
    }
    if (typeof visibleImages === "function") {
      for (const img of visibleImages()) {
        if (img !== excludeItem) {
          boxes.push(imageBox(img));
        }
      }
    }
    if (typeof visibleTextBoxes === "function") {
      for (const tb of visibleTextBoxes()) {
        if (tb !== excludeItem) {
          boxes.push(textBoxBox(tb));
        }
      }
    }
    if (typeof visibleAnimations === "function") {
      for (const a of visibleAnimations()) {
        if (a !== excludeItem) {
          const box = animationBox(a);
          if (box) boxes.push(box);
        }
      }
    }
    if (Array.isArray(state.atlasDrawnBoxes)) {
      for (const b of state.atlasDrawnBoxes) {
        if (b && b !== excludeItem && Number.isFinite(b.x) && Number.isFinite(b.y)) {
          boxes.push({ x: b.x, y: b.y, w: b.w || 2000, h: b.h || 1200 });
        }
      }
    }
    if (state.pendingWidget && state.pendingWidget !== excludeItem) {
      boxes.push(widgetBox(state.pendingWidget));
    }
    if (state.pending && state.pending !== excludeItem) {
      const b = typeof draftBounds === "function" ? draftBounds(state.pending) : null;
      if (b) boxes.push({ x: b.x, y: b.y, w: b.w, h: b.h });
    }
    return boxes;
  }
  function findFreeCanvasPosition(prefX, prefY, w, h, gap = 400, excludeItem = null) {
    const occupied = getCanvasOccupiedBoxes(excludeItem);
    const maxCanvas = typeof SIZE === "number" ? SIZE : 20000;
    const minX = 50, minY = 50;
    const maxX = Math.max(minX, maxCanvas - w - 50);
    const maxY = Math.max(minY, maxCanvas - h - 50);

    const clamp = (x, y) => ({
      x: Math.max(minX, Math.min(maxX, Math.round(x))),
      y: Math.max(minY, Math.min(maxY, Math.round(y))),
    });

    const checkOverlap = (cand) => {
      for (const b of occupied) {
        if (
          cand.x < b.x + b.w + gap &&
          cand.x + cand.w + gap > b.x &&
          cand.y < b.y + b.h + gap &&
          cand.y + cand.h + gap > b.y
        ) {
          return b;
        }
      }
      return null;
    };

    const start = clamp(prefX, prefY);
    const initialCand = { x: start.x, y: start.y, w, h };

    if (!checkOverlap(initialCand)) {
      return { x: start.x, y: start.y };
    }

    const candidates = [];

    // Prefer below occupied content so portrait phones can scroll down to the result.
    for (const b of occupied) {
      const candY = b.y + b.h + gap;
      candidates.push(clamp(start.x, candY));
      candidates.push(clamp(b.x, candY));
    }

    if (!(view && view.clientHeight > view.clientWidth * 1.05)) {
      for (const b of occupied) {
        const candX = b.x + b.w + gap;
        candidates.push(clamp(candX, start.y));
        candidates.push(clamp(candX, b.y));
      }
    }

    // 3. Ring search around preferred position
    const step = Math.max(300, gap);
    for (let ring = 1; ring <= 15; ring++) {
      const r = ring * step;
      candidates.push(clamp(start.x, start.y + r));
      candidates.push(clamp(start.x + r, start.y));
      candidates.push(clamp(start.x + r, start.y + r));
      candidates.push(clamp(start.x - r, start.y));
      candidates.push(clamp(start.x, start.y - r));
      candidates.push(clamp(start.x - r, start.y + r));
      candidates.push(clamp(start.x + r, start.y - r));
    }

    candidates.sort((a, b) => Math.hypot(a.x - start.x, a.y - start.y) - Math.hypot(b.x - start.x, b.y - start.y));

    for (const pos of candidates) {
      if (!checkOverlap({ x: pos.x, y: pos.y, w, h })) {
        return { x: pos.x, y: pos.y };
      }
    }

    return { x: start.x, y: start.y };
  }
  function drawWidgetChrome(context) {
    if (!widgetRuntimeEnabled()) return;
    const widget = state.pendingWidget || (state.widgetEdit ? selectedWidget() : null);
    if (!widget) return;
    const box = widgetBox(widget),
      unit = 1 / state.scale,
      handle = 14 * unit;
    context.save();
    context.strokeStyle = widget.pending ? "#72b7e5" : "#2679b8";
    context.lineWidth = 2 * unit;
    context.setLineDash([7 * unit, 6 * unit]);
    context.strokeRect(box.x, box.y, box.w, box.h);
    context.setLineDash([]);
    context.beginPath();
    drawResizeHandle(context, box, handle);
    context.moveTo(box.x + box.w + handle * 0.08, box.y + box.h / 2 - handle * 0.48);
    context.lineTo(box.x + box.w + handle * 0.08, box.y + box.h / 2 + handle * 0.48);
    context.moveTo(box.x + box.w / 2 - handle * 0.48, box.y + box.h + handle * 0.08);
    context.lineTo(box.x + box.w / 2 + handle * 0.48, box.y + box.h + handle * 0.08);
    context.stroke();
    context.restore();
  }
  function positionImageEditBar() {
    const item = state.imageEdit ? selectedImage() : null;
    if (!item) {
      if (!imageEditBar.hidden) imageEditBar.hidden = true;
      return;
    }
    if (imageEditBar.hidden) imageEditBar.hidden = false;
    const rect = view.getBoundingClientRect(),
      box = imageBox(item),
      left = state.panX + box.x * state.scale,
      top = state.panY + box.y * state.scale,
      width = box.w * state.scale,
      height = box.h * state.scale,
      barWidth = imageEditBar.offsetWidth || 200,
      barHeight = imageEditBar.offsetHeight || 210,
      gap = 12,
      style = runtimeElementStyle(imageEditBar, "image-edit-bar");
    let x = left + width + gap;
    if (x + barWidth > rect.width - 8) x = left - barWidth - gap;
    if (x < 8) x = Math.max(8, Math.min(rect.width - barWidth - 8, left + width / 2 - barWidth / 2));
    const y = Math.max(8, Math.min(rect.height - barHeight - 8, top + height / 2 - barHeight / 2));
    style?.setProperty("--image-edit-bar-x", `${x.toFixed(1)}px`);
    style?.setProperty("--image-edit-bar-y", `${y.toFixed(1)}px`);
  }
  function drawImageChrome(context) {
    const item = state.imageEdit ? selectedImage() : null;
    if (!item) return;
    const box = imageBox(item),
      unit = 1 / state.scale,
      handle = 14 * unit;
    context.save();
    context.strokeStyle = "#2679b8";
    context.lineWidth = 2 * unit;
    context.setLineDash([7 * unit, 6 * unit]);
    context.strokeRect(box.x, box.y, box.w, box.h);
    context.setLineDash([]);
    context.beginPath();
    drawResizeHandle(context, box, handle);
    context.moveTo(box.x + box.w + handle * 0.08, box.y + box.h / 2 - handle * 0.48);
    context.lineTo(box.x + box.w + handle * 0.08, box.y + box.h / 2 + handle * 0.48);
    context.moveTo(box.x + box.w / 2 - handle * 0.48, box.y + box.h + handle * 0.08);
    context.lineTo(box.x + box.w / 2 + handle * 0.48, box.y + box.h + handle * 0.08);
    context.stroke();
    context.restore();
  }
  function pointDistanceToWidget(point, widget) {
    const box = widgetBox(widget),
      dx = point.x < box.x ? box.x - point.x : point.x > box.x + box.w ? point.x - box.x - box.w : 0,
      dy = point.y < box.y ? box.y - point.y : point.y > box.y + box.h ? point.y - box.y - box.h : 0;
    return Math.hypot(dx, dy);
  }
  function strokeWidgetProximity(widget, drawing) {
    if (!drawing || drawing.erase) return null;
    const points = [...drawing.trail];
    if (drawing.last && points.at(-1) !== drawing.last) points.push(drawing.last);
    if (!points.length) return null;
    let distance = Infinity,
      hits = 0;
    for (const point of points) {
      const next = pointDistanceToWidget(point, widget) * state.scale;
      distance = Math.min(distance, next);
      if (next <= 48) hits++;
    }
    return distance <= 48 ? { distance, hits } : null;
  }
  function clearWidgetRefineCandidate() {
    state.widgetRefineCandidate = null;
    requestInteractionLayerRender();
  }
  function dismissWidgetRefineCandidate() {
    clearWidgetRefineCandidate();
  }
  function latchWidgetRefineCandidate(drawing) {
    if (state.widgetRefineCandidate || state.mode === "hand" || state.pending || state.pendingWidget || state.pendingWidgetReplacement) return state.widgetRefineCandidate;
    const candidates = [];
    for (const widget of visibleWidgets()) {
      if (!widget.shell || widget.renderActive === false || widget.pending) continue;
      const dirty = strokeWidgetProximity(widget, drawing);
      if (!dirty) continue;
      candidates.push({
        widget,
        widgetId:widget.id,
        instructionMode:"nearby-dirty",
        distance:dirty.distance,
        hits:dirty.hits,
      });
    }
    candidates.sort((a, b) => a.distance - b.distance || b.hits - a.hits || state.widgets.indexOf(b.widget) - state.widgets.indexOf(a.widget));
    state.widgetRefineCandidate = candidates[0] || null;
    if (state.widgetRefineCandidate) requestInteractionLayerRender();
    return state.widgetRefineCandidate;
  }
  function currentWidgetRefineCandidate() {
    const candidate = state.widgetRefineCandidate;
    if (!candidate || state.mode === "hand") return null;
    if (!state.widgets.includes(candidate.widget) || candidate.widget.hiddenForReplacement || candidate.widget.pending || candidate.widget.renderActive === false) {
      state.widgetRefineCandidate = null;
      return null;
    }
    return candidate;
  }
  async function copyWidgetSource(widget) {
    if (!widget || typeof widget.copyText !== "string" || !widget.copyText) return false;
    const copied = await writeClipboardText(widget.copyText);
    setStatusKey(copied ? "widgetSourceCopied" : "widgetSourceCopyFailed");
    return copied;
  }
  function widgetEditContext(widget, instructionMode) {
    return {
      mode:"replace",
      widgetType:widget.widgetType,
      pluginId:widget.pluginId,
      title:widget.title,
      instructionMode,
      box:widgetBox(widget),
      ...(widget.diagramKind ? { diagramKind:widget.diagramKind } : {}),
      ...(widget.sourceFormat ? { sourceFormat:widget.sourceFormat } : {}),
      ...(widget.frameworkVersion ? { frameworkVersion:widget.frameworkVersion } : {}),
      ...(widget.widgetType === "diagram_source" ? { source:widget.source } : { html:widget.html }),
      ...(widget.widgetType !== "diagram_source" && widget.copyText ? { source:widget.copyText, copyLabel:widget.copyLabel } : {}),
    };
  }
  async function requestWidgetRefinement(widget, instructionMode) {
    if (!widget || state.mode === "hand" || !state.widgets.includes(widget) || widget.hiddenForReplacement || state.pendingWidget || state.pendingWidgetReplacement) return false;
    const revision = state.userRevision;
    clearWidgetRefineCandidate();
    supersedeActiveAI("widget-refine");
    setStatusKey("widgetRefining");
    try {
      await requestWidgetSnapshot(widget);
    } catch (error) {
      if (state.userRevision === revision) setStatus(`${t("aiError")}${error.message}`);
      return false;
    }
    if (state.userRevision !== revision || !state.widgets.includes(widget) || widget.hiddenForReplacement) return false;
    void requestAI("answer", null, {
      captureCurrentViewport:true,
      widgetEditTarget:widget,
      widgetEditContext:widgetEditContext(widget, instructionMode),
    });
    return true;
  }
  const OBJECT_CHROME_ICONS = Object.freeze({
    move:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 9V3M9 6l3-3 3 3M12 15v6M9 18l3 3 3-3M9 12H3M6 9l-3 3 3 3M15 12h6M18 9l3 3-3 3"/></svg>',
    accept:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.2 4.2L19 7"/></svg>',
    cancel:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    copy:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>',
    refine:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 1.3 4.2L17.5 8.5l-4.2 1.3L12 14l-1.3-4.2-4.2-1.3 4.2-1.3L12 3Z"/><path d="m18.5 14 .7 2.3 2.3.7-2.3.7-.7 2.3-.7-2.3-2.3-.7 2.3-.7.7-2.3Z"/></svg>',
    reply:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 6h14M12 6v14M8 20h8"/></svg>',
  });
  function screenObjectBox(box) {
    return {
      left:state.panX + box.x * state.scale,
      top:state.panY + box.y * state.scale,
      width:box.w * state.scale,
      height:box.h * state.scale,
    };
  }
  function widgetToolLabelWidth(label, minimum = 108) {
    return Math.max(minimum, Math.min(220, 44 + String(label || "").length * 7.2));
  }
  function addWidgetToolSpecs(specs, widget, options = {}) {
    if (!widget) return;
    const box = widgetBox(widget),
      items = [];
    if (options.copy && widget.copyText) items.push({
      key:`widget:${widget.id}:tool-copy`,
      kind:"copy",
      label:widget.copyLabel || (widget.sourceFormat ? `Copy ${widget.sourceFormat}` : t("copyText")),
      baseWidth:widgetToolLabelWidth(widget.copyLabel || `Copy ${widget.sourceFormat || "source"}`, 118),
      activate:() => void copyWidgetSource(widget),
    });
    if (options.refine) items.push({
      key:`widget:${widget.id}:tool-refine`,
      kind:"refine",
      label:t("widgetRefine"),
      baseWidth:112,
      activate:() => void requestWidgetRefinement(widget, options.refine.instructionMode),
    });
    if (!items.length) return;
    const gap = 4,
      groupBaseWidth = items.reduce((sum, item) => sum + item.baseWidth, 0) + gap * (items.length - 1),
      controlScale = 1,
      widgetToolGroup = `widget-${widget.id}`;
    let groupOffset = 0;
    for (const item of items) {
      specs.push({
        ...item,
        box,
        widget,
        widgetTool:true,
        widgetToolGroup,
        groupBaseWidth,
        groupOffset,
        controlScale,
        baseHeight:34,
        priority:6,
      });
      groupOffset += item.baseWidth + gap;
    }
  }
  function objectChromePosition(box, kind, ignoreKey = "", spec = null) {
    const baseWidth = spec?.baseWidth || (kind === "move" ? 34 : kind === "refine" ? 112 : 36),
      baseHeight = spec?.baseHeight || 34,
      controlScale = spec?.controlScale || 1,
      width = baseWidth * controlScale,
      height = baseHeight * controlScale,
      viewportWidth = view.clientWidth,
      viewportHeight = view.clientHeight,
      screenBox = screenObjectBox(box),
      right = screenBox.left + screenBox.width,
      bottom = screenBox.top + screenBox.height,
      chromeGap = 7;
    if (viewportWidth <= 0 || viewportHeight <= 0 || right < -8 || bottom < -8 || screenBox.left > viewportWidth + 8 || screenBox.top > viewportHeight + 8) return null;
    const clampX = (value) => Math.max(6, Math.min(Math.max(6, viewportWidth - width - 6), value)),
      clampY = (value) => Math.max(6, Math.min(Math.max(6, viewportHeight - height - 6), value)),
      above = screenBox.top - height - chromeGap,
      y = clampY(above >= 6 ? above : screenBox.top + chromeGap);
    if (spec?.widgetTool) {
      const groupWidth = spec.groupBaseWidth * controlScale,
        groupHeight = height,
        gap = chromeGap * controlScale,
        clampGroupX = (value) => Math.max(6, Math.min(Math.max(6, viewportWidth - groupWidth - 6), value)),
        clampGroupY = (value) => Math.max(6, Math.min(Math.max(6, viewportHeight - groupHeight - 6), value)),
        positions = [
          { x:right - groupWidth, y:screenBox.top - groupHeight - gap },
          { x:right + gap, y:screenBox.top },
          { x:right + gap, y:screenBox.top + screenBox.height / 2 - groupHeight / 2 },
          { x:right - groupWidth, y:bottom + gap },
          { x:screenBox.left, y:bottom + gap },
          { x:screenBox.left - groupWidth - gap, y:screenBox.top + screenBox.height / 2 - groupHeight / 2 },
        ].map(position => ({ x:clampGroupX(position.x), y:clampGroupY(position.y) })),
        viewRect = view.getBoundingClientRect(),
        obstacles = [...document.querySelectorAll(".top-row, .toolbar, .animation-controls:not([hidden]), .image-edit-bar:not([hidden]), .selection-context-toolbar, .text-editor, .ai-embodiment, .object-chrome-button")]
          .filter(element => element.dataset.objectChromeKey !== ignoreKey && element.dataset.widgetToolGroup !== spec.widgetToolGroup)
          .map(element => {
          const rect = element.getBoundingClientRect();
          return { x:rect.left - viewRect.left, y:rect.top - viewRect.top, w:rect.width, h:rect.height };
        }),
        overlapsObstacle = position => obstacles.some(obstacle => position.x < obstacle.x + obstacle.w + 5 && position.x + groupWidth + 5 > obstacle.x && position.y < obstacle.y + obstacle.h + 5 && position.y + groupHeight + 5 > obstacle.y),
        groupPosition = positions.find(position => !overlapsObstacle(position)) || positions[0];
      return {
        x:groupPosition.x + spec.groupOffset * controlScale,
        y:groupPosition.y,
        scale:controlScale,
        baseWidth,
        baseHeight,
      };
    }
    let x;
    if (kind === "move") x = clampX(screenBox.left + screenBox.width / 2 - width / 2);
    else if (kind === "cancel") x = clampX(screenBox.left - width - 7);
    else if (kind === "accept") x = clampX(right + 7);
    else x = clampX(screenBox.left + screenBox.width / 2 + 38);
    return { x, y, scale:1, baseWidth, baseHeight };
  }
  function objectChromeLabel(kind, spec = null) {
    if (spec?.label) return spec.label;
    if (kind === "accept") return t("widgetAccept");
    if (kind === "cancel") return t("cancel");
    if (kind === "copy") return t("copyText");
    if (kind === "refine") return t("widgetRefine");
    if (kind === "reply") return t("boardReply");
    return t("hand");
  }
  function beginObjectChromeMove(event, spec) {
    if (state.mode !== "hand" || Number(event.button) !== 0) return false;
    const point = clientPoint(event);
    let started = false;
    if (spec.target === "pending") {
      beginPendingGesture(event, "move", spec.itemIndex);
      started = true;
    } else if (spec.target === "pending-widget") {
      started = beginWidgetGesture(event, point, { widget:spec.object, hit:"move", pending:true });
    } else if (spec.target === "widget") {
      started = beginWidgetGesture(event, point, { widget:spec.object, hit:"move", pending:false });
    } else if (spec.target === "image") {
      started = beginImageGesture(event, point, { image:spec.object, hit:"move" });
    } else if (spec.target === "animation") {
      started = beginAnimationGesture(event, point, { animation:spec.object, hit:"move" });
    }
    if (!started) return false;
    try { objectChromeLayer.setPointerCapture(event.pointerId); } catch {}
    return true;
  }
  function finishObjectChromeGesture(event) {
    if (state.pendingGesture?.id === event.pointerId && !state.pendingGesture.copy) {
      state.pendingGesture = null;
      resetCanvasCursor();
      requestRender();
      return true;
    }
    if (state.widgetGesture?.id === event.pointerId) return finishWidgetGesture(event);
    if (state.imageGesture?.id === event.pointerId) return finishImageGesture(event);
    if (state.animationGesture?.id === event.pointerId) return finishAnimationGesture(event);
    return false;
  }
  function createObjectChromeButton(key, kind) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `object-chrome-button ${kind}`;
    button.dataset.objectChromeKey = key;
    button.innerHTML = ["copy", "refine", "reply"].includes(kind) ? `${OBJECT_CHROME_ICONS[kind]}<span></span>` : OBJECT_CHROME_ICONS[kind];
    ensureObjectChromeStyleRule(button);
    button.addEventListener("pointerdown", (event) => {
      event.stopPropagation();
      if (kind !== "move") return;
      event.preventDefault();
      beginObjectChromeMove(event, button.lumi6Spec);
    });
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (kind !== "move") button.lumi6Spec?.activate?.();
    });
    objectChromeLayer.append(button);
    objectChromeButtons.set(key, button);
    return button;
  }
  function ensureObjectChromeStyleRule(button) {
    if (!button || button.lumi6StyleRule) return button?.lumi6StyleRule || null;
    const sheet = textEditorStyleSheet(),
      className = button.lumi6StyleClass || `object-chrome-position-${nextObjectChromeStyleId++}`;
    button.lumi6StyleClass = className;
    button.classList.add(className);
    if (!sheet) return null;
    try {
      sheet.insertRule(`.${className} { --object-control-x: 0px; --object-control-y: 0px; z-index: 1; }`, sheet.cssRules.length);
      button.lumi6StyleRule = [...sheet.cssRules].find((rule) => rule.selectorText === `.${className}`) || null;
    } catch {
      button.lumi6StyleRule = null;
    }
    return button.lumi6StyleRule;
  }
  function removeObjectChromeStyleRule(button) {
    const rule = button?.lumi6StyleRule,
      sheet = textEditorStyleSheet();
    if (!rule || !sheet) return;
    const index = [...sheet.cssRules].indexOf(rule);
    if (index >= 0) {
      try { sheet.deleteRule(index); } catch {}
    }
    button.lumi6StyleRule = null;
  }
  function pendingChromeSpecs(specs, pending) {
    if (!pending) return;
    const add = (key, box, itemIndex = null, target = pending) => {
      specs.push({ key:`${key}:move`, kind:"move", box, target:"pending", itemIndex, object:target, priority:4 });
      specs.push({ key:`${key}:cancel`, kind:"cancel", box, activate:() => itemIndex === null ? rejectPending() : rejectPendingItem(itemIndex), priority:5 });
      specs.push({ key:`${key}:accept`, kind:"accept", box, activate:() => itemIndex === null ? acceptPending() : acceptPendingItem(itemIndex), priority:5 });
      if (pendingCopyable(target)) specs.push({ key:`${key}:copy`, kind:"copy", box, activate:() => void copyPendingText(itemIndex), priority:5 });
      if (target?.textCommand || pendingCopyable(target)) specs.push({
        key:`${key}:reply`,
        kind:"reply",
        box,
        label: t("boardReply"),
        widgetTool: true,
        widgetToolGroup: `${key}-reply`,
        groupBaseWidth: widgetToolLabelWidth(t("boardReply"), 86),
        groupOffset: 0,
        baseWidth: widgetToolLabelWidth(t("boardReply"), 86),
        baseHeight: 34,
        activate: () => openBoardReplyFromPending(itemIndex),
        priority: 7,
      });
    };
    if (pending.items) pending.items.forEach((item, index) => add(`pending-item:${index}`, pendingItemBounds(item), index, item));
    else add("pending", draftBounds(pending));
  }
  function objectChromeSpecs() {
    const specs = [];
    pendingChromeSpecs(specs, state.pending);
    if (state.mode !== "hand") {
      const candidate = currentWidgetRefineCandidate();
      if (candidate) addWidgetToolSpecs(specs, candidate.widget, { refine:candidate });
      return specs;
    }
    for (const image of visibleImages()) specs.push({ key:`image:${image.id}:move`, kind:"move", box:imageBox(image), target:"image", object:image, priority:1 });
    for (const animation of visibleAnimations()) specs.push({ key:`animation:${animation.id}:move`, kind:"move", box:animationBox(animation), target:"animation", object:animation, priority:1 });
    for (const widget of visibleWidgets()) specs.push({ key:`widget:${widget.id}:move`, kind:"move", box:widgetBox(widget), target:"widget", object:widget, priority:2 });
    if (state.animationEdit) {
      const animation = selectedAnimation();
      if (animation) {
        const box = animationBox(animation);
        specs.push({ key:`animation:${animation.id}:cancel`, kind:"cancel", box, activate:cancelAnimationEdit, priority:3 });
        specs.push({ key:`animation:${animation.id}:accept`, kind:"accept", box, activate:acceptAnimationEdit, priority:3 });
      }
    }
    if (state.widgetEdit) {
      const widget = selectedWidget();
      if (widget) {
        const box = widgetBox(widget);
        specs.push({ key:`widget:${widget.id}:cancel`, kind:"cancel", box, activate:() => deleteWidget(widget), priority:3 });
        specs.push({ key:`widget:${widget.id}:accept`, kind:"accept", box, activate:acceptWidgetEdit, priority:3 });
        addWidgetToolSpecs(specs, widget, { copy:true });
      }
    }
    if (state.pendingWidget) {
      const widget = state.pendingWidget,
        box = widgetBox(widget);
      specs.push({ key:`pending-widget:${widget.id}:move`, kind:"move", box, target:"pending-widget", object:widget, priority:4 });
      specs.push({ key:`pending-widget:${widget.id}:cancel`, kind:"cancel", box, activate:rejectPendingWidget, priority:5 });
      specs.push({ key:`pending-widget:${widget.id}:accept`, kind:"accept", box, activate:acceptPendingWidget, priority:5 });
      addWidgetToolSpecs(specs, widget, { copy:true });
    }
    return specs;
  }
  function syncObjectChrome() {
    if (!objectChromeLayer) return;
    const active = new Set();
    for (const spec of objectChromeSpecs()) {
      const button = objectChromeButtons.get(spec.key) || createObjectChromeButton(spec.key, spec.kind),
        position = objectChromePosition(spec.box, spec.kind, spec.key, spec);
      if (!position) continue;
      active.add(spec.key);
      const label = objectChromeLabel(spec.kind, spec),
        declaration = (button.lumi6StyleRule || ensureObjectChromeStyleRule(button))?.["style"];
      button.lumi6Spec = spec;
      button.classList.toggle("widget-tool", Boolean(spec.widgetTool));
      button.classList.toggle("solo-widget-tool", Boolean(spec.widgetTool && spec.groupBaseWidth === spec.baseWidth));
      if (spec.widgetToolGroup) button.dataset.widgetToolGroup = spec.widgetToolGroup;
      else delete button.dataset.widgetToolGroup;
      button.setAttribute("aria-label", label);
      button.title = spec.kind === "refine" ? t("widgetRefineHint") : label;
      if (["copy", "refine", "reply"].includes(spec.kind)) button.querySelector("span").textContent = label;
      declaration?.setProperty("--object-control-x", `${position.x.toFixed(1)}px`);
      declaration?.setProperty("--object-control-y", `${position.y.toFixed(1)}px`);
      declaration?.setProperty("--object-control-scale", String(position.scale || 1));
      declaration?.setProperty("--object-control-width", `${position.baseWidth}px`);
      declaration?.setProperty("--object-control-height", `${position.baseHeight}px`);
      declaration?.setProperty("z-index", String(spec.priority || 1));
    }
    for (const [key, button] of objectChromeButtons) {
      if (active.has(key)) continue;
      removeObjectChromeStyleRule(button);
      button.remove();
      objectChromeButtons.delete(key);
    }
  }
  objectChromeLayer?.addEventListener("pointermove", (event) => {
    if (state.pendingGesture?.id === event.pointerId) updatePendingGesture(event);
    else if (state.widgetGesture?.id === event.pointerId) updateWidgetGesture(event);
    else if (state.imageGesture?.id === event.pointerId) updateImageGesture(event);
    else if (state.animationGesture?.id === event.pointerId) updateAnimationGesture(event);
  });
  objectChromeLayer?.addEventListener("pointerup", finishObjectChromeGesture);
  objectChromeLayer?.addEventListener("pointercancel", finishObjectChromeGesture);
  function drawPointerPreview(context) {
    const preview = state.pointerPreview;
    if (!preview || state.mode !== "eraser" || !valid(preview)) return;
    const radius = logicalWidth(state.eraser) / 2,
      unit = 1 / state.scale;
    context.save();
    context.strokeStyle = `${state.inkColor}cc`;
    context.lineWidth = 1.2 * unit;
    context.setLineDash([3.5 * unit, 3 * unit]);
    context.beginPath();
    context.arc(preview.x, preview.y, radius, 0, Math.PI * 2);
    context.stroke();
    context.restore();
  }
  function renderInteractionLayer() {
    const d = devicePixelRatio || 1,
      r = view.getBoundingClientRect();
    interactionCtx.setTransform(d, 0, 0, d, 0, 0);
    interactionCtx.clearRect(0, 0, r.width, r.height);
    interactionCtx.save();
    interactionCtx.translate(state.panX, state.panY);
    interactionCtx.scale(state.scale, state.scale);
    interactionCtx.beginPath();
    interactionCtx.rect(0, 0, SIZE, SIZE);
    interactionCtx.clip();
    if (state.drawing?.preview) drawPreview(state.drawing.preview, interactionCtx);
    if (typeof window.__drawSketchShapePreview === "function") window.__drawSketchShapePreview(interactionCtx);
    drawPointerPreview(interactionCtx);
    if (state.selection) drawSelection(state.selection, interactionCtx);
    drawHandModeOutlines(interactionCtx);
    drawSelectedAnimation(interactionCtx);
    if (state.pending) {
      interactionCtx.save();
      interactionCtx.globalAlpha = 1 - (state.pending.fadeProgress || 0);
      drawPending(state.pending, interactionCtx);
      interactionCtx.restore();
    }
    drawWidgetChrome(interactionCtx);
    drawImageChrome(interactionCtx);
    interactionCtx.restore();
    positionAnimationControls();
    positionImageEditBar();
    syncObjectChrome();
  }
  function clientPoint(e) {
    const r = view.getBoundingClientRect();
    return {
      x: (e.clientX - r.left - state.panX) / state.scale,
      y: (e.clientY - r.top - state.panY) / state.scale,
    };
  }
  function blockCanvasInput(duration = 1000) {
    state.textInputBlockedUntil = Math.max(state.textInputBlockedUntil, Date.now() + duration);
    resetCanvasCursor();
  }
  function mergeDirtyBox(box) {
    if (!box) return;
    if (!state.dirty) {
      state.dirty = { ...box };
      return;
    }
    const right = Math.max(state.dirty.x + state.dirty.w, box.x + box.w),
      bottom = Math.max(state.dirty.y + state.dirty.h, box.y + box.h);
    state.dirty = {
      x: Math.min(state.dirty.x, box.x),
      y: Math.min(state.dirty.y, box.y),
      w: right - Math.min(state.dirty.x, box.x),
      h: bottom - Math.min(state.dirty.y, box.y),
    };
  }
