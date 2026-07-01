let BENCHMARK = null;

const VIEW = {
  search: "",
  backend: "",
};

const SERIES_COLORS = ["#047857", "#155eef", "#c2410c", "#7c3aed", "#0f766e", "#be123c"];

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

function contextKey(row) {
  return `${row.contextTokens ?? ""}|${row.contextLabel ?? ""}`;
}

function contextLabel(context) {
  if (context.label) return context.label;
  if (context.tokens === 0) return "0";
  if (Number.isInteger(context.tokens) && context.tokens % 1000 === 0) return `${context.tokens / 1000}k`;
  return String(context.tokens ?? "unknown");
}

function contextDetail(context) {
  if (context.tokens == null) return "tokens unknown";
  return `${context.tokens.toLocaleString()} tokens`;
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

function sameContext(row, context) {
  return row.contextTokens === context.tokens && (row.contextLabel ?? "") === (context.label ?? "");
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

function configLabel(rowOrBackend) {
  if (rowOrBackend.mode === "default" && rowOrBackend.b != null && rowOrBackend.ub != null) return `default b${rowOrBackend.b} ub${rowOrBackend.ub}`;
  if (rowOrBackend.mode === "default") return "default command";
  return `custom b${rowOrBackend.b} ub${rowOrBackend.ub}`;
}

function shortConfigLabel(rowOrBackend) {
  if (rowOrBackend.mode === "default" && rowOrBackend.b != null && rowOrBackend.ub != null) return `default b${rowOrBackend.b} ub${rowOrBackend.ub}`;
  if (rowOrBackend.mode === "default") return "default";
  return `b${rowOrBackend.b} ub${rowOrBackend.ub}`;
}

function isCustomRow(row) {
  return row.mode !== "default";
}

function modelResults(model) {
  return BENCHMARK.results.filter((row) => row.modelId === model.id && (!VIEW.backend || row.build === VIEW.backend));
}

function contextsForModel(model) {
  const seen = new Map();
  for (const row of modelResults(model)) {
    const key = contextKey(row);
    if (!seen.has(key)) {
      seen.set(key, {
        key,
        tokens: row.contextTokens,
        label: row.contextLabel ?? "",
      });
    }
  }
  return [...seen.values()].sort((a, b) => (a.tokens ?? 0) - (b.tokens ?? 0));
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

function resultForBackendConfig(model, context, backendConfig) {
  return modelResults(model).find((row) => sameContext(row, context) && backendKey(row) === backendConfig.key);
}

function resultForDepthConfig(model, depth, backendConfig) {
  return modelResults(model).find((row) => sameDepth(row, depth) && backendKey(row) === backendConfig.key);
}

function pointsForConfig(model, contexts, config) {
  return contexts
    .map((context, contextIndex) => ({
      context,
      contextIndex,
      row: resultForBackendConfig(model, context, config),
    }))
    .filter((point) => point.row)
    .sort((a, b) => a.contextIndex - b.contextIndex);
}

function efficiencyScore(points) {
  if (points.length === 0) return { score: -Infinity, retention: -Infinity, last: -Infinity };
  const sorted = [...points].sort((a, b) => a.contextIndex - b.contextIndex);
  const weighted = sorted.reduce((acc, point, index) => {
    const weight = 2 ** index;
    return {
      value: acc.value + point.row.tps * weight,
      weight: acc.weight + weight,
    };
  }, { value: 0, weight: 0 });
  const score = weighted.value / weighted.weight;
  const baseline = sorted.find((point) => point.context.tokens >= 10000)?.row.tps ?? sorted[0].row.tps;
  const last = sorted[sorted.length - 1].row.tps;
  const retention = baseline > 0 ? last / baseline : -Infinity;
  return { score, retention, last };
}

function compareEfficiency(aScore, bScore) {
  return bScore.score - aScore.score || bScore.last - aScore.last || bScore.retention - aScore.retention;
}

function bestRow(rows) {
  return rows.reduce((best, row) => row.tps > best.tps ? row : best, { tps: -Infinity });
}

function backendContextSummary(model, context, backendId) {
  const rows = modelResults(model).filter((row) => row.build === backendId && sameContext(row, context));
  const defaultRow = rows.find((row) => row.mode === "default") ?? null;
  const customRows = rows.filter(isCustomRow);
  const bestCustomCandidate = bestRow(customRows);
  const bestCustom = bestCustomCandidate.tps === -Infinity ? null : bestCustomCandidate;
  const gain = defaultRow && bestCustom ? (bestCustom.tps / defaultRow.tps - 1) * 100 : null;

  return {
    context,
    backendId,
    defaultRow,
    bestCustom,
    gain,
  };
}

function allBackendSummaries(model) {
  const contexts = contextsForModel(model);
  const backendIds = backendIdsForModel(model);
  return contexts.flatMap((context) => backendIds.map((backendId) => backendContextSummary(model, context, backendId)));
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

function renderMeasure(row) {
  if (!row) return `<span class="muted">-</span>`;
  return `<span class="measure">${fmtTps(row.tps)}</span>${fmtStd(row.std)}`;
}

function renderBackendCell(backendId) {
  return `
    <span class="backend-name">${escapeHtml(backendName(backendId))}</span>
    <span class="backend-details">${escapeHtml(backendDetails(backendId))}</span>
  `;
}

function renderHighlights(model, summaries) {
  const bestLift = summaries
    .filter((summary) => summary.gain != null)
    .reduce((best, summary) => summary.gain > best.gain ? summary : best, { gain: -Infinity });
  const fastestDefault = bestRow(summaries.map((summary) => summary.defaultRow).filter(Boolean));
  const fastestCustom = bestRow(summaries.map((summary) => summary.bestCustom).filter(Boolean));

  return `
    <div class="metric-row">
      <div class="metric-card ${gainClass(bestLift.gain)}">
        <span class="metric-label">Best custom lift</span>
        <strong>${bestLift.gain === -Infinity ? "-" : fmtGain(bestLift.gain)}</strong>
        <span>${bestLift.gain === -Infinity ? "no custom rows" : `${escapeHtml(backendName(bestLift.backendId))} at ${escapeHtml(contextLabel(bestLift.context))}`}</span>
      </div>
      <div class="metric-card">
        <span class="metric-label">Fastest default command</span>
        <strong>${fastestDefault.tps === -Infinity ? "-" : escapeHtml(fmtTps(fastestDefault.tps))}</strong>
        <span>${fastestDefault.tps === -Infinity ? "-" : `${escapeHtml(backendName(fastestDefault.build))} / ${escapeHtml(contextLabel({ tokens: fastestDefault.contextTokens, label: fastestDefault.contextLabel }))}`}</span>
      </div>
      <div class="metric-card">
        <span class="metric-label">Fastest custom command</span>
        <strong>${fastestCustom.tps === -Infinity ? "-" : escapeHtml(fmtTps(fastestCustom.tps))}</strong>
        <span>${fastestCustom.tps === -Infinity ? "-" : `${escapeHtml(backendName(fastestCustom.build))} / ${escapeHtml(shortConfigLabel(fastestCustom))}`}</span>
      </div>
      <div class="metric-card">
        <span class="metric-label">Coverage</span>
        <strong>${contextsForModel(model).length} x ${backendIdsForModel(model).length}</strong>
        <span>contexts x backends</span>
      </div>
    </div>
  `;
}

function renderThroughputChart(model, contexts) {
  const backendIds = backendIdsForModel(model);
  const colorByBackend = new Map(backendIds.map((backendId, index) => [backendId, SERIES_COLORS[index % SERIES_COLORS.length]]));
  const series = backendIds.flatMap((backendId) => {
    const color = colorByBackend.get(backendId) ?? SERIES_COLORS[0];
    const configs = backendConfigsForModel(model).filter((config) => config.build === backendId);
    const defaultConfig = configs.find((config) => config.mode === "default" && config.b == null && config.ub == null);
    const bestCustom = configs
      .filter((config) => config.mode !== "default" || config.b != null || config.ub != null)
      .map((config) => ({
        config,
        points: pointsForConfig(model, contexts, config),
      }))
      .filter((item) => item.points.length > 0)
      .sort((a, b) => {
        const aScore = efficiencyScore(a.points);
        const bScore = efficiencyScore(b.points);
        return compareEfficiency(aScore, bScore) || (a.config.b ?? 0) - (b.config.b ?? 0) || (a.config.ub ?? 0) - (b.config.ub ?? 0);
      })[0];

    return [
      defaultConfig ? { role: "default", label: `${backendName(backendId)} default`, color, points: pointsForConfig(model, contexts, defaultConfig) } : null,
      bestCustom ? { role: "best", label: `${backendName(backendId)} ${shortConfigLabel(bestCustom.config)}`, color, points: bestCustom.points } : null,
    ].filter(Boolean).filter((item) => item.points.length > 0);
  });

  if (series.length === 0) return "";

  const width = 760;
  const height = 220;
  const left = 58;
  const right = 24;
  const top = 24;
  const bottom = 42;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const values = series.flatMap((item) => item.points.map((point) => point.row.tps));
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  let min = Math.max(0, minValue * 0.92);
  let max = maxValue * 1.08;
  if (max - min < 1) {
    max += 0.5;
    min = Math.max(0, min - 0.5);
  }

  const xFor = (index) => contexts.length === 1 ? left + plotWidth / 2 : left + (index * plotWidth) / (contexts.length - 1);
  const yFor = (value) => top + plotHeight - ((value - min) / (max - min)) * plotHeight;

  return `
    <div class="chart-card chart-card-primary">
      <div class="chart-title">Throughput by context</div>
      <svg class="line-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Throughput by backend and context">
        <line class="chart-grid-line" x1="${left}" y1="${top}" x2="${width - right}" y2="${top}"></line>
        <line class="chart-grid-line" x1="${left}" y1="${top + plotHeight / 2}" x2="${width - right}" y2="${top + plotHeight / 2}"></line>
        <line class="chart-grid-line" x1="${left}" y1="${top + plotHeight}" x2="${width - right}" y2="${top + plotHeight}"></line>
        <text class="chart-label" x="${left - 8}" y="${top + 4}" text-anchor="end">${Math.round(max)}</text>
        <text class="chart-label" x="${left - 8}" y="${top + plotHeight + 4}" text-anchor="end">${Math.round(min)}</text>
        ${contexts.map((context, index) => `
          <text class="chart-label" x="${xFor(index)}" y="${height - 12}" text-anchor="middle">${escapeHtml(contextLabel(context))}</text>
        `).join("")}
        ${series.map((item) => {
          const points = item.points.map((point) => `${xFor(point.contextIndex).toFixed(1)},${yFor(point.row.tps).toFixed(1)}`).join(" ");
          const dotRadius = item.role === "best" ? 5 : 4;
          return `
            ${item.points.length > 1 ? `<polyline class="speed-line ${item.role}" points="${points}" style="stroke: ${item.color}"></polyline>` : ""}
            ${item.points.map((point) => `
              <circle class="speed-dot ${item.role}" cx="${xFor(point.contextIndex)}" cy="${yFor(point.row.tps)}" r="${dotRadius}" style="fill: ${item.color}">
                <title>${escapeHtml(item.label)} / ${escapeHtml(contextLabel(point.context))}: ${escapeHtml(fmtTps(point.row.tps))}</title>
              </circle>
            `).join("")}
          `;
        }).join("")}
      </svg>
      <div class="chart-legend">
        ${series.map((item) => `<span><i class="legend-line ${item.role}" style="color: ${item.color}"></i>${escapeHtml(item.label)}</span>`).join("")}
      </div>
    </div>
  `;
}

function renderGainChart(model, contexts, backendIds) {
  const series = backendIds.map((backendId, index) => ({
    backendId,
    color: SERIES_COLORS[index % SERIES_COLORS.length],
    points: contexts
      .map((context, contextIndex) => ({
        context,
        contextIndex,
        summary: backendContextSummary(model, context, backendId),
      }))
      .filter((point) => point.summary.gain != null),
  })).filter((item) => item.points.length > 0);

  if (series.length === 0) return "";

  const width = 720;
  const height = 170;
  const left = 44;
  const right = 22;
  const top = 24;
  const bottom = 38;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const gains = series.flatMap((item) => item.points.map((point) => point.summary.gain));
  let min = Math.min(0, ...gains);
  let max = Math.max(0, ...gains);
  if (max - min < 1) {
    max += 0.5;
    min -= 0.5;
  }

  const xFor = (index) => contexts.length === 1 ? left + plotWidth / 2 : left + (index * plotWidth) / (contexts.length - 1);
  const yFor = (gain) => top + plotHeight - ((gain - min) / (max - min)) * plotHeight;
  const zeroY = yFor(0);

  return `
    <div class="chart-card">
      <div class="chart-title">Custom command gain vs default command, by backend</div>
      <svg class="gain-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Custom gain by backend and context">
        <line class="chart-grid-line" x1="${left}" y1="${top}" x2="${width - right}" y2="${top}"></line>
        <line class="chart-grid-line" x1="${left}" y1="${top + plotHeight}" x2="${width - right}" y2="${top + plotHeight}"></line>
        <line class="chart-axis" x1="${left}" y1="${zeroY}" x2="${width - right}" y2="${zeroY}"></line>
        <text class="chart-label" x="${left - 8}" y="${top + 4}" text-anchor="end">${fmtGain(max)}</text>
        <text class="chart-label" x="${left - 8}" y="${top + plotHeight + 4}" text-anchor="end">${fmtGain(min)}</text>
        ${contexts.map((context, index) => `
          <text class="chart-label" x="${xFor(index)}" y="${height - 10}" text-anchor="middle">${escapeHtml(contextLabel(context))}</text>
        `).join("")}
        ${series.map((item) => {
          const points = item.points.map((point) => `${xFor(point.contextIndex).toFixed(1)},${yFor(point.summary.gain).toFixed(1)}`).join(" ");
          return `
            ${item.points.length > 1 ? `<polyline class="gain-line" points="${points}" style="stroke: ${item.color}"></polyline>` : ""}
            ${item.points.map((point) => {
              const x = xFor(point.contextIndex);
              const y = yFor(point.summary.gain);
              return `
                <g>
                  <circle class="gain-dot" cx="${x}" cy="${y}" r="4.5" style="fill: ${item.color}"></circle>
                  <title>${escapeHtml(backendName(item.backendId))} / ${escapeHtml(contextLabel(point.context))}: ${escapeHtml(fmtGain(point.summary.gain))}</title>
                </g>
              `;
            }).join("")}
          `;
        }).join("")}
      </svg>
      <div class="chart-legend">
        ${series.map((item) => `<span><i style="background: ${item.color}"></i>${escapeHtml(backendName(item.backendId))}</span>`).join("")}
      </div>
    </div>
  `;
}

function renderDefaultVsCustomTable(summaries) {
  return `
    <div class="table-wrap">
      <table class="comparison-table">
        <thead>
          <tr>
            <th>Context</th>
            <th>Backend</th>
            <th>Default command</th>
            <th>Best custom command</th>
            <th>Custom gain</th>
            <th>Custom config</th>
          </tr>
        </thead>
        <tbody>
          ${summaries.map((summary) => `
            <tr>
              <th>
                <span class="context-main">${escapeHtml(contextLabel(summary.context))}</span>
                <span class="context-sub">${escapeHtml(contextDetail(summary.context))}</span>
              </th>
              <td>${renderBackendCell(summary.backendId)}</td>
              <td>${renderMeasure(summary.defaultRow)}</td>
              <td>${renderMeasure(summary.bestCustom)}</td>
              <td class="gain-cell ${gainClass(summary.gain)}">${fmtGain(summary.gain)}</td>
              <td>${summary.bestCustom ? `<code>${escapeHtml(shortConfigLabel(summary.bestCustom))}</code>` : `<span class="muted">-</span>`}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function sortedBackendConfigs(model, contexts) {
  return backendConfigsForModel(model).sort((a, b) => {
    if (a.mode === "default" && b.mode !== "default") return -1;
    if (a.mode !== "default" && b.mode === "default") return 1;
    const aScore = efficiencyScore(pointsForConfig(model, contexts, a));
    const bScore = efficiencyScore(pointsForConfig(model, contexts, b));
    return compareEfficiency(aScore, bScore) || (a.b ?? 0) - (b.b ?? 0) || (a.ub ?? 0) - (b.ub ?? 0);
  });
}

function featuredBackendConfigs(model, contexts) {
  return backendIdsForModel(model).flatMap((backendId) => {
    const configs = sortedBackendConfigs(model, contexts).filter((config) => config.build === backendId);
    const defaultConfig = configs.find((config) => config.mode === "default" && config.b == null && config.ub == null);
    const bestCustom = configs.find((config) => config.mode !== "default" || config.b != null || config.ub != null);
    return [defaultConfig, bestCustom].filter(Boolean);
  });
}

function renderBackendMatrix(model, contexts, configs, bestConfigKeys = new Set()) {
  const defaultKeys = new Set(backendIdsForModel(model).map((backendId) => `${backendId}|default||`));
  const visibleKeys = new Set([...defaultKeys, ...bestConfigKeys]);
  const localTopKeyByContext = new Map(contexts.map((context) => {
    const rows = modelResults(model).filter((row) => sameContext(row, context));
    const top = bestRow(rows);
    return [context.key, top.tps === -Infinity ? null : backendKey(top)];
  }));

  return backendIdsForModel(model).map((backendId) => {
    const backendConfigs = configs.filter((config) => config.build === backendId);
    if (backendConfigs.length === 0) return "";
    const hiddenCount = backendConfigs.filter((config) => !visibleKeys.has(config.key)).length;

    return `
      <section class="backend-matrix-section">
        <header class="backend-matrix-header">
          <div>
            <h4>${escapeHtml(backendName(backendId))}</h4>
            <p>${escapeHtml(backendDetails(backendId))}</p>
          </div>
        </header>
        <div class="table-wrap matrix-wrap">
          <table class="matrix-table">
            <thead>
              <tr>
                <th>Config</th>
                ${contexts.map((context) => `<th>${escapeHtml(contextLabel(context))}</th>`).join("")}
              </tr>
            </thead>
            <tbody>
          ${backendConfigs.map((config) => {
            const isDefaultConfig = defaultKeys.has(config.key);
            const isBestConfig = bestConfigKeys.has(config.key);
            const isExtraConfig = !visibleKeys.has(config.key);
            const roleLabel = isDefaultConfig ? "baseline" : isBestConfig ? "selected" : "measured";
            return `
            <tr class="${[
              isDefaultConfig ? "matrix-row-default" : "",
              isBestConfig ? "matrix-row-best" : "",
              isExtraConfig ? "matrix-extra-row" : "",
            ].filter(Boolean).join(" ")}" ${isExtraConfig ? "hidden" : ""}>
              <th>
                <span class="backend-name">${escapeHtml(shortConfigLabel(config))}</span>
                <span class="backend-details">
                  <span class="matrix-role ${isDefaultConfig ? "baseline" : isBestConfig ? "selected" : "measured"}">${roleLabel}</span>
                </span>
              </th>
              ${contexts.map((context, contextIndex) => {
                const row = resultForBackendConfig(model, context, config);
                const isDefault = row && defaultKeys.has(config.key);
                const isCustom = row && bestConfigKeys.has(config.key);
                const isLocalTop = row && localTopKeyByContext.get(context.key) === config.key;
                const classes = [
                  isDefault ? "matrix-default" : "",
                  isCustom ? "matrix-best-custom" : "",
                  isLocalTop ? "matrix-local-top" : "",
                  row && !isLocalTop ? "matrix-not-top" : "",
                ].filter(Boolean).join(" ");
                return `<td class="${classes}">${renderMeasure(row)}</td>`;
              }).join("")}
            </tr>
          `}).join("")}
          ${hiddenCount > 0 ? `
            <tr class="matrix-toggle-row" role="button" tabindex="0">
              <td colspan="${contexts.length + 1}">
                <button type="button" class="chip small matrix-toggle" data-hidden-count="${hiddenCount}">Show ${hiddenCount} more config${hiddenCount === 1 ? "" : "s"}</button>
              </td>
            </tr>
          ` : ""}
            </tbody>
          </table>
        </div>
      </section>
    `;
  }).join("");
}

function renderSweepHighlights(model, depths, configs) {
  const rows = modelResults(model).filter((row) => typeof row.tps === "number");
  const best = bestRow(rows);
  const rawRows = modelResults(model).filter((row) => row.raw != null).length;

  return `
    <div class="metric-row">
      <div class="metric-card">
        <span class="metric-label">Fastest measurement</span>
        <strong>${best.tps === -Infinity ? "-" : escapeHtml(fmtTps(best.tps))}</strong>
        <span>${best.tps === -Infinity ? "no numeric rows" : `${escapeHtml(backendName(best.build))} / d${escapeHtml(depthValue(best))} / ${escapeHtml(shortConfigLabel(best))}`}</span>
      </div>
      <div class="metric-card">
        <span class="metric-label">Sweep coverage</span>
        <strong>${depths.length} x ${configs.length}</strong>
        <span>depths x batch configs</span>
      </div>
      <div class="metric-card">
        <span class="metric-label">Raw rows kept</span>
        <strong>${rawRows}</strong>
        <span>full llama-bench rows in JSON</span>
      </div>
      <div class="metric-card">
        <span class="metric-label">Measurements</span>
        <strong>${modelResults(model).length}</strong>
        <span>total rows</span>
      </div>
    </div>
  `;
}

function renderRawDetails(row) {
  if (!row?.raw) return "";
  return `<details class="raw-details"><summary>raw</summary><pre>${escapeHtml(JSON.stringify(row.raw, null, 2))}</pre></details>`;
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
                <th>Depth</th>
                ${backendConfigs.map((config) => `<th><span class="backend-name">${escapeHtml(shortConfigLabel(config))}</span><span class="backend-details">${escapeHtml(configLabel(config))}</span></th>`).join("")}
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
                    return `<td class="${isTop ? "matrix-local-top" : row ? "matrix-not-top" : ""}">${renderMeasure(row)}${renderRawDetails(row)}</td>`;
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

function commandTemplate(model) {
  return `llama-bench -m /path/to/${model.file} -o jsonl -p 2080 -d 512,10000,25000,50000,75000,100000 -b 2048 -ub 512 -n 0 -r 3 -ngl 999 -fa on -mmp 0`;
}

function renderMethod(model) {
  return `
    <details class="method-details">
      <summary>Method and command</summary>
      <p>Benchmarks measure prefill throughput only: prompt tokens are processed with <code>-n 0</code>, so no generation throughput is included.</p>
      <code class="command-code">${escapeHtml(commandTemplate(model))}</code>
      <p class="muted">The local runner tests the displayed <code>-b</code>/<code>-ub</code> pairs and streams <code>jsonl</code> results into the page data as each depth completes.</p>
    </details>
  `;
}

function renderModelCard(model) {
  const depths = depthsForModel(model);
  const provider = model.quantProvider ?? "Unknown";
  const allConfigs = backendConfigsForModel(model);

  return `
    <section class="model-card">
      <header class="model-header">
        <div>
          <h2>${escapeHtml(model.name)}</h2>
          <p>${escapeHtml(model.shape ?? "")}</p>
        </div>
        <div class="model-meta">
          <span>${escapeHtml(provider)}</span>
          <span>${escapeHtml(model.quant)}</span>
          <span>${escapeHtml(model.architecture)}</span>
          <span>${escapeHtml(model.paramsB)}B params</span>
          <span>${escapeHtml(model.sizeGiB)} GiB</span>
          <code>${escapeHtml(model.file)}</code>
        </div>
      </header>

      ${renderSweepHighlights(model, depths, allConfigs)}

      <section class="table-section detail-section">
        <h3>Sweep matrix</h3>
        <p class="section-note">Each row is a depth from <code>-d</code>. Each column is one expanded <code>-b</code>/<code>-ub</code> configuration. Green marks the fastest config for that backend/depth. Raw llama-bench rows are available per cell.</p>
        ${renderSweepMatrix(model, depths, allConfigs)}
      </section>

      ${renderMethod(model)}
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
    ["CPU/GPU", BENCHMARK.system.cpuGpu],
    ["GPU", BENCHMARK.system.gpu],
    ["Arch", BENCHMARK.system.arch],
    ["Memory", BENCHMARK.system.memory],
    ["Wave size", BENCHMARK.system.waveSize],
    ["Backends", BENCHMARK.builds.map((build) => backendName(build.shortLabel)).join(", ")],
  ];
  tbody.innerHTML = entries.map(([key, value]) => `<tr><th>${escapeHtml(key)}</th><td>${escapeHtml(value)}</td></tr>`).join("");
}

function renderStats() {
  const models = filteredModels();
  const depthKeys = new Set(models.flatMap((model) => depthsForModel(model).map((depth) => depth.key)));
  const backendIds = new Set(models.flatMap((model) => backendIdsForModel(model)));
  const resultCount = models.reduce((sum, model) => sum + modelResults(model).length, 0);
  byId("stats-line").textContent = `Showing ${models.length} model variants, ${depthKeys.size} depths, ${backendIds.size} backends, ${resultCount} sweep rows`;
}

function renderAll() {
  renderModels();
  renderStats();
}

function setupControls() {
  const backend = byId("filter-backend");
  backend.innerHTML = `<option value="">All backends</option>${BENCHMARK.builds.map((build) => `<option value="${escapeHtml(build.shortLabel)}">${escapeHtml(backendName(build.shortLabel))}</option>`).join("")}`;

  byId("filter-search").addEventListener("input", (event) => {
    VIEW.search = event.target.value;
    renderAll();
  });

  backend.addEventListener("change", (event) => {
    VIEW.backend = event.target.value;
    renderAll();
  });

  byId("reset-filters").addEventListener("click", () => {
    VIEW.search = "";
    VIEW.backend = "";
    byId("filter-search").value = "";
    backend.value = "";
    renderAll();
  });

  byId("models").addEventListener("click", (event) => {
    const toggleRow = event.target.closest(".matrix-toggle-row");
    if (!toggleRow) return;
    const button = toggleRow.querySelector(".matrix-toggle");
    const tbody = toggleRow.closest("tbody");
    const rows = [...tbody.querySelectorAll(".matrix-extra-row")];
    const expanded = button.dataset.expanded === "true";
    for (const row of rows) row.hidden = expanded;
    button.dataset.expanded = String(!expanded);
    button.textContent = expanded
      ? `Show ${button.dataset.hiddenCount} more config${button.dataset.hiddenCount === "1" ? "" : "s"}`
      : "Hide extra configs";
  });

  byId("models").addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const toggleRow = event.target.closest(".matrix-toggle-row");
    if (!toggleRow) return;
    event.preventDefault();
    toggleRow.click();
  });
}

function init() {
  byId("datasetId").textContent = BENCHMARK.dataset.id;
  byId("sys-info").textContent = `${BENCHMARK.system.arch} / ${BENCHMARK.system.memory}`;
  byId("run-info").innerHTML = `Dataset ${escapeHtml(BENCHMARK.dataset.date)} / <a href="data/benchmark.json">benchmark.json</a> / raw rows preserved`;
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
