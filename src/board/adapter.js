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
