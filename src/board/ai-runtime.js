// AI requests, validation, generated drafts, plotting, and draft interaction.
  function supersedeActiveAI(reason) {
    const active = state.activeAI;
    if (active && !active.superseded) {
      active.superseded = true;
      active.controller.abort();
      if (state.activeAI === active) {
        state.activeAI = null;
        setBusy(false);
      }
      if (!active.dirtyRestored && !active.oneShotInput && active.recognitionGeneration === state.recognitionGeneration) {
        restoreDirty(active.dirtySnapshot);
        active.dirtyRestored = true;
        state.autoEligible = Boolean(state.dirty);
      }
      debug("ai-deferred", { requestId: state.lastRequestId, reason });
    }
  }
  function hasUnsettledToolbox() {
    return Boolean(state.pending || state.pendingWidget || state.pendingGesture || state.widgetEdit || state.widgetGesture || state.imageEdit || state.imageGesture || state.imageImporting || state.selection || state.selectionGesture || state.textEditors.size);
  }
  function launchAutomaticAI(reason) {
    if (window.__atlasTeachingLock) return;
    if (!state.auto || !state.dirty || !state.autoEligible || state.drawing) return;
    if (currentWidgetRefineCandidate()) {
      if (state.statusKey !== "widgetRefinePending") setStatusKey("widgetRefinePending");
      return;
    }
    if (hasUnsettledToolbox()) {
      if (state.statusKey !== "autoToolboxPending") setStatusKey("autoToolboxPending");
      return;
    }
    clearWidgetRefineCandidate();
    supersedeActiveAI(reason);
    requestAI("auto");
  }
  function schedule(delay = state.autoDelayMs) {
    clearTimeout(state.timer);
    state.timer = 0;
    if (!state.auto || !state.dirty || !state.autoEligible) return;
    if (currentWidgetRefineCandidate()) {
      if (state.statusKey !== "widgetRefinePending") setStatusKey("widgetRefinePending");
      return;
    }
    state.timer = setTimeout(() => {
      state.timer = 0;
      launchAutomaticAI("new-stroke-deadline");
    }, Math.max(0, delay));
  }
  function inkBox(c, scanWidth = c.width, scanHeight = c.height) {
    const width = Math.max(0, Math.min(c.width, Math.floor(scanWidth))),
      height = Math.max(0, Math.min(c.height, Math.floor(scanHeight)));
    if (!width || !height) return null;
    const d = c.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, width, height).data;
    let x0 = width,
      y0 = height,
      x1 = -1,
      y1 = -1;
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        if (d[i + 3] && !(d[i] > 248 && d[i + 1] > 248 && d[i + 2] > 248)) {
          x0 = Math.min(x0, x);
          y0 = Math.min(y0, y);
          x1 = Math.max(x1, x);
          y1 = Math.max(y1, y);
        }
      }
    return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }
  function inkBoxInRect(c, rx, ry, rw, rh) {
    const x = Math.max(0, Math.floor(rx));
    const y = Math.max(0, Math.floor(ry));
    const width = Math.max(0, Math.min(c.width - x, Math.floor(rw)));
    const height = Math.max(0, Math.min(c.height - y, Math.floor(rh)));
    if (!width || !height) return null;
    const d = c.getContext("2d", { willReadFrequently: true }).getImageData(x, y, width, height).data;
    let x0 = width,
      y0 = height,
      x1 = -1,
      y1 = -1;
    for (let py = 0; py < height; py++)
      for (let px = 0; px < width; px++) {
        const i = (py * width + px) * 4;
        if (d[i + 3] && !(d[i] > 248 && d[i + 1] > 248 && d[i + 2] > 248)) {
          x0 = Math.min(x0, px);
          y0 = Math.min(y0, py);
          x1 = Math.max(x1, px);
          y1 = Math.max(y1, py);
        }
      }
    return x1 < 0 ? null : { x: x + x0, y: y + y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }
  function intersection(a, b) {
    const x = Math.max(a.x, b.x),
      y = Math.max(a.y, b.y),
      right = Math.min(a.x + a.w, b.x + b.w),
      bottom = Math.min(a.y + a.h, b.y + b.h);
    return right > x && bottom > y ? { x, y, w: right - x, h: bottom - y } : null;
  }
  function containsRect(outer, inner) {
    return Boolean(outer && inner
      && inner.x >= outer.x && inner.y >= outer.y
      && inner.x + inner.w <= outer.x + outer.w
      && inner.y + inner.h <= outer.y + outer.h);
  }
  async function requestAI(action, packedOverride = null, requestOptions = null) {
    requestOptions = requestOptions || {};
    clearWidgetRefineCandidate();
    const automatic = action === "auto",
      isolatedSelection = Boolean(requestOptions.isolatedSelection),
      oneShotInput = Boolean(requestOptions.oneShotInput),
      captureCurrentViewport = Boolean(requestOptions.captureCurrentViewport),
      widgetEditTarget = requestOptions.widgetEditTarget || null,
      widgetEditContext = requestOptions.widgetEditContext || null,
      revision = state.userRevision,
      recognitionGeneration = state.recognitionGeneration,
      aiColor = state.aiColor,
      dirtySnapshot = state.dirty ? { ...state.dirty } : null,
      latestBox = dirtySnapshot || state.lastUserBox,
      attentionBox = dirtySnapshot || (captureCurrentViewport ? null : latestBox),
      hotspotCount = isolatedSelection ? 0 : state.hotspotTrail.length,
      packed = packedOverride || (captureCurrentViewport || attentionBox ? buildViewportImage(state.hotspotTrail.slice(0, hotspotCount), attentionBox, captureCurrentViewport) : null),
      typedInput = !isolatedSelection && state.latestTypedInput && containsRect(packed?.sourceRect, state.latestTypedInput.box)
        ? state.latestTypedInput
        : null,
      preservedRecognition = isolatedSelection
        ? {
            dirty: state.dirty ? { ...state.dirty } : null,
            autoEligible: state.autoEligible,
            lastUserBox: state.lastUserBox ? { ...state.lastUserBox } : null,
            hotspotTrail: state.hotspotTrail.slice(),
            latestTypedInput: state.latestTypedInput,
          }
        : null;
    if (pluginEnabled("flowchart")) {
      try { await ensurePluginRuntime("flowchart"); }
      catch (error) {
        setStatus(`${t("aiError")}${error.message}`);
        return;
      }
    }
    if (!packed) {
      discardUncapturableInput(hotspotCount, Boolean(dirtySnapshot));
      if (preservedRecognition) {
        state.dirty = preservedRecognition.dirty;
        state.autoEligible = preservedRecognition.autoEligible;
        state.lastUserBox = preservedRecognition.lastUserBox;
        state.hotspotTrail = preservedRecognition.hotspotTrail;
        state.latestTypedInput = preservedRecognition.latestTypedInput;
      }
      setStatusKey(latestBox ? "cannotCapture" : "noInk");
      return;
    }
    const requestBox = packed.changedBox;
    if (!isolatedSelection) {
      state.dirty = null;
      state.autoEligible = false;
      if (hotspotCount) state.hotspotTrail.splice(0, hotspotCount);
      state.latestTypedInput = null;
      state.lastUserBox = requestBox;
    }
    const controller = new AbortController(),
      // A selection-scoped request never consumes the normal recognition state. Mark its
      // snapshot as already preserved so superseding it cannot merge stale dirty ink back in.
      run = { controller, dirtySnapshot, recognitionGeneration, superseded: false, dirtyRestored: true, inputConsumed:!isolatedSelection, isolatedSelection, oneShotInput, selection: requestOptions.selection || null, selectionRequestToken: requestOptions.selectionRequestToken || null, widgetEdit:widgetEditTarget ? { target:widgetEditTarget, targetId:widgetEditTarget.id, pluginId:widgetEditTarget.pluginId, revision } : null, action };
    state.activeAI = run;
    state.summonAnchor = dirtySnapshot || state.lastUserBox || null;
    setBusy(true);
    setStatusKey(isolatedSelection && action === "normalize" ? "selectionTypesetting" : "observing");
    const timeout = setTimeout(() => controller.abort(), state.aiRequestTimeoutMs);
    try {
      const res = await fetch("/api/ai/command", {
          signal: controller.signal,
          method: "POST",
          credentials: "same-origin",
          headers: authenticatedApiHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({
            ...packed,
            trigger: automatic ? "user_paused" : "manual",
            userAction: action,
            ...(state.reasoningEffort === "config" ? {} : { reasoningEffort: state.reasoningEffort }),
            ...pluginRequestPayload(),
            ...(widgetEditContext ? { widgetEdit:widgetEditContext } : {}),
            ...(typedInput ? { typedInput } : {}),
            canvasSize: { w: SIZE, h: SIZE },
            uiTheme: state.theme,
            persona: {
              research: "Rigorous mathematical-physics research and teaching mentor. Prioritize assumptions, derivations, units, physical interpretation, proofs, and verifiable code or numerical checks when useful. Be concise but academically precise; never claim to literally be Einstein unless asked for roleplay.",
              scifi: "Pragmatic futuristic engineering copilot. Prioritize programming, debugging, algorithms, architecture, systems thinking, quantitative tradeoffs, and plausible emerging technology. Give concise, actionable answers rather than decorative sci-fi prose.",
              arcane: "Warm interdisciplinary knowledge guide. Favor intuition, memorable analogies, creative synthesis, conceptual connections across science and humanities, and exploratory alternatives while keeping facts and reasoning precise.",
              studio: "Minimal, well-organized general-purpose studio assistant. Prioritize clear structure, legible formatting, concise step-by-step reasoning, and practical actionable answers. Keep visual output clean and uncluttered; avoid decorative flourishes.",
              indic: "Warm, culturally enriched, and insightful guide drawing upon Indian knowledge systems, history, mathematics, literature, languages, and modern technology. Prioritize clear structure, intuitive analogies, and rich contextual explanations.",
            }[state.theme],
          }),
        }),
        data = await res.json();
      if (run.superseded || state.activeAI !== run) throw Error(AI_SUPERSEDED);
      rememberRequest(data.requestId);
      if (!res.ok) {
        const error = Error(data.error || `HTTP ${res.status}`);
        error.status = res.status;
        throw error;
      }
      // Draft confirmation is a separate interaction after the model request has ended.
      if (state.activeAI === run) setBusy(false);
      const rawCommands = Array.isArray(data.commands) ? data.commands : [],
        rawCount = rawCommands.length,
        animationLimitReached = pluginEnabled("animation") && state.animations.length >= MAX_VISIBLE_ANIMATIONS && rawCommands.some((command) => (command?.tool || command?.type || command?.name) === "animate_scene"),
        widgetLimitReached = !widgetEditTarget && state.widgets.length >= MAX_VISIBLE_WIDGETS && rawCommands.some((command) => ["html_widget", "diagram_source"].includes(command?.tool || command?.type || command?.name)),
        commands = normalizeCommandPlacements(validate(rawCommands, aiColor, widgetEditTarget, packed.visibleRect), packed, requestBox),
        meta = { requestId: data.requestId };
      if (action === "normalize")
        for (let index = commands.length - 1; index >= 0; index--)
          if (!["write_text", "draw_formula", "plot_function"].includes(commands[index].tool)) commands.splice(index, 1);
      if (isolatedSelection && action === "normalize") {
        const relocated = relocateIsolatedTypesetCommands(commands, requestOptions.selection || run.selection);
        commands.splice(0, commands.length, ...relocated);
      }
      debug("ai-response", {
        ...meta,
        intent: data.intent || "none",
        rawCount,
        attempts: data.attempts || 1,
      });
      debug("commands-validated", {
        ...meta,
        rawCount,
        validCount: commands.length,
        rejectedCount: rawCount - commands.length,
        tools: commands.map((c) => c.tool),
      });
      if (state.userRevision !== revision) {
        if (!isolatedSelection && !oneShotInput && !run.inputConsumed && state.recognitionGeneration === recognitionGeneration) {
          restoreDirty(dirtySnapshot);
          state.autoEligible = Boolean(state.dirty);
          schedule();
        }
        setStatusKey("deferred");
        debug("ai-deferred", { ...meta, reason: "user-revision-changed" });
        return;
      }
      if (commands.length) {
        setStatusKey("writing");
        if (commands.length === 1 && !["draw", "erase"].includes(commands[0].tool)) {
          if (state.userRevision !== revision) throw Error(AI_CANCELLED);
          await animate(commands[0], revision, meta, run);
          checkAI(revision, run);
        } else {
          const items = [];
          for (const c of commands) {
            if (state.userRevision !== revision) throw Error(AI_CANCELLED);
            const item = await preparePendingItem(c, revision, meta, run);
            if (item) items.push(item);
            checkAI(revision, run);
          }
          const activeItems = pluginEnabled("animation") ? items : items.filter((item) => !item.animationScene);
          if (!activeItems.length) throw Error(AI_REJECTED);
          resolvePendingItemOverlaps(activeItems, meta);
          checkAI(revision, run);
          const outcome = await startPendingBatch(activeItems, revision, meta);
          checkAI(revision, run);
          if (outcome === AI_CANCELLED) throw Error(AI_CANCELLED);
          if (outcome === AI_SUPERSEDED) throw Error(AI_SUPERSEDED);
          if (!outcome?.acceptedCount) throw Error(AI_REJECTED);
          debug("tool-complete", { ...meta, batch: true, acceptedCount: outcome.acceptedCount, discardedCount: commands.length - outcome.acceptedCount });
        }
        if (!run.inputConsumed) {
          if (!isolatedSelection) {
            state.lastUserBox = requestBox;
            if (hotspotCount) state.hotspotTrail.splice(0, hotspotCount);
            if (state.latestTypedInput === typedInput) state.latestTypedInput = null;
          }
          run.inputConsumed = true;
        }
        if (!isolatedSelection) save();
        if (animationLimitReached) setStatusKey("animationLimitReached");
        else if (widgetLimitReached) setStatusKey("widgetLimitReached");
        else if (data.message) setStatus(data.message);
        else setStatusKey("aiDone");
      } else {
        if (!isolatedSelection) {
          state.lastUserBox = requestBox;
          if (hotspotCount) state.hotspotTrail.splice(0, hotspotCount);
          if (state.latestTypedInput === typedInput) state.latestTypedInput = null;
        }
        if (animationLimitReached) setStatusKey("animationLimitReached");
        else if (widgetLimitReached) setStatusKey("widgetLimitReached");
        else if (typeof data.message === "string" && data.message.trim()) setStatus(data.message.trim());
        else setStatusKey("aiNoVisibleResponse");
      }
    } catch (e) {
      if (run.superseded) {
        debug("ai-deferred", { requestId: state.lastRequestId, reason: "request-superseded" });
      } else if (e.message === AI_REJECTED) {
        if (!isolatedSelection && !oneShotInput && !run.inputConsumed && state.recognitionGeneration === recognitionGeneration) {
          state.lastUserBox = requestBox;
          if (hotspotCount) state.hotspotTrail.splice(0, hotspotCount);
        }
        setStatusKey("draftRejected");
      } else if (e.message === AI_SUPERSEDED) {
        if (!isolatedSelection && !run.inputConsumed && state.recognitionGeneration === recognitionGeneration) {
          state.lastUserBox = requestBox;
          if (hotspotCount) state.hotspotTrail.splice(0, hotspotCount);
        }
        setStatusKey("ready");
      } else if (state.userRevision !== revision) {
        if (!isolatedSelection && !oneShotInput && !run.inputConsumed && state.recognitionGeneration === recognitionGeneration) {
          restoreDirty(dirtySnapshot);
          state.autoEligible = Boolean(state.dirty);
          schedule();
        }
        setStatusKey("deferred");
        debug("ai-deferred", { requestId: state.lastRequestId, reason: "stale-request-error" });
      } else if (e.message === AI_CANCELLED) {
        if (!isolatedSelection && !oneShotInput && !run.inputConsumed && state.recognitionGeneration === recognitionGeneration) {
          restoreDirty(dirtySnapshot);
          state.autoEligible = Boolean(state.dirty);
          schedule();
        }
        setStatusKey("deferred");
        debug("ai-deferred", {
          requestId: state.lastRequestId,
          reason: "animation-cancelled",
        });
      } else {
        const timedOut = e.name === "AbortError",
          message = timedOut ? t("timeout") : e.message;
        if (!isolatedSelection && !run.inputConsumed && state.recognitionGeneration === recognitionGeneration) {
          restoreDirty(dirtySnapshot);
          state.autoEligible = false;
        }
        setStatus(`${t("aiError")}${message}`);
        debug("ai-error", {
          requestId: state.lastRequestId,
          action,
          error: timedOut ? "timeout" : Number.isInteger(e.status) ? "http-error" : "request-error",
        });
      }
    } finally {
      clearTimeout(timeout);
      if (state.activeAI === run) {
        state.activeAI = null;
        setBusy(false);
      }
      if (!state.activeAI) state.summonAnchor = null;
    }
  }
  function viewportRect() {
    const r = view.getBoundingClientRect(),
      x = Math.max(0, -state.panX / state.scale),
      y = Math.max(0, -state.panY / state.scale),
      right = Math.min(SIZE, (r.width - state.panX) / state.scale),
      bottom = Math.min(SIZE, (r.height - state.panY) / state.scale);
    return right > x && bottom > y ? { x, y, w: right - x, h: bottom - y } : null;
  }
  function visibleInkBounds(visible) {
    let bounds = null;
    for (const [k] of tiles) {
      const [tx, ty] = k.split(",").map(Number),
        tileBox = { x: tx * TILE, y: ty * TILE, w: TILE, h: TILE },
        part = intersection(tileBox, visible);
      if (!part) continue;
      let ink = state.inkBounds.get(k);
      if (ink === undefined) {
        const c = tiles.get(k);
        ink = c ? inkBox(c, Math.min(TILE, SIZE - tx * TILE), Math.min(TILE, SIZE - ty * TILE)) : null;
        state.inkBounds.set(k, ink);
      }
      if (!ink) continue;
      const found = intersection({ x: tileBox.x + ink.x, y: tileBox.y + ink.y, w: ink.w, h: ink.h }, visible);
      if (!found) continue;
      bounds = bounds
        ? {
            x: Math.min(bounds.x, found.x),
            y: Math.min(bounds.y, found.y),
            w: Math.max(bounds.x + bounds.w, found.x + found.w) - Math.min(bounds.x, found.x),
            h: Math.max(bounds.y + bounds.h, found.y + found.h) - Math.min(bounds.y, found.y),
          }
        : found;
    }
    return bounds;
  }
  function mapHotspots(sourceRect, imageSize, points) {
    const columns = 8,
      rows = 8,
      cellW = sourceRect.w / columns,
      cellH = sourceRect.h / rows,
      result = [];
    for (const point of points) {
      if (point.x < sourceRect.x || point.x > sourceRect.x + sourceRect.w || point.y < sourceRect.y || point.y > sourceRect.y + sourceRect.h) continue;
      const col = Math.min(columns - 1, Math.max(0, Math.floor((point.x - sourceRect.x) / cellW))),
        row = Math.min(rows - 1, Math.max(0, Math.floor((point.y - sourceRect.y) / cellH))),
        previous = result.at(-1);
      if (previous && previous.cell[0] === col && previous.cell[1] === row) continue;
      result.push({
        cell: [col, row],
        imageRect: {
          x: Math.round((col * imageSize.w) / columns),
          y: Math.round((row * imageSize.h) / rows),
          w: Math.ceil(imageSize.w / columns),
          h: Math.ceil(imageSize.h / rows),
        },
      });
    }
    return {
      columns,
      rows,
      order: "oldest-to-newest",
      attention: "newest unconsumed pen path; use ordered cells to read and apply every edit inside latestInput.imageRect",
      hotspots: result.slice(-64),
    };
  }
  function captureRectFor(latestBox, visible) {
    // Retained dirty ink from a failed request must never expand the next capture beyond what the user can currently see.
    return visible;
  }
  function buildViewportImage(hotspotPoints, latestBox, captureCurrentViewport = false) {
    const visible = viewportRect();
    if (!visible) return null;
    const captureRect = captureRectFor(latestBox, visible),
      ink = unionLocalBounds(unionLocalBounds(unionLocalBounds(visibleInkBounds(captureRect), imageBounds(captureRect)), textBoxBounds(captureRect)), animationBounds(captureRect)),
      useFullViewport = captureCurrentViewport || Boolean(latestBox && !intersection(latestBox, captureRect));
    if (!useFullViewport && !ink) return null;
    const margin = Math.max(120, Math.min(640, 160 / state.scale)),
      left = useFullViewport ? captureRect.x : Math.max(captureRect.x, ink.x - margin),
      top = useFullViewport ? captureRect.y : Math.max(captureRect.y, ink.y - margin),
      right = useFullViewport ? captureRect.x + captureRect.w : Math.min(captureRect.x + captureRect.w, ink.x + ink.w + margin),
      bottom = useFullViewport ? captureRect.y + captureRect.h : Math.min(captureRect.y + captureRect.h, ink.y + ink.h + margin),
      sourceRect = { x: left, y: top, w: right - left, h: bottom - top },
      // Keep ceil(source * scale) inside the server limits despite floating-point drift.
      imageScale = Math.min(1, MAX_ATLAS_WIDTH / sourceRect.w, MAX_ATLAS_HEIGHT / sourceRect.h) * (1 - Number.EPSILON * 4),
      imageSize = {
        w: Math.max(1, Math.min(MAX_ATLAS_WIDTH, Math.ceil(sourceRect.w * imageScale))),
        h: Math.max(1, Math.min(MAX_ATLAS_HEIGHT, Math.ceil(sourceRect.h * imageScale))),
      },
      out = offscreen(imageSize.w, imageSize.h),
      q = out.getContext("2d");
    const latestVisible = latestBox ? intersection(latestBox, sourceRect) || { ...sourceRect } : captureCurrentViewport ? { ...sourceRect } : null,
      captureTime = performance.now();
    if (!latestVisible) return null;
    q.fillStyle = "#fff";
    q.fillRect(0, 0, out.width, out.height);
    q.setTransform(imageScale, 0, 0, imageScale, -sourceRect.x * imageScale, -sourceRect.y * imageScale);
    q.globalAlpha = 0.42;
    drawImagesToContext(q, sourceRect);
    drawTextBoxesToContext(q, sourceRect);
    drawWidgetsToContext(q, sourceRect);
    forTiles(sourceRect.x, sourceRect.y, sourceRect.w, sourceRect.h, (c, tx, ty) => q.drawImage(c, tx * TILE, ty * TILE), false);
    drawSharpOverlays(q, sourceRect);
    drawAnimationsToContext(q, sourceRect, captureTime);
    q.globalAlpha = 1;
    q.save();
    q.beginPath();
    q.rect(latestVisible.x, latestVisible.y, latestVisible.w, latestVisible.h);
    q.clip();
    drawImagesToContext(q, latestVisible);
    drawTextBoxesToContext(q, latestVisible);
    drawWidgetsToContext(q, latestVisible);
    forTiles(latestVisible.x, latestVisible.y, latestVisible.w, latestVisible.h, (c, tx, ty) => q.drawImage(c, tx * TILE, ty * TILE), false);
    drawSharpOverlays(q, latestVisible);
    drawAnimationsToContext(q, latestVisible, captureTime);
    q.restore();
    const focusInset = FOCUS_INSET_ENABLED ? drawFocusInset(out, latestVisible, sourceRect, imageScale, captureTime) : null,
      hotspotGrid = mapHotspots(sourceRect, imageSize, hotspotPoints);
    debug("atlas-built", {
      scope: captureCurrentViewport ? "current-viewport" : "visible-content",
      visibleRect: visible,
      captureRect,
      sourceRect,
      imageSize,
      imageScale: Number(imageScale.toFixed(4)),
      latestBox: latestVisible,
      focusInset,
      hotspots: hotspotGrid.hotspots.length,
    });
    return {
      atlasImage: out.toDataURL("image/png"),
      atlasSize: imageSize,
      visibleRect: visible,
      captureRect,
      sourceRect,
      imageScale,
      changedBox: latestVisible,
      focusInset,
      hotspotGrid,
    };
  }
  function buildSelectionImage(selection) {
    if (!selection || selection.phase !== "active" || !selection.fragments?.length) return null;
    const content = selectionContentBounds(selection);
    if (!content || content.w <= 0 || content.h <= 0) return null;
    // Use the lasso's own minimum bounding rectangle; the polygon exterior stays white.
    const sourceRect = { ...selection.box },
      imageScale = Math.min(1, MAX_ATLAS_WIDTH / sourceRect.w, MAX_ATLAS_HEIGHT / sourceRect.h) * (1 - Number.EPSILON * 4),
      imageSize = {
        w: Math.max(1, Math.min(MAX_ATLAS_WIDTH, Math.ceil(sourceRect.w * imageScale))),
        h: Math.max(1, Math.min(MAX_ATLAS_HEIGHT, Math.ceil(sourceRect.h * imageScale))),
      },
      out = offscreen(imageSize.w, imageSize.h),
      q = out.getContext("2d");
    q.fillStyle = "#fff";
    q.fillRect(0, 0, out.width, out.height);
    q.setTransform(imageScale, 0, 0, imageScale, -sourceRect.x * imageScale, -sourceRect.y * imageScale);
    for (const fragment of selection.fragments) {
      const target = SELECT.mapFragment(fragment, selection.originalBox, selection.box);
      const source = fragment.renderImage || fragment.image;
      if (!source || !target.w || !target.h) continue;
      try { q.drawImage(source, target.x, target.y, target.w, target.h); } catch {}
    }
    q.setTransform(1, 0, 0, 1, 0, 0);
    const path = selectionPathFor(selection),
      context = {
        box: { ...selection.box },
        path: path.map((point) => ({ x: point.x, y: point.y })),
        closed: true,
      },
      contentRect = { ...content };
    debug("selection-atlas-built", {
      sourceRect,
      contentRect,
      imageSize,
      imageScale: Number(imageScale.toFixed(4)),
      pathPoints: path.length,
    });
    return {
      atlasImage: out.toDataURL("image/png"),
      atlasSize: imageSize,
      visibleRect: { x: 0, y: 0, w: SIZE, h: SIZE },
      captureRect: { ...sourceRect },
      sourceRect,
      imageScale,
      changedBox: { ...sourceRect },
      focusInset: null,
      hotspotGrid: { columns: 8, rows: 8, order: "oldest-to-newest", attention: "newest unconsumed pen path; use ordered cells to read and apply every edit inside latestInput.imageRect", hotspots: [] },
      selectionContext: context,
    };
  }
  function drawFocusInset(out, latestBox, sourceRect, mainScale, captureTime = performance.now()) {
    const largeInput = latestBox.w > 1800 || latestBox.h > 1200,
      padding = largeInput ? Math.max(40, Math.min(120, Math.max(latestBox.w, latestBox.h) * 0.04)) : Math.max(50, Math.min(280, Math.max(latestBox.w, latestBox.h) * 0.18)),
      w = Math.min(sourceRect.w, Math.max(220, latestBox.w + padding * 2)),
      h = Math.min(sourceRect.h, Math.max(160, latestBox.h + padding * 2)),
      x = Math.max(sourceRect.x, Math.min(sourceRect.x + sourceRect.w - w, latestBox.x + latestBox.w / 2 - w / 2)),
      y = Math.max(sourceRect.y, Math.min(sourceRect.y + sourceRect.h - h, latestBox.y + latestBox.h / 2 - h / 2)),
      focusRect = { x, y, w, h },
      targetW = largeInput ? Math.min(1500, out.width * 0.72) : 640,
      targetH = largeInput ? Math.min(1000, out.height * 0.82) : 420,
      focusScale = Math.min(3, targetW / w, targetH / h, Math.max(0.01, (out.width - 24) / w), Math.max(0.01, (out.height - 24) / h)),
      latestPixels = { w: latestBox.w * mainScale, h: latestBox.h * mainScale };
    if (focusScale <= mainScale * 1.05 || (!largeInput && focusScale <= mainScale * 1.35 && latestPixels.w >= 180 && latestPixels.h >= 100)) return null;
    const contentW = Math.max(1, Math.ceil(w * focusScale)),
      contentH = Math.max(1, Math.ceil(h * focusScale)),
      latestCenter = {
        x: (latestBox.x + latestBox.w / 2 - sourceRect.x) * mainScale,
        y: (latestBox.y + latestBox.h / 2 - sourceRect.y) * mainScale,
      },
      insetPadding = 12,
      positions = [
        { x: insetPadding, y: insetPadding },
        { x: out.width - contentW - insetPadding, y: insetPadding },
        { x: insetPadding, y: out.height - contentH - insetPadding },
        { x: out.width - contentW - insetPadding, y: out.height - contentH - insetPadding },
      ].filter((position) => position.x >= insetPadding && position.y >= insetPadding),
      distance = (position) => Math.hypot(position.x + contentW / 2 - latestCenter.x, position.y + contentH / 2 - latestCenter.y),
      position = positions.sort((a, b) => distance(b) - distance(a))[0];
    if (!position) return null;
    const q = out.getContext("2d");
    q.save();
    q.setTransform(1, 0, 0, 1, 0, 0);
    q.fillStyle = "#fff";
    q.fillRect(position.x - 5, position.y - 5, contentW + 10, contentH + 10);
    q.beginPath();
    q.rect(position.x, position.y, contentW, contentH);
    q.clip();
    q.setTransform(focusScale, 0, 0, focusScale, position.x - focusRect.x * focusScale, position.y - focusRect.y * focusScale);
    q.globalAlpha = 0.32;
    drawImagesToContext(q, focusRect);
    drawTextBoxesToContext(q, focusRect);
    forTiles(focusRect.x, focusRect.y, focusRect.w, focusRect.h, (c, tx, ty) => q.drawImage(c, tx * TILE, ty * TILE), false);
    q.globalAlpha = 1;
    drawSharpOverlays(q, focusRect);
    drawAnimationsToContext(q, focusRect, captureTime);
    q.save();
    q.beginPath();
    q.rect(latestBox.x, latestBox.y, latestBox.w, latestBox.h);
    q.clip();
    drawImagesToContext(q, latestBox);
    drawTextBoxesToContext(q, latestBox);
    forTiles(latestBox.x, latestBox.y, latestBox.w, latestBox.h, (c, tx, ty) => q.drawImage(c, tx * TILE, ty * TILE), false);
    q.restore();
    drawSharpOverlays(q, latestBox);
    drawAnimationsToContext(q, latestBox, captureTime);
    q.restore();
    q.save();
    q.setTransform(1, 0, 0, 1, 0, 0);
    q.strokeStyle = "#64748b";
    q.lineWidth = 2;
    q.strokeRect(position.x - 4, position.y - 4, contentW + 8, contentH + 8);
    q.restore();
    return {
      sourceRect: focusRect,
      imageRect: { x: position.x, y: position.y, w: contentW, h: contentH },
      imageScale: focusScale,
      purpose: "magnified duplicate of latestInput for handwriting transcription only",
    };
  }
  function containsRect(outer, inner) {
    const epsilon = 0.001;
    return inner.x >= outer.x - epsilon && inner.y >= outer.y - epsilon && inner.x + inner.w <= outer.x + outer.w + epsilon && inner.y + inner.h <= outer.y + outer.h + epsilon;
  }
  const n = (v, min = 0, max = SIZE) => Number.isFinite(v) && v >= min && v <= max;
  function matchedFontSize(value) {
    const screenReadable = 42 / Math.max(0.03, state.scale);
    return Math.max(24, Math.min(650, Math.max(+value || 180, screenReadable)));
  }
  function matchedTextFontSize(value, text) {
    const size = matchedFontSize(value),
      characters = Array.from(String(text).replace(/\s/g, "")).length;
    return characters < 10 ? size : Math.max(24, size * 0.5);
  }
  function portraitCanvasView() {
    return Boolean(view && view.clientHeight > view.clientWidth * 1.05);
  }
  function relocateIsolatedTypesetCommands(commands, selection) {
    if (!selection?.box || !Array.isArray(commands) || !commands.length) return commands;
    const source = selection.box,
      gap = Math.max(28, 18 / Math.max(0.03, state.scale)),
      below = portraitCanvasView() || window.matchMedia("(max-width: 900px)").matches;
    let y = source.y + source.h + gap,
      x = source.x + source.w + gap;
    return commands.map((command) => {
      if (!["write_text", "draw_formula", "plot_function", "draw"].includes(command.tool)) return command;
      const next = { ...command },
        width = next.tool === "write_text" ? next.maxWidth : Number(next.w) || next.fontSize || 240,
        lines = next.tool === "write_text" ? Math.max(1, String(next.text || "").split("\n").length) : 1,
        height = next.tool === "draw_formula"
          ? (next.fontSize || 48) * 1.8
          : next.tool === "write_text"
            ? (next.fontSize || 32) * (next.lineHeight || 1.35) * lines
            : Number(next.h) || 200;
      if (below) {
        next.x = Math.max(0, Math.min(SIZE - Math.min(width, SIZE), source.x));
        next.y = Math.max(0, Math.min(SIZE - Math.min(height, SIZE), y));
        y = next.y + height + gap;
      } else {
        next.x = Math.max(0, Math.min(SIZE - Math.min(width, SIZE), x));
        next.y = Math.max(0, Math.min(SIZE - Math.min(height, SIZE), source.y));
        x = next.x + width + gap;
      }
      if (next.tool === "write_text") next.maxWidth = Math.max(next.fontSize, Math.min(next.maxWidth, SIZE - next.x));
      return next;
    });
  }
  function normalizeCommandPlacements(commands, packed, latestBox) {
    if (commands.length !== 1) return commands;
    const capture = packed.captureRect,
      padding = Math.max(80, Math.min(320, latestBox.h * 0.15)),
      command = commands[0];
    if (command.tool !== "write_text" && command.tool !== "draw_formula") return commands;
    if (packed.selectionContext) return commands;
    const width = command.tool === "write_text" ? command.maxWidth : command.fontSize,
      height = command.tool === "write_text" ? command.fontSize * command.lineHeight * 2 : command.fontSize * 1.8,
      farAbove = command.y + Math.max(command.fontSize || 100, 120) < capture.y,
      suspiciousCanvasTop = command.y < capture.y + Math.max(200, capture.h * 0.04) && command.y + Math.max(command.fontSize || 100, 120) < latestBox.y - Math.max(400, capture.h * 0.12),
      farOutside = command.y > capture.y + capture.h || command.x > capture.x + capture.w || command.x + width < capture.x;
    if (!farAbove && !suspiciousCanvasTop && !farOutside) return commands;
    const next = { ...command },
      preferredY = Math.max(capture.y, Math.min(capture.y + capture.h - Math.min(height, capture.h), latestBox.y + latestBox.h + padding));
    next.x = Math.max(capture.x, Math.min(capture.x + capture.w - Math.min(width, capture.w), latestBox.x));
    next.y = Math.max(0, Math.min(SIZE - height, preferredY));
    if (next.tool === "write_text") next.maxWidth = Math.max(next.fontSize, Math.min(next.maxWidth, SIZE - next.x));
    return [next];
  }
  function widgetGeometryForViewport(visibleRect) {
    const bucket = (value) => Math.ceil(Math.min(SIZE, Math.max(1, Number(value) || 1)) / 1000) * 1000,
      viewportW = bucket(visibleRect?.w), viewportH = bucket(visibleRect?.h);
    return {
      max:{ w:Math.max(300,Math.round(viewportW/2)), h:Math.max(200,Math.round(viewportH/2)) },
    };
  }
  function fitWidgetGeometry(command, visibleRect) {
    if (!command || ![command.x, command.y, command.w, command.h].every(Number.isFinite)) return null;
    const target = widgetGeometryForViewport(visibleRect).max;
    let x = Math.round(command.x), y = Math.round(command.y),
      w = Math.round(command.w),
      h = Math.round(command.h);
    if (w <= 0 || h <= 0) {
      w = 2400;
      h = 1400;
    } else if (w < 300 || h < 200) {
      const scale = Math.max(300 / w, 200 / h);
      w = Math.ceil(w * scale);
      h = Math.ceil(h * scale);
    }
    if (w > 10000 || h > 10000 || w * h > 40000000) {
      const scale = Math.min(1, target.w / w, target.h / h, 10000 / w, 10000 / h, Math.sqrt(40000000 / (w * h)));
      w = Math.floor(w * scale);
      h = Math.floor(h * scale);
    }
    w = Math.max(300, w);
    h = Math.max(200, h);
    w = Math.min(w, SIZE);
    h = Math.min(h, SIZE);
    x = Math.max(0, Math.min(SIZE - w, x));
    y = Math.max(0, Math.min(SIZE - h, y));
    return w >= 300 && h >= 200 ? { x, y, w, h } : null;
  }
  function validWidgetRefreshSeconds(value) {
    return value === 0 || n(value, 60, 86400);
  }
  function validate(cmds, aiColor = state.aiColor, widgetEditTarget = null, visibleRect = null) {
    if (!Array.isArray(cmds)) return [];
    let plotPixels = 0,
      animationSlots = pluginEnabled("animation") ? Math.max(0, MAX_VISIBLE_ANIMATIONS - state.animations.length) : 0,
      widgetSlots = widgetEditTarget ? 1 : Math.max(0, MAX_VISIBLE_WIDGETS - state.widgets.length),
      widgetPluginIds = new Set(enabledPluginDescriptors().map((plugin) => plugin.id));
    const acceptedTools = pluginEnabled("animation")
      ? ["write_text", "draw_formula", "plot_function", "draw", "animate_scene", "erase"]
      : ["write_text", "draw_formula", "plot_function", "draw", "erase"];
    if (widgetPluginIds.size) acceptedTools.push("html_widget");
    if (widgetPluginIds.has("flowchart")) acceptedTools.push("diagram_source");
    const validated = cmds
      .slice(0, 16)
      .map((c) => (c && typeof c === "object" ? { ...c, tool: c.tool || c.type || c.name } : c))
      .filter((c) => c && acceptedTools.includes(c.tool))
      .map((c) => {
        c = { ...c };
        if (c.tool === "write_text") {
          if (typeof c.text !== "string" || !c.text.trim()) return null;
          if (!n(c.x)) c.x = 600;
          if (!n(c.y)) c.y = 600;
          if (!Number.isFinite(c.maxWidth)) c.maxWidth = 2600;
          c.text = c.text.slice(0, AI_TEXT_MAX_LENGTH);
          if (c.isLessonNote) {
            c.fontSize = Math.max(28, Math.min(40, +c.fontSize || 34));
            c.maxWidth = Math.max(900, Math.min(2200, c.maxWidth || 1680));
            c.color = "#1d1d1f";
            c.lineHeight = 1.4;
            if (!Array.isArray(c.rows)) c.rows = [];
          } else {
            c.fontSize = matchedTextFontSize(c.fontSize, c.text);
            c.maxWidth = Math.max(c.fontSize, Math.min(SIZE - c.x, c.maxWidth));
            c.lineHeight = Math.max(1, Math.min(2.2, +c.lineHeight || 1.35));
            c.color = c.color || aiColor;
          }
          if (c.maxWidth < c.fontSize) c.maxWidth = c.fontSize * 10;
          c.y = Math.min(c.y, Math.max(0, SIZE - c.fontSize * c.lineHeight * 2));
        }
        if (c.tool === "draw_formula") {
          if (!n(c.x) || !n(c.y) || typeof c.latex !== "string") return null;
          c.latex = c.latex.slice(0, 500);
          c.fontSize = matchedFontSize(c.fontSize);
          c.color = aiColor;
          const estimatedWidth = Math.min(5000, Math.max(c.fontSize, c.latex.length * c.fontSize * 0.72));
          c.x = Math.min(c.x, Math.max(0, SIZE - estimatedWidth));
          c.y = Math.min(c.y, Math.max(0, SIZE - c.fontSize * 1.8));
        }
        if (c.tool === "plot_function" && (!n(c.x) || !n(c.y) || !n(c.w, 240, 6000) || !n(c.h, 180, 6000) || c.w * c.h > 8000000 || Math.max(c.w / c.h, c.h / c.w) > 6 || 12000000 < plotPixels + c.w * c.h || c.x + c.w > SIZE || c.y + c.h > SIZE || typeof c.expression !== "string" || c.expression.length > 180)) return null;
        if (c.tool === "plot_function") {
          c.expression = normalizePlotExpression(c.expression);
          try {
            compileExpression(c.expression);
          } catch {
            return null;
          }
          c.color = aiColor;
          plotPixels += c.w * c.h;
        }
        if (c.tool === "draw") {
          const normalized = DRAW?.normalize(c, SIZE);
          if (!normalized) return null;
          c = { ...normalized, color: aiColor };
        }
        if (c.tool === "animate_scene") {
          if (animationSlots <= 0) return null;
          const normalized = ANIMATION?.normalize(c, SIZE);
          if (!normalized) return null;
          c = normalized;
          animationSlots--;
        }
        if (c.tool === "html_widget") {
          const allowCopy = c.pluginId !== "image-search",
            diagramKind = typeof c.diagramKind === "string" ? c.diagramKind.trim() : "",
            sourceFormat = typeof c.sourceFormat === "string" ? c.sourceFormat.trim() : "",
            frameworkVersion = typeof c.frameworkVersion === "string" ? c.frameworkVersion.trim() : "",
            geometry = fitWidgetGeometry(c, visibleRect);
          if (widgetSlots <= 0 || !widgetPluginIds.has(c.pluginId) || widgetEditTarget && c.pluginId !== widgetEditTarget.pluginId || !geometry || typeof c.title !== "string" || !c.title.trim() || c.title.length > 120 || !validWidgetRefreshSeconds(c.refreshSeconds) || typeof c.html !== "string" || !c.html.trim() || c.html.length > MAX_WIDGET_HTML_LENGTH || diagramKind.length > 80 || sourceFormat.length > 80 || frameworkVersion.length > 120 || allowCopy && c.copyText !== undefined && (typeof c.copyText !== "string" || !c.copyText.trim() || c.copyText.length > MAX_WIDGET_COPY_TEXT_LENGTH) || allowCopy && c.copyLabel !== undefined && (typeof c.copyLabel !== "string" || !c.copyLabel.trim() || c.copyLabel.length > 80) || c.pluginId === "flowchart" && (typeof c.copyText !== "string" || !c.copyText.trim() || !sourceFormat)) return null;
          c = {
            tool:"html_widget",
            pluginId:c.pluginId,
            x:Math.round(widgetEditTarget ? widgetEditTarget.x : geometry.x),
            y:Math.round(widgetEditTarget ? widgetEditTarget.y : geometry.y),
            w:Math.round(widgetEditTarget ? widgetEditTarget.w : geometry.w),
            h:Math.round(widgetEditTarget ? widgetEditTarget.h : geometry.h),
            title:c.title.trim(),
            refreshSeconds:Math.round(c.refreshSeconds),
            html:c.html,
            ...(diagramKind ? { diagramKind } : {}),
            ...(sourceFormat ? { sourceFormat } : {}),
            ...(frameworkVersion ? { frameworkVersion } : {}),
            ...(allowCopy && typeof c.copyText === "string" ? { copyText:c.copyText.trim(), copyLabel:String(c.copyLabel || (sourceFormat ? `Copy ${sourceFormat}` : "Copy source")).trim() } : {}),
          };
          widgetSlots--;
        }
        if (c.tool === "diagram_source") {
          const runtime = diagramRuntime();
          const geometry = fitWidgetGeometry(c, visibleRect),
            sourceFormat = runtime?.normalizeFormat(c.sourceFormat) || "",
            diagramKind = typeof c.diagramKind === "string" ? c.diagramKind.trim() : "";
          if (widgetSlots <= 0 || !widgetPluginIds.has("flowchart") || c.pluginId !== "flowchart"
            || widgetEditTarget && (widgetEditTarget.pluginId !== "flowchart" || widgetEditTarget.widgetType !== "diagram_source")
            || !geometry || typeof c.title !== "string" || !c.title.trim() || c.title.length > 120
            || !sourceFormat || !diagramSourceFits(c.source)
            || diagramKind.length > 80) return null;
          c = {
            tool:"diagram_source",
            widgetType:"diagram_source",
            pluginId:"flowchart",
            x:Math.round(widgetEditTarget ? widgetEditTarget.x : geometry.x),
            y:Math.round(widgetEditTarget ? widgetEditTarget.y : geometry.y),
            w:Math.round(widgetEditTarget ? widgetEditTarget.w : geometry.w),
            h:Math.round(widgetEditTarget ? widgetEditTarget.h : geometry.h),
            title:c.title.trim(),
            refreshSeconds:0,
            sourceFormat,
            source:c.source,
            ...(diagramKind ? { diagramKind } : {}),
          };
          widgetSlots--;
        }
        if (c.tool === "erase") {
          if (c.mode === "path") {
            if (!Array.isArray(c.points) || c.points.length < 1 || c.points.length > 200 || !c.points.every(point)) return null;
            c.size = Math.max(2, Math.min(300, +c.size || 80));
            const xs = c.points.map((p) => p[0]),
              ys = c.points.map((p) => p[1]);
            if (Math.max(...xs) - Math.min(...xs) > 3000 || Math.max(...ys) - Math.min(...ys) > 3000) return null;
          } else {
            c.mode = "rect";
            if (!n(c.x) || !n(c.y) || !n(c.w, 1, 2000) || !n(c.h, 1, 2000) || c.x + c.w > SIZE || c.y + c.h > SIZE) return null;
          }
        }
        return c;
      })
      .filter(Boolean);
    const widgets = validated.filter((command) => ["html_widget", "diagram_source"].includes(command.tool));
    if (widgetEditTarget) return widgets.length === 1 ? widgets : [];
    return widgets.length ? [widgets[0]] : validated;
  }
  function point(v) {
    return Array.isArray(v) && v.length === 2 && n(v[0]) && n(v[1]);
  }
  function offscreen(w, h, readback = false) {
    const c = document.createElement("canvas");
    c.width = Math.ceil(w);
    c.height = Math.ceil(h);
    if (readback) c.getContext("2d", { willReadFrequently: true });
    return c;
  }
  function checkAI(revision, run = null) {
    if (revision != null && state.userRevision !== revision) throw Error(AI_CANCELLED);
    if (run && (run.superseded || state.activeAI !== run)) throw Error(AI_SUPERSEDED);
  }
  async function animate(c, revision, meta, run) {
    debug("tool-start", {
      ...meta,
      tool: c.tool,
      x: c.x,
      y: c.y,
      fontSize: c.fontSize,
      maxWidth: c.maxWidth,
    });
    try {
      checkAI(revision, run);
      if (c.tool === "animate_scene" && !pluginEnabled("animation")) throw Error(AI_REJECTED);
      if (["html_widget", "diagram_source"].includes(c.tool)) {
        if (!pluginEnabled(c.pluginId) || !pluginManifests.has(c.pluginId)) throw Error(AI_REJECTED);
        const target = run?.widgetEdit?.target,
          accepted = target ? await startPendingWidgetReplacement(c, target, revision) : await startPendingWidget(c, revision);
        if (accepted === AI_CANCELLED) throw Error(AI_CANCELLED);
        if (accepted === AI_SUPERSEDED) throw Error(AI_SUPERSEDED);
        if (!accepted) throw Error(AI_REJECTED);
      } else if (c.tool === "erase") {
        const bounds = eraseBounds(c),
          item={ command: c, erase: true, bounds, image: eraseMask(c, bounds) };
        const accepted = await startPendingBatch([item], revision, meta);
        if (accepted === AI_CANCELLED) throw Error(AI_CANCELLED);
        if (accepted === AI_SUPERSEDED) throw Error(AI_SUPERSEDED);
        if (!accepted) throw Error(AI_REJECTED);
      } else {
        let image,
          x = c.x,
          y = c.y,
          pendingCommand = c;
        if (c.tool === "write_text") {
          image = writeCommandImage(c, sharpRenderRatio());
        } else if (c.tool === "draw_formula") {
          image = await formulaImage(c.latex, c.fontSize, c.color);
        } else if (c.tool === "plot_function") {
          image = plot(c);
        } else if (c.tool === "animate_scene") {
          pendingCommand = ANIMATION.normalize(c, SIZE);
          image = pendingCommand ? ANIMATION.rasterize(pendingCommand, offscreen, 0, Math.min(2, sharpRenderRatio())) : null;
        }
        else if (c.tool === "draw") {
          const made = DRAW.render(c, offscreen, c.color);
          image = made.image;
          x = made.x;
          y = made.y;
        }
        if (image) {
          checkAI(revision, run);
          x = Math.max(0, Math.min(x, SIZE - Math.min(image.logicalWidth || image.width, SIZE)));
          y = Math.max(0, Math.min(y, SIZE - Math.min(image.logicalHeight || image.height, SIZE)));
          const accepted = await startPending(image, x, y, revision, meta, pendingCommand);
          if (accepted === AI_CANCELLED) throw Error(AI_CANCELLED);
          if (accepted === AI_SUPERSEDED) throw Error(AI_SUPERSEDED);
          if (!accepted) throw Error(AI_REJECTED);
        }
      }
      debug("tool-complete", { ...meta, tool: c.tool, x: c.x, y: c.y });
    } catch (error) {
      if (![AI_CANCELLED, AI_REJECTED, AI_SUPERSEDED].includes(error.message)) debug("tool-error", { ...meta, tool: c.tool, error: error.message });
      throw error;
    }
  }
  async function preparePendingItem(c, revision, meta, run) {
    debug("tool-start", { ...meta, tool: c.tool, x: c.x, y: c.y, fontSize: c.fontSize, maxWidth: c.maxWidth, batch: true });
    checkAI(revision, run);
    if (c.tool === "animate_scene" && !pluginEnabled("animation")) return null;
    if (c.tool === "erase") {
      const bounds = eraseBounds(c);
      return { command: c, erase: true, bounds, image: eraseMask(c, bounds) };
    }
    let image,
      x = c.x,
      y = c.y,
      pendingCommand = c;
    if (c.tool === "write_text") image = writeCommandImage(c, sharpRenderRatio());
    else if (c.tool === "draw_formula") image = await formulaImage(c.latex, c.fontSize, c.color);
    else if (c.tool === "plot_function") image = plot(c);
    else if (c.tool === "animate_scene") {
      pendingCommand = ANIMATION.normalize(c, SIZE);
      image = pendingCommand ? ANIMATION.rasterize(pendingCommand, offscreen, 0, Math.min(2, sharpRenderRatio())) : null;
    }
    else if (c.tool === "draw") {
      const made = DRAW.render(c, offscreen, c.color);
      image = made.image;
      x = made.x;
      y = made.y;
    }
    checkAI(revision, run);
    if (!image) throw Error(`Unable to prepare ${c.tool}`);
    const logicalWidth = image.logicalWidth || image.width,
      logicalHeight = image.logicalHeight || image.height;
    return {
      command: { ...pendingCommand },
      image,
      textCommand: c.tool === "write_text" ? { ...c } : null,
      copyText: copyTextForCommand(c),
      animationScene: c.tool === "animate_scene" ? pendingCommand : null,
      animationPlayback: c.tool === "animate_scene" ? createAnimationPlayback() : null,
      x: Math.max(0, Math.min(x, SIZE - Math.min(logicalWidth, SIZE))),
      y: Math.max(0, Math.min(y, SIZE - Math.min(logicalHeight, SIZE))),
      layoutWidth: logicalWidth,
      layoutHeight: logicalHeight,
    };
  }
  function resolvePendingItemOverlaps(items, meta) {
    const gap = Math.max(40, 14 / Math.max(0.03, state.scale)),
      flow = items
        .filter((item) => ["write_text", "draw_formula"].includes(item.command.tool))
        .sort((a, b) => a.y - b.y || a.x - b.x),
      placed = [],
      fixed = items
        .filter((item) => !["write_text", "draw_formula", "draw"].includes(item.command.tool))
        .map((item) => item.erase ? item.bounds : { x: item.x, y: item.y, w: item.layoutWidth, h: item.layoutHeight });
    for (const item of flow) {
      const width = item.image.logicalWidth || item.image.width,
        height = item.image.logicalHeight || item.image.height;
      let y = item.y;
      for (let pass = 0; pass < items.length; pass++) {
        const collisions = [...fixed, ...placed].filter((prior) => {
          const horizontalOverlap = Math.min(item.x + width, prior.x + prior.w) - Math.max(item.x, prior.x),
            verticalOverlap = Math.min(y + height, prior.y + prior.h) - Math.max(y, prior.y);
          return horizontalOverlap > 0 && verticalOverlap > 0;
        });
        if (!collisions.length) break;
        y = Math.max(...collisions.map((prior) => prior.y + prior.h)) + gap;
      }
      const originalY = item.y;
      item.y = Math.max(0, Math.min(SIZE - height, y));
      if (item.y !== originalY) debug("tool-layout-adjusted", { ...meta, tool: item.command.tool, x: item.x, originalY, y: item.y, width, height });
      placed.push({ x: item.x, y: item.y, w: width, h: height });
    }
  }
