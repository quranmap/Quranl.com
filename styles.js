import { SURFACE_THEMES_200, LS_SURFACE_THEME } from "./surface_themes_200.js";

/* ==============
   Surface Themes (ONE definitive implementation)
   ============== */

function _isLightMode(){
  return document.documentElement.getAttribute("data-theme") === "light";
}

function _hexToRgb(hex){
  const h = String(hex||"").trim().replace(/^#/,"");
  if (h.length === 3){
    return [
      parseInt(h[0]+h[0],16),
      parseInt(h[1]+h[1],16),
      parseInt(h[2]+h[2],16),
    ];
  }
  if (h.length === 6){
    return [
      parseInt(h.slice(0,2),16),
      parseInt(h.slice(2,4),16),
      parseInt(h.slice(4,6),16),
    ];
  }
  return [0,0,0];
}

function _luma([r,g,b]){
  return 0.2126*r + 0.7152*g + 0.0722*b;
}

export function loadSurfaceThemeId(){
  try{ return String(localStorage.getItem(LS_SURFACE_THEME) || ""); }catch{ return ""; }
}

export function saveSurfaceThemeId(id){
  try{ localStorage.setItem(LS_SURFACE_THEME, String(id||"")); }catch{}
}

export function applySurfaceThemeById(id, opts = {}){
  const t = (SURFACE_THEMES_200 || []).find(x=>x.id===id) || (SURFACE_THEMES_200?.[0] || null);
  if (!t) return;

  const v = _isLightMode() ? (t.light || t.dark) : (t.dark || t.light);
  if (!v) return;

  const root = document.documentElement.style;

  // ✅ nur deine 7 Surface-Tokens
  root.setProperty("--color-bg-main",  String(v.bgMain));
  root.setProperty("--color-bg-stage", String(v.bgStage));
  root.setProperty("--color-bg-chip",  String(v.bgChip));
  root.setProperty("--color-line",     String(v.line));

  root.setProperty("--fx-scroll-fill",   String(v.fxScrollFill));
  root.setProperty("--fav-actual-bg",    String(v.favActualBg));
  root.setProperty("--fav-add-title-bg", String(v.favAddTitleBg));

  // optional: hover token daraus ableiten (falls du es nutzt)
  try{
    const hover = String(v.favAddTitleBg).replace(/,\s*0\.12\)/, ",0.18)");
    root.setProperty("--fav-add-title-bg-hover", hover);
  }catch{}

  const preview = !!opts.preview;

  // ✅ NUR speichern + syncen, wenn es wirklich ausgewählt (click) wurde
  if (!preview){
    saveSurfaceThemeId(t.id);
    try{ window.__accountScheduleSync?.(); }catch{}
  }

  // UI refresh darf auch beim Preview (sonst sieht man’s nicht korrekt)
  try{ window.__refreshFavButtonDecor?.(); }catch{}
}

export function initSurfacePicker(){
  const picker = document.getElementById("surfacePicker");
  const menu = document.getElementById("surfaceMenu");
  const btn  = document.getElementById("surfaceBtn");
  if (!picker || !menu || !btn) return;

  function previewSvg(bgMain, bgStage, bgChip){
    const a = bgMain  || "var(--color-bg-main)";
    const b = bgStage || "var(--color-bg-stage)";
    const c = bgChip  || "var(--color-bg-chip)";
    return `
      <svg class="surfacePreview" viewBox="0 0 30 30" aria-hidden="true">
        <rect x="4"  y="6" width="6" height="18" rx="3" fill="${a}"></rect>
        <rect x="12" y="6" width="6" height="18" rx="3" fill="${b}"></rect>
        <rect x="20" y="6" width="6" height="18" rx="3" fill="${c}"></rect>
      </svg>`;
  }

  function setActiveDot(id){
    menu.querySelectorAll(".surfaceDot").forEach((b)=>{
      b.classList.toggle("is-active", b.getAttribute("data-surface") === id);
    });
  }

  // ✅ Sort: dunkel -> hell nach bgMain (im aktuellen light/dark mode)
  const lightMode = _isLightMode();
  const sorted = (SURFACE_THEMES_200 || []).slice().sort((a,b)=>{
    const av = (lightMode ? (a.light||a.dark) : (a.dark||a.light)) || {};
    const bv = (lightMode ? (b.light||b.dark) : (b.dark||b.light)) || {};
    const al = _luma(_hexToRgb(av.bgMain || "#000000"));
    const bl = _luma(_hexToRgb(bv.bgMain || "#000000"));
    return al - bl;
  });

  if (!menu._built){
    menu._built = true;
    menu.innerHTML = sorted.map((t)=>{
      const label = t.label || t.id;
      const v = lightMode ? (t.light||t.dark) : (t.dark||t.light);
      const prev = previewSvg(v?.bgMain, v?.bgStage, v?.bgChip);
      return `<button class="surfaceDot" type="button" data-surface="${t.id}" aria-label="${label}" title="${label}">${prev}</button>`;
    }).join("");
  }

  // 🔥 Preview state (nur anzeigen, NICHT speichern)
  let committedId = loadSurfaceThemeId() || (sorted[0]?.id || "");
  let previewing = false;

  function previewApply(id){
    if (!id) return;
    applySurfaceThemeById(id, { preview:true });
    previewing = true;
  }

  function restoreCommitted(){
    if (!previewing) return;
    previewing = false;
    if (!committedId) committedId = loadSurfaceThemeId() || (sorted[0]?.id || "");
    if (committedId) applySurfaceThemeById(committedId, { preview:true }); // restore ohne re-save/sync
  }

  if (!menu._bound){
    menu._bound = true;

    // ✅ Hover: nur Preview
    menu.addEventListener("pointerover", (e)=>{
      if (!picker.classList.contains("is-open")) return;
      const dot = e.target.closest?.(".surfaceDot");
      if (!dot) return;
      const id = dot.getAttribute("data-surface") || "";
      if (!id) return;
      previewApply(id);
    }, true);

    // ✅ Wenn Maus das Menü verlässt -> zurück auf committed
    menu.addEventListener("pointerleave", ()=>{
      restoreCommitted();
    });

    // ✅ Click: commit (speichern + DB sync)
    menu.addEventListener("click", (e)=>{
      const dot = e.target.closest?.(".surfaceDot");
      if (!dot) return;
      e.preventDefault(); e.stopPropagation();
      const id = dot.getAttribute("data-surface") || "";
      if (!id) return;

      committedId = id;
      previewing = false;

      applySurfaceThemeById(id, { preview:false }); // ✅ speichert + sync
      setActiveDot(id);
      picker.classList.remove("is-open");
    });
  }

  // toggle open/close
  if (!btn._bound){
    btn._bound = true;
    btn.addEventListener("click", (e)=>{
      e.preventDefault(); e.stopPropagation();
      committedId = loadSurfaceThemeId() || (sorted[0]?.id || "");
      picker.classList.toggle("is-open");
    });
  }

  // close when clicking outside (restore if only previewed)
  if (!picker._docBound){
    picker._docBound = true;
    document.addEventListener("click", (e)=>{
      if (!picker.classList.contains("is-open")) return;
      if (picker.contains(e.target)) return;
      picker.classList.remove("is-open");
      restoreCommitted();
    }, true);
  }

  // apply saved or first sorted
  const saved = loadSurfaceThemeId();
  const initial = (saved && sorted.find(x=>x.id===saved)) ? saved : (sorted[0]?.id || "");
  if (initial){
    committedId = initial;
    applySurfaceThemeById(initial, { preview:false });
    setActiveDot(initial);
  }

  // theme (light/dark) change -> rebuild menu order + re-apply current
  if (!picker._themeObs){
    picker._themeObs = true;
    const obs = new MutationObserver(()=>{
      const cur = loadSurfaceThemeId() || "";
      try{
        menu._built = false;
        menu.innerHTML = "";
      }catch{}
      try{ initSurfacePicker(); }catch{}
      if (cur) applySurfaceThemeById(cur, { preview:false });
    });
    obs.observe(document.documentElement, { attributes:true, attributeFilter:["data-theme"] });
  }
}

