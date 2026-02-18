/* Apostas Live - versão estável (sem crash)
   - Render cards
   - Filtros e auto refresh
   - Modal "Porque?"
*/

const $ = (id) => document.getElementById(id);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const state = {
  mode: "live",       // "live" | "next"
  market: "1x2",      // "1x2" | "ou25" | "btts"
  level: "all",       // all | top | good | mid | bad
  timer: null,
  games: [],
};

function nowStr() {
  const d = new Date();
  return d.toLocaleString();
}

function storageGet(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v == null ? fallback : v;
  } catch { return fallback; }
}
function storageSet(key, value) {
  try { localStorage.setItem(key, value); } catch {}
}

function setStatus(text) {
  const el = $("statusLine");
  if (el) el.textContent = text;
}
function setLastUpdate() {
  const el = $("lastUpdate");
  if (el) el.textContent = nowStr();
}

function apiBase() {
  const v = ($("apiBase")?.value || "").trim();
  return v.replace(/\/+$/, "");
}

function apiHeaders() {
  const h = { "Accept": "application/json" };
  const pass = ($("apiPass")?.value || "").trim();
  if (pass) h["X-Password"] = pass;
  return h;
}

function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

function computeConfidence(game) {
  // Se o worker já trouxer "confidence" usa; se não, cria algo simples
  const c = Number(game.confidence ?? game.conf ?? game.score_confidence ?? 0);
  if (!Number.isFinite(c) || c <= 0) {
    // fallback: usa um valor suave para não dar 0 sempre
    return 50;
  }
  return clamp(c, 0, 100);
}

function computeEdge(game) {
  // Se já houver edge/value usa; se não, 0.
  const e = Number(game.edge ?? game.value ?? game.value_edge ?? 0);
  return Number.isFinite(e) ? e : 0;
}

function levelFrom(conf) {
  if (conf >= 80) return "top";
  if (conf >= 65) return "good";
  if (conf >= 50) return "mid";
  return "bad";
}

function levelClass(level) {
  if (level === "top") return "levelTop";
  if (level === "good") return "levelGood";
  if (level === "mid") return "levelMid";
  return "levelBad";
}

function normalizeGames(payload) {
  // Aceita formatos:
  // { payload: { results: [...] } }
  // { results: [...] }
  // ou Soccerdata "results" com ligas->stages->matches (raw)
  const raw = payload?.payload?.results ?? payload?.results ?? payload?.payload ?? payload;

  if (Array.isArray(raw)) {
    // Já vem lista de jogos "flat"
    return raw.map((g) => ({
      id: g.id ?? g.match_id ?? `${g.home}-${g.away}-${g.time ?? ""}`,
      league: g.league_name ?? g.league ?? "—",
      country: g.country?.name ?? g.country ?? "",
      time: g.time ?? g.kickoff ?? g.date_time ?? g.date ?? "",
      date: g.date ?? "",
      home: g.home?.name ?? g.teams?.home?.name ?? g.home ?? "Casa",
      away: g.away?.name ?? g.teams?.away?.name ?? g.away ?? "Fora",
      status: g.status ?? g.match_status ?? "—",
      minute: g.minute ?? g.time_minute ?? null,
      confidence: g.confidence ?? g.conf ?? null,
      edge: g.edge ?? g.value ?? null,
      raw: g,
    }));
  }

  // Caso raw tipo Soccerdata: [{league_id,... stage:[{matches:[...]}]}]
  if (Array.isArray(payload?.payload?.results)) {
    // já tratado acima
    return [];
  }

  if (Array.isArray(payload?.payload?.results) === false && Array.isArray(payload?.payload) === true) {
    // ignore
  }

  // Detecta formato soccerdata "OK_RAW" que vem tipo:
  // payload: { results: [ { league_name, country, stage:[ { matches:[...] } ] } ] }
  const leagues = payload?.payload?.results;
  if (Array.isArray(leagues)) {
    const out = [];
    for (const L of leagues) {
      const league = L.league_name ?? "—";
      const country = L.country?.name ?? "";
      const stages = Array.isArray(L.stage) ? L.stage : [];
      for (const S of stages) {
        const matches = Array.isArray(S.matches) ? S.matches : [];
        for (const M of matches) {
          out.push({
            id: M.id,
            league,
            country,
            date: M.date ?? "",
            time: M.time ?? "",
            home: M.teams?.home?.name ?? "Casa",
            away: M.teams?.away?.name ?? "Fora",
            status: M.status ?? "—",
            minute: M.minute ?? null,
            confidence: null,
            edge: null,
            raw: M
          });
        }
      }
    }
    return out;
  }

  return [];
}

