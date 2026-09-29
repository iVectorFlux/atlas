// Atlas Canvas Engine - Bundled by scripts/build-web.js
"use strict";
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.LUMI6_DRAW = api;
})(typeof globalThis === "object" ? globalThis : this, function () {
  const TYPES = new Set(["line", "smooth", "rect", "ellipse", "circle", "arc"]),
    MAX_ITEMS = 64,
    MAX_VALUES = 2048,
    MAX_RASTER_PIXELS = 12000000,
    MAX_RASTER_SIDE = 4096;

  const integer = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;
  const copyPoint = (point) => ({ x: point.x, y: point.y });
  const includePoint = (bounds, point) => {
    bounds.left = Math.min(bounds.left, point.x);
    bounds.top = Math.min(bounds.top, point.y);
    bounds.right = Math.max(bounds.right, point.x);
    bounds.bottom = Math.max(bounds.bottom, point.y);
  };
  const flatPoints = (values, origin) => {
    const points = [];
    for (let index = 0; index < values.length; index += 2) points.push({ x: origin[0] + values[index], y: origin[1] + values[index + 1] });
    return points;
  };
  const cubicAt = (start, control1, control2, end, t) => {
    const inverse = 1 - t;
    return inverse ** 3 * start + 3 * inverse ** 2 * t * control1 + 3 * inverse * t ** 2 * control2 + t ** 3 * end;
  };
  function cubicExtrema(start, control1, control2, end) {
    const a = -start + 3 * control1 - 3 * control2 + end,
      b = 2 * (start - 2 * control1 + control2),
      c = control1 - start,
      roots = [];
    if (Math.abs(a) < 1e-9) {
      if (Math.abs(b) >= 1e-9) roots.push(-c / b);
    } else {
      const discriminant = b * b - 4 * a * c;
      if (discriminant >= 0) {
        const root = Math.sqrt(discriminant);
        roots.push((-b + root) / (2 * a), (-b - root) / (2 * a));
      }
    }
    return roots.filter((value) => value > 0 && value < 1);
  }
  function includeCubic(bounds, segment) {
    includePoint(bounds, segment.from);
    includePoint(bounds, segment.to);
    const values = new Set([
      ...cubicExtrema(segment.from.x, segment.c1.x, segment.c2.x, segment.to.x),
      ...cubicExtrema(segment.from.y, segment.c1.y, segment.c2.y, segment.to.y),
    ]);
    for (const t of values) {
      includePoint(bounds, {
        x: cubicAt(segment.from.x, segment.c1.x, segment.c2.x, segment.to.x, t),
        y: cubicAt(segment.from.y, segment.c1.y, segment.c2.y, segment.to.y, t),
      });
    }
  }
  const TAU = Math.PI * 2;
  const normalizeAngle = (angle) => ((angle % TAU) + TAU) % TAU;
  function angleOnSweep(angle, start, sweep) {
    if (Math.abs(sweep) >= TAU) return true;
    const distance = sweep > 0 ? normalizeAngle(angle - start) : normalizeAngle(start - angle);
    return distance <= Math.abs(sweep) + 1e-9;
  }
  function includeArc(bounds, primitive) {
    if (Math.abs(primitive.sweep) >= TAU) {
      includePoint(bounds, { x: primitive.cx - primitive.rx, y: primitive.cy - primitive.ry });
      includePoint(bounds, { x: primitive.cx + primitive.rx, y: primitive.cy + primitive.ry });
      return;
    }
    const angles = [primitive.start, primitive.start + primitive.sweep, 0, Math.PI / 2, Math.PI, Math.PI * 1.5];
    for (const angle of angles) {
      if (!angleOnSweep(angle, primitive.start, primitive.sweep)) continue;
      includePoint(bounds, { x: primitive.cx + primitive.rx * Math.cos(angle), y: primitive.cy + primitive.ry * Math.sin(angle) });
    }
  }
  function smoothSegments(points, closed, tension) {
    if (points.length < 3) return [];
    const segments = [], count = closed ? points.length : points.length - 1, strength = tension / 50 / 6;
    for (let index = 0; index < count; index++) {
      const p1 = points[index],
        p2 = points[(index + 1) % points.length],
        p0 = closed ? points[(index - 1 + points.length) % points.length] : points[Math.max(0, index - 1)],
        p3 = closed ? points[(index + 2) % points.length] : points[Math.min(points.length - 1, index + 2)],
        c1 = { x: p1.x + (p2.x - p0.x) * strength, y: p1.y + (p2.y - p0.y) * strength },
        c2 = { x: p2.x - (p3.x - p1.x) * strength, y: p2.y - (p3.y - p1.y) * strength };
      segments.push({ from: p1, c1, c2, to: p2 });
    }
    return segments;
  }
  function arrowGeometry(end, tangentFrom, width) {
    const angle = Math.atan2(end.y - tangentFrom.y, end.x - tangentFrom.x), size = Math.max(18, width * 2.2), spread = 0.52;
    return [
      copyPoint(end),
      { x: end.x - size * Math.cos(angle - spread), y: end.y - size * Math.sin(angle - spread) },
      { x: end.x - size * Math.cos(angle + spread), y: end.y - size * Math.sin(angle + spread) },
    ];
  }
  function terminalTangentFrom(primitive) {
    const end = primitive.points.at(-1), candidates = [];
    if (primitive.segments.length) {
      for (let index = primitive.segments.length - 1; index >= 0; index--) {
        const segment = primitive.segments[index];
        candidates.push(segment.c2, segment.c1, segment.from);
      }
    } else {
      for (let index = primitive.points.length - 2; index >= 0; index--) candidates.push(primitive.points[index]);
    }
    return candidates.find((point) => Math.hypot(end.x - point.x, end.y - point.y) > 1e-6) || null;
  }
  function indexSet(value, count) {
    if (value === undefined) return new Set();
    if (!Array.isArray(value) || value.length > count) return null;
    const result = new Set();
    for (const index of value) {
      if (!integer(index, 0, count - 1) || result.has(index)) return null;
      result.add(index);
    }
    return result;
  }
  function normalize(command, canvasSize = 20000) {
    if (!command || typeof command !== "object" || !Array.isArray(command.origin) || command.origin.length !== 2 || !command.origin.every((value) => integer(value, 0, canvasSize))) return null;
    if (!Array.isArray(command.types) || !Array.isArray(command.items) || !command.types.length || command.types.length !== command.items.length || command.types.length > MAX_ITEMS) return null;
    const width = command.width === undefined ? 30 : command.width,
      tension = command.tension === undefined ? 50 : command.tension;
    if (!integer(width, 2, 200) || !integer(tension, 0, 100)) return null;
    const closed = indexSet(command.closed, command.items.length),
      fill = indexSet(command.fill, command.items.length),
      arrows = indexSet(command.arrows, command.items.length);
    if (!closed || !fill || !arrows) return null;
    const bounds = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity }, primitives = [];
    let valueCount = 0;
    for (let index = 0; index < command.items.length; index++) {
      const type = command.types[index], item = command.items[index];
      if (!TYPES.has(type) || !Array.isArray(item) || !item.every((value) => integer(value, -canvasSize, canvasSize))) return null;
      valueCount += item.length;
      if (valueCount > MAX_VALUES) return null;
      const primitive = { type, closed: closed.has(index), fill: fill.has(index), arrow: arrows.has(index) };
      if (type === "line" || type === "smooth") {
        if (item.length < 4 || item.length % 2 || item.length > 512) return null;
        primitive.points = flatPoints(item, command.origin);
        if (primitive.closed && primitive.points.length < 3) return null;
        primitive.segments = type === "smooth" ? smoothSegments(primitive.points, primitive.closed, tension) : [];
        if (primitive.segments.length) primitive.segments.forEach((segment) => includeCubic(bounds, segment));
        else primitive.points.forEach((point) => includePoint(bounds, point));
        if (primitive.fill && !primitive.closed) return null;
        if (primitive.arrow && primitive.closed) return null;
        if (primitive.arrow) {
          const end = primitive.points.at(-1),
            tangentFrom = terminalTangentFrom(primitive);
          if (!tangentFrom) return null;
          primitive.arrowPoints = arrowGeometry(end, tangentFrom, width);
          primitive.arrowPoints.forEach((point) => includePoint(bounds, point));
        }
      } else if (type === "rect") {
        if (item.length !== 4 || !integer(item[2], 1, canvasSize) || !integer(item[3], 1, canvasSize) || primitive.closed || primitive.arrow) return null;
        primitive.x = command.origin[0] + item[0];
        primitive.y = command.origin[1] + item[1];
        primitive.w = item[2];
        primitive.h = item[3];
        includePoint(bounds, { x: primitive.x, y: primitive.y });
        includePoint(bounds, { x: primitive.x + primitive.w, y: primitive.y + primitive.h });
      } else if (type === "ellipse") {
        if (item.length !== 4 || !integer(item[2], 1, canvasSize) || !integer(item[3], 1, canvasSize) || primitive.closed || primitive.arrow) return null;
        primitive.cx = command.origin[0] + item[0];
        primitive.cy = command.origin[1] + item[1];
        primitive.rx = item[2];
        primitive.ry = item[3];
        includePoint(bounds, { x: primitive.cx - primitive.rx, y: primitive.cy - primitive.ry });
        includePoint(bounds, { x: primitive.cx + primitive.rx, y: primitive.cy + primitive.ry });
      } else if (type === "circle") {
        if (item.length !== 3 || !integer(item[2], 1, canvasSize) || primitive.closed || primitive.arrow) return null;
        primitive.cx = command.origin[0] + item[0];
        primitive.cy = command.origin[1] + item[1];
        primitive.rx = primitive.ry = item[2];
        includePoint(bounds, { x: primitive.cx - primitive.rx, y: primitive.cy - primitive.ry });
        includePoint(bounds, { x: primitive.cx + primitive.rx, y: primitive.cy + primitive.ry });
      } else {
        if (item.length !== 6 || !integer(item[2], 1, canvasSize) || !integer(item[3], 1, canvasSize) || !integer(item[4], -3600, 3600) || !integer(item[5], -3600, 3600) || item[5] === 0 || primitive.closed || primitive.fill) return null;
        primitive.cx = command.origin[0] + item[0];
        primitive.cy = command.origin[1] + item[1];
        primitive.rx = item[2];
        primitive.ry = item[3];
        primitive.start = (item[4] * Math.PI) / 180;
        primitive.sweep = (item[5] * Math.PI) / 180;
        includeArc(bounds, primitive);
        if (primitive.arrow) {
          const endAngle = primitive.start + primitive.sweep,
            end = { x: primitive.cx + primitive.rx * Math.cos(endAngle), y: primitive.cy + primitive.ry * Math.sin(endAngle) },
            direction = primitive.sweep > 0 ? 1 : -1,
            tangentFrom = { x: end.x + direction * primitive.rx * Math.sin(endAngle) * 0.1, y: end.y - direction * primitive.ry * Math.cos(endAngle) * 0.1 };
          primitive.arrowPoints = arrowGeometry(end, tangentFrom, width);
          primitive.arrowPoints.forEach((point) => includePoint(bounds, point));
        }
      }
      primitives.push(primitive);
    }
    if (bounds.left < 0 || bounds.top < 0 || bounds.right > canvasSize || bounds.bottom > canvasSize) return null;
    const pad = Math.ceil(width / 2 + 4),
      imageBounds = {
        x: Math.max(0, Math.floor(bounds.left - pad)),
        y: Math.max(0, Math.floor(bounds.top - pad)),
        right: Math.min(canvasSize, Math.ceil(bounds.right + pad)),
        bottom: Math.min(canvasSize, Math.ceil(bounds.bottom + pad)),
      };
    imageBounds.w = Math.max(1, imageBounds.right - imageBounds.x);
    imageBounds.h = Math.max(1, imageBounds.bottom - imageBounds.y);
    return {
      tool: "draw",
      origin: [...command.origin],
      types: [...command.types],
      items: command.items.map((item) => [...item]),
      closed: [...closed].sort((a, b) => a - b),
      fill: [...fill].sort((a, b) => a - b),
      arrows: [...arrows].sort((a, b) => a - b),
      width,
      tension,
      x: imageBounds.x,
      y: imageBounds.y,
      _draw: { primitives, bounds: imageBounds },
    };
  }
  function trace(context, primitive) {
    if (primitive.type === "line") {
      context.moveTo(primitive.points[0].x, primitive.points[0].y);
      for (const point of primitive.points.slice(1)) context.lineTo(point.x, point.y);
      if (primitive.closed) context.closePath();
    } else if (primitive.type === "smooth") {
      context.moveTo(primitive.points[0].x, primitive.points[0].y);
      if (primitive.segments.length) for (const segment of primitive.segments) context.bezierCurveTo(segment.c1.x, segment.c1.y, segment.c2.x, segment.c2.y, segment.to.x, segment.to.y);
      else context.lineTo(primitive.points[1].x, primitive.points[1].y);
      if (primitive.closed) context.closePath();
    } else if (primitive.type === "rect") context.rect(primitive.x, primitive.y, primitive.w, primitive.h);
    else if (primitive.type === "circle" || primitive.type === "ellipse") context.ellipse(primitive.cx, primitive.cy, primitive.rx, primitive.ry, 0, 0, Math.PI * 2);
    else context.ellipse(primitive.cx, primitive.cy, primitive.rx, primitive.ry, 0, primitive.start, primitive.start + primitive.sweep, primitive.sweep < 0);
  }
  function render(command, createCanvas, color = "#2563eb") {
    const prepared = command?._draw ? command : normalize(command);
    if (!prepared) return null;
    const bounds = prepared._draw.bounds,
      logicalWidth = bounds.w,
      logicalHeight = bounds.h,
      rasterScale = Math.min(1, MAX_RASTER_SIDE / logicalWidth, MAX_RASTER_SIDE / logicalHeight, Math.sqrt(MAX_RASTER_PIXELS / (logicalWidth * logicalHeight))),
      rasterWidth = Math.max(1, Math.floor(logicalWidth * rasterScale)),
      rasterHeight = Math.max(1, Math.floor(logicalHeight * rasterScale)),
      scaleX = rasterWidth / logicalWidth,
      scaleY = rasterHeight / logicalHeight,
      image = createCanvas(rasterWidth, rasterHeight),
      context = image.getContext("2d");
    context.setTransform(scaleX, 0, 0, scaleY, -bounds.x * scaleX, -bounds.y * scaleY);
    context.strokeStyle = color;
    context.fillStyle = color;
    context.lineWidth = prepared.width;
    context.lineCap = context.lineJoin = "round";
    for (const primitive of prepared._draw.primitives) {
      context.beginPath();
      trace(context, primitive);
      if (primitive.fill) {
        context.save();
        context.globalAlpha = 0.14;
        context.fill();
        context.restore();
      }
      context.stroke();
      if (primitive.arrowPoints) {
        context.beginPath();
        context.moveTo(primitive.arrowPoints[0].x, primitive.arrowPoints[0].y);
        context.lineTo(primitive.arrowPoints[1].x, primitive.arrowPoints[1].y);
        context.lineTo(primitive.arrowPoints[2].x, primitive.arrowPoints[2].y);
        context.closePath();
        context.fill();
      }
    }
    image.logicalWidth = logicalWidth;
    image.logicalHeight = logicalHeight;
    image.revealRows = [logicalWidth];
    image.revealRowHeight = logicalHeight;
    return { image, x: bounds.x, y: bounds.y };
  }
  return {
    normalize,
    render,
    smoothSegments,
  };
});
"use strict";
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.LUMI6_SELECTION = api;
})(typeof globalThis === "object" ? globalThis : this, function () {
  function clipPoint(point, limit) {
    return { x: Math.max(0, Math.min(limit, point.x)), y: Math.max(0, Math.min(limit, point.y)) };
  }

  function polygonBounds(points, limit) {
    if (!points.length) return null;
    let left = limit,
      top = limit,
      right = 0,
      bottom = 0;
    for (const point of points) {
      left = Math.min(left, point.x);
      top = Math.min(top, point.y);
      right = Math.max(right, point.x);
      bottom = Math.max(bottom, point.y);
    }
    left = Math.max(0, Math.floor(left));
    top = Math.max(0, Math.floor(top));
    right = Math.min(limit, Math.ceil(right));
    bottom = Math.min(limit, Math.ceil(bottom));
    return { x: left, y: top, w: Math.max(0, right - left), h: Math.max(0, bottom - top) };
  }

  function pathLength(points, scale = 1) {
    let length = 0;
    for (let index = 1; index < points.length; index++) length += Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y) * scale;
    return length;
  }

  function shouldAddPoint(points, point, minimumDistance) {
    const last = points.at(-1);
    return !last || Math.hypot(point.x - last.x, point.y - last.y) >= minimumDistance;
  }

  function pointInPolygon(point, polygon) {
    if (!Array.isArray(polygon) || polygon.length < 3) return false;
    let inside = false;
    for (let current = 0, previous = polygon.length - 1; current < polygon.length; previous = current++) {
      const a = polygon[current],
        b = polygon[previous],
        crosses = a.y > point.y !== b.y > point.y && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
      if (crosses) inside = !inside;
    }
    return inside;
  }

  function pointSegmentDistance(point, start, end) {
    const dx = end.x - start.x,
      dy = end.y - start.y,
      lengthSquared = dx * dx + dy * dy;
    if (!lengthSquared) return Math.hypot(point.x - start.x, point.y - start.y);
    const ratio = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared)),
      x = start.x + ratio * dx,
      y = start.y + ratio * dy;
    return Math.hypot(point.x - x, point.y - y);
  }

  function pointNearPath(point, path, tolerance) {
    if (!Array.isArray(path) || path.length < 2) return false;
    for (let index = 0; index < path.length; index++) {
      const next = path[(index + 1) % path.length];
      if (pointSegmentDistance(point, path[index], next) <= tolerance) return true;
    }
    return false;
  }

  function validBox(box) {
    return Boolean(box)
      && Number.isFinite(box.x)
      && Number.isFinite(box.y)
      && Number.isFinite(box.w)
      && Number.isFinite(box.h);
  }

  function unionBox(current, next) {
    if (!validBox(next)) return validBox(current) ? { x: current.x, y: current.y, w: current.w, h: current.h } : null;
    if (!validBox(current)) return { x: next.x, y: next.y, w: next.w, h: next.h };
    const x = Math.min(current.x, next.x),
      y = Math.min(current.y, next.y),
      right = Math.max(current.x + current.w, next.x + next.w),
      bottom = Math.max(current.y + current.h, next.y + next.h);
    return { x, y, w: right - x, h: bottom - y };
  }

  function moveBox(box, dx, dy, limit) {
    if (!box || !Number.isFinite(box.w) || !Number.isFinite(box.h) || box.w <= 0 || box.h <= 0) return { ...box };
    return {
      ...box,
      x: Math.max(0, Math.min(limit - box.w, box.x + dx)),
      y: Math.max(0, Math.min(limit - box.h, box.y + dy)),
    };
  }

  function resizeBox(box, point, minimum, limit) {
    if (!box || !Number.isFinite(box.w) || !Number.isFinite(box.h) || box.w <= 0 || box.h <= 0) return { ...box };
    const maximumScale = Math.max(Number.EPSILON, Math.min((limit - box.x) / box.w, (limit - box.y) / box.h)),
      minimumScale = Math.min(maximumScale, Math.max(minimum / box.w, minimum / box.h)),
      requestedScale = Math.max((point.x - box.x) / box.w, (point.y - box.y) / box.h),
      scale = Math.max(minimumScale, Math.min(maximumScale, requestedScale));
    return { ...box, w: box.w * scale, h: box.h * scale };
  }

  function resizeBoxAxis(box, point, axis, minimum, limit) {
    if (!box || !Number.isFinite(box.w) || !Number.isFinite(box.h) || box.w <= 0 || box.h <= 0) return { ...box };
    if (axis === "width") {
      const maximum = Math.max(minimum, limit - box.x);
      return { ...box, w: Math.max(Math.min(maximum, point.x - box.x), Math.min(minimum, maximum)) };
    }
    if (axis === "height") {
      const maximum = Math.max(minimum, limit - box.y);
      return { ...box, h: Math.max(Math.min(maximum, point.y - box.y), Math.min(minimum, maximum)) };
    }
    return resizeBox(box, point, minimum, limit);
  }

  function mapPoint(point, sourceBox, targetBox) {
    const scaleX = sourceBox?.w > 0 ? targetBox.w / sourceBox.w : 1,
      scaleY = sourceBox?.h > 0 ? targetBox.h / sourceBox.h : 1;
    return {
      x: targetBox.x + (point.x - sourceBox.x) * scaleX,
      y: targetBox.y + (point.y - sourceBox.y) * scaleY,
    };
  }

  function mapPath(path, sourceBox, targetBox) {
    if (!Array.isArray(path)) return [];
    return path.map((point) => mapPoint(point, sourceBox, targetBox));
  }

  function mapFragment(fragment, sourceBox, targetBox) {
    const scaleX = sourceBox?.w > 0 ? targetBox.w / sourceBox.w : 1,
      scaleY = sourceBox?.h > 0 ? targetBox.h / sourceBox.h : 1;
    return {
      x: targetBox.x + (fragment.x - sourceBox.x) * scaleX,
      y: targetBox.y + (fragment.y - sourceBox.y) * scaleY,
      w: fragment.w * scaleX,
      h: fragment.h * scaleY,
    };
  }

  function controlPoints(box, size) {
    return {
      cancel: { x: box.x - size * 0.42, y: box.y - size * 0.42 },
      accept: { x: box.x + box.w + size * 0.42, y: box.y - size * 0.42 },
      move: { x: box.x + box.w / 2, y: box.y - size * 0.46 },
      resize: { x: box.x + box.w, y: box.y + box.h },
      width: { x: box.x + box.w, y: box.y + box.h / 2 },
      height: { x: box.x + box.w / 2, y: box.y + box.h },
    };
  }

  function hitTest(box, point, size, includeActions = true) {
    const controls = controlPoints(box, size),
      radius = Math.max(size * 0.8, 1);
    const actions = includeActions ? ["cancel", "accept", "resize", "width", "height", "move"] : ["resize", "width", "height"];
    for (const action of actions)
      if (Math.hypot(point.x - controls[action].x, point.y - controls[action].y) <= radius) return action;
    return point.x >= box.x && point.x <= box.x + box.w && point.y >= box.y && point.y <= box.y + box.h ? "move" : null;
  }

  function hitTestPath(path, box, point, size, includeActions = true) {
    if (!box || !Number.isFinite(box.x) || !Number.isFinite(box.y) || box.w <= 0 || box.h <= 0) return null;
    const controls = controlPoints(box, size),
      radius = Math.max(Number.isFinite(size) ? size * 0.8 : 1, 1),
      right = box.x + box.w,
      bottom = box.y + box.h;
    const actions = includeActions ? ["cancel", "accept", "resize", "width", "height", "move"] : ["resize", "width", "height"];
    for (const action of actions)
      if (Math.hypot(point.x - controls[action].x, point.y - controls[action].y) <= radius) return action;
    if (!includeActions) {
      if (Math.abs(point.x - right) <= radius && point.y >= box.y - radius && point.y <= bottom + radius) return "width";
      if (Math.abs(point.y - bottom) <= radius && point.x >= box.x - radius && point.x <= right + radius) return "height";
    }
    return pointInPolygon(point, path) || pointNearPath(point, path, radius) ? "move" : null;
  }

  return {
    clipPoint,
    polygonBounds,
    pathLength,
    shouldAddPoint,
    pointInPolygon,
    pointNearPath,
    unionBox,
    validBox,
    moveBox,
    resizeBox,
    resizeBoxAxis,
    mapPoint,
    mapPath,
    mapFragment,
    controlPoints,
    hitTest,
    hitTestPath,
  };
});
"use strict";
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.LUMI6_MIXED_TEXT = api;
})(typeof globalThis === "object" ? globalThis : this, function () {
  const NAMED_TEX_COMMANDS = new Set([
    "alpha", "beta", "gamma", "delta", "epsilon", "varepsilon", "zeta", "eta", "theta", "vartheta", "iota", "kappa", "lambda", "mu", "nu", "xi", "pi", "varpi", "rho", "varrho", "sigma", "tau", "upsilon", "phi", "varphi", "chi", "psi", "omega",
    "Gamma", "Delta", "Theta", "Lambda", "Xi", "Pi", "Sigma", "Upsilon", "Phi", "Psi", "Omega",
    "sum", "prod", "coprod", "int", "iint", "iiint", "oint", "lim", "sin", "cos", "tan", "cot", "sec", "csc", "arcsin", "arccos", "arctan", "log", "ln", "exp", "min", "max", "det",
    "infty", "partial", "nabla", "forall", "exists", "neg", "pm", "mp", "times", "div", "cdot", "le", "leq", "ge", "geq", "ne", "neq", "approx", "equiv", "to", "rightarrow", "leftarrow", "Rightarrow", "Leftarrow", "leftrightarrow",
    "vec", "hat", "bar", "overline", "underline", "dot", "ddot", "mathbf", "mathrm", "mathit", "mathbb", "mathcal", "operatorname", "text",
  ]);

  function isEscaped(source, index) {
    let slashes = 0;
    for (let at = index - 1; at >= 0 && source[at] === "\\"; at--) slashes++;
    return slashes % 2 === 1;
  }

  function findClosing(source, marker, from) {
    let index = from;
    while ((index = source.indexOf(marker, index)) >= 0) {
      if (!isEscaped(source, index)) return index;
      index += marker.length;
    }
    return -1;
  }

  function readBalanced(source, index, open, close) {
    if (source[index] !== open) return -1;
    let depth = 0;
    for (let at = index; at < source.length; at++) {
      if (isEscaped(source, at)) continue;
      if (source[at] === open) depth++;
      else if (source[at] === close && --depth === 0) return at + 1;
    }
    return -1;
  }

  function readScriptTarget(source, index) {
    if (source[index] === "{") return readBalanced(source, index, "{", "}");
    return /[A-Za-z0-9]/.test(source[index] || "") ? index + 1 : -1;
  }

  function readScripts(source, index) {
    let at = index,
      count = 0;
    while (source[at] === "_" || source[at] === "^") {
      const end = readScriptTarget(source, at + 1);
      if (end < 0) break;
      at = end;
      count++;
    }
    return { end: at, count };
  }

  function boundary(source, index) {
    return index < 0 || index >= source.length || !/[A-Za-z0-9_]/.test(source[index]);
  }

  function bareMathAt(source, index) {
    if (isEscaped(source, index) || !boundary(source, index - 1)) return null;
    let end = -1;
    if (source.startsWith("\\frac", index)) {
      let at = index + 5;
      while (/\s/.test(source[at] || "")) at++;
      at = readBalanced(source, at, "{", "}");
      if (at < 0) return null;
      while (/\s/.test(source[at] || "")) at++;
      end = readBalanced(source, at, "{", "}");
    } else if (source.startsWith("\\sqrt", index)) {
      let at = index + 5;
      while (/\s/.test(source[at] || "")) at++;
      if (source[at] === "[") {
        at = readBalanced(source, at, "[", "]");
        if (at < 0) return null;
        while (/\s/.test(source[at] || "")) at++;
      }
      end = readBalanced(source, at, "{", "}");
    } else if (source[index] === "\\") {
      const command = /^\\([A-Za-z]+)/.exec(source.slice(index));
      if (!command || !NAMED_TEX_COMMANDS.has(command[1])) return null;
      let at = index + command[0].length;
      while (/\s/.test(source[at] || "")) at++;
      if (source[at] === "[") {
        at = readBalanced(source, at, "[", "]");
        if (at < 0) return null;
      }
      for (let groups = 0; groups < 4 && source[at] === "{"; groups++) {
        at = readBalanced(source, at, "{", "}");
        if (at < 0) return null;
      }
      const scripts = readScripts(source, at);
      end = scripts.end;
      if (source[end] === "(") {
        const grouped = readBalanced(source, end, "(", ")");
        if (grouped > 0) end = grouped;
      }
    } else if (/[A-Za-z]/.test(source[index] || "")) {
      const scripts = readScripts(source, index + 1);
      if (!scripts.count) return null;
      end = scripts.end;
    }
    if (end < 0 || !boundary(source, end)) return null;
    return { type: "math", tex: source.slice(index, end), raw: source.slice(index, end), end, display: false };
  }

  function explicitMathAt(source, index) {
    let open = null,
      close = null,
      display = false;
    if (source.startsWith("$$", index) && !isEscaped(source, index)) {
      open = close = "$$";
      display = true;
    } else if (source[index] === "$" && !isEscaped(source, index)) open = close = "$";
    else if (source.startsWith("\\(", index) && !isEscaped(source, index)) {
      open = "\\(";
      close = "\\)";
    } else if (source.startsWith("\\[", index) && !isEscaped(source, index)) {
      open = "\\[";
      close = "\\]";
      display = true;
    } else return null;
    const closing = findClosing(source, close, index + open.length);
    if (closing < 0) return { type: "literal-rest", raw: source.slice(index), end: source.length };
    const tex = source.slice(index + open.length, closing);
    if (!tex.trim()) return { type: "text", text: source.slice(index, closing + close.length), end: closing + close.length };
    if (open === "$" && (/\s/.test(tex[0]) || /\s/.test(tex.at(-1)))) return null;
    return { type: "math", tex, raw: source.slice(index, closing + close.length), end: closing + close.length, display };
  }

  function markdownAt(source, index) {
    if (isEscaped(source, index)) return null;
    if (source[index] === "`") {
      const closing = findClosing(source, "`", index + 1);
      if (closing < 0) return { type: "literal-rest", raw: source.slice(index), end: source.length };
      return { type: "code", content: source.slice(index + 1, closing), end: closing + 1 };
    }
    for (const marker of ["**", "__"]) {
      if (!source.startsWith(marker, index)) continue;
      const closing = findClosing(source, marker, index + marker.length);
      if (closing < 0) return { type: "literal-rest", raw: source.slice(index), end: source.length };
      const content = source.slice(index + marker.length, closing);
      const end = closing + marker.length,
        raw = source.slice(index, end);
      if (closing > index + marker.length && boundary(source, index - 1) && boundary(source, end) && !/\s/.test(content[0]) && !/\s/.test(content.at(-1)) && !/[*_]/.test(content[0]) && !/[*_]/.test(content.at(-1))) {
        return { type: "styled", style: "bold", content, end: closing + marker.length };
      }
      return { type: "text", text: raw, end };
    }
    if (source[index] === "*" && source[index + 1] !== "*" && boundary(source, index - 1)) {
      const closing = findClosing(source, "*", index + 1);
      const content = source.slice(index + 1, closing);
      if (closing > index + 1 && source[closing + 1] !== "*" && boundary(source, closing + 1) && !/\s/.test(content[0]) && !/\s/.test(content.at(-1))) {
        return { type: "styled", style: "italic", content, end: closing + 1 };
      }
      if (closing > index + 1) return { type: "text", text: source.slice(index, closing + 1), end: closing + 1 };
    }
    if (source[index] === "_" && boundary(source, index - 1) && source[index + 1] !== "_") {
      let closing = findClosing(source, "_", index + 1);
      while (closing > index + 1 && !boundary(source, closing + 1)) closing = findClosing(source, "_", closing + 1);
      const content = source.slice(index + 1, closing);
      if (closing > index + 1 && !/\s/.test(content[0]) && !/\s/.test(content.at(-1))) return { type: "styled", style: "italic", content, end: closing + 1 };
      if (closing > index + 1) return { type: "text", text: source.slice(index, closing + 1), end: closing + 1 };
    }
    return null;
  }

  function sameTextStyle(a, b) {
    return a.type === "text" && b.type === "text" && Boolean(a.bold) === Boolean(b.bold) && Boolean(a.italic) === Boolean(b.italic) && Boolean(a.code) === Boolean(b.code);
  }

  function appendSegment(segments, segment) {
    if (segment.type === "text" && !segment.text) return;
    const previous = segments.at(-1);
    if (previous && sameTextStyle(previous, segment)) previous.text += segment.text;
    else segments.push(segment);
  }

  function tokenizeInline(source, style = {}) {
    const segments = [];
    let plainStart = 0,
      index = 0;
    const flush = (end) => {
      if (end > plainStart) appendSegment(segments, { type: "text", text: source.slice(plainStart, end), ...style });
    };
    while (index < source.length) {
      const explicit = explicitMathAt(source, index),
        markdown = explicit ? null : markdownAt(source, index),
        bare = explicit || markdown ? null : bareMathAt(source, index),
        token = explicit || markdown || bare;
      if (!token) {
        index++;
        continue;
      }
      flush(index);
      if (token.type === "literal-rest") {
        appendSegment(segments, { type: "text", text: token.raw, ...style });
        return segments;
      }
      if (token.type === "text") appendSegment(segments, { type: "text", text: token.text, ...style });
      else if (token.type === "math") segments.push({ type: "math", tex: token.tex, raw: token.raw, display: token.display, ...style });
      else if (token.type === "code") appendSegment(segments, { type: "text", text: token.content, ...style, code: true });
      else {
        const nested = tokenizeInline(token.content, { ...style, [token.style]: true });
        nested.forEach((segment) => appendSegment(segments, segment));
      }
      index = token.end;
      plainStart = index;
    }
    flush(source.length);
    return segments;
  }

  function parseLine(raw) {
    let content = raw,
      kind = "paragraph",
      level = 0,
      fontScale = 1,
      prefix = null;
    const heading = /^(?: {0,3})(#{1,3})[\t ]+(.*)$/.exec(raw),
      bullet = /^(?: {0,3})[-+*][\t ]+(.*)$/.exec(raw),
      ordered = /^(?: {0,3})(\d{1,3})[.)][\t ]+(.*)$/.exec(raw),
      quote = /^(?: {0,3})>[\t ]?(.*)$/.exec(raw);
    if (heading) {
      kind = "heading";
      level = heading[1].length;
      fontScale = [0, 1.36, 1.2, 1.1][level];
      content = heading[2];
    } else if (bullet) {
      kind = "bullet";
      content = bullet[1];
      prefix = { type: "text", text: "\u2022 ", bold: true };
    } else if (ordered) {
      kind = "ordered";
      content = ordered[2];
      prefix = { type: "text", text: `${ordered[1]}. `, bold: true };
    } else if (quote) {
      kind = "quote";
      content = quote[1];
      prefix = { type: "text", text: "> ", italic: true };
    }
    const segments = tokenizeInline(content, kind === "heading" ? { bold: true } : kind === "quote" ? { italic: true } : {});
    if (prefix) segments.unshift(prefix);
    return { raw, kind, level, fontScale, segments };
  }

  function parse(source) {
    const value = String(source ?? ""),
      normalized = value.replace(/\r\n?/g, "\n");
    return { source: value, normalized, lines: normalized.split("\n").map(parseLine) };
  }

  return { parse, tokenizeInline, bareMathAt };
});
"use strict";
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.LUMI6_ANIMATION = api;
})(typeof globalThis === "object" ? globalThis : this, function () {
  const MAX_OBJECTS = 32,
    MAX_MOTIONS = 32,
    MAX_PATH_POINTS = 128,
    MAX_TEXT_LENGTH = 240,
    OBJECT_TYPES = new Set(["group", "circle", "ellipse", "rect", "line", "path", "text"]),
    MOTION_TYPES = new Set(["orbit", "spin", "translate", "pulse", "fade", "keyframes"]),
    PALETTE = ["#f59e0b", "#2563eb", "#ef4444", "#10b981", "#8b5cf6", "#06b6d4", "#f97316", "#64748b"],
    COLOR_NAMES = new Set(["black", "white", "red", "orange", "yellow", "green", "blue", "purple", "gray", "grey", "transparent"]);

  const finite = (value) => Number.isFinite(value),
    clamp = (value, min, max) => Math.max(min, Math.min(max, value)),
    safeNumber = (value, fallback = 0) => (finite(value) ? value : fallback),
    point = (value) => Array.isArray(value) && value.length === 2 && value.every(finite) ? [value[0], value[1]] : null,
    period = (value, fallback) => clamp(finite(value) ? value : fallback, 250, 600000);

  function safeColor(value, fallback = null) {
    if (typeof value !== "string") return fallback;
    const color = value.trim().toLowerCase();
    if (/^#[0-9a-f]{3,8}$/i.test(color) || /^rgba?\(\s*[\d.]+%?\s*,\s*[\d.]+%?\s*,\s*[\d.]+%?(?:\s*,\s*[\d.]+%?)?\s*\)$/i.test(color) || COLOR_NAMES.has(color)) return color;
    return fallback;
  }

  function normalizeStyle(source, index, type) {
    const outlined = type === "line" || type === "path",
      fill = safeColor(source.fill, outlined ? null : PALETTE[index % PALETTE.length]),
      stroke = safeColor(source.stroke, outlined ? PALETTE[index % PALETTE.length] : null),
      lineWidth = clamp(safeNumber(source.lineWidth, outlined ? 4 : 2), 0.5, 80),
      opacity = clamp(safeNumber(source.opacity, 1), 0, 1);
    return { fill, stroke, lineWidth, opacity };
  }

  function bounded(value, min, max) {
    return finite(value) && value >= min && value <= max;
  }

  function normalizeObject(source, index, width, height) {
    if (!source || typeof source !== "object" || Array.isArray(source) || !OBJECT_TYPES.has(source.type)) return null;
    const id = typeof source.id === "string" && /^[A-Za-z][A-Za-z0-9_-]{0,47}$/.test(source.id) ? source.id : null;
    if (!id) return null;
    const base = { id, type: source.type, ...normalizeStyle(source, index, source.type) };
    if (source.type === "group") {
      const children = Array.isArray(source.children) ? source.children.filter((child) => typeof child === "string").slice(0, 32) : [];
      if (!children.length) return null;
      return { ...base, x: safeNumber(source.x), y: safeNumber(source.y), rotation: safeNumber(source.rotation), scale: clamp(safeNumber(source.scale, 1), 0.05, 20), children };
    }
    if (source.type === "circle") {
      if (![source.cx, source.cy, source.r].every(finite) || source.r <= 0 || source.r > Math.max(width, height) * 2) return null;
      return { ...base, cx: source.cx, cy: source.cy, r: source.r };
    }
    if (source.type === "ellipse") {
      if (![source.cx, source.cy, source.rx, source.ry].every(finite) || source.rx <= 0 || source.ry <= 0 || source.rx > width * 2 || source.ry > height * 2) return null;
      return { ...base, cx: source.cx, cy: source.cy, rx: source.rx, ry: source.ry };
    }
    if (source.type === "rect") {
      if (![source.x, source.y, source.w, source.h].every(finite) || source.w <= 0 || source.h <= 0 || source.w > width * 3 || source.h > height * 3) return null;
      return { ...base, x: source.x, y: source.y, w: source.w, h: source.h, radius: clamp(safeNumber(source.radius), 0, Math.min(source.w, source.h) / 2) };
    }
    if (source.type === "line") {
      if (![source.x1, source.y1, source.x2, source.y2].every(finite)) return null;
      return { ...base, x1: source.x1, y1: source.y1, x2: source.x2, y2: source.y2 };
    }
    if (source.type === "path") {
      const points = Array.isArray(source.points) ? source.points.map(point).filter(Boolean).slice(0, MAX_PATH_POINTS) : [];
      if (points.length < 2) return null;
      return { ...base, points, closed: Boolean(source.closed), smooth: Boolean(source.smooth) };
    }
    if (source.type === "text") {
      if (!finite(source.x) || !finite(source.y) || typeof source.text !== "string" || !source.text.length) return null;
      return {
        ...base,
        x: source.x,
        y: source.y,
        text: source.text.slice(0, MAX_TEXT_LENGTH),
        fontSize: clamp(safeNumber(source.fontSize, 32), 6, 400),
        fontFamily: typeof source.fontFamily === "string" && source.fontFamily.length <= 80 ? source.fontFamily : "system-ui, sans-serif",
        fontWeight: source.fontWeight === "bold" || source.fontWeight === 700 ? "700" : "500",
        align: ["left", "center", "right"].includes(source.align) ? source.align : "left",
      };
    }
    return null;
  }

  function normalizeKeyframes(source) {
    if (!Array.isArray(source) || source.length < 2 || source.length > 16) return null;
    const frames = source.map((frame) => {
      if (!frame || typeof frame !== "object" || Array.isArray(frame) || !bounded(frame.at, 0, 1)) return null;
      const normalized = { at: frame.at };
      for (const key of ["x", "y", "rotation"]) if (finite(frame[key])) normalized[key] = frame[key];
      if (finite(frame.scale)) normalized.scale = clamp(frame.scale, 0.05, 20);
      if (finite(frame.opacity)) normalized.opacity = clamp(frame.opacity, 0, 1);
      return Object.keys(normalized).length > 1 ? normalized : null;
    });
    if (frames.some((frame) => !frame)) return null;
    frames.sort((a, b) => a.at - b.at);
    if (frames.some((frame, index) => index && frame.at <= frames[index - 1].at)) return null;
    return frames;
  }

  function normalizeMotion(source, ids, durationMs, width, height) {
    if (!source || typeof source !== "object" || Array.isArray(source) || !MOTION_TYPES.has(source.type) || !ids.has(source.target)) return null;
    const base = { type: source.type, target: source.target, periodMs: period(source.periodMs, durationMs), phase: safeNumber(source.phaseDeg) * Math.PI / 180 };
    if (source.type === "orbit") {
      const center = typeof source.center === "string" && ids.has(source.center) ? source.center : point(source.center);
      if (!center || !finite(source.rx) || !finite(source.ry) || source.rx <= 0 || source.ry <= 0 || source.rx > width * 2 || source.ry > height * 2) return null;
      return { ...base, center, rx: source.rx, ry: source.ry, clockwise: source.clockwise !== false };
    }
    if (source.type === "spin") return { ...base, clockwise: source.clockwise !== false };
    if (source.type === "translate") {
      const from = point(source.from) || [0, 0],
        to = point(source.to);
      if (!to) return null;
      return { ...base, from, to, alternate: source.alternate !== false };
    }
    if (source.type === "pulse") return { ...base, from: clamp(safeNumber(source.from, 0.85), 0.05, 20), to: clamp(safeNumber(source.to, 1.15), 0.05, 20) };
    if (source.type === "fade") return { ...base, from: clamp(safeNumber(source.from, 0.25), 0, 1), to: clamp(safeNumber(source.to, 1), 0, 1) };
    const frames = normalizeKeyframes(source.frames);
    return frames ? { ...base, frames } : null;
  }

  function normalize(command, canvasSize = 20000) {
    if (!command || typeof command !== "object" || Array.isArray(command) || (command.tool || command.type || command.name) !== "animate_scene") return null;
    const x = command.x,
      y = command.y,
      width = command.w,
      height = command.h,
      durationMs = period(command.durationMs, 8000);
    if (![x, y, width, height].every(finite) || x < 0 || y < 0 || width < 120 || height < 90 || width > 6000 || height > 6000 || x + width > canvasSize || y + height > canvasSize) return null;
    if (!Array.isArray(command.objects) || !command.objects.length || command.objects.length > MAX_OBJECTS || !Array.isArray(command.motions) || !command.motions.length || command.motions.length > MAX_MOTIONS) return null;
    const objects = command.objects.map((object, index) => normalizeObject(object, index, width, height));
    if (objects.some((object) => !object)) return null;
    const ids = new Set(objects.map((object) => object.id));
    if (ids.size !== objects.length) return null;
    const byId = new Map(objects.map((object) => [object.id, object])),
      childIds = new Set();
    for (const object of objects) {
      if (object.type !== "group") continue;
      const localChildren = new Set();
      for (const child of object.children) {
        if (!ids.has(child) || child === object.id || localChildren.has(child) || childIds.has(child)) return null;
        localChildren.add(child);
        childIds.add(child);
      }
    }
    const visiting = new Set(),
      visited = new Set();
    function visitGroup(id) {
      const object = byId.get(id);
      if (!object || object.type !== "group" || visited.has(id)) return true;
      if (visiting.has(id)) return false;
      visiting.add(id);
      for (const child of object.children) if (!visitGroup(child)) return false;
      visiting.delete(id);
      visited.add(id);
      return true;
    }
    for (const object of objects) if (object.type === "group" && !visitGroup(object.id)) return null;
    const motions = command.motions.map((motion) => normalizeMotion(motion, ids, durationMs, width, height));
    if (motions.some((motion) => !motion)) return null;
    return {
      tool: "animate_scene",
      version: 1,
      x,
      y,
      w: width,
      h: height,
      durationMs,
      loop: command.loop !== false,
      objects,
      motions,
      dynamicObjectCount: new Set(motions.map((motion) => motion.target)).size,
    };
  }

  function objectAnchor(object) {
    if (object.type === "circle" || object.type === "ellipse") return { x: object.cx, y: object.cy };
    if (object.type === "rect") return { x: object.x + object.w / 2, y: object.y + object.h / 2 };
    if (object.type === "line") return { x: (object.x1 + object.x2) / 2, y: (object.y1 + object.y2) / 2 };
    if (object.type === "path") return { x: object.points.reduce((sum, item) => sum + item[0], 0) / object.points.length, y: object.points.reduce((sum, item) => sum + item[1], 0) / object.points.length };
    return { x: object.x || 0, y: object.y || 0 };
  }

  function motionProgress(motion, timeMs, loop = true) {
    const raw = timeMs / motion.periodMs + motion.phase / (Math.PI * 2);
    if (!loop) return clamp(raw, 0, 1);
    const cycle = raw % 1;
    return cycle < 0 ? cycle + 1 : cycle;
  }

  function interpolateFrames(frames, progress) {
    let left = frames[0], right = frames.at(-1);
    if (progress <= left.at) right = left;
    else if (progress >= right.at) left = right;
    else for (let index = 1; index < frames.length; index++) if (frames[index].at >= progress) { left = frames[index - 1]; right = frames[index]; break; }
    const ratio = left === right ? 0 : (progress - left.at) / (right.at - left.at), result = {};
    for (const key of ["x", "y", "rotation", "scale", "opacity"]) {
      const a = finite(left[key]) ? left[key] : key === "scale" || key === "opacity" ? 1 : 0,
        b = finite(right[key]) ? right[key] : a;
      result[key] = a + (b - a) * ratio;
    }
    return result;
  }

  function animationStates(scene, timeMs) {
    const byId = new Map(scene.objects.map((object) => [object.id, object])),
      states = new Map(scene.objects.map((object) => [object.id, { dx: 0, dy: 0, rotation: 0, scale: 1, opacity: 1 }]));
    for (const motion of scene.motions) {
      const target = byId.get(motion.target), state = states.get(motion.target), progress = motionProgress(motion, timeMs, scene.loop);
      if (!target || !state) continue;
      if (motion.type === "orbit") {
        const centerObject = typeof motion.center === "string" ? byId.get(motion.center) : null,
          center = centerObject ? objectAnchor(centerObject) : { x: motion.center[0], y: motion.center[1] },
          anchor = objectAnchor(target), angle = (motion.clockwise ? 1 : -1) * progress * Math.PI * 2;
        state.dx += center.x + Math.cos(angle) * motion.rx - anchor.x;
        state.dy += center.y + Math.sin(angle) * motion.ry - anchor.y;
      } else if (motion.type === "spin") state.rotation += (motion.clockwise ? 1 : -1) * progress * Math.PI * 2;
      else if (motion.type === "translate") {
        const ratio = motion.alternate ? 0.5 - Math.cos(progress * Math.PI * 2) / 2 : progress;
        state.dx += motion.from[0] + (motion.to[0] - motion.from[0]) * ratio;
        state.dy += motion.from[1] + (motion.to[1] - motion.from[1]) * ratio;
      } else if (motion.type === "pulse") state.scale *= motion.from + (motion.to - motion.from) * (0.5 - Math.cos(progress * Math.PI * 2) / 2);
      else if (motion.type === "fade") state.opacity *= motion.from + (motion.to - motion.from) * (0.5 - Math.cos(progress * Math.PI * 2) / 2);
      else {
        const frame = interpolateFrames(motion.frames, progress);
        state.dx += frame.x;
        state.dy += frame.y;
        state.rotation += frame.rotation * Math.PI / 180;
        state.scale *= frame.scale;
        state.opacity *= frame.opacity;
      }
    }
    return states;
  }

  function roundedRect(context, object) {
    if (object.radius && typeof context.roundRect === "function") context.roundRect(object.x, object.y, object.w, object.h, object.radius);
    else context.rect(object.x, object.y, object.w, object.h);
  }

  function drawPath(context, object) {
    const points = object.points;
    context.moveTo(points[0][0], points[0][1]);
    if (!object.smooth || points.length < 3) for (let index = 1; index < points.length; index++) context.lineTo(points[index][0], points[index][1]);
    else {
      for (let index = 1; index < points.length - 1; index++) {
        const item = points[index], next = points[index + 1];
        context.quadraticCurveTo(item[0], item[1], (item[0] + next[0]) / 2, (item[1] + next[1]) / 2);
      }
      context.lineTo(points.at(-1)[0], points.at(-1)[1]);
    }
    if (object.closed) context.closePath();
  }

  function drawShape(context, object) {
    if (object.type === "text") {
      context.fillStyle = object.fill || object.stroke || "#1f2937";
      context.font = object.fontWeight + " " + object.fontSize + "px " + object.fontFamily;
      context.textAlign = object.align;
      context.textBaseline = "middle";
      context.fillText(object.text, object.x, object.y);
      return;
    }
    context.beginPath();
    if (object.type === "circle") context.arc(object.cx, object.cy, object.r, 0, Math.PI * 2);
    else if (object.type === "ellipse") context.ellipse(object.cx, object.cy, object.rx, object.ry, 0, 0, Math.PI * 2);
    else if (object.type === "rect") roundedRect(context, object);
    else if (object.type === "line") { context.moveTo(object.x1, object.y1); context.lineTo(object.x2, object.y2); }
    else if (object.type === "path") drawPath(context, object);
    if (object.fill && object.type !== "line") { context.fillStyle = object.fill; context.fill(); }
    if (object.stroke) { context.strokeStyle = object.stroke; context.lineWidth = object.lineWidth; context.lineCap = context.lineJoin = "round"; context.stroke(); }
  }

  function render(context, scene, timeMs = 0) {
    const normalized = scene?.tool === "animate_scene" && scene.version === 1 ? scene : normalize(scene);
    if (!normalized || !context) return false;
    const byId = new Map(normalized.objects.map((object) => [object.id, object])),
      states = animationStates(normalized, timeMs),
      childIds = new Set(normalized.objects.filter((object) => object.type === "group").flatMap((object) => object.children)),
      rendering = new Set();
    function renderObject(object) {
      if (!object || rendering.has(object.id)) return;
      rendering.add(object.id);
      const state = states.get(object.id) || { dx: 0, dy: 0, rotation: 0, scale: 1, opacity: 1 };
      context.save();
      context.globalAlpha *= object.opacity * state.opacity;
      if (object.type === "group") {
        context.translate(object.x + state.dx, object.y + state.dy);
        context.rotate((object.rotation || 0) * Math.PI / 180 + state.rotation);
        context.scale(object.scale * state.scale, object.scale * state.scale);
        object.children.forEach((id) => renderObject(byId.get(id)));
      } else {
        const anchor = objectAnchor(object);
        context.translate(anchor.x + state.dx, anchor.y + state.dy);
        context.rotate(state.rotation);
        context.scale(state.scale, state.scale);
        context.translate(-anchor.x, -anchor.y);
        drawShape(context, object);
      }
      context.restore();
      rendering.delete(object.id);
    }
    context.save();
    context.beginPath();
    context.rect(0, 0, normalized.w, normalized.h);
    context.clip();
    normalized.objects.filter((object) => !childIds.has(object.id)).forEach(renderObject);
    context.restore();
    return true;
  }

  function rasterize(scene, createCanvas, timeMs = 0, pixelRatio = 1, maxPixels = 4000000) {
    const normalized = scene?.tool === "animate_scene" && scene.version === 1 ? scene : normalize(scene);
    if (!normalized || typeof createCanvas !== "function") return null;
    const ratio = Math.max(0.1, Math.min(pixelRatio, 2048 / normalized.w, 1536 / normalized.h, Math.sqrt(maxPixels / (normalized.w * normalized.h)))),
      canvas = createCanvas(Math.max(1, Math.ceil(normalized.w * ratio)), Math.max(1, Math.ceil(normalized.h * ratio))),
      context = canvas.getContext("2d");
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    render(context, normalized, timeMs);
    canvas.logicalWidth = normalized.w;
    canvas.logicalHeight = normalized.h;
    return canvas;
  }

  function serialize(scene) {
    const normalized = scene?.tool === "animate_scene" && scene.version === 1 ? scene : normalize(scene);
    if (!normalized) return null;
    const { dynamicObjectCount, background, ...plain } = normalized;
    return JSON.parse(JSON.stringify(plain));
  }

  return { normalize, render, rasterize, serialize, animationStates, objectAnchor, MAX_OBJECTS, MAX_MOTIONS };
});
"use strict";
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.LUMI6_SUMMON = api;
})(typeof globalThis === "object" ? globalThis : this, function () {
  const TAU = Math.PI * 2,
    LOADER_TYPES = ["lemniscate", "rose", "superellipse", "golden-spiral", "deltoid"],
    PHRASE_KEYS = Array.from({ length:12 }, (_, i) => `summonPhrase${i + 1}`),
    TIP_KEYS = Array.from({ length:20 }, (_, i) => `summonTip${i + 1}`),
    PHRASE_MS = 12000,
    TIP_MS = 26000,
    TEXT_INTERVALS = Object.freeze({ phrase:PHRASE_MS, tip:TIP_MS }),
    THINKING_LAYOUT = Object.freeze({
      loaderRadius:43,
      copyTop:68,
      copyWidth:330,
      copyHeight:72,
      padding:12,
      viewportMargin:14,
    });

  function clamp01(value) {
    return Math.max(0, Math.min(1, value));
  }

  function mulberry32(seed) {
    let value = seed >>> 0 || 1;
    return () => {
      value |= 0;
      value = (value + 0x6d2b79f5) | 0;
      let next = Math.imul(value ^ (value >>> 15), 1 | value);
      next = (next + Math.imul(next ^ (next >>> 7), 61 | next)) ^ next;
      return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
    };
  }

  function pickLoaderType(random = Math.random, previous = "") {
    const available = LOADER_TYPES.filter((type) => type !== previous),
      value = clamp01(Number(random()) || 0),
      index = Math.min(available.length - 1, Math.floor(value * available.length));
    return available[index];
  }

  function pickDifferentIndex(random, length, previous) {
    if (length <= 1) return 0;
    let index = Math.min(length - 1, Math.floor(clamp01(Number(random()) || 0) * length));
    if (index === previous) index = (index + 1) % length;
    return index;
  }

  function normalizePoints(points) {
    if (!points.length) return points;
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const point of points) {
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    }
    const centerX = (minX + maxX) / 2,
      centerY = (minY + maxY) / 2,
      scale = 2 / Math.max(1e-6, maxX - minX, maxY - minY);
    return points.map((point) => ({
      x:(point.x - centerX) * scale,
      y:(point.y - centerY) * scale,
    }));
  }

  function buildLoaderData(type, seed) {
    const random = mulberry32(seed);
    return {
      hue:random() * 360,
      phase:random() * TAU,
      direction:random() < 0.5 ? -1 : 1,
    };
  }

  function signedPower(value, power) {
    return Math.sign(value) * Math.pow(Math.abs(value), power);
  }

  function buildLoaderPoints(type, data, elapsed = 0) {
    const points = [],
      samples = type === "golden-spiral" ? 220 : 240;
    for (let index = 0; index <= samples; index++) {
      const progress = index / samples,
        angle = progress * TAU;
      if (type === "lemniscate") {
        points.push({
          x:Math.sin(angle),
          y:Math.sin(angle) * Math.cos(angle) * 0.72,
        });
      } else if (type === "rose") {
        const radius = Math.cos(3 * angle);
        points.push({
          x:Math.cos(angle) * radius,
          y:Math.sin(angle) * radius,
        });
      } else if (type === "superellipse") {
        const exponent = 2 / (3.1 + Math.sin(elapsed * 0.48 + data.phase) * 0.38);
        points.push({
          x:signedPower(Math.cos(angle), exponent),
          y:signedPower(Math.sin(angle), exponent),
        });
      } else if (type === "golden-spiral") {
        const spiralAngle = progress * Math.PI * 5,
          radius = 0.105 * Math.exp(spiralAngle * 0.138);
        points.push({
          x:Math.cos(spiralAngle + data.phase) * radius,
          y:Math.sin(spiralAngle + data.phase) * radius,
        });
      } else {
        points.push({
          x:2 * Math.cos(angle) + Math.cos(2 * angle),
          y:2 * Math.sin(angle) - Math.sin(2 * angle),
        });
      }
    }
    return normalizePoints(points);
  }

  function pathIsClosed(type) {
    return type !== "golden-spiral";
  }

  function traceIndex(index, length, closed) {
    if (closed) return ((index % length) + length) % length;
    return index >= 0 && index < length ? index : -1;
  }

  function drawPolyline(ctx, points) {
    if (points.length < 2) return;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let index = 1; index < points.length; index++) ctx.lineTo(points[index].x, points[index].y);
    ctx.stroke();
  }

  function drawTrail(ctx, points, model, elapsed, fade, aiColor) {
    if (points.length < 2) return;
    const closed = pathIsClosed(model.type),
      length = points.length,
      trailLength = Math.floor(length * 0.22),
      cycle = ((elapsed * 0.105 * model.data.direction + model.data.phase / TAU) % 1 + 1) % 1,
      head = closed ? Math.floor(cycle * length) : Math.floor(cycle * (length + trailLength)),
      colorDrift = Math.sin(elapsed * 0.24) * 4;

    ctx.save();
    ctx.strokeStyle = aiColor;
    ctx.globalAlpha = fade * 0.14;
    ctx.lineWidth = 1.1;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    drawPolyline(ctx, points);
    ctx.restore();

    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = 2.05;
    for (let step = 1; step <= trailLength; step++) {
      const previous = traceIndex(head - trailLength + step - 1, length, closed),
        current = traceIndex(head - trailLength + step, length, closed);
      if (previous < 0 || current < 0) continue;
      const strength = step / trailLength,
        hue = (model.data.hue + colorDrift + strength * 34) % 360;
      ctx.strokeStyle = `hsla(${hue},76%,48%,${fade * (0.14 + strength * 0.78)})`;
      ctx.beginPath();
      ctx.moveTo(points[previous].x, points[previous].y);
      ctx.lineTo(points[current].x, points[current].y);
      ctx.stroke();
    }

    const headIndex = traceIndex(head, length, closed);
    if (headIndex < 0) return;
    const point = points[headIndex],
      hue = (model.data.hue + colorDrift + 34) % 360;
    ctx.fillStyle = `hsla(${hue},80%,45%,${fade * 0.96})`;
    ctx.beginPath();
    ctx.arc(point.x, point.y, 1.9, 0, TAU);
    ctx.fill();
  }

  function thinkingFootprint(center, viewportWidth) {
    const width = Math.max(0, Number(viewportWidth) || 0),
      copyWidth = Math.max(0, Math.min(THINKING_LAYOUT.copyWidth, width - 36)),
      halfWidth = Math.max(THINKING_LAYOUT.loaderRadius, copyWidth / 2),
      left = center.x - halfWidth - THINKING_LAYOUT.padding,
      top = center.y - THINKING_LAYOUT.loaderRadius - THINKING_LAYOUT.padding,
      right = center.x + halfWidth + THINKING_LAYOUT.padding,
      bottom = center.y + THINKING_LAYOUT.copyTop + THINKING_LAYOUT.copyHeight + THINKING_LAYOUT.padding;
    return { x:left, y:top, w:right - left, h:bottom - top };
  }

  function chooseThinkingPlacement(options = {}) {
    const width = Math.max(1, Number(options.width) || 1),
      height = Math.max(1, Number(options.height) || 1),
      template = thinkingFootprint({ x:0, y:0 }, width),
      margin = Math.min(THINKING_LAYOUT.viewportMargin, width / 2, height / 2),
      minX = margin - template.x,
      maxX = width - margin - template.x - template.w,
      minY = margin - template.y,
      maxY = height - margin - template.y - template.h,
      clampAxis = (value, min, max, fallback) => min <= max ? Math.max(min, Math.min(max, value)) : fallback,
      clampCenter = (x, y) => ({
        x:clampAxis(x, minX, maxX, width / 2),
        y:clampAxis(y, minY, maxY, height / 2),
      }),
      blockers = (Array.isArray(options.blockers) ? options.blockers : [])
        .filter((rect) => rect && Number.isFinite(rect.x) && Number.isFinite(rect.y)
          && Number.isFinite(rect.w) && Number.isFinite(rect.h) && rect.w > 0 && rect.h > 0),
      anchor = options.anchor && Number.isFinite(options.anchor.x) && Number.isFinite(options.anchor.y)
        && Number.isFinite(options.anchor.w) && Number.isFinite(options.anchor.h)
        ? options.anchor
        : null,
      candidates = [],
      seen = new Set(),
      addCandidate = (x, y) => {
        const point = clampCenter(x, y),
          key = `${Math.round(point.x * 10)},${Math.round(point.y * 10)}`;
        if (seen.has(key)) return;
        seen.add(key);
        candidates.push(point);
      },
      overlapScore = (box) => {
        let score = 0;
        for (const blocker of blockers) {
          const overlapWidth = Math.min(box.x + box.w, blocker.x + blocker.w) - Math.max(box.x, blocker.x),
            overlapHeight = Math.min(box.y + box.h, blocker.y + blocker.h) - Math.max(box.y, blocker.y);
          if (overlapWidth > 0 && overlapHeight > 0)
            score += overlapWidth * overlapHeight * Math.max(1, Number(blocker.weight) || 1);
        }
        return score;
      };
    if (anchor) {
      const centerX = anchor.x + anchor.w / 2,
        centerY = anchor.y + anchor.h / 2,
        gap = 18;
      addCandidate(anchor.x + anchor.w + gap - template.x, centerY);
      addCandidate(centerX, anchor.y + anchor.h + gap - template.y);
      addCandidate(anchor.x - gap - template.x - template.w, centerY);
      addCandidate(centerX, anchor.y - gap - template.y - template.h);
    }
    addCandidate(width / 2, height / 2);
    for (const y of [0.17, 0.38, 0.62, 0.83])
      for (const x of [0.12, 0.31, 0.5, 0.69, 0.88]) addCandidate(width * x, height * y);
    let best = candidates[0] || clampCenter(width / 2, height / 2),
      bestBox = thinkingFootprint(best, width),
      bestScore = overlapScore(bestBox);
    for (let index = 1; index < candidates.length; index++) {
      const candidate = candidates[index],
        box = thinkingFootprint(candidate, width),
        score = overlapScore(box);
      if (score < bestScore) {
        best = candidate;
        bestBox = box;
        bestScore = score;
        if (score === 0) break;
      }
    }
    return { x:best.x, y:best.y, box:bestBox, score:bestScore };
  }

  function create(options) {
    const canvas = options.fxCanvas,
      ctx = canvas?.getContext("2d"),
      textLayer = options.textLayer,
      t = options.t,
      getTransform = options.getTransform,
      getAiColor = options.getAiColor || (() => "#2563eb"),
      styleFor = options.styleFor || (() => null);
    let model = null,
      rafId = 0,
      startTime = 0,
      hideAt = 0,
      phraseTimer = 0,
      tipTimer = 0,
      phraseIndex = 0,
      tipIndex = 0,
      copyEl = null,
      copyStyle = null,
      captionEl = null,
      hintEl = null,
      lastType = "",
      lastPhraseIndex = -1,
      lastTipIndex = -1;

    function now() {
      return performance.now() / 1000;
    }

    function applyText() {
      if (captionEl) captionEl.textContent = t(PHRASE_KEYS[phraseIndex % PHRASE_KEYS.length]);
      if (hintEl) hintEl.textContent = t(TIP_KEYS[tipIndex % TIP_KEYS.length]);
    }

    function swapText(element, className) {
      if (!element) return;
      element.classList.remove(className);
      void element.offsetWidth;
      element.classList.add(className);
    }

    function rotatePhrase() {
      phraseIndex = (phraseIndex + 1) % PHRASE_KEYS.length;
      swapText(captionEl, "caption-swap");
      applyText();
    }

    function rotateTip() {
      tipIndex = (tipIndex + 1) % TIP_KEYS.length;
      swapText(hintEl, "hint-swap");
      applyText();
    }

    function buildText() {
      if (!textLayer) return;
      textLayer.textContent = "";
      copyEl = document.createElement("div");
      copyEl.className = "summon-copy";
      copyStyle = styleFor(copyEl);
      captionEl = document.createElement("div");
      captionEl.className = "summon-caption caption-swap";
      hintEl = document.createElement("div");
      hintEl.className = "summon-hint hint-swap";
      copyEl.append(captionEl, hintEl);
      textLayer.appendChild(copyEl);
      applyText();
    }

    function placeText(screenX, screenY) {
      if (!copyStyle) return;
      copyStyle.left = `${screenX}px`;
      copyStyle.top = `${screenY + THINKING_LAYOUT.copyTop}px`;
    }

    function drawLoader(elapsed, fade, screenX, screenY) {
      const radius = 41 * (1 + Math.sin(elapsed * 0.68 + model.data.phase) * 0.018),
        points = buildLoaderPoints(model.type, model.data, elapsed)
          .map((point) => ({ x:point.x * radius, y:point.y * radius }));
      ctx.save();
      ctx.translate(screenX, screenY);
      drawTrail(ctx, points, model, elapsed, fade, getAiColor());
      ctx.restore();
    }

    function stop() {
      cancelAnimationFrame(rafId);
      rafId = 0;
      clearInterval(phraseTimer);
      clearInterval(tipTimer);
      phraseTimer = 0;
      tipTimer = 0;
      model = null;
      hideAt = 0;
      copyEl = null;
      copyStyle = null;
      captionEl = null;
      hintEl = null;
      if (textLayer) textLayer.textContent = "";
      if (ctx && canvas) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        delete canvas.dataset.loaderType;
        canvas.hidden = true;
      }
    }

    function frame() {
      if (!model) return;
      rafId = requestAnimationFrame(frame);
      const transform = getTransform(),
        dpr = transform.dpr || 1,
        elapsed = now() - startTime,
        screenX = model.anchor.x * transform.scale + transform.panX,
        screenY = model.anchor.y * transform.scale + transform.panY;
      let fade = 1;
      if (hideAt) {
        fade = clamp01(1 - (now() - hideAt) / 0.36);
        if (fade <= 0) {
          stop();
          return;
        }
      }
      if (canvas.width !== Math.round(transform.width * dpr) || canvas.height !== Math.round(transform.height * dpr)) {
        canvas.width = Math.round(transform.width * dpr);
        canvas.height = Math.round(transform.height * dpr);
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawLoader(elapsed, fade, screenX, screenY);
      if (copyStyle) copyStyle.opacity = String(fade);
      placeText(screenX, screenY);
    }

    function show(anchor) {
      if (!ctx || !canvas || !textLayer || !anchor) return false;
      stop();
      const seed = ((Date.now() & 0xffffffff) ^ ((anchor.x * 2654435761) | 0) ^ ((anchor.y * 1597334677) | 0)) >>> 0,
        random = mulberry32(seed),
        type = pickLoaderType(random, lastType);
      lastType = type;
      model = {
        anchor:{ x:anchor.x, y:anchor.y },
        type,
        data:buildLoaderData(type, seed),
      };
      phraseIndex = pickDifferentIndex(random, PHRASE_KEYS.length, lastPhraseIndex);
      tipIndex = pickDifferentIndex(random, TIP_KEYS.length, lastTipIndex);
      lastPhraseIndex = phraseIndex;
      lastTipIndex = tipIndex;
      buildText();
      canvas.dataset.loaderType = type;
      canvas.hidden = false;
      startTime = now();
      hideAt = 0;
      phraseTimer = setInterval(rotatePhrase, PHRASE_MS);
      tipTimer = setInterval(rotateTip, TIP_MS);
      rafId = requestAnimationFrame(frame);
      return true;
    }

    function hide() {
      if (model && !hideAt) hideAt = now();
      else if (!model) stop();
    }

    return {
      show,
      hide,
      refreshText: applyText,
      get type() {
        return model?.type || lastType;
      },
      get active() {
        return Boolean(model);
      },
    };
  }

  return {
    LOADER_TYPES,
    TEXT_INTERVALS,
    THINKING_LAYOUT,
    pickLoaderType,
    pickDifferentIndex,
    buildLoaderData,
    buildLoaderPoints,
    thinkingFootprint,
    chooseThinkingPlacement,
    create,
  };
});
/**
 * Lumi6 Canvas Adapter
 * 
 * Puts Primer lesson pictures and notes onto the Lumi6 whiteboard.
 */
