  function textEditorScreenPoint(editor) {
    return { left: editor.x * state.scale + state.panX, top: editor.y * state.scale + state.panY };
  }
  function textEditorViewportSize() {
    const rect = view.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  }
  function resizeTextEditorDimensions(gesture, hit, dx, dy, minWidth, minHeight, maxWidth, maxHeight) {
    const startWidth = gesture.startWidth,
      startHeight = gesture.startHeight,
      startFontCss = gesture.startFontCss,
      scale = Math.max(0.03, state.scale);
    let widthCss = startWidth,
      heightCss = startHeight,
      fontCss = startFontCss,
      x = gesture.startX,
      y = gesture.startY,
      autoHeight = false;
    const clampW = (value) => Math.max(minWidth, Math.min(maxWidth, value));
    const clampH = (value) => Math.max(minHeight, Math.min(maxHeight, value));
    const applyWest = (width) => { x = gesture.startX + (startWidth - width) / scale; };
    const applyNorth = (height) => { y = gesture.startY + (startHeight - height) / scale; };
    if (hit === "e" || hit === "width") {
      widthCss = clampW(startWidth + dx);
      autoHeight = true;
    } else if (hit === "w") {
      widthCss = clampW(startWidth - dx);
      applyWest(widthCss);
      autoHeight = true;
    } else if (hit === "s" || hit === "height") {
      heightCss = clampH(startHeight + dy);
      fontCss = Math.max(16, Math.min(120, startFontCss * (heightCss / Math.max(1, startHeight))));
    } else if (hit === "n") {
      heightCss = clampH(startHeight - dy);
      fontCss = Math.max(16, Math.min(120, startFontCss * (heightCss / Math.max(1, startHeight))));
      applyNorth(heightCss);
    } else {
      const sx = hit.includes("w") ? -1 : 1;
      const sy = hit.includes("n") ? -1 : 1;
      const requested = Math.max((startWidth + sx * dx) / Math.max(1, startWidth), (startHeight + sy * dy) / Math.max(1, startHeight));
      const minimumScale = Math.max(minWidth / startWidth, minHeight / startHeight, 16 / startFontCss);
      const maximumScale = Math.max(minimumScale, Math.min(maxWidth / startWidth, maxHeight / startHeight, 120 / startFontCss));
      const factor = Math.max(minimumScale, Math.min(maximumScale, requested));
      widthCss = startWidth * factor;
      heightCss = startHeight * factor;
      fontCss = startFontCss * factor;
      if (hit.includes("w")) applyWest(widthCss);
      if (hit.includes("n")) applyNorth(heightCss);
    }
    return { widthCss, heightCss, fontCss, x, y, autoHeight };
  }
  function keepTextEditorInsideCanvas(editor) {
    const logicalWidth = editor.widthCss / Math.max(0.03, state.scale),
      logicalHeight = editor.heightCss / Math.max(0.03, state.scale);
    editor.x = Math.max(0, Math.min(SIZE - logicalWidth, editor.x));
    editor.y = Math.max(0, Math.min(SIZE - logicalHeight, editor.y));
  }
  function keepTextEditorVisible(editor) {
    const viewport = textEditorViewportSize(),
      inset = 12,
      scale = Math.max(0.03, state.scale),
      point = textEditorScreenPoint(editor),
      widthCss = Math.max(TEXT_EDITOR_MIN_WIDTH, editor.widthCss),
      heightCss = Math.max(TEXT_EDITOR_MIN_HEIGHT, editor.heightCss),
      maxLeft = Math.max(inset, viewport.width - widthCss - inset),
      maxTop = Math.max(inset, viewport.height - heightCss - inset),
      canvasLeft = state.panX,
      canvasTop = state.panY,
      canvasRight = state.panX + SIZE * scale - widthCss,
      canvasBottom = state.panY + SIZE * scale - heightCss,
      minLeft = Math.max(inset, canvasLeft),
      minTop = Math.max(inset, canvasTop),
      boundedMaxLeft = Math.min(maxLeft, canvasRight),
      boundedMaxTop = Math.min(maxTop, canvasBottom),
      left = boundedMaxLeft >= minLeft ? Math.min(boundedMaxLeft, Math.max(minLeft, point.left)) : Math.min(maxLeft, Math.max(inset, point.left)),
      top = boundedMaxTop >= minTop ? Math.min(boundedMaxTop, Math.max(minTop, point.top)) : Math.min(maxTop, Math.max(inset, point.top));
    if (Math.abs(left - point.left) > 0.5) editor.x = (left - state.panX) / scale;
    if (Math.abs(top - point.top) > 0.5) editor.y = (top - state.panY) / scale;
    keepTextEditorInsideCanvas(editor);
  }
  function panToRevealTextEditor(editor) {
    if (!editor) return;
    const viewport = textEditorViewportSize(),
      pad = 16,
      point = textEditorScreenPoint(editor);
    let dx = 0,
      dy = 0;
    if (point.left < pad) dx = pad - point.left;
    else if (point.left + editor.widthCss > viewport.width - pad) dx = viewport.width - pad - (point.left + editor.widthCss);
    if (point.top < pad) dy = pad - point.top;
    else if (point.top + editor.heightCss > viewport.height - pad) dy = viewport.height - pad - (point.top + editor.heightCss);
    if (!dx && !dy) return;
    state.panX += dx;
    state.panY += dy;
    updateCoordinates();
    requestRender();
    keepTextEditorVisible(editor);
  }
  function applyTextEditorLayout(editor) {
    const el = editor?.element;
    if (!el) return;
    const point = textEditorScreenPoint(editor);
    el.style.position = "absolute";
    el.style.left = `${Math.round(point.left)}px`;
    el.style.top = `${Math.round(point.top)}px`;
    el.style.width = `${Math.round(editor.widthCss)}px`;
    if (editor.resized) el.style.height = `${Math.round(editor.heightCss)}px`;
    else el.style.height = "auto";
    el.style.zIndex = String(editor.zIndex || 1);
    el.style.setProperty("--text-editor-font-size", `${editor.fontCss}px`);
    el.style.setProperty("--text-editor-ink", editor.color || state.inkColor);
    el.style.setProperty("--text-editor-font-family", state.aiFont || TEXT_EDITOR_FONT_FAMILY);
    if (editor.previewLogicalWidth) el.style.setProperty("--text-editor-preview-width", `${editor.previewLogicalWidth}px`);
    else el.style.removeProperty("--text-editor-preview-width");
    if (editor.previewLogicalHeight) el.style.setProperty("--text-editor-preview-height", `${editor.previewLogicalHeight}px`);
    else el.style.removeProperty("--text-editor-preview-height");
  }
  function positionTextEditors() {
    const visible = state.textEditors.size > 0;
    textEditorLayer.hidden = !visible;
    textInputHint.hidden = !visible;
    for (const editor of state.textEditors.values()) {
      keepTextEditorInsideCanvas(editor);
      keepTextEditorVisible(editor);
      applyTextEditorLayout(editor);
      editor.element.classList.toggle("active", editor.id === state.activeTextEditorId);
    }
    textEditorLayer.setAttribute("aria-hidden", String(!visible));
  }
  function textEditorStyleSheet() {
    if (state.textEditorStyleSheet) return state.textEditorStyleSheet;
    state.textEditorStyleSheet = [...document.styleSheets].find((sheet) => /(?:^|\/)style\.css(?:\?|$)/.test(sheet.href || "")) || null;
    return state.textEditorStyleSheet;
  }
  function addTextEditorStyleRule(editor) {
    applyTextEditorLayout(editor);
  }
  function removeTextEditorStyleRule(editor) {
    editor.styleRule = null;
  }
  function focusTextEditor(editor, input = false) {
    if (!editor) return;
    state.activeTextEditorId = editor.id;
    editor.zIndex = ++state.nextTextEditorZ;
    positionTextEditors();
    if (input && !editor.textarea.hidden) editor.textarea.focus({ preventScroll: true });
  }
  function textEditorPointerDown(event, editor, hit) {
    event.preventDefault();
    event.stopPropagation();
    focusTextEditor(editor, hit === "body");
    if (hit === "body") return;
    editor.gesture = {
      id: event.pointerId,
      hit,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: editor.x,
      startY: editor.y,
      startWidth: editor.widthCss,
      startHeight: editor.heightCss,
      startFontCss: editor.fontCss,
    };
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch {}
  }
  function updateTextEditorGesture(event, editor) {
    const gesture = editor.gesture;
    if (!gesture || gesture.id !== event.pointerId) return;
    const dx = event.clientX - gesture.startClientX,
      dy = event.clientY - gesture.startClientY,
      viewport = textEditorViewportSize();
    if (gesture.hit === "move") {
      editor.x = gesture.startX + dx / Math.max(0.03, state.scale);
      editor.y = gesture.startY + dy / Math.max(0.03, state.scale);
      editor.moved = true;
    } else {
      const point = textEditorScreenPoint(editor),
        maxWidth = Math.max(TEXT_EDITOR_MIN_WIDTH, viewport.width - Math.max(8, point.left) - 8),
        maxHeight = Math.max(TEXT_EDITOR_MIN_HEIGHT, viewport.height - Math.max(8, point.top) - 8),
        next = resizeTextEditorDimensions(gesture, gesture.hit, dx, dy, TEXT_EDITOR_MIN_WIDTH, TEXT_EDITOR_MIN_HEIGHT, maxWidth, maxHeight);
      editor.widthCss = next.widthCss;
      editor.heightCss = next.heightCss;
      editor.fontCss = next.fontCss;
      editor.x = next.x;
      editor.y = next.y;
      editor.resized = true;
      if (next.autoHeight) fitTextEditorToContent(editor);
      if (editor.mixedMode && (gesture.hit === "width" || gesture.hit === "e" || gesture.hit === "w" || gesture.hit === "corner" || /[ne]/.test(gesture.hit))) scheduleTextEditorPreview(editor);
    }
    positionTextEditors();
  }
  function finishTextEditorGesture(event, editor) {
    if (editor.gesture?.id !== event.pointerId) return;
    const hit = editor.gesture.hit;
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch {}
    editor.gesture = null;
    if (editor.mixedMode && (hit === "width" || hit === "corner")) scheduleTextEditorPreview(editor, 0);
  }
  function textEditorButton(button, key, className) {
    button.type = "button";
    button.className = `text-editor-button ${className || ""}`;
    button.dataset.i18nTitle = key;
    button.dataset.i18nAria = key;
    button.setAttribute("aria-label", t(key));
    button.setAttribute("title", t(key));
    if (className === "confirm") button.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m4.5 10.3 3.4 3.4 7.8-8"/></svg>';
    else if (className === "cancel") button.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5.5 5.5 14.5 14.5M14.5 5.5 5.5 14.5"/></svg>';
    else button.textContent = t(key);
    return button;
  }
  function removeTextEditor(editor) {
    if (!editor) return;
    editor.cancelled = true;
    cancelTextEditorPreview(editor, true);
    removeTextEditorStyleRule(editor);
    editor.element.remove();
    state.textEditors.delete(editor.id);
    if (state.activeTextEditorId === editor.id) {
      const next = state.textEditors.values().next().value || null;
      if (next) focusTextEditor(next);
      else state.activeTextEditorId = null;
    }
    positionTextEditors();
  }
  function clearTextEditors() {
    for (const editor of state.textEditors.values()) {
      editor.cancelled = true;
      cancelTextEditorPreview(editor, true);
      removeTextEditorStyleRule(editor);
      editor.element.remove();
    }
    state.textEditors.clear();
    state.activeTextEditorId = null;
    state.selectedTextBoxId = null;
    state.textTap = null;
    positionTextEditors();
  }
  function cancelTextEditorPreview(editor, clear = false) {
    if (!editor) return;
    clearTimeout(editor.previewTimer);
    editor.previewTimer = 0;
    editor.previewRevision++;
    if (!clear || !editor.preview) return;
    editor.preview.replaceChildren();
    editor.preview.removeAttribute("aria-busy");
    editor.preview.removeAttribute("data-fallback");
    editor.previewLogicalWidth = 0;
    editor.previewLogicalHeight = 0;
  }
  async function renderTextEditorPreview(editor) {
    if (!editor?.preview || !editor.mixedMode || editor.committing || editor.cancelled || state.textEditors.get(editor.id) !== editor) return;
    const revision = ++editor.previewRevision,
      text = editor.textarea.value,
      fontCss = editor.fontCss,
      maxWidth = Math.max(fontCss * 3, editor.widthCss - 16),
      color = editor.color || state.inkColor;
    editor.preview.setAttribute("aria-busy", "true");
    let image,
      fallback = false;
    try {
      image = await mixedTextImage(text, fontCss, color, maxWidth, 1.35, state.aiFont || TEXT_EDITOR_FONT_FAMILY, Math.min(3, devicePixelRatio || 1));
    } catch {
      image = textImage(text, fontCss, color, maxWidth, 1.35, state.aiFont || TEXT_EDITOR_FONT_FAMILY, TEXT_INPUT_MAX_LENGTH, Math.min(3, devicePixelRatio || 1));
      fallback = true;
    }
    if (editor.cancelled || editor.committing || !editor.mixedMode || editor.previewRevision !== revision || state.textEditors.get(editor.id) !== editor) return;
    image.classList.add("text-editor-preview-canvas");
    editor.previewLogicalWidth = image.logicalWidth || image.width;
    editor.previewLogicalHeight = image.logicalHeight || image.height;
    editor.preview.replaceChildren(image);
    editor.preview.toggleAttribute("data-fallback", fallback);
    editor.preview.setAttribute("aria-label", text || t("textPreview"));
    editor.preview.setAttribute("aria-busy", "false");
    positionTextEditors();
  }
  function scheduleTextEditorPreview(editor, delay = TEXT_EDITOR_PREVIEW_INTERVAL_MS) {
    if (!editor?.mixedMode || editor.committing || editor.cancelled) return;
    if (delay > 0 && editor.previewTimer) return;
    clearTimeout(editor.previewTimer);
    editor.previewTimer = setTimeout(() => {
      editor.previewTimer = 0;
      void renderTextEditorPreview(editor);
    }, Math.max(0, delay));
  }
  function updateTextEditorMixedMode(editor) {
    const button = editor?.mixedModeButton;
    if (!button) return;
    const labelKey = editor.mixedMode ? "textEditMode" : "textMixedMode";
    button.classList.toggle("active", editor.mixedMode);
    button.setAttribute("aria-pressed", String(editor.mixedMode));
    button.dataset.i18nTitle = labelKey;
    button.dataset.i18nAria = labelKey;
    button.setAttribute("aria-label", t(labelKey));
    button.setAttribute("title", t(labelKey));
    editor.element.classList.toggle("previewing", editor.mixedMode);
    if (editor.textarea) editor.textarea.hidden = Boolean(editor.mixedMode && editor.preview);
    if (editor.preview) editor.preview.hidden = !editor.mixedMode;
  }
  function toggleTextEditorMixedMode(editor) {
    if (!editor || editor.committing) return;
    editor.mixedMode = !editor.mixedMode;
    updateTextEditorMixedMode(editor);
    if (editor.mixedMode) {
      focusTextEditor(editor);
      scheduleTextEditorPreview(editor, 0);
      editor.preview?.focus({ preventScroll: true });
    } else {
      cancelTextEditorPreview(editor, true);
      focusTextEditor(editor, true);
    }
  }
  function openTextHelp(editor, invoker) {
    const dialog = document.querySelector("#textHelpDialog");
    if (!dialog) return;
    if (editor && state.textEditors.get(editor.id) === editor) focusTextEditor(editor);
    textHelpInvoker = invoker || null;
    if (!dialog.open) dialog.showModal();
  }
  function closeTextHelp() {
    const dialog = document.querySelector("#textHelpDialog");
    if (dialog?.open) dialog.close();
  }
  function restoreTextEditorAfterHelp() {
    blockCanvasInput(300);
    const invoker = textHelpInvoker;
    textHelpInvoker = null;
    if (invoker?.isConnected && !invoker.disabled) invoker.focus({ preventScroll: true });
  }
  function textEditorContentOffset() {
    return { x: 10, y: 32 };
  }
  function fitTextEditorToContent(editor) {
    const textarea = editor?.textarea;
    const el = editor?.element;
    if (!textarea || !el) return;
    el.style.height = "auto";
    textarea.style.flexGrow = "0";
    textarea.style.flexShrink = "0";
    textarea.style.flexBasis = "auto";
    textarea.style.minHeight = "0";
    textarea.style.height = "0px";
    const font = editor.fontCss || TEXT_EDITOR_FONT_CSS;
    const contentH = Math.max(Math.ceil(font * 1.3), Math.ceil(textarea.scrollHeight));
    textarea.style.height = `${contentH}px`;
    const chromeH = el.querySelector(".text-editor-chrome")?.offsetHeight || 28;
    editor.heightCss = chromeH + contentH + 4;
  }

  async function confirmTextEditor(editor) {
    if (!editor) return;
    if (editor.commitPromise) return editor.commitPromise;
    const text = editor.textarea.value;
    if (!text.trim()) {
      setStatusKey("textEmpty");
      return;
    }
    const commitPromise = (async () => {
      editor.committing = true;
      editor.cancelled = false;
      editor.element.classList.add("committing");
      cancelTextEditorPreview(editor);
      blockCanvasInput(TEXT_INPUT_GUARD_MS);
      if (!editor.returnMode && state.mode === "text") setCanvasMode("pen");
      supersedeActiveAI("text-input-confirmed");
      clearTimeout(state.timer);
      state.timer = 0;
      editor.element.querySelectorAll("button").forEach((button) => (button.disabled = true));
      const contentOffset = textEditorContentOffset(editor),
        editorScale = Math.max(0.03, state.scale);
      editor.x += contentOffset.x / editorScale;
      editor.y += contentOffset.y / editorScale;
      editor.mixedMode = true;
      const proposedFontSize = editor.fontCss / Math.max(0.03, state.scale);
      let fontSize = editor.sourceTextBoxId && !editor.resized ? editor.sourceFontSize : proposedFontSize,
        proposedMaxWidth = Math.max(fontSize * 3, (editor.widthCss - 16) / Math.max(0.03, state.scale)),
        color = editor.color || state.inkColor;
      let maxWidth = editor.sourceTextBoxId && !editor.resized ? editor.sourceMaxWidth : proposedMaxWidth,
        x = editor.sourceTextBoxId && !editor.moved ? editor.sourceX : editor.x,
        y = editor.sourceTextBoxId && !editor.moved ? editor.sourceY : editor.y;
      const fitted = await fittedTextBoxContent(text, fontSize, color, maxWidth);
      if (editor.cancelled || state.textEditors.get(editor.id) !== editor) return;
      const image = fitted.image,
        mixedFallback = fitted.mixedFallback,
        width = fitted.width,
        height = fitted.height;
      fontSize = fitted.fontSize;
      maxWidth = fitted.maxWidth;
      x = Math.max(0, Math.min(SIZE - width, x));
      y = Math.max(0, Math.min(SIZE - height, y));
      const
        box = { x, y, w: width, h: height },
        existingIndex = editor.sourceTextBoxId ? state.textBoxes.findIndex((item) => item.id === editor.sourceTextBoxId) : -1;
      recordTextBoxesBefore();
      const item = {
        id:existingIndex >= 0 ? state.textBoxes[existingIndex].id : `text-box-${state.nextTextBoxId++}`,
        x,
        y,
        w:width,
        h:height,
        maxWidth,
        fontSize,
        color,
        text,
        image,
      };
      if (existingIndex >= 0) state.textBoxes.splice(existingIndex, 1, item);
      else state.textBoxes.push(item);
      state.userRevision++;
      mergeDirtyBox(box);
      state.latestTypedInput = { text: text.slice(0, TEXT_INPUT_MAX_LENGTH), box };
      state.hotspotTrail.push({ x: x + width / 2, y: y + height / 2 });
      if (state.hotspotTrail.length > 512) state.hotspotTrail.splice(0, state.hotspotTrail.length - 512);
      state.autoEligible = true;
      state.selectedTextBoxId = null;
      removeTextEditor(editor);
      blockCanvasInput(TEXT_INPUT_GUARD_MS);
      restoreTextEditorMode(editor);
      save();
      render();
      setStatusKey(mixedFallback ? "textMixedModeError" : "ready");
      if (state.auto) schedule(Math.max(1000, state.autoDelayMs));
    })();
    editor.commitPromise = commitPromise;
    try {
      return await commitPromise;
    } finally {
      if (editor.commitPromise === commitPromise) editor.commitPromise = null;
    }
  }
  function restoreTextEditorMode(editor) {
    const returnMode = editor?.returnMode;
    if (returnMode && state.mode === "hand") {
      setCanvasMode(returnMode, {
        preserveSelection:true,
        skipDraftFinalize:true,
        preserveWidgetRefinement:true,
      });
    } else if (!returnMode && state.mode === "text") setCanvasMode("pen");
  }
  function cancelTextEditor(editor) {
    if (!editor || editor.committing) return;
    if (editor.sourceTextBoxId) state.selectedTextBoxId = null;
    removeTextEditor(editor);
    blockCanvasInput(TEXT_INPUT_GUARD_MS);
    if (editor.returnMode) restoreTextEditorMode(editor);
    else setCanvasMode("pen");
    render();
    setStatusKey("ready");
    if (!state.textEditors.size && state.auto && state.autoEligible) schedule(Math.max(1000, state.autoDelayMs));
  }
  function createTextEditor(point, options = null) {
    options ||= {};
    if (!options.sourceTextBoxId && state.textEditors.size) {
      for (const open of [...state.textEditors.values()]) void confirmTextEditor(open);
    }
    if (!options.sourceTextBoxId && state.textBoxes.length >= MAX_VISIBLE_TEXT_BOXES) return null;
    supersedeActiveAI("text-input-started");
    if (!state.timer && state.auto && state.dirty && state.autoEligible) schedule();
    const viewport = textEditorViewportSize();
    const widthCss = Math.min(Number(options.widthCss) || TEXT_EDITOR_DEFAULT_WIDTH, Math.max(TEXT_EDITOR_MIN_WIDTH, viewport.width - 24));
    let heightCss = Math.min(Number(options.heightCss) || TEXT_EDITOR_DEFAULT_HEIGHT, Math.max(TEXT_EDITOR_MIN_HEIGHT, viewport.height - 24));
    if (!options.heightCss) heightCss = TEXT_EDITOR_MIN_HEIGHT;
    const editor = {
        id: state.nextTextEditorId++,
        x: point.x,
        y: point.y,
        widthCss,
        heightCss,
        fontCss: Number(options.fontCss) || TEXT_EDITOR_FONT_CSS,
        zIndex: 1,
        mixedMode: false,
        previewRevision: 0,
        previewTimer: 0,
        previewLogicalWidth: 0,
        previewLogicalHeight: 0,
        committing: false,
        cancelled: false,
        gesture: null,
        returnMode:typeof options.returnMode === "string" ? options.returnMode : "",
        sourceTextBoxId:typeof options.sourceTextBoxId === "string" ? options.sourceTextBoxId : "",
        sourceX:Number(options.sourceX),
        sourceY:Number(options.sourceY),
        sourceMaxWidth:Number(options.sourceMaxWidth),
        sourceFontSize:Number(options.sourceFontSize),
        moved:false,
        resized:false,
        color:typeof options.color === "string" ? options.color : state.inkColor,
      },
      root = document.createElement("section"),
      mixedModeButton = document.createElement("button"),
      textarea = document.createElement("textarea");
    editor.element = root;
    editor.textarea = textarea;
    editor.preview = null;
    editor.body = null;
    editor.mixedModeButton = mixedModeButton;
    root.className = "text-editor active";
    root.dataset.editorId = String(editor.id);
    root.dataset.i18nAria = "text";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-label", t("text"));
    mixedModeButton.hidden = true;
    textarea.className = "text-editor-input";
    textarea.rows = 1;
    textarea.maxLength = TEXT_INPUT_MAX_LENGTH;
    textarea.dataset.i18nPlaceholder = "textPlaceholder";
    textarea.dataset.i18nAria = "text";
    textarea.placeholder = t("textPlaceholder");
    textarea.setAttribute("aria-label", t("text"));
    textarea.value = typeof options.text === "string" ? options.text.slice(0, TEXT_INPUT_MAX_LENGTH) : "";
    const chrome = document.createElement("div");
    chrome.className = "text-editor-chrome";
    const drag = document.createElement("span");
    drag.className = "text-editor-drag";
    drag.textContent = "Move";
    const del = document.createElement("button");
    del.type = "button";
    del.className = "text-editor-delete";
    del.setAttribute("aria-label", "Delete text");
    del.textContent = "Delete";
    chrome.append(drag, del);
    root.append(chrome, textarea);
    drag.addEventListener("pointerdown", (event) => textEditorPointerDown(event, editor, "move"));
    del.addEventListener("pointerdown", (event) => event.stopPropagation());
    del.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      deleteTextEditorTarget(editor);
    });
    for (const kind of ["n", "ne", "e", "se", "s", "sw", "w", "nw"]) {
      const handle = document.createElement("span");
      handle.className = `text-editor-handle ${kind}`;
      handle.dataset.textHandle = kind;
      root.append(handle);
      handle.addEventListener("pointerdown", (event) => textEditorPointerDown(event, editor, kind));
    }
    root.addEventListener("pointerdown", (event) => {
      if (event.target === textarea || event.target.closest(".text-editor-handle")) return;
      textEditorPointerDown(event, editor, "move");
    });
    root.addEventListener("pointermove", (event) => updateTextEditorGesture(event, editor));
    root.addEventListener("pointerup", (event) => finishTextEditorGesture(event, editor));
    root.addEventListener("pointercancel", (event) => finishTextEditorGesture(event, editor));
    textarea.addEventListener("focus", () => focusTextEditor(editor));
    textarea.addEventListener("input", () => {
      fitTextEditorToContent(editor);
      positionTextEditors();
    });
    textarea.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        cancelTextEditor(editor);
        return;
      }
      if ((event.key === "Backspace" || event.key === "Delete") && !String(editor.textarea.value || "") && editor.sourceTextBoxId) {
        event.preventDefault();
        deleteTextEditorTarget(editor);
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        void confirmTextEditor(editor);
      }
    });
    textarea.addEventListener("blur", () => {
      if (editor.committing || editor.cancelled || editor.gesture) return;
      window.setTimeout(() => {
        if (editor.cancelled || editor.committing || !state.textEditors.has(editor.id)) return;
        if (editor.element.contains(document.activeElement)) return;
        if (String(editor.textarea.value || "").trim()) void confirmTextEditor(editor);
        else cancelTextEditor(editor);
      }, 80);
    });
    textEditorLayer.append(root);
    addTextEditorStyleRule(editor);
    updateTextEditorMixedMode(editor);
    keepTextEditorInsideCanvas(editor);
    state.textEditors.set(editor.id, editor);
    fitTextEditorToContent(editor);
    keepTextEditorVisible(editor);
    panToRevealTextEditor(editor);
    focusTextEditor(editor, true);
    positionTextEditors();
    return editor;
  }
  function editTextBox(item) {
    if (state.mode !== "hand" || !item || !state.textBoxes.includes(item) || state.textEditors.size) return false;
    if (state.widgetEdit) acceptWidgetEdit();
    if (state.imageEdit) acceptImageEdit({ restoreMode:false });
    if (state.animationEdit) acceptAnimationEdit();
    state.selectedTextBoxId = item.id;
    const scale = Math.max(.03, state.scale),
      editor = createTextEditor({ x:item.x, y:item.y }, {
        text:item.text,
        widthCss:Math.max(TEXT_EDITOR_MIN_WIDTH, item.maxWidth * scale + 16),
        fontCss:Math.max(8, item.fontSize * scale),
        sourceTextBoxId:item.id,
        sourceX:item.x,
        sourceY:item.y,
        sourceMaxWidth:item.maxWidth,
        sourceFontSize:item.fontSize,
        color:item.color,
        returnMode:"hand",
      });
    if (!editor) {
      state.selectedTextBoxId = null;
      return false;
    }
    const offset = textEditorContentOffset(editor);
    editor.x -= offset.x / scale;
    editor.y -= offset.y / scale;
    positionTextEditors();
    setStatusKey("ready");
    render();
    return true;
  }
  function pendingReplyBox(itemIndex = null) {
    const pending = state.pending;
    if (!pending) return null;
    if (pending.items) {
      const item = Number.isInteger(itemIndex) ? pending.items[itemIndex] : pending.items.find((entry) => entry?.textCommand) || pending.items[pending.selectedIndex] || pending.items[0];
      return item ? pendingItemBounds(item) : null;
    }
    return draftBounds(pending);
  }
  function deleteTextEditorTarget(editor) {
    if (!editor) return;
    const id = editor.sourceTextBoxId;
    cancelTextEditor(editor);
    if (!id) return;
    recordTextBoxesBefore();
    state.textBoxes = state.textBoxes.filter((item) => item.id !== id);
    state.selectedTextBoxId = null;
    state.userRevision++;
    save();
    render();
    setStatusKey("selectionDeleted");
  }
  function followUpAnchorPoint() {
    const lastBox = state.textBoxes[state.textBoxes.length - 1];
    const lastImage = state.images[state.images.length - 1];
    let box = state.lastUserBox ? { ...state.lastUserBox } : null;
    if (lastBox) box = { x: lastBox.x, y: lastBox.y, w: lastBox.w, h: lastBox.h };
    if (lastImage && (!box || lastImage.y + lastImage.h > box.y + box.h)) {
      box = { x: lastImage.x, y: lastImage.y, w: lastImage.w, h: lastImage.h };
    }
    if (box) {
      return { x: box.x, y: Math.min(SIZE - 120, box.y + box.h + 48 / Math.max(0.03, state.scale)) };
    }
    const rect = view.getBoundingClientRect();
    return {
      x: (rect.width * 0.5 - state.panX) / Math.max(0.03, state.scale),
      y: (rect.height * 0.42 - state.panY) / Math.max(0.03, state.scale)
    };
  }
  function openFollowUpEditor() {
    const editor = createTextEditor(followUpAnchorPoint(), {
      returnMode: state.mode === "text" ? "" : state.mode,
    });
    if (!editor) return false;
    editor.textarea.placeholder = "Type a follow-up, then Cmd/Ctrl+Enter";
    panToRevealTextEditor(editor);
    positionTextEditors();
    setStatusKey("boardReplyHint");
    return true;
  }
  function openBoardReplyFromPending(itemIndex = null) {
    const box = pendingReplyBox(itemIndex);
    if (!box) return false;
    const gap = 20 / Math.max(0.03, state.scale),
      point = {
        x: box.x,
        y: Math.min(SIZE - 80, box.y + box.h + gap),
      },
      editor = createTextEditor(point, {
        returnMode: state.mode === "text" ? "" : state.mode,
      });
    if (!editor) return false;
    panToRevealTextEditor(editor);
    positionTextEditors();
    setStatusKey("boardReplyHint");
    return true;
  }
  function setCanvasCursor(cursor) {
    screen.classList.remove("cursor-crosshair", "cursor-pen", "cursor-eraser", "cursor-grab", "cursor-grabbing", "cursor-nwse-resize", "cursor-ew-resize", "cursor-ns-resize");
    screen.classList.add(`cursor-${cursor}`);
  }
  function resetCanvasCursor() {
    setCanvasCursor(state.mode === "hand" ? "grab" : state.mode === "pen" || state.mode === "shape" ? "pen" : state.mode === "eraser" ? "eraser" : "crosshair");
  }
  function beginTouchGesture() {
    if (state.touches.size < 2) return;
    const ids = [...state.touches.keys()].slice(0, 2),
      points = ids.map((id) => state.touches.get(id));
    state.touchGesture = {
      ids,
      center: {
        x: (points[0].x + points[1].x) / 2,
        y: (points[0].y + points[1].y) / 2,
      },
      distance: Math.max(1, Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y)),
      scale: state.scale,
      panX: state.panX,
      panY: state.panY,
    };
    state.panGesture = null;
  }
  function updateTouchGesture() {
    const g = state.touchGesture;
    if (!g) return false;
    const points = g.ids.map((id) => state.touches.get(id));
    if (points.some((p) => !p)) return false;
    const center = {
        x: (points[0].x + points[1].x) / 2,
        y: (points[0].y + points[1].y) / 2,
      },
      distance = Math.max(1, Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y)),
      r = view.getBoundingClientRect(),
      next = Math.max(0.03, Math.min(2, (g.scale * distance) / g.distance)),
      anchorX = (g.center.x - r.left - g.panX) / g.scale,
      anchorY = (g.center.y - r.top - g.panY) / g.scale;
    state.scale = next;
    state.panX = center.x - r.left - anchorX * next;
    state.panY = center.y - r.top - anchorY * next;
    updateCoordinates();
    setNavigating(true);
    render();
    return true;
  }
  function moveCanvas(dx, dy) {
    state.panX += dx;
    state.panY += dy;
    updateCoordinates();
    requestRender();
  }
  function zoomCanvasAt(clientX, clientY, deltaY) {
    const rect = view.getBoundingClientRect(),
      factor = deltaY < 0 ? 1.12 : 0.89,
      next = Math.max(0.03, Math.min(2, state.scale * factor)),
      px = clientX - rect.left,
      py = clientY - rect.top;
    state.panX = px - ((px - state.panX) * next) / state.scale;
    state.panY = py - ((py - state.panY) * next) / state.scale;
    state.scale = next;
    updateCoordinates();
    requestRender();
    wheelNavigating();
  }
  window.zoomCanvasAt = zoomCanvasAt;
  window.setCanvasZoom = function (targetScale, centerPoint) {
    const rect = view.getBoundingClientRect();
    const cx = centerPoint ? centerPoint.x : rect.width / 2;
    const cy = centerPoint ? centerPoint.y : rect.height / 2;
    const next = Math.max(0.03, Math.min(2, targetScale));
    state.panX = cx - ((cx - state.panX) * next) / state.scale;
    state.panY = cy - ((cy - state.panY) * next) / state.scale;
    state.scale = next;
    updateCoordinates();
    requestRender();
  };
  function valid(p) {
    return p.x >= 0 && p.x <= SIZE && p.y >= 0 && p.y <= SIZE;
  }
  function mergeDirty(x, y, p = 10) {
    const a = {
      x: Math.max(0, x - p),
      y: Math.max(0, y - p),
      w: Math.min(SIZE, x + p) - Math.max(0, x - p),
      h: Math.min(SIZE, y + p) - Math.max(0, y - p),
    };
    if (!state.dirty) state.dirty = a;
    else {
      const b = state.dirty,
        x1 = Math.min(a.x, b.x),
        y1 = Math.min(a.y, b.y),
        x2 = Math.max(a.x + a.w, b.x + b.w),
        y2 = Math.max(a.y + a.h, b.y + b.h);
      state.dirty = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
    }
  }
  function restoreDirty(box) {
    if (!box) return;
    if (!state.dirty) {
      state.dirty = box;
      return;
    }
    const x = Math.min(box.x, state.dirty.x),
      y = Math.min(box.y, state.dirty.y),
      right = Math.max(box.x + box.w, state.dirty.x + state.dirty.w),
      bottom = Math.max(box.y + box.h, state.dirty.y + state.dirty.h);
    state.dirty = { x, y, w: right - x, h: bottom - y };
  }
  function discardUncapturableInput(hotspotCount, usedDirty) {
    if (hotspotCount) state.hotspotTrail.splice(0, hotspotCount);
    state.dirty = null;
    state.autoEligible = false;
    if (!usedDirty) state.lastUserBox = null;
  }
  function invalidateRecognition() {
    const active=state.activeAI;
    if(active&&!active.superseded){active.superseded=true;active.dirtyRestored=true;active.controller.abort();if(state.activeAI===active){state.activeAI=null;setBusy(false)}}
    clearTimeout(state.timer);
    state.timer = 0;
    state.recognitionGeneration++;
    state.hotspotTrail = [];
    state.dirty = null;
    state.autoEligible = false;
    state.lastUserBox = null;
  }
  function cloneCanvas(source) {
    if (!source) return null;
    const copy = document.createElement("canvas");
    copy.width = copy.height = TILE;
    copy.getContext("2d").drawImage(source, 0, 0);
    return copy;
  }