async function fetchGames() {
  const base = apiBase();
  if (!base) {
    setStatus("Mete o API Base (workers.dev).");
    return [];
  }

  const days = Number($("days")?.value || 3);
  const endpoint = state.mode === "live" ? "/jogos" : "/jogos"; // mais estável
  const url = new URL(base + endpoint);
  if (state.mode !== "live") url.searchParams.set("days", String(days));
  url.searchParams.set("debug", "0");

  setStatus("A carregar…");

  const r = await fetch(url.toString(), { headers: apiHeaders() });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`API ${r.status}: ${t.slice(0,200)}`);
  }
  const j = await r.json();
  const games = normalizeGames(j);

  setLastUpdate();
  setStatus(`OK — ${games.length} jogos carregados.`);
  return games;
}

function applyFilters(games) {
  const q = ($("search")?.value || "").trim().toLowerCase();
  const minConf = Number($("minConfidence")?.value || 0);
  const minEdge = Number($("minEdge")?.value || 0);
  const sortBy = ($("sortBy")?.value || "confidence");

  let out = games.map(g => {
    const confidence = computeConfidence(g);
    const edge = computeEdge(g);
    const level = levelFrom(confidence);
    return { ...g, confidence, edge, level };
  });

  if (q) {
    out = out.filter(g =>
      `${g.league} ${g.country} ${g.home} ${g.away}`.toLowerCase().includes(q)
    );
  }

  out = out.filter(g => g.confidence >= minConf && g.edge >= minEdge);

  if (state.level !== "all") out = out.filter(g => g.level === state.level);

  out.sort((a,b) => {
    if (sortBy === "edge") return (b.edge - a.edge) || (b.confidence - a.confidence);
    if (sortBy === "time") return String(a.date + " " + a.time).localeCompare(String(b.date + " " + b.time));
    return (b.confidence - a.confidence) || (b.edge - a.edge);
  });

  return out;
}

function scoreBadge(g) {
  const level = g.level;
  const cls = levelClass(level);
  const label =
    level === "top" ? "Top" :
    level === "good" ? "Boa" :
    level === "mid" ? "Média" : "Fraca";

  return `<span class="badge ${cls}">${label} • ${Math.round(g.confidence)}%</span>`;
}

function cardHTML(g) {
  const metaLeft = `${g.league}${g.country ? " • " + g.country : ""}`;
  const metaRight =
    state.mode === "live"
      ? (g.minute != null && g.minute >= 0 ? `${g.minute}'` : (g.status || "AO VIVO"))
      : `${g.date || ""} ${g.time || ""}`.trim();

  const why = `
    <div class="modalRow">
      <b>Confiança:</b> ${Math.round(g.confidence)}%<br/>
      <b>Value (edge):</b> ${Number(g.edge).toFixed(1)}%<br/><br/>
      <b>Como calculo agora:</b><br/>
      • Se a API trouxer confidence/edge → uso esses valores.<br/>
      • Se não trouxer → confiança fica default 50% e edge 0%.<br/><br/>
      Próximo passo (quando estiveres com tempo): ligar odds reais por mercado (1X2/OU/BTTS) e estatísticas para um score verdadeiro.
    </div>
  `;

  return `
    <div class="card" data-id="${g.id}">
      <div class="cardTop">
        <div>
          <div class="meta">${metaLeft}</div>
          <div class="teams">${g.home} <span style="opacity:.7">vs</span> ${g.away}</div>
          <div class="meta">${metaRight}</div>
        </div>
        ${scoreBadge(g)}
      </div>

      <div class="cardBottom">
        <div class="kpis">
          <div class="kpi"><b>Edge</b> ${Number(g.edge).toFixed(1)}%</div>
          <div class="kpi"><b>Modo</b> ${state.mode === "live" ? "AO VIVO" : "PRÓXIMOS"}</div>
          <div class="kpi"><b>Mercado</b> ${state.market.toUpperCase()}</div>
        </div>
        <button class="smallBtn" data-why="1">Porque?</button>
      </div>

      <template class="whyTpl">${why}</template>
    </div>
  `;
}

function render() {
  const wrap = $("games");
  const empty = $("empty");
  if (!wrap) return;

  const filtered = applyFilters(state.games);
  wrap.innerHTML = filtered.map(cardHTML).join("");

  if (empty) {
    empty.classList.toggle("hidden", filtered.length !== 0);
  }
}

function openModal(title, sub, html) {
  const m = $("modal");
  if (!m) return;
  $("modalTitle").textContent = title || "Porque?";
  $("modalSub").textContent = sub || "";
  $("modalBody").innerHTML = html || "";
  m.classList.remove("hidden");
}
function closeModal() {
  $("modal")?.classList.add("hidden");
}

