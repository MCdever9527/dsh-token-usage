window.__ModuleLoader__.load({ id: "dsh-token-usage", factory: (require) => { var module = { exports: {} };
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client/index.tsx
var index_exports = {};
__export(index_exports, {
  NS: () => NS,
  SECTION_ORDER: () => SECTION_ORDER,
  StatsSource: () => StatsSource,
  TokenUsagePage: () => TokenUsagePage,
  USAGE_RANGES: () => USAGE_RANGES,
  apply: () => apply,
  billedOf: () => billedOf,
  dayInRange: () => dayInRange,
  dayKeyOf: () => dayKeyOf,
  inject: () => inject,
  pickSession: () => pickSession,
  startDayOf: () => startDayOf,
  statsPathsOf: () => statsPathsOf,
  sumDays: () => sumDays,
  viewForRange: () => viewForRange
});
module.exports = __toCommonJS(index_exports);

// src/client/page.tsx
var import_react = require("react");
var import_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");

// src/client/range.ts
var USAGE_RANGES = ["today", "3d", "7d", "30d", "all"];
function emptyBuckets() {
  return { inputTokens: 0, cacheReadTokens: 0, outputTokens: 0, reasoningTokens: 0, calls: 0 };
}
function dayKeyOf(date) {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
function shiftDay(date, days) {
  const shifted = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  shifted.setDate(shifted.getDate() + days);
  return shifted;
}
function startDayOf(range, now = /* @__PURE__ */ new Date()) {
  if (range === "all") return void 0;
  const span = range === "today" ? 1 : range === "3d" ? 3 : range === "7d" ? 7 : 30;
  return dayKeyOf(shiftDay(now, -(span - 1)));
}
function dayInRange(day, range, now = /* @__PURE__ */ new Date()) {
  if (range === "all") return true;
  if (day === "unknown") return false;
  const start = startDayOf(range, now);
  const today = dayKeyOf(now);
  return start !== void 0 && day >= start && day <= today;
}
function sumDays(days, range, now = /* @__PURE__ */ new Date()) {
  const total = emptyBuckets();
  if (days === void 0) return total;
  for (const [day, buckets] of Object.entries(days)) {
    if (!dayInRange(day, range, now)) continue;
    total.inputTokens += buckets.inputTokens;
    total.cacheReadTokens += buckets.cacheReadTokens;
    total.outputTokens += buckets.outputTokens;
    total.reasoningTokens += buckets.reasoningTokens;
    total.calls += buckets.calls;
  }
  return total;
}
function billedOf(buckets) {
  return buckets.inputTokens + buckets.cacheReadTokens + buckets.outputTokens;
}

// src/client/page.tsx
var import_jsx_runtime = require("react/jsx-runtime");
var STYLES = [
  ".tua-page { display: flex; flex-direction: column; gap: 16px; max-width: 860px; }",
  ".tua-heading { margin: 0; font-size: 13px; font-weight: 600; color: var(--dsw-alias-label-primary); }",
  ".tua-intro { margin: 0; font-size: 11px; line-height: 1.6; color: var(--dsw-alias-label-tertiary); }",
  ".tua-toolbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }",
  ".tua-ranges { display: inline-flex; align-items: center; gap: 4px; margin-right: auto; }",
  ".tua-rangesLabel { font-size: 11px; color: var(--dsw-alias-label-tertiary); margin-right: 2px; }",
  ".tua-rangeActive { outline: 2px solid var(--dsw-alias-label-tertiary); outline-offset: -2px; border-radius: var(--dsw-alias-radius-md, 8px); }",
  ".tua-meta { display: flex; gap: 12px; flex-wrap: wrap; font-size: 11px; color: var(--dsw-alias-label-tertiary); }",
  ".tua-metaItem { display: inline-flex; gap: 4px; }",
  ".tua-grand { display: flex; flex-direction: column; gap: 6px; padding: 12px 14px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-alias-radius-md, 8px); }",
  ".tua-grandLabel { font-size: 11px; color: var(--dsw-alias-label-tertiary); }",
  ".tua-grandNumbers { display: flex; gap: 18px; flex-wrap: wrap; }",
  ".tua-grandItem { display: flex; flex-direction: column; gap: 2px; }",
  ".tua-grandValue { font-size: 14px; font-weight: 600; color: var(--dsw-alias-label-primary); font-variant-numeric: tabular-nums; }",
  ".tua-grandKey { font-size: 10px; color: var(--dsw-alias-label-tertiary); }",
  ".tua-provider { display: flex; flex-direction: column; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-alias-radius-md, 8px); overflow: hidden; }",
  ".tua-providerHead { display: flex; align-items: center; gap: 8px; width: 100%; box-sizing: border-box; padding: 10px 12px; margin: 0; border: none; background: none; font: inherit; text-align: left; cursor: pointer; }",
  ".tua-providerHead:hover { background: var(--dsw-alias-bg-layer-3); }",
  ".tua-providerHead:focus-visible { outline: 2px solid var(--dsw-alias-label-tertiary); outline-offset: -2px; }",
  ".tua-chevron { flex: none; width: 6px; height: 6px; margin: 0 4px; border-right: 1.5px solid var(--dsw-alias-label-tertiary); border-bottom: 1.5px solid var(--dsw-alias-label-tertiary); transform: rotate(-45deg); transition: transform 0.12s ease; }",
  ".tua-chevronOpen { transform: rotate(45deg); }",
  ".tua-providerName { font-size: 12px; font-weight: 600; color: var(--dsw-alias-label-primary); }",
  ".tua-providerId { min-width: 0; font-size: 11px; color: var(--dsw-alias-label-tertiary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }",
  ".tua-providerTotal { flex: none; margin-left: auto; font-size: 11px; color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums; }",
  ".tua-table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }",
  ".tua-table th, .tua-table td { padding: 6px 12px; font-size: 11px; text-align: right; white-space: nowrap; }",
  ".tua-table th { color: var(--dsw-alias-label-tertiary); font-weight: 500; border-top: 1px solid var(--dsw-alias-border-l2); }",
  ".tua-table td { color: var(--dsw-alias-label-primary); border-top: 1px solid var(--dsw-alias-border-l1); }",
  ".tua-table th:first-child, .tua-table td:first-child { text-align: left; }",
  ".tua-modelName { color: var(--dsw-alias-label-primary); }",
  ".tua-subtotal td { color: var(--dsw-alias-label-secondary); font-weight: 600; }",
  ".tua-status { font-size: 11px; color: var(--dsw-alias-label-tertiary); }",
  ".tua-error { font-size: 11px; color: #d93025; line-height: 1.6; }"
].join("\n");
function formatCount(value) {
  if (!Number.isFinite(value)) return String(value);
  if (value >= 1e9) return trim(value / 1e9) + "B";
  if (value >= 1e6) return trim(value / 1e6) + "M";
  if (value >= 1e4) return trim(value / 1e3) + "k";
  return value.toLocaleString();
}
function trim(value) {
  const text = value.toFixed(2);
  return text.replace(/\.?0+$/, "");
}
function cacheHit(row) {
  const prompt = row.inputTokens + row.cacheReadTokens;
  if (prompt <= 0) return "\u2014";
  return Math.round(row.cacheReadTokens / prompt * 100) + "%";
}
function formatTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString();
}
function zeroBuckets() {
  return { inputTokens: 0, cacheReadTokens: 0, outputTokens: 0, reasoningTokens: 0, calls: 0 };
}
function viewForRange(groups, range, now) {
  const providers = [];
  const totals = zeroBuckets();
  for (const group of groups) {
    const models = [];
    const groupTotals = zeroBuckets();
    for (const model of group.models) {
      const buckets = range === "all" ? {
        inputTokens: model.inputTokens,
        cacheReadTokens: model.cacheReadTokens,
        outputTokens: model.outputTokens,
        reasoningTokens: model.reasoningTokens,
        calls: model.calls
      } : sumDays(model.days, range, now);
      if (buckets.calls === 0) continue;
      const row2 = { id: model.id, ...buckets, billedTokens: billedOf(buckets) };
      models.push(row2);
      groupTotals.inputTokens += buckets.inputTokens;
      groupTotals.cacheReadTokens += buckets.cacheReadTokens;
      groupTotals.outputTokens += buckets.outputTokens;
      groupTotals.reasoningTokens += buckets.reasoningTokens;
      groupTotals.calls += buckets.calls;
    }
    if (models.length === 0) continue;
    const row = { id: group.id, ...groupTotals, billedTokens: billedOf(groupTotals) };
    providers.push({ id: group.id, displayName: group.displayName, totals: row, models });
    totals.inputTokens += groupTotals.inputTokens;
    totals.cacheReadTokens += groupTotals.cacheReadTokens;
    totals.outputTokens += groupTotals.outputTokens;
    totals.reasoningTokens += groupTotals.reasoningTokens;
    totals.calls += groupTotals.calls;
  }
  return { providers, totals: { id: "total", ...totals, billedTokens: billedOf(totals) } };
}
function ProviderSection(props) {
  const { group, t, expanded, onToggle } = props;
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { className: "tua-provider", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", { type: "button", className: "tua-providerHead", "aria-expanded": expanded, onClick: onToggle, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: expanded ? "tua-chevron tua-chevronOpen" : "tua-chevron" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "tua-providerName", children: group.displayName }),
      group.displayName !== group.id ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "tua-providerId", children: group.id }) : null,
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "tua-providerTotal", title: t("totals.billed"), children: formatCount(group.totals.billedTokens) })
    ] }),
    expanded ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("table", { className: "tua-table", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("thead", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("tr", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", { children: t("model") }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", { children: t("totals.input") }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", { children: t("totals.cacheRead") }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", { children: t("totals.output") }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", { children: t("totals.billed") }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", { children: t("totals.hit") }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", { children: t("totals.calls") })
      ] }) }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("tbody", { children: [
        group.models.map((model) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("tr", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { className: "tua-modelName", children: model.id }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { title: model.inputTokens.toLocaleString(), children: formatCount(model.inputTokens) }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { title: model.cacheReadTokens.toLocaleString(), children: formatCount(model.cacheReadTokens) }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { title: model.outputTokens.toLocaleString(), children: formatCount(model.outputTokens) }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { title: model.billedTokens.toLocaleString(), children: formatCount(model.billedTokens) }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: cacheHit(model) }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { title: model.calls.toLocaleString(), children: formatCount(model.calls) })
        ] }, model.id)),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("tr", { className: "tua-subtotal", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: t("provider.total") }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { title: group.totals.inputTokens.toLocaleString(), children: formatCount(group.totals.inputTokens) }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { title: group.totals.cacheReadTokens.toLocaleString(), children: formatCount(group.totals.cacheReadTokens) }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { title: group.totals.outputTokens.toLocaleString(), children: formatCount(group.totals.outputTokens) }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { title: group.totals.billedTokens.toLocaleString(), children: formatCount(group.totals.billedTokens) }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: cacheHit(group.totals) }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { title: group.totals.calls.toLocaleString(), children: formatCount(group.totals.calls) })
        ] })
      ] })
    ] }) : null
  ] });
}
function GrandTotals(props) {
  const { totals, t } = props;
  const items = [
    { value: totals.inputTokens, key: "totals.input" },
    { value: totals.cacheReadTokens, key: "totals.cacheRead" },
    { value: totals.outputTokens, key: "totals.output" },
    { value: totals.billedTokens, key: "totals.billed" },
    { value: totals.calls, key: "totals.calls" }
  ];
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "tua-grand", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "tua-grandLabel", children: t("grand.total") }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "tua-grandNumbers", children: items.map((item) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "tua-grandItem", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "tua-grandValue", title: item.value.toLocaleString(), children: formatCount(item.value) }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "tua-grandKey", children: t(item.key) })
    ] }, item.key)) })
  ] });
}
function TokenUsagePage(props) {
  const { t, useStats, reload } = props;
  const state = useStats((value) => value);
  const [collapsed, setCollapsed] = (0, import_react.useState)(/* @__PURE__ */ new Set());
  const [range, setRange] = (0, import_react.useState)("all");
  const snapshot = state.status === "ready" ? state.snapshot : void 0;
  const groups = (0, import_react.useMemo)(() => snapshot?.providers ?? [], [snapshot]);
  const now = (0, import_react.useMemo)(() => /* @__PURE__ */ new Date(), [snapshot]);
  const view = (0, import_react.useMemo)(() => viewForRange(groups, range, now), [groups, range, now]);
  if (state.status === "loading") {
    return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "tua-page", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("style", { children: STYLES }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "tua-status", children: t("status.loading") })
    ] });
  }
  if (state.status === "error") {
    const reason = state.reason;
    let text;
    if (reason === "no-home") text = t("status.noHome");
    else if (reason === "no-session") text = t("status.noSession");
    else if (reason === "not-found") text = t("status.notFound");
    else if (reason.startsWith("read: ")) text = t("status.readFailed", { reason: reason.slice(6) });
    else if (reason.startsWith("bad-data: ")) text = t("status.badData", { reason: reason.slice(10) });
    else text = t("status.readFailed", { reason });
    return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "tua-page", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("style", { children: STYLES }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "tua-error", children: text })
    ] });
  }
  const scan = snapshot?.scan;
  if (snapshot !== void 0 && scan !== void 0 && scan.status === "scanning") {
    return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "tua-page", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("style", { children: STYLES }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "tua-status", children: t("status.scanning") })
    ] });
  }
  if (snapshot === void 0 || groups.length === 0) {
    return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "tua-page", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("style", { children: STYLES }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "tua-status", children: t("status.empty") })
    ] });
  }
  const toggle = (id) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const allCollapsed = view.providers.every((group) => collapsed.has(group.id));
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "tua-page", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("style", { children: STYLES }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { className: "tua-heading", children: t("title") }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "tua-intro", children: t("intro") }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "tua-toolbar", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "tua-ranges", role: "group", "aria-label": t("range.label"), children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "tua-rangesLabel", children: t("range.label") }),
        USAGE_RANGES.map((option) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.Button, { onClick: () => setRange(option), children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: option === range ? "tua-rangeActive" : void 0, children: t("range." + option) }) }, option))
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.Button, { onClick: () => setCollapsed(allCollapsed ? /* @__PURE__ */ new Set() : new Set(view.providers.map((group) => group.id))), children: allCollapsed ? t("expand.all") : t("collapse.all") }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.Button, { onClick: reload, children: t("refresh") })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "tua-meta", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "tua-metaItem", children: t("updated", { time: formatTime(snapshot.generatedAt) }) }),
      scan?.storedSessions !== void 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "tua-metaItem", children: t("sessions", { count: scan.storedSessions }) }) : null,
      scan?.archivedCount !== void 0 && scan.archivedCount > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "tua-metaItem", children: t("archived", { count: scan.archivedCount }) }) : null,
      scan?.durationMs !== void 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "tua-metaItem", children: t("scan.duration", { seconds: (scan.durationMs / 1e3).toFixed(1) + "s" }) }) : null,
      scan?.failedSessions !== void 0 && scan.failedSessions > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "tua-metaItem", children: t("scan.failed", { count: scan.failedSessions }) }) : null
    ] }),
    view.providers.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "tua-status", children: t("status.emptyRange", { range: t("range." + range) }) }) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(GrandTotals, { totals: view.totals, t }),
      view.providers.map((group) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        ProviderSection,
        {
          group,
          t,
          expanded: !collapsed.has(group.id),
          onToggle: () => toggle(group.id)
        },
        group.id
      ))
    ] })
  ] });
}