(function () {
  "use strict";

  class Lumi6CanvasAdapter {
    /**
     * Render Primer visual commands on the Lumi6 canvas.
     * 
     * @param {Array<Object>} commands - Array of Lumi6 commands (draw, write_text, draw_formula, plot_function)
     * @returns {Promise<{success: boolean, count: number}>}
     */
    static async renderCommands(commands) {
      if (!Array.isArray(commands) || commands.length === 0) {
        return { success: true, count: 0 };
      }
      if (window.LUMI6_CANVAS_ADAPTER && typeof window.LUMI6_CANVAS_ADAPTER.executeCommands === "function") {
        return window.LUMI6_CANVAS_ADAPTER.executeCommands(commands);
      }

      // 2. Fallback rasterizer via LUMI6_DRAW for standalone canvas
      const screenCanvas = document.getElementById("screen");
      const drawEngine = window.LUMI6_DRAW;
      if (screenCanvas && drawEngine) {
        let count = 0;
        for (const cmd of commands) {
          if (cmd.tool === "draw") {
            const normalized = drawEngine.normalize(cmd);
            if (normalized && typeof drawEngine.render === "function") {
              drawEngine.render(normalized, screenCanvas, "#2563eb");
              count++;
            }
          }
        }
        return { success: true, count };
      }

      return { success: false, count: 0 };
    }
  }

  window.Lumi6CanvasAdapter = Lumi6CanvasAdapter;
})();
"use strict";
(() => {
  const SIZE = 20000,
    TILE = 512,
    INITIAL_VIEW_ZOOM = 1.5,
    EXPORT_MAX_DIMENSION = 16384,
    EXPORT_MAX_PIXELS = 64 * 1024 * 1024,
    MAX_ATLAS_WIDTH = 2048,
    MAX_ATLAS_HEIGHT = 1536,
    FOCUS_INSET_ENABLED = true,
    MAX_LASSO_POINTS = 4096,
    MAX_HISTORY = 30,
    DEFAULT_AUTO_DELAY = 5000,
    DEFAULT_AI_TIMEOUT = 260000,
    screen = document.querySelector("#screen"),
    view = document.querySelector("#viewport"),
    ctx = screen.getContext("2d"),
    animationLayer = document.querySelector("#animationLayer"),
    animationCtx = animationLayer.getContext("2d"),
    widgetLayer = document.querySelector("#widgetLayer"),
    summonLayer = document.querySelector("#summonLayer"),
    inkLayer = document.querySelector("#inkLayer"),
    inkCtx = inkLayer.getContext("2d"),
    interactionLayer = document.querySelector("#interactionLayer"),
    interactionCtx = interactionLayer.getContext("2d"),
    objectChromeLayer = document.querySelector("#objectChromeLayer"),
    animationControls = document.querySelector("#animationControls"),
    animationPlayPause = document.querySelector("#animationPlayPause"),
    animationRestart = document.querySelector("#animationRestart"),
    animationDelete = document.querySelector("#animationDelete"),
    pluginButton = document.querySelector("#pluginButton"),
    pluginPopover = document.querySelector("#pluginPopover"),
    pluginOptions = document.querySelector("#pluginOptions"),
    pluginClose = document.querySelector("#pluginClose"),
    pluginRefresh = document.querySelector("#pluginRefresh"),
    pluginLocalTab = document.querySelector("#pluginLocalTab"),
    pluginCreateTab = document.querySelector("#pluginCreateTab"),
    pluginServerTab = document.querySelector("#pluginServerTab"),
    pluginLocalPanel = document.querySelector("#pluginLocalPanel"),
    pluginCreatePanel = document.querySelector("#pluginCreatePanel"),
    pluginServerPanel = document.querySelector("#pluginServerPanel"),
    pluginLocalCount = document.querySelector("#pluginLocalCount"),
    pluginCatalogStatus = document.querySelector("#pluginCatalogStatus"),
    pluginCreateForm = document.querySelector("#pluginCreateForm"),
    pluginSimpleTemplate = document.querySelector("#pluginSimpleTemplate"),
    pluginTitle = document.querySelector("#pluginTitle"),
    pluginDocumentEditor = document.querySelector("#pluginDocumentEditor"),
    pluginDocumentBytes = document.querySelector("#pluginDocumentBytes"),
    pluginStylesEditor = document.querySelector("#pluginStylesEditor"),
    pluginStylesUploadButton = document.querySelector("#pluginStylesUploadButton"),
    pluginStylesUpload = document.querySelector("#pluginStylesUpload"),
    pluginStylesBytes = document.querySelector("#pluginStylesBytes"),
    pluginStylesPreview = document.querySelector("#pluginStylesPreview"),
    pluginDocumentStatus = document.querySelector("#pluginDocumentStatus"),
    pluginImprove = document.querySelector("#pluginImprove"),
    pluginSave = document.querySelector("#pluginSave"),
    status = document.querySelector("#status"),
    coords = document.querySelector("#coords"),
    debugList = document.querySelector("#debugEvents"),
    debugRequest = document.querySelector("#debugRequest"),
    embodiment = document.querySelector("#aiEmbodiment"),
    aiOrb = document.querySelector("#aiOrb"),
    aiRadial = document.querySelector("#aiRadial"),
    selectionOverlayLayer = document.querySelector("#selectionOverlayLayer"),
    selectionToolbar = document.querySelector("#selectionToolbar"),
    selectionTypesetButton = document.querySelector("#selectionTypesetBtn"),
    selectionVisualizeButton = document.querySelector("#selectionVisualizeBtn"),
    selectionDeleteButton = document.querySelector("#selectionDeleteBtn"),
    selectionCancelButton = document.querySelector("#selectionCancelBtn"),
    imagePickerButton = document.querySelector("#imagePickerBtn"),
    clipboardCopyButton = document.querySelector("#clipboardCopyBtn"),
    imagePickerInput = document.querySelector("#imagePickerInput"),
    imageEditBar = document.querySelector("#imageEditBar"),
    imagePlaceButton = document.querySelector("#imagePlaceBtn"),
    imageMergeButton = document.querySelector("#imageMergeBtn"),
    imageDeleteButton = document.querySelector("#imageDeleteBtn"),
    textEditorLayer = document.querySelector("#textEditorLayer"),
    textInputHint = document.querySelector("#textInputHint"),
    tourMain = document.querySelector("main"),
    tourLayer = document.querySelector("#tourLayer"),
    tourHighlight = document.querySelector("#tourHighlight"),
    tourCard = document.querySelector("#tourCard"),
    tourBadge = document.querySelector(".tour-badge"),
    tourProgress = document.querySelector("#tourProgress"),
    tourProgressTrack = document.querySelector("#tourProgressTrack"),
    tourProgressBar = document.querySelector("#tourProgressBar"),
    tourTitle = document.querySelector("#tourTitle"),
    tourBody = document.querySelector("#tourBody"),
    tourBackButton = document.querySelector("#tourBack"),
    tourNextButton = document.querySelector("#tourNext"),
    tourSkipButton = document.querySelector("#tourSkip"),
    changelogLayer = document.querySelector("#changelogLayer"),
    changelogDialog = document.querySelector("#changelogDialog"),
    changelogCloseButton = document.querySelector("#changelogClose"),
    changelogDoneButton = document.querySelector("#changelogDone"),
    settingsLayer = document.querySelector("#settingsLayer"),
    settingsBackdrop = document.querySelector("#settingsBackdrop"),
    settingsPanel = document.querySelector("#settingsPanel"),
    settingsButton = document.querySelector("#settingsBtn"),
    settingsCloseButton = document.querySelector("#settingsClose"),
    settingsAutoToggle = document.querySelector("#settingsAutoToggle"),
    summonToggle = document.querySelector("#summonToggle"),
    settingsTourButton = document.querySelector("#settingsTourBtn"),
    settingsChangelogButton = document.querySelector("#settingsChangelogBtn");
  const DRAW = window.LUMI6_DRAW || {};
  const SELECT = window.LUMI6_SELECTION || {};
  const TOUR = window.LUMI6_TOUR || {
    resolveInitialLanguage: (p, l) => p || l || "en",
    parseProgress: () => ({ seen: [] }),
    markSeen: (prog, ids) => ({ seen: Array.from(new Set([...(prog?.seen || []), ...(ids || [])])) }),
    serializeProgress: (prog) => JSON.stringify(prog || { seen: [] }),
    rectHasArea: (rect) => Boolean(rect && rect.width > 0 && rect.height > 0),
    unionRects: (rects) => rects[0] || { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 },
    placeCoachmark: () => ({ left: 0, top: 0 }),
    unseenSteps: () => [],
    keyAction: () => null
  };
  const MIXED_TEXT = window.LUMI6_MIXED_TEXT || {};
  const ANIMATION = window.LUMI6_ANIMATION || {};
  const PLUGINS = window.LUMI6_PLUGINS || {
    parse: () => null
  };
  const SUMMON = window.LUMI6_SUMMON || {};
  const EFFORT_LEVELS = ["none", "low", "medium", "high", "max"],
    EFFORT_OPTIONS = ["config", ...EFFORT_LEVELS],
    TEXT_EDITOR_DEFAULT_WIDTH = 280,
    TEXT_EDITOR_DEFAULT_HEIGHT = 48,
    TEXT_EDITOR_MIN_WIDTH = 140,
    TEXT_EDITOR_MIN_HEIGHT = 44,
    TEXT_EDITOR_FONT_CSS = 32,
    TEXT_EDITOR_PREVIEW_INTERVAL_MS = 80,
    TEXT_EDITOR_FONT_FAMILY = '"Patrick Hand", "Segoe Print", "Comic Sans MS", cursive',
    TEXT_INPUT_GUARD_MS = 500,
    TEXT_INPUT_MAX_LENGTH = 2000,
    MAX_VISIBLE_TEXT_BOXES = 50,
    MIXED_FORMULA_MAX_LENGTH = 512,
    AI_TEXT_MAX_LENGTH = 1000,
    COPY_FEEDBACK_MS = 1600,
    NAVIGATION_HINT_VISIBLE_MS = 10000,
    ANIMATION_CONTROLS_VISIBLE_MS = 10000;
  const MAX_SHARP_OVERLAY_PIXELS = 8000000,
    MAX_SHARP_OVERLAY_ITEM_PIXELS = 2500000,
    MAX_VISIBLE_ANIMATIONS = 100,
    MAX_VISIBLE_WIDGETS = 100,
    MAX_VISIBLE_IMAGES = 100,
    MAX_IMAGE_SOURCE_BYTES = 32 * 1024 * 1024,
    MAX_IMAGE_DIMENSION = 2048,
    MAX_IMAGE_PIXELS = 16 * 1024 * 1024,
    MAX_WIDGET_HTML_LENGTH = 200000,
    MAX_WIDGET_COPY_TEXT_LENGTH = 16000,
    MAX_DIAGRAM_SOURCE_BYTES = 100 * 1024,
    MAX_WIDGET_CONTENT_DIMENSION = 1000000,
    WIDGET_SNAPSHOT_TIMEOUT_MS = 12000;
  const PLUGIN_TEMPLATE_DOCUMENTS = Object.freeze({
    simple: `---
lumi6-plugin: 1
id: air-quality
name: Air Quality
version: 1
description: Show air quality for a place in a live canvas widget.
category: Environment
source: Public web API
connect:
recommended-refresh-seconds: 900
---

# Air Quality

Show air quality for a location.

## Output contract

Return exactly one html_widget command and no prose, with pluginId:"air-quality". Generate a complete responsive HTML document that uses the place from the user's request, displays the most important air-quality information clearly, and keeps the outer layout transparent.

## Runtime rules

The generated HTML must fetch data directly in the user's browser, own its refresh timer, and show loading, error, and last-update states. Improve with AI before saving so this draft gains exact browser-accessible API origins, endpoint URLs, parameters, response fields, and instructions for constructing and using those URLs inside the HTML.

## One-shot example

User writes "Show air quality for Tokyo", names a place, and points to an empty area. Produce one html_widget there that uses that place in its API requests and displays the resulting air-quality information in large readable type.`,
  });
  const PLUGIN_TEMPLATE_STYLES = Object.freeze({ simple:"" });
  const I18N = {
    en: {
      title: "Lumi6 | Handwritten AI Canvas",
      tagline: "Write across twenty thousand squares and summon knowledge",
      taglineArcane: "Interdisciplinary intuition, creative synthesis, and exploratory explanation",
      taglineScifi: "Engineering, programming, system design, and future-technology analysis",
      taglineResearch: "Mathematical physics, rigorous teaching, and verifiable code",
      taglineStudio: "A clean, focused studio for clear structure and practical answers",
      taglineIndic: "Knowledge, Indian culture, science, languages, and rich structural insights",
      taglineCanvasPro: "Professional whiteboard with dedicated AI teaching assistant drawer",
      language: "Language",
      theme: "Theme",
      themeArcane: "Arcane",
      themeScifi: "Sci-fi",
      themeResearch: "Research",
      themeStudio: "Studio",
      themeIndic: "Indic",
      themeCanvasPro: "Canvas Pro",
      themeFocusArcane: "Favors interdisciplinary insight, intuitive analogy, and creative exploration",
      themeFocusScifi: "Favors engineering, debugging, system design, and future technology",
      themeFocusResearch: "Favors mathematical physics, rigorous derivation, teaching, and code verification",
      themeFocusStudio: "Favors clean layout, concise structured answers, and practical next steps",
      themeFocusIndic: "Favors rich cultural synthesis, Indian knowledge systems, ancient science, literature, languages, and vibrant structured explanations",
      themeFocusCanvasPro: "Favors professional whiteboard tools and right-side ATLAS AI assistant",
      guideArcane: "Arcane knowledge crystal",
      guideScifi: "Holographic analysis core",
      guideResearch: "Einstein scientific mentor",
      guideStudio: "Studio assistant",
      guideIndic: "Indic AI knowledge guide",
      guideCanvasPro: "ATLAS AI Teaching Assistant",
      boardTools: "Board tools",
      hand: "Hand tool: move canvas and objects",
      pen: "Pen",
      eraser: "Eraser",
      select: "Lasso select",
      text: "Text input",
      textMixedMode: "Preview Markdown + LaTeX formatting",
      textMixedModeShort: "Preview",
      textEditMode: "Return to editing",
      textPreview: "Markdown and LaTeX preview",
      textConfirm: "Confirm text",
      textCancel: "Discard text",
      textPlaceholder: "Type here",
      boardReply: "Reply",
      boardReplyHint: "Type your answer in the text box",
      textConfirmHint: "to confirm",
      textEmpty: "Enter some text first",
      textMixedModeError: "Mixed formatting was unavailable; plain text was inserted",
      textHelp: "Text formatting help",
      addImage: "Add image or photo",
      copyFromClipboard: "Copy text or image from clipboard",
      clipboardReading: "Reading clipboard...",
      clipboardTextAdded: "Clipboard text added. Move or resize the text box, then confirm.",
      clipboardUnsupported: "Clipboard format not supported. Copy plain text or an image.",
      clipboardReadFailed: "Could not read the clipboard. Allow clipboard access or use Ctrl/Cmd+V.",
      imageLoading: "Preparing image...",
      imageAdded: "Image added",
      imageSelected: "Editing image: drag the top handle to move, use edge handles to resize, or choose a side action",
      imageMerged: "Merged into canvas ink — the eraser now works on it",
      imageEditBarLabel: "Image actions",
      imagePlace: "Place image",
      imagePlaceHint: "Keep it as an image; use Hand and its top handle to edit again",
      imageMerge: "Merge into ink",
      imageMergeHint: "Fuse into the canvas; the eraser then works on it",
      imageDelete: "Delete image",
      imageDeleteHint: "Remove this image from the canvas",
      imageDeleted: "Image deleted",
      imageLimitReached: "Image limit reached (100). Delete an image before adding another.",
      imageTooLarge: "The selected image is too large (32 MB maximum)",
      imageUnsupported: "This image format could not be opened",
      imageImportFailed: "The image could not be added",
      textHelpTitle: "Markdown + LaTeX",
      textHelpClose: "Close text help",
      textHelpIntro: "Type normally; line breaks are preserved. Markdown and likely LaTeX are formatted automatically when confirmed; Preview shows the result.",
      textHelpMarkdown: "Use # for headings, - for lists, **text** for bold, and *text* for italic.",
      textHelpMath: "You may use $...$, but common bare TeX such as \\pi, \\frac{a}{b}, A_x, and \\sin(x) is recognized too.",
      textHelpConfirm: "Press Ctrl/Cmd + Enter to confirm.",
      textHelpExampleTitle: "Example",
      textHelpExample: "# Kinematics\n**Speed:** $v=\\frac{d}{t}$\n- Area: $A=\\pi r^2$",
      textHelpDone: "Got it",
      penSize: "Pen size",
      autoAI: "Auto AI",
      autoEnabled: "Auto ({delay}s)",
      autoDisabled: "Manual AI",
      autoDelay: "Auto AI delay",
      autoToolboxPending: "Auto AI paused: settle the open toolbox or trigger AI manually",
      aiTools: "AI tools",
      grid: "Canvas grid",
      gridOn: "Show canvas grid",
      gridOff: "Hide canvas grid",
      researchGridDefault: "Research grid (off by default)",
      font: "Font",
      aiFont: "AI font",
      reasoningEffort: "Reasoning effort",
      reasoningEffortDisplay: "Reasoning ({level})",
      effortConfigured: "Configured",
      effortConfiguredShort: "Conf",
      effortNone: "None",
      effortLow: "Low",
      effortMedium: "Medium",
      effortMediumShort: "Med",
      effortHigh: "High",
      effortMaximum: "Max",
      inkColor: "Ink color",
      fontRounded: "Rounded",
      fontHand: "Handwritten",
      fontSerif: "Classic serif",
      fontSans: "Sans serif",
      aiColor: "AI color",
      colorBlue: "Blue",
      colorBlack: "Ink black",
      colorRed: "Red",
      colorOrange: "Orange",
      colorGold: "Gold",
      colorGreen: "Green",
      colorCyan: "Cyan",
      colorPurple: "Purple",
      undo: "Undo",
      redo: "Redo",
      fullscreen: "Fullscreen",
      exitFullscreen: "Exit fullscreen",
      clear: "Clear",
      debug: "Debug",
      canvas: "Zoomable handwritten AI canvas",
      aiGuide: "AI knowledge guide",
      openAIMenu: "Open AI action menu",
      aiActions: "AI actions",
      answer: "Answer",
      hint: "Hint",
      continue: "Continue",
      explain: "Explain",
      plot: "Plot",
      tip: "Pan: middle-mouse drag, Hand tool, or one finger · Zoom: wheel or pinch",
      tourReplay: "Feature tour",
      tourDialog: "Lumi6 feature tour",
      tourBadge: "Quick tour",
      tourBadgeNew: "What's new",
      tourProgress: "Tour progress",
      tourStepCounter: "Step {current} of {total}",
      tourSkip: "Skip tour",
      tourBack: "Back",
      tourNext: "Next",
      tourDone: "Finish",
      tourEffortTitle: "Choose how deeply AI reasons",
      tourEffortBody: "AI Effort controls the reasoning depth used for each request. Higher levels suit difficult derivations and multi-step problems, but can take longer. Configured uses the default selected in your local setup.",
      tourPluginsTitle: "Real photos and professional diagrams",
      tourPluginsBody: "Real Photos is on by default and usually shows one web photo. Professional Diagrams is also on by default and creates editable professional visuals with copyable source. Manage both in Plugins.",
      tourHandTitle: "Move objects with the Hand tool",
      tourHandBody: "Choose Hand, then use the small top handle to move outlined images, animations, and AI HTML widgets. Hand also lets you click inside HTML widgets; drag empty space to pan.",
      tourStudioThemeTitle: "Try the new Studio theme",
      tourStudioThemeBody: "Open Theme to switch the canvas's visual style and the AI's response emphasis. The new Studio theme uses a clean, focused interface and favors concise, well-structured, practical answers. You can switch themes at any time.",
      tourLassoTitle: "Work with exactly the content you select",
      tourLassoBody: "With a mouse or stylus, draw a closed loop around handwriting. Drag the selected region to move it; use the right edge, bottom edge, or lower-right corner to resize it. The selection toolbar can typeset handwriting, delete it, or cancel. Selection-scoped AI requests do not reference the rest of the canvas.",
      tourTextTitle: "Add editable text and formulas",
      tourTextBody: "Choose Text, then click the canvas to create an input box. Markdown and likely LaTeX are formatted automatically; Preview shows the exact placement before confirmation. Confirm with the check button or Ctrl/Cmd + Enter.",
      tourImageTitle: "Add images and photos",
      tourImageBody: "Add a picture from your device; large pictures are compressed automatically. In Hand, use its top handle to move it and edge handles to resize. Place keeps it below ink, while Merge makes it erasable.",
      tourFullscreenTitle: "Give the canvas the whole screen",
      tourFullscreenBody: "Fullscreen hides surrounding browser space and expands the drawing area. Use the same button—or your browser's fullscreen shortcut—to return.",
      tourFilesTitle: "Start, export, and save locally",
      tourFilesBody: "New starts a clean canvas and offers to save confirmed work first. Download exports all visible ink as a cropped PNG. History opens local snapshots, where you can name, save, reload, or delete canvases. Unconfirmed AI drafts are not saved.",
      tourManualAITitle: "Ask AI for a specific kind of help",
      tourManualAIBody: "Click the magic orb to open manual AI actions such as Answer, Hint, Continue, Explain, and Plot. Manual requests use the current canvas context—or only the lasso selection when one is active.",
      tourStatusTitle: "Follow every AI request and result",
      tourStatusBody: "This status indicator reports when AI is observing, writing, finished, delayed, or needs confirmation. When a multi-part draft is ready, nearby controls let you accept or discard the complete response.",
      tourCanvasTitle: "Navigate the large canvas",
      tourCanvasBody: "Write with a mouse or stylus. Pan with one finger, the middle mouse button, or Alt-drag. Zoom with a wheel or trackpad, and pinch with two fingers. Your pointer position and zoom level are shown below the canvas.",
      changelogDialog: "Lumi6 release notes",
      changelogClose: "Close release notes",
      changelogBadge: "What's new",
      changelogTitle: "Professional diagrams, editable source, and precise refinement",
      changelogIntro: "Version 0.8.0 expands Lumi6 from flowcharts into professional engineering, scientific, software, and business diagrams.",
      changelogPluginEnableNote: "Professional Diagrams is on by default. You can turn it off at any time from Plugins.",
      changelogVisualPlugins: "Professional Diagrams chooses an appropriate editable domain format. Supported formats render locally in the existing iframe; specialized or unlisted formats can use generated HTML while preserving copyable professional source.",
      changelogCanvasWorkflow: "Draw or describe the professional diagram you need; Lumi6 chooses a suitable format and returns it as a canvas widget.",
      changelogPluginRefine: "Plugin-returned widgets can be refined directly: draw the requested changes over the widget with the Pen, then click the Refine button that appears. This workflow applies only to plugin widgets.",
      changelogDesktopAccess: "Professional Diagrams is second in the plugin list and on by default. Its compact capability guide adds about 1.5k–2k prompt tokens per AI request; full renderer CSS and libraries stay local and load only when needed.",
      changelogEarlierTitle: "Earlier highlights",
      changelogImagesSummary: "0.7.2 added sourced web photos, more reliable canvas persistence and export, and simpler protected local access.",
      changelogPluginsSummary: "0.7.1 added local images and photos with canvas-native editing, snapshots, PNG export, and early copyable flowcharts.",
      changelogAnimation: "0.7.0 introduced sandboxed HTML plugins; 0.6.0 introduced controllable declarative animation scenes.",
      changelogDone: "Got it",
      settingsTitle: "Settings",
      settingsClose: "Close settings",
      settingsAISection: "AI",
      settingsSummonSection: "Thinking indicator",
      settingsSummonEnabled: "Show while AI thinks",
      settingsSummonDescription: "A changing mathematical form and quiet text appear while each request runs.",
      settingsChangelog: "What's new",
      settingsHelpSection: "Help & about",
      settingsDownloadMac: "Download for macOS",
      settingsDownloadWin: "Download for Windows",
      settingsGitHub: "GitHub repository",
      summonPhrase1: "I’m following the trail your pen left behind...",
      summonPhrase2: "Give me a moment—I’m fitting the pieces on the canvas together.",
      summonPhrase3: "This deserves another look. I’m still thinking with you.",
      summonPhrase4: "I’m turning the question around to see its other side...",
      summonPhrase5: "No rush. The answer is beginning to take shape.",
      summonPhrase6: "I’m looking for the most honest explanation between these lines.",
      summonPhrase7: "Thinking is not waiting for an answer; it is making the question clearer.",
      summonPhrase8: "The canvas keeps the marks; understanding gives them direction.",
      summonPhrase9: "Every line is a question that has not quite finished speaking.",
      summonPhrase10: "Intelligence may begin with calculation; understanding begins with attention.",
      summonPhrase11: "Let’s turn this hazy idea into something we can both see.",
      summonPhrase12: "An answer is not an ending. It is where the next stroke begins.",
      summonTip1: "Tip: create professional diagrams for engineering, science, software, and business.",
      summonTip2: "Tip: professional diagrams preserve editable source that you can copy into other tools.",
      summonTip3: "Tip: add a few strokes beside a diagram, then use AI Refine to update only that diagram.",
      summonTip4: "Tip: AI Refine tries to preserve the diagram’s format, layout, terminology, and visual style.",
      summonTip5: "Tip: professional diagram renderers load only when needed; simply viewing them uses no model tokens.",
      summonTip6: "Tip: Professional Diagrams is on by default and can be turned off from Plugins.",
      summonTip7: "Tip: Real Photo Search places sourced web photos directly on the canvas.",
      summonTip8: "Tip: use Hand to move and freely resize images, animations, and AI widgets.",
      summonTip9: "Tip: remote images remain included when you save the canvas or export a PNG.",
      summonTip10: "Tip: save a canvas to the Lumi6 server so other authorized devices can open it.",
      summonTip11: "Tip: pause a few seconds after writing and AI replies on its own; auto mode can be toggled in Settings.",
      summonTip12: "Tip: click the AI orb on the canvas to manually pick Answer, Hint, Continue, Explain, or Plot.",
      summonTip13: "Tip: circle content with the lasso and AI will work only on that selection.",
      summonTip14: "Tip: the text tool understands Markdown and LaTeX; press Ctrl/Cmd + Enter to confirm.",
      summonTip15: "Tip: AI drafts can be moved as a group, or accepted and discarded item by item.",
      summonTip16: "Tip: raise the Reasoning effort in the toolbar for harder problems.",
      summonTip17: "Tip: plugins add focused capabilities and can be switched off when you do not need them.",
      summonTip18: "Tip: History can update the current snapshot or save a separate new copy.",
      summonTip19: "Tip: zoom with the wheel, pan with the middle mouse button—the canvas spans twenty thousand squares.",
      summonTip20: "Tip: AI ink color lives in the toolbar; AI font lives in this Settings panel.",
      debugTitle: "Lumi6 debug",
      openLocalLog: "Open local server log",
      history: "Canvas history",
      historyTitle: "Canvas history",
      historyDescription: "Stores confirmed canvas content, including restorable animation scenes. Unconfirmed AI drafts are excluded.",
      saveLocation: "Save location",
      storageThisDevice: "This device",
      storageLumi6Server: "Lumi6 server",
      storageThisDeviceDescription: "Saved only in this browser on this device. Other devices cannot see it.",
      storageLumi6ServerDescription: "Saved on the computer running Lumi6. Anyone using this Lumi6 service can see it after passing its access check.",
      closeHistory: "Close history",
      newCanvas: "New",
      saveCanvas: "Save canvas",
      saveCurrentSnapshot: "Save",
      exportPng: "Export PNG",
      newCanvasTitle: "Start a new board?",
      newCanvasDescription: "Save this board first, or start with a clean one.",
      currentSnapshot: "Current snapshot: {name} · {location}",
      noCurrentSnapshot: "There is no current snapshot to overwrite.",
      currentSnapshotOtherLocation: "Current snapshot {name} is in {location}. Select that location to overwrite it.",
      newSnapshotName: "Name for new snapshot (optional)",
      cancel: "Cancel",
      newWithoutSave: "Don't save",
      saveAsNewAndCreate: "Save & start new",
      overwriteAndCreate: "Replace this one",
      snapshotName: "Snapshot name (optional)",
      saveSnapshot: "Save New",
      snapshotSaving: "Saving canvas...",
      snapshotSavingShort: "Saving...",
      loadSnapshot: "Load",
      deleteSnapshot: "Delete",
      emptyDeviceHistory: "No canvases saved on this device yet",
      emptyServerHistory: "No canvases saved on this Lumi6 server yet",
      emptyCanvas: "The canvas is empty",
      snapshotSaved: "Canvas snapshot saved",
      snapshotOverwritten: "Current snapshot overwritten",
      snapshotLoaded: "Canvas snapshot loaded",
      snapshotDeleted: "Canvas snapshot deleted",
      newCanvasReady: "New canvas ready",
      exportComplete: "PNG exported",
      exportError: "Export: ",
      snapshotError: "Canvas history: ",
      snapshotTiles: "canvas tiles",
      snapshotImages: "images",
      deleteSnapshotConfirmDevice: "Delete this snapshot from this device?",
      deleteSnapshotConfirmServer: "Delete this shared snapshot from the Lumi6 server?",
      footerTip: "AI drafts: move the whole group or adjust, accept, and discard items independently",
      ready: "Ready",
      aiBusy: "AI is working. Please wait.",
      noInk: "Write something first",
      cannotCapture: "Could not capture the newest handwriting",
      observing: "Observing...",
      deferred: "New ink found; this AI result was deferred",
      writing: "Writing...",
      aiDone: "AI complete",
      draftRejected: "AI draft discarded",
      draftFading: "Continued writing detected; fading the AI draft",
      canvasChanged: "Canvas changed; the old AI draft was discarded",
      draftReady: "Drag the AI draft to move it; use its handles to resize",
      batchDraftReady: "Drag an item to move it; drag the group frame or blank space to move all; use the group corner to resize",
      itemAccepted: "AI item accepted; remaining drafts are still editable",
      itemDiscarded: "AI item discarded; remaining drafts are still editable",
      copyText: "Copy content",
      textCopied: "Copied",
      textCopyFailed: "Could not copy content",
      rejectBatch: "Discard all AI drafts",
      acceptBatch: "Accept all AI drafts",
      outsideCanvas: "This is outside the canvas. Write on the paper.",
      selectionEmpty: "The selected area has no ink",
      selectionTooSmall: "Draw a larger closed lasso around some ink",
      selectionReady: "Move or resize the selected lasso region",
      selectionCommitted: "Selection applied locally",
      selectionCancelled: "Selection cancelled",
      selectionRecolored: "Selection color changed locally",
      selectionTools: "Selection tools",
      selectionScopeNotice: "AI answers use only this selected region",
      selectionTypeset: "Typeset",
      selectionVisualize: "Visualize",
      selectionVisualizing: "Visualizing...",
      selectionVisualizeFailed: "Could not make a picture from that selection",
      selectionDelete: "Delete",
      selectionCancel: "Cancel",
      selectionKeep: "Keep",
      selectionDiscard: "Discard",
      selectionTypesetting: "Typesetting selection...",
      selectionDeleted: "Selected region deleted",
      pendingConfirm: "Confirm or discard the current AI draft first",
      merged: "AI merged",
      plugins: "Plugins",
      pluginManagerTitle: "Plugin manager",
      pluginManagerDescription: "Choose which capabilities the AI can use. Disabled plugins add no prompt or canvas widget runtime.",
      closePlugins: "Close plugins",
      pluginSources: "Plugin sources",
      localPlugins: "Local plugins",
      createPlugin: "Create",
      pluginPreview: "Preview",
      serverPlugins: "Server plugins",
      comingSoon: "Coming soon",
      refreshPlugins: "Refresh local plugins",
      serverPluginsComingTitle: "Server plugin marketplace is coming",
      serverPluginsComingDescription: "Published plugins, free or points-priced downloads, server selection, trust details, and updates will appear here after the Lumi6 website launches.",
      pluginBuiltIn: "Built in",
      pluginLocal: "Local Markdown",
      pluginPersonalSection: "Your plugins",
      pluginBuiltInSection: "Built-in plugins",
      pluginRecommended: "Recommended",
      generalPluginRecommendedHelp: "Recommended. Gives AI a flexible way to present rich interactive and dynamic content when ordinary canvas output is not enough.",
      pluginUsageTitle: "How to use",
      pluginUsageDescription: "For custom interfaces, enable General HTML and write a request such as “a colorful live clock.” For live data, enable its source and ask for “Shanghai weather” or “Kweichow Moutai daily chart.” An arrow or box can choose where the widget appears; data is fetched directly by your browser.",
      pluginSourceLabel: "Source: {source}",
      pluginApiLabel: "API: {origins}",
      pluginNoNetwork: "No network access",
      pluginPromptEstimate: "adds about {tokens} prompt tokens to each AI request while enabled; once on canvas, display, interaction, refresh, and rendering use no tokens",
      pluginRefreshRate: "refresh {time}",
      pluginDetails: "Details",
      pluginDetailsFor: "{name} plugin details",
      copyPluginMarkdown: "Copy Markdown",
      pluginMarkdownCopied: "Copied",
      pluginMarkdownCopyFailed: "Copy failed",
      duplicatePlugin: "Create editable copy",
      pluginCopyName: "Copy of {name}",
      pluginCopyDraftReady: "Editable copy of {name} is ready. Review and save it as your own plugin.",
      pluginBuiltInRuntime: "Built-in runtime capability",
      pluginDefaultState: "Default: {state}",
      pluginRequestField: "Request field: {field}",
      pluginStateEnabled: "enabled",
      pluginStateDisabled: "disabled",
      pluginMinute: "{count} min",
      pluginHour: "{count} hr",
      pluginDay: "{count} day",
      pluginCatalogLoading: "Refreshing local plugin directory...",
      pluginCatalogReady: "{count} plugins found · {enabled} enabled",
      pluginCatalogFailed: "Local plugin directory could not be refreshed",
      pluginNoDescription: "Local plugin capability",
      createPluginTitle: "Create a local plugin",
      createPluginDescription: "Preview: this workflow has limited testing. Describe the capability in the template, then preferably use Improve with AI before saving so endpoints, runtime rules, and the display title are completed for you.",
      sharePluginComing: "Share for points · Coming soon",
      pluginTemplateLabel: "Template",
      pluginSimpleTemplate: "Simple HTML",
      pluginTitleLabel: "Plugin title",
      pluginTitlePlaceholder: "Filled automatically by Improve with AI, or enter your own",
      pluginDocumentLabel: "Plugin Markdown",
      pluginDocumentHint: "Prefer Improve with AI before saving. The final document needs frontmatter and an exact One-shot example.",
      pluginStylesLabel: "Plugin CSS (optional)",
      pluginStylesHint: "Saved CSS is injected only when this plugin's widget is mounted; it does not load at canvas startup. Edit here or import a .css file. Put external JS/CSS URLs in generated widget HTML.",
      pluginStylesImport: "Import .css",
      pluginStylesImported: "Imported {name}. Review the preview before saving.",
      pluginStylesFileType: "Choose a .css file",
      pluginStylesFileTooLarge: "CSS file must be 32000 bytes or smaller",
      pluginStylesReadFailed: "CSS file could not be read: {error}",
      pluginStylesPreview: "Plugin CSS preview",
      improvePluginWithAi: "Improve with AI",
      saveAndEnablePlugin: "Save and enable",
      pluginMarketplaceNote: "The future marketplace will support free or points-priced downloads. Authors will be able to share plugins and earn points.",
      pluginBytes: "{bytes} / 12000 bytes",
      pluginStylesBytes: "{bytes} / 32000 bytes",
      pluginDraftValid: "Ready to save as {name}",
      pluginDraftInvalid: "Fix the plugin document: {error}",
      pluginIdExists: "Plugin id {id} already exists",
      pluginIdReserved: "Plugin id {id} is reserved",
      pluginImproving: "AI is improving the capability contract...",
      pluginImproved: "AI improvement is ready. Review it before saving.",
      pluginImproveFailed: "AI improvement failed: {error}",
      pluginSaving: "Saving local plugin...",
      pluginSaved: "{name} was saved and enabled",
      pluginSaveFailed: "Plugin could not be saved: {error}",
      deletePlugin: "Delete plugin",
      deletePluginConfirm: "Delete the local plugin “{name}”? Existing widgets created with it will stop running.",
      pluginDeleting: "Deleting {name}...",
      pluginDeleted: "{name} was deleted",
      pluginDeleteFailed: "Plugin could not be deleted: {error}",
      animationPlugin: "Animation scenes",
      animationPluginCost: "Adds about 500–600 prompt tokens per AI request",
      animationPluginDisabledHelp: "When enabled, the model can return animated demonstrations when explicitly requested or genuinely useful.",
      animationControls: "Animation controls",
      animationPlay: "Play",
      animationPause: "Pause",
      animationRestart: "Restart",
      animationDelete: "Delete animation",
      animationSelected: "Editing animation; drag the top handle to move, resize with edge or corner handles, then confirm or cancel",
      animationDeleted: "Animation deleted",
      animationLimitReached: "Animation limit reached (100). Delete an animation before adding another.",
      snapshotAnimations: "animations",
      widgetAccept: "Keep widget",
      widgetDiscard: "Discard widget",
      widgetMove: "Move widget",
      widgetDelete: "Delete widget",
      widgetDeleted: "Widget deleted",
      widgetSourceCopied: "Widget source copied",
      widgetSourceCopyFailed: "Widget source could not be copied",
      widgetRefine: "AI Refine",
      widgetRefineHint: "Refine and replace this widget using its content and the current canvas",
      widgetRefinePending: "New marks detected near this diagram. Use its AI Refine button to update it, or choose a manual AI action above. Auto AI is paused.",
      widgetRefining: "AI is refining this widget",
      widgetReplacementReady: "Review the refined replacement",
      widgetExportFailed: "A live widget could not be captured. Wait for it to finish loading and try again.",
      widgetPluginUnavailable: "The plugin document could not be loaded",
      widgetLimitReached: "Live widget limit reached (100). Delete a widget before adding another.",
      snapshotWidgets: "live widgets",
      clearConfirm: "Clear the whole canvas?",
      timeout: "Request timed out",
      aiNoVisibleResponse: "AI returned no displayable content. Please retry or rephrase the request.",
    },
  };
  const PLUGIN_STORAGE_KEY = "lumi6-plugins",
    DIAGRAM_RUNTIME_VERSION = "lumi6-diagram-source-v1",
    DIAGRAM_SOURCE_FORMATS = new Set(["mermaid", "dot", "bpmn-xml", "vega-lite", "geojson", "smiles", "cytoscape-json"]),
    BUILTIN_PLUGIN_DEFINITIONS = Object.freeze([
      Object.freeze({
        id: "animation",
        labelKey: "animationPlugin",
        costKey: "animationPluginCost",
        helpKey: "animationPluginDisabledHelp",
        requestField: "animationEnabled",
        builtIn: true,
        defaultEnabled: true,
        legacyStorageKey: "lumi6-animation-plugin",
        onChange: applyAnimationPluginState,
      }),
    ]);
  const PLUGIN_DEFINITIONS = [...BUILTIN_PLUGIN_DEFINITIONS];
  const pluginManifests = new Map(),
    pluginLoadErrors = new Map(),
    widgetSnapshotRequests = new Map(),
    widgetHostPointerAnchors = new Map(),
    screenCalibration = new Map();
  let diagramRuntimePromise = null;
  let screenClientRatio = 1;
  function storedPluginSettings() {
    let stored = {};
    try {
      const parsed = JSON.parse(localStorage.getItem(PLUGIN_STORAGE_KEY) || "{}");
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) stored = parsed;
    } catch {}
    return Object.fromEntries(PLUGIN_DEFINITIONS.map((plugin) => {
      const legacy = plugin.legacyStorageKey ? localStorage.getItem(plugin.legacyStorageKey) : null,
        value = typeof stored[plugin.id] === "boolean" ? stored[plugin.id] : legacy === null ? plugin.defaultEnabled : legacy === "true";
      return [plugin.id, value];
    }));
  }
  const initialPlugins = storedPluginSettings();
  const storedPrimaryLanguage = localStorage.getItem("lumi6-language"),
    storedLegacyLanguage = localStorage.getItem("ghostboard-language"),
    storedTheme = localStorage.getItem("lumi6-theme") || localStorage.getItem("ghostboard-theme"),
    storedGrid = localStorage.getItem("lumi6-grid") ?? localStorage.getItem("ghostboard-grid"),
    storedResearchGrid = localStorage.getItem("lumi6-research-grid"),
    storedAutoEnabled = localStorage.getItem("lumi6-auto-ai"),
    storedAutoDelayText = localStorage.getItem("lumi6-auto-delay-ms"),
    storedSummonEnabled = localStorage.getItem("lumi6-summon-enabled"),
    storedSnapshotLocation = localStorage.getItem("lumi6-snapshot-location"),
    storedAiEffortText = String(localStorage.getItem("lumi6-ai-effort") || "").trim().toLowerCase(),
    storedAiEffort = storedAiEffortText === "xhigh" ? "max" : storedAiEffortText,
    storedAutoDelay = storedAutoDelayText === null ? NaN : Number(storedAutoDelayText),
    initialLanguage = TOUR.resolveInitialLanguage(storedPrimaryLanguage, storedLegacyLanguage),
    initialTheme = ["arcane", "scifi", "research", "studio", "indic"].includes(storedTheme) ? storedTheme : "studio",
    initialGrid = storedGrid === null ? true : storedGrid === "true",
    initialResearchGrid = storedResearchGrid === "true",
    configuredAutoDelay = Number(window.LUMI6_CONFIG?.autoAiDelayMs),
    configuredAiTimeout = Number(window.LUMI6_CONFIG?.aiRequestTimeoutMs),
    configuredAiEffort = String(window.LUMI6_CONFIG?.aiEffort || "").trim().toLowerCase(),
    configuredAccessSession = String(window.LUMI6_CONFIG?.accessSessionToken || sessionStorage.getItem("lumi6-access-session") || ""),
    serverAutoDelay = Number.isFinite(configuredAutoDelay) && configuredAutoDelay >= 0 ? configuredAutoDelay : DEFAULT_AUTO_DELAY,
    initialAutoDelay = Number.isFinite(storedAutoDelay) && storedAutoDelay >= 0 && storedAutoDelay <= 10000 ? storedAutoDelay : Math.min(10000, serverAutoDelay),
    initialAutoEnabled = false,
    initialSummonEnabled = storedSummonEnabled === null ? true : storedSummonEnabled === "true",
    initialSnapshotLocation = storedSnapshotLocation === "server" ? "server" : "device",
    initialAiEffort = EFFORT_OPTIONS.includes(storedAiEffort) ? storedAiEffort : EFFORT_OPTIONS.includes(configuredAiEffort) ? configuredAiEffort : "config",
    initialAiTimeout = Number.isFinite(configuredAiTimeout) && configuredAiTimeout >= 10000 ? configuredAiTimeout : DEFAULT_AI_TIMEOUT;
  function authenticatedApiHeaders(headers = {}) {
    return configuredAccessSession ? { ...headers, "X-Lumi6-Session":configuredAccessSession } : { ...headers };
  }
  const tiles = new Map(),
    state = {
      mode: "pen",
      shapeKind: "rect",
      shapeGesture: null,
      scale: 0.35,
      panX: 0,
      panY: 0,
      pen: 6,
      eraser: 35,
      aiFont: '"Patrick Hand", "Segoe Print", "Comic Sans MS", cursive',
      inkColor: "#1d4ed8",
      aiColor: "#2563eb",
      drawing: null,
      pointers: new Map(),
      touches: new Map(),
      touchGesture: null,
      panGesture: null,
      textEditors: new Map(),
      textBoxes: [],
      textEditorStyleSheet: null,
      nextTextEditorId: 1,
      nextTextBoxId: 1,
      nextTextEditorZ: 1,
      activeTextEditorId: null,
      selectedTextBoxId: null,
      textBoxHistoryBefore: null,
      animations: [],
      nextAnimationId: 1,
      selectedAnimationId: null,
      animationGesture: null,
      animationEdit: null,
      widgets: [],
      nextWidgetId: 1,
      pendingWidget: null,
      pendingWidgetReplacement: null,
      selectedWidgetId: null,
      widgetEdit: null,
      widgetGesture: null,
      widgetHostPan: null,
      widgetHistoryBefore: null,
      widgetRefineCandidate: null,
      widgetMessageHooked: false,
      plugins: { ...initialPlugins },
      animationFrame: 0,
      animationLastFrame: 0,
      animationFullRedraw: true,
      animationScreenBoxes: new Map(),
      animationRenderedPlayheads: new Map(),
      animationControlsTimer: 0,
      animationControlsUntil: 0,
      interactionRenderQueued: false,
      animationHistoryBefore: null,
      sharpOverlays: [],
      sharpOverlayPixels: 0,
      images: [],
      nextImageId: 1,
      selectedImageId: null,
      imageEdit: null,
      imageGesture: null,
      imageHistoryBefore: null,
      imageHandReturnMode: null,
      imageImporting: false,
      clipboardImporting: false,
      textInputBlockedUntil: 0,
      textTap: null,
      latestTypedInput: null,
      pending: null,
      pendingGesture: null,
      aiDraftReturnMode: null,
      pendingHistoryRestored: false,
      pointerPreview: null,
      copyGeneration: 0,
      selection: null,
      selectionGesture: null,
      lastInkBox: null,
      hotspotTrail: [],
      auto: initialAutoEnabled,
      summonEnabled: initialSummonEnabled,
      summonAnchor: null,
      timer: 0,
      autoPopoverTimer: 0,
      effortPopoverTimer: 0,
      pluginCatalogLoading: false,
      pluginCatalogLoaded: false,
      pluginCatalogError: "",
      pluginCatalogNotice: null,
      pluginDeleting: "",
      pluginDialogRestoreFocus: null,
      pluginAuthoringTemplate: "simple",
      pluginAuthoringBusy: false,
      pluginAuthoringStatus: null,
      autoDelayMs: initialAutoDelay,
      reasoningEffort: initialAiEffort,
      aiRequestTimeoutMs: initialAiTimeout,
      dirty: null,
      autoEligible: false,
      lastUserBox: null,
      history: [],
      future: [],
      historyBefore: new Map(),
      inkBounds: new Map(),
      busy: false,
      activeAI: null,
      snapshotLoadGeneration: 0,
      snapshotLocation: initialSnapshotLocation,
      currentSnapshotId: null,
      currentSnapshotName: "",
      currentSnapshotLocation: null,
      restoreGeneration: 0,
      recognitionGeneration: 0,
      userRevision: 0,
      lastRequestId: "—",
      viewInitialized: false,
      renderQueued: false,
      boardTitle: "New board",
      boardTitlePlaceholder: true,
      language: initialLanguage,
      theme: initialTheme,
      gridVisible: initialTheme === "research" ? initialResearchGrid : initialGrid,
      paint: { paper: "#ffffff", paperGrid: "rgba(0, 0, 0, 0.05)", outside: "#ffffff", border: "#e2e8f0" },
      navigationTimer: 0,
      radialGesture: null,
      radialCloseTimer: 0,
      radialSuppressClickUntil: 0,
      statusKey: "ready",
    };
  let textHelpInvoker = null;
  let pluginStylesPreviewReady = false,
    pluginStylesPreviewPayload = null;
  const AI_CANCELLED = "AI_CANCELLED";
  const AI_REJECTED = "AI_REJECTED";
  const AI_SUPERSEDED = "AI_SUPERSEDED";
  const FEATURE_TOUR_STORAGE_KEY = "lumi6-tour-progress";
  const CHANGELOG_STORAGE_KEY = "lumi6-changelog-seen";
  const CHANGELOG_VERSION = "0.8.0";
  // Keep seen IDs stable. Add a new ID (or bump its -vN suffix) to show only that feature to returning users.
  const FEATURE_TOUR_STEPS = Object.freeze([
    { id: "core-effort-v1", targets: ["#aiEffortButton"], titleKey: "tourEffortTitle", bodyKey: "tourEffortBody", placement: "bottom", radius: 8 },
    { id: "plugins-v3", targets: ["#pluginButton"], titleKey: "tourPluginsTitle", bodyKey: "tourPluginsBody", placement: "bottom", radius: 8 },
    { id: "hand-v1", targets: ["#handToolBtn"], titleKey: "tourHandTitle", bodyKey: "tourHandBody", placement: "bottom", radius: 7 },
    { id: "studio-theme-v1", targets: ["#theme"], titleKey: "tourStudioThemeTitle", bodyKey: "tourStudioThemeBody", placement: "bottom", radius: 8 },
    { id: "core-lasso-v1", targets: ["#lassoToolBtn"], titleKey: "tourLassoTitle", bodyKey: "tourLassoBody", placement: "bottom", radius: 7 },
    { id: "core-text-v1", targets: ["#textToolBtn"], titleKey: "tourTextTitle", bodyKey: "tourTextBody", placement: "bottom", radius: 7 },
    { id: "core-image-v1", targets: ["#imagePickerBtn"], titleKey: "tourImageTitle", bodyKey: "tourImageBody", placement: "bottom", radius: 7 },
    { id: "core-fullscreen-v1", targets: ["#fullscreenBtn"], titleKey: "tourFullscreenTitle", bodyKey: "tourFullscreenBody", placement: "bottom", radius: 7 },
    { id: "core-files-v1", targets: ["#canvasFileActions"], titleKey: "tourFilesTitle", bodyKey: "tourFilesBody", placement: "bottom", radius: 8 },
    { id: "core-manual-ai-v1", targets: ["#aiOrb"], titleKey: "tourManualAITitle", bodyKey: "tourManualAIBody", placement: "left", radius: 50 },
    { id: "core-status-v1", targets: ["#aiStatusArea"], titleKey: "tourStatusTitle", bodyKey: "tourStatusBody", placement: "bottom", radius: 999 },
    { id: "core-navigation-v1", targets: ["#viewport"], titleKey: "tourCanvasTitle", bodyKey: "tourCanvasBody", placement: "center", radius: 10, padding: 5 },
  ]);
  const featureTour = {
    active: false,
    steps: [],
    index: 0,
    progress: TOUR.parseProgress(null),
    replay: false,
    newOnly: false,
    restoreFocus: null,
    restoreScrollX: 0,
    restoreScrollY: 0,
    positionFrame: 0,
    retryFrame: 0,
    resizeObserver: null,
    pendingObserver: null,
    activeObserver: null,
    targets: [],
    shownIds: new Set(),
    autoChecked: false,
  };
  const changelog = {
    active: false,
    restoreFocus: null,
  };
  const COLOR_CLASS = {
    "#2563eb": "color-blue",
    "#1d4ed8": "color-blue",
    "#1f2937": "color-black",
    "#dc2626": "color-red",
    "#ea580c": "color-orange",
    "#ca8a04": "color-gold",
    "#eab308": "color-gold",
    "#16a34a": "color-green",
    "#0891b2": "color-cyan",
    "#9333ea": "color-purple",
    "#ffffff": "color-white",
    "#9ca3af": "color-gray",
    "#92400e": "color-brown",
    "#0d9488": "color-teal",
    "#db2777": "color-pink"
  };
  const runtimeStyleRules = new Map();
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
  function pluginEnabled(pluginId) {
    return state.plugins[pluginId] === true;
  }
  function diagramRuntime() {
    return window.LUMI6_DIAGRAM_RUNTIME || null;
  }
  function canonicalStoredDiagramFormat(value) {
    const format = String(value || "").trim().toLowerCase();
    return DIAGRAM_SOURCE_FORMATS.has(format) ? format : "";
  }
  function diagramSourceFits(value) {
    return typeof value === "string" && value.trim() && new TextEncoder().encode(value).length <= MAX_DIAGRAM_SOURCE_BYTES;
  }
  function loadDiagramRuntime() {
    if (diagramRuntime()) return Promise.resolve(diagramRuntime());
    if (diagramRuntimePromise) return diagramRuntimePromise;
    diagramRuntimePromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "plugins/flowchart/runtime.js";
      script.async = true;
      script.onload = () => {
        const runtime = diagramRuntime();
        if (runtime) resolve(runtime);
        else reject(Error("Professional diagram runtime did not initialize"));
      };
      script.onerror = () => reject(Error("Professional diagram runtime could not be loaded"));
      document.head.append(script);
    }).catch((error) => {
      diagramRuntimePromise = null;
      throw error;
    });
    return diagramRuntimePromise;
  }
  function ensurePluginRuntime(pluginId) {
    return pluginId === "flowchart" ? loadDiagramRuntime() : Promise.resolve(null);
  }
  async function enableSnapshotWidgetPlugins(items) {
    const pluginIds = [...new Set((Array.isArray(items) ? items : [])
      .map((item) => typeof item?.pluginId === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.pluginId) ? item.pluginId : "")
      .filter(Boolean))];
    if (!pluginIds.length) return;
    for (const pluginId of pluginIds) state.plugins[pluginId] = true;
    if (pluginIds.includes("flowchart") && items.some((item) => item?.pluginId === "flowchart" && item?.widgetType === "diagram_source")) {
      try { await ensurePluginRuntime("flowchart"); }
      catch (error) { state.pluginCatalogError = error.message; }
    }
    persistPluginSettings();
    syncWidgetRuntime();
    updatePluginControl();
  }
  function dataPluginDefinitions() {
    return PLUGIN_DEFINITIONS.filter((plugin) => plugin.documentPath);
  }
  function widgetRuntimeEnabled() {
    return state.widgetMessageHooked;
  }
  function syncWidgetRuntime() {
    const enabled = dataPluginDefinitions().some((plugin) => pluginEnabled(plugin.id) && pluginManifests.has(plugin.id));
    widgetLayer.hidden = !enabled;
    if (enabled === state.widgetMessageHooked) return;
    state.widgetMessageHooked = enabled;
    window[enabled ? "addEventListener" : "removeEventListener"]("message", handleWidgetMessage);
  }
  function enabledPluginDescriptors() {
    return dataPluginDefinitions().filter((plugin) => pluginEnabled(plugin.id))
      .map((plugin) => pluginManifests.get(plugin.id))
      .filter(Boolean)
      .sort((a, b) => {
        const priority = (id) => id === "general" ? 0 : id === "flowchart" ? 1 : 2,
          difference = priority(a.id) - priority(b.id);
        return difference || a.id.localeCompare(b.id);
      })
      .map((manifest) => ({
        id: manifest.id,
        name: manifest.name,
        version: manifest.version,
        connect: [...manifest.connect],
        recommendedRefreshSeconds: manifest.recommendedRefreshSeconds,
        document: manifest.document,
      }));
  }
  function pluginRequestPayload() {
    const payload = Object.fromEntries(PLUGIN_DEFINITIONS.filter((plugin) => plugin.requestField && pluginEnabled(plugin.id)).map((plugin) => [plugin.requestField, true])),
      plugins = enabledPluginDescriptors();
    if (plugins.length) payload.plugins = plugins;
    return payload;
  }
  function validPluginCatalogPath(value, extension) {
    if (typeof value !== "string") return null;
    const suffix = extension === "css" ? "styles\\.css" : "plugin\\.md",
      legacy = extension === "md" ? "|[a-z0-9][a-z0-9-]{0,63}\\.md" : "";
    return new RegExp(`^plugins/(?:private/)?(?:[a-z0-9][a-z0-9-]{0,63}/${suffix}${legacy})$`).test(value) ? value : null;
  }
  async function loadPluginDocuments() {
    if (state.pluginCatalogLoading) return false;
    state.pluginCatalogLoading = true;
    state.pluginCatalogError = "";
    updatePluginControl();
    updatePluginAuthoringUi();
    try {
      const response = await fetch("/api/plugins", { credentials:"same-origin", cache:"no-store" });
      if (!response.ok) throw Error(`HTTP ${response.status}`);
      const catalog = await response.json(), entries = (Array.isArray(catalog?.plugins) ? catalog.plugins : [])
        .map((entry) => ({
          path:validPluginCatalogPath(entry?.path, "md"),
          stylePath:entry?.stylePath ? validPluginCatalogPath(entry.stylePath, "css") : null,
          builtIn:entry?.builtIn !== false,
          error:typeof entry?.error === "string" ? entry.error : "",
        }))
        .filter((entry) => entry.path), uniqueEntries = [...new Map(entries.map((entry) => [entry.path, entry])).values()];
      const loaded = await Promise.all(uniqueEntries.map(async ({ path:documentPath, stylePath, builtIn, error:catalogError }) => {
        if (catalogError) return { documentPath, error:catalogError };
        try {
          const [documentResponse, styleResponse] = await Promise.all([
            fetch(documentPath, { credentials:"same-origin", cache:"no-store" }),
            stylePath ? fetch(stylePath, { credentials:"same-origin", cache:"no-store" }) : null,
          ]);
          if (!documentResponse.ok) throw Error(`HTTP ${documentResponse.status}`);
          if (styleResponse && !styleResponse.ok) throw Error(`CSS HTTP ${styleResponse.status}`);
          const [document, styles] = await Promise.all([documentResponse.text(), styleResponse ? styleResponse.text() : ""]),
            manifest = PLUGINS?.parse(document, styles);
          if (!manifest) throw Error("Plugin parser is unavailable");
          return { documentPath, stylePath, manifest, builtIn };
        } catch (error) {
          return { documentPath, error:error.message };
        }
      }));
      const definitions = [], manifests = new Map(), errors = new Map();
      for (const item of loaded) {
        if (item.error) {
          errors.set(item.documentPath, item.error);
          continue;
        }
        if (item.manifest.id === "animation" || manifests.has(item.manifest.id)) {
          errors.set(item.documentPath, "Plugin id is reserved or duplicated");
          continue;
        }
        manifests.set(item.manifest.id, item.manifest);
        definitions.push(Object.freeze({
          id:item.manifest.id,
          documentPath:item.documentPath,
          stylePath:item.stylePath,
          builtIn:item.builtIn,
          defaultEnabled:["general", "flowchart", "image-search", "weather"].includes(item.manifest.id),
        }));
      }
      definitions.sort((a, b) => (manifests.get(a.id)?.name || a.id).localeCompare(manifests.get(b.id)?.name || b.id));
      const generalDefinitions = definitions.filter((definition) => definition.id === "general"),
        professionalDefinitions = definitions.filter((definition) => definition.id === "flowchart"),
        promotedDefinitions = ["image-search", "weather"].map((id) => definitions.find((definition) => definition.id === id)).filter(Boolean),
        fixedDefinitionIds = new Set(["general", "flowchart", ...promotedDefinitions.map((definition) => definition.id)]),
        remainingDefinitions = definitions.filter((definition) => !fixedDefinitionIds.has(definition.id)),
        previousIds = new Set(dataPluginDefinitions().map((plugin) => plugin.id)), nextIds = new Set(definitions.map((plugin) => plugin.id));
      if (state.activeAI?.widgetEdit || state.pendingWidgetReplacement) cancelWidgetRefinement("plugin-catalog-reloaded");
      for (const widget of [...state.widgets, ...(state.pendingWidget ? [state.pendingWidget] : [])]) unmountWidget(widget);
      PLUGIN_DEFINITIONS.splice(0, PLUGIN_DEFINITIONS.length, ...generalDefinitions, ...professionalDefinitions, ...BUILTIN_PLUGIN_DEFINITIONS, ...promotedDefinitions, ...remainingDefinitions);
      pluginManifests.clear();
      for (const [id, manifest] of manifests) pluginManifests.set(id, manifest);
      pluginLoadErrors.clear();
      for (const [path, error] of errors) pluginLoadErrors.set(path, error);
      const stored = storedPluginSettings();
      for (const definition of definitions) if (typeof state.plugins[definition.id] !== "boolean") state.plugins[definition.id] = stored[definition.id];
      for (const id of previousIds) if (!nextIds.has(id)) state.plugins[id] = false;
      if (pluginEnabled("flowchart")) await ensurePluginRuntime("flowchart");
      if (state.pendingWidget && !pluginManifests.has(state.pendingWidget.pluginId)) rejectPendingWidget();
      if (state.widgetEdit && !pluginManifests.has(selectedWidget()?.pluginId)) acceptWidgetEdit();
      for (const widget of state.widgets) if (pluginEnabled(widget.pluginId)) mountWidget(widget);
      if (state.pendingWidget && pluginEnabled(state.pendingWidget.pluginId)) mountWidget(state.pendingWidget);
      state.pluginCatalogLoaded = true;
      syncWidgetRuntime();
      persistPluginSettings();
      requestRender();
      return true;
    } catch (error) {
      state.pluginCatalogError = error.message;
      return false;
    } finally {
      state.pluginCatalogLoading = false;
      updatePluginControl();
      updatePluginAuthoringUi();
    }
  }
  function persistPluginSettings() {
    let stored = {};
    try {
      const parsed = JSON.parse(localStorage.getItem(PLUGIN_STORAGE_KEY) || "{}");
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) stored = parsed;
    } catch {}
    localStorage.setItem(PLUGIN_STORAGE_KEY, JSON.stringify({ ...stored, ...Object.fromEntries(PLUGIN_DEFINITIONS.map((plugin) => [plugin.id, pluginEnabled(plugin.id)])) }));
  }
  function localizedManifestValue(manifest, field) {
    if (!manifest) return "";
    const localized = state.language === "zh" ? manifest[`${field}Zh`] : "";
    return localized || manifest[field] || "";
  }
  function pluginRefreshText(seconds) {
    const key = seconds >= 86400 && seconds % 86400 === 0 ? "pluginDay" : seconds >= 3600 && seconds % 3600 === 0 ? "pluginHour" : "pluginMinute",
      count = key === "pluginDay" ? seconds / 86400 : key === "pluginHour" ? seconds / 3600 : Math.max(1, Math.round(seconds / 60));
    return t("pluginRefreshRate").replace("{time}", t(key).replace("{count}", String(count)));
  }
  function pluginCatalogStatusText() {
    if (state.pluginCatalogLoading) return t("pluginCatalogLoading");
    if (state.pluginCatalogError) return `${t("pluginCatalogFailed")}: ${state.pluginCatalogError}`;
    if (state.pluginCatalogNotice) return pluginAuthoringText(state.pluginCatalogNotice);
    const plugins = dataPluginDefinitions(), enabled = plugins.filter((plugin) => pluginEnabled(plugin.id)).length;
    let text = t("pluginCatalogReady").replace("{count}", String(plugins.length)).replace("{enabled}", String(enabled));
    if (pluginLoadErrors.size) text += ` · ${pluginLoadErrors.size} invalid file${pluginLoadErrors.size === 1 ? "" : "s"}`;
    return text;
  }
  function renderPluginOptions() {
    if (!pluginOptions) return;
    const fragment = document.createDocumentFragment(),
      groups = [
        { titleKey: "pluginPersonalSection", plugins: PLUGIN_DEFINITIONS.filter((plugin) => plugin.builtIn === false) },
        { titleKey: "pluginBuiltInSection", plugins: PLUGIN_DEFINITIONS.filter((plugin) => plugin.builtIn !== false) },
      ];
    for (const group of groups) {
      if (!group.plugins.length) continue;
      const section = document.createElement("section"),
        heading = document.createElement("h3"),
        grid = document.createElement("div");
      section.className = "plugin-option-section";
      heading.className = "plugin-option-section-title";
      heading.textContent = t(group.titleKey);
      grid.className = "plugin-option-grid";
      for (const plugin of group.plugins) {
        const option = document.createElement("div"),
          label = document.createElement("label"),
          input = document.createElement("input"),
          copy = document.createElement("span"),
          titleRow = document.createElement("span"),
          title = document.createElement("strong"),
          help = document.createElement("small"),
          meta = document.createElement("span"),
          manifest = pluginManifests.get(plugin.id);
        option.className = "plugin-option";
        label.className = "plugin-option-toggle";
        label.htmlFor = `plugin-${plugin.id}`;
        input.id = label.htmlFor;
        input.type = "checkbox";
        input.dataset.pluginId = plugin.id;
        input.checked = pluginEnabled(plugin.id);
        input.disabled = Boolean(plugin.documentPath && !pluginManifests.has(plugin.id));
        copy.className = "plugin-option-copy";
        titleRow.className = "plugin-option-title";
        title.textContent = plugin.labelKey ? t(plugin.labelKey) : localizedManifestValue(manifest, "name") || plugin.id;
        titleRow.append(title);
        const badge = document.createElement("span");
        badge.className = "plugin-badge";
        badge.textContent = plugin.documentPath ? localizedManifestValue(manifest, "category") || t("pluginLocal") : t("pluginBuiltIn");
        titleRow.append(badge);
        if (plugin.id === "general") {
          const recommended = document.createElement("span");
          recommended.className = "plugin-badge recommended";
          recommended.textContent = t("pluginRecommended");
          titleRow.append(recommended);
        }
        help.textContent = plugin.id === "general" ? t("generalPluginRecommendedHelp") : plugin.helpKey ? t(plugin.helpKey) : localizedManifestValue(manifest, "description") || t("pluginNoDescription");
        meta.className = "plugin-option-meta";
        if (plugin.documentPath && manifest) {
          const bytes = new TextEncoder().encode(manifest.document).length,
            tokens = Math.ceil(bytes / 4),
            source = manifest.source || manifest.connect.map((origin) => new URL(origin).hostname).join(", "),
            sourceItem = document.createElement("span"),
            apiItem = document.createElement("span"),
            refreshItem = document.createElement("span"),
            tokenItem = document.createElement("span");
          sourceItem.className = "plugin-option-source";
          sourceItem.textContent = t("pluginSourceLabel").replace("{source}", source);
          apiItem.className = "plugin-option-api";
          apiItem.textContent = t("pluginApiLabel").replace("{origins}", manifest.connect.length ? manifest.connect.join(" · ") : t("pluginNoNetwork"));
          refreshItem.textContent = pluginRefreshText(manifest.recommendedRefreshSeconds);
          tokenItem.textContent = t("pluginPromptEstimate").replace("{tokens}", String(tokens));
          meta.append(sourceItem, apiItem, refreshItem, tokenItem);
        } else if (plugin.costKey) meta.append(document.createTextNode(t(plugin.costKey)));
        copy.append(titleRow, help, meta);
        label.append(input, copy);
        const actions = document.createElement("span");
        actions.className = "plugin-option-actions";
        const detailDocument = manifest?.document || (plugin.builtIn !== false ? [
          title.textContent,
          t("pluginBuiltInRuntime"),
          t("pluginDefaultState").replace("{state}", t(plugin.defaultEnabled ? "pluginStateEnabled" : "pluginStateDisabled")),
          ...(plugin.requestField ? [t("pluginRequestField").replace("{field}", plugin.requestField)] : []),
          "",
          help.textContent,
          ...(plugin.costKey ? [t(plugin.costKey)] : []),
        ].join("\n") : "");
        if (detailDocument) {
          const detailButton = document.createElement("button"),
            detail = document.createElement("section"),
            detailBar = document.createElement("span"),
            detailTitle = document.createElement("strong"),
            documentView = document.createElement("pre");
          detailButton.className = "plugin-detail-button";
          detailButton.type = "button";
          detailButton.dataset.pluginDetail = plugin.id;
          detailButton.setAttribute("aria-expanded", "false");
          detailButton.setAttribute("aria-controls", `plugin-detail-${plugin.id}`);
          detailButton.textContent = t("pluginDetails");
          detail.id = `plugin-detail-${plugin.id}`;
          detail.className = "plugin-option-detail";
          detail.hidden = true;
          detailBar.className = "plugin-option-detail-bar";
          detailTitle.textContent = t("pluginDetailsFor").replace("{name}", localizedManifestValue(manifest, "name") || title.textContent);
          detailBar.append(detailTitle);
          if (manifest?.document) {
            const copyButton = document.createElement("button");
            copyButton.className = "plugin-detail-copy";
            copyButton.type = "button";
            copyButton.dataset.pluginCopy = plugin.id;
            copyButton.textContent = t("copyPluginMarkdown");
            detailBar.append(copyButton);
          }
          documentView.textContent = detailDocument;
          detail.append(detailBar, documentView);
          actions.append(detailButton);
          option.append(detail);
        }
        if (plugin.documentPath && manifest?.document) {
          const duplicateButton = document.createElement("button");
          duplicateButton.className = "plugin-duplicate-button";
          duplicateButton.type = "button";
          duplicateButton.dataset.pluginDuplicate = plugin.id;
          duplicateButton.disabled = state.pluginAuthoringBusy;
          duplicateButton.setAttribute("aria-label", t("duplicatePlugin"));
          duplicateButton.setAttribute("title", t("duplicatePlugin"));
          duplicateButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="11" height="11" rx="1.5"/><path d="M15 14v5.5A1.5 1.5 0 0 1 13.5 21h-9A1.5 1.5 0 0 1 3 19.5v-9A1.5 1.5 0 0 1 4.5 9H9"/></svg>';
          actions.append(duplicateButton);
        }
        if (plugin.documentPath && plugin.builtIn === false) {
          const deleteButton = document.createElement("button");
          deleteButton.className = "plugin-delete-button";
          deleteButton.type = "button";
          deleteButton.dataset.pluginDelete = plugin.id;
          deleteButton.disabled = Boolean(state.pluginDeleting);
          deleteButton.setAttribute("aria-label", t("deletePlugin"));
          deleteButton.setAttribute("title", t("deletePlugin"));
          deleteButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5"/></svg>';
          actions.append(deleteButton);
        }
        option.prepend(label, actions);
        grid.append(option);
      }
      section.append(heading, grid);
      fragment.append(section);
    }
    pluginOptions.replaceChildren(fragment);
  }
  function updatePluginControl() {
    if (!pluginButton) return;
    renderPluginOptions();
    const anyEnabled = PLUGIN_DEFINITIONS.some((plugin) => pluginEnabled(plugin.id));
    pluginButton.classList.toggle("active", anyEnabled);
    pluginButton.setAttribute("aria-pressed", String(anyEnabled));
    if (pluginPopover) pluginButton.setAttribute("aria-expanded", String(!pluginPopover.hidden));
    if (pluginLocalCount) pluginLocalCount.textContent = String(PLUGIN_DEFINITIONS.length);
    if (pluginCatalogStatus) {
      pluginCatalogStatus.textContent = pluginCatalogStatusText();
      pluginCatalogStatus.classList.toggle("plugin-option-error", Boolean(state.pluginCatalogError) || state.pluginCatalogNotice?.type === "error");
    }
    if (pluginRefresh) {
      pluginRefresh.classList.toggle("loading", state.pluginCatalogLoading);
      pluginRefresh.disabled = state.pluginCatalogLoading;
    }
  }
  function togglePluginDetails(pluginId, button) {
    const detail = button?.closest(".plugin-option")?.querySelector(`#plugin-detail-${CSS.escape(pluginId)}`);
    if (!detail) return;
    const expanded = detail.hidden;
    detail.hidden = !expanded;
    button.setAttribute("aria-expanded", String(expanded));
  }
  async function copyPluginMarkdown(pluginId, button) {
    const document = pluginManifests.get(pluginId)?.document;
    if (!document || !button) return;
    const copied = await writeClipboardText(document),
      original = t("copyPluginMarkdown");
    button.textContent = t(copied ? "pluginMarkdownCopied" : "pluginMarkdownCopyFailed");
    clearTimeout(button._copyResetTimer);
    button._copyResetTimer = setTimeout(() => {
      if (button.isConnected) button.textContent = original;
    }, 1800);
  }
  function nextPluginCopyId(pluginId) {
    const taken = new Set(PLUGIN_DEFINITIONS.map((plugin) => plugin.id));
    for (const id of pluginManifests.keys()) taken.add(id);
    for (let index = 1; index < 10000; index++) {
      const suffix = index === 1 ? "-copy" : `-copy-${index}`,
        stem = pluginId.slice(0, Math.max(1, 64 - suffix.length)).replace(/-+$/, "") || "plugin",
        candidate = `${stem}${suffix}`;
      if (!taken.has(candidate)) return candidate;
    }
    return "";
  }
  function replacePluginFrontmatterField(document, field, value) {
    const line = `${field}: ${String(value).trim().replace(/[\r\n]/g, " ")}`,
      pattern = new RegExp(`^${field}:[^\\r\\n]*$`, "m");
    if (pattern.test(document)) return document.replace(pattern, line);
    return document.replace(/^(name:[^\r\n]*\r?\n)/m, (match) => `${match}${line}\n`);
  }
  function createPluginCopy(pluginId) {
    if (state.pluginAuthoringBusy) return false;
    const plugin = PLUGIN_DEFINITIONS.find((item) => item.id === pluginId),
      manifest = pluginManifests.get(pluginId);
    if (!plugin?.documentPath || !manifest?.document) return false;
    const copyId = nextPluginCopyId(pluginId);
    if (!copyId) return false;
    const sourceName = localizedManifestValue(manifest, "name") || manifest.name || pluginId,
      copyName = t("pluginCopyName").replace("{name}", sourceName),
      escapedId = pluginId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      pluginIdPattern = new RegExp(`(pluginId\\s*:\\s*["'])${escapedId}(["'])`, "g");
    let document = manifest.document.replace(/^id:[^\r\n]*$/m, `id: ${copyId}`);
    document = document.replace(pluginIdPattern, `$1${copyId}$2`);
    document = replacePluginFrontmatterField(document, state.language === "zh" ? "name-zh" : "name", copyName);
    pluginTitle.value = copyName;
    pluginDocumentEditor.value = document;
    pluginStylesEditor.value = manifest.styles || "";
    state.pluginAuthoringStatus = { key:"pluginCopyDraftReady", type:"success", values:{ name:sourceName } };
    setPluginTab("create");
    requestAnimationFrame(() => pluginTitle.focus({ preventScroll:true }));
    return true;
  }
  function pluginAuthoringText(status) {
    if (!status) return "";
    let text = status.raw || t(status.key);
    for (const [key, value] of Object.entries(status.values || {})) text = text.replace(`{${key}}`, String(value));
    return text;
  }
  function pluginDocumentWithTitle(document, title = pluginTitle?.value) {
    const value = String(title || "").trim().replace(/[\r\n]/g, " ");
    if (!value) return document;
    let next = document;
    if (state.language === "zh") {
      if (/^name-zh:/m.test(next)) next = next.replace(/^name-zh:[^\r\n]*$/m, () => `name-zh: ${value}`);
      else next = next.replace(/^(name:[^\r\n]*\r?\n)/m, (line) => `${line}name-zh: ${value}\n`);
    } else next = next.replace(/^name:[^\r\n]*$/m, () => `name: ${value}`);
    return next;
  }
  function syncPluginTitleFromDocument(document) {
    try {
      const manifest = PLUGINS?.parse(document);
      if (manifest) pluginTitle.value = localizedManifestValue(manifest, "name") || manifest.name;
    } catch {}
  }
  function pluginDraftValidation() {
    const document = pluginDocumentWithTitle(pluginDocumentEditor.value),
      styles = pluginStylesEditor?.value || "",
      bytes = new TextEncoder().encode(document).length,
      styleBytes = new TextEncoder().encode(styles).length;
    try {
      if (!PLUGINS?.parse) throw Error("Plugin parser is unavailable");
      const manifest = PLUGINS.parse(document, styles);
      if (PLUGIN_DEFINITIONS.some((plugin) => plugin.id === manifest.id && plugin.builtIn !== false) || ["animation", "general"].includes(manifest.id)) throw Error(t("pluginIdReserved").replace("{id}", manifest.id));
      if (pluginManifests.has(manifest.id)) throw Error(t("pluginIdExists").replace("{id}", manifest.id));
      return { bytes, styleBytes, manifest, document, styles:manifest.styles, error:"" };
    } catch (error) {
      return { bytes, styleBytes, manifest:null, error:error.message || String(error) };
    }
  }
  function updatePluginStylesPreview(validation) {
    if (!pluginStylesPreview) return;
    const css = validation?.manifest?.styles || "";
    pluginStylesPreviewPayload = {
      type:"lumi6-widget-init",
      title:t("pluginStylesPreview"),
      html:`<!doctype html><meta charset="utf-8"><style>
      *{box-sizing:border-box}body{margin:0;padding:22px;background:#fff;color:#172033;font:16px/1.45 system-ui,sans-serif}
      .plugin-css-preview{display:grid;gap:16px}.preview-row{display:flex;flex-wrap:wrap;align-items:center;gap:12px}
      .preview-node{padding:12px 16px;border:2px solid #64748b;border-radius:6px;background:#f8fafc;font-weight:700}
      .preview-muted{color:#64748b}.preview-accent{color:#2563eb}
    </style><main class="plugin-css-preview pd-root" data-pd-palette="standard" data-pd-density="comfortable">
      <h2 class="pd-title">Plugin style preview</h2><p class="pd-subtitle preview-muted">Typography, semantic nodes, labels and palette variables</p>
      <div class="preview-row pd-stage"><span class="preview-node pd-node pd-node--service">Service</span><span class="pd-edge-label">request</span><span class="preview-node pd-node pd-node--database">Database</span></div>
      <div class="preview-row"><span class="pd-badge pd-badge--info preview-accent">Info</span><span class="pd-badge pd-badge--success">Success</span><span class="pd-badge pd-badge--warning">Warning</span><span class="pd-badge pd-badge--danger">Error</span></div>
    </main>`,
      pluginStyles:css,
    };
    if (!pluginStylesPreview.getAttribute("src")) {
      pluginStylesPreviewReady = false;
      pluginStylesPreview.src = new URL("widget-host.html", location.href).href;
    }
    sendPluginStylesPreview();
  }
  function sendPluginStylesPreview() {
    if (!pluginStylesPreviewReady || !pluginStylesPreviewPayload || !pluginStylesPreview?.contentWindow) return false;
    pluginStylesPreview.contentWindow.postMessage(pluginStylesPreviewPayload, location.origin);
    return true;
  }
  function handlePluginStylesPreviewMessage(event) {
    if (event.source !== pluginStylesPreview?.contentWindow || event.origin !== location.origin || event.data?.type !== "lumi6-widget-host-ready") return;
    pluginStylesPreviewReady = true;
    sendPluginStylesPreview();
  }
  window.addEventListener("message", handlePluginStylesPreviewMessage);
  function updatePluginAuthoringUi() {
    if (!pluginDocumentEditor || !pluginTitle || !pluginDocumentStatus) return { bytes: 0, styleBytes: 0, manifest: null };
    const validation = pluginDraftValidation(),
      status = state.pluginAuthoringStatus || (validation.manifest
        ? { key:"pluginDraftValid", values:{ name:localizedManifestValue(validation.manifest, "name") || validation.manifest.name }, type:"" }
        : { key:"pluginDraftInvalid", values:{ error:validation.error }, type:"error" });
    for (const button of [pluginSimpleTemplate]) {
      if (!button) continue;
      const active = button.dataset?.pluginTemplate === state.pluginAuthoringTemplate;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
      button.disabled = state.pluginAuthoringBusy;
    }
    if (pluginDocumentBytes) {
      pluginDocumentBytes.textContent = t("pluginBytes").replace("{bytes}", String(validation.bytes));
      pluginDocumentBytes.classList.toggle("invalid", validation.bytes > 12000);
    }
    if (pluginStylesBytes) {
      pluginStylesBytes.textContent = t("pluginStylesBytes").replace("{bytes}", String(validation.styleBytes));
      pluginStylesBytes.classList.toggle("invalid", validation.styleBytes > 32000);
    }
    pluginDocumentStatus.textContent = pluginAuthoringText(status);
    pluginDocumentStatus.className = status.type || "";
    pluginTitle.disabled = state.pluginAuthoringBusy;
    pluginDocumentEditor.disabled = state.pluginAuthoringBusy;
    if (pluginStylesEditor) pluginStylesEditor.disabled = state.pluginAuthoringBusy;
    if (pluginStylesUploadButton) pluginStylesUploadButton.disabled = state.pluginAuthoringBusy;
    if (pluginStylesUpload) pluginStylesUpload.disabled = state.pluginAuthoringBusy;
    if (pluginImprove) pluginImprove.disabled = state.pluginAuthoringBusy || !pluginDocumentEditor.value.trim() || validation.bytes > 12000;
    if (pluginSave) pluginSave.disabled = state.pluginAuthoringBusy || state.pluginCatalogLoading || !validation.manifest;
    for (const tab of [pluginLocalTab, pluginCreateTab, pluginServerTab]) if (tab) tab.disabled = state.pluginAuthoringBusy;
    updatePluginStylesPreview(validation);
    return validation;
  }
  function setPluginAuthoringStatus(key, type = "", values = {}, raw = "") {
    state.pluginAuthoringStatus = { key, type, values, raw };
    updatePluginAuthoringUi();
  }
  function setPluginTemplate(template) {
    if (!pluginDocumentEditor || !pluginStylesEditor || !Object.hasOwn(PLUGIN_TEMPLATE_DOCUMENTS, template) || state.pluginAuthoringBusy) return false;
    state.pluginAuthoringTemplate = template;
    state.pluginAuthoringStatus = null;
    pluginDocumentEditor.value = PLUGIN_TEMPLATE_DOCUMENTS[template];
    pluginStylesEditor.value = PLUGIN_TEMPLATE_STYLES[template] || "";
    syncPluginTitleFromDocument(pluginDocumentEditor.value);
    updatePluginAuthoringUi();
    return true;
  }
  async function importPluginStylesFile(file) {
    if (!(file instanceof Blob) || state.pluginAuthoringBusy) return false;
    const name = String(file.name || "styles.css"),
      isCss = /\.css$/i.test(name) || file.type === "text/css";
    if (!isCss) {
      setPluginAuthoringStatus("pluginStylesFileType", "error");
      return false;
    }
    if (file.size > 32000) {
      setPluginAuthoringStatus("pluginStylesFileTooLarge", "error");
      return false;
    }
    try {
      const styles = await file.text();
      if (new TextEncoder().encode(styles).length > 32000) {
        setPluginAuthoringStatus("pluginStylesFileTooLarge", "error");
        return false;
      }
      pluginStylesEditor.value = styles;
      state.pluginAuthoringStatus = null;
      const validation = pluginDraftValidation();
      if (!validation.manifest) {
        setPluginAuthoringStatus("pluginDraftInvalid", "error", { error:validation.error });
        return false;
      }
      setPluginAuthoringStatus("pluginStylesImported", "success", { name });
      return true;
    } catch (error) {
      setPluginAuthoringStatus("pluginStylesReadFailed", "error", { error:error.message || String(error) });
      return false;
    } finally {
      pluginStylesUpload.value = "";
    }
  }
  async function pluginJsonResponse(response) {
    let body = null;
    try { body = await response.json(); } catch {}
    if (!response.ok) throw Error(body?.error || `HTTP ${response.status}`);
    return body;
  }
  async function improvePluginDraft() {
    if (state.pluginAuthoringBusy) return false;
    const document = pluginDocumentWithTitle(pluginDocumentEditor.value),
      styles = pluginStylesEditor.value;
    if (!document.trim() || new TextEncoder().encode(document).length > 12000 || new TextEncoder().encode(styles).length > 32000) return false;
    state.pluginAuthoringBusy = true;
    setPluginAuthoringStatus("pluginImproving");
    try {
      const response = await fetch("/api/plugins/improve", {
        method:"POST",
        credentials:"same-origin",
        headers:authenticatedApiHeaders({ "Content-Type":"application/json" }),
        body:JSON.stringify({ document, styles, reasoningEffort:state.reasoningEffort }),
      }), body = await pluginJsonResponse(response);
      if (typeof body?.document !== "string" || typeof body?.styles !== "string") throw Error("The AI response did not contain a complete plugin bundle");
      PLUGINS.parse(body.document, body.styles);
      pluginDocumentEditor.value = body.document;
      pluginStylesEditor.value = body.styles;
      syncPluginTitleFromDocument(body.document);
      state.pluginAuthoringStatus = { key:"pluginImproved", type:"success", values:{} };
      return true;
    } catch (error) {
      state.pluginAuthoringStatus = { key:"pluginImproveFailed", type:"error", values:{ error:error.message || String(error) } };
      return false;
    } finally {
      state.pluginAuthoringBusy = false;
      updatePluginAuthoringUi();
    }
  }
  async function savePluginDraft(event) {
    event?.preventDefault();
    if (state.pluginAuthoringBusy) return false;
    const validation = updatePluginAuthoringUi();
    if (!validation.manifest) return false;
    state.pluginAuthoringBusy = true;
    setPluginAuthoringStatus("pluginSaving");
    try {
      const response = await fetch("/api/plugins", {
        method:"POST",
        credentials:"same-origin",
        headers:authenticatedApiHeaders({ "Content-Type":"application/json" }),
        body:JSON.stringify({ document:validation.document, styles:validation.styles }),
      }), body = await pluginJsonResponse(response), savedId = body?.plugin?.id;
      if (typeof savedId !== "string" || !await loadPluginDocuments() || !await setPluginEnabled(savedId, true)) throw Error("The plugin was saved, but the local catalog could not be refreshed");
      state.pluginAuthoringStatus = { key:"pluginSaved", type:"success", values:{ name:localizedManifestValue(validation.manifest, "name") || validation.manifest.name } };
      setPluginTab("local");
      return true;
    } catch (error) {
      state.pluginAuthoringStatus = { key:"pluginSaveFailed", type:"error", values:{ error:error.message || String(error) } };
      return false;
    } finally {
      state.pluginAuthoringBusy = false;
      updatePluginAuthoringUi();
    }
  }
  function forgetPluginSetting(pluginId) {
    try {
      const stored = JSON.parse(localStorage.getItem(PLUGIN_STORAGE_KEY) || "{}");
      if (!stored || typeof stored !== "object" || Array.isArray(stored)) return;
      delete stored[pluginId];
      localStorage.setItem(PLUGIN_STORAGE_KEY, JSON.stringify(stored));
    } catch {}
  }
  async function deleteLocalPlugin(pluginId) {
    if (state.pluginDeleting) return false;
    const plugin = PLUGIN_DEFINITIONS.find((item) => item.id === pluginId);
    if (!plugin?.documentPath || plugin.builtIn !== false) return false;
    const manifest = pluginManifests.get(pluginId), name = localizedManifestValue(manifest, "name") || pluginId,
      confirmation = t("deletePluginConfirm").replace("{name}", name);
    if (!window.confirm(confirmation)) return false;
    state.pluginDeleting = pluginId;
    state.pluginCatalogNotice = { key:"pluginDeleting", values:{ name } };
    updatePluginControl();
    try {
      const response = await fetch(`/api/plugins/${encodeURIComponent(pluginId)}`, { method:"DELETE", credentials:"same-origin", headers:authenticatedApiHeaders() });
      await pluginJsonResponse(response);
      forgetPluginSetting(pluginId);
      state.pluginCatalogNotice = { key:"pluginDeleted", values:{ name }, type:"success" };
      await loadPluginDocuments();
      return true;
    } catch (error) {
      state.pluginCatalogNotice = { key:"pluginDeleteFailed", values:{ error:error.message || String(error) }, type:"error" };
      return false;
    } finally {
      state.pluginDeleting = "";
      updatePluginControl();
    }
  }
  function hidePluginControl() {
    if (!pluginPopover) return;
    if (pluginPopover.hidden) return;
    pluginPopover.hidden = true;
    pluginPopover.setAttribute("aria-hidden", "true");
    document.body.classList.remove("plugin-open");
    if (!featureTour.active) tourMain.inert = false;
    pluginButton.setAttribute("aria-expanded", "false");
    const restore = state.pluginDialogRestoreFocus;
    state.pluginDialogRestoreFocus = null;
    if (restore?.isConnected) restore.focus({ preventScroll:true });
  }
  function setPluginTab(tab) {
    const selected = ["local", "create", "server"].includes(tab) ? tab : "local",
      tabs = [["local", pluginLocalTab, pluginLocalPanel], ["create", pluginCreateTab, pluginCreatePanel], ["server", pluginServerTab, pluginServerPanel]];
    for (const [name, button, panel] of tabs) {
      const active = name === selected;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
      panel.hidden = !active;
      if (active) panel.scrollTop = 0;
    }
    if (selected === "create") updatePluginAuthoringUi();
  }
  function showPluginControl() {
    if (!pluginPopover) return;
    if (!pluginPopover.hidden) return;
    state.pluginDialogRestoreFocus = document.activeElement;
    pluginPopover.hidden = false;
    pluginPopover.setAttribute("aria-hidden", "false");
    document.body.classList.add("plugin-open");
    tourMain.inert = true;
    updatePluginControl();
    setPluginTab("local");
    pluginPopover.querySelector(".plugin-modal")?.focus({ preventScroll:true });
    if (!state.pluginCatalogLoaded) void loadPluginDocuments();
  }
  function discardPendingAnimationDrafts() {
    const pending = state.pending;
    if (!pending) return;
    if (!pending.items) {
      if (!pending.animationScene) return;
      state.pending = null;
      state.pendingGesture = null;
      updateBatchActions();
      resolvePending(pending, AI_REJECTED);
      return;
    }
    const remaining = pending.items.filter((item) => !item.animationScene);
    if (remaining.length === pending.items.length) return;
    if (!remaining.length) {
      state.pending = null;
      state.pendingGesture = null;
      updateBatchActions();
      resolvePending(pending, AI_REJECTED);
      return;
    }
    pending.items = remaining;
    pending.selectedIndex = Math.min(pending.selectedIndex, remaining.length - 1);
    state.pendingGesture = null;
    updateBatchActions();
  }
  function applyAnimationPluginState(enabled) {
    if (!enabled) {
      if (state.animationEdit) acceptAnimationEdit();
      discardPendingAnimationDrafts();
      hideAnimationControls();
      state.selectedAnimationId = null;
      state.animationGesture = null;
      state.animationEdit = null;
      stopAnimationFrames();
      clearAnimationLayer();
    } else {
      state.animationFullRedraw = true;
      requestAnimationLayerRender();
    }
    requestRender();
  }
  function applyWidgetPluginState(pluginId, enabled) {
    if (!enabled && state.activeAI?.widgetEdit?.pluginId === pluginId) cancelWidgetRefinement("widget-plugin-disabled");
    if (!enabled && state.pendingWidget?.pluginId === pluginId) rejectPendingWidget();
    if (!enabled && selectedWidget()?.pluginId === pluginId) acceptWidgetEdit();
    for (const widget of state.widgets) {
      if (widget.pluginId !== pluginId) continue;
      if (enabled) mountWidget(widget);
      else unmountWidget(widget);
    }
    syncWidgetRuntime();
    requestRender();
  }
  async function setPluginEnabled(pluginId, enabled) {
    const plugin = PLUGIN_DEFINITIONS.find((item) => item.id === pluginId);
    if (!plugin) return false;
    if (enabled && plugin.documentPath && !pluginManifests.has(pluginId)) return false;
    if (enabled) {
      try { await ensurePluginRuntime(pluginId); }
      catch (error) {
        state.pluginCatalogError = error.message;
        updatePluginControl();
        return false;
      }
    }
    state.plugins[pluginId] = Boolean(enabled);
    persistPluginSettings();
    if (plugin.documentPath) applyWidgetPluginState(pluginId, state.plugins[pluginId]);
    else plugin.onChange?.(state.plugins[pluginId]);
    updatePluginControl();
    return true;
  }
  function setEffort(value) {
    state.reasoningEffort = EFFORT_OPTIONS.includes(value) ? value : "config";
    localStorage.setItem("lumi6-ai-effort", state.reasoningEffort);
    updateEffortControl();
    hideEffortControl();
  }
  function setAutoEnabled(enabled, showDelay = false) {
    state.auto = enabled;
    clearTimeout(state.timer);
    state.timer = 0;
    localStorage.setItem("lumi6-auto-ai", String(enabled));
    updateAutoControl();
    if (enabled) {
      schedule();
      if (showDelay) showAutoDelayControl();
    } else hideAutoDelayControl();
  }
  function updatePaint() {
    const css = getComputedStyle(document.body);
    state.paint = {
      paper: css.getPropertyValue("--paper").trim() || "#ffffff",
      paperGrid: css.getPropertyValue("--paper-grid").trim() || "rgba(0, 0, 0, 0.05)",
      outside: css.getPropertyValue("--outside").trim() || "#ffffff",
      border: css.getPropertyValue("--line").trim() || "#e2e8f0",
    };
  }
  function applyLanguage() {
    document.documentElement.lang = state.language === "zh" ? "zh-CN" : "en";
    document.title = t("title");
    document.querySelectorAll("[data-i18n]").forEach((node) => (node.textContent = t(node.dataset.i18n)));
    document.querySelectorAll("[data-i18n-aria]").forEach((node) => node.setAttribute("aria-label", t(node.dataset.i18nAria)));
    document.querySelectorAll("[data-i18n-title]").forEach((node) => node.setAttribute("title", t(node.dataset.i18nTitle)));
    document.querySelectorAll("[data-i18n-placeholder]").forEach((node) => node.setAttribute("placeholder", t(node.dataset.i18nPlaceholder)));
    document.querySelectorAll("[data-language]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.language === state.language)));
    updateAutoControl();
    updateEffortControl();
    updatePluginControl();
    updatePluginAuthoringUi();
    updateFullscreenButton();
    updateThemeCopy();
    updateEmbodimentLabel();
    updateGridButton();
    updateHistorySaveFeedbackLanguage();
    renderSnapshotList();
    updateNewCanvasDialog();
    if (state.statusKey) status.textContent = t(state.statusKey);
    updateSelectionToolbar();
    updateFeatureTourLanguage();
    summonFX?.refreshText();
    positionAnimationControls();
    requestInteractionLayerRender();
  }
  function updateThemeCopy() {
    const key = { arcane: "taglineArcane", scifi: "taglineScifi", research: "taglineResearch", studio: "taglineStudio", indic: "taglineIndic", "canvas-pro": "taglineCanvasPro" }[state.theme] || "taglineStudio";
    const tagline = document.querySelector("[data-i18n=tagline]");
    if (tagline) tagline.textContent = t(key);
    const focus = t({ arcane: "themeFocusArcane", scifi: "themeFocusScifi", research: "themeFocusResearch", studio: "themeFocusStudio", indic: "themeFocusIndic", "canvas-pro": "themeFocusCanvasPro" }[state.theme] || "themeFocusStudio");
    const themeEl = document.querySelector("#theme");
    if (themeEl) {
      themeEl.setAttribute("title", focus);
      themeEl.setAttribute("aria-description", focus);
    }
  }
  function updateEmbodimentLabel() {
    const label = t({ arcane: "guideArcane", scifi: "guideScifi", research: "guideResearch", studio: "guideStudio", indic: "guideIndic", "canvas-pro": "guideCanvasPro" }[state.theme] || "guideStudio");
    embodiment?.setAttribute("aria-label", label);
    aiOrb?.setAttribute("title", label);
  }
  function updateFullscreenButton() {
    const button = document.querySelector("#fullscreenBtn");
    if (!button) return;
    const active = Boolean(document.fullscreenElement);
    button.setAttribute("aria-pressed", String(active));
    button.setAttribute("aria-label", t(active ? "exitFullscreen" : "fullscreen"));
    button.setAttribute("title", t(active ? "exitFullscreen" : "fullscreen"));
    document.body.classList.toggle("is-fullscreen", active);
  }
  function updateBatchActions() {
    const actions = document.querySelector("#batchActions");
    if (actions) actions.hidden = !state.pending?.items || state.pending.fading;
  }
  function updateGridButton() {
    const button = document.querySelector("#gridToggle");
    if (!button) return;
    const visible = state.gridVisible,
      label = t(visible ? "gridOff" : "gridOn");
    button.disabled = false;
    button.classList.toggle("active", visible);
    button.setAttribute("aria-pressed", String(visible));
    button.setAttribute("aria-label", label);
    button.setAttribute("title", label);
  }
  function applyTheme(theme) {
    state.theme = theme;
    document.body.dataset.theme = theme;
    if (embodiment) embodiment.dataset.theme = theme;
    const themeSelect = document.querySelector("#theme");
    if (themeSelect) themeSelect.value = theme;
    localStorage.setItem("lumi6-theme", theme);
    if (theme === "research") state.gridVisible = localStorage.getItem("lumi6-research-grid") === "true";
    else state.gridVisible = (localStorage.getItem("lumi6-grid") ?? localStorage.getItem("ghostboard-grid")) !== "false";
    updateThemeCopy();
    updateEmbodimentLabel();
    updateGridButton();
    updatePaint();
    requestRender();
  }
  function setBusy(value) {
    state.busy = Boolean(value);
    embodiment?.classList.toggle("working", state.busy);
    embodiment?.setAttribute("aria-busy", String(state.busy));
    if (state.busy) showSummon();
    else hideSummon();
  }
  function setNavigating(value) {
    clearTimeout(state.navigationTimer);
    if (value) view.classList.add("is-navigating");
    if (!view.classList.contains("is-navigating")) return;
    state.navigationTimer = setTimeout(() => {
      state.navigationTimer = 0;
      view.classList.remove("is-navigating");
    }, NAVIGATION_HINT_VISIBLE_MS);
  }
  function wheelNavigating() {
    setNavigating(true);
  }
  function selectionAIRequest(selection = state.selection) {
    return selection?.aiRequest || null;
  }
  function selectionAIBusy(selection = state.selection) {
    return Boolean(selectionAIRequest(selection));
  }
  function selectionIsTypesetting(selection = state.selection) {
    return selectionAIRequest(selection)?.action === "normalize";
  }
  function selectionAIStatusKey(selection = state.selection) {
    return selectionIsTypesetting(selection) ? "selectionTypesetting" : "observing";
  }
  function requestSelectionAI(action, selection, packed) {
    if (!selection || selection.phase !== "active" || !packed) return false;
    const token = {};
    selection.aiRequest = { token, action };
    supersedeActiveAI("selection-scoped-action");
    setStatusKey(selectionAIStatusKey(selection));
    updateSelectionToolbar();
    requestAI(action, packed, { isolatedSelection: true, selection, selectionRequestToken: token }).finally(() => {
      if (selection.aiRequest?.token === token) selection.aiRequest = null;
      if (state.selection === selection) updateSelectionToolbar();
    });
    return true;
  }
  function invokeAIAction(action) {
    if (action === "voice") {
      closeRadialMenu();
      if (typeof window.setAppViewMode === "function") window.setAppViewMode("talk");
      return;
    }
    if (action === "followup") {
      closeRadialMenu();
      openFollowUpEditor();
      return;
    }
    cancelWidgetRefinement("manual-action");
    if (state.selection?.phase === "active") {
      const selection = state.selection,
        packed = buildSelectionTypesetRequest(selection);
      if (!packed) return;
      requestSelectionAI(action, selection, packed);
      return;
    }
    supersedeActiveAI("manual-action");
    requestAI(action, null, { captureCurrentViewport: true });
  }
  function showConfirmModal({ title = "Clear canvas?", message = "Clear the whole canvas?", okText = "Clear Canvas", cancelText = "Cancel", danger = true } = {}) {
    return new Promise((resolve) => {
      const layer = document.querySelector("#confirmModalLayer"),
        titleEl = document.querySelector("#confirmModalTitle"),
        bodyEl = document.querySelector("#confirmModalMessage"),
        okBtn = document.querySelector("#confirmModalOk"),
        cancelBtn = document.querySelector("#confirmModalCancel"),
        closeBtn = document.querySelector("#confirmModalClose"),
        backdrop = document.querySelector("#confirmModalBackdrop");
      if (!layer || !okBtn) {
        resolve(window.confirm(message));
        return;
      }
      titleEl.textContent = title;
      bodyEl.textContent = message;
      okBtn.textContent = okText;
      cancelBtn.textContent = cancelText;
      okBtn.className = `confirm-modal-btn ${danger ? "confirm-modal-danger" : "confirm-modal-cancel"}`;
      layer.hidden = false;
      layer.setAttribute("aria-hidden", "false");

      const cleanup = (result) => {
        layer.hidden = true;
        layer.setAttribute("aria-hidden", "true");
        okBtn.removeEventListener("click", onOk);
        cancelBtn.removeEventListener("click", onCancel);
        closeBtn.removeEventListener("click", onCancel);
        backdrop.removeEventListener("click", onCancel);
        window.removeEventListener("keydown", onKeydown);
        resolve(result);
      };
      const onOk = () => cleanup(true);
      const onCancel = () => cleanup(false);
      const onKeydown = (e) => {
        if (e.key === "Escape") cleanup(false);
        if (e.key === "Enter") cleanup(true);
      };
      okBtn.addEventListener("click", onOk);
      cancelBtn.addEventListener("click", onCancel);
      closeBtn.addEventListener("click", onCancel);
      backdrop.addEventListener("click", onCancel);
      window.addEventListener("keydown", onKeydown);
      requestAnimationFrame(() => okBtn.focus());
    });
  }
  function openRadialMenu() {
    clearTimeout(state.radialCloseTimer);
    embodiment?.classList.add("menu-open");
    aiOrb?.setAttribute("aria-expanded", "true");
    aiRadial?.setAttribute("aria-hidden", "false");
    document.querySelectorAll(".radial-action").forEach((button) => button.setAttribute("tabindex", "0"));
  }
  function closeRadialMenu(force = false) {
    if (state.radialGesture && !force) return;
    state.radialGesture = null;
    embodiment?.classList.remove("menu-open");
    aiOrb?.setAttribute("aria-expanded", "false");
    aiRadial?.setAttribute("aria-hidden", "true");
    document.querySelectorAll(".radial-action").forEach((button) => {
      button.classList.remove("is-highlighted");
      button.setAttribute("tabindex", "-1");
    });
  }
  function chooseRadialAction(clientX, clientY) {
    const orbRect = aiOrb.getBoundingClientRect(),
      origin = { x: orbRect.left + orbRect.width / 2, y: orbRect.top + orbRect.height / 2 },
      pointerDistance = Math.hypot(clientX - origin.x, clientY - origin.y);
    let selected = null,
      angleDistance = Infinity;
    if (pointerDistance < 22) {
      document.querySelectorAll(".radial-action").forEach((button) => button.classList.remove("is-highlighted"));
      return null;
    }
    const pointerAngle = Math.atan2(clientY - origin.y, clientX - origin.x);
    document.querySelectorAll(".radial-action").forEach((button) => {
      const r = button.getBoundingClientRect(),
        buttonAngle = Math.atan2(r.top + r.height / 2 - origin.y, r.left + r.width / 2 - origin.x),
        next = Math.abs(Math.atan2(Math.sin(pointerAngle - buttonAngle), Math.cos(pointerAngle - buttonAngle)));
      if (next < angleDistance) {
        angleDistance = next;
        selected = button;
      }
    });
    if (angleDistance > 0.42) selected = null;
    document.querySelectorAll(".radial-action").forEach((button) => button.classList.toggle("is-highlighted", button === selected));
    return selected;
  }
  function debug(event, details = {}) {
    const item = document.createElement("li");
    item.textContent = `${new Date().toLocaleTimeString()} ${event} ${JSON.stringify(details)}`;
    debugList.prepend(item);
    while (debugList.children.length > 30) debugList.lastChild.remove();
  }
  function rememberRequest(id) {
    if (!id) return;
    state.lastRequestId = id;
    debugRequest.textContent = `request: ${id}`;
  }
  const key = (x, y) => `${x},${y}`;
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
// Canvas snapshots, export, drawing history, strokes, and lasso selection.
  const SNAPSHOT_DB = "lumi6-canvas-history",
    SNAPSHOT_STORE = "snapshots",
    SNAPSHOT_TILE_STORE = "snapshot-tiles",
    SNAPSHOT_LOCATIONS = new Set(["device", "server"]);
  let snapshotDbPromise = null,
    snapshotItems = [],
    snapshotSaveInProgress = false,
    snapshotListGeneration = 0,
    historyNoticeTimer = 0;
  function snapshotLocationLabel(location = state.snapshotLocation) {
    return t(location === "server" ? "storageLumi6Server" : "storageThisDevice");
  }
  function updateSnapshotLocationUi() {
    const location = SNAPSHOT_LOCATIONS.has(state.snapshotLocation) ? state.snapshotLocation : "device",
      descriptionKey = location === "server" ? "storageLumi6ServerDescription" : "storageThisDeviceDescription";
    document.querySelectorAll('input[name="historyStorageLocation"], input[name="newCanvasStorageLocation"]').forEach((input) => {
      input.checked = input.value === location;
    });
    for (const id of ["historyStorageDescription", "newCanvasStorageDescription"]) {
      const description = document.querySelector(`#${id}`);
      if (description) description.textContent = t(descriptionKey);
    }
  }
  function setSnapshotLocation(location) {
    if (!SNAPSHOT_LOCATIONS.has(location) || state.snapshotLocation === location) {
      updateSnapshotLocationUi();
      return;
    }
    state.snapshotLocation = location;
    localStorage.setItem("lumi6-snapshot-location", location);
    updateSnapshotLocationUi();
    updateNewCanvasDialog();
    refreshSnapshots().catch((error) => setStatus(`${t("snapshotError")}${error.message}`));
  }
  function updateHistorySaveFeedbackLanguage() {
    const button = document.querySelector("#historySave"),
      currentButton = document.querySelector("#historySaveCurrent"),
      notice = document.querySelector("#historyNotice");
    if (button) button.textContent = t(snapshotSaveInProgress ? "snapshotSavingShort" : "saveSnapshot");
    if (currentButton) currentButton.textContent = t(snapshotSaveInProgress ? "snapshotSavingShort" : "saveCurrentSnapshot");
    if (notice?.dataset.messageKey) notice.textContent = t(notice.dataset.messageKey);
    updateSnapshotLocationUi();
  }
  function showHistoryNotice(text, tone = "info", { messageKey = "", duration = 2800 } = {}) {
    const notice = document.querySelector("#historyNotice");
    if (!notice) return;
    clearTimeout(historyNoticeTimer);
    notice.textContent = text;
    notice.dataset.messageKey = messageKey;
    notice.dataset.tone = tone;
    notice.classList.add("visible");
    if (duration > 0) {
      historyNoticeTimer = setTimeout(() => {
        notice.classList.remove("visible");
        notice.dataset.messageKey = "";
        notice.textContent = "";
      }, duration);
    }
  }
  function showHistoryNoticeKey(key, tone = "info", duration = 2800) {
    showHistoryNotice(t(key), tone, { messageKey: key, duration });
  }
  function setHistorySaveBusy(busy) {
    const button = document.querySelector("#historySave"),
      currentButton = document.querySelector("#historySaveCurrent"),
      saveButton = document.querySelector("#saveCanvasBtn");
    snapshotSaveInProgress = busy;
    if (button) {
      button.disabled = busy;
      button.classList.toggle("is-saving", busy);
      button.setAttribute("aria-busy", String(busy));
      button.textContent = t(busy ? "snapshotSavingShort" : "saveSnapshot");
    }
    if (currentButton) {
      currentButton.disabled = busy;
      currentButton.classList.toggle("is-saving", busy);
      currentButton.setAttribute("aria-busy", String(busy));
      currentButton.textContent = t(busy ? "snapshotSavingShort" : "saveCurrentSnapshot");
    }
    if (saveButton) {
      saveButton.disabled = busy;
      saveButton.classList.toggle("is-saving", busy);
      saveButton.setAttribute("aria-busy", String(busy));
    }
    document.querySelectorAll('input[name="historyStorageLocation"]').forEach((input) => (input.disabled = busy));
  }
  async function saveSnapshotFromHistory() {
    if (snapshotSaveInProgress) return;
    setHistorySaveBusy(true);
    showHistoryNoticeKey("snapshotSaving", "busy", 0);
    try {
      const selectionBusy = selectionAIBusy(),
        selectionBusyKey = selectionAIStatusKey(),
        id = await saveSnapshot();
      showHistoryNoticeKey(id ? "snapshotSaved" : selectionBusy ? selectionBusyKey : "emptyCanvas", id ? "success" : "info");
    } catch (error) {
      const message = `${t("snapshotError")}${error.message}`;
      setStatus(message);
      showHistoryNotice(message, "error", { duration: 5000 });
    } finally {
      setHistorySaveBusy(false);
    }
  }
  async function saveCurrentCanvas() {
    if (snapshotSaveInProgress) return;
    const overwriteId = state.currentSnapshotLocation === state.snapshotLocation ? state.currentSnapshotId : null,
      requestedName = document.querySelector("#historyName")?.value.trim(),
      name = requestedName || (overwriteId ? state.currentSnapshotName : "");
    setHistorySaveBusy(true);
    showHistoryNoticeKey("snapshotSaving", "busy", 0);
    try {
      const selectionBusy = selectionAIBusy(),
        selectionBusyKey = selectionAIStatusKey(),
        id = await saveSnapshot({ overwriteId, name, location:state.snapshotLocation });
      showHistoryNoticeKey(id ? (overwriteId ? "snapshotOverwritten" : "snapshotSaved") : selectionBusy ? selectionBusyKey : "emptyCanvas", id ? "success" : "info");
    } catch (error) {
      const message = `${t("snapshotError")}${error.message}`;
      setStatus(message);
      showHistoryNotice(message, "error", { duration:5000 });
    } finally {
      setHistorySaveBusy(false);
    }
  }
  function snapshotDb() {
    if (snapshotDbPromise) return snapshotDbPromise;
    snapshotDbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(SNAPSHOT_DB, 2);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(SNAPSHOT_STORE)) db.createObjectStore(SNAPSHOT_STORE, { keyPath: "id" });
        if (!db.objectStoreNames.contains(SNAPSHOT_TILE_STORE)) {
          const store = db.createObjectStore(SNAPSHOT_TILE_STORE, { keyPath: "id" });
          store.createIndex("snapshotId", "snapshotId", { unique: false });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || Error("Could not open IndexedDB"));
    });
    return snapshotDbPromise;
  }
  function canvasBlob(canvas, type = "image/png", quality) {
    return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(Error("Could not encode canvas"))), type, quality));
  }
  function requestResult(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || Error("IndexedDB request failed"));
    });
  }
  function transactionDone(transaction) {
    return new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onerror = transaction.onabort = () => reject(transaction.error || Error("IndexedDB transaction failed"));
    });
  }
  async function allSnapshots() {
    const db = await snapshotDb(),
      items = await requestResult(db.transaction(SNAPSHOT_STORE, "readonly").objectStore(SNAPSHOT_STORE).getAll());
    return items.sort((a, b) => b.createdAt - a.createdAt);
  }
  function blobDataUrl(blob) {
    return new Promise((resolve, reject) => {
      if (!(blob instanceof Blob)) return reject(Error("Snapshot contains invalid binary data"));
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(reader.error || Error("Could not encode snapshot data"));
      reader.readAsDataURL(blob);
    });
  }
  function dataUrlBlob(value) {
    if (typeof value !== "string") throw Error("Snapshot contains invalid encoded data");
    const match = /^data:([^;,]+);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
    if (!match) throw Error("Snapshot contains invalid encoded data");
    const binary = atob(match[2]),
      bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    return new Blob([bytes], { type:match[1] });
  }
  async function snapshotApiResponse(response) {
    let body = null;
    try { body = await response.json(); } catch {}
    if (!response.ok) throw Error(body?.error || `Lumi6 server returned HTTP ${response.status}`);
    return body;
  }
  async function serverSnapshotItems() {
    const response = await fetch("/api/canvases", {
        credentials:"same-origin",
        cache:"no-store",
        headers:authenticatedApiHeaders(),
      }),
      body = await snapshotApiResponse(response);
    return Promise.all((Array.isArray(body?.canvases) ? body.canvases : []).map(async (item) => ({
      ...item,
      preview:dataUrlBlob(item.preview),
    })));
  }
  async function snapshotsAt(location) {
    return location === "server" ? serverSnapshotItems() : allSnapshots();
  }
  function animationBounds(region = null) {
    if (!pluginEnabled("animation")) return null;
    let bounds = null;
    for (const animation of visibleAnimations(region)) {
      const box = animationBox(animation),
        visible = region ? intersection(box, region) : box;
      if (visible) bounds = unionLocalBounds(bounds, visible);
    }
    return bounds;
  }
  function snapshotPreview() {
    const preview = offscreen(180, 120),
      q = preview.getContext("2d"),
      bounds = unionLocalBounds(unionLocalBounds(unionLocalBounds(unionLocalBounds(visibleInkBounds({ x:0, y:0, w:SIZE, h:SIZE }), imageBounds()), textBoxBounds()), animationBounds()), widgetBounds());
    q.fillStyle = state.paint.paper;
    q.fillRect(0, 0, preview.width, preview.height);
    if (!bounds) return preview;
    const pad = 8,
      scale = Math.min((preview.width - pad * 2) / bounds.w, (preview.height - pad * 2) / bounds.h),
      dx = (preview.width - bounds.w * scale) / 2,
      dy = (preview.height - bounds.h * scale) / 2;
    const captureTime = performance.now();
    q.save();
    q.setTransform(scale, 0, 0, scale, dx - bounds.x * scale, dy - bounds.y * scale);
    drawImagesToContext(q, bounds);
    drawTextBoxesToContext(q, bounds);
    q.restore();
    for (const [k, canvas] of tiles) {
      const [tx, ty] = k.split(",").map(Number),
        x = tx * TILE,
        y = ty * TILE;
      if (!intersection({ x, y, w: TILE, h: TILE }, bounds)) continue;
      q.drawImage(canvas, dx + (x - bounds.x) * scale, dy + (y - bounds.y) * scale, TILE * scale, TILE * scale);
    }
    q.save();
    q.setTransform(scale, 0, 0, scale, dx - bounds.x * scale, dy - bounds.y * scale);
    drawSharpOverlays(q, bounds);
    drawAnimationsToContext(q, bounds, captureTime);
    drawWidgetsToContext(q, bounds);
    q.restore();
    return preview;
  }
  function exportInkBounds() {
    let bounds = null;
    for (const [tileKey, tileCanvas] of tiles) {
      const [tx, ty] = tileKey.split(",").map(Number),
        ink = inkBox(tileCanvas, Math.min(TILE, SIZE - tx * TILE), Math.min(TILE, SIZE - ty * TILE));
      if (!ink) continue;
      state.inkBounds.set(tileKey, ink);
      bounds = unionLocalBounds(bounds, { x: tx * TILE + ink.x, y: ty * TILE + ink.y, w: ink.w, h: ink.h });
    }
    bounds = unionLocalBounds(bounds, animationBounds());
    bounds = unionLocalBounds(bounds, imageBounds());
    bounds = unionLocalBounds(bounds, textBoxBounds());
    bounds = unionLocalBounds(bounds, widgetBounds());
    const selection = state.selection;
    if (selection?.phase !== "active") return bounds;
    for (const fragment of selection.fragments) {
      const target = SELECT.mapFragment(fragment, selection.originalBox, selection.box);
      bounds = unionLocalBounds(bounds, target);
    }
    return bounds;
  }
  function exportRegion() {
    const ink = exportInkBounds();
    if (!ink) return null;
    const x = Math.floor(ink.x) - TILE,
      y = Math.floor(ink.y) - TILE,
      right = Math.ceil(ink.x + ink.w) + TILE,
      bottom = Math.ceil(ink.y + ink.h) + TILE;
    return { x, y, w: right - x, h: bottom - y };
  }
  async function renderExportCanvas() {
    await snapshotVisibleWidgets();
    const region = exportRegion();
    if (!region) return null;
    const scale = Math.min(1, EXPORT_MAX_DIMENSION / region.w, EXPORT_MAX_DIMENSION / region.h, Math.sqrt(EXPORT_MAX_PIXELS / (region.w * region.h))),
      canvas = offscreen(Math.max(1, Math.ceil(region.w * scale)), Math.max(1, Math.ceil(region.h * scale))),
      context = canvas.getContext("2d");
    const captureTime = performance.now();
    context.fillStyle = state.paint.paper;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.save();
    context.setTransform(scale, 0, 0, scale, -region.x * scale, -region.y * scale);
    if (state.gridVisible) {
      const right = region.x + region.w,
        bottom = region.y + region.h;
      context.strokeStyle = state.paint.paperGrid;
      context.lineWidth = 1 / scale;
      context.beginPath();
      for (let x = Math.floor(region.x / 500) * 500; x <= right; x += 500) {
        context.moveTo(x, region.y);
        context.lineTo(x, bottom);
      }
      for (let y = Math.floor(region.y / 500) * 500; y <= bottom; y += 500) {
        context.moveTo(region.x, y);
        context.lineTo(right, y);
      }
      context.stroke();
    }
    drawImagesToContext(context, region);
    drawTextBoxesToContext(context, region);
    for (const [tileKey, tileCanvas] of tiles) {
      const [tx, ty] = tileKey.split(",").map(Number),
        x = tx * TILE,
        y = ty * TILE;
      if (intersection({ x, y, w: TILE, h: TILE }, region)) context.drawImage(tileCanvas, x, y);
    }
    drawSharpOverlays(context, region);
    drawAnimationsToContext(context, region, captureTime);
    drawWidgetsToContext(context, region);
    const selection = state.selection;
    if (selection?.phase === "active")
      for (const fragment of selection.fragments) {
        const target = SELECT.mapFragment(fragment, selection.originalBox, selection.box);
        context.drawImage(fragment.renderImage || fragment.image, target.x, target.y, target.w, target.h);
      }
    context.restore();
    return canvas;
  }
  function exportFilename() {
    const now = new Date(),
      pad = (value) => String(value).padStart(2, "0");
    return `lumi6-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.png`;
  }
  async function exportCanvasPng() {
    const button = document.querySelector("#exportPngBtn");
    if (button.disabled) return;
    button.disabled = true;
    let canvas = null;
    try {
      canvas = await renderExportCanvas();
      if (!canvas) {
        setStatusKey("emptyCanvas");
        return;
      }
      const blob = await canvasBlob(canvas),
        url = URL.createObjectURL(blob),
        link = document.createElement("a");
      link.href = url;
      link.download = exportFilename();
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStatusKey("exportComplete");
    } catch (error) {
      setStatus(`${t("exportError")}${error.message}`);
    } finally {
      if (canvas) canvas.width = canvas.height = 1;
      button.disabled = false;
    }
  }
  function imageFromBlob(blob) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob),
        image = new Image();
      image.onload = () => {
        URL.revokeObjectURL(url);
        resolve(image);
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(Error("Could not decode snapshot tile"));
      };
      image.src = url;
    });
  }
  async function finalizeCanvasForSnapshot() {
    if (state.pendingWidget) acceptPendingWidget({ restoreMode:false });
    if (state.pending) acceptPending({ restoreMode:false });
    if (state.widgetEdit) acceptWidgetEdit();
    if (state.imageEdit) acceptImageEdit();
    if (state.animationEdit) acceptAnimationEdit();
    for (const editor of [...state.textEditors.values()]) await confirmTextEditor(editor);
    if (state.selection) commitSelection();
    finishAIDraftHandMode();
  }
  async function saveDeviceSnapshot(item, tileEntries, overwriteId) {
    const db = await snapshotDb();
    let oldTileKeys = [];
    if (overwriteId) oldTileKeys = await requestResult(db.transaction(SNAPSHOT_TILE_STORE, "readonly").objectStore(SNAPSHOT_TILE_STORE).index("snapshotId").getAllKeys(overwriteId));
    const transaction = db.transaction([SNAPSHOT_STORE, SNAPSHOT_TILE_STORE], "readwrite");
    transaction.objectStore(SNAPSHOT_STORE).put(item);
    const tileStore = transaction.objectStore(SNAPSHOT_TILE_STORE);
    oldTileKeys.forEach((key) => tileStore.delete(key));
    tileEntries.forEach(({ k, blob }) => tileStore.put({ id:`${item.id}:${k}`, snapshotId:item.id, k, blob }));
    await transactionDone(transaction);
  }
  async function serverSnapshotPayload(item, tileEntries) {
    const [preview, serverTiles, serverImages] = await Promise.all([
      blobDataUrl(item.preview),
      Promise.all(tileEntries.map(async ({ k, blob }) => ({ k, data:await blobDataUrl(blob) }))),
      Promise.all(item.images.map(async ({ blob, ...image }) => ({ ...image, data:await blobDataUrl(blob) }))),
    ]);
    return {
      version:1,
      id:item.id,
      createdAt:item.createdAt,
      name:item.name,
      theme:item.theme,
      view:item.view,
      animations:item.animations,
      widgets:item.widgets,
      textBoxes:item.textBoxes,
      images:serverImages,
      tiles:serverTiles,
      preview,
    };
  }
  async function saveServerSnapshot(item, tileEntries, overwriteId) {
    const response = await fetch(overwriteId ? `/api/canvases/${encodeURIComponent(overwriteId)}` : "/api/canvases", {
      method:overwriteId ? "PUT" : "POST",
      credentials:"same-origin",
      headers:authenticatedApiHeaders({ "Content-Type":"application/json" }),
      body:JSON.stringify(await serverSnapshotPayload(item, tileEntries)),
    });
    await snapshotApiResponse(response);
  }
  async function saveSnapshot({ overwriteId = null, name = null, location = state.snapshotLocation } = {}) {
    if (selectionAIBusy()) {
      setStatusKey(selectionAIStatusKey());
      return null;
    }
    if (!SNAPSHOT_LOCATIONS.has(location)) throw Error("Invalid snapshot location");
    if (overwriteId && state.currentSnapshotLocation !== location) throw Error(t("noCurrentSnapshot"));
    await finalizeCanvasForSnapshot();
    if (!tiles.size && !state.images.length && !state.textBoxes.length && (!pluginEnabled("animation") || !state.animations.length) && !visibleWidgets().length) {
      setStatusKey("emptyCanvas");
      return null;
    }
    await snapshotVisibleWidgets();
    const nameInput = document.querySelector("#historyName"),
      existing = overwriteId ? snapshotItems.find((item) => item.id === overwriteId) : null,
      id = overwriteId || `${Date.now()}-${crypto.randomUUID?.() || Math.random().toString(36).slice(2)}`,
      createdAt = Date.now(),
      animations = serializedAnimations(),
      widgets = serializedWidgets(),
      textBoxes = storedTextBoxes(),
      images = storedImages(),
      tileEntries = await Promise.all([...tiles].map(async ([k, canvas]) => ({ k, blob: await canvasBlob(canvas) }))),
      preview = await canvasBlob(snapshotPreview()),
      requestedName = String(name === null ? nameInput.value : name).trim().slice(0, 48),
      item = {
        id,
        createdAt,
        name: requestedName || (overwriteId ? (existing ? existing.name : state.currentSnapshotName) : ""),
        theme: state.theme,
        view: { scale: state.scale, panX: state.panX, panY: state.panY },
        tileCount: tileEntries.length,
        animationCount: animations.length,
        animations,
        widgetCount: widgets.length,
        widgets,
        textBoxCount:textBoxes.length,
        textBoxes,
        imageCount: images.length,
        images,
        preview,
      };
    if (overwriteId && !existing && overwriteId !== state.currentSnapshotId) throw Error(t("noCurrentSnapshot"));
    if (location === "server") await saveServerSnapshot(item, tileEntries, overwriteId);
    else await saveDeviceSnapshot(item, tileEntries, overwriteId);
    nameInput.value = "";
    state.currentSnapshotId = id;
    state.currentSnapshotName = snapshotName(item);
    state.currentSnapshotLocation = location;
    applyBoardTitle(state.currentSnapshotName, { placeholder: false, force: true });
    await refreshSnapshots();
    setStatusKey(overwriteId ? "snapshotOverwritten" : "snapshotSaved");
    return id;
  }
  async function readDeviceSnapshot(id) {
    const db = await snapshotDb(),
      transaction = db.transaction([SNAPSHOT_STORE, SNAPSHOT_TILE_STORE], "readonly"),
      itemRequest = transaction.objectStore(SNAPSHOT_STORE).get(id),
      tilesRequest = transaction.objectStore(SNAPSHOT_TILE_STORE).index("snapshotId").getAll(id),
      [item, tileEntries] = await Promise.all([requestResult(itemRequest), requestResult(tilesRequest)]);
    return item ? { item, tileEntries } : null;
  }
  async function readServerSnapshot(id) {
    const response = await fetch(`/api/canvases/${encodeURIComponent(id)}`, {
        credentials:"same-origin",
        cache:"no-store",
        headers:authenticatedApiHeaders(),
      }),
      body = await snapshotApiResponse(response),
      stored = body?.canvas;
    if (!stored || !Array.isArray(stored.tiles) || !Array.isArray(stored.images)) throw Error("Lumi6 server returned an invalid canvas");
    return {
      item:{
        ...stored,
        preview:dataUrlBlob(stored.preview),
        images:stored.images.map(({ data, ...image }) => ({ ...image, blob:dataUrlBlob(data) })),
      },
      tileEntries:stored.tiles.map(({ k, data }) => ({ k, blob:dataUrlBlob(data) })),
    };
  }
  async function readSnapshot(location, id) {
    return location === "server" ? readServerSnapshot(id) : readDeviceSnapshot(id);
  }
  async function loadSnapshot(id, location = state.snapshotLocation) {
    const loadGeneration=++state.snapshotLoadGeneration;
    if (state.selection) cancelSelection(true);
    clearTextEditors();
    state.userRevision++;
    invalidateRecognition();
    cancelPendingForRevision();
    const expectedRevision=state.userRevision,
      stored = await readSnapshot(location, id);
    if (!stored) return;
    const { item, tileEntries } = stored;
    const [decoded, images] = await Promise.all([
      Promise.all(tileEntries.map(async ({ k, blob }) => ({ k, image: await imageFromBlob(blob) }))),
      decodeStoredImages(item.images),
    ]);
    if(loadGeneration!==state.snapshotLoadGeneration||state.userRevision!==expectedRevision)return;
    await enableSnapshotWidgetPlugins(item.widgets);
    if(loadGeneration!==state.snapshotLoadGeneration||state.userRevision!==expectedRevision)return;
    state.userRevision++;
    invalidateRecognition();
    cancelPendingForRevision();
    clearTextEditors();
    tiles.clear();
    clearSharpOverlays();
    state.inkBounds.clear();
    state.history = [];
    state.future = [];
    state.animationHistoryBefore = null;
    state.widgetHistoryBefore = null;
    state.historyBefore.clear();
    state.imageHistoryBefore = null;
    state.textBoxHistoryBefore = null;
    for (const { k, image } of decoded) {
      const canvas = offscreen(TILE, TILE);
      canvas.getContext("2d").drawImage(image, 0, 0);
      tiles.set(k, canvas);
    }
    restoreAnimations(item.animations);
    restoreWidgets(item.widgets);
    if (["arcane", "scifi", "research", "studio", "indic", "canvas-pro"].includes(item.theme)) applyTheme(item.theme);
    restoreImages(images);
    await restoreTextBoxes(item.textBoxes);
    if (item.view) {
      state.scale = Math.max(0.03, Math.min(2, item.view.scale));
      state.panX = item.view.panX;
      state.panY = item.view.panY;
      updateCoordinates();
    }
    state.currentSnapshotId = item.id;
    state.currentSnapshotName = snapshotName(item);
    state.currentSnapshotLocation = location;
    applyBoardTitle(state.currentSnapshotName, { placeholder: false, force: true });
    render();
    closeHistoryPanel();
    setStatusKey("snapshotLoaded");
  }
  async function deleteDeviceSnapshot(id) {
    const db = await snapshotDb(),
      readTransaction = db.transaction(SNAPSHOT_TILE_STORE, "readonly"),
      tileKeys = await requestResult(readTransaction.objectStore(SNAPSHOT_TILE_STORE).index("snapshotId").getAllKeys(id)),
      transaction = db.transaction([SNAPSHOT_STORE, SNAPSHOT_TILE_STORE], "readwrite");
    transaction.objectStore(SNAPSHOT_STORE).delete(id);
    const tileStore = transaction.objectStore(SNAPSHOT_TILE_STORE);
    tileKeys.forEach((key) => tileStore.delete(key));
    await transactionDone(transaction);
  }
  async function deleteServerSnapshot(id) {
    const response = await fetch(`/api/canvases/${encodeURIComponent(id)}`, {
      method:"DELETE",
      credentials:"same-origin",
      headers:authenticatedApiHeaders(),
    });
    await snapshotApiResponse(response);
  }
  async function deleteSnapshot(id, location = state.snapshotLocation) {
    const confirmed = await showConfirmModal({
      title: t("delete") || "Delete snapshot?",
      message: t(location === "server" ? "deleteSnapshotConfirmServer" : "deleteSnapshotConfirmDevice"),
      okText: t("delete") || "Delete",
    });
    if (!confirmed) return;
    if (location === "server") await deleteServerSnapshot(id);
    else await deleteDeviceSnapshot(id);
    if (state.currentSnapshotId === id && state.currentSnapshotLocation === location) {
      state.currentSnapshotId = null;
      state.currentSnapshotName = "";
      state.currentSnapshotLocation = null;
    }
    await refreshSnapshots();
    setStatusKey("snapshotDeleted");
  }
  function updateNewCanvasDialog() {
    const label = document.querySelector("#currentSnapshotLabel"),
      overwrite = document.querySelector("#newOverwrite");
    if (!label || !overwrite) return;
    if (!state.currentSnapshotId) label.textContent = t("noCurrentSnapshot");
    else {
      const sameLocation = state.currentSnapshotLocation === state.snapshotLocation,
        key = sameLocation ? "currentSnapshot" : "currentSnapshotOtherLocation";
      label.textContent = t(key)
        .replace("{name}", state.currentSnapshotName || state.currentSnapshotId)
        .replace("{location}", snapshotLocationLabel(state.currentSnapshotLocation));
    }
    overwrite.disabled = !state.currentSnapshotId || state.currentSnapshotLocation !== state.snapshotLocation;
    updateSnapshotLocationUi();
  }
  function setNewCanvasDialogBusy(busy) {
    const dialog = document.querySelector("#newCanvasDialog");
    dialog.dataset.busy = String(busy);
    dialog.querySelectorAll("button, input").forEach((control) => (control.disabled = busy));
    if (!busy) updateNewCanvasDialog();
  }
  function applyBoardTitle(name, options) {
    options ||= {};
    const next = String(name || "").replace(/\s+/g, " ").trim().slice(0, 48) || "New board";
    if (!options.force && options.fromContent && !state.boardTitlePlaceholder) return next;
    state.boardTitle = next;
    state.boardTitlePlaceholder = Boolean(options.placeholder);
    state.lessonTitle = state.boardTitlePlaceholder ? "" : next;
    const docName = document.querySelector("#currentDocName");
    if (docName) docName.textContent = next;
    renderSidebarRecents();
    try {
      document.title = `${next} · Lumi6`;
    } catch {}
    return next;
  }
  function maybeNameBoardFromText(text) {
    if (!state.boardTitlePlaceholder) return;
    const cleaned = String(text || "")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/^(hey|hi|hello|please|can you|could you)\s+/i, "")
      .replace(/[?!.,;:]+$/g, "")
      .trim();
    if (cleaned.length < 4) return;
    const title = cleaned.length <= 40 ? cleaned : `${cleaned.slice(0, 38).replace(/\s+\S*$/, "")}`.trim();
    if (title.length < 4) return;
    applyBoardTitle(title, { fromContent: true, placeholder: false });
  }
  function startBlankCanvas() {
    const dialog = document.querySelector("#newCanvasDialog");
    if (state.selection) cancelSelection(true);
    clearTextEditors();
    state.snapshotLoadGeneration++;
    state.userRevision++;
    invalidateRecognition();
    cancelPendingForRevision();
    tiles.clear();
    clearSharpOverlays();
    state.inkBounds.clear();
    state.history = [];
    state.future = [];
    state.animationHistoryBefore = null;
    restoreAnimations([]);
    state.widgetHistoryBefore = null;
    restoreWidgets([]);
    state.imageHistoryBefore = null;
    restoreImages([]);
    state.textBoxHistoryBefore = null;
    void restoreTextBoxes([]);
    state.historyBefore.clear();
    state.currentSnapshotId = null;
    state.currentSnapshotName = "";
    state.currentSnapshotLocation = null;
    state.viewInitialized = false;
    state.aiDraftReturnMode = null;
    state.pendingHistoryRestored = false;
    setCanvasMode("pen", {
      preserveSelection:true,
      skipDraftFinalize:true,
      preserveWidgetRefinement:true,
    });
    if (typeof window.resetPrimerSession === "function") {
      window.resetPrimerSession();
    } else {
      try {
        sessionStorage.removeItem("primerSessionId");
        localStorage.removeItem("primerSessionId");
        sessionStorage.removeItem("primerRecentTurns");
        localStorage.removeItem("primerRecentTurns");
        sessionStorage.removeItem("lumi6_lesson_turns");
        localStorage.removeItem("lumi6_lesson_turns");
      } catch {}
    }
    if (typeof window.Lumi6Lesson?.clear === "function") {
      window.Lumi6Lesson.clear();
    }
    if (typeof window.primerVoice?.resetSession === "function") {
      window.primerVoice.resetSession();
    }
    state.lastLessonNote = null;
    state.atlasDrawnBoxes = [];
    if (typeof _atlasDrawCursor !== "undefined") {
      try { _atlasDrawCursor = null; } catch {}
    }
    applyBoardTitle("New board", { placeholder: true, force: true });
    if (typeof window.syncTalkModeFeed === "function") {
      window.syncTalkModeFeed();
    }
    renderSidebarRecents();
    document.querySelector("#newSnapshotName").value = "";
    if (dialog.open) dialog.close();
    if (document.querySelector("#historyPanel").classList.contains("open")) closeHistoryPanel();
    fit();
    setStatusKey("newCanvasReady");
  }
  function boardHasContent() {
    const talkTurns = typeof window.Lumi6Lesson?.turns === "function" ? window.Lumi6Lesson.turns() : [];
    return Boolean(
      tiles.size
      || state.images.length
      || state.textBoxes.length
      || (pluginEnabled("animation") && state.animations.length)
      || visibleWidgets().length
      || talkTurns.length
    );
  }
  function openNewCanvasDialog() {
    if (!boardHasContent()) {
      startBlankCanvas();
      return;
    }
    const dialog = document.querySelector("#newCanvasDialog");
    document.querySelector("#newSnapshotName").value = "";
    setNewCanvasDialogBusy(false);
    updateNewCanvasDialog();
    if (!dialog.open) dialog.showModal();
  }
  async function completeNewCanvas(saveMode) {
    const name = document.querySelector("#newSnapshotName").value;
    setNewCanvasDialogBusy(true);
    try {
      let saved = true;
      if (saveMode === "new") saved = await saveSnapshot({ name, location:state.snapshotLocation });
      else if (saveMode === "overwrite") saved = await saveSnapshot({ overwriteId:state.currentSnapshotId, name, location:state.snapshotLocation });
      if (saved === null) {
        setNewCanvasDialogBusy(false);
        return;
      }
      startBlankCanvas();
    } catch (error) {
      setStatus(`${t("snapshotError")}${error.message}`);
      setNewCanvasDialogBusy(false);
    }
  }
  function snapshotName(item) {
    return item.name || new Intl.DateTimeFormat(state.language === "zh" ? "zh-CN" : "en", { dateStyle: "medium", timeStyle: "short" }).format(item.createdAt);
  }
  function renderSnapshotList() {
    const list = document.querySelector("#historyList"),
      location = state.snapshotLocation;
    if (!list) return;
    list.replaceChildren();
    if (!snapshotItems.length) {
      const empty = document.createElement("div");
      empty.className = "history-empty";
      empty.textContent = t(state.snapshotLocation === "server" ? "emptyServerHistory" : "emptyDeviceHistory");
      list.append(empty);
      return;
    }
    for (const item of snapshotItems) {
      const card = document.createElement("article"),
        preview = document.createElement("div"),
        image = document.createElement("img"),
        meta = document.createElement("div"),
        title = document.createElement("strong"),
        detail = document.createElement("small"),
        actions = document.createElement("div"),
        load = document.createElement("button"),
        remove = document.createElement("button"),
        url = item.preview instanceof Blob ? URL.createObjectURL(item.preview) : "";
      card.className = "history-card";
      const isCurrent = item.id === state.currentSnapshotId && location === state.currentSnapshotLocation;
      card.classList.toggle("current", isCurrent);
      if (isCurrent) card.setAttribute("aria-current", "true");
      preview.className = "history-preview";
      image.alt = "";
      if (url) {
        image.src = url;
        image.onload = image.onerror = () => URL.revokeObjectURL(url);
      }
      preview.append(image);
      meta.className = "history-meta";
      title.textContent = snapshotName(item);
      detail.textContent = `${new Intl.DateTimeFormat(state.language === "zh" ? "zh-CN" : "en", { dateStyle: "short", timeStyle: "short" }).format(item.createdAt)} · ${item.tileCount} ${t("snapshotTiles")}`;
      if (pluginEnabled("animation") && item.animationCount) detail.textContent += " · " + item.animationCount + " " + t("snapshotAnimations");
      if (item.widgetCount) detail.textContent += " · " + item.widgetCount + " " + t("snapshotWidgets");
      if (item.imageCount) detail.textContent += " · " + item.imageCount + " " + t("snapshotImages");
      actions.className = "history-actions";
      load.textContent = t("loadSnapshot");
      load.onclick = () => runSnapshotAction(() => loadSnapshot(item.id, location));
      remove.className = "history-delete";
      remove.textContent = t("deleteSnapshot");
      remove.onclick = () => runSnapshotAction(() => deleteSnapshot(item.id, location));
      actions.append(load, remove);
      meta.append(title, detail, actions);
      card.append(preview, meta);
      list.append(card);
    }
  }
  async function refreshSnapshots() {
    const generation = ++snapshotListGeneration,
      location = state.snapshotLocation,
      items = await snapshotsAt(location);
    if (generation !== snapshotListGeneration || location !== state.snapshotLocation) return;
    snapshotItems = items;
    renderSnapshotList();
    renderSidebarRecents();
  }
  function renderSidebarRecents() {
    const root = document.querySelector("#sidebarRecents");
    if (!root) return;
    let label = root.querySelector(".sidebar-recents-label");
    if (!label) {
      label = document.createElement("div");
      label.className = "sidebar-recents-label";
      label.textContent = "Boards";
    }
    root.replaceChildren(label);
    const addItem = (text, options) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "sidebar-recent-item";
      if (options.current) button.classList.add("current");
      if (options.id) button.id = options.id;
      button.textContent = text;
      button.title = text;
      if (options.onClick) button.onclick = options.onClick;
      root.append(button);
      return button;
    };
    const currentName = state.boardTitle || "New board";
    if (!state.currentSnapshotId) {
      addItem(currentName, { current: true, id: "currentBoardItem" });
    }
    for (const item of snapshotItems.slice(0, 16)) {
      const name = snapshotName(item);
      const isCurrent = item.id === state.currentSnapshotId && state.snapshotLocation === state.currentSnapshotLocation;
      addItem(name, {
        current: isCurrent,
        onClick: () => runSnapshotAction(() => loadSnapshot(item.id, state.snapshotLocation)),
      });
    }
    if (!root.querySelector(".sidebar-recent-item")) {
      addItem(currentName, { current: true, id: "currentBoardItem" });
    }
  }
  async function runSnapshotAction(action) {
    try {
      await action();
    } catch (error) {
      setStatus(`${t("snapshotError")}${error.message}`);
    }
  }
  function openHistoryPanel() {
    const panel = document.querySelector("#historyPanel"),
      backdrop = document.querySelector("#historyBackdrop"),
      button = document.querySelector("#historyBtn");
    backdrop.hidden = false;
    panel.classList.add("open");
    panel.setAttribute("aria-hidden", "false");
    button.setAttribute("aria-expanded", "true");
    updateSnapshotLocationUi();
    refreshSnapshots().catch((error) => setStatus(`${t("snapshotError")}${error.message}`));
  }
  function closeHistoryPanel() {
    const panel = document.querySelector("#historyPanel"),
      backdrop = document.querySelector("#historyBackdrop"),
      button = document.querySelector("#historyBtn");
    panel.classList.remove("open");
    panel.setAttribute("aria-hidden", "true");
    button.setAttribute("aria-expanded", "false");
    setTimeout(() => {
      if (!panel.classList.contains("open")) backdrop.hidden = true;
    }, 220);
  }
  function recordBefore(tx, ty) {
    const k = key(tx, ty);
    if (!state.historyBefore.has(k)) state.historyBefore.set(k, cloneCanvas(tiles.get(k)));
  }
  function unionLocalBounds(current, next) {
    if (!current) return next;
    if (!next) return current;
    const x = Math.min(current.x, next.x),
      y = Math.min(current.y, next.y),
      right = Math.max(current.x + current.w, next.x + next.w),
      bottom = Math.max(current.y + current.h, next.y + next.h);
    return { x, y, w: right - x, h: bottom - y };
  }
  function extendInkBounds(k, next) {
    if (!state.inkBounds.has(k)) return;
    state.inkBounds.set(k, unionLocalBounds(state.inkBounds.get(k), next));
  }
  function lineIntersectsRect(a, b, rect) {
    let t0 = 0,
      t1 = 1;
    const dx = b.x - a.x,
      dy = b.y - a.y,
      tests = [
        [-dx, a.x - rect.x],
        [dx, rect.x + rect.w - a.x],
        [-dy, a.y - rect.y],
        [dy, rect.y + rect.h - a.y],
      ];
    for (const [p, q] of tests) {
      if (!p) {
        if (q < 0) return false;
        continue;
      }
      const ratio = q / p;
      if (p < 0) t0 = Math.max(t0, ratio);
      else t1 = Math.min(t1, ratio);
      if (t0 > t1) return false;
    }
    return true;
  }
  function flattenTextBoxesHitByEraser(a, b, size) {
    if (!state.textBoxes.length) return;
    const pad = size / 2 + 2,
      hit = {
        x: Math.min(a.x, b.x) - pad,
        y: Math.min(a.y, b.y) - pad,
        w: Math.abs(a.x - b.x) + pad * 2,
        h: Math.abs(a.y - b.y) + pad * 2,
      };
    for (let index = state.textBoxes.length - 1; index >= 0; index--) {
      const item = state.textBoxes[index];
      if (!item?.image || item.id === state.selectedTextBoxId) continue;
      const box = textBoxBox(item);
      if (box.x >= hit.x + hit.w || hit.x >= box.x + box.w || box.y >= hit.y + hit.h || hit.y >= box.y + box.h) continue;
      if (!lineIntersectsRect(a, b, { x: box.x - pad, y: box.y - pad, w: box.w + pad * 2, h: box.h + pad * 2 })) continue;
      recordTextBoxesBefore();
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
      state.textBoxes.splice(index, 1);
    }
  }
  function stroke(a, b, erase = false, size = state.pen, userChange = false) {
    if (!valid(a) || !valid(b)) return;
    if (erase) flattenTextBoxesHitByEraser(a, b, size);
    const pad = size / 2 + 2,
      x = Math.min(a.x, b.x) - pad,
      y = Math.min(a.y, b.y) - pad,
      w = Math.abs(a.x - b.x) + pad * 2,
      h = Math.abs(a.y - b.y) + pad * 2;
    invalidateSharpOverlays({ x, y, w, h });
    const x0 = Math.max(0, Math.floor(x / TILE)),
      y0 = Math.max(0, Math.floor(y / TILE)),
      x1 = Math.min(Math.ceil(SIZE / TILE) - 1, Math.floor((x + w) / TILE)),
      y1 = Math.min(Math.ceil(SIZE / TILE) - 1, Math.floor((y + h) / TILE));
    for (let ty = y0; ty <= y1; ty++)
      for (let tx = x0; tx <= x1; tx++) {
        const expanded = { x: tx * TILE - pad, y: ty * TILE - pad, w: TILE + pad * 2, h: TILE + pad * 2 };
        if (!lineIntersectsRect(a, b, expanded)) continue;
        const existing = tile(tx, ty, false);
        if (erase && !existing) continue;
        recordBefore(tx, ty);
        const c = existing || tile(tx, ty),
          q = c.getContext("2d");
        q.save();
        q.globalCompositeOperation = erase ? "destination-out" : "source-over";
        q.strokeStyle = state.inkColor;
        q.lineWidth = size;
        q.lineCap = q.lineJoin = "round";
        q.beginPath();
        q.moveTo(a.x - tx * TILE, a.y - ty * TILE);
        q.lineTo(b.x - tx * TILE, b.y - ty * TILE);
        q.stroke();
        q.restore();
        const k = key(tx, ty);
        if (erase) state.inkBounds.delete(k);
        else {
          const local = {
            x: Math.max(0, Math.min(a.x, b.x) - tx * TILE - pad),
            y: Math.max(0, Math.min(a.y, b.y) - ty * TILE - pad),
            w: Math.min(TILE, Math.max(a.x, b.x) - tx * TILE + pad) - Math.max(0, Math.min(a.x, b.x) - tx * TILE - pad),
            h: Math.min(TILE, Math.max(a.y, b.y) - ty * TILE + pad) - Math.max(0, Math.min(a.y, b.y) - ty * TILE - pad),
          };
          extendInkBounds(k, local);
        }
      }
    if (userChange) {
      mergeDirty(a.x, a.y, pad);
      mergeDirty(b.x, b.y, pad);
    }
  }
  function dot(p, erase = false, size = state.pen, userChange = false) {
    stroke(p, { x: p.x + 0.01, y: p.y + 0.01 }, erase, size, userChange);
  }
  function pressureWidth(e) {
    if (e.pointerType !== "pen" || !Number.isFinite(e.pressure) || e.pressure <= 0) return state.pen;
    return Math.max(3, Math.min(16, state.pen * (0.72 + e.pressure * 0.7)));
  }
  function logicalWidth(cssWidth) {
    const maximum = state.mode === "eraser" ? 1600 : 320;
    return Math.max(1, Math.min(maximum, cssWidth / Math.max(0.03, state.scale)));
  }
  function drawPreview(s, context = ctx) {
    const ctx = context;
    ctx.strokeStyle = s.erase ? "#dc262666" : `${state.inkColor}88`;
    ctx.lineWidth = s.size;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(s.a.x, s.a.y);
    ctx.lineTo(s.b.x, s.b.y);
    ctx.stroke();
  }
  function clonePendingHistoryItem(item) {
    if (!item) return null;
    return {
      ...item,
      command:item.command ? { ...item.command } : item.command,
      textCommand:item.textCommand ? { ...item.textCommand } : item.textCommand,
      animationPlayback:item.animationPlayback ? { ...item.animationPlayback } : item.animationPlayback,
      bounds:item.bounds ? { ...item.bounds } : item.bounds,
    };
  }
  function clonePendingHistoryDraft(pending) {
    if (!pending) return null;
    const clone = {
      ...pending,
      command:pending.command ? { ...pending.command } : pending.command,
      textCommand:pending.textCommand ? { ...pending.textCommand } : pending.textCommand,
      animationPlayback:pending.animationPlayback ? { ...pending.animationPlayback } : pending.animationPlayback,
      resolves:[],
      resolve:null,
    };
    if (pending.items) clone.items = pending.items.map(clonePendingHistoryItem);
    return clone;
  }
  function pendingWidgetHistoryRecord(widget) {
    if (!widget) return null;
    return {
      id:widget.id,
      pluginId:widget.pluginId,
      x:widget.x,
      y:widget.y,
      w:widget.w,
      h:widget.h,
      contentW:widget.contentW,
      contentH:widget.contentH,
      title:widget.title,
      refreshSeconds:widget.refreshSeconds,
      widgetType:widget.widgetType,
      ...(widget.widgetType === "diagram_source" ? { source:widget.source } : { html:widget.html }),
      ...(widget.diagramKind ? { diagramKind:widget.diagramKind } : {}),
      ...(widget.sourceFormat ? { sourceFormat:widget.sourceFormat } : {}),
      ...(widget.frameworkVersion ? { frameworkVersion:widget.frameworkVersion } : {}),
      ...(widget.copyText ? { copyText:widget.copyText, copyLabel:widget.copyLabel } : {}),
      revision:widget.revision,
    };
  }
  function capturePendingHistoryState() {
    if (!state.pending && !state.pendingWidget) return null;
    return {
      pending:clonePendingHistoryDraft(state.pending),
      pendingWidget:pendingWidgetHistoryRecord(state.pendingWidget),
      returnMode:state.aiDraftReturnMode,
    };
  }
  function recordPendingHistory(entry, before, after = null) {
    if (!entry || !before) return;
    entry.pendingBefore = before;
    entry.pendingAfter = after;
    entry.aiDraftReturnMode = before.returnMode;
  }
  function clearPendingHistoryState() {
    const returnMode = state.aiDraftReturnMode;
    state.pending = null;
    state.pendingGesture = null;
    if (state.pendingWidget) rejectPendingWidget(AI_CANCELLED, { restoreMode:false, status:false });
    state.pendingWidgetReplacement = null;
    state.pendingHistoryRestored = false;
    state.aiDraftReturnMode = null;
    hideAnimationControls();
    updateBatchActions();
    return returnMode;
  }
  function restorePendingHistoryState(entry, side) {
    const returnMode = clearPendingHistoryState(),
      hasPendingTransition = !Array.isArray(entry) && Object.prototype.hasOwnProperty.call(entry || {}, "pendingBefore");
    if (!hasPendingTransition) {
      if (returnMode && state.mode === "hand") setCanvasMode(returnMode, { preserveSelection:true, skipDraftFinalize:true });
      return;
    }
    const snapshot = side === "before" ? entry.pendingBefore : entry.pendingAfter;
    if (!snapshot) {
      const mode = entry.aiDraftReturnMode;
      if (mode && state.mode === "hand") setCanvasMode(mode, { preserveSelection:true, skipDraftFinalize:true });
      return;
    }
    state.aiDraftReturnMode = snapshot.returnMode;
    if (snapshot.pending) {
      state.pending = clonePendingHistoryDraft(snapshot.pending);
      state.pending.revision = state.userRevision;
      state.pending.latestUserRevision = state.userRevision;
    }
    if (snapshot.pendingWidget) {
      const widget = widgetRecord(snapshot.pendingWidget);
      if (widget) {
        widget.pending = true;
        widget.revision = state.userRevision;
        const numbered = /^widget-(\d+)$/.exec(widget.id);
        if (numbered) state.nextWidgetId = Math.max(state.nextWidgetId, Number(numbered[1]) + 1);
        state.pendingWidget = widget;
        mountWidget(widget);
      }
    }
    state.pendingHistoryRestored = Boolean(state.pending || state.pendingWidget);
    if (state.pendingHistoryRestored) {
      setCanvasMode("hand", { preserveSelection:true, skipDraftFinalize:true });
      updateBatchActions();
      setStatusKey(state.pending?.items ? "batchDraftReady" : "draftReady");
    }
  }
  function save() {
    if (!state.historyBefore.size && !state.animationHistoryBefore && !state.widgetHistoryBefore && !state.imageHistoryBefore && !state.textBoxHistoryBefore) return null;
    const changes = [];
    const animationsBefore = state.animationHistoryBefore,
      animationsAfter = animationsBefore ? serializedAnimations() : null,
      widgetsBefore = state.widgetHistoryBefore,
      widgetsAfter = widgetsBefore ? serializedWidgets() : null,
      imagesBefore = state.imageHistoryBefore,
      imagesAfter = imagesBefore ? imageHistoryState() : null,
      textBoxesBefore = state.textBoxHistoryBefore,
      textBoxesAfter = textBoxesBefore ? textBoxHistoryState() : null;
    for (const [k, before] of state.historyBefore) {
      let current = tiles.get(k);
      if (current && state.inkBounds.get(k) === undefined) {
        const [tx, ty] = k.split(",").map(Number),
          ink = inkBox(current, Math.min(TILE, SIZE - tx * TILE), Math.min(TILE, SIZE - ty * TILE));
        if (ink) state.inkBounds.set(k, ink);
        else {
          tiles.delete(k);
          state.inkBounds.delete(k);
          current = null;
        }
      }
      changes.push({ k, before, after: cloneCanvas(current) });
    }
    state.historyBefore.clear();
    const entry = { tiles: changes, animationsBefore, animationsAfter, widgetsBefore, widgetsAfter, imagesBefore, imagesAfter, textBoxesBefore, textBoxesAfter };
    state.history.push(entry);
    state.animationHistoryBefore = null;
    state.widgetHistoryBefore = null;
    state.imageHistoryBefore = null;
    state.textBoxHistoryBefore = null;
    if (state.history.length > MAX_HISTORY) state.history.shift();
    state.future = [];
    return entry;
  }
  function applyHistory(entry, side) {
    const changes = Array.isArray(entry) ? entry : entry?.tiles || [];
    for (const change of changes) {
      const value = change[side];
      if (value) tiles.set(change.k, cloneCanvas(value));
      else tiles.delete(change.k);
      state.inkBounds.delete(change.k);
    }
    const animationState = !Array.isArray(entry) ? entry?.[side === "before" ? "animationsBefore" : "animationsAfter"] : null;
    if (animationState) restoreAnimations(animationState);
    const widgetState = !Array.isArray(entry) ? entry?.[side === "before" ? "widgetsBefore" : "widgetsAfter"] : null;
    if (widgetState) restoreWidgets(widgetState);
    const imageState = !Array.isArray(entry) ? entry?.[side === "before" ? "imagesBefore" : "imagesAfter"] : null;
    if (imageState) restoreImages(imageState);
    const textBoxState = !Array.isArray(entry) ? entry?.[side === "before" ? "textBoxesBefore" : "textBoxesAfter"] : null;
    if (textBoxState) void restoreTextBoxes(textBoxState);
    restorePendingHistoryState(entry, side);
    clearSharpOverlays();
    requestAnimationLayerRender();
    render();
  }
  function undo() {
    save();
    const change = state.history.pop();
    if (!change) return;
    invalidateRecognition();
    state.future.push(change);
    applyHistory(change, "before");
  }
  function redo() {
    const change = state.future.pop();
    if (!change) return;
    invalidateRecognition();
    state.history.push(change);
    applyHistory(change, "after");
  }
  function sameBox(a, b) {
    return a && b && Math.abs(a.x - b.x) < 0.01 && Math.abs(a.y - b.y) < 0.01 && Math.abs(a.w - b.w) < 0.01 && Math.abs(a.h - b.h) < 0.01;
  }
  function selectionHasChanges(selection) {
    return Boolean(selection?.color) || !sameBox(selection?.box, selection?.originalBox);
  }
  function recolorSelectionImage(image, color) {
    const recolored = offscreen(image.width, image.height),
      context = recolored.getContext("2d");
    context.drawImage(image, 0, 0);
    context.globalCompositeOperation = "source-in";
    context.fillStyle = color;
    context.fillRect(0, 0, recolored.width, recolored.height);
    return recolored;
  }
  function traceSelectionPath(context, points, offsetX = 0, offsetY = 0, close = true) {
    if (!points.length) return;
    context.beginPath();
    context.moveTo(points[0].x - offsetX, points[0].y - offsetY);
    for (let index = 1; index < points.length; index++) context.lineTo(points[index].x - offsetX, points[index].y - offsetY);
    if (close) context.closePath();
  }
  function selectionPathFor(selection, box = selection.box) {
    const source = selection.originalPath || selection.points || [];
    return selection.originalBox && box ? SELECT.mapPath(source, selection.originalBox, box) : source.map((point) => ({ ...point }));
  }
  function selectionContentBounds(selection) {
    let bounds = null;
    for (const fragment of selection.fragments || []) {
      const target = SELECT.mapFragment(fragment, selection.originalBox, selection.box);
      bounds = SELECT.unionBox(bounds, target);
    }
    return bounds;
  }
  function drawSelectionAxisHandles(context, box, size) {
    context.moveTo(box.x + box.w, box.y + box.h / 2 - size * 0.48);
    context.lineTo(box.x + box.w, box.y + box.h / 2 + size * 0.48);
    context.moveTo(box.x + box.w / 2 - size * 0.48, box.y + box.h);
    context.lineTo(box.x + box.w / 2 + size * 0.48, box.y + box.h);
  }
  function drawSelection(selection, context = ctx) {
    const ctx = context,
      unit = 1 / state.scale,
      size = 14 * unit;
    if (selection.phase === "lasso") {
      ctx.save();
      ctx.fillStyle = "#2679b81a";
      ctx.strokeStyle = "#2679b8";
      ctx.lineWidth = 1.5 * unit;
      ctx.setLineDash([7 * unit, 6 * unit]);
      traceSelectionPath(ctx, selection.points);
      ctx.fill("evenodd");
      ctx.stroke();
      ctx.restore();
      return;
    }
    for (const fragment of selection.fragments) {
      const target = SELECT.mapFragment(fragment, selection.originalBox, selection.box);
      ctx.drawImage(fragment.renderImage || fragment.image, target.x, target.y, target.w, target.h);
    }
    const path = selectionPathFor(selection);
    ctx.save();
    ctx.strokeStyle = "#2679b8";
    ctx.lineWidth = 1.8 * unit;
    ctx.setLineDash([7 * unit, 6 * unit]);
    traceSelectionPath(ctx, path);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineCap = "round";
    ctx.beginPath();
    drawResizeHandle(ctx, selection.box, size);
    drawSelectionAxisHandles(ctx, selection.box, size);
    ctx.stroke();
    ctx.restore();
    if (selection.showMoveHandle) drawMoveHandle(ctx, selection.box, size, true);
    // Keep the legacy call shape available for integrations that opt into the old controls.
    if (selection.legacyActions) drawDraftActions(ctx, selection.box, size);
  }
  function padInkBox(box, pad) {
    if (!box) return null;
    return {
      x: box.x - pad,
      y: box.y - pad,
      w: box.w + pad * 2,
      h: box.h + pad * 2,
    };
  }
  function rememberInkBox(box) {
    if (!box || !Number.isFinite(box.x) || !Number.isFinite(box.y) || !Number.isFinite(box.w) || !Number.isFinite(box.h)) return;
    state.lastInkBox = { x: box.x, y: box.y, w: box.w, h: box.h };
  }
  function rectPathForBox(box) {
    return [
      { x: box.x, y: box.y },
      { x: box.x + box.w, y: box.y },
      { x: box.x + box.w, y: box.y + box.h },
      { x: box.x, y: box.y + box.h },
      { x: box.x, y: box.y },
    ];
  }
  function inkBoundsInRegion(probe) {
    if (!probe) return null;
    let bounds = null;
    forTiles(
      probe.x,
      probe.y,
      probe.w,
      probe.h,
      (canvas, tx, ty) => {
        const tileBox = { x: tx * TILE, y: ty * TILE, w: TILE, h: TILE };
        const part = intersection(tileBox, probe);
        if (!part) return;
        const ink = inkBoxInRect(canvas, part.x - tileBox.x, part.y - tileBox.y, part.w, part.h);
        if (!ink) return;
        bounds = SELECT.unionBox(bounds, {
          x: tileBox.x + ink.x,
          y: tileBox.y + ink.y,
          w: ink.w,
          h: ink.h,
        });
      },
      false,
    );
    return bounds;
  }
  function textBoxBoundsInRegion(probe) {
    if (!probe) return null;
    let bounds = null;
    for (const item of visibleTextBoxes(probe)) bounds = SELECT.unionBox(bounds, textBoxBox(item));
    return bounds;
  }
  function imageBoundsInRegion(probe) {
    if (!probe) return null;
    let bounds = null;
    for (const item of visibleImages(probe)) bounds = SELECT.unionBox(bounds, imageBox(item));
    return bounds;
  }
  function contentBoundsInRegion(probe) {
    return SELECT.unionBox(SELECT.unionBox(inkBoundsInRegion(probe), textBoxBoundsInRegion(probe)), imageBoundsInRegion(probe));
  }
  function textBoxHitsSelection(item, points, box) {
    const tb = textBoxBox(item),
      overlap = intersection(tb, box);
    if (!overlap) return false;
    const center = { x: tb.x + tb.w / 2, y: tb.y + tb.h / 2 };
    if (SELECT.pointInPolygon(center, points)) return true;
    const overlapArea = overlap.w * overlap.h,
      textArea = Math.max(1, tb.w * tb.h);
    return overlapArea / textArea >= 0.55;
  }
  function liftTextBoxesForSelection(points, box, fragments, onlyId) {
    const lifted = [];
    for (let index = state.textBoxes.length - 1; index >= 0; index--) {
      const item = state.textBoxes[index];
      if (!item?.image || item.id === state.selectedTextBoxId) continue;
      if (onlyId && item.id !== onlyId) continue;
      if (!onlyId && !textBoxHitsSelection(item, points, box)) continue;
      fragments.push({ image: item.image, x: item.x, y: item.y, w: item.w, h: item.h, textBox: item });
      lifted.push(item);
      recordTextBoxesBefore();
      state.textBoxes.splice(index, 1);
    }
    return lifted;
  }
  function liftImagesForSelection(points, box, fragments, onlyId) {
    const lifted = [];
    for (let index = state.images.length - 1; index >= 0; index--) {
      const item = state.images[index];
      if (!item?.image) continue;
      if (onlyId && item.id !== onlyId) continue;
      if (!onlyId && !textBoxHitsSelection(item, points, box)) continue;
      fragments.push({ image: item.image, x: item.x, y: item.y, w: item.w, h: item.h, boardImage: item });
      lifted.push(item);
      recordImagesBefore();
      state.images.splice(index, 1);
    }
    return lifted;
  }
  function absorbOverlappingPending(box) {
    const pending = state.pending;
    if (!pending || !box) return;
    if (pending.items) {
      for (let index = pending.items.length - 1; index >= 0; index--) {
        const itemBox = pendingItemBounds(pending.items[index]);
        if (itemBox && intersection(itemBox, box)) acceptPendingItem(index);
      }
      return;
    }
    if (intersection(draftBounds(pending), box)) acceptPending({ restoreMode: false });
  }
  function captureBoxSelection(box, options) {
    if (!box || box.w < 1 || box.h < 1) return false;
    return captureSelection(rectPathForBox(box), options);
  }
  function boxesAlmostEqual(a, b) {
    return a && b
      && Math.abs(a.x - b.x) < 1
      && Math.abs(a.y - b.y) < 1
      && Math.abs(a.w - b.w) < 1
      && Math.abs(a.h - b.h) < 1;
  }
  function selectInkClusterAtPoint(point) {
    const scale = Math.max(state.scale, 0.05),
      hitPad = 14 / scale;
    let bounds = inkBoundsInRegion({
      x: point.x - hitPad,
      y: point.y - hitPad,
      w: hitPad * 2,
      h: hitPad * 2,
    });
    if (!bounds) return false;
    const gap = 7 / scale,
      maxGrow = 56 / scale,
      origin = { ...bounds };
    for (let i = 0; i < 10; i += 1) {
      const next = inkBoundsInRegion(padInkBox(bounds, gap));
      if (!next || boxesAlmostEqual(next, bounds)) break;
      if (
        next.x < origin.x - maxGrow
        || next.y < origin.y - maxGrow
        || next.x + next.w > origin.x + origin.w + maxGrow
        || next.y + next.h > origin.y + origin.h + maxGrow
      ) break;
      bounds = next;
    }
    rememberInkBox(bounds);
    return captureBoxSelection(bounds, {
      quiet: true,
      allowSmall: true,
      liftText: false,
      liftImages: false,
      absorbPending: false,
    });
  }
  function selectSingleAtPoint(point) {
    const textHit = textBoxAtPoint(point);
    if (textHit) {
      rememberInkBox(textBoxBox(textHit));
      return captureBoxSelection(textBoxBox(textHit), {
        quiet: true,
        allowSmall: true,
        skipInk: true,
        liftImages: false,
        onlyTextId: textHit.id,
        absorbPending: false,
      });
    }
    const imageHit = imageAtPoint(point);
    if (imageHit) {
      rememberInkBox(imageBox(imageHit));
      return captureBoxSelection(imageBox(imageHit), {
        quiet: true,
        allowSmall: true,
        skipInk: true,
        liftText: false,
        onlyImageId: imageHit.id,
        absorbPending: false,
      });
    }
    return selectInkClusterAtPoint(point);
  }
  function selectNearestContent(point) {
    return selectSingleAtPoint(point);
  }
  function captureSelection(points, options) {
    options ||= {};
    const box = SELECT.polygonBounds(points, SIZE);
    if (!box || points.length < 3) {
      if (!options.quiet) setStatusKey("selectionTooSmall");
      return false;
    }
    if (!options.allowSmall && (SELECT.pathLength(points, state.scale) < 12 || box.w * state.scale < 4 || box.h * state.scale < 4)) {
      if (!options.quiet) setStatusKey("selectionTooSmall");
      return false;
    }
    const fragments = [];
    const originalBox = { ...box };
    if (!options.skipInk) {
      forTiles(
        box.x,
        box.y,
        box.w,
        box.h,
        (canvas, tx, ty) => {
          const tileBox = { x: tx * TILE, y: ty * TILE, w: TILE, h: TILE },
            part = intersection(tileBox, box);
          if (!part) return;
          const clipped = offscreen(part.w, part.h, true),
            clippedContext = clipped.getContext("2d", { willReadFrequently: true });
          clippedContext.save();
          traceSelectionPath(clippedContext, points, part.x, part.y);
          clippedContext.clip("evenodd");
          clippedContext.drawImage(canvas, part.x - tileBox.x, part.y - tileBox.y, part.w, part.h, 0, 0, part.w, part.h);
          clippedContext.restore();
          const ink = inkBox(clipped);
          if (!ink) return;
          const image = offscreen(ink.w, ink.h);
          image.getContext("2d").drawImage(clipped, ink.x, ink.y, ink.w, ink.h, 0, 0, ink.w, ink.h);
          const fragment = { image, x: part.x + ink.x, y: part.y + ink.y, w: ink.w, h: ink.h };
          fragments.push(fragment);
        },
        false,
      );
    }
    if (options.absorbPending !== false) absorbOverlappingPending(box);
    const liftedTextBoxes = options.liftText === false
      ? []
      : liftTextBoxesForSelection(points, box, fragments, options.onlyTextId);
    const liftedImages = options.liftImages === false
      ? []
      : liftImagesForSelection(points, box, fragments, options.onlyImageId);
    if (!fragments.length) {
      state.selection = null;
      if (!options.quiet) setStatusKey("selectionEmpty");
      render();
      return false;
    }
    let content = null;
    for (const fragment of fragments) {
      content = SELECT.unionBox(content, { x: fragment.x, y: fragment.y, w: fragment.w, h: fragment.h });
    }
    const tightPad = 3 / Math.max(state.scale, 0.05);
    const tight = content ? padInkBox(content, tightPad) : originalBox;
    const tightPath = rectPathForBox(tight);
    invalidateSharpOverlays(box);
    save();
    invalidateRecognition();
    state.userRevision++;
    const beforeTiles = new Map();
    forTiles(
      box.x,
      box.y,
      box.w,
      box.h,
      (canvas, tx, ty) => {
        const tileKey = key(tx, ty),
          before = cloneCanvas(canvas);
        beforeTiles.set(tileKey, before);
        state.historyBefore.set(tileKey, before);
      },
      false,
    );
    forTiles(
      box.x,
      box.y,
      box.w,
      box.h,
      (canvas, tx, ty) => {
        recordBefore(tx, ty);
        const tileContext = canvas.getContext("2d");
        tileContext.save();
        tileContext.globalCompositeOperation = "destination-out";
        tileContext.fillStyle = "#000";
        traceSelectionPath(tileContext, points, tx * TILE, ty * TILE);
        tileContext.fill("evenodd");
        tileContext.restore();
        state.inkBounds.delete(key(tx, ty));
      },
      false,
    );
    state.selection = {
      phase: "active",
      originalPath: tightPath.map((point) => ({ ...point })),
      path: tightPath.map((point) => ({ ...point })),
      originalBox: { ...tight },
      box: { ...tight },
      fragments,
      contentBox: selectionContentBounds({ fragments, originalBox: tight, box: tight }),
      beforeTiles,
      liftedTextBoxes,
      liftedImages,
      color: null,
    };
    state.selectionGesture = null;
    setStatusKey("selectionReady");
    render();
    return true;
  }
  function restoreSelectionSource(selection) {
    for (const [tileKey, before] of selection.beforeTiles) {
      if (before) tiles.set(tileKey, cloneCanvas(before));
      else tiles.delete(tileKey);
      state.inkBounds.delete(tileKey);
    }
    for (const item of selection.liftedTextBoxes || []) {
      if (item && !state.textBoxes.some((existing) => existing.id === item.id)) state.textBoxes.push(item);
    }
    for (const item of selection.liftedImages || []) {
      if (item && !state.images.some((existing) => existing.id === item.id)) state.images.push(item);
    }
    state.historyBefore.clear();
    state.textBoxHistoryBefore = null;
  }
  function cancelSelection(silent = false) {
    const selection = state.selection;
    if (!selection) return false;
    const pending = state.pending,
      selectionRequest = state.activeAI?.selection === selection,
      pendingSelection = pending?.selection === selection || (pending?.isolatedSelection && selectionRequest);
    if (pendingSelection) rejectPending();
    if (selectionAIBusy(selection) || selectionRequest) supersedeActiveAI("selection-cancelled");
    if (selection.phase === "active" && !selection.acceptedDraft) restoreSelectionSource(selection);
    state.selection = null;
    state.selectionGesture = null;
    resetCanvasCursor();
    render();
    if (!silent) setStatusKey("selectionCancelled");
    return true;
  }
  function commitSelection() {
    const selection = state.selection;
    if (!selection) return false;
    if (selectionAIBusy(selection)) return false;
    if (selection.phase !== "active") {
      state.selection = null;
      state.selectionGesture = null;
      render();
      return false;
    }
    if (!selectionHasChanges(selection)) {
      cancelSelection(true);
      setStatusKey("selectionCommitted");
      return false;
    }
    state.selection = null;
    state.selectionGesture = null;
    for (const fragment of selection.fragments) {
      const target = SELECT.mapFragment(fragment, selection.originalBox, selection.box);
      if (fragment.textBox && !selection.color) {
        const item = fragment.textBox,
          scaleX = target.w / Math.max(1, fragment.w),
          scaleY = target.h / Math.max(1, fragment.h);
        item.x = target.x;
        item.y = target.y;
        item.w = target.w;
        item.h = target.h;
        item.fontSize = Math.max(1, item.fontSize * Math.min(scaleX, scaleY));
        item.maxWidth = Math.max(item.fontSize * 3, item.maxWidth * scaleX);
        if (!state.textBoxes.some((existing) => existing.id === item.id)) state.textBoxes.push(item);
        continue;
      }
      if (fragment.boardImage && !selection.color) {
        const item = fragment.boardImage,
          scaleX = target.w / Math.max(1, fragment.w),
          scaleY = target.h / Math.max(1, fragment.h);
        item.x = target.x;
        item.y = target.y;
        item.w = target.w;
        item.h = target.h;
        if (!state.images.some((existing) => existing.id === item.id)) state.images.push(item);
        continue;
      }
      blitSized(fragment.renderImage || fragment.image, target.x, target.y, target.w, target.h);
    }
    state.userRevision++;
    save();
    resetCanvasCursor();
    render();
    setStatusKey("selectionCommitted");
    return true;
  }
  function applySelectionColor(color) {
    const selection = state.selection;
    if (!selection || selection.phase !== "active" || selection.color === color) return false;
    selection.color = color;
    for (const fragment of selection.fragments) fragment.renderImage = recolorSelectionImage(fragment.image, color);
    render();
    setStatusKey("selectionRecolored");
    return true;
  }
  function selectionHasTypesetDraft(selection = state.selection) {
    const pending = state.pending;
    return Boolean(selection && pending && pending.isolatedSelection && (pending.selection === selection || !pending.selection));
  }
  function dismissSelectionKeepInkRemoved(selection = state.selection) {
    if (!selection) return;
    if (state.selection === selection) {
      state.selection = null;
      state.selectionGesture = null;
    }
    state.historyBefore.clear();
    state.textBoxHistoryBefore = null;
    updateSelectionToolbar();
    requestRender();
  }
  function updateSelectionToolbar() {
    if (!selectionOverlayLayer || !selectionToolbar) return;
    const selection = state.selection,
      typesetting = selectionIsTypesetting(selection),
      draftReady = selectionHasTypesetDraft(selection),
      active = selection?.phase === "active" && !typesetting;
    selectionOverlayLayer.hidden = !active;
    selectionOverlayLayer.setAttribute("aria-hidden", String(!active));
    if (!active) return;
    const viewport = view.getBoundingClientRect(),
      pendingBox = draftReady
        ? (state.pending.items ? pendingItemBounds(state.pending.items[0]) : draftBounds(state.pending))
        : null,
      box = pendingBox || selection.box,
      toolbarStyle = runtimeElementStyle(selectionToolbar, "selection-toolbar");
    selectionToolbar.hidden = false;
    selectionToolbar.setAttribute("aria-busy", "false");
    if (selectionTypesetButton) {
      selectionTypesetButton.hidden = false;
      selectionTypesetButton.disabled = false;
      selectionTypesetButton.setAttribute("aria-busy", "false");
      selectionTypesetButton.textContent = t(draftReady ? "selectionKeep" : "selectionTypeset");
    }
    if (selectionVisualizeButton) {
      selectionVisualizeButton.hidden = draftReady;
      selectionVisualizeButton.disabled = Boolean(state.visualizingSelection);
      selectionVisualizeButton.setAttribute("aria-busy", String(Boolean(state.visualizingSelection)));
      selectionVisualizeButton.textContent = t(state.visualizingSelection ? "selectionVisualizing" : "selectionVisualize");
    }
    if (selectionDeleteButton) {
      selectionDeleteButton.hidden = draftReady;
      selectionDeleteButton.disabled = false;
    }
    if (selectionCancelButton) selectionCancelButton.textContent = t(draftReady ? "selectionDiscard" : "selectionCancel");
    const width = selectionToolbar.offsetWidth || 280,
      height = selectionToolbar.offsetHeight || 36,
      left = box.x * state.scale + state.panX,
      top = box.y * state.scale + state.panY,
      bottom = (box.y + box.h) * state.scale + state.panY,
      maxX = Math.max(8, viewport.width - width - 8),
      x = Math.max(8, Math.min(maxX, left + (box.w * state.scale - width) / 2)),
      preferredY = top - height - 8,
      y = preferredY >= 8 ? preferredY : bottom + 8,
      maxY = Math.max(8, viewport.height - height - 8);
    if (toolbarStyle) {
      toolbarStyle.setProperty("--selection-toolbar-x", `${x}px`);
      toolbarStyle.setProperty("--selection-toolbar-y", `${Math.max(8, Math.min(maxY, y))}px`);
    } else {
      selectionToolbar.style.left = `${x}px`;
      selectionToolbar.style.top = `${Math.max(8, Math.min(maxY, y))}px`;
    }
  }
  function releaseSelectionAITransformLock(run = state.activeAI) {
    const selection = run?.isolatedSelection ? run.selection : null,
      token = run?.selectionRequestToken;
    if (!selection || !token || selection.aiRequest?.token !== token || state.selection !== selection) return;
    selection.aiRequest = null;
    updateSelectionToolbar();
  }
  function preservePendingAfterSelectionDelete(selection, pending = state.pending, selectionRequest = false) {
    if (!pending || (pending.selection !== selection && !(pending.isolatedSelection && selectionRequest))) return;
    pending.revision = state.userRevision;
    pending.latestUserRevision = state.userRevision;
  }
  function deleteSelection() {
    const selection = state.selection;
    if (!selection || selection.phase !== "active") return false;
    const pending = state.pending,
      selectionRequest = state.activeAI?.selection === selection || pending?.selection === selection;
    supersedeActiveAI("selection-deleted");
    state.selection = null;
    state.selectionGesture = null;
    state.userRevision++;
    preservePendingAfterSelectionDelete(selection, pending, selectionRequest);
    save();
    resetCanvasCursor();
    render();
    setStatusKey("selectionDeleted");
    return true;
  }
  function buildSelectionTypesetRequest(selection) {
    const packed = buildSelectionImage(selection);
    if (!packed) {
      setStatusKey("selectionEmpty");
      return null;
    }
    return packed;
  }
  function normalizeSelectionForAI() {
    const selection = state.selection;
    if (!selection || selection.phase !== "active") return false;
    const packed = buildSelectionTypesetRequest(selection);
    if (!packed) return false;
    return requestSelectionAI("normalize", selection, packed);
  }
  function selectionRawText(selection) {
    const boxed = [
      ...(selection?.fragments || []).map((fragment) => String(fragment.textBox?.text || fragment.text || "").trim()),
      ...(selection?.liftedTextBoxes || []).map((item) => String(item?.text || "").trim()),
    ].filter(Boolean).join(" ");
    if (boxed) return boxed;
    if (state.textEditors?.size && selection?.box) {
      const scale = Math.max(0.03, state.scale);
      const fromEditors = [...state.textEditors.values()]
        .filter((editor) => {
          const box = { x: editor.x, y: editor.y, w: editor.widthCss / scale, h: editor.heightCss / scale };
          return Boolean(intersection(box, selection.box));
        })
        .map((editor) => String(editor.textarea?.value || "").trim())
        .filter(Boolean)
        .join(" ");
      if (fromEditors) return fromEditors;
    }
    const typed = state.latestTypedInput;
    if (typed?.text && selection?.box && typed.box && intersection(typed.box, selection.box)) {
      return String(typed.text).trim();
    }
    return "";
  }
  function nearbyBoardText(selection) {
    const selected = new Set((selection?.liftedTextBoxes || []).map((item) => item?.id).filter(Boolean));
    return state.textBoxes
      .filter((item) => item?.text && !selected.has(item.id))
      .map((item) => String(item.text).trim())
      .filter(Boolean)
      .join(" • ")
      .slice(0, 400);
  }
  function childVisualProfile() {
    try {
      const profile = JSON.parse(localStorage.getItem("primerProfile") || "{}");
      return {
        grade: profile.grade || "",
        age: profile.age_years || ""
      };
    } catch {
      return {};
    }
  }
  function conceptTopicFromText(raw) {
    let t = String(raw || "").replace(/\s+/g, " ").trim();
    t = t.replace(/^(please\s+|can you\s+|could you\s+)+/i, "");
    t = t.replace(/^(tell me|explain|teach me|show me|draw|visualize|picture|illustrate)\s+(about\s+|me\s+)?/i, "");
    t = t.replace(/^(what is|what's|whats|what are|what was|what were|who is|who was|why is|why are|why do|why does|why did|how does|how do|how is|how are|how to|define|describe)\s+/i, "");
    t = t.replace(/^(the\s+)?(meaning|definition)\s+of\s+/i, "");
    t = t.replace(/[?!.]+$/g, "").trim();
    return t.slice(0, 160);
  }
  function selectionTopicHint(selection) {
    const boxed = selectionRawText(selection);
    if (boxed) return conceptTopicFromText(boxed);
    if (state.textEditors?.size && selection?.box) {
      const scale = Math.max(0.03, state.scale);
      const fromEditors = [...state.textEditors.values()]
        .filter((editor) => {
          const box = { x: editor.x, y: editor.y, w: editor.widthCss / scale, h: editor.heightCss / scale };
          return Boolean(intersection(box, selection.box));
        })
        .map((editor) => String(editor.textarea?.value || "").trim())
        .filter(Boolean)
        .join(" ");
      if (fromEditors) return conceptTopicFromText(fromEditors);
    }
    const typed = state.latestTypedInput;
    if (typed?.text && selection?.box && typed.box && intersection(typed.box, selection.box)) {
      return conceptTopicFromText(typed.text);
    }
    return "";
  }
  function compactSelectionImage(dataUrl) {
    return new Promise((resolve) => {
      if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image")) {
        resolve("");
        return;
      }
      const image = new Image();
      image.onload = () => {
        const scale = Math.min(1, 768 / Math.max(1, image.width, image.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.74));
      };
      image.onerror = () => resolve(dataUrl);
      image.src = dataUrl;
    });
  }
  async function visualizeSelection() {
    const selection = state.selection;
    if (!selection || selection.phase !== "active" || state.visualizingSelection || selectionHasTypesetDraft(selection)) return false;
    const rawText = selectionRawText(selection) || selectionTopicHint(selection);
    const topic = selectionTopicHint(selection);
    const packed = buildSelectionImage(selection);
    if (!topic && !rawText && !packed?.atlasImage) {
      if (selectionVisualizeButton) selectionVisualizeButton.textContent = t("selectionVisualizeFailed");
      setStatusKey("selectionEmpty");
      return false;
    }
    state.visualizingSelection = true;
    updateSelectionToolbar();
    try {
      const image = packed?.atlasImage ? await compactSelectionImage(packed.atlasImage) : "";
      const profile = childVisualProfile();
      const response = await fetch("/api/primer/visualize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: String(rawText || "").slice(0, 400),
          topic,
          context: nearbyBoardText(selection),
          image: image || undefined,
          grade: profile.grade || undefined,
          age: profile.age || undefined,
          preferGenerated: true
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.href) {
        if (selectionVisualizeButton) selectionVisualizeButton.textContent = t("selectionVisualizeFailed");
        setStatusKey("selectionVisualizeFailed");
        return false;
      }
      const fileResponse = await fetch(data.href);
      if (!fileResponse.ok) {
        if (selectionVisualizeButton) selectionVisualizeButton.textContent = t("selectionVisualizeFailed");
        setStatusKey("selectionVisualizeFailed");
        return false;
      }
      const blob = await fileResponse.blob();
      const file = new File([blob], `${String(data.title || "picture").replace(/\s+/g, "-")}.png`, { type: blob.type || "image/png" });
      const placed = await addGeneratedImageBelow(selection.box, file, data.title || "Visualize");
      if (!placed) {
        if (selectionVisualizeButton) selectionVisualizeButton.textContent = t("selectionVisualizeFailed");
        setStatusKey("selectionVisualizeFailed");
        return false;
      }
      setStatusKey("imageAdded");
      return true;
    } catch {
      if (selectionVisualizeButton) selectionVisualizeButton.textContent = t("selectionVisualizeFailed");
      setStatusKey("selectionVisualizeFailed");
      return false;
    } finally {
      state.visualizingSelection = false;
      updateSelectionToolbar();
    }
  }
  function selectionHit(selection, event) {
    const point = clientPoint(event),
      size = 14 / state.scale;
    const includeLegacyActions = Boolean(selection.legacyActions);
    return selection.path?.length >= 3
      ? SELECT.hitTestPath(selection.path, selection.box, point, size, includeLegacyActions)
      : SELECT.hitTest(selection.box, point, size, includeLegacyActions);
  }
  function beginSelectionMarquee(event, point) {
    const start = SELECT.clipPoint(point, SIZE);
    const box = { x: start.x, y: start.y, w: 1, h: 1 };
    state.selection = {
      phase: "lasso",
      points: [start],
      box,
      marqueeStart: start,
    };
    state.selectionGesture = { id: event.pointerId, hit: "pending", startClientX: event.clientX, startClientY: event.clientY };
    resetCanvasCursor();
    requestRender();
  }
  function beginSelectionTransform(event, hit) {
    if (selectionAIBusy()) return false;
    const point = clientPoint(event);
    state.selectionGesture = {
      id: event.pointerId,
      hit,
      startPoint: point,
      startBox: { ...state.selection.box },
    };
    setCanvasCursor(hit === "resize" ? "nwse-resize" : hit === "width" ? "ew-resize" : hit === "height" ? "ns-resize" : "grabbing");
  }
  function addLassoPoint(selection, point, minimumDistance) {
    if (!SELECT.shouldAddPoint(selection.points, point, minimumDistance)) return false;
    if (selection.points.length >= MAX_LASSO_POINTS) selection.points = selection.points.filter((_, index) => index % 2 === 0);
    selection.points.push(point);
    return true;
  }
  function updateSelectionGesture(event) {
    const gesture = state.selectionGesture,
      selection = state.selection;
    if (!gesture || !selection || gesture.id !== event.pointerId || selectionAIBusy(selection)) return false;
    const point = clientPoint(event);
    if (gesture.hit === "pending") {
      const travel = Math.hypot(event.clientX - gesture.startClientX, event.clientY - gesture.startClientY);
      if (travel < 8) return true;
      gesture.hit = "marquee";
    }
    if (gesture.hit === "marquee") {
      const start = selection.marqueeStart || point;
      const clipped = SELECT.clipPoint(point, SIZE);
      selection.box = {
        x: Math.min(start.x, clipped.x),
        y: Math.min(start.y, clipped.y),
        w: Math.max(1, Math.abs(clipped.x - start.x)),
        h: Math.max(1, Math.abs(clipped.y - start.y)),
      };
      selection.points = rectPathForBox(selection.box);
    } else if (gesture.hit === "lasso") {
      const samples = typeof event.getCoalescedEvents === "function" ? event.getCoalescedEvents() : [],
        events = samples.length ? samples : [event],
        minimumDistance = 0.75 / Math.max(0.03, state.scale);
      for (const sample of events) addLassoPoint(selection, SELECT.clipPoint(clientPoint(sample), SIZE), minimumDistance);
      selection.box = SELECT.polygonBounds(selection.points, SIZE);
    } else if (gesture.hit === "move") selection.box = SELECT.moveBox(gesture.startBox, point.x - gesture.startPoint.x, point.y - gesture.startPoint.y, SIZE);
    else if (gesture.hit === "resize") selection.box = SELECT.resizeBox(gesture.startBox, point, 24 / state.scale, SIZE);
    else if (gesture.hit === "width" || gesture.hit === "height") selection.box = SELECT.resizeBoxAxis(gesture.startBox, point, gesture.hit, 24 / state.scale, SIZE);
    if (selection.phase === "active") selection.path = selectionPathFor(selection);
    requestRender();
    return true;
  }
  function finishSelectionGesture(event) {
    const gesture = state.selectionGesture,
      selection = state.selection;
    if (!gesture || gesture.id !== event.pointerId) return false;
    state.selectionGesture = null;
    resetCanvasCursor();
    if (gesture.hit === "marquee" || gesture.hit === "lasso" || gesture.hit === "pending") {
      if (selection && event.type !== "pointercancel" && gesture.hit === "lasso") {
        const point = SELECT.clipPoint(clientPoint(event), SIZE);
        addLassoPoint(selection, point, 0.5 / state.scale);
      }
      const points = selection?.points || [],
        start = selection?.marqueeStart,
        box = selection?.box,
        scale = Math.max(state.scale, 0.05),
        smallMarquee = Boolean(
          (gesture.hit === "pending")
          || (box && box.w * scale < 28 && box.h * scale < 28 && SELECT.pathLength(points, scale) < 36)
        );
      state.selection = null;
      if (event.type === "pointercancel") {
        requestRender();
        return true;
      }
      if (smallMarquee && start && selectSingleAtPoint(start)) return true;
      if (!smallMarquee) captureSelection(points);
      return true;
    }
    if (selection) {
      selection.path = selectionPathFor(selection);
      selection.changed = selectionHasChanges(selection);
    }
    requestRender();
    return true;
  }
  function handleSelectionPointerDown(event, point) {
    const selection = state.selection;
    if (selection?.phase === "active") {
      if (selectionAIBusy(selection)) return true;
      const hit = selectionHit(selection, event);
      if (hit === "cancel") {
        cancelSelection();
        return true;
      }
      if (hit === "accept") {
        commitSelection();
        return true;
      }
      if (hit) {
        beginSelectionTransform(event, hit);
        return true;
      }
      commitSelection();
    } else if (selection) cancelSelection(true);
    beginSelectionMarquee(event, point);
    return true;
  }
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
