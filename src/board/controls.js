  function runtimeElementStyle(element, key) {
    if (!element || !key) return null;
    let record = runtimeStyleRules.get(key);
    if (!record) {
      const className = `lumi6-runtime-${String(key).replace(/[^a-z0-9_-]/gi, "-")}`,
        sheet = textEditorStyleSheet();
      if (!sheet) return null;
      try {
        const index = sheet.cssRules.length;
        sheet.insertRule(`.${className} {}`, index);
        record = { className, style:sheet.cssRules[index]?.style || null };
        if (!record.style) return null;
        runtimeStyleRules.set(key, record);
      } catch {
        return null;
      }
    }
    element.classList.add(record.className);
    return record.style;
  }
  const setStatus = (text, key = null) => {
    const clean = String(text || "");
    if (/access has expired/i.test(clean)) {
      status.textContent = "Ready";
      state.statusKey = "ready";
      return;
    }
    status.textContent = clean;
    state.statusKey = key;
  };
  const setStatusKey = (key) => setStatus(t(key), key);
  const t = (key) => I18N.en[key] || key;
  const summonFX = SUMMON?.create({
    fxCanvas:summonLayer,
    textLayer: document.querySelector("#summonTextLayer"),
    t,
    getTransform: () => ({ scale: state.scale, panX: state.panX, panY: state.panY, width: view.clientWidth, height: view.clientHeight, dpr: devicePixelRatio || 1 }),
    getAiColor: () => state.aiColor,
    styleFor: (element) => runtimeElementStyle(element, "summon-copy"),
  });
  function summonBlockers() {
    const visible = viewportRect(),
      rects = [];
    if (visible) {
      for (const [k, c] of tiles) {
        const [tx, ty] = k.split(",").map(Number),
          tileBox = { x: tx * TILE, y: ty * TILE, w: TILE, h: TILE };
        if (!intersection(tileBox, visible)) continue;
        let ink = state.inkBounds.get(k);
        if (ink === undefined) {
          ink = c ? inkBox(c, Math.min(TILE, SIZE - tx * TILE), Math.min(TILE, SIZE - ty * TILE)) : null;
          state.inkBounds.set(k, ink);
        }
        if (ink) rects.push({ x: tileBox.x + ink.x, y: tileBox.y + ink.y, w: ink.w, h: ink.h });
      }
    }
    for (const widget of state.widgets) rects.push({ x: widget.x, y: widget.y, w: widget.w, h: widget.h });
    for (const editor of state.textEditors.values()) {
      const scale = Math.max(0.03, state.scale);
      rects.push({ x: editor.x, y: editor.y, w: editor.widthCss / scale, h: editor.heightCss / scale });
    }
    for (const image of state.images)
      if (Number.isFinite(image.x) && Number.isFinite(image.y)) rects.push({ x: image.x, y: image.y, w: image.logicalWidth || image.width || 0, h: image.logicalHeight || image.height || 0 });
    for (const animation of state.animations)
      if (Number.isFinite(animation.x)) rects.push({ x: animation.x, y: animation.y, w: animation.w, h: animation.h });
    for (const item of state.pending?.items || [])
      if (item && Number.isFinite(item.x)) rects.push({ x: item.x, y: item.y, w: item.layoutWidth || item.w || 0, h: item.layoutHeight || item.h || 0 });
    return rects.filter((r) => r.w > 0 && r.h > 0);
  }
  function summonControlBlockers() {
    const viewRect = view.getBoundingClientRect(),
      viewport = { x:0, y:0, w:view.clientWidth, h:view.clientHeight },
      selectors = [
        ".object-chrome-button",
        ".animation-controls:not([hidden])",
        ".image-edit-bar:not([hidden])",
        ".selection-context-toolbar",
        ".text-editor",
        ".text-input-hint:not([hidden])",
        ".ai-embodiment",
        ".ai-embodiment.menu-open .radial-action",
        "#tip",
      ].join(","),
      rects = [];
    for (const element of view.querySelectorAll(selectors)) {
      const style = getComputedStyle(element),
        rect = element.getBoundingClientRect();
      if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) <= 0.02
        || rect.width <= 0 || rect.height <= 0) continue;
      const padding = 8,
        clipped = intersection({
          x:rect.left - viewRect.left - padding,
          y:rect.top - viewRect.top - padding,
          w:rect.width + padding * 2,
          h:rect.height + padding * 2,
        }, viewport);
      if (clipped) rects.push({ ...clipped, weight:4 });
    }
    return rects;
  }
  function summonScreenBlockers() {
    const scale = Math.max(0.03, state.scale),
      viewport = { x:0, y:0, w:view.clientWidth, h:view.clientHeight },
      padding = 8,
      rects = [];
    for (const rect of summonBlockers()) {
      const clipped = intersection({
        x:rect.x * scale + state.panX - padding,
        y:rect.y * scale + state.panY - padding,
        w:rect.w * scale + padding * 2,
        h:rect.h * scale + padding * 2,
      }, viewport);
      if (clipped) rects.push({ ...clipped, weight:1 });
    }
    return rects.concat(summonControlBlockers());
  }
  function summonPlacement() {
    const width = view.clientWidth,
      height = view.clientHeight,
      scale = Math.max(0.03, state.scale);
    if (width <= 0 || height <= 0 || !SUMMON?.chooseThinkingPlacement) return null;
    const anchor = state.summonAnchor
        ? {
            x:state.summonAnchor.x * scale + state.panX,
            y:state.summonAnchor.y * scale + state.panY,
            w:state.summonAnchor.w * scale,
            h:state.summonAnchor.h * scale,
          }
        : null,
      placement = SUMMON.chooseThinkingPlacement({
        width,
        height,
        anchor,
        blockers:summonScreenBlockers(),
      });
    return {
      x:(placement.x - state.panX) / scale,
      y:(placement.y - state.panY) / scale,
    };
  }
  function showSummon() {
    if (!summonFX || !state.summonEnabled) return;
    const spot = summonPlacement();
    if (spot) summonFX.show(spot);
  }
  function hideSummon() {
    summonFX?.hide();
  }
  function readFeatureTourProgress() {
    try {
      const stored = TOUR.parseProgress(localStorage.getItem(FEATURE_TOUR_STORAGE_KEY));
      featureTour.progress = TOUR.markSeen(stored, featureTour.progress.seen);
    } catch {
      featureTour.progress = TOUR.parseProgress(featureTour.progress);
    }
    return featureTour.progress;
  }
  function markFeatureTourStepsSeen(steps) {
    featureTour.progress = TOUR.markSeen(featureTour.progress, steps.map((step) => step.id));
    try {
      localStorage.setItem(FEATURE_TOUR_STORAGE_KEY, TOUR.serializeProgress(featureTour.progress));
    } catch {}
  }
  function featureTourViewport() {
    const visual = window.visualViewport;
    return visual
      ? { left: visual.offsetLeft, top: visual.offsetTop, width: visual.width, height: visual.height }
      : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
  }
  function featureTourElements(step) {
    return (step?.targets || [])
      .map((selector) => document.querySelector(selector))
      .filter((element) => {
        if (!element?.isConnected || element.hidden || !element.getClientRects().length) return false;
        const rect = element.getBoundingClientRect(),
          computed = window.getComputedStyle(element);
        return TOUR.rectHasArea(rect) && computed.display !== "none" && computed.visibility !== "hidden" && computed.visibility !== "collapse";
      });
  }
  function featureTourTargetRect(step, elements = featureTourElements(step)) {
    return TOUR.unionRects(elements.map((element) => element.getBoundingClientRect()));
  }
  function availableFeatureTourSteps(steps) {
    return (Array.isArray(steps) ? steps : []).filter((step) => featureTourTargetRect(step));
  }
  function featureTourTargetNeedsScroll(rect) {
    const viewport = featureTourViewport(),
      margin = 10;
    return rect && (rect.top < viewport.top + margin || rect.left < viewport.left + margin || rect.bottom > viewport.top + viewport.height - margin || rect.right > viewport.left + viewport.width - margin);
  }
  function observeFeatureTourTargets(elements) {
    featureTour.resizeObserver?.disconnect();
    featureTour.resizeObserver = typeof ResizeObserver === "function" ? new ResizeObserver(scheduleFeatureTourPosition) : null;
    for (const element of elements) featureTour.resizeObserver?.observe(element);
  }
  function stopActiveFeatureTourObserver() {
    featureTour.activeObserver?.disconnect();
    featureTour.activeObserver = null;
  }
  function observeActiveFeatureTour() {
    stopActiveFeatureTourObserver();
    if (typeof MutationObserver !== "function") return false;
    featureTour.activeObserver = new MutationObserver((records) => {
      if (featureTour.active && records.some((record) => !tourLayer.contains(record.target))) scheduleFeatureTourPosition();
    });
    featureTour.activeObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["hidden", "class", "style", "aria-hidden", "open"],
    });
    return true;
  }
  function scheduleFeatureTourPosition() {
    if (!featureTour.active || featureTour.positionFrame) return;
    featureTour.positionFrame = requestAnimationFrame(positionFeatureTour);
  }
  function handleFeatureTourViewportChange() {
    if (featureTour.active) scheduleFeatureTourPosition();
    else if (featureTour.pendingObserver) scheduleFeatureTourPendingRetry();
  }
  function positionFeatureTour() {
    featureTour.positionFrame = 0;
    if (!featureTour.active) return;
    const step = featureTour.steps[featureTour.index],
      elements = featureTourElements(step),
      target = featureTourTargetRect(step, elements);
    if (!target) {
      runtimeElementStyle(tourHighlight, "tour-highlight")?.setProperty("visibility", "hidden");
      runtimeElementStyle(tourCard, "tour-card")?.setProperty("visibility", "hidden");
      showFeatureTourStep(featureTour.index + 1, 1);
      return;
    }
    featureTour.targets = elements;
    const viewport = featureTourViewport(),
      layerStyle = runtimeElementStyle(tourLayer, "tour-layer"),
      padding = step.padding ?? 7,
      viewportRight = viewport.left + viewport.width,
      viewportBottom = viewport.top + viewport.height,
      left = Math.max(viewport.left + 2, target.left - padding),
      top = Math.max(viewport.top + 2, target.top - padding),
      right = Math.min(viewportRight - 2, target.right + padding),
      bottom = Math.min(viewportBottom - 2, target.bottom + padding);
    layerStyle?.setProperty("--tour-viewport-width", `${Math.max(1, Math.floor(viewport.width))}px`);
    layerStyle?.setProperty("--tour-viewport-height", `${Math.max(1, Math.floor(viewport.height))}px`);
    tourCard.classList.toggle("tour-compact", viewport.width < 300);
    const highlightStyle = runtimeElementStyle(tourHighlight, "tour-highlight"),
      cardStyle = runtimeElementStyle(tourCard, "tour-card");
    highlightStyle?.setProperty("left", `${Math.round(left)}px`);
    highlightStyle?.setProperty("top", `${Math.round(top)}px`);
    highlightStyle?.setProperty("width", `${Math.max(2, Math.round(right - left))}px`);
    highlightStyle?.setProperty("height", `${Math.max(2, Math.round(bottom - top))}px`);
    highlightStyle?.setProperty("border-radius", `${step.radius ?? 10}px`);
    const cardRect = tourCard.getBoundingClientRect(),
      coachmarkMargin = viewport.width <= 620 ? 8 : 12,
      position = TOUR.placeCoachmark(target, { width: cardRect.width, height: cardRect.height }, viewport, step.placement, { margin: coachmarkMargin, gap: 15, arrowMargin: 23 });
    cardStyle?.setProperty("left", `${Math.round(position.x)}px`);
    cardStyle?.setProperty("top", `${Math.round(position.y)}px`);
    cardStyle?.setProperty("--tour-arrow-offset", `${Math.round(position.arrowOffset)}px`);
    tourCard.dataset.placement = position.placement;
    highlightStyle?.setProperty("visibility", "visible");
    cardStyle?.setProperty("visibility", "visible");
    if (!featureTour.shownIds.has(step.id)) {
      featureTour.shownIds.add(step.id);
      markFeatureTourStepsSeen([step]);
    }
  }
  function updateFeatureTourLanguage() {
    if (!featureTour.active) return;
    const step = featureTour.steps[featureTour.index],
      current = featureTour.index + 1,
      total = featureTour.steps.length,
      counter = t("tourStepCounter").replace("{current}", String(current)).replace("{total}", String(total));
    tourBadge.textContent = t(featureTour.newOnly ? "tourBadgeNew" : "tourBadge");
    tourProgress.textContent = counter;
    tourTitle.textContent = t(step.titleKey);
    tourBody.textContent = t(step.bodyKey);
    tourBackButton.textContent = t("tourBack");
    tourSkipButton.textContent = t("tourSkip");
    tourNextButton.textContent = t(current === total ? "tourDone" : "tourNext");
    tourBackButton.disabled = featureTour.index === 0;
    tourProgressTrack.setAttribute("aria-label", t("tourProgress"));
    tourProgressTrack.setAttribute("aria-valuemax", String(total));
    tourProgressTrack.setAttribute("aria-valuenow", String(current));
    runtimeElementStyle(tourProgressBar, "tour-progress")?.setProperty("width", `${(current / total) * 100}%`);
    tourCard.dataset.stepId = step.id;
    scheduleFeatureTourPosition();
  }
  function showFeatureTourStep(index, direction = 1) {
    let nextIndex = index,
      elements = [];
    while (nextIndex >= 0 && nextIndex < featureTour.steps.length) {
      elements = featureTourElements(featureTour.steps[nextIndex]);
      if (featureTourTargetRect(featureTour.steps[nextIndex], elements)) break;
      nextIndex += direction;
    }
    if (nextIndex < 0 || nextIndex >= featureTour.steps.length) {
      closeFeatureTour();
      return false;
    }
    featureTour.index = nextIndex;
    featureTour.targets = elements;
    runtimeElementStyle(tourCard, "tour-card")?.setProperty("visibility", "hidden");
    runtimeElementStyle(tourHighlight, "tour-highlight")?.setProperty("visibility", "hidden");
    updateFeatureTourLanguage();
    const rect = featureTourTargetRect(featureTour.steps[nextIndex], elements);
    if (featureTourTargetNeedsScroll(rect)) elements[0].scrollIntoView({ block: featureTour.steps[nextIndex].placement === "center" ? "center" : "nearest", inline: "nearest", behavior: "auto" });
    observeFeatureTourTargets(elements);
    const stepId = featureTour.steps[nextIndex].id;
    requestAnimationFrame(() => {
      if (!featureTour.active || featureTour.steps[featureTour.index]?.id !== stepId) return;
      positionFeatureTour();
      if (featureTour.active && featureTour.steps[featureTour.index]?.id === stepId) tourTitle.focus({ preventScroll: true });
    });
    return true;
  }
  function startFeatureTour(steps, options = {}) {
    const available = availableFeatureTourSteps(steps);
    if (!available.length || !tourLayer || !TOUR) return false;
    if (featureTour.active) closeFeatureTour({ restore: false, scroll: false, retry: false, changelog: false });
    cancelAnimationFrame(featureTour.retryFrame);
    featureTour.retryFrame = 0;
    hideAutoDelayControl();
    hideEffortControl();
    hidePluginControl();
    closeRadialMenu();
    featureTour.active = true;
    featureTour.steps = available;
    featureTour.index = 0;
    featureTour.replay = Boolean(options.replay);
    featureTour.newOnly = Boolean(options.newOnly);
    featureTour.shownIds = new Set();
    featureTour.restoreFocus = document.activeElement;
    featureTour.restoreScrollX = window.scrollX;
    featureTour.restoreScrollY = window.scrollY;
    tourMain.inert = true;
    document.body.classList.add("tour-open");
    tourLayer.hidden = false;
    tourLayer.setAttribute("aria-hidden", "false");
    runtimeElementStyle(tourHighlight, "tour-highlight")?.setProperty("visibility", "hidden");
    observeActiveFeatureTour();
    return showFeatureTourStep(0, 1);
  }
  function closeFeatureTour(options = {}) {
    if (!featureTour.active) return false;
    const restore = options.restore !== false,
      restoreScroll = options.scroll !== false,
      restoreFocus = featureTour.restoreFocus;
    featureTour.active = false;
    cancelAnimationFrame(featureTour.positionFrame);
    featureTour.positionFrame = 0;
    featureTour.resizeObserver?.disconnect();
    featureTour.resizeObserver = null;
    stopActiveFeatureTourObserver();
    featureTour.targets = [];
    tourLayer.hidden = true;
    tourLayer.setAttribute("aria-hidden", "true");
    tourMain.inert = false;
    document.body.classList.remove("tour-open");
    runtimeElementStyle(tourHighlight, "tour-highlight")?.setProperty("visibility", "hidden");
    runtimeElementStyle(tourCard, "tour-card")?.setProperty("visibility", "hidden");
    if (restoreScroll) window.scrollTo({ left: featureTour.restoreScrollX, top: featureTour.restoreScrollY, behavior: "auto" });
    requestAnimationFrame(() => {
      if (featureTour.active) return;
      if (options.changelog !== false && maybeShowChangelog()) return;
      if (restore) {
        const target = restoreFocus?.isConnected && restoreFocus !== document.body ? restoreFocus : settingsButton;
        target?.focus({ preventScroll: true });
      }
    });
    if (options.retry !== false) scheduleFeatureTourPendingRetry();
    return true;
  }
  function nextFeatureTourStep() {
    if (!featureTour.active) return false;
    if (featureTour.index >= featureTour.steps.length - 1) return closeFeatureTour();
    return showFeatureTourStep(featureTour.index + 1, 1);
  }
  function previousFeatureTourStep() {
    if (!featureTour.active || featureTour.index <= 0) return false;
    return showFeatureTourStep(featureTour.index - 1, -1);
  }
  function skipFeatureTour() {
    if (!featureTour.active) return false;
    markFeatureTourStepsSeen(availableFeatureTourSteps(FEATURE_TOUR_STEPS));
    return closeFeatureTour();
  }
  function replayFeatureTour() {
    readFeatureTourProgress();
    return startFeatureTour(FEATURE_TOUR_STEPS, { replay: true, newOnly: false });
  }
  function stopFeatureTourPendingObserver() {
    featureTour.pendingObserver?.disconnect();
    featureTour.pendingObserver = null;
  }
  function scheduleFeatureTourPendingRetry() {
    if (featureTour.active || featureTour.retryFrame) return false;
    featureTour.retryFrame = requestAnimationFrame(() => {
      featureTour.retryFrame = 0;
      if (featureTour.active) return;
      maybeStartFeatureTour(true);
    });
    return true;
  }
  function watchForPendingFeatureTour() {
    if (featureTour.pendingObserver || typeof MutationObserver !== "function") return false;
    featureTour.pendingObserver = new MutationObserver((records) => {
      if (!featureTour.active && records.some((record) => !tourLayer.contains(record.target))) scheduleFeatureTourPendingRetry();
    });
    featureTour.pendingObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["hidden", "class", "style", "aria-hidden", "open"],
    });
    return true;
  }
  function maybeStartFeatureTour(retry = false) {
    featureTour.autoChecked = true;
    stopFeatureTourPendingObserver();
    return false;
  }
  function featureTourFocusableButtons() {
    return [tourSkipButton, tourBackButton, tourNextButton].filter((button) => button && !button.disabled && !button.hidden);
  }
  function handleFeatureTourKeydown(event) {
    if (!featureTour.active) return false;
    if (event.key === "Tab") {
      const buttons = featureTourFocusableButtons(),
        current = buttons.indexOf(document.activeElement),
        next = event.shiftKey ? (current <= 0 ? buttons.length - 1 : current - 1) : current < 0 || current === buttons.length - 1 ? 0 : current + 1;
      event.preventDefault();
      event.stopImmediatePropagation();
      buttons[next]?.focus();
      return true;
    }
    if ((event.key === "Enter" || event.key === " ") && event.target instanceof HTMLButtonElement && tourCard.contains(event.target)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      event.target.click();
      return true;
    }
    const action = TOUR.keyAction(event);
    if (action) event.preventDefault();
    event.stopImmediatePropagation();
    if (action === "next") nextFeatureTourStep();
    else if (action === "back") previousFeatureTourStep();
    else if (action === "skip") skipFeatureTour();
    return true;
  }
  function changelogSeen() {
    try {
      return localStorage.getItem(CHANGELOG_STORAGE_KEY) === CHANGELOG_VERSION;
    } catch {
      return false;
    }
  }
  function markChangelogSeen() {
    try {
      localStorage.setItem(CHANGELOG_STORAGE_KEY, CHANGELOG_VERSION);
    } catch {}
  }
  function maybeShowChangelog(force = false) {
    if (!force) return false;
    if (!changelogLayer || !changelogDialog || changelog.active || featureTour.active || (pluginPopover && !pluginPopover.hidden) || (!force && changelogSeen())) return false;
    hideAutoDelayControl();
    hideEffortControl();
    hidePluginControl();
    closeRadialMenu();
    const active = document.activeElement;
    changelog.restoreFocus = active?.isConnected && active !== document.body && !tourLayer.contains(active) ? active : settingsButton;
    changelog.active = true;
    tourMain.inert = true;
    document.body.classList.add("changelog-open");
    changelogLayer.hidden = false;
    changelogLayer.setAttribute("aria-hidden", "false");
    requestAnimationFrame(() => changelogDialog.focus({ preventScroll: true }));
    return true;
  }
  function closeChangelog() {
    if (!changelog.active) return false;
    const restoreFocus = changelog.restoreFocus;
    changelog.active = false;
    changelog.restoreFocus = null;
    markChangelogSeen();
    changelogLayer.hidden = true;
    changelogLayer.setAttribute("aria-hidden", "true");
    document.body.classList.remove("changelog-open");
    tourMain.inert = featureTour.active || Boolean(pluginPopover && !pluginPopover.hidden);
    requestAnimationFrame(() => {
      if (!featureTour.active && !changelog.active) restoreFocus?.focus({ preventScroll: true });
    });
    scheduleFeatureTourPendingRetry();
    return true;
  }
  function handleChangelogKeydown(event) {
    if (!changelog.active) return false;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeChangelog();
      return true;
    }
    if (event.key !== "Tab") return false;
    const focusable = [changelogCloseButton, changelogDoneButton].filter((button) => button && !button.disabled && !button.hidden),
      current = focusable.indexOf(document.activeElement),
      next = event.shiftKey ? (current <= 0 ? focusable.length - 1 : current - 1) : current < 0 || current === focusable.length - 1 ? 0 : current + 1;
    event.preventDefault();
    event.stopPropagation();
    focusable[next]?.focus();
    return true;
  }
  const settings = { open: false, restoreFocus: null };
  function updateSettingsPanel() {
    if (!settingsPanel) return;
    settingsAutoToggle.classList.toggle("on", state.auto);
    settingsAutoToggle.setAttribute("aria-checked", String(state.auto));
    summonToggle.classList.toggle("on", state.summonEnabled);
    summonToggle.setAttribute("aria-checked", String(state.summonEnabled));
  }
  function openSettings() {
    if (settings.open || !settingsLayer) return false;
    hideAutoDelayControl();
    hideEffortControl();
    hidePluginControl();
    closeRadialMenu();
    settings.open = true;
    settings.restoreFocus = document.activeElement?.isConnected && document.activeElement !== document.body ? document.activeElement : settingsButton;
    settingsLayer.hidden = false;
    settingsLayer.setAttribute("aria-hidden", "false");
    settingsButton.setAttribute("aria-expanded", "true");
    updateSettingsPanel();
    requestAnimationFrame(() => settingsPanel.focus({ preventScroll: true }));
    return true;
  }
  function closeSettings(restore = true) {
    if (!settings.open) return false;
    settings.open = false;
    settingsLayer.hidden = true;
    settingsLayer.setAttribute("aria-hidden", "true");
    settingsButton.setAttribute("aria-expanded", "false");
    if (restore) requestAnimationFrame(() => settings.restoreFocus?.focus({ preventScroll: true }));
    settings.restoreFocus = null;
    return true;
  }
  function setSummonEnabled(enabled) {
    state.summonEnabled = Boolean(enabled);
    localStorage.setItem("lumi6-summon-enabled", String(state.summonEnabled));
    if (!state.summonEnabled) hideSummon();
    updateSettingsPanel();
  }
  function maybeStartOnboarding() {
    return false;
  }
  function autoDelayText() {
    const seconds = state.autoDelayMs / 1000;
    return Number.isInteger(seconds) ? String(seconds) : String(Number(seconds.toFixed(1)));
  }
  function updateAutoControl() {
    const button = document.querySelector("#auto"),
      range = document.querySelector("#autoDelayRange"),
      value = document.querySelector("#autoDelayValue"),
      label = document.querySelector("#autoLabel");
    if (button) {
      button.classList.toggle("active", state.auto);
      button.setAttribute("aria-pressed", String(state.auto));
    }
    if (label) {
      label.textContent = state.auto ? t("autoEnabled").replace("{delay}", autoDelayText()) : t("autoDisabled");
    }
    if (range) range.value = String(state.autoDelayMs / 1000);
    if (value) value.textContent = `${autoDelayText()} s`;
    if (settingsAutoToggle) {
      settingsAutoToggle.classList.toggle("on", state.auto);
      settingsAutoToggle.setAttribute("aria-checked", String(state.auto));
    }
  }
  function updateEffortControl() {
    if (!EFFORT_OPTIONS.includes(state.reasoningEffort)) state.reasoningEffort = "config";
    const control = document.querySelector("#effortControl"),
      button = document.querySelector("#aiEffortButton"),
      label = document.querySelector("#aiEffortLabel"),
      levelKey = { config:"effortConfigured", none:"effortNone", low:"effortLow", medium:"effortMedium", high:"effortHigh", max:"effortMaximum" }[state.reasoningEffort] || "effortConfigured",
      level = t({ config:"effortConfiguredShort", medium:"effortMediumShort" }[state.reasoningEffort] || levelKey),
      text = t("reasoningEffortDisplay").replace("{level}", level);
    if (label) label.textContent = text;
    if (button) {
      button.setAttribute("aria-label", text);
      button.setAttribute("title", text);
      const pop = document.querySelector("#effortPopover");
      button.setAttribute("aria-expanded", String(pop ? !pop.hidden : false));
    }
    if (control) control.dataset.effort = state.reasoningEffort;
    document.querySelectorAll("#effortOptions .effort-option").forEach((option) => {
      const optionKey = { config:"effortConfigured", none:"effortNone", low:"effortLow", medium:"effortMedium", high:"effortHigh", max:"effortMaximum" }[option.dataset.effort] || "effortConfigured";
      const optLabel = option.querySelector("[data-effort-label]");
      if (optLabel) optLabel.textContent = t(optionKey);
      option.setAttribute("aria-selected", String(option.dataset.effort === state.reasoningEffort));
      option.classList.toggle("active", option.dataset.effort === state.reasoningEffort);
    });
  }
  function hideAutoDelayControl() {
    clearTimeout(state.autoPopoverTimer);
    state.autoPopoverTimer = 0;
    const pop = document.querySelector("#autoDelayPopover");
    if (pop) pop.hidden = true;
    const btn = document.querySelector("#auto");
    if (btn) btn.setAttribute("aria-expanded", "false");
  }
  function keepAutoDelayControlOpen() {
    clearTimeout(state.autoPopoverTimer);
    state.autoPopoverTimer = setTimeout(hideAutoDelayControl, 5000);
  }
  function showAutoDelayControl() {
    const pop = document.querySelector("#autoDelayPopover");
    if (pop) pop.hidden = false;
    const btn = document.querySelector("#auto");
    if (btn) btn.setAttribute("aria-expanded", "true");
    keepAutoDelayControlOpen();
  }
  function hideEffortControl() {
    clearTimeout(state.effortPopoverTimer);
    state.effortPopoverTimer = 0;
    const pop = document.querySelector("#effortPopover");
    if (pop) pop.hidden = true;
    const btn = document.querySelector("#aiEffortButton");
    if (btn) btn.setAttribute("aria-expanded", "false");
  }
  function keepEffortControlOpen() {
    clearTimeout(state.effortPopoverTimer);
    state.effortPopoverTimer = setTimeout(hideEffortControl, 5000);
  }
  function showEffortControl() {
    const pop = document.querySelector("#effortPopover");
    if (pop) pop.hidden = false;
    const btn = document.querySelector("#aiEffortButton");
    if (btn) btn.setAttribute("aria-expanded", "true");
    updateEffortControl();
    keepEffortControlOpen();
  }