export const LS_STYLE_THEME = "quranm_style_theme_v1";

function clamp01(x){ return Math.max(0, Math.min(1, Number(x))); }
function hexToRgbArr(hex){
  const h = String(hex||"").trim().replace(/^#/, "");
  if (h.length===3) return [parseInt(h[0]+h[0],16), parseInt(h[1]+h[1],16), parseInt(h[2]+h[2],16)];
  if (h.length===6) return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)];
  return [0,0,0];
}
function arrToRgbStr(arr){
  const [r,g,b]=(arr||[0,0,0]).map(n=>Math.max(0,Math.min(255,Math.round(Number(n)||0))));
  return `${r},${g},${b}`;
}
function rgba(arr,a){ return `rgba(${arrToRgbStr(arr)},${clamp01(a)})`; }
function mixRgb(a,b,t){ const tt=clamp01(t); return [
  Math.round(a[0]+(b[0]-a[0])*tt),
  Math.round(a[1]+(b[1]-a[1])*tt),
  Math.round(a[2]+(b[2]-a[2])*tt),
]; }
function isLightMode(){ return document.documentElement.getAttribute("data-theme")==="light"; }

function buildDerivedColorRamps({ rgbWhite, rgbBlack, rgbInk, rgbSlate, rgbAccent, rgbDanger, rgbWarn, rgbNote }){
  const vars={};
  const blackAlphas={"03":0.03,"08":0.08,"12":0.12,"18":0.18,"25":0.25,"35":0.35};
  for (const k in blackAlphas) vars[`--c-black-${k}`] = rgba(rgbBlack, blackAlphas[k]);

  const inkAlphas={"03":0.03,"04":0.04,"06":0.06,"07":0.07,"08":0.08,"10":0.10,"12":0.12,"18":0.18,"20":0.20,"22":0.22,"28":0.28,"30":0.30,"35":0.35,"45":0.45,"55":0.55,"70":0.70,"88":0.88,"90":0.90,"92":0.92};
  for (const k in inkAlphas) vars[`--c-ink-${k}`] = rgba(rgbInk, inkAlphas[k]);

  const whiteAlphas={"04":0.04,"06":0.06,"10":0.10,"12":0.12,"14":0.14,"18":0.18,"22":0.22,"25":0.25,"28":0.28,"34":0.34,"35":0.35,"55":0.55,"88":0.88,"98":0.98};
  for (const k in whiteAlphas) vars[`--c-w-${k}`] = rgba(rgbWhite, whiteAlphas[k]);

  const accentAlphas={"06":0.06,"10":0.10,"12":0.12,"14":0.14,"16":0.16,"18":0.18,"20":0.20,"22":0.22,"25":0.25,"28":0.28,"32":0.32,"35":0.35,"40":0.40,"45":0.45,"55":0.55,"65":0.65,"70":0.70,"72":0.72,"75":0.75,"85":0.85,"95":0.95};
  for (const k in accentAlphas) vars[`--c-a-${k}`] = rgba(rgbAccent, accentAlphas[k]);

  vars["--c-d-18"] = rgba(rgbDanger, 0.18);
  vars["--c-d-25"] = rgba(rgbDanger, 0.25);
  vars["--c-d-95"] = rgba(rgbDanger, 0.95);

  vars["--c-warn-28"] = rgba(rgbWarn, 0.28);
  vars["--c-warn-40"] = rgba(rgbWarn, 0.40);
  vars["--c-warn-55"] = rgba(rgbWarn, 0.55);
  vars["--c-warn-90"] = rgba(rgbWarn, 0.90);
  vars["--c-warn-95"] = rgba(rgbWarn, 0.95);

  vars["--c-note-20"] = rgba(rgbNote, 0.20);
  vars["--c-note-28"] = rgba(rgbNote, 0.28);
  vars["--c-note-45"] = rgba(rgbNote, 0.45);
  vars["--c-note-70"] = rgba(rgbNote, 0.70);
  vars["--c-note-90"] = rgba(rgbNote, 0.90);

  vars["--c-slate-06"] = rgba(rgbSlate, 0.06);
  vars["--c-slate-16"] = rgba(rgbSlate, 0.16);
  vars["--c-slate-55"] = rgba(rgbSlate, 0.55);
  vars["--c-slate-88"] = rgba(rgbSlate, 0.88);

  return vars;
}

