// data.js
let _loadPromise = null;

const _ayahByRef = new Map();
const _wordsByRef = new Map();
const _suraMeta = new Map();
const _suraRefs = new Map();

async function fetchJson(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Kann JSON nicht laden: ${path} (${res.status})`);
  return res.json();
}

/**
 * Lädt und normalisiert Quran-Daten in ein einheitliches Modell.
 * Standardpfade sind Dateinamen im gleichen Ordner wie index.html.
 */
export function loadQuranData(opts = {}) {
  if (_loadPromise) return _loadPromise;

  const ayahPath = opts.ayahPath ?? "quran_full_with_overrides.json";
  const wordPath = opts.wordPath ?? "quran_worddata_de_en_audio.json";

  _loadPromise = (async () => {
    const [ayahRows, wordDict] = await Promise.all([
      fetchJson(ayahPath),
      fetchJson(wordPath),
    ]);

    // 1) Ayah-Index + Sura-Meta + Refs
    for (const row of ayahRows) {
      const ref = String(row.ref ?? `${row.surah}:${row.ayah}`);
      const surah = Number(row.surah);
      const ayah = Number(row.ayah);

      const ayahObj = {
        ref,
        surah,
        ayah,
        surahNameAr: row.surah_name_ar ?? "",
        surahNameTranslit: row.surah_name_translit ?? "",
        textAr: row.text_ar ?? "",
        scores: {
          ayahScore: row.ayah_score ?? null,
          wordScores: row.word_scores ?? null,
          finalScore: row.final_score ?? null,
        },
        words: [],     // wird unten gefüllt
        timings: null, // Platzhalter für später (pro Reciter)
      };

      _ayahByRef.set(ref, ayahObj);

      if (!_suraMeta.has(surah)) {
        _suraMeta.set(surah, {
          surah,
          nameAr: ayahObj.surahNameAr,
          nameTranslit: ayahObj.surahNameTranslit,
          ayahCount: 0,
          // Regel für später: eigenständige Basmallah (nicht als Ayah gezählt)
          // außer Fatiha (1) und Tauba (9)
          hasStandaloneBasmallah: surah !== 1 && surah !== 9,
        });
        _suraRefs.set(surah, []);
      }

      _suraMeta.get(surah).ayahCount++;
      _suraRefs.get(surah).push(ref);
    }

    // 2) Word-Index (ref -> words[])
    for (const [ref, arr] of Object.entries(wordDict)) {
      if (!Array.isArray(arr)) continue;

      const words = arr.map((w, i) => {
        const audioUrl = (w.audioUrl || "").trim();
        const isAyahNoToken =
          !audioUrl && /^\(\d+\)$/.test(String(w.en ?? w.de ?? "").trim());

        return {
          i,
          ar: w.ar ?? "",
          de: w.de ?? "",
          en: w.en ?? "",
          audioUrl,
          playable: Boolean(audioUrl),
          isAyahNoToken, // z.B. "(69)" Token, meist ohne Audio
          // timings kommen später rein:
          start: null,
          end: null,
        };
      });

      _wordsByRef.set(ref, words);
    }

    // 3) Words an Ayah-Objekte hängen (damit getAyah(ref).words sofort geht)
    for (const [ref, ayahObj] of _ayahByRef.entries()) {
      ayahObj.words = _wordsByRef.get(ref) ?? [];
    }
  })();

  return _loadPromise;
}

export function normalizeRef(input) {
  const m = String(input).trim().match(/^(\d{1,3})\s*[:/]\s*(\d{1,3})$/);
  if (!m) return null;
  return `${Number(m[1])}:${Number(m[2])}`;
}

export function getAyah(ref) {
  return _ayahByRef.get(ref) ?? null;
}

export function getWords(ref) {
  return _wordsByRef.get(ref) ?? [];
}

export function getSuraMeta(surah) {
  return _suraMeta.get(Number(surah)) ?? null;
}

export function getSuraRefs(surah) {
  return _suraRefs.get(Number(surah)) ?? [];
}
