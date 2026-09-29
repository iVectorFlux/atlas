
  function imageBox(item) {
    return { x:item.x, y:item.y, w:item.w, h:item.h };
  }
  function imageLayout(item) {
    return imageBox(item);
  }
  function imageHistoryRecord(item) {
    return {
      id:item.id,
      x:item.x,
      y:item.y,
      w:item.w,
      h:item.h,
      naturalW:item.naturalW,
      naturalH:item.naturalH,
      sourceName:item.sourceName,
      blob:item.blob,
      image:item.image,
    };
  }
  function storedImageRecord(item) {
    return {
      id:item.id,
      x:item.x,
      y:item.y,
      w:item.w,
      h:item.h,
      naturalW:item.naturalW,
      naturalH:item.naturalH,
      sourceName:item.sourceName,
      blob:item.blob,
    };
  }
  function imageRecord(item) {
    if (!item || typeof item !== "object" || !(item.blob instanceof Blob) || !item.image || item.blob.size <= 0 || item.blob.size > MAX_IMAGE_SOURCE_BYTES) return null;
    if (!n(item.x) || !n(item.y) || !n(item.w, 80) || !n(item.h, 80) || item.x + item.w > SIZE || item.y + item.h > SIZE) return null;
    const naturalW = Number(item.naturalW) || item.image.naturalWidth || item.image.width,
      naturalH = Number(item.naturalH) || item.image.naturalHeight || item.image.height;
    if (!n(naturalW, 1, MAX_IMAGE_DIMENSION) || !n(naturalH, 1, MAX_IMAGE_DIMENSION) || naturalW * naturalH > MAX_IMAGE_PIXELS) return null;
    return {
      id:typeof item.id === "string" && /^image-\d+$/.test(item.id) ? item.id : `image-${state.nextImageId++}`,
      x:Math.round(item.x),
      y:Math.round(item.y),
      w:Math.round(item.w),
      h:Math.round(item.h),
      naturalW:Math.round(naturalW),
      naturalH:Math.round(naturalH),
      sourceName:typeof item.sourceName === "string" ? item.sourceName.trim().slice(0, 160) : "",
      blob:item.blob,
      image:item.image,
    };
  }
  function imageHistoryState() {
    return state.images.map(imageHistoryRecord);
  }
  function storedImages() {
    return state.images.map(storedImageRecord);
  }
  function recordImagesBefore() {
    if (!state.imageHistoryBefore) state.imageHistoryBefore = imageHistoryState();
  }
  function restoreImages(items) {
    state.images = [];
    state.nextImageId = 1;
    state.selectedImageId = null;
    state.imageEdit = null;
    state.imageGesture = null;
    state.imageHandReturnMode = null;
    for (const item of Array.isArray(items) ? items.slice(0, MAX_VISIBLE_IMAGES) : []) {
      const record = imageRecord(item);
      if (!record || state.images.some((existing) => existing.id === record.id)) continue;
      const numbered = /^image-(\d+)$/.exec(record.id);
      if (numbered) state.nextImageId = Math.max(state.nextImageId, Number(numbered[1]) + 1);
      state.images.push(record);
    }
  }
  async function decodeStoredImage(item) {
    if (!item || !(item.blob instanceof Blob)) return null;
    try {
      const image = await imageFromBlob(item.blob);
      return imageRecord({ ...item, image });
    } catch {
      return null;
    }
  }
  async function decodeStoredImages(items) {
    return (await Promise.all((Array.isArray(items) ? items.slice(0, MAX_VISIBLE_IMAGES) : []).map(decodeStoredImage))).filter(Boolean);
  }
  function visibleImages(region = null) {
    return state.images.filter((item) => !region || intersection(imageBox(item), region));
  }
  function imageBounds(region = null) {
    let bounds = null;
    for (const item of visibleImages(region)) bounds = unionLocalBounds(bounds, region ? intersection(imageBox(item), region) : imageBox(item));
    return bounds;
  }
  function drawImagesToContext(context, region = null) {
    for (const item of visibleImages(region)) context.drawImage(item.image, item.x, item.y, item.w, item.h);
  }
  function selectedImage() {
    return state.images.find((item) => item.id === state.selectedImageId) || null;
  }
  function enterManualImageHandMode() {
    if (state.mode !== "hand" && state.imageHandReturnMode === null) state.imageHandReturnMode = state.mode;
    if (state.mode !== "hand") setCanvasMode("hand", {
      preserveSelection:true,
      skipDraftFinalize:true,
      preserveWidgetRefinement:true,
    });
  }
  function finishManualImageHandMode() {
    const returnMode = state.imageHandReturnMode;
    state.imageHandReturnMode = null;
    if (returnMode && state.mode === "hand") setCanvasMode(returnMode, {
      preserveSelection:true,
      skipDraftFinalize:true,
      preserveWidgetRefinement:true,
    });
  }
  function beginImageEdit(item) {
    if (!item || !state.images.includes(item)) return false;
    if (state.imageEdit?.id === item.id) return true;
    if (state.widgetEdit) acceptWidgetEdit();
    if (state.animationEdit) acceptAnimationEdit();
    if (state.imageEdit) acceptImageEdit({ restoreMode:false });
    recordImagesBefore();
    state.selectedImageId = item.id;
    state.imageEdit = { id:item.id, before:imageLayout(item), changed:false };
    requestInteractionLayerRender();
    setStatusKey("imageSelected");
    return true;
  }
  function acceptImageEdit(options) {
    options ||= {};
    const restoreMode = options.restoreMode !== false;
    const edit = state.imageEdit;
    state.imageGesture = null;
    state.imageEdit = null;
    state.selectedImageId = null;
    if (edit?.changed) {
      state.userRevision++;
      save();
    } else if (edit) state.imageHistoryBefore = null;
    if (edit && state.mode !== "hand") schedule();
    requestRender();
    if (edit) setStatusKey("ready");
    if (edit && restoreMode) finishManualImageHandMode();
    else if (edit) state.imageHandReturnMode = null;
    return Boolean(edit);
  }
  function cancelImageEdit() {
    const edit = state.imageEdit,
      item = edit ? state.images.find((candidate) => candidate.id === edit.id) : null;
    if (item) Object.assign(item, edit.before);
    state.imageHistoryBefore = null;
    state.imageGesture = null;
    state.imageEdit = null;
    state.selectedImageId = null;
    if (edit && state.mode !== "hand") schedule();
    requestRender();
    if (edit) setStatusKey("ready");
    if (edit) finishManualImageHandMode();
    return Boolean(edit);
  }
  function imageControlHit(item, point, pointerType = "mouse") {
    const box = imageBox(item),
      handle = 14 / state.scale,
      radius = (pointerType === "touch" ? 24 : 14) / state.scale,
      controls = [
        { hit:"resize", target:{ x:box.x + box.w, y:box.y + box.h }, radius },
        { hit:"width", target:{ x:box.x + box.w + handle * 0.08, y:box.y + box.h / 2 }, radius },
        { hit:"height", target:{ x:box.x + box.w / 2, y:box.y + box.h + handle * 0.08 }, radius },
      ],
      control = controls
        .map((candidate) => ({ ...candidate, distance:Math.hypot(point.x - candidate.target.x, point.y - candidate.target.y) }))
        .filter((candidate) => candidate.distance <= candidate.radius)
        .sort((a, b) => a.distance - b.distance)[0];
    if (control) return control.hit;
    return point.x >= box.x && point.x <= box.x + box.w && point.y >= box.y && point.y <= box.y + box.h ? "move" : null;
  }
  function imageAtPoint(point) {
    for (let index = state.images.length - 1; index >= 0; index--) {
      const item = state.images[index], box = imageBox(item);
      if (point.x >= box.x && point.x <= box.x + box.w && point.y >= box.y && point.y <= box.y + box.h) return item;
    }
    return null;
  }
  function imagePointerHit(point, pointerType = "mouse", includeUnselected = false) {
    const selected = selectedImage();
    if (selected && state.imageEdit) {
      const hit = imageControlHit(selected, point, pointerType);
      if (hit) return { image:selected, hit };
    }
    if (!includeUnselected) return null;
    const item = imageAtPoint(point);
    return item ? { image:item, hit:"move" } : null;
  }
  function resizeImageBox(start, point, hit) {
    const minimumWidth = 80, minimumHeight = 80,
      maximumWidth = SIZE - start.x,
      maximumHeight = SIZE - start.y;
    if (hit === "width") return { ...start, w:Math.max(minimumWidth, Math.min(maximumWidth, point.x - start.x)) };
    if (hit === "height") return { ...start, h:Math.max(minimumHeight, Math.min(maximumHeight, point.y - start.y)) };
    const minimumScale = Math.max(minimumWidth / start.w, minimumHeight / start.h),
      maximumScale = Math.min(maximumWidth / start.w, maximumHeight / start.h),
      requestedScale = Math.max((point.x - start.x) / start.w, (point.y - start.y) / start.h),
      scale = Math.max(minimumScale, Math.min(maximumScale, requestedScale));
    return { ...start, w:start.w * scale, h:start.h * scale };
  }
  function beginImageGesture(event, point, result) {
    if (!result?.image) return false;
    beginImageEdit(result.image);
    state.imageGesture = {
      id:event.pointerId,
      image:result.image,
      hit:result.hit,
      startPoint:point,
      start:imageLayout(result.image),
      changed:false,
    };
    setCanvasCursor(result.hit === "resize" ? "nwse-resize" : result.hit === "width" ? "ew-resize" : result.hit === "height" ? "ns-resize" : "grabbing");
    requestInteractionLayerRender();
    return true;
  }
  function updateImageGesture(event) {
    const gesture = state.imageGesture;
    if (!gesture || gesture.id !== event.pointerId) return false;
    const point = clientPoint(event), item = gesture.image;
    if (gesture.hit === "move") {
      item.x = Math.max(0, Math.min(SIZE - item.w, gesture.start.x + point.x - gesture.startPoint.x));
      item.y = Math.max(0, Math.min(SIZE - item.h, gesture.start.y + point.y - gesture.startPoint.y));
    } else Object.assign(item, resizeImageBox(gesture.start, point, gesture.hit));
    gesture.changed = ["x", "y", "w", "h"].some((key) => Math.abs(item[key] - gesture.start[key]) > 0.01);
    requestRender();
    requestInteractionLayerRender();
    return true;
  }
  function finishImageGesture(event) {
    const gesture = state.imageGesture;
    if (!gesture || gesture.id !== event.pointerId) return false;
    state.imageGesture = null;
    resetCanvasCursor();
    if (gesture.changed && state.imageEdit?.id === gesture.image.id) state.imageEdit.changed = true;
    requestInteractionLayerRender();
    return true;
  }
  function deleteImage(item) {
    if (!item || !state.images.includes(item)) return false;
    const edited = state.imageEdit?.id === item.id;
    recordImagesBefore();
    state.images = state.images.filter((candidate) => candidate !== item);
    if (state.selectedImageId === item.id) {
      state.selectedImageId = null;
      state.imageEdit = null;
      state.imageGesture = null;
    }
    state.userRevision++;
    save();
    if (edited) finishManualImageHandMode();
    if (state.mode !== "hand") schedule();
    requestRender();
    setStatusKey("imageDeleted");
    return true;
  }
  function mergeImage(item) {
    if (!item || !state.images.includes(item)) return false;
    const edited = state.imageEdit?.id === item.id;
    recordImagesBefore();
    const box = imageBox(item);
    invalidateSharpOverlays(box);
    const x0 = Math.max(0, Math.floor(box.x / TILE)),
      y0 = Math.max(0, Math.floor(box.y / TILE)),
      x1 = Math.min(Math.ceil(SIZE / TILE) - 1, Math.ceil((box.x + box.w) / TILE) - 1),
      y1 = Math.min(Math.ceil(SIZE / TILE) - 1, Math.ceil((box.y + box.h) / TILE) - 1);
    for (let ty = y0; ty <= y1; ty++)
      for (let tx = x0; tx <= x1; tx++) {
        recordBefore(tx, ty);
        const canvas = tile(tx, ty);
        canvas.getContext("2d").drawImage(item.image, item.x - tx * TILE, item.y - ty * TILE, item.w, item.h);
        extendInkBounds(key(tx, ty), {
          x: Math.max(0, item.x - tx * TILE),
          y: Math.max(0, item.y - ty * TILE),
          w: Math.min(TILE, item.x + item.w - tx * TILE) - Math.max(0, item.x - tx * TILE),
          h: Math.min(TILE, item.y + item.h - ty * TILE) - Math.max(0, item.y - ty * TILE),
        });
      }
    state.images = state.images.filter((candidate) => candidate !== item);
    if (state.selectedImageId === item.id) {
      state.selectedImageId = null;
      state.imageEdit = null;
      state.imageGesture = null;
    }
    state.userRevision++;
    mergeDirty(box.x, box.y, 0);
    mergeDirty(box.x + box.w, box.y + box.h, 0);
    if (edited) finishManualImageHandMode();
    if (state.mode !== "hand") {
      state.autoEligible = true;
      schedule();
    }
    save();
    requestRender();
    setStatusKey("imageMerged");
    return true;
  }
  function importedImagePlacement(naturalW, naturalH) {
    const visible = viewportRect() || { x:0, y:0, w:SIZE, h:SIZE },
      rect = view.getBoundingClientRect(),
      maxW = Math.max(80, Math.min(6000, visible.w * 0.72, Math.max(240, rect.width * 0.52) / state.scale)),
      maxH = Math.max(80, Math.min(6000, visible.h * 0.72, Math.max(200, rect.height * 0.52) / state.scale)),
      scale = Math.min(maxW / naturalW, maxH / naturalH),
      w = Math.max(80, naturalW * scale),
      h = Math.max(80, naturalH * scale),
      x = Math.max(0, Math.min(SIZE - w, visible.x + (visible.w - w) / 2)),
      y = Math.max(0, Math.min(SIZE - h, visible.y + (visible.h - h) / 2));
    return { x, y, w, h };
  }
  function imageImportError(key) {
    const error = Error(t(key));
    error.statusKey = key;
    return error;
  }
  async function prepareImportedImage(file) {
    if (!(file instanceof Blob) || file.size <= 0 || file.size > MAX_IMAGE_SOURCE_BYTES) throw imageImportError("imageTooLarge");
    if (file.type && !file.type.toLowerCase().startsWith("image/")) throw imageImportError("imageUnsupported");
    let source;
    try { source = await imageFromBlob(file); } catch { throw imageImportError("imageUnsupported"); }
    const sourceW = source.naturalWidth || source.width,
      sourceH = source.naturalHeight || source.height;
    if (!Number.isFinite(sourceW) || !Number.isFinite(sourceH) || sourceW <= 0 || sourceH <= 0) throw imageImportError("imageUnsupported");
    const scale = Math.min(1, MAX_IMAGE_DIMENSION / sourceW, MAX_IMAGE_DIMENSION / sourceH, Math.sqrt(MAX_IMAGE_PIXELS / (sourceW * sourceH))),
      naturalW = Math.max(1, Math.round(sourceW * scale)),
      naturalH = Math.max(1, Math.round(sourceH * scale)),
      canvas = offscreen(naturalW, naturalH),
      context = canvas.getContext("2d");
    context.drawImage(source, 0, 0, naturalW, naturalH);
    const blob = await canvasBlob(canvas, "image/webp", 0.92);
    canvas.width = canvas.height = 1;
    if (!blob || blob.size <= 0 || blob.size > MAX_IMAGE_SOURCE_BYTES) throw imageImportError("imageTooLarge");
    const image = await imageFromBlob(blob);
    return { blob, image, naturalW, naturalH };
  }
  function canvasIdentityGeneration() {
    return state.snapshotLoadGeneration;
  }
  async function addImageFile(file) {
    if (state.imageImporting) return;
    cancelWidgetRefinement("image-import-started");
    if (state.images.length >= MAX_VISIBLE_IMAGES) {
      setStatusKey("imageLimitReached");
      return;
    }
    if (selectionAIBusy()) {
      setStatusKey(selectionAIStatusKey());
      return;
    }
    const expectedIdentityGeneration = canvasIdentityGeneration();
    state.imageImporting = true;
    imagePickerButton.disabled = true;
    setStatusKey("imageLoading");
    try {
      const prepared = await prepareImportedImage(file);
      if (expectedIdentityGeneration !== canvasIdentityGeneration()) return;
      if (state.pending) acceptPending();
      if (state.pendingWidgetReplacement) rejectPendingWidget(AI_CANCELLED);
      else if (state.pendingWidget) acceptPendingWidget();
      if (state.images.length >= MAX_VISIBLE_IMAGES) throw imageImportError("imageLimitReached");
      if (state.selection) commitSelection();
      if (state.selection) {
        setStatusKey(selectionAIStatusKey());
        return;
      }
      if (state.widgetEdit) acceptWidgetEdit();
      if (state.animationEdit) acceptAnimationEdit();
      if (state.imageEdit) acceptImageEdit();
      recordImagesBefore();
      const item = imageRecord({
        id:`image-${state.nextImageId++}`,
        ...importedImagePlacement(prepared.naturalW, prepared.naturalH),
        ...prepared,
        sourceName:typeof file.name === "string" ? file.name : "",
      });
      if (!item) throw imageImportError("imageImportFailed");
      state.images.push(item);
      state.userRevision++;
      save();
      requestRender();
      enterManualImageHandMode();
      beginImageEdit(item);
      setStatusKey("imageAdded");
    } catch (error) {
      setStatusKey(error?.statusKey || "imageImportFailed");
    } finally {
      state.imageImporting = false;
      imagePickerButton.disabled = false;
      imagePickerInput.value = "";
    }
  }
  function placementBelowBox(source, naturalW, naturalH) {
    const gap = Math.max(28, 18 / Math.max(0.03, state.scale)),
      maxW = Math.max(160, Math.min(source.w * 1.35, 720 / Math.max(0.03, state.scale), SIZE * 0.42)),
      factor = Math.min(maxW / Math.max(1, naturalW), (640 / Math.max(0.03, state.scale)) / Math.max(1, naturalH)),
      w = Math.max(80, naturalW * factor),
      h = Math.max(80, naturalH * factor),
      x = Math.max(0, Math.min(SIZE - w, source.x)),
      y = Math.max(0, Math.min(SIZE - h, source.y + source.h + gap));
    return { x, y, w, h };
  }
  async function addGeneratedImageBelow(sourceBox, file, sourceName = "") {
    if (!sourceBox || state.images.length >= MAX_VISIBLE_IMAGES) return false;
    const prepared = await prepareImportedImage(file);
    recordImagesBefore();
    const item = imageRecord({
      id: `image-${state.nextImageId++}`,
      ...placementBelowBox(sourceBox, prepared.naturalW, prepared.naturalH),
      ...prepared,
      sourceName,
    });
    if (!item) return false;
    state.images.push(item);
    state.userRevision++;
    save();
    requestRender();
    return true;
  }