const BASE_THEME_DATA = [{"id":"style-164","label":"NearBlack 164","accentHex":"#4ee4ee","dark":{"bgMain":"#0b0b0d","bgStage":"#191b1f","bgChip":"#262a30","line":"#5b5f67"},"light":{"bgMain":"#f9f9f9","bgStage":"#fefefe","bgChip":"#f0f0f0","line":"#d1d1d1"},"warnRgb":[241,147,65],"noteRgb":[239,221,108],"dangerRgb":[236,69,60],"okRgb":[47,218,104],"favRgb":[239,134,42]},{"id":"style-178","label":"Near Black Neon 18","accentHex":"#4bdcf1","dark":{"bgMain":"#090a0b","bgStage":"#111316","bgChip":"#1d2025","line":"#44494f"},"light":{"bgMain":"#f9f9f9","bgStage":"#fefefe","bgChip":"#f0f0f0","line":"#d1d1d2"},"warnRgb":[255,90,200],"noteRgb":[255,240,140],"dangerRgb":[255,90,90],"okRgb":[90,220,130],"favRgb":[255,90,200]},{"id":"style-141","label":"Charcoal Accent 31","accentHex":"#4bcaf1","dark":{"bgMain":"#0c0c0e","bgStage":"#1a1b1e","bgChip":"#2b2c31","line":"#54565c"},"light":{"bgMain":"#f9f9f9","bgStage":"#fefefe","bgChip":"#f0f0f0","line":"#d1d1d1"},"warnRgb":[255,160,80],"noteRgb":[255,220,120],"dangerRgb":[255,90,90],"okRgb":[90,220,130],"favRgb":[255,140,50]},{"id":"style-133","label":"Charcoal 133","accentHex":"#4dc3f1","dark":{"bgMain":"#101011","bgStage":"#1e1f21","bgChip":"#2b2c30","line":"#46474a"},"light":{"bgMain":"#f9f9f9","bgStage":"#fefefe","bgChip":"#f0f0f0","line":"#d1d1d1"},"warnRgb":[241,147,65],"noteRgb":[239,221,108],"dangerRgb":[236,69,60],"okRgb":[47,218,104],"favRgb":[239,134,42]},{"id":"style-023","label":"Blue Slate 023","accentHex":"#4bc2f1","dark":{"bgMain":"#101315","bgStage":"#23282d","bgChip":"#2c3339","line":"#535a61"},"light":{"bgMain":"#f9f9f9","bgStage":"#fefefe","bgChip":"#f0f0f0","line":"#d1d1d2"},"warnRgb":[255,170,80],"noteRgb":[240,230,120],"dangerRgb":[255,90,90],"okRgb":[90,220,130],"favRgb":[255,150,60]},{"id":"style-082","label":"Blue Slate 082","accentHex":"#4baaf1","dark":{"bgMain":"#101214","bgStage":"#22252a","bgChip":"#30343b","line":"#595e66"},"light":{"bgMain":"#f9f9f9","bgStage":"#fefefe","bgChip":"#f0f0f0","line":"#d1d1d1"},"warnRgb":[255,170,80],"noteRgb":[240,230,120],"dangerRgb":[255,90,90],"okRgb":[90,220,130],"favRgb":[255,150,60]},{"id":"style-095","label":"Blue/Grey 095","accentHex":"#51a4ee","dark":{"bgMain":"#101114","bgStage":"#1d2024","bgChip":"#272b31","line":"#53575d"},"light":{"bgMain":"#f9f9f9","bgStage":"#fefefe","bgChip":"#f0f0f0","line":"#d1d1d1"},"warnRgb":[241,147,65],"noteRgb":[239,221,108],"dangerRgb":[236,69,60],"okRgb":[47,218,104],"favRgb":[239,134,42]},{"id":"style-112","label":"Charcoal 112","accentHex":"#4e8eef","dark":{"bgMain":"#0c0c0e","bgStage":"#191a1d","bgChip":"#232529","line":"#5e6067"},"light":{"bgMain":"#f9f9f9","bgStage":"#fefefe","bgChip":"#f0f0f0","line":"#d1d1d1"},"warnRgb":[241,147,65],"noteRgb":[239,221,108],"dangerRgb":[236,69,60],"okRgb":[47,218,104],"favRgb":[239,134,42]},{"id":"style-030","label":"Blue Slate 030","accentHex":"#4b85f1","dark":{"bgMain":"#0f1215","bgStage":"#1c2227","bgChip":"#303942","line":"#515a62"},"light":{"bgMain":"#f9f9f9","bgStage":"#fefefe","bgChip":"#f0f0f0","line":"#d1d1d2"},"warnRgb":[255,170,80],"noteRgb":[240,230,120],"dangerRgb":[255,90,90],"okRgb":[90,220,130],"favRgb":[255,150,60]},{"id":"style-079","label":"Blue/Grey 079","accentHex":"#3b72ec","dark":{"bgMain":"#0a0c0e","bgStage":"#181d21","bgChip":"#21272e","line":"#5b646d"},"light":{"bgMain":"#f9f9f9","bgStage":"#fefefe","bgChip":"#f0f0f0","line":"#d1d1d2"},"warnRgb":[241,147,65],"noteRgb":[239,221,108],"dangerRgb":[236,69,60],"okRgb":[47,218,104],"favRgb":[239,134,42]},{"id":"style-098","label":"Blue Slate 098","accentHex":"#4b74f1","dark":{"bgMain":"#101215","bgStage":"#24282f","bgChip":"#2d323b","line":"#595e68"},"light":{"bgMain":"#f9f9f9","bgStage":"#fefefe","bgChip":"#f0f0f0","line":"#d1d1d2"},"warnRgb":[255,170,80],"noteRgb":[240,230,120],"dangerRgb":[255,90,90],"okRgb":[90,220,130],"favRgb":[255,150,60]},{"id":"style-094","label":"Blue/Grey 094","accentHex":"#5570ed","dark":{"bgMain":"#0c0e10","bgStage":"#191e23","bgChip":"#22282e","line":"#3f454a"},"light":{"bgMain":"#f9f9f9","bgStage":"#fefefe","bgChip":"#f0f0f0","line":"#d1d1d2"},"warnRgb":[241,147,65],"noteRgb":[239,221,108],"dangerRgb":[236,69,60],"okRgb":[47,218,104],"favRgb":[239,134,42]},{"id":"style-016","label":"Blue/Grey 016","accentHex":"#4c63f4","dark":{"bgMain":"#0c0d10","bgStage":"#16191f","bgChip":"#21262f","line":"#484d57"},"light":{"bgMain":"#f9f9f9","bgStage":"#fefefe","bgChip":"#f0f0f0","line":"#d1d1d2"},"warnRgb":[241,147,65],"noteRgb":[239,221,108],"dangerRgb":[236,69,60],"okRgb":[47,218,104],"favRgb":[239,134,42]},{"id":"style-076","label":"Blue Slate 076","accentHex":"#4b5cf1","dark":{"bgMain":"#101315","bgStage":"#1e2429","bgChip":"#2e373f","line":"#505860"},"light":{"bgMain":"#f9f9f9","bgStage":"#fefefe","bgChip":"#f0f0f0","line":"#d1d1d2"},"warnRgb":[255,170,80],"noteRgb":[240,230,120],"dangerRgb":[255,90,90],"okRgb":[90,220,130],"favRgb":[255,150,60]},{"id":"style-089","label":"Blue/Grey 089","accentHex":"#3645f2","dark":{"bgMain":"#0b0c0f","bgStage":"#1b1f24","bgChip":"#282c35","line":"#494d55"},"light":{"bgMain":"#f9f9f9","bgStage":"#fefefe","bgChip":"#f0f0f0","line":"#d1d1d2"},"warnRgb":[241,147,65],"noteRgb":[239,221,108],"dangerRgb":[236,69,60],"okRgb":[47,218,104],"favRgb":[239,134,42]},{"id":"style-050","label":"Blue Slate 050","accentHex":"#654bf1","dark":{"bgMain":"#111317","bgStage":"#21252c","bgChip":"#272c34","line":"#50555f"},"light":{"bgMain":"#f9f9f9","bgStage":"#fefefe","bgChip":"#f0f0f0","line":"#d1d1d2"},"warnRgb":[255,170,80],"noteRgb":[240,230,120],"dangerRgb":[255,90,90],"okRgb":[90,220,130],"favRgb":[255,150,60]},{"id":"style-090","label":"Blue/Grey 090","accentHex":"#5e41f6","dark":{"bgMain":"#0d0e12","bgStage":"#171921","bgChip":"#1f212c","line":"#464955"},"light":{"bgMain":"#f9f9f9","bgStage":"#fefefe","bgChip":"#f0f0f0","line":"#d1d1d2"},"warnRgb":[241,147,65],"noteRgb":[239,221,108],"dangerRgb":[236,69,60],"okRgb":[47,218,104],"favRgb":[239,134,42]},{"id":"style-170","label":"Near Black Neon 10","accentHex":"#de4bf1","dark":{"bgMain":"#08090b","bgStage":"#131519","bgChip":"#1f2228","line":"#3b3f46"},"light":{"bgMain":"#f9f9f9","bgStage":"#fefefe","bgChip":"#f0f0f0","line":"#d1d1d2"},"warnRgb":[255,90,200],"noteRgb":[255,240,140],"dangerRgb":[255,90,90],"okRgb":[90,220,130],"favRgb":[255,90,200]},{"id":"style-163","label":"NearBlack 163","accentHex":"#f65ab0","dark":{"bgMain":"#131419","bgStage":"#1e1f27","bgChip":"#292b35","line":"#5e606c"},"light":{"bgMain":"#f9f9f9","bgStage":"#fefefe","bgChip":"#f0f0f0","line":"#d1d1d1"},"warnRgb":[241,147,65],"noteRgb":[239,221,108],"dangerRgb":[236,69,60],"okRgb":[47,218,104],"favRgb":[239,134,42]},{"id":"style-138","label":"Charcoal 138","accentHex":"#f54963","dark":{"bgMain":"#0d0e0f","bgStage":"#191a1e","bgChip":"#25262b","line":"#4c4d53"},"light":{"bgMain":"#f9f9f9","bgStage":"#fefefe","bgChip":"#f0f0f0","line":"#d1d1d1"},"warnRgb":[242,110,54],"noteRgb":[238,214,119],"dangerRgb":[236,69,60],"okRgb":[47,218,104],"favRgb":[239,134,42]},{"id":"style-191","label":"Contrast Slate + Red 191","accentHex":"#f5586a","dark":{"bgMain":"#0c0e10","bgStage":"#191c21","bgChip":"#252930","line":"#464a51"},"light":{"bgMain":"#f9f9f9","bgStage":"#fefefe","bgChip":"#f0f0f0","line":"#d1d1d2"},"warnRgb":[242,110,54],"noteRgb":[238,214,119],"dangerRgb":[236,69,60],"okRgb":[47,218,104],"favRgb":[239,134,42]},{"id":"style-049","label":"Blue/Grey 049","accentHex":"#f15058","dark":{"bgMain":"#0e1013","bgStage":"#1b1f24","bgChip":"#23272f","line":"#484d55"},"light":{"bgMain":"#f9f9f9","bgStage":"#fefefe","bgChip":"#f0f0f0","line":"#d1d1d2"},"warnRgb":[242,110,54],"noteRgb":[238,214,119],"dangerRgb":[236,69,60],"okRgb":[47,218,104],"favRgb":[239,134,42]},{"id":"style-031","label":"Blue/Grey 031","accentHex":"#ed3a3e","dark":{"bgMain":"#0d1012","bgStage":"#1d2328","bgChip":"#283137","line":"#5b656c"},"light":{"bgMain":"#f9f9f9","bgStage":"#fefefe","bgChip":"#f0f0f0","line":"#d1d1d2"},"warnRgb":[242,110,54],"noteRgb":[238,214,119],"dangerRgb":[236,69,60],"okRgb":[47,218,104],"favRgb":[239,134,42]},{"id":"style-143","label":"Charcoal Accent 33","accentHex":"#f14d4b","dark":{"bgMain":"#0e0f10","bgStage":"#1b1c1e","bgChip":"#2e2f32","line":"#505154"},"light":{"bgMain":"#f9f9f9","bgStage":"#fefefe","bgChip":"#f0f0f0","line":"#d1d1d1"},"warnRgb":[255,160,80],"noteRgb":[255,220,120],"dangerRgb":[255,90,90],"okRgb":[90,220,130],"favRgb":[255,140,50]},{"id":"style-109","label":"Charcoal 109","accentHex":"#f2342c","dark":{"bgMain":"#0b0b0c","bgStage":"#1d1e21","bgChip":"#27282c","line":"#606166"},"light":{"bgMain":"#f9f9f9","bgStage":"#fefefe","bgChip":"#f0f0f0","line":"#d1d1d1"},"warnRgb":[242,110,54],"noteRgb":[238,214,119],"dangerRgb":[236,69,60],"okRgb":[47,218,104],"favRgb":[239,134,42]},{"id":"style-190","label":"Contrast Slate + Red 10","accentHex":"#f1634b","dark":{"bgMain":"#0e0f12","bgStage":"#1c2025","bgChip":"#2d333b","line":"#595f69"},"light":{"bgMain":"#f9f9f9","bgStage":"#fefefe","bgChip":"#f0f0f0","line":"#d1d1d2"},"warnRgb":[240,124,66],"noteRgb":[136,171,221],"dangerRgb":[255,90,90],"okRgb":[90,220,130],"favRgb":[238,59,43]},{"id":"style-137","label":"Charcoal 137","accentHex":"#f07d60","dark":{"bgMain":"#0d0e0f","bgStage":"#1a1b1e","bgChip":"#25262a","line":"#48494d"},"light":{"bgMain":"#f9f9f9","bgStage":"#fefefe","bgChip":"#f0f0f0","line":"#d1d1d1"},"warnRgb":[242,110,54],"noteRgb":[238,214,119],"dangerRgb":[236,69,60],"okRgb":[47,218,104],"favRgb":[239,134,42]},{"id":"style-015","label":"Blue/Grey 015","accentHex":"#e8683d","dark":{"bgMain":"#0a0c0f","bgStage":"#1a1f25","bgChip":"#252c34","line":"#3c4249"},"light":{"bgMain":"#f9f9f9","bgStage":"#fefefe","bgChip":"#f0f0f0","line":"#d1d1d2"},"warnRgb":[242,110,54],"noteRgb":[238,214,119],"dangerRgb":[236,69,60],"okRgb":[47,218,104],"favRgb":[239,134,42]},{"id":"style-157","label":"Charcoal Accent 47","accentHex":"#f17d4b","dark":{"bgMain":"#0d0d0e","bgStage":"#191a1c","bgChip":"#2d2f32","line":"#4b4d50"},"light":{"bgMain":"#f9f9f9","bgStage":"#fefefe","bgChip":"#f0f0f0","line":"#d1d1d1"},"warnRgb":[255,160,80],"noteRgb":[255,220,120],"dangerRgb":[255,90,90],"okRgb":[90,220,130],"favRgb":[255,140,50]},{"id":"style-179","label":"Contrast Cyan + Orange 179","accentHex":"#eb8b40","dark":{"bgMain":"#0b0f10","bgStage":"#1a2426","bgChip":"#253437","line":"#505f63"},"light":{"bgMain":"#f9f9f9","bgStage":"#fefefe","bgChip":"#eff0f0","line":"#d0d1d2"},"warnRgb":[241,147,65],"noteRgb":[239,221,108],"dangerRgb":[236,69,60],"okRgb":[47,218,104],"favRgb":[239,134,42]},{"id":"style-128","label":"Charcoal 128","accentHex":"#eb8c36","dark":{"bgMain":"#0d0e0f","bgStage":"#191a1c","bgChip":"#25282a","line":"#45484a"},"light":{"bgMain":"#f9f9f9","bgStage":"#fefefe","bgChip":"#f0f0f0","line":"#d1d1d1"},"warnRgb":[241,147,65],"noteRgb":[239,221,108],"dangerRgb":[236,69,60],"okRgb":[47,218,104],"favRgb":[239,134,42]},{"id":"style-199","label":"Contrast Green + Orange 19","accentHex":"#f1a14b","dark":{"bgMain":"#0e120f","bgStage":"#212a24","bgChip":"#2c3931","line":"#536058"},"light":{"bgMain":"#f9f9f9","bgStage":"#fefefe","bgChip":"#f0f0f0","line":"#d1d2d1"},"warnRgb":[240,191,66],"noteRgb":[136,221,165],"dangerRgb":[255,90,90],"okRgb":[90,220,130],"favRgb":[238,134,43]},{"id":"style-177","label":"Contrast Green + Orange 177","accentHex":"#f5b156","dark":{"bgMain":"#0b0e0c","bgStage":"#19211b","bgChip":"#222d25","line":"#5c6b61"},"light":{"bgMain":"#f9f9f9","bgStage":"#fefefe","bgChip":"#f0f0f0","line":"#d1d2d1"},"warnRgb":[241,147,65],"noteRgb":[239,221,108],"dangerRgb":[236,69,60],"okRgb":[47,218,104],"favRgb":[239,134,42]},{"id":"style-115","label":"Charcoal Accent 05","accentHex":"#f1b04b","dark":{"bgMain":"#0d0e10","bgStage":"#191b1e","bgChip":"#26292c","line":"#515559"},"light":{"bgMain":"#f9f9f9","bgStage":"#fefefe","bgChip":"#f0f0f0","line":"#d1d1d1"},"warnRgb":[255,160,80],"noteRgb":[255,220,120],"dangerRgb":[255,90,90],"okRgb":[90,220,130],"favRgb":[255,140,50]},{"id":"style-044","label":"Blue/Grey 044","accentHex":"#f0bb51","dark":{"bgMain":"#0b0c0d","bgStage":"#17191c","bgChip":"#24272c","line":"#585c63"},"light":{"bgMain":"#f9f9f9","bgStage":"#fefefe","bgChip":"#f0f0f0","line":"#d1d1d1"},"warnRgb":[241,147,65],"noteRgb":[239,221,108],"dangerRgb":[236,69,60],"okRgb":[47,218,104],"favRgb":[239,134,42]},{"id":"style-174","label":"Near Black Neon 14","accentHex":"#e8f14b","dark":{"bgMain":"#09090b","bgStage":"#151619","bgChip":"#1f1f24","line":"#3b3c41"},"light":{"bgMain":"#f9f9f9","bgStage":"#fefefe","bgChip":"#f0f0f0","line":"#d1d1d1"},"warnRgb":[255,90,200],"noteRgb":[255,240,140],"dangerRgb":[255,90,90],"okRgb":[90,220,130],"favRgb":[255,90,200]},{"id":"style-194","label":"Contrast Purple + Lime 194","accentHex":"#63e847","dark":{"bgMain":"#0e0c0f","bgStage":"#221b24","bgChip":"#2e2531","line":"#625764"},"light":{"bgMain":"#f9f9f9","bgStage":"#fefefe","bgChip":"#f0f0f0","line":"#d1d1d2"},"warnRgb":[241,147,65],"noteRgb":[136,221,200],"dangerRgb":[236,69,60],"okRgb":[47,218,104],"favRgb":[239,134,42]},{"id":"style-162","label":"NearBlack 162","accentHex":"#4eee47","dark":{"bgMain":"#0f1012","bgStage":"#1e2024","bgChip":"#2b2f35","line":"#484c51"},"light":{"bgMain":"#f9f9f9","bgStage":"#fefefe","bgChip":"#f0f0f0","line":"#d1d1d1"},"warnRgb":[241,147,65],"noteRgb":[136,221,200],"dangerRgb":[236,69,60],"okRgb":[47,218,104],"favRgb":[239,134,42]},{"id":"style-121","label":"Charcoal Accent 11","accentHex":"#4bf150","dark":{"bgMain":"#0e0e0f","bgStage":"#19191b","bgChip":"#2d2d31","line":"#4f5054"},"light":{"bgMain":"#f9f9f9","bgStage":"#fefefe","bgChip":"#f0f0f0","line":"#d1d1d1"},"warnRgb":[255,160,80],"noteRgb":[255,220,120],"dangerRgb":[255,90,90],"okRgb":[90,220,130],"favRgb":[255,140,50]},{"id":"style-125","label":"Charcoal 125","accentHex":"#44eb74","dark":{"bgMain":"#0d0d0e","bgStage":"#1f2022","bgChip":"#2d2f32","line":"#4d4e51"},"light":{"bgMain":"#f9f9f9","bgStage":"#fefefe","bgChip":"#f0f0f0","line":"#d1d1d1"},"warnRgb":[241,147,65],"noteRgb":[136,221,200],"dangerRgb":[236,69,60],"okRgb":[47,218,104],"favRgb":[239,134,42]},{"id":"style-122","label":"Charcoal 122","accentHex":"#4df08c","dark":{"bgMain":"#0f0f10","bgStage":"#1f1f22","bgChip":"#292a2d","line":"#5c5d61"},"light":{"bgMain":"#f9f9f9","bgStage":"#fefefe","bgChip":"#f0f0f0","line":"#d1d1d1"},"warnRgb":[241,147,65],"noteRgb":[136,221,200],"dangerRgb":[236,69,60],"okRgb":[47,218,104],"favRgb":[239,134,42]},{"id":"style-146","label":"Charcoal Accent 36","accentHex":"#4bf197","dark":{"bgMain":"#0c0d0e","bgStage":"#1b1c1f","bgChip":"#26282b","line":"#47494d"},"light":{"bgMain":"#f9f9f9","bgStage":"#fefefe","bgChip":"#f0f0f0","line":"#d1d1d1"},"warnRgb":[255,160,80],"noteRgb":[255,220,120],"dangerRgb":[255,90,90],"okRgb":[90,220,130],"favRgb":[255,140,50]},{"id":"style-116","label":"Charcoal 116","accentHex":"#3cf294","dark":{"bgMain":"#0e0f10","bgStage":"#1e2123","bgChip":"#2b2e32","line":"#414447"},"light":{"bgMain":"#f9f9f9","bgStage":"#fefefe","bgChip":"#f0f0f0","line":"#d1d1d1"},"warnRgb":[241,147,65],"noteRgb":[136,221,200],"dangerRgb":[236,69,60],"okRgb":[47,218,104],"favRgb":[239,134,42]},{"id":"style-018","label":"Blue/Grey 018","accentHex":"#34f4aa","dark":{"bgMain":"#0b0d10","bgStage":"#171a20","bgChip":"#21242d","line":"#464a53"},"light":{"bgMain":"#f9f9f9","bgStage":"#fefefe","bgChip":"#f0f0f0","line":"#d1d1d2"},"warnRgb":[241,147,65],"noteRgb":[136,221,200],"dangerRgb":[236,69,60],"okRgb":[47,218,104],"favRgb":[239,134,42]},{"id":"style-183","label":"Contrast Indigo + Mint 03","accentHex":"#4bf1c2","dark":{"bgMain":"#0e0d13","bgStage":"#211e2c","bgChip":"#312b40","line":"#534d62"},"light":{"bgMain":"#f9f9f9","bgStage":"#fefefe","bgChip":"#f0eff0","line":"#d1d0d2"},"warnRgb":[66,240,240],"noteRgb":[157,136,221],"dangerRgb":[255,90,90],"okRgb":[90,220,130],"favRgb":[43,238,189]}];

