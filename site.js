let BENCHMARK = null;

const VIEW = {
  search: "",
  backend: "",
  autocompleteOpen: false,
  autocompleteIndex: 0,
};

function byId(id) {
  return document.getElementById(id);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[char]);
}

function fmtTps(value) {
  if (value == null || !Number.isFinite(value)) return "-";
  return `${value.toFixed(2)} t/s`;
}

function fmtStd(value) {
  if (value == null || !Number.isFinite(value) || value === 0) return "";
  return `<br><span class="std">+/- ${value.toFixed(2)}</span>`;
}

function fmtGain(value) {
  if (value == null || !Number.isFinite(value)) return "-";
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function gainClass(value) {
  if (value == null || !Number.isFinite(value)) return "gain-neutral";
  if (value > 1) return "gain-positive";
  if (value < -1) return "gain-negative";
  return "gain-neutral";
}

function depthValue(row) {
  return row.depth ?? row.raw?.n_depth ?? row.raw?.depth ?? row.raw?.n_ctx ?? row.raw?.n_kv ?? row.contextTokens ?? null;
}

function depthKey(row) {
  return String(depthValue(row) ?? "unknown");
}

function depthLabel(depth) {
  if (depth.value == null) return "unknown";
  return String(depth.value);
}

function depthDetail(depth) {
  if (depth.value == null) return "depth unknown";
  return `${Number(depth.value).toLocaleString()} tokens`;
}

function sameDepth(row, depth) {
  return String(depthValue(row) ?? "unknown") === depth.key;
}

function backendKey(row) {
  return [row.build, row.mode, row.b ?? "", row.ub ?? ""].join("|");
}

function parseBackendKey(key) {
  const [build, mode, b, ub] = key.split("|");
  return {
    key,
    build,
    mode,
    b: b === "" ? null : Number(b),
    ub: ub === "" ? null : Number(ub),
  };
}

function buildMeta(shortLabel) {
  return BENCHMARK.builds.find((build) => build.shortLabel === shortLabel) ?? { shortLabel };
}

function buildOrder(shortLabel) {
  const index = BENCHMARK.builds.findIndex((build) => build.shortLabel === shortLabel);
  return index === -1 ? 99 : index;
}

function backendName(shortLabel) {
  const build = buildMeta(shortLabel);
  return build.backendLabel ?? build.label ?? shortLabel;
}

function backendDetails(shortLabel) {
  const build = buildMeta(shortLabel);
  const details = [];
  if (build.backendVersion && !backendName(shortLabel).includes(build.backendVersion)) details.push(build.backendVersion);
  if (build.variant && !backendName(shortLabel).toLowerCase().includes(String(build.variant).toLowerCase())) details.push(build.variant);
  if (build.version) details.push(`llama.cpp ${build.version}`);
  if (build.commit) details.push(build.commit);
  return details.join(" / ") || build.label || build.shortLabel || shortLabel;
}

function configPairLabel(rowOrBackend) {
  if (rowOrBackend.b == null && rowOrBackend.ub == null) return "default";
  return `${rowOrBackend.b}/${rowOrBackend.ub}`;
}

function shortConfigLabel(rowOrBackend) {
  if (rowOrBackend.mode === "default" && rowOrBackend.b != null && rowOrBackend.ub != null) return `default ${configPairLabel(rowOrBackend)}`;
  if (rowOrBackend.mode === "default") return "default";
  return configPairLabel(rowOrBackend);
}

function cleanModelName(model) {
  return String(model.name || model.file || model.id)
    .replace(/\.gguf$/i, "")
    .replace(/-00001-of-\d+$/i, "");
}

function modelBadges(model) {
  const badges = [];
  for (const value of [model.quant, model.architecture]) {
    if (value && value !== "unknown") badges.push(value);
  }
  if (Number.isFinite(model.paramsB)) badges.push(`${model.paramsB}B params`);
  if (Number.isFinite(model.sizeGiB)) badges.push(`${model.sizeGiB} GiB`);
  return badges;
}

function modelResults(model) {
  return BENCHMARK.results.filter((row) => row.modelId === model.id && (!VIEW.backend || row.build === VIEW.backend));
}

function depthsForModel(model) {
  const seen = new Map();
  for (const row of modelResults(model)) {
    const key = depthKey(row);
    if (!seen.has(key)) {
      const value = depthValue(row);
      seen.set(key, { key, value: value == null ? null : Number(value) });
    }
  }
  return [...seen.values()].sort((a, b) => (a.value ?? 0) - (b.value ?? 0));
}

function backendIdsForModel(model) {
  return [...new Set(modelResults(model).map((row) => row.build))]
    .sort((a, b) => buildOrder(a) - buildOrder(b));
}

function backendConfigsForModel(model) {
  const seen = new Map();
  for (const row of modelResults(model)) {
    const key = backendKey(row);
    if (!seen.has(key)) seen.set(key, parseBackendKey(key));
  }

  return [...seen.values()].sort((a, b) => {
    const buildDelta = buildOrder(a.build) - buildOrder(b.build);
    if (buildDelta !== 0) return buildDelta;
    if (a.mode !== b.mode) return a.mode === "default" ? -1 : 1;
    return (a.b ?? 0) - (b.b ?? 0) || (a.ub ?? 0) - (b.ub ?? 0);
  });
}

function resultForDepthConfig(model, depth, backendConfig) {
  return modelResults(model).find((row) => sameDepth(row, depth) && backendKey(row) === backendConfig.key);
}

function bestRow(rows) {
  return rows.reduce((best, row) => row.tps > best.tps ? row : best, { tps: -Infinity });
}

function filteredModels() {
  const search = VIEW.search.trim().toLowerCase();
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

  return BENCHMARK.models
    .filter((model) => {
      const text = [
        model.family,
        model.name,
        model.file,
        model.architecture,
        model.quant,
        model.quantProvider ?? "Unknown",
        model.shape,
      ].join(" ").toLowerCase();

      if (search && !text.includes(search)) return false;
      if (VIEW.backend && modelResults(model).length === 0) return false;
      return true;
    })
    .sort((a, b) => collator.compare(a.family ?? a.name, b.family ?? b.name) || collator.compare(a.quant, b.quant));
}

function modelSearchText(model) {
  return [
    model.family,
    model.name,
    model.file,
    model.architecture,
    model.quant,
    model.quantProvider ?? "Unknown",
    model.shape,
    cleanModelName(model),
  ].join(" ").toLowerCase();
}

function autocompleteSuggestions() {
  const query = VIEW.search.trim().toLowerCase();
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
  const models = BENCHMARK.models.filter((model) => modelResults(model).length > 0);

  if (!query) {
    return models
      .sort((a, b) => collator.compare(cleanModelName(a), cleanModelName(b)))
      .slice(0, 8);
  }

  return models
    .map((model) => {
      const name = cleanModelName(model).toLowerCase();
      const family = String(model.family ?? "").toLowerCase();
      const text = modelSearchText(model);
      let score = 0;
      if (name === query) score = 100;
      else if (name.startsWith(query)) score = 90;
      else if (family.startsWith(query)) score = 80;
      else if (name.includes(query)) score = 70;
      else if (text.includes(query)) score = 50;
      return { model, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || collator.compare(cleanModelName(a.model), cleanModelName(b.model)))
    .slice(0, 8)
    .map((item) => item.model);
}

function highlightQuery(value, query) {
  const text = String(value ?? "");
  const needle = query.trim().toLowerCase();
  if (!needle) return escapeHtml(text);
  const index = text.toLowerCase().indexOf(needle);
  if (index === -1) return escapeHtml(text);
  return `${escapeHtml(text.slice(0, index))}<mark>${escapeHtml(text.slice(index, index + needle.length))}</mark>${escapeHtml(text.slice(index + needle.length))}`;
}

function renderAutocomplete() {
  const input = byId("filter-search");
  const panel = byId("search-suggestions");
  const suggestions = autocompleteSuggestions();
  const visibleModels = filteredModels().length;

  if (!VIEW.autocompleteOpen) {
    panel.hidden = true;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
    return;
  }

  VIEW.autocompleteIndex = Math.min(Math.max(VIEW.autocompleteIndex, 0), Math.max(suggestions.length - 1, 0));
  panel.hidden = false;
  input.setAttribute("aria-expanded", "true");

  if (suggestions.length === 0) {
    input.removeAttribute("aria-activedescendant");
    panel.innerHTML = `
      <div class="autocomplete-empty">
        <strong>No matching model</strong>
        <span>Try a family, quant, or architecture.</span>
      </div>
    `;
    return;
  }

  input.setAttribute("aria-activedescendant", `search-suggestion-${VIEW.autocompleteIndex}`);
  panel.innerHTML = `
    <div class="autocomplete-list">
      ${suggestions.map((model, index) => {
        const badges = modelBadges(model).slice(0, 3);
        const rows = modelResults(model).length;
        return `
          <button id="search-suggestion-${index}" type="button" role="option" class="autocomplete-option ${index === VIEW.autocompleteIndex ? "active" : ""}" aria-selected="${index === VIEW.autocompleteIndex ? "true" : "false"}" data-index="${index}">
            <span class="autocomplete-name">${highlightQuery(cleanModelName(model), VIEW.search)}</span>
            <span class="autocomplete-meta">
              ${badges.map((badge) => `<span>${escapeHtml(badge)}</span>`).join("")}
              <span>${rows} row${rows === 1 ? "" : "s"}</span>
            </span>
          </button>
        `;
      }).join("")}
    </div>
    <div class="autocomplete-footer">${visibleModels} model${visibleModels === 1 ? "" : "s"} visible</div>
  `;
  panel.querySelector(".autocomplete-option.active")?.scrollIntoView({ block: "nearest" });
}

function selectAutocompleteSuggestion(index) {
  const model = autocompleteSuggestions()[index];
  if (!model) return;
  const value = cleanModelName(model);
  VIEW.search = value;
  VIEW.autocompleteOpen = false;
  VIEW.autocompleteIndex = 0;
  byId("filter-search").value = value;
  renderAll();
  renderAutocomplete();
}

function renderMeasure(row, baseline = null) {
  if (!row) return `<span class="muted">-</span>`;
  const delta = baseline && baseline.tps > 0 && row !== baseline
    ? (row.tps / baseline.tps - 1) * 100
    : null;
  return `<span class="measure">${fmtTps(row.tps)}</span>${fmtStd(row.std)}${delta == null ? "" : `<span class="delta ${gainClass(delta)}" title="change versus default 2048/512">${fmtGain(delta)}</span>`}`;
}

function renderSweepMatrix(model, depths, configs) {
  return backendIdsForModel(model).map((backendId) => {
    const backendConfigs = configs.filter((config) => config.build === backendId);
    if (backendConfigs.length === 0) return "";

    const bestKeyByDepth = new Map(depths.map((depth) => {
      const rows = modelResults(model).filter((row) => row.build === backendId && sameDepth(row, depth) && typeof row.tps === "number");
      const top = bestRow(rows);
      return [depth.key, top.tps === -Infinity ? null : backendKey(top)];
    }));
    const baselineByDepth = new Map(depths.map((depth) => {
      const rows = modelResults(model).filter((row) => row.build === backendId && sameDepth(row, depth));
      const baseline = rows.find((row) => row.mode === "default" && row.b === 2048 && row.ub === 512) ?? rows.find((row) => row.mode === "default") ?? null;
      return [depth.key, baseline];
    }));

    return `
      <section class="backend-matrix-section">
        <header class="backend-matrix-header">
          <div>
            <h4>${escapeHtml(backendName(backendId))}</h4>
            <p>${escapeHtml(backendDetails(backendId))}</p>
          </div>
        </header>
        <div class="table-wrap matrix-wrap">
          <table class="matrix-table sweep-table">
            <thead>
              <tr>
                <th>Context</th>
                ${backendConfigs.map((config) => {
                  const isBaseline = config.mode === "default";
                  return `<th class="${isBaseline ? "matrix-baseline-head" : ""}"><span class="backend-name">${escapeHtml(shortConfigLabel(config))}</span>${isBaseline ? `<span class="backend-details">baseline</span>` : ""}</th>`;
                }).join("")}
              </tr>
            </thead>
            <tbody>
              ${depths.map((depth) => `
                <tr>
                  <th>
                    <span class="context-main">${escapeHtml(depthLabel(depth))}</span>
                    <span class="context-sub">${escapeHtml(depthDetail(depth))}</span>
                  </th>
                  ${backendConfigs.map((config) => {
                    const row = resultForDepthConfig(model, depth, config);
                    const isTop = row && bestKeyByDepth.get(depth.key) === config.key;
                    const classes = [
                      config.mode === "default" ? "matrix-baseline" : "",
                      isTop ? "matrix-local-top" : row ? "matrix-not-top" : "matrix-empty",
                    ].filter(Boolean).join(" ");
                    return `<td class="${classes}">${renderMeasure(row, baselineByDepth.get(depth.key))}</td>`;
                  }).join("")}
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      </section>
    `;
  }).join("");
}

function renderModelCard(model) {
  const depths = depthsForModel(model);
  const provider = model.quantProvider ?? "Unknown";
  const allConfigs = backendConfigsForModel(model);

  return `
    <section class="model-card">
      <header class="model-header">
        <div>
          <h2>${escapeHtml(cleanModelName(model))}</h2>
          <p>${escapeHtml(provider && provider !== "local" ? provider : "Local GGUF")}</p>
        </div>
        <div class="model-meta">
          ${modelBadges(model).map((badge) => `<span>${escapeHtml(badge)}</span>`).join("")}
        </div>
      </header>

      <section class="table-section detail-section">
        <h3>Throughput by context depth</h3>
        <p class="section-note">Rows are context depths from <code>-d</code>. Columns are explicit <code>batch/ubatch</code> pairs; the green cell is the fastest pair for that backend and depth.</p>
        ${renderSweepMatrix(model, depths, allConfigs)}
      </section>

    </section>
  `;
}

function renderModels() {
  const models = filteredModels();
  byId("models").innerHTML = models.length === 0
    ? `<section class="panel"><p class="muted">No models match the current filters.</p></section>`
    : models.map(renderModelCard).join("");
}

function renderSystem() {
  const tbody = byId("systemTable").querySelector("tbody");
  const entries = [
    ["Platform", `${BENCHMARK.system.cpuGpu} / ${BENCHMARK.system.gpu}`],
    ["Backends", BENCHMARK.builds.map((build) => backendName(build.shortLabel)).join(", ")],
    ["llama.cpp", [...new Set(BENCHMARK.builds.map((build) => [build.version, build.commit].filter(Boolean).join(" / ")).filter(Boolean))].join(", ")],
  ];
  tbody.innerHTML = entries.map(([key, value]) => `<tr><th>${escapeHtml(key)}</th><td>${escapeHtml(value)}</td></tr>`).join("");
}

function renderAll() {
  renderModels();
}

function setupControls() {
  const backend = byId("filter-backend");
  const autocomplete = byId("model-autocomplete");
  const searchInput = byId("filter-search");
  const suggestionsPanel = byId("search-suggestions");
  const renderBackendFilter = () => {
    const options = [{ shortLabel: "", label: "All" }, ...BENCHMARK.builds.map((build) => ({ shortLabel: build.shortLabel, label: backendName(build.shortLabel) }))];
    backend.innerHTML = options.map((option) => `
      <button type="button" class="chip backend-filter-chip ${VIEW.backend === option.shortLabel ? "active" : ""}" data-backend="${escapeHtml(option.shortLabel)}">
        ${escapeHtml(option.label)}
      </button>
    `).join("");
  };
  renderBackendFilter();

  searchInput.addEventListener("focus", () => {
    VIEW.autocompleteOpen = true;
    VIEW.autocompleteIndex = 0;
    renderAutocomplete();
  });

  searchInput.addEventListener("input", (event) => {
    VIEW.search = event.target.value;
    VIEW.autocompleteOpen = true;
    VIEW.autocompleteIndex = 0;
    renderAll();
    renderAutocomplete();
  });

  searchInput.addEventListener("keydown", (event) => {
    const suggestions = autocompleteSuggestions();
    if (event.key === "ArrowDown") {
      event.preventDefault();
      VIEW.autocompleteOpen = true;
      VIEW.autocompleteIndex = suggestions.length === 0 ? 0 : (VIEW.autocompleteIndex + 1) % suggestions.length;
      renderAutocomplete();
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      VIEW.autocompleteOpen = true;
      VIEW.autocompleteIndex = suggestions.length === 0 ? 0 : (VIEW.autocompleteIndex - 1 + suggestions.length) % suggestions.length;
      renderAutocomplete();
    }
    if (event.key === "Enter" && VIEW.autocompleteOpen && suggestions.length > 0) {
      event.preventDefault();
      selectAutocompleteSuggestion(VIEW.autocompleteIndex);
    }
    if (event.key === "Escape") {
      VIEW.autocompleteOpen = false;
      renderAutocomplete();
    }
  });

  suggestionsPanel.addEventListener("mousedown", (event) => {
    const option = event.target.closest(".autocomplete-option");
    if (!option) return;
    event.preventDefault();
    selectAutocompleteSuggestion(Number(option.dataset.index));
  });

  suggestionsPanel.addEventListener("mousemove", (event) => {
    const option = event.target.closest(".autocomplete-option");
    if (!option) return;
    const index = Number(option.dataset.index);
    if (VIEW.autocompleteIndex === index) return;
    const previous = suggestionsPanel.querySelector(".autocomplete-option.active");
    previous?.classList.remove("active");
    previous?.setAttribute("aria-selected", "false");
    option.classList.add("active");
    option.setAttribute("aria-selected", "true");
    VIEW.autocompleteIndex = index;
    byId("filter-search").setAttribute("aria-activedescendant", option.id);
  });

  backend.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-backend]");
    if (!button) return;
    VIEW.backend = button.dataset.backend;
    renderBackendFilter();
    renderAll();
    renderAutocomplete();
  });

  byId("reset-filters").addEventListener("click", () => {
    VIEW.search = "";
    VIEW.backend = "";
    VIEW.autocompleteOpen = false;
    VIEW.autocompleteIndex = 0;
    searchInput.value = "";
    renderBackendFilter();
    renderAll();
    renderAutocomplete();
  });

  document.addEventListener("click", (event) => {
    if (autocomplete.contains(event.target)) return;
    VIEW.autocompleteOpen = false;
    renderAutocomplete();
  });

  renderAutocomplete();
}

function init() {
  byId("datasetId").textContent = BENCHMARK.dataset.id;
  byId("sys-info").textContent = BENCHMARK.builds.map((build) => backendName(build.shortLabel)).join(" vs ");
  byId("run-info").innerHTML = `${escapeHtml(BENCHMARK.dataset.date)} / <a href="data/benchmark.json">data</a>`;
  setupControls();
  renderSystem();
  renderAll();
}

fetch("data/benchmark.json")
  .then((response) => {
    if (!response.ok) throw new Error(`failed to load benchmark JSON: ${response.status}`);
    return response.json();
  })
  .then((data) => {
    BENCHMARK = data;
    init();
  })
  .catch((error) => {
    document.body.innerHTML = `<main class="panel"><h1>Failed to load benchmark data</h1><p>${escapeHtml(error.message)}</p></main>`;
  });
