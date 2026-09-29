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