// =========================
// EXTRA NeonBlack Themes (auto-generated)
// - same near-black surfaces like "Near Black Neon 10"
// - more magenta / girly pink / gold / yellow->acid green accents
// =========================
const __NEON_BLACK_SURFACES = {
  dark:  { bgMain:"#08090b", bgStage:"#131519", bgChip:"#1f2228", line:"#3b3f46" },
  light: { bgMain:"#f9f9f9", bgStage:"#fefefe", bgChip:"#f0f0f0", line:"#d1d1d2" }
};

// helpers
function __hexToRgbArrLocal(hex){
  const h = String(hex||"").trim().replace(/^#/, "");
  if (h.length===3) return [parseInt(h[0]+h[0],16), parseInt(h[1]+h[1],16), parseInt(h[2]+h[2],16)];
  if (h.length===6) return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)];
  return [0,0,0];
}

function __mkNeonTheme(idNum, label, accentHex){
  // we keep warn/note tuned to the accent family a bit, but safe defaults
  const acc = __hexToRgbArrLocal(accentHex);

  // classify by hue-ish (very rough): more "warm" => gold/yellow/lime, else pink/magenta
  const warmish = (acc[0] > 200 && acc[1] > 120); // yellow/gold/lime-ish
  const warnRgb = warmish ? [255, 190, 80] : [255, 90, 200];     // gold-ish or pink-ish
  const noteRgb = warmish ? [255, 240, 140] : [200, 140, 255];   // yellow note or purple note

  return {
    id: `style-${idNum}`,
    label,
    accentHex,
    dark:  { ...__NEON_BLACK_SURFACES.dark },
    light: { ...__NEON_BLACK_SURFACES.light },
    warnRgb,
    noteRgb,
    dangerRgb: [255,90,90],
    okRgb: [90,220,130]
    // favRgb: optional (we let your existing deriveFavRgb() handle it)
  };
}

