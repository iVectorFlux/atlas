  function widgetBox(widget) {
    return { x: widget.x, y: widget.y, w: widget.w, h: widget.h };
  }
  function widgetLayout(widget) {
    return { ...widgetBox(widget), contentW:widget.contentW, contentH:widget.contentH };
  }
  function visibleWidgets(region = null) {
    if (!widgetRuntimeEnabled()) return [];
    return state.widgets.filter((widget) => !widget.hiddenForReplacement && pluginEnabled(widget.pluginId) && pluginManifests.has(widget.pluginId) && (!region || intersection(widgetBox(widget), region)));
  }
  function serializedWidgets() {
    return state.widgets.map((widget) => ({
      id: widget.id,
      widgetType: widget.widgetType,
      pluginId: widget.pluginId,
      x: widget.x,
      y: widget.y,
      w: widget.w,
      h: widget.h,
      contentW: widget.contentW,
      contentH: widget.contentH,
      title: widget.title,
      refreshSeconds: widget.refreshSeconds,
      ...(widget.widgetType === "diagram_source" ? { source:widget.source } : { html:widget.html }),
      ...(widget.diagramKind ? { diagramKind:widget.diagramKind } : {}),
      ...(widget.sourceFormat ? { sourceFormat:widget.sourceFormat } : {}),
      ...(widget.frameworkVersion ? { frameworkVersion:widget.frameworkVersion } : {}),
      ...(widget.widgetType !== "diagram_source" && widget.pluginId !== "image-search" && widget.copyText ? { copyText:widget.copyText, copyLabel:widget.copyLabel } : {}),
    }));
  }
  function recordWidgetsBefore() {
    if (!state.widgetHistoryBefore) state.widgetHistoryBefore = serializedWidgets();
  }
  function widgetRecord(item) {
    if (!item || typeof item !== "object" || typeof item.pluginId !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.pluginId) || item.pluginId.length > 64) return null;
    const runtime = diagramRuntime(),
      widgetType = item.widgetType === "diagram_source" || item.tool === "diagram_source" ? "diagram_source" : "html_widget",
      source = widgetType === "diagram_source" && diagramSourceFits(item.source) ? item.source : "",
      normalizedSourceFormat = widgetType === "diagram_source" && source ? runtime?.normalizeFormat(item.sourceFormat) || canonicalStoredDiagramFormat(item.sourceFormat) : "",
      html = widgetType === "diagram_source"
        ? runtime?.documentFor({ sourceFormat:normalizedSourceFormat, source, title:item.title, diagramKind:item.diagramKind }) || ""
        : typeof item.html === "string" ? item.html : "";
    if (widgetType === "html_widget" && (!html.trim() || html.length > MAX_WIDGET_HTML_LENGTH)
      || widgetType === "diagram_source" && (!source || !normalizedSourceFormat || html.length > MAX_WIDGET_HTML_LENGTH)) return null;
    if (!n(item.x) || !n(item.y) || !n(item.w, 300, SIZE) || !n(item.h, 200, SIZE) || item.x + item.w > SIZE || item.y + item.h > SIZE) return null;
    const contentW = item.contentW ?? item.w,
      contentH = item.contentH ?? item.h;
    if (!Number.isFinite(contentW) || contentW < 300 || contentW > MAX_WIDGET_CONTENT_DIMENSION
      || !Number.isFinite(contentH) || contentH < 200 || contentH > MAX_WIDGET_CONTENT_DIMENSION) return null;
    if (typeof item.title !== "string" || !item.title.trim() || item.title.length > 120 || !(item.refreshSeconds === 0 || n(item.refreshSeconds, 60, 86400))) return null;
    const allowCopy = item.pluginId !== "image-search";
    const diagramKind = typeof item.diagramKind === "string" ? item.diagramKind.trim() : "",
      inferredSourceFormat = item.pluginId === "flowchart" && item.copyText && item.sourceFormat === undefined ? "mermaid" : "",
      sourceFormat = typeof item.sourceFormat === "string" ? item.sourceFormat.trim() : inferredSourceFormat,
      frameworkVersion = typeof item.frameworkVersion === "string" ? item.frameworkVersion.trim() : "";
    if (diagramKind.length > 80 || sourceFormat.length > 80 || frameworkVersion.length > 120) return null;
    if (widgetType !== "diagram_source" && allowCopy && item.copyText !== undefined && (typeof item.copyText !== "string" || !item.copyText.trim() || item.copyText.length > MAX_WIDGET_COPY_TEXT_LENGTH)) return null;
    if (widgetType !== "diagram_source" && allowCopy && item.copyLabel !== undefined && (typeof item.copyLabel !== "string" || !item.copyLabel.trim() || item.copyLabel.length > 80)) return null;
    return {
      id: typeof item.id === "string" && /^widget-\d+$/.test(item.id) ? item.id : `widget-${state.nextWidgetId++}`,
      widgetType,
      pluginId: item.pluginId,
      x: Math.round(item.x),
      y: Math.round(item.y),
      w: Math.round(item.w),
      h: Math.round(item.h),
      contentW: Math.round(contentW),
      contentH: Math.round(contentH),
      title: item.title.trim(),
      refreshSeconds: Math.round(item.refreshSeconds),
      html,
      source,
      diagramKind,
      sourceFormat: widgetType === "diagram_source" ? normalizedSourceFormat : sourceFormat,
      frameworkVersion: widgetType === "diagram_source" ? runtime?.VERSION || DIAGRAM_RUNTIME_VERSION : frameworkVersion,
      copyText: widgetType === "diagram_source" ? source : allowCopy && typeof item.copyText === "string" ? item.copyText.trim() : "",
      copyLabel: widgetType === "diagram_source" ? runtime?.copyLabel(normalizedSourceFormat) || `Copy ${normalizedSourceFormat}` : allowCopy && typeof item.copyText === "string" ? String(item.copyLabel || (sourceFormat ? `Copy ${sourceFormat}` : "Copy source")).trim() : "",
      snapshotImage: null,
      shell: null,
      frame: null,
      hostOrigin: null,
      pending: false,
    };
  }
  function restoreWidgets(items) {
    if (state.activeAI?.widgetEdit) supersedeActiveAI("widgets-restored");
    if (state.pendingWidget) rejectPendingWidget(AI_CANCELLED, { restoreMode:false, status:false });
    state.pendingWidgetReplacement = null;
    clearWidgetRefineCandidate();
    for (const widget of state.widgets) unmountWidget(widget);
    state.widgets = [];
    state.selectedWidgetId = null;
    state.widgetEdit = null;
    state.widgetGesture = null;
    state.nextWidgetId = 1;
    for (const item of Array.isArray(items) ? items.slice(0, MAX_VISIBLE_WIDGETS) : []) {
      const widget = widgetRecord(item);
      if (!widget || state.widgets.some((existing) => existing.id === widget.id)) continue;
      const numbered = /^widget-(\d+)$/.exec(widget.id);
      if (numbered) state.nextWidgetId = Math.max(state.nextWidgetId, Number(numbered[1]) + 1);
      state.widgets.push(widget);
      if (pluginEnabled(widget.pluginId)) mountWidget(widget);
    }
  }
  function widgetHostUrl(manifest) {
    const url = new URL("widget-host.html", location.href);
    if (url.hostname === "localhost") {
      url.hostname = "127.0.0.1";
      url.searchParams.set("parent-origin", location.origin);
    } else if (url.hostname === "127.0.0.1") {
      url.hostname = "localhost";
      url.searchParams.set("parent-origin", location.origin);
    }
    for (const origin of manifest.connect) url.searchParams.append("connect", origin);
    return url.href;
  }
  function mountWidget(widget) {
    if (widget.shell || !pluginEnabled(widget.pluginId)) return;
    const manifest = pluginManifests.get(widget.pluginId);
    if (!manifest) return;
    if (widget.widgetType === "diagram_source") {
      const runtime = diagramRuntime(),
        html = runtime?.documentFor({ sourceFormat:widget.sourceFormat, source:widget.source, title:widget.title, diagramKind:widget.diagramKind }) || "";
      if (!html || html.length > MAX_WIDGET_HTML_LENGTH) return;
      widget.html = html;
      widget.frameworkVersion = runtime.VERSION;
      widget.copyText = widget.source;
      widget.copyLabel = runtime.copyLabel(widget.sourceFormat);
    }
    const shell = document.createElement("section"),
      frame = document.createElement("iframe");
    shell.className = `canvas-widget${widget.pending ? " pending" : ""}`;
    shell.dataset.widgetId = widget.id;
    shell.tabIndex = widget.pending ? -1 : 0;
    shell.setAttribute("aria-label", `${widget.title}. ${t("widgetRefineHint")}`);
    shell.classList.add(`canvas-widget-instance-${widget.id.replace(/[^a-z0-9-]/g, "")}`);
    frame.className = "canvas-widget-frame";
    frame.title = widget.title;
    frame.referrerPolicy = "no-referrer";
    frame.src = widgetHostUrl(manifest);
    shell.append(frame);
    widgetLayer.append(shell);
    widget.shell = shell;
    widget.frame = frame;
    widget.hostOrigin = new URL(frame.src).origin;
    widget.initialized = false;
    widget.hostReady = false;
    widget.hostReadyPromise = new Promise((resolve) => (widget.resolveHostReady = resolve));
    widget.hostStateKey = null;
    widget.contentReady = false;
    widget.readyPromise = new Promise((resolve) => (widget.resolveReady = resolve));
    addWidgetStyleRule(widget);
    positionWidget(widget);
  }
  function unmountWidget(widget) {
    if (state.widgetHostPan?.widget === widget) {
      state.widgetHostPan = null;
      setNavigating(false);
    }
    removeWidgetStyleRule(widget);
    widget.shell?.remove();
    widget.shell = null;
    widget.frame = null;
    widget.hostOrigin = null;
    widget.initialized = false;
    widget.hostReady = false;
    widget.resolveHostReady = null;
    widget.hostReadyPromise = null;
    widget.contentReady = false;
    widget.resolveReady = null;
    widget.readyPromise = null;
    for (const [requestId, pending] of widgetSnapshotRequests) {
      if (pending.widget !== widget) continue;
      clearTimeout(pending.timer);
      pending.reject(Error(t("widgetExportFailed")));
      widgetSnapshotRequests.delete(requestId);
    }
  }
  function addWidgetStyleRule(widget) {
    const sheet = textEditorStyleSheet(), className = `canvas-widget-instance-${widget.id.replace(/[^a-z0-9-]/g, "")}`;
    if (!sheet) return;
    try {
      sheet.insertRule(`.${className} { width: ${widget.contentW}px; height: ${widget.contentH}px; }`, sheet.cssRules.length);
      widget.styleRule = [...sheet.cssRules].find((rule) => rule.selectorText === `.${className}`) || null;
    } catch {
      widget.styleRule = null;
    }
  }
  function removeWidgetStyleRule(widget) {
    const sheet = textEditorStyleSheet(), rule = widget?.styleRule;
    if (!sheet || !rule) return;
    const index = [...sheet.cssRules].indexOf(rule);
    if (index >= 0) {
      try { sheet.deleteRule(index); } catch {}
    }
    widget.styleRule = null;
  }
  function updateWidgetRenderVisibility(widget, screenX, screenY) {
    if (!widget.shell) return;
    const viewportWidth = view.clientWidth,
      viewportHeight = view.clientHeight,
      displayWidth = widget.w * state.scale,
      displayHeight = widget.h * state.scale,
      dragging = state.widgetGesture?.widget === widget,
      intersectsViewport = viewportWidth <= 0 || viewportHeight <= 0
        || (screenX < viewportWidth && screenY < viewportHeight && screenX + displayWidth > 0 && screenY + displayHeight > 0),
      active = dragging || intersectsViewport;
    widget.renderActive = active;
    widget.shell.classList.toggle("widget-offscreen", !active);
    if (active) sendWidgetInit(widget);
    return active;
  }
  function positionWidget(widget) {
    if (!widget.shell) return;
    const screenX = state.panX + widget.x * state.scale,
      screenY = state.panY + widget.y * state.scale,
      scaleX = state.scale * widget.w / widget.contentW,
      scaleY = state.scale * widget.h / widget.contentH,
      declaration = widget.styleRule?.style;
    if (!declaration) return;
    const sizeKey = `${widget.contentW}x${widget.contentH}`;
    if (widget.styleSizeKey !== sizeKey) {
      widget.styleSizeKey = sizeKey;
      declaration.width = `${widget.contentW}px`;
      declaration.height = `${widget.contentH}px`;
    }
    declaration.transform = `translate3d(${screenX}px,${screenY}px,0) scale(${scaleX},${scaleY})`;
    updateWidgetRenderVisibility(widget, screenX, screenY);
    sendWidgetHostState(widget, scaleX, scaleY);
  }
  function positionWidgets() {
    if (!widgetRuntimeEnabled()) return;
    for (const widget of [...state.widgets, ...(state.pendingWidget ? [state.pendingWidget] : [])]) positionWidget(widget);
  }
  function sendWidgetInit(widget) {
    if (!widget.frame?.contentWindow || !widget.hostReady || widget.initialized || widget.renderActive === false) return;
    const manifest = pluginManifests.get(widget.pluginId);
    if (!manifest) return;
    widget.initialized = true;
    widget.frame.contentWindow.postMessage({
      type:"lumi6-widget-init",
      title:widget.title,
      html:widget.html,
      pluginStyles:manifest.styles || "",
    }, widget.hostOrigin || location.origin);
  }
  function sendWidgetHostState(widget, scaleX = state.scale * widget.w / widget.contentW, scaleY = state.scale * widget.h / widget.contentH, force = false) {
    if (!widget.frame?.contentWindow || !widget.hostReady || !Number.isFinite(scaleX) || scaleX <= 0 || !Number.isFinite(scaleY) || scaleY <= 0) return;
    const selected = widget.pending === true || (state.widgetEdit?.id === widget.id && state.selectedWidgetId === widget.id),
      active = widget.renderActive !== false,
      key = `${selected ? 1 : 0}:${active ? 1 : 0}:${scaleX.toFixed(6)}:${scaleY.toFixed(6)}`;
    if (!force && widget.hostStateKey === key) return;
    widget.hostStateKey = key;
    widget.frame.contentWindow.postMessage({ type:"lumi6-widget-state", selected, active, scaleX, scaleY }, widget.hostOrigin || location.origin);
  }
  function syncWidgetHostStates() {
    for (const widget of [...state.widgets, ...(state.pendingWidget ? [state.pendingWidget] : [])]) sendWidgetHostState(widget);
  }
  function decodeWidgetSnapshot(dataUrl) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(Error("Widget snapshot could not be decoded"));
      image.src = dataUrl;
    });
  }
  async function waitForWidgetContent(widget) {
    if (widget.contentReady) return;
    if (!widget.readyPromise) throw Error(t("widgetExportFailed"));
    await Promise.race([
      widget.readyPromise,
      new Promise((_, reject) => setTimeout(() => reject(Error(t("widgetExportFailed"))), WIDGET_SNAPSHOT_TIMEOUT_MS)),
    ]);
  }
  async function requestWidgetSnapshot(widget) {
    if (widget.snapshotPromise) return widget.snapshotPromise;
    const snapshotPromise = (async () => {
      const previousActive = widget.renderActive;
      try {
        if (!widget.hostReady && widget.hostReadyPromise) await Promise.race([
          widget.hostReadyPromise,
          new Promise((_, reject) => setTimeout(() => reject(Error(t("widgetExportFailed"))), WIDGET_SNAPSHOT_TIMEOUT_MS)),
        ]);
        if (!widget.initialized) {
          widget.renderActive = true;
          sendWidgetInit(widget);
          sendWidgetHostState(widget, undefined, undefined, true);
        }
        await waitForWidgetContent(widget);
        if (!widget.frame?.contentWindow) throw Error(t("widgetExportFailed"));
        const requestId = crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`;
        return await new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            widgetSnapshotRequests.delete(requestId);
            reject(Error(t("widgetExportFailed")));
          }, WIDGET_SNAPSHOT_TIMEOUT_MS);
          widgetSnapshotRequests.set(requestId, { widget, resolve, reject, timer });
          widget.frame.contentWindow.postMessage({ type:"lumi6-widget-snapshot-request", requestId, width:widget.contentW, height:widget.contentH }, widget.hostOrigin || location.origin);
        });
      } finally {
        if (previousActive === false) {
          widget.renderActive = false;
          sendWidgetHostState(widget, undefined, undefined, true);
        }
      }
    })();
    widget.snapshotPromise = snapshotPromise;
    try {
      return await snapshotPromise;
    } finally {
      if (widget.snapshotPromise === snapshotPromise) widget.snapshotPromise = null;
    }
  }
  async function handleWidgetMessage(event) {
    const widget = [...state.widgets, ...(state.pendingWidget ? [state.pendingWidget] : [])].find((item) => item.frame?.contentWindow === event.source);
    if (!widget || event.origin !== (widget.hostOrigin || location.origin) || !event.data || typeof event.data !== "object") return;
    const message = event.data;
    if (message.type === "lumi6-widget-host-ready") {
      widget.hostReady = true;
      widget.resolveHostReady?.();
      widget.resolveHostReady = null;
      sendWidgetInit(widget);
      sendWidgetHostState(widget, undefined, undefined, true);
      return;
    }
    if (message.type === "lumi6-widget-activate") {
      if (state.mode === "hand" && !widget.pending && state.widgets.includes(widget)) beginWidgetEdit(widget);
      return;
    }
    if (validWidgetHostDrag(message)) {
      if (message.type === "lumi6-widget-drag-start") beginWidgetHostDrag(widget, message);
      else if (message.type === "lumi6-widget-drag-move") {
        if (!updateWidgetHostDrag(widget, message) && message.pointerType === "touch") updateWidgetHostTouch(widget, { ...message, type:"lumi6-widget-touch-move" });
      }
      else finishWidgetHostDrag(widget, message);
      return;
    }
    if (validWidgetHostTouch(message)) {
      if (message.type === "lumi6-widget-touch-start") beginWidgetHostTouch(widget, message);
      else if (message.type === "lumi6-widget-touch-move") updateWidgetHostTouch(widget, message);
      else finishWidgetHostTouch(widget, message);
      return;
    }
    if (validWidgetHostNavigation(message)) {
      handleWidgetHostNavigation(widget, message);
      return;
    }
    if (message.type === "lumi6-widget-updated") {
      widget.contentReady = true;
      widget.resolveReady?.();
      widget.resolveReady = null;
      return;
    }
    if (!["lumi6-widget-snapshot", "lumi6-widget-snapshot-error"].includes(message.type)) return;
    const pending = widgetSnapshotRequests.get(message.requestId);
    if (!pending || pending.widget !== widget) return;
    widgetSnapshotRequests.delete(message.requestId);
    clearTimeout(pending.timer);
    if (message.type === "lumi6-widget-snapshot-error" || typeof message.dataUrl !== "string" || !message.dataUrl.startsWith("data:image/png;base64,")) {
      pending.reject(Error(t("widgetExportFailed")));
      return;
    }
    try {
      widget.snapshotImage = await decodeWidgetSnapshot(message.dataUrl);
      pending.resolve(widget.snapshotImage);
    } catch (error) {
      pending.reject(error);
    }
  }
  function selectedWidget() {
    return state.widgets.find((widget) => widget.id === state.selectedWidgetId) || null;
  }
  function beginWidgetEdit(widget) {
    if (!widget || widget.pending) return false;
    if (state.imageEdit) acceptImageEdit({ restoreMode:false });
    if (state.widgetEdit?.id === widget.id) return true;
    if (state.widgetEdit) acceptWidgetEdit();
    recordWidgetsBefore();
    state.selectedWidgetId = widget.id;
    state.widgetEdit = { id:widget.id, before:widgetLayout(widget), changed:false };
    syncWidgetHostStates();
    requestInteractionLayerRender();
    return true;
  }
  function acceptWidgetEdit() {
    const edit = state.widgetEdit;
    state.widgetGesture = null;
    state.widgetEdit = null;
    state.selectedWidgetId = null;
    if (edit?.changed) {
      state.userRevision++;
      save();
    } else if (edit) state.widgetHistoryBefore = null;
    syncWidgetHostStates();
    requestInteractionLayerRender();
    if (edit) setStatusKey("ready");
    return Boolean(edit);
  }
  function cancelWidgetEdit() {
    const edit = state.widgetEdit,
      widget = edit ? state.widgets.find((item) => item.id === edit.id) : null;
    if (widget) {
      Object.assign(widget, edit.before);
      positionWidget(widget);
    }
    state.widgetHistoryBefore = null;
    state.widgetGesture = null;
    state.widgetEdit = null;
    state.selectedWidgetId = null;
    syncWidgetHostStates();
    requestInteractionLayerRender();
    if (edit) setStatusKey("ready");
    return Boolean(edit);
  }
  function widgetControlHit(widget, point, pointerType = "mouse") {
    const box = widgetBox(widget),
      handle = 14 / state.scale,
      radius = (pointerType === "touch" ? 24 : 14) / state.scale,
      actionRadius = pointerType === "touch" ? 22 / state.scale : Math.max(handle * 0.8, 9 / state.scale),
      controls = [
        ...Object.entries(draftActionPoints(box, handle, false, true)).map(([hit, target]) => ({ hit, target, radius:actionRadius })),
        { hit:"resize", target:{ x:box.x + box.w, y:box.y + box.h }, radius },
        { hit:"width", target:{ x:box.x + box.w + handle * 0.08, y:box.y + box.h / 2 }, radius },
        { hit:"height", target:{ x:box.x + box.w / 2, y:box.y + box.h + handle * 0.08 }, radius },
      ],
      control = controls
        .map((item) => ({ ...item, distance:Math.hypot(point.x - item.target.x, point.y - item.target.y) }))
        .filter((item) => item.distance <= item.radius)
        .sort((a, b) => a.distance - b.distance)[0];
    if (control) return control.hit;
    return point.x >= box.x && point.x <= box.x + box.w && point.y >= box.y && point.y <= box.y + box.h ? "move" : null;
  }
  function widgetPointerHit(point, pointerType = "mouse", includeUnselected = false) {
    if (!widgetRuntimeEnabled()) return null;
    if (state.pendingWidget) {
      const hit = widgetControlHit(state.pendingWidget, point, pointerType);
      if (hit && hit !== "move") return { widget:state.pendingWidget, hit, pending:true };
      if (includeUnselected && hit === "move") return { widget:state.pendingWidget, hit, pending:true };
    }
    const selected = selectedWidget();
    if (selected && state.widgetEdit) {
      const hit = widgetControlHit(selected, point, pointerType);
      if (hit && hit !== "move") return { widget:selected, hit, pending:false };
      if (includeUnselected && hit === "move") return { widget:selected, hit, pending:false };
    }
    if (includeUnselected) {
      const widgets = visibleWidgets();
      for (let index = widgets.length - 1; index >= 0; index--) {
        const widget = widgets[index],
          box = widgetBox(widget);
        if (point.x >= box.x && point.x <= box.x + box.w && point.y >= box.y && point.y <= box.y + box.h) return { widget, hit:"move", pending:false };
      }
    }
    return null;
  }
  function resizeWidgetBox(start, point, hit, minimumWidth = 300, minimumHeight = 200, limit = SIZE) {
    const contentW = start.contentW ?? start.w,
      contentH = start.contentH ?? start.h;
    if (hit === "width") {
      const displayScale = start.h / contentH,
        minimum = Math.max(minimumWidth, minimumWidth * displayScale),
        maximum = limit - start.x,
        width = Math.max(minimum, Math.min(maximum, point.x - start.x));
      return { ...start, w:width, contentW:width / displayScale };
    }
    if (hit === "height") {
      const displayScale = start.w / contentW,
        minimum = Math.max(minimumHeight, minimumHeight * displayScale),
        maximum = limit - start.y,
        height = Math.max(minimum, Math.min(maximum, point.y - start.y));
      return { ...start, h:height, contentH:height / displayScale };
    }
    const minimumScale = Math.max(minimumWidth / start.w, minimumHeight / start.h),
      maximumScale = Math.min((limit - start.x) / start.w, (limit - start.y) / start.h),
      requestedScale = Math.max((point.x - start.x) / start.w, (point.y - start.y) / start.h),
      scale = Math.max(minimumScale, Math.min(maximumScale, requestedScale));
    return { ...start, w:start.w * scale, h:start.h * scale };
  }
  function beginWidgetGesture(event, point, result) {
    if (!result?.widget) return false;
    if (result.hit === "accept") return (result.pending ? acceptPendingWidget() : acceptWidgetEdit()) || true;
    if (result.hit === "cancel") return (result.pending ? rejectPendingWidget() : deleteWidget(result.widget)) || true;
    if (!result.pending) beginWidgetEdit(result.widget);
    state.widgetGesture = {
      id:event.pointerId,
      widget:result.widget,
      pending:result.pending,
      hit:result.hit,
      startPoint:point,
      start:widgetLayout(result.widget),
      changed:false,
    };
    setCanvasCursor(result.hit === "resize" ? "nwse-resize" : result.hit === "width" ? "ew-resize" : result.hit === "height" ? "ns-resize" : "grabbing");
    requestInteractionLayerRender();
    return true;
  }
  function updateWidgetGesturePoint(gesture, point) {
    const widget = gesture.widget;
    if (gesture.hit === "move") {
      widget.x = Math.max(0, Math.min(SIZE - widget.w, gesture.start.x + point.x - gesture.startPoint.x));
      widget.y = Math.max(0, Math.min(SIZE - widget.h, gesture.start.y + point.y - gesture.startPoint.y));
    } else Object.assign(widget, resizeWidgetBox(gesture.start, point, gesture.hit));
    gesture.changed = ["x", "y", "w", "h"].some((key) => Math.abs(widget[key] - gesture.start[key]) > 0.01);
    positionWidget(widget);
    requestInteractionLayerRender();
    return true;
  }
  function updateWidgetGesture(event) {
    const gesture = state.widgetGesture;
    if (!gesture || gesture.id !== event.pointerId) return false;
    return updateWidgetGesturePoint(gesture, clientPoint(event));
  }
  function validWidgetHostDrag(message) {
    return message && ["lumi6-widget-drag-start", "lumi6-widget-drag-move", "lumi6-widget-drag-end"].includes(message.type)
      && Number.isInteger(message.pointerId) && Math.abs(message.pointerId) <= 0x7fffffff
      && ["mouse", "pen", "touch"].includes(message.pointerType)
      && ["width", "height", "resize"].includes(message.hit)
      && [message.localX, message.localY, message.screenX, message.screenY].every(value => Number.isFinite(value) && Math.abs(value) <= 10000000);
  }
  function validWidgetHostTouch(message) {
    return message && ["lumi6-widget-touch-start", "lumi6-widget-touch-move", "lumi6-widget-touch-end"].includes(message.type)
      && Number.isInteger(message.pointerId) && Math.abs(message.pointerId) <= 0x7fffffff
      && message.pointerType === "touch"
      && [message.localX, message.localY, message.screenX, message.screenY].every(value => Number.isFinite(value) && Math.abs(value) <= 10000000);
  }
  function validWidgetHostNavigation(message) {
    if (!message || !["lumi6-widget-pan-start", "lumi6-widget-pan-move", "lumi6-widget-pan-end", "lumi6-widget-wheel"].includes(message.type)) return false;
    if (message.type === "lumi6-widget-wheel")
      return [message.localX, message.localY, message.deltaY].every((value) => Number.isFinite(value) && Math.abs(value) <= 10000000);
    return Number.isInteger(message.pointerId) && Math.abs(message.pointerId) <= 0x7fffffff && message.pointerType === "mouse"
      && [message.localX, message.localY, message.screenX, message.screenY].every((value) => Number.isFinite(value) && Math.abs(value) <= 10000000);
  }
  function widgetHostPointerId(widget, pointerId) {
    return `widget-host:${widget.id}:${pointerId}`;
  }
  function widgetHostViewportPoint(widget, message) {
    const rect = widget.frame?.getBoundingClientRect();
    if (!rect || !rect.width || !rect.height) return null;
    return {
      x:rect.left + message.localX * rect.width / widget.contentW,
      y:rect.top + message.localY * rect.height / widget.contentH,
    };
  }
  function widgetHostTrackedPoint(anchor, message) {
    if (!anchor) return null;
    return {
      x:anchor.clientX + (message.screenX - anchor.screenX) * screenClientRatio,
      y:anchor.clientY + (message.screenY - anchor.screenY) * screenClientRatio,
    };
  }
  function calibrateScreenClientRatio(event, moved) {
    const current = { screenX:event.screenX, screenY:event.screenY, clientX:event.clientX, clientY:event.clientY };
    if (![current.screenX, current.screenY, current.clientX, current.clientY].every(Number.isFinite)) return;
    const previous = screenCalibration.get(event.pointerId);
    screenCalibration.set(event.pointerId, current);
    if (!moved || !previous) return;
    const dsX = current.screenX - previous.screenX, dsY = current.screenY - previous.screenY,
      dcX = current.clientX - previous.clientX, dcY = current.clientY - previous.clientY,
      ds2 = dsX * dsX + dsY * dsY;
    if (ds2 < 16) return;
    const candidate = (dcX * dsX + dcY * dsY) / ds2;
    if (!Number.isFinite(candidate) || candidate <= 0.25 || candidate >= 4) return;
    screenClientRatio = Math.min(4, Math.max(0.25, screenClientRatio * 0.7 + candidate * 0.3));
  }
  function releaseWidgetHostTouch(widget, pointerId) {
    const id = widgetHostPointerId(widget, pointerId);
    widgetHostPointerAnchors.delete(id);
    state.pointers.delete(id);
    state.touches.delete(id);
    if (state.panGesture?.id === id) state.panGesture = null;
    if (state.touchGesture?.ids?.includes(id)) state.touchGesture = null;
    if (!state.touches.size) setNavigating(false);
  }
  function beginWidgetHostTouch(widget, message) {
    if (!validWidgetHostTouch(message) || message.type !== "lumi6-widget-touch-start") return false;
    const point = widgetHostViewportPoint(widget, message);
    if (!point) return false;
    const id = widgetHostPointerId(widget, message.pointerId);
    state.pointers.set(id, point);
    state.touches.set(id, point);
    widgetHostPointerAnchors.set(id, { clientX:point.x, clientY:point.y, screenX:message.screenX, screenY:message.screenY });
    if (state.touches.size < 2) return true;
    state.textTap = null;
    if (state.pendingGesture) state.pendingGesture = null;
    if (state.widgetGesture) finishWidgetGesture({ pointerId:state.widgetGesture.id });
    if (state.selectedWidgetId) acceptWidgetEdit();
    if (state.animationGesture) finishAnimationGesture({ pointerId:state.animationGesture.id });
    if (state.selectedAnimationId) acceptAnimationEdit();
    finishDrawing("pen");
    beginTouchGesture();
    return true;
  }
  function updateWidgetHostTouch(widget, message) {
    if (!validWidgetHostTouch(message) || message.type !== "lumi6-widget-touch-move") return false;
    const id = widgetHostPointerId(widget, message.pointerId),
      old = state.pointers.get(id),
      point = widgetHostTrackedPoint(widgetHostPointerAnchors.get(id), message) || widgetHostViewportPoint(widget, message);
    if (!old || !point || !state.touches.has(id)) return false;
    state.pointers.set(id, point);
    state.touches.set(id, point);
    if (state.touches.size >= 2) {
      if (!state.touchGesture) beginTouchGesture();
      return updateTouchGesture();
    }
    if (!state.panGesture || state.panGesture.id !== id) state.panGesture = { id, last:old };
    moveCanvas(point.x - old.x, point.y - old.y);
    state.panGesture.last = point;
    setNavigating(true);
    return true;
  }
  function finishWidgetHostTouch(widget, message) {
    if (!validWidgetHostTouch(message) || message.type !== "lumi6-widget-touch-end") return false;
    const id = widgetHostPointerId(widget, message.pointerId);
    if (!state.pointers.has(id) && !state.touches.has(id)) return false;
    state.pointers.delete(id);
    state.touches.delete(id);
    widgetHostPointerAnchors.delete(id);
    state.touchGesture = null;
    if (state.touches.size === 1) {
      const [remainingId, point] = state.touches.entries().next().value;
      state.panGesture = { id:remainingId, last:point };
    } else state.panGesture = null;
    if (!state.touches.size) setNavigating(false);
    return true;
  }
  function handleWidgetHostNavigation(widget, message) {
    if (!validWidgetHostNavigation(message)) return false;
    if (message.type === "lumi6-widget-wheel") {
      const point = widgetHostViewportPoint(widget, message);
      if (!point) return false;
      zoomCanvasAt(point.x, point.y, message.deltaY);
      return true;
    }
    const id = widgetHostPointerId(widget, message.pointerId);
    if (message.type === "lumi6-widget-pan-start") {
      const point = widgetHostViewportPoint(widget, message);
      if (!point || state.widgetHostPan) return false;
      if (state.selectedImageId) acceptImageEdit({ restoreMode:false });
      if (state.selectedWidgetId) acceptWidgetEdit();
      if (state.selectedAnimationId) acceptAnimationEdit();
      state.widgetHostPan = {
        id,
        widget,
        last:point,
        anchor:{ clientX:point.x, clientY:point.y, screenX:message.screenX, screenY:message.screenY },
      };
      setNavigating(true);
      return true;
    }
    const pan = state.widgetHostPan;
    if (!pan || pan.id !== id || pan.widget !== widget) return false;
    if (message.type === "lumi6-widget-pan-move") {
      const point = widgetHostTrackedPoint(pan.anchor, message) || widgetHostViewportPoint(widget, message);
      if (!point) return false;
      moveCanvas(point.x - pan.last.x, point.y - pan.last.y);
      pan.last = point;
      setNavigating(true);
      return true;
    }
    state.widgetHostPan = null;
    setNavigating(false);
    return true;
  }
  function beginWidgetHostDrag(widget, message) {
    if (!validWidgetHostDrag(message) || message.type !== "lumi6-widget-drag-start") return false;
    if (message.pointerType === "touch") {
      const id = widgetHostPointerId(widget, message.pointerId);
      if ([...state.touches.keys()].some((pointerId) => pointerId !== id)) return false;
      releaseWidgetHostTouch(widget, message.pointerId);
    }
    if (state.widgetGesture || state.pendingGesture || state.animationGesture || state.selectionGesture || state.drawing || state.panGesture || state.touchGesture) return false;
    const pending = widget === state.pendingWidget && widget.pending === true;
    if (!pending && (!state.widgets.includes(widget) || !beginWidgetEdit(widget))) return false;
    const viewportPoint = widgetHostViewportPoint(widget, message);
    if (!viewportPoint) return false;
    state.widgetGesture = {
      id:widgetHostPointerId(widget, message.pointerId),
      hostPointerId:message.pointerId,
      source:"widget-host",
      widget,
      pending,
      hit:message.hit,
      startPoint:clientPoint({ clientX:viewportPoint.x, clientY:viewportPoint.y }),
      hostAnchor:{ clientX:viewportPoint.x, clientY:viewportPoint.y, screenX:message.screenX, screenY:message.screenY },
      start:widgetLayout(widget),
      changed:false,
    };
    setCanvasCursor(message.hit === "resize" ? "nwse-resize" : message.hit === "width" ? "ew-resize" : message.hit === "height" ? "ns-resize" : "grabbing");
    requestInteractionLayerRender();
    return true;
  }
  function updateWidgetHostDrag(widget, message) {
    const gesture = state.widgetGesture;
    if (!validWidgetHostDrag(message) || !gesture || gesture.source !== "widget-host" || gesture.widget !== widget || gesture.hostPointerId !== message.pointerId) return false;
    const viewportPoint = widgetHostTrackedPoint(gesture.hostAnchor, message) || widgetHostViewportPoint(widget, message);
    if (!viewportPoint) return false;
    return updateWidgetGesturePoint(gesture, clientPoint({ clientX:viewportPoint.x, clientY:viewportPoint.y }));
  }
  function finishWidgetHostDrag(widget, message) {
    const gesture = state.widgetGesture;
    if (!validWidgetHostDrag(message) || message.type !== "lumi6-widget-drag-end" || !gesture || gesture.source !== "widget-host" || gesture.widget !== widget || gesture.hostPointerId !== message.pointerId) return false;
    updateWidgetHostDrag(widget, message);
    return finishWidgetGesture({ pointerId:gesture.id });
  }
  function finishWidgetGesture(event) {
    const gesture = state.widgetGesture;
    if (!gesture || gesture.id !== event.pointerId) return false;
    state.widgetGesture = null;
    resetCanvasCursor();
    if (gesture.changed && !gesture.pending && state.widgetEdit?.id === gesture.widget.id) state.widgetEdit.changed = true;
    positionWidget(gesture.widget);
    requestInteractionLayerRender();
    return true;
  }
  function deleteWidget(widget) {
    if (!widget || widget.pending || !state.widgets.includes(widget)) return false;
    recordWidgetsBefore();
    unmountWidget(widget);
    state.widgets = state.widgets.filter((item) => item !== widget);
    if (state.selectedWidgetId === widget.id) {
      state.selectedWidgetId = null;
      state.widgetEdit = null;
      state.widgetGesture = null;
    }
    state.userRevision++;
    save();
    requestInteractionLayerRender();
    setStatusKey("widgetDeleted");
    return true;
  }
  function acceptPendingWidget(options) {
    options ||= {};
    const restoreMode = options?.restoreMode !== false;
    const widget = state.pendingWidget;
    if (!widget) return;
    const replacement = state.pendingWidgetReplacement;
    const pendingBefore = capturePendingHistoryState();
    if (widget.revision !== state.userRevision) {
      rejectPendingWidget(AI_CANCELLED);
      setStatusKey("canvasChanged");
      return;
    }
    recordWidgetsBefore();
    state.pendingWidget = null;
    state.pendingWidgetReplacement = null;
    widget.pending = false;
    const resolve = widget.resolve;
    widget.resolve = null;
    unmountWidget(widget);
    if (replacement) {
      const index = state.widgets.indexOf(replacement.target);
      if (index < 0 || replacement.target.id !== widget.id || replacement.target.pluginId !== widget.pluginId) {
        replacement.target.hiddenForReplacement = false;
        mountWidget(replacement.target);
        resolve?.(AI_CANCELLED);
        state.widgetHistoryBefore = null;
        if (restoreMode) finishAIDraftHandMode();
        return;
      }
      state.widgets.splice(index, 1, widget);
    } else state.widgets.push(widget);
    mountWidget(widget);
    const historyEntry = save();
    if (!replacement) recordPendingHistory(historyEntry, pendingBefore, capturePendingHistoryState());
    requestInteractionLayerRender();
    setStatusKey("merged");
    resolve?.(true);
    if (restoreMode) finishAIDraftHandMode();
  }
  function rejectPendingWidget(result = AI_REJECTED, options) {
    options ||= {};
    const restoreMode = options?.restoreMode !== false,
      updateStatus = options?.status !== false;
    const widget = state.pendingWidget;
    if (!widget) return;
    state.pendingWidget = null;
    const replacement = state.pendingWidgetReplacement;
    state.pendingWidgetReplacement = null;
    const resolve = widget.resolve;
    widget.resolve = null;
    unmountWidget(widget);
    if (replacement?.target && state.widgets.includes(replacement.target)) {
      replacement.target.hiddenForReplacement = false;
      mountWidget(replacement.target);
    }
    requestInteractionLayerRender();
    if (updateStatus) setStatusKey(result === AI_CANCELLED ? "canvasChanged" : "draftRejected");
    resolve?.(result);
    if (restoreMode) finishAIDraftHandMode();
  }
  function cancelWidgetRefinement(reason = "widget-refine-cancelled", options) {
    let cancelled = false;
    if (state.activeAI?.widgetEdit) {
      supersedeActiveAI(reason);
      cancelled = true;
    }
    if (state.pendingWidgetReplacement) {
      rejectPendingWidget(AI_CANCELLED, options);
      cancelled = true;
    }
    clearWidgetRefineCandidate();
    return cancelled;
  }
  function startPendingWidget(command, revision) {
    if (state.pendingWidget || state.widgets.length >= MAX_VISIBLE_WIDGETS) return Promise.resolve(false);
    let cmd = { ...command };
    if (Number.isFinite(cmd.x) && Number.isFinite(cmd.y) && Number.isFinite(cmd.w) && Number.isFinite(cmd.h)) {
      const freePos = findFreeCanvasPosition(cmd.x, cmd.y, cmd.w, cmd.h, 400);
      cmd.x = freePos.x;
      cmd.y = freePos.y;
    }
    const widget = widgetRecord({ ...cmd, id:`widget-${state.nextWidgetId++}` });
    if (!widget || !pluginEnabled(widget.pluginId)) return Promise.resolve(false);
    widget.pending = true;
    widget.revision = revision;
    state.pendingWidget = widget;
    enterAIDraftHandMode();
    mountWidget(widget);
    requestInteractionLayerRender();
    setStatusKey("draftReady");
    return new Promise((resolve) => (widget.resolve = resolve));
  }
  function startPendingWidgetReplacement(command, target, revision) {
    if (state.pendingWidget || state.pendingWidgetReplacement || !target || !state.widgets.includes(target) || target.hiddenForReplacement || target.pluginId !== command.pluginId) return Promise.resolve(false);
    const widget = widgetRecord({
      ...command,
      id:target.id,
      x:target.x,
      y:target.y,
      w:target.w,
      h:target.h,
      contentW:target.contentW,
      contentH:target.contentH,
    });
    if (!widget || !pluginEnabled(widget.pluginId) || revision !== state.userRevision) return Promise.resolve(false);
    widget.pending = true;
    widget.revision = revision;
    target.hiddenForReplacement = true;
    unmountWidget(target);
    state.pendingWidget = widget;
    state.pendingWidgetReplacement = { target, targetId:target.id, pluginId:target.pluginId, revision };
    enterAIDraftHandMode();
    mountWidget(widget);
    requestInteractionLayerRender();
    setStatusKey("widgetReplacementReady");
    return new Promise((resolve) => (widget.resolve = resolve));
  }
  function widgetBounds(region = null) {
    let bounds = null;
    for (const widget of visibleWidgets(region)) bounds = unionLocalBounds(bounds, region ? intersection(widgetBox(widget), region) : widgetBox(widget));
    return bounds;
  }
  function drawWidgetsToContext(context, region = null) {
    for (const widget of visibleWidgets(region)) {
      if (!widget.snapshotImage) continue;
      context.drawImage(widget.snapshotImage, widget.x, widget.y, widget.w, widget.h);
    }
  }
  async function snapshotVisibleWidgets() {
    for (const widget of visibleWidgets()) await requestWidgetSnapshot(widget);
  }

  function animationBox(animation) {
    return { x: animation.x, y: animation.y, w: animation.w, h: animation.h };
  }
  function createAnimationPlayback(now = performance.now()) {
    return { playheadMs: 0, paused: false, startedAt: now };
  }
  function playbackPlayhead(scene, playback, now = performance.now()) {
    const base = Math.max(0, playback?.playheadMs || 0),
      elapsed = playback?.paused ? 0 : Math.max(0, now - (playback?.startedAt || now)),
      total = base + elapsed,
      duration = Math.max(1, scene.durationMs);
    return scene.loop ? total % duration : Math.min(duration, total);
  }
  function selectedAnimation() {
    return state.animations.find((animation) => animation.id === state.selectedAnimationId) || null;
  }
  function animationPlayhead(animation, now = performance.now()) {
    return playbackPlayhead(animation.scene, animation, now);
  }
  function pendingAnimationEntries(pending = state.pending) {
    if (!pending) return [];
    if (!pending.items) {
      if (!pending.animationScene) return [];
      pending.animationPlayback ||= createAnimationPlayback();
      return [{ kind: "pending", owner: pending, pending, itemIndex: null, scene: pending.animationScene, playback: pending.animationPlayback, box: draftBounds(pending) }];
    }
    return pending.items.flatMap((item, itemIndex) => {
      if (!item.animationScene) return [];
      item.animationPlayback ||= createAnimationPlayback();
      return [{ kind: "pending", owner: item, pending, itemIndex, scene: item.animationScene, playback: item.animationPlayback, box: pendingItemBounds(item) }];
    });
  }
  function pendingAnimationControlTarget() {
    const entries = pendingAnimationEntries();
    if (!entries.length) return null;
    if (!state.pending?.items) return entries[0];
    return entries.find((entry) => entry.itemIndex === state.pending.selectedIndex) || null;
  }
  function animationControlTarget() {
    const pending = pendingAnimationControlTarget();
    if (pending) return pending;
    const animation = selectedAnimation();
    return animation ? { kind: "confirmed", animation, scene: animation.scene, playback: animation, box: animationBox(animation) } : null;
  }
  function animationTargetPlayhead(target, now = performance.now()) {
    return target?.kind === "confirmed" ? animationPlayhead(target.animation, now) : playbackPlayhead(target.scene, target.playback, now);
  }
  function serializedAnimations(now = performance.now()) {
    return state.animations.map((animation) => ({
      id: animation.id,
      rendererVersion: 1,
      transform: animationBox(animation),
      scene: ANIMATION.serialize(animation.scene),
      playback: { playheadMs: animationPlayhead(animation, now), paused: Boolean(animation.paused) },
    }));
  }
  function restoreAnimations(items) {
    state.animations = [];
    state.selectedAnimationId = null;
    state.animationEdit = null;
    hideAnimationControls();
    const now = performance.now(),
      usedIds = new Set();
    for (const saved of Array.isArray(items) ? items : []) {
      if (state.animations.length >= MAX_VISIBLE_ANIMATIONS) break;
      const scene = ANIMATION?.normalize(saved?.scene, SIZE),
        transform = saved?.transform;
      if (!scene || !transform || ![transform.x, transform.y, transform.w, transform.h].every(Number.isFinite) || transform.w <= 0 || transform.h <= 0 || transform.x < 0 || transform.y < 0 || transform.x + transform.w > SIZE || transform.y + transform.h > SIZE) continue;
      const playheadMs = Math.max(0, Math.min(scene.durationMs, Number(saved.playback?.playheadMs) || 0)),
        paused = Boolean(saved.playback?.paused);
      let id = typeof saved.id === "string" && saved.id.length <= 128 && !usedIds.has(saved.id) ? saved.id : "";
      const numberedId = /^animation-(\d+)$/.exec(id);
      if (numberedId) state.nextAnimationId = Math.max(state.nextAnimationId, Number(numberedId[1]) + 1);
      if (!id) {
        do id = "animation-" + state.nextAnimationId++;
        while (usedIds.has(id));
      }
      usedIds.add(id);
      state.animations.push({
        id,
        scene,
        x: transform.x,
        y: transform.y,
        w: transform.w,
        h: transform.h,
        playheadMs,
        paused,
        startedAt: now,
      });
    }
    requestAnimationLayerRender();
  }
  function recordAnimationsBefore() {
    if (!state.animationHistoryBefore) state.animationHistoryBefore = serializedAnimations();
  }
  function beginAnimationEdit(animation) {
    if (!animation) return false;
    if (state.imageEdit) acceptImageEdit({ restoreMode:false });
    if (state.animationEdit?.id === animation.id) return true;
    if (state.animationEdit) acceptAnimationEdit();
    const now = performance.now();
    recordAnimationsBefore();
    state.selectedAnimationId = animation.id;
    state.animationEdit = {
      id: animation.id,
      before: {
        x: animation.x,
        y: animation.y,
        w: animation.w,
        h: animation.h,
        playheadMs: animationPlayhead(animation, now),
        paused: Boolean(animation.paused),
      },
      changed: false,
    };
    return true;
  }
  function acceptAnimationEdit() {
    const edit = state.animationEdit;
    state.animationGesture = null;
    state.animationEdit = null;
    state.selectedAnimationId = null;
    hideAnimationControls();
    if (edit?.changed) {
      state.userRevision++;
      save();
    } else if (edit) state.animationHistoryBefore = null;
    requestAnimationLayerRender();
    requestInteractionLayerRender();
    if (edit) setStatusKey("ready");
    return Boolean(edit);
  }
  function cancelAnimationEdit() {
    const edit = state.animationEdit,
      animation = edit ? state.animations.find((item) => item.id === edit.id) : null;
    if (animation) {
      Object.assign(animation, edit.before, { startedAt: performance.now() });
    }
    state.animationHistoryBefore = null;
    state.animationGesture = null;
    state.animationEdit = null;
    state.selectedAnimationId = null;
    hideAnimationControls();
    requestAnimationLayerRender();
    requestInteractionLayerRender();
    if (edit) setStatusKey("ready");
    return Boolean(edit);
  }
  function addAnimation(scene, transform = scene, playback = null) {
    if (!pluginEnabled("animation") || state.animations.length >= MAX_VISIBLE_ANIMATIONS) return null;
    const normalized = ANIMATION?.normalize(scene, SIZE);
    if (!normalized) return null;
    recordAnimationsBefore();
    const now = performance.now(),
      playheadMs = playback ? playbackPlayhead(normalized, playback, now) : 0,
      paused = Boolean(playback?.paused);
    const animation = {
      id: "animation-" + state.nextAnimationId++,
      scene: normalized,
      x: transform.x,
      y: transform.y,
      w: transform.w,
      h: transform.h,
      playheadMs,
      paused,
      startedAt: now,
    };
    state.animations.push(animation);
    requestAnimationLayerRender();
    return animation;
  }
  function deleteSelectedAnimation() {
    const target = animationControlTarget();
    if (target?.kind === "pending") {
      hideAnimationControls();
      if (target.itemIndex == null) rejectPending();
      else rejectPendingItem(target.itemIndex);
      return;
    }
    const animation = selectedAnimation();
    if (!animation) return;
    recordAnimationsBefore();
    state.animations = state.animations.filter((item) => item !== animation);
    state.selectedAnimationId = null;
    state.animationEdit = null;
    hideAnimationControls();
    state.userRevision++;
    save();
    requestAnimationLayerRender();
    requestInteractionLayerRender();
    setStatusKey("animationDeleted");
  }
  function toggleSelectedAnimationPlayback() {
    const target = animationControlTarget();
    if (!target) return;
    const playback = target.playback;
    if (target.kind === "confirmed") beginAnimationEdit(target.animation);
    const now = performance.now();
    if (playback.paused) {
      playback.paused = false;
      playback.startedAt = now;
    } else {
      playback.playheadMs = animationTargetPlayhead(target, now);
      playback.paused = true;
    }
    if (target.kind === "confirmed" && state.animationEdit) state.animationEdit.changed = true;
    showAnimationControls();
    requestAnimationLayerRender();
    requestInteractionLayerRender();
  }
  function restartSelectedAnimation() {
    const target = animationControlTarget();
    if (!target) return;
    if (target.kind === "confirmed") beginAnimationEdit(target.animation);
    target.playback.playheadMs = 0;
    target.playback.startedAt = performance.now();
    if (target.kind === "confirmed" && state.animationEdit) state.animationEdit.changed = true;
    showAnimationControls();
    requestAnimationLayerRender();
    requestInteractionLayerRender();
  }
  function drawAnimationInstance(context, animation, now) {
    const playhead = animationPlayhead(animation, now);
    context.save();
    context.translate(animation.x, animation.y);
    context.scale(animation.w / animation.scene.w, animation.h / animation.scene.h);
    ANIMATION.render(context, animation.scene, playhead);
    context.restore();
  }
  function visibleAnimations(region = null) {
    if (!pluginEnabled("animation")) return [];
    return state.animations.filter((animation) => !region || intersection(animationBox(animation), region));
  }
  function drawAnimationsToContext(context, region, now = performance.now()) {
    for (const animation of visibleAnimations(region)) drawAnimationInstance(context, animation, now);
  }
  function visiblePlayingAnimations(region = viewportRect()) {
    if (!pluginEnabled("animation") || document.hidden || !region) return [];
    return visibleAnimations(region).filter((animation) => !animation.paused && (animation.scene.loop || animationPlayhead(animation) < animation.scene.durationMs));
  }
  function hideAnimationControls() {
    clearTimeout(state.animationControlsTimer);
    state.animationControlsTimer = 0;
    state.animationControlsUntil = 0;
    if (!animationControls.hidden) animationControls.hidden = true;
    requestInteractionLayerRender();
  }
  function animationControlChromeVisible(target = animationControlTarget(), now = performance.now()) {
    return Boolean(pluginEnabled("animation") && target && state.animationControlsUntil > now);
  }
  function pendingAnimationChromeVisible(pending, itemIndex = null, now = performance.now()) {
    const target = pendingAnimationControlTarget();
    return Boolean(target && target.pending === pending && target.itemIndex === itemIndex && animationControlChromeVisible(target, now));
  }
  function animationEditChromeVisible(now = performance.now()) {
    const target = animationControlTarget();
    return Boolean(target?.kind === "confirmed" && state.animationEdit && selectedAnimation() && animationControlChromeVisible(target, now));
  }
  function expireAnimationControls() {
    hideAnimationControls();
    if (selectedAnimation()) acceptAnimationEdit();
  }
  function showAnimationControls(duration = ANIMATION_CONTROLS_VISIBLE_MS) {
    if (!pluginEnabled("animation") || !animationControlTarget()) {
      hideAnimationControls();
      return;
    }
    clearTimeout(state.animationControlsTimer);
    state.animationControlsUntil = performance.now() + duration;
    if (animationControls.hidden) animationControls.hidden = false;
    positionAnimationControls();
    state.animationControlsTimer = setTimeout(expireAnimationControls, duration);
  }
  function positionAnimationControls() {
    const target = animationControlTarget();
    if (!pluginEnabled("animation") || !target) {
      if (!animationControls.hidden) animationControls.hidden = true;
      return;
    }
    if (performance.now() >= state.animationControlsUntil) {
      if (!animationControls.hidden) animationControls.hidden = true;
      if (target.kind === "confirmed") acceptAnimationEdit();
      return;
    }
    const rect = view.getBoundingClientRect(),
      box = target.box,
      left = state.panX + box.x * state.scale,
      top = state.panY + box.y * state.scale,
      width = box.w * state.scale,
      controlsWidth = animationControls.offsetWidth || 210,
      controlsHeight = animationControls.offsetHeight || 36,
      editControlsClearance = 28,
      controlsStyle = runtimeElementStyle(animationControls, "animation-controls"),
      x = Math.max(8, Math.min(rect.width - controlsWidth - 8, left + width / 2 - controlsWidth / 2)),
      y = top - controlsHeight - editControlsClearance >= 8 ? top - controlsHeight - editControlsClearance : Math.min(rect.height - controlsHeight - 8, top + box.h * state.scale + editControlsClearance),
      nextX = Math.round(x) + "px",
      nextY = Math.round(y) + "px",
      nextLabel = t(target.playback.paused ? "animationPlay" : "animationPause");
    if (animationControls.hidden) animationControls.hidden = false;
    if (controlsStyle?.getPropertyValue("--animation-controls-x") !== nextX) controlsStyle?.setProperty("--animation-controls-x", nextX);
    if (controlsStyle?.getPropertyValue("--animation-controls-y") !== nextY) controlsStyle?.setProperty("--animation-controls-y", nextY);
    if (animationPlayPause.textContent !== nextLabel) animationPlayPause.textContent = nextLabel;
  }
  function animationScreenBox(animation, padding = 3) {
    const box = animationBox(animation);
    return {
      x: state.panX + box.x * state.scale - padding,
      y: state.panY + box.y * state.scale - padding,
      w: box.w * state.scale + padding * 2,
      h: box.h * state.scale + padding * 2,
    };
  }
  function sameAnimationScreenBox(a, b) {
    return a && b && Math.abs(a.x - b.x) < 0.01 && Math.abs(a.y - b.y) < 0.01 && Math.abs(a.w - b.w) < 0.01 && Math.abs(a.h - b.h) < 0.01;
  }
  function clippedScreenBox(box, rect) {
    const left = Math.max(0, box.x),
      top = Math.max(0, box.y),
      right = Math.min(rect.width, box.x + box.w),
      bottom = Math.min(rect.height, box.y + box.h);
    return right > left && bottom > top ? { x: left, y: top, w: right - left, h: bottom - top } : null;
  }
  function mergeAnimationDirtyRects(rects) {
    const merged = [];
    for (const rect of rects) {
      let next = rect;
      for (let index = merged.length - 1; index >= 0; index--) {
        const prior = merged[index],
          touches = next.x <= prior.x + prior.w && next.x + next.w >= prior.x && next.y <= prior.y + prior.h && next.y + next.h >= prior.y;
        if (!touches) continue;
        next = unionLocalBounds(next, prior);
        merged.splice(index, 1);
      }
      merged.push(next);
    }
    return merged;
  }
  function drawAnimationScreenRegion(screenRegion, now) {
    const logicalRegion = {
      x: (screenRegion.x - state.panX) / state.scale,
      y: (screenRegion.y - state.panY) / state.scale,
      w: screenRegion.w / state.scale,
      h: screenRegion.h / state.scale,
    };
    animationCtx.save();
    animationCtx.beginPath();
    animationCtx.rect(screenRegion.x, screenRegion.y, screenRegion.w, screenRegion.h);
    animationCtx.clip();
    animationCtx.translate(state.panX, state.panY);
    animationCtx.scale(state.scale, state.scale);
    animationCtx.beginPath();
    animationCtx.rect(0, 0, SIZE, SIZE);
    animationCtx.clip();
    drawAnimationsToContext(animationCtx, logicalRegion, now);
    animationCtx.restore();
  }
  function clearAnimationLayer() {
    const d = devicePixelRatio || 1,
      rect = view.getBoundingClientRect();
    animationCtx.setTransform(d, 0, 0, d, 0, 0);
    animationCtx.clearRect(0, 0, rect.width, rect.height);
    state.animationScreenBoxes.clear();
    state.animationRenderedPlayheads.clear();
    state.animationFullRedraw = true;
  }
  function renderAnimationLayer(now = performance.now()) {
    if (!pluginEnabled("animation")) {
      clearAnimationLayer();
      return;
    }
    const d = devicePixelRatio || 1,
      rect = view.getBoundingClientRect(),
      visible = viewportRect(),
      animations = visibleAnimations(visible),
      currentBoxes = new Map(animations.map((animation) => [animation.id, animationScreenBox(animation)])),
      currentPlayheads = new Map(animations.map((animation) => [animation.id, animationPlayhead(animation, now)]));
    let dirty = [];
    if (state.animationFullRedraw) dirty.push({ x: 0, y: 0, w: rect.width, h: rect.height });
    else {
      for (const [id, oldBox] of state.animationScreenBoxes) {
        const nextBox = currentBoxes.get(id);
        if (!sameAnimationScreenBox(oldBox, nextBox)) dirty.push(oldBox);
      }
      for (const [id, nextBox] of currentBoxes) {
        const oldBox = state.animationScreenBoxes.get(id),
          previousPlayhead = state.animationRenderedPlayheads.get(id),
          nextPlayhead = currentPlayheads.get(id);
        if (!sameAnimationScreenBox(oldBox, nextBox) || previousPlayhead === undefined || Math.abs(previousPlayhead - nextPlayhead) > 0.01) dirty.push(nextBox);
      }
    }
    dirty = mergeAnimationDirtyRects(dirty.map((box) => clippedScreenBox(box, rect)).filter(Boolean));
    animationCtx.setTransform(d, 0, 0, d, 0, 0);
    for (const region of dirty) {
      animationCtx.clearRect(region.x, region.y, region.w, region.h);
      drawAnimationScreenRegion(region, now);
    }
    state.animationScreenBoxes = currentBoxes;
    state.animationRenderedPlayheads = currentPlayheads;
    state.animationFullRedraw = false;
  }
  function animationFrameStep(now) {
    state.animationFrame = 0;
    const playing = visiblePlayingAnimations(),
      pendingAnimations = pendingAnimationEntries(),
      pendingPlaying = pendingAnimations.filter((entry) => !document.hidden && !entry.playback.paused && (entry.scene.loop || animationTargetPlayhead(entry, now) < entry.scene.durationMs)),
      renderObjectCount = playing.reduce((sum, animation) => sum + animation.scene.objects.length, 0) + pendingPlaying.reduce((sum, entry) => sum + entry.scene.objects.length, 0),
      minimumFrameMs = 1000 / (renderObjectCount > 24 ? 30 : 60);
    if (!playing.length && !pendingPlaying.length || now - state.animationLastFrame >= minimumFrameMs - 0.5) {
      state.animationLastFrame = now;
      renderAnimationLayer(now);
      if (pendingAnimations.length) renderInteractionLayer();
    }
    if (playing.length || pendingPlaying.length) state.animationFrame = requestAnimationFrame(animationFrameStep);
  }
  function requestAnimationLayerRender() {
    if (!pluginEnabled("animation") || state.animationFrame || document.hidden) return;
    state.animationFrame = requestAnimationFrame(animationFrameStep);
  }
  function stopAnimationFrames() {
    if (state.animationFrame) cancelAnimationFrame(state.animationFrame);
    state.animationFrame = 0;
  }
  function requestRender() {
    requestAnimationLayerRender();
    if (state.renderQueued) return;
    state.renderQueued = true;
    requestAnimationFrame(() => {
      state.renderQueued = false;
      render();
    });
  }
  function requestInteractionLayerRender() {
    if (state.interactionRenderQueued) return;
    state.interactionRenderQueued = true;
    requestAnimationFrame(() => {
      state.interactionRenderQueued = false;
      renderInteractionLayer();
    });
  }
  function forTiles(x, y, w, h, fn, create = true) {
    if (w <= 0 || h <= 0) return;
    const x0 = Math.max(0, Math.floor(x / TILE)),
      y0 = Math.max(0, Math.floor(y / TILE)),
      x1 = Math.min(Math.ceil(SIZE / TILE) - 1, Math.ceil((x + w) / TILE) - 1),
      y1 = Math.min(Math.ceil(SIZE / TILE) - 1, Math.ceil((y + h) / TILE) - 1);
    if (x1 < x0 || y1 < y0) return;
    for (let ty = y0; ty <= y1; ty++)
      for (let tx = x0; tx <= x1; tx++) {
        const c = tile(tx, ty, create);
        if (c) fn(c, tx, ty);
      }
  }
