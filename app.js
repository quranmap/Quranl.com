// app.js (ES Module)
import { loadQuranData, getAyah, getSuraMeta, getSuraRefs, getWords } from "./data.js";
import {
  initStylePicker, applyStyleThemeById, loadStyleThemeId, saveStyleThemeId, STYLE_THEMES,
  initSurfacePicker, applySurfaceThemeById, loadSurfaceThemeId, saveSurfaceThemeId
} from "./styles.js";

function getAllRefs() {
  const out = [];
  for (let s = 1; s <= 114; s++) {
    const refs = getSuraRefs(s) || [];
    for (const r of refs) out.push(r);
  }
  return out;
}

let suppressHashRender = false;
// ✅ Whole Quran standardmäßig NICHT rendern (Performance!)
window.__renderAllQuran = false;

/* ============================================================================
   DEBUG (per URL)
   - ?debug=1            -> alles an
   - ?debug=layout,data  -> nur bestimmte Bereiche
   - optional: ?debug=1&forcePhone=1
============================================================================ */

function parseDebug() {
  const raw = new URLSearchParams(location.search).get("debug");
  if (!raw) return { enabled: false, tags: new Set() };

  const v = String(raw).trim().toLowerCase();
  if (v === "1" || v === "true" || v === "all") return { enabled: true, tags: new Set(["all"]) };

  const tags = new Set(
    v
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  );
  return { enabled: true, tags };
}

const DBG = parseDebug();
const debugOn = (tag) =>
  DBG.enabled && (DBG.tags.has("all") || DBG.tags.size === 0 || DBG.tags.has(tag));

const dlog = (tag, ...args) => debugOn(tag) && console.log(`[${tag}]`, ...args);
const dgroup = (tag, title) => debugOn(tag) && console.groupCollapsed(`[${tag}] ${title}`);
const dgroupEnd = (tag) => debugOn(tag) && console.groupEnd();

function dumpLayoutVars() {
  const cs = getComputedStyle(document.documentElement);
  const vars = {
    "--vw": cs.getPropertyValue("--vw").trim(),
    "--vh": cs.getPropertyValue("--vh").trim(),
    "--stage-w": cs.getPropertyValue("--stage-w").trim(),
    "--stage-h": cs.getPropertyValue("--stage-h").trim(),
    "--bar-lr": cs.getPropertyValue("--bar-lr").trim(),
    "--bar-bottom": cs.getPropertyValue("--bar-bottom").trim(),
    rotatePhone: document.documentElement.classList.contains("rotate-phone"),
    href: location.href,
  };
  dlog("layout", "CSS vars snapshot:", vars);
  return vars;
}

function domReady() {
  return new Promise((resolve) => {
    if (document.readyState !== "loading") return resolve();
    document.addEventListener("DOMContentLoaded", resolve, { once: true });
  });
}

// =========================
// Render Scheduler (Idle-first)
// =========================
const _ric =
  window.requestIdleCallback ||
  function (cb) {
    return setTimeout(() => cb({ timeRemaining: () => 0, didTimeout: true }), 16);
  };

const _cic =
  window.cancelIdleCallback ||
  function (id) {
    clearTimeout(id);
  };

function scheduleRender(fn, { timeout = 120 } = {}) {
  return _ric(() => fn(), { timeout });
}

function cancelScheduledRender(id) {
  if (id == null) return;
  _cic(id);
}

/* ============================================================================
   PHONE DETECTION + ROTATION (läuft sofort, ohne auf Daten zu warten)
============================================================================ */

function isPhoneDevice() {
  const ua = navigator.userAgent || "";
  const uaMobile = /Mobi|Android|iPhone|iPod/i.test(ua);
  const uaIpad = /iPad/i.test(ua);

  const mobileHint =
    (navigator.userAgentData && navigator.userAgentData.mobile) === true;

  let coarse = false;
  try {
    coarse = matchMedia("(pointer: coarse)").matches;
  } catch {
    coarse = false;
  }

  const touch = (navigator.maxTouchPoints || 0) > 0;

  // "Phone": mobile UA OR (coarse + touch), but exclude iPad explicitly
  const maybePhone = (uaMobile || mobileHint || (coarse && touch)) && !uaIpad;
  return !!maybePhone;
}

function recalc() {
  const rotated = document.documentElement.classList.contains("rotate-phone");

  const vw = rotated ? window.innerHeight : window.innerWidth;
  const vh = rotated ? window.innerWidth : window.innerHeight;

  // ✅ 16:9 Stage (wie bisher)
  const stageW = Math.min(vw, vh * (16 / 9));
  const stageH = stageW * (9 / 16);

  // ✅ links/rechts: maximal möglich
  const barLR = Math.max(0, (vw - stageW) / 2);

  // ✅ Stage View Height: darf über 16:9 wachsen, aber nur begrenzt
  // (damit bei hohen Fenstern mehr Inhalt sichtbar wird, ohne Skalierung zu ändern)
  const extraV = Math.max(0, vh - stageH);
  const maxExtra = stageH * 0.35;              // feinjustieren: 0.20 .. 0.45
  const stageVH = stageH + Math.min(extraV, maxExtra);

  // ✅ Bottom-Bar bleibt dünn, aber wieder sichtbar
  const maxBottom = stageH * 0.012;            // feinjustieren: 0.005 .. 0.020
  const barBottom = maxBottom;

  const root = document.documentElement.style;
  root.setProperty("--vw", vw + "px");
  root.setProperty("--vh", vh + "px");
  root.setProperty("--stage-w", stageW + "px");
  root.setProperty("--stage-h", stageH + "px");
  root.setProperty("--stage-vh", stageVH + "px");   // ✅ NEU
  root.setProperty("--bar-lr", barLR + "px");
  root.setProperty("--bar-bottom", barBottom + "px");

  // ✅ frame-top nicht mehr benutzt
  root.setProperty("--frame-top", "0px");

  if (debugOn("layout")) {
    dgroup("layout", "recalc()");
    dlog("layout", { rotated, vw, vh, stageW, stageH, barLR, barBottom, frameTop: 0 });
    dumpLayoutVars();
    dgroupEnd("layout");
  }
}
// Preview-Simulator: ?forcePhone=1 erzwingt Phone-Rotation
const forcePhone = new URLSearchParams(location.search).get("forcePhone") === "1";

if (forcePhone || isPhoneDevice()) {
  document.documentElement.classList.add("rotate-phone");
  dlog("layout", "rotate-phone enabled", { forcePhone });
} else {
  dlog("layout", "rotate-phone disabled", { forcePhone });
}

recalc();

/* ✅ ROOT FIX: Theme sofort anwenden (vor domReady / vor dem ersten “echten” Paint)
   - verhindert “Statusbar ohne Style -> Welcome -> Style” Flash
   - ✅ Fix: echte Defaults (Style + Surface) passend zu den richtigen Listen
*/
const DEFAULT_STYLE_ID   = "style-082"; // Blue Slate 082 (STYLE_THEMES)  :contentReference[oaicite:5]{index=5}
const DEFAULT_SURFACE_ID = "style-070"; // Blue/Grey 070 (SURFACE_THEMES_200) :contentReference[oaicite:6]{index=6}

try{
  const saved = loadStyleThemeId();

  // wenn leer -> Default speichern (damit Picker nicht auf [0] fällt)
  if (!saved && DEFAULT_STYLE_ID) {
    try { saveStyleThemeId(DEFAULT_STYLE_ID); } catch {}
  }

  applyStyleThemeById(saved || DEFAULT_STYLE_ID);
}catch(e){
  console.warn("[style] early apply failed:", e);
}

try{
  const savedSurf = loadSurfaceThemeId();

  // wenn leer -> Default speichern (damit Surface-Picker nicht auf sorted[0] fällt)
  if (!savedSurf && DEFAULT_SURFACE_ID) {
    try { saveSurfaceThemeId(DEFAULT_SURFACE_ID); } catch {}
  }

  applySurfaceThemeById(savedSurf || DEFAULT_SURFACE_ID);
}catch(e){
  console.warn("[surface] early apply failed:", e);
}
window.addEventListener("resize", recalc);
window.addEventListener("orientationchange", recalc);

// Run after initial layout (hilft bei manchen Browsern/Rotation)
requestAnimationFrame(() => {
  recalc();
  requestAnimationFrame(recalc);
});

/* ============================================================================
   DATA LOAD (parallel, blockiert Layout nicht)
============================================================================ */

let dataReady = false;

const dataPromise = loadQuranData()
  .then(() => {
    dataReady = true;
  })
  .catch((err) => {
    console.error("[data] loadQuranData failed:", err);
    try {
      const el = document.getElementById("stage") || document.body;
      const box = document.createElement("div");
      box.style.cssText =
        "position:fixed;inset:12px;z-index:9999;padding:12px;border:1px solid #f00;background:#200;color:#fff;font:14px/1.4 system-ui;";
      box.textContent = `Fehler beim Laden der Quran-Daten: ${err?.message || err}`;
      el.appendChild(box);
    } catch {}
    throw err;
  });

  /* ============================================================================
   TRANSLATIONS (Ayah-Mode only)
   - index: translations_index.json
   - files: translate/FINAL/<Language>/<Name>.json
   - fallback: tries local ./<basename>.json if path fails (dev)
   ============================================================================ */

// ✅ R2 Custom Domain (Audio Bucket) – muss VOR den Translation-Konstanten existieren
const AUDIO_BASE_URL = "https://audio.quranm.com";

// ✅ Translations liegen jetzt in R2 unter https://audio.quranm.com/translate/FINAL/...
const TRANSLATIONS_ROOT = `${AUDIO_BASE_URL}/translate/FINAL`;
const TRANSLATIONS_INDEX_URL = `${TRANSLATIONS_ROOT}/translations_index.json`;
const MAX_ACTIVE_TRANSLATIONS = 10;

let translationsIndex = null;               // geladenes index json
const translationCache = new Map();         // file -> json
let activeTranslations = [];                // [{ language, label, file }]

const LS_ACTIVE_TRANSLATIONS = "quranm_active_translations_v1";

function saveActiveTranslationFiles(files) {
  try {
    const arr = (files || []).map(String);
    localStorage.setItem(LS_ACTIVE_TRANSLATIONS, JSON.stringify(arr));
  } catch {}
}

function loadActiveTranslationFiles() {
  try {
    const raw = localStorage.getItem(LS_ACTIVE_TRANSLATIONS);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.map(String);
  } catch {
    return [];
  }
}

// Default: 1 Übersetzung aktiv (später per UI änderbar)
const DEFAULT_ACTIVE_TRANSLATION_FILES = [
  "English/Saheeh International.json"
];

function _basename(path) {
  const s = String(path || "");
  const i = s.lastIndexOf("/");
  return i >= 0 ? s.slice(i + 1) : s;
}

function translationUrlFor(file) {
  // file ist z.B. "English/Saheeh International.json"
  return `${TRANSLATIONS_ROOT}/${file}`;
}

async function fetchJsonWithFallbacks(urlCandidates) {
  let lastErr = null;
  for (const url of urlCandidates) {
    try {
      const res = await fetch(url, { cache: "force-cache" });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return await res.json();
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("fetchJsonWithFallbacks failed");
}

async function ensureTranslationsIndex() {
  if (translationsIndex) return translationsIndex;

  try {
    // 1) normal
    // 2) fallback: "./translations_index.json"
    translationsIndex = await fetchJsonWithFallbacks([
      TRANSLATIONS_INDEX_URL,
      `./${TRANSLATIONS_INDEX_URL}`
    ]);
  } catch (e) {
    // ✅ Wichtig: Index ist OPTIONAL – App darf niemals deswegen crashen
    console.warn(
      "[tr] translations_index.json konnte nicht geladen werden (OK für dev).",
      e
    );
    translationsIndex = { root: "", languages: [] };
  }

  return translationsIndex;
}

function findIndexItemByFile(file) {
  const idx = translationsIndex;
  if (!idx || !Array.isArray(idx.languages)) return null;

  for (const lang of idx.languages) {
    const items = lang?.items || [];
    for (const it of items) {
      if (it?.file === file) {
        return { language: lang.language, label: it.label, file: it.file };
      }
    }
  }
  return null;
}

async function loadTranslationFile(file) {
  if (translationCache.has(file)) return translationCache.get(file);

  const urlMain = translationUrlFor(file);        // jetzt absolute URL (R2)
  const base = _basename(file);

  // Kandidaten: zuerst R2, dann (optional) lokale dev-fallbacks
  const candidates = [urlMain];

  // Falls jemand lokal noch Dateien hat, versuchen wir die auch:
  // (wichtig: NICHT "./" vor eine https URL hängen)
  const urlRel = `translate/FINAL/${file}`;
  candidates.push(
    urlRel,               // translate/FINAL/English/Name.json
    `./${urlRel}`,        // ./translate/FINAL/English/Name.json
    `./${file}`,          // ./English/Name.json (manchmal so in dev)
    `./${base}`           // ./Name.json (wie bei deinem Upload)
  );

  const json = await fetchJsonWithFallbacks(candidates);

  translationCache.set(file, json);
  return json;
}

function stripHtmlToText(html) {
  // Sup-Footnotes usw. entfernen + HTML sauber zu Text
  const el = document.createElement("div");
  el.innerHTML = String(html || "")
    .replace(/<sup\b[^>]*>.*?<\/sup>/gi, ""); // <sup ...>..</sup> kill
  return (el.textContent || "").trim();
}

function getTranslationTextFromJson(tJson, surah, ayah) {
  // Format wie in Saheeh: chapters["2"][12].text (0-index für ayah)
  try {
    const ch = tJson?.chapters?.[String(surah)];
    if (!Array.isArray(ch)) return "";
    const row = ch[Number(ayah) - 1];
    const raw = row?.text ?? "";
    return stripHtmlToText(raw);
  } catch {
    return "";
  }
}

async function initTranslations() {
  await ensureTranslationsIndex();

  // 1) persisted files (wenn vorhanden)
  const persisted = loadActiveTranslationFiles().slice(0, MAX_ACTIVE_TRANSLATIONS);

  let filesToUse = [];
  if (persisted.length) {
    filesToUse = persisted;
  } else {
    filesToUse = DEFAULT_ACTIVE_TRANSLATION_FILES.slice(0, MAX_ACTIVE_TRANSLATIONS);
  }

  activeTranslations = filesToUse
    .map((file) => findIndexItemByFile(file) || { language: "", label: _basename(file).replace(/\.json$/i,""), file })
    .filter(Boolean);

  // falls persisted tot ist: neu speichern
  saveActiveTranslationFiles(activeTranslations.map(t => t.file));

  // Warm cache
  await Promise.all(activeTranslations.map((t) => loadTranslationFile(t.file).catch(() => null)));

  // ✅ Wenn UI schon existiert: Dropdown neu aufbauen/label refresh
  try { window.__initTranslationsDropdown?.(); } catch {}
}

function buildAyahTranslationsHtml(a, escFn) {
  // escFn ist deine bestehende esc()-Funktion aus renderAyahWords
  const lines = [];

  // 1) vorhandenes Deutsch aus Quran-Dataset (falls da)
  if (a?.textDe) {
    lines.push(
      `<div class="trLine"><span class="trLabel">Deutsch</span><span class="trText" lang="de">${escFn(a.textDe)}</span></div>`
    );
  }

  // 2) aktive JSON-Übersetzungen (geladen/Cache)
  for (const t of activeTranslations) {
    const tJson = translationCache.get(t.file);
    if (!tJson) continue;

    const txt = getTranslationTextFromJson(tJson, a.surah, a.ayah);
    if (!txt) continue;

    const label = t.language ? `${escFn(t.language)} — ${escFn(t.label)}` : escFn(t.label);
    lines.push(
      `<div class="trLine"><span class="trLabel">${label}</span><span class="trText" lang="en">${escFn(txt)}</span></div>`
    );
  }

  if (!lines.length) return "";
  return `<div class="ayahTrans ayahTransList">${lines.join("")}</div>`;
}

function buildBasmTranslationsHtml(escFn) {
  const lines = [];

  // Wir nehmen 1:1 als "Basmallah-Übersetzung" (funktioniert bei sehr vielen Translations)
  for (const t of activeTranslations) {
    const tJson = translationCache.get(t.file);
    if (!tJson) continue;

    const txt = getTranslationTextFromJson(tJson, 1, 1);
    if (!txt) continue;

    const label = t.language ? `${escFn(t.language)} — ${escFn(t.label)}` : escFn(t.label);
    lines.push(
      `<div class="trLine"><span class="trLabel">${label}</span><span class="trText" lang="en">${escFn(txt)}</span></div>`
    );
  }

  if (!lines.length) return "";
  return `<div class="ayahTrans ayahTransList">${lines.join("")}</div>`;
}

/* ============================================================================
   QURAN TRAINER – echte Stage-Session + gemischte Wiederholung schwacher Ayahs
   - 1 = bad, 2 = mid, 3 = good
   - Ayah-Mode bleibt Single-Card
   - schlechte/mittlere Ayahs kommen kontrolliert wieder rein,
     ohne dass die Stage nur noch dieselben Ayahs wiederholt
============================================================================ */

const LS_TRAINER_AYAH_RATINGS = "quranm_reader_trainer_ayah_ratings_v1";
const LS_READER_REPEAT_TARGET = "quranm_reader_repeat_target_v1";
const LS_TRAINER_REVIEW_MODE = "quranm_reader_review_mode_v1";

/* ✅ WICHTIG:
   Diese Stage-Helfer müssen auf Top-Level existieren,
   weil der Trainer sie schon VOR initDemoUI benutzt.
*/
const LS_TRAINER_STAGE_TOP = "quranm_trainer_stage_v1";

let trainerSession = null;
let trainerStageCurrent = (() => {
  try {
    const raw = Number(localStorage.getItem(LS_TRAINER_STAGE_TOP) || "2");
    if (!Number.isFinite(raw)) return 2;
    return Math.max(1, Math.min(7, raw));
  } catch (e) {
    return 2;
  }
})();

try { window.__trainerStageCurrent = trainerStageCurrent; } catch (e) {}

function saveTrainerStage(v) {
  const n = Math.max(1, Math.min(7, Number(v) || 1));
  trainerStageCurrent = n;
  try { window.__trainerStageCurrent = n; } catch (e) {}
  try { localStorage.setItem(LS_TRAINER_STAGE_TOP, String(n)); } catch (e) {}
  return n;
}

function loadTrainerStage() {
  return Math.max(1, Math.min(7, Number(trainerStageCurrent) || 1));
}

function syncAyahTopStageUI(root = document) {
  const scope = root || document;
  const current = loadTrainerStage();

  scope.querySelectorAll("[data-stage-drop]").forEach((drop) => {
    const prog = getTrainerStageProgress(current);

    const stageBtn = drop.querySelector(".ayahStageDropBtn");
    if (stageBtn) {
      stageBtn.style.setProperty("--stage-progress-pct", `${prog.pct}%`);
    }

    const textEl = drop.querySelector(".ayahStageDropText");
    if (textEl) textEl.textContent = `Stage ${current}`;

    drop.querySelectorAll(".ayahStageOpt[data-stage]").forEach((btn) => {
      const n = Number(btn.dataset.stage || "1");
      const rowProg = getTrainerStageProgress(n);

      btn.classList.toggle("is-active", n === current);
      btn.style.setProperty("--stage-progress-pct", `${rowProg.pct}%`);

      const rowMeta = btn.querySelector(".ayahStageOptMeta");
      if (rowMeta) rowMeta.textContent = `${rowProg.done}/${rowProg.total}`;
    });
  });
}

function closeAyahStageMenus(root = document) {
  const scope = root || document;
  scope.querySelectorAll("[data-stage-drop].is-open").forEach((drop) => {
    drop.classList.remove("is-open", "is-active");
  });
}

function applyTrainerStage(v, { rerender = true } = {}) {
  const n = saveTrainerStage(v);

  invalidateTrainerSession(n);
  syncAyahTopStageUI(document);

  if (rerender) {
    try {
      if (viewMode === "ayah") {
        if (typeof __inFavoritesPage !== "undefined" && __inFavoritesPage) {
          renderFavoritesPage();
        } else {
          const nextRef = pickTrainerNextRef() || String(currentRef || "");
          if (nextRef) {
            currentRef = nextRef;
            try { setRefToHash(nextRef); } catch (e) {}
            renderCurrent(nextRef);
            try { persistNavState?.(); } catch (e) {}
          }
        }
      }
    } catch (e) {}
  }

  return n;
}

window.__getTrainerStage = () => loadTrainerStage();
window.__setTrainerStage = (n, opts) => applyTrainerStage(n, opts || {});

function scoreToStage(score) {
  const s = Number(score);
  if (!Number.isFinite(s)) return 1;
  if (s <= 1.9) return 1;
  if (s < 3) return 2;
  if (s < 4) return 3;
  if (s < 5) return 4;
  if (s < 7) return 5;
  if (s < 8) return 6;
  return 7;
}

function normalizeTrainerReaderRow(ref, row = {}) {
  const r = String(ref || "");
  const target = loadReaderRepeatTarget();

  if (!/^\d+:\d+$/.test(r)) {
    return {
      rating: "",
      updatedAt: 0,
      rightCount: 0,
      goodCount: 0,
      mediumCount: 0,
      mediumPassed: false,
      done: false,
      badCount: 0,
      shownCount: 0,
    };
  }

  const rating = String(row.rating || "").trim();
  const rightCount = Math.max(0, Number(row.rightCount) || 0);
  const goodCount = Math.max(0, Number(row.goodCount) || 0);
  const mediumCount = Math.max(0, Number(row.mediumCount) || 0);
  const badCount = Math.max(0, Number(row.badCount) || 0);
  const shownCount = Math.max(0, Number(row.shownCount) || 0);

  return {
    rating: (rating === "bad" || rating === "mid" || rating === "good") ? rating : "",
    updatedAt: Number(row.updatedAt) || 0,
    rightCount,
    goodCount,
    mediumCount,
    mediumPassed: false,
    done: rightCount >= target,
    badCount,
    shownCount,
  };
}

let __trainerRatingsCacheRaw = null;
let __trainerRatingsCacheTarget = null;
let __trainerRatingsCacheMap = null;
let __trainerRatingsPersistTimer = 0;
let __trainerRatingsPendingRaw = null;

function loadTrainerRatingsMap() {
  try {
    const raw = localStorage.getItem(LS_TRAINER_AYAH_RATINGS) || "";
    const target = loadReaderRepeatTarget();

    if (
      __trainerRatingsCacheMap &&
      __trainerRatingsCacheRaw === raw &&
      __trainerRatingsCacheTarget === target
    ) {
      return __trainerRatingsCacheMap;
    }

    if (!raw) {
      __trainerRatingsCacheRaw = "";
      __trainerRatingsCacheTarget = target;
      __trainerRatingsCacheMap = {};
      return __trainerRatingsCacheMap;
    }

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      __trainerRatingsCacheRaw = raw;
      __trainerRatingsCacheTarget = target;
      __trainerRatingsCacheMap = {};
      return __trainerRatingsCacheMap;
    }

    const clean = {};
    for (const [ref, row] of Object.entries(parsed)) {
      if (!/^\d+:\d+$/.test(String(ref || ""))) continue;
      clean[String(ref)] = normalizeTrainerReaderRow(ref, row || {});
    }

    __trainerRatingsCacheRaw = raw;
    __trainerRatingsCacheTarget = target;
    __trainerRatingsCacheMap = clean;

    return __trainerRatingsCacheMap;
  } catch {
    __trainerRatingsCacheRaw = null;
    __trainerRatingsCacheTarget = null;
    __trainerRatingsCacheMap = {};
    return __trainerRatingsCacheMap;
  }
}

function saveTrainerRatingsMap(obj, { deferPersist = false, persistDelay = 1600 } = {}) {
  try {
    const clean = {};
    const source = (obj && typeof obj === "object") ? obj : {};
    const target = loadReaderRepeatTarget();

    for (const [ref, row] of Object.entries(source)) {
      if (!/^\d+:\d+$/.test(String(ref || ""))) continue;
      clean[String(ref)] = normalizeTrainerReaderRow(ref, row || {});
    }

    const raw = JSON.stringify(clean);

    __trainerRatingsCacheRaw = raw;
    __trainerRatingsCacheTarget = target;
    __trainerRatingsCacheMap = clean;

    if (!deferPersist) {
      localStorage.setItem(LS_TRAINER_AYAH_RATINGS, raw);
      __trainerRatingsPendingRaw = null;
      return;
    }

    __trainerRatingsPendingRaw = raw;

    try {
      clearTimeout(window.__trainerRatingsPersistTimer || 0);
    } catch (e) {}

    window.__trainerRatingsPersistTimer = setTimeout(() => {
      window.__trainerRatingsPersistTimer = 0;

      try {
        const pending = typeof __trainerRatingsPendingRaw === "string"
          ? __trainerRatingsPendingRaw
          : __trainerRatingsCacheRaw;

        if (typeof pending === "string") {
          localStorage.setItem(LS_TRAINER_AYAH_RATINGS, pending);
        }
      } catch (e) {}
    }, Math.max(0, Number(persistDelay) || 0));
  } catch {}
}

function getTrainerReaderRow(ref) {
  const r = String(ref || "");
  if (!/^\d+:\d+$/.test(r)) return normalizeTrainerReaderRow(r, {});

  const map = loadTrainerRatingsMap();
  return map?.[r] || normalizeTrainerReaderRow(r, {});
}

function getTrainerRatingForRef(ref) {
  return getTrainerReaderRow(ref).rating;
}

function getTrainerRightCountForRef(ref) {
  return getTrainerReaderRow(ref).rightCount;
}

function getReaderRingRatioForRef(ref) {
  const target = Math.max(1, Number(loadReaderRepeatTarget() || 5));
  const row = getTrainerReaderRow(ref);
  const count = Math.max(0, Number(row?.rightCount || 0));
  return Math.max(0, Math.min(1, count / target));
}

function getReaderRingStateForRef(ref) {
  const row = getTrainerReaderRow(ref);
  const ratio = getReaderRingRatioForRef(ref);
  const rating = String(row?.rating || "").trim();

  if (ratio >= 1) return "mastered";
  if (rating === "bad") return "bad";
  if (rating === "mid") return "mid";
  if (ratio > 0 || rating === "good") return "progress";
  return "neutral";
}

function getReaderRingClassForRef(ref) {
  const state = getReaderRingStateForRef(ref);

  if (state === "bad") return " is-reader-bad";
  if (state === "mid") return " is-reader-mid";
  if (state === "mastered") return " is-reader-mastered";
  if (state === "progress") return " is-reader-progress";
  return "";
}



function loadReaderRepeatTarget() {
  try {
    const v = Number(localStorage.getItem(LS_READER_REPEAT_TARGET) || 5);
    if (Number.isFinite(v) && v >= 1 && v <= 100) return Math.floor(v);
  } catch {}
  return 5;
}

function saveReaderRepeatTarget(v) {
  const n = Math.max(1, Math.min(100, Number(v) || 5));
  try {
    localStorage.setItem(LS_READER_REPEAT_TARGET, String(n));
  } catch {}
  try { window.__accountScheduleSync?.(); } catch (e) {}
  return n;
}

function loadTrainerReviewMode() {
  try {
    const raw = String(localStorage.getItem(LS_TRAINER_REVIEW_MODE) || "balanced").trim();
    if (raw === "soft" || raw === "balanced" || raw === "often") return raw;
  } catch {}
  return "balanced";
}

function saveTrainerReviewMode(mode) {
  const next = (mode === "soft" || mode === "balanced" || mode === "often") ? mode : "balanced";
  try {
    localStorage.setItem(LS_TRAINER_REVIEW_MODE, next);
  } catch {}
  try { window.__accountScheduleSync?.(); } catch (e) {}
  return next;
}


function getReaderRepeatTargetLabel(value) {
  const n = Math.max(1, Math.min(100, Number(value) || 5));
  return `${n}x right`;
}

function getReaderRepeatProgressLabel(ref = currentRef) {
  const r = String(ref || "");
  const target = Math.max(1, Math.min(100, Number(loadReaderRepeatTarget() || 5)));
  const count = /^\d+:\d+$/.test(r) ? Math.max(0, Number(getTrainerRightCountForRef(r) || 0)) : 0;
  return `${count}/${target} right`;
}

function buildReaderRepeatTargetSelectHtml() {
  const current = loadReaderRepeatTarget();
  const options = Array.from({ length: 100 }, (_, i) => i + 1);

  return `
    <div class="ayahRepeatDrop" data-repeat-drop>
      <button class="ayahRepeatDropBtn has-surah-help" type="button" data-repeat-toggle aria-label="Open right target list">
        <span class="ayahRepeatDropText">${getReaderRepeatTargetLabel(current)}</span>
        <span class="ayahRepeatDropArrow" aria-hidden="true">▼</span>
        <span
          class="acctScoreHelp surahTopHelp is-by-arrow"
          data-reader-help="reader-repeat-target"
          data-reader-help-title="Right target"
          data-reader-help-text="Choose how many right answers are needed."
          aria-label="Choose how many right answers are needed.">?</span>
      </button>

      <div class="ayahRepeatDropMenu" role="listbox" aria-label="Right target list">
        ${options.map((n) => `
          <button
            class="ayahRepeatOpt${n === current ? " is-active" : ""}"
            type="button"
            data-repeat-target-option="${n}"
            aria-label="${n}x right">
            ${n}x right
          </button>
        `).join("")}
      </div>
    </div>
  `;
}

function getTrainerReviewModeLabel(mode) {
  const m = String(mode || "balanced").trim();
  if (m === "soft") return "soft";
  if (m === "often") return "often";
  return "balanced";
}

function buildReaderReviewModeSelectHtml() {
  const current = loadTrainerReviewMode();
  const options = [
    { value: "soft", label: "soft" },
    { value: "balanced", label: "balanced" },
    { value: "often", label: "often" },
  ];

  return `
    <div class="ayahReviewDrop" data-review-drop>
      <button class="ayahReviewDropBtn has-surah-help" type="button" data-review-toggle aria-label="Open review mode list">
        <span class="ayahReviewDropText">${getTrainerReviewModeLabel(current)}</span>
        <span class="ayahReviewDropArrow" aria-hidden="true">▼</span>
        <span
          class="acctScoreHelp surahTopHelp is-by-arrow"
          data-reader-help="reader-review-mode"
          data-reader-help-title="Review mode"
          data-reader-help-text="Choose how often reviewed ayahs return."
          aria-label="Choose how often reviewed ayahs return.">?</span>
      </button>

      <div class="ayahReviewDropMenu" role="listbox" aria-label="Review mode list">
        ${options.map((opt) => `
          <button
            class="ayahReviewOpt${opt.value === current ? " is-active" : ""}"
            type="button"
            data-review-mode-option="${opt.value}"
            aria-label="${opt.label}">
            ${opt.label}
          </button>
        `).join("")}
      </div>
    </div>
  `;
}

const LS_MUSHAF_STAGE_FILTER = "quranm_mushaf_stage_filter_v1";
const LS_MUSHAF_MARK_FILTER = "quranm_mushaf_mark_filter_v1";

function loadMushafStageFilterStages() {
  try {
    const raw = localStorage.getItem(LS_MUSHAF_STAGE_FILTER);
    if (raw == null) return new Set([1, 2, 3, 4, 5, 6, 7]);

    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return new Set([1, 2, 3, 4, 5, 6, 7]);

    return new Set(
      arr
        .map((n) => Number(n))
        .filter((n) => Number.isFinite(n) && n >= 1 && n <= 7)
    );
  } catch {
    return new Set([1, 2, 3, 4, 5, 6, 7]);
  }
}

function saveMushafStageFilterStages(input) {
  const set = new Set(
    Array.from(input || [])
      .map((n) => Number(n))
      .filter((n) => Number.isFinite(n) && n >= 1 && n <= 7)
  );

  const out = Array.from(set).sort((a, b) => a - b);

  try {
    localStorage.setItem(LS_MUSHAF_STAGE_FILTER, JSON.stringify(out));
  } catch {}

  try { window.__accountScheduleSync?.(); } catch (e) {}
  return set;
}

function loadMushafMarkFilterStates() {
  try {
    const raw = localStorage.getItem(LS_MUSHAF_MARK_FILTER);
    if (raw == null) return new Set(["good", "mid", "bad"]);

    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return new Set(["good", "mid", "bad"]);

    return new Set(
      arr
        .map((v) => String(v || "").trim())
        .filter((v) => v === "good" || v === "mid" || v === "bad")
    );
  } catch {
    return new Set(["good", "mid", "bad"]);
  }
}

function saveMushafMarkFilterStates(input) {
  const set = new Set(
    Array.from(input || [])
      .map((v) => String(v || "").trim())
      .filter((v) => v === "good" || v === "mid" || v === "bad")
  );

  const out = Array.from(set);

  try {
    localStorage.setItem(LS_MUSHAF_MARK_FILTER, JSON.stringify(out));
  } catch {}

  try { window.__accountScheduleSync?.(); } catch (e) {}
  return set;
}

function isMushafStageVisible(stage) {
  const n = Math.max(1, Math.min(7, Number(stage) || 1));
  return loadMushafStageFilterStages().has(n);
}

function isMushafMarkedVisible(ref) {
  const rating = String(getTrainerRatingForRef(ref) || "").trim();
  if (!(rating === "good" || rating === "mid" || rating === "bad")) return true;
  return loadMushafMarkFilterStates().has(rating);
}

function getNearestVisibleMushafRef(baseRef) {
  const safe = String(baseRef || "");
  if (!/^\d+:\d+$/.test(safe)) return safe;

  const ay = getAyah(safe);
  if (!ay) return safe;

  const refs = ((typeof getSuraRefs === "function") ? getSuraRefs(ay.surah) : []).map(String);
  if (!refs.length) return safe;

  if (
    isMushafStageVisible(getTrainerStageForRef(safe)) &&
    isMushafMarkedVisible(safe)
  ) return safe;

  const visibleRefs = refs.filter((r) =>
    isMushafStageVisible(getTrainerStageForRef(r)) &&
    isMushafMarkedVisible(r)
  );
  if (!visibleRefs.length) return safe;

  const idx = refs.indexOf(safe);
  if (idx < 0) return visibleRefs[0];

  let best = visibleRefs[0];
  let bestDist = Number.POSITIVE_INFINITY;

  for (const r of visibleRefs) {
    const pos = refs.indexOf(r);
    if (pos < 0) continue;

    const dist = Math.abs(pos - idx);
    if (dist < bestDist) {
      best = r;
      bestDist = dist;
    }
  }

  return best || safe;
}

function buildMushafStageFilterHtml() {
  const active = loadMushafStageFilterStages();
  const activeMarks = loadMushafMarkFilterStates();

  return `
    <div class="ayahFilterDrop" data-mushaf-filter-drop>
      <button class="ayahFilterDropBtn has-surah-help" type="button" data-mushaf-filter-toggle aria-label="Open mushaf stage filter">
        <span class="ayahFilterDropText">Filter</span>
        <span class="ayahFilterDropArrow" aria-hidden="true">▼</span>
      </button>

      <div class="ayahFilterDropMenu" role="dialog" aria-label="Show ayahs in stage">
        <div class="ayahFilterDropSection">
          <div class="ayahFilterDropTitle">show ayahs in stage:</div>
          <div class="ayahFilterDropList">
            ${Array.from({ length: 7 }, (_, i) => i + 1).map((n) => {
              const checked = active.has(n) ? "checked" : "";
              return `
                <label class="trOpt" data-mushaf-stage-filter-row="${n}">
                  <span class="trOptLabel">Stage ${n}</span>
                  <input class="trChk" type="checkbox" data-mushaf-stage-filter="${n}" ${checked}>
                </label>
              `;
            }).join("")}
          </div>
        </div>

        <div class="ayahFilterDropSection">
          <div class="ayahFilterDropTitle">show marked as:</div>
          <div class="ayahFilterDropList">
            <label class="trOpt" data-mushaf-mark-filter-row="good">
              <span class="trOptLabel">good</span>
              <input class="trChk" type="checkbox" data-mushaf-mark-filter="good" ${activeMarks.has("good") ? "checked" : ""}>
            </label>

            <label class="trOpt" data-mushaf-mark-filter-row="mid">
              <span class="trOptLabel">medium</span>
              <input class="trChk" type="checkbox" data-mushaf-mark-filter="mid" ${activeMarks.has("mid") ? "checked" : ""}>
            </label>

            <label class="trOpt" data-mushaf-mark-filter-row="bad">
              <span class="trOptLabel">bad</span>
              <input class="trChk" type="checkbox" data-mushaf-mark-filter="bad" ${activeMarks.has("bad") ? "checked" : ""}>
            </label>
          </div>
        </div>
      </div>
    </div>
  `;
}

function parseMushafHiddenRefs(raw) {
  return String(raw || "")
    .split("|")
    .map((s) => String(s || "").trim())
    .filter((ref) => /^\d+:\d+$/.test(ref));
}

function formatMushafHiddenRefsCompact(refs) {
  const list = (Array.isArray(refs) ? refs : [])
    .map((s) => String(s || "").trim())
    .filter((ref) => /^\d+:\d+$/.test(ref));

  if (!list.length) return "";

  const firstSurah = String(list[0]).split(":")[0] || "";
  const sameSurah = list.every((ref) => String(ref).split(":")[0] === firstSurah);

  if (!sameSurah) return list.join(", ");

  const ayahNos = list
    .map((ref) => String(ref).split(":")[1] || "")
    .filter(Boolean);

  return `${firstSurah}:${ayahNos.join(", ")}`;
}

function getTrainerFlaggedRefsForStage(stage) {
  const refs = getTrainerStageRefs(stage).map(String);
  const bad = [];
  const mid = [];

  for (const ref of refs) {
    const rating = String(getTrainerRatingForRef(ref) || "");
    if (rating === "bad") {
      bad.push({ ref, rating });
      continue;
    }
    if (rating === "mid") {
      mid.push({ ref, rating });
    }
  }

  return [...bad, ...mid];
}

function buildReaderFlaggedRefsTopbarHtml() {
  const stage = loadTrainerStage();
  const items = getTrainerFlaggedRefsForStage(stage);
  const count = items.length;

  const itemsHtml = items.length
    ? items.map(({ ref, rating }) => `
        <button class="hifzBadDropItem" type="button" data-trainer-flag-ref="${ref}" aria-label="Open ${ref}">
          <span class="hifzBadDropItemRef ${rating === "bad" ? "is-bad" : "is-mid"}">${ref}</span>
        </button>
      `).join("")
    : `<div class="hifzBadDropEmpty">No marked ayahs</div>`;

  return `
    <div class="hifzBadDrop" data-trainer-flag-drop>
      <button class="hifzBadDropBtn has-surah-help" type="button" data-trainer-flag-toggle aria-haspopup="dialog" aria-expanded="false" aria-label="Show bad and medium ayahs">
        <span class="hifzBadDropBtnLabel">marked</span>
        <span class="hifzBadDropBtnCount">${count}</span>
        <span class="hifzBadDropBtnArrow" aria-hidden="true">▼</span>
        <span
          class="acctScoreHelp surahTopHelp is-by-arrow"
          data-reader-help="reader-flagged-refs"
          data-reader-help-title="Marked ayahs"
          data-reader-help-text="Open bad and medium ayahs in this stage."
          aria-label="Open bad and medium ayahs in this stage.">?</span>
      </button>

      <div class="hifzBadDropMenu" data-trainer-flag-menu>
        <div class="hifzBadDropHead">bad + medium</div>
        ${itemsHtml}
      </div>
    </div>
  `;
}
function getTrainerScoreForRef(ref) {
  const a = getAyah(ref);
  if (!a) return null;

  const score = Number(
    a?.final_score ??
    a?.ayah_score ??
    a?.scores?.finalScore ??
    a?.scores?.ayahScore
  );

  return Number.isFinite(score) ? score : null;
}

function getTrainerStageForRef(ref) {
  const score = getTrainerScoreForRef(ref);
  if (score == null) return 1;
  return Math.max(1, Math.min(7, Number(scoreToStage(score) || 1)));
}

function getTrainerStageRefs(stage) {
  const wanted = Math.max(1, Math.min(7, Number(stage) || 1));
  const out = [];

  for (const ref of getAllRefs()) {
    const score = getTrainerScoreForRef(ref);
    if (score == null) continue;
    if (scoreToStage(score) !== wanted) continue;
    out.push(String(ref));
  }

  return out;
}

function getTrainerStageProgress(stage) {
  const refs = getTrainerStageRefs(stage);
  const total = refs.length;

  let done = 0;
  for (const ref of refs) {
    if (getTrainerReaderRow(ref).done) done++;
  }

  const pct = total > 0
    ? Math.max(0, Math.min(100, Math.round((done / total) * 100)))
    : 0;

  return { total, done, pct };
}

function shuffleTrainerArrayInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function trainerStageHasPendingRefs(stage) {
  const refs = getTrainerStageRefs(stage);
  for (const ref of refs) {
    if (!getTrainerReaderRow(ref).done) return true;
  }
  return false;
}

function buildTrainerStagePool(stage) {
  const refs = getTrainerStageRefs(stage);
  const hasPending = refs.some((ref) => !getTrainerReaderRow(ref).done);
  const list = (hasPending ? refs.filter((ref) => !getTrainerReaderRow(ref).done) : refs).slice();
  return shuffleTrainerArrayInPlace(list);
}

function rebuildTrainerSession(stage = loadTrainerStage()) {
  const n = Math.max(1, Math.min(7, Number(stage) || 1));

  trainerSession = {
    stage: n,
    unseenRefs: buildTrainerStagePool(n),
    unseenIndex: 0,
    reviewQueue: [],
    currentStep: 0,
    sinceLastReview: 0,
    currentRef: "",
  };

  return trainerSession;
}

function ensureTrainerSession(stage = loadTrainerStage()) {
  const n = Math.max(1, Math.min(7, Number(stage) || 1));
  if (!trainerSession || Number(trainerSession.stage) !== n) {
    return rebuildTrainerSession(n);
  }
  return trainerSession;
}

function invalidateTrainerSession(stage = loadTrainerStage()) {
  trainerSession = null;
  return ensureTrainerSession(stage);
}

function getTrainerReviewProfile(mode, stageSize = 0) {
  const widen = stageSize > 0 && stageSize <= 12 ? 1 : 0;

  if (mode === "soft") {
    return {
      minGap: 4 + widen,
      forceAfter: 7 + widen,
      badAfter: [4 + widen, 6 + widen],
      midAfter: [6 + widen, 8 + widen],
      goodAfter: [9 + widen, 12 + widen],
    };
  }

  if (mode === "often") {
    return {
      minGap: 2,
      forceAfter: 4 + widen,
      badAfter: [2, 3 + widen],
      midAfter: [3 + widen, 5 + widen],
      goodAfter: [5 + widen, 7 + widen],
    };
  }

  return {
    minGap: 3,
    forceAfter: 6 + widen,
    badAfter: [3, 5 + widen],
    midAfter: [5 + widen, 7 + widen],
    goodAfter: [7 + widen, 10 + widen],
  };
}

function getTrainerDelayRange(profile, rating) {
  if (rating === "bad") return profile.badAfter;
  if (rating === "mid") return profile.midAfter;
  return profile.goodAfter;
}

function trainerRandInt(min, max) {
  const a = Math.min(Number(min) || 0, Number(max) || 0);
  const b = Math.max(Number(min) || 0, Number(max) || 0);
  return Math.floor(Math.random() * ((b - a) + 1)) + a;
}

function countTrainerUnseenRemaining(session) {
  if (!session) return 0;

  let count = 0;
  for (let i = Number(session.unseenIndex) || 0; i < session.unseenRefs.length; i++) {
    const ref = String(session.unseenRefs[i] || "");
    if (!/^\d+:\d+$/.test(ref)) continue;
    if (getTrainerReaderRow(ref).done) continue;
    count++;
  }
  return count;
}

function upsertTrainerReviewItem(session, item) {
  if (!session || !item || !/^\d+:\d+$/.test(String(item.ref || ""))) return;

  const ref = String(item.ref);
  const dueStep = Math.max(0, Number(item.dueStep) || 0);
  const priority = Math.max(1, Number(item.priority) || 1);
  const createdAt = Math.max(0, Number(item.createdAt) || 0);

  const existing = session.reviewQueue.find((x) => String(x.ref || "") === ref);
  if (existing) {
    existing.dueStep = Math.min(Number(existing.dueStep) || dueStep, dueStep);
    existing.priority = Math.max(Number(existing.priority) || priority, priority);
    existing.createdAt = Math.min(Number(existing.createdAt) || createdAt, createdAt);
    return;
  }

  session.reviewQueue.push({ ref, dueStep, priority, createdAt });
}

function scheduleTrainerReview(ref, rating) {
  const r = String(ref || "");
  if (!/^\d+:\d+$/.test(r)) return;

  const stage = loadTrainerStage();
  const session = ensureTrainerSession(stage);
  const stageSize = Math.max(1, session.unseenRefs.length + session.reviewQueue.length);
  const profile = getTrainerReviewProfile(loadTrainerReviewMode(), stageSize);
  const [minDelay, maxDelay] = getTrainerDelayRange(profile, rating);
  const dueStep = session.currentStep + trainerRandInt(minDelay, maxDelay);
  const priority = rating === "bad" ? 3 : (rating === "mid" ? 2 : 1);

  upsertTrainerReviewItem(session, {
    ref: r,
    dueStep,
    priority,
    createdAt: session.currentStep,
  });
}

function pullTrainerDueItems(session) {
  if (!session) return [];

  const due = [];
  const keep = [];

  for (const item of session.reviewQueue) {
    const ref = String(item?.ref || "");
    if (!/^\d+:\d+$/.test(ref)) continue;
    if (getTrainerReaderRow(ref).done) continue;

    if ((Number(item?.dueStep) || 0) <= (Number(session.currentStep) || 0)) {
      due.push({
        ref,
        dueStep: Number(item?.dueStep) || 0,
        priority: Math.max(1, Number(item?.priority) || 1),
        createdAt: Math.max(0, Number(item?.createdAt) || 0),
      });
    } else {
      keep.push(item);
    }
  }

  session.reviewQueue = keep;
  due.sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    if (a.dueStep !== b.dueStep) return a.dueStep - b.dueStep;
    return a.createdAt - b.createdAt;
  });

  return due;
}

function pushBackTrainerDueItems(session, items) {
  if (!session || !Array.isArray(items)) return;
  for (const item of items) upsertTrainerReviewItem(session, item);
}

function shouldInjectTrainerReview(session, dueItems) {
  if (!session || !Array.isArray(dueItems) || !dueItems.length) return false;

  const unseenRemaining = countTrainerUnseenRemaining(session);
  const profile = getTrainerReviewProfile(
    loadTrainerReviewMode(),
    Math.max(1, session.unseenRefs.length + session.reviewQueue.length + dueItems.length)
  );

  if (unseenRemaining <= 0) return true;
  if ((Number(session.sinceLastReview) || 0) < profile.minGap) return false;
  if ((Number(session.sinceLastReview) || 0) >= profile.forceAfter) return true;
  if (dueItems.length >= 3) return true;
  if (dueItems.length >= 2 && unseenRemaining <= 10) return true;

  return false;
}

function pickTrainerNextRef() {
  const stage = loadTrainerStage();
  let session = ensureTrainerSession(stage);
  const cycleCompleted = !trainerStageHasPendingRefs(stage);

  const due = pullTrainerDueItems(session);
  if (!cycleCompleted && shouldInjectTrainerReview(session, due)) {
    const chosen = due.shift();
    pushBackTrainerDueItems(session, due);

    session.sinceLastReview = 0;
    session.currentRef = chosen?.ref || "";
    return chosen?.ref || null;
  }
  pushBackTrainerDueItems(session, due);

  while (session.unseenIndex < session.unseenRefs.length) {
    const ref = String(session.unseenRefs[session.unseenIndex++] || "");
    if (!/^\d+:\d+$/.test(ref)) continue;
    if (!cycleCompleted && getTrainerReaderRow(ref).done) continue;

    session.sinceLastReview = (Number(session.sinceLastReview) || 0) + 1;
    session.currentRef = ref;
    return ref;
  }

  const fallbackDue = pullTrainerDueItems(session);
  if (!cycleCompleted && fallbackDue.length) {
    const chosen = fallbackDue.shift();
    pushBackTrainerDueItems(session, fallbackDue);

    session.sinceLastReview = 0;
    session.currentRef = chosen?.ref || "";
    return chosen?.ref || null;
  }

  session = rebuildTrainerSession(stage);
  const cycleCompletedAfterReset = !trainerStageHasPendingRefs(stage);

  while (session.unseenIndex < session.unseenRefs.length) {
    const ref = String(session.unseenRefs[session.unseenIndex++] || "");
    if (!/^\d+:\d+$/.test(ref)) continue;
    if (!cycleCompletedAfterReset && getTrainerReaderRow(ref).done) continue;

    session.sinceLastReview = (Number(session.sinceLastReview) || 0) + 1;
    session.currentRef = ref;
    return ref;
  }

  return null;
}

function setTrainerRatingForRef(ref, rating) {
  const r = String(ref || "");
  const rt = String(rating || "");
  if (!/^\d+:\d+$/.test(r)) return false;
  if (!(rt === "bad" || rt === "mid" || rt === "good")) return false;

  const map = loadTrainerRatingsMap();
  const prev = normalizeTrainerReaderRow(r, map?.[r] || {});
  const target = loadReaderRepeatTarget();

  const next = {
    ...prev,
    rating: rt,
    updatedAt: Date.now(),
    shownCount: Math.max(0, Number(prev.shownCount) || 0) + 1,
  };

  if (rt === "bad") {
    next.badCount = Math.max(0, Number(prev.badCount) || 0) + 1;
    next.rightCount = 0;
    next.mediumPassed = false;
  } else if (rt === "mid") {
    next.mediumCount = Math.max(0, Number(prev.mediumCount) || 0) + 1;
    next.rightCount = 0;
    next.mediumPassed = false;
  } else if (rt === "good") {
    next.goodCount = Math.max(0, Number(prev.goodCount) || 0) + 1;
    next.rightCount = Math.max(0, Number(prev.rightCount) || 0) + 1;
    next.mediumPassed = false;
  }

  next.done = next.rightCount >= target;

  map[r] = normalizeTrainerReaderRow(r, next);
  saveTrainerRatingsMap(map, { deferPersist: true, persistDelay: 1600 });

  try {
    cancelScheduledRender(window.__readerProgressHeavyTimer);
  } catch (e) {}

  window.__readerProgressHeavyTimer = scheduleRender(() => {
    window.__readerProgressHeavyTimer = 0;

    try { window.__refreshAccountPanelMeta?.(); } catch (e) {}
    try { window.__accountScheduleSync?.(); } catch (e) {}

    try {
      cancelScheduledRender(window.__readerProgressSnapshotTimer);
    } catch (e) {}

    window.__readerProgressSnapshotTimer = scheduleRender(() => {
      window.__readerProgressSnapshotTimer = 0;
      try { snapshotReaderProgressHistory?.(); } catch (e) {}
    }, { timeout: 2200 });
  }, { timeout: 900 });
  return true;
}

function buildReaderAyahHeaderProgressHtml(ref) {
  const r = String(ref || "");
  const label = getReaderRepeatProgressLabel(r);

  return `
    <div class="readerTopProgress" data-reader-progress="${r}" aria-label="${label}">
      <div class="readerTopProgressTrack">
        <span class="readerTopProgressLabel">${label}</span>
      </div>
    </div>
  `;
}

function getTrainerStageLabelText() {
  try {
    if (typeof window.__trainerStageCurrent !== "undefined" && window.__trainerStageCurrent) {
      return `Stage ${Number(window.__trainerStageCurrent) || 1}`;
    }
  } catch {}

  try {
    const el = document.getElementById("stageDropText");
    const txt = String(el?.textContent || "").trim();
    if (txt) return txt;
  } catch {}

  return "Stage 1";
}

function __syncTrainerScoreButtons(root = document) {
  const scope = root || document;

  scope.querySelectorAll(".ayahTrainerBar[data-ref]").forEach((bar) => {
    const ref = String(bar.dataset?.ref || "");
    const current = getTrainerRatingForRef(ref);

    bar.querySelectorAll(".ayahScoreBtn[data-rating]").forEach((btn) => {
      const rt = String(btn.dataset?.rating || "");
      btn.classList.toggle("is-active", rt === current);
    });
  });
}

function getTrainerNextRef(ref) {
  const currentStage = loadTrainerStage();
  const refs = getTrainerStageRefs(currentStage).map(String);
  const cur = String(ref || "");
  const idx = refs.indexOf(cur);

  if (!refs.length) return null;
  if (idx < 0) return pickTrainerNextRef();

  const cycleCompleted = !trainerStageHasPendingRefs(currentStage);

  if (cycleCompleted) {
    return refs[(idx + 1) % refs.length] || refs[0];
  }

  for (let i = idx + 1; i < refs.length; i++) {
    if (!getTrainerReaderRow(refs[i]).done) return refs[i];
  }

  return pickTrainerNextRef();
}

const ensureReaderRecallFlightFx = () => {
  let fx = document.querySelector(".readerRecallFlightFx");
  if (fx) return fx;

  fx = document.createElement("div");
  fx.className = "readerRecallFlightFx";
  fx.setAttribute("aria-hidden", "true");
  fx.innerHTML = `
    <svg class="readerRecallFlightSvg" viewBox="0 0 1 1" preserveAspectRatio="none">
      <path class="readerRecallFlightGlowPath"></path>
      <path class="readerRecallFlightSparkPath"></path>
    </svg>
    <div class="readerRecallFlightDust">
      <span class="readerRecallFlightDustCore"></span>
      <span class="readerRecallFlightDustMote is-a"></span>
      <span class="readerRecallFlightDustMote is-b"></span>
      <span class="readerRecallFlightDustMote is-c"></span>
      <span class="readerRecallFlightDustMote is-d"></span>
    </div>
  `;
  document.body.appendChild(fx);
  return fx;
};

const clearReaderRecallFlightFx = () => {
  try { clearTimeout(Number(window.__readerRecallFlightArrivalTimer || 0)); } catch(e) {}
  try { clearTimeout(Number(window.__readerRecallFlightClearTimer || 0)); } catch(e) {}
  try {
    if (typeof window.__readerRecallFlightRaf === "number" && window.__readerRecallFlightRaf) {
      cancelAnimationFrame(window.__readerRecallFlightRaf);
    }
  } catch(e) {}

  const fx = document.querySelector(".readerRecallFlightFx");
  if (fx) {
    fx.classList.remove("is-active");
    fx.removeAttribute("data-kind");
    fx.style.removeProperty("--flight-len");
    fx.style.removeProperty("--flight-ms");

    const dust = fx.querySelector(".readerRecallFlightDust");
    if (dust) {
      dust.style.left = "0px";
      dust.style.top = "0px";
      dust.style.opacity = "0";
      dust.style.transform = "translate(-50%, -50%)";
    }
  }

  try {
    if (window.__readerRecallFlightTick && window.__readerRecallFlightTick.isConnected) {
      window.__readerRecallFlightTick.classList.remove(
        "is-reader-good-arrival",
        "is-reader-mid-arrival",
        "is-reader-bad-arrival"
      );
    }
  } catch(e) {}

  window.__readerRecallFlightTick = null;
  window.__readerRecallFlightArrivalTimer = 0;
  window.__readerRecallFlightClearTimer = 0;
  window.__readerRecallFlightRaf = 0;
};

const runReaderRecallFlightFromButton = (btn, ref, kind = "good") => {
  const r = String(ref || "");
  const markKind = (() => {
    const k = String(kind || "").toLowerCase();
    if (k === "bad") return "bad";
    if (k === "mid") return "mid";
    return "good";
  })();

  if (!btn || !/^\d+:\d+$/.test(r)) {
    return { started:false, arrivalDelay:0, totalDelay:340 };
  }

  const tickSelector = (typeof CSS !== "undefined" && typeof CSS.escape === "function")
    ? `.suraTick[data-ref="${CSS.escape(r)}"]`
    : `.suraTick[data-ref="${r.replace(/"/g, '\\"')}"]`;

  const tick = document.querySelector(tickSelector);
  if (!tick) {
    return { started:false, arrivalDelay:0, totalDelay:340 };
  }

  const fx = ensureReaderRecallFlightFx();
  clearReaderRecallFlightFx();

  const svg = fx.querySelector(".readerRecallFlightSvg");
  const glowPath = fx.querySelector(".readerRecallFlightGlowPath");
  const sparkPath = fx.querySelector(".readerRecallFlightSparkPath");
  const dust = fx.querySelector(".readerRecallFlightDust");

  if (!svg || !glowPath || !sparkPath || !dust) {
    return { started:false, arrivalDelay:0, totalDelay:340 };
  }

  const fxStyle = getComputedStyle(fx);
  const dustStyle = getComputedStyle(dust);

  const fxLooksReady =
    fxStyle.position === "fixed" &&
    fxStyle.pointerEvents === "none" &&
    dustStyle.position === "fixed";

  if (!fxLooksReady) {
    clearReaderRecallFlightFx();
    return { started:false, arrivalDelay:0, totalDelay:340 };
  }

  const startRect = btn.getBoundingClientRect();
  const endRect = tick.getBoundingClientRect();

  const startX = startRect.left + (startRect.width * 0.50);
  const startY = startRect.top + (startRect.height * 0.50);

  const endX = endRect.left + (endRect.width * 0.50);
  const endY = endRect.top + (endRect.height * 0.54);

  const dx = endX - startX;
  const dy = endY - startY;
  const dist = Math.max(1, Math.hypot(dx, dy));

  const rootCs = getComputedStyle(document.documentElement);
  const stageH = parseFloat(rootCs.getPropertyValue("--stage-h")) || window.innerHeight;

  const nx = -dy / dist;
  const ny = dx / dist;

  const bendSign = Math.random() < 0.5 ? -1 : 1;
  const bendMain =
    Math.min(Math.max(dist * 0.26, stageH * 0.10), stageH * 0.28) *
    bendSign *
    (0.85 + (Math.random() * 0.45));

  const bendLate = bendMain * -(0.42 + (Math.random() * 0.30));

  const liftBase = Math.min(Math.max(dist * 0.18, stageH * 0.06), stageH * 0.18);
  const lift1 = liftBase * (0.95 + (Math.random() * 0.45));
  const lift2 = liftBase * (0.25 + (Math.random() * 0.35));

  const c1x = startX + (dx * (0.20 + (Math.random() * 0.08))) + (nx * bendMain);
  const c1y = startY + (dy * 0.10) + (ny * bendMain) - lift1;

  const c2x = startX + (dx * (0.72 + (Math.random() * 0.10))) + (nx * bendLate);
  const c2y = startY + (dy * 0.86) + (ny * bendLate) - lift2;

  const d = `M ${startX} ${startY} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${endX} ${endY}`;

  svg.setAttribute("viewBox", `0 0 ${Math.max(1, window.innerWidth)} ${Math.max(1, window.innerHeight)}`);
  glowPath.setAttribute("d", d);
  sparkPath.setAttribute("d", d);

  let pathLen = 1;
  try {
    pathLen = Math.max(1, glowPath.getTotalLength());
  } catch(e) {
    return { started:false, arrivalDelay:0, totalDelay:340 };
  }

  const duration = Math.round(
    Math.min(1660, Math.max(1100, dist * (1.62 + (Math.random() * 0.20))))
  );

  fx.setAttribute("data-kind", markKind);
  fx.style.setProperty("--flight-len", String(pathLen));
  fx.style.setProperty("--flight-ms", `${duration}ms`);

  fx.classList.remove("is-active");
  void fx.offsetWidth;
  fx.classList.add("is-active");

  const easeInOut = (t) => 0.5 - (Math.cos(Math.PI * t) / 2);
  const lookAhead = Math.min(0.03, Math.max(0.010, 26 / pathLen));
  const startedAt = performance.now();

  const step = (now) => {
    const raw = Math.max(0, Math.min(1, (now - startedAt) / duration));
    const eased = easeInOut(raw);

    let point;
    let ahead;

    try {
      point = glowPath.getPointAtLength(pathLen * eased);
      ahead = glowPath.getPointAtLength(pathLen * Math.min(1, eased + lookAhead));
    } catch(e) {
      dust.style.opacity = "0";
      window.__readerRecallFlightRaf = 0;
      return;
    }

    const angle = Math.atan2(ahead.y - point.y, ahead.x - point.x);
    const alpha =
      raw < 0.08
        ? (raw / 0.08)
        : (raw > 0.92 ? Math.max(0, (1 - raw) / 0.08) : 1);

    const scale = 0.92 + (Math.sin(raw * Math.PI) * 0.18);

    dust.style.left = `${point.x}px`;
    dust.style.top = `${point.y}px`;
    dust.style.opacity = String(alpha);
    dust.style.transform = `translate(-50%, -50%) rotate(${angle}rad) scale(${scale})`;

    if (raw < 1) {
      window.__readerRecallFlightRaf = requestAnimationFrame(step);
    } else {
      dust.style.opacity = "0";
      window.__readerRecallFlightRaf = 0;
    }
  };

  const arrivalDelay = Math.max(430, Math.round(duration * 0.88));
  const arrivalClass = (
    markKind === "bad"
      ? "is-reader-bad-arrival"
      : markKind === "mid"
        ? "is-reader-mid-arrival"
        : "is-reader-good-arrival"
  );
  const arrivalClassMs = markKind === "bad" ? 560 : 460;

  window.__readerRecallFlightTick = tick;
  window.__readerRecallFlightRaf = requestAnimationFrame(step);

  window.__readerRecallFlightArrivalTimer = setTimeout(() => {
    try {
      if (tick.isConnected) {
        tick.classList.remove(
          "is-reader-good-arrival",
          "is-reader-mid-arrival",
          "is-reader-bad-arrival"
        );
        void tick.offsetWidth;
        tick.classList.add(arrivalClass);

        setTimeout(() => {
          try {
            tick.classList.remove(
              "is-reader-good-arrival",
              "is-reader-mid-arrival",
              "is-reader-bad-arrival"
            );
          } catch(e) {}
        }, arrivalClassMs);
      }
    } catch(e) {}
  }, arrivalDelay);

  window.__readerRecallFlightClearTimer = setTimeout(() => {
    clearReaderRecallFlightFx();
  }, duration + 360);

  return {
    started:true,
    arrivalDelay,
    totalDelay: duration + 360
  };
};

function applyTrainerRatingFromUI(ref, rating, { advance = true, uiDelay = 0 } = {}) {
  const r = String(ref || "");
  const rt = String(rating || "");

  const now = performance.now();
  const cooldownUntil = Number(window.__trainerRateCooldownUntil || 0);
  if (cooldownUntil && now < cooldownUntil) return false;

  if (!/^\d+:\d+$/.test(r)) return false;
  if (!(rt === "bad" || rt === "mid" || rt === "good")) return false;

  window.__trainerRateCooldownUntil = now + 700;

  ensureTrainerSession(loadTrainerStage()).currentRef = r;

  const ok = setTrainerRatingForRef(r, rt);
  if (!ok) return false;

  const row = getTrainerReaderRow(r);
  if (!row.done) {
    if (rt === "bad" || rt === "mid") {
      scheduleTrainerReview(r, rt);
    } else if (rt === "good") {
      scheduleTrainerReview(r, "good");
    }
  }

  const runUiStep = () => {
    try {
      const qv = document.querySelector(".qView");
      if (qv) __syncTrainerScoreButtons(qv);
    } catch (e) {}

    try { window.__suraProgRefresh?.(); } catch (e) {}

    if (!advance) {
      try { renderCurrent(r); } catch (e) {}
      return;
    }

    try {
      const session = ensureTrainerSession(loadTrainerStage());
      session.currentStep = (Number(session.currentStep) || 0) + 1;
    } catch (e) {}

    const nextRef = getTrainerNextRef(r) || pickTrainerNextRef() || r;

    try { stopWordAudio?.(); } catch (e) {}
    try { stopVerseAudio?.(); } catch (e) {}
    try { stopSurahQueue?.(); } catch (e) {}

    currentRef = nextRef;
    try { renderCurrent(nextRef); } catch (e) {}
    try { setRefToHash(nextRef); } catch (e) {}
    try { persistNavState?.(); } catch (e) {}
  };

  const delayMs = Math.max(0, Number(uiDelay) || 0);

  try {
    clearTimeout(window.__trainerUiDelayTimer || 0);
  } catch (e) {}

  window.__trainerUiDelayTimer = setTimeout(() => {
    window.__trainerUiDelayTimer = 0;
    try { runUiStep(); } catch (e) {}
  }, delayMs);
  return true;
}
function __bindTrainerHotkeysOnce() {
  if (window.__trainerHotkeysBound) return;
  window.__trainerHotkeysBound = true;

  document.addEventListener("keydown", (e) => {
    const tag = String(document.activeElement?.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || document.activeElement?.isContentEditable) return;

    if (typeof __inFavoritesPage !== "undefined" && __inFavoritesPage) return;
    if (viewMode !== "ayah") return;
    if (!/^\d+:\d+$/.test(String(currentRef || ""))) return;

    let rating = "";
    if (e.key === "1") rating = "bad";
    else if (e.key === "2") rating = "mid";
    else if (e.key === "3") rating = "good";
    else return;

    e.preventDefault();

    let uiDelay = 0;

    try {
      const qv = document.querySelector(".qView");
      const scoreBtn = qv?.querySelector?.(
        `.ayahScoreBtn[data-score-ref="${CSS.escape(String(currentRef))}"][data-rating="${CSS.escape(rating)}"]`
      );

      if (scoreBtn) {
        const flight = runReaderRecallFlightFromButton(scoreBtn, currentRef, rating);
        uiDelay = flight?.started ? Math.max(0, Number(flight.totalDelay) || 0) : 0;
      }
    } catch (e) {}

    applyTrainerRatingFromUI(currentRef, rating, { advance: true, uiDelay });
  });
}


/* ============================================================================
   ROUTER HELPERS (Hash) – URL -> Ref
   Beispiele:
   - http://localhost:8000/#/2:1
   - http://localhost:8000/#/2:255
============================================================================ */

function parseRefLoose(input) {
  const s = String(input || "")
    .trim()
    // alles was vorne wie "#", "#/", "##///" usw. ist weg
    .replace(/^#+\/?/, "")
    // falls jemand "ref=#/2/255" reinpaste't: alles vor letztem # weg
    .replace(/^.*#\/?/, "")
    // Trenner normalisieren
    .replace(/[.\s\-_/]+/g, ":");

  // 1) Nur Sura: "2" => "2:1"
  const mOnlySura = s.match(/^(\d{1,3})$/);
  if (mOnlySura) {
    const surah = Number(mOnlySura[1]);
    if (Number.isNaN(surah)) return null;
    if (surah < 1 || surah > 114) return null;
    return `${surah}:1`;
  }

  // 2) Sura:Ayah "2:255" (oder "2 255", "2-255", "2/255" => wird oben zu ":" normalisiert)
  const m = s.match(/^(\d{1,3}):(\d{1,3})$/);
  if (!m) return null;

  const surah = Number(m[1]);
  const ayah = Number(m[2]);

  if (Number.isNaN(surah) || Number.isNaN(ayah)) return null;
  if (surah < 1 || surah > 114) return null;
  if (ayah < 1 || ayah > 999) return null;

  return `${surah}:${ayah}`;
}

function normalizeRef(input) {
  const loose = parseRefLoose(input);
  if (!loose) return null;

  // Solange Daten noch nicht da sind: nur "loose" zulassen (hash setzen ok)
  if (!dataReady) return loose;

  const [suraStr, ayahStr] = loose.split(":");
  const surah = Number(suraStr);
  const ayah = Number(ayahStr);

  const meta = getSuraMeta(surah);
  if (!meta) return null;

  const maxAyah = Number(meta.ayahCount || 0);
  if (!maxAyah) return null;
  if (ayah < 1 || ayah > maxAyah) return null;

  return loose;
}

function getRefFromHash() {
  // location.hash kann sein: "#/2:255", "#/7/7", "#7-7", "##/7/7"
  const raw = (location.hash || "");
  const loose = parseRefLoose(raw);
  return normalizeRef(loose);
}

function setRefToHash(ref) {
  const n = parseRefLoose(ref);
  if (!n) return false;

  const next = `#/${n}`;
  if (location.hash !== next) {
    suppressHashRender = true;   // <- verhindert, dass hashchange direkt nochmal rendert
    location.hash = next;
  }
  return true;
}

// =========================
// Nav Persist (lastRef + viewMode)
// =========================
const LS_LAST_REF = "q_lastRef";
const LS_VIEW_MODE = "q_viewMode";

function persistNavState() {
  try {
    if (/^\d+:\d+$/.test(currentRef)) localStorage.setItem(LS_LAST_REF, currentRef);
    if (viewMode) localStorage.setItem(LS_VIEW_MODE, viewMode);
  } catch {}
}

function loadPersistedNavState() {
  try {
    const lastRef = localStorage.getItem(LS_LAST_REF) || "";
    const vm = localStorage.getItem(LS_VIEW_MODE) || "";
    return { lastRef, viewMode: vm };
  } catch {
    return { lastRef: "", viewMode: "" };
  }
}

// =========================
// ACCOUNT SYNC (Cloudflare Worker + D1)
// =========================

// ⚠️ HIER deine Worker-URL
const ACCOUNT_API_BASE = "https://quranmapi.u87bc15v3.workers.dev";

// Design-Key (Style Picker)
const LS_STYLE_THEME = "quranm_style_theme_v1";

// ✅ Fixe Auth-Keys (damit wir nicht “irgendeinen” JWT aus Versehen nehmen)
// (UMBENANNT, damit es nicht mit dem AUTH-Block oben kollidiert)
const LS_ACC_AUTH_TOKEN  = "q_auth_token_v1";
const LS_ACC_AUTH_SET_AT = "q_auth_set_at_v1"; // ms timestamp

// 114 Tage in ms
const AUTH_KEEP_MS = 114 * 24 * 60 * 60 * 1000;

function __setAuthToken(token){
  try{ localStorage.setItem(LS_ACC_AUTH_TOKEN, String(token || "")); }catch{}
  try{ localStorage.setItem(LS_ACC_AUTH_SET_AT, String(Date.now())); }catch{}
}

function __getAuthToken(){
  try{ return String(localStorage.getItem(LS_ACC_AUTH_TOKEN) || ""); }catch{ return ""; }
}

function __isAuthFresh(){
  try{
    const t = Number(localStorage.getItem(LS_ACC_AUTH_SET_AT) || "0");
    if (!Number.isFinite(t) || t <= 0) return false;
    return (Date.now() - t) <= AUTH_KEEP_MS;
  }catch{
    return false;
  }
}

// Token finden: erst unser fixer Key, fallback (damit deine bisherigen Tests nicht kaputt gehen)
function __findJwtInLocalStorage(){
  const direct = __getAuthToken().trim();
  if (/^[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+$/.test(direct)) return direct;

  // fallback: irgendein JWT (nur als Übergang)
  try{
    for (let i = 0; i < localStorage.length; i++){
      const k = localStorage.key(i);
      if (!k) continue;
      const v = String(localStorage.getItem(k) || "").trim();
      if (!v) continue;
      if (/^[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+$/.test(v)) return v;
    }
  }catch{}
  return "";
}

function __authHeaders(){
  const token = __findJwtInLocalStorage();
  const h = { "Content-Type": "application/json" };
  if (token) h["Authorization"] = `Bearer ${token}`;
  return h;
}

function __isLoggedIn(){
  const tok = __findJwtInLocalStorage();
  if (!tok) return false;

  // ✅ LocalStorage-Regel: nur 114 Tage “eingeloggt”
  // (Token bleibt gespeichert, aber wir behandeln ihn danach als “ausgeloggt”)
  return __isAuthFresh();
}

let __syncTimer = 0;
let __syncInFlight = false;

const LS_HIFZ_RESULTS = "q_hifz_results_v1";
const LS_HIFZ_REPEAT_TARGET = "q_hifz_repeat_target_v1";
const LS_HIFZ_STAGE = "q_hifzStage_v1";
const LS_HIFZ_RANGE = "q_hifzRange_v1";
const LS_HIFZ_STAGE_TREND = "q_hifz_stage_trend_v1";

const HIFZ_SCORE_MAX = 1000000000;
const HIFZ_SCORE_STAGE_MAX = HIFZ_SCORE_MAX / 10;
const HIFZ_STAGE_TREND_KEEP_DAYS = 36525;

let __hifzResultsCache = null;
let __hifzRepeatTargetCache = null;
let __hifzQuranWordCountCache = null;
const __hifzAyahWordCountCache = new Map();

function __normalizeHifzResultsMap(obj){
  return (obj && typeof obj === "object") ? obj : {};
}

function __resetHifzLocalCache(){
  __hifzResultsCache = null;
  __hifzRepeatTargetCache = null;
  __hifzQuranWordCountCache = null;
  __hifzAyahWordCountCache.clear();
}

function loadHifzResults(){
  if (__hifzResultsCache && typeof __hifzResultsCache === "object") {
    return __hifzResultsCache;
  }

  try{
    const raw = localStorage.getItem(LS_HIFZ_RESULTS);
    if (!raw) {
      __hifzResultsCache = {};
      return __hifzResultsCache;
    }

    const obj = JSON.parse(raw);
    __hifzResultsCache = __normalizeHifzResultsMap(obj);
    return __hifzResultsCache;
  }catch{
    __hifzResultsCache = {};
    return __hifzResultsCache;
  }
}

function loadHifzRepeatTarget(){
  if (Number.isFinite(__hifzRepeatTargetCache)) {
    return __hifzRepeatTargetCache;
  }

  try{
    const v = Number(localStorage.getItem(LS_HIFZ_REPEAT_TARGET) || 5);
    if (Number.isFinite(v) && v >= 1 && v <= 100) {
      __hifzRepeatTargetCache = Math.floor(v);
      return __hifzRepeatTargetCache;
    }
  }catch{}

  __hifzRepeatTargetCache = 5;
  return __hifzRepeatTargetCache;
}

function _normalizeHifzTrendStages(obj){
  const src = (obj && typeof obj === "object") ? obj : {};
  const out = {};

  for (let i = 1; i <= 10; i += 1) {
    const key = String(i);
    const n = Number(src[key]);
    out[key] = Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0;
  }

  return out;
}

function loadHifzStageTrendHistory(){
  try{
    const raw = localStorage.getItem(LS_HIFZ_STAGE_TREND);
    if (!raw) return [];

    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];

    return arr
      .map((row) => {
        const date = String(row?.date || "").trim();
        if (!date) return null;

        return {
          date,
          stages: _normalizeHifzTrendStages(row?.stages || {})
        };
      })
      .filter(Boolean)
      .slice(-HIFZ_STAGE_TREND_KEEP_DAYS);
  }catch{
    return [];
  }
}

function saveHifzStageTrendHistory(list){
  const clean = (Array.isArray(list) ? list : [])
    .map((row) => {
      const date = String(row?.date || "").trim();
      if (!date) return null;

      return {
        date,
        stages: _normalizeHifzTrendStages(row?.stages || {})
      };
    })
    .filter(Boolean)
    .slice(-HIFZ_STAGE_TREND_KEEP_DAYS);

  try{
    localStorage.setItem(LS_HIFZ_STAGE_TREND, JSON.stringify(clean));
  }catch{}
}

function getHifzStageRow(ref, stage){
  const r = String(ref || "");
  const s = /^(10|[1-9])$/.test(String(stage || "")) ? String(stage) : "1";
  if (!/^\d+:\d+$/.test(r)) return null;

  const map = loadHifzResults();
  const row = (map[r] && typeof map[r] === "object") ? map[r] : {};
  const cell = (row[s] && typeof row[s] === "object") ? row[s] : {
    state: "neutral",
    goodCount: 0
  };

  return {
    ref: r,
    stage: s,
    state: String(cell.state || "neutral"),
    goodCount: Math.max(0, Number(cell.goodCount) || 0)
  };
}

function getHifzGoodCountForRef(ref, stage){
  const row = getHifzStageRow(ref, stage);
  return row ? row.goodCount : 0;
}

function getHifzProgressRatioForRef(ref, stage){
  const target = loadHifzRepeatTarget();
  const count = getHifzGoodCountForRef(ref, stage);
  return Math.max(0, Math.min(1, count / target));
}

function getHifzAyahWordCount(ref){
  const safeRef = String(ref || "");
  if (__hifzAyahWordCountCache.has(safeRef)) {
    return __hifzAyahWordCountCache.get(safeRef) || 0;
  }

  let count = 0;
  try{
    const words = (typeof getWords === "function") ? getWords(safeRef) : [];
    count = Array.isArray(words) ? words.length : 0;
  }catch{
    count = 0;
  }

  __hifzAyahWordCountCache.set(safeRef, count);
  return count;
}

function getHifzQuranWordCount(){
  if (Number.isFinite(__hifzQuranWordCountCache) && __hifzQuranWordCountCache > 0) {
    return __hifzQuranWordCountCache;
  }

  let total = 0;
  try{
    const refs = (typeof getAllRefs === "function") ? (getAllRefs() || []) : [];
    for (const ref of refs) {
      total += getHifzAyahWordCount(ref);
    }
  }catch{
    total = 0;
  }

  __hifzQuranWordCountCache = Math.max(1, total);
  return __hifzQuranWordCountCache;
}

function getHifzScoreValue(){
  const refs = (typeof getAllRefs === "function") ? (getAllRefs() || []) : [];
  if (!refs.length) return 0;

  const totalWords = getHifzQuranWordCount();
  const pointsPerWordPerStage = HIFZ_SCORE_STAGE_MAX / Math.max(1, totalWords);

  let score = 0;

  for (const ref of refs) {
    const wordCount = getHifzAyahWordCount(ref);
    if (!wordCount) continue;

    for (let stage = 1; stage <= 10; stage += 1) {
      const ratio = Number(getHifzProgressRatioForRef(ref, String(stage)) || 0);
      if (ratio <= 0) continue;
      score += wordCount * ratio * pointsPerWordPerStage;
    }
  }

  return Math.max(0, Math.min(HIFZ_SCORE_MAX, Math.round(score)));
}

function refreshAccountHifzScoreUi(){
  const el = document.getElementById("acctHifzScoreValue");
  if (!el) return;

  const scoreNow = Math.max(0, Math.round(Number(getHifzScoreValue()) || 0));
  el.textContent = `${scoreNow}/${HIFZ_SCORE_MAX}`;
}

window.__refreshAccountHifzScore = refreshAccountHifzScoreUi;

dataPromise.then(() => {
  try { window.__refreshAccountHifzScore?.(); } catch(e) {}
});

window.addEventListener("storage", (e) => {
  if (!e) return;

  if (
    e.key === LS_HIFZ_RESULTS ||
    e.key === LS_HIFZ_REPEAT_TARGET ||
    e.key === LS_HIFZ_STAGE ||
    e.key === LS_HIFZ_RANGE
  ) {
    __resetHifzLocalCache();
    try { window.__refreshAccountHifzScore?.(); } catch(e) {}
  }

  if (e.key === LS_HIFZ_STAGE_TREND) {
    try { window.__refreshAccountHifzScore?.(); } catch(e) {}
  }
});

// ✅ Account-State: Bookmarks + Notes + Style + Favorites-Pages + Group-Titles/Map/Collapsed + Habashi Labels
function __collectLocalAccountState(){
  let bookmarks = [];
  let notes = {};
  let styleId = "";
  let surfaceId = "";
  let trainerReadRatings = {};

  // Favorites pages + grouping
  let favPresets = {};
  let favActivePreset = "actual";
  let favGroupTitles = [];
  let favGroupMap = {};
  let favGroupCollapsed = {};
  let habashiLabels = {};

  // Hifz
  let hifzResults = {};
  let hifzRepeatTarget = 5;
  let hifzStage = "1";
  let hifzRange = "5-10";
  let hifzStageTrendHistory = [];

  // ---- base keys
  try { bookmarks = JSON.parse(localStorage.getItem("q_bookmarks_v1") || "[]"); } catch { bookmarks = []; }
  try { notes = JSON.parse(localStorage.getItem("q_notes_v1") || "{}"); } catch { notes = {}; }
  try { styleId = String(localStorage.getItem(LS_STYLE_THEME) || ""); } catch { styleId = ""; }
  try { trainerReadRatings = JSON.parse(localStorage.getItem(LS_TRAINER_AYAH_RATINGS) || "{}"); } catch { trainerReadRatings = {}; }

  // ✅ NEW: Surface Theme (2. Style Button)
  try { surfaceId = String(loadSurfaceThemeId() || ""); } catch { surfaceId = ""; }

  // ---- favorites keys
  try { favPresets = JSON.parse(localStorage.getItem("q_fav_presets_v1") || "{}"); } catch { favPresets = {}; }
  try { favActivePreset = String(localStorage.getItem("q_fav_active_preset_v1") || "actual"); } catch { favActivePreset = "actual"; }
  try { favGroupTitles = JSON.parse(localStorage.getItem("q_fav_group_titles_v1") || "[]"); } catch { favGroupTitles = []; }
  try { favGroupMap = JSON.parse(localStorage.getItem("q_fav_group_map_v1") || "{}"); } catch { favGroupMap = {}; }
  try { favGroupCollapsed = JSON.parse(localStorage.getItem("q_fav_group_collapsed_v1") || "{}"); } catch { favGroupCollapsed = {}; }
  try { habashiLabels = JSON.parse(localStorage.getItem("q_habashi_labels_v1") || "{}"); } catch { habashiLabels = {}; }

  // ---- hifz keys
  try { hifzResults = JSON.parse(localStorage.getItem(LS_HIFZ_RESULTS) || "{}"); } catch { hifzResults = {}; }
  try { hifzRepeatTarget = Number(localStorage.getItem(LS_HIFZ_REPEAT_TARGET) || 5); } catch { hifzRepeatTarget = 5; }
  try { hifzStage = String(localStorage.getItem(LS_HIFZ_STAGE) || "1").trim() || "1"; } catch { hifzStage = "1"; }
  try { hifzRange = String(localStorage.getItem(LS_HIFZ_RANGE) || "5-10").trim() || "5-10"; } catch { hifzRange = "5-10"; }
  try { hifzStageTrendHistory = loadHifzStageTrendHistory(); } catch { hifzStageTrendHistory = []; }

  // ---- sanitize base
  if (!Array.isArray(bookmarks)) bookmarks = [];
  if (!notes || typeof notes !== "object") notes = {};
  if (!trainerReadRatings || typeof trainerReadRatings !== "object") trainerReadRatings = {};
  bookmarks = bookmarks.map(String).filter(r => /^\d+:\d+$/.test(r));

  const cleanNotes = {};
  for (const k of Object.keys(notes)){
    const rk = String(k);
    const v = notes[k];
    if (!/^\d+:\d+$/.test(rk)) continue;
    if (typeof v !== "string") continue;
    if (!v.trim()) continue;
    cleanNotes[rk] = v;
  }

  const cleanTrainerReadRatings = {};
  for (const k of Object.keys(trainerReadRatings)){
    const rk = String(k || "").trim();
    const row = trainerReadRatings[k];
    if (!/^\d+:\d+$/.test(rk)) continue;
    if (!row || typeof row !== "object") continue;

    const rating = String(row.rating || "").trim();
    if (rating !== "bad" && rating !== "mid" && rating !== "good") continue;

    cleanTrainerReadRatings[rk] = {
      rating,
      updatedAt: Number(row.updatedAt) || 0
    };
  }

  // ---- sanitize favorites structures (keep it tolerant)
  if (!favPresets || typeof favPresets !== "object") favPresets = {};
  if (!Array.isArray(favGroupTitles)) favGroupTitles = [];
  if (!favGroupMap || typeof favGroupMap !== "object") favGroupMap = {};
  if (!favGroupCollapsed || typeof favGroupCollapsed !== "object") favGroupCollapsed = {};
  if (!habashiLabels || typeof habashiLabels !== "object") habashiLabels = {};

  // presets: ensure arrays + valid refs
  const cleanFavPresets = {};
  for (const name of Object.keys(favPresets)){
    const arr = Array.isArray(favPresets[name]) ? favPresets[name] : [];
    const clean = arr.map(String).filter(r => /^\d+:\d+$/.test(r));
    cleanFavPresets[String(name)] = clean;
  }

  // group titles: strings only
  const cleanGroupTitles = Array.from(new Set(favGroupTitles.map(v => String(v || "").trim()).filter(Boolean)));

  // group map: string->string
  const cleanGroupMap = {};
  for (const k of Object.keys(favGroupMap)){
    const kk = String(k || "").trim();
    const vv = String(favGroupMap[k] || "").trim();
    if (!kk || !vv) continue;
    cleanGroupMap[kk] = vv;
  }

  // collapsed: title->boolean
  const cleanCollapsed = {};
  for (const k of Object.keys(favGroupCollapsed)){
    const kk = String(k || "").trim();
    if (!kk) continue;
    cleanCollapsed[kk] = !!favGroupCollapsed[k];
  }

  // habashi labels: key->string
  const cleanHabashiLabels = {};
  for (const k of Object.keys(habashiLabels)){
    const kk = String(k || "").trim();
    const vv = String(habashiLabels[k] || "").trim();
    if (!kk || !vv) continue;
    cleanHabashiLabels[kk] = vv;
  }

  // ---- sanitize hifz
  const cleanHifzResults = {};
  const rawHifz = __normalizeHifzResultsMap(hifzResults);

  for (const ref of Object.keys(rawHifz)){
    const safeRef = String(ref || "").trim();
    if (!/^\d+:\d+$/.test(safeRef)) continue;

    const row = rawHifz[ref];
    if (!row || typeof row !== "object") continue;

    const cleanRow = {};
    for (const stageKey of Object.keys(row)){
      const safeStage = String(stageKey || "").trim();
      if (!/^(10|[1-9])$/.test(safeStage)) continue;

      const cell = row[stageKey];
      if (!cell || typeof cell !== "object") continue;

      const state = String(cell.state || "neutral").trim().toLowerCase();
      const goodCount = Math.max(0, Number(cell.goodCount) || 0);

      cleanRow[safeStage] = {
        state: (state === "good" || state === "bad") ? state : "neutral",
        goodCount
      };
    }

    if (Object.keys(cleanRow).length) {
      cleanHifzResults[safeRef] = cleanRow;
    }
  }

  if (!Number.isFinite(hifzRepeatTarget) || hifzRepeatTarget < 1) hifzRepeatTarget = 5;
  hifzRepeatTarget = Math.min(100, Math.floor(hifzRepeatTarget));

  hifzStage = /^(10|[1-9])$/.test(String(hifzStage || "")) ? String(hifzStage) : "1";
  hifzRange = String(hifzRange || "").trim() || "5-10";

  const cleanHifzStageTrendHistory = loadHifzStageTrendHistory().slice(-HIFZ_STAGE_TREND_KEEP_DAYS);

  // active preset sanitize
  favActivePreset = String(favActivePreset || "").trim() || "actual";

  return {
    bookmarks,
    notes: cleanNotes,
    trainerReadRatings: cleanTrainerReadRatings,

    // ✅ BOTH style systems
    styleId,
    surfaceId,

    favPresets: cleanFavPresets,
    favActivePreset,
    favGroupTitles: cleanGroupTitles,
    favGroupMap: cleanGroupMap,
    favGroupCollapsed: cleanCollapsed,
    habashiLabels: cleanHabashiLabels,

    // ✅ HIFZ
    hifzResults: cleanHifzResults,
    hifzRepeatTarget,
    hifzStage,
    hifzRange,
    hifzStageTrendHistory: cleanHifzStageTrendHistory,
  };
}

function __applyAccountStateToLocal(state){
  try{
    // Base
    const b = Array.isArray(state?.bookmarks) ? state.bookmarks : null;
    const n = (state?.notes && typeof state.notes === "object") ? state.notes : null;
    const s = (typeof state?.styleId === "string") ? String(state.styleId) : "";
    const rr = (state?.trainerReadRatings && typeof state.trainerReadRatings === "object") ? state.trainerReadRatings : null;

    // ✅ NEW: 2nd theme button (surface)
    const sf = (typeof state?.surfaceId === "string") ? String(state.surfaceId) : "";

    const hasHifzResults = Object.prototype.hasOwnProperty.call(state || {}, "hifzResults");
    const hasHifzRepeatTarget = Object.prototype.hasOwnProperty.call(state || {}, "hifzRepeatTarget");
    const hasHifzStage = Object.prototype.hasOwnProperty.call(state || {}, "hifzStage");
    const hasHifzRange = Object.prototype.hasOwnProperty.call(state || {}, "hifzRange");
    const hasHifzStageTrendHistory = Object.prototype.hasOwnProperty.call(state || {}, "hifzStageTrendHistory");

    if (b) localStorage.setItem("q_bookmarks_v1", JSON.stringify(b));
    if (n) localStorage.setItem("q_notes_v1", JSON.stringify(n));
    if (s) localStorage.setItem(LS_STYLE_THEME, s);
    if (rr) localStorage.setItem(LS_TRAINER_AYAH_RATINGS, JSON.stringify(rr));

    // ✅ save surface id via official helper (same key used everywhere)
    if (sf) {
      try { saveSurfaceThemeId(sf); } catch {}
    }

    // Favorites (optional/backward-compatible)
    if (state?.favPresets && typeof state.favPresets === "object") {
      localStorage.setItem(LS_FAV_PRESETS, JSON.stringify(state.favPresets));
    }
    if (typeof state?.favActivePreset === "string" && state.favActivePreset.trim()) {
      localStorage.setItem(LS_FAV_ACTIVE_PRESET, String(state.favActivePreset));
    }
    if (Array.isArray(state?.favGroupTitles)) {
      localStorage.setItem(LS_FAV_GROUP_TITLES, JSON.stringify(state.favGroupTitles));
    }
    if (state?.favGroupMap && typeof state.favGroupMap === "object") {
      localStorage.setItem(LS_FAV_GROUP_MAP, JSON.stringify(state.favGroupMap));
    }
    if (state?.favGroupCollapsed && typeof state.favGroupCollapsed === "object") {
      localStorage.setItem(LS_FAV_GROUP_COLLAPSED, JSON.stringify(state.favGroupCollapsed));
    }

    // ✅ HIFZ
    if (hasHifzResults) {
      const cleanResults = __normalizeHifzResultsMap(state?.hifzResults);
      __hifzResultsCache = cleanResults;
      localStorage.setItem(LS_HIFZ_RESULTS, JSON.stringify(cleanResults));
    }

    if (hasHifzRepeatTarget) {
      const nTarget = Math.max(1, Math.min(100, Number(state?.hifzRepeatTarget) || 5));
      __hifzRepeatTargetCache = nTarget;
      localStorage.setItem(LS_HIFZ_REPEAT_TARGET, String(nTarget));
    }

    if (hasHifzStage) {
      const safeStage = /^(10|[1-9])$/.test(String(state?.hifzStage || "")) ? String(state.hifzStage) : "1";
      localStorage.setItem(LS_HIFZ_STAGE, safeStage);
    }

    if (hasHifzRange) {
      const safeRange = String(state?.hifzRange || "").trim() || "5-10";
      localStorage.setItem(LS_HIFZ_RANGE, safeRange);
    }

    if (hasHifzStageTrendHistory) {
      saveHifzStageTrendHistory(state?.hifzStageTrendHistory || []);
    }

    // UI refresh hooks
    try { window.__refreshFavCount?.(); } catch(e) {}
    try { window.__refreshFavButtonDecor?.(); } catch(e) {}
    try { window.__refreshNoteIndicators?.(); } catch(e) {}
    try { window.__refreshAccountHifzScore?.(); } catch(e) {}

    // Wenn wir gerade in Favorites sind: Seite neu rendern
    try{
      if (typeof __inFavoritesPage !== "undefined" && __inFavoritesPage) {
        renderFavoritesPage();
      }
    }catch{}

    // Style anwenden
    try{ window.quranStyleSet?.(s); }catch{}

    // ✅ Surface anwenden (Preview=true damit kein extra Save/Sync-Loop entsteht)
    try{
      if (sf) applySurfaceThemeById(sf, { preview:true });
    }catch{}
  }catch{}
}
// Pull vom Server -> localStorage setzen
async function __accountPull(){
  if (!__isLoggedIn()) return false;

  try{
    const res = await fetch(`${ACCOUNT_API_BASE}/api/state`, {
      method: "GET",
      headers: __authHeaders(),
    });
    if (!res.ok) return false;
    const j = await res.json();
    if (!j || !j.ok) return false;

    __applyAccountStateToLocal(j.state || {});
    try { __setAccountLastSyncNow(); } catch {}
    try { window.__refreshAccountPanelMeta?.(); } catch {}
    return true;
  }catch{
    return false;
  }
}

async function __accountPush(){
  if (!__isLoggedIn()) return false;

  const payload = __collectLocalAccountState();

  try{
    const res = await fetch(`${ACCOUNT_API_BASE}/api/state`, {
      method: "PUT",
      headers: __authHeaders(),
      body: JSON.stringify({ state: payload }),
    });
    if (!res.ok) return false;
    const j = await res.json().catch(() => ({}));
    const ok = !!(j && j.ok);

    if (ok) {
      try { __setAccountLastSyncNow(); } catch {}
      try { window.__refreshAccountPanelMeta?.(); } catch {}
    }

    return ok;
  }catch{
    return false;
  }
}

// Debounced: nach Änderungen (Bookmark/Note/Style) einmal speichern
function __accountScheduleSync(){
  if (!__isLoggedIn()) return;

  if (__syncTimer) clearTimeout(__syncTimer);
  __syncTimer = setTimeout(async () => {
    __syncTimer = 0;
    if (__syncInFlight) return;
    __syncInFlight = true;
    try { await __accountPush(); } finally { __syncInFlight = false; }
  }, 350);
}

// Damit styles.js uns triggern kann:
window.__accountScheduleSync = __accountScheduleSync;

// ✅ Favorites Delta Sync (klein statt riesige favPresets zu pushen)
async function __accountSendFavEvent(ev){
  try{
    if (!__isLoggedIn()) return false;

    const res = await fetch(`${ACCOUNT_API_BASE}/api/fav-event`, {
      method: "POST",
      headers: __authHeaders(),
      body: JSON.stringify({ event: ev || {} }),
    });

    const j = await res.json().catch(() => ({}));
    return !!(res.ok && j && j.ok);
  }catch{
    return false;
  }
}

// ✅ Queue: damit Events nicht “verloren gehen”, wenn du direkt logout machst
let __favEvQ = Promise.resolve(true);

function __accountFavEventQueued(ev){
  if (!__isLoggedIn()) return Promise.resolve(false);
  __favEvQ = __favEvQ.then(() => __accountSendFavEvent(ev));
  return __favEvQ;
}

// ✅ Flush: vor Logout alles rausschieben
async function __accountFlushAll(){
  // 1) scheduled full sync sofort ausführen (falls timer läuft)
  try{
    if (__syncTimer){
      clearTimeout(__syncTimer);
      __syncTimer = 0;
      if (!__syncInFlight){
        __syncInFlight = true;
        try { await __accountPush(); } finally { __syncInFlight = false; }
      }
    }
  }catch{}

  // 2) fav-events queue abwarten
  try{ await __favEvQ; }catch{}
}

window.__accountFavEvent = __accountSendFavEvent;
window.__accountFavEventQueued = __accountFavEventQueued;
window.__accountFlushAll = __accountFlushAll;


const LS_ACCOUNT_LAST_SYNC_AT = "quranm_account_last_sync_at_v1";

function __setAccountLastSyncNow(ts = Date.now()){
  try {
    localStorage.setItem(LS_ACCOUNT_LAST_SYNC_AT, String(Number(ts) || Date.now()));
  } catch {}
  try { window.__refreshAccountPanelMeta?.(); } catch {}
}

function __formatAccountLastSync(ts){
  const n = Number(ts || 0);
  if (!Number.isFinite(n) || n <= 0) return "—";

  try{
    const d = new Date(n);
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    const mi = String(d.getMinutes()).padStart(2, "0");
    return `${dd}.${mm}., ${hh}:${mi}`;
  }catch{
    return "—";
  }
}

function __getAccountReaderScoreText(){
  const SCORE_MAX = 1000000000;
  const repeatTarget = Math.max(1, Number(loadReaderRepeatTarget?.() || 5));

  let totalSum = 0;
  let totalCount = 0;

  for (let s = 1; s <= 114; s++) {
    const refs = getSuraRefs(Number(s) || 0) || [];
    for (const ref of refs) {
      const row = getTrainerReaderRow(ref);
      const ratio = Math.max(0, Math.min(1, Number(row?.rightCount || 0) / repeatTarget));
      totalSum += ratio;
      totalCount += 1;
    }
  }

  const score = totalCount
    ? Math.max(0, Math.min(SCORE_MAX, Math.round((totalSum / totalCount) * SCORE_MAX)))
    : 0;

  return `${score}/${SCORE_MAX}`;
}

let __accountReaderScoreRefreshTimer = 0;
let __accountReaderScoreRefreshBusy = false;
let __accountReaderScoreRefreshQueued = false;

function __refreshAccountReaderScoreAsync(scoreEl){
  if (!scoreEl) return;

  try {
    if (__accountReaderScoreRefreshTimer) {
      clearTimeout(__accountReaderScoreRefreshTimer);
    }
  } catch {}

  __accountReaderScoreRefreshTimer = setTimeout(() => {
    __accountReaderScoreRefreshTimer = 0;

    if (__accountReaderScoreRefreshBusy) {
      __accountReaderScoreRefreshQueued = true;
      return;
    }

    __accountReaderScoreRefreshBusy = true;

    const finish = () => {
      __accountReaderScoreRefreshBusy = false;

      if (__accountReaderScoreRefreshQueued) {
        __accountReaderScoreRefreshQueued = false;
        __refreshAccountReaderScoreAsync(scoreEl);
      }
    };

    const run = () => {
      try {
        const nextText = __getAccountReaderScoreText();
        if (scoreEl.isConnected) {
          scoreEl.textContent = nextText;
        }
      } catch (e) {
      } finally {
        finish();
      }
    };

    try {
      if (typeof requestIdleCallback === "function") {
        requestIdleCallback(() => run(), { timeout: 120 });
      } else {
        setTimeout(run, 0);
      }
    } catch (e) {
      setTimeout(run, 0);
    }
  }, 120);
}

function __refreshAccountPanelMeta(){
  const scoreEl = document.getElementById("acctScoreValue");
  const syncStateEl = document.getElementById("acctSyncState");
  const syncTimeEl = document.getElementById("acctSyncTime");

  if (scoreEl) {
    const currentText = String(scoreEl.textContent || "").trim();
    if (!currentText) scoreEl.textContent = "…";
    __refreshAccountReaderScoreAsync(scoreEl);
  }

  try { window.__refreshAccountHifzScore?.(); } catch(e) {}

  const isLive = (() => {
    try { return !!__isLoggedIn?.(); } catch { return false; }
  })();

  if (syncStateEl) {
    syncStateEl.textContent = isLive ? "Live synced" : "Offline";
  }

  const lastSyncRaw = (() => {
    try { return localStorage.getItem(LS_ACCOUNT_LAST_SYNC_AT) || ""; } catch { return ""; }
  })();

  if (syncTimeEl) {
    syncTimeEl.textContent = __formatAccountLastSync(lastSyncRaw);
  }
}

function __normalizeAccountStateForCompare(state){
  const src = (state && typeof state === "object") ? state : {};

  const out = {
    bookmarks: [],
    notes: {},
    trainerReadRatings: {},
    styleId: "",
    surfaceId: "",
    favPresets: {},
    favActivePreset: "actual",
    favGroupTitles: [],
    favGroupMap: {},
    favGroupCollapsed: {},
    habashiLabels: {},
  };

  out.bookmarks = (Array.isArray(src.bookmarks) ? src.bookmarks : [])
    .map(String)
    .filter((r) => /^\d+:\d+$/.test(r))
    .sort();

  const notes = (src.notes && typeof src.notes === "object") ? src.notes : {};
  for (const k of Object.keys(notes).sort()) {
    const rk = String(k || "").trim();
    const v = notes[k];
    if (!/^\d+:\d+$/.test(rk)) continue;
    if (typeof v !== "string") continue;
    if (!v.trim()) continue;
    out.notes[rk] = v;
  }

  const rr = (src.trainerReadRatings && typeof src.trainerReadRatings === "object")
    ? src.trainerReadRatings
    : {};
  for (const k of Object.keys(rr).sort()) {
    const rk = String(k || "").trim();
    const row = rr[k];
    if (!/^\d+:\d+$/.test(rk)) continue;
    if (!row || typeof row !== "object") continue;

    const rating = String(row.rating || "").trim();
    if (rating !== "bad" && rating !== "mid" && rating !== "good") continue;

    out.trainerReadRatings[rk] = {
      rating,
      updatedAt: Number(row.updatedAt) || 0,
    };
  }

  out.styleId = (typeof src.styleId === "string") ? String(src.styleId) : "";
  out.surfaceId = (typeof src.surfaceId === "string") ? String(src.surfaceId) : "";
  out.favActivePreset = (typeof src.favActivePreset === "string" && src.favActivePreset.trim())
    ? String(src.favActivePreset).trim()
    : "actual";

  const favPresets = (src.favPresets && typeof src.favPresets === "object") ? src.favPresets : {};
  for (const name of Object.keys(favPresets).sort()) {
    const arr = Array.isArray(favPresets[name]) ? favPresets[name] : [];
    out.favPresets[String(name)] = arr
      .map(String)
      .filter((r) => /^\d+:\d+$/.test(r))
      .sort();
  }

  out.favGroupTitles = Array.from(
    new Set(
      (Array.isArray(src.favGroupTitles) ? src.favGroupTitles : [])
        .map((v) => String(v || "").trim())
        .filter(Boolean)
    )
  ).sort();

  const groupMap = (src.favGroupMap && typeof src.favGroupMap === "object") ? src.favGroupMap : {};
  for (const k of Object.keys(groupMap).sort()) {
    const kk = String(k || "").trim();
    const vv = String(groupMap[k] || "").trim();
    if (!kk || !vv) continue;
    out.favGroupMap[kk] = vv;
  }

  const collapsed = (src.favGroupCollapsed && typeof src.favGroupCollapsed === "object")
    ? src.favGroupCollapsed
    : {};
  for (const k of Object.keys(collapsed).sort()) {
    const kk = String(k || "").trim();
    if (!kk) continue;
    out.favGroupCollapsed[kk] = !!collapsed[k];
  }

  const habashiLabels = (src.habashiLabels && typeof src.habashiLabels === "object")
    ? src.habashiLabels
    : {};
  for (const k of Object.keys(habashiLabels).sort()) {
    const kk = String(k || "").trim();
    const vv = String(habashiLabels[k] || "").trim();
    if (!kk || !vv) continue;
    out.habashiLabels[kk] = vv;
  }

  return out;
}

function __accountStatesDiffer(localState, remoteState){
  try{
    const a = JSON.stringify(__normalizeAccountStateForCompare(localState));
    const b = JSON.stringify(__normalizeAccountStateForCompare(remoteState));
    return a !== b;
  }catch{
    return false;
  }
}

window.__refreshAccountPanelMeta = __refreshAccountPanelMeta;

// Beim Laden: wenn Token existiert -> Serverstate holen
domReady().then(() => {
  if (__isLoggedIn()){
    __accountPull().catch(()=>{});
  }
});

// =========================
// BOOKMARKS (localStorage)
// =========================
const LS_BOOKMARKS = "q_bookmarks_v1";

function loadBookmarks() {
  try {
    const raw = localStorage.getItem(LS_BOOKMARKS);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    // nur gültige refs
    return arr.filter((r) => /^\d+:\d+$/.test(String(r)));
  } catch {
    return [];
  }
}

function saveBookmarks(list) {
  try {
    const uniq = Array.from(new Set((list || []).map(String))).filter((r) => /^\d+:\d+$/.test(r));
    localStorage.setItem(LS_BOOKMARKS, JSON.stringify(uniq));

    // ✅ account sync (nur wenn eingeloggt)
    try { window.__accountScheduleSync?.(); } catch(e) {}

    return uniq;
  } catch {
    return (list || []).slice();
  }
}

function isBookmarked(ref) {
  const r = String(ref || "");
  const b = loadBookmarks();
  return b.includes(r);
}

function toggleBookmark(ref) {
  const r = String(ref || "");
  if (!/^\d+:\d+$/.test(r)) return { ok: false, bookmarked: false, list: loadBookmarks() };

  const b = loadBookmarks();
  const idx = b.indexOf(r);

  let next;
  let bookmarked;
  if (idx >= 0) {
    b.splice(idx, 1);
    next = saveBookmarks(b);
    bookmarked = false;
  } else {
    b.push(r);
    next = saveBookmarks(b);
    bookmarked = true;
  }

  // ✅ NUR actual-count updaten (Presets sind getrennt!)
  try { window.__refreshFavCount?.(); } catch(e) {}

  // ✅ NEU: Fav-Button Deko (Progress + Marks) neu berechnen
  try { window.__refreshFavButtonDecor?.(); } catch(e) {}

  return { ok: true, bookmarked, list: next };
}

// =========================
// COPY (Ayah text + 1st translation + URL)
// =========================
async function copyTextToClipboard(text) {
  const s = String(text ?? "").trim();
  if (!s) return false;

  // modern
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(s);
      return true;
    }
  } catch {}

  // fallback
  try {
    const ta = document.createElement("textarea");
    ta.value = s;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    ta.style.top = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
    return true;
  } catch {}

  return false;
}

async function buildCopyPayloadForRef(ref) {
  const a = getAyah(ref);
  if (!a) return "";

  const ar = String(a.textAr || "").trim();

  // first active translation (if loaded; else try load once)
  let tr = "";
  try {
    const first = (activeTranslations && activeTranslations[0]) ? activeTranslations[0] : null;
    if (first?.file) {
      let tJson = translationCache.get(first.file);
      if (!tJson) {
        try { tJson = await loadTranslationFile(first.file); } catch {}
      }
      if (tJson) tr = getTranslationTextFromJson(tJson, a.surah, a.ayah) || "";
    }
  } catch {}

  const url = (() => {
    // URL soll auf diese Ayah zeigen
    try {
      const base = location.href.split("#")[0];
      return `${base}#/${ref}`;
    } catch {
      return location.href;
    }
  })();

  const parts = [];
  if (ar) parts.push(ar);
  if (tr) parts.push(tr);
  parts.push(url);

  return parts.join("\n\n");
}

async function copyAyahRef(ref, { flashEl = null } = {}) {
  const payload = await buildCopyPayloadForRef(ref);
  const ok = await copyTextToClipboard(payload);

  if (flashEl) {
    flashEl.classList.add("is-copied");
    setTimeout(() => flashEl.classList.remove("is-copied"), 1000);
  }

  return ok;
}

// =========================
// NOTES (localStorage) – Ayah Notes
// =========================
const LS_NOTES = "q_notes_v1";

function loadNotesMap(){
  try{
    const raw = localStorage.getItem(LS_NOTES);
    if (!raw) return {};
    const obj = JSON.parse(raw);
    return (obj && typeof obj === "object") ? obj : {};
  }catch{
    return {};
  }
}

// ✅ Für "notes only" (Favorites Dropdown): alle Refs mit nicht-leeren Notes
function getNotesOnlyRefs(){
  try{
    const map = loadNotesMap();
    const keys = Object.keys(map || {});
    const refs = keys.filter((r) => {
      if (!/^\d+:\d+$/.test(String(r))) return false;
      const v = map?.[r];
      return (typeof v === "string") && !!v.trim();
    });
    return _sortRefs(refs);
  }catch{
    return [];
  }
}

function saveNotesMap(obj){
  try{
    localStorage.setItem(LS_NOTES, JSON.stringify(obj || {}));
  }catch{}
}

function getNoteForRef(ref){
  const r = String(ref || "");
  if (!/^\d+:\d+$/.test(r)) return "";
  const map = loadNotesMap();
  const v = map?.[r];
  return (typeof v === "string") ? v : "";
}

function setNoteForRef(ref, text){
  const r = String(ref || "");
  if (!/^\d+:\d+$/.test(r)) return;

  const t = String(text ?? "");
  const map = loadNotesMap();

  // leer => löschen
  if (!t.trim()){
    if (r in map) delete map[r];
  } else {
    map[r] = t;
  }

  saveNotesMap(map);

  // ✅ UI sofort updaten (Ayahcards + Mushaf)
  try { window.__refreshNoteIndicators?.(); } catch(e){}

  // ✅ account sync (nur wenn eingeloggt)
  try { window.__accountScheduleSync?.(); } catch(e) {}
}

// toggles CSS classes im DOM je nach Note-Existenz
window.__refreshNoteIndicators = function(){
  try{
    const map = loadNotesMap(); // ✅ 1x localStorage lesen + 1x JSON parse

    // Ayah cards
    document.querySelectorAll('button.ayahNoteBtn[data-note]').forEach((btn)=>{
      const r = String(btn.dataset?.note || "");
      const v = map?.[r];
      const has = (typeof v === "string") && !!v.trim();
      btn.classList.toggle("is-has-note", has);
    });

    // Mushaf numbers
    document.querySelectorAll('.mNo[data-ref]').forEach((noBtn)=>{
      const r = String(noBtn.getAttribute("data-ref") || "");
      const v = map?.[r];
      const has = (typeof v === "string") && !!v.trim();
      noBtn.classList.toggle("is-note", has);
    });
  }catch(e){}
};

function ensureNotesModal(){
  let ov = document.getElementById("notesOverlay");
  if (ov) return ov;

  ov = document.createElement("div");
  ov.id = "notesOverlay";
  ov.className = "notesOverlay";
  ov.innerHTML = `
    <div class="notesModal" role="dialog" aria-modal="true" aria-label="Notes">
      <div class="notesHeader">
        <div class="notesTitle">
          <span class="notesLabel">notes</span>
          <span class="notesRef" id="notesRef">—</span>
        </div>
        <button class="notesClose" id="notesClose" type="button" aria-label="Close notes" title="Close">✕</button>
      </div>

      <textarea class="notesText" id="notesText" spellcheck="false" placeholder="Write your notes here..."></textarea>

      <div class="notesFooter">
        <div class="notesHint">auto-saved</div>
      </div>
    </div>
  `;

  document.body.appendChild(ov);

  const modal = ov.querySelector(".notesModal");
  const btnClose = ov.querySelector("#notesClose");
  const refEl = ov.querySelector("#notesRef");
  const ta = ov.querySelector("#notesText");

  // Close handlers
  const close = () => {
    ov.classList.remove("is-open");
    ov.removeAttribute("data-ref");
  };

  ov.addEventListener("click", (e) => {
    // click outside modal closes
    if (e.target === ov) close();
  });

  btnClose.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    close();
  });

  window.addEventListener("keydown", (e) => {
    if (!ov.classList.contains("is-open")) return;
    if (e.key === "Escape") close();
  });

  // Auto-save (debounced)
  let saveT = 0;
  ta.addEventListener("input", () => {
    const ref = ov.getAttribute("data-ref") || "";
    if (!ref) return;

    if (saveT) clearTimeout(saveT);
    saveT = setTimeout(() => {
      setNoteForRef(ref, ta.value);
      saveT = 0;
    }, 250);
  });

  // expose helpers on element (internal)
  ov._notes = { close, refEl, ta, modal };

  return ov;
}

function openNotesForRef(ref){
  const r = String(ref || "");
  if (!/^\d+:\d+$/.test(r)) return;

  const ov = ensureNotesModal();
  const api = ov._notes;

  ov.setAttribute("data-ref", r);
  api.refEl.textContent = r;
  api.ta.value = getNoteForRef(r);

  ov.classList.add("is-open");

  // focus textarea
  try{
    api.ta.focus({ preventScroll: true });
    api.ta.setSelectionRange(api.ta.value.length, api.ta.value.length);
  }catch{}
}

// =========================
// FAVORITES PAGE (Ayah-Mode only)
// =========================
function _sortRefs(refs) {
  return (refs || [])
    .map(String)
    .filter((r) => /^\d+:\d+$/.test(r))
    .sort((a, b) => {
      const [as, aa] = a.split(":").map(Number);
      const [bs, ba] = b.split(":").map(Number);
      if (as !== bs) return as - bs;
      return aa - ba;
    });
}

function _isConsecutive(a, b) {
  const [as, aa] = String(a).split(":").map(Number);
  const [bs, ba] = String(b).split(":").map(Number);
  return as === bs && ba === aa + 1;
}

// =========================
// FAVORITES PRESETS (localStorage)
// =========================
const LS_FAV_PRESETS = "q_fav_presets_v1";
const LS_FAV_ACTIVE_PRESET = "q_fav_active_preset_v1";

// ✅ Virtual preset: zeigt alle Ayat mit Notes
const FAV_NOTES_ONLY_KEY = "__notes_only__";
const FAV_NOTES_ONLY_LABEL = "notes only";

// =========================
// HABASHI (hb-xx) UI + Labels + Locking
// =========================
const HABASHI_KEY_PREFIX = "hb-"; // hb-01, hb-02, ...
const HABASHI_GROUP_TITLE = "identify sihr/ayn threw quran"; // <- bleibt der interne Gruppen-Key
const HABASHI_GROUP_TITLE_UI = "identify sihr/ayn threw quran (Khalid al habashi presets)";
const LS_HABASHI_LABELS = "q_habashi_labels_v1"; // key -> "Pretty Name (Note)"
const LS_HABASHI_SEEDED = "q_habashi_seeded_v1"; // einmaliges Seed
const LS_FAV_GROUP_COLLAPSED = "q_fav_group_collapsed_v1"; // title -> true/false

// ✅ FIX: verhindert Crash nach Reset, wenn die Map nicht existiert.
// Wenn du später eine echte DE->EN Map hinzufügen willst, kannst du das hier ersetzen.
const HABASHI_DE_TO_EN = (typeof window !== "undefined" && window.HABASHI_DE_TO_EN)
  ? window.HABASHI_DE_TO_EN
  : {};

function isHabashiKey(name){
  const n = String(name || "").trim().toLowerCase();
  return n.startsWith(HABASHI_KEY_PREFIX) && /^hb-\d{2}$/.test(n);
}

function habashiKey(nr){
  const n = Number(nr || 0);
  if (!Number.isFinite(n) || n <= 0) return "";
  return `${HABASHI_KEY_PREFIX}${String(n).padStart(2,"0")}`;
}

// baut den UI-Label-Text (English titles + English notes in parentheses)
function habashiLabel(theme){
  const nr = Number(theme?.nr || 0);
  const key = habashiKey(nr); // -> "hb-01"

  // ✅ English titles for ALL 36 Habashi pages
  const HABASHI_TITLE_EN_BY_KEY = {
    "hb-01": "General Ruqyah",
    "hb-02": "Evil Eye & Envy",
    "hb-03": "Sihr (Magic)",
    "hb-04": "Anxiety Relief",
    "hb-05": "Harq",
    "hb-06": "Learning & Focus",
    "hb-07": "Tawhid Proof",
    "hb-08": "Marriage & Family",
    "hb-09": "Jinn Diagnosis",
    "hb-10": "Punishment Verses",
    "hb-11": "Subduing Power",
    "hb-12": "Call to Guidance",
    "hb-13": "Jewish Jinn",
    "hb-14": "Christian Jinn",
    "hb-15": "Lover Jinn",
    "hb-16": "Parents’ Rights",
    "hb-17": "Oppression Warning",
    "hb-18": "Battle Verses",
    "hb-19": "Victory & Opening",
    "hb-20": "Patience (Sabr)",
    "hb-21": "Worship Verses",
    "hb-22": "Charity Blocks",
    "hb-23": "Blessings (Ni‘ma)",
    "hb-24": "Exit & Expulsion",
    "hb-25": "Stars & Planets",
    "hb-26": "Birds",
    "hb-27": "Sea",
    "hb-28": "Mountains",
    "hb-29": "Graves & Shirk",
    "hb-30": "Walking & Legs",
    "hb-31": "Reviving (Ihya’)",
    "hb-32": "Desire & Temptation",
    "hb-33": "Knots & Fortresses",
    "hb-34": "Angels",
    "hb-35": "Provision (Rizq)",
    "hb-36": "Paradise (Jannah)",
  };

  // ✅ English notes (in parentheses) for ALL 36 Habashi pages
  const HABASHI_NOTE_EN_BY_KEY = {
    "hb-01": "General ruqyah base ayat",
    "hb-02": "Protection from envy/ayn",
    "hb-03": "Break sihr and protect",
    "hb-04": "For calmness and peace",
    "hb-05": "Burn jinn interference",
    "hb-06": "Clear learning/focus blocks",
    "hb-07": "Weaken jinn, prove truth",
    "hb-08": "Sihr/ayn in marriage",
    "hb-09": "Reveal jinn presence",
    "hb-10": "Torment and weaken jinn",
    "hb-11": "Overpower strong jinn",
    "hb-12": "Invite to guidance",
    "hb-13": "Expose/harm “Jewish” jinn",
    "hb-14": "Expose/harm “Christian” jinn",
    "hb-15": "Expose/strike lover jinn",
    "hb-16": "Break satanic influence",
    "hb-17": "Warn and push exit",
    "hb-18": "Break/kill rebellious jinn",
    "hb-19": "Victory in hard cases",
    "hb-20": "Strengthen patience, weaken",
    "hb-21": "Burn ayn/hasad effects",
    "hb-22": "Remove charity blockages",
    "hb-23": "Expose the envier",
    "hb-24": "Expel from body/home",
    "hb-25": "Astral/star-related sihr",
    "hb-26": "Reveal flying jinn",
    "hb-27": "Reveal “diver” jinn",
    "hb-28": "Caves/mountain sihr cases",
    "hb-29": "Grave sihr & shirk",
    "hb-30": "Paralysis-related cases",
    "hb-31": "Extreme weakness, coma, cancer",
    "hb-32": "Lover jinn / dawah",
    "hb-33": "Break knots/fortresses",
    "hb-34": "Harsh jinn expulsion",
    "hb-35": "Solve rizq blockages",
    "hb-36": "No content listed",
  };

  // Title: use our English map first, fallback to existing DE->EN logic
  const de = String(theme?.title_de || "").trim();
  const titleEn =
    String(HABASHI_TITLE_EN_BY_KEY[key] || "").trim() ||
    (HABASHI_DE_TO_EN[de] || de || `Preset ${nr}`);

  // Note: use our English note first, fallback to JSON note fields
  const noteFromJson =
    String(theme?.note || "").trim() ||
    String(theme?.note_de || "").trim() ||
    String(theme?.note_en || "").trim() ||
    String(theme?.comment || "").trim() ||
    String(theme?.remark || "").trim() ||
    String(theme?.purpose || "").trim() ||
    String(theme?.why || "").trim() ||
    "";

  const noteEn =
    String(HABASHI_NOTE_EN_BY_KEY[key] || "").trim() ||
    noteFromJson;

  const notePart = noteEn ? ` (${noteEn})` : "";
  return `Habashi ${String(nr).padStart(2,"0")} — ${titleEn}${notePart}`;
}

async function fetchHabashiJson(){
  // deine Datei liegt neben index.html (wie vorher)
  const tryUrls = [
    "ruqyah_themes_with_ayahs.json",
    "./ruqyah_themes_with_ayahs.json",
    "ruqyah_themes_with_ayahs (1).json",
    "./ruqyah_themes_with_ayahs (1).json",
  ];
  let lastErr = null;
  for (const u of tryUrls){
    try{
      const res = await fetch(u);
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${u}`);
      return await res.json();
    }catch(e){ lastErr = e; }
  }
  throw lastErr || new Error("Habashi JSON not found");
}

function loadHabashiLabels(){
  try{
    const raw = localStorage.getItem(LS_HABASHI_LABELS);
    if (!raw) return {};
    const obj = JSON.parse(raw);
    return (obj && typeof obj === "object") ? obj : {};
  }catch{
    return {};
  }
}

function saveHabashiLabels(obj){
  try{ localStorage.setItem(LS_HABASHI_LABELS, JSON.stringify(obj || {})); }catch{}
}

// ✅ One-time seed into localStorage (new users automatically get it)
// - Presets hb-xx anlegen (wenn fehlen)
// - unter den Habashi-Titel mappen
// - Labels mit "— Note" speichern
async function seedHabashiPresetsIfNeeded(){
  try{
    if (localStorage.getItem(LS_HABASHI_SEEDED) === "1") return;
  }catch{}

  let json = null;
  try{
    json = await fetchHabashiJson();
  }catch(e){
    // ✅ JSON optional: App darf nicht crashen.
    // ❗️Aber: NICHT als "seeded" markieren, sonst wird nach einem temporären Fehler nie wieder versucht.
    return;
  }

  const themes = Array.isArray(json?.themes) ? json.themes : [];
  if (!themes.length){
    try{ localStorage.setItem(LS_HABASHI_SEEDED, "1"); }catch{}
    return;
  }

  const presets = loadFavPresets();
  const map = loadFavGroupMap();
  const titles = loadFavGroupTitles();
  const labels = loadHabashiLabels();

  let changed = false;
  let labelsChanged = false;

  // ensure title exists
  if (!titles.includes(HABASHI_GROUP_TITLE)){
    titles.push(HABASHI_GROUP_TITLE);
    changed = true;
  }

  // helper: "ayah_refs" -> ["2:1","2:2",...]
  const expandAyahRefs = (ayahRefs) => {
    const out = [];
    const arr = Array.isArray(ayahRefs) ? ayahRefs : [];
    for (const rr of arr){
      const s = Number(rr?.surah_id || 0);
      if (!Number.isFinite(s) || s < 1 || s > 114) continue;
      const a1 = Number(rr?.ayah_start || rr?.ayah || 0);
      const a2 = Number(rr?.ayah_end || a1);
      if (!Number.isFinite(a1) || a1 <= 0) continue;

      const lo = Math.max(1, Math.min(a1, a2));
      const hi = Math.max(lo, Math.max(a1, a2));
      for (let a = lo; a <= hi; a++) out.push(`${s}:${a}`);
    }
    const uniq = Array.from(new Set(out)).filter(r => /^\d+:\d+$/.test(r));
    try{ return _sortRefs(uniq); } catch { return uniq; }
  };

  for (const t of themes){
    const key = habashiKey(t?.nr);
    if (!key) continue;

    // add preset if missing
    if (!Array.isArray(presets[key]) || presets[key].length === 0){
      presets[key] = expandAyahRefs(t?.ayah_refs);
      changed = true;
    }

    // map to title (so it appears under this title)
    if (map[key] !== HABASHI_GROUP_TITLE){
      map[key] = HABASHI_GROUP_TITLE;
      changed = true;
    }

    // pretty label speichern
    const pretty = habashiLabel(t);
    if (pretty && labels[key] !== pretty){
      labels[key] = pretty;
      labelsChanged = true;
    }
  }

  if (changed){
    saveFavPresets(presets);
    saveFavGroupMap(map);
    saveFavGroupTitles(titles);
  }
  if (labelsChanged){
    saveHabashiLabels(labels);
  }

  try{ localStorage.setItem(LS_HABASHI_SEEDED, "1"); }catch{}
}

// ✅ Optional: Wenn du irgendwo schon “Notizen/Anmerkungen” pro hb-xx hast,
// kannst du sie jederzeit so speichern:
// labels["hb-01"] = "General Ruqyah (…deine Anmerkung…)"
// Dann zeigt UI automatisch diese Namen.

function labelForGroupTitle(title){
  const t = String(title || "");
  if (t === HABASHI_GROUP_TITLE) return HABASHI_GROUP_TITLE_UI;
  return t;
}

function labelForPresetName(name){
  const n = String(name || "");
  if (n === FAV_NOTES_ONLY_KEY) return FAV_NOTES_ONLY_LABEL;

  // ✅ Habashi pages: schöner Name aus localStorage (falls vorhanden)
  if (isHabashiKey(n)){
    try{
      const labels = loadHabashiLabels();
      const v = labels?.[n];
      if (typeof v === "string" && v.trim()) return v.trim();
    }catch{}
    // fallback
    return `${n}`; // bleibt hb-01, hb-02 ... wenn noch kein Label gesetzt wurde
  }

  return n || "actual";
}

function loadFavGroupCollapsed(){
  try{
    const raw = localStorage.getItem(LS_FAV_GROUP_COLLAPSED);
    if (!raw) return {};
    const obj = JSON.parse(raw);
    return (obj && typeof obj === "object") ? obj : {};
  }catch{
    return {};
  }
}

function saveFavGroupCollapsed(obj){
  try{ localStorage.setItem(LS_FAV_GROUP_COLLAPSED, JSON.stringify(obj || {})); }catch{}

  // ✅ Delta: nur collapsed-state schicken (klein)
  try{
    window.__accountFavEvent?.({
      t: "favGroupCollapsedSet",
      value: obj || {}
    });
  }catch{}
}

function isLockedTitle(title){
  return String(title || "") === HABASHI_GROUP_TITLE;
}

function isLockedPreset(name){
  const n = String(name || "");
  if (!n) return false;
  if (n === "actual") return true;
  if (n === FAV_NOTES_ONLY_KEY) return true;
  if (isHabashiKey(n)) return true;
  return false;
}

// ✅ Beim Start direkt die zuletzt aktive Favoritenseite laden (damit favCount nach Reload stimmt)
let favPresetActiveName = loadActiveFavPreset();   // "actual" ODER preset-name aus localStorage
let favActualSnapshot = [];                        // optional: merken, was "actual" beim Öffnen war

function loadFavPresets(){
  try{
    const raw = localStorage.getItem(LS_FAV_PRESETS);
    if (!raw) return {};
    const obj = JSON.parse(raw);
    return (obj && typeof obj === "object") ? obj : {};
  }catch{
    return {};
  }
}

function saveFavPresets(obj){
  try{
    localStorage.setItem(LS_FAV_PRESETS, JSON.stringify(obj || {}));
  }catch{}

  // ❗️WICHTIG: KEIN auto full-sync mehr hier.
  // Favorites werden als Delta-Events gesynct (siehe toggleFavInActivePage / setPresetGroup / removeGroupTitle).
}

function normalizePresetName(name){
  // ✅ erlaubt deutlich längere Titel (du kannst das jederzeit erhöhen)
  const MAX_LEN = 200;

  return String(name || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, MAX_LEN);
}

function listPresetNames(presetsObj){
  return Object.keys(presetsObj || {})
    .map(normalizePresetName)
    .filter(Boolean)
    .sort((a,b)=>a.localeCompare(b));
}

function saveActiveFavPreset(name){
  try{
    const n = normalizePresetName(name) || "actual";
    localStorage.setItem(LS_FAV_ACTIVE_PRESET, n);
  }catch{}

  // ✅ account sync (nur wenn eingeloggt)
  try { window.__accountScheduleSync?.(); } catch(e) {}
}

function loadActiveFavPreset(){
  try{
    const raw = localStorage.getItem(LS_FAV_ACTIVE_PRESET);
    const n = normalizePresetName(raw);
    return n || "actual";
  }catch{
    return "actual";
  }
}

// =========================
// Favorites Groups (Titles) – localStorage + account delta sync
// =========================
const LS_FAV_GROUP_TITLES = "q_fav_group_titles_v1";   // ["Dua", "Study", ...]
const LS_FAV_GROUP_MAP    = "q_fav_group_map_v1";      // { "pageName": "Dua", ... }

function loadFavGroupTitles(){
  try{
    const raw = localStorage.getItem(LS_FAV_GROUP_TITLES);
    const arr = JSON.parse(raw || "[]");
    if (!Array.isArray(arr)) return [];
    return arr.map(normalizePresetName).filter(Boolean);
  }catch{
    return [];
  }
}

function saveFavGroupTitles(arr){
  try{
    const clean = Array.from(new Set((arr || []).map(normalizePresetName))).filter(Boolean);
    localStorage.setItem(LS_FAV_GROUP_TITLES, JSON.stringify(clean));

    // ✅ delta sync: komplette titles-liste (sehr klein)
    try{
      window.__accountFavEventQueued?.({ t:"groupTitlesSet", titles: clean, at: Date.now() });
    }catch{}

    return clean;
  }catch{
    return (arr || []).slice();
  }
}

function loadFavGroupMap(){
  try{
    const raw = localStorage.getItem(LS_FAV_GROUP_MAP);
    const obj = JSON.parse(raw || "{}");
    return (obj && typeof obj === "object") ? obj : {};
  }catch{
    return {};
  }
}

function saveFavGroupMap(obj){
  try{
    localStorage.setItem(LS_FAV_GROUP_MAP, JSON.stringify(obj || {}));
  }catch{}
}

function setPresetGroup(presetName, groupName){
  const name = normalizePresetName(presetName);
  const group = normalizePresetName(groupName);

  const map = loadFavGroupMap();
  if (!name || name === "actual") return;

  if (!group){
    delete map[name];
    saveFavGroupMap(map);

    // ✅ delta sync: ungroup
    try{
      window.__accountFavEventQueued?.({ t:"presetSetGroup", preset: name, group:"", at: Date.now() });
    }catch{}
    return;
  }

  map[name] = group;
  saveFavGroupMap(map);

  // group sicher in titles-list halten
  const titles = loadFavGroupTitles();
  if (!titles.includes(group)){
    titles.push(group);
    saveFavGroupTitles(titles);
  }

  // ✅ delta sync: set group for preset
  try{
    window.__accountFavEventQueued?.({ t:"presetSetGroup", preset: name, group, at: Date.now() });
  }catch{}
}

function removeGroupTitle(groupName){
  const g = normalizePresetName(groupName);
  if (!g) return;

  // title entfernen
  const titles = loadFavGroupTitles().filter(t => t !== g);
  saveFavGroupTitles(titles);

  // mapping cleanup
  const map = loadFavGroupMap();
  for (const k of Object.keys(map)){
    if (map[k] === g) delete map[k];
  }
  saveFavGroupMap(map);

  // ✅ delta sync: remove group server-side (entfernt auch map + collapsed)
  try{
    window.__accountFavEventQueued?.({ t:"groupRemove", group: g, at: Date.now() });
  }catch{}
}


function setActivePresetName(name){
  favPresetActiveName = normalizePresetName(name) || "actual";
  // ✅ merken, welche Seite zuletzt aktiv war
  saveActiveFavPreset(favPresetActiveName);

  // ✅ WICHTIG: favSet muss zur aktiven Seite passen (actual ODER preset-page ODER notes-only)
  try{
    favSet = new Set((getActiveFavRefs?.() || []).map(String));
  }catch(e){
    // fallback: niemals crashen
    try{ favSet = new Set(); }catch{}
  }

  // ✅ vorhandene Mushaf-Buttons sofort updaten (damit Fav-Ringe direkt erscheinen)
  try{
    document.querySelectorAll('.mNo[data-ref]').forEach((noBtn) => {
      const r = String(noBtn.getAttribute("data-ref") || "");
      noBtn.classList.toggle("is-fav", favSet.has(r));
    });
  }catch(e){}

  // ✅ Count im Statusbar-Favorites-Button updaten (passend zur aktiven Seite)
  try { window.__refreshFavCount?.(); } catch(e) {}

  // ✅ Marks/Decor sofort aktualisieren (wichtig bei preset-page Wechsel)
  try { window.__refreshFavButtonDecor?.(); } catch(e) {}
}

// ✅ Liefert IMMER nur die aktuell aktive Liste (actual ODER preset-page ODER notes-only)
function getActiveFavRefs(){
  if (!favPresetActiveName || favPresetActiveName === "actual") {
    return _sortRefs(loadBookmarks());
  }

  // ✅ "notes only" = alle Ayat, die Notes haben (unabhängig von Bookmarks/Presets)
  if (favPresetActiveName === FAV_NOTES_ONLY_KEY) {
    try { return getNotesOnlyRefs(); } catch { return []; }
  }

  const pObj = loadFavPresets();
  const arr = Array.isArray(pObj[favPresetActiveName]) ? pObj[favPresetActiveName] : [];
  return _sortRefs(arr);
}

// ✅ Toggle innerhalb der aktiven Seite
// - actual toggelt bookmarks
// - notes-only toggelt bookmarks (weil es nur ein Filter ist)
// - preset toggelt preset-array
function toggleFavInActivePage(ref){
  const r = String(ref || "");
  if (!/^\d+:\d+$/.test(r)) return { ok:false, bookmarked:false, list:[] };

  // actual + notes-only = echte bookmarks
if (!favPresetActiveName || favPresetActiveName === "actual" || favPresetActiveName === FAV_NOTES_ONLY_KEY || isHabashiKey(favPresetActiveName)) {
  const res = toggleBookmark(r);
  return res;
}

  // preset-page = nur preset ändern
  const pObj = loadFavPresets();
  const cur = _sortRefs(Array.isArray(pObj[favPresetActiveName]) ? pObj[favPresetActiveName] : []);
  const idx = cur.indexOf(r);

  let bookmarked;
  if (idx >= 0) {
    cur.splice(idx, 1);
    bookmarked = false;
  } else {
    cur.push(r);
    bookmarked = true;
  }

pObj[favPresetActiveName] = _sortRefs(cur);
saveFavPresets(pObj);

// ✅ Delta: nur EIN Ayah-Change senden
try{
  window.__accountFavEvent?.({
    t: "presetToggle",
    preset: String(favPresetActiveName || ""),
    ref: r,
    on: !!bookmarked
  });
}catch{}

  // ✅ Count im Statusbar-Favorites-Button updaten (Preset-Page hat sich geändert)
  try { window.__refreshFavCount?.(); } catch(e) {}

  // ✅ Marks/Decor neu (falls gerade Ayah/Mushaf offen ist)
  try { window.__refreshFavButtonDecor?.(); } catch(e) {}

  return { ok:true, bookmarked, list: pObj[favPresetActiveName] };
}

// =========================
// Favorites Gap Delay (CSS -> JS)
// =========================
function getFavGapMs(){
  try{
    const cs = getComputedStyle(document.documentElement);
    const raw = (cs.getPropertyValue("--fav-gap-ms") || "").trim();
    const n = parseFloat(raw);
    return Number.isFinite(n) ? n : 500;
  }catch{
    return 500;
  }
}

// =========================
// WebAudio (GainNode) – smooth fades + background-safe
// =========================
let __ac = null;
let __masterGain = null;

function __acNow(){
  try{ return (__ac && typeof __ac.currentTime === "number") ? __ac.currentTime : 0; }catch{ return 0; }
}

function __ensureAudioContext(){
  try{
    if (!__ac) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;

      __ac = new Ctx();
      __masterGain = __ac.createGain();
      __masterGain.gain.value = (typeof globalVolume === "number" && Number.isFinite(globalVolume)) ? globalVolume : 0.3;
      __masterGain.connect(__ac.destination);
    }

    // Browser kann suspended starten -> bei User-Gesture (Play-Klick) resuming klappt meist
    if (__ac.state === "suspended") {
      __ac.resume().catch(() => {});
    }
    return __ac;
  }catch{
    return null;
  }
}

function __attachVerseAudioGraph(audioEl){
  if (!audioEl) return false;
  const ac = __ensureAudioContext();
  if (!ac || !__masterGain) return false;

  // schon attached?
  if (audioEl._edgeGain && audioEl._mediaSrc) return true;

  try{
    const src = ac.createMediaElementSource(audioEl);
    const edge = ac.createGain();

    // default = 1 (wird von __initVerseFade gesetzt)
    edge.gain.value = 1;

    src.connect(edge);
    edge.connect(__masterGain);

    audioEl._mediaSrc = src;
    audioEl._edgeGain = edge;

    // Wichtig: MediaElement laut lassen, Lautstärke kommt über GainNodes
    audioEl.volume = 1;

    return true;
  }catch(e){
    // createMediaElementSource kann pro Element nur 1x funktionieren – bei Fehler fallback
    return false;
  }
}

function __setMasterGainFromGlobalVolume(){
  try{
    if (__masterGain && __masterGain.gain) {
      const v = (typeof globalVolume === "number" && Number.isFinite(globalVolume)) ? globalVolume : 0.3;
      __masterGain.gain.setValueAtTime(Math.max(0, Math.min(1, v)), __acNow());
    }
  }catch{}
}

// =========================
// Ayah Edge (Fade + "Stille") (CSS :root -> JS)
// - pro Reciter steuerbar über :root Variablen
//   NEU (empfohlen):
//     --ayah-edge-ms-default: "<fadeMs> <fadeMinMul> - <silenceMs> <silenceMul>";
//     --ayah-edge-ms-<reciterKey>: "<fadeMs> <fadeMinMul> - <silenceMs> <silenceMul>";
//       Beispiel: "500 0.5 - 50 0.5"
//         - fadeMs:       Dauer vom Fade (ms)
//         - fadeMinMul:   wie tief der Fade runtergeht (0..1)
//         - silenceMs:    Dauer der "Stille"-Phase am Anfang + Ende (ms)
//         - silenceMul:   Lautstärke in der "Stille"-Phase (0..1)  (0 = echte Stille)
//   Backward-Compat (alt):
//     "fadeMs silenceMs" oder "fadeMs silenceMs minMul"
// =========================
function getAyahEdgeProfileForReciter(reciterKey){
  const clamp01 = (x) => {
    const n = Number(x);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(1, n));
  };

  const toks = (s) => String(s || "").trim().split(/[,\s]+/).filter(Boolean);

  // Unterstützt:
  // 1) alt:  "<fadeMs> <silenceMs> <minMul>"
  // 2) neu:  "<fadeMs> <minMul> - <silenceMs> <silenceMul>"
  // 3) auch ohne "-" aber 4 Werte: "<fadeMs> <minMul> <silenceMs> <silenceMul>"
  const parseProfile = (raw) => {
    const str = String(raw || "").trim();
    if (!str) return { fadeMs: 0, silenceMs: 0, minMul: 0, silenceMul: 0 };

    let fadeMs = 0, silenceMs = 0, minMul = 0, silenceMul = 0;

    const groups = str.split("-").map(g => g.trim()).filter(Boolean);

    if (groups.length >= 2) {
      const a = toks(groups[0]); // fade group
      const b = toks(groups[1]); // silence group

      const f0 = parseFloat(a[0]);
      const f1 = (a.length >= 2) ? parseFloat(a[1]) : 0;

      const s0 = parseFloat(b[0]);
      const s1 = (b.length >= 2) ? parseFloat(b[1]) : 0;

      fadeMs = f0;
      minMul = f1;
      silenceMs = s0;
      silenceMul = s1;
    } else {
      const p = toks(groups[0]);
      const a0 = parseFloat(p[0]);
      const a1 = (p.length >= 2) ? parseFloat(p[1]) : 0;
      const a2 = (p.length >= 3) ? parseFloat(p[2]) : 0;
      const a3 = (p.length >= 4) ? parseFloat(p[3]) : 0;

      if (p.length >= 4) {
        // 4 Werte ohne "-" -> interpretieren wie: fadeMs minMul silenceMs silenceMul
        fadeMs = a0;
        minMul = a1;
        silenceMs = a2;
        silenceMul = a3;
      } else {
        // alt: fadeMs silenceMs minMul
        fadeMs = a0;
        silenceMs = a1;
        minMul = a2;
        silenceMul = 0;
      }
    }

    return {
      fadeMs: Number.isFinite(fadeMs) ? Math.max(0, fadeMs) : 0,
      silenceMs: Number.isFinite(silenceMs) ? Math.max(0, silenceMs) : 0,
      minMul: clamp01(minMul),
      silenceMul: clamp01(silenceMul),
    };
  };

  try{
    const cs = getComputedStyle(document.documentElement);
    const key = String(reciterKey || "").trim();

    if (key){
      const rawK = (cs.getPropertyValue(`--ayah-edge-ms-${key}`) || "").trim();
      if (rawK) return parseProfile(rawK);
    }

    const raw = (cs.getPropertyValue("--ayah-edge-ms-default") || "").trim();
    return parseProfile(raw);
  }catch{
    return { fadeMs: 0, silenceMs: 0, minMul: 0, silenceMul: 0 };
  }
}

function __clamp01(x){
  const n = Number(x);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

// Setzt den "Fade-Multiplikator" (0..1) und wendet ihn sofort auf die echte Lautstärke an.
// Lautstärke bleibt dabei an deinem globalVolume/Slider gekoppelt.
function __applyVerseFadeMul(audioEl, mul){
  if (!audioEl) return;
  const m = __clamp01(mul);
  audioEl._fadeMul = m;

  // ✅ Wenn WebAudio aktiv ist: Edge über GainNode (smooth + background-safe)
  const eg = audioEl._edgeGain;
  if (eg && eg.gain) {
    try{
      // MasterGain kümmert sich um globalVolume, edgeGain ist nur 0..1 Mul
      eg.gain.setValueAtTime(m, __acNow());
      // MediaElement volume auf 1 lassen, damit wir nicht doppelt multiplizieren
      audioEl.volume = 1;
      return;
    }catch{}
  }

  // Fallback (ohne WebAudio)
  try{
    const base = (typeof globalVolume === "number" && Number.isFinite(globalVolume)) ? globalVolume : 0.3;
    audioEl.volume = Math.max(0, Math.min(1, base * m));
  }catch{}
}

function __cancelVerseFadeRafs(audioEl){
  if (!audioEl) return;

  // alte RAF/timer (falls noch irgendwo)
  try{ if (audioEl._fadeInRaf)  cancelAnimationFrame(audioEl._fadeInRaf); }catch{}
  try{ if (audioEl._fadeOutRaf) cancelAnimationFrame(audioEl._fadeOutRaf); }catch{}
  audioEl._fadeInRaf = 0;
  audioEl._fadeOutRaf = 0;

  try{ if (audioEl._fadeEdgeTimer) clearInterval(audioEl._fadeEdgeTimer); }catch{}
  audioEl._fadeEdgeTimer = 0;

  // ✅ WebAudio schedules stoppen (damit keine “alten” ramps reinfunken)
  try{
    const eg = audioEl._edgeGain;
    if (eg && eg.gain) {
      const now = __acNow();
      eg.gain.cancelScheduledValues(now);
      // nicht knacken: aktuellen Wert halten
      eg.gain.setValueAtTime(__clamp01(audioEl._fadeMul ?? 1), now);
    }
  }catch{}
}

// 🔧 Wichtig: KEIN requestAnimationFrame mehr für die Fade-Logik.
// Hintergrund-Tabs drosseln/stoppen RAF → Audio kann sonst "stumm" hängen bleiben.
// Wir synchronisieren stattdessen über currentTime (wird via timeupdate + play-Event getriggert).
function __initVerseFade(audioEl, { fadeMs = 0, silenceMs = 0, minMul = 0, silenceMul = 0, queueMode = false } = {}){
  if (!audioEl) return;

  const msFade = Math.max(0, Number(fadeMs) || 0);
  const msSilence = Math.max(0, Number(silenceMs) || 0);

  const minLevel = Math.max(0, Math.min(1, Number(minMul) || 0));
  const silLevel = Math.max(0, Math.min(1, Number(silenceMul) || 0));

  __cancelVerseFadeRafs(audioEl);

  audioEl._fadeMs = msFade;
  audioEl._silenceMs = msSilence;
  audioEl._fadeMinMul = minLevel;
  audioEl._silenceMul = silLevel;
  audioEl._fadeMul = 1;

  audioEl._fadeInSilenceSec = msSilence / 1000;
  audioEl._fadeInFadeSec = msFade / 1000;

  audioEl._fadeOutSilenceSec = msSilence / 1000;
  audioEl._fadeOutFadeSec = msFade / 1000;

  audioEl._fadeCutSec = queueMode ? 0 : 0.06;

  audioEl._fadeInDone = false;
  audioEl._fadeOutDone = false;

  // ✅ WebAudio attach (wenn möglich)
  const webOk = __attachVerseAudioGraph(audioEl);

  // ✅ Startlevel:
  // - wenn silenceMs > 0 -> silenceMul
  // - sonst wenn fadeMs > 0 -> silenceMul (meist 0), und wir rammen hoch
  // - sonst -> 1
  const hasEdge = (msFade > 0) || (msSilence > 0);
  const startMul = !hasEdge ? 1 : silLevel;
  __applyVerseFadeMul(audioEl, startMul);

  // ✅ Fade-In Ramp sofort planen (smooth, ohne Stufen)
  if (webOk && audioEl._edgeGain && hasEdge) {
    try{
      const eg = audioEl._edgeGain;
      const now = __acNow();
      eg.gain.cancelScheduledValues(now);

      // kleine “safety” offset gegen clicks
      const t0 = now + 0.005;

      // Phase 1: Silence-Level halten
      const tSilEnd = t0 + (msSilence / 1000);

      eg.gain.setValueAtTime(startMul, t0);
      eg.gain.setValueAtTime(startMul, tSilEnd);

      // Phase 2: Fade-In auf 1
      if (msFade > 0) {
        eg.gain.linearRampToValueAtTime(1, tSilEnd + (msFade / 1000));
      } else {
        eg.gain.setValueAtTime(1, tSilEnd);
      }
    }catch{}
  }

  // ✅ Fade-Out planen, sobald duration sicher da ist + wir wissen wann play wirklich startet
  audioEl._needsFadeOutSchedule = hasEdge && webOk;
}

function __syncVerseEdgeMul(audioEl){
  if (!audioEl) return;

  const t = Number(audioEl.currentTime || 0);
  if (!Number.isFinite(t) || t < 0) return;

  const silenceSec = Math.max(0, Number(audioEl._fadeInSilenceSec) || 0);
  const fadeInSec = Math.max(0, Number(audioEl._fadeInFadeSec) || 0);

  const endSilenceSec = Math.max(0, Number(audioEl._fadeOutSilenceSec) || 0);
  const fadeOutSec = Math.max(0, Number(audioEl._fadeOutFadeSec) || 0);

  const silLevel = __clamp01(audioEl._silenceMul ?? 0);
  const floor = __clamp01(audioEl._fadeMinMul ?? 0);

  // 1) Start (Silence -> FadeIn -> 1)
  let mul = 1;

  const fadeInEnd = silenceSec + fadeInSec;

  if (t < silenceSec) {
    mul = silLevel;
  } else if (fadeInSec > 0 && t < fadeInEnd) {
    const p = Math.max(0, Math.min(1, (t - silenceSec) / fadeInSec));
    mul = silLevel + (1 - silLevel) * p;
  } else {
    mul = 1;
  }

  // 2) End (1 -> FadeOut->floor -> Silence(silLevel))
  const d = Number(audioEl.duration || 0);
  if (Number.isFinite(d) && d > 0) {
    const cutSec = Math.max(0, Number(audioEl._fadeCutSec || 0));
    const stopSec = Math.max(0, d - cutSec);

    const silenceStartSec = Math.max(0, stopSec - endSilenceSec);
    const fadeStartSec = Math.max(0, silenceStartSec - fadeOutSec);

    audioEl._fadeOutStartSec = fadeStartSec;
    audioEl._fadeOutSilenceStartSec = silenceStartSec;
    audioEl._fadeOutStopSec = stopSec;

    if (t >= silenceStartSec) {
      mul = silLevel;
      audioEl._fadeOutDone = true;
    } else if (fadeOutSec > 0 && t >= fadeStartSec) {
      const denom = Math.max(0.000001, (silenceStartSec - fadeStartSec));
      const p = Math.max(0, Math.min(1, (t - fadeStartSec) / denom));
      // p=0 -> 1.0, p=1 -> floor
      mul = 1 - (p * (1 - floor));
    }
  }

  __applyVerseFadeMul(audioEl, mul);
}


// =========================
// Ayah Edge Smooth Driver (Timer-only, Background-safe)
// - KEIN requestAnimationFrame (damit Background weiterläuft)
// - Smooth über setInterval (~60fps), stoppt automatisch nach Fade-In/Fade-Out
// - Wichtig: KEINE doppelte __syncVerseEdgeMul Definition mehr
// =========================
function __startFadeEdgeTimer(audioEl){
  if (!audioEl) return;
  if (audioEl._fadeEdgeTimer) return;

  audioEl._fadeEdgeTimer = setInterval(() => {
    try{
      if (!audioEl) return;
      if (audioEl.ended) { __cancelVerseFadeRafs(audioEl); return; }
      if (audioEl.paused || audioEl.seeking) return;

      __syncVerseEdgeMul(audioEl);

      // Wenn wir sicher “fertig” sind, Timer beenden
      if (audioEl._fadeInDone && audioEl._fadeOutDone) {
        __cancelVerseFadeRafs(audioEl);
      }
    }catch{}
  }, 16);
}

function __maybeStartVerseFadeIn(audioEl){
  if (!audioEl) return;

  // wenn kein Edge aktiv, sofort fertig
  const startSilSec = Math.max(0, Number(audioEl._fadeInSilenceSec) || 0);
  const fadeInSec   = Math.max(0, Number(audioEl._fadeInFadeSec) || 0);
  if ((startSilSec + fadeInSec) <= 0) {
    audioEl._fadeInDone = true;
    __applyVerseFadeMul(audioEl, 1);
    return;
  }

  __startFadeEdgeTimer(audioEl);
  __syncVerseEdgeMul(audioEl);
}

function __maybeStartVerseFadeOut(audioEl){
  if (!audioEl) return;

  const fadeOutSec    = Math.max(0, Number(audioEl._fadeOutFadeSec) || 0);
  const endSilenceSec = Math.max(0, Number(audioEl._fadeOutSilenceSec) || 0);
  if ((fadeOutSec + endSilenceSec) <= 0) return;

  __startFadeEdgeTimer(audioEl);
  __syncVerseEdgeMul(audioEl);
}

// =========================
// Favorites Playback Queue (nur Favorites-Seite)
// Pause/Resume + Auto-Scroll
// =========================
let favQueueRefs = [];
let favQueueIdx = 0;
let favQueueToken = 0;
let favQueuePaused = false;
let favQueueContinueFn = null;

const LS_FAV_REPEAT = "quranm_fav_repeat_v1";
const LS_SURAH_REPEAT = "quranm_surah_repeat_v1";
const LS_VOL = "quranm_volume_v1";

let surahRepeatOn = false;
let globalVolume = 0.3;

function _loadBool(key, def=false){
  try{
    const v = localStorage.getItem(key);
    if (v === null) return def;
    return v === "1" || v === "true";
  }catch(e){ return def; }
}
function _saveBool(key, val){
  try{ localStorage.setItem(key, val ? "1" : "0"); }catch(e){}
}

/* ✅ FIX: wenn LS_VOL nicht existiert -> default benutzen (nicht 0!) */
function _loadVol(def=0.3){
  try{
    const raw = localStorage.getItem(LS_VOL);
    if (raw === null || raw === "") return def;   // <-- wichtig
    const v = Number(raw);
    if (!Number.isFinite(v)) return def;
    return Math.min(1, Math.max(0, v));
  }catch(e){ return def; }
}

function _saveVol(v){
  try{ localStorage.setItem(LS_VOL, String(v)); }catch(e){}
}
function applyGlobalVolume(){
  // ✅ WebAudio master gain (für verseAudio smooth + background-safe)
  try{ __setMasterGainFromGlobalVolume(); }catch{}

  // Fallback / Safety: falls kein WebAudio attached ist
  try{
    if (verseAudio && !verseAudio._edgeGain){
      const mul = Number(verseAudio?._fadeMul);
      const m = Number.isFinite(mul) ? Math.max(0, Math.min(1, mul)) : 1;
      verseAudio.volume = Math.max(0, Math.min(1, globalVolume * m));
    }
  }catch(e){}

  // WordAudio lassen wir wie gehabt (du kannst später auch dafür WebAudio machen)
  try{ if (wordAudio)  wordAudio.volume  = globalVolume; }catch(e){}
}
function syncSurahRepeatUI(){
  try{
    const b = document.getElementById("suraRepeat");
    if (!b) return;
    b.classList.toggle("is-on", !!surahRepeatOn);
  }catch(e){}
}

function isFavRepeatOn(){
  try { return localStorage.getItem(LS_FAV_REPEAT) === "1"; } catch { return false; }
}
function setFavRepeatOn(on){
  try { localStorage.setItem(LS_FAV_REPEAT, on ? "1" : "0"); } catch {}
}

function syncFavRepeatUI(){
  try{
    const on = isFavRepeatOn();

    // Statusbar Button
    if (favRepeatBtn) favRepeatBtn.classList.toggle("is-on", on);

    // Topbar Button (kann beim Rendern neu entstehen)
    const top = document.querySelector("button.favTopRepeat");
    if (top) top.classList.toggle("is-on", on);
  }catch(e){}
}

function setFavPauseUI(show, paused){
  const sb = document.getElementById("statusbar");
  const btn = document.getElementById("favPause");
  if (sb) sb.classList.toggle("is-fav-playing", !!show);
  if (btn){
    btn.classList.toggle("is-paused", !!paused);
    btn.setAttribute("aria-label", paused ? "Resume Favorites" : "Pause Favorites");
  }
}

function __resetSuraPlayProgressState(){
  try{
    // diese Variablen existieren bei dir (Hold-Logik in syncUI)
    __progHoldPct = 0;
    __progHoldSurah = null;
    __progTarget = 0;
    __progVis = 0;
    __progLastT = 0;
  }catch(e){}

  // ✅ Progress-Bar konsequent über transform steuern (nicht width)
  try{
    const p = document.getElementById("progress");
    if (p) p.style.transform = "scaleX(0)";
  }catch(e){}
}

function __hideSuraPlayProgress(){
  try{
    const p = document.getElementById("progress");
    if (p) p.style.transform = "scaleX(0)";
  }catch(e){}
}

function setSuraPauseUI(show, paused, opts = {}) {
  const { syncContinue = true } = opts || {};
  try{
    const sb = document.getElementById("statusbar");
    const btn = document.getElementById("suraPause");
    const rep = document.getElementById("suraRepeat");
    if (!sb || !btn) return;

    // niemals in favorites zeigen
    if (typeof __inFavoritesPage !== "undefined" && __inFavoritesPage) {
      sb.classList.remove("is-surah-playing");
      btn.classList.remove("is-paused");
      btn.style.display = "none";
      if (rep) rep.style.display = "none";
      const p = document.getElementById("progress");
      if (p) p.style.transform = "scaleX(0)";
      // ✅ Continue Buttons (optional)
      if (syncContinue) {
        try { __syncContinueButtons(); } catch(e){}
      }
      return;
    }

    // ✅ Hard-UI: niemals “zufällig” sichtbar
    sb.classList.toggle("is-surah-playing", !!show);
    btn.classList.toggle("is-paused", !!paused);
    btn.style.display = show ? "" : "none";

    // ✅ Repeat nur wenn SurahPlay läuft (und nicht STOP)
    if (rep){
      rep.style.display = show ? "" : "none";
      rep.classList.toggle("is-on", !!surahRepeatOn);
    }

    // SVG Swap (play/pause)
    const playI  = btn.querySelector(".icon-play");
    const pauseI = btn.querySelector(".icon-pause");
    if (playI && pauseI) {
      playI.style.display  = paused ? "block" : "none";
      pauseI.style.display = paused ? "none"  : "block";
    }

    // Fortschritt: wenn aus -> komplett weg
    const p = document.getElementById("progress");
    if (p && !show) p.style.transform = "scaleX(0)";

    // ✅ Continue Buttons (optional)
    if (syncContinue) {
      try { __syncContinueButtons(); } catch(e){}
    }
  }catch(e){}
}

function __syncContinueButtons(){
  try{
    const sb = document.getElementById("statusbar");
    const suraActive = !!sb && sb.classList.contains("is-surah-playing"); // ✅ true bei Play + Pause, false bei STOP
    const s = Number((typeof surahPlaying !== "undefined" && surahPlaying) ? surahPlaying : 0);

    document.querySelectorAll("button.ayahContinueBtn").forEach((btn) => {
      const bs = Number(btn.dataset?.surah || 0);
      btn.hidden = !(suraActive && s && bs === s);
    });
  }catch(e){}
}

function stopFavoritesQueue(){
  favQueueToken++;          // kill pending timeouts
  favQueueRefs = [];
  favQueueIdx = 0;
  favQueuePaused = false;
  favQueueContinueFn = null;

  // ✅ hide the separate favPause button
  setFavPauseUI(false, false);
}

// spielt genau EIN ref über topPlay button ab (queueMode=true)
function _playFavRef(topPlayBtn, ref, { onEnded } = {}){
  const a = getAyah(ref);
  if (!a) return false;

  // wichtig: playFromButton holt sich verseRefPlaying u.a. über dataset.ref
  topPlayBtn.dataset.ref = ref;

  const url = ayahMp3Url(a.surah, a.ayah);
  playFromButton(topPlayBtn, url, { queueMode: true, onEnded });
  return true;
}

// ✅ NEU: Toggle (Start / Pause / Resume)
function toggleFavoritesQueue(view){
  const topPlayBtn = view?.querySelector("button.favTopPlay");
  if (!topPlayBtn) return;

  const refs = getActiveFavRefs();
  if (!refs.length) return;

  // 1) Noch nicht aktiv -> starten
  if (!favQueueRefs.length){
    startFavoritesQueue(view);
    return;
  }
  

  // 2) Aktiv -> Pause/Resume (NICHT stop)
  // Wenn gerade kein verseAudio existiert, machen wir lieber stop (damit es nicht “hängt”)
  if (!verseAudio){
    stopFavoritesQueue();
    try { stopVerseAudio({ stopQueue: true }); } catch {}
    topPlayBtn.classList.remove("is-playing", "is-paused");
    return;
  }

  // Pause/Resume über die vorhandene “echte Wahrheit” (toggleVersePause)
  const did = (typeof toggleVersePause === "function") ? toggleVersePause() : false;

  // Wenn toggle nicht ging, dann lieber stop (sauber)
  if (!did){
    stopFavoritesQueue();
    try { stopVerseAudio({ stopQueue: true }); } catch {}
    topPlayBtn.classList.remove("is-playing", "is-paused");
    return;
  }

  // UI-State
  favQueuePaused = !!verseAudio.paused;
  topPlayBtn.classList.toggle("is-paused", favQueuePaused);
  topPlayBtn.classList.toggle("is-playing", !favQueuePaused);

  // ✅ Wenn wir während einer “Gap-Pause” pausiert hatten (also noch nichts spielt),
  // dann beim Resume wieder weiterlaufen lassen:
  if (!favQueuePaused){
    try { favQueueContinueFn?.(); } catch(e) {}
  }
  setFavPauseUI(true, favQueuePaused);
  
}

function startFavoritesQueue(view){
  const topPlayBtn = view?.querySelector("button.favTopPlay");
  if (!topPlayBtn) return;

  const refs = getActiveFavRefs();
  if (!refs.length) return;

  // reset state
favQueueRefs = refs;

// ✅ Start-Ref (vom Tick/Continue) berücksichtigen
try{
  const startRef = String(window.__favStartRef || "");
  const idx = startRef ? favQueueRefs.indexOf(startRef) : -1;
  favQueueIdx = (idx >= 0) ? idx : 0;
}catch(e){
  favQueueIdx = 0;
}
  favQueuePaused = false;
  setFavPauseUI(true, false);
try { syncFavRepeatUI(); } catch(e) {}

  const myToken = ++favQueueToken;

  topPlayBtn.classList.add("is-playing");
  topPlayBtn.classList.remove("is-paused");

  const playNext = () => {
    favQueueContinueFn = playNext;

    if (favQueueToken !== myToken) return;      // gestoppt/neu gestartet
    if (!favQueueRefs.length) return;

    // ✅ wenn pausiert: nichts schedulen
    if (favQueuePaused) return;

// Ende erreicht?
if (favQueueIdx >= favQueueRefs.length) {
  // ✅ 2000ms Pause (konfigurierbar) bevor Stop oder Repeat
  const endDelay = (() => {
    try {
      const cs = getComputedStyle(document.documentElement);
      const raw = (cs.getPropertyValue("--fav-end-gap-ms") || "").trim();
      const n = parseFloat(raw);
      return Number.isFinite(n) ? n : 2000;
    } catch {
      return 2000;
    }
  })();

  setTimeout(() => {
    if (favQueueToken !== myToken) return;
    if (favQueuePaused) return;

    if (isFavRepeatOn()) {
      favQueueIdx = 0;
      playNext();
    } else {
      stopFavoritesQueue();
      topPlayBtn.classList.remove("is-playing", "is-paused");
    }
  }, endDelay);

  return; // wichtig: jetzt nicht weiterlaufen
}

    const curRef = favQueueRefs[favQueueIdx];
    const prevRef = favQueueIdx > 0 ? favQueueRefs[favQueueIdx - 1] : null;

    // Pause nur wenn NICHT consecutive
    const needGap = prevRef && !_isConsecutive(prevRef, curRef);
    const delay = needGap ? getFavGapMs() : 0;

    const doPlay = () => {
      if (favQueueToken !== myToken) return;
      if (favQueuePaused) return;

       // ✅ Nur Fokus/Highlight – Scroll entscheidet die Auto-Gate-Logik in playFromButton()
       try{
         focusAyahCard(view, curRef, { scroll: false });
       }catch(e){}

      const ok = _playFavRef(topPlayBtn, curRef, {
        onEnded: () => {
          if (favQueueToken !== myToken) return;
          if (favQueuePaused) return;
          favQueueIdx += 1;
          playNext();
        }
      });

      // falls irgendein Ref fehlt -> skip
      if (!ok) {
        favQueueIdx += 1;
        playNext();
      }
    };

    if (delay > 0) setTimeout(doPlay, delay);
    else doPlay();
  };

  playNext();
}

function renderFavoritesPage() {
  // Always render in qView
  const view = ensureQView();
  if (!view) return;

  // Hide mushaf view if visible
  const mv = document.querySelector(".mView");
  if (mv) mv.style.display = "none";
  view.style.display = "";

  view.dataset.mode = "favorites";
  document.getElementById("statusbar")?.classList.add("is-favorites");

  const refs = getActiveFavRefs();
  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));

  // Top bar (like surahTopBar)
  let html = `
    <div class="surahTopBar favTopBar">

      <div class="surahTopLeft">
        <button class="ayahBtn ayahPlay favTopPlay" type="button" aria-label="Play Favorites"></button>

        <button class="favTopClear" type="button" aria-label="Clear Favorites" title="Clear Favorites">
          <span class="favTopClearIcon" aria-hidden="true"></span>
        </button>

        <div class="favPresetCtl" id="favPresetCtl">
          <button class="favPresetBtn" id="favPresetBtn" type="button" aria-label="Favorites preset">
            <span class="favPresetText" id="favPresetText">actual</span>
            <span class="favPresetArrow" aria-hidden="true">▼</span>
          </button>

          <button class="favPresetPlus" id="favPresetPlus" type="button" aria-label="Save new preset" title="Save preset">+</button>

          <div class="favPresetMenu" id="favPresetMenu" role="listbox" aria-label="Favorites presets"></div>
        </div>
      </div>

      <div class="surahTopCenter">
        <div class="surahTitle">
          <span class="sEn">Favorites</span>
        </div>
      </div>

      <div class="surahTopRight">
        <button class="surahModeBtn" type="button" data-action="favBack" title="Back">
          <span class="modeText">Back →</span>
          <span class="modeArrow"></span>
        </button>
      </div>

    </div>

    <!-- ✅ Favorites Progress: sitzt oben in der Statusleiste (statusbar #suraProg) -->
  `;

if (!refs.length) {
  html += `<div class="favEmpty">No favorites yet.</div>`;
  view.innerHTML = html;
  try { window.__refreshNoteIndicators?.(); } catch(e){}
  

 /* (Favorites Ticks/Continue werden weiter unten nach view.innerHTML = html; gebunden) */


  applyAyahJustify(view);

  // ✅ Preset UI auch im Empty-State binden
  try{
    const ctl  = view.querySelector("#favPresetCtl");
    const btn  = view.querySelector("#favPresetBtn");
    const txt  = view.querySelector("#favPresetText");
    const menu = view.querySelector("#favPresetMenu");
    const plus = view.querySelector("#favPresetPlus");

    if (ctl && btn && txt && menu && plus) {
      function closeMenu(){ ctl.classList.remove("is-open","is-active"); }
      function openMenu(){ ctl.classList.add("is-open","is-active"); }
      function toggleMenu(){ ctl.classList.contains("is-open") ? closeMenu() : openMenu(); }

function rebuildMenu(){
  const p = loadFavPresets();
  const names = listPresetNames(p);

  const map = loadFavGroupMap();
  const titles = loadFavGroupTitles();

  const pagesFor = (title) =>
    names
      .filter(n => normalizePresetName(map?.[n] || "") === title)
      .sort((a,b)=>a.localeCompare(b));

  const loose =
    names
      .filter(n => !normalizePresetName(map?.[n] || ""))
      .sort((a,b)=>a.localeCompare(b));

  const countFor = (name) => {
    const key = String(name || "");
    if (!key || key === "actual") {
      try { return (loadBookmarks() || []).length; } catch { return 0; }
    }
    if (key === FAV_NOTES_ONLY_KEY) {
      try { return getNotesOnlyRefs().length; } catch { return 0; }
    }
    const arr = Array.isArray(p?.[key]) ? p[key] : [];
    return arr.length;
  };

  const collapsed = loadFavGroupCollapsed();

  // Habashi default collapsed
  if (collapsed[HABASHI_GROUP_TITLE] === undefined){
    collapsed[HABASHI_GROUP_TITLE] = true;
    saveFavGroupCollapsed(collapsed);
  }

  let out = "";

  // actual
  out += `
    <button class="favPresetOpt ${favPresetActiveName==="actual"?"is-active":""}" type="button" data-name="actual">
      <span class="favPresetName">actual <span class="favPresetAyCount">(${countFor("actual")})</span></span>
    </button>
  `;

  // notes-only
  out += `
    <button class="favPresetOpt ${favPresetActiveName===FAV_NOTES_ONLY_KEY?"is-active":""}" type="button" data-name="${FAV_NOTES_ONLY_KEY}">
      <span class="favPresetName">${FAV_NOTES_ONLY_LABEL} <span class="favPresetAyCount">(${countFor(FAV_NOTES_ONLY_KEY)})</span></span>
    </button>
  `;

  // Add Title+
  out += `
    <button class="favGroupAdd" type="button" data-action="addGroup">
      Add Title +
    </button>
  `;

  // ✅ 1) normale Titles (ohne Habashi)
  const normalTitles = (titles || []).filter(t => String(t) !== HABASHI_GROUP_TITLE);
  for (const t of normalTitles){
    const isCol = !!collapsed[t];
    const locked = isLockedTitle(t);

    out += `
      <div class="favGroupBlock" data-group="${t}">
        <button class="favGroupHdr ${isCol ? "is-collapsed" : ""}" type="button" data-group="${t}">
          <span class="favGroupCaret" aria-hidden="true">${isCol ? "▶" : "▼"}</span>
          <span class="favGroupHdrText">${labelForGroupTitle(t)}</span>
          <span class="favGroupHdrHint" aria-hidden="true"></span>
          ${locked ? "" : `<span class="favGroupDel" data-delgroup="${t}" aria-label="Delete title" title="Delete title">✕</span>`}
        </button>

        <div class="favGroupBody" ${isCol ? 'style="display:none"' : ""}>
    `;

    for (const n of pagesFor(t)){
      const lockedPage = isLockedPreset(n);
      const hb = isHabashiKey(n);

      out += `
        <button class="favPresetOpt ${favPresetActiveName===n?"is-active":""} ${hb ? "is-habashi" : ""}"
          type="button"
          data-name="${n}"
          draggable="true"
          title="Drag this page onto a title">
          <span class="favPresetName">${labelForPresetName(n)} <span class="favPresetAyCount">(${countFor(n)})</span></span>
          ${lockedPage ? "" : `<span class="favPresetDel" data-del="${n}" aria-label="Delete page" title="Delete page">✕</span>`}
        </button>
      `;
    }

    out += `
        </div>
      </div>
    `;
  }

  // ✅ 2) Loose pages
  out += `
    <div class="favGroupBlock" data-group="">
      <button class="favGroupHdr favGroupLooseHdr" type="button" data-group="">
        <span class="favGroupCaret" aria-hidden="true">▼</span>
        <span class="favGroupHdrText">Loose pages</span>
        <span class="favGroupHdrHint">drop here</span>
      </button>
      <div class="favGroupBody">
  `;

  for (const n of loose){
    const lockedPage = isLockedPreset(n);
    const hb = isHabashiKey(n);

    out += `
      <button class="favPresetOpt ${favPresetActiveName===n?"is-active":""} ${hb ? "is-habashi" : ""}"
        type="button"
        data-name="${n}"
        draggable="true"
        title="Drag this page onto a title">
        <span class="favPresetName">${labelForPresetName(n)} <span class="favPresetAyCount">(${countFor(n)})</span></span>
        ${lockedPage ? "" : `<span class="favPresetDel" data-del="${n}" aria-label="Delete page" title="Delete page">✕</span>`}
      </button>
    `;
  }

  out += `
      </div>
    </div>
  `;

  // ✅ 3) Habashi Title ganz unten (unter Loose pages), NICHT löschbar
  if ((titles || []).includes(HABASHI_GROUP_TITLE)){
    const t = HABASHI_GROUP_TITLE;
    const isCol = !!collapsed[t];

    out += `
      <div class="favGroupBlock" data-group="${t}">
        <button class="favGroupHdr is-habashi ${isCol ? "is-collapsed" : ""}" type="button" data-group="${t}">
          <span class="favGroupCaret" aria-hidden="true">${isCol ? "▶" : "▼"}</span>
          <span class="favGroupHdrText">${labelForGroupTitle(t)}</span>
          <span class="favGroupHdrHint">drop here</span>
        </button>

        <div class="favGroupBody" ${isCol ? 'style="display:none"' : ""}>
    `;

    for (const n of pagesFor(t)){
      out += `
        <button class="favPresetOpt ${favPresetActiveName===n?"is-active":""} is-habashi"
          type="button"
          data-name="${n}"
          draggable="true"
          title="Drag this page onto a title">
          <span class="favPresetName">${labelForPresetName(n)} <span class="favPresetAyCount">(${countFor(n)})</span></span>
        </button>
      `;
    }

    out += `
        </div>
      </div>
    `;
  }

  menu.innerHTML = out;
}

      txt.textContent = labelForPresetName(favPresetActiveName);
      rebuildMenu();

      if (!btn._bound){
        btn._bound = true;
        btn.addEventListener("click", (e)=>{ e.preventDefault(); e.stopPropagation(); toggleMenu(); });
      }

      if (!menu._bound){
        menu._bound = true;
menu.addEventListener("click", (e) => {

  // ✅ 0) Collapse/Expand Titel (inkl. Klick auf Pfeil ODER Titelzeile)
  const hdr = e.target.closest?.(".favGroupHdr");
  if (hdr){
    e.preventDefault();
    e.stopPropagation();

    const groupKeyRaw = String(hdr.dataset?.group ?? "");
    // normale Titles benutzen ihren echten Titel als key in collapsed[]
    // loose pages benutzen "" als group (bleibt so)
    const titleKey = groupKeyRaw === "" ? "__loose__" : normalizePresetName(groupKeyRaw);

    const collapsed = loadFavGroupCollapsed();
    collapsed[titleKey] = !collapsed[titleKey];
    saveFavGroupCollapsed(collapsed);

    // Dropdown bleibt offen
    rebuildMenu();
    syncLabel();
    return;
  }

  // ✅ Add Title+
  const addBtn = e.target.closest?.('button[data-action="addGroup"]');
  if (addBtn){
    e.preventDefault();
    e.stopPropagation();

    const nameRaw = prompt("Title name?");
    const title = normalizePresetName(nameRaw);
    if (!title) return;

    // ❗ Habashi ist “locked” (nicht neu anlegen/überschreiben)
    if (title === HABASHI_GROUP_TITLE) return;

    const titles = loadFavGroupTitles();
    if (!titles.includes(title)){
      titles.push(title);
      saveFavGroupTitles(titles);
    }

    rebuildMenu();
    syncLabel();
    return;
  }

  // ✅ Delete TITLE (Group) click?  (X neben dem Title)
  const delGroup = e.target.closest?.(".favGroupDel");
  if (delGroup){
    e.preventDefault();
    e.stopPropagation();

    const g = delGroup.dataset?.delgroup || "";
    const group = normalizePresetName(g);
    if (!group) return;

    // ❗ locked title (Habashi) darf nicht gelöscht werden
    if (typeof isLockedTitle === "function" && isLockedTitle(group)) return;

    const ok = confirm(`Do you want to delete the title "${group}"?`);
    if (!ok) return;

    // Title löschen + pages ungroup (keine Presets löschen!)
    removeGroupTitle(group);

    rebuildMenu();
    syncLabel();
    return;
  }

  // ✅ Delete page click?  (Dropdown soll dabei NICHT schließen)
  const del = e.target.closest?.(".favPresetDel");
  if (del) {
    e.preventDefault();
    e.stopPropagation();

    const name = del.dataset?.del || "";
    if (!name) return;

    // ❗ locked presets (actual / notes-only / hb-xx) nicht löschbar
    if (typeof isLockedPreset === "function" && isLockedPreset(name)) return;

    const ok = confirm("Do you want to delete this page?");
    if (!ok) return;

    const wasActive = (favPresetActiveName === name);

    const pObj = loadFavPresets();
    delete pObj[name];
    saveFavPresets(pObj);

    // mapping cleanup
    try{
      const map = loadFavGroupMap();
      if (map && map[name]) {
        delete map[name];
        saveFavGroupMap(map);
      }
    }catch{}

    if (wasActive) {
      setActivePresetName("actual");
      renderFavoritesPage();
    }

    rebuildMenu();
    syncLabel();
    return;
  }

  // ✅ Select page (Preset)
  const btnOpt = e.target.closest?.(".favPresetOpt");
  if (btnOpt) {
    e.preventDefault();
    e.stopPropagation();

    const name = btnOpt.dataset?.name || "";
    if (!name) return;

    setActivePresetName(name);
    syncLabel();
    renderFavoritesPage();

    // Dropdown NICHT schließen (wie bisher)
    rebuildMenu();
    return;
  }

});
      }

// ✅ Drag & Drop (Touch + Mouse) – ohne HTML5 dragstart/drop
if (!menu._dndBound){
  menu._dndBound = true;

  let dragName = "";
  let dragging = false;
  let startX = 0, startY = 0;
  let activeHdr = null;

  // ✅ merken womit wir gestartet sind (wichtig für Touch: Tap soll öffnen)
  let startBtn = null;
  let startWasTouch = false;

  // ✅ Drag “Ghost” = 1:1 Kopie des gezogenen Buttons (sieht exakt gleich aus)
  let ghostEl = null;

  const DRAG_PX = 8; // erst ab 8px Bewegung wird es “Drag”, sonst “Tap”

  const ensureGhostFromBtn = (btn) => {
    try { ghostEl?.remove?.(); } catch {}
    ghostEl = null;

    if (!btn) return null;

    // ✅ Wir kopieren 1:1 den Button (Text/Struktur)
    const g = btn.cloneNode(true);

    // Delete-X weg im Ghost
    try { g.querySelectorAll(".favPresetDel").forEach(x => x.remove()); } catch {}
    try { g.removeAttribute("id"); } catch {}

    // ✅ Ghost positioning
    g.classList.add("favDragGhost");
    g.style.position = "fixed";
    g.style.left = "0px";
    g.style.top = "0px";
    g.style.margin = "0";
    g.style.zIndex = "999999";
    g.style.pointerEvents = "none";
    g.style.opacity = "0";
    g.style.transform = "translate(-9999px,-9999px)";

    // ✅ Größe wie Original
    try{
      const r = btn.getBoundingClientRect();
      g.style.width = r.width + "px";
      g.style.height = r.height + "px";
    }catch{}

    // ✅ 1:1 Styles vom Original übernehmen (inkl. Light/Dark, Font, Background, Borders, etc.)
    try{
      const cs = getComputedStyle(btn);
      const props = [
        "font", "fontFamily", "fontSize", "fontWeight", "letterSpacing", "lineHeight",
        "color",
        "background", "backgroundColor",
        "border", "borderColor", "borderWidth", "borderStyle",
        "borderRadius",
        "boxShadow",
        "padding", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
        "height", "minHeight",
        "display", "alignItems", "justifyContent", "gap",
        "textAlign", "whiteSpace"
      ];
      for (const p of props) g.style[p] = cs[p];

      // wichtig: im body kann width:auto anders laufen -> wir fixen width/height ja oben
      g.style.boxSizing = "border-box";
    }catch{}

    // ✅ optional: ganz leicht “lift”, aber theme-safe
    g.style.filter = "none";
    g.style.opacity = "0";

    document.body.appendChild(g);
    ghostEl = g;
    return ghostEl;
  };

  const showGhostFromBtn = (btn, x, y) => {
    const g = ensureGhostFromBtn(btn);
    if (!g) return;
    g.style.opacity = "1";
    // leicht versetzt, damit der Finger/Maus nicht alles verdeckt
    g.style.transform = `translate(${Math.round(x + 14)}px, ${Math.round(y + 18)}px)`;
  };

  const moveGhost = (x, y) => {
    if (!ghostEl) return;
    ghostEl.style.transform = `translate(${Math.round(x + 14)}px, ${Math.round(y + 18)}px)`;
  };

  const hideGhost = () => {
    if (!ghostEl) return;
    ghostEl.style.opacity = "0";
    ghostEl.style.transform = "translate(-9999px,-9999px)";
    try { ghostEl.remove(); } catch {}
    ghostEl = null;
  };

  const clearDrop = () => {
    try{
      menu.querySelectorAll(".favGroupHdr.is-drop").forEach(el => el.classList.remove("is-drop"));
    }catch{}
    activeHdr = null;
  };

  const hdrAt = (x, y) => {
    try{
      const el = document.elementFromPoint(x, y);
      return el?.closest?.(".favGroupHdr") || null;
    }catch{
      return null;
    }
  };

  const begin = (btn, name, x, y, wasTouch) => {
    dragName = name;
    dragging = false;
    startX = x;
    startY = y;
    clearDrop();

    startBtn = btn || null;
    startWasTouch = !!wasTouch;

    // ✅ WICHTIG: Ghost NICHT sofort zeigen.
    // Erst wenn wirklich Drag startet (nach DRAG_PX).
  };

  const move = (x, y, ev) => {
    if (!dragName) return;

    const dx = x - startX;
    const dy = y - startY;

    // ✅ erst ab “echter” Bewegung Drag starten
    if (!dragging){
      if ((dx*dx + dy*dy) < (DRAG_PX*DRAG_PX)) return;
      dragging = true;

      // Ghost erst JETZT anzeigen
      if (startBtn) showGhostFromBtn(startBtn, startX, startY);
    }

    // beim echten drag: scroll/selection verhindern
    try { ev.preventDefault(); } catch {}

    const hdr = hdrAt(x, y);
    if (hdr !== activeHdr){
      clearDrop();
      if (hdr){
        hdr.classList.add("is-drop");
        activeHdr = hdr;
      }
    }

    // ✅ bei JEDEM Move nachziehen
    moveGhost(x, y);
  };

  const end = (x, y) => {
    if (!dragName) return;

    // ✅ Wenn es KEIN Drag war, war es ein Tap.
    // Auf Touch öffnen wir dann die neue Favoritenliste direkt.
    if (!dragging){
      if (startWasTouch){
        // exakt wie im Dropdown-Click: Seite aktiv setzen + rendern + Menü updaten
        setActivePresetName(dragName);
        syncLabel();
        renderFavoritesPage();
        rebuildMenu();
      }

      dragName = "";
      dragging = false;
      clearDrop();
      hideGhost();
      startBtn = null;
      startWasTouch = false;
      return;
    }

    // ✅ echtes Drag: in Gruppe droppen
    const hdr = activeHdr || hdrAt(x, y);
    if (hdr){
      const group = hdr.dataset?.group || ""; // "" = loose
      setPresetGroup(dragName, group);
      rebuildMenu();
      syncLabel();
    }

    dragName = "";
    dragging = false;
    clearDrop();
    hideGhost();
    startBtn = null;
    startWasTouch = false;
  };

  // ==========
  // Mouse
  // ==========
  menu.addEventListener("mousedown", (e) => {
    const del = e.target.closest?.(".favPresetDel");
    if (del) return; // nicht draggen wenn man auf ✕ ist

    const btn = e.target.closest?.(".favPresetOpt");
    const name = btn?.dataset?.name || "";
    if (!btn || !name || name === "actual") return;

    if (e.button !== 0) return;

    begin(btn, name, e.clientX, e.clientY, false);

    const onMove = (ev) => move(ev.clientX, ev.clientY, ev);
    const onUp = (ev) => {
      window.removeEventListener("mousemove", onMove, true);
      window.removeEventListener("mouseup", onUp, true);
      end(ev.clientX, ev.clientY);
    };

    window.addEventListener("mousemove", onMove, true);
    window.addEventListener("mouseup", onUp, true);
  }, true);

  // ==========
  // Touch
  // ==========
  menu.addEventListener("touchstart", (e) => {
    const del = e.target.closest?.(".favPresetDel");
    if (del) return;

    const btn = e.target.closest?.(".favPresetOpt");
    const name = btn?.dataset?.name || "";
    if (!btn || !name || name === "actual") return;

    const t = e.touches && e.touches[0];
    if (!t) return;

    begin(btn, name, t.clientX, t.clientY, true);
  }, { capture:true, passive:true });

  menu.addEventListener("touchmove", (e) => {
    if (!dragName) return;
    const t = e.touches && e.touches[0];
    if (!t) return;
    move(t.clientX, t.clientY, e);
  }, { capture:true, passive:false });

  menu.addEventListener("touchend", (e) => {
    if (!dragName) return;
    const t = (e.changedTouches && e.changedTouches[0]) || null;
    end(t ? t.clientX : startX, t ? t.clientY : startY);
  }, { capture:true, passive:true });

  menu.addEventListener("touchcancel", () => {
    dragName = "";
    dragging = false;
    clearDrop();
    hideGhost();
    startBtn = null;
    startWasTouch = false;
  }, { capture:true, passive:true });
}

      if (!plus._bound){
        plus._bound = true;
plus.addEventListener("click", (e)=>{
  e.preventDefault(); e.stopPropagation();

  const name = normalizePresetName(prompt("Preset name?"));
  if (!name) return;

  const refs = getActiveFavRefs(); // ✅ speichert die aktuell sichtbare Seite
  const pObj = loadFavPresets();
  pObj[name] = refs;
  saveFavPresets(pObj);

  // ✅ delta sync: nur diese eine Seite (viel kleiner als full snapshot)
  try{
    window.__accountFavEventQueued?.({ t:"presetUpsert", preset: name, refs, at: Date.now() });
  }catch{}

  setActivePresetName(name);
  txt.textContent = name;
  rebuildMenu();
});
      }

      if (!ctl._outsideBound){
        ctl._outsideBound = true;
        view.addEventListener("pointerdown", (e)=>{
          if (!ctl.classList.contains("is-open")) return;
          if (ctl.contains(e.target)) return;
          closeMenu();
        }, { capture:true, passive:true });
      }
    }
  }catch{}

  // Back button
  try {
    const backBtn = view.querySelector('button[data-action="favBack"]');
    if (backBtn) backBtn.addEventListener("click", (e) => { e.preventDefault(); closeFavoritesPage(); });
  } catch {}

  // Play/Stop (bleibt wie bei dir)
  try {
    const topPlay = view.querySelector("button.favTopPlay");
    if (topPlay) topPlay.addEventListener("click", (e) => {
      e.preventDefault();
      if (!favQueueRefs || !favQueueRefs.length) startFavoritesQueue(view);
      else { stopFavoritesQueue(); try { stopVerseAudio({ stopQueue: true }); } catch {} topPlay.classList.remove("is-playing","is-paused"); }
    });
  } catch {}

  // Repeat toggle  ✅ gekoppelt mit Statusbar #favRepeat
  try {
    const rep = view.querySelector("button.favTopRepeat");
    if (rep) {
      rep.classList.toggle("is-on", isFavRepeatOn());

      // (Sicherheit) nicht doppelt binden, falls renderFavoritesPage öfter läuft
      if (!rep._bound) {
        rep._bound = true;

        rep.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();

const next = !isFavRepeatOn();
setFavRepeatOn(next);

// ✅ nur noch einmal synchronisieren (macht Statusbar + Topbar)
try { window.__syncFavRepeatUI?.(); } catch {}
        });
      }
    }
  } catch {}

  // Clear
  try {
    const clearBtn = view.querySelector("button.favTopClear");
    if (clearBtn) clearBtn.addEventListener("click", (e) => {
      e.preventDefault(); e.stopPropagation();
      if (!confirm("ARE YOU SURE?!")) return;
      try { stopFavoritesQueue(); } catch {}
      try { stopVerseAudio({ stopQueue: true }); } catch {}
      try { saveBookmarks([]); } catch {}
      try { window.__refreshFavCount?.(); } catch {}
      renderFavoritesPage();
    });
  } catch {}

  return;
}

  const bmSetLocal =
    (favPresetActiveName === FAV_NOTES_ONLY_KEY)
      ? new Set(loadBookmarks())          // notes-only: Bookmark-Icon zeigt echte Bookmarks
      : new Set(refs);                    // actual/preset: basiert auf der aktiven Liste

  let prev = null;
  for (const r of refs) {
    if (prev && !_isConsecutive(prev, r)) {
      html += `<div class="favSep">—</div>`;
    }
    prev = r;

    const a = getAyah(r);
    if (!a) continue;

    const wordsHtml = buildWordSpans({ ...a, ayahNo: a.ayah });
    const mp3 = ayahMp3Url(a.surah, a.ayah);

html += `
  <div class="ayahCard ayahMainCard" data-ref="${a.ref}" tabindex="0">
    <div class="ayahHeaderRow">
      <div class="ayahRefRow">
        <button class="ayahBtn ayahPlay playAyah" type="button" data-audio="${mp3}" aria-label="Play Ayah"></button>
<button class="ayahBtn favContinuePlayBtn" type="button" data-ref="${a.ref}" aria-label="Continue Favorites from ${a.ref}" title="Continue from here">⟲</button>
        <div class="ayahRef">${a.ref}</div>

        <button class="ayahBtn ayahBm${bmSet.has(a.ref) ? " is-on" : ""}"
          type="button"
          data-bm="${a.ref}"
          aria-label="Bookmark ${a.ref}"
          title="Bookmark"></button>

<button class="ayahCopy ayahCopyBtn"
  type="button"
  data-copy="${a.ref}"
  aria-label="Copy ${a.ref}"
  title="Copy">
  <svg class="copyIcon" viewBox="0 0 24 24" aria-hidden="true">
    <rect x="9" y="9" width="11" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="2"></rect>
    <rect x="4" y="4" width="11" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="2"></rect>
  </svg>
</button>

<button class="ayahNote ayahNoteBtn"
  type="button"
  data-note="${a.ref}"
  aria-label="Notes ${a.ref}"
  title="Notes">
  <svg class="noteIcon" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M7 3h8a2 2 0 0 1 2 2v14l-6-3-6 3V5a2 2 0 0 1 2-2z"
      fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
    <path d="M9 7h6M9 10h6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  </svg>
</button>

<!-- ✅ SurahPlay: Continue Button (wird per JS nur bei aktiver Sura angezeigt) -->
<button class="ayahContinueBtn"
  type="button"
  data-continue="${a.ref}"
  data-surah="${a.surah}"
  data-ayah="${a.ayah}"
  aria-label="Continue ${a.ref}"
  title="Continue">
  <span class="ayahContinueIcon" aria-hidden="true">▶</span>
  <span class="ayahContinueText">continue</span>
</button>
      </div>

      <div class="ayahHeaderRight"></div>
    </div>

    <div class="ayahText">${wordsHtml}</div>

    ${buildAyahTranslationsHtml(a, esc)}

    <div class="ayahTrainerBar" data-ref="${a.ref}">
      <div class="ayahTrainerMeta">
        <div class="ayahStagePill">${getTrainerStageLabelText()}</div>
        <div class="ayahScoreHint">keys: 1 / 2 / 3</div>
      </div>

      <div class="ayahTrainerButtons" role="group" aria-label="Trainer score buttons for ${a.ref}">
        <button class="ayahScoreBtn is-bad" type="button" data-score-ref="${a.ref}" data-rating="bad" aria-label="Rate ${a.ref} as bad">1</button>
        <button class="ayahScoreBtn is-mid" type="button" data-score-ref="${a.ref}" data-rating="mid" aria-label="Rate ${a.ref} as medium">2</button>
        <button class="ayahScoreBtn is-good" type="button" data-score-ref="${a.ref}" data-rating="good" aria-label="Rate ${a.ref} as good">3</button>
      </div>
    </div>
  </div>
`;
  }

  view.innerHTML = html;
  try { window.__refreshNoteIndicators?.(); } catch(e){}

// ✅ In Favorites: Bookmark-Toggle gehört zur aktiven Seite (actual ODER preset)
  // (Dieser Block fehlte im non-empty Render -> deshalb ging ent-favoritisieren "manchmal")
  try{
    view.querySelectorAll('button.ayahBm[data-bm]').forEach((btn) => {
      if (btn._favBound) return;
      btn._favBound = true;

      btn.addEventListener("click", (e) => {
        // nur in Favorites selbst abfangen
        if (view.dataset.mode !== "favorites") return;

        e.preventDefault();
        e.stopPropagation();

        const ref = btn.dataset?.bm || "";
        const res = toggleFavInActivePage(ref);

        if (res && res.ok) {
          btn.classList.toggle("is-on", !!res.bookmarked);

          // Wenn entfernt: Seite neu rendern (damit die Ayah wirklich verschwindet + Trenner stimmen)
          if (!res.bookmarked) {
            const keepScroll = view.scrollTop || 0;
            renderFavoritesPage();
            requestAnimationFrame(() => {
              try { view.scrollTop = keepScroll; } catch {}
            });
          }
        }
      }, { passive: false });
    });
  }catch(e){}

    // =========================
  // Favorites Presets UI bind
  // =========================
  try{
    const ctl  = view.querySelector("#favPresetCtl");
    const btn  = view.querySelector("#favPresetBtn");
    const txt  = view.querySelector("#favPresetText");
    const menu = view.querySelector("#favPresetMenu");
    const plus = view.querySelector("#favPresetPlus");

    if (ctl && btn && txt && menu && plus) {
      const presets = loadFavPresets();

      function closeMenu(){
        ctl.classList.remove("is-open", "is-active");
      }

      function openMenu(){
        // ✅ erst öffnen (UI fühlt sich sofort responsive an)
        ctl.classList.add("is-open", "is-active");

        // ✅ Habashi (hb-xx) nach Reset automatisch wiederherstellen,
        // bevor wir das Dropdown-Menü final aufbauen.
        // - safe: darf NIE crashen
        // - async ohne await (damit Click-Handler nicht kaputt geht)
        try{
          Promise.resolve(seedHabashiPresetsIfNeeded?.())
            .catch(()=>{})
            .finally(() => {
              try { rebuildMenu(); } catch {}
              try { syncLabel(); } catch {}
            });
        }catch{
          // fallback: wenigstens normal rebuilden
          try { rebuildMenu(); } catch {}
          try { syncLabel(); } catch {}
        }
      }

      function toggleMenu(){
        ctl.classList.contains("is-open") ? closeMenu() : openMenu();
      }

function rebuildMenu(){
  const p = loadFavPresets();
  const names = listPresetNames(p);

  const map = loadFavGroupMap();
  const titles = loadFavGroupTitles();

  const pagesFor = (title) =>
    names
      .filter(n => normalizePresetName(map?.[n] || "") === title)
      .sort((a,b)=>a.localeCompare(b));

  const loose =
    names
      .filter(n => !normalizePresetName(map?.[n] || ""))
      .sort((a,b)=>a.localeCompare(b));

  const countFor = (name) => {
    const key = String(name || "");
    if (!key || key === "actual") {
      try { return (loadBookmarks() || []).length; } catch { return 0; }
    }
    if (key === FAV_NOTES_ONLY_KEY) {
      try { return getNotesOnlyRefs().length; } catch { return 0; }
    }
    const arr = Array.isArray(p?.[key]) ? p[key] : [];
    return arr.length;
  };

  const collapsed = loadFavGroupCollapsed();

  // Habashi default collapsed
  if (collapsed[HABASHI_GROUP_TITLE] === undefined){
    collapsed[HABASHI_GROUP_TITLE] = true;
    saveFavGroupCollapsed(collapsed);
  }

  let out = "";

  // actual
  out += `
    <button class="favPresetOpt ${favPresetActiveName==="actual"?"is-active":""}" type="button" data-name="actual">
      <span class="favPresetName">actual <span class="favPresetAyCount">(${countFor("actual")})</span></span>
    </button>
  `;

  // notes-only
  out += `
    <button class="favPresetOpt ${favPresetActiveName===FAV_NOTES_ONLY_KEY?"is-active":""}" type="button" data-name="${FAV_NOTES_ONLY_KEY}">
      <span class="favPresetName">${FAV_NOTES_ONLY_LABEL} <span class="favPresetAyCount">(${countFor(FAV_NOTES_ONLY_KEY)})</span></span>
    </button>
  `;

  // Add Title+
  out += `
    <button class="favGroupAdd" type="button" data-action="addGroup">
      Add Title +
    </button>
  `;

  // ✅ 1) normale Titles (ohne Habashi)
  const normalTitles = (titles || []).filter(t => String(t) !== HABASHI_GROUP_TITLE);
  for (const t of normalTitles){
    const isCol = !!collapsed[t];
    const locked = isLockedTitle(t);

      out += `
      <div class="favGroupBlock" data-group="${t}">
        <button class="favGroupHdr ${isCol ? "is-collapsed" : ""}" type="button" data-group="${t}">
          <span class="favGroupCaret" aria-hidden="true">${isCol ? "▶" : "▼"}</span>
          <span class="favGroupHdrText">${labelForGroupTitle(t)}</span>
          <span class="favGroupHdrHint" aria-hidden="true"></span>
          ${locked ? "" : `<span class="favGroupDel" data-delgroup="${t}" aria-label="Delete title" title="Delete title">✕</span>`}
        </button>

        <div class="favGroupBody" ${isCol ? 'style="display:none"' : ""}>
    `;

    for (const n of pagesFor(t)){
      const lockedPage = isLockedPreset(n);
      const hb = isHabashiKey(n);

      out += `
        <button class="favPresetOpt ${favPresetActiveName===n?"is-active":""} ${hb ? "is-habashi" : ""}"
          type="button"
          data-name="${n}"
          draggable="true"
          title="Drag this page onto a title">
          <span class="favPresetName">${labelForPresetName(n)} <span class="favPresetAyCount">(${countFor(n)})</span></span>
          ${lockedPage ? "" : `<span class="favPresetDel" data-del="${n}" aria-label="Delete page" title="Delete page">✕</span>`}
        </button>
      `;
    }

    out += `
        </div>
      </div>
    `;
  }

  // ✅ 2) Loose pages
  out += `
    <div class="favGroupBlock" data-group="">
      <button class="favGroupHdr favGroupLooseHdr" type="button" data-group="">
        <span class="favGroupCaret" aria-hidden="true">▼</span>
        <span class="favGroupHdrText">Loose pages</span>
        <span class="favGroupHdrHint">drop here</span>
      </button>
      <div class="favGroupBody">
  `;

  for (const n of loose){
    const lockedPage = isLockedPreset(n);
    const hb = isHabashiKey(n);

    out += `
      <button class="favPresetOpt ${favPresetActiveName===n?"is-active":""} ${hb ? "is-habashi" : ""}"
        type="button"
        data-name="${n}"
        draggable="true"
        title="Drag this page onto a title">
        <span class="favPresetName">${labelForPresetName(n)} <span class="favPresetAyCount">(${countFor(n)})</span></span>
        ${lockedPage ? "" : `<span class="favPresetDel" data-del="${n}" aria-label="Delete page" title="Delete page">✕</span>`}
      </button>
    `;
  }

  out += `
      </div>
    </div>
  `;

  // ✅ 3) Habashi Title ganz unten (unter Loose pages), NICHT löschbar
  if ((titles || []).includes(HABASHI_GROUP_TITLE)){
    const t = HABASHI_GROUP_TITLE;
    const isCol = !!collapsed[t];

    out += `
      <div class="favGroupBlock" data-group="${t}">
        <button class="favGroupHdr is-habashi ${isCol ? "is-collapsed" : ""}" type="button" data-group="${t}">
          <span class="favGroupCaret" aria-hidden="true">${isCol ? "▶" : "▼"}</span>
          <span class="favGroupHdrText">${labelForGroupTitle(t)}</span>
          <span class="favGroupHdrHint">drop here</span>
        </button>

        <div class="favGroupBody" ${isCol ? 'style="display:none"' : ""}>
    `;

    for (const n of pagesFor(t)){
      out += `
        <button class="favPresetOpt ${favPresetActiveName===n?"is-active":""} is-habashi"
          type="button"
          data-name="${n}"
          draggable="true"
          title="Drag this page onto a title">
          <span class="favPresetName">${labelForPresetName(n)} <span class="favPresetAyCount">(${countFor(n)})</span></span>
        </button>
      `;
    }

    out += `
        </div>
      </div>
    `;
  }

  menu.innerHTML = out;
}

      function syncLabel(){
        txt.textContent = labelForPresetName(favPresetActiveName);
      }

      // initial
      syncLabel();
      rebuildMenu();

      if (!btn._bound){
        btn._bound = true;
        btn.addEventListener("click", (e)=>{
          e.preventDefault();
          e.stopPropagation();
          toggleMenu();
        });
      }

menu.addEventListener("click", (e) => {

  // ✅ 1) Delete TITLE (Group) click?  (X neben dem Title)
  // MUSS VOR dem Header-Toggle kommen, sonst wird erst eingeklappt/ausgeklappt.
  const delGroup = e.target.closest?.(".favGroupDel");
  if (delGroup){
    e.preventDefault();
    e.stopPropagation();

    const g = delGroup.dataset?.delgroup || "";
    const group = normalizePresetName(g);

    // ❌ Loose pages + Habashi title dürfen NICHT gelöscht werden
    if (!group) return;
    if (typeof isLockedTitle === "function" && isLockedTitle(group)) return;

    const ok = confirm(`Do you want to delete the title "${group}"?`);
    if (!ok) return;

    // ✅ Title löschen + pages ungroup (keine Presets löschen!)
    removeGroupTitle(group);

    // Dropdown bleibt offen
    rebuildMenu();
    syncLabel();
    return;
  }

  // ✅ 2) Delete page click?  (X bei der Seite)
  // MUSS VOR dem Header-Toggle kommen, damit X NICHT einklappt/ausklappt.
  const del = e.target.closest?.(".favPresetDel");
  if (del) {
    e.preventDefault();
    e.stopPropagation();

    const name = del.dataset?.del || "";
    if (!name) return;

    // ❌ locked pages dürfen NICHT gelöscht werden (actual, notes-only, habashi, etc.)
    if (typeof isLockedPreset === "function" && isLockedPreset(name)) return;

    const ok = confirm("Do you want to delete this page?");
    if (!ok) return;

    const wasActive = (favPresetActiveName === name);

    const pObj = loadFavPresets();
    delete pObj[name];
    saveFavPresets(pObj);

    // ✅ delta sync: preset löschen
try{
  window.__accountFavEventQueued?.({ t:"presetDelete", preset: name, at: Date.now() });
}catch{}

    // mapping cleanup
    try{
      const map = loadFavGroupMap();
      if (map && map[name]) {
        delete map[name];
        saveFavGroupMap(map);
      }
    }catch{}

    if (wasActive) {
      setActivePresetName("actual");
      renderFavoritesPage();

      // ✅ Dropdown danach wieder öffnen (damit es NICHT "zu bleibt")
      setTimeout(() => {
        const c = document.querySelector(".favPresetCtl");
        if (c) c.classList.add("is-open", "is-active");
      }, 0);

      return;
    }

    // ✅ Wenn NICHT aktiv: nur Menu updaten, Dropdown bleibt offen
    rebuildMenu();
    syncLabel();
    return;
  }

  // ✅ 3) Title einklappen/ausklappen (Click auf .favGroupHdr)
  const hdrBtn = e.target.closest?.(".favGroupHdr");
  if (hdrBtn){
    e.preventDefault();
    e.stopPropagation();

    const groupRaw = hdrBtn.dataset?.group ?? "";
    const group = normalizePresetName(groupRaw);

    // "Loose pages" hat data-group="" -> wir speichern das unter einem festen Key
    const key = group ? group : "__loose__";

    const collapsed = loadFavGroupCollapsed();
    collapsed[key] = !collapsed[key];
    saveFavGroupCollapsed(collapsed);

    // Dropdown bleibt offen
    rebuildMenu();
    syncLabel();
    return;
  }

  // ✅ 4) Add Title+
  const addBtn = e.target.closest?.('button[data-action="addGroup"]');
  if (addBtn){
    e.preventDefault();
    e.stopPropagation();

    const nameRaw = prompt("Title name?");
    const title = normalizePresetName(nameRaw);
    if (!title) return;

    const titles = loadFavGroupTitles();
    if (!titles.includes(title)){
      titles.push(title);
      saveFavGroupTitles(titles);
    }

    // Dropdown bleibt offen
    rebuildMenu();
    syncLabel();
    return;
  }

  // ✅ 5) Normal select click
  const opt = e.target.closest?.(".favPresetOpt");
  if (!opt) return;

  e.preventDefault();
  e.stopPropagation();

  const name = opt.dataset?.name || "actual";

  try { stopFavoritesQueue(); } catch {}
  try { stopVerseAudio({ stopQueue: true }); } catch {}

  // ✅ WICHTIG: actual bleibt actual (KEIN saveBookmarks!)
  setActivePresetName(name);

  closeMenu();

  // ✅ Sofort rendern
  renderFavoritesPage();

  // ✅ EXTRA: beim ersten Öffnen manchmal nötig -> erzwingt sichtbares Update
  setTimeout(() => {
    try { renderFavoritesPage(); } catch {}
    try { window.__refreshFavButtonDecor?.(); } catch {}
  }, 0);
});

  // (entfernt) ✅ Delete TITLE (Group) click? war hier doppelt und hat JS gecrasht

// ✅ Drag & Drop (Touch + Mouse) – ohne HTML5 dragstart/drop
if (!menu._dndBound){
  menu._dndBound = true;

  let dragName = "";
  let dragging = false;
  let startX = 0, startY = 0;
  let activeHdr = null;

  // ✅ Drag “Ghost” = 1:1 Kopie des gezogenen Buttons (sieht exakt gleich aus)
  let ghostEl = null;

const ensureGhostFromBtn = (btn) => {
  try { ghostEl?.remove?.(); } catch {}
  ghostEl = null;

  if (!btn) return null;

  // ✅ Wir kopieren 1:1 den Button (Text/Struktur)
  const g = btn.cloneNode(true);

  // Delete-X weg im Ghost
  try { g.querySelectorAll(".favPresetDel").forEach(x => x.remove()); } catch {}
  try { g.removeAttribute("id"); } catch {}

  // ✅ Ghost positioning
  g.classList.add("favDragGhost");
  g.style.position = "fixed";
  g.style.left = "0px";
  g.style.top = "0px";
  g.style.margin = "0";
  g.style.zIndex = "999999";
  g.style.pointerEvents = "none";
  g.style.opacity = "0";
  g.style.transform = "translate(-9999px,-9999px)";

  // ✅ Größe wie Original
  try{
    const r = btn.getBoundingClientRect();
    g.style.width = r.width + "px";
    g.style.height = r.height + "px";
  }catch{}

  // ✅ 1:1 Styles vom Original übernehmen (inkl. Light/Dark, Font, Background, Borders, etc.)
  try{
    const cs = getComputedStyle(btn);
    const props = [
      "font", "fontFamily", "fontSize", "fontWeight", "letterSpacing", "lineHeight",
      "color",
      "background", "backgroundColor",
      "border", "borderColor", "borderWidth", "borderStyle",
      "borderRadius",
      "boxShadow",
      "padding", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
      "height", "minHeight",
      "display", "alignItems", "justifyContent", "gap",
      "textAlign", "whiteSpace"
    ];
    for (const p of props) g.style[p] = cs[p];

    // wichtig: im body kann width:auto anders laufen -> wir fixen width/height ja oben
    g.style.boxSizing = "border-box";
  }catch{}

  // ✅ optional: ganz leicht “lift”, aber theme-safe (kein hardcoded dunkler shadow)
  g.style.filter = "none";                 // <-- keine Farbverfälschung im White Mode
  g.style.opacity = "0";                   // wird in showGhost gesetzt

  document.body.appendChild(g);
  ghostEl = g;
  return ghostEl;
};

  const showGhostFromBtn = (btn, x, y) => {
    const g = ensureGhostFromBtn(btn);
    if (!g) return;
    g.style.opacity = "1";
    // leicht versetzt, damit der Finger/Maus nicht alles verdeckt
    g.style.transform = `translate(${Math.round(x + 14)}px, ${Math.round(y + 18)}px)`;
  };

  const moveGhost = (x, y) => {
    if (!ghostEl) return;
    ghostEl.style.transform = `translate(${Math.round(x + 14)}px, ${Math.round(y + 18)}px)`;
  };

  const hideGhost = () => {
    if (!ghostEl) return;
    ghostEl.style.opacity = "0";
    ghostEl.style.transform = "translate(-9999px,-9999px)";
    try { ghostEl.remove(); } catch {}
    ghostEl = null;
  };

  const clearDrop = () => {
    try{
      menu.querySelectorAll(".favGroupHdr.is-drop").forEach(el => el.classList.remove("is-drop"));
    }catch{}
    activeHdr = null;
  };

  const hdrAt = (x, y) => {
    try{
      const el = document.elementFromPoint(x, y);
      return el?.closest?.(".favGroupHdr") || null;
    }catch{
      return null;
    }
  };

  const begin = (btn, name, x, y) => {
    dragName = name;
    dragging = false;
    startX = x;
    startY = y;
    clearDrop();

    // ✅ Ghost sofort anzeigen (als Kopie vom Button)
    showGhostFromBtn(btn, x, y);
  };

  const move = (x, y, ev) => {
    if (!dragName) return;

    const dx = x - startX;
    const dy = y - startY;

    if (!dragging){
      if ((dx*dx + dy*dy) < (8*8)) return;
      dragging = true;
    }

    // beim echten drag: scroll/selection verhindern
    try { ev.preventDefault(); } catch {}

    const hdr = hdrAt(x, y);
    if (hdr !== activeHdr){
      clearDrop();
      if (hdr){
        hdr.classList.add("is-drop");
        activeHdr = hdr;
      }
    }

    // ✅ WICHTIG: bei JEDEM Move nachziehen (fix für Maus)
    moveGhost(x, y);
  };

  const end = (x, y) => {
    if (!dragName) return;

    if (dragging){
      const hdr = activeHdr || hdrAt(x, y);
      if (hdr){
        const group = hdr.dataset?.group || ""; // "" = loose
        setPresetGroup(dragName, group);
        rebuildMenu();
        syncLabel();
            
      }
      
    }

    dragName = "";
    dragging = false;
    clearDrop();

    hideGhost();
  };

  // ==========
  // Mouse
  // ==========
  menu.addEventListener("mousedown", (e) => {
    const del = e.target.closest?.(".favPresetDel");
    if (del) return; // nicht draggen wenn man auf ✕ ist

    const btn = e.target.closest?.(".favPresetOpt");
    const name = btn?.dataset?.name || "";
    if (!btn || !name || name === "actual") return;

    if (e.button !== 0) return;

    begin(btn, name, e.clientX, e.clientY);

    const onMove = (ev) => move(ev.clientX, ev.clientY, ev);
    const onUp = (ev) => {
      window.removeEventListener("mousemove", onMove, true);
      window.removeEventListener("mouseup", onUp, true);
      end(ev.clientX, ev.clientY);
    };

    window.addEventListener("mousemove", onMove, true);
    window.addEventListener("mouseup", onUp, true);
  }, true);

  // ==========
  // Touch
  // ==========
  menu.addEventListener("touchstart", (e) => {
    const del = e.target.closest?.(".favPresetDel");
    if (del) return;

    const btn = e.target.closest?.(".favPresetOpt");
    const name = btn?.dataset?.name || "";
    if (!btn || !name || name === "actual") return;

    const t = e.touches && e.touches[0];
    if (!t) return;

    begin(btn, name, t.clientX, t.clientY);
  }, { capture:true, passive:true });

  menu.addEventListener("touchmove", (e) => {
    if (!dragName) return;
    const t = e.touches && e.touches[0];
    if (!t) return;
    move(t.clientX, t.clientY, e);
  }, { capture:true, passive:false });

  menu.addEventListener("touchend", (e) => {
    if (!dragName) return;
    const t = (e.changedTouches && e.changedTouches[0]) || null;
    end(t ? t.clientX : startX, t ? t.clientY : startY);
  }, { capture:true, passive:true });

  menu.addEventListener("touchcancel", () => {
    dragName = "";
    dragging = false;
    clearDrop();
  }, { capture:true, passive:true });
}

      if (!plus._bound){
        plus._bound = true;
        plus.addEventListener("click", (e)=>{
          e.preventDefault();
          e.stopPropagation();

          const nameRaw = prompt("Preset name?");
          const name = normalizePresetName(nameRaw);
          if (!name) return;

          const pObj = loadFavPresets();
          pObj[name] = getActiveFavRefs(); // ✅ speichert die aktuell sichtbare Seite
          saveFavPresets(pObj);

          setActivePresetName(name);
          syncLabel();
          rebuildMenu();
        });
      }

// ✅ click outside closes (GLOBAL, damit Klick auf Statusbar auch schließt)
if (!window.__favPresetOutsideBound){
  window.__favPresetOutsideBound = true;

  document.addEventListener("pointerdown", (e) => {
    // wir suchen immer das aktuell offene ctl (weil Favorites re-rendered)
    const openCtl = document.querySelector(".favPresetCtl.is-open");
    if (!openCtl) return;

    if (openCtl.contains(e.target)) return;

    // close = Klassen entfernen (wie closeMenu)
    openCtl.classList.remove("is-open", "is-active");
  }, { capture: true, passive: true });
}
    }
  }catch(e){}

  // ✅ Clear favorites (FavTopBar) – auch im non-empty branch
try {
  const clearBtn = view.querySelector("button.favTopClear");
  if (clearBtn) clearBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();

    const ok = confirm("ARE YOU SURE?!");
    if (!ok) return;

    try { stopFavoritesQueue(); } catch {}
    try { stopVerseAudio({ stopQueue: true }); } catch {}

    try { saveBookmarks([]); } catch {}
    try { window.__refreshFavCount?.(); } catch {}

    renderFavoritesPage();
  });
} catch {}

  // Back button inside favorites topbar
  try {
    const backBtn = view.querySelector('button[data-action="favBack"]');
    if (backBtn) backBtn.addEventListener("click", (e) => { e.preventDefault(); closeFavoritesPage(); });
  } catch {}

  // Top play button = play first favorite
    // Top play button = play ALL favorites sequentially
    try {
      const topPlay = view.querySelector("button.favTopPlay");
      if (topPlay) topPlay.addEventListener("click", (e) => {
        e.preventDefault();
// ✅ nur Play/Stop (Pause kommt später als eigener Button)
if (!favQueueRefs || !favQueueRefs.length) {
  startFavoritesQueue(view);
} else {
  stopFavoritesQueue();
  try { stopVerseAudio({ stopQueue: true }); } catch {}
  topPlay.classList.remove("is-playing", "is-paused");
      }});
    } catch {}

}

function openFavoritesPage() {
  if (__inFavoritesPage) return;

    // ✅ Beim Betreten der Favoriten-Seite: ALLES andere Audio stoppen (ohne Listener)
  try { stopWordAudio(); } catch(e) {}
  try { stopVerseAudio({ stopQueue: true }); } catch(e) {}
  try { stopSurahQueue(); } catch(e) {}

  __inFavoritesPage = true;
    // ✅ Snapshot optional (actual bleibt actual)
  favActualSnapshot = _sortRefs(loadBookmarks());

  // ✅ letzte besuchte Favorites-Seite wiederherstellen
  setActivePresetName(loadActiveFavPreset());
  __favPrevViewMode = viewMode;
  __favPrevRef = currentRef;

  // Favorites page is Ayah-mode only
  viewMode = "ayah";
  try { window.__syncViewToggleBtn?.(); } catch {}

  // ✅ WICHTIG: Wenn wir aus Mushaf kommen, ist qView oft noch display:none.
  // Also: Mushaf-View ausblenden und qView sichtbar machen.
  try {
    const mv = document.querySelector(".mView");
    const qv = ensureQView();
    if (mv) mv.style.display = "none";
    if (qv) qv.style.display = "flex";
  } catch {}

  // Fav button becomes back
  try {
    const favBtnBtn = document.getElementById("favBtnBtn");
    const favText = document.getElementById("favText");
    if (favBtnBtn) favBtnBtn.classList.add("is-back");
    if (favText) favText.textContent = "Back →";
  } catch {}

  // ✅ Favorites page rendern – aber sicherstellen, dass Translations geladen sind
  const _doRenderFav = () => {
    renderFavoritesPage();
    try { window.__syncFavRepeatUI?.(); } catch(e) {}
    try { persistNavState?.(); } catch {}
  };

  // wenn Translations noch nicht “warm” sind: erst initTranslations, dann rendern
  if (!activeTranslations || activeTranslations.length === 0 || (translationCache?.size || 0) === 0) {
    try {
      Promise.resolve(initTranslations())
        .catch((e) => console.warn("[fav] initTranslations failed:", e))
        .finally(_doRenderFav);
    } catch (e) {
      console.warn("[fav] initTranslations call failed:", e);
      _doRenderFav();
    }
  } else {
    _doRenderFav();
  }
}

function closeFavoritesPage(opts = {}) {
  if (!__inFavoritesPage) return;

  const silent = !!opts.silent;

  // ✅ STOP favorites playback immer beim Verlassen
  try { stopFavoritesQueue(); } catch {}
  try { stopVerseAudio({ stopQueue: true }); } catch {}
  try { stopSurahQueue?.(); } catch {}
  try { stopWordAudio?.(); } catch {}

  // ✅ statusbar mode off
  document.getElementById("statusbar")?.classList.remove("is-favorites");
  document.getElementById("statusbar")?.classList.remove("is-fav-playing");

  __inFavoritesPage = false;

  // Restore button label
  try {
    const favBtnBtn = document.getElementById("favBtnBtn");
    const favText = document.getElementById("favText");
    if (favBtnBtn) favBtnBtn.classList.remove("is-back");
    if (favText) favText.textContent = "Favorites";
  } catch {}

  // Restore previous view mode
  viewMode = __favPrevViewMode || "ayah";
  try { window.__syncViewToggleBtn?.(); } catch {}

  // ✅ Normalfall: vorherige Ansicht wieder rendern
  // ✅ Silent-Fall: NICHT rendern (Navigation macht gleich renderCurrent / goToRef)
  if (!silent) {
    const ref = __favPrevRef || currentRef;
    renderCurrent(ref);
    try { persistNavState?.(); } catch {}
  }
}



function setSurahContext(surahNo) {
  const s = Number(surahNo);
  if (!Number.isFinite(s) || s < 1) return;

  // nur wenn wirklich geändert → ressourceschonend
  if (currentSurahInView !== s) currentSurahInView = s;

  // ✅ Dropdown-Label + Suraplay-Button synchron halten
  try { window.__refreshSurahDropdown?.(); } catch {}
  try { syncGlobalPlayStopUI?.(); } catch {}
  try {
    const playingSurah =
      (typeof surahPlaying !== "undefined" && surahPlaying) ? Number(surahPlaying) : 0;

    // ✅ wenn SurahPlay läuft, nur dann umstellen wenn es dieselbe Sura ist
    if (!playingSurah || playingSurah === s) window.__suraProgSetSurah?.(s);
  } catch {}
}


function goToRef(ref, { updateUrl = true } = {}) {
  const loose = parseRefLoose(ref);
  if (!loose) return false;

  // Wenn Daten noch laden: nur URL setzen (Renderer kommt dann nach initRouter)
  if (!dataReady) {
    if (updateUrl) setRefToHash(loose);
    dlog("router", "queued ref until data ready", loose);
    return true;
  }


  const n = normalizeRef(loose);
  if (!n) return false;

  const a = getAyah(n);
  if (!a) return false;

if (updateUrl) setRefToHash(n);

// ✅ immer die normalisierte Ref als aktuelle Wahrheit speichern
currentRef = n;

// 🟢 Sura für UI (Dropdown + Suraplay)
setSurahContext(a.surah);

// ✅ rendern + persistieren
try { __autoScrollGate = false; } catch(e) {}   // <- User-Jump soll NICHT sofort zurückspringen
renderCurrent(n);
persistNavState();

// ✅ Jump Busy aus (falls gesetzt)
try { window.__setJumpBusy?.(false); } catch(e) {}

// ✅ WICHTIG: Erfolg zurückgeben, damit doJump NICHT rot macht
return true;

}

function initRouter(defaultRef = "2:255") {
  const fromUrl = getRefFromHash();
  const persisted = loadPersistedNavState();

  // viewMode aus storage setzen (falls gültig)
  if (persisted.viewMode === "ayah" || persisted.viewMode === "mushaf") {
    viewMode = persisted.viewMode;
  }

  const last = normalizeRef(persisted.lastRef);
  const def = normalizeRef(defaultRef) || defaultRef;

  let start = null;

  if (fromUrl && getAyah(fromUrl)) {
    start = fromUrl;
  } else {
    let trainerStart = null;

    try {
      if (viewMode === "ayah") {
        trainerStart = pickTrainerNextRef() || null;
      }
    } catch (e) {}

    start =
      (trainerStart && getAyah(trainerStart)) ? trainerStart :
      (last && getAyah(last)) ? last :
      def;
  }

  currentRef = start;
  const a0 = getAyah(start);
  if (a0) currentSurahInView = a0.surah;
  if (a0) setSurahContext(a0.surah);
  renderCurrent(start);
  persistNavState();

  window.addEventListener("hashchange", () => {
    if (suppressHashRender) {
      suppressHashRender = false;
      return;
    }

    // ✅ Wenn wir gerade in der Favoritenseite sind: erst raus (ohne extra render)
    try { closeFavoritesPage?.({ silent: true }); } catch {}

    const r = getRefFromHash();
    if (r && getAyah(r)) {
      currentRef = r;
      const a1 = getAyah(r);
      if (a1) currentSurahInView = a1.surah;
      if (a1) setSurahContext(a1.surah);
      try { window.__refreshSurahDropdown?.(); } catch(e) {}
      renderCurrent(r);
      persistNavState();
    }
  });

  if (DBG.enabled) {
    window.__quranDebug = window.__quranDebug || {};
    window.__quranDebug.go = (r) => goToRef(r);
    window.__quranDebug.toggleView = () => toggleViewMode();
  }
}

window.__refreshFavCount = function(){
  try {
    const el = document.getElementById("favCount");
    if (!el) return;

    // ✅ aktiv: current preset name (falls aus irgendeinem Grund noch leer -> actual)
    const active =
      (typeof favPresetActiveName !== "undefined" && favPresetActiveName)
        ? String(favPresetActiveName)
        : "actual";

    if (active === "actual") {
      el.textContent = String((loadBookmarks()?.length || 0));
      return;
    }

    // ✅ notes-only count
    if (active === FAV_NOTES_ONLY_KEY) {
      el.textContent = String((getNotesOnlyRefs()?.length || 0));
      return;
    }

    // ✅ preset-page count
    const pObj = loadFavPresets();
    const arr = Array.isArray(pObj?.[active]) ? pObj[active] : [];
    el.textContent = String(arr.length || 0);
  } catch(e) {}
};

// Public helpers (immer verfügbar)
window.__quran = window.__quran || {};
window.__quran.bookmarks = {
  list: () => loadBookmarks(),
  toggle: (r) => toggleBookmark(r),
  has: (r) => isBookmarked(r),
  clear: () => saveBookmarks([]),
};

/* ============================================================================
   UI DEMO (Buttons) – unabhängig von Quran-Daten
============================================================================ */
  const jumpBox = document.getElementById("jumpBox");

  let jumpBadTimer = null;
  function flashJumpBad() {
    if (!jumpBox) return;
    jumpBox.classList.add("is-bad");
    if (jumpBadTimer) clearTimeout(jumpBadTimer);
    jumpBadTimer = setTimeout(() => jumpBox.classList.remove("is-bad"), 700);
  }
let playing = false;
let paused = false;

function initDemoUI() {
  const progress = document.getElementById("progress");
  const playStop = document.getElementById("playStop");
  const playPause = document.getElementById("playPause");

  // ✅ Volume + Surah Repeat (Statusbar)
  const volSlider = document.getElementById("volSlider");
  const suraRepeatBtn = document.getElementById("suraRepeat");

  // ✅ Favorites Repeat (Statusbar)
  const favRepeatBtn = document.getElementById("favRepeat");

  // ✅ Hard reset: Pause-Buttons dürfen niemals “zufällig” sichtbar sein
  try { setSuraPauseUI(false, false); } catch(e){}
  try { setFavPauseUI(false, false); } catch(e){}

// ✅ Volume: localStorage hat Vorrang + mobile-sicher speichern
try{
  const hasVol = (() => {
    try { return localStorage.getItem(LS_VOL) !== null; } catch { return false; }
  })();

  // 1) Immer aus LS laden (wenn kaputt -> default 0.3)
  globalVolume = _loadVol(0.3);

  // 2) Wenn es noch keinen LS-Wert gab: default einmalig persistieren
  if (!hasVol) _saveVol(globalVolume);

  // 3) UI + Audio synchronisieren (immer)
  const syncVolUI = () => {
    if (volSlider) volSlider.value = String(Math.round(globalVolume * 100));
    applyGlobalVolume();
  };

  // initial sync
  syncVolUI();

  // 4) Slider binding (input + change = mobile sicher)
  if (volSlider && !volSlider._bound){
    volSlider._bound = true;

    const saveFromSlider = () => {
      const v01 = Math.min(1, Math.max(0, Number(volSlider.value) / 100));
      globalVolume = v01;
      _saveVol(globalVolume);
      applyGlobalVolume();
    };

    volSlider.addEventListener("input",  saveFromSlider, { passive:true });
    volSlider.addEventListener("change", saveFromSlider, { passive:true });

    // Extra: wenn Browser “back/forward cache” nutzt -> Wert erneut aus LS ziehen
    window.addEventListener("pageshow", () => {
      globalVolume = _loadVol(0.3);
      syncVolUI();
    }, { passive:true });
  }
}catch(e){}

  // ✅ Surah Repeat: Zustand aus localStorage laden + UI sync (bleibt nach Reload)
  try{
    surahRepeatOn = _loadBool(LS_SURAH_REPEAT, false);
    syncSurahRepeatUI();

    // Extra: wenn Browser “back/forward cache” nutzt -> Zustand erneut aus LS ziehen
    if (!window.__surahRepeatPageshowBound){
      window.__surahRepeatPageshowBound = true;
      window.addEventListener("pageshow", () => {
        surahRepeatOn = _loadBool(LS_SURAH_REPEAT, false);
        syncSurahRepeatUI();
      }, { passive:true });
    }
  }catch(e){}

  // ✅ bind Surah Repeat button (darf IMMER togglen; wir merken es in localStorage)
  try{
    if (suraRepeatBtn && !suraRepeatBtn._bound){
      suraRepeatBtn._bound = true;
      suraRepeatBtn.addEventListener("click", (e)=>{
        e.preventDefault();
        e.stopPropagation();

        // in Favorites nie relevant (Button ist dort sowieso versteckt)
        if (typeof __inFavoritesPage !== "undefined" && __inFavoritesPage) return;

        surahRepeatOn = !surahRepeatOn;
        _saveBool(LS_SURAH_REPEAT, surahRepeatOn);
        syncSurahRepeatUI();
      });
    }
  }catch(e){}

  // ✅ bind Favorites Repeat button (Statusbar) -> gekoppelt an FavTopRepeat
  try{
    function syncFavRepeatUI(){
      if (!favRepeatBtn) return;
      favRepeatBtn.classList.toggle("is-on", isFavRepeatOn());
    }
    // einmal initial
    syncFavRepeatUI();

    if (favRepeatBtn && !favRepeatBtn._bound){
      favRepeatBtn._bound = true;
      favRepeatBtn.addEventListener("click", (e)=>{
        e.preventDefault();
        e.stopPropagation();

        // nur in Favorites sinnvoll
        if (typeof __inFavoritesPage === "undefined" || !__inFavoritesPage) return;

        const next = !isFavRepeatOn();
        setFavRepeatOn(next);

        // Statusbar Button UI
        favRepeatBtn.classList.toggle("is-on", next);

        // FavTopBar Button UI (falls sichtbar)
        const top = document.querySelector("button.favTopRepeat");
        if (top) top.classList.toggle("is-on", next);
      });
    }

    // verfügbar machen, damit renderFavoritesPage/openFavoritesPage es nachrendern können
    window.__syncFavRepeatUI = syncFavRepeatUI;
  }catch(e){}

  const suraProg = document.getElementById("suraProg");
  const suraProgTicks = document.getElementById("suraProgTicks");

    // ✅ Surah dropdown (Statusbar)
  const suraDrop = document.getElementById("suraDrop");
  const suraDropBtn = document.getElementById("suraDropBtn");
  const suraDropText = document.getElementById("suraDropText");
  const suraDropMenu = document.getElementById("suraDropMenu");

    // ✅ Font dropdown (Statusbar)
  const fontDrop = document.getElementById("fontDrop");
  const fontDropBtn = document.getElementById("fontDropBtn");
  const fontDropText = document.getElementById("fontDropText");
  const fontDropMenu = document.getElementById("fontDropMenu");

  // ✅ Reciter dropdown (Statusbar)
  const recDrop = document.getElementById("recDrop");
  const recDropBtn = document.getElementById("recDropBtn");
  const recDropText = document.getElementById("recDropText");
  const recDropMenu = document.getElementById("recDropMenu");

  // ✅ Translations dropdown (Statusbar)
  const trDrop = document.getElementById("trDrop");
  const trDropBtn = document.getElementById("trDropBtn");
  const trDropText = document.getElementById("trDropText");
  const trDropMenu = document.getElementById("trDropMenu");

  // ✅ Font Size (Statusbar)
  const fsCtl   = document.getElementById("fsCtl");
  const fsBtn   = document.getElementById("fsBtn");
  const fsVal   = document.getElementById("fsVal");
  const fsMinus = document.getElementById("fsMinus");
  const fsPlus  = document.getElementById("fsPlus");

  const themeBtn = document.getElementById("themeBtn");

    // ✅ Jump feedback UI (damit User sieht: er lädt/arbeitet)
  const statusbar = document.getElementById("statusbar");
  let jumpBusy = false;


  // ✅ Favorites Button (Statusbar)
const favBtnBtn = document.getElementById("favBtnBtn");
const favText   = document.getElementById("favText");
const favCount  = document.getElementById("favCount");

// ✅ Clear Favorites Button (Statusbar)
const favClearBtn = document.getElementById("favClearBtn");

if (favClearBtn && !favClearBtn._bound) {
  favClearBtn._bound = true;
  favClearBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();

    // nur sinnvoll in Favorites-Page
    if (typeof __inFavoritesPage === "undefined" || !__inFavoritesPage) return;

    const ok = confirm("ARE YOU SURE?!");
    if (!ok) return;

    // ✅ Stop Favorites playback sofort
    try { stopFavoritesQueue(); } catch {}
    try { stopVerseAudio({ stopQueue: true }); } catch {}

    // ✅ Clear bookmarks
    try { saveBookmarks([]); } catch {}
    try { window.__refreshFavCount?.(); } catch {}

    // ✅ Re-render Favorites page (zeigt dann empty state)
    try { renderFavoritesPage(); } catch {}
  });
}

  // ✅ Mushaf/Ayah Toggle Button (Statusbar)
  const viewToggleBtn = document.getElementById("viewToggleBtn");

  function syncViewToggleBtn() {
    if (!viewToggleBtn) return;

    // Favoriten-Seite zählt wie "Ayah" (weil sie in qView gerendert wird)
    const isMushaf = (viewMode === "mushaf") && !(typeof __inFavoritesPage !== "undefined" && __inFavoritesPage);
    viewToggleBtn.classList.toggle("is-mushaf", !!isMushaf);
  }

  // global verfügbar, damit toggleViewMode() / Favorites hooks es syncen können
  window.__syncViewToggleBtn = syncViewToggleBtn;

  if (viewToggleBtn && !viewToggleBtn._bound) {
    viewToggleBtn._bound = true;
    viewToggleBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();

      // Wenn wir auf der Favoriten-Seite sind: erst zurück zur normalen View
      if (typeof __inFavoritesPage !== "undefined" && __inFavoritesPage) {
        closeFavoritesPage(); // rendert die vorherige ViewMode + currentRef
        // danach togglen
      }

      toggleViewMode();       // rendert + fokussiert currentRef
      syncViewToggleBtn();
    });
  }

  // ✅ SuraPlay Tooltip (einmal)
  let suraTip = document.getElementById("suraProgTip");
  if (!suraTip) {
    suraTip = document.createElement("div");
    suraTip.id = "suraProgTip";
    suraTip.className = "suraProgTip";
    document.body.appendChild(suraTip);
  }

  // ✅ NEU: Word hover tooltip
  let wordTip = document.getElementById("wordTip");
  if (!wordTip) {
    wordTip = document.createElement("div");
    wordTip.id = "wordTip";
    wordTip.className = "qHoverTip";
    document.body.appendChild(wordTip);
  }

  // ✅ NEU: Mushaf Ayahnummer hover tooltip
  let mNoTip = document.getElementById("mNoTip");
  if (!mNoTip) {
    mNoTip = document.createElement("div");
    mNoTip.id = "mNoTip";
    mNoTip.className = "qHoverTip";
    document.body.appendChild(mNoTip);
  }

  let mGapTip = document.getElementById("mGapTip");
  if (!mGapTip) {
    mGapTip = document.createElement("div");
    mGapTip.id = "mGapTip";
    mGapTip.className = "suraProgTip";
    document.body.appendChild(mGapTip);
  }

  let readerScoreTip = document.getElementById("readerScoreTip");
  if (!readerScoreTip) {
    readerScoreTip = document.createElement("div");
    readerScoreTip.id = "readerScoreTip";
    readerScoreTip.className = "suraProgTip";
    document.body.appendChild(readerScoreTip);
  }

  let hifzHelpTip = document.getElementById("hifzHelpTip");
  if (!hifzHelpTip) {
    hifzHelpTip = document.createElement("div");
    hifzHelpTip.id = "hifzHelpTip";
    hifzHelpTip.className = "suraProgTip";
    document.body.appendChild(hifzHelpTip);
  }

  const escTip = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
    

  function _firstActiveTranslationText(ref){
    try{
      const a = getAyah(ref);
      if (!a) return "";
      const first = (activeTranslations && activeTranslations[0]) ? activeTranslations[0] : null;
      if (!first?.file) return "";
      const tJson = translationCache.get(first.file);
      if (!tJson) return "";
      return getTranslationTextFromJson(tJson, a.surah, a.ayah) || "";
    }catch{ return ""; }
  }

    // ✅ Tooltips während Playback AUS (Performance)
  // (Wichtig: verseAudio ist in deinem Code meist NICHT auf window)
  function tooltipsAllowed(){
    const a =
      (typeof verseAudio !== "undefined" && verseAudio) ? verseAudio :
      (window.verseAudio ? window.verseAudio : null);

    // erlaubt = NICHT am Spielen
    return !(a && !a.paused);
  }

function _placeTip(tipEl, x, y){
  if (!tipEl) return;

  // ✅ Pad/Offsets NICHT hard px: aus stage-w/h ableiten
  const cs = getComputedStyle(document.documentElement);
  const stageW = parseFloat(cs.getPropertyValue("--stage-w")) || window.innerWidth;
  const stageH = parseFloat(cs.getPropertyValue("--stage-h")) || window.innerHeight;

  const pad   = Math.max(1, stageW * 0.008);   // ~0.8% von stage-w
  const gapY  = Math.max(1, stageH * 0.012);   // Abstand zur Maus

  // ✅ sichtbar via Klasse (CSS Delay)
  tipEl.classList.add("is-show");

  // Stage bounds (damit nie ins Ornament / Bars gerät)
  const stageEl = document.getElementById("stage");
  const stageRect = stageEl ? stageEl.getBoundingClientRect() : { left:0, top:0, right:window.innerWidth, bottom:window.innerHeight };

  // Tooltip-Größe erst NACH "is-show" messen
  const rect = tipEl.getBoundingClientRect();

  // Ziel X: zentriert zur Maus
  let left = x - rect.width / 2;

  // Platz oben/unten NUR innerhalb der Stage rechnen
  const spaceBelow = stageRect.bottom - (y + gapY);
  const spaceAbove = (y - gapY) - stageRect.top;

  // Default: lieber unter der Maus, sonst darüber
  let top = (spaceBelow >= rect.height + pad) ? (y + gapY) : (y - rect.height - gapY);

  // ✅ NICHT in die Statusbar ragen (Statusbar ist oben in der Stage)
  let minTop = stageRect.top + pad;
  try{
    const sb = document.getElementById("statusbar");
    if (sb){
      const sbRect = sb.getBoundingClientRect();
      // Tooltip soll NICHT über die Statusbar (und nicht drauf)
      minTop = Math.max(minTop, (sbRect.bottom || 0) + pad);
    }
  }catch(e){}

  // ✅ NICHT auf die SurahTopBar (die “Topbar” in Ayah/Mushaf)
  // Wir nehmen die oberste sichtbare SurahTopBar innerhalb der Stage.
  try{
    const tops = Array.from(document.querySelectorAll(".surahTopBar"));
    let best = null;
    for (const el of tops){
      const r = el.getBoundingClientRect();
      // nur wenn innerhalb der Stage sichtbar
      const visible =
        r.bottom > stageRect.top &&
        r.top < stageRect.bottom &&
        r.right > stageRect.left &&
        r.left < stageRect.right;
      if (!visible) continue;

      // "oberste" Bar wählen (kleinster top, aber nicht komplett außerhalb)
      if (!best || r.top < best.top) best = r;
    }
    if (best){
      // Tooltip soll NICHT auf/über dieser Topbar liegen
      minTop = Math.max(minTop, (best.bottom || 0) + pad);
    }
  }catch(e){}

  // ✅ Clamp X/Y in die Stage (nie in die Ornament-Bars)
  const minLeft = stageRect.left + pad;
  const maxLeft = stageRect.right - rect.width - pad;
  left = Math.max(minLeft, Math.min(left, maxLeft));

  const maxTop = stageRect.bottom - rect.height - pad;
  top = Math.max(minTop, Math.min(top, maxTop));

  tipEl.style.left = left + "px";
  tipEl.style.top  = top  + "px";
}

function _hideTip(tipEl){
  if (!tipEl) return;
  tipEl.classList.remove("is-show");
}

  function _showSuraTipAt(x, y, ref){
    const a = getAyah(ref);
    if (!a) return;

    const tr = _firstActiveTranslationText(ref);
    suraTip.innerHTML = `
      <div class="tipRef">${escTip(a.ref)}</div>
      <div class="tipAr" dir="rtl" lang="ar">${a.textAr || ""}</div>
      ${tr ? `<div class="tipTr">${escTip(tr)}</div>` : ``}
    `;

    _placeTip(suraTip, x, y);
  }

  function _hideSuraTip(){
    _hideTip(suraTip);
  }

  // =========================
  // Ticks bauen
  // =========================
  let _ticksSurah = 0;

function buildSuraTicks(surahNo){
  if (!suraProgTicks) return;

  const s = Number(surahNo || 0);
  const meta = getSuraMeta(s);
  if (!meta || !meta.ayahCount) {
    suraProgTicks.innerHTML = "";
    suraProgTicks.style.setProperty("--sura-tick-count", "1");
    _ticksSurah = 0;
    return;
  }

  const n = Number(meta.ayahCount);
  const target = Math.max(1, Number(loadReaderRepeatTarget() || 5));

  const applyTickDecor = (btn, ref) => {
    const row = getTrainerReaderRow(ref);
    const rating = String(row?.rating || "");
    const rightCount = Math.max(0, Number(row?.rightCount || 0));
    const pct = Math.max(0, Math.min(100, (rightCount / target) * 100));

    btn.style.setProperty("--tick-progress-pct", `${pct.toFixed(3)}%`);
    btn.classList.toggle("is-reader-progress", rightCount > 0);
    btn.classList.toggle("is-reader-done", rightCount >= target);
    btn.classList.toggle("is-reader-bad", rating === "bad");
    btn.classList.toggle("is-reader-mid", rating === "mid");
  };

  suraProgTicks.style.setProperty("--sura-tick-count", String(n));

  // gleiche Sura + gleiche Anzahl -> nur Decor aktualisieren
  if (_ticksSurah === s && suraProgTicks.childElementCount === n) {
    suraProgTicks.querySelectorAll(".suraTick[data-ref]").forEach((btn) => {
      applyTickDecor(btn, String(btn.dataset.ref || ""));
    });
    try { markActiveTick(currentRef || `${s}:1`); } catch {}
    return;
  }

  _ticksSurah = s;

  let html = "";
  for (let i = 1; i <= n; i++){
    const pct = (n <= 0) ? 0 : (((i - 0.5) / n) * 100);
    const ref = `${s}:${i}`;
    const row = getTrainerReaderRow(ref);
    const rating = String(row?.rating || "");
    const rightCount = Math.max(0, Number(row?.rightCount || 0));
    const progPct = Math.max(0, Math.min(100, (rightCount / target) * 100));

    const cls = [
      "suraTick",
      rightCount > 0 ? "is-reader-progress" : "",
      rightCount >= target ? "is-reader-done" : "",
      rating === "bad" ? "is-reader-bad" : "",
      rating === "mid" ? "is-reader-mid" : ""
    ].filter(Boolean).join(" ");

    html += `<button class="${cls}" type="button" style="left:${pct.toFixed(4)}%;--tick-progress-pct:${progPct.toFixed(3)}%" data-ref="${ref}" aria-label="${ref}"></button>`;
  }

  suraProgTicks.innerHTML = html;
  try { markActiveTick(currentRef || `${s}:1`); } catch {}
}

window.__suraProgSetSurah = (s) => {
  try {
    buildSuraTicks(s);
    markActiveTick(currentRef || `${Number(s || currentSurahInView || 1)}:1`);
  } catch {}
};

window.__suraProgRefresh = () => {
  try {
    buildSuraTicks(currentSurahInView || 1);
    markActiveTick(currentRef || `${Number(currentSurahInView || 1)}:1`);
  } catch {}
};

try {
  buildSuraTicks(currentSurahInView || 1);
  markActiveTick(currentRef || `${Number(currentSurahInView || 1)}:1`);
} catch {}

  // ✅ O(1): nur letztes + neues Element anfassen (keine querySelectorAll-Loops)
  let _lastActiveTickEl = null;
  let _lastActiveTickRef = "";

  function markActiveTick(ref){
    
       if (!suraProgTicks) return;

    const r = String(ref || "");

    // Wenn wir schon auf diesem Ref sind und das Element noch im DOM ist -> nix tun
    if (_lastActiveTickRef === r && _lastActiveTickEl && _lastActiveTickEl.isConnected) return;

    // alten Active-Tick deaktivieren (nur 1 Element)
    if (_lastActiveTickEl && _lastActiveTickEl.isConnected) {
      _lastActiveTickEl.classList.remove("is-active");
    }

    // neuen Tick finden + aktivieren
    const btn = suraProgTicks.querySelector(`.suraTick[data-ref="${CSS.escape(r)}"]`);
    if (btn) {
      btn.classList.add("is-active");
      _lastActiveTickEl = btn;
      _lastActiveTickRef = r;
    } else {
      // falls nix gefunden: Cache zurücksetzen (verhindert falsches "stuck")
      _lastActiveTickEl = null;
      _lastActiveTickRef = r;
    }
  }

  // =========================
  // Tick Events + Tooltips
  // =========================
  if (suraProgTicks && !suraProgTicks.__bound) {
    suraProgTicks.__bound = true;

suraProgTicks.addEventListener("click", (e) => {
  const t = e.target.closest?.(".suraTick[data-ref]");
  if (!t) return;
  e.preventDefault();
  e.stopPropagation();

  // ✅ Fix: nach Tick-Klick kurz “chillen”, damit der Balken nicht vor/zurück springt
  try { window.__suraProgFreezeUntil = performance.now() + 400; } catch(e) {}

  const ref = t.dataset.ref || "";
  if (!/^\d+:\d+$/.test(ref)) return;

  const [sStr, aStr] = ref.split(":");
  const s = Number(sStr), ay = Number(aStr);

  // ✅ Wenn Surah Queue läuft: dort weiterspielen
  if (typeof surahPlaying !== "undefined" && surahPlaying && Number(surahPlaying) === s) {
    try { startSurahPlayback(s, { fromAyah: ay, btn: document.getElementById("playStop") }); } catch {}
    return;
  }

  // ✅ Immer goToRef: hält URL/currentRef/currentSurahInView korrekt
  const ok = goToRef(ref, { updateUrl: true });

  // ✅ Mushaf: nach Render nochmal sicher zum Nummernblock scrollen
  // (weil Render/Chunking/Idle Timing sonst manchmal "zu spät" ist)
  if (ok && viewMode === "mushaf") {
    const mv = document.querySelector(".mView");
    if (mv && mv.style.display !== "none") {
      setTimeout(() => {
        try {
          scrollToMushafNoWhenReady(mv, ref, { updateUrl: false, scroll: true });
        } catch {}
      }, 0);
    }
  }

  // ✅ Tick sofort visuell aktiv setzen (falls du markActiveTick hast)
  try { markActiveTick?.(ref); } catch {}
});

    // ✅ SuraProg: Click anywhere on bar => jump to that ayah
    if (suraProg && !suraProg.__boundClick) {
      suraProg.__boundClick = true;

suraProg.addEventListener("click", (e) => {
        if (e.target?.closest?.(".suraTick")) return;

        e.preventDefault();
        e.stopPropagation();

        // ✅ Fix: nach Bar-Klick kurz “chillen”, damit der Balken nicht vor/zurück springt
        try { window.__suraProgFreezeUntil = performance.now() + 400; } catch(e) {}

        const s =
          (typeof surahPlaying !== "undefined" && surahPlaying)
            ? Number(surahPlaying)
            : Number(currentSurahInView || 0);

        const meta = getSuraMeta(s);
        const n = Number(meta?.ayahCount || 0);
        if (!s || n <= 0) return;

        // ✅ Kein Layout-Rect: offsetX/clientWidth benutzen
        // offsetX ist relativ zum Event-Target -> sicherstellen: wir wollen suraProg als Referenz
        const w = suraProg.clientWidth || 0;
        if (w <= 0) return;

        // click position 0..1
        const x01 = Math.max(0, Math.min(1, (e.offsetX || 0) / w));

        // nearest tick
        const idx0 = Math.min(n - 1, Math.floor(x01 * n));
        const ay = idx0 + 1;
        const ref = `${s}:${ay}`;

        if (typeof surahPlaying !== "undefined" && surahPlaying && Number(surahPlaying) === s) {
          try { startSurahPlayback(s, { fromAyah: ay, btn: document.getElementById("playStop") }); } catch {}
          return;
        }

        goToRef(ref, { updateUrl: true });
      });
    }

    // Hover: tooltip (THROTTLED für Performance, bleibt AN)
    let _suraTipLastT = 0;
    let _suraTipLastRef = "";

    suraProgTicks.addEventListener("mousemove", (e) => {
      const t = e.target.closest?.(".suraTick[data-ref]");
      if (!t) { _hideSuraTip(); return; }

      const ref = t.dataset.ref || "";
      const now = (performance && performance.now) ? performance.now() : Date.now();

      // ✅ Wenn Ref wechselt: sofort updaten (fühlt sich snappy an)
      // ✅ Sonst: throttle auf ~40ms
      if (ref === _suraTipLastRef && (now - _suraTipLastT) < 40) return;

      _suraTipLastRef = ref;
      _suraTipLastT = now;

      _showSuraTipAt(e.clientX, e.clientY, ref);
    }, { passive: true });

    suraProgTicks.addEventListener("mouseleave", () => {
      _suraTipLastRef = "";
      _hideSuraTip();
    });
        // =========================
    // Scroll-Progress 
    // =========================
    (function bindScrollProgress(){
      // nur 1x binden
      if (window.__scrollProgBound) return;
      window.__scrollProgBound = true;

      // blauen Scroll-Fill vollständig deaktivieren
      try{
        document.getElementById("scrollProgress")?.remove();
      }catch{}

      // Hook bleibt bestehen, damit bestehende Aufrufer nicht kaputtgehen
      window.__updateScrollProgress = () => {
        try{
          markActiveTick(currentRef || `${Number(currentSurahInView || 1)}:1`);
        }catch{}
      };
    })();
  }

  // =========================
  // ✅ NEU: Word hover tooltip (Wortübersetzung + 1. Ayah-Übersetzung)
  // =========================
  let _lastWordKey = "";
  document.addEventListener("mousemove", (e) => {
    // ✅ während Playback: Tooltips aus
    if (!tooltipsAllowed()) {
      _lastWordKey = "";
      _hideTip(wordTip);
      return;
    }

    // nicht über anderen Tooltips
    if (e.target?.closest?.("#suraProgTip, #wordTip, #mNoTip")) return;

    const wEl = e.target?.closest?.(".w:not(.wMark)");
    if (!wEl) {
      _lastWordKey = "";
      _hideTip(wordTip);
      return;
    }

    const ref = wEl.dataset?.ref || "";
    const wi  = Number(wEl.dataset?.wi);
    if (!/^\d+:\d+$/.test(ref) || !Number.isFinite(wi) || wi < 0) {
      _lastWordKey = "";
      _hideTip(wordTip);
      return;
    }

    const key = `${ref}|${wi}`;
    if (_lastWordKey !== key) {
      _lastWordKey = key;

      const words = (typeof getWords === "function") ? getWords(ref) : null;
      const wObj = Array.isArray(words) ? words[wi] : null;

      const wordTr = (wObj?.de || wObj?.en || "").trim();
      const ayTr = (_firstActiveTranslationText(ref) || "").trim();

      // Wenn gar nix da ist -> kein Tooltip
      if (!wordTr && !ayTr) {
        _hideTip(wordTip);
        return;
      }

      wordTip.innerHTML = `
        ${wordTr ? `<div class="tipWord"><span class="tipLabel">word translate:</span> ${escTip(wordTr)}</div>` : ``}
        ${ayTr ? `<div class="tipTr"><span class="tipLabel">ayah translate:</span> ${escTip(ayTr)}</div>` : ``}
      `;
    }

    _placeTip(wordTip, e.clientX, e.clientY);
  }, { passive: true });

  // =========================
  // ✅ NEU: Mushaf Ayahnummer hover tooltip (nur Mushaf)
  // =========================
  let _lastNoRef = "";
  document.addEventListener("mousemove", (e) => {
    // ✅ während Playback: Tooltips aus
    if (!tooltipsAllowed()) {
      _lastNoRef = "";
      _hideTip(mNoTip);
      return;
    }

    if (e.target?.closest?.("#suraProgTip, #wordTip, #mNoTip, #mGapTip")) return;

    // nur im Mushaf-Modus
    if (viewMode !== "mushaf") {
      _lastNoRef = "";
      _hideTip(mNoTip);
      return;
    }

    const noEl = e.target?.closest?.(".mNo[data-ref]");
    if (!noEl) {
      _lastNoRef = "";
      _hideTip(mNoTip);
      return;
    }

    const ref = String(noEl.dataset?.ref || "");
    if (!ref) {
      _lastNoRef = "";
      _hideTip(mNoTip);
      return;
    }

    if (_lastNoRef !== ref) {
      _lastNoRef = ref;

      mNoTip.innerHTML = `
  <div class="tipRef">${escTip(ref)}</div>
  <div class="tipAr" dir="rtl" lang="ar">انقر بالزر الأيسر للتشغيل</div>
  <div class="tipAr" dir="rtl" lang="ar">Ctrl + نقرة يسار للإشارة المرجعية</div>
  <div class="tipAr" dir="rtl" lang="ar">Shift + نقرة يسار للملاحظات</div>
  <div class="tipAr" dir="rtl" lang="ar">Alt + نقرة يسار للنسخ</div>
  <div class="tipTr">Left click to play</div>
  <div class="tipTr">Shift + left click for notes</div>
  <div class="tipTr">Ctrl + left click to bookmark</div>
  <div class="tipTr">Alt + left click to copy</div>
  
`;
    }

    _placeTip(mNoTip, e.clientX, e.clientY);
  }, { passive: true });

  let _lastGapKey = "";
  document.addEventListener("mousemove", (e) => {
    if (!tooltipsAllowed()) {
      _lastGapKey = "";
      _hideTip(mGapTip);
      return;
    }

    if (e.target?.closest?.("#suraProgTip, #wordTip, #mNoTip, #mGapTip")) return;

    if (viewMode !== "mushaf") {
      _lastGapKey = "";
      _hideTip(mGapTip);
      return;
    }

    const gapEl = e.target?.closest?.(".mFilterGap[data-hidden-refs]");
    if (!gapEl) {
      _lastGapKey = "";
      _hideTip(mGapTip);
      return;
    }

    const raw = String(gapEl.dataset?.hiddenRefs || "");
    const refs = parseMushafHiddenRefs(raw);

    if (!refs.length) {
      _lastGapKey = "";
      _hideTip(mGapTip);
      return;
    }

    if (_lastGapKey !== raw) {
      _lastGapKey = raw;

      mGapTip.innerHTML = `
  <div class="tipRef">hidden ayahs</div>
  ${refs.map((ref) => `<div class="tipTr">${escTip(ref)} — Stage ${getTrainerStageForRef(ref)}</div>`).join("")}
`;
    }

    _placeTip(mGapTip, e.clientX, e.clientY);
  }, { passive: true });

  let _readerScoreTipVisible = false;
  let _lastReaderScoreTipKey = "";

  document.addEventListener("mousemove", (e) => {
    if (!tooltipsAllowed()) {
      _readerScoreTipVisible = false;
      _lastReaderScoreTipKey = "";
      _hideTip(readerScoreTip);
      return;
    }

    if (e.target?.closest?.("#suraProgTip, #wordTip, #mNoTip, #mGapTip, #readerScoreTip")) return;

    const helpEl = e.target?.closest?.(".hifzSurahSummaryScoreHelp, .acctScoreHelp[data-reader-help]");
    if (!helpEl) {
      _readerScoreTipVisible = false;
      _lastReaderScoreTipKey = "";
      _hideTip(readerScoreTip);
      return;
    }

    const title = String(helpEl.dataset?.readerHelpTitle || "Reader score");
    const text = String(helpEl.dataset?.readerHelpText || "this is a score to track your progress reading the quran fluently");
    const key = `${helpEl.dataset?.readerHelp || ""}|${title}|${text}`;

    if (!_readerScoreTipVisible || _lastReaderScoreTipKey !== key) {
      _readerScoreTipVisible = true;
      _lastReaderScoreTipKey = key;

      const lower = String(text || "").toLowerCase();
      const marker = lower.includes("quranl.com") ? "quranl.com" : "";
      let textHtml = "";

      if (marker) {
        const idx = lower.indexOf(marker);
        const rawText = String(text || "");
        const before = rawText.slice(0, idx).trim();
        const after = rawText.slice(idx + marker.length).trim();

        textHtml = `
  ${before ? `<div class="tipTr">${escTip(before)}</div>` : ``}
  <div class="tipLinkAccent">quranl.com</div>
  ${after ? `<div class="tipTr">${escTip(after)}</div>` : ``}
`;
      } else {
        textHtml = `<div class="tipTr">${escTip(text)}</div>`;
      }

      readerScoreTip.innerHTML = `
  <div class="tipRef">${escTip(title)}</div>
  ${textHtml}
`;
    }

    _placeTip(readerScoreTip, e.clientX, e.clientY);
  }, { passive: true });

  let _lastHifzHelpKey = "";
  document.addEventListener("mousemove", (e) => {
    if (!tooltipsAllowed()) {
      _lastHifzHelpKey = "";
      _hideTip(hifzHelpTip);
      return;
    }

    if (e.target?.closest?.("#suraProgTip, #wordTip, #mNoTip, #mGapTip, #readerScoreTip, #hifzHelpTip")) return;

    const helpEl = e.target?.closest?.(".acctScoreHelp[data-hifz-help]");
    if (!helpEl) {
      _lastHifzHelpKey = "";
      _hideTip(hifzHelpTip);
      return;
    }

    const title = String(helpEl.dataset?.hifzHelpTitle || "Hifzscore");
    const text = String(helpEl.dataset?.hifzHelpText || "");
    const key = `${helpEl.dataset?.hifzHelp || ""}|${title}|${text}`;

    if (_lastHifzHelpKey !== key) {
      _lastHifzHelpKey = key;

      let textHtml = "";
      if (text) {
        const marker = "quranf.com";
        const rawText = String(text || "");
        const lower = rawText.toLowerCase();
        const idx = lower.indexOf(marker);

        if (idx >= 0) {
          const before = rawText.slice(0, idx).trim();
          const after = rawText.slice(idx + marker.length).trim();

          textHtml = `
            ${before ? `<div class="tipTr">${escTip(before)}</div>` : ``}
            <div class="tipLinkAccent">quranf.com</div>
            ${after ? `<div class="tipTr">${escTip(after)}</div>` : ``}
          `;
        } else {
          textHtml = `<div class="tipTr">${escTip(rawText)}</div>`;
        }
      }

      hifzHelpTip.innerHTML = `
  <div class="tipRef">${escTip(title)}</div>
  ${textHtml}
`;
    }

    _placeTip(hifzHelpTip, e.clientX, e.clientY);
  }, { passive: true });

  document.addEventListener("mouseout", (e) => {
    const helpEl = e.target?.closest?.(".acctScoreHelp[data-hifz-help]");
    if (!helpEl) return;

    const rel = e.relatedTarget;
    const stillInsideHelp = rel?.closest?.(".acctScoreHelp[data-hifz-help]");
    if (stillInsideHelp) return;

    _lastHifzHelpKey = "";
    _hideTip(hifzHelpTip);
  }, { passive: true });

  function refreshFavCount() {
    // ✅ Wichtig: nach Reload soll der Count zur aktiven Favorites-Seite passen (actual ODER preset)
    try {
      if (typeof window.__refreshFavCount === "function") {
        window.__refreshFavCount();
        return;
      }
    } catch {}

    // Fallback (sollte praktisch nie greifen)
    if (!favCount) return;
    const n = (loadBookmarks()?.length || 0);
    favCount.textContent = String(n);
  }

  // =========================
// Theme Toggle (Light/Dark)
// =========================
const LS_THEME = "quranm_theme_v1";

function applyTheme(mode){
  const m = (mode === "light") ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", m);
  try { localStorage.setItem(LS_THEME, m); } catch(e){}
}

function loadTheme(){
  try {
    const v = String(localStorage.getItem(LS_THEME) || "");
    return (v === "light" || v === "dark") ? v : "dark";
  } catch(e){
    return "dark";
  }
}

// init beim Laden
applyTheme(loadTheme());
// ✅ Style Picker init (Paletten/Designs)
try { initStylePicker(); } catch {}

// click toggle
if (themeBtn) {
themeBtn.addEventListener("click", (e) => {
  e.preventDefault();
  e.stopPropagation();

  const cur = document.documentElement.getAttribute("data-theme") || "dark";
  const next = (cur === "light") ? "dark" : "light";
  applyTheme(next);

  // ✅ WICHTIG: Palette neu anwenden, damit Light/Dark-Varianten greifen
  try {
    const saved = loadStyleThemeId();
    const fallback =
      (STYLE_THEMES.find(t => t?.label === "Charcoal Accent 31")?.id) ||
      (STYLE_THEMES.find(t => t?.id === "style-141")?.id) ||
      (STYLE_THEMES[0] ? STYLE_THEMES[0].id : "");
    applyStyleThemeById(saved || fallback);
  } catch (err) {
    console.warn("[theme] reapply style failed:", err);
  }
});
}

const FAV_PROGRESS_STEP = 2; // jede 2 Ayahs (weniger clunky)
let _favLastBucket = -1;
let _favLastPct = -1;
let _favRaf = 0;

// ✅ Marks Cache (damit wir nicht ständig neu bauen)
let _favMarksKey = "";
let _favLastMarksSurah = 0;

function setFavProgressPct(pct) {
  if (!favBtnBtn) return;
  const safe = Math.max(0, Math.min(100, pct));
  favBtnBtn.style.setProperty("--fav-prog", safe.toFixed(2) + "%");
}

// ✅ baut multi-linear-gradients für 1px Striche (Positionen in %)
// ✅ Quelle wird als srcRefs übergeben (actual ODER preset-page)
function _buildFavMarksBgForSurah(surahNo, srcRefs) {
  const s = Number(surahNo || 0);
  if (!s || s < 1 || s > 114) return "none";

  const meta = getSuraMeta(s);
  const ayahCount = Number(meta?.ayahCount || 0);
  if (!ayahCount || ayahCount <= 1) return "none";

  let list = [];
  try {
    list = (srcRefs || [])
      .map(String)
      .filter((r) => r.startsWith(s + ":"))
      .map((r) => Number(r.split(":")[1] || 0))
      .filter((n) => Number.isFinite(n) && n >= 1 && n <= ayahCount);
  } catch {
    list = [];
  }

  list = Array.from(new Set(list)).sort((a, b) => a - b);
  if (!list.length) return "none";

  if (list.length > 350) list = list.slice(0, 350);

  const layers = [];
  for (const ayahNo of list) {
    const pct = ((ayahNo - 1) / (ayahCount - 1)) * 100;

    layers.push(
      `linear-gradient(90deg,
        transparent calc(${pct.toFixed(4)}% - var(--u1w)),
        var(--color-fav-mark) calc(${pct.toFixed(4)}% - var(--u1w)),
        var(--color-fav-mark) calc(${pct.toFixed(4)}% + var(--u1w)),
        transparent calc(${pct.toFixed(4)}% + var(--u1w))
      )`
    );
  }

  return layers.join(",");
}

function updateFavMarksForSurah(surahNo) {
  if (!favBtnBtn) return;

  // ✅ In Favorites-Seite: Marks immer aus
  if (typeof __inFavoritesPage !== "undefined" && __inFavoritesPage) {
    favBtnBtn.style.setProperty("--fav-mark-bg", "none");
    _favMarksKey = "";
    _favLastMarksSurah = 0;
    return;
  }

  const s = Number(surahNo || 0);
  if (!s) {
    favBtnBtn.style.setProperty("--fav-mark-bg", "none");
    _favMarksKey = "";
    _favLastMarksSurah = 0;
    return;
  }

  // ✅ Ayah/Mushaf: Quelle = aktive Seite (actual ODER preset)
  let srcRefs = [];
  let srcTag = "actual";
  try {
    srcRefs = getActiveFavRefs();
    srcTag = String(favPresetActiveName || "actual");
  } catch {
    srcRefs = [];
    srcTag = "actual";
  }

  // Cache-Key: surah + pageName + refs in surah
  let key = "";
  try {
    const inS = (srcRefs || [])
      .map(String)
      .filter((r) => r.startsWith(s + ":"))
      .sort()
      .join("|");
    key = `${s}::${srcTag}::${inS}`;
  } catch {
    key = `${s}::${srcTag}::`;
  }

  if (key === _favMarksKey) return;

  _favMarksKey = key;
  _favLastMarksSurah = s;

  const bg = _buildFavMarksBgForSurah(s, srcRefs);
  favBtnBtn.style.setProperty("--fav-mark-bg", bg);
}

function computeAyahScrollProgress(qv) {
  // 1) Bestimme die Sura, die gerade wirklich im View ist
  const all = qv.querySelectorAll(".ayahMainCard[data-ref]");
  if (!all || all.length === 0) return { idx: 0, pct: 0, bucket: 0, surah: 0 };

  const qTop = qv.getBoundingClientRect().top;

  // erste Card im sichtbaren Bereich
  let focusCard = all[0];
  for (let i = 0; i < all.length; i++) {
    const r = all[i].getBoundingClientRect();
    if ((r.bottom - qTop) > 12) { focusCard = all[i]; break; }
  }

  const ref = focusCard.getAttribute("data-ref") || "";
  const sInView = Number(ref.split(":")[0] || 0);
  if (sInView) setSurahContext(sInView);

  const s = sInView || currentSurahInView || 0;
  if (!s) return { idx: 0, pct: 0, bucket: 0, surah: 0 };

  const inSura = Array.from(all).filter((el) => (el.getAttribute("data-ref") || "").startsWith(s + ":"));
  const n = inSura.length;
  if (n <= 1) return { idx: 0, pct: 0, bucket: 0, surah: s };

  let idx = 0;
  for (let i = 0; i < n; i++) {
    const r = inSura[i].getBoundingClientRect();
    if ((r.top - qTop) <= 12) idx = i;
    else break;
  }

  const pct = (idx / (n - 1)) * 100;
  const bucket = Math.floor(idx / FAV_PROGRESS_STEP);
  return { idx, pct, bucket, surah: s };
}

function computeMushafScrollProgress(mv) {
  const allNos = Array.from(mv.querySelectorAll('.mNo[data-ref]'));
  if (!allNos.length) return { pct: 0, bucket: 0, surah: 0 };

  const mvTop = mv.getBoundingClientRect().top;
  const TH = 12;

  let anchor = allNos[0];
  for (const el of allNos) {
    const r = el.getBoundingClientRect();
    if ((r.bottom - mvTop) > TH) { anchor = el; break; }
  }

  const ref = anchor.getAttribute("data-ref") || "";
  const sInView = Number(ref.split(":")[0] || 0);
  if (sInView) setSurahContext(sInView);

  const s = sInView || currentSurahInView || 0;

  const surahNos = s
    ? Array.from(mv.querySelectorAll(`.mNo[data-ref^="${s}:"]`))
    : allNos;

  const n = surahNos.length;
  if (n <= 1) return { pct: 0, bucket: 0, surah: s || 0 };

  let idx = 0;
  for (let i = 0; i < n; i++) {
    const r = surahNos[i].getBoundingClientRect();
    if ((r.top - mvTop) <= TH) idx = i;
    else break;
  }

  const pct = (idx / (n - 1)) * 100;
  const bucket = Math.floor(idx / FAV_PROGRESS_STEP);
  return { pct, bucket, surah: s || 0 };
}

function updateFavProgress() {
  _favRaf = 0;
  if (!favBtnBtn) return;

  if (viewMode === "ayah") {
    const qv = document.querySelector(".qView");
    if (!qv || qv.style.display === "none") return;

    const { pct, bucket, surah } = computeAyahScrollProgress(qv);

    // marks: immer wenn Sura wechselt oder Favoriten geändert wurden (Key-Cache)
    if (surah && surah !== _favLastMarksSurah) updateFavMarksForSurah(surah);
    else updateFavMarksForSurah(surah);

    if (bucket !== _favLastBucket) {
      _favLastBucket = bucket;
      setFavProgressPct(pct);
    }
    return;
  }

  const mv = document.querySelector(".mView");
  if (!mv || mv.style.display === "none") return;

  const { pct, surah } = computeMushafScrollProgress(mv);

  if (surah && surah !== _favLastMarksSurah) updateFavMarksForSurah(surah);
  else updateFavMarksForSurah(surah);

  if (Math.abs(pct - _favLastPct) >= 0.2) {
    _favLastPct = pct;
    setFavProgressPct(pct);
  }
}

function scheduleFavProgressUpdate() {
  if (_favRaf) return;
  _favRaf = requestAnimationFrame(updateFavProgress);
}

// Scroll Listener (einmal binden, ohne Event-Stacking)
function bindFavProgressListeners() {
  const qv = document.querySelector(".qView");
  const mv = document.querySelector(".mView");

  if (qv && !qv._favProgBound) {
    qv._favProgBound = true;
    qv.addEventListener("scroll", scheduleFavProgressUpdate, { passive: true });
  }
  if (mv && !mv._favProgBound) {
    mv._favProgBound = true;
    mv.addEventListener("scroll", scheduleFavProgressUpdate, { passive: true });
  }
}

// ✅ Expose für Updates (nach Bookmark toggle, nach render, etc.)
window.__refreshFavButtonDecor = function(){
  try { scheduleFavProgressUpdate(); } catch(e) {}
};

// ✅ Expose, damit renderCurrent nach jedem Render nachbinden kann
window.__bindFavProgressListeners = bindFavProgressListeners;
window.__scheduleFavProgressUpdate = scheduleFavProgressUpdate;

// ✅ Favorites Button: öffnet Favoriten-Seite (Ayah-only), und wird dort zum Back-Button
if (favBtnBtn) {
  favBtnBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();

    // Wenn wir schon in der Favoriten-Seite sind: zurück
    if (typeof __inFavoritesPage !== "undefined" && __inFavoritesPage) {
      closeFavoritesPage();
      return;
    }

    // ✅ Direkt öffnen (openFavoritesPage kümmert sich selbst um Mushaf -> Favorites korrekt anzeigen)
    openFavoritesPage();
  });
}


// init
refreshFavCount();
bindFavProgressListeners();
scheduleFavProgressUpdate();



function setJumpBusy(on) {
  jumpBusy = !!on;

  // Statusbar + Surah Dropdown (wie vorher)
  if (statusbar) statusbar.classList.toggle("is-jumping", jumpBusy);
  if (suraDrop)  suraDrop.classList.toggle("is-jumping", jumpBusy);

  // ✅ Jumper auch als "loading" markieren (Spinner + Glow)
  const jumpBoxEl = document.getElementById("jumpBox");
  const jumpGoEl  = document.getElementById("jumpGo");
  if (jumpBoxEl) jumpBoxEl.classList.toggle("is-jumping", jumpBusy);
  if (jumpGoEl)  jumpGoEl.classList.toggle("is-jumping", jumpBusy);
}



  // global, damit Scroll-Helpers es wieder ausschalten können
  window.__setJumpBusy = setJumpBusy;

  function fmtSurahLine(s) {
    const sm = getSuraMeta(s);
    if (!sm) return `${s}`;
    // ✅ Zahl – Arabisch – Englisch (für Tooltips / Debug)
    return `${s} - ${sm.nameAr} • ${sm.nameTranslit}`;
  }

  function setSurahDropdownLabel(s) {
    if (!suraDropText) return;

    const n = Number(s) || 1;
    const sm = getSuraMeta(n);

    if (!sm) {
      suraDropText.textContent = `${n}`;
      return;
    }

    // ✅ Button: Zahl – Arabisch – Englisch
    suraDropText.textContent = `${n} - ${sm.nameAr} • ${sm.nameTranslit}`;
  }

  function closeSurahMenu() {
    if (!suraDrop) return;
    suraDrop.classList.remove("is-open", "is-active");
  }

  function openSurahMenu() {
    if (!suraDrop) return;
    closeAllStatusbarDropdowns("suraDrop");
    suraDrop.classList.add("is-open", "is-active");
  }

  function toggleSurahMenu() {
    if (!suraDrop) return;
    const open = suraDrop.classList.contains("is-open");
    if (open) closeSurahMenu();
    else openSurahMenu();
  }

  // Menu befüllen (114 Suren)
  function buildSurahMenu() {
    if (!suraDropMenu) return;
    let html = "";

    for (let s = 1; s <= 114; s++) {
      const sm = getSuraMeta(s);
      const en = sm?.nameTranslit ?? "";
      const ar = sm?.nameAr ?? "";

      html += `
        <button class="suraOpt" type="button" data-surah="${s}" title="${s} — ${ar} — ${en}">
          <span class="suraLine">
            <span class="suraNo">${s}</span>
            <span class="suraAr" dir="rtl" lang="ar">${ar}</span>
            <span class="suraEn">${en}</span>
          </span>
        </button>
      `;
    }

    suraDropMenu.innerHTML = html;
  }

  // click handlers
  if (suraDropBtn) {
    suraDropBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleSurahMenu();
    });
  }

if (suraDropMenu) {
  suraDropMenu.addEventListener("click", (e) => {
    // ✅ Wenn wir gerade in der Favoritenseite sind: erst raus (ohne extra render)
    try { closeFavoritesPage?.({ silent: true }); } catch {}

    const opt = e.target.closest?.(".suraOpt");
    if (!opt) return;

    const s = Number(opt.dataset?.surah || 0);
    if (!s || s < 1 || s > 114) return;

    // ✅ Jump feedback AN (wir schalten es aus, sobald Ziel wirklich gerendert ist)
    setJumpBusy(true);

    // ✅ springe zu Ayah 1 der Sura
    goToRef(`${s}:1`, { updateUrl: true });

    // ✅ Label sofort updaten (kann kurz "nur Zahl" sein, aber wird gleich gefixt)
    setSurahDropdownLabel(s);

    closeSurahMenu();
  });
}
  // initial menu + label
  // (Beim ersten Aufruf können Quran-Daten noch nicht fertig sein -> Menu wird danach refresh't)
  buildSurahMenu();
  setSurahDropdownLabel(currentSurahInView || 1);

  // ✅ Expose refresh, damit wir nach dataReady die echten Namen reinladen können
  window.__refreshSurahDropdown = function __refreshSurahDropdown() {
    buildSurahMenu();
    setSurahDropdownLabel(currentSurahInView || 1);
  };

// =========================
// ✅ Font Dropdown (Statusbar) + Persist
// =========================
const LS_AR_FONT = "quranm_arfont";

const FONT_OPTIONS = [
  { key: "Uthmani", label: "Uthmani" },
  { key: "IndoPak", label: "IndoPak" },
];

function setFontDropdownLabel(name) {
  if (!fontDropText) return;
  // Button-Label soll statisch sein
  fontDropText.textContent = "Font";
}

function closeFontMenu() {
  if (!fontDrop) return;
  fontDrop.classList.remove("is-open", "is-active");
}

function openFontMenu() {
  if (!fontDrop) return;
  closeAllStatusbarDropdowns("fontDrop");
  fontDrop.classList.add("is-open", "is-active");
}

function toggleFontMenu() {
  if (!fontDrop) return;
  const open = fontDrop.classList.contains("is-open");
  if (open) closeFontMenu();
  else openFontMenu();
}

function saveArabicFont(name) {
  try { localStorage.setItem(LS_AR_FONT, name); } catch(e){}
}

function loadArabicFont() {
  try {
    const v = localStorage.getItem(LS_AR_FONT);
    return (v === "IndoPak" || v === "Uthmani") ? v : "Uthmani";
  } catch(e){
    return "Uthmani";
  }
}

function applyArabicFont(fontName, { rerender = true } = {}) {
  const safeName = (fontName === "IndoPak") ? "IndoPak" : "Uthmani";

  // ✅ CSS Variable setzen (mit Fallbacks)
  document.documentElement.style.setProperty(
    "--font-ar",
    `"${safeName}","Amiri","Noto Naskh Arabic","Scheherazade New",serif`
  );

  setFontDropdownLabel(safeName);
  saveArabicFont(safeName);

  if (rerender) {
    try {
      if (typeof __inFavoritesPage !== "undefined" && __inFavoritesPage) renderFavoritesPage();
      else renderCurrent(currentRef);
    } catch(e){}
  }
}


function buildFontMenu() {
  if (!fontDropMenu) return;
  fontDropMenu.innerHTML = FONT_OPTIONS.map(opt => `
    <button class="fontOpt" type="button" data-font="${opt.key}">
      <span>${opt.label}</span>
    </button>
  `).join("");
}

if (fontDropBtn) {
  fontDropBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleFontMenu();
  });
}

if (fontDropMenu) {
  fontDropMenu.addEventListener("click", (e) => {
    const opt = e.target.closest?.(".fontOpt");
    if (!opt) return;
    const name = opt.dataset?.font || "Uthmani";
    applyArabicFont(name);
    closeFontMenu();
  });
}

// ✅ init
buildFontMenu();

// ✅ Default beim Laden: gespeicherte Wahl (sonst Uthmani)
applyArabicFont(loadArabicFont(), { rerender: false });

// =========================
// ✅ Trainer Stage (Ayah-Topbar only)
// bereits oben auf Top-Level definiert
// =========================
try {
  syncAyahTopStageUI(document);
} catch (e) {}

const LS_RECITER = "quranm_reciter";

// ✅ Word-Highlighting Delay pro Reciter (persistiert)
// Positiv = Highlight kommt SPÄTER (z.B. try { window.__suraProgFreezeUntil = performance.now() + 200; } catch(e) {} => 200ms später)
const LS_RECITER_TIMING_DELAYS = "quranm_reciter_timing_delays_v1";

// ✅ GLOBAL DEFAULT: 0ms (ohne Reciter-Delay wird NICHT vorgezogen)
const DEFAULT_TIMING_LEAD_MS = 0;

// ✅ Optional: Default-Delays pro Reciter-Key (wenn du willst)
// Keys = RECITER_OPTIONS[].key (z.B. "alafasy")
const DEFAULT_RECITER_TIMING_DELAYS_MS = {
  // Beispiel:
  // alafasy: 200,
};

function _loadReciterTimingDelays() {
  try {
    const raw = localStorage.getItem(LS_RECITER_TIMING_DELAYS);
    if (!raw) return {};
    const obj = JSON.parse(raw);
    return (obj && typeof obj === "object") ? obj : {};
  } catch {
    return {};
  }
}

function _saveReciterTimingDelays(obj) {
  try {
    localStorage.setItem(LS_RECITER_TIMING_DELAYS, JSON.stringify(obj || {}));
  } catch {}
}

// Gibt Delay (ms) für einen Reciter-Key zurück: localStorage override -> Default Map -> 0
function getReciterTimingDelayMs(reciterKey) {
  const key = String(reciterKey || "").trim();
  if (!key) return 0;

  const overrides = _loadReciterTimingDelays();
  const o = Number(overrides?.[key]);
  if (Number.isFinite(o)) return o;

  const d = Number(DEFAULT_RECITER_TIMING_DELAYS_MS?.[key]);
  if (Number.isFinite(d)) return d;

  return 0;
}

// Lead fürs Highlighting = globalLead - reciterDelay
// Default: 0 - 0 = 0
// Beispiel: Delay 200 => leadMs = -200 => Highlight kommt später
function getActiveTimingLeadMs() {
  try {
    const rk = (typeof RECITER !== "undefined") ? RECITER : "";
    return DEFAULT_TIMING_LEAD_MS - getReciterTimingDelayMs(rk);
  } catch {
    return DEFAULT_TIMING_LEAD_MS;
  }
}

// ✅ Console-Helper (damit du live testen kannst)
window.__setReciterTimingDelay = function (reciterKey, ms) {
  const key = String(reciterKey || "").trim();
  const n = Number(ms);
  if (!key || !Number.isFinite(n)) return false;

  const obj = _loadReciterTimingDelays();
  obj[key] = Math.round(n);
  _saveReciterTimingDelays(obj);
  return true;
};

window.__getReciterTimingDelay = function (reciterKey) {
  return getReciterTimingDelayMs(reciterKey);
};

// ✅ 9 Reciter (Dropdown) — key = UI/Storage, audioFolder/timingsFolder = echte Ordnernamen
// Hinweis: Ordnernamen müssen GENAU so heißen wie in /reciter und /timings_out.
const RECITER_OPTIONS = [
  {
    key: "alafasy",
    label: "Mishari Rashid al Afasy",
    audioFolder: "Mishari Rashid al Afasy",
    timingsFolder: "Mishari Rashid al Afasy",
  },
  {
    key: "abdulbaset_abdulsamad_murattal",
    label: "Abdulbaset Abdulsamad (Murattal)",
    audioFolder: "Abdulbaset Abdulsamad Murattal",
    timingsFolder: "Abdulbaset Abdulsamad Murattal",
  },
  {
    key: "abdulbaset_abdulsamad_mujawwad",
    label: "Abdulbaset Abdulsamad (Mujawwad)",
    audioFolder: "Abdulbaset Abdulsamad Mujawwad",
    timingsFolder: "Abdulbaset Abdulsamad Mujawwad",
  },
  {
    key: "abdur_rahman_as_sudais",
    label: "Abdur Rahman as Sudais",
    audioFolder: "Abdur Rahman as Sudais",
    timingsFolder: "Abdur Rahman as Sudais",
  },
  {
    key: "abu_bakr_al_shatri",
    label: "Abu Bakr al Shatri",
    audioFolder: "Abu Bakr al Shatri",
    timingsFolder: "Abu Bakr al Shatri",
  },
  {
    key: "hani_ar_rifai",
    label: "Hani ar Rifai",
    audioFolder: "Hani ar Rifai",
    timingsFolder: "Hani ar Rifai",
  },
  {
    key: "mohamed_siddiq_al_minshawi_mujawwad",
    label: "Mohamed Siddiq al Minshawi (Mujawwad)",
    audioFolder: "Mohamed Siddiq al Minshawi Mujawwad",
    timingsFolder: "Mohamed Siddiq al Minshawi Mujawwad",
  },
  {
    key: "mohamed_siddiq_al_minshawi_murattal",
    label: "Mohamed Siddiq al Minshawi (Murattal)",
    audioFolder: "Mohamed Siddiq al Minshawi Murattal",
    timingsFolder: "Mohamed Siddiq al Minshawi Murattal",
  },
  {
    key: "saud_ash_shuraym",
    label: "Saud ash Shuraym",
    audioFolder: "Saud ash Shuraym",
    timingsFolder: "Saud ash Shuraym",
  },
];

function setReciterDropdownLabel(label) {
  if (!recDropText) return;
  // Button-Label soll statisch sein
  recDropText.textContent = "Reciter";
}

function closeAllStatusbarDropdowns(exceptId = "") {
  if (exceptId !== "suraDrop") suraDrop?.classList.remove("is-open", "is-active");
  if (exceptId !== "recDrop")  recDrop?.classList.remove("is-open", "is-active");
  if (exceptId !== "fontDrop") fontDrop?.classList.remove("is-open", "is-active");
  if (exceptId !== "trDrop")   trDrop?.classList.remove("is-open", "is-active");
}

function closeReciterMenu() {
  if (!recDrop) return;
  recDrop.classList.remove("is-open", "is-active");
}

function openReciterMenu() {
  if (!recDrop) return;
  closeAllStatusbarDropdowns("recDrop");
  recDrop.classList.add("is-open", "is-active");
}

function toggleReciterMenu() {
  if (!recDrop) return;
  const open = recDrop.classList.contains("is-open");
  if (open) closeReciterMenu();
  else openReciterMenu();
}

function saveReciter(key) {
  try { localStorage.setItem(LS_RECITER, key); } catch(e){}
}

function loadReciter() {
  try {
    let v = String(localStorage.getItem(LS_RECITER) || "");

    // Backward-compat: alter Key -> neuer Key
    if (v === "abdulbaset_abdulsamad") v = "abdulbaset_abdulsamad_murattal";

    return RECITER_OPTIONS.some(o => o.key === v) ? v : "alafasy";
  } catch(e){
    return "alafasy";
  }
}

function applyReciter(key, { rerender = true } = {}) {
  const opt = RECITER_OPTIONS.find(o => o.key === key) || RECITER_OPTIONS[0];

  // ✅ stoppe laufendes Audio beim Wechsel (sonst mischt es)
  try { stopWordAudio(); } catch(e){}
  try { stopVerseAudio(); } catch(e){}
  try { stopSurahQueue(); } catch(e){}

  RECITER = opt.key; // ✅ UI/Storage key
  RECITER_AUDIO_FOLDER = opt.audioFolder || opt.key; // ✅ echter MP3-Ordnername

  // ✅ Timing-Folder pro Reciter
  TIMINGS_ROOT = `${TIMINGS_BASE}/${opt.timingsFolder || opt.audioFolder || opt.key}`;

  // ✅ Timings sind reciter-spezifisch -> Cache leeren
  try { timingCache?.clear?.(); } catch {}

  setReciterDropdownLabel(opt.label);
  saveReciter(opt.key);

  // Menü-Active markieren
  if (recDropMenu) {
    recDropMenu.querySelectorAll(".recOpt").forEach(btn => {
      btn.classList.toggle("is-active", btn.dataset.reciter === opt.key);
    });
  }

  if (rerender) {
    try {
      if (typeof __inFavoritesPage !== "undefined" && __inFavoritesPage) renderFavoritesPage();
      else renderCurrent(currentRef);
    } catch(e){}
  }
}

function buildReciterMenu() {
  if (!recDropMenu) return;

  recDropMenu.innerHTML = RECITER_OPTIONS.map(opt => `
    <button class="recOpt" type="button" data-reciter="${opt.key}">
      ${opt.label}
    </button>
  `).join("");

  recDropMenu.querySelectorAll(".recOpt").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();

      const key = btn.dataset.reciter || "";
      if (!key) return;

      applyReciter(key, { rerender: true });
      closeReciterMenu();
    });
  });
}

if (recDropBtn) {
  recDropBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleReciterMenu();
  });
}

if (recDropMenu) {
  recDropMenu.addEventListener("click", (e) => {
    const optBtn = e.target.closest?.(".recOpt");
    if (!optBtn) return;
    const key = optBtn.dataset?.reciter || "alafasy";
    applyReciter(key);
    closeReciterMenu();
  });
}

// init
buildReciterMenu();
applyReciter(loadReciter(), { rerender: false });

// ✅ Expose refresh hook so initTranslations() can rebuild menu after index load
window.__initTranslationsDropdown = function __initTranslationsDropdown() {
  setTrDropdownLabel();
  buildTranslationsMenu();
};

// init (build once; may still show "No translations index" until initTranslations finishes)
window.__initTranslationsDropdown();


// =========================
// ✅ Translations Dropdown (Statusbar) + Multi-Select (max 10)
// =========================

// (MAX_ACTIVE_TRANSLATIONS ist schon global oben definiert – NICHT nochmal const hier drin)
function escHtml(s){
  return String(s ?? "").replace(/[&<>"']/g, (c) => (
    c === "&" ? "&amp;" :
    c === "<" ? "&lt;" :
    c === ">" ? "&gt;" :
    c === '"' ? "&quot;" : "&#39;"
  ));
}

function setTrDropdownLabel() {
  if (!trDropText) return;
  // Button-Label soll statisch sein
  trDropText.textContent = "Translation";
}

function closeTrMenu() {
  if (!trDrop) return;
  trDrop.classList.remove("is-open", "is-active");
}

function openTrMenu() {
  if (!trDrop) return;
  closeAllStatusbarDropdowns("trDrop");
  trDrop.classList.add("is-open", "is-active");
}


function toggleTrMenu() {
  if (!trDrop) return;
  const open = trDrop.classList.contains("is-open");
  if (open) closeTrMenu();
  else openTrMenu();
}

function flashTranslationsLimit() {
  if (!trDropBtn) return;
  trDropBtn.classList.add("is-bad");
  setTimeout(() => trDropBtn.classList.remove("is-bad"), 450);
}

function isFileActive(file) {
  return (activeTranslations || []).some(t => t.file === file);
}

function buildTranslationsMenu() {
  if (!trDropMenu) return;

  if (!translationsIndex || !Array.isArray(translationsIndex.languages) || translationsIndex.languages.length === 0) {
    trDropMenu.innerHTML = `<div class="trLangTitle">No translations index</div>`;
    return;
  }

  const parts = [];

  // ✅ Sortierung: English -> German -> Rest alphabetisch
  const langs = (translationsIndex.languages || []).slice();
  const norm = (s) => String(s || "").trim().toLowerCase();

  langs.sort((a, b) => {
    const A = norm(a?.language);
    const B = norm(b?.language);

    const rank = (x) => (x === "english" ? 0 : (x === "german" ? 1 : 2));
    const rA = rank(A);
    const rB = rank(B);

    if (rA !== rB) return rA - rB;

    // beide "Rest" => alphabetisch
    if (rA === 2) return A.localeCompare(B);

    // beide gleich (english/english oder german/german)
    return 0;
  });

  for (const lang of langs) {
    const langName = lang?.language || "Language";
    const items = Array.isArray(lang?.items) ? lang.items : [];
    if (!items.length) continue;

    parts.push(`<div class="trLangTitle">${escHtml(langName)}</div>`);

    for (const it of items) {
      const file = it?.file || "";
      if (!file) continue;

      const label = (it?.label || _basename(file)).replace(/\.json$/i, "");
      const checked = isFileActive(file) ? "checked" : "";

parts.push(`
  <label class="trOpt ${checked ? "is-active" : ""}">
    <span class="trOptLabel">${escHtml(label)}</span>
    <input class="trChk" type="checkbox" data-file="${escHtml(file)}" ${checked}>
  </label>
`);
    }
  }

  trDropMenu.innerHTML = parts.join("");
}

// ✅ Button click
if (trDropBtn) {
  trDropBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleTrMenu();
  });
}

// ✅ Klicks im Menü sollen NICHT schließen
if (trDropMenu) {
  trDropMenu.addEventListener("click", (e) => {
    e.stopPropagation();
  });

  trDropMenu.addEventListener("change", async (e) => {
    const chk = e.target?.closest?.(".trChk");
    if (!chk) return;

    const file = chk.dataset?.file || "";
    if (!file) return;

    const willEnable = !!chk.checked;

    if (willEnable) {
      if (!isFileActive(file) && (activeTranslations.length >= MAX_ACTIVE_TRANSLATIONS)) {
        chk.checked = false;
        flashTranslationsLimit();
        return;
      }

      const it =
        findIndexItemByFile(file) ||
        { language: "", label: _basename(file).replace(/\.json$/i, ""), file };

      activeTranslations = [...activeTranslations, it].slice(0, MAX_ACTIVE_TRANSLATIONS);

      // warm load
      try { await loadTranslationFile(file); } catch {}

    } else {
      activeTranslations = activeTranslations.filter(t => t.file !== file);
    }

    // persist
    saveActiveTranslationFiles(activeTranslations.map(t => t.file));

    // label refresh
    setTrDropdownLabel();

    // active mark refresh (CSS)
    const optLabel = chk.closest(".trOpt");
    if (optLabel) optLabel.classList.toggle("is-active", chk.checked);

    // rerender only in ayah mode
    try {
  if (viewMode === "ayah") {
    if (typeof __inFavoritesPage !== "undefined" && __inFavoritesPage) renderFavoritesPage();
    else renderCurrent(currentRef);
  }
} catch {}
  });
}

document.addEventListener(
  "pointerdown",
  (e) => {
    const t = e.target;

    // ✅ Statusbar-Dropdowns
    const anyStatusOpen =
      suraDrop?.classList.contains("is-open") ||
      recDrop?.classList.contains("is-open") ||
      fontDrop?.classList.contains("is-open") ||
      trDrop?.classList.contains("is-open");

    if (anyStatusOpen) {
      const insideStatus =
        suraDrop?.contains(t) ||
        recDrop?.contains(t) ||
        fontDrop?.contains(t) ||
        trDrop?.contains(t);

      if (!insideStatus) {
        closeAllStatusbarDropdowns("");
      }
    }

    // ✅ Ayah-Topbar Dropdowns (Stage / Right Target / Review / Filter / Bad+Medium)
    const openAyahTopDrop = document.querySelector("[data-stage-drop].is-open, [data-repeat-drop].is-open, [data-review-drop].is-open, [data-mushaf-filter-drop].is-open, [data-trainer-flag-drop].is-open");
    if (openAyahTopDrop) {
      const insideAyahTopDrop = !!t?.closest?.("[data-stage-drop], [data-repeat-drop], [data-review-drop], [data-mushaf-filter-drop], [data-trainer-flag-drop]");
      if (!insideAyahTopDrop) {
        document
          .querySelectorAll("[data-stage-drop].is-open, [data-repeat-drop].is-open, [data-review-drop].is-open, [data-mushaf-filter-drop].is-open, [data-trainer-flag-drop].is-open")
          .forEach((el) => el.classList.remove("is-open", "is-active"));
      }
    }
  },
  { capture: true, passive: true }
);


    // =========================
  // ✅ Font Size (Statusbar)
  // =========================

  const LS_AR_SCALE = "quranm_arFontScale";

  function clamp(n, a, b){ return Math.max(a, Math.min(b, n)); }

  function getBaseAyahPx(){
    const cs = getComputedStyle(document.documentElement);
    const v = cs.getPropertyValue("--ayah-font-ar-base").trim(); // e.g. "38px"
    const n = parseFloat(v);
    return Number.isFinite(n) && n > 0 ? n : 38;
  }

function setArabicScale(scale, { strong = false } = {}) {
  const s = clamp(Number(scale) || 1, 0.60, 1.80);

  // ✅ Arabic + Translations Scale setzen (kein rerender!)
  document.documentElement.style.setProperty("--ar-font-scale", String(s));
  document.documentElement.style.setProperty("--tr-font-scale", String(s));

  // UI label: px = base * scale (nur Anzeige)
  const px = Math.round(getBaseAyahPx() * s);
  if (fsVal) fsVal.textContent = `${px}px`;

  // Glow state: nur kurz beim Klick
  if (fsCtl) {
    fsCtl.classList.toggle("is-strong", !!strong);
    if (strong) setTimeout(() => fsCtl.classList.remove("is-strong"), 180);
  }

  // speichern
  try { localStorage.setItem(LS_AR_SCALE, String(s)); } catch(e){}

  // ✅ Wichtig: KEIN renderCurrent() / KEIN renderFavoritesPage()
  // Nur Fokus-Highlight “halten”, ohne Scroll (damit nix springt)
  requestAnimationFrame(() => {
    try {
      // Favorites Page: nichts machen (soll ruhig “normal” bleiben)
      if (typeof __inFavoritesPage !== "undefined" && __inFavoritesPage) return;

      if (viewMode === "ayah") {
        const qv = document.querySelector(".qView");
        if (qv) focusAyahCard(qv, currentRef, { scroll: false });
      } else if (viewMode === "mushaf") {
        const mv = document.querySelector(".mView");
        if (!mv) return;
        mv.querySelectorAll(".mNo.is-focus").forEach(el => el.classList.remove("is-focus"));
        const btn = mv.querySelector(`.mNo[data-ref="${CSS.escape(String(currentRef))}"]`);
        if (btn) btn.classList.add("is-focus"); // kein scrollIntoView
      }
    } catch(e){}
  });
}

  // init: gespeicherte Scale laden
  let startScale = 1;
  try {
    const saved = parseFloat(localStorage.getItem(LS_AR_SCALE) || "");
    if (Number.isFinite(saved)) startScale = saved;
  } catch(e){}
  setArabicScale(startScale, { strong: false });

const STEP = 0.05; // fein genug

if (fsBtn) {
  fsBtn.addEventListener("click", (e) => {
    e.stopPropagation();

    const rect = fsBtn.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const topHalf = y < rect.height / 2;

    const cs = getComputedStyle(document.documentElement);
    const cur = parseFloat(cs.getPropertyValue("--ar-font-scale")) || 1;

    // oben = PLUS, unten = MINUS
    setArabicScale(cur + (topHalf ? STEP : -STEP), { strong: true });
  });
}

  const jumpInput = document.getElementById("jumpInput");
  const jumpGo = document.getElementById("jumpGo");
  const jumpBox = document.getElementById("jumpBox");

  let jumpBadTimer = null;
  function flashJumpBad() {
    if (!jumpBox) return;
    jumpBox.classList.add("is-bad");
    if (jumpBadTimer) clearTimeout(jumpBadTimer);
    jumpBadTimer = setTimeout(() => jumpBox.classList.remove("is-bad"), 700);
  }
  // ===== Live Play Progress (smooth, performance-arm) =====
  let __playProgRaf = 0;

  function __computePlayProgress01() {
    // 0..1
    if (!verseAudio) return 0;

    // Wenn Surah-Queue aktiv: Fortschritt über Ayah-Index + Anteil innerhalb der aktuellen Ayah
    if (surahPlaying) {
      const meta = getSuraMeta(surahPlaying);
      const total = Number(meta?.ayahCount || 0) || 0;
      if (!total) return 0;

      const base = Math.max(0, (Number(surahAyahIdx || 1) - 1)) / total;

      let within = 0;
      const d = Number(verseAudio.duration || 0);
      const t = Number(verseAudio.currentTime || 0);
      if (d > 0 && Number.isFinite(d) && Number.isFinite(t)) {
        within = Math.max(0, Math.min(1, t / d)) / total;
      }

      return Math.max(0, Math.min(1, base + within));
    }

    // Sonst: nur innerhalb der aktuellen Ayah
    const d = Number(verseAudio.duration || 0);
    const t = Number(verseAudio.currentTime || 0);
    if (d > 0 && Number.isFinite(d) && Number.isFinite(t)) {
      return Math.max(0, Math.min(1, t / d));
    }
    return 0;
  }

  function __renderPlayProgress() {
    if (!progress) return;
    const p = __computePlayProgress01();
    progress.style.width = (p * 100).toFixed(3) + "%";
  }

  function __startPlayProgressRaf() {
    cancelAnimationFrame(__playProgRaf);

    const tick = () => {
      // nur live rendern wenn wirklich am Abspielen
      if (verseAudio && !verseAudio.paused && !verseAudio.ended) {
        __renderPlayProgress();
        __playProgRaf = requestAnimationFrame(tick);
      }
    };

    __renderPlayProgress(); // sofort ein Update
    if (verseAudio && !verseAudio.paused && !verseAudio.ended) {
      __playProgRaf = requestAnimationFrame(tick);
    }
  }

  function __stopPlayProgressRaf() {
    cancelAnimationFrame(__playProgRaf);
    __playProgRaf = 0;
    __renderPlayProgress(); // beim Pause/Stop einmal final setzen
  }

  function syncUI(opts = {}) {
  const { syncContinue = true } = opts || {};
  // ✅ echte Wahrheit: verseAudio
  const isPlaying = !!verseAudio && !verseAudio.paused;
  const isPaused  = !!verseAudio && verseAudio.paused;

  // Statusbar PlayStop (Icon)
  if (playStop) playStop.classList.toggle("is-playing", isPlaying);

  // PlayPause-Button (optional UI): nur aktiv wenn verseAudio existiert
  if (playPause) {
    playPause.disabled = !verseAudio;
    playPause.classList.toggle("is-paused", isPaused);
  }

  // ✅ Small Surah Pause Button (nur wenn surah queue läuft UND nicht favorites)
  try{
    const showSuraPause =
      (typeof surahPlaying !== "undefined") &&
      !!surahPlaying &&
      !(typeof __inFavoritesPage !== "undefined" && __inFavoritesPage);

    const suraPaused = !!showSuraPause ? !!surahStoppedByUser : !!isPaused;
setSuraPauseUI(!!showSuraPause, suraPaused, { syncContinue });
  }catch(e){}

  // ✅ SuraPlay Progress (innerhalb aktueller Sura)
  // ✅ Live Progress (Surah-Queue: innerhalb der Sura / sonst: innerhalb der Ayah)
  if (progress) {
    // ✅ Fix: nach Tick/Bar-Klick kurz “chillen” (kein Hin-und-Her)
    try{
      const fu = Number(window.__suraProgFreezeUntil || 0);
      if (fu && performance.now() < fu) return;
    }catch(e){}

    let pct = 0;

    // falls kein Audio: 0%
    if (!verseAudio) {
      pct = 0;
    } else {
      const dur = Number(verseAudio.duration || 0);
      const cur = Number(verseAudio.currentTime || 0);

      // ✅ Auto-scroll decision: NUR kurz vor Ende der aktuellen Ayah festlegen
      // Wenn User wegscrollt, wird Gate false -> nächste Ayah scrollt nicht mehr automatisch.
      if (surahPlaying && !isPaused && dur > 0) {
        const remaining = dur - cur;
        if (remaining <= 0.35) { // ~350ms vor Ende
          __autoScrollGate = __isRefVisibleNow(verseRefPlaying);
        }
      }

      const frac = (dur > 0) ? Math.max(0, Math.min(1, cur / dur)) : 0;

      // ✅ WICHTIG: Während "basm:*" läuft, soll KEIN Surah-Fortschritt angezeigt werden.
      // Sonst sieht man kurz vor Ende der Basmallah diesen komischen Mini-Blau-Balken.
      const isBasmNow = /^basm:/.test(String(verseRefPlaying || ""));

      if (isBasmNow) {
        pct = 0;
      } else if (surahPlaying) {
        const meta = getSuraMeta(surahPlaying);
        const n = Number(meta?.ayahCount || 0);

        if (n > 1) {
          // ✅ Bei Surah-Queue: Index lieber aus verseRefPlaying nehmen (stabil bei Ayah-Wechsel),
          // sonst fallback auf surahAyahIdx.
          let idx0 = Math.max(0, (Number(surahAyahIdx || 1) - 1)); // 0-based fallback

          try{
            const rNow = (verseRefPlaying && /^\d+:\d+$/.test(String(verseRefPlaying)))
              ? String(verseRefPlaying)
              : "";
            if (rNow) {
              const [rs, ra] = rNow.split(":").map(Number);
              if (Number.isFinite(rs) && Number.isFinite(ra) && rs === Number(surahPlaying)) {
                idx0 = Math.max(0, ra - 1);
              }
            }
          }catch{}

          pct = ((idx0 + frac) / n) * 100;
        } else {
          pct = frac * 100;
        }
      } else {
        // sonst: nur aktuelle Ayah
        pct = frac * 100;
      }
    }

    // ✅ WICHTIG: Wenn surahPlaying läuft und verseAudio gerade "kurz weg" ist (Ayah-Wechsel),
    // NICHT auf 0 springen -> letzten Wert halten.
    if (!verseAudio && surahPlaying && __progHoldSurah === surahPlaying) {
      pct = __progHoldPct;
    }

    // clamp
    pct = Math.max(0, Math.min(100, pct));

    // ✅ Wenn Surah-Queue spielt: niemals rückwärts laufen (verhindert mini “zurückspringen”)
    if (surahPlaying && __progHoldSurah === surahPlaying) {
      pct = Math.max(pct, __progHoldPct);
    }

    __progTarget = pct;

    // ✅ Hold-State updaten (nur im Surah-Queue)
    if (surahPlaying) {
      __progHoldSurah = surahPlaying;
      __progHoldPct = __progTarget;
    } else {
      __progHoldSurah = null;
      __progHoldPct = 0;
    }

    // ✅ Glättung: target -> vis (macht es “normal” smooth)
    const now = performance.now();
    const dt = __progLastT ? Math.min(80, now - __progLastT) : 16;
    __progLastT = now;

    // Zeitkonstante ~120ms: schnell genug, aber nicht “zappelig”
    const k = 1 - Math.pow(0.001, dt / 120);
    __progVis = __progVis + (__progTarget - __progVis) * k;

    // ✅ GPU-smooth statt width-layout
    progress.style.transform = `scaleX(${(__progVis / 100).toFixed(5)})`;
  }
}

  // ✅ Live Progress Loop (smooth, ohne Interval-Spam)
  let __progRaf = 0;
  let __progVis = 0;       // sichtbarer Wert (0..100)
  let __progTarget = 0;    // Zielwert (0..100)
  let __progLastT = 0;     // für dt
  let __progHoldPct = 0;   // letzter stabiler Prozentwert (für Ayah-Wechsel)
  let __progHoldSurah = null; // welche Sura zu __progHoldPct gehört

function __startProgRaf(){
  cancelAnimationFrame(__progRaf);

  // cheap: ~11 FPS UI (Buttons + Progress-State)
  let __lastCheap = 0;
  // expensive: 1 FPS (Continue-Buttons etc.)
  let __lastExp = 0;

  // Edge-Detection: wenn sich SurahPlay/Pause ändert, sofort Continue-Buttons syncen
  let __lastSuraActive = null;
  let __lastPaused = null;

  const tick = (now) => {
    try {
      // --- CHEAP TICK (≈ 8–12×/s) ---
      if (!__lastCheap || (now - __lastCheap) >= 90) {
        __lastCheap = now;

        // ✅ syncUI, aber OHNE teure Continue-Buttons (die kommen unten)
        syncUI({ syncContinue: false });

        // State lesen (nur simple booleans)
        const suraActive =
          (typeof surahPlaying !== "undefined") &&
          !!surahPlaying &&
          !(typeof __inFavoritesPage !== "undefined" && __inFavoritesPage);

        const pausedNow = !!verseAudio && !!verseAudio.paused;

        // wenn sich State geändert hat: Continue sofort richtig setzen
        if (__lastSuraActive === null || __lastPaused === null ||
            suraActive !== __lastSuraActive || pausedNow !== __lastPaused) {
          __lastSuraActive = suraActive;
          __lastPaused = pausedNow;
          try { __syncContinueButtons(); } catch(e){}
        }
      }

      // --- EXPENSIVE TICK (≈ 1×/s) ---
      if (!__lastExp || (now - __lastExp) >= 1000) {
        __lastExp = now;
        try { __syncContinueButtons(); } catch(e){}
      }
    } catch {}

    if (verseAudio && !verseAudio.paused && !verseAudio.ended) {
      __progRaf = requestAnimationFrame(tick);
    }
  };

  __progRaf = requestAnimationFrame(tick);
}

function __stopProgRaf(){
  cancelAnimationFrame(__progRaf);
  __progRaf = 0;
  try { syncUI({ syncContinue: true }); } catch {}
  try { __syncContinueButtons(); } catch(e){}
}

  // für playFromButton erreichbar machen
  window.__startStatusbarProg = __startProgRaf;
  window.__stopStatusbarProg  = __stopProgRaf;
  window.__syncUI = syncUI;

function flashStoppedGlow(){
  try{
    if (!playStop) return;
    playStop.classList.add("is-stopped");
    setTimeout(() => playStop.classList.remove("is-stopped"), 220);
  }catch(e){}
}

if (playStop) {
  playStop.addEventListener("click", () => {
    // Wort-Audio hat eigene Logik -> stoppen
    if (wordAudio) stopWordAudio();

    // ✅ FAVORITES MODE: Statusbar PlayStop steuert Favorites Queue
    if (typeof __inFavoritesPage !== "undefined" && __inFavoritesPage) {
      const qv = document.querySelector(".qView"); // Favorites rendert in qView
      if (!qv) return;

      // Play/Stop (kein Pause) – nutzt deine bestehende Favorites-Queue-Funktionen
      if (!favQueueRefs || favQueueRefs.length === 0) {
        startFavoritesQueue(qv);
      } else {
        stopFavoritesQueue();
        try { stopVerseAudio({ stopQueue: true }); } catch {}
      }

      // UI sync (playStop Icon)
      try { syncUI?.(); } catch {}
      return;
    }

    // ✅ NORMAL MODE (Ayah/Mushaf): dein bisheriges Verhalten
    if (verseAudio && !verseAudio.paused) {
      stopVerseAudio();
      stopSurahQueue();
      return;
    }

    startSurahPlayback(currentSurahInView, { fromAyah: 1, btn: playStop });
  });
}

const suraPauseBtn = document.getElementById("suraPause");
if (suraPauseBtn && !suraPauseBtn.__bound) {
  suraPauseBtn.__bound = true;

  suraPauseBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();

    // Nur relevant wenn Surah Queue läuft
    if (typeof surahPlaying === "undefined" || !surahPlaying) return;
    if (!verseAudio) return;

    // Toggle pause/resume
    try{
      if (verseAudio.paused) {
        verseAudio.play();

        // ✅ wichtig: Surah-Queue ist wieder aktiv (für UI + playNext/onEnded)
        surahStoppedByUser = false;
      } else {
        verseAudio.pause();

        // ✅ wichtig: UI liest bei SurahPlay "surahStoppedByUser" als Pause-State
        surahStoppedByUser = true;
      }
    }catch(err){}

    // 1s Flash Glow
    try{
      suraPauseBtn.classList.add("is-flash");
      setTimeout(() => suraPauseBtn.classList.remove("is-flash"), 1000);
    }catch(err){}

    // UI sync
    try { syncUI?.(); } catch {}
  });
}

   if (playPause) {
    playPause.addEventListener("click", () => {
      // ✅ echte Pause/Resume für Ayah/Basm
      const did = toggleVersePause();
      if (did) syncUI();
    });
    // ✅ Favorites Pause Button (separat von playPause!)
const favPauseBtn = document.getElementById("favPause");
if (favPauseBtn) {
  favPauseBtn.addEventListener("click", () => {
    // nur während Favorites Page + Queue aktiv
    if (typeof __inFavoritesPage === "undefined" || !__inFavoritesPage) return;
    if (!favQueueRefs || favQueueRefs.length === 0) return;

    // 1) Wenn gerade Ayah Audio läuft -> echte Pause/Resume
    if (verseAudio) {
      const did = (typeof toggleVersePause === "function") ? toggleVersePause() : false;
      if (!did) return;

      favQueuePaused = !!verseAudio.paused;
      setFavPauseUI(true, favQueuePaused);

      // optional: auch topbar button state mitziehen
      try{
        const qv = document.querySelector(".qView");
        const topPlay = qv?.querySelector("button.favTopPlay");
        if (topPlay){
          topPlay.classList.toggle("is-paused", favQueuePaused);
          topPlay.classList.toggle("is-playing", !favQueuePaused);
        }
      }catch(e){}
      return;
    }

    // 2) Wenn gerade kein verseAudio existiert (z.B. wir stehen in der Gap-Pause)
    favQueuePaused = !favQueuePaused;
    setFavPauseUI(true, favQueuePaused);

    // Resume: weiterlaufen lassen
    if (!favQueuePaused) {
      try { favQueueContinueFn?.(); } catch(e) {}
    }
  });
}
  }

function doJump() {
  // ✅ Wenn wir gerade in der Favoritenseite sind: erst raus (ohne extra render)
  try { closeFavoritesPage?.({ silent: true }); } catch {}

  const raw = (jumpInput?.value || "").trim();
  if (!raw) return;

  const ok = goToRef(raw, { updateUrl: true });
  if (!ok) {
    console.warn("[jump] invalid ref:", raw);

    // ❌ nur bei wirklich ungültig rot
    jumpInput?.classList.add("is-bad");
    if (jumpBox) jumpBox.classList.add("is-bad");

    setTimeout(() => {
      jumpInput?.classList.remove("is-bad");
      jumpBox?.classList.remove("is-bad");
    }, 600);

    // sicherheitshalber busy aus
    try { window.__setJumpBusy?.(false); } catch(e) {}
    return;
  }

  // ✅ gültig -> rot sofort weg + busy an
  jumpInput?.classList.remove("is-bad");
  jumpBox?.classList.remove("is-bad");

  // zeigt den Kreis/Spinner bis Scroll-Helper wieder ausschaltet
  try { window.__setJumpBusy?.(true); } catch(e) {}

  if (jumpInput) jumpInput.value = "";
  syncJumpActive();
}


  if (jumpGo) jumpGo.addEventListener("click", doJump);

  // ✅ Glow wenn Inhalt vorhanden (und beim Tippen live)
  const syncJumpActive = () => {
    if (!jumpBox || !jumpInput) return;
    const hasValue = (jumpInput.value || "").trim().length > 0;
    jumpBox.classList.toggle("is-active", hasValue);
  };

  if (jumpInput) {
    // initial
    syncJumpActive();

    // live beim Tippen / Paste / Delete
    jumpInput.addEventListener("input", syncJumpActive);

    // enter = jump
    jumpInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") doJump();
    });

    // optional: beim blur active-state nochmal syncen
    jumpInput.addEventListener("blur", syncJumpActive);
    jumpInput.addEventListener("focus", syncJumpActive);
  }

  syncUI();
  syncViewToggleBtn();
}

let verseAudio = null;
let verseBtnPlaying = null;
let verseRefPlaying = null; // ✅ welche Ayah-Ref spielt gerade (z.B. "2:255")

// ===== Sura Playback (Queue) =====
let surahPlaying = null;        // number | null
let surahAyahIdx = 1;           // aktuelle Ayah innerhalb der Sura
let surahStoppedByUser = false; // stop/pause durch User

function stopSurahQueue() {
  surahPlaying = null;
  surahAyahIdx = 1;
  surahStoppedByUser = false;

  // ✅ HARD: Statusbar Klassen sofort entfernen (damit nix “random” sichtbar bleibt)
  try{
    const sb = document.querySelector(".statusbar");
    sb?.classList.remove("is-surah-playing");
  }catch(e){}

  // ✅ Small Surah Pause Button aus
  try { setSuraPauseUI(false, false); } catch(e){}
  try { __resetSuraPlayProgressState(); } catch(e){}

  // ✅ iOS FIX: manchmal “repaintet” Safari nach STOP nicht -> alles wirkt weg bis scroll
  // Wir triggern einen harmlosen Reflow + mini scrollTop nudge im Scroll-Container.
  try{
    const v =
      document.querySelector(".qView") ||
      document.querySelector(".mView") ||
      null;

    if (v) {
      const st = v.scrollTop;

      // layer/reflow
      v.style.transform = "translateZ(0)";
      void v.offsetHeight;

      // mini nudge (unsichtbar)
      v.scrollTop = st + 1;
      v.scrollTop = st;

      requestAnimationFrame(() => {
        v.style.transform = "";
      });
    }

    // zusätzlich: manche iPhones brauchen ein “resize” ping
    window.dispatchEvent(new Event("resize"));
  }catch(e){}
}

function startSurahPlayback(surahNo, { fromAyah = 1, btn = null } = {}) {
  const meta = getSuraMeta(surahNo);
  if (!meta) return;

  // Es darf immer nur EIN Audio laufen
  stopWordAudio();
  stopVerseAudio();

  surahPlaying = surahNo;
  surahAyahIdx = Math.max(1, Number(fromAyah) || 1);
  surahStoppedByUser = false;

  // ✅ beim manuellen Start immer erlauben, zum Start zu springen
  try { __autoScrollGate = true; } catch(e){}

  // ✅ Small Surah Pause Button an (paused=false)
  try { setSuraPauseUI(true, false); } catch(e){}
  try { __resetSuraPlayProgressState(); } catch(e){}

  // ✅ Wenn Sura eine Standalone-Basmallah hat (alle außer 1 und 9),
  // und wir ab Ayah 1 starten: erst Basm spielen, dann Ayah 1.
  let basmPlayed = false;
  const shouldPlayBasmFirst = () => (!!meta?.hasStandaloneBasmallah && surahAyahIdx === 1);

  // ✅ Beim Start einmal zum passenden Start-Element scrollen (Basm oder Ayah)
  const scrollToStartOnce = () => {
    try{
      const targetRef = (shouldPlayBasmFirst() && !basmPlayed)
        ? `basm:${surahNo}`
        : `${surahNo}:${surahAyahIdx}`;

      if (viewMode === "ayah") {
        const qv = document.querySelector(".qView");
        if (qv && qv.style.display !== "none") {
          // focus (ohne sofortiges scroll), dann “when ready” scroll
          try { focusAyahCard(qv, targetRef, { scroll: false }); } catch(e){}
          try { scrollToAyahWhenReady(qv, targetRef, { scroll: true }); } catch(e){}
        }
      } else {
        const mv = document.querySelector(".mView");
        if (mv && mv.style.display !== "none") {
          // Mushaf: scroll zum Nummernblock
          try { scrollToMushafNoWhenReady(mv, targetRef, { updateUrl: false, scroll: true }); } catch(e){}
        }
      }
    }catch(e){}
  };

  const playNext = () => {
    if (!surahPlaying || surahStoppedByUser) return;

    // ✅ beim Start (und nach Resume) sicherstellen, dass wir einmal am Start sind
    if (!basmPlayed && surahAyahIdx === Math.max(1, Number(fromAyah) || 1)) {
      scrollToStartOnce();
    }

    // ✅ 1) optional: Basmallah vor Ayah 1
      if (shouldPlayBasmFirst() && !basmPlayed) {
      basmPlayed = true;

      const useBtn = btn || document.querySelector("#playStop") || document.body;
      if (useBtn && useBtn.dataset) useBtn.dataset.ref = `basm:${surahNo}`;

      const url = basmMp3Url(surahNo);
      playFromButton(useBtn, url, {
        queueMode: true,
        onEnded: () => {
          if (!surahPlaying || surahStoppedByUser) return;
          playNext();
        },
      });
      return;
    }

    // ✅ 2) normale Ayah-Queue
    if (surahAyahIdx > meta.ayahCount) {
      // ✅ Repeat: Surah wieder von vorn (inkl. Basmallah-Logik)
      if (surahRepeatOn) {
        surahAyahIdx = 1;
        basmPlayed = false;
        try { __autoScrollGate = true; } catch(e){}
        playNext();
        return;
      }

      stopSurahQueue();
      return;
    }

    const ref = `${surahNo}:${surahAyahIdx}`;
    const a = getAyah(ref);
    if (!a) {
      stopSurahQueue();
      return;
    }

    const useBtn = btn || document.querySelector("#playStop") || document.body;
    if (useBtn && useBtn.dataset) useBtn.dataset.ref = ref;

    const url = ayahMp3Url(a.surah, a.ayah);
    playFromButton(useBtn, url, {
      queueMode: true,
      onEnded: () => {
        if (!surahPlaying || surahStoppedByUser) return;
        surahAyahIdx += 1;
        playNext();
      },
    });
  };

  playNext();
}

// ✅ Surah-Play Button Toggle:
// - wenn gleiche Sura gerade spielt -> STOP (und NICHT neu starten)
// - wenn gleiche Sura pausiert -> Resume
// - sonst -> starte Sura ab Anfang
function toggleSurahPlaybackFromBtn(surahNo, btn) {
  const sameSurah = (surahPlaying === surahNo);

  // ✅ Wenn gerade irgendwas spielt (auch Ayah/Basm) und der User sieht Stop:
  // erster Klick = STOPPEN, nicht neu starten.
  if (verseAudio && !verseAudio.paused) {
    // Wenn es die gleiche SurahQueue ist -> stoppt sie sauber
    if (sameSurah) {
      stopVerseAudio();
      stopSurahQueue();
      return;
    }
    // Wenn es eine andere Wiedergabe ist (z.B. AyahPlay),
    // dann erst stoppen und NICHT sofort die Sura starten.
    stopVerseAudio();
    stopSurahQueue();
    return;
  }

  // Wenn gleiche Sura pausiert ist: Resume (optional)
  if (sameSurah && verseAudio && verseAudio.paused) {
    toggleVersePause();
    return;
  }

  // Sonst: starte diese Sura ab Anfang
  startSurahPlayback(surahNo, { fromAyah: 1, btn });
}

// ✅ welche Sura ist "im Fokus" der View (für Statusbar Play)

function syncVerseBtnState() {
  if (!verseBtnPlaying) return;

const isPaused  = !!verseAudio && (surahPlaying ? !!surahStoppedByUser : !!verseAudio.paused);
const isPlaying = !!verseAudio && !isPaused;

  verseBtnPlaying.classList.toggle("is-playing", isPlaying);
  verseBtnPlaying.classList.toggle("is-paused", isPaused);
  syncPlayingCardGlow();
  syncPlayingMushafFocus();

  syncGlobalPlayStopUI();
}

function syncGlobalPlayStopUI() {
  const anyPlaying = !!verseAudio && !verseAudio.paused;

  // ✅ “aktive” Sura bestimmen:
  // 1) wenn Queue läuft -> surahPlaying
  // 2) sonst wenn Ayah/Basm läuft -> Sura aus verseRefPlaying
  // 3) fallback -> currentSurahInView
  let activeSurah = surahPlaying;

  if (!activeSurah && verseRefPlaying) {
    const m = String(verseRefPlaying).match(/^(\d{1,3}):(\d{1,3})$/);
    if (m) activeSurah = Number(m[1]);
    else {
      const bm = String(verseRefPlaying).match(/^basm:(\d{1,3})$/);
      if (bm) activeSurah = Number(bm[1]);
    }
  }

  if (!activeSurah) activeSurah = currentSurahInView;

    // ✅ Statusbar dropdown label folgt dem "active" Surah Kontext
  const _suraDropText = document.getElementById("suraDropText");
  if (_suraDropText) {
    const sm = getSuraMeta(activeSurah);

    if (!sm) {
      _suraDropText.textContent = String(activeSurah);
    } else {
      // ✅ Zahl – Arabisch – Englisch (Bidi-sicher)
_suraDropText.innerHTML = `
  <span class="suraBtnLine" dir="ltr">
    <span class="suraBtnNo" style="font-weight:650;">${activeSurah}</span>
    <span class="suraBtnGap" aria-hidden="true">&nbsp;</span>
    <span class="suraBtnAr" dir="rtl" lang="ar">${sm.nameAr ?? ""}</span>
    <span class="suraBtnGap" aria-hidden="true">&nbsp;</span>
    <span class="suraBtnEn">${sm.nameTranslit ?? ""}</span>
  </span>
`;
    }
  }

  document.querySelectorAll(".btnCircle.playStop").forEach((btn) => {
    // 1) Statusbar Button (#playStop) = global
    if (btn.id === "playStop") {
      btn.classList.toggle("is-playing", anyPlaying);
      return;
    }

    // 2) SurahTopbar Buttons: Stop/Glow nur für die “aktive” Sura anzeigen,
    // auch wenn gerade nur eine Ayah läuft.
    if (btn.classList.contains("suraPlayBtn")) {
      const s = Number(btn.dataset?.surah || 0);
      const isActive = anyPlaying && activeSurah === s;
      btn.classList.toggle("is-playing", isActive);
      return;
    }

    // fallback
    btn.classList.toggle("is-playing", anyPlaying);
  });
}

function syncPlayingCardGlow() {
  const qv = document.querySelector(".qView");
  if (!qv) return;

  // alle Cards resetten
  qv.querySelectorAll(".ayahMainCard.is-playing").forEach((el) => el.classList.remove("is-playing"));

  // nur wenn wirklich Audio aktiv & nicht paused
  if (!verseAudio || verseAudio.paused || !verseRefPlaying) return;

  const card = qv.querySelector(`.ayahMainCard[data-ref="${CSS.escape(verseRefPlaying)}"]`);
  if (card) card.classList.add("is-playing");
}

// ✅ Mushaf: Ring/Fokus auf der gerade spielenden Ayah-Nummer
function syncPlayingMushafFocus() {
  const mv = document.querySelector(".mView");
  if (!mv) return;

  // ✅ Focus weg + Ring reset (damit nach Stop/Pause nix “hängen bleibt”)
  mv.querySelectorAll(".mNo.is-focus").forEach((el) => {
    el.classList.remove("is-focus");
    try { el.style.setProperty("--ring", "0"); } catch {}
  });

  if (!verseAudio || verseAudio.paused || !verseRefPlaying) return;

  // Basmallah ist kein Mushaf-Ref
  if (/^basm:\d+$/i.test(String(verseRefPlaying))) return;

  const btn = mv.querySelector(`.mNo[data-ref="${CSS.escape(String(verseRefPlaying))}"]`);
  if (btn) {
    btn.classList.add("is-focus");
    try { btn.style.setProperty("--ring", "0"); } catch {}
  }
}

// =========================
// ✅ Mushaf Ring Progress RAF (smooth, nicht chunky)
// =========================
let __mushafRingRaf = 0;
let __mushafRingLastT = 0;

function __updateMushafRingNow() {
  try {
    const mv = document.querySelector(".mView");
    if (!mv) return;

    const btn = mv.querySelector(".mNo.is-focus");
    if (!btn) return;

    if (!verseAudio) return;

    const d = Number(verseAudio.duration || 0);
    const t = Number(verseAudio.currentTime || 0);
    if (!Number.isFinite(d) || d <= 0) {
      btn.style.setProperty("--ring", "0");
      return;
    }

    const p = Math.max(0, Math.min(1, t / d));
    btn.style.setProperty("--ring", String(p));
  } catch {}
}

function __startMushafRingRaf() {
  cancelAnimationFrame(__mushafRingRaf);
  __mushafRingRaf = 0;
  __mushafRingLastT = 0;

  const tick = (now) => {
    try {
      if (verseAudio && !verseAudio.paused && !verseAudio.ended) {
        // ✅ throttle ~30fps (smooth, aber nicht unnötig teuer)
        const ts = (typeof now === "number") ? now : Date.now();
        if (!__mushafRingLastT || (ts - __mushafRingLastT) >= 33) {
          __mushafRingLastT = ts;
          __updateMushafRingNow();
        }
        __mushafRingRaf = requestAnimationFrame(tick);
      }
    } catch {}
  };

  // sofort setzen
  __updateMushafRingNow();
  __mushafRingRaf = requestAnimationFrame(tick);
}

function __stopMushafRingRaf({ reset = false } = {}) {
  cancelAnimationFrame(__mushafRingRaf);
  __mushafRingRaf = 0;
  __mushafRingLastT = 0;

  if (reset) {
    try {
      const mv = document.querySelector(".mView");
      mv?.querySelectorAll(".mNo").forEach((el) => el.style.setProperty("--ring", "0"));
    } catch {}
  }
}

function stopVerseAudio({ stopQueue = true } = {}) {
  // Wenn Ayah/Basm bewusst gestoppt wird, Sura-Queue auch beenden.
  // Beim Queue-Advance (ended) darf die Queue NICHT gekillt werden.
  if (stopQueue) stopSurahQueue();

  // ✅ Mushaf Ring RAF stoppen + reset (damit nichts “hängt”)
  try { __stopMushafRingRaf({ reset: true }); } catch {}

  // ✅ Ayah Edge Smooth RAF stoppen (sonst kann es “weiterlaufen” / CPU ziehen)
  try { __stopVerseEdgeSmoothRaf(); } catch {}

  // ✅ word timing highlight weg
  detachTimingRun();

  if (verseAudio) {
    // ✅ Ayah Fade RAFs stoppen (sonst kann im Hintergrund weiterlaufen)
    try { __cancelVerseFadeRafs(verseAudio); } catch {}

    try { verseAudio.pause(); } catch {}
    try { verseAudio.currentTime = 0; } catch {}
    verseRefPlaying = null;
  }
  verseAudio = null;

  if (verseBtnPlaying) {
    verseBtnPlaying.classList.remove("is-playing", "is-paused");
    verseBtnPlaying = null;
    syncPlayingCardGlow();
    syncPlayingMushafFocus();

    syncGlobalPlayStopUI();
  }
}

function toggleVersePause() {
  if (!verseAudio) return false;

// Toggle pause/resume (SurahPlay: nur USER-Pause zählt)
try{
  if (!surahStoppedByUser) {
    // user paused
    surahStoppedByUser = true;
    verseAudio.pause();
  } else {
    // user resumed
    surahStoppedByUser = false;
    verseAudio.play().catch(()=>{});
  }
}catch(err){}
  syncVerseBtnState();
  return true;
}

// =========================
// Auto-Follow while playing (nur wenn vorherige Ayah im Bild war)
// =========================
let __autoFollowNext = true;

// check: ist ein Element innerhalb des Scroll-Views sichtbar?
function __isElVisibleInScrollBox(el, boxEl, { margin = 18 } = {}) {
  try {
    if (!el || !boxEl) return false;
    const b = boxEl.getBoundingClientRect();
    const r = el.getBoundingClientRect();

    // ✅ Strenger: Mittelpunkt des Elements muss im sichtbaren Bereich liegen
    const midY = (r.top + r.bottom) / 2;
    return (midY >= (b.top + margin)) && (midY <= (b.bottom - margin));
  } catch {
    return false;
  }
}

// =========================
// Auto-follow: nur scrollen, wenn vorherige Ayah im Bild war
// =========================
function __isRefVisibleNow(ref) {
  const raw = String(ref || "").trim();

  // ✅ Wenn Basmallah läuft: NICHT pauschal "true".
  // Stattdessen prüfen wir, ob Ayah 1 dieser Sura sichtbar ist.
  // (Sonst fliegst du am Ende der Basmallah immer wieder hoch.)
  const mBasm = raw.match(/^basm:(\d{1,3})$/);
  if (mBasm) {
    const s = Number(mBasm[1] || 0);
    if (!s) return false;
    const r1 = `${s}:1`; // Sichtbarkeit an Ayah 1 koppeln

    try {
      if (viewMode === "ayah") {
        const qv = document.querySelector(".qView");
        if (!qv || qv.style.display === "none") return false;

        const el = qv.querySelector(`.ayahMainCard[data-ref="${CSS.escape(r1)}"]`);
        if (!el) return false;

        // ✅ strenger: Mittelpunkt muss im sichtbaren Bereich liegen
        return __isElVisibleInScrollBox(el, qv, { margin: 18 });
      } else {
        const mv = document.querySelector(".mView");
        if (!mv || mv.style.display === "none") return false;

        const el = mv.querySelector(`.mNo[data-ref="${CSS.escape(r1)}"]`);
        if (!el) return false;

        return __isElVisibleInScrollBox(el, mv, { margin: 18 });
      }
    } catch {
      return false;
    }
  }

  // null/leer: beim initialen Start nicht blockieren
  if (!raw) return true;

  // normale Ayah
  if (!/^\d+:\d+$/.test(raw)) return false;

  try {
    if (viewMode === "ayah") {
      const qv = document.querySelector(".qView");
      if (!qv || qv.style.display === "none") return false;

      const el = qv.querySelector(`.ayahMainCard[data-ref="${CSS.escape(raw)}"]`);
      if (!el) return false;

      return __isElVisibleInScrollBox(el, qv, { margin: 18 });
    } else {
      const mv = document.querySelector(".mView");
      if (!mv || mv.style.display === "none") return false;

      const el = mv.querySelector(`.mNo[data-ref="${CSS.escape(raw)}"]`);
      if (!el) return false;

      return __isElVisibleInScrollBox(el, mv, { margin: 18 });
    }
  } catch {
    return false;
  }
}

let __autoScrollGate = true; // wird kurz vor Ende der Ayah gesetzt

// =========================
// SuraPlay Progress (smooth, nur wenn SurahPlay läuft)
// =========================
let __suraProgRaf = 0;

function __setSuraProgressPct(pct){
  try{
    const p = document.getElementById("progress");
    if (!p) return;
    const v = Math.max(0, Math.min(100, pct));
    // ✅ einheitlich wie dein anderer Progress: GPU-smooth via transform
    p.style.transform = `scaleX(${(v / 100).toFixed(6)})`;
  }catch(e){}
}

function __computeSuraProgressPct(){
  try{
    if (!surahPlaying || !verseAudio) return 0;

    // ✅ Wenn gerade Basmallah (Standalone) läuft: KEIN Progress anzeigen
    // startSurahPlayback setzt dataset.ref = `basm:<surah>` für die Basm-Audio :contentReference[oaicite:4]{index=4}
    const r = String(verseRefPlaying || "");
    if (/^basm:\d+$/.test(r)) return 0;

    const meta = getSuraMeta(Number(surahPlaying));
    const n = Number(meta?.ayahCount || 0);
    if (!n) return 0;

    const idx0 = Math.max(0, (Number(surahAyahIdx || 1) - 1)); // 0-based
    const d = Number(verseAudio.duration || 0);
    const t = Number(verseAudio.currentTime || 0);
    const frac = (d > 0 && Number.isFinite(d) && Number.isFinite(t)) ? Math.max(0, Math.min(1, t / d)) : 0;

    // ✅ n Segmente: Progress läuft von 0 .. 100 erst am Ende der letzten Ayah
    return ((idx0 + frac) / n) * 100;
  }catch(e){
    return 0;
  }
}

function __startSuraProgRaf(){
  cancelAnimationFrame(__suraProgRaf);

  let _lastT = 0;

  const tick = (now) => {
    if (surahPlaying && verseAudio && !verseAudio.paused && !verseAudio.ended) {
      const t = (typeof now === "number")
        ? now
        : ((performance && performance.now) ? performance.now() : Date.now());

      // ✅ throttle auf ~90ms (~11fps)
      if (!_lastT || (t - _lastT) >= 90) {
        _lastT = t;
        __setSuraProgressPct(__computeSuraProgressPct());
      }

      __suraProgRaf = requestAnimationFrame(tick);
    }
  };

  // ✅ sofort einmal setzen (damit es nicht “hinterher hängt”)
  __setSuraProgressPct(__computeSuraProgressPct());
  __suraProgRaf = requestAnimationFrame(tick);
}

function __stopSuraProgRaf({ reset = false } = {}){
  cancelAnimationFrame(__suraProgRaf);
  __suraProgRaf = 0;
  if (reset) __setSuraProgressPct(0);
}

function playFromButton(btn, url, { queueMode = false, onEnded = null } = {}) {
  if (!url) return;

  // ✅ Safety: falls irgendwo noch relative reciter/wbw URLs in data-audio stehen,
  // machen wir sie hier immer absolut zur R2 Audio Domain.
  try {
    let u = String(url || "").trim();

    // wenn jemand aus Versehen "audio.quranm.com/..." ohne https setzt
    if (/^audio\.quranm\.com\//i.test(u)) u = "https://" + u;

    // führenden Slash entfernen ("/reciter/..." -> "reciter/...")
    if (u.startsWith("/")) u = u.slice(1);

    // relative reciter/wbw automatisch zur Audio-Domain
    if (!/^https?:\/\//i.test(u) && (u.startsWith("reciter/") || u.startsWith("wbw/"))) {
      u = `${AUDIO_BASE_URL}/${u}`;
    }

    url = u;
  } catch (e) {}

  // Wenn Wort-Audio läuft: stoppen, weil jetzt Ayah/Basm startet
  stopWordAudio();

  // Single-Ayah Klick soll Sura-Queue beenden
  if (!queueMode) stopSurahQueue();

  // Gleicher Button nochmal => Pause/Resume
  if (verseAudio && verseBtnPlaying === btn) {
    toggleVersePause();
    return;
  }
  // ✅ Auto-scroll Gate wird kurz vor Ende der vorherigen Ayah gesetzt.
  // Default: true (damit Start/Manuell nicht blockiert).
  // Wichtig: gilt für SurahPlay UND FavPlay (wenn sie wirklich aktiv sind).
  const __statusbar = document.getElementById("statusbar");
  const __favPlaying = !!(__statusbar && __statusbar.classList.contains("is-fav-playing"));
  const __surahPlaying = !!((typeof surahPlaying !== "undefined") && surahPlaying);

  const __useAutoScrollGate = !!(queueMode && (__surahPlaying || __favPlaying));

  const __allowAutoScrollToNext =
    __useAutoScrollGate
      ? !!__autoScrollGate
      : true;

  // reset fürs nächste Segment (wird wieder kurz vor Ende gesetzt)
  __autoScrollGate = true;

  stopVerseAudio({ stopQueue: !queueMode });

verseAudio = new Audio(url);

// ✅ Wichtig für WebAudio / Analyzer: sonst "outputs zeroes due to CORS"
verseAudio.crossOrigin = "anonymous";

try { applyGlobalVolume(); } catch(e){}

  // ✅ Ayah Edge: pro Reciter aus CSS :root (Fade + Silence)
  try {
    const prof = getAyahEdgeProfileForReciter((typeof RECITER !== "undefined") ? RECITER : "");
    const fadeMs = Number(prof?.fadeMs || 0);
    const silenceMs = Number(prof?.silenceMs || 0);
    const minMul = Number(prof?.minMul || 0);
    const silenceMul = Number(prof?.silenceMul || 0);
    __initVerseFade(verseAudio, { fadeMs, silenceMs, minMul, silenceMul, queueMode });
  } catch (e) {}

  verseBtnPlaying = btn;

  // ✅ welche Ayah spielt gerade? (für Swap Ayah<->Mushaf)
  verseRefPlaying =
    btn?.dataset?.ref ||
    btn?.getAttribute?.("data-ref") ||
    btn?.closest?.(".mNo")?.dataset?.ref ||
    btn?.closest?.(".ayahMainCard")?.dataset?.ref ||
    null;

  // ✅ Highlight immer.
  // ✅ Scroll nur wenn vorherige Ayah im Bild war (== __allowAutoScrollToNext)
  try {
    if (verseRefPlaying && /^\d+:\d+$/.test(String(verseRefPlaying))) {
      if (viewMode === "ayah") {
        const qv = document.querySelector(".qView");
        if (qv && qv.style.display !== "none") {
          focusAyahCard(qv, verseRefPlaying, { scroll: false });
          syncPlayingCardGlow();

          if (__allowAutoScrollToNext) {
            scrollToAyahWhenReady(qv, verseRefPlaying, { scroll: true });
          }
        }
      } else {
        const mv = document.querySelector(".mView");
        if (mv && mv.style.display !== "none") {
          syncPlayingMushafFocus();

          if (__allowAutoScrollToNext) {
            scrollToMushafNoWhenReady(mv, verseRefPlaying, { updateUrl: false, scroll: true });
          }
        }
      }
    }
  } catch (e) {}

  // ✅ word timings highlight (nur wenn wir eine echte ref haben)
  if (verseRefPlaying && verseAudio) {
    attachTimingToVerseAudio(verseAudio, verseRefPlaying);
  }

  // UI state an
  btn.classList.add("is-playing");
  btn.classList.remove("is-paused");

const hardStop = () => {
  // ✅ In Queue-Mode NICHT resetten (sonst springt Balken zwischen Ayat/Basm auf 0)
  try { __stopSuraProgRaf({ reset: !queueMode }); } catch(e){}
  stopVerseAudio({ stopQueue: !queueMode });
};

  verseAudio.addEventListener(
    "ended",
    () => {
      // ✅ FAILSAFE: Auto-scroll Gate am *echten* Ende festlegen.
      // Manche Browser/MP3 liefern duration spät/komisch -> dann greift der 350ms-Check nicht.
       try {
         const sb = document.getElementById("statusbar");
         const favPlaying = !!(sb && sb.classList.contains("is-fav-playing"));
         const suraPlaying = !!((typeof surahPlaying !== "undefined") && surahPlaying);

         if (queueMode && (suraPlaying || favPlaying)) {
           __autoScrollGate = __isRefVisibleNow(verseRefPlaying);
         }
       } catch {}

      // ✅ erst dieses Audio sauber stoppen,
      // dann ggf. die nächste Ayah starten (sonst killt hardStop die neu gestartete Audio)
      hardStop();
      try { onEnded && onEnded(); } catch {}
    },
    { once: true }
  );

  // ✅ 350ms vor Ende: merken, ob die aktuelle Ayah noch im Viewport ist.
  // Das verhindert "hochspringen", wenn der User weggescrollt hat.
  let __gatePreEndSet = false;

verseAudio.addEventListener("timeupdate", () => {
  try {
    const d = Number(verseAudio?.duration || 0);
    const t = Number(verseAudio?.currentTime || 0);
    if (!Number.isFinite(d) || d <= 0) return;

    // ✅ Fade-In + Fade-Out (damit Background nicht "stumm hängen" kann)
    try { __maybeStartVerseFadeIn(verseAudio); } catch {}
    try { __maybeStartVerseFadeOut(verseAudio); } catch {}

    // ✅ Mushaf Progress-Ring (nur wenn Mushaf sichtbar + echte Ayah-Ref)
    try {
      const r = String(verseRefPlaying || "");
      if (r && /^\d+:\d+$/.test(r) && viewMode !== "ayah") {
        const mv = document.querySelector(".mView");
        if (mv && mv.style.display !== "none") {
          const el = mv.querySelector(`.mNo[data-ref="${CSS.escape(r)}"]`);
          if (el && !el.classList.contains("is-copied")) {
            const p = Math.max(0, Math.min(1, t / d));   // 0..1
            el.style.setProperty("--ring", String(p));
          }
        }
      }
    } catch {}

    // --- Queue-Mode: ~350ms vor Ende -> AutoScroll-Gate setzen
    if (queueMode && !__gatePreEndSet) {
      const sb = document.getElementById("statusbar");
      const favPlaying = !!(sb && sb.classList.contains("is-fav-playing"));
      const suraPlaying = !!((typeof surahPlaying !== "undefined") && surahPlaying);

      if (suraPlaying || favPlaying) {
        if (t >= d - 0.35) {
          __gatePreEndSet = true;
          __autoScrollGate = __isRefVisibleNow(verseRefPlaying);
        }
      }
    }

    // --- Single-Ayah Mode: harter Stop sehr kurz vor Ende
    if (!queueMode) {
      if (t >= d - 0.06) hardStop();
    }
  } catch {}
}, { passive: true });

  verseAudio.addEventListener("error", hardStop, { once: true });

  verseAudio.addEventListener("play", () => {

    // ✅ WebAudio: wir merken uns die AudioContext-Zeitbasis für dieses Element
    try{
      __ensureAudioContext();
      if (__ac) {
        // mapping: acTime ≈ currentTime + base
        verseAudio._acBase = __acNow() - Number(verseAudio.currentTime || 0);
      }
    }catch{}

    // ✅ Fade-Out exakt zur Track-Duration planen (wenn möglich)
    try{
      if (verseAudio._needsFadeOutSchedule && verseAudio._edgeGain && __ac && Number.isFinite(verseAudio.duration) && verseAudio.duration > 0) {
        const eg = verseAudio._edgeGain;
        const now = __acNow();
        const base = Number(verseAudio._acBase || 0);

        const d = Number(verseAudio.duration || 0);
        const cutSec = Math.max(0, Number(verseAudio._fadeCutSec || 0));

        const fadeOutSec = Math.max(0, Number(verseAudio._fadeOutFadeSec || 0));
        const silOutSec  = Math.max(0, Number(verseAudio._fadeOutSilenceSec || 0));

        const floor = Math.max(0, Math.min(1, Number(verseAudio._fadeMinMul || 0)));
        const silLv = Math.max(0, Math.min(1, Number(verseAudio._silenceMul || 0)));

        const stopSec = Math.max(0, d - cutSec);
        const silStartSec = Math.max(0, stopSec - silOutSec);
        const fadeStartSec = Math.max(0, silStartSec - fadeOutSec);

        // in AudioContext time
        const tFadeStart = base + fadeStartSec;
        const tSilStart  = base + silStartSec;

        // ab "now" nicht anfassen, was schon lief (fade-in bleibt). Wir planen nur wenn Zeiten in Zukunft liegen
        if (tFadeStart > now + 0.01) {
          // Wert zum Zeitpunkt fadeStart setzen (damit kein Sprung)
          eg.gain.setValueAtTime(1, tFadeStart);

          // Ramp auf floor bis silStart
          if (fadeOutSec > 0) {
            eg.gain.linearRampToValueAtTime(floor, tSilStart);
          } else {
            eg.gain.setValueAtTime(floor, tSilStart);
          }

          // Silence-Level ab silStart (bis Ende)
          eg.gain.setValueAtTime(silLv, tSilStart);
        }

        verseAudio._needsFadeOutSchedule = false;
      }
    }catch{}



    // ✅ Fade-In (nur einmal pro Track) + ggf. Fade-Out Resume
    try { __maybeStartVerseFadeIn(verseAudio); } catch {}
    try { __maybeStartVerseFadeOut(verseAudio); } catch {}

    syncVerseBtnState();

    // ✅ Mushaf Ring smooth starten (gilt für AyahPlay, SurahPlay, FavPlay)
    try { __startMushafRingRaf(); } catch {}

    // ✅ nur im SurahPlay live updaten
    if (surahPlaying) {
      try { __startSuraProgRaf(); } catch (e) {}
    }
  });

  // ✅ NUR 1x pause (alles zusammen)
  verseAudio.addEventListener("pause", () => {
    try {
      // ✅ Mushaf Ring RAF stoppen (Ring bleibt stehen, wirkt stabil)
      try { __stopMushafRingRaf({ reset: false }); } catch {}

      // Single-Ayah Mode: wenn Pause exakt am Ende, Stop erzwingen
      if (!queueMode) {
        const d = Number(verseAudio?.duration || 0);
        const t = Number(verseAudio?.currentTime || 0);
        if (Number.isFinite(d) && d > 0 && Number.isFinite(t) && t >= d - 0.06) {
          hardStop();
        }
      }

      syncVerseBtnState();

      // SurahPlay RAF anhalten (nicht resetten)
      if (surahPlaying) {
        try { __stopSuraProgRaf({ reset: false }); } catch (e) {}
      }

      // Statusbar Progress stoppen (falls aktiv)
      try { window.__stopStatusbarProg?.(); } catch {}
    } catch {}
  });

  verseAudio.play().catch(() => hardStop());
}

// ===== MP3-NAMEN (global, damit basmMp3Url/ayahMp3Url IMMER existieren)
let RECITER = "alafasy";               // ✅ UI/Storage key (Dropdown)
let RECITER_AUDIO_FOLDER = "Mishari Rashid al Afasy"; // ✅ echter Ordnername in /reciter

// ✅ AUDIO_BASE_URL ist bereits weiter oben definiert (vor TRANSLATIONS)

// ✅ Reciter root über R2
const AUDIO_ROOT = `${AUDIO_BASE_URL}/reciter`;

const pad3 = (n) => String(Number(n)).padStart(3, "0");

// encode einzelne Pfad-Segmente (Spaces usw.)
const encSeg = (s) => encodeURIComponent(String(s || ""));

// reciter/<Reciter Folder>/<001-114>/
const surahDir = (surahNo) => `${AUDIO_ROOT}/${encSeg(RECITER_AUDIO_FOLDER)}/${pad3(surahNo)}/`;

// basm: reciter/<reciter>/002/002000.mp3
const basmMp3Url = (surahNo) => `${surahDir(surahNo)}${pad3(surahNo)}000.mp3`;

// ayah: reciter/<reciter>/002/002001.mp3
// special: Sura 1 => 1:1 -> 001000.mp3
const ayahMp3Url = (surahNo, ayahNo) => {
  let idx = ayahNo;
  if (surahNo === 1) idx = ayahNo - 1;
  if (idx < 0) idx = 0;
  return `${surahDir(surahNo)}${pad3(surahNo)}${pad3(idx)}.mp3`;
};

// optional debug helper
window.__getReciter = () => RECITER;

// --- Word Audio (1x global), damit nur ein Wort gleichzeitig spielt ---
let wordAudio = null;
let wordElPlaying = null;

function stopWordAudio() {
  if (wordAudio) {
    try { wordAudio.pause(); } catch {}
    try { wordAudio.currentTime = 0; } catch {}
  }
  wordAudio = null;

  if (wordElPlaying) {
    wordElPlaying.classList.remove("is-playing", "is-paused");
    wordElPlaying = null;
  }
}

// ===================== Word Timings (highlight) =====================

// IMPORTANT:
// - timing JSON ms sind ABSOLUT im Surah-Audio (audio_url im JSON)
// - wir spielen aber Ayah-MP3s -> wir addieren Ayah-Start-ms als Offset

const TIMINGS_BASE = `${AUDIO_BASE_URL}/timings_out`;
let TIMINGS_ROOT = `${TIMINGS_BASE}/Mishari Rashid al Afasy`;
const timingCache = new Map(); // surahNo -> json
// ✅ DOM-Cache: ref -> Array<HTMLElement> (Index = data-wi)
const wordDomCache = new Map();

function invalidateWordDomCache() {
  wordDomCache.clear();
  // optional: aktives Highlight sicher resetten (verhindert "hängende" Klasse)
  if (timingActiveEl) {
    timingActiveEl.classList.remove("is-timing");
    timingActiveEl = null;
  }
}

function _wordScopeEl() {
  // Wichtig: nur in der aktuell sichtbaren View suchen (Ayah vs Mushaf)
  return (viewMode === "mushaf")
    ? (document.querySelector(".mView") || document)
    : (document.querySelector(".qView") || document);
}

function getWordElCached(ref, wi0) {
  const r = String(ref || "");
  if (!r) return null;

  // Cache-Key MUSS viewMode enthalten, sonst greift Ayah-Cache im Mushaf (und umgekehrt)
  const key = `${viewMode}|${r}`;

  let arr = wordDomCache.get(key);
  if (!arr) {
    const scope = _wordScopeEl();

    // CSS.escape schützt refs sauber
    const selRef = CSS.escape(r);

    // nur innerhalb der aktuellen View einsammeln
    const els = Array.from(scope.querySelectorAll(`.w[data-ref="${selRef}"]`));

    arr = [];
    for (const el of els) {
      const n = Number(el.dataset?.wi);
      if (Number.isFinite(n) && n >= 0) arr[n] = el;
    }
    wordDomCache.set(key, arr);
  }

  return arr[wi0] || null;
}

let timingActiveEl = null;

// aktueller timing-run (damit wir listener sauber entfernen)
let timingRun = null;

function timingUrlForSurah(surahNo) {
  const s = String(Number(surahNo)).padStart(3, "0");
  return `${TIMINGS_ROOT}/surah_${s}.json`;
}

async function getSurahTimings(surahNo) {
  const s = Number(surahNo);
  if (timingCache.has(s)) return timingCache.get(s);

  const url = timingUrlForSurah(s);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`timing fetch failed ${res.status}: ${url}`);
  const json = await res.json();

  timingCache.set(s, json);
  return json;
}

function clearTimingHighlight() {
  if (timingActiveEl) {
    timingActiveEl.classList.remove("is-timing");
    timingActiveEl = null;
  }
}

// wordIndex im JSON ist i.d.R. 1-based, bei uns data-wi ist 0-based
function setTimingWord(ref, wordIndex1Based) {
  const wi = Number(wordIndex1Based) - 1;
  if (!Number.isFinite(wi) || wi < 0) return;

  const el = getWordElCached(ref, wi);
  if (!el) return;

  if (timingActiveEl && timingActiveEl !== el) {
    timingActiveEl.classList.remove("is-timing");
  }
  timingActiveEl = el;
  timingActiveEl.classList.add("is-timing");
}


function detachTimingRun() {
  try { timingRun?.detach?.(); } catch {}
  timingRun = null;
  clearTimingHighlight();
}

async function attachTimingToVerseAudio(audioEl, ref) {
  // ref Format: "2:255"
  const [sStr, aStr] = String(ref || "").split(":");
  const s = Number(sStr);
  const a = Number(aStr);
  if (!s || !a || !audioEl) return;

  // alte run weg
  detachTimingRun();

  let timings;
  try {
    timings = await getSurahTimings(s);
  } catch (e) {
    // wenn timing json fehlt -> einfach kein highlighting
    return;
  }

  const list = timings?.ayahs?.[String(a)];
  if (!Array.isArray(list) || list.length === 0) return;

  // list entries: [wordIndex, startMs, endMs] (absolute in surah)
  // AyahStart = startMs vom ersten word
  const ayahStartMs = Number(list[0]?.[1] ?? 0);

  // wir laufen pointer-basiert durch (performant)
  const segs = list
    .map((x) => [Number(x[0]), Number(x[1]), Number(x[2])])
    .filter((x) => Number.isFinite(x[0]) && Number.isFinite(x[1]) && Number.isFinite(x[2]))
    .sort((p, q) => p[1] - q[1]); // nach startMs

  let idx = 0;

  // ✅ NEGATIV = Highlight später (Delay)
  // Wenn es bei dir ca. 200ms zu früh ist -> -200 passt meistens
  const leadMs = -1;

  const onTime = () => {
    if (!audioEl) return;

    // currentTime ist relativ zur Ayah-MP3 -> auf absolute surah-ms mappen
    const absMs = ayahStartMs + (audioEl.currentTime * 1000) + leadMs;

    // idx vorziehen falls nötig
    while (idx < segs.length - 1 && absMs >= segs[idx][2]) idx++;

    const cur = segs[idx];
    if (!cur) return;

    const [wordIndex, startMs, endMs] = cur;
    if (absMs >= startMs && absMs < endMs) {
      setTimingWord(`${s}:${a}`, wordIndex);
    }
  };

  // initial (falls currentTime > 0)
  onTime();

  let rafId = 0;

const tick = () => {
  if (!audioEl) return;

  // ✅ Wenn Audio nicht wirklich "laufbereit" ist (Buffering/Seeking), Highlighting nicht vorwärts schieben
  // HAVE_FUTURE_DATA = 3 (genug Daten um weiterzuspielen)
  if (audioEl.paused || audioEl.seeking || (audioEl.readyState && audioEl.readyState < 3)) {
    rafId = requestAnimationFrame(tick);
    return;
  }

  const absMs = ayahStartMs + (audioEl.currentTime * 1000) + leadMs;

  while (idx < segs.length - 1 && absMs >= segs[idx][2]) idx++;

  const cur = segs[idx];
  if (cur) {
    const [wordIndex, startMs, endMs] = cur;
    if (absMs >= startMs && absMs < endMs) {
      setTimingWord(`${s}:${a}`, wordIndex);
    }
  }

  rafId = requestAnimationFrame(tick);
};

  const startRaf = () => {
    if (rafId) return;
    rafId = requestAnimationFrame(tick);
  };

  const stopRaf = () => {
    if (!rafId) return;
    try { cancelAnimationFrame(rafId); } catch {}
    rafId = 0;
  };

  // nur laufen lassen wenn wirklich play
  const onPlay = () => startRaf();
  const onPause = () => stopRaf();

  audioEl.addEventListener("play", onPlay);
  audioEl.addEventListener("pause", onPause);
  audioEl.addEventListener("ended", onPause);

  // initial: falls schon spielt
  if (!audioEl.paused) startRaf();

  timingRun = {
    detach: () => {
      stopRaf();
      try { audioEl.removeEventListener("play", onPlay); } catch {}
      try { audioEl.removeEventListener("pause", onPause); } catch {}
      try { audioEl.removeEventListener("ended", onPause); } catch {}
    },
  };

}

function installSpacebarAudioHotkey() {
  if (window.__quranSpacebarHotkeyInstalled) return;
  window.__quranSpacebarHotkeyInstalled = true;

  document.addEventListener(
    "keydown",
    (e) => {
      const isSpace = e.code === "Space" || e.key === " ";
      if (!isSpace) return;

      // nicht triggern, wenn der User gerade tippt
      const ae = document.activeElement;
      const typing =
        ae &&
        (ae.tagName === "INPUT" ||
          ae.tagName === "TEXTAREA" ||
          ae.isContentEditable);
      if (typing) return;

      // Wort hat Priorität
      let did = false;

      if (wordAudio) {
        if (wordAudio.paused) {
          wordAudio.play().catch(() => {});
          wordElPlaying?.classList.remove("is-paused");
        } else {
          wordAudio.pause();
          wordElPlaying?.classList.add("is-paused");
        }
        did = true;
      } else {
        did = toggleVersePause(); // kommt aus dem Verse-Audio Block
      }

      if (did) e.preventDefault();
    },
    { capture: true }
  );
}

function installBookmarkHotkey() {
  if (window.__quranBookmarkHotkeyInstalled) return;
  window.__quranBookmarkHotkeyInstalled = true;

  document.addEventListener("keydown", (e) => {
    if (e.key !== "b" && e.key !== "B") return;

    const ae = document.activeElement;
    const typing =
      ae &&
      (ae.tagName === "INPUT" ||
        ae.tagName === "TEXTAREA" ||
        ae.isContentEditable);
    if (typing) return;

    if (/^\d+:\d+$/.test(currentRef)) {
      const res = toggleBookmark(currentRef);
      // UI sync (nur falls Ayah view da)
      const qv = document.querySelector(".qView");
      if (qv) {
        const btn = qv.querySelector(`button.ayahBm[data-bm="${CSS.escape(currentRef)}"]`);
        if (btn) btn.classList.toggle("is-on", res.bookmarked);
      }
    }

    e.preventDefault();
  }, { capture: true });
}

function ensureQView() {
  const stage = document.getElementById("stage");
  if (!stage) return null;

  let view = stage.querySelector(".qView");
  if (!view) {
    view = document.createElement("div");
    view.className = "qView";
    stage.appendChild(view);
  }
  return view;
}

let __inFavoritesPage = false;
let __favPrevViewMode = "ayah";
let __favPrevRef = null;

// =========================
// VIEW MODE: "ayah" | "mushaf"
// =========================
let viewMode = "ayah";
let currentRef = "2:255";
// Statusbar-Play soll immer wissen in welcher Sura man gerade ist
let currentSurahInView = 2;

// =========================
// Render batching (perf + keine Render-Stürme)
// =========================
let __renderJobId = null;
let __renderPendingRef = null;

function __renderCurrentNow(ref) {
  // ======= HIER BEGINNT DEIN ALTER renderCurrent BODY =======
  currentRef = ref || currentRef;
    invalidateWordDomCache();

  const qv = document.querySelector(".qView");

  if (viewMode === "mushaf") {
    renderMushaf(currentRef);

    const mv = document.querySelector(".mView");
    if (qv) qv.style.display = "none";
    if (mv) {
      mv.style.display = "block";

      // ✅ erst scrollen, wenn .mNo existiert (Chunking!)
      scrollToMushafNoWhenReady(mv, currentRef, { updateUrl: false, scroll: true });
    }
  }
  else {
 if (verseAudio && !verseAudio.paused && verseRefPlaying && __autoScrollGate) {
  currentRef = verseRefPlaying; // ✅ nur auto-folgen, wenn Gate aktiv ist
}
    renderAyahWords(currentRef);

    const mv = document.querySelector(".mView");
    const qv2 = document.querySelector(".qView");

    if (mv) mv.style.display = "none";
    if (qv2) qv2.style.display = "flex"; // ✅ flex damit gap + scroll passt

    // ✅ nachdem Ayah-View sichtbar ist: sicher scrollen
    if (qv2) {
      // ✅ erst scrollen/fokussieren wenn die Ziel-Card existiert
      scrollToAyahWhenReady(qv2, currentRef, { scroll: "instant" });
    }
  }
    // ✅ Favorites Progress: nach jedem Render Views finden + Listener binden + update triggern
  try { window.__bindFavProgressListeners?.(); } catch(e) {}
  try { window.__scheduleFavProgressUpdate?.(); } catch(e) {}
  // ======= HIER ENDET DEIN ALTER renderCurrent BODY =======
}

// ✅ Öffentliche API bleibt gleich: renderCurrent()
// Aber intern wird gebatched: viele schnelle Calls -> 1 Render
function renderCurrent(ref) {
  // ✅ Favorites-Seite darf NICHT überschrieben werden
  if (typeof __inFavoritesPage !== "undefined" && __inFavoritesPage) return;

  __renderPendingRef = ref || __renderPendingRef || currentRef;

  // Wenn schon geplant -> nur Ref updaten, NICHT nochmal schedulen
  if (__renderJobId != null) return;

  // Idle-first, aber mit Timeout damit es nicht “hängt”
  __renderJobId = scheduleRender(() => {
    __renderJobId = null;

    const r = __renderPendingRef || currentRef;
    __renderPendingRef = null;

    __renderCurrentNow(r);
  }, { timeout: 80 });
}

function toggleViewMode() {
  viewMode = viewMode === "ayah" ? "mushaf" : "ayah";
  dlog("ui", "viewMode", viewMode);

  // ✅ Wenn currentRef aus irgendeinem Grund basm:* ist: fallback auf 2:1 der Sura
  if (!/^\d+:\d+$/.test(currentRef)) {
    const m = String(currentRef).match(/^basm:(\d{1,3})$/);
    if (m) currentRef = `${Number(m[1])}:1`;
  }

  // ✅ WICHTIG: SurahSelect/SurahPlay SOFORT korrekt setzen (auch ohne “Play”-Trigger)
  try {
    const a = getAyah(currentRef);
    if (a?.surah) setSurahContext(a.surah);
  } catch {}

  // Render + Persist wie gehabt
  renderCurrent(currentRef);
  persistNavState();

  // ✅ Statusbar Icon aktualisieren
  try { window.__syncViewToggleBtn?.(); } catch {}

  // ✅ (optional aber hilfreich) direkt einmal progress/update anstoßen
  try { window.__bindFavProgressListeners?.(); } catch(e) {}
  try { window.__scheduleFavProgressUpdate?.(); } catch(e) {}
}

// =========================
// WORD DISPLAY (textAr) + WORD AUDIO (wbw) MAPPING
// =========================

// Ordner wo deine 80k Word-by-Word MP3 liegen:
const WORD_AUDIO_ROOT = `${AUDIO_BASE_URL}/wbw`; // z.B. https://audio.quranm.com/wbw/002_013_013.mp3

const _pad3w = (n) => String(Number(n)).padStart(3, "0");

// Waqf/Stop marks die oft am Wort "dranhängen"
const _WAQF_MARKS = "ۖۗۘۙۚۛۜ۝۞۩";
const _reTrailingMarks = new RegExp(`^(.*?)([${_WAQF_MARKS}]+)$`);
const _reOnlyMarks = new RegExp(`^[${_WAQF_MARKS}]+$`);

function wordMp3Url(surahNo, ayahNo, wordNo) {
  return `${WORD_AUDIO_ROOT}/${_pad3w(surahNo)}_${_pad3w(ayahNo)}_${_pad3w(wordNo)}.mp3`;
}

function tokenizeTextAr(textAr) {
  const raw = String(textAr || "").trim();
  if (!raw) return [];

  const base = raw.split(/\s+/).filter(Boolean);
  const out = [];

  for (const tok of base) {
    const m = tok.match(_reTrailingMarks);
    if (m) {
      if (m[1]) out.push(m[1]);   // Wort ohne Mark
      out.push(m[2]);             // Mark(s) separat
    } else {
      out.push(tok);
    }
  }
  return out;
}

/**
 * Baut <span class="w">...</span> aus textAr (sichtbarer Text),
 * mappt aber Wortindex (wi) gegen ayah.words (für de/en später),
 * und setzt Audio:
 *  - data-audio  = "continuous" wbw (…_013.mp3)
 *  - data-audio2 = fallback aus JSON (falls du das später brauchst)
 */
function buildWordSpans({ ref, surah, ayahNo, textAr, words }) {
  const wordObjs = (words || []).filter((w) => !w.isAyahNoToken);
  const toks = tokenizeTextAr(textAr);

  let wi = 0; // zählt nur "sprechbare Wörter" (ohne waqf marks)
  return toks
    .map((t) => {
      // Nur Waqf-Mark => anzeigen, aber NICHT klickbar / ohne Audio
      if (_reOnlyMarks.test(t)) {
        return `<span class="w wMark" aria-hidden="true">${t}</span>`;
      }

      const w = wordObjs[wi] || null;

      // 1) dein erwartetes Schema (continuous)
      const primary = wordMp3Url(surah, ayahNo, wi + 1);

      // 2) fallback: was in JSON steht (kann "gapped" sein)
      const alt = w?.audioUrl ? String(w.audioUrl) : "";

      const html =
        `<span class="w" data-ref="${ref}" data-wi="${wi}" data-audio="${primary}" data-audio2="${alt}">${t}</span>`;

      wi++;
      return html;
    })
    .join("");
}

// Spielt Word-Audio von einem .w Span (mit fallback)
function playWordFromSpan(wEl) {
  const url1 = wEl?.dataset?.audio || "";
  const url2 = wEl?.dataset?.audio2 || "";

  if (!url1 && !url2) return;

  // Toggle: gleiches Wort nochmal -> stop
  if (wordElPlaying === wEl && wordAudio && !wordAudio.paused) {
    stopWordAudio();
    return;
  }

  stopWordAudio();

  wordElPlaying = wEl;
  wEl.classList.add("is-playing");

  const start = (url, isFallback = false) => {
    if (!url) return stopWordAudio();

    wordAudio = new Audio(url);
    wordAudio.preload = "auto";

    // ✅ WICHTIG: Wordplay-Volume direkt beim Erzeugen setzen
    try {
      const v = (typeof globalVolume === "number") ? globalVolume : 1;
      wordAudio.volume = Math.min(1, Math.max(0, v));
    } catch (e) {}

    wordAudio.addEventListener("ended", stopWordAudio, { once: true });

    wordAudio.addEventListener(
      "error",
      () => {
        if (!isFallback && url2 && url2 !== url1) start(url2, true);
        else stopWordAudio();
      },
      { once: true }
    );

    wordAudio.play().catch(() => {
      if (!isFallback && url2 && url2 !== url1) start(url2, true);
      else stopWordAudio();
    });
  };

  start(url1 || url2, false);
}

function setLiveTopbarSurah(view, surahNo) {
  const el = view?.querySelector?.("#liveSurahTopTitle");
  if (!el) return;

  const sm = getSuraMeta(surahNo);
  if (!sm) return;

  el.innerHTML = `
    <span class="sNum">${surahNo}</span>
    <span class="dot">•</span>
    <span class="sEn">${sm?.nameTranslit ?? ""}</span>
    <span class="dot">•</span>
    <span class="sAr" dir="rtl" lang="ar">${sm?.nameAr ?? ""}</span>
  `;
}

function buildAyahTopStageHtmlSafe() {
  const current = (() => {
    try {
      const n = Number(window.__trainerStageCurrent);
      if (Number.isFinite(n) && n >= 1 && n <= 7) return n;
    } catch(e){}

    try {
      const raw = Number(localStorage.getItem("quranm_trainer_stage_v1") || "2");
      if (Number.isFinite(raw)) return Math.max(1, Math.min(7, raw));
    } catch(e){}

    return 2;
  })();

  const currentProg = getTrainerStageProgress(current);
  const options = [1, 2, 3, 4, 5, 6, 7];

  return `
    <div class="ayahStageDrop" data-stage-drop>
      <button
        class="ayahStageDropBtn has-surah-help"
        type="button"
        data-stage-toggle
        aria-label="Open stage list"
        style="--stage-progress-pct:${currentProg.pct}%;"> 

        <span class="ayahStageDropBtnFill" aria-hidden="true"></span>
        <span class="ayahStageDropText">Stage ${current}</span>
        <span class="ayahStageDropArrow" aria-hidden="true">▼</span>
        <span
          class="acctScoreHelp surahTopHelp is-by-arrow"
          data-reader-help="reader-stage"
          data-reader-help-title="Stage"
          data-reader-help-text="Choose the trainer stage for this flow."
          aria-label="Choose the trainer stage for this flow.">?</span>
      </button>

      <div class="ayahStageDropMenu" role="listbox" aria-label="Stage list">
        ${options.map((n) => {
          const prog = getTrainerStageProgress(n);
          return `
            <button
              class="ayahStageOpt${n === current ? " is-active" : ""}"
              type="button"
              data-stage="${n}"
              aria-label="Stage ${n}, ${prog.done} of ${prog.total}"
              style="--stage-progress-pct:${prog.pct}%;"> 

              <span class="ayahStageOptFill" aria-hidden="true"></span>

              <span class="ayahStageOptContent">
                <span class="ayahStageOptLabel">Stage ${n}</span>
                <span class="ayahStageOptMeta">${prog.done}/${prog.total}</span>
              </span>
            </button>
          `;
        }).join("")}
      </div>
    </div>
  `;
}

const LS_READER_PROGRESS_HISTORY = "quranm_reader_progress_history_v1";
const READER_PROGRESS_HISTORY_MAX_DAYS = 36525;

function getReaderProgressDayKey(ts = Date.now()) {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function loadReaderProgressHistory() {
  try {
    const raw = localStorage.getItem(LS_READER_PROGRESS_HISTORY) || "";
    if (!raw) return {};

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};

    const clean = {};
    for (const [dayKey, pctRaw] of Object.entries(parsed)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dayKey || ""))) continue;

      const pct = Math.max(0, Math.min(100, Number(pctRaw) || 0));
      clean[String(dayKey)] = Math.round(pct);
    }

    return clean;
  } catch {
    return {};
  }
}

function saveReaderProgressHistory(obj) {
  try {
    const clean = {};
    for (const [dayKey, pctRaw] of Object.entries(obj || {})) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dayKey || ""))) continue;

      const pct = Math.max(0, Math.min(100, Number(pctRaw) || 0));
      clean[String(dayKey)] = Math.round(pct);
    }

    const keys = Object.keys(clean).sort();
    if (keys.length > READER_PROGRESS_HISTORY_MAX_DAYS) {
      const drop = keys.length - READER_PROGRESS_HISTORY_MAX_DAYS;
      for (let i = 0; i < drop; i++) {
        delete clean[keys[i]];
      }
    }

    localStorage.setItem(LS_READER_PROGRESS_HISTORY, JSON.stringify(clean));
    return clean;
  } catch {
    return obj || {};
  }
}

function getReaderOverallProgressStats() {
  const repeatTarget = Math.max(1, Number(loadReaderRepeatTarget?.() || 5));
  const SCORE_MAX = 1000000000;

  const escSummary = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    }[c]));

  const perSurah = [];
  let totalSum = 0;
  let totalCount = 0;

  for (let s = 1; s <= 114; s++) {
    const refs = getSuraRefs(Number(s) || 0) || [];

    let sum = 0;
    let count = 0;

    for (const ref of refs) {
      const row = getTrainerReaderRow(ref);
      const ratio = Math.max(0, Math.min(1, Number(row?.rightCount || 0) / repeatTarget));
      sum += ratio;
      count += 1;
      totalSum += ratio;
      totalCount += 1;
    }

    const pct = count
      ? Math.max(0, Math.min(100, Math.round((sum / count) * 100)))
      : 0;

    const smx = getSuraMeta(s) || {};
    const surahTr = escSummary(smx?.nameTranslit ?? `Surah ${s}`);

    perSurah.push({
      surah: s,
      pct,
      surahTr,
    });
  }

  const readPct = totalCount
    ? Math.max(0, Math.min(100, Math.round((totalSum / totalCount) * 100)))
    : 0;

  const readScore = totalCount
    ? Math.max(0, Math.min(SCORE_MAX, Math.round((totalSum / totalCount) * SCORE_MAX)))
    : 0;

  return {
    repeatTarget,
    perSurah,
    readPct,
    readScore,
  };
}

function snapshotReaderProgressHistory() {
  const dayKey = getReaderProgressDayKey();
  const stats = getReaderOverallProgressStats();
  const history = loadReaderProgressHistory();
  const nextPct = Math.max(0, Math.min(100, Number(stats?.readPct || 0)));

  if (Number(history?.[dayKey]) === nextPct) return history;

  history[dayKey] = nextPct;
  return saveReaderProgressHistory(history);
}

function sampleReaderProgressHistory(entries, maxPoints = 240) {
  const list = Array.isArray(entries) ? entries.slice() : [];
  if (list.length <= maxPoints) return list;
  if (maxPoints <= 1) return [list[list.length - 1]];

  const out = [];
  const lastIdx = list.length - 1;

  for (let i = 0; i < maxPoints; i++) {
    const idx = Math.round((i / (maxPoints - 1)) * lastIdx);
    const row = list[idx];
    if (!row) continue;

    if (!out.length || out[out.length - 1].dayKey !== row.dayKey) {
      out.push(row);
    }
  }

  const last = list[lastIdx];
  if (last && (!out.length || out[out.length - 1].dayKey !== last.dayKey)) {
    out.push(last);
  }

  return out;
}

function formatReaderProgressDayLabel(dayKey) {
  const m = String(dayKey || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return String(dayKey || "");

  const [, y, mo, d] = m;
  return `${d}.${mo}.${String(y).slice(-2)}`;
}

function buildReaderProgressChartHtml() {
  const stats = getReaderOverallProgressStats();
  const history = snapshotReaderProgressHistory();

  const entries = Object.keys(history)
    .sort()
    .map((dayKey) => ({
      dayKey,
      dayNo: Math.floor(Date.parse(`${dayKey}T00:00:00`) / 86400000),
      pct: Math.max(0, Math.min(100, Number(history[dayKey]) || 0)),
    }))
    .filter((row) => Number.isFinite(row.dayNo));

  const sampled = sampleReaderProgressHistory(entries, 240);

  const vbW = 3400;
  const vbH = 400;
  const padL = 110;
  const padR = 34;
  const padT = 18;
  const padB = 46;

  const plotW = vbW - padL - padR;
  const plotH = vbH - padT - padB;

  const minDay = sampled.length ? sampled[0].dayNo : 0;
  const maxDay = sampled.length ? sampled[sampled.length - 1].dayNo : minDay;
  const spanDays = Math.max(1, maxDay - minDay);

  const xFor = (dayNo) => padL + (((dayNo - minDay) / spanDays) * plotW);
  const yFor = (pct) => padT + (((100 - pct) / 100) * plotH);

  const points = sampled.map((row) => ({
    x: xFor(row.dayNo),
    y: yFor(row.pct),
  }));

  const linePoints = points.map((p, idx, arr) => {
    const x = Number(p.x.toFixed(2));

    if (arr.length <= 2 || idx === 0 || idx === arr.length - 1) {
      return { x, y: Number(p.y.toFixed(2)) };
    }

    const prev2 = arr[idx - 2] || arr[idx - 1] || p;
    const prev1 = arr[idx - 1] || p;
    const next1 = arr[idx + 1] || p;
    const next2 = arr[idx + 2] || arr[idx + 1] || p;

    const smoothY =
      (
        (prev2.y * 1) +
        (prev1.y * 2) +
        (p.y * 4) +
        (next1.y * 2) +
        (next2.y * 1)
      ) / 10;

    return { x, y: Number(smoothY.toFixed(2)) };
  });

  const pathD = linePoints.length <= 1
    ? linePoints.map((p, idx) => `${idx === 0 ? "M" : "L"} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(" ")
    : (() => {
        let d = `M ${linePoints[0].x.toFixed(2)} ${linePoints[0].y.toFixed(2)}`;

        if (linePoints.length === 2) {
          d += ` L ${linePoints[1].x.toFixed(2)} ${linePoints[1].y.toFixed(2)}`;
          return d;
        }

        const smooth = 0.12;

        for (let i = 0; i < linePoints.length - 1; i++) {
          const p0 = linePoints[i - 1] || linePoints[i];
          const p1 = linePoints[i];
          const p2 = linePoints[i + 1];
          const p3 = linePoints[i + 2] || p2;

          const cp1x = p1.x + ((p2.x - p0.x) * smooth);
          const cp1y = p1.y + ((p2.y - p0.y) * smooth);
          const cp2x = p2.x - ((p3.x - p1.x) * smooth);
          const cp2y = p2.y - ((p3.y - p1.y) * smooth);

          d += ` C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)} ${cp2x.toFixed(2)} ${cp2y.toFixed(2)} ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
        }

        return d;
      })();

  const areaD = linePoints.length
    ? `${pathD} L ${linePoints[linePoints.length - 1].x.toFixed(2)} ${(padT + plotH).toFixed(2)} L ${linePoints[0].x.toFixed(2)} ${(padT + plotH).toFixed(2)} Z`
    : "";

  const gridVals = [0, 25, 50, 75, 100];
  const gridHtml = gridVals.map((pct) => {
    const y = yFor(pct).toFixed(2);
    return `
      <line class="readerHistoryGridLine" x1="${padL}" y1="${y}" x2="${vbW - padR}" y2="${y}"></line>
      <text class="readerHistoryAxisLabel is-y" x="${(padL - 6).toFixed(2)}" y="${y}" text-anchor="end" dominant-baseline="middle">${pct}%</text>
    `;
  }).join("");

  const trackedDays = entries.length
    ? Math.max(1, (entries[entries.length - 1].dayNo - entries[0].dayNo) + 1)
    : 1;

  const xLabelTarget = (() => {
    if (sampled.length <= 1) return 1;
    if (trackedDays >= 3650) return 10;
    if (trackedDays >= 1825) return 9;
    if (trackedDays >= 730) return 8;
    if (trackedDays >= 365) return 7;
    if (trackedDays >= 180) return 6;
    if (trackedDays >= 90) return 5;
    if (trackedDays >= 30) return 4;
    return 3;
  })();

  const xLabelCount = Math.max(1, Math.min(xLabelTarget, sampled.length));

  const xLabelIdx = Array.from(new Set(
    sampled.length
      ? Array.from({ length: xLabelCount }, (_, i) =>
          Math.round((i / Math.max(1, xLabelCount - 1)) * (sampled.length - 1))
        )
      : [0]
  ));

  const xLabelsHtml = xLabelIdx.map((idx) => {
    const row = sampled[idx];
    if (!row) return "";

    const x = xFor(row.dayNo).toFixed(2);
    return `
      <line class="readerHistoryAxisTick" x1="${x}" y1="${(padT + plotH).toFixed(2)}" x2="${x}" y2="${(padT + plotH + (vbH * 0.018)).toFixed(2)}"></line>
      <text class="readerHistoryAxisLabel is-x" x="${x}" y="${(vbH - 10).toFixed(2)}" text-anchor="middle">${formatReaderProgressDayLabel(row.dayKey)}</text>
    `;
  }).join("");

  const dotsHtml = sampled.length <= 120
    ? sampled.map((row) => `
        <circle class="readerHistoryDot" cx="${xFor(row.dayNo).toFixed(2)}" cy="${yFor(row.pct).toFixed(2)}" r="3.6"></circle>
      `).join("")
    : "";

  return `
    <div class="readerHistoryMount" aria-label="Reader progress chart">
      <div class="ayahCard readerHistoryCard">
        <div class="readerHistoryHeader">
          <div class="readerHistoryTitle">Progress history</div>
          <div class="readerHistoryMeta">${stats.readPct}% • ${trackedDays} day${trackedDays === 1 ? "" : "s"}</div>
        </div>

        <div class="readerHistoryChartWrap">
          <svg class="readerHistoryChart" viewBox="0 0 ${vbW} ${vbH}" aria-hidden="true">
            ${gridHtml}
            <line class="readerHistoryAxisBase" x1="${padL}" y1="${(padT + plotH).toFixed(2)}" x2="${vbW - padR}" y2="${(padT + plotH).toFixed(2)}"></line>
            <line class="readerHistoryAxisBase" x1="${padL}" y1="${padT}" x2="${padL}" y2="${(padT + plotH).toFixed(2)}"></line>

            ${areaD ? `<path class="readerHistoryArea" d="${areaD}"></path>` : ""}
            ${pathD ? `<path class="readerHistoryLine" d="${pathD}"></path>` : ""}
            ${dotsHtml}
            ${xLabelsHtml}
          </svg>
        </div>
      </div>
    </div>
  `;
}

function buildReaderStageSummaryHtml() {
  const stats = getReaderOverallProgressStats();
  const readScore = stats.readScore;

  let cells = "";
  for (const item of stats.perSurah) {
    cells += `
      <div class="hifzSurahSummaryCell${item.pct > 0 ? " is-progress" : ""}${item.pct >= 100 ? " is-mastered" : ""}"
           style="--surah-progress:${item.pct}%;"
           data-surah="${item.surah}"
           data-pct="${item.pct}"
           title="Surah ${item.surah} — ${item.surahTr} — ${item.pct}%"
           aria-label="Surah ${item.surah}, ${item.pct}% learned">
        <div class="hifzSurahSummaryCellInner" aria-hidden="true">
          <span class="hifzSurahSummaryNo">${item.surah}</span>
        </div>
      </div>
    `;
  }

  return `
    <div class="hifzSurahSummaryMount" aria-label="Surah progress">
      <div class="ayahCard hifzSurahSummaryCard">
        <div class="hifzSurahSummaryHeader">
          <div class="hifzSurahSummaryTitle">Surah Progress</div>

          <div class="hifzSurahSummaryScore" aria-label="Reader score ${readScore}">
            <span class="hifzSurahSummaryScoreLabelWrap">
              <span class="hifzSurahSummaryScoreLabel">Reader score</span>
              <span
                class="hifzSurahSummaryScoreHelp"
                tabindex="0"
                role="button"
                aria-label="Reader score help">?</span>
            </span>
            <span class="hifzSurahSummaryScoreValue">${readScore}</span>
          </div>
        </div>

        <div class="hifzSurahSummaryGrid">
          ${cells}
        </div>
      </div>
    </div>
  `;
}

function renderAyahWords(ref) {
  const ay = getAyah(ref);
  if (!ay) return;

  const view = ensureQView();
  if (!view) return;

  // Ayah-Mode = jetzt wirklich nur eine Ayah-Card
  view.dataset.mode = "singleAyahCard";

  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    }[c]));

  const surah = ay.surah;
  const sm = getSuraMeta(surah);
  const modeText = (viewMode === "mushaf") ? "Ayah mode" : "Mushaf mode";

  const bmSet = new Set((getActiveFavRefs?.() || []).map(String));

  const topBarHtml = `
    <div class="surahTopBar ayahTopBar">
      <div class="surahTopFarLeft">
        <div class="ayahTopLeftControls">
          ${buildAyahTopStageHtmlSafe()}
          ${buildReaderRepeatTargetSelectHtml()}
          ${buildReaderReviewModeSelectHtml()}
        </div>
      </div>

      <div class="surahTopLeft">
        <div class="surahTitle surahTopTitle">
          <span class="sNum">${surah}</span>
          <span class="dot">•</span>
          <span class="sEn">${sm?.nameTranslit ?? ""}</span>
          <span class="dot">•</span>
          <span class="sAr" dir="rtl" lang="ar">${sm?.nameAr ?? ""}</span>
        </div>
      </div>

      <div class="surahTopRight">
        ${buildReaderFlaggedRefsTopbarHtml()}
        <button class="surahModeBtn" type="button" data-action="toggleView" title="Switch view mode">
          <span class="modeText">${modeText}</span>
          <span class="modeArrow">→</span>
        </button>
      </div>
    </div>
  `;

  const basmCardHtml = (surahNo) => {
    if (surahNo === 1 || surahNo === 9) return "";
    const trHtml = buildBasmTranslationsHtml(esc);

    return `
      <div class="basmCard ayahCard ayahMainCard" data-ref="basm:${surahNo}" tabindex="0">
        <div class="basmHeader">
          <button class="ayahPlay" type="button" data-audio="${basmMp3Url(surahNo)}" aria-label="Play Basmallah"></button>
          <div class="basmLabel">Basmallah</div>
        </div>

        <div class="basmAr">بِسْمِ ٱللَّٰهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ</div>

        ${trHtml}
      </div>
    `;
  };

  const showBasm =
    ay.ayah === 1 &&
    surah !== 1 &&
    surah !== 9;

  const ayahNo = ay.ayah;
  const wordsHtml = buildWordSpans({ ...ay, ayahNo });
  const mp3 = ayahMp3Url(ay.surah, ayahNo);

  const ayahCardHtml = `
    <div class="ayahCard ayahMainCard is-single-ayah" data-ref="${ay.ref}" tabindex="0">
      <div class="ayahHeaderRow">
        <div class="ayahRefRow">
          <button class="ayahBtn ayahPlay playAyah" type="button" data-audio="${mp3}" aria-label="Play Ayah"></button>

          <button class="ayahBtn favContinuePlayBtn" type="button" data-ref="${ay.ref}" aria-label="Continue Favorites from ${ay.ref}" title="Continue from here">⟲</button>

          <div class="ayahRef">${ay.ref}</div>

          <button class="ayahBtn ayahBm${bmSet.has(ay.ref) ? " is-on" : ""}"
            type="button"
            data-bm="${ay.ref}"
            aria-label="Bookmark ${ay.ref}"
            title="Bookmark"></button>

          <button class="ayahCopy ayahCopyBtn"
            type="button"
            data-copy="${ay.ref}"
            aria-label="Copy ${ay.ref}"
            title="Copy">
            <svg class="copyIcon" viewBox="0 0 24 24" aria-hidden="true">
              <rect x="9" y="9" width="11" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="2"></rect>
              <rect x="4" y="4" width="11" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="2"></rect>
            </svg>
          </button>

          <button class="ayahNote ayahNoteBtn"
            type="button"
            data-note="${ay.ref}"
            aria-label="Notes ${ay.ref}"
            title="Notes">
            <svg class="noteIcon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M7 3h8a2 2 0 0 1 2 2v14l-6-3-6 3V5a2 2 0 0 1 2-2z"
                fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
              <path d="M9 7h6M9 10h6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            </svg>
          </button>

          <button class="ayahContinueBtn"
            type="button"
            data-continue="${ay.ref}"
            data-surah="${ay.surah}"
            data-ayah="${ay.ayah}"
            aria-label="Continue ${ay.ref}"
            title="Continue">
            <span class="ayahContinueIcon" aria-hidden="true">▶</span>
            <span class="ayahContinueText">continue</span>
          </button>
        </div>
      </div>

      <div class="ayahText">${wordsHtml}</div>

      ${buildAyahTranslationsHtml(ay, esc)}

      <div class="ayahTrainerBar" data-ref="${ay.ref}">
        <div class="ayahTrainerQuestion hifzStage1FocusLabel">How good did you read the ayah?</div>

        <div class="ayahTrainerButtons" role="group" aria-label="Trainer score buttons for ${ay.ref}">
          <button class="ayahScoreBtn is-bad" type="button" data-score-ref="${ay.ref}" data-rating="bad" data-tip="Press key 1" aria-label="Rate ${ay.ref} as bad">
            <span class="ayahScoreInline">
              <span class="ayahScoreKeyBubble"><span class="ayahScoreKey">1</span></span>
              <span class="ayahScoreWord">bad</span>
            </span>
          </button>

          <button class="ayahScoreBtn is-mid" type="button" data-score-ref="${ay.ref}" data-rating="mid" data-tip="Press key 2" aria-label="Rate ${ay.ref} as middle">
            <span class="ayahScoreInline">
              <span class="ayahScoreKeyBubble"><span class="ayahScoreKey">2</span></span>
              <span class="ayahScoreWord">middle</span>
            </span>
          </button>

          <button class="ayahScoreBtn is-good" type="button" data-score-ref="${ay.ref}" data-rating="good" data-tip="Press key 3" aria-label="Rate ${ay.ref} as good">
            <span class="ayahScoreInline">
              <span class="ayahScoreKeyBubble"><span class="ayahScoreKey">3</span></span>
              <span class="ayahScoreWord">good</span>
            </span>
          </button>
        </div>

        ${buildReaderAyahHeaderProgressHtml(ay.ref)}
      </div>
    </div>
  `;

  view.innerHTML = `
    ${topBarHtml}
    <div class="allCardsMount">
      ${ayahCardHtml}
    </div>
    ${buildReaderProgressChartHtml()}
    ${buildReaderStageSummaryHtml()}
  `;

  const reviewSel = view.querySelector("[data-review-mode]");
  if (reviewSel && !reviewSel.dataset.bound) {
    reviewSel.dataset.bound = "1";

    reviewSel.addEventListener("change", () => {
      const mode = saveTrainerReviewMode(reviewSel.value || "balanced");
      reviewSel.value = String(mode);

      try {
        invalidateTrainerSession(loadTrainerStage());
        const nextRef = pickTrainerNextRef() || String(currentRef || ay.ref);
        currentRef = nextRef;
        try { setRefToHash(nextRef); } catch (e) {}
        renderCurrent(nextRef);
      } catch (e) {}
    });
  }

  const mount = view.querySelector(".allCardsMount");
  applyAyahJustify(mount);
  try { window.__refreshNoteIndicators?.(); } catch(e){}
  try { __syncContinueButtons(); } catch(e){}
  try { __syncTrainerScoreButtons(view); } catch(e){}
  try { __bindTrainerHotkeysOnce(); } catch(e){}

  view.__ayahCacheDirty = true;
  view.__ayahCardsCache = Array.from(view.querySelectorAll(".ayahMainCard[data-ref]"))
    .filter((c) => /^\d+:\d+$/.test(c.dataset.ref || ""));

  if (!view.__ayahHandlersBound) {    view.__ayahHandlersBound = true;

    view.addEventListener("click", (ev) => {
      const t = ev.target;

      const scoreBtn = t?.closest?.("button.ayahScoreBtn[data-score-ref][data-rating]");
      if (scoreBtn) {
        ev.preventDefault();
        ev.stopPropagation();

        const ref = String(scoreBtn.dataset?.scoreRef || "");
        const rating = String(scoreBtn.dataset?.rating || "");

        if (ref && rating) {
          let uiDelay = 0;

          try {
            const flight = runReaderRecallFlightFromButton(scoreBtn, ref, rating);
            uiDelay = flight?.started ? Math.max(0, Number(flight.totalDelay) || 0) : 0;
          } catch (e) {}

          applyTrainerRatingFromUI(ref, rating, { advance: true, uiDelay });
        }
        return;
      
      }
      const noteBtn = t?.closest?.("button.ayahNote[data-note]");
      if (noteBtn) {
        ev.preventDefault();
        ev.stopPropagation();
        const ref = noteBtn.dataset?.note || "";
        if (ref) openNotesForRef(ref);
        return;
      }

      const copyBtn = t?.closest?.("button.ayahCopy[data-copy]");
      if (copyBtn) {
        ev.preventDefault();
        ev.stopPropagation();
        const ref = copyBtn.dataset?.copy || "";
        if (ref) copyAyahRef(ref, { flashEl: copyBtn });
        return;
      }

      const contBtn = t?.closest?.("button.ayahContinueBtn[data-continue]");
      if (contBtn) {
        ev.preventDefault();
        ev.stopPropagation();

        const ref = String(contBtn.dataset?.continue || "");
        if (!/^\d+:\d+$/.test(ref)) return;

        const [sStr, aStr] = ref.split(":");
        const s = Number(sStr);
        const ay = Number(aStr);

        if (typeof surahPlaying !== "undefined" && surahPlaying && Number(surahPlaying) === s) {
          try { startSurahPlayback(s, { fromAyah: ay, btn: document.getElementById("playStop") }); } catch {}
        }
        return;
      }


const closeAyahTopDrops = () => {
  view.querySelectorAll("[data-stage-drop].is-open, [data-repeat-drop].is-open, [data-review-drop].is-open, [data-trainer-flag-drop].is-open").forEach((el) => {
    el.classList.remove("is-open", "is-active");
  });
};

const trainerFlagToggleBtn = t?.closest?.("[data-trainer-flag-toggle]");
if (trainerFlagToggleBtn) {
  ev.preventDefault();
  ev.stopPropagation();

  const drop = trainerFlagToggleBtn.closest?.("[data-trainer-flag-drop]");
  if (!drop) return;

  const willOpen = !drop.classList.contains("is-open");
  closeAyahTopDrops();

  if (willOpen) {
    drop.classList.add("is-open", "is-active");
  }
  return;
}

const trainerFlagRefBtn = t?.closest?.(".hifzBadDropItem[data-trainer-flag-ref]");
if (trainerFlagRefBtn) {
  ev.preventDefault();
  ev.stopPropagation();

  const ref = String(trainerFlagRefBtn.dataset?.trainerFlagRef || "");
  if (!/^\d+:\d+$/.test(ref)) return;

  closeAyahTopDrops();

  currentRef = ref;
  try { setRefToHash(ref); } catch (e) {}
  try { renderCurrent(ref); } catch (e) {}
  try { persistNavState?.(); } catch (e) {}
  return;
}

const reviewToggleBtn = t?.closest?.("[data-review-toggle]");
if (reviewToggleBtn) {
  ev.preventDefault();
  ev.stopPropagation();

  const drop = reviewToggleBtn.closest?.("[data-review-drop]");
  if (!drop) return;

  const willOpen = !drop.classList.contains("is-open");
  closeAyahTopDrops();

  if (willOpen) {
    drop.classList.add("is-open", "is-active");
  }
  return;
}

const reviewOptBtn = t?.closest?.(".ayahReviewOpt[data-review-mode-option]");
if (reviewOptBtn) {
  ev.preventDefault();
  ev.stopPropagation();

  const mode = String(reviewOptBtn.dataset?.reviewModeOption || "balanced");
  saveTrainerReviewMode(mode);
  invalidateTrainerSession(loadTrainerStage());
  closeAyahTopDrops();

  try {
    const nextRef = pickTrainerNextRef() || String(currentRef || "");
    if (nextRef) {
      currentRef = nextRef;
      try { setRefToHash(nextRef); } catch (e) {}
      renderCurrent(nextRef);
      try { persistNavState?.(); } catch (e) {}
    }
  } catch (e) {}

  return;
}

const repeatToggleBtn = t?.closest?.("[data-repeat-toggle]");
if (repeatToggleBtn) {
  ev.preventDefault();
  ev.stopPropagation();

  const drop = repeatToggleBtn.closest?.("[data-repeat-drop]");
  if (!drop) return;

  const willOpen = !drop.classList.contains("is-open");
  closeAyahTopDrops();

  if (willOpen) {
    drop.classList.add("is-open", "is-active");
  }
  return;
}

const repeatOptBtn = t?.closest?.(".ayahRepeatOpt[data-repeat-target-option]");
if (repeatOptBtn) {
  ev.preventDefault();
  ev.stopPropagation();

  const v = Number(repeatOptBtn.dataset?.repeatTargetOption || "5");
  saveReaderRepeatTarget(v);
  invalidateTrainerSession(loadTrainerStage());
  closeAyahTopDrops();

  try {
    const keepRef = String(currentRef || ay.ref || "");
    if (keepRef) {
      currentRef = keepRef;
      renderCurrent(keepRef);
      try { persistNavState?.(); } catch (e) {}
    }
  } catch (e) {}

  return;
}

const stageToggleBtn = t?.closest?.("[data-stage-toggle]");
if (stageToggleBtn) {
  ev.preventDefault();
  ev.stopPropagation();

  const drop = stageToggleBtn.closest?.("[data-stage-drop]");
  if (!drop) return;

  const willOpen = !drop.classList.contains("is-open");
  closeAyahTopDrops();

  if (willOpen) {
    drop.classList.add("is-open", "is-active");
  }
  return;
}

const stageOptBtn = t?.closest?.(".ayahStageOpt[data-stage]");
if (stageOptBtn) {
  ev.preventDefault();
  ev.stopPropagation();

  const v = Number(stageOptBtn.dataset?.stage || "1");
  applyTrainerStage(v, { rerender: true });
  closeAyahTopDrops();
  return;
}

const toggleBtn = t?.closest?.('[data-action="toggleView"]');
if (toggleBtn) {
  closeAyahTopDrops();

  console.log("[toggleView] click", { viewModeBefore: viewMode, currentRef });
  toggleViewMode();
  console.log("[toggleView] after", { viewModeAfter: viewMode, currentRef });
  return;
}

      const suraBtn = t?.closest?.("button.suraPlayBtn");
      if (suraBtn) {
        const s = Number(suraBtn.dataset?.surah || 0);
        if (s >= 1 && s <= 114) {
          toggleSurahPlaybackFromBtn(s, suraBtn);
        }
        return;
      }

      const wEl = t?.closest?.(".w");
      if (wEl && wEl.dataset?.wi != null) {
        stopSurahQueue();
        stopVerseAudio();
        playWordFromSpan(wEl);
        return;
      }

      const bmBtn = t?.closest?.("button.ayahBm");
      if (bmBtn) {
        const r = bmBtn.dataset?.bm || bmBtn.getAttribute("data-bm") || "";
        const res = toggleFavInActivePage(r);

        if (res && res.ok) {
          bmBtn.classList.toggle("is-on", !!res.bookmarked);
        }

        if (__inFavoritesPage) {
          renderFavoritesPage();
        }
        return;
      }

      const btn = t?.closest?.("button.ayahPlay");
      if (btn) {
        const card = btn.closest(".ayahMainCard");
        const r = card?.dataset?.ref || "";

        if (/^\d+:\d+$/.test(r)) {
          currentRef = r;
          setRefToHash(r);
          focusAyahCard(view, r);

          const a = getAyah(r);
          if (a) currentSurahInView = a.surah;
        }

        stopSurahQueue();
        playFromButton(btn, btn.dataset.audio);
        return;
      }

      const card = t?.closest?.(".ayahMainCard");
      if (card?.dataset?.ref) {
        focusAyahCard(view, card.dataset.ref);
      }
    });
  }

  focusAyahCard(view, ref, { scroll: false });

  if (verseAudio && verseRefPlaying) {
    const newCard = view.querySelector(`.ayahMainCard[data-ref="${CSS.escape(verseRefPlaying)}"]`);
    const newBtn = newCard?.querySelector("button.ayahPlay");
    if (newBtn) verseBtnPlaying = newBtn;
    syncVerseBtnState();
  }

  syncPlayingCardGlow();
}

    // =========================
// Smooth scroll helper (ultra smooth, no jitter)
// Scrollt IM Container (qView / mView) und zentriert das Ziel
// =========================
let __qrScrollAnimToken = 0;

function __qrEaseInOut(t) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}
function __qrClamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

function __qrScrollContainerTo(container, targetY, { behavior = "smooth", duration = 420 } = {}) {
  if (!container) return;

  const maxY = Math.max(0, (container.scrollHeight || 0) - (container.clientHeight || 0));
  const to = __qrClamp(targetY, 0, maxY);

  // instant
  if (behavior === "instant" || behavior === "auto") {
    container.scrollTop = to;
    return;
  }

  const from = container.scrollTop;
  const delta = to - from;

  // already there
  if (Math.abs(delta) < 0.5) return;

  const token = ++__qrScrollAnimToken;
  const t0 = performance.now();

  // optional: mark as auto-scrolling (falls du irgendwo gate/logik hast)
  try { window.__qrAutoScrollActiveUntil = Date.now() + duration + 160; } catch (e) {}

  const step = (now) => {
    if (token !== __qrScrollAnimToken) return; // cancelled by newer scroll
    const t = __qrClamp((now - t0) / duration, 0, 1);
    const y = from + delta * __qrEaseInOut(t);
    container.scrollTop = y;
    if (t < 1) requestAnimationFrame(step);
  };

  requestAnimationFrame(step);
}

function __qrScrollElementToCenter(container, el, { behavior = "smooth", duration = 420 } = {}) {
  if (!container || !el) return;

  const cRect = container.getBoundingClientRect();
  const eRect = el.getBoundingClientRect();

  const curTop = container.scrollTop;
  const elCenterInContainer = (eRect.top - cRect.top) + curTop + (eRect.height / 2);
  const targetCenter = (container.clientHeight / 2);

  const targetY = elCenterInContainer - targetCenter;
  __qrScrollContainerTo(container, targetY, { behavior, duration });
}

  function scrollToAyahWhenReady(view, ref, { scroll = "instant", timeoutFrames = 240 } = {}) {
  const targetRef = String(parseRefLoose(ref) || ref);

  let tries = 0;

  const tick = () => {
    const card = view.querySelector(`.ayahMainCard[data-ref="${CSS.escape(targetRef)}"]`);

    if (card) {
      // ✅ Wenn gerade Auto-Smooth-Scroll läuft ODER Audio läuft:
      // "instant" darf NICHT dazwischenfunken (sonst Zucken/Doppelscroll).
      let effectiveScroll = scroll;

      try {
        const now = Date.now();
        const autoBusy =
          typeof window.__qrAutoScrollActiveUntil === "number" &&
          now < window.__qrAutoScrollActiveUntil;

        const audioPlaying =
          (typeof verseAudio !== "undefined") &&
          verseAudio &&
          !verseAudio.paused;

        if (scroll === "instant" && (autoBusy || audioPlaying)) {
          effectiveScroll = false; // nur Fokus/Highlight, kein Jump
        }
      } catch (e) {}

      focusAyahCard(view, targetRef, { scroll: effectiveScroll });

      // ✅ Jump feedback AUS (Ziel ist jetzt da)
      try { window.__setJumpBusy?.(false); } catch {}

      return;
    }

    // solange Chunking noch läuft, warten wir ein paar Frames
    if (tries++ < timeoutFrames) {
      requestAnimationFrame(tick);
      return;
    }

    console.warn("[jump] target not rendered in time:", targetRef);
  };

  tick();
}

function scrollToMushafNoWhenReady(view, ref, { updateUrl = false, scroll = true, timeoutFrames = 240 } = {}) {
  const targetRef = String(parseRefLoose(ref) || ref);

  let tries = 0;

  const tick = () => {
    const btn = view.querySelector(`.mNo[data-ref="${CSS.escape(targetRef)}"]`);

    if (btn) {
      // entspricht deiner bestehenden Fokus-Logik: Klasse setzen, currentRef setzen, optional URL, optional scroll
      view.querySelectorAll(".mNo.is-focus").forEach((el) => el.classList.remove("is-focus"));
      btn.classList.add("is-focus");

      currentRef = targetRef;
      if (updateUrl) setRefToHash(targetRef);

      // ✅ Wenn gerade Auto-Smooth-Scroll läuft: KEIN zusätzlicher scrollIntoView (sonst Zucken)
      let allowScroll = !!scroll;
      try {
        const now = Date.now();
        const autoBusy =
          typeof window.__qrAutoScrollActiveUntil === "number" &&
          now < window.__qrAutoScrollActiveUntil;
        if (autoBusy) allowScroll = false;
      } catch (e) {}

      if (allowScroll) btn.scrollIntoView({ block: "center", behavior: "smooth" });

      // ✅ Jump feedback AUS (Ziel ist jetzt da)
      try { window.__setJumpBusy?.(false); } catch {}
      return;
    }

    if (tries++ < timeoutFrames) {
      requestAnimationFrame(tick);
      return;
    }

    console.warn("[mushaf jump] target not rendered in time:", targetRef);
  };

  tick();
}


function focusAyahCard(view, ref, { scroll = false } = {}) {
  currentRef = ref;

  view.querySelectorAll(".ayahMainCard.is-focus").forEach((el) => el.classList.remove("is-focus"));
  const card = view.querySelector(`.ayahMainCard[data-ref="${CSS.escape(ref)}"]`);
  if (!card) return;

  card.classList.add("is-focus");
  card.focus({ preventScroll: true });

  // ✅ Surah-Kontext sauber halten (nur wenn echte Ayah + nur wenn sich Sura ändert)
  try {
    if (/^\d+:\d+$/.test(String(ref || ""))) {
      const a = getAyah(ref);
      if (a?.surah && a.surah !== currentSurahInView) {
        currentSurahInView = a.surah;
        try { setSurahContext(a.surah); } catch (e) {}
      }
      // Ayahmode Topbar live halten (falls sichtbar)
      if (a?.surah) {
        try { setLiveTopbarSurah(view, a.surah); } catch (e) {}
      }
    }
  } catch (e) {}

  // ✅ scroll modes:
  // false = gar nicht
  // "instant" = sofort (kein smooth)
  // true = smooth

  // ✅ Anti-Doppelscroll (verhindert jitter: 2x Scroll zur selben Ayah in kurzer Zeit)
  let allowScroll = true;
  try {
    const now = Date.now();
    const rKey = String(ref || "");
    const last = window.__lastFocusScroll || { ref: "", t: 0 };

    if ((scroll === true || scroll === "instant") && last.ref === rKey && (now - last.t) < 650) {
      allowScroll = false; // 2. Scroll zu schnell -> ignorieren
    } else if (scroll === true || scroll === "instant") {
      window.__lastFocusScroll = { ref: rKey, t: now };
    }
  } catch (e) {}

  if (allowScroll) {
    if (scroll === "instant") {
      __qrScrollElementToCenter(view, card, { behavior: "instant" });
    } else if (scroll === true) {
      __qrScrollElementToCenter(view, card, { behavior: "smooth" });
    }
  }

  // Ping (bleibt)
  card.classList.remove("is-ping");
  requestAnimationFrame(() => {
    card.classList.add("is-ping");
    setTimeout(() => card.classList.remove("is-ping"), 600);
  });
}

// =========================
// Mushaf Mode (Best-of, nutzt textAr via buildWordSpans)
// =========================
function ensureMView() {
  const stage = document.getElementById("stage");
  if (!stage) return null;

  let view = stage.querySelector(".mView");
  if (!view) {
    view = document.createElement("div");
    view.className = "mView";
    view.style.display = "none";
    stage.appendChild(view);
  }
  return view;
}

// =========================
// Mushaf Justify (ALWAYS ON)
// =========================
const mushafJustifyState = {
  on: true,          // ✅ immer an
};

function _mushafFlowEl() {
  return document.querySelector(".mView .mFlow");
}

// Fügt Spaces zwischen benachbarten Word-Spans ein (damit justify funktioniert)
// ✅ Wichtig: wir fügen NUR echte Leerzeichen ein – KEIN Marker-Text mehr.
function _mushafInsertSpaces(flow) {
  if (!flow) return;

  const isWord = (n) =>
    n?.nodeType === 1 && (n.classList.contains("w") || n.classList.contains("mw"));
  const isMark = (n) => n?.nodeType === 1 && n.classList.contains("wMark");

  flow.querySelectorAll(".mText, .mChunk").forEach((line) => {
    let n = line.firstChild;

    while (n) {
      const next = n.nextSibling;
      if (!next) break;

      // Nur wenn zwei ELEMENTE direkt nebeneinander liegen (kein Text dazwischen)
      if (n.nodeType === 1 && next.nodeType === 1) {
        const needSpace =
          (isWord(n) && isWord(next) && !isMark(next)) ||
          (isMark(n) && isWord(next));

        if (needSpace) {
          const after = n.nextSibling;

          // ✅ Schon ein whitespace-textnode vorhanden? Dann nix einfügen.
          const hasWS =
            after &&
            after.nodeType === 3 &&
            /^\s+$/.test(after.nodeValue || "");

          if (!hasWS) {
            n.after(document.createTextNode(" "));
          }
        }
      }

      n = next;
    }
  });
}

function applyMushafJustify() {
  const flow = _mushafFlowEl();
  if (!flow) return;

  // CSS-Justify aktiv (dein CSS ist schon da)
  flow.classList.add("is-justify");

  // Spaces einfügen (idempotent durch hasWS-check)
  _mushafInsertSpaces(flow);
}

// ✅ Mushaf Justify: immer an (kein Hotkey)
window.__quran = window.__quran || {};
// optional: falls du mal manuell triggern willst:
window.__quran.applyMushafJustify = applyMushafJustify;

// =========================
// Ayah-Mode Justify (Word-Spans) – ALWAYS ON
// =========================
function _ayahInsertSpaces(box) {
  if (!box) return;

  const isWord = (n) =>
    n?.nodeType === 1 && (n.classList.contains("w") || n.classList.contains("mw"));
  const isMark = (n) => n?.nodeType === 1 && n.classList.contains("wMark");

  let n = box.firstChild;
  while (n) {
    const next = n.nextSibling;
    if (!next) break;

    // nur wenn 2 Elemente direkt nebeneinander liegen (kein Text dazwischen)
    if (n.nodeType === 1 && next.nodeType === 1) {
      const needSpace =
        (isWord(n) && isWord(next) && !isMark(next)) ||
        (isMark(n) && isWord(next));

      if (needSpace) {
        const after = n.nextSibling;

        // schon whitespace da? dann nix
        const hasWS =
          after &&
          after.nodeType === 3 &&
          /^\s+$/.test(after.nodeValue || "");

        if (!hasWS) n.after(document.createTextNode(" "));
      }
    }

    n = next;
  }
}

function applyAyahJustify(root) {
  if (!root) return;

  // ✅ Cache: wenn Width + Font-Scale gleich sind, skippen wir Messung
  const docCS = getComputedStyle(document.documentElement);
  const arScale = (docCS.getPropertyValue("--ar-font-scale") || "").trim();
  const stageW  = (docCS.getPropertyValue("--stage-w") || "").trim();
  const cacheKeyBase = `${arScale}|${stageW}`;

  root.querySelectorAll(".ayahText").forEach((el) => {
    // 1) Spaces sicherstellen (für justify)
    _ayahInsertSpaces(el);

    // ✅ Quick-cache: wenn Elementbreite + global key gleich, nicht erneut messen
    const w = el.clientWidth || 0;
    const cacheKey = `${cacheKeyBase}|${w}`;

    if (el.dataset.justifyKey === cacheKey) {
      // nichts tun (klassenzustand ist schon gesetzt)
      return;
    }

    // 2) Entscheiden ob justify sinnvoll ist (nur wenn Cache miss)
    const cs = getComputedStyle(el);
    const lh = parseFloat(cs.lineHeight) || 0;

    // Layout-read: nur im Cache-Miss
    const h = el.getBoundingClientRect().height || 0;

    const lines = (lh > 0) ? (h / lh) : 2;
    const shouldJustify = lines >= 1.35;

    el.classList.toggle("is-justify", shouldJustify);

    // Cache setzen
    el.dataset.justifyKey = cacheKey;
  });
}

// optional fürs Debug
window.__quran = window.__quran || {};
window.__quran.applyAyahJustify = applyAyahJustify;

function renderMushaf(ref) {
  const view = ensureMView();
  if (!view) return;

  const ay = getAyah(ref);
  if (!ay) {
    view.innerHTML = `<div class="ayahCard">Ayah nicht gefunden: <b>${ref}</b></div>`;
    return;
  }

  const surah = ay.surah;
  const sm = getSuraMeta(surah);
  const renderAll = window.__renderAllQuran === true;
  const refs = renderAll
  ? getAllRefs()
  : ((typeof getSuraRefs === "function") ? getSuraRefs(surah) : []);

  const toArDigits = (n) => String(n).replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[d]);

  const modeText = (viewMode === "mushaf") ? "Ayah mode" : "Mushaf mode";

// ✅ Mushaf: Favoriten-Markierung muss die AKTIVE Favoritenseite nutzen (actual ODER preset)
let favSet = new Set((getActiveFavRefs?.() || []).map(String));
const isFavActive = (ref) => favSet.has(String(ref || ""));

  const topBarHtml = renderAll ? "" : `
    <div class="surahTopBar ayahTopBar">
      <div class="surahTopFarLeft">
        <div class="ayahTopLeftControls">
          ${buildAyahTopStageHtmlSafe()}
          ${buildReaderRepeatTargetSelectHtml()}
          ${buildReaderReviewModeSelectHtml()}
        </div>
      </div>

      <div class="surahTopLeft">
        <div class="surahTitle surahTopTitle">
          <span class="sNum">${surah}</span>
          <span class="dot">•</span>
          <span class="sEn">${sm?.nameTranslit ?? ""}</span>
          <span class="dot">•</span>
          <span class="sAr" dir="rtl" lang="ar">${sm?.nameAr ?? ""}</span>
        </div>
      </div>

      <div class="surahTopRight">
        ${buildMushafStageFilterHtml()}
        ${buildReaderFlaggedRefsTopbarHtml()}
        <button class="surahModeBtn" type="button" data-action="toggleView" title="Switch view mode">
          <span class="modeText">${modeText}</span>
          <span class="modeArrow">→</span>
        </button>
      </div>
    </div>
  `;

// Mushaf: Header + Basmallah oben an (Ayah-Mode bleibt separat wie bisher)
const basmCardHtml = () => "";

const basmHtml =
  renderAll
    ? ""
    : `
      <div class="mCenter">
        <div class="mMushafHeader">
          <div class="mSurahName" dir="rtl" lang="ar">سورة ${sm?.nameAr ?? ""}</div>
          ${
            (surah !== 1 && surah !== 9)
              ? `<div class="mBasm" dir="rtl" lang="ar">بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</div>`
              : ``
          }
        </div>
      </div>
    `;

view.innerHTML = `
  ${topBarHtml}
  ${basmHtml}
  <div class="mBody">
    <div class="mFlow"></div>
  </div>
  ${buildReaderProgressChartHtml()}
  ${buildReaderStageSummaryHtml()}
`;

const flow = view.querySelector(".mFlow");
if (!flow) return;

const CHUNK = 60;
const FAST_CHUNK = 250; // ✅ viel kleiner (Performance!)
  const turboActive = (targetRef) =>
    window.__turboJumpRef === targetRef &&
    typeof window.__turboJumpUntil === "number" &&
    performance.now() < window.__turboJumpUntil;

let i = 0;
let lastSurah = null;

let targetIdx = -1;
let turboDone = false;
let pendingStageFilterGapRefs = [];

// Cache-Flags für Scroll-Handler
view.__mushafCacheDirty = true;
view.__mushafBtnsCache = null;

if (renderAll) {
  const target = parseRefLoose(ref) || ref;
  targetIdx = refs.indexOf(String(target));
}

function renderChunk() {
  const step =
    (renderAll && targetIdx >= 0 && !turboDone && i < targetIdx) ? FAST_CHUNK : CHUNK;

  const end = Math.min(refs.length, i + step);
  let html = "";

  for (; i < end; i++) {
    const r = refs[i];
    const a = getAyah(r);
    if (!a) continue;

    // ✅ SurahTopBar vor jeder neuen Sura (nur wenn renderAll)
    if (renderAll && a.surah !== lastSurah) {
      lastSurah = a.surah;
      const sm2 = getSuraMeta(lastSurah);
      const headerModeText = (viewMode === "mushaf") ? "Ayah mode" : "Mushaf mode";

      html += `
  <div class="surahTopBar ayahSurahHeader" data-surah="${lastSurah}">
    <div class="surahTopFarLeft">
      <button class="btnCircle playStop suraPlayBtn has-surah-help" type="button" data-surah="${lastSurah}" aria-label="Play/Stop Sura ${lastSurah}">
        <svg class="icon icon-play" viewBox="0 0 24 24"><path d="M8 5v14l12-7z"></path></svg>
        <svg class="icon icon-stop" viewBox="0 0 24 24"><rect x="7" y="7" width="10" height="10" rx="1"></rect></svg>
        <span
          class="acctScoreHelp surahTopHelp is-corner"
          data-reader-help="surah-play"
          data-reader-help-title="Surah playback"
          data-reader-help-text="Play or stop this surah."
          aria-label="Play or stop this surah.">?</span>
      </button>
    </div>

    <div class="surahTopLeft">
      <div class="surahTitle is-compact">
        <span class="sNum">${lastSurah}</span>
        <span class="dot">•</span>
        <span class="sEn">${sm2?.nameTranslit ?? ""}</span>
        <span class="dot">•</span>
        <span class="sAr" dir="rtl" lang="ar">${sm2?.nameAr ?? ""}</span>
      </div>
    </div>

    <div class="surahTopRight">
      <button class="surahModeBtn" type="button" data-action="toggleView" title="Switch view mode">
        <span class="modeText">${headerModeText}</span>
        <span class="modeArrow">→</span>
      </button>
    </div>
  </div>
`;

      // ✅ Arabischer Surah-Titel + Basmallah im Mushaf-Flow
      html += `
  <div class="mCenter">
    <div class="mMushafHeader">
      <div class="mSurahName" dir="rtl" lang="ar">سورة ${sm2?.nameAr ?? ""}</div>
      ${
        (lastSurah !== 1 && lastSurah !== 9)
          ? `<div class="mBasm" dir="rtl" lang="ar">بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</div>`
          : ``
      }
    </div>
  </div>
`;
    }

    const difficultyStage = getTrainerStageForRef(a.ref);
    if (
      !isMushafStageVisible(difficultyStage) ||
      !isMushafMarkedVisible(a.ref)
    ) {
      pendingStageFilterGapRefs.push(String(a.ref));
      continue;
    }

    if (pendingStageFilterGapRefs.length) {
      const hiddenRefs = pendingStageFilterGapRefs.slice();
      const lastHiddenRef = hiddenRefs[hiddenRefs.length - 1] || "";

      html += `
        <span
          class="mFilterGap"
          data-hidden-refs="${hiddenRefs.join("|")}"
          data-hidden-last-ref="${lastHiddenRef}"
          aria-label="Hidden ayahs ${hiddenRefs.join(", ")}">....</span>
      `;

      pendingStageFilterGapRefs = [];
    }

    

    const no = toArDigits(a.ayah ?? "");
    const wordsHtml = buildWordSpans({
      ref: a.ref,
      surah: a.surah,
      ayahNo: a.ayah,
      textAr: a.textAr,
      words: a.words
    });

    const readerRingClass = getReaderRingClassForRef(a.ref);
    const readerRingRatio = getReaderRingRatioForRef(a.ref);

    html += `
      <span class="mChunk" data-ref="${a.ref}">
        <span class="mText" dir="rtl" lang="ar">${wordsHtml}</span>
        <button class="mNo${readerRingClass}${((typeof favSet !== "undefined") && favSet && favSet.has(String(a.ref))) ? " is-fav" : ""}${getNoteForRef(a.ref).trim() ? " is-note" : ""}"
  type="button"
  data-ref="${a.ref}"
  data-difficulty-stage="${difficultyStage}"
  style="--reader-ring:${readerRingRatio};"
  aria-label="Play ${a.ref}">${no}</button>
      </span>
    `; }

  if (!flow) return;

  flow.insertAdjacentHTML("beforeend", html);
  view.__mushafCacheDirty = true;

  // ✅ WICHTIG: Justify/Spaces NACHDEM neuer Content im DOM ist
  try { applyMushafJustify(); } catch(e) {}

  if (!turboDone && renderAll && targetIdx >= 0) {
    const targetRef = String(parseRefLoose(ref) || ref);
    const exists = !!view.querySelector(`.mNo[data-ref="${CSS.escape(targetRef)}"]`);
    if (exists) turboDone = true;
  }

  if (i < refs.length) {
    if (renderAll) {
      view.__mushafRenderJob = scheduleRender(renderChunk, { timeout: 120 });
    } else {
      // single-sura: weiter in rAF-Chunks, damit alles gebaut wird
      view.__mushafRenderJob = requestAnimationFrame(renderChunk);
    }
  } else {
    view.__mushafRenderJob = null;

    // ✅ Safety: am Ende nochmal anwenden (damit die LETZTE Ayah immer passt)
    try { applyMushafJustify(); } catch(e) {}

    syncPlayingMushafFocus();
  }
}

renderChunk();


  // Fokus helper (wie alt)
  const setFocus = (r, { updateUrl = false, scroll = false } = {}) => {
    if (!r) return;

    view.querySelectorAll(".mNo.is-focus").forEach((el) => el.classList.remove("is-focus"));
    const btn = view.querySelector(`.mNo[data-ref="${CSS.escape(r)}"]`);
    if (btn) btn.classList.add("is-focus");

    currentRef = r;

    if (updateUrl) setRefToHash(r);

    if (scroll && btn) __qrScrollElementToCenter(view, btn, { behavior: "smooth" });
  };

  // ✅ erst fokussieren/scrollen wenn die Ziel-Ayah in den gerenderten Chunks existiert
  scrollToMushafNoWhenReady(view, ref, { updateUrl: false, scroll: true });

  // Click handling (einmal binden)
  if (!view._mushafBound) {
    view._mushafBound = true;

    view.addEventListener("click", (e) => {

      const closeMushafTopDrops = () => {
        view.querySelectorAll("[data-stage-drop].is-open, [data-repeat-drop].is-open, [data-review-drop].is-open, [data-mushaf-filter-drop].is-open, [data-trainer-flag-drop].is-open").forEach((el) => {
          el.classList.remove("is-open", "is-active");
        });
      };

      const filterToggleBtn = e.target.closest?.("[data-mushaf-filter-toggle]");
      if (filterToggleBtn) {
        e.preventDefault();
        e.stopPropagation();

        const drop = filterToggleBtn.closest?.("[data-mushaf-filter-drop]");
        if (!drop) return;

        const willOpen = !drop.classList.contains("is-open");
        closeMushafTopDrops();

        if (willOpen) {
          drop.classList.add("is-open", "is-active");
        }
        return;
      }

      const trainerFlagToggleBtn = e.target.closest?.("[data-trainer-flag-toggle]");
      if (trainerFlagToggleBtn) {
        e.preventDefault();
        e.stopPropagation();

        const drop = trainerFlagToggleBtn.closest?.("[data-trainer-flag-drop]");
        if (!drop) return;

        const willOpen = !drop.classList.contains("is-open");
        closeMushafTopDrops();

        if (willOpen) {
          drop.classList.add("is-open", "is-active");
        }
        return;
      }

      const trainerFlagRefBtn = e.target.closest?.(".hifzBadDropItem[data-trainer-flag-ref]");
      if (trainerFlagRefBtn) {
        e.preventDefault();
        e.stopPropagation();

        const ref = String(trainerFlagRefBtn.dataset?.trainerFlagRef || "");
        if (!/^\d+:\d+$/.test(ref)) return;

        closeMushafTopDrops();

        currentRef = ref;
        try { setRefToHash(ref); } catch (err) {}
        try { renderCurrent(ref); } catch (err) {}
        try { persistNavState?.(); } catch (err) {}
        return;
      }

      const reviewToggleBtn = e.target.closest?.("[data-review-toggle]");
      if (reviewToggleBtn) {
        e.preventDefault();
        e.stopPropagation();

        const drop = reviewToggleBtn.closest?.("[data-review-drop]");
        if (!drop) return;

        const willOpen = !drop.classList.contains("is-open");
        closeMushafTopDrops();

        if (willOpen) {
          drop.classList.add("is-open", "is-active");
        }
        return;
      }

      const reviewOptBtn = e.target.closest?.(".ayahReviewOpt[data-review-mode-option]");
      if (reviewOptBtn) {
        e.preventDefault();
        e.stopPropagation();

        const mode = String(reviewOptBtn.dataset?.reviewModeOption || "balanced");
        saveTrainerReviewMode(mode);
        invalidateTrainerSession(loadTrainerStage());
        closeMushafTopDrops();

        try {
          const keepRef = String(currentRef || ref || "");
          if (keepRef) {
            currentRef = keepRef;
            renderCurrent(keepRef);
            try { persistNavState?.(); } catch (err) {}
          }
        } catch (err) {}

        return;
      }

      const repeatToggleBtn = e.target.closest?.("[data-repeat-toggle]");
      if (repeatToggleBtn) {
        e.preventDefault();
        e.stopPropagation();

        const drop = repeatToggleBtn.closest?.("[data-repeat-drop]");
        if (!drop) return;

        const willOpen = !drop.classList.contains("is-open");
        closeMushafTopDrops();

        if (willOpen) {
          drop.classList.add("is-open", "is-active");
        }
        return;
      }

      const repeatOptBtn = e.target.closest?.(".ayahRepeatOpt[data-repeat-target-option]");
      if (repeatOptBtn) {
        e.preventDefault();
        e.stopPropagation();

        const v = Number(repeatOptBtn.dataset?.repeatTargetOption || "5");
        saveReaderRepeatTarget(v);
        invalidateTrainerSession(loadTrainerStage());
        closeMushafTopDrops();

        try {
          const keepRef = String(currentRef || ref || "");
          if (keepRef) {
            currentRef = keepRef;
            renderCurrent(keepRef);
            try { persistNavState?.(); } catch (err) {}
          }
        } catch (err) {}

        return;
      }

      const stageToggleBtn = e.target.closest?.("[data-stage-toggle]");
      if (stageToggleBtn) {
        e.preventDefault();
        e.stopPropagation();

        const drop = stageToggleBtn.closest?.("[data-stage-drop]");
        if (!drop) return;

        const willOpen = !drop.classList.contains("is-open");
        closeMushafTopDrops();

        if (willOpen) {
          drop.classList.add("is-open", "is-active");
        }
        return;
      }

      const stageOptBtn = e.target.closest?.(".ayahStageOpt[data-stage]");
      if (stageOptBtn) {
        e.preventDefault();
        e.stopPropagation();

        const v = Number(stageOptBtn.dataset?.stage || "1");
        applyTrainerStage(v, { rerender: false });
        closeMushafTopDrops();

        try {
          const keepRef = String(currentRef || ref || "");
          if (keepRef) {
            currentRef = keepRef;
            renderCurrent(keepRef);
            try { persistNavState?.(); } catch (err) {}
          }
        } catch (err) {}

        return;
      }

      // ✅ View-Mode Toggle (Ayah/Mushaf)
      const toggleBtn = e.target.closest?.('[data-action="toggleView"]');
      if (toggleBtn) {
        closeMushafTopDrops();
        toggleViewMode();
        return;
      }

      const suraBtn = e.target.closest?.("button.suraPlayBtn");
      if (suraBtn) {
        const s = Number(suraBtn.dataset?.surah || 0);
        if (s >= 1 && s <= 114) {
          toggleSurahPlaybackFromBtn(s, suraBtn);
        }
        return;
      }

      // Word click: plays WBW deterministic audio (data-audio), fallback to data-audio2
      const wEl = e.target.closest(".w");
      if (wEl && !wEl.classList.contains("wMark")) {
        e.stopPropagation();

        const chunk = wEl.closest(".mChunk");
        const r = chunk?.getAttribute("data-ref");
        if (!r) return;

        // Fokus + URL
        setFocus(r, { updateUrl: true, scroll: false });

        stopSurahQueue();
        stopVerseAudio();

        playWordFromSpan(wEl);
        return;
      }

// Nummer-Kreis: Ayah MP3 / Favorit (Ctrl+Click)
const noBtn = e.target.closest(".mNo");

if (noBtn) {
  e.stopPropagation();
  const r = noBtn.getAttribute("data-ref");
  if (!r) return;

    // ✅ SHIFT + Klick => NOTES (nur im Mushaf-Mode)
  if (viewMode === "mushaf" && e.shiftKey) {
    e.preventDefault();
    e.stopPropagation();
    openNotesForRef(r);
    return;
  }

  // ✅ SHIFT + Klick => Notes (kein Play!)
  if (viewMode === "mushaf" && e.shiftKey) {
    e.preventDefault();
    e.stopPropagation();
    openNotesForRef(r);
    return;
  }

  // ✅ ALT + Klick => NUR Copy (kein Play!)
  if (viewMode === "mushaf" && e.altKey) {
    e.preventDefault();
    e.stopPropagation();
    copyAyahRef(r, { flashEl: noBtn });
    return;
  }

  // ✅ STRG/CTRL (oder Mac CMD) + Klick => Favorit togglen (nur im Mushaf-Mode)
  if (viewMode === "mushaf" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();

    // ✅ in Mushaf: aktive Favoritenseite togglen (actual ODER preset)
    const res =
      (typeof toggleFavInActivePage === "function")
        ? toggleFavInActivePage(r)
        : toggleBookmark(r);

    const isNowFav =
      (res && typeof res === "object" && "bookmarked" in res)
        ? !!res.bookmarked
        : !!res;

    // UI am Button
    noBtn.classList.toggle("is-fav", isNowFav);

    // ✅ WICHTIG: favSet updaten (das ist die Render-Quelle für Mushaf-Markierungen)
    try {
      if (isNowFav) favSet.add(r);
      else favSet.delete(r);
    } catch {}

    try { window.__refreshFavCount?.(); } catch {}
    try { window.__refreshFavButtonDecor?.(); } catch {}

    return;
  }

  // Normaler Klick:
  const a = getAyah(r);
  if (!a) return;

  setFocus(r, { updateUrl: true, scroll: false });

  // ✅ Wenn SurahPlay läuft: von HIER weiter spielen (wie Klick auf Fortschritts-Strich)
  if (surahPlaying && typeof startSurahPlayback === "function") {
    const playStop = document.getElementById("playStop");
    startSurahPlayback(a.surah, { fromAyah: a.ayah, btn: playStop || undefined });
    return;
  }

  // sonst: Ayah-MP3 (Single)
  stopSurahQueue();
  const url = ayahMp3Url(a.surah, a.ayah);
  playFromButton(noBtn, url);
  return;
}

      // Klick auf Chunk: nur Fokus + URL
      const chunk = e.target.closest(".mChunk");
      if (chunk) {
        const r = chunk.getAttribute("data-ref");
        if (!r) return;
        setFocus(r, { updateUrl: true, scroll: false });
      }
    });

    view.addEventListener("change", (e) => {
      const stageChk = e.target.closest?.(".trChk[data-mushaf-stage-filter]");
      const markChk = e.target.closest?.(".trChk[data-mushaf-mark-filter]");
      if (!stageChk && !markChk) return;

      e.stopPropagation();

      if (stageChk) {
        const n = Number(stageChk.dataset?.mushafStageFilter || "0");
        if (n >= 1 && n <= 7) {
          const active = loadMushafStageFilterStages();
          if (stageChk.checked) active.add(n);
          else active.delete(n);
          saveMushafStageFilterStages(active);
        }
      }

      if (markChk) {
        const key = String(markChk.dataset?.mushafMarkFilter || "").trim();
        if (key === "good" || key === "mid" || key === "bad") {
          const activeMarks = loadMushafMarkFilterStates();
          if (markChk.checked) activeMarks.add(key);
          else activeMarks.delete(key);
          saveMushafMarkFilterStates(activeMarks);
        }
      }

      try {
        const keepRef = String(currentRef || ref || "");
        const nextRef = getNearestVisibleMushafRef(keepRef) || keepRef;
        if (nextRef) {
          currentRef = nextRef;
          renderCurrent(nextRef);
          try { persistNavState?.(); } catch (err) {}
        }
      } catch (err) {}
    });

// Scroll: Auto-Fokus (performant: Positions-Cache + rAF)
view.__mushafPosCache = null;
view.__mushafRAF = 0;
view.__mushafLastRef = "";

function rebuildMushafPosCache() {
  // Cache der Buttons + ihrer Position im Scroll-Container
  const btns = Array.from(view.querySelectorAll(".mNo"));
  view.__mushafBtnsCache = btns;

  const arr = [];
  for (const el of btns) {
    const ref = el.getAttribute("data-ref");
    if (!ref) continue;
    // centerY im Container-Koordinatensystem (scrollTop basiert)
    const cy = el.offsetTop + el.offsetHeight * 0.5;
    arr.push({ ref, cy, el });
  }

  // Sicherheit: nach cy sortieren (meist eh schon korrekt)
  arr.sort((a, b) => a.cy - b.cy);

  view.__mushafPosCache = arr;
  view.__mushafCacheDirty = false;
}

function findNearestRefByScroll() {
  const arr = view.__mushafPosCache;
  if (!arr || !arr.length) return "";

  const targetY = view.scrollTop + view.clientHeight * 0.40;

  // binary search nach nächstem cy
  let lo = 0, hi = arr.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid].cy < targetY) lo = mid + 1;
    else hi = mid;
  }

  // lo ist der erste >= targetY, prüfe Nachbarn
  const a = arr[lo];
  const b = arr[lo - 1];
  if (!b) return a.ref;

  return (Math.abs(a.cy - targetY) < Math.abs(b.cy - targetY)) ? a.ref : b.ref;
}

function applyMushafFocus(refBest) {
  if (!refBest) return;
  if (refBest === view.__mushafLastRef) return;

  // Fokus-Klasse nur ändern wenn wirklich nötig
  view.querySelectorAll(".mNo.is-focus").forEach((el) => el.classList.remove("is-focus"));
  const b = view.querySelector(`.mNo[data-ref="${CSS.escape(refBest)}"]`);
  if (b) b.classList.add("is-focus");

  view.__mushafLastRef = refBest;
  currentRef = refBest;

  const ab = getAyah(refBest);
  if (ab) currentSurahInView = ab.surah;
}

view.addEventListener("scroll", () => {
  // ✅ wenn Render-All pausiert war: beim Scrollen weiter rendern (nur Mushaf)
  if (renderAll && i < refs.length && !view.__mushafRenderJob) {
    view.__mushafRenderJob = scheduleRender(renderChunk, { timeout: 120 });
  }

  if (view.__mushafRAF) return; // rAF already scheduled
  view.__mushafRAF = requestAnimationFrame(() => {
    view.__mushafRAF = 0;

    if (view.__mushafCacheDirty || !view.__mushafPosCache) {
      rebuildMushafPosCache();
    }

    // ✅ Wenn Ayah-Audio läuft: Fokus NICHT wechseln
    if (verseAudio && !verseAudio.paused && verseRefPlaying) {
      applyMushafFocus(verseRefPlaying);
      return;
    }

    const refBest = findNearestRefByScroll();
    applyMushafFocus(refBest);
  });
}, { passive: true });

  }
}

// =========================
// FIRST VISIT WELCOME (Intentions + Surah Grid + Donate)
// =========================

// ✅ Welcome soll bei “neuem Besuch” wieder kommen,
// aber NICHT bei Reload -> wir merken nur “in diesem Tab schon gezeigt”
const SS_WELCOME_SHOWN_THIS_TAB = "q_welcome_shown_tab_v1";

const LS_INTENTS = "q_intents_v1";

// Keep DEFAULT_INTENTS small (used only when localStorage is empty)
const DEFAULT_INTENTS = [
  "Seek closeness to God (Taqarrub)",
  "Cultivate gratitude",
  "Strengthen trust in God (Tawakkul)",
];

// All options in collapsible groups (accordion)
const INTENT_GROUPS = [
  {
    title: "Spiritual & Worship",
    items: [
      "Seek closeness to God (Taqarrub)",
      "Cultivate gratitude",
      "Deepen repentance (Tawba)",
      "Practice sincerity (Ikhlās)",
      "Strengthen God-conscious awe / mindful reverence (Taqwā)",
      "Nurture hope (Rajāʾ)",
      "Train patience (Ṣabr)",
      "Strengthen trust in God (Tawakkul)",
      "Develop humility",
      "Find inner peace / tranquility (Sakīna)",
      "Pursue purification of the heart (Tazkiya)",
      "Increase love for God and for goodness",
      "Remember the Hereafter",
      "Keep awareness of one’s mortality",
      "Deepen understanding of God’s mercy",
      "Understand God’s justice",
      "Learn God’s names and attributes (Asmāʾ wa Ṣifāt)",
      "Seek God’s guidance (Hudā)",
      "Awaken the heart when feeling spiritually empty",
      "Deepen prayer/devotion through Qur’an reading",
      "Let it inspire supplication (Duʿāʾ)",
      "Structure a practice of thanks and supplication"
    ]
  },

  {
    title: "Guidance & Decision-Making",
    items: [
      "Seek clarity in a specific life question",
      "Sharpen one’s moral compass",
      "Put life priorities in order",
      "Strengthen moral standards",
      "Correct oneself (self-reflection)",
      "Strengthen impulse control",
      "Take responsibility more consciously",
      "Find meaning in suffering/pain",
      "Put future anxiety into perspective",
      "Find guidance for relationships",
      "Better understand how to handle conflicts",
      "Realign life goals",
      "Recognize dependencies / unhealthy patterns"
    ]
  },

  {
    title: "Character & Ethics",
    items: [
      "Promote honesty",
      "Strengthen a sense of justice",
      "Cultivate compassion/mercy",
      "Learn generosity",
      "Practice modesty instead of ego",
      "Practice forgiveness",
      "Reduce envy",
      "Restrain anger",
      "Avoid spite/malice",
      "Increase helpfulness",
      "Deepen respect for others",
      "Develop an ethic of responsibility",
      "Train mindfulness in words and actions",
      "Develop empathy",
      "Improve communication ethics (not harming, not backbiting)",
      "Deal with injustice without becoming unjust oneself"
    ]
  },

  {
    title: "Knowledge & Understanding",
    items: [
      "Understand the meaning and message (Maʿnā)",
      "Learn the context of verses (Asbāb an-Nuzūl)",
      "Grasp the structure and composition of a surah",
      "Identify recurring themes",
      "Use the stories of the prophets as learning material",
      "Study the Qur’an’s way of reasoning/argumentation",
      "Notice linguistic nuances (Arabic)",
      "Understand rhetoric and imagery",
      "Clarify long-held questions"
    ]
  },

  {
    title: "Practice & Daily Life",
    items: [
      "Derive practical action steps (“What will I change today?”)",
      "Improve habits (e.g., speech, consumption, time use)",
      "Live family life more consciously",
      "Strengthen fairness at work/study",
      "Become more mindful about money/charity",
      "Motivate social engagement",
      "Take steps toward reconciliation",
      "Initiate making amends",
      "Stabilize daily discipline/routine",
      "Approach parent–child conflicts with more kindness",
      "Reflect on partnership: responsibility, loyalty, respect",
      "Learn how to deal with being hurt/offended"
    ]
  },

  {
    title: "Emotional & Mental Well-Being",
    items: [
      "Nurture hope during depression/lack of motivation",
      "Reduce anxiety through a shift in perspective",
      "Reduce stress through recitation/reading rhythm",
      "Stabilize self-worth (not tied to external standards)",
      "Transform guilt into constructive repentance",
      "Bring order to inner turmoil",
      "Cope with loneliness",
      "Channel anger/frustration constructively",
      "Cultivate gratitude instead of rumination",
      "Build resilience",
      "Gain mental clarity through reflection on verses (Tadabbur)"
    ]
  },

  {
    title: "Community, Family & Daʿwa",
    items: [
      "Strengthen shared values in the family",
      "Teach religion to children/students",
      "Become articulate for conversations/Daʿwa",
      "Build bridges in dialogue with people of other faiths",
      "Read social justice as a calling/mission",
      "Emphasize responsibility for the weak/disadvantaged",
      "Use role models from Qur’anic narratives for community work",
      "Clarify one’s identity (“Who am I in faith?”)",
      "Experience belonging (tradition, history, continuity)",
      "Work through existential questions of meaning",
      "Define oneself by values rather than status/achievement",
      "Reflect on consumer and performance culture",
      "Deepen gratitude for creation/the environment"
    ]
  },

  {
    title: "Language, Culture & Beauty",
    items: [
      "Enjoy the beauty of recitation",
      "Learn/improve Arabic",
      "Better understand the cultural history of Islam"
    ]
  },

  {
    title: "Recitation & Learning Skills",
    items: [
      "Improve Tajwīd",
      "Build regular consistency (Wird)",
      "Train concentration (Khushūʿ)",
      "Learn specific surahs for everyday situations",
      "Improve reading comprehension through vocabulary work",
      "Keep personal notes/journaling"
    ]
  },

  {
    title: "Protection & Healing",
    items: [
      "Ask for protection from temptations",
      "Gain steadfastness in trials",
      "Ask for healing/relief (Ruqya intention, within one’s practice)"
    ]
  },
];

// build checkboxes (grouped)
function renderChecks() {

const checksEl = document.getElementById("welcomeChecks");
if (!checksEl) throw new Error("#welcomeChecks not found");

  const selected = _loadIntents();

  checksEl.innerHTML = INTENT_GROUPS.map((g, gi) => {
    const groupId = `intentGroup_${gi}`;
    const itemsHtml = (g.items || []).map((label) => {
      const safe = String(label);
      const id = "intent_" + safe.replace(/\s+/g, "_").replace(/[^\w-]/g, "");
      const checked = selected.has(safe) ? "checked" : "";
      return `
        <label class="welcomeCheck" for="${id}">
          <input class="welcomeCheckBox" id="${id}" type="checkbox" data-intent="${safe}" ${checked}/>
          <span class="welcomeCheckText">${safe}</span>
        </label>
      `;
    }).join("");

    // <details> macht "aufklappbar" ohne extra JS
    return `
      <details class="intentGroup">
        <summary class="intentGroupSummary">${g.title}</summary>
        <div class="intentGroupItems">${itemsHtml}</div>
      </details>
    `;
  }).join("");

  // events: speichern wenn geklickt
  checksEl.querySelectorAll("input.welcomeCheckBox[data-intent]").forEach((chk) => {
    chk.addEventListener("change", () => {
      const label = chk.getAttribute("data-intent") || "";
      const set = _loadIntents();
      if (chk.checked) set.add(label);
      else set.delete(label);
      _saveIntents(set);
    });
  });
}
function _getAllIntentsSafe() {
  // 1) Wenn ALL_INTENTS existiert, nimm das
  if (typeof ALL_INTENTS !== "undefined" && Array.isArray(ALL_INTENTS) && ALL_INTENTS.length) {
    return ALL_INTENTS.map(String);
  }

  // 2) Sonst: aus INTENT_GROUPS flatten (wenn vorhanden)
  if (typeof INTENT_GROUPS !== "undefined" && Array.isArray(INTENT_GROUPS)) {
    const flat = INTENT_GROUPS.flatMap(g => Array.isArray(g?.items) ? g.items : []).map(String);
    return Array.from(new Set(flat));
  }

  // 3) Letzter Fallback: wenn DEFAULT_INTENTS existiert
  if (typeof DEFAULT_INTENTS !== "undefined" && Array.isArray(DEFAULT_INTENTS)) {
    return DEFAULT_INTENTS.map(String);
  }

  // 4) Nichts verfügbar -> leer
  return [];
}

function _loadIntents() {
  const all = _getAllIntentsSafe();

  try {
    const raw = localStorage.getItem(LS_INTENTS);

    // Beim ersten Besuch: alles an (wenn wir überhaupt eine Liste haben)
    if (!raw) return new Set(all);

    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return new Set(all);

    const set = new Set(arr.map(String));

    // Wenn alles abgewählt: wieder alles an
    if (set.size === 0) return new Set(all);

    return set;
  } catch {
    return new Set(all);
  }
}
function _saveIntents(set) {
  try {
    const arr = Array.from(set || []).map(String);
    localStorage.setItem(LS_INTENTS, JSON.stringify(arr));
  } catch {}
}

function ensureWelcomeModal() {
  let ov = document.getElementById("welcomeOverlay");
  if (ov) return ov;

  ov = document.createElement("div");
  ov.id = "welcomeOverlay";
  ov.className = "welcomeOverlay";

  ov.innerHTML = `
    <div class="welcomeModal" role="dialog" aria-modal="true" aria-label="Welcome">
 <div class="welcomeHeader">
  <div class="welcomeHeaderCenter">
    <div class="welcomeTitle">With what intentions do you read the Quran?</div>
    <div class="welcomeSubtitle">(The more intentions, the more Hasanat while reading.)</div>
  </div>
  <button class="welcomeClose" id="welcomeClose" type="button" aria-label="Close">✕</button>
</div>

      <!-- ✅ ACCOUNT BAR (NEU) -->
      <div class="welcomeAuth" id="welcomeAuth">
        <div class="welcomeAuthTop">
          <div class="welcomeAuthTitle">
  Create an account
  <span class="welcomeAuthTitleHint">(no email required, save bookmarks and notes in the cloud instead of localstorage if needed)</span>
</div>
          <button class="welcomeAuthLogout" id="welcomeAuthLogout" type="button" aria-label="Log out">Log out</button>
        </div>

        <div class="welcomeAuthRow">
          <input
            class="welcomeAuthInput"
            id="welcomeUsername"
            type="text"
            autocomplete="username"
            placeholder="example Muhammad114"
          />
          <input
            class="welcomeAuthInput"
            id="welcomePassword"
            type="password"
            autocomplete="current-password"
            placeholder="Password"
          />

          <div class="welcomeAuthActions">
            <button class="welcomeAuthBtn" id="welcomeLoginBtn" type="button">Log in</button>
            <button class="welcomeAuthBtn is-primary" id="welcomeCreateBtn" type="button">Create account</button>
          </div>
        </div>

        <div class="welcomeAuthMsg" id="welcomeAuthMsg" aria-live="polite"></div>
      </div>

      <div class="welcomeBody">
        <div class="welcomeSection">
          <div class="welcomeChecks" id="welcomeChecks"></div>
        </div>

        <div class="welcomeSection">
          <div class="welcomeSectionTitle">Choose a Surah</div>
          <div class="welcomeSurahGrid" id="welcomeSurahGrid"></div>
        </div>

<div class="welcomeSection welcomeSectionDonate">

  <div class="welcomeDonateText">
    <p class="welcomeDonateP">
      Take part in earning Hasanat. 100% of donations go toward maintenance, and anything extra goes toward new features.
    </p>
  </div>

  <div class="welcomeDonateActions">
    <a class="welcomeDonateBtn" href="https://paypal.me/quranm" target="_blank" rel="noopener noreferrer">Donate</a>
  </div>

</div>

      </div>

      <!-- ✅ Footer wieder da: Continue Button -->
      <div class="welcomeFooter">
        <button class="welcomeContinue" id="welcomeContinue" type="button">Continue</button>
      </div>

    </div>
  `;

  document.body.appendChild(ov);

  const modal = ov.querySelector(".welcomeModal");
  const btnClose = ov.querySelector("#welcomeClose");
    const btnContinue = ov.querySelector("#welcomeContinue");

  // init (bind auth once)
  try { initWelcomeAuth(ov); } catch {}

  function closeAndRemember() {
    // ✅ "Shown this tab" setzen, damit "neuer Besuch" wieder Welcome zeigt
    try { sessionStorage.setItem(SS_WELCOME_SHOWN_THIS_TAB, "1"); } catch {}
    ov.classList.remove("is-open");
  }

  // outside click closes
  ov.addEventListener("click", (e) => {
    if (e.target === ov) closeAndRemember();
  });

  btnClose.addEventListener("click", (e) => {
    e.preventDefault();
    closeAndRemember();
  });

  btnContinue?.addEventListener("click", (e) => {
    e.preventDefault();
    closeAndRemember();
  });

  // close by ESC
  window.addEventListener("keydown", (e) => {
    if (!ov.classList.contains("is-open")) return;
    if (e.key === "Escape") closeAndRemember();
  });

  // Clicking a Surah in grid -> go
  function renderSurahGrid() {
    const grid = ov.querySelector("#welcomeSurahGrid");
    if (!grid) return;

    // build styled grid 1..114 (matches app.css: .welcomeSuraCard / .welcomeSuraNo / .welcomeSuraAr / .welcomeSuraAyahs)
    grid.innerHTML = Array.from({ length: 114 }, (_, i) => {
      const s = i + 1;
      const meta = (typeof getSuraMeta === "function") ? getSuraMeta(s) : null;

      const nameEn = (meta && (meta.name_en || meta.nameEn || meta.name || meta.english)) ? String(meta.name_en || meta.nameEn || meta.name || meta.english) : `Surah ${s}`;
      const nameAr = (meta && (meta.name_ar || meta.nameAr || meta.arabic)) ? String(meta.name_ar || meta.nameAr || meta.arabic) : "";
      const ayahs  = (meta && (meta.ayahs || meta.verses || meta.count)) ? Number(meta.ayahs || meta.verses || meta.count) : 0;

      const ayahLabel = ayahs ? `${ayahs} Ayahs` : "";

      return `
        <button class="welcomeSuraCard" type="button" data-s="${s}">
          <div class="welcomeSuraNo">${s}</div>

          <div class="welcomeSuraLeft">
            <div class="welcomeSuraName">${nameEn}</div>
          </div>

          <div class="welcomeSuraRight">
            <div class="welcomeSuraAr">${nameAr}</div>
            <div class="welcomeSuraAyahs">${ayahLabel}</div>
          </div>
        </button>
      `;
    }).join("");

    grid.querySelectorAll("button.welcomeSuraCard[data-s]").forEach((b) => {
      b.addEventListener("click", () => {
        const s = parseInt(b.getAttribute("data-s") || "0", 10);
        if (!Number.isFinite(s) || s < 1 || s > 114) return;
        closeAndRemember();
        try { goToRef(`${s}:1`); } catch {}
      });
    });
  }

  ov._welcome = {
    open() {
      // build current UI fresh
      renderChecks();
      renderSurahGrid();
      ov.classList.add("is-open");

      // refresh auth UI each time
      try { refreshWelcomeAuthUI(); } catch {}

      // focus for accessibility
      try { modal.focus?.(); } catch {}
    }
  };

  return ov;
}

// =========================
// AUTH (Cloudflare Worker + D1)
// Username + Password (no email)
// Sync: localStorage -> account state
// =========================

const LS_AUTH_TOKEN  = "q_auth_token_v1";
const LS_AUTH_USER   = "q_auth_user_v1";
const LS_AUTH_SET_AT = "q_auth_set_at_v1"; // ✅ für 114 Tage Login

function _authBase() {
  // ✅ immer Worker nutzen (auch auf localhost)
  return "https://quranmapi.u87bc15v3.workers.dev";
}

function _setAuth(token, username) {
  try { localStorage.setItem(LS_AUTH_TOKEN, token || ""); } catch {}
  try { localStorage.setItem(LS_AUTH_USER, username || ""); } catch {}

  // ✅ wichtig: sonst ist __isLoggedIn() false und Pull läuft nie
  try { localStorage.setItem(LS_AUTH_SET_AT, String(Date.now())); } catch {}
}

function _clearAuth() {
  try { localStorage.removeItem(LS_AUTH_TOKEN); } catch {}
  try { localStorage.removeItem(LS_AUTH_USER); } catch {}
  try { localStorage.removeItem(LS_AUTH_SET_AT); } catch {}
}
function _getAuthToken() {
  try { return localStorage.getItem(LS_AUTH_TOKEN) || ""; } catch { return ""; }
}
function _getAuthUser() {
  try { return localStorage.getItem(LS_AUTH_USER) || ""; } catch { return ""; }
}

async function _api(path, opts = {}) {
  const token = _getAuthToken();
  const headers = Object.assign(
    { "Content-Type": "application/json" },
    (opts.headers || {})
  );
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(_authBase() + path, Object.assign({}, opts, { headers }));
  const txt = await res.text();
  let data = null;
  try { data = txt ? JSON.parse(txt) : null; } catch { data = { ok:false, error: txt || "Bad JSON" }; }
  if (!res.ok) {
    const msg = (data && (data.error || data.message)) ? (data.error || data.message) : `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

function _exportLocalState() {
  const out = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      // your app keys mostly start with q_ or quranm_
      if (k.startsWith("q_") || k.startsWith("quranm_")) {
        out[k] = localStorage.getItem(k);
      }
    }
  } catch {}
  return out;
}

function _applyState(stateObj) {
  if (!stateObj || typeof stateObj !== "object") return;
  try {
    Object.keys(stateObj).forEach((k) => {
      const v = stateObj[k];
      if (typeof v === "string") localStorage.setItem(k, v);
    });
  } catch {}
}

function _mergeStates(localState, remoteState) {
  const merged = Object.assign({}, localState || {}, remoteState || {});

  // merge bookmarks by union (array of "sura:ayah")
  const BK = (typeof LS_BOOKMARKS !== "undefined") ? LS_BOOKMARKS : "q_bookmarks_v1";
  try {
    const a = localState && localState[BK] ? JSON.parse(localState[BK]) : [];
    const b = remoteState && remoteState[BK] ? JSON.parse(remoteState[BK]) : [];
    const ua = Array.isArray(a) ? a : [];
    const ub = Array.isArray(b) ? b : [];
    const uni = Array.from(new Set([...ua, ...ub].map(String))).filter((r) => /^\d+:\d+$/.test(r));
    merged[BK] = JSON.stringify(uni);
  } catch {}

  return merged;
}

async function syncAccountState() {
  // 1) get remote
  let remote = {};
  try {
    const got = await _api("/api/state", { method: "GET" });
    remote = (got && got.state) ? got.state : {};
  } catch {
    remote = {};
  }

  // 2) merge with local
  const local = _exportLocalState();
  const merged = _mergeStates(local, remote);

  // 3) apply merged locally (writes localStorage)
  _applyState(merged);

  // ✅ ROOT FIX: Theme + Style AFTER state got applied
  try {
    applyTheme(loadTheme()); // sets data-theme + persists
  } catch (e) {
    console.warn("[theme] applyTheme after sync failed:", e);
  }

  try {
    const sid = loadStyleThemeId();
    if (sid) applyStyleThemeById(sid); // recompute CSS vars for current light/dark
  } catch (e) {
    console.warn("[style] re-apply style after sync failed:", e);
  }

  // 4) push merged back to server
  await _api("/api/state", {
    method: "PUT",
    body: JSON.stringify({ state: merged })
  });

  // refresh UI bits that depend on localStorage
  try { syncUI?.(); } catch {}
  try { renderChecks?.(); } catch {}
}

function initWelcomeAuth(ov) {
  if (!ov || ov.__authBound) return;
  ov.__authBound = true;

  const elUser = ov.querySelector("#welcomeUsername");
  const elPass = ov.querySelector("#welcomePassword");
  const btnLogin = ov.querySelector("#welcomeLoginBtn");
  const btnCreate = ov.querySelector("#welcomeCreateBtn");
  const btnLogout = ov.querySelector("#welcomeAuthLogout"); // bleibt vorhanden, wird aber versteckt
  const msg = ov.querySelector("#welcomeAuthMsg");

  function setMsg(t, isErr) {
    if (!msg) return;
    msg.textContent = t || "";
    msg.classList.toggle("is-error", !!isErr);
    msg.classList.toggle("is-ok", !isErr && !!t);
  }

  function setLoggedInUI(isIn) {
    ov.classList.toggle("is-logged-in", !!isIn);

    // ✅ Wir benutzen NICHT mehr den extra Logout-Button oben rechts
    if (btnLogout) btnLogout.style.display = "none";

    // ✅ Log in Button wird zu Log out
    if (btnLogin) btnLogin.textContent = isIn ? "Log out" : "Log in";

    // ✅ Create account Button nur wenn NICHT eingeloggt
    if (btnCreate) btnCreate.style.display = isIn ? "none" : "inline-flex";
  }

  window.refreshWelcomeAuthUI = function refreshWelcomeAuthUI() {
    const u = _getAuthUser();
    if (u) {
      setLoggedInUI(true);
      setMsg("Logged in", false);

      // optional: Eingabefelder leeren (damit nix rumliegt)
      try { elUser && (elUser.value = ""); } catch {}
      try { elPass && (elPass.value = ""); } catch {}
    } else {
      setLoggedInUI(false);
      setMsg("", false);
    }
  };
}
// =========================
// Account Panel (Statusbar)
// =========================
function initAccountPanel(){
  try { window.__refreshAccountPanelMeta?.(); } catch (e) {}
}

function _navIsReload() {
  try {
    const nav = performance.getEntriesByType("navigation")?.[0];
    return nav?.type === "reload";
  } catch {
    return false;
  }
}

function maybeShowWelcome() {
  // ✅ Reload -> NICHT anzeigen
  if (_navIsReload()) return;

  // ✅ Wenn in diesem Tab schon gezeigt -> nicht nochmal (z.B. Hash-Navigation)
  try {
    if (sessionStorage.getItem(SS_WELCOME_SHOWN_THIS_TAB) === "1") return;
  } catch {}

  try { sessionStorage.setItem(SS_WELCOME_SHOWN_THIS_TAB, "1"); } catch {}

  const ov = ensureWelcomeModal();
  ov._welcome?.open?.();
}

// ✅ Minimaler Binder: toggelt nur .is-open (wie dein Debug-Test)
function bindAccountMenuToggle(){
  const picker = document.getElementById("acctPicker");
  const btn = document.getElementById("acctBtn");
  const closeBtn = document.getElementById("acctClose");

  if (!picker || !btn) return;

  // nur 1x binden
  if (picker.__acctToggleBound) return;
  picker.__acctToggleBound = true;

  const close = () => picker.classList.remove("is-open");
  const open = () => {
    picker.classList.add("is-open");
    try { window.__refreshAccountPanelMeta?.(); } catch (e) {}
  };
  const toggle = () => {
    if (picker.classList.contains("is-open")) close();
    else open();
  };

  // robust: capture-phase
  btn.addEventListener("pointerdown", (e) => {
    if (e.button != null && e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    toggle();
  }, true);

  // X schließt
  closeBtn?.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    close();
  }, true);

  // outside closes
  document.addEventListener("pointerdown", (e) => {
    if (!picker.classList.contains("is-open")) return;
    if (picker.contains(e.target)) return;
    close();
  }, true);

  // ESC closes
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });
}

// =========================
// Account Menu Actions (Login/Create/Export/Import)
// =========================
function bindAccountMenuActions(){
  const picker = document.getElementById("acctPicker");
  const elUser = document.getElementById("acctUsername");
  const elPass = document.getElementById("acctPassword");
  const btnLogin = document.getElementById("acctLoginBtn");
  const btnCreate = document.getElementById("acctCreateBtn");
  const btnLoad = document.getElementById("acctLoadBtn");
  const btnSave = document.getElementById("acctSaveBtn");
  const btnExport = document.getElementById("acctExportBtn");
  const fileImport = document.getElementById("acctImportFile");

  const btnBug = document.getElementById("acctBugBtn");
  const bugBox = document.getElementById("acctBugBox");
  const bugClose = document.getElementById("acctBugClose");
  const bugText = document.getElementById("acctBugText");
  const bugCancel = document.getElementById("acctBugCancel");
  const bugSend = document.getElementById("acctBugSend");

  const msg = document.getElementById("acctMsg");

  if (!picker || !btnLogin || !btnCreate || !btnLoad || !btnSave || !msg) return;
  if (picker.__acctActionsBound) {
    try { window.__refreshAccountPanelMeta?.(); } catch {}
    return;
  }
  picker.__acctActionsBound = true;

  const LS_ACC_USER = "q_auth_user_v1";

  function setMsg(t, isErr){
    msg.textContent = t || "";
    msg.classList.toggle("is-error", !!isErr);
    msg.classList.toggle("is-ok", !isErr && !!t);
  }

  function isLoggedIn(){
    try { return !!__isLoggedIn?.(); } catch { return false; }
  }

  function refreshButtons(){
    const inOk = isLoggedIn();
    btnLogin.textContent = inOk ? "Log out" : "Log in";
    btnCreate.style.display = inOk ? "none" : "inline-flex";
    if (inOk) setMsg("Logged in", false);
    else setMsg("", false);
    try { window.__refreshAccountPanelMeta?.(); } catch {}
  }

  async function api(path, { method="GET", body=null, auth=false } = {}){
    const headers = { "Content-Type": "application/json" };
    if (auth) {
      try {
        const h = __authHeaders?.() || {};
        if (h.Authorization) headers.Authorization = h.Authorization;
      } catch {}
    }

    const res = await fetch(`${ACCOUNT_API_BASE}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined
    });

    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j?.ok) throw new Error(j?.error || `HTTP ${res.status}`);
    return j;
  }

  function refreshLocalUiAfterAccountChange(){
    try { window.__refreshFavCount?.(); } catch {}
    try { window.__refreshFavButtonDecor?.(); } catch {}
    try { window.__refreshNoteIndicators?.(); } catch {}
    try { window.__suraProgRefresh?.(); } catch {}
    try {
      const sid = localStorage.getItem("quranm_style_theme_v1") || "";
      if (sid) window.quranStyleSet?.(sid);
    } catch {}
    try {
      if (/^\d+:\d+$/.test(String(currentRef || ""))) renderCurrent(currentRef);
    } catch {}
    try { window.__refreshAccountPanelMeta?.(); } catch {}
  }

  async function doLoginOrCreate(mode){
    const username = (elUser?.value || "").trim();
    const password = (elPass?.value || "");

    if (username.length < 3) return setMsg("Username must be at least 3 characters.", true);
    if (password.length < 6) return setMsg("Password must be at least 6 characters.", true);

    setMsg("Working...", false);

    try{
      if (mode === "create"){
        await api("/api/register", { method:"POST", body:{ username, password }, auth:false });
      }

      const login = await api("/api/login", { method:"POST", body:{ username, password }, auth:false });

      try { __setAuthToken?.(login.token || ""); } catch {}
      try { localStorage.setItem(LS_ACC_USER, username); } catch {}

      let remoteState = {};
      try {
        const remote = await api("/api/state", { method:"GET", auth:true });
        remoteState = (remote && remote.state && typeof remote.state === "object") ? remote.state : {};
      } catch {
        remoteState = {};
      }

      const localState = (typeof __collectLocalAccountState === "function")
        ? __collectLocalAccountState()
        : {};

      const hasRemoteState = !!Object.keys(remoteState || {}).length;
      const hasMismatch = hasRemoteState && !!__accountStatesDiffer?.(localState, remoteState);

      if (hasMismatch) {
        refreshButtons();
        setMsg("Logged in. Browser storage and account storage differ.", false);
        try {
          window.alert('Account storage ≠ Browser storage, click "Save device" to upload Browser storage or "Load account" to import Account storage.');
        } catch {}
      } else {
        if (hasRemoteState) {
          try { __applyAccountStateToLocal(remoteState); } catch {}
          try { __setAccountLastSyncNow?.(); } catch {}
        } else {
          try { await __accountPush?.(); } catch {}
        }

        refreshLocalUiAfterAccountChange();
        refreshButtons();
        setMsg(mode === "create" ? "Account created + logged in." : "Logged in.", false);
      }

      try { elUser.value = ""; } catch {}
      try { elPass.value = ""; } catch {}
    }catch(e){
      setMsg(String(e?.message || e), true);
    }
  }

  async function loadAccountIntoBrowser(){
    if (!isLoggedIn()) {
      setMsg("Log in first.", true);
      return;
    }

    setMsg("Loading account...", false);

    try{
      const ok = await __accountPull?.();
      if (!ok) throw new Error("Could not load account storage.");

      refreshLocalUiAfterAccountChange();
      refreshButtons();
      setMsg("Account storage loaded.", false);
    }catch(e){
      setMsg(String(e?.message || e), true);
    }
  }

  async function saveBrowserIntoAccount(){
    if (!isLoggedIn()) {
      setMsg("Log in first.", true);
      return;
    }

    setMsg("Saving device...", false);

    try{
      const ok = await __accountPush?.();
      if (!ok) throw new Error("Could not save browser storage.");

      refreshButtons();
      setMsg("Browser storage saved to account.", false);
    }catch(e){
      setMsg(String(e?.message || e), true);
    }
  }

  btnLogin.addEventListener("click", async () => {
    if (isLoggedIn()){
      try { await window.__accountFlushAll?.(); } catch {}

      try { localStorage.removeItem("q_auth_token_v1"); } catch {}
      try { localStorage.removeItem("q_auth_set_at_v1"); } catch {}
      try { localStorage.removeItem(LS_ACC_USER); } catch {}

      refreshButtons();
      setMsg("Logged out.", false);
      return;
    }

    await doLoginOrCreate("login");
  });

  btnCreate.addEventListener("click", () => doLoginOrCreate("create"));
  btnLoad.addEventListener("click", () => loadAccountIntoBrowser());
  btnSave.addEventListener("click", () => saveBrowserIntoAccount());

  btnExport?.addEventListener("click", () => {
    try{
      const state = (typeof __collectLocalAccountState === "function")
        ? __collectLocalAccountState()
        : {
            bookmarks: JSON.parse(localStorage.getItem("q_bookmarks_v1") || "[]"),
            notes: JSON.parse(localStorage.getItem("q_notes_v1") || "{}"),
            trainerReadRatings: JSON.parse(localStorage.getItem("q_trainer_read_ratings_v1") || "{}"),
            styleId: localStorage.getItem("quranm_style_theme_v1") || "",
            surfaceId: (typeof loadSurfaceThemeId === "function") ? (loadSurfaceThemeId() || "") : "",
            favPresets: JSON.parse(localStorage.getItem("q_fav_presets_v1") || "{}"),
            favActivePreset: localStorage.getItem("q_fav_active_preset_v1") || "actual",
            favGroupTitles: JSON.parse(localStorage.getItem("q_fav_group_titles_v1") || "[]"),
            favGroupMap: JSON.parse(localStorage.getItem("q_fav_group_map_v1") || "{}"),
            favGroupCollapsed: JSON.parse(localStorage.getItem("q_fav_group_collapsed_v1") || "{}"),
            habashiLabels: JSON.parse(localStorage.getItem("q_habashi_labels_v1") || "{}"),
          };

      const payload = { v: 1, exportedAt: new Date().toISOString(), state };

      const blob = new Blob([JSON.stringify(payload, null, 2)], { type:"application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `quranm_settings_${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);

      setMsg("Exported settings JSON.", false);
    }catch(e){
      setMsg("Export failed: " + String(e?.message || e), true);
    }
  });

  fileImport?.addEventListener("change", async () => {
    const f = fileImport.files?.[0];
    if (!f) return;

    try{
      const text = await f.text();
      const j = JSON.parse(text);
      const st = j?.state || {};

      if (Array.isArray(st.bookmarks)) localStorage.setItem("q_bookmarks_v1", JSON.stringify(st.bookmarks));
      if (st.notes && typeof st.notes === "object") localStorage.setItem("q_notes_v1", JSON.stringify(st.notes));
      if (st.trainerReadRatings && typeof st.trainerReadRatings === "object") {
        localStorage.setItem("q_trainer_read_ratings_v1", JSON.stringify(st.trainerReadRatings));
      }

      if (typeof st.styleId === "string") localStorage.setItem("quranm_style_theme_v1", st.styleId);

      if (typeof st.surfaceId === "string" && st.surfaceId.trim()) {
        try { saveSurfaceThemeId(st.surfaceId); } catch {}
      }

      if (st.favPresets && typeof st.favPresets === "object") localStorage.setItem("q_fav_presets_v1", JSON.stringify(st.favPresets));
      if (typeof st.favActivePreset === "string") localStorage.setItem("q_fav_active_preset_v1", st.favActivePreset);
      if (Array.isArray(st.favGroupTitles)) localStorage.setItem("q_fav_group_titles_v1", JSON.stringify(st.favGroupTitles));
      if (st.favGroupMap && typeof st.favGroupMap === "object") localStorage.setItem("q_fav_group_map_v1", JSON.stringify(st.favGroupMap));
      if (st.favGroupCollapsed && typeof st.favGroupCollapsed === "object") localStorage.setItem("q_fav_group_collapsed_v1", JSON.stringify(st.favGroupCollapsed));
      if (st.habashiLabels && typeof st.habashiLabels === "object") localStorage.setItem("q_habashi_labels_v1", JSON.stringify(st.habashiLabels));

      refreshLocalUiAfterAccountChange();

      try { if (st.styleId) window.quranStyleSet?.(st.styleId); } catch {}

      try {
        if (typeof st.surfaceId === "string" && st.surfaceId.trim()) {
          applySurfaceThemeById(st.surfaceId, { preview:true });
        }
      } catch {}

      try {
        if (typeof setActivePresetName === "function" && typeof st.favActivePreset === "string") {
          setActivePresetName(st.favActivePreset || "actual");
        }
      } catch {}

      try { if (typeof __isLoggedIn === "function" ? __isLoggedIn() : false) await __accountPush?.(); } catch {}

      setMsg("Imported settings.", false);
    }catch(e){
      setMsg("Import failed: " + String(e?.message || e), true);
    }finally{
      try { fileImport.value = ""; } catch {}
    }
  });

  function openBugBox(){
    if (!bugBox) return;
    bugBox.classList.add("is-open");
    try { bugText?.focus({ preventScroll:true }); } catch {}
  }

  function closeBugBox(){
    if (!bugBox) return;
    bugBox.classList.remove("is-open");
    try { if (bugText) bugText.value = ""; } catch {}
  }

  btnBug?.addEventListener("click", () => {
    openBugBox();
  });

  bugClose?.addEventListener("click", (e) => {
    e.preventDefault(); e.stopPropagation();
    closeBugBox();
  });

  bugCancel?.addEventListener("click", (e) => {
    e.preventDefault(); e.stopPropagation();
    closeBugBox();
  });

  bugSend?.addEventListener("click", (e) => {
    e.preventDefault(); e.stopPropagation();

    const desc = String(bugText?.value || "").trim();
    if (desc.length < 10){
      setMsg("Please describe the bug (at least 10 characters).", true);
      return;
    }

    const lastRef = localStorage.getItem("q_lastRef") || "";
    const theme = localStorage.getItem("quranm_theme_v1") || "";
    const style = localStorage.getItem("quranm_style_theme_v1") || "";
    const viewMode = localStorage.getItem("q_viewMode") || "";

    const subject = `Quranm Bug Report`;
    const body =
`Bug description:
${desc}

---
Debug:
URL: ${location.href}
LastRef: ${lastRef}
ViewMode: ${viewMode}
Theme: ${theme}
Style: ${style}
UA: ${navigator.userAgent}
`;

    const mailto =
      `mailto:u87bc15v3@gmail.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

    try{
      window.open(mailto, "_blank", "noopener,noreferrer");
      setMsg("A new tab opened. Please send the email there. If you don’t see a compose screen, copy the text and email it to u87bc15v3@gmail.com.", false);
      try { navigator.clipboard?.writeText(body); } catch {}
      closeBugBox();
    }catch(err){
      try { navigator.clipboard?.writeText(body); } catch {}
      setMsg("Could not open email. I copied the bug report text — please paste it into an email to u87bc15v3@gmail.com.", true);
    }
  });

  [elUser, elPass].forEach((inp) => {
    inp?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") doLoginOrCreate("login");
    });
  });

  refreshButtons();
}


/* ============================================================================
   Style Picker (left) — DISABLED (handled inside styles.js / initStylePicker)
============================================================================ */
function bindStylePickerClickOnly(){
  // ❌ früher: doppelte Handler (app.js + styles.js) -> open & instant close
  // ✅ jetzt: NOP, damit nur styles.js zuständig ist
  return;
}

/* ============================================================================
   MAIN
============================================================================ */

(async () => {
  await domReady();
  bindAccountMenuToggle();
  bindAccountMenuActions();
  initDemoUI();
initStylePicker();          // ✅ Accent/Style Designs initialisieren
initSurfacePicker();        // ✅ Surface (bg/stage/chips/line + fav bg) Designs initialisieren
// bindStylePickerClickOnly(); // ❌ disabled (handled by styles.js)
// bindStylePickerClickOnly(); // ❌ disabled (handled by styles.js)
  // ✅ Account UI darf die App NICHT crashen lassen
  try {
    if (typeof initAccountPanel === "function") initAccountPanel();
  } catch (e) {
    console.warn("[account] initAccountPanel failed:", e);
  }

  installSpacebarAudioHotkey();
  installBookmarkHotkey();
  try { await seedHabashiPresetsIfNeeded(); } catch(e){ console.warn("[habashi] seed failed:", e); }

  // ✅ Daten: App darf auch ohne weiter laufen (Welcome etc.)
  try {
    await dataPromise;
  } catch (e) {
    console.warn("[data] continuing without data (welcome can still open):", e);
  }

  // ✅ Translations dürfen App nicht killen
  try {
    await initTranslations();
  } catch (e) {
    console.warn("[tr] initTranslations failed (ignored):", e);
  }

  if (DBG.enabled) {
    dgroup("data", "Quran data loaded");
    const m2 = getSuraMeta(2);
    const a2255 = getAyah("2:255");
    dlog("data", "Sura 2 meta:", m2);
    dlog("data", "Ayah 2:255:", a2255);
    dlog("data", "Words 2:255 length:", a2255?.words?.length);
    dlog("data", "First word 2:255:", a2255?.words?.[0]);
    dgroupEnd("data");
  }

  if (DBG.enabled) {
    window.__quranDebug = {
      DBG,
      recalc,
      dumpLayoutVars,
      getAyah,
      getSuraMeta,
      renderAyahWords,
      goToRef,
      initRouter,
    };
    dlog("debug", "window.__quranDebug ready");
  }

  // ✅ Router startet Rendering aus URL oder Default
  initRouter("2:255");

  // ✅ First visit welcome (normaler Flow)
  try { maybeShowWelcome(); } catch {}

  // ======================================================
  // TEMP (zum Testen): Welcome bei JEDEM Reload erzwingen
  // -> Wenn du fertig bist: diesen TEMP-Block einfach löschen
  // ======================================================
  try {
    sessionStorage.removeItem(SS_WELCOME_SHOWN_THIS_TAB);

    setTimeout(() => {
      try {
        const ov = ensureWelcomeModal();
        ov._welcome?.open?.();
      } catch {}
    }, 0);
  } catch {}
})();