// Accent sets (progressbar color)
const __MAGENTA = [
  "#ff2bd6","#ff2fe0","#ff33ea","#ff36f4","#ff3bff",
  "#f22bff","#e52bff","#d82bff","#cb2bff","#be2bff",
  "#b12bff","#a42bff","#972bff","#8a2bff","#7d2bff",
  "#ff2bb3","#ff2bbd","#ff2bc7","#ff2bd1","#ff2bdb"
];

const __PINK_GIRLY = [
  "#ff5aa8","#ff4f9e","#ff4494","#ff398a","#ff2e80",
  "#ff6bc0","#ff7bd0","#ff8be0","#ff9bf0","#ffaaf7",
  "#ff6aa3","#ff7ab0","#ff8abd","#ff9aca","#ffaad7"
];

const __GOLD = [
  "#ffd24b","#ffcc33","#ffc61a","#ffbf00","#ffb800",
  "#ffb24b","#ffac33","#ffa61a","#ff9f00","#ff9800",
  "#e8c15a","#d9b54f"
];

const __YELLOW_TO_ACID_GREEN = [
  "#e8ff2b","#dfff2b","#d6ff2b","#cdff2b","#c4ff2b",
  "#bbff2b","#b2ff2b","#a9ff2b","#a0ff2b","#97ff2b",
  "#8eff2b","#85ff2b","#7cff2b","#73ff2b","#6aff2b",
  "#61ff2b","#58ff2b","#4fff2b","#46ff2b"
];

