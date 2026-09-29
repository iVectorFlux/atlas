  function copyTextForCommand(command) {
    if (command?.tool === "write_text" && typeof command.text === "string") return command.text;
    if (command?.tool === "draw_formula" && typeof command.latex === "string") return command.latex;
    return null;
  }
  function pendingCopyValue(target) {
    if (typeof target?.copyText === "string") return target.copyText;
    return copyTextForCommand(target?.command || target?.textCommand);
  }
  function pendingCopyable(target) {
    return typeof pendingCopyValue(target) === "string";
  }
  function draftBounds(p) {
    if (p.items) return batchBounds(p);
    return {
      x: p.x,
      y: p.y,
      w: (p.textCommand ? p.layoutWidth : p.image.logicalWidth || p.image.width) * p.scaleX,
      h: (p.textCommand ? p.layoutHeight : p.image.logicalHeight || p.image.height) * p.scaleY,
    };
  }
  function pendingItemBounds(item) {
    const width = item.erase ? item.bounds.w : item.textCommand ? item.layoutWidth : item.image.logicalWidth || item.image.width,
      height = item.erase ? item.bounds.h : item.textCommand ? item.layoutHeight : item.image.logicalHeight || item.image.height;
    return { x: item.x, y: item.y, w: width * item.scaleX, h: height * item.scaleY };
  }
  function batchBounds(p) {
    const boxes = p.items.map(pendingItemBounds),
      left = Math.min(...boxes.map((box) => box.x)),
      top = Math.min(...boxes.map((box) => box.y)),
      right = Math.max(...boxes.map((box) => box.x + box.w)),
      bottom = Math.max(...boxes.map((box) => box.y + box.h));
    return { x: left, y: top, w: right - left, h: bottom - top };
  }
  function drawTextDraftSurface(context, box, selected = true) {
    context.save();
    context.globalAlpha *= selected ? 0.82 : 0.68;
    context.fillStyle = state.paint.paper;
    context.fillRect(box.x, box.y, box.w, box.h);
    context.restore();
  }
  function drawPending(p, context = ctx) {
    if (p.items) return drawPendingBatch(p, context);
    const ctx = context,
      b = draftBounds(p),
      progress = p.revealProgress ?? 1,
      logicalWidth = p.image.logicalWidth || p.image.width,
      logicalHeight = p.image.logicalHeight || p.image.height,
      rows = p.image.revealRows || [logicalWidth],
      rowHeight = p.image.revealRowHeight || logicalHeight,
      total = rows.reduce((sum, width) => sum + width, 0),
      distance = total * progress;
    let consumed = 0,
      current = 0,
      currentWidth = 0;
    while (current < rows.length && consumed + rows[current] < distance) {
      consumed += rows[current];
      current++;
    }
    if (current < rows.length) currentWidth = Math.max(0, distance - consumed);
    if (p.textCommand) drawTextDraftSurface(ctx, b);
    ctx.save();
    ctx.beginPath();
    ctx.rect(b.x, b.y, b.w, b.h);
    ctx.clip();
    ctx.beginPath();
    for (let row = 0; row < current; row++) ctx.rect(b.x, b.y + row * rowHeight * p.scaleY, b.w, rowHeight * p.scaleY);
    if (current < rows.length) ctx.rect(b.x, b.y + current * rowHeight * p.scaleY, currentWidth * p.scaleX, rowHeight * p.scaleY);
    ctx.clip();
    const imageWidth = logicalWidth * p.scaleX,
      imageHeight = logicalHeight * p.scaleY;
    if (p.animationScene) drawPendingAnimation(ctx, p.animationScene, p.animationPlayback ||= createAnimationPlayback(), b);
    else ctx.drawImage(p.image, b.x, b.y, imageWidth, imageHeight);
    ctx.restore();
    if (progress < 1) {
      const tipX = b.x + currentWidth * p.scaleX,
        tipY = b.y + Math.min(current, rows.length - 1) * rowHeight * p.scaleY + rowHeight * p.scaleY * 0.72,
        unit = 1 / state.scale;
      ctx.save();
      ctx.strokeStyle = "#2563eb";
      ctx.lineWidth = 2 * unit;
      ctx.lineCap = "round";
      ctx.shadowColor = "#60a5fa";
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.moveTo(tipX - 7 * unit, tipY + 5 * unit);
      ctx.lineTo(tipX + 2 * unit, tipY - 4 * unit);
      ctx.stroke();
      ctx.restore();
      return;
    }
    const chromeVisible = !p.animationScene || pendingAnimationChromeVisible(p);
    if (!chromeVisible) return;
    const s = 14 / state.scale;
    ctx.save();
    ctx.strokeStyle = "#72b7e599";
    ctx.lineWidth = 1.5 / state.scale;
    ctx.setLineDash([7 / state.scale, 7 / state.scale]);
    ctx.strokeRect(b.x, b.y, b.w, b.h);
    ctx.setLineDash([]);
    ctx.restore();
    ctx.save();
    ctx.strokeStyle = "#2679b8";
    ctx.lineWidth = 1.8 / state.scale;
    ctx.lineCap = "round";
    ctx.beginPath();
    drawResizeHandle(ctx, b, s);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(b.x + b.w + s * 0.08, b.y + b.h / 2 - s * 0.48);
    ctx.lineTo(b.x + b.w + s * 0.08, b.y + b.h / 2 + s * 0.48);
    ctx.moveTo(b.x + b.w / 2 - s * 0.48, b.y + b.h + s * 0.08);
    ctx.lineTo(b.x + b.w / 2 + s * 0.48, b.y + b.h + s * 0.08);
    ctx.stroke();
    ctx.restore();
    drawCopyFeedback(ctx, b, s, p);
  }
  function drawPendingBatch(p, context = ctx) {
    const ctx = context,
      batch = batchBounds(p),
      unit = 1 / state.scale,
      s = 14 * unit,
      entries = p.items.map((item, index) => ({ item, index, box: pendingItemBounds(item), chromeVisible: !item.animationScene || pendingAnimationChromeVisible(p, index) })),
      selectedEntry = entries.find(({ index }) => index === p.selectedIndex),
      batchChromeVisible = !selectedEntry?.item.animationScene || selectedEntry.chromeVisible;
    for (const { item, index, box } of entries) {
      if (item.textCommand) drawTextDraftSurface(ctx, box, index === p.selectedIndex);
      ctx.save();
      ctx.beginPath();
      ctx.rect(box.x, box.y, box.w, box.h);
      ctx.clip();
      if (item.erase) {
        ctx.globalAlpha = 0.18;
        ctx.drawImage(item.image, box.x, box.y, box.w, box.h);
      } else if (item.animationScene) drawPendingAnimation(ctx, item.animationScene, item.animationPlayback ||= createAnimationPlayback(), box);
      else if (item.textCommand) {
        const imageWidth = (item.image.logicalWidth || item.image.width) * item.scaleX,
          imageHeight = (item.image.logicalHeight || item.image.height) * item.scaleY;
        ctx.drawImage(item.image, box.x, box.y, imageWidth, imageHeight);
      } else ctx.drawImage(item.image, box.x, box.y, box.w, box.h);
      ctx.restore();
    }
    if (p.items.length > 1 && batchChromeVisible) {
      ctx.save();
      ctx.strokeStyle = "#2679b866";
      ctx.lineWidth = 1.4 * unit;
      ctx.setLineDash([8 * unit, 7 * unit]);
      ctx.strokeRect(batch.x, batch.y, batch.w, batch.h);
      ctx.restore();
    }
    const controlEntries = [...entries.filter(({ index }) => index !== p.selectedIndex), ...entries.filter(({ index }) => index === p.selectedIndex)];
    for (const { item, index, box, chromeVisible } of controlEntries) {
      if (!chromeVisible) continue;
      ctx.save();
      ctx.strokeStyle = index === p.selectedIndex ? "#2679b8" : "#72b7e577";
      ctx.lineWidth = (index === p.selectedIndex ? 2 : 1.2) * unit;
      ctx.setLineDash(index === p.selectedIndex ? [] : [6 * unit, 6 * unit]);
      ctx.strokeRect(box.x, box.y, box.w, box.h);
      ctx.restore();
      drawCopyFeedback(ctx, box, s, item);
    }
    ctx.save();
    ctx.strokeStyle = "#2679b8";
    ctx.lineWidth = 1.8 * unit;
    ctx.lineCap = "round";
    if (selectedEntry?.chromeVisible) {
      const selectedBox = selectedEntry.box;
      ctx.beginPath();
      drawResizeHandle(ctx, selectedBox, s);
      ctx.moveTo(selectedBox.x + selectedBox.w + s * 0.08, selectedBox.y + selectedBox.h / 2 - s * 0.48);
      ctx.lineTo(selectedBox.x + selectedBox.w + s * 0.08, selectedBox.y + selectedBox.h / 2 + s * 0.48);
      ctx.moveTo(selectedBox.x + selectedBox.w / 2 - s * 0.48, selectedBox.y + selectedBox.h + s * 0.08);
      ctx.lineTo(selectedBox.x + selectedBox.w / 2 + s * 0.48, selectedBox.y + selectedBox.h + s * 0.08);
      ctx.stroke();
    }
    ctx.restore();
    if (p.items.length > 1 && batchChromeVisible) {
      ctx.save();
      ctx.strokeStyle = "#2679b8";
      ctx.lineWidth = 1.8 * unit;
      ctx.lineCap = "round";
      ctx.beginPath();
      drawResizeHandle(ctx, batch, s);
      ctx.stroke();
      ctx.restore();
    }
  }
  function drawPendingAnimation(context, scene, playback, box, now = performance.now()) {
    context.save();
    context.translate(box.x, box.y);
    context.scale(box.w / scene.w, box.h / scene.h);
    ANIMATION.render(context, scene, playbackPlayhead(scene, playback, now));
    context.restore();
  }
  function draftActionPoints(box, s, includeCopy = false, single = false) {
    const prefix = single ? "" : "item-",
      radius = s * 0.54,
      clampX = (value) => Math.max(radius, Math.min(SIZE - radius, value)),
      aboveY = box.y - s * 0.74,
      actionY = aboveY - radius >= 0 ? aboveY : Math.min(SIZE - radius, box.y + radius + s * 0.18),
      actions = {
        [prefix + "cancel"]: { x: clampX(box.x - s * 0.62), y: actionY },
        [prefix + "accept"]: { x: clampX(box.x + box.w + s * 0.62), y: actionY },
      };
    if (includeCopy) {
      actions[prefix + "copy"] = { x: clampX(box.x + box.w / 2 - s * 0.95), y: actionY };
      actions[prefix + "reply"] = { x: clampX(box.x + box.w / 2 + s * 0.95), y: actionY };
    }
    return actions;
  }
  function drawDraftActions(context, box, s, includeCopy = false, single = false) {
    const actions = draftActionPoints(box, s, includeCopy, single),
      radius = s * 0.54;
    context.save();
    context.lineCap = context.lineJoin = "round";
    for (const [action, point] of Object.entries(actions)) {
      const kind = action.replace(/^item-/, ""),
        accent = kind === "cancel" ? "#fb7185" : kind === "accept" ? "#4ade80" : kind === "reply" ? "#a78bfa" : "#60a5fa";
      context.fillStyle = "#111827f2";
      context.strokeStyle = "#ffffffd9";
      context.lineWidth = 1.15 / state.scale;
      context.shadowColor = "#00000066";
      context.shadowBlur = 5 / state.scale;
      context.beginPath();
      context.arc(point.x, point.y, radius, 0, Math.PI * 2);
      context.fill();
      context.stroke();
      context.shadowBlur = 0;
      context.strokeStyle = accent;
      context.lineWidth = 1.75 / state.scale;
      context.beginPath();
      if (kind === "cancel") {
        context.moveTo(point.x - radius * 0.34, point.y - radius * 0.34);
        context.lineTo(point.x + radius * 0.34, point.y + radius * 0.34);
        context.moveTo(point.x + radius * 0.34, point.y - radius * 0.34);
        context.lineTo(point.x - radius * 0.34, point.y + radius * 0.34);
      } else if (kind === "accept") {
        context.moveTo(point.x - radius * 0.42, point.y);
        context.lineTo(point.x - radius * 0.1, point.y + radius * 0.3);
        context.lineTo(point.x + radius * 0.46, point.y - radius * 0.38);
      } else if (kind === "reply") {
        context.moveTo(point.x - radius * 0.32, point.y + radius * 0.3);
        context.lineTo(point.x - radius * 0.32, point.y - radius * 0.26);
        context.lineTo(point.x + radius * 0.32, point.y - radius * 0.26);
        context.moveTo(point.x, point.y - radius * 0.26);
        context.lineTo(point.x, point.y + radius * 0.34);
      } else {
        const size = radius * 0.72,
          offset = radius * 0.2,
          corner = radius * 0.12;
        if (typeof context.roundRect === "function") context.roundRect(point.x - size / 2 - offset, point.y - size / 2 + offset, size, size, corner);
        else context.rect(point.x - size / 2 - offset, point.y - size / 2 + offset, size, size);
        context.stroke();
        context.beginPath();
        if (typeof context.roundRect === "function") context.roundRect(point.x - size / 2 + offset, point.y - size / 2 - offset, size, size, corner);
        else context.rect(point.x - size / 2 + offset, point.y - size / 2 - offset, size, size);
      }
      context.stroke();
    }
    context.restore();
  }
  function drawCopyFeedback(context, box, s, target) {
    if (target?.copyFeedbackGeneration !== state.copyGeneration || !Number.isFinite(target.copyFeedbackUntil) || target.copyFeedbackUntil <= performance.now()) return;
    const unit = 1 / state.scale,
      label = t("textCopied"),
      fontSize = 11 * unit,
      paddingX = 6 * unit,
      paddingY = 4 * unit;
    context.save();
    context.font = `700 ${fontSize}px system-ui, sans-serif`;
    const width = context.measureText(label).width + paddingX * 2,
      height = fontSize + paddingY * 2,
      x = Math.max(0, Math.min(SIZE - width, box.x + box.w / 2 - width / 2)),
      above = box.y - s * 1.15 - height,
      y = above >= 0 ? above : Math.min(SIZE - height, box.y + s * 0.95);
    context.fillStyle = "#111827e8";
    context.fillRect(x, y, width, height);
    context.fillStyle = "#fff";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(label, x + width / 2, y + height / 2);
    context.restore();
  }
  function drawResizeHandle(context, b, s) {
    context.moveTo(b.x + b.w - s * 0.52, b.y + b.h);
    context.lineTo(b.x + b.w, b.y + b.h - s * 0.52);
    context.moveTo(b.x + b.w - s * 0.28, b.y + b.h);
    context.lineTo(b.x + b.w, b.y + b.h - s * 0.28);
  }
  function drawMoveHandle(context, b, s, selected) {
    const x = b.x + b.w / 2,
      y = b.y - s * 0.46,
      radius = s * 0.34;
    context.save();
    context.fillStyle = selected ? "#eef8ff" : "#eef8ffcc";
    context.strokeStyle = selected ? "#2679b8" : "#72b7e5";
    context.lineWidth = 1.5 / state.scale;
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fill();
    context.stroke();
    context.beginPath();
    context.moveTo(x - radius * 0.55, y);
    context.lineTo(x + radius * 0.55, y);
    context.moveTo(x, y - radius * 0.55);
    context.lineTo(x, y + radius * 0.55);
    context.stroke();
    context.restore();
  }
  function pendingHit(p, e, moveOnly = false) {
    const q = clientPoint(e),
      b = draftBounds(p),
      s = 14 / state.scale;
    if (p.items) {
      const actionRadius = e.pointerType === "touch" ? 22 / state.scale : Math.max(s * 0.8, 9 / state.scale),
        handleRadius = Math.max(s * 0.72, 8 / state.scale),
        selectedControlZ = p.items.length * 10 + 50,
        controls = [],
        addControl = (hit, point, radius, itemIndex, z) => {
          const distance = Math.hypot(q.x - point.x, q.y - point.y);
          if (distance <= radius) controls.push({ hit, itemIndex, distance, z });
        };
      const selected = p.items[p.selectedIndex],
        selectedChromeVisible = !selected?.animationScene || pendingAnimationChromeVisible(p, p.selectedIndex),
        batchChromeVisible = !selected?.animationScene || selectedChromeVisible;
      if (p.items.length > 1 && !moveOnly && batchChromeVisible)
        addControl("batch-resize", { x: b.x + b.w, y: b.y + b.h }, Math.max(handleRadius, (e.pointerType === "touch" ? 16 : 10) / state.scale), null, p.items.length * 10 + 100);
      if (selected && !moveOnly && selectedChromeVisible) {
        const box = pendingItemBounds(selected),
          handles = [
            { hit: "resize", point: { x: box.x + box.w, y: box.y + box.h } },
            { hit: "width", point: { x: box.x + box.w + s * 0.08, y: box.y + box.h / 2 } },
            { hit: "height", point: { x: box.x + box.w / 2, y: box.y + box.h + s * 0.08 } },
          ];
        handles.forEach((handle, index) => addControl(handle.hit, handle.point, handleRadius, p.selectedIndex, selectedControlZ + 20 + index));
      }
      for (let index = p.items.length - 1; index >= 0; index--) {
        const item = p.items[index],
          box = pendingItemBounds(item),
          controlZ = index === p.selectedIndex ? selectedControlZ : index * 10;
        if (!moveOnly && (!item.animationScene || pendingAnimationChromeVisible(p, index))) Object.entries(draftActionPoints(box, s, pendingCopyable(item))).forEach(([hit, point], actionIndex) => addControl(hit, point, actionRadius, index, controlZ + 2 + actionIndex));
      }
      controls.sort((a, b) => a.distance - b.distance || b.z - a.z);
      if (controls[0]) return { hit: controls[0].hit, itemIndex: controls[0].itemIndex };
      if (p.items.length > 1 && batchChromeVisible) {
        const frameOuter = (e.pointerType === "touch" ? 16 : 10) / state.scale,
          frameInner = (e.pointerType === "touch" ? 6 : 4) / state.scale,
          right = b.x + b.w,
          bottom = b.y + b.h,
          insetX = Math.min(frameInner, b.w / 4),
          insetY = Math.min(frameInner, b.h / 4),
          insideOuter = q.x >= b.x - frameOuter && q.x <= right + frameOuter && q.y >= b.y - frameOuter && q.y <= bottom + frameOuter,
          insideInset = q.x > b.x + insetX && q.x < right - insetX && q.y > b.y + insetY && q.y < bottom - insetY,
          nearFrame =
            insideOuter && !insideInset;
        if (nearFrame) return { hit: "batch-move", itemIndex: null };
      }
      for (let index = p.items.length - 1; index >= 0; index--) {
        const box = pendingItemBounds(p.items[index]);
        if (q.x >= box.x && q.x <= box.x + box.w && q.y >= box.y && q.y <= box.y + box.h) return { hit: "move", itemIndex: index };
      }
      if (p.items.length > 1 && q.x >= b.x && q.x <= b.x + b.w && q.y >= b.y && q.y <= b.y + b.h) return { hit: "batch-move", itemIndex: null };
      return null;
    }
    if (moveOnly) return q.x >= b.x && q.x <= b.x + b.w && q.y >= b.y && q.y <= b.y + b.h ? "move" : null;
    if (p.animationScene && !pendingAnimationChromeVisible(p)) return q.x >= b.x && q.x <= b.x + b.w && q.y >= b.y && q.y <= b.y + b.h ? "move" : null;
    const points = {
        ...draftActionPoints(b, s, pendingCopyable(p), true),
        resize: { x: b.x + b.w, y: b.y + b.h },
      };
    points.width = { x: b.x + b.w + s * 0.08, y: b.y + b.h / 2 };
    points.height = { x: b.x + b.w / 2, y: b.y + b.h + s * 0.08 };
    const nearest = Object.entries(points)
      .map(([name, point]) => ({ name, distance: Math.hypot(q.x - point.x, q.y - point.y) }))
      .filter((control) => control.distance <= Math.max(s * 1.8, 18 / state.scale))
      .sort((a, b) => a.distance - b.distance)[0];
    if (nearest) return nearest.name;
    return q.x >= b.x && q.x <= b.x + b.w && q.y >= b.y && q.y <= b.y + b.h ? "move" : null;
  }
  function pendingTextTarget(p, itemIndex = null) {
    if (!p) return null;
    if (!p.items) return itemIndex == null ? p : null;
    return Number.isInteger(itemIndex) ? p.items[itemIndex] || null : null;
  }
  function fallbackCopyText(text) {
    const field = document.createElement("textarea"),
      activeElement = document.activeElement,
      selection = document.getSelection();
    const ranges = [];
    try {
      for (let index = 0; selection && index < selection.rangeCount; index++) ranges.push(selection.getRangeAt(index).cloneRange());
    } catch {}
    field.className = "clipboard-copy-fallback";
    field.value = text;
    field.setAttribute("readonly", "");
    field.setAttribute("tabindex", "-1");
    field.setAttribute("aria-hidden", "true");
    document.body.append(field);
    try {
      field.focus({ preventScroll: true });
    } catch {
      field.focus();
    }
    field.select();
    field.setSelectionRange(0, field.value.length);
    let copied = false;
    try {
      copied = Boolean(document.execCommand?.("copy"));
    } catch {}
    field.remove();
    try {
      activeElement?.focus?.({ preventScroll: true });
    } catch {}
    try {
      selection?.removeAllRanges();
      for (const range of ranges) selection?.addRange(range);
    } catch {}
    return copied;
  }
  async function writeClipboardText(text) {
    // Keep the synchronous fallback inside the trusted pointer event. This is
    // required for LAN HTTP and embedded browsers, and avoids losing transient
    // user activation while waiting for an asynchronous Clipboard API failure.
    if (fallbackCopyText(text)) return true;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (error) {
      debug("clipboard-copy-failed", {
        name: error?.name || "UnknownError",
        secureContext: Boolean(window.isSecureContext),
        focused: Boolean(document.hasFocus?.()),
      });
    }
    return false;
  }
  async function copyPendingText(itemIndex = null) {
    const pending = state.pending,
      target = pendingTextTarget(pending, itemIndex),
      text = pendingCopyValue(target);
    if (typeof text !== "string") return false;
    const generation = ++state.copyGeneration,
      stillPending = () => state.copyGeneration === generation && state.pending === pending && (pending?.items ? pending.items.includes(target) : target === pending);
    setStatusKey("copyText");
    requestRender();
    const copied = await writeClipboardText(text);
    if (!stillPending()) return copied;
    if (!copied) {
      setStatusKey("textCopyFailed");
      return false;
    }
    setStatusKey("textCopied");
    target.copyFeedbackGeneration = generation;
    target.copyFeedbackUntil = performance.now() + COPY_FEEDBACK_MS;
    requestRender();
    setTimeout(() => {
      if (!stillPending() || target.copyFeedbackGeneration !== generation) return;
      if (target.copyFeedbackUntil <= performance.now()) {
        target.copyFeedbackUntil = 0;
        requestRender();
      }
      if (state.statusKey === "textCopied") setStatusKey(state.pending?.items ? "batchDraftReady" : state.pending ? "draftReady" : "ready");
    }, COPY_FEEDBACK_MS + 30);
    return true;
  }
  function acceptPending(options) {
    options ||= {};
    const restoreMode = options?.restoreMode !== false;
    const p = state.pending;
    if (!p) return;
    const pendingBefore = capturePendingHistoryState();
    blockCanvasInput();
    if (!options?.force && p.revision !== state.userRevision && state.userRevision !== p.latestUserRevision) {
      rejectPending();
      setStatusKey("canvasChanged");
      return;
    }
    const acceptedCount = p.items ? (p.acceptedItems || 0) + p.items.length : 1;
    if (p.items) {
      commitPendingBatch(p);
      consumePendingInput(p);
    }
    else if (p.animationScene) {
      const box = draftBounds(p);
      addAnimation(p.animationScene, box, p.animationPlayback);
    }
    else if (p.textCommand) {
      const box = draftBounds(p);
      blitClipped(p.image, p.x, p.y, (p.image.logicalWidth || p.image.width) * p.scaleX, (p.image.logicalHeight || p.image.height) * p.scaleY, box.w, box.h);
    }
    else blitSized(p.image, p.x, p.y, (p.image.logicalWidth || p.image.width) * p.scaleX, (p.image.logicalHeight || p.image.height) * p.scaleY);
    state.pending = null;
    state.pendingGesture = null;
    hideAnimationControls();
    updateBatchActions();
    const historyEntry = save();
    recordPendingHistory(historyEntry, pendingBefore, capturePendingHistoryState());
    render();
    setStatusKey("merged");
    resolvePending(p, p.items ? { acceptedCount } : true);
    if (p.isolatedSelection) dismissSelectionKeepInkRemoved(p.selection);
    if (restoreMode) finishAIDraftHandMode();
  }
  function acceptPendingItem(index) {
    const p = state.pending,
      item = p?.items?.[index];
    if (!item) return;
    const pendingBefore = capturePendingHistoryState();
    blockCanvasInput();
    if (p.revision !== state.userRevision && state.userRevision !== p.latestUserRevision) {
      rejectPending();
      setStatusKey("canvasChanged");
      return;
    }
    commitPendingItem(item);
    p.acceptedItems = (p.acceptedItems || 0) + 1;
    consumePendingInput(p);
    removePendingItem(p, index);
    const historyEntry = save();
    finishPendingItemAction(p, "itemAccepted");
    recordPendingHistory(historyEntry, pendingBefore, capturePendingHistoryState());
  }
  function rejectPendingItem(index) {
    const p = state.pending;
    if (!p?.items?.[index]) return;
    blockCanvasInput();
    removePendingItem(p, index);
    finishPendingItemAction(p, "itemDiscarded");
  }
  function removePendingItem(p, index) {
    const selected = p.items[p.selectedIndex],
      removedSelected = selected === p.items[index];
    p.items.splice(index, 1);
    if (removedSelected) p.selectedIndex = Math.max(0, Math.min(index, p.items.length - 1));
    else p.selectedIndex = Math.max(0, p.items.indexOf(selected));
    state.pendingGesture = null;
  }
  function consumePendingInput(p) {
    if (p.inputConsumed) return;
    p.inputConsumed = true;
    if (state.activeAI) {
      state.activeAI.dirtyRestored = true;
      state.activeAI.inputConsumed = true;
    }
    // Selection-scoped drafts are independent of the normal handwriting stream. They
    // must not consume its last box, hotspots, or typed input when the draft is accepted.
    if (p.isolatedSelection) {
      if (p.selection) p.selection.acceptedDraft = true;
      return;
    }
    state.lastUserBox = p.latestBox;
    if (p.hotspotEnd) {
      const end = state.hotspotTrail.indexOf(p.hotspotEnd);
      if (end >= 0) state.hotspotTrail.splice(0, end + 1);
    }
  }
  function finishPendingItemAction(p, statusKey) {
    if (p.items.length) {
      setStatusKey(statusKey);
      updateBatchActions();
      render();
      if (pendingAnimationControlTarget()) showAnimationControls();
      else hideAnimationControls();
      return;
    }
    state.pending = null;
    state.pendingGesture = null;
    hideAnimationControls();
    updateBatchActions();
    render();
    const accepted = Boolean(p.acceptedItems);
    setStatusKey(accepted ? "merged" : "draftRejected");
    resolvePending(p, p.acceptedItems ? { acceptedCount: p.acceptedItems } : false);
    if (p.isolatedSelection && p.selection) {
      if (accepted) dismissSelectionKeepInkRemoved(p.selection);
      else {
        restoreSelectionSource(p.selection);
        if (state.selection === p.selection) {
          state.selection = null;
          state.selectionGesture = null;
        }
        updateSelectionToolbar();
      }
    }
    finishAIDraftHandMode();
  }
  function rejectPending(options) {
    options ||= {};
    const restoreMode = options?.restoreMode !== false;
    if (!state.pending) return;
    blockCanvasInput();
    const p = state.pending;
    state.pending = null;
    state.pendingGesture = null;
    hideAnimationControls();
    updateBatchActions();
    render();
    const accepted = Boolean(p.acceptedItems);
    setStatusKey(accepted ? "merged" : "draftRejected");
    resolvePending(p, p.items && p.acceptedItems ? { acceptedCount: p.acceptedItems } : false);
    if (p.isolatedSelection && p.selection && !p.selection.acceptedDraft) {
      restoreSelectionSource(p.selection);
      if (state.selection === p.selection) {
        state.selection = null;
        state.selectionGesture = null;
      }
      updateSelectionToolbar();
      render();
    }
    if (restoreMode) finishAIDraftHandMode();
  }
  function notePendingContinuedInput(drawing) {
    const p = state.pending;
    if (!p) return;
    p.latestUserRevision = state.userRevision;
    p.continuedDistance = (p.continuedDistance || 0) + drawing.screenDistance;
  }
  function cancelPendingForRevision() {
    if (state.pendingWidget) rejectPendingWidget(AI_CANCELLED);
    if (!state.pending) return;
    const p = state.pending;
    state.pending = null;
    state.pendingGesture = null;
    hideAnimationControls();
    updateBatchActions();
    render();
    resolvePending(p, AI_CANCELLED);
    finishAIDraftHandMode();
  }
  function resolvePending(p, result) {
    if (!p) return;
    const callbacks = Array.isArray(p.resolves) ? p.resolves.splice(0) : p.resolve ? [p.resolve] : [];
    p.resolve = null;
    callbacks.forEach((callback) => callback(result));
  }
  function queuePendingResolve(p, resolve) {
    if (typeof resolve !== "function") return;
    if (!Array.isArray(p.resolves)) p.resolves = [];
    if (p.resolve) {
      p.resolves.push(p.resolve);
      p.resolve = null;
    }
    p.resolves.push(resolve);
  }
  function pendingSingleItem(p) {
    return {
      command: p.command || p.textCommand || {},
      image: p.image,
      textCommand: p.textCommand ? { ...p.textCommand } : null,
      animationScene: p.animationScene || null,
      animationPlayback: p.animationPlayback || null,
      copyText: pendingCopyValue(p),
      x: p.x,
      y: p.y,
      scaleX: p.scaleX || 1,
      scaleY: p.scaleY || 1,
      layoutWidth: p.layoutWidth || p.image.logicalWidth || p.image.width,
      layoutHeight: p.layoutHeight || p.image.logicalHeight || p.image.height,
    };
  }
  function appendPendingItems(p, items, revision, meta, resolve) {
    if (!p.items) {
      p.items = [pendingSingleItem(p)];
      p.selectedIndex = 0;
      p.revealProgress = 1;
    }
    const firstAddedIndex = p.items.length,
      additions = items.map((item) => ({ ...item, x: item.erase ? item.bounds.x : item.x, y: item.erase ? item.bounds.y : item.y, scaleX: item.scaleX || 1, scaleY: item.scaleY || 1, animationPlayback: item.animationScene ? item.animationPlayback || createAnimationPlayback() : null })),
      addedAnimationIndex = additions.findIndex((item) => item.animationScene);
    p.items.push(...additions);
    if (addedAnimationIndex >= 0) p.selectedIndex = firstAddedIndex + addedAnimationIndex;
    if (!p.selection && state.activeAI?.isolatedSelection) p.selection = state.activeAI.selection || null;
    if (state.activeAI?.isolatedSelection) p.isolatedSelection = true;
    p.latestUserRevision = state.userRevision;
    if (!p.isolatedSelection) {
      p.latestBox = state.activeAI?.dirtySnapshot || state.lastUserBox || p.latestBox;
      p.hotspotEnd = state.hotspotTrail.at(-1) || p.hotspotEnd;
    }
    p.meta = meta || p.meta;
    p.revision = revision;
    queuePendingResolve(p, resolve);
    updateBatchActions();
    setStatusKey("batchDraftReady");
    render();
    requestAnimationLayerRender();
    if (pendingAnimationControlTarget()) showAnimationControls();
    releaseSelectionAITransformLock();
    maybeOfferBoardReply(p);
  }
  function startPending(image, x, y, revision, meta, command) {
    return new Promise((resolve) => {
      enterAIDraftHandMode();
      const textCommand = command.tool === "write_text" ? { ...command } : null,
        animationScene = command.tool === "animate_scene" ? command : null,
        copyText = copyTextForCommand(command),
        layoutWidth = textCommand ? command.maxWidth : image.logicalWidth || image.width,
        layoutHeight = image.logicalHeight || image.height;
      if (state.pending) {
        appendPendingItems(state.pending, [{ command: { ...command }, image, textCommand, animationScene, copyText, x, y, layoutWidth, layoutHeight }], revision, meta, resolve);
        return;
      }
      const rows = image.revealRows || [image.logicalWidth || image.width],
        distance = rows.reduce((sum, width) => sum + width, 0),
        duration = Math.max(900, Math.min(6200, distance * 0.7));
      state.pending = {
        command: { ...command },
        image,
        x,
        y,
        scaleX: 1,
        scaleY: 1,
        textCommand,
        copyText,
        animationScene,
        animationPlayback: animationScene ? createAnimationPlayback() : null,
        layoutWidth,
        layoutHeight,
        heightLocked: false,
        revealProgress: animationScene ? 1 : 0,
        revision,
        meta,
        isolatedSelection: Boolean(state.activeAI?.isolatedSelection),
        selection: state.activeAI?.isolatedSelection ? state.activeAI.selection || null : null,
        resolves: [resolve],
      };
      releaseSelectionAITransformLock();
      updateBatchActions();
      const p = state.pending,
        started = performance.now();
      if (animationScene) {
        setStatusKey("draftReady");
        render();
        showAnimationControls();
        requestAnimationLayerRender();
        return;
      }
      function step(now) {
        if (!state.pending || state.pending !== p) return;
        p.revealProgress = Math.min(1, (now - started) / duration);
        render();
        if (p.revealProgress < 1) requestAnimationFrame(step);
        else {
          setStatusKey("draftReady");
          maybeOfferBoardReply(p);
        }
      }
      requestAnimationFrame(step);
    });
  }
  function startPendingBatch(items, revision, meta) {
    return new Promise((resolve) => {
      enterAIDraftHandMode();
      if (state.pending) {
        appendPendingItems(state.pending, items, revision, meta, resolve);
        return;
      }
      state.pending = {
        items: items.map((item) => ({ ...item, x: item.erase ? item.bounds.x : item.x, y: item.erase ? item.bounds.y : item.y, scaleX: 1, scaleY: 1, animationPlayback: item.animationScene ? item.animationPlayback || createAnimationPlayback() : null })),
        selectedIndex: Math.max(0, items.findIndex((item) => item.animationScene)),
        revealProgress: 1,
        revision,
        meta,
        isolatedSelection: Boolean(state.activeAI?.isolatedSelection),
        selection: state.activeAI?.isolatedSelection ? state.activeAI.selection || null : null,
        latestBox: state.activeAI?.isolatedSelection ? null : state.activeAI?.dirtySnapshot || state.lastUserBox,
        hotspotEnd: state.activeAI?.isolatedSelection ? null : state.hotspotTrail.at(-1) || null,
        resolves: [resolve],
      };
      releaseSelectionAITransformLock();
      updateBatchActions();
      setStatusKey("batchDraftReady");
      render();
      requestAnimationLayerRender();
      if (pendingAnimationControlTarget()) showAnimationControls();
      maybeOfferBoardReply(state.pending);
    });
  }
  function pendingTextIsQuestion(target) {
    const text = String(pendingCopyValue(target) || target?.textCommand?.text || target?.command?.text || "");
    return /[?？]/.test(text) || /\b(what do you want|what should i|how can i help|tell me what|want me to)\b/i.test(text);
  }
  function maybeOfferBoardReply(pending) {
    if (!pending || state.textEditors.size) return;
    const items = pending.items || (pending.textCommand ? [pending] : []);
    const index = items.findIndex((item) => item?.textCommand && pendingTextIsQuestion(item));
    if (index < 0) return;
    window.setTimeout(() => {
      if (state.pending !== pending || state.textEditors.size) return;
      openBoardReplyFromPending(pending.items ? index : null);
    }, 280);
  }
  function commitPendingBatch(p) {
    for (const item of p.items) commitPendingItem(item);
  }
  function commitPendingItem(item) {
    const box = pendingItemBounds(item);
    if (item.erase) eraseWithMask(item.image, box.x, box.y, box.w, box.h);
    else if (item.isTextBoxRecord) {
      // Native state.textBoxes record; skip tile ink blitting to prevent text duplication
      return;
    }
    else if (item.textCommand) blitClipped(item.image, item.x, item.y, (item.image.logicalWidth || item.image.width) * item.scaleX, (item.image.logicalHeight || item.image.height) * item.scaleY, box.w, box.h);
    else if (item.animationScene) addAnimation(item.animationScene, box, item.animationPlayback);
    else blitSized(item.image, box.x, box.y, (item.image.logicalWidth || item.image.width) * item.scaleX, (item.image.logicalHeight || item.image.height) * item.scaleY);
  }
  function armPendingCopy(e, hit, itemIndex = null) {
    const pending = state.pending;
    if (!pending) return false;
    state.pendingGesture = {
      id: e.pointerId,
      hit,
      itemIndex,
      pending,
      armed: true,
      copy: true,
    };
    return true;
  }
  function pendingCopyMatches(gesture, event) {
    const pending = state.pending;
    if (!gesture?.copy || pending !== gesture.pending) return false;
    const result = pendingHit(pending, event, pending.revealProgress < 1),
      hit = typeof result === "string" ? result : result?.hit,
      itemIndex = result && typeof result === "object" ? result.itemIndex : null;
    return hit === gesture.hit && itemIndex === gesture.itemIndex;
  }
  function finishPendingCopy(event) {
    const gesture = state.pendingGesture;
    if (!gesture?.copy || gesture.id !== event.pointerId) return false;
    const shouldCopy = event.type !== "pointercancel" && gesture.armed && pendingCopyMatches(gesture, event);
    state.pendingGesture = null;
    resetCanvasCursor();
    if (shouldCopy) void copyPendingText(gesture.itemIndex);
    return true;
  }
  function beginPendingGesture(e, hit, itemIndex = null) {
    const p = state.pending,
      q = clientPoint(e);
    if (p.items && itemIndex != null) {
      p.selectedIndex = itemIndex;
      if (p.items[itemIndex]?.animationScene) showAnimationControls();
      else hideAnimationControls();
    } else if (!p.items && p.animationScene) showAnimationControls();
    const gesture = {
      id: e.pointerId,
      hit,
      itemIndex,
      last: q,
      armed: true,
      startX: q.x,
      startY: q.y,
    };
    if (p.items && (hit === "batch-move" || hit === "batch-resize")) {
      gesture.batchStartBounds = batchBounds(p);
      gesture.itemStarts = p.items.map((item) => ({ x: item.x, y: item.y, scaleX: item.scaleX, scaleY: item.scaleY }));
    }
    state.pendingGesture = gesture;
    setCanvasCursor(hit === "resize" || hit === "batch-resize" ? "nwse-resize" : hit === "width" ? "ew-resize" : hit === "height" ? "ns-resize" : "grabbing");
    render();
  }
  function resizePendingBatchItems(items, startBox, itemStarts, point, minimum, limit) {
    const target = SELECT.resizeBox(startBox, point, minimum, limit),
      scale = startBox.w > 0 ? target.w / startBox.w : startBox.h > 0 ? target.h / startBox.h : 1;
    items.forEach((item, index) => {
      const start = itemStarts[index];
      if (!start) return;
      item.x = startBox.x + (start.x - startBox.x) * scale;
      item.y = startBox.y + (start.y - startBox.y) * scale;
      item.scaleX = start.scaleX * scale;
      item.scaleY = start.scaleY * scale;
    });
    return target;
  }
  function updatePendingGesture(e) {
    const g = state.pendingGesture,
      p = state.pending;
    if (!g || !p || g.id !== e.pointerId) return false;
    if (g.copy) {
      g.armed = pendingCopyMatches(g, e);
      return true;
    }
    const q = clientPoint(e);
    if (p.items) {
      if (g.hit === "batch-move") {
        if (g.armed) {
          const box = g.batchStartBounds,
            dx = Math.max(-box.x, Math.min(SIZE - box.x - box.w, q.x - g.startX)),
            dy = Math.max(-box.y, Math.min(SIZE - box.y - box.h, q.y - g.startY));
          p.items.forEach((item, index) => {
            item.x = g.itemStarts[index].x + dx;
            item.y = g.itemStarts[index].y + dy;
          });
        }
        g.last = q;
        if (g.armed) render();
        return true;
      }
      if (g.hit === "batch-resize") {
        if (g.armed) resizePendingBatchItems(p.items, g.batchStartBounds, g.itemStarts, q, 40, SIZE);
        g.last = q;
        if (g.armed) render();
        return true;
      }
      const item = p.items[g.itemIndex],
        box = item ? pendingItemBounds(item) : null;
      if (!item || !box) return false;
      if (g.hit === "move" && g.armed) {
        item.x = Math.max(0, Math.min(SIZE - box.w, item.x + q.x - g.last.x));
        item.y = Math.max(0, Math.min(SIZE - box.h, item.y + q.y - g.last.y));
      } else if (g.hit === "resize" && g.armed) {
        const baseWidth = box.w / item.scaleX,
          baseHeight = box.h / item.scaleY,
          minimum = Math.max(40 / baseWidth, 40 / baseHeight),
          maximum = Math.min((SIZE - item.x) / baseWidth, (SIZE - item.y) / baseHeight),
          next = Math.max(minimum, Math.min(maximum, Math.max((q.x - item.x) / baseWidth, (q.y - item.y) / baseHeight)));
        item.scaleX = item.scaleY = next;
      } else if (g.hit === "width" && g.armed) {
        if (item.textCommand) {
          const layoutWidth=Math.max(item.textCommand.fontSize,Math.min((SIZE-item.x)/item.scaleX,(q.x-item.x)/item.scaleX));
          item.layoutWidth=layoutWidth;
          item.image=textImage(item.textCommand.text,item.textCommand.fontSize,item.textCommand.color,item.layoutWidth,item.textCommand.lineHeight);
          if(!item.heightLocked)item.layoutHeight=item.image.logicalHeight||item.image.height;
        } else {
          const baseWidth = box.w / item.scaleX;
          item.scaleX = Math.max(40 / baseWidth, Math.min((SIZE - item.x) / baseWidth, (q.x - item.x) / baseWidth));
        }
      } else if (g.hit === "height" && g.armed) {
        if (item.textCommand) {
          item.layoutHeight = Math.max(item.textCommand.fontSize * item.textCommand.lineHeight + 8, Math.min((SIZE - item.y) / item.scaleY, (q.y - item.y) / item.scaleY));
          item.heightLocked = true;
        } else {
          const baseHeight = box.h / item.scaleY;
          item.scaleY = Math.max(40 / baseHeight, Math.min((SIZE - item.y) / baseHeight, (q.y - item.y) / baseHeight));
        }
      }
      g.last = q;
      if (g.armed) render();
      return true;
    }
    if (g.hit === "move" && g.armed) {
      const b = draftBounds(p);
      p.x = Math.max(0, Math.min(SIZE - b.w, p.x + q.x - g.last.x));
      p.y = Math.max(0, Math.min(SIZE - b.h, p.y + q.y - g.last.y));
    } else if (g.hit === "resize" && g.armed) {
      const minimum = 40,
        baseWidth = p.textCommand ? p.layoutWidth : p.image.logicalWidth || p.image.width,
        baseHeight = p.textCommand ? p.layoutHeight : p.image.logicalHeight || p.image.height,
        ratio = Math.max(minimum / baseWidth, minimum / baseHeight),
        maxScale = Math.max(ratio, Math.min((SIZE - p.x) / baseWidth, (SIZE - p.y) / baseHeight)),
        next = Math.max(ratio, Math.min(maxScale, Math.max((q.x - p.x) / baseWidth, (q.y - p.y) / baseHeight)));
      p.scaleX = p.scaleY = next;
    } else if (g.hit === "width" && g.armed) {
      if (p.textCommand) {
        const layoutWidth=Math.max(p.textCommand.fontSize,Math.min((SIZE-p.x)/p.scaleX,(q.x-p.x)/p.scaleX));
        p.layoutWidth=layoutWidth;
        p.image=textImage(p.textCommand.text,p.textCommand.fontSize,p.textCommand.color,p.layoutWidth,p.textCommand.lineHeight);
        if(!p.heightLocked)p.layoutHeight=p.image.logicalHeight||p.image.height;
      } else {
        const baseWidth = draftBounds(p).w / p.scaleX;
        p.scaleX = Math.max(40 / baseWidth, Math.min((SIZE - p.x) / baseWidth, (q.x - p.x) / baseWidth));
      }
    } else if (g.hit === "height" && g.armed) {
      if (p.textCommand) {
        p.layoutHeight = Math.max(p.textCommand.fontSize * p.textCommand.lineHeight + 8, Math.min((SIZE - p.y) / p.scaleY, (q.y - p.y) / p.scaleY));
        p.heightLocked = true;
      } else {
        const baseHeight = draftBounds(p).h / p.scaleY;
        p.scaleY = Math.max(40 / baseHeight, Math.min((SIZE - p.y) / baseHeight, (q.y - p.y) / baseHeight));
      }
    }
    g.last = q;
    if (g.armed) render();
    return true;
  }
  function eraseRect(x, y, w, h) {
    invalidateSharpOverlays({ x, y, w, h });
    forTiles(
      x,
      y,
      w,
      h,
      (t, tx, ty) => {
        recordBefore(tx, ty);
        t.getContext("2d").clearRect(x - tx * TILE, y - ty * TILE, w, h);
        state.inkBounds.delete(key(tx, ty));
      },
      false,
    );
  }
  function eraseMask(c, bounds) {
    const image = offscreen(Math.max(1, bounds.w), Math.max(1, bounds.h)),
      context = image.getContext("2d");
    context.fillStyle = "#dc2626";
    context.strokeStyle = "#dc2626";
    if (c.mode === "path") {
      context.lineWidth = c.size;
      context.lineCap = context.lineJoin = "round";
      context.beginPath();
      c.points.forEach(([x, y], index) => {
        const px = x - bounds.x,
          py = y - bounds.y;
        if (index) context.lineTo(px, py);
        else context.moveTo(px, py);
      });
      if (c.points.length === 1) context.lineTo(c.points[0][0] - bounds.x + 0.01, c.points[0][1] - bounds.y + 0.01);
      context.stroke();
    } else context.fillRect(0, 0, image.width, image.height);
    return image;
  }
  function eraseWithMask(image, x, y, w, h) {
    invalidateSharpOverlays({ x, y, w, h });
    forTiles(
      x,
      y,
      w,
      h,
      (canvas, tx, ty) => {
        recordBefore(tx, ty);
        const context = canvas.getContext("2d");
        context.save();
        context.globalCompositeOperation = "destination-out";
        context.drawImage(image, x - tx * TILE, y - ty * TILE, w, h);
        context.restore();
        state.inkBounds.delete(key(tx, ty));
      },
      false,
    );
  }
  function eraseBounds(c) {
    if (c.mode !== "path") return { x: c.x, y: c.y, w: c.w, h: c.h };
    const xs = c.points.map((p) => p[0]),
      ys = c.points.map((p) => p[1]),
      pad = c.size / 2;
    return {
      x: Math.max(0, Math.min(...xs) - pad),
      y: Math.max(0, Math.min(...ys) - pad),
      w: Math.min(SIZE, Math.max(...xs) + pad) - Math.max(0, Math.min(...xs) - pad),
      h: Math.min(SIZE, Math.max(...ys) + pad) - Math.max(0, Math.min(...ys) - pad),
    };
  }
  async function previewErase(c, revision) {
    const b = eraseBounds(c);
    for (let i = 1; i <= 12; i++) {
      checkAI(revision);
      render();
      ctx.save();
      ctx.translate(state.panX, state.panY);
      ctx.scale(state.scale, state.scale);
      ctx.fillStyle = "rgba(220,38,38,.16)";
      ctx.fillRect(b.x, b.y, (b.w * i) / 12, b.h);
      ctx.restore();
      await wait(22);
    }
  }
  function commitErasePath(c) {
    const pts = c.points.map(([x, y]) => ({ x, y }));
    if (pts.length === 1) pts.push({ ...pts[0] });
    for (let i = 1; i < pts.length; i++) stroke(pts[i - 1], pts[i], true, c.size, false);
  }
  function compileExpression(source) {
    const text = normalizePlotExpression(source)
      .trim()
      .replace(/^y\s*=\s*/i, "");
    if (!text || text.length > 180 || !/^[\d\sA-Za-z_+\-*/^().]+$/.test(text)) throw Error("Unsupported expression");
    const tokens = [],
      re = /\s*(\d*\.?\d+(?:e[+\-]?\d+)?|[A-Za-z_]+|[()+\-*/^])/gy;
    let at = 0,
      m;
    while ((m = re.exec(text))) {
      if (m.index !== at) throw Error("Invalid token");
      tokens.push(m[1]);
      at = re.lastIndex;
    }
    if (at !== text.length || tokens.length > 100) throw Error("Expression too complex");
    let i = 0;
    const funcs = {
      sin: Math.sin,
      cos: Math.cos,
      tan: Math.tan,
      sqrt: Math.sqrt,
      abs: Math.abs,
      exp: Math.exp,
      log: Math.log,
      ln: Math.log,
    };
    function take(v) {
      if (tokens[i] === v) {
        i++;
        return true;
      }
      return false;
    }
    function primary() {
      const t = tokens[i++];
      if (t === "(") {
        const v = add();
        if (!take(")")) throw Error("Unclosed parenthesis");
        return v;
      }
      if (/^\d|^\./.test(t || "")) return () => Number(t);
      if (t === "x") return (x) => x;
      if (t === "pi") return () => Math.PI;
      if (t === "e") return () => Math.E;
      if (funcs[t]) {
        if (!take("(")) throw Error("Function needs parentheses");
        const arg = add();
        if (!take(")")) throw Error("Unclosed function");
        return (x) => funcs[t](arg(x));
      }
      throw Error("Unknown identifier");
    }
    function unary() {
      if (take("+")) return unary();
      if (take("-")) {
        const v = unary();
        return (x) => -v(x);
      }
      return primary();
    }
    function power() {
      let left = unary();
      if (take("^")) {
        const right = power(),
          old = left;
        left = (x) => old(x) ** right(x);
      }
      return left;
    }
    function multiply() {
      let left = power();
      while (tokens[i] === "*" || tokens[i] === "/") {
        const op = tokens[i++],
          right = power(),
          old = left;
        left = op === "*" ? (x) => old(x) * right(x) : (x) => old(x) / right(x);
      }
      return left;
    }
    function add() {
      let left = multiply();
      while (tokens[i] === "+" || tokens[i] === "-") {
        const op = tokens[i++],
          right = multiply(),
          old = left;
        left = op === "+" ? (x) => old(x) + right(x) : (x) => old(x) - right(x);
      }
      return left;
    }
    const result = add();
    if (i !== tokens.length) throw Error("Unexpected expression tail");
    return result;
  }
  function normalizePlotExpression(source) {
    return String(source || "")
      .trim()
      .replace(/[−–—]/g, "-")
      .replace(/[×·]/g, "*")
      .replace(/÷/g, "/")
      .replace(/π/gi, "pi")
      .replace(/√\s*\(([^()]*)\)/g, "sqrt($1)")
      .replace(/√\s*([A-Za-z0-9_.]+)/g, "sqrt($1)")
      .replace(/(\d|\)|x(?![A-Za-z_])|pi(?![A-Za-z_])|e(?![A-Za-z_]))\s*(?=x|pi|e(?![+\-]?\d)|sin|cos|tan|sqrt|abs|exp|log|ln|\()/gi, "$1*");
  }
  function plot(c) {
    const o = offscreen(c.w, c.h),
      q = o.getContext("2d"),
      minSide = Math.min(c.w, c.h),
      tickFont = Math.max(10, Math.min(96, minSide * 0.032)),
      titleFont = Math.max(11, Math.min(112, minSide * 0.041)),
      margin = {
        left: Math.max(42, minSide * 0.105),
        right: Math.max(24, minSide * 0.06),
        top: Math.max(42, minSide * 0.12),
        bottom: Math.max(38, minSide * 0.1),
      },
      area = {
        left: margin.left,
        top: margin.top,
        right: c.w - margin.right,
        bottom: c.h - margin.bottom,
      },
      plotWidth = Math.max(1, area.right - area.left),
      plotHeight = Math.max(1, area.bottom - area.top),
      gridWidth = Math.max(0.75, Math.min(5, minSide * 0.002)),
      axisWidth = Math.max(1.5, Math.min(9, minSide * 0.004)),
      curveWidth = Math.max(2.2, Math.min(13, minSide * 0.006));
    let evaluate;
    try {
      evaluate = compileExpression(c.expression);
    } catch {
      return o;
    }
    const view = plotView(evaluate),
      { xMin, xMax, yMin, yMax } = view,
      xPixel = (x) => area.left + ((x - xMin) / (xMax - xMin)) * plotWidth,
      yPixel = (y) => area.bottom - ((y - yMin) / (yMax - yMin)) * plotHeight,
      axisX = Math.max(area.left, Math.min(area.right, xPixel(0))),
      axisY = Math.max(area.top, Math.min(area.bottom, yPixel(0))),
      xStep = nicePlotStep(xMax - xMin, Math.max(2, plotWidth / 72)),
      yStep = nicePlotStep(yMax - yMin, Math.max(2, plotHeight / 52)),
      xTicks = plotTicks(xMin, xMax, xStep),
      yTicks = plotTicks(yMin, yMax, yStep);

    q.save();
    q.lineCap = q.lineJoin = "round";
    q.strokeStyle = "rgba(148, 163, 184, 0.34)";
    q.lineWidth = gridWidth;
    q.beginPath();
    for (const x of xTicks) {
      if (Math.abs(x) > xStep * 1e-9) {
        const px = xPixel(x);
        q.moveTo(px, area.top);
        q.lineTo(px, area.bottom);
      }
    }
    for (const y of yTicks) {
      if (Math.abs(y) > yStep * 1e-9) {
        const py = yPixel(y);
        q.moveTo(area.left, py);
        q.lineTo(area.right, py);
      }
    }
    q.stroke();

    q.strokeStyle = "#475569";
    q.fillStyle = "#475569";
    q.lineWidth = axisWidth;
    q.beginPath();
    q.moveTo(area.left, axisY);
    q.lineTo(area.right, axisY);
    q.moveTo(axisX, area.bottom);
    q.lineTo(axisX, area.top);
    q.stroke();
    const arrow = Math.max(6, Math.min(24, tickFont * 0.62));
    q.beginPath();
    q.moveTo(area.right, axisY);
    q.lineTo(area.right - arrow, axisY - arrow * 0.55);
    q.lineTo(area.right - arrow, axisY + arrow * 0.55);
    q.closePath();
    q.moveTo(axisX, area.top);
    q.lineTo(axisX - arrow * 0.55, area.top + arrow);
    q.lineTo(axisX + arrow * 0.55, area.top + arrow);
    q.closePath();
    q.fill();

    const tickLength = Math.max(4, Math.min(18, tickFont * 0.42));
    q.font = `500 ${tickFont}px ui-sans-serif, system-ui, sans-serif`;
    q.textBaseline = axisY > area.bottom - tickFont * 1.8 ? "bottom" : "top";
    q.textAlign = "center";
    q.beginPath();
    for (const x of xTicks) {
      const px = xPixel(x);
      q.moveTo(px, axisY - tickLength / 2);
      q.lineTo(px, axisY + tickLength / 2);
    }
    for (const y of yTicks) {
      const py = yPixel(y);
      q.moveTo(axisX - tickLength / 2, py);
      q.lineTo(axisX + tickLength / 2, py);
    }
    q.stroke();
    for (const x of xTicks) {
      if (Math.abs(x) > xStep * 1e-9) q.fillText(formatPlotTick(x, xStep), xPixel(x), axisY + (q.textBaseline === "top" ? tickLength * 0.7 : -tickLength * 0.7));
    }
    q.textAlign = axisX < area.left + tickFont * 3 ? "left" : "right";
    q.textBaseline = "middle";
    for (const y of yTicks) {
      if (Math.abs(y) > yStep * 1e-9) q.fillText(formatPlotTick(y, yStep), axisX + (q.textAlign === "left" ? tickLength * 0.8 : -tickLength * 0.8), yPixel(y));
    }
    q.textAlign = "left";
    q.textBaseline = "bottom";
    q.font = `600 ${titleFont}px ui-sans-serif, system-ui, sans-serif`;
    q.fillText("x", area.right - titleFont * 0.35, Math.max(area.top + titleFont, axisY - titleFont * 0.28));
    q.fillText("y", Math.min(area.right - titleFont, axisX + titleFont * 0.28), area.top + titleFont * 0.9);
    const title = `y = ${normalizePlotExpression(c.expression).replace(/^y\s*=\s*/i, "")}`;
    q.fillStyle = c.color || "#2563eb";
    q.textBaseline = "top";
    q.fillText(fitCanvasText(q, title, plotWidth), area.left, Math.max(2, (margin.top - titleFont) / 2));

    q.save();
    q.beginPath();
    q.rect(area.left, area.top, plotWidth, plotHeight);
    q.clip();
    q.strokeStyle = c.color || "#2563eb";
    q.lineWidth = curveWidth;
    q.beginPath();
    let joined = false,
      previousPy = 0,
      previousX = 0;
    const sampleStep = Math.max(0.5, Math.min(2, 900 / plotWidth));
    for (let px = area.left; px <= area.right; px += sampleStep) {
      const x = xMin + ((px - area.left) / plotWidth) * (xMax - xMin);
      let y;
      try {
        y = evaluate(x);
      } catch {
        y = NaN;
      }
      const py = yPixel(y),
        visibleEnough = Number.isFinite(py) && py > area.top - plotHeight * 2 && py < area.bottom + plotHeight * 2,
        midpointY = joined ? evaluate((previousX + x) / 2) : y,
        discontinuity = joined && (!Number.isFinite(midpointY) || Math.abs(py - previousPy) > plotHeight * 0.75 || Math.abs(yPixel(midpointY) - (py + previousPy) / 2) > plotHeight * 0.5);
      if (visibleEnough) {
        if (!joined) {
          q.moveTo(px, py);
          joined = true;
        } else if (discontinuity) q.moveTo(px, py);
        else q.lineTo(px, py);
        previousPy = py;
        previousX = x;
      } else joined = false;
    }
    q.stroke();
    q.restore();
    q.restore();
    return o;
  }
  function plotView(evaluate) {
    for (const extent of [5, 10, 100, 1000, 10000]) {
      const values = [];
      for (let i = 0; i <= 240; i++) {
        const y = evaluate(-extent + (i / 240) * extent * 2);
        if (Number.isFinite(y)) values.push(y);
      }
      if (values.length < 8) continue;
      if (extent === 5 && values.some((y) => y >= -10 && y <= 10)) return { xMin: -5, xMax: 5, yMin: -10, yMax: 10 };
      values.sort((a, b) => a - b);
      let low = values[Math.floor(values.length * 0.02)],
        high = values[Math.ceil(values.length * 0.98) - 1];
      if (low === high) {
        const padding = Math.max(1, Math.abs(low) * 0.1);
        low -= padding;
        high += padding;
      } else {
        const padding = (high - low) * 0.1;
        low -= padding;
        high += padding;
      }
      const step = nicePlotStep(high - low, 8);
      return { xMin: -extent, xMax: extent, yMin: Math.floor(low / step) * step, yMax: Math.ceil(high / step) * step };
    }
    return { xMin: -5, xMax: 5, yMin: -10, yMax: 10 };
  }
  function nicePlotStep(range, targetTicks) {
    const rough = Math.max(Number.MIN_VALUE, range / Math.max(1, targetTicks)),
      power = 10 ** Math.floor(Math.log10(rough)),
      normalized = rough / power,
      factor = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
    return factor * power;
  }
  function plotTicks(min, max, step) {
    const values = [],
      first = Math.ceil((min - step * 1e-9) / step) * step;
    for (let value = first; value <= max + step * 1e-9 && values.length < 40; value += step) values.push(Math.abs(value) < step * 1e-9 ? 0 : value);
    return values;
  }
  function formatPlotTick(value, step) {
    const digits = Math.max(0, Math.min(6, -Math.floor(Math.log10(step))));
    return Number(value.toFixed(digits)).toString();
  }
  function fitCanvasText(context, text, maxWidth) {
    if (context.measureText(text).width <= maxWidth) return text;
    let low = 0,
      high = text.length;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (context.measureText(`${text.slice(0, middle)}...`).width <= maxWidth) low = middle;
      else high = middle - 1;
    }
    return `${text.slice(0, low)}...`;
  }
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  function animationPointerHit(point, pointerType = "mouse") {
    if (!pluginEnabled("animation")) return null;
    const selected = selectedAnimation(),
      radius = (pointerType === "touch" ? 24 : 14) / state.scale;
    if (selected) {
      const box = animationBox(selected);
      if (animationEditChromeVisible()) {
        const handle = 14 / state.scale,
          actionRadius = pointerType === "touch" ? 22 / state.scale : Math.max(handle * 0.8, 9 / state.scale),
          actions = draftActionPoints(box, handle, false, true),
          controls = [
            ...Object.entries(actions).map(([hit, target]) => ({ hit, target, radius: actionRadius })),
            { hit: "resize", target: { x: box.x + box.w, y: box.y + box.h }, radius },
            { hit: "width", target: { x: box.x + box.w + handle * 0.08, y: box.y + box.h / 2 }, radius },
            { hit: "height", target: { x: box.x + box.w / 2, y: box.y + box.h + handle * 0.08 }, radius },
          ];
        const control = controls
          .map((item) => ({ ...item, distance: Math.hypot(point.x - item.target.x, point.y - item.target.y) }))
          .filter((item) => item.distance <= item.radius)
          .sort((a, b) => a.distance - b.distance)[0];
        if (control) return { animation: selected, hit: control.hit };
      }
      if (point.x >= box.x && point.x <= box.x + box.w && point.y >= box.y && point.y <= box.y + box.h) return { animation: selected, hit: "move" };
    }
    const animations = visibleAnimations();
    for (let index = animations.length - 1; index >= 0; index--) {
      const animation = animations[index],
        box = animationBox(animation);
      if (point.x >= box.x && point.x <= box.x + box.w && point.y >= box.y && point.y <= box.y + box.h) return { animation, hit: "move" };
    }
    return null;
  }
  function beginAnimationGesture(event, point, result) {
    if (!result?.animation) return false;
    if (result.hit === "accept") return acceptAnimationEdit() || true;
    if (result.hit === "cancel") return cancelAnimationEdit() || true;
    if (state.selection) commitSelection();
    beginAnimationEdit(result.animation);
    state.animationGesture = {
      id: event.pointerId,
      animation: result.animation,
      hit: result.hit,
      startPoint: point,
      start: animationBox(result.animation),
      changed: false,
    };
    showAnimationControls();
    setCanvasCursor(result.hit === "resize" ? "nwse-resize" : result.hit === "width" ? "ew-resize" : result.hit === "height" ? "ns-resize" : "grabbing");
    setStatusKey("animationSelected");
    requestAnimationLayerRender();
    requestInteractionLayerRender();
    return true;
  }
  function updateAnimationGesture(event) {
    const gesture = state.animationGesture;
    if (!gesture || gesture.id !== event.pointerId) return false;
    const point = clientPoint(event),
      animation = gesture.animation,
      dx = point.x - gesture.startPoint.x,
      dy = point.y - gesture.startPoint.y;
    if (gesture.hit === "resize") {
      const ratio = gesture.start.w / gesture.start.h,
        targetWidth = Math.max(80, Math.max(point.x - gesture.start.x, (point.y - gesture.start.y) * ratio)),
        width = Math.min(SIZE - gesture.start.x, targetWidth),
        height = Math.min(SIZE - gesture.start.y, width / ratio);
      animation.w = width;
      animation.h = height;
    } else if (gesture.hit === "width") {
      animation.w = Math.max(80, Math.min(SIZE - gesture.start.x, point.x - gesture.start.x));
    } else if (gesture.hit === "height") {
      animation.h = Math.max(80, Math.min(SIZE - gesture.start.y, point.y - gesture.start.y));
    } else {
      animation.x = Math.max(0, Math.min(SIZE - animation.w, gesture.start.x + dx));
      animation.y = Math.max(0, Math.min(SIZE - animation.h, gesture.start.y + dy));
    }
    gesture.changed ||= Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01;
    requestAnimationLayerRender();
    requestInteractionLayerRender();
    return true;
  }
  function finishAnimationGesture(event) {
    const gesture = state.animationGesture;
    if (!gesture || gesture.id !== event.pointerId) return false;
    state.animationGesture = null;
    resetCanvasCursor();
    if (gesture.changed && state.animationEdit) state.animationEdit.changed = true;
    showAnimationControls();
    requestAnimationLayerRender();
    requestInteractionLayerRender();
    return true;
  }
  function deselectAnimation() {
    if (!state.selectedAnimationId) return;
    acceptAnimationEdit();
  }
  function isMousePan(e) {
    return e.pointerType === "mouse" && (e.button === 1 || e.altKey);
  }
  function finishDrawing(pointerType) {
    if (!state.drawing) return;
    const d = state.drawing;
    state.drawing = null;
    const shouldRequest = !d.erase;
    let refineCandidate = null;
    if (shouldRequest) {
      for (const point of d.trail) state.hotspotTrail.push(point);
      if (state.hotspotTrail.length > 512) state.hotspotTrail.splice(0, state.hotspotTrail.length - 512);
      refineCandidate = latchWidgetRefineCandidate(d);
    }
    notePendingContinuedInput(d);
    state.autoEligible ||= shouldRequest;
    if (shouldRequest && d.bbox) rememberInkBox(d.bbox);
    if (shouldRequest && state.autoEligible && !refineCandidate) schedule();
    save();
    requestInteractionLayerRender();
    if (shouldRequest) setStatusKey(refineCandidate ? "widgetRefinePending" : state.pending?.items ? "batchDraftReady" : state.pending ? "draftReady" : "ready");
  }
