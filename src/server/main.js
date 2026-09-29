"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const ROOT = path.resolve(__dirname, "../..");
const PUBLIC = path.join(ROOT, "public");
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || "0.0.0.0";

// Load .env if present
function loadEnv() {
  const envPath = path.join(ROOT, ".env");
  if (fs.existsSync(envPath)) {
    try {
      const lines = fs.readFileSync(envPath, "utf8").split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx !== -1) {
          const key = trimmed.slice(0, eqIdx).trim();
          let val = trimmed.slice(eqIdx + 1).trim();
          if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
          }
          if (process.env[key] === undefined) {
            process.env[key] = val;
          }
        }
      }
    } catch {}
  }
}
loadEnv();

const CANVAS_DIR = process.env.ATLAS_CANVAS_DIR
  ? path.resolve(process.env.ATLAS_CANVAS_DIR)
  : path.join(os.homedir(), ".atlas", "canvases");

try {
  fs.mkdirSync(CANVAS_DIR, { recursive: true });
} catch {}

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf"
};

function send(res, status, body, contentType = "application/json; charset=utf-8") {
  res.writeHead(status, {
    "Content-Type": contentType,
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization"
  });
  if (typeof body === "object" && !(body instanceof Buffer)) {
    res.end(JSON.stringify(body));
  } else {
    res.end(body || "");
  }
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 50 * 1024 * 1024) {
        req.destroy();
        reject(new Error("Payload too large"));
      }
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (err) {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function listCanvases() {
  try {
    const files = fs.readdirSync(CANVAS_DIR).filter((f) => f.endsWith(".json"));
    return files.map((file) => {
      try {
        const full = path.join(CANVAS_DIR, file);
        const stat = fs.statSync(full);
        const data = JSON.parse(fs.readFileSync(full, "utf8"));
        return {
          id: file.replace(/\.json$/, ""),
          name: data.name || "Untitled Board",
          updatedAt: stat.mtime.toISOString(),
          createdAt: stat.birthtime.toISOString()
        };
      } catch {
        return null;
      }
    }).filter(Boolean);
  } catch {
    return [];
  }
}

function readCanvas(id) {
  const safeId = String(id).replace(/[^a-zA-Z0-9-_]/g, "");
  const target = path.join(CANVAS_DIR, `${safeId}.json`);
  if (!fs.existsSync(target)) return null;
  return JSON.parse(fs.readFileSync(target, "utf8"));
}

function saveCanvas(id, data) {
  const safeId = String(id || Date.now().toString()).replace(/[^a-zA-Z0-9-_]/g, "");
  const target = path.join(CANVAS_DIR, `${safeId}.json`);
  fs.writeFileSync(target, JSON.stringify(data, null, 2));
  return { id: safeId, ...data };
}

function deleteCanvas(id) {
  const safeId = String(id).replace(/[^a-zA-Z0-9-_]/g, "");
  const target = path.join(CANVAS_DIR, `${safeId}.json`);
  if (fs.existsSync(target)) {
    fs.unlinkSync(target);
    return true;
  }
  return false;
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization"
    });
    return res.end();
  }

  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = decodeURIComponent(url.pathname);

  // 1. /api/config.js and /api/config
  if (req.method === "GET" && (pathname === "/api/config.js" || pathname === "/api/config")) {
    const config = {
      supabaseUrl: process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || null,
      supabaseAnonKey: process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || null
    };

    if (pathname === "/api/config.js") {
      const script = `window.LUMI6_CONFIG=${JSON.stringify(config)};window.ATLAS_CONFIG=window.LUMI6_CONFIG;`;
      return send(res, 200, script, "application/javascript; charset=utf-8");
    }
    return send(res, 200, config);
  }

  // 2. /api/canvases (local canvas snapshot persistence)
  const canvasMatch = /^\/api\/canvases(?:\/([a-zA-Z0-9-_]+))?$/.exec(pathname);
  if (canvasMatch) {
    const id = canvasMatch[1];
    if (req.method === "GET") {
      if (!id) return send(res, 200, { canvases: listCanvases() });
      const item = readCanvas(id);
      if (!item) return send(res, 404, { error: "Canvas not found" });
      return send(res, 200, { canvas: item });
    }
    if (req.method === "POST" && !id) {
      try {
        const body = await readJson(req);
        const newId = body.id || `canvas-${Date.now()}`;
        const saved = saveCanvas(newId, body);
        return send(res, 201, { canvas: saved });
      } catch (err) {
        return send(res, 400, { error: err.message });
      }
    }
    if (req.method === "PUT" && id) {
      try {
        const body = await readJson(req);
        const saved = saveCanvas(id, body);
        return send(res, 200, { canvas: saved });
      } catch (err) {
        return send(res, 400, { error: err.message });
      }
    }
    if (req.method === "DELETE" && id) {
      const ok = deleteCanvas(id);
      return send(res, ok ? 200 : 404, { success: ok });
    }
    return send(res, 405, { error: "Method Not Allowed" });
  }

  // 3. Static Files
  let filePath;
  if (pathname === "/" || pathname === "/dashboard") {
    filePath = path.join(PUBLIC, "index.html");
  } else if (pathname === "/login") {
    filePath = path.join(PUBLIC, "login.html");
  } else {
    filePath = path.join(PUBLIC, pathname);
  }

  // Security: prevent path traversal
  if (!filePath.startsWith(PUBLIC)) {
    return send(res, 403, "Forbidden", "text/plain");
  }

  // Check if file exists
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";
    const noCache = ext === ".html" || ext === ".js" || ext === ".css";
    res.writeHead(200, {
      "Content-Type": contentType,
      "Cache-Control": noCache ? "no-cache, no-store, must-revalidate" : "public, max-age=3600"
    });
    return fs.createReadStream(filePath).pipe(res);
  }

  // Single page app fallback
  const indexFallback = path.join(PUBLIC, "index.html");
  if (fs.existsSync(indexFallback)) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return fs.createReadStream(indexFallback).pipe(res);
  }

  send(res, 404, "Not Found", "text/plain");
});

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    console.log(`Atlas whiteboard server running at http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}`);
  });
}

module.exports = server;
