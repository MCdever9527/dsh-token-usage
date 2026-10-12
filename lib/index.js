// src/index.ts
import { readFileSync as readFileSync2 } from "node:fs";
import { mkdir as mkdir2, readFile, readdir, rename, stat, writeFile as writeFile2 } from "node:fs/promises";
import { homedir as homedir2 } from "node:os";
import { dirname, join as join3 } from "node:path";

// src/fold.ts
var UNKNOWN_DAY = "unknown";
function routeKeyOf(provider, model) {
  return provider + "\0" + model;
}
function isCount(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
function dayKeyOf(time) {
  if (typeof time !== "number" || !Number.isFinite(time)) return UNKNOWN_DAY;
  const date = new Date(time);
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
function lastStreamUsage(stream) {
  if (!Array.isArray(stream)) return void 0;
  for (let index = stream.length - 1; index >= 0; index -= 1) {
    const entry = stream[index];
    if (entry === null || typeof entry !== "object") continue;
    if (entry.type === "chunk" && entry.chunk !== void 0 && entry.chunk.type === "usage") {
      return entry.chunk.usage;
    }
  }
  return void 0;
}
function usageOf(event) {
  const data = event.data;
  if (typeof data !== "object" || data === null) return void 0;
  if (event.type === "assistant/message" && data.usage !== void 0) return data.usage;
  if (event.type !== "assistant/message" && event.type !== "assistant/attempt") return void 0;
  return lastStreamUsage(data.stream);
}
function messageRouteOf(message) {
  if (typeof message !== "object" || message === null) return void 0;
  const source = message.source;
  if (typeof source !== "object" || source === null) return void 0;
  const { provider, model } = source;
  if (typeof provider !== "string" || provider.length === 0) return void 0;
  if (typeof model !== "string" || model.length === 0) return void 0;
  return { provider, model };
}
function bucketsOf(sample) {
  if (typeof sample !== "object" || sample === null) return void 0;
  const raw = sample;
  if (!isCount(raw.inputTokens) || !isCount(raw.outputTokens)) return void 0;
  const cacheReadTokens = isCount(raw.cacheReadTokens) ? raw.cacheReadTokens : 0;
  const reasoningTokens = isCount(raw.reasoningTokens) && raw.reasoningTokens <= raw.outputTokens ? raw.reasoningTokens : 0;
  return { inputTokens: raw.inputTokens, cacheReadTokens, outputTokens: raw.outputTokens, reasoningTokens };
}
function routeOf(event) {
  const data = event.data;
  if (typeof data !== "object" || data === null) return void 0;
  if (event.type === "model/selection" || event.type === "request/context") {
    if (typeof data.provider === "string" && data.provider.length > 0 && typeof data.model === "string" && data.model.length > 0) {
      return { provider: data.provider, model: data.model };
    }
    return void 0;
  }
  if (event.type === "request/header") {
    const config = data.header?.config;
    if (typeof config !== "object" || config === null) return void 0;
    const { provider, model } = config;
    if (typeof provider === "string" && provider.length > 0 && typeof model === "string" && model.length > 0) {
      return { provider, model };
    }
  }
  return void 0;
}
function addEntry(entries, key, provider, model, day, buckets, sign) {
  const current = entries[key];
  if (current === void 0) {
    if (sign === -1) return;
    entries[key] = {
      provider,
      model,
      inputTokens: buckets.inputTokens,
      cacheReadTokens: buckets.cacheReadTokens,
      outputTokens: buckets.outputTokens,
      reasoningTokens: buckets.reasoningTokens,
      calls: 1,
      days: {
        [day]: {
          inputTokens: buckets.inputTokens,
          cacheReadTokens: buckets.cacheReadTokens,
          outputTokens: buckets.outputTokens,
          reasoningTokens: buckets.reasoningTokens,
          calls: 1
        }
      }
    };
    return;
  }
  current.inputTokens += sign * buckets.inputTokens;
  current.cacheReadTokens += sign * buckets.cacheReadTokens;
  current.outputTokens += sign * buckets.outputTokens;
  current.reasoningTokens += sign * buckets.reasoningTokens;
  current.calls += sign;
  const dayBucket = current.days[day];
  if (dayBucket === void 0) {
    if (sign === 1) {
      current.days[day] = {
        inputTokens: buckets.inputTokens,
        cacheReadTokens: buckets.cacheReadTokens,
        outputTokens: buckets.outputTokens,
        reasoningTokens: buckets.reasoningTokens,
        calls: 1
      };
    }
  } else {
    dayBucket.inputTokens += sign * buckets.inputTokens;
    dayBucket.cacheReadTokens += sign * buckets.cacheReadTokens;
    dayBucket.outputTokens += sign * buckets.outputTokens;
    dayBucket.reasoningTokens += sign * buckets.reasoningTokens;
    dayBucket.calls += sign;
    if (dayBucket.calls <= 0) delete current.days[day];
  }
  if (current.calls <= 0) {
    delete entries[key];
  }
}
function applyFold(state, event) {
  if (event.type === "llm/retry-started") {
    const data = event.data;
    if (state.slot !== null && typeof data === "object" && data !== null && state.slot.turn === data.turn && state.slot.step === data.step) {
      return { ...state, slot: null };
    }
    return state;
  }
  if (event.type === "model/selection" || event.type === "request/context" || event.type === "request/header") {
    const route = routeOf(event);
    if (route === void 0) return state;
    if (state.route !== null && state.route.provider === route.provider && state.route.model === route.model) return state;
    return { ...state, route };
  }
  if (event.type === "compaction/summary") {
    const data = event.data;
    if (typeof data !== "object" || data === null) return state;
    if (typeof data.provider !== "string" || data.provider.length === 0) return state;
    if (typeof data.model !== "string" || data.model.length === 0) return state;
    const buckets = bucketsOf(data.usage);
    if (buckets === void 0) return state;
    const key = routeKeyOf(data.provider, data.model);
    const entries = { ...state.entries };
    addEntry(entries, key, data.provider, data.model, dayKeyOf(event.time), buckets, 1);
    return { ...state, entries };
  }
  if (event.type === "assistant/message" || event.type === "assistant/attempt") {
    const data = event.data;
    if (typeof data !== "object" || data === null) return state;
    const sample = usageOf(event);
    const buckets = bucketsOf(sample);
    if (buckets === void 0) return state;
    const route = event.type === "assistant/message" ? messageRouteOf(data.message) ?? state.route ?? void 0 : state.route ?? void 0;
    const key = route === void 0 ? null : routeKeyOf(route.provider, route.model);
    const day = dayKeyOf(event.time);
    const slot = state.slot;
    const previous = slot !== null && slot.turn === data.turn && slot.step === data.step ? slot : void 0;
    if (previous !== void 0 && previous.key === key && previous.day === day && bucketsEqual(previous.buckets, buckets)) {
      return state;
    }
    const entries = { ...state.entries };
    if (previous !== void 0 && previous.key !== null) {
      const previousEntry = entries[previous.key];
      if (previousEntry !== void 0) {
        addEntry(entries, previous.key, previousEntry.provider, previousEntry.model, previous.day, previous.buckets, -1);
      }
    }
    if (key !== null && route !== void 0) {
      addEntry(entries, key, route.provider, route.model, day, buckets, 1);
    }
    return { ...state, entries, slot: { turn: data.turn, step: data.step, key, day, buckets } };
  }
  return state;
}
function bucketsEqual(a, b) {
  return a.inputTokens === b.inputTokens && a.cacheReadTokens === b.cacheReadTokens && a.outputTokens === b.outputTokens && a.reasoningTokens === b.reasoningTokens;
}
function initFold() {
  return { entries: {}, route: null, slot: null };
}
function foldEvents(events) {
  let state = initFold();
  for (const event of events) state = applyFold(state, event);
  return state;
}
function foldRows(state) {
  const rows = Object.values(state.entries);
  rows.sort((a, b) => a.provider === b.provider ? a.model < b.model ? -1 : 1 : a.provider < b.provider ? -1 : 1);
  return rows;
}

// src/log-file.ts
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { zstdDecompressSync } from "node:zlib";
var ZSTD_MAGIC = 4247762216;
var ZSTD_SKIPPABLE_MASK = 4294967280;
var ZSTD_SKIPPABLE_BASE = 407710288;
var LOG_FILENAME = /^session(\.v\d+)?\.jsonl(\.zstd)?$/;
function readUint24(buffer, offset) {
  return buffer[offset] | buffer[offset + 1] << 8 | buffer[offset + 2] << 16;
}
function frameSpans(buffer) {
  const spans = [];
  let offset = 0;
  while (offset + 4 <= buffer.length) {
    const magic = buffer.readUInt32LE(offset);
    if ((magic & ZSTD_SKIPPABLE_MASK) >>> 0 === ZSTD_SKIPPABLE_BASE) {
      if (offset + 8 > buffer.length) break;
      const payload = buffer.readUInt32LE(offset + 4);
      spans.push({ offset, size: 8 + payload, skippable: true });
      offset += 8 + payload;
      continue;
    }
    if (magic !== ZSTD_MAGIC) break;
    const descriptor = buffer[offset + 4];
    const contentSizeFlag = descriptor >> 6 & 3;
    const singleSegment = descriptor >> 5 & 1;
    const hasChecksum = descriptor >> 2 & 1;
    const dictionaryIdFlag = descriptor & 3;
    let contentSizeBytes;
    if (contentSizeFlag === 0) contentSizeBytes = singleSegment === 1 ? 1 : 0;
    else if (contentSizeFlag === 1) contentSizeBytes = 2;
    else if (contentSizeFlag === 2) contentSizeBytes = 4;
    else contentSizeBytes = 8;
    const dictionarySizeBytes = [0, 1, 2, 4][dictionaryIdFlag];
    let headerSize = 1;
    if (singleSegment === 0) headerSize += 1;
    headerSize += dictionarySizeBytes + contentSizeBytes;
    let cursor = offset + 4 + headerSize;
    let complete = false;
    while (cursor + 3 <= buffer.length) {
      const blockHeader = readUint24(buffer, cursor);
      const isLast = blockHeader & 1;
      const blockType = blockHeader >> 1 & 3;
      const blockSize = blockHeader >> 3;
      cursor += 3;
      if (blockType === 3) break;
      if (blockType === 1) cursor += 1;
      else cursor += blockSize;
      if (isLast === 1) {
        complete = true;
        break;
      }
    }
    if (!complete) break;
    if (hasChecksum === 1) cursor += 4;
    const size = cursor - offset;
    if (size <= 0 || offset + size > buffer.length) break;
    spans.push({ offset, size, skippable: false });
    offset += size;
  }
  return spans;
}
function decodeArtifact(buffer) {
  const lines = [];
  let unreadable = 0;
  const spans = frameSpans(buffer);
  for (const span of spans) {
    if (span.skippable) continue;
    let text;
    try {
      text = zstdDecompressSync(buffer.subarray(span.offset, span.offset + span.size)).toString("utf8");
    } catch {
      unreadable += 1;
      continue;
    }
    for (const line of text.split("\n")) if (line.trim().length > 0) lines.push(line);
  }
  return { lines, frames: spans.length, unreadable };
}
function newestLogFile(directory) {
  let newest;
  let newestName = "";
  for (const name2 of readdirSync(directory)) {
    if (!LOG_FILENAME.test(name2)) continue;
    if (name2 <= newestName) continue;
    const candidate = join(directory, name2);
    try {
      if (!statSync(candidate).isFile()) continue;
    } catch {
      continue;
    }
    newest = candidate;
    newestName = name2;
  }
  return newest;
}
function readSessionLogFile(sessionsRoot, sessionId) {
  for (const project of readdirSync(sessionsRoot)) {
    const directory = join(sessionsRoot, project, sessionId);
    let isDirectory = false;
    try {
      isDirectory = statSync(directory).isDirectory();
    } catch {
      continue;
    }
    if (!isDirectory) continue;
    const file = newestLogFile(directory);
    if (file === void 0) continue;
    const buffer = readFileSync(file);
    const raw = buffer.subarray(0, 4);
    const compressed = raw.length === 4 && raw.readUInt32LE(0) === ZSTD_MAGIC;
    const { lines, frames, unreadable } = compressed ? decodeArtifact(buffer) : { lines: buffer.toString("utf8").split("\n").filter((line) => line.trim().length > 0), frames: 1, unreadable: 0 };
    const events = [];
    for (const line of lines) {
      try {
        events.push(JSON.parse(line));
      } catch {
      }
    }
    return { events, frames, unreadable };
  }
  throw new Error(`no log file for session "${sessionId}" under ${sessionsRoot}`);
}

// src/status.ts
import { mkdir, writeFile, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join as join2 } from "node:path";
var STATUS_DIR = ["cache", "dsh-token-usage"];
function resolveDshHome() {
  const fromEnv = process.env.DSH_HOME;
  if (typeof fromEnv === "string" && fromEnv.length > 0) return fromEnv;
  return join2(homedir(), ".dsh");
}
function versionOf(read) {
  try {
    return String(JSON.parse(read()).version ?? "unknown");
  } catch {
    return "unknown";
  }
}
var StatusWriter = class {
  #path;
  #base;
  #sweep;
  #error;
  #pending;
  constructor(base) {
    this.#base = base;
    this.#path = join2(base.dshHome, ...STATUS_DIR, "stats-status.json");
  }
  /** Snapshot the report as it stands. */
  report() {
    return {
      ...this.#base,
      ...this.#sweep === void 0 ? {} : { lastSweep: this.#sweep },
      ...this.#error === void 0 ? {} : { error: this.#error }
    };
  }
  /** Replace the sweep summary and flush. */
  sweep(summary) {
    this.#sweep = summary;
    this.#error = void 0;
    this.flush();
  }
  /** Record the failure of the latest sweep and flush. */
  failed(reason) {
    this.#error = reason;
    this.flush();
  }
  /** Write the report once, coalescing concurrent callers. */
  flush() {
    if (this.#pending !== void 0) return;
    this.#pending = this.#write().finally(() => {
      this.#pending = void 0;
    });
  }
  /** Await the in-flight write, if any. */
  settle() {
    return this.#pending ?? Promise.resolve();
  }
  async #write() {
    try {
      await mkdir(join2(this.#base.dshHome, ...STATUS_DIR), { recursive: true });
      await writeFile(this.#path, `${JSON.stringify(this.report(), null, 2)}
`, "utf8");
    } catch {
    }
  }
};

// src/index.ts
var name = "token-usage";
var CACHE_DIR = ["cache", "dsh-token-usage"];
var PROVIDER_NAMESPACE = "llm-pi-ai";
var SESSIONS_BACKEND = "@deepseek-ai/dsh-session-persistence-jsonl";
var FAILURE_SAMPLES = 8;
function readConfig(config) {
  const record = config === null || typeof config !== "object" ? {} : config;
  const enabled = record.enabled !== false;
  const rawPoll = record.pollSeconds;
  const pollSeconds = typeof rawPoll === "number" && Number.isFinite(rawPoll) && rawPoll >= 5 ? Math.floor(rawPoll) : 30;
  return { enabled, pollSeconds };
}
function readVersion() {
  return versionOf(() => readFileSync2(new URL("../package.json", import.meta.url), "utf8"));
}
function readDisplayNames(settings) {
  const names = /* @__PURE__ */ new Map();
  if (settings === void 0 || typeof settings.describe !== "function") return names;
  try {
    const descriptor = settings.describe().find((view) => view?.ns === PROVIDER_NAMESPACE);
    const value = descriptor?.value;
    if (value === null || typeof value !== "object") return names;
    const providers = value.providers;
    if (providers === null || typeof providers !== "object") return names;
    for (const [id, entry] of Object.entries(providers)) {
      if (entry === null || typeof entry !== "object") continue;
      const displayName = entry.displayName;
      if (typeof displayName === "string" && displayName.length > 0) names.set(id, displayName);
    }
  } catch {
  }
  return names;
}
function resolveSessionsRoot(loader, dshHome) {
  try {
    for (const entry of loader?.entries() ?? []) {
      if (entry?.options?.name !== SESSIONS_BACKEND) continue;
      const config = entry.options.config;
      if (config === null || typeof config !== "object") continue;
      const root = config.root;
      if (typeof root === "string" && root.length > 0) return root;
    }
  } catch {
  }
  return join3(dshHome, "sessions");
}
async function countArchived(dshHome, storedIds) {
  try {
    const raw = await readFile(join3(dshHome, "storages", "workspace.json"), "utf8");
    const parsed = JSON.parse(raw);
    const ids = parsed?.global?.archivedSessionIds;
    if (!Array.isArray(ids)) return 0;
    let count = 0;
    for (const id of ids) if (typeof id === "string" && storedIds.has(id)) count += 1;
    return count;
  } catch {
    return 0;
  }
}
function totalsOf(rows) {
  let inputTokens = 0;
  let cacheReadTokens = 0;
  let outputTokens = 0;
  let reasoningTokens = 0;
  let calls = 0;
  for (const row of rows) {
    inputTokens += row.inputTokens;
    cacheReadTokens += row.cacheReadTokens;
    outputTokens += row.outputTokens;
    reasoningTokens += row.reasoningTokens;
    calls += row.calls;
  }
  return {
    inputTokens,
    cacheReadTokens,
    outputTokens,
    reasoningTokens,
    billedTokens: inputTokens + cacheReadTokens + outputTokens,
    calls
  };
}
function buildSnapshot(sessions, displayNames) {
  const byKey = /* @__PURE__ */ new Map();
  for (const session of sessions) {
    for (const row of session.rows) {
      const key = row.provider + "\0" + row.model;
      const current = byKey.get(key);
      if (current === void 0) {
        byKey.set(key, row);
        continue;
      }
      const days = { ...current.days };
      for (const [day, buckets] of Object.entries(row.days)) {
        const existing = days[day];
        days[day] = existing === void 0 ? { ...buckets } : {
          inputTokens: existing.inputTokens + buckets.inputTokens,
          cacheReadTokens: existing.cacheReadTokens + buckets.cacheReadTokens,
          outputTokens: existing.outputTokens + buckets.outputTokens,
          reasoningTokens: existing.reasoningTokens + buckets.reasoningTokens,
          calls: existing.calls + buckets.calls
        };
      }
      byKey.set(key, {
        provider: row.provider,
        model: row.model,
        inputTokens: current.inputTokens + row.inputTokens,
        cacheReadTokens: current.cacheReadTokens + row.cacheReadTokens,
        outputTokens: current.outputTokens + row.outputTokens,
        reasoningTokens: current.reasoningTokens + row.reasoningTokens,
        calls: current.calls + row.calls,
        days
      });
    }
  }
  const rows = [...byKey.values()].sort(
    (a, b) => a.provider === b.provider ? a.model < b.model ? -1 : 1 : a.provider < b.provider ? -1 : 1
  );
  const providers = [];
  for (const row of rows) {
    const last = providers[providers.length - 1];
    if (last === void 0 || last.id !== row.provider) {
      providers.push({
        id: row.provider,
        displayName: displayNames.get(row.provider) ?? row.provider,
        totals: totalsOf([row]),
        models: [withId(row)]
      });
      continue;
    }
    const models = [...last.models, withId(row)];
    providers[providers.length - 1] = { ...last, models, totals: totalsOf(models) };
  }
  return { totals: totalsOf(rows), providers };
}
function withId(row) {
  return { id: row.model, ...totalsOf([row]), days: row.days };
}
async function listSessionDirectories(sessionsRoot) {
  const ids = [];
  let projects;
  try {
    projects = await readdir(sessionsRoot);
  } catch {
    return ids;
  }
  for (const project of projects) {
    const projectPath = join3(sessionsRoot, project);
    let entries;
    try {
      entries = await readdir(projectPath);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const directory = join3(projectPath, entry);
      try {
        const info = await stat(directory);
        if (!info.isDirectory()) continue;
      } catch {
        continue;
      }
      if (newestLogFile(directory) === void 0) continue;
      ids.push(entry);
    }
  }
  return ids;
}
async function fileRevision(sessionsRoot, sessionId) {
  let projects;
  try {
    projects = await readdir(sessionsRoot);
  } catch {
    return void 0;
  }
  for (const project of projects) {
    const directory = join3(sessionsRoot, project, sessionId);
    let file;
    try {
      file = newestLogFile(directory);
    } catch {
      continue;
    }
    if (file === void 0) continue;
    try {
      const info = await stat(file);
      return `file:${info.size}:${Math.trunc(info.mtimeMs)}`;
    } catch {
      return void 0;
    }
  }
  return void 0;
}
async function writeJsonAtomic(path, value) {
  await mkdir2(dirname(path), { recursive: true });
  const body = JSON.stringify(value) + "\n";
  const tmp = path + ".tmp";
  try {
    await writeFile2(tmp, body, "utf8");
    await rename(tmp, path);
  } catch {
    await writeFile2(path, body, "utf8");
  }
}
function writeStats(path, snapshot) {
  return writeJsonAtomic(path, snapshot);
}
function anchorPathOf(userHome) {
  return join3(userHome, ".dsh", ...CACHE_DIR, "anchor.json");
}
async function writeAnchor(userHome, statsPath) {
  try {
    await writeJsonAtomic(anchorPathOf(userHome), { version: 1, statsPath, updatedAt: (/* @__PURE__ */ new Date()).toISOString() });
  } catch {
  }
}
async function foldSession(persistence, sessionsRoot, sessionId) {
  let seamFailure;
  if (persistence !== void 0 && typeof persistence.open === "function") {
    try {
      const handle = await persistence.open(sessionId, "read");
      try {
        const read = await handle.read(0, void 0);
        return { rows: foldRows(foldEvents(read.events)), fallback: false };
      } finally {
        await handle.close();
      }
    } catch (error) {
      seamFailure = error;
    }
  }
  try {
    const { events } = readSessionLogFile(sessionsRoot, sessionId);
    return { rows: foldRows(foldEvents(events)), fallback: true };
  } catch (error) {
    throw new Error(
      seamFailure === void 0 ? `artifact read failed: ${String(error)}` : `seam read failed: ${String(seamFailure)}; artifact read failed: ${String(error)}`
    );
  }
}
function apply(ctx, config) {
  const { enabled, pollSeconds } = readConfig(config);
  const dshHome = resolveDshHome();
  const statsPath = join3(dshHome, ...CACHE_DIR, "stats.json");
  const status = new StatusWriter({
    plugin: "dsh-token-usage",
    version: readVersion(),
    activatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    pid: process.pid,
    dshHome,
    statsPath,
    enabled,
    pollSeconds
  });
  status.flush();
  if (!enabled) {
    ctx.logger?.warn("dsh-token-usage: mounted with enabled off; nothing is scanned or published");
    return;
  }
  ctx.effect(() => {
    let stopped = false;
    let running = false;
    const sessions = /* @__PURE__ */ new Map();
    let published = false;
    const sweep = async () => {
      if (running || stopped) return;
      running = true;
      const startedAt = /* @__PURE__ */ new Date();
      const start = Date.now();
      try {
        await (ctx.root?.loader?.await?.() ?? Promise.resolve());
        if (stopped) return;
        const persistence = ctx.get("sessionPersistence");
        const loader = ctx.get("loader");
        const sessionsRoot = resolveSessionsRoot(loader, dshHome);
        const listed = persistence !== void 0 && typeof persistence.list === "function" ? await persistence.list().catch(() => []) : [];
        const revisions = /* @__PURE__ */ new Map();
        for (const entry of listed) {
          if (typeof entry?.header?.id === "string") revisions.set(entry.header.id, `seam:${String(entry.revision)}`);
        }
        const ids = new Set(revisions.keys());
        for (const id of await listSessionDirectories(sessionsRoot)) ids.add(id);
        for (const id of [...sessions.keys()]) if (!ids.has(id)) sessions.delete(id);
        let folded = 0;
        let skipped = 0;
        let failed = 0;
        let fallback = 0;
        const failures = [];
        for (const id of ids) {
          if (stopped) return;
          let revision = revisions.get(id);
          if (revision === void 0) revision = await fileRevision(sessionsRoot, id);
          if (revision === void 0) revision = "unknown";
          const known = sessions.get(id);
          if (known !== void 0 && known.revision === revision) {
            skipped += 1;
            continue;
          }
          try {
            const result = await foldSession(persistence, sessionsRoot, id);
            if (result.fallback) fallback += 1;
            sessions.set(id, { revision, rows: result.rows });
            folded += 1;
          } catch (error) {
            failed += 1;
            if (failures.length < FAILURE_SAMPLES) failures.push(`${id}: ${String(error)}`);
            ctx.logger?.warn(`dsh-token-usage: folding session "${id}" failed: ${String(error)}`);
          }
        }
        const settings = ctx.get("settings");
        const displayNames = readDisplayNames(settings);
        const aggregate = buildSnapshot(sessions.values(), displayNames);
        const archivedCount = await countArchived(dshHome, ids);
        const durationMs = Date.now() - start;
        published = true;
        await writeStats(statsPath, {
          version: 1,
          generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
          scan: {
            status: "ready",
            storedSessions: ids.size,
            foldedSessions: folded,
            skippedSessions: skipped,
            failedSessions: failed,
            fallbackSessions: fallback,
            archivedCount,
            durationMs
          },
          totals: aggregate.totals,
          providers: aggregate.providers
        });
        await writeAnchor(homedir2(), statsPath);
        status.sweep({
          startedAt: startedAt.toISOString(),
          finishedAt: (/* @__PURE__ */ new Date()).toISOString(),
          durationMs,
          storedSessions: ids.size,
          foldedSessions: folded,
          skippedSessions: skipped,
          failedSessions: failed,
          fallbackSessions: fallback,
          archivedCount,
          failures
        });
      } catch (error) {
        status.failed(`sweep failed: ${String(error)}`);
        ctx.logger?.warn(`dsh-token-usage: sweep failed: ${String(error)}`);
        if (!published) {
          await writeStats(statsPath, {
            version: 1,
            generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
            scan: { status: "scanning" }
          }).catch(() => {
          });
        }
      } finally {
        running = false;
      }
    };
    void writeStats(statsPath, { version: 1, generatedAt: (/* @__PURE__ */ new Date()).toISOString(), scan: { status: "scanning" } }).catch(() => {
    }).then(() => sweep());
    const interval = setInterval(() => {
      if (!running) void sweep();
    }, pollSeconds * 1e3);
    return () => {
      stopped = true;
      clearInterval(interval);
    };
  }, "dsh-token-usage: corpus scanner");
}
export {
  CACHE_DIR,
  anchorPathOf,
  apply,
  buildSnapshot,
  decodeArtifact,
  foldEvents,
  foldRows,
  frameSpans,
  name,
  newestLogFile,
  readConfig,
  readSessionLogFile,
  resolveSessionsRoot
};
//# sourceMappingURL=index.js.map
