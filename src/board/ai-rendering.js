  function sharpRenderRatio() {
    return Math.min(3, Math.max(1, (devicePixelRatio || 1) * Math.max(1, state.scale)));
  }
  function rasterScaleFor(width, height, requested = 1) {
    return Math.min(Math.max(0.1, requested), 4096 / width, 4096 / height, Math.sqrt(12000000 / (width * height)));
  }

  function textRasterMetrics(text, f, maxWidth = 900, lineHeight = 1.35, family = state.aiFont, maxLength = AI_TEXT_MAX_LENGTH, pixelRatio = 1) {
    const content = text.slice(0, maxLength),
      fontFamily = family || "ui-rounded, system-ui, sans-serif";
    maxWidth = Math.max(f, Math.min(SIZE, maxWidth));
    const probe = offscreen(1, 1).getContext("2d");
    probe.font = `${f}px ${fontFamily}`;
    const layout = layoutText(content, probe, maxWidth),
      lines = layout.lines,
      widths = layout.widths,
      rowHeight = f * lineHeight,
      naturalWidth = Math.ceil(Math.min(maxWidth, Math.max(...widths)) + 8),
      naturalHeight = Math.ceil(lines.length * rowHeight + 8),
      rasterScale = rasterScaleFor(naturalWidth, naturalHeight, pixelRatio),
      rasterWidth=Math.max(1,Math.ceil(naturalWidth*rasterScale)),rasterHeight=Math.max(1,Math.ceil(naturalHeight*rasterScale));
    return{family:fontFamily,lines,widths,rowHeight,naturalWidth,naturalHeight,rasterScale,rasterWidth,rasterHeight,pixels:rasterWidth*rasterHeight};
  }
  function textImage(text, f, color, maxWidth = 900, lineHeight = 1.35, family = state.aiFont, maxLength = AI_TEXT_MAX_LENGTH, pixelRatio = 1) {
    const metrics=textRasterMetrics(text,f,maxWidth,lineHeight,family,maxLength,pixelRatio),
      {family:resolvedFamily,lines,widths,rowHeight,naturalWidth,naturalHeight,rasterScale,rasterWidth,rasterHeight}=metrics,
      image = offscreen(rasterWidth,rasterHeight),
      q = image.getContext("2d");
    q.font = `${f * rasterScale}px ${resolvedFamily}`;
    q.fillStyle = color || "#2563eb";
    q.textBaseline = "top";
    lines.forEach((value, i) => q.fillText(value, 2 * rasterScale, (2 + i * rowHeight) * rasterScale));
    image.revealRows = widths;
    image.revealRowHeight = rowHeight;
    image.naturalHeight = naturalHeight;
    image.naturalWidth = naturalWidth;
    image.logicalWidth = naturalWidth;
    image.logicalHeight = naturalHeight;
    return cropRasterToInk(image);
  }

  const SLIDE_FAMILY = "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', sans-serif";
  const SLIDE_KIND = {
    let: { label: "", pill: "", chip: "#dcfce7", chipInk: "#166534" },
    fact: { label: "", pill: "", chip: "#ffedd5", chipInk: "#9a3412" },
    example: { label: "Example", pill: "#f3e8ff", pillInk: "#6b21a8", chip: "#f3e8ff", chipInk: "#6b21a8" },
    problem: { label: "Problem", pill: "#ffedd5", pillInk: "#c2410c", chip: "#ffedd5", chipInk: "#9a3412" },
    question: { label: "Question", pill: "#dbeafe", pillInk: "#1d4ed8", chip: "#dbeafe", chipInk: "#1e40af" }
  };

  function slideWrap(ctx, text, maxWidth) {
    const words = String(text || "").split(/\s+/).filter(Boolean);
    const lines = [];
    let line = "";
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (ctx.measureText(next).width <= maxWidth) line = next;
      else {
        if (line) lines.push(line);
        line = word;
      }
    }
    if (line) lines.push(line);
    return lines.length ? lines : [""];
  }

  function lessonSlideImage(command, pixelRatio = 1) {
    const width = Math.max(900, Math.min(SIZE, Number(command.maxWidth) || 1680));
    const title = String(command.title || "").trim();
    const rows = Array.isArray(command.rows) && command.rows.length
      ? command.rows
      : String(command.text || "").split("\n").slice(title ? 1 : 0).filter(Boolean).map((text, i) => ({
        kind: i === 0 ? "let" : "fact",
        text,
        chips: []
      }));
    const padX = 56;
    const padY = 44;
    const titleSize = 44;
    const bodySize = 30;
    const pillSize = 22;
    const inner = width - padX * 2;
    const probe = offscreen(1, 1).getContext("2d");
    probe.font = `700 ${titleSize}px ${SLIDE_FAMILY}`;
    const titleLines = title ? slideWrap(probe, title, inner) : [];
    probe.font = `400 ${bodySize}px ${SLIDE_FAMILY}`;
    const layoutRows = rows.slice(0, 4).map((row) => {
      const kind = SLIDE_KIND[row.kind] || SLIDE_KIND.fact;
      const labelW = kind.label ? 118 : 0;
      const textWidth = inner - 36 - (labelW ? labelW + 16 : 0);
      return {
        kind,
        label: kind.label,
        chips: Array.isArray(row.chips) ? row.chips : [],
        lines: slideWrap(probe, String(row.text || "").replace(/^\s*[•?]\s*/, ""), textWidth)
      };
    });
    let height = padY;
    if (titleLines.length) height += titleLines.length * (titleSize * 1.15) + 22;
    for (const row of layoutRows) height += Math.max(44, row.lines.length * (bodySize * 1.38) + 18);
    height += padY;
    height = Math.max(220, Math.min(SIZE, Math.ceil(height)));
    const rasterScale = rasterScaleFor(width, height, pixelRatio);
    const image = offscreen(Math.max(1, Math.ceil(width * rasterScale)), Math.max(1, Math.ceil(height * rasterScale)));
    const q = image.getContext("2d");
    const s = rasterScale;
    q.scale(s, s);
    q.fillStyle = "#ffffff";
    q.fillRect(0, 0, width, height);
    q.strokeStyle = "rgba(60, 60, 67, 0.12)";
    q.lineWidth = 2;
    q.strokeRect(1, 1, width - 2, height - 2);
    let y = padY;
    q.fillStyle = "#1d1d1f";
    q.textBaseline = "top";
    q.font = `700 ${titleSize}px ${SLIDE_FAMILY}`;
    for (const line of titleLines) {
      q.fillText(line, padX, y);
      y += titleSize * 1.15;
    }
    if (titleLines.length) y += 18;
    for (const row of layoutRows) {
      const rowTop = y;
      q.fillStyle = "#86868b";
      q.beginPath();
      q.moveTo(padX, rowTop + 12);
      q.lineTo(padX + 10, rowTop + 18);
      q.lineTo(padX, rowTop + 24);
      q.closePath();
      q.fill();
      let textX = padX + 28;
      if (row.label) {
        q.font = `700 ${pillSize}px ${SLIDE_FAMILY}`;
        const pillW = Math.ceil(q.measureText(row.label).width) + 22;
        q.fillStyle = row.kind.pill;
        q.beginPath();
        if (q.roundRect) q.roundRect(textX, rowTop + 2, pillW, 28, 8);
        else q.rect(textX, rowTop + 2, pillW, 28);
        q.fill();
        q.fillStyle = row.kind.pillInk;
        q.fillText(row.label, textX + 11, rowTop + 5);
        textX += pillW + 14;
      }
      q.font = `400 ${bodySize}px ${SLIDE_FAMILY}`;
      for (let i = 0; i < row.lines.length; i++) {
        const line = row.lines[i];
        const lineY = rowTop + i * (bodySize * 1.38);
        const chips = i === 0 ? row.chips : [];
        for (const chip of chips) {
          const word = String(chip || "").trim();
          if (word.length < 3) continue;
          const idx = line.toLowerCase().indexOf(word.toLowerCase());
          if (idx < 0) continue;
          const before = line.slice(0, idx);
          const match = line.slice(idx, idx + word.length);
          const x0 = textX + q.measureText(before).width;
          const w0 = q.measureText(match).width + 10;
          q.fillStyle = row.kind.chip;
          q.beginPath();
          if (q.roundRect) q.roundRect(x0 - 5, lineY - 2, w0, bodySize + 8, 6);
          else q.rect(x0 - 5, lineY - 2, w0, bodySize + 8);
          q.fill();
        }
        q.fillStyle = "#1d1d1f";
        q.fillText(line, textX, lineY);
      }
      y = rowTop + Math.max(44, row.lines.length * (bodySize * 1.38) + 18);
    }
    image.revealRows = [width];
    image.revealRowHeight = height;
    image.naturalHeight = height;
    image.naturalWidth = width;
    image.logicalWidth = width;
    image.logicalHeight = height;
    return image;
  }
  function writeCommandImage(command, pixelRatio = 1) {
    if (command?.isLessonNote) return lessonSlideImage(command, pixelRatio);
    const text = String(command?.text || "");
    const lines = text.split(/\n+/).map((row) => row.replace(/^\s*[•\-\*]\s*/, "").trim()).filter(Boolean);
    const long = text.length > 160 || lines.length >= 3;
    if (long && lines.length) {
      const title = lines[0].slice(0, 90);
      const rest = lines.slice(1).length ? lines.slice(1) : text.split(/(?<=[.!?])\s+/).map((row) => row.trim()).filter((row) => row && row !== title);
      return lessonSlideImage({
        title,
        rows: rest.slice(0, 4).map((row, i) => ({
          kind: /\?$/.test(row) ? "question" : i === 0 ? "let" : "fact",
          text: row,
          chips: []
        })),
        maxWidth: command.maxWidth || 1680,
        text
      }, pixelRatio);
    }
    return textImage(command.text, command.fontSize, command.color, command.maxWidth, command.lineHeight, state.aiFont, AI_TEXT_MAX_LENGTH, pixelRatio);
  }
  function cropRasterToInk(image) {
    if (!image || typeof inkBox !== "function") return image;
    const box = inkBox(image);
    if (!box || box.w < 2 || box.h < 2) return image;
    const pad = 2;
    const x = Math.max(0, box.x - pad);
    const y = Math.max(0, box.y - pad);
    const w = Math.min(image.width - x, box.w + pad * 2);
    const h = Math.min(image.height - y, box.h + pad * 2);
    if (w >= image.width - 1 && h >= image.height - 1) return image;
    const cropped = offscreen(Math.max(1, Math.ceil(w)), Math.max(1, Math.ceil(h)));
    cropped.getContext("2d").drawImage(image, x, y, w, h, 0, 0, w, h);
    const scaleX = image.width / Math.max(1, image.logicalWidth || image.width);
    const scaleY = image.height / Math.max(1, image.logicalHeight || image.height);
    cropped.logicalWidth = w / scaleX;
    cropped.logicalHeight = h / scaleY;
    cropped.naturalWidth = cropped.logicalWidth;
    cropped.naturalHeight = cropped.logicalHeight;
    cropped.revealRows = [cropped.logicalWidth];
    cropped.revealRowHeight = cropped.logicalHeight;
    return cropped;
  }
  function layoutText(content, context, maxWidth) {
    const lines = [];
    for (const explicitLine of content.replace(/\r/g, "").split("\n")) {
      const parts = explicitLine.match(/\s+|\S+/g) || [""],
        wrapped = [];
      let line = "";
      const push = () => {
        wrapped.push(line);
        line = "";
      };
      for (const part of parts) {
        if (context.measureText(line + part).width <= maxWidth) {
          line += part;
          continue;
        }
        if (line) push();
        if (context.measureText(part).width <= maxWidth) {
          line = part;
          continue;
        }
        for (const char of Array.from(part)) {
          if (line && context.measureText(line + char).width > maxWidth) push();
          line += char;
        }
      }
      if (line || !wrapped.length) wrapped.push(line);
      lines.push(...wrapped);
    }
    return { lines, widths: lines.map((value) => Math.max(1, context.measureText(value).width)) };
  }
  function mixedTextFont(segment, fontSize, family) {
    const fontFamily = segment.code ? "ui-monospace, SFMono-Regular, Consolas, monospace" : family,
      fontStyle = segment.italic ? "italic" : "normal",
      fontWeight = segment.bold ? "700" : "400";
    return `${fontStyle} ${fontWeight} ${fontSize}px ${fontFamily}`;
  }
  function splitMixedTextPart(text, segment, fontSize, family, maxWidth, context) {
    const rendered = text.replace(/\t/g, "    "),
      font = mixedTextFont(segment, fontSize, family);
    context.font = font;
    if (context.measureText(rendered).width <= maxWidth) return [{ type: "text", text: rendered, font, fontSize, width: context.measureText(rendered).width }];
    const items = [];
    let chunk = "";
    for (const char of Array.from(rendered)) {
      if (chunk && context.measureText(chunk + char).width > maxWidth) {
        items.push({ type: "text", text: chunk, font, fontSize, width: context.measureText(chunk).width });
        chunk = "";
      }
      chunk += char;
    }
    if (chunk) items.push({ type: "text", text: chunk, font, fontSize, width: context.measureText(chunk).width });
    return items;
  }
  async function mixedTextImage(text, fontSize, color, maxWidth = 900, lineHeight = 1.35, family = state.aiFont, pixelRatio = sharpRenderRatio()) {
    if (!MIXED_TEXT?.parse) return textImage(text, fontSize, color, maxWidth, lineHeight, family, TEXT_INPUT_MAX_LENGTH, pixelRatio);
    const parsed = MIXED_TEXT.parse(text.slice(0, TEXT_INPUT_MAX_LENGTH)),
      resolvedFamily = family || "ui-rounded, system-ui, sans-serif",
      widthLimit = Math.max(fontSize * 3, Math.min(SIZE, maxWidth)),
      probe = offscreen(1, 1).getContext("2d"),
      formulaCache = new Map(),
      preparedLines = [];
    let formulaCount = 0;
    for (const line of parsed.lines) {
      const lineFontSize = Math.max(1, fontSize * (line.fontScale || 1)),
        segments = [];
      for (const segment of line.segments) {
        if (segment.type !== "math" || formulaCount >= 64 || segment.tex.length > MIXED_FORMULA_MAX_LENGTH) {
          segments.push(segment.type === "math" ? { ...segment, type: "text", text: segment.raw } : segment);
          continue;
        }
        formulaCount++;
        const cacheKey = `${lineFontSize}\n${color}\n${segment.tex}`;
        if (!formulaCache.has(cacheKey)) formulaCache.set(cacheKey, mathJaxImage(segment.tex, lineFontSize, color, pixelRatio));
        const formula = await formulaCache.get(cacheKey);
        if (formula.image) segments.push({ type: "math", image: formula.image, raw: segment.raw });
        else segments.push({ ...segment, type: "text", text: segment.raw });
      }
      preparedLines.push({ ...line, lineFontSize, segments });
    }
    const rows = [];
    for (const line of preparedLines) {
      const defaultHeight = line.lineFontSize * lineHeight;
      let row = { items: [], width: 0, height: defaultHeight };
      const finishRow = () => {
        rows.push(row);
        row = { items: [], width: 0, height: defaultHeight };
      };
      const addItem = (item) => {
        if (row.items.length && row.width + item.width > widthLimit) finishRow();
        item.x = row.width;
        row.items.push(item);
        row.width += item.width;
        row.height = Math.max(row.height, item.height || item.fontSize * lineHeight);
      };
      for (const segment of line.segments) {
        if (segment.type === "math") {
          const sourceWidth = segment.image.logicalWidth || segment.image.width,
            sourceHeight = segment.image.logicalHeight || segment.image.height,
            scale = Math.min(1, widthLimit / Math.max(1, sourceWidth));
          addItem({ type: "math", image: segment.image, width: sourceWidth * scale, height: sourceHeight * scale });
          continue;
        }
        const parts = segment.text.match(/\s+|\S+/g) || [];
        for (const part of parts) {
          const items = splitMixedTextPart(part, segment, line.lineFontSize, resolvedFamily, widthLimit, probe);
          items.forEach(addItem);
        }
      }
      finishRow();
    }
    const padding = Math.max(2, fontSize * 0.12),
      contentWidth = Math.max(1, ...rows.map((row) => row.width)),
      naturalWidth = Math.ceil(Math.min(widthLimit, contentWidth) + padding * 2),
      naturalHeight = Math.ceil(rows.reduce((sum, row) => sum + row.height, 0) + padding * 2),
      rasterScale = rasterScaleFor(naturalWidth, naturalHeight, pixelRatio),
      rasterWidth = Math.max(1, Math.ceil(naturalWidth * rasterScale)),
      rasterHeight = Math.max(1, Math.ceil(naturalHeight * rasterScale)),
      image = offscreen(rasterWidth, rasterHeight),
      context = image.getContext("2d");
    context.setTransform(rasterScale, 0, 0, rasterScale, 0, 0);
    context.fillStyle = color || "#2563eb";
    context.textBaseline = "top";
    let y = padding;
    for (const row of rows) {
      for (const item of row.items) {
        const x = padding + item.x;
        if (item.type === "math") context.drawImage(item.image, x, y + (row.height - item.height) / 2, item.width, item.height);
        else {
          context.font = item.font;
          context.fillText(item.text, x, y + (row.height - item.fontSize) / 2);
        }
      }
      y += row.height;
    }
    image.logicalWidth = naturalWidth;
    image.logicalHeight = naturalHeight;
    image.revealRows = rows.map((row) => Math.max(1, row.width));
    image.revealRowHeight = naturalHeight / Math.max(1, rows.length);
    return image;
  }
  async function mathJaxImage(latex, fontSize, color, pixelRatio = sharpRenderRatio()) {
    if (!window.MathJax?.tex2svgPromise) return { image: null, error: Error("MathJax unavailable") };
    try {
      const node = await window.MathJax.tex2svgPromise(latex, {
        display: false,
        containerWidth: SIZE,
      });
      if (node.querySelector('[data-mml-node="merror"], mjx-merror')) throw Error("Invalid MathJax input");
      const svg = node.querySelector("svg");
      if (!svg) throw Error("No MathJax SVG");
      const viewBox = (svg.getAttribute("viewBox") || "").trim().split(/\s+/).map(Number),
        ratio = viewBox.length === 4 && viewBox[2] > 0 && viewBox[3] > 0 ? viewBox[2] / viewBox[3] : Math.max(0.7, latex.length * 0.65),
        logicalHeight = Math.max(1, Math.ceil(fontSize * 1.35)),
        logicalWidth = Math.max(1, Math.ceil(logicalHeight * ratio)),
        rasterScale = rasterScaleFor(logicalWidth, logicalHeight, pixelRatio),
        rasterWidth = Math.max(1, Math.ceil(logicalWidth * rasterScale)),
        rasterHeight = Math.max(1, Math.ceil(logicalHeight * rasterScale));
      svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      svg.setAttribute("width", String(rasterWidth));
      svg.setAttribute("height", String(rasterHeight));
      svg.setAttribute("color", color || "#2563eb");
      svg.setAttribute("fill", "currentColor");
      const xml = new XMLSerializer().serializeToString(svg),
        img = new Image(),
        url = URL.createObjectURL(new Blob([xml], { type: "image/svg+xml" }));
      try {
        img.src = url;
        await img.decode();
        const image = offscreen(rasterWidth, rasterHeight);
        image.getContext("2d").drawImage(img, 0, 0, rasterWidth, rasterHeight);
        image.logicalWidth = logicalWidth;
        image.logicalHeight = logicalHeight;
        image.revealRows = [logicalWidth];
        image.revealRowHeight = logicalHeight;
        return { image, error: null };
      } finally {
        URL.revokeObjectURL(url);
      }
    } catch (error) {
      return { image: null, error };
    }
  }
  async function formulaImage(latex, fontSize, color, family = state.aiFont, pixelRatio = sharpRenderRatio()) {
    const rendered = await mathJaxImage(latex, fontSize, color, pixelRatio);
    if (rendered.image) return rendered.image;
    console.warn("MathJax formula fallback", rendered.error);
    return textImage(formulaText(latex), fontSize, color, 900, 1.35, family, AI_TEXT_MAX_LENGTH, pixelRatio);
  }
  function formulaText(s) {
    return s.replace(/\\frac\{([^}]*)\}\{([^}]*)\}/g, "($1)/($2)").replace(/[\\{}]/g, "");
  }
  async function reveal(im, x, y, revision, duration = 1200) {
    const imageWidth = im.logicalWidth || im.width,
      imageHeight = im.logicalHeight || im.height,
      rows = im.revealRows || [imageWidth],
      rowHeight = im.revealRowHeight || imageHeight,
      total = rows.reduce((sum, width) => sum + width, 0),
      steps = Math.max(28, Math.min(180, Math.ceil(duration / 28)));
    for (let i = 1; i <= steps; i++) {
      checkAI(revision);
      const distance = (total * i) / steps;
      let consumed = 0,
        current = 0,
        currentWidth = 0;
      while (current < rows.length && consumed + rows[current] < distance) {
        consumed += rows[current];
        current++;
      }
      if (current < rows.length) currentWidth = Math.max(0, distance - consumed);
      render();
      ctx.save();
      ctx.translate(state.panX, state.panY);
      ctx.scale(state.scale, state.scale);
      ctx.beginPath();
      for (let row = 0; row < current; row++) ctx.rect(x, y + row * rowHeight, imageWidth, rowHeight);
      if (current < rows.length) ctx.rect(x, y + current * rowHeight, currentWidth, rowHeight);
      ctx.clip();
      ctx.drawImage(im, x, y, imageWidth, imageHeight);
      ctx.restore();
      await wait(duration / steps);
    }
    checkAI(revision);
    blitSized(im, x, y, imageWidth, imageHeight);
    render();
  }
  function blit(im, x, y, scale = 1) {
    blitStretched(im, x, y, scale, scale);
  }
  function blitStretched(im, x, y, scaleX, scaleY) {
    blitSized(im, x, y, im.width * scaleX, im.height * scaleY);
  }
  function blitSized(im, x, y, w, h) {
    const x0 = Math.max(0, Math.floor(x / TILE)),
      y0 = Math.max(0, Math.floor(y / TILE)),
      x1 = Math.min(Math.ceil(SIZE / TILE) - 1, Math.ceil((x + w) / TILE) - 1),
      y1 = Math.min(Math.ceil(SIZE / TILE) - 1, Math.ceil((y + h) / TILE) - 1);
    for (let ty = y0; ty <= y1; ty++)
      for (let tx = x0; tx <= x1; tx++) {
        recordBefore(tx, ty);
        const t = tile(tx, ty);
        t.getContext("2d").drawImage(im, x - tx * TILE, y - ty * TILE, w, h);
        const local = intersection({ x: x - tx * TILE, y: y - ty * TILE, w, h }, { x: 0, y: 0, w: TILE, h: TILE });
        if (local) extendInkBounds(key(tx, ty), local);
      }
  }
  function blitClipped(im, x, y, w, h, clipW, clipH) {
    forTiles(x, y, clipW, clipH, (canvas, tx, ty) => {
      recordBefore(tx, ty);
      const tileContext = canvas.getContext("2d"),
        local = intersection({ x: x - tx * TILE, y: y - ty * TILE, w: clipW, h: clipH }, { x: 0, y: 0, w: TILE, h: TILE });
      if (!local) return;
      tileContext.save();
      tileContext.beginPath();
      tileContext.rect(local.x, local.y, local.w, local.h);
      tileContext.clip();
      tileContext.drawImage(im, x - tx * TILE, y - ty * TILE, w, h);
      tileContext.restore();
      extendInkBounds(key(tx, ty), local);
    });
  }
