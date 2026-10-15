/**
 * Performance Plan Parser & Compiler
 * Extracts semantic speech anchors, cleans plain text for TTS,
 * and maps visual cues to authoritative Scene Graph objects.
 * (PRD Section 16 - Teaching Performance Protocol)
 */

import { PerformanceAnchor, TeachingPerformancePlan, VisualPerformanceAction } from "./performanceTypes";
import { sceneManager } from "./sceneManager";

/**
 * Parses tutor speech text, extracting embedded <anchor> tags or automatically
 * generating anchors from keywords that match objects currently in the Scene Graph.
 */
export function compileTeachingPerformancePlan(
  rawSpeech: string,
  performanceId: string = `perf-${Date.now().toString(36)}`
): TeachingPerformancePlan {
  const anchors: PerformanceAnchor[] = [];
  const actions: VisualPerformanceAction[] = [];

  let cleanSpeech = "";
  const anchorRegex = /<anchor\s+([^>]*?)>(.*?)<\/anchor>/gi;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  // 1. Explicit <anchor> tag parsing
  while ((match = anchorRegex.exec(rawSpeech)) !== null) {
    const preText = rawSpeech.substring(lastIndex, match.index);
    cleanSpeech += preText;

    const attributesStr = match[1];
    const triggerWord = match[2];
    const anchorStartIndex = cleanSpeech.length;
    cleanSpeech += triggerWord;

    // Parse attributes: id, target, action
    const idMatch = /id=['"]([^'"]+)['"]/i.exec(attributesStr);
    const targetMatch = /target=['"]([^'"]+)['"]/i.exec(attributesStr);
    const actionMatch = /action=['"]([^'"]+)['"]/i.exec(attributesStr);

    const anchorId = idMatch ? idMatch[1] : `anchor-${anchors.length + 1}`;
    const targetObjectId = targetMatch ? targetMatch[1] : "visual_model";
    const actionType = (actionMatch ? actionMatch[1] : "point_to") as PerformanceAnchor["action"];

    anchors.push({
      id: anchorId,
      targetObjectId,
      triggerWord,
      action: actionType,
      startFraction: 0, // Will compute after full text length is known
      durationMs: Math.max(600, triggerWord.length * 80),
    });

    actions.push({
      id: `act-${anchorId}`,
      targetObjectId,
      action: actionType,
      anchorId,
      durationMs: Math.max(600, triggerWord.length * 80),
      label: triggerWord,
    });

    lastIndex = match.index + match[0].length;
  }

  cleanSpeech += rawSpeech.substring(lastIndex);
  // Ensure all remaining XML or HTML tags are stripped from speech text
  cleanSpeech = cleanSpeech.replace(/<\/?[^>]+(>|$)/g, "");

  // 2. If no explicit tags were provided, auto-bind anchors to scene objects by keyword
  if (anchors.length === 0 && cleanSpeech.length > 0) {
    const sceneObjects = sceneManager.getObjects();
    const cleanLower = cleanSpeech.toLowerCase();

    for (const obj of sceneObjects) {
      if (!obj.visible) continue;

      let keyword = "";
      if (obj.role === "title" && obj.label) {
        keyword = obj.label.toLowerCase();
      } else if (obj.role === "primary_concept") {
        keyword = "equation";
      } else if (obj.role === "visual_model") {
        keyword = obj.semanticType.replace(/_/g, " ").toLowerCase();
      } else if (obj.role === "conclusion") {
        keyword = "total";
      }

      if (keyword && cleanLower.includes(keyword)) {
        const idx = cleanLower.indexOf(keyword);
        const anchorId = `auto-anchor-${anchors.length + 1}`;
        anchors.push({
          id: anchorId,
          targetObjectId: obj.id,
          triggerWord: keyword,
          action: obj.role === "visual_model" ? "point_to" : "pulse_highlight",
          startFraction: idx / Math.max(1, cleanSpeech.length),
          durationMs: 700,
        });

        actions.push({
          id: `act-${anchorId}`,
          targetObjectId: obj.id,
          action: obj.role === "visual_model" ? "point_to" : "pulse_highlight",
          anchorId,
          durationMs: 700,
          label: keyword,
        });
      }
    }
  }

  // 3. Compute fractional timing anchors along the speech timeline
  const totalLength = Math.max(1, cleanSpeech.length);
  anchors.forEach((a) => {
    if (a.startFraction === 0 || a.startFraction === undefined) {
      const idx = cleanSpeech.indexOf(a.triggerWord);
      a.startFraction = idx >= 0 ? idx / totalLength : 0.5;
    }
  });

  // Sort anchors chronologically by their position in the speech stream
  anchors.sort((a, b) => (a.startFraction || 0) - (b.startFraction || 0));

  // Natural speech rate estimate: ~14 characters per second (roughly 150 words per minute)
  const durationEstimateMs = Math.max(1500, Math.round((cleanSpeech.length / 14) * 1000));

  return {
    performanceId,
    baseWorldVersion: sceneManager.getVersion(),
    rawText: rawSpeech,
    cleanSpeechText: cleanSpeech.trim(),
    anchors,
    actions,
    durationEstimateMs,
  };
}
