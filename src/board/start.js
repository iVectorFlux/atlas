// Pointer and control bindings, portable snapshots, and application startup.
  function updateCanvasPointerPreview(event) {
    const drawing = state.drawing,
      next = state.mode === "eraser"
        && event.pointerType !== "touch"
        && drawing?.erase
        && drawing.id === event.pointerId
        ? clientPoint(event)
        : null,
      preview = next && valid(next) ? next : null,
      changed = Boolean(preview) !== Boolean(state.pointerPreview)
        || preview && (!state.pointerPreview || Math.abs(preview.x - state.pointerPreview.x) > 0.01 || Math.abs(preview.y - state.pointerPreview.y) > 0.01);
    if (!changed) return;
    state.pointerPreview = preview;
    requestInteractionLayerRender();
  }
  function beginCanvasPointerAction(e, point) {
    if (state.selectedAnimationId) acceptAnimationEdit();
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (state.mode === "hand") {
      const textBox = valid(point) ? textBoxAtPoint(point) : null;
      if (textBox && editTextBox(textBox)) return;
      state.panGesture = {
        id: e.pointerId,
        last: { x: e.clientX, y: e.clientY },
      };
      setCanvasCursor("grabbing");
      setNavigating(true);
      return;
    }
    if (state.mode === "text" && e.pointerType === "touch") {
      if (!valid(point)) {
        setStatusKey("outsideCanvas");
        return;
      }
      state.textTap = { id: e.pointerId, startX: e.clientX, startY: e.clientY, point };
      return;
    }
    if (state.mode === "text") {
      if (!valid(point)) {
        setStatusKey("outsideCanvas");
        return;
      }
      createTextEditor(point);
      return;
    }
    if (state.mode === "shape") {
      if (!valid(point)) {
        setStatusKey("outsideCanvas");
        return;
      }
      state.shapeGesture = { id: e.pointerId, start: point, end: point };
      requestInteractionLayerRender();
      return;
    }
    if (state.mode === "select") {
      if (!valid(point)) {
        setStatusKey("outsideCanvas");
        return;
      }
      deselectAnimation();
      handleSelectionPointerDown(e, point);
      return;
    }
    const p = point;
    if (!valid(p)) {
      setStatusKey("outsideCanvas");
      return;
    }
    supersedeActiveAI("user-input-started");
    clearTimeout(state.timer);
    state.timer = 0;
    state.latestTypedInput = null;
    const erasing = state.mode === "eraser";
    if (erasing) invalidateRecognition();
    const cssSize = erasing ? state.eraser : pressureWidth(e),
      size = logicalWidth(cssSize);
    state.userRevision++;
    state.drawing = {
      id: e.pointerId,
      last: p,
      size,
      start: p,
      points: 1,
      screenDistance: 0,
      widthMin: cssSize,
      widthMax: cssSize,
      bbox: { x: p.x, y: p.y, w: 0, h: 0 },
      trail: [p],
      erase: erasing,
    };
    updateCanvasPointerPreview(e);
    dot(p, erasing, size, !erasing);
    requestRender();
  }
  screen.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    if (Date.now() < state.textInputBlockedUntil) return;
    try {
      screen.setPointerCapture(e.pointerId);
    } catch {}
    calibrateScreenClientRatio(e, false);
    state.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (e.pointerType === "touch") {
      state.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (state.touches.size >= 2) {
        state.textTap = null;
        if (state.pendingGesture) state.pendingGesture = null;
        if (state.widgetGesture) finishWidgetGesture({ pointerId:state.widgetGesture.id });
        if (state.selectedWidgetId) acceptWidgetEdit();
        if (state.imageGesture) finishImageGesture({ pointerId:state.imageGesture.id });
        if (state.animationGesture) finishAnimationGesture({ pointerId: state.animationGesture.id });
        if (state.selectedAnimationId) acceptAnimationEdit();
        finishDrawing("pen");
        beginTouchGesture();
        return;
      }
    }
    if (isMousePan(e)) {
      if (state.selectedWidgetId) acceptWidgetEdit();
      if (state.selectedAnimationId) acceptAnimationEdit();
      state.panGesture = {
        id: e.pointerId,
        last: { x: e.clientX, y: e.clientY },
      };
      setCanvasCursor("grabbing");
      setNavigating(true);
      return;
    }
    const downPoint = clientPoint(e);
    if (handlePendingPointerDown(e, downPoint)) return;
    if (state.mode !== "hand") {
      beginCanvasPointerAction(e, clientPoint(e));
      return;
    }
    const point = clientPoint(e);
    const widgetResult = widgetRuntimeEnabled() && valid(point) ? widgetPointerHit(point, e.pointerType, false) : null;
    if (widgetResult && ["resize", "width", "height"].includes(widgetResult.hit)) {
      beginWidgetGesture(e, point, widgetResult);
      return;
    }
    if (state.selectedWidgetId) acceptWidgetEdit();
    const selectedImageResult = valid(point) ? imagePointerHit(point, e.pointerType, false) : null;
    if (selectedImageResult && selectedImageResult.hit !== "move") {
      if (state.selectedAnimationId) acceptAnimationEdit();
      beginImageGesture(e, point, selectedImageResult);
      return;
    }
    if (valid(point)) {
      const animationResult = animationPointerHit(point, e.pointerType);
      if (animationResult && animationResult.hit !== "move") {
        beginAnimationGesture(e, point, animationResult);
        return;
      }
    }
    beginCanvasPointerAction(e, point);
  });
  function pendingActionName(hit) {
    return String(hit || "").replace(/^item-/, "");
  }
  function handlePendingPointerDown(event, point) {
    if (!state.pending) return false;
    const result = pendingHit(state.pending, event, state.pending.revealProgress < 1);
    if (!result) return false;
    const hit = typeof result === "string" ? result : result.hit,
      itemIndex = result && typeof result === "object" ? result.itemIndex : null,
      action = pendingActionName(hit);
    if (action === "accept") {
      if (itemIndex == null) acceptPending();
      else acceptPendingItem(itemIndex);
      return true;
    }
    if (action === "cancel") {
      if (itemIndex == null) rejectPending();
      else rejectPendingItem(itemIndex);
      return true;
    }
    if (action === "copy") return armPendingCopy(event, hit, itemIndex);
    if (action === "reply") return openBoardReplyFromPending(itemIndex);
    if (state.mode === "select" && (hit === "move" || hit === "batch-move")) {
      const box = itemIndex == null
        ? draftBounds(state.pending)
        : pendingItemBounds(state.pending.items[itemIndex]);
      if (itemIndex == null) acceptPending({ restoreMode: false });
      else acceptPendingItem(itemIndex);
      if (box) captureBoxSelection(box, { quiet: true, allowSmall: true });
      const next = state.selection;
      if (next?.phase === "active") beginSelectionTransform(event, "move");
      return true;
    }
    if (["resize", "width", "height", "batch-resize", "move", "batch-move"].includes(hit)) {
      beginPendingGesture(event, hit, itemIndex);
      return true;
    }
    return false;
  }
  screen.addEventListener("pointermove", (e) => {
    e.preventDefault();
    const old = state.pointers.get(e.pointerId);
    calibrateScreenClientRatio(e, true);
    state.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (e.pointerType === "touch") state.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    updateCanvasPointerPreview(e);
    if (state.pendingGesture?.id === e.pointerId) {
      updatePendingGesture(e);
      return;
    }
    if (state.widgetGesture?.id === e.pointerId) {
      updateWidgetGesture(e);
      return;
    }
    if (state.imageGesture?.id === e.pointerId) {
      updateImageGesture(e);
      return;
    }
    if (state.animationGesture?.id === e.pointerId) {
      updateAnimationGesture(e);
      return;
    }
    if (state.shapeGesture?.id === e.pointerId) {
      const p = clientPoint(e);
      if (valid(p)) state.shapeGesture.end = p;
      requestInteractionLayerRender();
      return;
    }
    if (state.selectionGesture?.id === e.pointerId) {
      updateSelectionGesture(e);
      coords.textContent = `${Math.round(state.scale * 100)}%`;
      return;
    }
    if (state.textTap?.id === e.pointerId) {
      const tap = state.textTap,
        distance = Math.hypot(e.clientX - tap.startX, e.clientY - tap.startY);
      if (distance > 8) {
        state.textTap = null;
        state.panGesture = { id: e.pointerId, last: { x: e.clientX, y: e.clientY } };
        setNavigating(true);
      } else return;
    }
    if (e.pointerType === "touch") {
      if (state.touches.size >= 2) {
        updateTouchGesture();
        return;
      }
      if (state.panGesture?.id === e.pointerId && old) {
        moveCanvas(e.clientX - old.x, e.clientY - old.y);
        state.panGesture.last = { x: e.clientX, y: e.clientY };
        setNavigating(true);
        return;
      }
    }
    if (state.panGesture?.id === e.pointerId) {
      if (old) {
        moveCanvas(e.clientX - old.x, e.clientY - old.y);
        setNavigating(true);
      }
      return;
    }
    if (!state.drawing || state.drawing.id !== e.pointerId) return;
    const p = clientPoint(e),
      a = state.drawing.last,
      d = state.drawing,
      cssSize = d.erase ? state.eraser : pressureWidth(e),
      size = logicalWidth(cssSize);
    state.userRevision++;
    stroke(a, p, d.erase, size, !d.erase);
    d.last = p;
    d.size = size;
    d.points++;
    d.screenDistance += old ? Math.hypot(e.clientX - old.x, e.clientY - old.y) : 0;
    if (d.points % 8 === 0) d.trail.push(p);
    d.widthMin = Math.min(d.widthMin, cssSize);
    d.widthMax = Math.max(d.widthMax, cssSize);
    const x1 = Math.min(d.bbox.x, p.x),
      y1 = Math.min(d.bbox.y, p.y),
      x2 = Math.max(d.bbox.x + d.bbox.w, p.x),
      y2 = Math.max(d.bbox.y + d.bbox.h, p.y);
    d.bbox = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
    requestRender();
    coords.textContent = `${Math.round(state.scale * 100)}%`;
  });
  function end(e) {
    state.pointers.delete(e.pointerId);
    if (e.pointerType === "touch") state.touches.delete(e.pointerId);
    if (state.widgetGesture?.id === e.pointerId) {
      finishWidgetGesture(e);
      return;
    }
    if (state.imageGesture?.id === e.pointerId) {
      finishImageGesture(e);
      return;
    }
    if (state.pendingGesture?.id === e.pointerId) {
      if (!finishPendingCopy(e)) {
        if (state.pendingGesture.armed) resetCanvasCursor();
        state.pendingGesture = null;
      }
      if (e.pointerType === "touch") {
        state.touchGesture = null;
        if (state.touches.size === 1) {
          const [id, p] = state.touches.entries().next().value;
          state.panGesture = { id, last: p };
        } else state.panGesture = null;
        if (!state.touches.size) setNavigating(false);
      }
      return;
    }
    if (state.animationGesture?.id === e.pointerId) {
      finishAnimationGesture(e);
      return;
    }
    if (state.shapeGesture?.id === e.pointerId) {
      const gesture = state.shapeGesture;
      state.shapeGesture = null;
      if (e.type !== "pointercancel") stampSketchShape(gesture.start, gesture.end);
      requestInteractionLayerRender();
      return;
    }
    if (state.selectionGesture?.id === e.pointerId) {
      finishSelectionGesture(e);
      return;
    }
    if (state.textTap?.id === e.pointerId) {
      const tap = state.textTap;
      state.textTap = null;
      if (e.type !== "pointercancel" && state.mode === "text") createTextEditor(tap.point);
      state.touchGesture = null;
      state.panGesture = null;
      if (!state.touches.size) setNavigating(false);
      return;
    }
    if (state.panGesture?.id === e.pointerId) {
      state.panGesture = null;
      resetCanvasCursor();
      setNavigating(false);
      if (e.pointerType === "touch") {
        state.touchGesture = null;
        if (state.touches.size === 1) {
          const [id, p] = state.touches.entries().next().value;
          state.panGesture = { id, last: p };
        }
      }
      return;
    }
    if (state.drawing?.id === e.pointerId) {
      const wasErasing = state.drawing.erase;
      finishDrawing(e.pointerType);
      if (wasErasing && state.pointerPreview) {
        state.pointerPreview = null;
        requestInteractionLayerRender();
      }
      if (e.pointerType === "touch") {
        state.touchGesture = null;
        state.panGesture = null;
      }
      return;
    }
    if (e.pointerType === "touch") {
      state.touchGesture = null;
      if (state.touches.size === 1) {
        const [id, p] = state.touches.entries().next().value;
        state.panGesture = { id, last: p };
      } else state.panGesture = null;
      if (!state.touches.size) setNavigating(false);
      return;
    }
  }
  screen.addEventListener("pointerup", end);
  screen.addEventListener("pointercancel", end);
  screen.addEventListener("pointerleave", () => {
    if (!state.pointerPreview) return;
    state.pointerPreview = null;
    requestInteractionLayerRender();
  });
  screen.addEventListener("contextmenu", (e) => e.preventDefault());
  view.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      zoomCanvasAt(e.clientX, e.clientY, e.deltaY);
    },
    { passive: false },
  );
  function enterAIDraftHandMode() {
    if (state.mode !== "hand" && state.aiDraftReturnMode === null) state.aiDraftReturnMode = state.mode;
    state.pendingHistoryRestored = false;
    if (state.mode !== "hand") setCanvasMode("hand", {
      preserveSelection:true,
      skipDraftFinalize:true,
      preserveWidgetRefinement:true,
    });
  }
  function finishAIDraftHandMode() {
    if (state.pending || state.pendingWidget || state.imageEdit) return;
    const returnMode = state.aiDraftReturnMode;
    state.aiDraftReturnMode = null;
    state.pendingHistoryRestored = false;
    if (returnMode && state.mode === "hand") setCanvasMode(returnMode, {
      preserveSelection:true,
      skipDraftFinalize:true,
      preserveWidgetRefinement:true,
    });
  }
  function setCanvasMode(mode, options) {
    options ||= {};
    const button = document.querySelector(`[data-mode="${mode}"]`);
    if (!button) return;
    if (mode !== state.mode && !options.preserveWidgetRefinement && (state.activeAI?.widgetEdit || state.pendingWidgetReplacement)) {
      state.aiDraftReturnMode = null;
      state.pendingHistoryRestored = false;
      cancelWidgetRefinement("widget-refine-tool-change", { restoreMode:false });
    }
    const leavingDraftHand = state.mode === "hand" && mode !== "hand" && !options.skipDraftFinalize && (state.pending || state.pendingWidget);
    let deferredSelectionCommit = false;
    if (leavingDraftHand) {
      state.aiDraftReturnMode = null;
      state.pendingHistoryRestored = false;
      if (state.pending) acceptPending({ restoreMode:false });
      if (state.pendingWidgetReplacement) rejectPendingWidget(AI_CANCELLED, { restoreMode:false });
      else if (state.pendingWidget) acceptPendingWidget({ restoreMode:false });
    }
    if (!options.preserveSelection && mode !== "select" && state.selection && (state.mode === "select" || leavingDraftHand)) {
      if (selectionAIBusy(state.selection)) {
        if (leavingDraftHand) deferredSelectionCommit = true;
        else {
          setStatusKey(selectionAIStatusKey(state.selection));
          return;
        }
      } else commitSelection();
    }
    if (state.mode === "hand" && mode !== "hand") {
      for (const editor of [...state.textEditors.values()]) void confirmTextEditor(editor);
      if (state.widgetEdit) acceptWidgetEdit();
      if (state.imageEdit) {
        state.aiDraftReturnMode = null;
        state.imageHandReturnMode = null;
        acceptImageEdit();
      }
      if (state.animationEdit) acceptAnimationEdit();
    }
    state.mode = mode;
    if (mode === "hand") clearWidgetRefineCandidate();
    if (mode !== "eraser") state.pointerPreview = null;
    if (mode !== "select") deselectAnimation();
    view.classList.toggle("hand-mode", mode === "hand");
    document.querySelectorAll("[data-mode]").forEach((item) => {
      item.classList.toggle("active", item === button);
      item.setAttribute("aria-pressed", String(item === button));
    });
    resetCanvasCursor();
    const shapeSheet = document.querySelector("#sketchShapeSheet");
    if (shapeSheet) shapeSheet.hidden = mode !== "shape";
    requestInteractionLayerRender();
    if (mode === "hand") setNavigating(true);
    if (deferredSelectionCommit) queueMicrotask(() => {
      if (state.mode === mode && state.selection && !selectionAIBusy(state.selection)) commitSelection();
    });
  }
  document.querySelectorAll("[data-mode]").forEach((button) => {
    const handleModeSwitch = (event) => {
      if (event) {
        event.stopPropagation();
        if (event.type === "pointerdown" && event.pointerType === "mouse" && event.button !== 0) return;
      }
      if (/^(talk|draw|sim)$/.test(button.dataset.mode || "")) return;
      if (button.dataset.mode === "shape") {
        setCanvasMode("shape");
        const sheet = document.querySelector("#sketchShapeSheet");
        if (sheet) sheet.hidden = false;
        return;
      }
      setCanvasMode(button.dataset.mode);
    };

    button.addEventListener("pointerdown", handleModeSwitch);
    button.addEventListener("click", (e) => e.stopPropagation());
  });

  const sketchHudEl = document.querySelector("#sketchHud");
  if (sketchHudEl) {
    sketchHudEl.addEventListener("pointerdown", (e) => {
      if (e.target === sketchHudEl) return;
      e.stopPropagation();
    });
    sketchHudEl.addEventListener("touchstart", (e) => {
      if (e.target === sketchHudEl) return;
      e.stopPropagation();
    }, { passive: true });
  }

  const sketchTopbarEl = document.querySelector("#sketchTopbarTools");
  if (sketchTopbarEl) {
    sketchTopbarEl.addEventListener("pointerdown", (e) => e.stopPropagation());
    sketchTopbarEl.addEventListener("touchstart", (e) => e.stopPropagation(), { passive: true });
  }

  [selectionTypesetButton, selectionDeleteButton, selectionCancelButton].filter(Boolean).forEach((button) => {
    button.addEventListener("pointerdown", (event) => event.stopPropagation());
    button.addEventListener("click", (event) => event.stopPropagation());
  });
  imagePlaceButton.onclick = () => acceptImageEdit();
  imageMergeButton.onclick = () => {
    const item = selectedImage();
    if (item) mergeImage(item);
  };
  imageDeleteButton.onclick = () => {
    const item = selectedImage();
    if (item) deleteImage(item);
  };
  for (const button of [imagePlaceButton, imageMergeButton, imageDeleteButton]) {
    button.addEventListener("pointerdown", (event) => event.stopPropagation());
    button.addEventListener("click", (event) => event.stopPropagation());
  }
  imagePickerButton.addEventListener("click", () => {
    if (state.imageImporting) return;
    if (selectionAIBusy()) {
      setStatusKey(selectionAIStatusKey());
      return;
    }
    if (state.images.length >= MAX_VISIBLE_IMAGES) {
      setStatusKey("imageLimitReached");
      return;
    }
    imagePickerInput.value = "";
    imagePickerInput.click();
  });
  imagePickerInput.addEventListener("change", () => {
    const file = imagePickerInput.files?.[0];
    if (file) void addImageFile(file);
    else imagePickerInput.value = "";
  });
  function clipboardTextEditorPoint() {
    const rect = view.getBoundingClientRect(),
      scale = Math.max(0.03, state.scale),
      width = Math.min(TEXT_EDITOR_DEFAULT_WIDTH, Math.max(TEXT_EDITOR_MIN_WIDTH, rect.width - 24)),
      height = Math.min(TEXT_EDITOR_DEFAULT_HEIGHT, Math.max(TEXT_EDITOR_MIN_HEIGHT, rect.height - 24)),
      center = clientPoint({ clientX:rect.left + rect.width / 2, clientY:rect.top + rect.height / 2 });
    return {
      x:Math.max(0, Math.min(SIZE - width / scale, center.x - width / scale / 2)),
      y:Math.max(0, Math.min(SIZE - height / scale, center.y - height / scale / 2)),
    };
  }
  function addClipboardText(text) {
    const value = typeof text === "string" ? text.slice(0, TEXT_INPUT_MAX_LENGTH) : "";
    if (!value.trim()) {
      setStatusKey("clipboardUnsupported");
      return false;
    }
    if (selectionAIBusy()) {
      setStatusKey(selectionAIStatusKey());
      return false;
    }
    if (state.pending) acceptPending();
    if (state.pendingWidgetReplacement) rejectPendingWidget(AI_CANCELLED);
    else if (state.pendingWidget) acceptPendingWidget();
    if (state.selection) commitSelection();
    if (state.selection) {
      setStatusKey(selectionAIStatusKey());
      return false;
    }
    if (state.widgetEdit) acceptWidgetEdit();
    if (state.animationEdit) acceptAnimationEdit();
    if (state.imageEdit) acceptImageEdit();
    const returnMode = state.mode;
    if (state.mode !== "hand") setCanvasMode("hand", {
      preserveSelection:true,
      skipDraftFinalize:true,
      preserveWidgetRefinement:true,
    });
    createTextEditor(clipboardTextEditorPoint(), { text:value, returnMode });
    setStatusKey("clipboardTextAdded");
    return true;
  }
  async function importClipboardPayload(payload) {
    if (payload?.image instanceof Blob) {
      await addImageFile(payload.image);
      return true;
    }
    if (typeof payload?.text === "string" && payload.text.trim()) return addClipboardText(payload.text);
    setStatusKey("clipboardUnsupported");
    return false;
  }
  function clipboardPayloadFromDataTransfer(data) {
    if (!data) return null;
    const files = [...(data.files || [])],
      itemImage = [...(data.items || [])].find((item) => String(item.type || "").toLowerCase().startsWith("image/")),
      image = files.find((file) => String(file.type || "").toLowerCase().startsWith("image/")) || itemImage?.getAsFile?.() || null;
    if (image) return { image };
    const text = data.getData?.("text/plain") || "";
    return text ? { text } : null;
  }
  async function navigatorClipboardPayload() {
    if (navigator.clipboard?.read) {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const imageType = [...item.types].find((type) => String(type).toLowerCase().startsWith("image/"));
        if (imageType) return { image:await item.getType(imageType) };
      }
      for (const item of items) {
        if (item.types.includes("text/plain")) return { text:await (await item.getType("text/plain")).text() };
      }
      return null;
    }
    if (navigator.clipboard?.readText) return { text:await navigator.clipboard.readText() };
    throw Error("Clipboard reading is unavailable");
  }
  async function copyFromSystemClipboard() {
    if (state.clipboardImporting || state.imageImporting) return false;
    state.clipboardImporting = true;
    clipboardCopyButton.disabled = true;
    setStatusKey("clipboardReading");
    try {
      return await importClipboardPayload(await navigatorClipboardPayload());
    } catch {
      setStatusKey("clipboardReadFailed");
      return false;
    } finally {
      state.clipboardImporting = false;
      clipboardCopyButton.disabled = false;
    }
  }
  function editableClipboardTarget(target) {
    return target instanceof Element && Boolean(target.closest("input, textarea, select, [contenteditable]:not([contenteditable='false'])"));
  }
  clipboardCopyButton.addEventListener("click", () => void copyFromSystemClipboard());
  document.addEventListener("paste", (event) => {
    if (editableClipboardTarget(event.target)) return;
    event.preventDefault();
    void importClipboardPayload(clipboardPayloadFromDataTransfer(event.clipboardData));
  });
  if (selectionTypesetButton) selectionTypesetButton.onclick = () => {
    if (selectionHasTypesetDraft()) acceptPending();
    else normalizeSelectionForAI();
  };
  if (selectionVisualizeButton) selectionVisualizeButton.onclick = () => void visualizeSelection();
  if (selectionToolbar) {
    selectionToolbar.addEventListener("pointerdown", (event) => event.stopPropagation());
    selectionToolbar.addEventListener("pointerup", (event) => event.stopPropagation());
  }
  if (selectionDeleteButton) selectionDeleteButton.onclick = deleteSelection;
  if (selectionCancelButton) selectionCancelButton.onclick = () => {
    if (selectionHasTypesetDraft()) rejectPending();
    else cancelSelection();
  };
  [animationPlayPause, animationRestart, animationDelete].forEach((button) => button.addEventListener("pointerdown", (event) => event.stopPropagation()));
  animationPlayPause.onclick = toggleSelectedAnimationPlayback;
  animationRestart.onclick = restartSelectedAnimation;
  animationDelete.onclick = deleteSelectedAnimation;
  animationControls.addEventListener("click", (event) => event.stopPropagation());
  animationControls.addEventListener("pointerdown", (event) => event.stopPropagation());

  const penSizeInput = document.querySelector("#penSize");
  const sketchSizeRail = document.querySelector("#sketchSizeRail");
  const sketchSizeKnob = document.querySelector("#sketchSizeKnob");
  function syncSketchPenSizeUi() {
    if (!penSizeInput || !sketchSizeRail || !sketchSizeKnob) return;
    const min = Number(penSizeInput.min) || 2;
    const max = Number(penSizeInput.max) || 16;
    const value = Number(penSizeInput.value) || min;
    const t = (value - min) / (max - min || 1);
    const railH = sketchSizeRail.clientHeight || 220;
    const inset = 10;
    const y = inset + (1 - t) * Math.max(0, railH - inset * 2);
    sketchSizeKnob.style.top = `${y}px`;
    sketchSizeRail.setAttribute("aria-valuenow", String(value));
    state.pen = value;
  }
  function setSketchPenSizeFromClientY(clientY) {
    if (!penSizeInput || !sketchSizeRail) return;
    const rect = sketchSizeRail.getBoundingClientRect();
    const inset = 10;
    const usable = Math.max(1, rect.height - inset * 2);
    const y = (clientY - rect.top - inset) / usable;
    const t = Math.max(0, Math.min(1, 1 - y));
    const min = Number(penSizeInput.min) || 2;
    const max = Number(penSizeInput.max) || 16;
    penSizeInput.value = String(Math.round(min + t * (max - min)));
    syncSketchPenSizeUi();
  }
  if (sketchSizeRail && penSizeInput) {
    sketchSizeRail.addEventListener("pointerdown", (event) => {
      if (event.button != null && event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      sketchSizeRail.setPointerCapture(event.pointerId);
      setSketchPenSizeFromClientY(event.clientY);
    });
    sketchSizeRail.addEventListener("pointermove", (event) => {
      if (!sketchSizeRail.hasPointerCapture(event.pointerId)) return;
      event.preventDefault();
      setSketchPenSizeFromClientY(event.clientY);
    });
    sketchSizeRail.addEventListener("pointerup", (event) => {
      if (sketchSizeRail.hasPointerCapture(event.pointerId)) sketchSizeRail.releasePointerCapture(event.pointerId);
    });
    sketchSizeRail.addEventListener("keydown", (event) => {
      const min = Number(penSizeInput.min) || 2;
      const max = Number(penSizeInput.max) || 16;
      let value = Number(penSizeInput.value) || min;
      if (event.key === "ArrowUp" || event.key === "ArrowRight") value += 1;
      else if (event.key === "ArrowDown" || event.key === "ArrowLeft") value -= 1;
      else return;
      event.preventDefault();
      penSizeInput.value = String(Math.max(min, Math.min(max, value)));
      syncSketchPenSizeUi();
    });
  }
  syncSketchPenSizeUi();
  syncSketchInkWell(state.inkColor);
  const sketchMoreWrap = document.querySelector("#sketchMoreWrap");
  const sketchMoreBtn = document.querySelector("#sketchMoreBtn");
  function closeSketchMore() {
    if (!sketchMoreWrap || !sketchMoreBtn) return;
    sketchMoreWrap.classList.remove("open");
    sketchMoreBtn.setAttribute("aria-expanded", "false");
  }
  if (sketchMoreBtn && sketchMoreWrap) {
    sketchMoreBtn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const open = !sketchMoreWrap.classList.contains("open");
      sketchMoreWrap.classList.toggle("open", open);
      sketchMoreBtn.setAttribute("aria-expanded", String(open));
    });
    sketchMoreWrap.addEventListener("click", (event) => {
      if (event.target.closest(".btool") && event.target.closest("#sketchMorePanel")) closeSketchMore();
    });
    document.addEventListener("click", (event) => {
      if (!sketchMoreWrap.contains(event.target)) closeSketchMore();
    });
  }

  function sketchShapePoints(kind, a, b) {
    const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
    const w = Math.max(Math.abs(b.x - a.x), 1), h = Math.max(Math.abs(b.y - a.y), 1);
    const cx = x + w / 2, cy = y + h / 2;
    const ellipse = (rx, ry, n = 36) => {
      const pts = [];
      for (let i = 0; i <= n; i += 1) {
        const t = (i / n) * Math.PI * 2;
        pts.push({ x: cx + rx * Math.cos(t), y: cy + ry * Math.sin(t) });
      }
      return pts;
    };
    const polygon = (n, rot = -Math.PI / 2) => {
      const pts = [];
      for (let i = 0; i <= n; i += 1) {
        const t = rot + (i / n) * Math.PI * 2;
        pts.push({ x: cx + (w / 2) * Math.cos(t), y: cy + (h / 2) * Math.sin(t) });
      }
      return pts;
    };
    if (kind === "line") return [a, b];
    if (kind === "minus") return [{ x, y: cy }, { x: x + w, y: cy }];
    if (kind === "plus") return [
      [{ x: cx, y }, { x: cx, y: y + h }],
      [{ x, y: cy }, { x: x + w, y: cy }],
    ];
    if (kind === "cross") return [
      [{ x, y }, { x: x + w, y: y + h }],
      [{ x: x + w, y }, { x, y: y + h }],
    ];
    if (kind === "arrow") {
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      const head = Math.max(18 / Math.max(state.scale, 0.05), Math.hypot(w, h) * 0.18);
      return [
        a, b,
        { x: b.x - head * Math.cos(ang - 0.45), y: b.y - head * Math.sin(ang - 0.45) },
        b,
        { x: b.x - head * Math.cos(ang + 0.45), y: b.y - head * Math.sin(ang + 0.45) },
      ];
    }
    if (kind === "double-arrow") {
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      const head = Math.max(16 / Math.max(state.scale, 0.05), Math.hypot(w, h) * 0.16);
      return [
        { x: a.x + head * Math.cos(ang - 0.45), y: a.y + head * Math.sin(ang - 0.45) },
        a,
        { x: a.x + head * Math.cos(ang + 0.45), y: a.y + head * Math.sin(ang + 0.45) },
        a, b,
        { x: b.x - head * Math.cos(ang - 0.45), y: b.y - head * Math.sin(ang - 0.45) },
        b,
        { x: b.x - head * Math.cos(ang + 0.45), y: b.y - head * Math.sin(ang + 0.45) },
      ];
    }
    if (kind === "rect") return [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }, { x, y }];
    if (kind === "roundrect") {
      const r = Math.min(w, h) * 0.22;
      return [
        { x: x + r, y }, { x: x + w - r, y }, { x: x + w, y: y + r }, { x: x + w, y: y + h - r },
        { x: x + w - r, y: y + h }, { x: x + r, y: y + h }, { x, y: y + h - r }, { x, y: y + r }, { x: x + r, y },
      ];
    }
    if (kind === "triangle") return [{ x: cx, y }, { x: x + w, y: y + h }, { x, y: y + h }, { x: cx, y }];
    if (kind === "diamond") return [{ x: cx, y }, { x: x + w, y: cy }, { x: cx, y: y + h }, { x, y: cy }, { x: cx, y }];
    if (kind === "pentagon") return polygon(5);
    if (kind === "hexagon") return polygon(6, 0);
    if (kind === "ellipse") return ellipse(w / 2, h / 2);
    if (kind === "star") {
      const pts = [];
      for (let i = 0; i <= 10; i += 1) {
        const t = -Math.PI / 2 + (i / 10) * Math.PI * 2;
        const r = i % 2 === 0 ? 1 : 0.42;
        pts.push({ x: cx + (w / 2) * r * Math.cos(t), y: cy + (h / 2) * r * Math.sin(t) });
      }
      return pts;
    }
    if (kind === "heart") {
      const pts = [];
      for (let i = 0; i <= 40; i += 1) {
        const t = (i / 40) * Math.PI * 2;
        const hx = 16 * Math.sin(t) ** 3;
        const hy = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
        pts.push({ x: cx + (hx / 34) * w, y: y + h * 0.42 - (hy / 34) * h });
      }
      return pts;
    }
    if (kind === "cloud") {
      return [
        ellipse(w * 0.28, h * 0.28, 20).map((p) => ({ x: p.x - w * 0.18, y: p.y + h * 0.08 })),
        ellipse(w * 0.34, h * 0.32, 20).map((p) => ({ x: p.x + w * 0.02, y: p.y - h * 0.08 })),
        ellipse(w * 0.26, h * 0.26, 20).map((p) => ({ x: p.x + w * 0.2, y: p.y + h * 0.1 })),
      ];
    }
    if (kind === "lightning") {
      return [
        { x: x + w * 0.58, y }, { x: x + w * 0.28, y: y + h * 0.46 }, { x: x + w * 0.52, y: y + h * 0.46 },
        { x: x + w * 0.38, y: y + h }, { x: x + w * 0.72, y: y + h * 0.52 }, { x: x + w * 0.48, y: y + h * 0.52 },
        { x: x + w * 0.58, y },
      ];
    }
    if (kind === "speech") {
      return [
        { x: x + w * 0.12, y }, { x: x + w * 0.88, y }, { x: x + w, y: y + h * 0.12 },
        { x: x + w, y: y + h * 0.62 }, { x: x + w * 0.88, y: y + h * 0.74 },
        { x: x + w * 0.38, y: y + h * 0.74 }, { x: x + w * 0.18, y: y + h },
        { x: x + w * 0.28, y: y + h * 0.74 }, { x: x + w * 0.12, y: y + h * 0.74 },
        { x, y: y + h * 0.62 }, { x, y: y + h * 0.12 }, { x: x + w * 0.12, y },
      ];
    }
    if (kind === "chevron") return [{ x, y }, { x: x + w, y: cy }, { x, y: y + h }];
    if (kind === "parallelogram") return [
      { x: x + w * 0.28, y }, { x: x + w, y }, { x: x + w * 0.72, y: y + h }, { x, y: y + h }, { x: x + w * 0.28, y },
    ];
    if (kind === "trapezoid") return [
      { x: x + w * 0.22, y }, { x: x + w * 0.78, y }, { x: x + w, y: y + h }, { x, y: y + h }, { x: x + w * 0.22, y },
    ];
    if (kind === "brace") {
      return [
        { x: x + w * 0.7, y }, { x: x + w * 0.45, y }, { x: x + w * 0.45, y: cy - h * 0.08 },
        { x: x + w * 0.2, y: cy }, { x: x + w * 0.45, y: cy + h * 0.08 }, { x: x + w * 0.45, y: y + h },
        { x: x + w * 0.7, y: y + h },
      ];
    }
    if (kind === "house") {
      return [
        { x, y: y + h * 0.42 }, { x: cx, y }, { x: x + w, y: y + h * 0.42 }, { x: x + w * 0.82, y: y + h * 0.42 },
        { x: x + w * 0.82, y: y + h }, { x: x + w * 0.18, y: y + h }, { x: x + w * 0.18, y: y + h * 0.42 }, { x, y: y + h * 0.42 },
      ];
    }
    if (kind === "person") {
      const headR = Math.min(w, h) * 0.16;
      return [
        ellipse(headR, headR, 18).map((p) => ({ x: p.x, y: y + h * 0.22 + (p.y - cy) })),
        [{ x: cx, y: y + h * 0.38 }, { x: cx, y: y + h * 0.72 }],
        [{ x: x + w * 0.18, y: y + h * 0.52 }, { x: x + w * 0.82, y: y + h * 0.52 }],
        [{ x: cx, y: y + h * 0.72 }, { x: x + w * 0.22, y: y + h }],
        [{ x: cx, y: y + h * 0.72 }, { x: x + w * 0.78, y: y + h }],
      ];
    }
    return [a, b];
  }

  function sketchShapePolylines(kind, a, b) {
    const pts = sketchShapePoints(kind, a, b);
    if (!pts.length) return [];
    return Array.isArray(pts[0]) ? pts : [pts];
  }

  function stampSketchShape(start, end) {
    if (!start || !end) return;
    if (Math.hypot(end.x - start.x, end.y - start.y) < 8 / Math.max(state.scale, 0.05)) return;
    const polylines = sketchShapePolylines(state.shapeKind || "rect", start, end);
    const size = logicalWidth(state.pen);
    state.userRevision++;
    let bounds = null;
    for (const points of polylines) {
      for (let i = 1; i < points.length; i += 1) stroke(points[i - 1], points[i], false, size, true);
      for (const point of points) bounds = SELECT.unionBox(bounds, { x: point.x, y: point.y, w: 1, h: 1 });
    }
    if (bounds) rememberInkBox(bounds);
    save();
    requestRender();
  }

  window.__drawSketchShapePreview = function (context) {
    const gesture = state.shapeGesture;
    if (!gesture || state.mode !== "shape") return;
    const polylines = sketchShapePolylines(state.shapeKind || "rect", gesture.start, gesture.end);
    context.save();
    context.strokeStyle = state.inkColor;
    context.lineWidth = logicalWidth(state.pen);
    context.lineCap = "round";
    context.lineJoin = "round";
    for (const points of polylines) {
      if (points.length < 2) continue;
      context.beginPath();
      context.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i += 1) context.lineTo(points[i].x, points[i].y);
      context.stroke();
    }
    context.restore();
  };

  document.querySelectorAll("#sketchShapeSheet [data-shape]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      state.shapeKind = button.dataset.shape || "rect";
      document.querySelectorAll("#sketchShapeSheet [data-shape]").forEach((item) => {
        item.classList.toggle("active", item === button);
      });
      setCanvasMode("shape");
    });
  });

  document.querySelector("#sketchCustomColor")?.addEventListener("input", (event) => {
    const color = event.target.value;
    if (!color) return;
    state.inkColor = color;
    document.querySelectorAll("[data-ink-color]").forEach((swatch) => swatch.classList.remove("active"));
    syncSketchInkWell(color);
  });

  function lightenInkColor(hex, amount = 0.58) {
    const raw = String(hex || "#1d4ed8").replace("#", "");
    if (raw.length < 6) return "#93c5fd";
    const r = parseInt(raw.slice(0, 2), 16);
    const g = parseInt(raw.slice(2, 4), 16);
    const b = parseInt(raw.slice(4, 6), 16);
    if (![r, g, b].every(Number.isFinite)) return "#93c5fd";
    const mix = (c) => Math.round(c + (255 - c) * amount);
    return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
  }
  function syncSketchInkWell(color) {
    const next = color || state.inkColor || "#1d4ed8";
    const dot = document.querySelector("#sketchInkDot");
    if (dot) dot.style.background = next;
    const rail = document.querySelector("#sketchSizeRail");
    if (rail) rail.style.setProperty("--sketch-wedge", lightenInkColor(next));
  }
  const aiFont = document.querySelector("#aiFont");
  if (aiFont) {
    state.aiFont = aiFont.value || state.aiFont;
    aiFont.onchange = (e) => {
      state.aiFont = e.target.value;
      positionTextEditors();
    };
  }
  function closeColorOrbs(except = null) {
    document.querySelectorAll("[data-color-control]").forEach((control) => {
      if (control === except) return;
      const trigger = control.querySelector(".color-orb-trigger");
      const orbit = control.querySelector(".color-orbit");
      if (!trigger || !orbit) return;
      const focusedInside = control.contains(document.activeElement) && document.activeElement !== trigger;
      control.classList.remove("open");
      trigger.setAttribute("aria-expanded", "false");
      orbit.setAttribute("aria-hidden", "true");
      control.querySelectorAll(".orbit-swatch").forEach((button) => button.setAttribute("tabindex", "-1"));
      if (focusedInside) trigger.focus();
    });
  }
  document.querySelectorAll("[data-color-control]").forEach((control) => {
    const trigger = control.querySelector(".color-orb-trigger"),
      orbit = control.querySelector(".color-orbit"),
      type = control.dataset.colorControl;
    if (!trigger || !orbit) return;
    trigger.onclick = (event) => {
      event.stopPropagation();
      const open = !control.classList.contains("open");
      closeColorOrbs(control);
      control.classList.toggle("open", open);
      trigger.setAttribute("aria-expanded", String(open));
      orbit.setAttribute("aria-hidden", String(!open));
      control.querySelectorAll(".orbit-swatch").forEach((button) => button.setAttribute("tabindex", open ? "0" : "-1"));
    };
    control.querySelectorAll(".orbit-swatch").forEach((button) => {
      button.onclick = (event) => {
        event.stopPropagation();
        const color = type === "ink" ? button.dataset.inkColor : button.dataset.aiColor;
        if (type === "ink") {
          state.inkColor = color;
          applySelectionColor(color);
          positionTextEditors();
          for (const editor of state.textEditors.values()) if (editor.mixedMode) scheduleTextEditorPreview(editor, 0);
          syncSketchInkWell(color);
        }
        else state.aiColor = color;
        trigger.classList.remove(...Object.values(COLOR_CLASS));
        trigger.classList.add(COLOR_CLASS[color]);
        control.querySelectorAll(".orbit-swatch").forEach((item) => {
          const active = item === button;
          item.classList.toggle("active", active);
          item.setAttribute("aria-checked", String(active));
        });
        closeColorOrbs();
      };
    });
  });
  document.querySelectorAll(".orbit-swatch").forEach((button) => {
    button.setAttribute("role", "menuitemradio");
    button.setAttribute("tabindex", "-1");
    button.setAttribute("aria-checked", String(button.classList.contains("active")));
  });
  document.addEventListener("click", () => closeColorOrbs());
  document.querySelector("#rejectBatch")?.addEventListener("click", rejectPending);
  document.querySelector("#acceptBatch")?.addEventListener("click", acceptPending);
  const autoBtn = document.querySelector("#auto");
  if (autoBtn) {
    autoBtn.onclick = () => {
      if (state.auto) setAutoEnabled(false);
      else setAutoEnabled(true, true);
    };
  }
  const autoDelayRange = document.querySelector("#autoDelayRange");
  if (autoDelayRange) {
    autoDelayRange.oninput = (event) => {
      state.autoDelayMs = Math.round(Math.max(0, Math.min(10, Number(event.target.value))) * 1000);
      localStorage.setItem("lumi6-auto-delay-ms", String(state.autoDelayMs));
      updateAutoControl();
      schedule();
      keepAutoDelayControlOpen();
    };
  }
  const aiEffortBtn = document.querySelector("#aiEffortButton");
  if (aiEffortBtn) {
    aiEffortBtn.onclick = () => {
      const pop = document.querySelector("#effortPopover");
      if (pop && pop.hidden) showEffortControl();
      else hideEffortControl();
    };
  }
  if (pluginButton && pluginPopover) {
    pluginButton.onclick = () => {
      if (pluginPopover.hidden) showPluginControl();
      else hidePluginControl();
    };
  }
  if (pluginClose) pluginClose.onclick = hidePluginControl;
  if (pluginRefresh) {
    pluginRefresh.onclick = () => {
      state.pluginCatalogNotice = null;
      void loadPluginDocuments();
    };
  }
  if (pluginLocalTab) pluginLocalTab.onclick = () => setPluginTab("local");
  if (pluginCreateTab) pluginCreateTab.onclick = () => setPluginTab("create");
  if (pluginServerTab) pluginServerTab.onclick = () => setPluginTab("server");
  if (pluginSimpleTemplate) pluginSimpleTemplate.onclick = () => setPluginTemplate("simple");
  if (pluginTitle) {
    pluginTitle.addEventListener("input", () => {
      if (state.pluginAuthoringStatus?.type === "error") state.pluginAuthoringStatus = null;
      updatePluginAuthoringUi();
    });
  }
  if (pluginDocumentEditor) {
    pluginDocumentEditor.addEventListener("input", () => {
      state.pluginAuthoringStatus = null;
      updatePluginAuthoringUi();
    });
  }
  if (pluginStylesEditor) {
    pluginStylesEditor.addEventListener("input", () => {
      state.pluginAuthoringStatus = null;
      updatePluginAuthoringUi();
    });
  }
  if (pluginStylesUploadButton && pluginStylesUpload) {
    pluginStylesUploadButton.onclick = () => {
      if (state.pluginAuthoringBusy) return;
      pluginStylesUpload.value = "";
      pluginStylesUpload.click();
    };
    pluginStylesUpload.addEventListener("change", () => {
      const file = pluginStylesUpload.files?.[0];
      if (file) void importPluginStylesFile(file);
      else pluginStylesUpload.value = "";
    });
  }
  if (pluginImprove) pluginImprove.onclick = () => void improvePluginDraft();
  if (pluginCreateForm) pluginCreateForm.addEventListener("submit", (event) => void savePluginDraft(event));
  if (pluginOptions) {
    pluginOptions.addEventListener("click", (event) => {
      const detailButton = event.target.closest("button[data-plugin-detail]");
      if (detailButton) {
        event.preventDefault();
        event.stopPropagation();
        togglePluginDetails(detailButton.dataset.pluginDetail, detailButton);
        return;
      }
      const copyButton = event.target.closest("button[data-plugin-copy]");
      if (copyButton) {
        event.preventDefault();
        event.stopPropagation();
        void copyPluginMarkdown(copyButton.dataset.pluginCopy, copyButton);
        return;
      }
      const duplicateButton = event.target.closest("button[data-plugin-duplicate]");
      if (duplicateButton) {
        event.preventDefault();
        event.stopPropagation();
        createPluginCopy(duplicateButton.dataset.pluginDuplicate);
        return;
      }
      const deleteButton = event.target.closest("button[data-plugin-delete]");
      if (!deleteButton) return;
      event.preventDefault();
      event.stopPropagation();
      void deleteLocalPlugin(deleteButton.dataset.pluginDelete);
    });
    pluginOptions.addEventListener("change", (event) => {
      const input = event.target.closest("input[data-plugin-id]");
      if (!input) return;
      void setPluginEnabled(input.dataset.pluginId, input.checked).then((enabled) => {
        if (!enabled && input.isConnected) input.checked = pluginEnabled(input.dataset.pluginId);
      });
    });
  }
  if (pluginPopover) {
    pluginPopover.addEventListener("pointerdown", (event) => {
      if (event.target === pluginPopover) hidePluginControl();
    });
    pluginPopover.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        hidePluginControl();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...pluginPopover.querySelectorAll("button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled)")].filter((element) => !element.closest("[hidden]"));
      if (!focusable.length) return;
      const current = focusable.indexOf(document.activeElement), next = event.shiftKey ? (current <= 0 ? focusable.length - 1 : current - 1) : current < 0 || current === focusable.length - 1 ? 0 : current + 1;
      event.preventDefault();
      focusable[next].focus();
    });
  }
  document.querySelectorAll("#effortOptions .effort-option").forEach((option) => {
    option.onclick = () => setEffort(option.dataset.effort);
  });
  document.querySelector("#effortPopover")?.addEventListener("pointerdown", keepEffortControlOpen);
  document.querySelector("#autoDelayPopover")?.addEventListener("pointerdown", keepAutoDelayControlOpen);
  document.addEventListener("pointerdown", (event) => {
    const autoControl = document.querySelector("#autoControl");
    if (autoControl && !autoControl.contains(event.target)) hideAutoDelayControl();
    const effortControl = document.querySelector("#effortControl");
    if (effortControl && !effortControl.contains(event.target)) hideEffortControl();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") hideEffortControl();
    if (event.key === "Escape") hidePluginControl();
  });
  document.querySelectorAll("[data-language]").forEach((button) => {
    button.onclick = () => {
      state.language = button.dataset.language;
      localStorage.setItem("lumi6-language", state.language);
      applyLanguage();
    };
  });
  const themeEl = document.querySelector("#theme");
  if (themeEl) themeEl.onchange = (e) => applyTheme(e.target.value);
  const gridToggle = document.querySelector("#gridToggle");
  if (gridToggle) {
    gridToggle.onclick = () => {
      state.gridVisible = !state.gridVisible;
      localStorage.setItem(state.theme === "research" ? "lumi6-research-grid" : "lumi6-grid", String(state.gridVisible));
      updateGridButton();
      requestRender();
    };
  }
  const fullscreenBtn = document.querySelector("#fullscreenBtn");
  if (fullscreenBtn) {
    fullscreenBtn.onclick = async () => {
      try {
        if (document.fullscreenElement) await document.exitFullscreen();
        else await document.documentElement.requestFullscreen();
      } catch (error) {
        setStatus(`${t("aiError")}${error.message}`);
      }
    };
  }
  const newCanvasBtn = document.querySelector("#newCanvasBtn");
  if (newCanvasBtn) newCanvasBtn.onclick = openNewCanvasDialog;
  const clearCanvasBtn = document.querySelector("#clearCanvasBtn");
  if (clearCanvasBtn) clearCanvasBtn.onclick = startBlankCanvas;
  const exportBtn = document.querySelector("#exportPngBtn");
  if (exportBtn) {
    exportBtn.onclick = () => {
      if (typeof window.exportLessonPdf === "function") {
        window.exportLessonPdf();
      } else if (typeof exportCanvasPng === "function") {
        exportCanvasPng();
      }
    };
  }
  const historyBtn = document.querySelector("#historyBtn");
  if (historyBtn) historyBtn.onclick = openHistoryPanel;
  const historyClose = document.querySelector("#historyClose");
  if (historyClose) historyClose.onclick = closeHistoryPanel;
  const historyBackdrop = document.querySelector("#historyBackdrop");
  if (historyBackdrop) historyBackdrop.onclick = closeHistoryPanel;
  const historySaveCurrent = document.querySelector("#historySaveCurrent");
  if (historySaveCurrent) historySaveCurrent.onclick = saveCurrentCanvas;
  const historySave = document.querySelector("#historySave");
  if (historySave) historySave.onclick = saveSnapshotFromHistory;
  const historyNew = document.querySelector("#historyNew");
  if (historyNew) historyNew.onclick = openNewCanvasDialog;
  document.querySelectorAll('input[name="historyStorageLocation"], input[name="newCanvasStorageLocation"]').forEach((input) => {
    input.addEventListener("change", () => {
      if (input.checked) setSnapshotLocation(input.value);
    });
  });
  const newCanvasDialog = document.querySelector("#newCanvasDialog");
  const newCanvasClose = document.querySelector("#newCanvasClose");
  if (newCanvasClose) newCanvasClose.onclick = () => newCanvasDialog?.close("cancel");
  const newCanvasCancel = document.querySelector("#newCanvasCancel");
  if (newCanvasCancel) newCanvasCancel.onclick = () => newCanvasDialog?.close("cancel");
  const textHelpClose = document.querySelector("#textHelpClose");
  if (textHelpClose) textHelpClose.onclick = closeTextHelp;
  const textHelpDone = document.querySelector("#textHelpDone");
  if (textHelpDone) textHelpDone.onclick = closeTextHelp;
  const textHelpDialog = document.querySelector("#textHelpDialog");
  if (textHelpDialog) textHelpDialog.addEventListener("close", restoreTextEditorAfterHelp);
  const newDiscard = document.querySelector("#newDiscard");
  if (newDiscard) newDiscard.onclick = startBlankCanvas;
  const newSaveCopy = document.querySelector("#newSaveCopy");
  if (newSaveCopy) newSaveCopy.onclick = () => completeNewCanvas("new");
  const newOverwrite = document.querySelector("#newOverwrite");
  if (newOverwrite) newOverwrite.onclick = () => completeNewCanvas("overwrite");
  if (newCanvasDialog) {
    newCanvasDialog.addEventListener("cancel", (event) => {
      if (event.currentTarget.dataset.busy === "true") event.preventDefault();
    });
  }
  const historyName = document.querySelector("#historyName");
  if (historyName) {
    historyName.addEventListener("keydown", (event) => {
      if (event.key === "Enter") saveCurrentCanvas();
    });
  }
  const newSnapshotName = document.querySelector("#newSnapshotName");
  if (newSnapshotName) {
    newSnapshotName.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        completeNewCanvas("new");
      }
    });
  }
  document.addEventListener("fullscreenchange", () => {
    updateFullscreenButton();
    requestAnimationFrame(fit);
  });
  const debugBtn = document.querySelector("#debugBtn");
  if (debugBtn) {
    debugBtn.onclick = (e) => {
      const panel = document.querySelector("#debugPanel");
      if (panel) {
        panel.hidden = !panel.hidden;
        e.currentTarget.setAttribute("aria-expanded", String(!panel.hidden));
        e.currentTarget.classList.toggle("active", !panel.hidden);
      }
    };
  }
  document.querySelectorAll("[data-action]").forEach(
      (b) =>
      (b.onclick = () => {
        const a = b.dataset.action;
        if (selectionAIBusy()) {
          setStatusKey(selectionAIStatusKey());
          return;
        }
        if ((state.pending || state.pendingWidget) && a !== "clear" && !(state.pendingHistoryRestored && (a === "undo" || a === "redo"))) {
          setStatusKey("pendingConfirm");
          return;
        }
        if (a === "undo") {
          if (state.selection) commitSelection();
          state.userRevision++;
          undo();
        } else if (a === "redo") {
          if (state.selection) commitSelection();
          state.userRevision++;
          redo();
        } else if (a === "clear") {
          void showConfirmModal({ title: t("clearConfirm"), message: t("clearConfirm"), okText: t("clear") }).then((confirmed) => {
            if (!confirmed) return;
            if (state.selection) commitSelection();
            clearTextEditors();
            state.userRevision++;
            state.snapshotLoadGeneration++;
            invalidateRecognition();
            state.historyBefore.clear();
            clearSharpOverlays();
            for (const [k, c] of tiles) state.historyBefore.set(k, cloneCanvas(c));
            recordAnimationsBefore();
            recordWidgetsBefore();
            recordImagesBefore();
            recordTextBoxesBefore();
            state.animations = [];
            state.selectedAnimationId = null;
            state.animationGesture = null;
            state.animationEdit = null;
            hideAnimationControls();
            requestAnimationLayerRender();
            restoreWidgets([]);
            restoreImages([]);
            void restoreTextBoxes([]);
            tiles.clear();
            state.inkBounds.clear();
            cancelPendingForRevision();
            save();
            render();
          });
        } else invokeAIAction(a);
      }),
  );
  embodiment?.addEventListener("pointerenter", (e) => {
    if (e.pointerType === "mouse" || e.pointerType === "pen") openRadialMenu();
  });
  embodiment?.addEventListener("pointerleave", (e) => {
    if (e.pointerType !== "mouse" && e.pointerType !== "pen") return;
    if (!state.radialGesture) {
      state.radialCloseTimer = setTimeout(closeRadialMenu, 2000);
    }
  });
  aiOrb?.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const wasOpen = embodiment?.classList.contains("menu-open");
    if (!wasOpen) openRadialMenu();
    state.radialGesture = { id: e.pointerId, moved: false, selected: null, wasOpen };
    try {
      aiOrb.setPointerCapture(e.pointerId);
    } catch {}
  });
  aiOrb?.addEventListener("pointermove", (e) => {
    const gesture = state.radialGesture;
    if (!gesture || gesture.id !== e.pointerId) return;
    e.preventDefault();
    e.stopPropagation();
    const r = aiOrb.getBoundingClientRect(),
      distance = Math.hypot(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2));
    if (distance > 12) gesture.moved = true;
    gesture.selected = gesture.moved ? chooseRadialAction(e.clientX, e.clientY) : null;
  });
  function finishRadialGesture(e) {
    const gesture = state.radialGesture;
    if (!gesture || gesture.id !== e.pointerId) return;
    e.preventDefault();
    e.stopPropagation();
    const selected = gesture.selected;
    state.radialGesture = null;
    state.radialSuppressClickUntil = performance.now() + 450;
    if (selected) {
      invokeAIAction(selected.dataset.aiAction);
      closeRadialMenu(true);
      return;
    }
    if (gesture.wasOpen && !gesture.moved) {
      closeRadialMenu(true);
      return;
    }
    if (gesture.moved) closeRadialMenu(true);
  }
  aiOrb?.addEventListener("pointerup", finishRadialGesture);
  aiOrb?.addEventListener("pointercancel", (e) => {
    if (state.radialGesture?.id !== e.pointerId) return;
    state.radialGesture = null;
    state.radialSuppressClickUntil = performance.now() + 450;
    closeRadialMenu(true);
  });
  aiOrb?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (performance.now() < state.radialSuppressClickUntil) return;
    if (embodiment?.classList.contains("menu-open")) closeRadialMenu(true);
    else openRadialMenu();
  });
  document.querySelectorAll(".radial-action").forEach((button) => {
    button.addEventListener("pointerenter", (e) => {
      if (e.pointerType !== "mouse" && e.pointerType !== "pen") return;
      clearTimeout(state.radialCloseTimer);
      openRadialMenu();
    });
    button.addEventListener("pointerleave", (e) => {
      if ((e.pointerType !== "mouse" && e.pointerType !== "pen") || state.radialGesture) return;
      state.radialCloseTimer = setTimeout(closeRadialMenu, 2000);
    });
    button.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
    });
    button.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      invokeAIAction(button.dataset.aiAction);
      closeRadialMenu();
    });
  });
  tourBackButton?.addEventListener("click", previousFeatureTourStep);
  tourNextButton?.addEventListener("click", nextFeatureTourStep);
  tourSkipButton?.addEventListener("click", skipFeatureTour);
  changelogCloseButton?.addEventListener("click", closeChangelog);
  changelogDoneButton?.addEventListener("click", closeChangelog);
  changelogLayer?.addEventListener("pointerdown", (event) => {
    if (event.target === changelogLayer) closeChangelog();
  });
  changelogLayer?.addEventListener("keydown", handleChangelogKeydown);
  settingsButton?.addEventListener("click", () => {
    if (settings.open) closeSettings();
    else openSettings();
  });
  settingsCloseButton?.addEventListener("click", () => closeSettings());
  settingsBackdrop?.addEventListener("pointerdown", () => closeSettings());
  settingsPanel?.addEventListener("pointerdown", (event) => event.stopPropagation());
  settingsAutoToggle?.addEventListener("click", () => setAutoEnabled(!state.auto));
  summonToggle?.addEventListener("click", () => setSummonEnabled(!state.summonEnabled));
  settingsTourButton?.addEventListener("click", () => {
    closeSettings(false);
    replayFeatureTour();
  });
  settingsChangelogButton?.addEventListener("click", () => {
    closeSettings(false);
    maybeShowChangelog(true);
  });
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && settings.open) {
      event.preventDefault();
      event.stopPropagation();
      closeSettings();
    }
  }, true);
  window.addEventListener("keydown", handleFeatureTourKeydown, true);
  window.addEventListener("resize", handleFeatureTourViewportChange);
  window.addEventListener("scroll", scheduleFeatureTourPosition, true);
  window.visualViewport?.addEventListener("resize", handleFeatureTourViewportChange);
  window.visualViewport?.addEventListener("scroll", scheduleFeatureTourPosition);
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && (document.querySelector("#newCanvasDialog").open || document.querySelector("#textHelpDialog").open)) return;
    if (e.key === "Escape" && state.selection) {
      cancelSelection();
      return;
    }
    if (e.key === "Escape" && state.pendingWidget) {
      rejectPendingWidget();
      return;
    }
    if (e.key === "Escape" && state.activeAI?.widgetEdit) {
      cancelWidgetRefinement();
      setStatusKey("ready");
      return;
    }
    if (e.key === "Escape" && state.widgetRefineCandidate) {
      dismissWidgetRefineCandidate();
      return;
    }
    if (e.key === "Escape" && state.imageEdit) {
      cancelImageEdit();
      return;
    }
    if ((e.key === "Delete" || e.key === "Backspace") && state.imageEdit && !/^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(e.target.tagName)) {
      deleteImage(selectedImage());
      return;
    }
    if (e.key === "Escape" && state.widgetEdit) {
      cancelWidgetEdit();
      return;
    }
    if ((e.key === "Delete" || e.key === "Backspace") && state.widgetEdit && !/^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(e.target.tagName)) {
      deleteWidget(selectedWidget());
      return;
    }
    if (e.key === "Enter" && state.selection?.phase === "active" && !/^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(e.target.tagName)) {
      commitSelection();
      return;
    }
    const autoDelayPop = document.querySelector("#autoDelayPopover");
    if (e.key === "Escape" && autoDelayPop && !autoDelayPop.hidden) {
      hideAutoDelayControl();
      document.querySelector("#auto")?.focus();
      return;
    }
    const historyPanel = document.querySelector("#historyPanel");
    if (e.key === "Escape" && historyPanel?.classList.contains("open")) {
      closeHistoryPanel();
      document.querySelector("#historyBtn")?.focus();
      return;
    }
    if (e.key === "Escape" && embodiment?.classList?.contains("menu-open")) {
      state.radialGesture = null;
      closeRadialMenu();
      aiOrb?.focus();
      return;
    }
    if (!/^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(e.target.tagName)) {
      const k = e.key.toLowerCase();
      if (k === "h") {
        setCanvasMode("hand");
        e.preventDefault();
        return;
      }
      if (k === "p") {
        setCanvasMode("pen");
        e.preventDefault();
        return;
      }
      if (k === "e") {
        setCanvasMode("eraser");
        e.preventDefault();
        return;
      }
      if (k === "l" || k === "s") {
        setCanvasMode("select");
        e.preventDefault();
        return;
      }
    }
    if (e.key === "Alt" && !state.drawing && !state.pending && !state.pendingWidget) setCanvasCursor("grab");
  });
  window.addEventListener("keyup", (e) => {
    if (e.key === "Alt" && !state.panGesture && !state.drawing && !state.pending && !state.pendingWidget) resetCanvasCursor();
  });
  new ResizeObserver(fit).observe(view);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopAnimationFrames();
    else requestAnimationLayerRender();
  });

  document.querySelectorAll(".radial-action").forEach((button) => button.setAttribute("tabindex", "-1"));
  setPluginTemplate("simple");
  applyLanguage();
    applyTheme(state.theme);
    if (typeof setAutoEnabled === "function") setAutoEnabled(false);
  resetCanvasCursor();
  loadPluginDocuments().catch(() => {});
  refreshSnapshots().catch(() => {});
  fit();
  setNavigating(true);

  // Tracks the canvas Y position below the last ATLAS drawing.
  // Each new drawing is placed below the previous one to avoid overlap.
  let _atlasDrawCursor = null;

  // ── ATLAS Visual Layout Policy ─────────────────────────────────────────────
  // Computes diagram widget dimensions in canvas units from the visible viewport.
  // Targets 85% of viewport CSS pixel width for primary diagrams (55% for supporting),
  // then back-converts to canvas units using state.scale so the widget always appears
  // large and readable regardless of the current zoom level.
  // Aspect ratio 16:10 is appropriate for flow/process diagrams.
  function _atlasWidgetSizing(primaryDiagram = true) {
    const rect = view.getBoundingClientRect();
    const scale = Math.max(0.001, state.scale);
    // Target coverage of the viewport in CSS pixels, then convert to canvas units.
    const targetFraction = primaryDiagram ? 0.70 : 0.50;
    const targetPxW = Math.min(1050, rect.width * targetFraction);
    const targetPxH = Math.min(650, rect.height * targetFraction);
    // Convert screen pixels → canvas units
    const w = Math.round(Math.max(300, targetPxW / scale));
    const hFromRatio   = Math.round(w * 0.625);
    const hFromViewport = Math.round(Math.max(200, targetPxH / scale));
    const h = Math.min(hFromRatio, hFromViewport);
    return { w, h };
  }

  function fallbackLessonCard(title, body) {
    const canvas = document.createElement("canvas");
    canvas.width = 1400;
    canvas.height = 900;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#e0f2fe";
    ctx.fillRect(0, 0, 1400, 900);
    ctx.fillStyle = "#0369a1";
    ctx.fillRect(0, 0, 1400, 16);
    ctx.fillStyle = "#0f172a";
    ctx.textAlign = "center";
    ctx.font = "bold 56px Arial, sans-serif";
    ctx.fillText(String(title || "Lesson").slice(0, 40), 700, 120);
    ctx.font = "32px Arial, sans-serif";
    ctx.fillStyle = "#334155";
    const words = String(body || "").replace(/\s+/g, " ").trim().split(" ");
    let line = "", y = 220;
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (ctx.measureText(next).width > 1200) {
        ctx.fillText(line, 700, y);
        line = word;
        y += 48;
        if (y > 820) break;
      } else line = next;
    }
    if (line && y <= 820) ctx.fillText(line, 700, y);
    return canvas;
  }

  async function rasterizeSvgPicture(cmd) {
    let svg = String(cmd?.svg || "").trim();
    if (!svg.includes("<svg")) return null;
    if (!/^<\?xml/i.test(svg)) svg = `<?xml version="1.0" encoding="UTF-8"?>\n${svg}`;
    if (!/xmlns=/.test(svg)) svg = svg.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"');
    if (!/\swidth=/.test(svg)) svg = svg.replace("<svg", '<svg width="900" height="620"');
    const sources = [
      () => URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" })),
      () => "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg)
    ];
    for (const makeSrc of sources) {
      const url = makeSrc();
      try {
        const img = await new Promise((resolve, reject) => {
          const picture = new Image();
          picture.onload = () => resolve(picture);
          picture.onerror = () => reject(new Error("svg decode"));
          picture.src = url;
        });
        const srcW = Math.max(1, img.naturalWidth || img.width || 900);
        const srcH = Math.max(1, img.naturalHeight || img.height || 620);
        const scale = Math.min(1, 1600 / srcW, 1600 / srcH);
        const rw = Math.max(1, Math.round(srcW * scale));
        const rh = Math.max(1, Math.round(srcH * scale));
        const canvas = document.createElement("canvas");
        canvas.width = rw;
        canvas.height = rh;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, rw, rh);
        ctx.drawImage(img, 0, 0, rw, rh);
        return canvas;
      } catch (err) {
        console.warn("[ATLAS] svg raster try failed:", err);
      } finally {
        if (String(url).startsWith("blob:")) URL.revokeObjectURL(url);
      }
    }
    return fallbackLessonCard(cmd.title, cmd.title);
  }

  async function placeLessonImage(cmd, options = {}) {
    const canvas = await rasterizeSvgPicture(cmd);
    if (!canvas) return null;
    const blob = await canvasBlob(canvas, "image/png");
    if (!blob) return null;
    const image = await imageFromBlob(blob);
    const naturalW = canvas.width;
    const naturalH = canvas.height;
    canvas.width = canvas.height = 1;

    const rect = view.getBoundingClientRect();
    const isMobile = window.innerWidth <= 768 || window.matchMedia("(max-width: 768px)").matches;
    const recentNote = (state.lastLessonNote && (Date.now() - state.lastLessonNote.time < 300000)) ? state.lastLessonNote : null;

    let place;
    if (recentNote && options.skipCamera !== true) {
      const maxPicW = Math.min(3200, Math.max(recentNote.w || 1400, Math.round(rect.width * 1.6)));
      const targetW = Math.min(naturalW, maxPicW);
      const targetH = Math.round(naturalH * (targetW / naturalW));
      place = {
        x: recentNote.x,
        y: Math.max(40, recentNote.y - targetH - 56),
        w: targetW,
        h: targetH
      };
    } else {
      place = importedImagePlacement(naturalW, naturalH);
    }

    const item = imageRecord({
      id: `image-${state.nextImageId++}`,
      ...place,
      blob,
      image,
      naturalW,
      naturalH,
      sourceName: `atlas-lesson:${cmd.title || "Lesson picture"}`
    });
    if (!item) return null;
    if (state.pending) acceptPending({ restoreMode: false });
    recordImagesBefore();
    state.images = state.images.filter((img) => {
      const name = String(img.sourceName || "");
      if (name.startsWith("atlas-lesson:")) return false;
      if (/\.(png|jpe?g|gif|webp|heic|svg)$/i.test(name)) return true;
      return !name;
    });
    if (state.images.length >= MAX_VISIBLE_IMAGES) {
      console.warn("[ATLAS] image skipped — MAX_VISIBLE_IMAGES reached.");
      return null;
    }
    state.images.push(item);
    state.userRevision++;
    save();

    if (options.skipCamera !== true) {
      if (recentNote) {
        const minX = Math.min(recentNote.x, item.x);
        const minY = Math.min(recentNote.y, item.y);
        const maxX = Math.max(recentNote.x + recentNote.w, item.x + item.w);
        const maxY = Math.max(recentNote.y + recentNote.h, item.y + item.h);
        const totalW = maxX - minX;
        const totalH = maxY - minY;
        const fitScale = isMobile
          ? Math.min((rect.width * 0.9) / Math.max(totalW, 1), (rect.height * 0.8) / Math.max(totalH, 1), 0.55)
          : Math.min((rect.width * 0.84) / Math.max(totalW, 1), (rect.height * 0.76) / Math.max(totalH, 1), 0.55);
        state.scale = Math.max(0.14, Math.min(0.55, fitScale));
        state.panX = rect.width / 2 - (minX + totalW / 2) * state.scale;
        state.panY = isMobile
          ? Math.max(60, rect.height * 0.22 - minY * state.scale)
          : rect.height / 2 - (minY + totalH / 2) * state.scale;
      } else {
        const fitScale = Math.min((rect.width * 0.78) / Math.max(item.w, 1), (rect.height * 0.68) / Math.max(item.h, 1), 0.85);
        state.scale = Math.max(0.12, Math.min(0.85, fitScale));
        state.panX = rect.width / 2 - (item.x + item.w / 2) * state.scale;
        state.panY = rect.height / 2 - (item.y + item.h / 2) * state.scale;
      }
    }
    requestRender();
    setStatusKey("ready");
    console.log("[ATLAS] lesson picture placed:", item.id, item.w, "x", item.h);
    return item;
  }

  function restackFlowItems(items, gap = 56) {
    if (!Array.isArray(items) || items.length < 2) return;
    const ordered = [...items].sort((a, b) => (Number(a.y) || 0) - (Number(b.y) || 0));
    let y = Number(ordered[0].y) || 0;
    for (const item of ordered) {
      const h = item.image?.logicalHeight || item.layoutHeight || item.bounds?.h || item.h || 200;
      item.y = y;
      if (item.bounds) item.bounds.y = y;
      y += Math.round(h) + gap;
    }
  }

  window.LUMI6_CANVAS_ADAPTER = {
    // ── diagram_source widgets ─────────────────────────────────────────────────
    // Called for any command with tool === "diagram_source".
    // Creates a proper Lumi6 widget using the internal widgetRecord/mountWidget
    // functions that live in the Lumi6 canvas closure.
    executeWidgetCommand(item) {
      if (!item || (item.tool !== "diagram_source" && item.tool !== "html_widget")) return false;

      // Compute viewport-relative sizing
      const { w, h } = _atlasWidgetSizing(true);
      const rect = view.getBoundingClientRect();
      const canvasCenterX = Math.round((rect.width  / 2 - state.panX) / state.scale);
      const canvasCenterY = Math.round((rect.height / 2 - state.panY) / state.scale);

      const prefX = Math.round(canvasCenterX - w / 2);
      const prefY = Math.round(canvasCenterY - h / 2);

      const { x, y } = findFreeCanvasPosition(prefX, prefY, w, h, 600);

      const widgetItem = {
        ...item,
        x,
        y,
        w,
        h,
        contentW: w,
        contentH: h,
      };
      if (item.copyText === "" || item.copyText === undefined) {
        delete widgetItem.copyText;
        delete widgetItem.copyLabel;
      }

      const widget = widgetRecord(widgetItem);
      if (!widget) {
        console.warn("[ATLAS Stage 7] widgetRecord returned null — invalid command:", item);
        return false;
      }

      if (state.widgets.length >= MAX_VISIBLE_WIDGETS) {
        console.warn("[ATLAS Stage 7] widget skipped — MAX_VISIBLE_WIDGETS reached.");
        return false;
      }

      state.widgets.push(widget);
      // Ensure plugin is enabled for ATLAS generated widgets and mount immediately
      state.plugins[widget.pluginId] = true;
      mountWidget(widget);

      // Suppress copy button AFTER mountWidget
      widget.copyText = "";
      widget.copyLabel = "";

      // Suppress the top of screen confirmation banner/draft status by setting statusKey back to "ready"
      if (typeof setStatusKey === "function") {
        setStatusKey("ready");
      }

      // Pan viewport to center on the widget
      state.panX = rect.width  / 2 - (x + w / 2) * state.scale;
      state.panY = rect.height / 2 - (y + h / 2) * state.scale;
      render();

      console.log("[ATLAS Stage 7] widget mounted:", widget.id, "at", x, y, "size", w, "x", h);
      return true;
    },

    captureBoardImage() {
      try {
        const visible = typeof viewportRect === "function" ? viewportRect() : null;
        if (!visible) return null;
        const ink = typeof visibleInkBounds === "function" ? visibleInkBounds(visible) : null;
        if (!ink || ink.w < 6 || ink.h < 6) return null;
        const margin = Math.max(48, Math.min(280, 80 / Math.max(0.08, state.scale)));
        const left = Math.max(visible.x, ink.x - margin);
        const top = Math.max(visible.y, ink.y - margin);
        const right = Math.min(visible.x + visible.w, ink.x + ink.w + margin);
        const bottom = Math.min(visible.y + visible.h, ink.y + ink.h + margin);
        const sourceRect = { x: left, y: top, w: Math.max(8, right - left), h: Math.max(8, bottom - top) };
        const maxW = 1600, maxH = 1600, targetMin = 960;
        let imageScale = Math.max(targetMin / sourceRect.w, targetMin / sourceRect.h, 2);
        imageScale = Math.min(imageScale, maxW / sourceRect.w, maxH / sourceRect.h, 10);
        const out = document.createElement("canvas");
        out.width = Math.max(1, Math.round(sourceRect.w * imageScale));
        out.height = Math.max(1, Math.round(sourceRect.h * imageScale));
        const q = out.getContext("2d");
        q.fillStyle = "#ffffff";
        q.fillRect(0, 0, out.width, out.height);
        q.imageSmoothingEnabled = false;
        q.setTransform(imageScale, 0, 0, imageScale, -sourceRect.x * imageScale, -sourceRect.y * imageScale);
        q.globalAlpha = 1;
        if (typeof forTiles === "function") {
          forTiles(sourceRect.x, sourceRect.y, sourceRect.w, sourceRect.h, (c, tx, ty) => q.drawImage(c, tx * TILE, ty * TILE), false);
        }
        if (typeof drawTextBoxesToContext === "function") drawTextBoxesToContext(q, sourceRect);
        const png = out.toDataURL("image/png");
        return png && png.startsWith("data:image/png") && png.length > 120 ? png : null;
      } catch (err) {
        console.warn("[ATLAS] board capture failed:", err);
        return null;
      }
    },

    // ── Primitive drawing commands ─────────────────────────────────────────────
    async executeCommands(rawCommands) {
      if (!Array.isArray(rawCommands) || !rawCommands.length) return { success: true, count: 0 };
      window.__atlasTeachingLock = true;
      try {

      // Route diagram_source and html_widget commands through the widget path
      const svgCmds = rawCommands.filter((c) => c?.tool === "svg_picture" || c?.tool === "place_photo");
      const diagramCmds = rawCommands.filter((c) => c?.tool === "diagram_source" || (c?.tool === "html_widget" && c?.pluginId !== "image-search"));
      const primitiveCmds = rawCommands.filter((c) => c?.tool !== "diagram_source" && c?.tool !== "html_widget" && c?.tool !== "svg_picture" && c?.tool !== "place_photo");

      let diagramCount = 0;
      for (const cmd of diagramCmds) {
        if (this.executeWidgetCommand(cmd)) diagramCount++;
      }

      let imageCount = 0;
      let lastPlaced = null;
      for (const cmd of svgCmds) {
        try {
          const placed = await placeLessonImage(cmd, {
            skipCamera: true,
            keepOthers: cmd?.keepOthers === true || cmd?.archivePrevious === true,
            archivePrevious: cmd?.archivePrevious === true
          });
          if (placed) {
            imageCount++;
            lastPlaced = placed;
          }
        } catch (err) {
          console.warn("[ATLAS] svg_picture failed:", err);
        }
      }

      const isMobile = window.innerWidth <= 768 || window.matchMedia("(max-width: 768px)").matches;
      if (lastPlaced) {
        const textMaxWidth = Math.round(lastPlaced.w);
        const noteX = lastPlaced.x;
        let noteY = lastPlaced.y + lastPlaced.h + 56;
        for (const cmd of primitiveCmds) {
          cmd.x = noteX;
          cmd.y = noteY;
          if (cmd.tool === "write_text") {
            cmd.maxWidth = textMaxWidth;
            const rows = Array.isArray(cmd.rows) && cmd.rows.length ? cmd.rows.length : Math.max(2, String(cmd.text || "").split("\n").length);
            noteY += cmd.isLessonNote
              ? 120 + rows * 86
              : Math.round((cmd.fontSize || 34) * (cmd.lineHeight || 1.4) * rows + 48);
          } else {
            noteY += Math.round((cmd.fontSize || 40) * 2.4);
          }
        }
      }

      const rect = view.getBoundingClientRect();
      const canvasCenterX = Math.round((rect.width / 2 - state.panX) / state.scale);
      const canvasCenterY = Math.round((rect.height / 2 - state.panY) / state.scale);

      if (!lastPlaced && primitiveCmds.length) {
        let noteY = Math.max(100, Math.round(canvasCenterY - 300));
        for (const cmd of primitiveCmds) {
          if (!Number.isFinite(cmd.maxWidth)) cmd.maxWidth = Math.min(1680, Math.max(900, Math.round((rect.width * 0.72) / Math.max(state.scale, 0.2))));
          if (!Number.isFinite(cmd.x)) {
            cmd.x = isMobile
              ? Math.max(40, Math.round(canvasCenterX - cmd.maxWidth / 2))
              : Math.max(60, Math.round(canvasCenterX - cmd.maxWidth - 120));
          }
          if (!Number.isFinite(cmd.y)) {
            cmd.y = noteY;
            if (cmd.tool === "write_text") {
              const charsPerLine = Math.max(24, Math.floor(cmd.maxWidth / Math.max(36, (cmd.fontSize || 135) * 0.52)));
              const lines = Math.max(1, Math.ceil(String(cmd.text || "").length / charsPerLine));
              noteY += Math.round((cmd.fontSize || 135) * (cmd.lineHeight || 1.35) * lines + 56);
            } else {
              noteY += Math.round((cmd.fontSize || 150) * 2.4);
            }
          }
        }
      }

      const GAP = 250;
      const meta = { requestId: `atlas_${Date.now()}` };
      const items = [];

      if (!primitiveCmds.length && !items.length) {
        if (lastPlaced) {
          const recentNote = (state.lastLessonNote && (Date.now() - state.lastLessonNote.time < 300000)) ? state.lastLessonNote : null;
          if (recentNote) {
            const minX = Math.min(recentNote.x, lastPlaced.x);
            const minY = Math.min(recentNote.y, lastPlaced.y);
            const maxX = Math.max(recentNote.x + recentNote.w, lastPlaced.x + lastPlaced.w);
            const maxY = Math.max(recentNote.y + recentNote.h, lastPlaced.y + lastPlaced.h);
            const totalW = maxX - minX;
            const totalH = maxY - minY;
            const fitScale = isMobile
              ? Math.min((rect.width * 0.9) / Math.max(totalW, 1), (rect.height * 0.8) / Math.max(totalH, 1), 0.55)
              : Math.min((rect.width * 0.84) / Math.max(totalW, 1), (rect.height * 0.76) / Math.max(totalH, 1), 0.55);
            state.scale = Math.max(0.14, Math.min(0.55, fitScale));
            state.panX = rect.width / 2 - (minX + totalW / 2) * state.scale;
            state.panY = isMobile
              ? Math.max(60, rect.height * 0.22 - minY * state.scale)
              : rect.height / 2 - (minY + totalH / 2) * state.scale;
          } else {
            const fitScale = Math.min((rect.width * 0.82) / Math.max(lastPlaced.w, 1), (rect.height * 0.72) / Math.max(lastPlaced.h, 1), 0.5);
            state.scale = Math.max(0.16, Math.min(0.5, fitScale));
            state.panX = rect.width / 2 - (lastPlaced.x + lastPlaced.w / 2) * state.scale;
            state.panY = rect.height / 2 - (lastPlaced.y + lastPlaced.h / 2) * state.scale;
          }
          render();
        }
        if ((diagramCount > 0 || imageCount > 0) && typeof setStatusKey === "function") setStatusKey("ready");
        if (typeof syncTalkModeFeed === "function") syncTalkModeFeed();
        return { success: diagramCount + imageCount > 0, count: diagramCount + imageCount };
      }

      const commands = primitiveCmds.length
        ? validate(primitiveCmds, state.aiColor, null, { x: 0, y: 0, w: SIZE, h: SIZE })
        : [];
      if (primitiveCmds.length && (!commands || !commands.length) && !items.length) {
        return { success: false, count: 0 };
      }

      for (const c of commands || []) {
        try {
          const item = await preparePendingItem(c, null, meta, state.userRevision);
          if (item) items.push(item);
        } catch (err) {
          console.warn("[ATLAS] preparePendingItem failed:", err);
        }
      }

      restackFlowItems(items, 80);

      if (!items.length) {
        if (lastPlaced) {
          const fitScale = Math.min((rect.width * 0.82) / Math.max(lastPlaced.w, 1), (rect.height * 0.72) / Math.max(lastPlaced.h, 1), 0.5);
          state.scale = Math.max(0.16, Math.min(0.5, fitScale));
          state.panX = rect.width / 2 - (lastPlaced.x + lastPlaced.w / 2) * state.scale;
          state.panY = rect.height / 2 - (lastPlaced.y + lastPlaced.h / 2) * state.scale;
          render();
        }
        if (typeof syncTalkModeFeed === "function") syncTalkModeFeed();
        return { success: diagramCount + imageCount > 0, count: diagramCount + imageCount };
      }

      // ── 2. Compute TRUE bounding box of the entire generated group ─────────
      let groupMinX = Infinity, groupMinY = Infinity, groupMaxX = -Infinity, groupMaxY = -Infinity;
      for (const item of items) {
        const ix = Number.isFinite(item.x) ? item.x : (item.bounds?.x ?? 10000);
        const iy = Number.isFinite(item.y) ? item.y : (item.bounds?.y ?? 10000);
        const iw = item.image?.logicalWidth || item.image?.width || item.layoutWidth || item.bounds?.w || item.w || 300;
        const ih = item.image?.logicalHeight || item.image?.height || item.layoutHeight || item.bounds?.h || item.h || 200;

        groupMinX = Math.min(groupMinX, ix);
        groupMinY = Math.min(groupMinY, iy);
        groupMaxX = Math.max(groupMaxX, ix + iw);
        groupMaxY = Math.max(groupMaxY, iy + ih);
      }
      if (lastPlaced) {
        groupMinX = Math.min(groupMinX, lastPlaced.x);
        groupMinY = Math.min(groupMinY, lastPlaced.y);
        groupMaxX = Math.max(groupMaxX, lastPlaced.x + lastPlaced.w);
        groupMaxY = Math.max(groupMaxY, lastPlaced.y + lastPlaced.h);
      }

      const groupW = Math.max(250, Math.round(groupMaxX - groupMinX));
      const groupH = Math.max(200, Math.round(groupMaxY - groupMinY));

      // ── 3. Determine collision-free target position for the complete group ─
      let prefX, prefY;
      if (_atlasDrawCursor === null) {
        prefX = Math.max(500, Math.min(SIZE - groupW - 500, canvasCenterX - Math.round(groupW / 2)));
        prefY = Math.max(500, Math.min(SIZE - groupH - 500, canvasCenterY - Math.round(groupH / 2)));
      } else {
        prefX = _atlasDrawCursor.x;
        prefY = Math.min(SIZE - groupH - 500, _atlasDrawCursor.y + GAP);
      }

      const { x: targetX, y: targetY } = findFreeCanvasPosition(prefX, prefY, groupW, groupH, GAP);

      // ── 4. Shift ALL elements in the group coherently as ONE logical output ──
      const shiftX = targetX - groupMinX;
      const shiftY = targetY - groupMinY;

      if (lastPlaced) {
        lastPlaced.x += shiftX;
        lastPlaced.y += shiftY;
      }

      for (const item of items) {
        if (Number.isFinite(item.x)) item.x += shiftX;
        if (Number.isFinite(item.y)) item.y += shiftY;
        if (item.command && item.command.tool === "draw" && Array.isArray(item.command.origin)) {
          item.command.origin[0] += shiftX;
          item.command.origin[1] += shiftY;
        }
        if (item.bounds) {
          item.bounds.x += shiftX;
          item.bounds.y += shiftY;
        }

        // Record handwritten lesson note coordinates so the photo is placed beside it
        if (item.command && item.command.tool === "write_text") {
          const w = item.image?.logicalWidth || item.image?.width || item.layoutWidth || 300;
          const h = item.image?.logicalHeight || item.image?.height || item.layoutHeight || 200;
          state.lastLessonNote = {
            id: item.command.id || `note-${Date.now()}`,
            x: item.x,
            y: item.y,
            w,
            h,
            isLessonNote: Boolean(item.command.isLessonNote),
            time: Date.now()
          };
          if (item.command.title && typeof noteLessonTitle === "function") {
            noteLessonTitle(item.command.title);
          }
        }
      }

      startPendingBatch(items, state.userRevision, meta);
      if (state.pending) acceptPending({ restoreMode: false, force: true });

      // ── 5. Record EXACT footprint & update draw cursor ─────────────────────
      _atlasDrawCursor = { x: targetX, y: targetY + groupH };

      if (!Array.isArray(state.atlasDrawnBoxes)) {
        state.atlasDrawnBoxes = [];
      }
      state.atlasDrawnBoxes.push({
        x: targetX,
        y: targetY,
        w: groupW,
        h: groupH
      });

      // ── 6. Zoom and pan so the lesson fills the view ───────────────────────
      const drawCenterX = targetX + Math.round(groupW / 2);
      const drawCenterY = targetY + Math.round(groupH / 2);
      const fitScale = Math.min((rect.width * 0.84) / Math.max(groupW, 1), (rect.height * 0.76) / Math.max(groupH, 1), 0.55);
      state.scale = Math.max(0.08, Math.min(0.55, fitScale));
      state.panX = rect.width / 2 - drawCenterX * state.scale;
      state.panY = rect.height / 2 - drawCenterY * state.scale;

      render();
      if (typeof syncTalkModeFeed === "function") syncTalkModeFeed();

      return { success: true, count: items.length + diagramCount + imageCount };
      } finally {
        window.__atlasTeachingLock = false;
      }
    }
  };
  window.lumi6BoardState = state;
  window.lumi6BoardRender = render;
  window.lumi6ApplyBoardTitle = applyBoardTitle;
  window.lumi6MaybeNameBoardFromText = maybeNameBoardFromText;
  window.LUMI6_BOARD_READY = true;
})();