// src/client/stats-source.ts
function statsPathsOf(home) {
  const normalized = home.replace(/[\\/]+$/, "");
  const dir = normalized + "/.dsh/cache/dsh-token-usage";
  return { primary: dir + "/stats.json", anchor: dir + "/anchor.json", legacy: normalized + "/cache/dsh-token-usage/stats.json" };
}
function pickSession(items) {
  return items.find((item) => item.running === true && typeof item.cwd === "string")?.sessionId ?? items.find((item) => typeof item.cwd === "string")?.sessionId ?? items[0]?.sessionId;
}
var REREAD_DEBOUNCE_MS = 400;
var WATCH_RETRY_MS = 1e4;
var WATCH_RECONNECT_MS = 500;
var StatsSource = class {
  #remote;
  #state = { status: "loading" };
  #listeners = /* @__PURE__ */ new Set();
  #active = false;
  #home;
  #sessionId;
  /** The candidate path that last yielded a valid snapshot; watched while active. */
  #resolvedPath;
  #reloadTimer;
  #watchAbort;
  #readGeneration = 0;
  constructor(remote) {
    this.#remote = remote;
  }
  getSnapshot() {
    return this.#state;
  }
  subscribe(listener) {
    this.#listeners.add(listener);
    if (this.#listeners.size === 1) this.#activate();
    return () => {
      this.#listeners.delete(listener);
      if (this.#listeners.size === 0) this.#suspend();
    };
  }
  /** Whether the read/watch loop is currently active. */
  isActive() {
    return this.#active;
  }
  /** Force an immediate re-read (the refresh button). */
  reload() {
    if (!this.#active) this.#activate();
    else if (this.#sessionId !== void 0 && this.#home !== void 0) void this.#resolveAndRead();
  }
  #activate() {
    if (this.#active) return;
    this.#active = true;
    void this.#bootstrap();
  }
  #suspend() {
    if (!this.#active) return;
    this.#active = false;
    if (this.#reloadTimer !== void 0) clearTimeout(this.#reloadTimer);
    this.#reloadTimer = void 0;
    this.#watchAbort?.abort();
    this.#watchAbort = void 0;
    this.#readGeneration += 1;
  }
  async #bootstrap() {
    if (!this.#active) return;
    const home = this.#remote.$host?.home;
    if (typeof home !== "string" || home.length === 0) {
      this.#publish({ status: "error", reason: "no-home" });
      return;
    }
    this.#home = home;
    try {
      const listed = await this.#remote.session.list({});
      if (!this.#active) return;
      if (!listed.ok) {
        this.#publish({ status: "error", reason: "session-list: " + (listed.error.message ?? listed.error.code ?? "failed") });
        return;
      }
      this.#sessionId = pickSession(listed.value.items);
      if (this.#sessionId === void 0) {
        this.#publish({ status: "error", reason: "no-session" });
        return;
      }
    } catch (error) {
      if (!this.#active) return;
      this.#publish({ status: "error", reason: "session-list: " + String(error) });
      return;
    }
    await this.#resolveAndRead();
    if (this.#active) void this.#watchLoop();
  }
  /** Read one candidate path and classify the outcome. */
  async #probe(path, generation) {
    const sessionId = this.#sessionId;
    if (sessionId === void 0) return { kind: "error", reason: "no-session" };
    let text;
    try {
      const read = await this.#remote.workspaceFiles.read(sessionId, path, {});
      if (generation !== this.#readGeneration) return { kind: "not-found" };
      if (!read.ok) {
        const code = read.error.code ?? "failed";
        return code === "workspace-file/not-found" ? { kind: "not-found" } : { kind: "error", reason: "read: " + code };
      }
      text = read.value.text;
    } catch (error) {
      return { kind: "error", reason: "read: " + String(error) };
    }
    try {
      const parsed = JSON.parse(text);
      if (parsed?.version === 1) return { kind: "ok", snapshot: parsed };
      return { kind: "error", reason: "bad-data: unsupported snapshot version" };
    } catch (error) {
      return { kind: "error", reason: "bad-data: " + String(error) };
    }
  }
  /**
   * Walk the candidates: the default-anchored path first, then the anchor file
   * (which names the real path), then the legacy guess. The winner becomes the
   * watched path.
   */
  async #resolveAndRead() {
    const home = this.#home;
    if (home === void 0) return;
    const generation = ++this.#readGeneration;
    const paths = statsPathsOf(home);
    const home_ = this.#remote.$host.home;
    void home_;
    const primary = await this.#probe(paths.primary, generation);
    if (!this.#active || generation !== this.#readGeneration) return;
    if (primary.kind === "ok") {
      this.#resolvedPath = paths.primary;
      this.#publish({ status: "ready", snapshot: primary.snapshot });
      return;
    }
    if (primary.kind === "error") {
      this.#publish({ status: "error", reason: primary.reason });
      return;
    }
    const anchor = await this.#probeAnchor(paths.anchor, generation);
    if (!this.#active || generation !== this.#readGeneration) return;
    if (anchor.kind === "ok") {
      this.#resolvedPath = anchor.path;
      this.#publish({ status: "ready", snapshot: anchor.snapshot });
      return;
    }
    if (anchor.kind === "error") {
      this.#publish({ status: "error", reason: anchor.reason });
      return;
    }
    const legacy = await this.#probe(paths.legacy, generation);
    if (!this.#active || generation !== this.#readGeneration) return;
    if (legacy.kind === "ok") {
      this.#resolvedPath = paths.legacy;
      this.#publish({ status: "ready", snapshot: legacy.snapshot });
      return;
    }
    if (legacy.kind === "error") {
      this.#publish({ status: "error", reason: legacy.reason });
      return;
    }
    this.#publish({ status: "error", reason: "not-found" });
  }
  /** Read the anchor file and follow the absolute path it names. */
  async #probeAnchor(anchorPath, generation) {
    const sessionId = this.#sessionId;
    if (sessionId === void 0) return { kind: "error", reason: "no-session" };
    let text;
    try {
      const read = await this.#remote.workspaceFiles.read(sessionId, anchorPath, {});
      if (generation !== this.#readGeneration) return { kind: "not-found" };
      if (!read.ok) {
        const code = read.error.code ?? "failed";
        return code === "workspace-file/not-found" ? { kind: "not-found" } : { kind: "error", reason: "read anchor: " + code };
      }
      text = read.value.text;
    } catch (error) {
      return { kind: "error", reason: "read anchor: " + String(error) };
    }
    let statsPath;
    try {
      statsPath = JSON.parse(text).statsPath;
    } catch (error) {
      return { kind: "error", reason: "bad anchor: " + String(error) };
    }
    if (typeof statsPath !== "string" || statsPath.length === 0) {
      return { kind: "error", reason: "bad anchor: no statsPath" };
    }
    const stats = await this.#probe(statsPath, generation);
    if (stats.kind === "ok") return { kind: "ok", snapshot: stats.snapshot, path: statsPath };
    if (stats.kind === "not-found") return { kind: "not-found" };
    return stats;
  }
  async #watchLoop() {
    while (this.#active) {
      const sessionId = this.#sessionId;
      const home = this.#home;
      if (sessionId === void 0 || home === void 0) return;
      const watchPath = this.#resolvedPath ?? statsPathsOf(home).primary;
      const controller = new AbortController();
      this.#watchAbort = controller;
      const stream = this.#remote.$stream({
        name: "token-usage stats",
        open: (signal) => this.#remote.workspaceFiles.changes(sessionId, watchPath, signal),
        ended: () => new Error("stats watch ended")
      });
      const abort = () => {
        void stream.dispose();
      };
      controller.signal.addEventListener("abort", abort, { once: true });
      let failed = false;
      try {
        for await (const item of stream) {
          if (!this.#active || controller.signal.aborted) break;
          item.accept();
          if (item.value.kind === "change") this.#scheduleReload();
        }
      } catch {
        failed = true;
      } finally {
        controller.signal.removeEventListener("abort", abort);
        await stream.dispose().catch(() => {
        });
      }
      if (!this.#active) return;
      await delay(failed ? WATCH_RETRY_MS : WATCH_RECONNECT_MS);
    }
  }
  #scheduleReload() {
    if (this.#reloadTimer !== void 0) return;
    this.#reloadTimer = setTimeout(() => {
      this.#reloadTimer = void 0;
      if (this.#active) void this.#resolveAndRead();
    }, REREAD_DEBOUNCE_MS);
  }
  #publish(state) {
    this.#state = state;
    for (const listener of [...this.#listeners]) listener();
  }
};
function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

// src/client/locales.ts
var zh = {
  "nav": "Token \u7EDF\u8BA1",
  "title": "Token \u7528\u91CF\u7EDF\u8BA1",
  "intro": "\u6309\u300C\u63D0\u4F9B\u5546 \xD7 \u6A21\u578B\u300D\u6C47\u603B\u5168\u90E8\u5386\u53F2\u4F1A\u8BDD\uFF08\u542B\u5DF2\u5F52\u6863\u4F1A\u8BDD\uFF09\u7684 token \u7528\u91CF\u3002\u6570\u5B57\u6765\u81EA\u5BBF\u4E3B\u5BF9\u4F1A\u8BDD\u65E5\u5FD7\u7684\u5B9A\u671F\u626B\u63CF\u3002",
  "totals.input": "\u8F93\u5165",
  "totals.cacheRead": "\u7F13\u5B58\u8BFB",
  "totals.output": "\u8F93\u51FA",
  "totals.reasoning": "\u63A8\u7406\uFF08\u542B\u5728\u8F93\u51FA\u5185\uFF09",
  "totals.billed": "\u5408\u8BA1",
  "totals.calls": "\u8C03\u7528\u6B21\u6570",
  "totals.hit": "\u7F13\u5B58\u547D\u4E2D",
  "model": "\u6A21\u578B",
  "provider": "\u63D0\u4F9B\u5546",
  "models.count": "{count} \u4E2A\u6A21\u578B",
  "sessions": "{count} \u4E2A\u4F1A\u8BDD",
  "archived": "\u542B {count} \u4E2A\u5DF2\u5F52\u6863",
  "scan.duration": "\u626B\u63CF {seconds}",
  "scan.failed": "{count} \u4E2A\u4F1A\u8BDD\u8BFB\u53D6\u5931\u8D25",
  "updated": "\u66F4\u65B0\u4E8E {time}",
  "range.label": "\u65F6\u95F4\u8303\u56F4",
  "range.today": "\u4ECA\u5929",
  "range.3d": "\u8FD1 3 \u5929",
  "range.7d": "\u8FD1 7 \u5929",
  "range.30d": "\u8FD1 30 \u5929",
  "range.all": "\u5168\u90E8",
  "status.emptyRange": "\u300C{range}\u300D\u65F6\u95F4\u8303\u56F4\u5185\u6682\u65E0\u7528\u91CF\u3002",
  "expand.all": "\u5C55\u5F00\u5168\u90E8",
  "collapse.all": "\u5168\u90E8\u6298\u53E0",
  "refresh": "\u5237\u65B0",
  "status.loading": "\u6B63\u5728\u8BFB\u53D6\u7EDF\u8BA1\u2026\u2026",
  "status.scanning": "\u5BBF\u4E3B\u6B63\u5728\u626B\u63CF\u4F1A\u8BDD\u65E5\u5FD7\uFF0C\u7A0D\u540E\u81EA\u52A8\u51FA\u73B0\u2026\u2026",
  "status.empty": "\u8FD8\u6CA1\u6709\u4EFB\u4F55\u7528\u91CF\u8BB0\u5F55\u3002",
  "status.noHome": "\u65E0\u6CD5\u83B7\u53D6\u5BBF\u4E3B\u4E3B\u76EE\u5F55\uFF0C\u7EDF\u8BA1\u6587\u4EF6\u8DEF\u5F84\u672A\u77E5\u3002",
  "status.noSession": "\u6CA1\u6709\u53EF\u7528\u4E8E\u8BFB\u53D6\u7EDF\u8BA1\u6587\u4EF6\u7684\u4F1A\u8BDD\u3002\u5148\u6253\u5F00\u4EFB\u610F\u5BF9\u8BDD\u518D\u56DE\u5230\u672C\u9875\u3002",
  "status.notFound": "\u8FD8\u6CA1\u6709\u7EDF\u8BA1\u6587\u4EF6\u2014\u2014\u63D2\u4EF6\u53EF\u80FD\u5C1A\u672A\u6302\u8F7D\u3002\u5B89\u88C5\u63D2\u4EF6\u540E\u9700\u8981\u91CD\u542F DSH \u624D\u80FD\u751F\u6548\u3002",
  "status.readFailed": "\u8BFB\u53D6\u7EDF\u8BA1\u6587\u4EF6\u5931\u8D25\uFF1A{reason}",
  "status.badData": "\u7EDF\u8BA1\u6587\u4EF6\u5185\u5BB9\u65E0\u6CD5\u89E3\u6790\uFF1A{reason}",
  "status.watchFailed": "\u5B9E\u65F6\u66F4\u65B0\u4E2D\u65AD\uFF0C\u5C06\u5728\u540E\u53F0\u91CD\u8BD5\u3002",
  "provider.total": "\u5C0F\u8BA1",
  "grand.total": "\u5168\u90E8\u5408\u8BA1"
};
var en = {
  "nav": "Token usage",
  "title": "Token usage statistics",
  "intro": "Provider-by-model token totals over every stored session, archived ones included. The numbers come from the host scanning the session logs periodically.",
  "totals.input": "Input",
  "totals.cacheRead": "Cache read",
  "totals.output": "Output",
  "totals.reasoning": "Reasoning (included in output)",
  "totals.billed": "Total",
  "totals.calls": "Calls",
  "totals.hit": "Cache hit",
  "model": "Model",
  "provider": "Provider",
  "models.count": "{count} models",
  "sessions": "{count} sessions",
  "archived": "{count} archived",
  "scan.duration": "scanned in {seconds}",
  "scan.failed": "{count} sessions unreadable",
  "updated": "updated {time}",
  "range.label": "Range",
  "range.today": "Today",
  "range.3d": "Last 3 days",
  "range.7d": "Last 7 days",
  "range.30d": "Last 30 days",
  "range.all": "All time",
  "status.emptyRange": "No usage in the selected range ({range}).",
  "expand.all": "Expand all",
  "collapse.all": "Collapse all",
  "refresh": "Refresh",
  "status.loading": "Loading statistics\u2026",
  "status.scanning": "The host is scanning session logs; this fills in automatically\u2026",
  "status.empty": "No usage recorded yet.",
  "status.noHome": "The host home directory is unavailable, so the stats file path is unknown.",
  "status.noSession": "No session is available to read the stats file through. Open any conversation first, then come back.",
  "status.notFound": "No stats file yet \u2014 the plugin may not be mounted. Installing a plugin takes effect after a DSH restart.",
  "status.readFailed": "Failed to read the stats file: {reason}",
  "status.badData": "The stats file could not be parsed: {reason}",
  "status.watchFailed": "Live updates were interrupted; retrying in the background.",
  "provider.total": "Subtotal",
  "grand.total": "Grand total"
};

// src/client/index.tsx
var NS = "token-usage";
var SECTION_ORDER = 19;
var inject = ["slots", "locale", "remote", "remote.session", "remote.workspaceFiles"];
function apply(ctx) {
  const t = ctx.locale.bind(NS);
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), "dsh-token-usage: dictionaries");
  const source = new StatsSource(ctx.remote);
  ctx.effect(
    () => ctx.slots.inject(
      "settings.section",
      () => ctx.slots.register(
        {
          name: "settings.section",
          id: NS,
          order: SECTION_ORDER,
          label: () => t("nav"),
          locale: NS,
          inject: () => ({
            hooks: { stats: source },
            reload: () => source.reload()
          })
        },
        TokenUsagePage
      )
    ),
    "dsh-token-usage: settings section"
  );
}
return module.exports; } });
//# sourceMappingURL=client.js.map
