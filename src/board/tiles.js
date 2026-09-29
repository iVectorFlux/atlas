// Canvas tiles, widgets, animations, rendering, navigation, and text editing.
  const objectChromeButtons = new Map();
  let nextObjectChromeStyleId = 1;
  function tile(tx, ty, create = true) {
    const k = key(tx, ty);
    if (!tiles.has(k) && create) {
      const c = document.createElement("canvas");
      c.width = c.height = TILE;
      c.getContext("2d", { willReadFrequently: true });
      tiles.set(k, c);
      state.inkBounds.set(k, null);
    }
    return tiles.get(k);
  }
  function retainSharpOverlay(image, box) {
    if (!image || !box) return;
    const pixels = image.width * image.height;
    if (!Number.isFinite(pixels) || pixels <= 0 || pixels > MAX_SHARP_OVERLAY_ITEM_PIXELS) return;
    const overlay = { image, box: { ...box }, pixels };
    state.sharpOverlays.push(overlay);
    state.sharpOverlayPixels += pixels;
    while (state.sharpOverlayPixels > MAX_SHARP_OVERLAY_PIXELS && state.sharpOverlays.length > 1) {
      const removed = state.sharpOverlays.shift();
      state.sharpOverlayPixels -= removed.pixels;
    }
  }
  function clearSharpOverlays() {
    state.sharpOverlays = [];
    state.sharpOverlayPixels = 0;
  }
  function invalidateSharpOverlays(box) {
    if (!box || !state.sharpOverlays.length) return;
    state.sharpOverlays = state.sharpOverlays.filter((overlay) => {
      if (!intersection(overlay.box, box)) return true;
      state.sharpOverlayPixels -= overlay.pixels;
      return false;
    });
    state.sharpOverlayPixels = Math.max(0, state.sharpOverlayPixels);
  }
  function drawSharpOverlays(context, region = null) {
    for (const overlay of state.sharpOverlays) {
      if (region && !intersection(overlay.box, region)) continue;
      context.drawImage(overlay.image, overlay.box.x, overlay.box.y, overlay.box.w, overlay.box.h);
    }
  }

  function textBoxBox(item) {
    return { x:item.x, y:item.y, w:item.w, h:item.h };
  }
  function textBoxHistoryRecord(item) {
    return {
      id:item.id,
      x:item.x,
      y:item.y,
      w:item.w,
      h:item.h,
      maxWidth:item.maxWidth,
      fontSize:item.fontSize,
      color:item.color,
      text:item.text,
      image:item.image,
    };
  }
  function storedTextBoxes() {
    return state.textBoxes.map(({ image, ...item }) => ({ ...item }));
  }
  function textBoxHistoryState() {
    return state.textBoxes.map(textBoxHistoryRecord);
  }
  function recordTextBoxesBefore() {
    if (!state.textBoxHistoryBefore) state.textBoxHistoryBefore = textBoxHistoryState();
  }
  function visibleTextBoxes(region = null) {
    return state.textBoxes.filter((item) => item.id !== state.selectedTextBoxId && (!region || intersection(textBoxBox(item), region)));
  }
  function textBoxBounds(region = null) {
    let bounds = null;
    for (const item of visibleTextBoxes(region)) bounds = unionLocalBounds(bounds, region ? intersection(textBoxBox(item), region) : textBoxBox(item));
    return bounds;
  }
  function drawTextBoxesToContext(context, region = null) {
    for (const item of visibleTextBoxes(region)) context.drawImage(item.image, item.x, item.y, item.w, item.h);
  }
  function textBoxAtPoint(point) {
    for (let index = state.textBoxes.length - 1; index >= 0; index--) {
      const item = state.textBoxes[index],
        box = textBoxBox(item);
      if (point.x >= box.x && point.x <= box.x + box.w && point.y >= box.y && point.y <= box.y + box.h) return item;
    }
    return null;
  }
  async function fittedTextBoxContent(text, fontSize, color, maxWidth) {
    const render = async () => {
      try {
        return { image:await mixedTextImage(text, fontSize, color, maxWidth, 1.35, state.aiFont || TEXT_EDITOR_FONT_FAMILY), mixedFallback:false };
      } catch {
        return { image:textImage(text, fontSize, color, maxWidth, 1.35, state.aiFont || TEXT_EDITOR_FONT_FAMILY, TEXT_INPUT_MAX_LENGTH), mixedFallback:true };
      }
    };
    maxWidth = Math.min(SIZE, Math.max(fontSize * 3, maxWidth));
    let result = await render(),
      width = result.image.logicalWidth || result.image.width,
      height = result.image.logicalHeight || result.image.height;
    for (let attempt = 0; attempt < 3 && (width > SIZE || height > SIZE); attempt++) {
      const scale = Math.min(SIZE / width, SIZE / height) * 0.995;
      fontSize = Math.max(1, fontSize * scale);
      maxWidth = Math.min(SIZE, Math.max(fontSize * 3, maxWidth * scale));
      result = await render();
      width = result.image.logicalWidth || result.image.width;
      height = result.image.logicalHeight || result.image.height;
    }
    return {
      ...result,
      fontSize,
      maxWidth,
      width:Math.min(SIZE, width),
      height:Math.min(SIZE, height),
    };
  }
  async function renderedTextBoxRecord(item) {
    if (!item || typeof item !== "object" || typeof item.text !== "string" || !item.text.trim() || item.text.length > TEXT_INPUT_MAX_LENGTH) return null;
    const x = Number(item.x),
      y = Number(item.y),
      fontSize = Number(item.fontSize),
      maxWidth = Number(item.maxWidth);
    if (![x, y, fontSize, maxWidth].every(Number.isFinite) || x < 0 || y < 0 || fontSize < 1 || fontSize > 2000 || maxWidth < fontSize * 3 || maxWidth > SIZE) return null;
    const color = item.color || state.inkColor,
      fitted = await fittedTextBoxContent(item.text, fontSize, color, maxWidth),
      width = fitted.width,
      height = fitted.height,
      fittedX = Math.max(0, Math.min(SIZE - width, x)),
      fittedY = Math.max(0, Math.min(SIZE - height, y));
    if (width <= 0 || height <= 0) return null;
    return {
      id:typeof item.id === "string" && /^text-box-\d+$/.test(item.id) ? item.id : `text-box-${state.nextTextBoxId++}`,
      x:fittedX,
      y:fittedY,
      w:width,
      h:height,
      maxWidth:fitted.maxWidth,
      fontSize:fitted.fontSize,
      color:typeof item.color === "string" ? item.color : color,
      text:item.text,
      image:fitted.image,
    };
  }
  async function restoreTextBoxes(items) {
    clearTextEditors();
    state.textBoxes = [];
    state.nextTextBoxId = 1;
    state.selectedTextBoxId = null;
    for (const item of Array.isArray(items) ? items.slice(0, MAX_VISIBLE_TEXT_BOXES) : []) {
      let record = null;
      if (item?.image) {
        record = textBoxHistoryRecord(item);
      } else record = await renderedTextBoxRecord(item);
      if (!record || state.textBoxes.some((existing) => existing.id === record.id)) continue;
      const numbered = /^text-box-(\d+)$/.exec(record.id);
      if (numbered) state.nextTextBoxId = Math.max(state.nextTextBoxId, Number(numbered[1]) + 1);
      state.textBoxes.push(record);
    }
    positionTextEditors();
    requestRender();
  }
