#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const PUBLIC = path.join(ROOT, "public");

const CSS_SOURCES = [
  "src/web/css/tokens.css",
  "src/web/css/board.css",
  "src/web/css/auth.css",
  "src/web/css/onboard.css",
  "src/web/css/mobile.css",
  "src/web/css/shell.css"
];

const BOARD_SOURCES = [
  "src/board/engine/draw.js",
  "src/board/engine/selection.js",
  "src/board/engine/mixed-text.js",
  "src/board/engine/animation.js",
  "src/board/engine/summon.js",
  "src/board/adapter.js",
  "src/board/core.js",
  "src/board/controls.js",
  "src/board/plugins.js",
  "src/board/tiles.js",
  "src/board/images.js",
  "src/board/widgets.js",
  "src/board/rendering.js",
  "src/board/text-editors.js",
  "src/board/persist.js",
  "src/board/ai-runtime.js",
  "src/board/ai-rendering.js",
  "src/board/ai-drafts.js",
  "src/board/start.js"
];

function joinFiles(files, banner) {
  const sections = files.map((file) => {
    const full = path.join(ROOT, file);
    if (!fs.existsSync(full)) throw new Error(`Missing ${file}`);
    return fs.readFileSync(full, "utf8").trimEnd();
  });
  return `${banner}\n${sections.join("\n")}\n`;
}

function write(rel, contents) {
  const full = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, contents);
  console.log(`Built ${rel}`);
}

function main(argv = process.argv.slice(2)) {
  const all = [...CSS_SOURCES, ...BOARD_SOURCES];
  if (argv.includes("--check")) {
    for (const file of all) {
      if (!fs.existsSync(path.join(ROOT, file))) {
        console.error(`Missing ${file}`);
        return 1;
      }
    }
    for (const out of ["public/css/app.css", "public/js/board.js"]) {
      if (!fs.existsSync(path.join(ROOT, out))) {
        console.error(`Missing ${out}`);
        return 1;
      }
    }
    return 0;
  }
  write("public/css/app.css", joinFiles(CSS_SOURCES, "/* Atlas Canvas Styles - Bundled by scripts/build-web.js */"));
  write("public/js/board.js", joinFiles(BOARD_SOURCES, "// Atlas Canvas Engine - Bundled by scripts/build-web.js"));
  return 0;
}

if (require.main === module) process.exitCode = main();

module.exports = { CSS_SOURCES, BOARD_SOURCES, main };