// build extra themes
const EXTRA_NEON_THEMES = [];
let __id = 301;

// Magenta block
for (let i=0;i<__MAGENTA.length;i++){
  EXTRA_NEON_THEMES.push(__mkNeonTheme(__id++, `NeonBlack Magenta ${String(i+1).padStart(2,"0")}`, __MAGENTA[i]));
}
// Girly pink block
for (let i=0;i<__PINK_GIRLY.length;i++){
  EXTRA_NEON_THEMES.push(__mkNeonTheme(__id++, `NeonBlack Pink ${String(i+1).padStart(2,"0")}`, __PINK_GIRLY[i]));
}
// Gold block
for (let i=0;i<__GOLD.length;i++){
  EXTRA_NEON_THEMES.push(__mkNeonTheme(__id++, `NeonBlack Gold ${String(i+1).padStart(2,"0")}`, __GOLD[i]));
}
// Yellow -> Acid green block
for (let i=0;i<__YELLOW_TO_ACID_GREEN.length;i++){
  EXTRA_NEON_THEMES.push(__mkNeonTheme(__id++, `NeonBlack Lime ${String(i+1).padStart(2,"0")}`, __YELLOW_TO_ACID_GREEN[i]));
}

// Final list used by the app:
const THEME_DATA = BASE_THEME_DATA.concat(EXTRA_NEON_THEMES);