function bindUI() {
  // Tabs
  $("tabLive")?.addEventListener("click", () => {
    state.mode = "live";
    $("tabLive").classList.add("active");
    $("tabNext").classList.remove("active");
    reload();
  });
  $("tabNext")?.addEventListener("click", () => {
    state.mode = "next";
    $("tabNext").classList.add("active");
    $("tabLive").classList.remove("active");
    reload();
  });

  // Buttons
  $("btnRefresh")?.addEventListener("click", reload);
  $("btnHelp")?.addEventListener("click", () => {
    openModal(
      "Ajuda",
      "Como usar",
      `
      <div>
        <b>1)</b> Mete o <b>API Base</b> (workers.dev)<br/>
        <b>2)</b> Ajusta <b>Min. confiança</b> e <b>Min. edge</b> para veres mais jogos<br/>
        <b>3)</b> Usa <b>Atualizar</b> ou ativa <b>Auto-refresh</b><br/><br/>
        Nota: Se não aparecer nada, mete filtros a 0 e testa em <b>PRÓXIMOS</b>.
      </div>
      `
    );
  });

  // Sliders labels (sem crash)
  const minEdgeEl = $("minEdge");
  const minEdgeTextEl = $("minEdgeText");
  if (minEdgeEl && minEdgeTextEl) {
    minEdgeTextEl.textContent = `${minEdgeEl.value}%`;
    minEdgeEl.addEventListener("input", () => {
      minEdgeTextEl.textContent = `${minEdgeEl.value}%`;
      storageSet("minEdge", minEdgeEl.value);
      render();
    });
  }

  const minConfEl = $("minConfidence");
  const minConfTextEl = $("minConfidenceText");
  if (minConfEl && minConfTextEl) {
    minConfTextEl.textContent = `${minConfEl.value}%`;
    minConfEl.addEventListener("input", () => {
      minConfTextEl.textContent = `${minConfEl.value}%`;
      storageSet("minConfidence", minConfEl.value);
      render();
    });
  }

  // Inputs
  $("search")?.addEventListener("input", render);
  $("sortBy")?.addEventListener("change", render);
  $("days")?.addEventListener("change", reload);
  $("apiBase")?.addEventListener("change", () => storageSet("apiBase", $("apiBase").value.trim()));
  $("apiPass")?.addEventListener("change", () => storageSet("apiPass", $("apiPass").value));
  $("refreshInterval")?.addEventListener("change", setupTimer);
  $("autoRefresh")?.addEventListener("change", setupTimer);

  // Mercado
  $$(".seg").forEach(btn => {
    btn.addEventListener("click", () => {
      $$(".seg").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      state.market = btn.dataset.market || "1x2";
      storageSet("market", state.market);
      render();
    });
  });

  // Level chips
  $$(".chip").forEach(btn => {
    btn.addEventListener("click", () => {
      $$(".chip").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      state.level = btn.dataset.level || "all";
      render();
    });
  });

  // Modal close
  $("modalClose")?.addEventListener("click", closeModal);
  $("modal")?.addEventListener("click", (e) => {
    if (e.target && e.target.id === "modal") closeModal();
  });

  // Delegation: Porque?
  $("games")?.addEventListener("click", (e) => {
    const btn = e.target?.closest?.("[data-why]");
    if (!btn) return;
    const card = e.target.closest(".card");
    const tpl = card?.querySelector(".whyTpl");
    const title = card?.querySelector(".teams")?.textContent || "Porque?";
    openModal(title, "Explicação do score", tpl?.innerHTML || "—");
  });
}

function setupTimer() {
  if (state.timer) {
    clearInterval(state.timer);
    state.timer = null;
  }
  const enabled = $("autoRefresh")?.checked;
  const sec = Number($("refreshInterval")?.value || 20);
  if (enabled) {
    state.timer = setInterval(reload, sec * 1000);
  }
}

async function reload() {
  try {
    const games = await fetchGames();
    state.games = games;
    render();
  } catch (err) {
    console.error(err);
    setStatus("Erro: " + (err?.message || "Failed"));
    state.games = [];
    render();
  }
}

function boot() {
  // restore settings
  const base = storageGet("apiBase", "https://apostas-live-api.manelronaldo1.workers.dev");
  const pass = storageGet("apiPass", "");
  const minC = storageGet("minConfidence", "35");
  const minE = storageGet("minEdge", "0");
  const market = storageGet("market", "1x2");

  if ($("apiBase")) $("apiBase").value = base;
  if ($("apiPass")) $("apiPass").value = pass;
  if ($("minConfidence")) $("minConfidence").value = minC;
  if ($("minEdge")) $("minEdge").value = minE;

  // set market active
  state.market = market;
  $$(".seg").forEach(b => b.classList.toggle("active", (b.dataset.market || "1x2") === market));

  bindUI();
  setupTimer();
  reload();
}

document.addEventListener("DOMContentLoaded", boot);