function makeThemeFromData(d){
  const accentRgb = hexToRgbArr(d.accentHex);
  const dangerRgb = d.dangerRgb || [255,90,90];
  const warnRgb   = d.warnRgb   || [255,160,60];
  const noteRgb   = d.noteRgb   || [255,220,80];
  const okRgb     = d.okRgb     || [90,220,130];

  // ✅ Favorites-Farbe (Ring + Striche im Favoritenbutton)
  // Einige Styles haben sonst fav zu nah an der Progressbar-Farbe -> hier harte Kontrast-Overrides:
  const FAV_OVERRIDES = {
    "Near Black Neon 10": [80,255,170],           // Mint gegen Purple/Magenta
    "NearBlack 163": [70,220,255],
    "Near Black 163": [70,220,255],                // Cyan gegen Pink
    "Contrast Indigo + Mint 03": [255,120,70],
    "Contrast Indigo + Mint 3": [255,120,70],
    "Contrast Indigo Mint 3": [255,120,70],    // Coral gegen Mint/Teal
  };

  const favRgb = (FAV_OVERRIDES[d.label] || d.favRgb || null);

  function deriveFavRgb(){
    const a = accentRgb;
    // Default: invert + leicht Richtung warm (wirkt meist wie "Komplement", ohne schmutzig zu werden)
    const opp = mixRgb([255-a[0], 255-a[1], 255-a[2]], [255,145,45], 0.25);
    return opp;
  }

  const favRgbUsed = Array.isArray(favRgb) ? favRgb : deriveFavRgb();

  function buildVars(mode){
    const light = mode==="light";
// ✅ FORCE NeonBlack Look for ALL styles (surfaces fixed, only accent changes)
const __SURF_DARK  = { bgMain:"#08090b", bgStage:"#131519", bgChip:"#1f2228", line:"#3b3f46" };
const __SURF_LIGHT = { bgMain:"#f9f9f9", bgStage:"#fefefe", bgChip:"#f0f0f0", line:"#d1d1d2" };

const bgMain  = light ? __SURF_LIGHT.bgMain  : __SURF_DARK.bgMain;
const bgStage = light ? __SURF_LIGHT.bgStage : __SURF_DARK.bgStage;
const bgChip  = light ? __SURF_LIGHT.bgChip  : __SURF_DARK.bgChip;
const line    = light ? __SURF_LIGHT.line    : __SURF_DARK.line;

    const rgbInk = light ? [12,22,38] : hexToRgbArr(__SURF_DARK.bgMain);
    const rgbSlate = mixRgb(rgbInk, [255,255,255], 0.10);

    const colorText = light ? rgba(rgbInk, 0.88) : "rgba(255,255,255,.88)";
    const colorTextMuted = light ? rgba(rgbInk, 0.55) : "rgba(255,255,255,.55)";
    const colorArText = light ? rgba(rgbInk, 0.92) : "rgba(255,255,255,.98)";

    const vars = {

      // text
      "--color-text": colorText,
      "--color-text-muted": colorTextMuted,
      "--color-ar-text": colorArText,

      // bases
      "--rgb-white": "255,255,255",
      "--rgb-black": "0,0,0",
      "--rgb-ink": arrToRgbStr(rgbInk),
      "--rgb-slate": arrToRgbStr(rgbSlate),

      // progress / accent
      "--rgb-accent": arrToRgbStr(accentRgb),
      "--color-accent": `rgb(${arrToRgbStr(accentRgb)})`,

      // signals
      "--rgb-danger": arrToRgbStr(dangerRgb),
      "--rgb-warn": arrToRgbStr(warnRgb),
      "--rgb-note": arrToRgbStr(noteRgb),
      "--rgb-ok": arrToRgbStr(okRgb),

      // fav (ring + fav button marks)
      "--rgb-fav": arrToRgbStr(favRgbUsed),
      "--rgb-fav-ring": "var(--rgb-fav)",
      "--color-fav-mark": "rgba(var(--rgb-fav),0.28)",

      // some aliases used elsewhere
      "--rgb-special": "var(--rgb-warn)",
      "--rgb-repeat": "var(--rgb-warn)",
      "--rgb-copy": "var(--rgb-ok)",
      "--rgb-notes": "var(--rgb-note)",
      "--rgb-bookmark": "var(--rgb-accent)",

      
      "--fav-add-title-bg-hover": "rgba(var(--rgb-accent),0.18)",

      "--glow-blue": "rgba(var(--rgb-accent),0.55)",
    };

    Object.assign(vars, buildDerivedColorRamps({
      rgbWhite:[255,255,255],
      rgbBlack:[0,0,0],
      rgbInk,
      rgbSlate,
      rgbAccent: accentRgb,
      rgbDanger: dangerRgb,
      rgbWarn: warnRgb,
      rgbNote: noteRgb,
    }));

    return vars;
  }

  return {
    id: d.id,
    label: d.label,
    accentHex: d.accentHex,
    varsDark: buildVars("dark"),
    varsLight: buildVars("light"),
    preview: { a: d.accentHex, b: d.dark.bgStage, c: d.dark.bgMain },
  };
}

// Build themes
const __STYLE_THEMES_UNSORTED = THEME_DATA.map(makeThemeFromData);

// ✅ Sortiere nach Accent/Progressbar-Farbe (Hue) → Regenbogen
function __rgbToHue([r,g,b]){
  r/=255; g/=255; b/=255;
  const max = Math.max(r,g,b), min = Math.min(r,g,b);
  const d = max - min;
  if (d === 0) return 0;
  let h = 0;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return h;
}

// Regenbogen-Startpunkt: „mitte“ (Cyan/Grün), damit das Menü nicht mit rot startet
const __HUE_PIVOT = 170;

// sortieren + rotieren
const __sorted = __STYLE_THEMES_UNSORTED.slice().sort((a,b)=>{
  const ha = __rgbToHue(hexToRgbArr(a.accentHex));
  const hb = __rgbToHue(hexToRgbArr(b.accentHex));
  if (ha !== hb) return ha - hb;
  return String(a.id||"").localeCompare(String(b.id||""));
});

let __pivotIdx = __sorted.findIndex(t => __rgbToHue(hexToRgbArr(t.accentHex)) >= __HUE_PIVOT);
if (__pivotIdx < 0) __pivotIdx = 0;

export const STYLE_THEMES = (()=>{const list=__sorted.slice(__pivotIdx).concat(__sorted.slice(0,__pivotIdx));const setRange=(from,to,favRgbStr,noteRgbStr)=>{const a=list.findIndex(t=>t&&t.label===from),b=list.findIndex(t=>t&&t.label===to);if(a<0||b<0)return;const s=Math.min(a,b),e=Math.max(a,b);for(let i=s;i<=e;i++){const t=list[i];for(const k of ["varsDark","varsLight"]){if(!t||!t[k])continue;t[k]["--rgb-fav"]=favRgbStr;t[k]["--rgb-fav-ring"]="var(--rgb-fav)";t[k]["--color-fav-mark"]="rgba(var(--rgb-fav),0.28)";t[k]["--rgb-repeat"]="var(--rgb-fav)";t[k]["--rgb-special"]="var(--rgb-fav)";t[k]["--rgb-note"]=noteRgbStr;}}};setRange("Near Black Neon 14","Near Black Neon 18","239,134,42","239,221,108");setRange("NeonBlack Magenta 15","NeonBlack Gold 03","80,255,170","60,120,230");return list;})();

export function loadStyleThemeId(){ try{ return String(localStorage.getItem(LS_STYLE_THEME)||""); }catch{ return ""; } }
export function saveStyleThemeId(id){ try{ localStorage.setItem(LS_STYLE_THEME, String(id||"")); }catch{} }

export function applyStyleThemeById(id, opts = {}){
  const t = STYLE_THEMES.find(x=>x.id===id) || STYLE_THEMES[0];
  if (!t) return;

  const vars = isLightMode() ? (t.varsLight||t.varsDark) : (t.varsDark||t.varsLight);
  const root = document.documentElement.style;
  for (const k in vars) root.setProperty(k, String(vars[k]));

  const preview = !!opts.preview;

  // ✅ NUR speichern + syncen, wenn Click-Auswahl (nicht Hover-Preview)
  if (!preview){
    saveStyleThemeId(t.id);
    try{ window.__accountScheduleSync?.(); }catch{}
  }

  // UI refresh darf auch beim Preview
  try{ window.__refreshFavButtonDecor?.(); }catch{}
}

export function initStylePicker(){
  const picker = document.getElementById("stylePicker");
  const menu = document.getElementById("styleMenu");
  const btn = document.getElementById("styleBtn");
  if (!picker || !menu) return;

  function previewSvg(p){
    const a=(p&&p.a)?p.a:"var(--color-accent)";
    const b=(p&&p.b)?p.b:"var(--color-bg-stage)";
    const c=(p&&p.c)?p.c:"var(--color-bg-main)";
    return `
      <svg class="stylePreview" viewBox="0 0 30 30" aria-hidden="true">
        <rect x="4"  y="6" width="6" height="18" rx="3" fill="${a}"></rect>
        <rect x="12" y="6" width="6" height="18" rx="3" fill="${b}"></rect>
        <rect x="20" y="6" width="6" height="18" rx="3" fill="${c}"></rect>
      </svg>`;
  }

  // menu nur einmal bauen
  if (!menu._built){
    menu._built = true;
    menu.innerHTML = STYLE_THEMES.map((t)=>{
      const id = t.id;
      const label = t.label || id;
      const prev = t.preview || null;
      return `<button class="styleDot" type="button" data-style="${id}" aria-label="${label}" title="${label}">${previewSvg(prev)}</button>`;
    }).join("");
  }

  function setActiveDot(id){
    menu.querySelectorAll(".styleDot").forEach((b)=>{
      b.classList.toggle("is-active", b.getAttribute("data-style")===id);
    });
  }

const DEFAULT_STYLE_ID =
  (STYLE_THEMES.find(t => t?.label === "Blue Slate 082")?.id) ||
  (STYLE_THEMES.find(t => t?.id === "style-082")?.id) ||
  (STYLE_THEMES[0] ? STYLE_THEMES[0].id : "");

  function safeId(id){
    return id || DEFAULT_STYLE_ID || (STYLE_THEMES[0] ? STYLE_THEMES[0].id : "");
  }

  // 🔥 Preview state (nur anzeigen, NICHT speichern)
  let committedId = safeId(loadStyleThemeId());
  let previewing = false;

  function previewApply(id){
    const sid = safeId(id);
    if (!sid) return;
    applyStyleThemeById(sid, { preview:true });
    previewing = true;
  }

  function restoreCommitted(){
    if (!previewing) return;
    previewing = false;
    committedId = safeId(loadStyleThemeId() || committedId);
    if (committedId) applyStyleThemeById(committedId, { preview:true });
  }

  // click binding nur einmal
  if (!menu._bound){
    menu._bound = true;

    // ✅ Hover: preview only
    menu.addEventListener("pointerover", (e)=>{
      if (!picker.classList.contains("is-open")) return;
      const dot = e.target.closest?.(".styleDot");
      if (!dot) return;
      const id = dot.getAttribute("data-style") || "";
      if (!id) return;
      previewApply(id);
    }, true);

    // ✅ wenn Maus Menü verlässt -> zurück
    menu.addEventListener("pointerleave", ()=>{
      restoreCommitted();
    });

    // ✅ Click: commit + close
    menu.addEventListener("click", (e)=>{
      const dot = e.target.closest?.(".styleDot");
      if (!dot) return;
      e.preventDefault(); e.stopPropagation();
      const id = dot.getAttribute("data-style") || "";
      const sid = safeId(id);
      if (!sid) return;

      committedId = sid;
      previewing = false;

      applyStyleThemeById(sid, { preview:false }); // ✅ speichert + sync
      setActiveDot(sid);
      picker.classList.remove("is-open");
    });
  }

  // toggle open/close
  if (btn && !btn._bound){
    btn._bound = true;
    btn.addEventListener("click", (e)=>{
      e.preventDefault();
      e.stopPropagation();
      committedId = safeId(loadStyleThemeId() || committedId);
      picker.classList.toggle("is-open");
    });
  }

  // close when clicking outside (restore if only previewed)
  if (!picker._docBound){
    picker._docBound = true;
    document.addEventListener("click", (e)=>{
      if (!picker.classList.contains("is-open")) return;
      if (picker.contains(e.target)) return;
      picker.classList.remove("is-open");
      restoreCommitted();
    }, true);
  }

  // initial apply: saved if present, else default
  const saved = loadStyleThemeId();
  committedId = safeId(saved || DEFAULT_STYLE_ID);
  if (committedId){
    applyStyleThemeById(committedId, { preview:false });
    setActiveDot(committedId);
  }

  // Theme (light/dark) Wechsel: neu anwenden, aber NICHT default überschreiben
  if (!picker._themeObs){
    picker._themeObs = true;
    const obs = new MutationObserver(()=>{
      const curSaved = safeId(loadStyleThemeId() || committedId || DEFAULT_STYLE_ID);
      committedId = curSaved;
      applyStyleThemeById(curSaved, { preview:false });
      setActiveDot(curSaved);
    });
    obs.observe(document.documentElement, { attributes:true, attributeFilter:["data-theme"] });
  }
}

//
// ✅ Console / Hotkeys: Styles mit ← / → wechseln
// Usage in Console:
//   quranStyleKeys()        -> enable
//   quranStyleKeys(false)   -> disable
//   quranStyleNext()        -> next style
//   quranStylePrev()        -> previous style
//
function _styleIds(){
  return (Array.isArray(STYLE_THEMES) ? STYLE_THEMES : [])
    .map(t => t && t.id)
    .filter(Boolean);
}

function _currentStyleId(){
  return loadStyleThemeId() || (_styleIds()[0] || "");
}

function _markActiveDot(id){
  try{
    const menu = document.getElementById("styleMenu");
    if (!menu) return;
    menu.querySelectorAll(".styleDot").forEach((b)=>{
      b.classList.toggle("is-active", b.getAttribute("data-style") === id);
    });
  }catch(e){}
}

function _applyStyleAndMark(id){
  if (!id) return;
  applyStyleThemeById(id);
  _markActiveDot(id);
}

function _cycleStyle(dir){
  const ids = _styleIds();
  if (!ids.length) return;

  const cur = _currentStyleId();
  let i = ids.indexOf(cur);
  if (i < 0) i = 0;

  const next = (i + (dir >= 0 ? 1 : -1) + ids.length) % ids.length;
  _applyStyleAndMark(ids[next]);
}

// Expose simple console functions
window.quranStyleNext = () => _cycleStyle(+1);
window.quranStylePrev = () => _cycleStyle(-1);
window.quranStyleSet  = (id) => _applyStyleAndMark(String(id || ""));
window.quranStyleList = () => _styleIds().slice();

// Hotkeys (ArrowLeft / ArrowRight)
function _enableStyleHotkeys(){
  if (window.__quranStyleKeysOn) return;
  window.__quranStyleKeysOn = true;

  window.__quranStyleKeysHandler = function(e){
    // nicht triggern beim Tippen / Inputs
    const t = e.target;
    const tag = (t && t.tagName) ? String(t.tagName).toLowerCase() : "";
    const typing =
      (tag === "input" || tag === "textarea" || tag === "select" || (t && t.isContentEditable));
    if (typing) return;

    // keine Hotkeys wenn Modifier gedrückt (damit nichts kaputt geht)
    if (e.altKey || e.ctrlKey || e.metaKey) return;

    if (e.key === "ArrowRight"){
      e.preventDefault();
      _cycleStyle(+1);
    } else if (e.key === "ArrowLeft"){
      e.preventDefault();
      _cycleStyle(-1);
    }
  };

  window.addEventListener("keydown", window.__quranStyleKeysHandler, { passive:false });
}

function _disableStyleHotkeys(){
  if (!window.__quranStyleKeysOn) return;
  window.__quranStyleKeysOn = false;
  try{
    window.removeEventListener("keydown", window.__quranStyleKeysHandler);
  }catch(e){}
  window.__quranStyleKeysHandler = null;
}

// Main console toggle
window.quranStyleKeys = (on = true) => {
  if (on === false) _disableStyleHotkeys();
  else _enableStyleHotkeys();
  return window.__quranStyleKeysOn;
};

// Optional: also hook into your existing debug object if it exists
try{
  window.__quranDebug = window.__quranDebug || {};
  window.__quranDebug.styleKeys = window.quranStyleKeys;
  window.__quranDebug.styleNext = window.quranStyleNext;
  window.__quranDebug.stylePrev = window.quranStylePrev;
}catch(e){}
