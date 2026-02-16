// js/app.js (COMPLETO)
// Liga o teu front-end ao Cloudflare Worker e monta UI (lista, detalhe, tabs, boletim, banca)

const WORKER_BASE = "https://apostas-live-api.manelronaldo1.workers.dev";

// Endpoints (ajusta se o teu Worker usar outros paths)
const ENDPOINTS = {
  live: "/live",
  pre: "/pre",          // se não existir, fica fallback
  multis: "/multis",    // se não existir, fica fallback
};

const $ = (id) => document.getElementById(id);

const els = {
  list: $("list"),
  detail: $("detail"),
  detailTitle: $("detailTitle"),
  detailBody: $("detailBody"),
  btnCloseDetail: $("btnCloseDetail"),
  btnRefresh: $("btnRefresh"),
  txtFilter: $("txtFilter"),
  selSort: $("selSort"),
  selOddsMode: $("selOddsMode"),

  slipCount: $("slipCount"),
  slipItems: $("slipItems"),
  stakeInput: $("stakeInput"),
  totalOdds: $("totalOdds"),
  estReturn: $("estReturn"),
  btnPlace: $("btnPlace"),

  bankAmount: $("bankAmount"),
};

let state = {
  tab: "live",
  games: [],
  filtered: [],
  selectedGame: null,

  slip: [], // { key, gameId, label, odd, edge, color }
  bank: 1000,
};

// ---------- Helpers ----------
function fmtMoney(n) {
  return Number(n || 0).toFixed(2);
}

function safeNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

function normalizeText(s) {
  return (s || "")
    .toString()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

function calcTotalOdds() {
  if (!state.slip.length) return 1;
  return state.slip.reduce((acc, s) => acc * safeNum(s.odd || 1), 1);
}

function calcEstReturn() {
  const stake = safeNum(els.stakeInput.value);
  return stake * calcTotalOdds();
}

function setBank(n) {
  state.bank = Math.max(0, safeNum(n));
  els.bankAmount.textContent = fmtMoney(state.bank);
}

function setLoadingList(msg = "A carregar…") {
  els.list.innerHTML = `<div class="hint">${msg}</div>`;
}

function badgeClassFromEdge(edge) {
  // edge 0..100
  if (edge >= 70) return "good";
  if (edge >= 50) return "warn";
  return "bad";
}

function edgeLabel(edge) {
  if (edge >= 70) return "Boa";
  if (edge >= 50) return "Média";
  return "Fraca";
}

// ---------- Data mapping (SoccerdataAPI costuma variar) ----------
function mapFromApi(raw) {
  // Esperado: { count, results: [ { league_name, country:{name}, stage:{matches:[...] } } ] }
  // Vamos "achatar" para uma lista simples de jogos.
  const out = [];

  const results = raw?.results || raw?.data || raw?.matches || [];
  // Caso já venha como lista de jogos
  if (Array.isArray(results) && results.length && (results[0]?.teams || results[0]?.home || results[0]?.away)) {
    for (const m of results) out.push(mapMatch(m, null));
    return out;
  }

  // Caso venha agrupado por ligas
  if (Array.isArray(results)) {
    for (const league of results) {
      const leagueName = league?.league_name || league?.name || "Liga";
      const countryName = league?.country?.name || league?.country_name || "";
      const stages = league?.stage ? [league.stage] : league?.stages || [];
      for (const st of stages) {
        const matches = st?.matches || st?.games || [];
        for (const m of matches) {
          out.push(mapMatch(m, { leagueName, countryName }));
        }
      }
    }
  }

  return out;
}

function mapMatch(m, leagueCtx) {
  const id = m?.id ?? m?.match_id ?? cryptoRandomId();
  const home = m?.teams?.home?.name || m?.home?.name || m?.home_team?.name || m?.home || "Casa";
  const away = m?.teams?.away?.name || m?.away?.name || m?.away_team?.name || m?.away || "Fora";
  const minute = m?.minute ?? m?.time?.minute ?? m?.status?.minute ?? "-";
  const status = m?.status || m?.match_status || "—";
  const date = m?.date || m?.start_date || "";
  const time = m?.time || m?.start_time || m?.kickoff || "";

  const leagueName =
    m?.league?.name ||
    m?.league_name ||
    leagueCtx?.leagueName ||
    "Liga";

  const country =
    m?.country?.name ||
    m?.country_name ||
    leagueCtx?.countryName ||
    "";

  const scoreHome =
    m?.goals?.home ||
    m?.score?.home ||
    m?.home_score ||
    0;

  const scoreAway =
    m?.goals?.away ||
    m?.score?.away ||
    m?.away_score ||
    0;

  // Odds: se existirem no payload (às vezes vem m.odds.match_winner.home etc.)
  const apiOdds = extractOdds(m);

  return {
    id,
    home,
    away,
    minute: minute === null || minute === undefined ? "-" : minute,
    status: typeof status === "string" ? status : "—",
    leagueName,
    country,
    date,
    time,
    scoreHome,
    scoreAway,
    raw: m,
    apiOdds,
  };
}

function extractOdds(m) {
  // tenta encontrar algo parecido com odds no payload
  const o = m?.odds || m?.markets || null;

  // padrão do teu JSON: odds.match_winner.home etc.
  const mw = m?.odds?.match_winner;
  if (mw) {
    return {
      home: mw.home,
      draw: mw.draw,
      away: mw.away,
      ou: m?.odds?.over_under,
      handicap: m?.odds?.handicap,
    };
  }

  // fallback: nada
  return null;
}

function cryptoRandomId() {
  // fallback simples
  return Math.random().toString(36).slice(2, 10);
}

// ---------- Odds + “edge” (simulação simples) ----------
function buildTipsForGame(g) {
  // Isto é um “motor” simples só para ter UI a funcionar.
  // Depois podemos trocar por lógica real usando stats/h2h/etc.
  const minute = safeNum(g.minute);
  const sim = (seed) => {
    const x = Math.sin(seed) * 10000;
    return x - Math.floor(x);
  };

  const base = sim(hashStr(g.home + g.away + g.leagueName));
  const pressure = minute > 0 ? Math.min(1, minute / 90) : 0.4;

  // 3 seleções exemplo
  const tips = [
    {
      key: `${g.id}:ou25`,
      label: "Mais de 2.5 golos",
      odd: 1.65 + base * 0.9,
      edge: Math.round(45 + base * 40 + pressure * 10),
      why: "Tendência de ritmo ofensivo e linha de odds aceitável (modelo simples).",
    },
    {
      key: `${g.id}:cards35`,
      label: "Mais de 3.5 cartões",
      odd: 1.55 + (1 - base) * 0.9,
      edge: Math.round(40 + (1 - base) * 45),
      why: "Equipas com probabilidade maior de faltas/cartões (modelo simples).",
    },
    {
      key: `${g.id}:corners85`,
      label: "Mais de 8.5 cantos",
      odd: 1.60 + sim(hashStr(g.away + g.home)) * 0.9,
      edge: Math.round(42 + sim(hashStr(g.leagueName)) * 45),
      why: "Padrão de ataques laterais e pressão (modelo simples).",
    },
  ];

  // ordenar por edge desc
  tips.sort((a, b) => b.edge - a.edge);

  // pintar “cor” como pediste (azul/verde/amarelo/vermelho)
  for (const t of tips) {
    if (t.edge >= 70) t.color = "good";      // verde
    else if (t.edge >= 55) t.color = "warn"; // amarelo
    else t.color = "bad";                    // vermelho
  }

  // “azul” podes usar para “neutro” se quiseres mais tarde
  return tips;
}

function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function getOddsMode() {
  return els.selOddsMode?.value || "api";
}

function getSortMode() {
  return els.selSort?.value || "time";
}

// ---------- Fetch ----------
async function fetchJson(url) {
  const res = await fetch(url, { headers: { "accept": "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}

async function loadTab(tab) {
  state.tab = tab;
  setLoadingList("A carregar…");

  // definir endpoint
  let path = ENDPOINTS[tab] || ENDPOINTS.live;
  let url = `${WORKER_BASE}${path}`;

  let raw;
  try {
    raw = await fetchJson(url);
  } catch (e) {
    // fallback: se o endpoint não existir, tenta raiz
    try {
      raw = await fetchJson(`${WORKER_BASE}/`);
    } catch (e2) {
      els.list.innerHTML = `<div class="hint">Erro a obter dados do Worker. Confirma URL/endpoint.<br><br><b>${String(e2.message || e2)}</b></div>`;
      return;
    }
  }

  const games = mapFromApi(raw);

  // Se o /pre ou /multis não existir, ainda assim mostra algo
  state.games = games;
  applyFilterAndRender();
}

// ---------- Render ----------
function applyFilterAndRender() {
  const q = normalizeText(els.txtFilter?.value || "");
  let items = [...state.games];

  // filtro
  if (q) {
    items = items.filter((g) => {
      const hay = normalizeText(`${g.leagueName} ${g.country} ${g.home} ${g.away}`);
      return hay.includes(q);
    });
  }

  // ordenar
  const sortMode = getSortMode();
  if (sortMode === "league") {
    items.sort((a, b) => (a.leagueName || "").localeCompare(b.leagueName || ""));
  } else if (sortMode === "edge") {
    items.sort((a, b) => {
      const ea = buildTipsForGame(a)[0]?.edge || 0;
      const eb = buildTipsForGame(b)[0]?.edge || 0;
      return eb - ea;
    });
  } else {
    // time: tenta ordenar por hora/tempo
    items.sort((a, b) => String(a.time || "").localeCompare(String(b.time || "")));
  }

  state.filtered = items;
  renderList();
}

function renderList() {
  if (!state.filtered.length) {
    els.list.innerHTML = `<div class="hint">Sem jogos para mostrar (filtro/endpoint).</div>`;
    return;
  }

  const oddsMode = getOddsMode();

  els.list.innerHTML = state.filtered
    .map((g) => {
      const bestTip = buildTipsForGame(g)[0];
      const badge = badgeClassFromEdge(bestTip.edge);

      // “odd base” (se tiver da API, usa a casa como exemplo; senão simula)
      let oddPreview = bestTip.odd;
      if (oddsMode === "api" && g.apiOdds?.home) oddPreview = g.apiOdds.home;

      return `
      <div class="card" data-game="${g.id}">
        <div class="row">
          <div>
            <div class="league">${escapeHtml(g.leagueName)} ${g.country ? `<span class="meta">(${escapeHtml(g.country)})</span>` : ""}</div>
            <div class="teams">${escapeHtml(g.home)} <span class="meta">vs</span> ${escapeHtml(g.away)}</div>
            <div class="meta">Minuto: ${escapeHtml(String(g.minute))} • ${escapeHtml(String(g.status || ""))}</div>
          </div>
          <div style="text-align:right">
            <div class="badge badge-${badge}">${edgeLabel(bestTip.edge)} • ${bestTip.edge}%</div>
            <div class="meta" style="margin-top:6px">Odd ~ <b>${safeNum(oddPreview).toFixed(2)}</b></div>
          </div>
        </div>
      </div>`;
    })
    .join("");

  // click handlers
  document.querySelectorAll("[data-game]").forEach((el) => {
    el.addEventListener("click", () => {
      const id = el.getAttribute("data-game");
      const g = state.filtered.find((x) => String(x.id) === String(id));
      if (g) openDetail(g);
    });
  });
}

function openDetail(g) {
  state.selectedGame = g;
  els.detailTitle.textContent = `${g.home} vs ${g.away}`;
  const tips = buildTipsForGame(g);

  els.detailBody.innerHTML = `
    <div class="meta">${escapeHtml(g.leagueName)} ${g.country ? `(${escapeHtml(g.country)})` : ""} • Minuto: ${escapeHtml(String(g.minute))}</div>

    <div style="height:10px"></div>

    <div class="hint">
      Prognósticos (modelo simples por agora). Depois ligamos a <b>stats / h2h</b> para “explicar o porquê” com dados reais.
    </div>

    <div style="height:12px"></div>

    ${tips
      .map((t) => {
        const badge = t.color; // good/warn/bad
        return `
        <div class="card" style="cursor:default">
          <div class="row">
            <div>
              <div style="font-weight:900">${escapeHtml(t.label)}</div>
              <div class="meta">${escapeHtml(t.why)}</div>
            </div>
            <div style="text-align:right">
              <div class="badge badge-${badge}">${edgeLabel(t.edge)} • ${t.edge}%</div>
              <div class="meta" style="margin-top:6px">Odd: <b>${safeNum(t.odd).toFixed(2)}</b></div>
              <div style="height:8px"></div>
              <button class="btn primary" data-add="${escapeHtml(t.key)}">Adicionar</button>
            </div>
          </div>
        </div>`;
      })
      .join("")}
  `;

  // add buttons
  els.detailBody.querySelectorAll("[data-add]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const key = btn.getAttribute("data-add");
      const tip = tips.find((x) => x.key === key);
      if (tip) addToSlip(g, tip);
    });
  });
}

function closeDetail() {
  state.selectedGame = null;
  els.detailTitle.textContent = "Seleciona um jogo";
  els.detailBody.innerHTML = `<div class="hint">Clica num jogo para abrir detalhes, estatísticas e prognósticos.</div>`;
}

// ---------- Bet slip ----------
function addToSlip(game, tip) {
  // não duplicar
  if (state.slip.some((s) => s.key === tip.key)) {
    renderSlip();
    return;
  }

  state.slip.push({
    key: tip.key,
    gameId: game.id,
    label: `${game.home} vs ${game.away} — ${tip.label}`,
    odd: safeNum(tip.odd).toFixed(2),
    edge: tip.edge,
    color: tip.color,
  });

  renderSlip();
}

function removeFromSlip(key) {
  state.slip = state.slip.filter((s) => s.key !== key);
  renderSlip();
}

function renderSlip() {
  els.slipCount.textContent = `${state.slip.length} seleções`;

  if (!state.slip.length) {
    els.slipItems.innerHTML = `<div class="meta">Sem seleções</div>`;
  } else {
    els.slipItems.innerHTML = state.slip
      .map(
        (s) => `
        <div class="pill" style="display:flex;align-items:center;gap:10px">
          <span class="badge badge-${s.color}">${s.edge}%</span>
          <span style="max-width:420px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(s.label)}</span>
          <b>${safeNum(s.odd).toFixed(2)}</b>
          <button class="btn ghost" data-remove="${escapeHtml(s.key)}">✕</button>
        </div>`
      )
      .join("");

    els.slipItems.querySelectorAll("[data-remove]").forEach((btn) => {
      btn.addEventListener("click", () => removeFromSlip(btn.getAttribute("data-remove")));
    });
  }

  const total = calcTotalOdds();
  els.totalOdds.textContent = total.toFixed(2);

  const est = calcEstReturn();
  els.estReturn.textContent = fmtMoney(est);
}

function placeBet() {
  const stake = safeNum(els.stakeInput.value);
  if (!state.slip.length) return alert("Adiciona pelo menos 1 seleção.");
  if (stake <= 0) return alert("Stake inválida.");
  if (stake > state.bank) return alert("Stake maior que a banca.");

  // Subtrai banca e limpa boletim (registo simples)
  setBank(state.bank - stake);
  alert(`Aposta registada! Stake €${fmtMoney(stake)} | Odds ${calcTotalOdds().toFixed(2)} | Retorno est. €${fmtMoney(calcEstReturn())}`);

  state.slip = [];
  renderSlip();
}

// ---------- Tabs ----------
function initTabs() {
  document.querySelectorAll(".tab").forEach((t) => {
    t.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((x) => x.classList.remove("active"));
      t.classList.add("active");
      const tab = t.getAttribute("data-tab");
      closeDetail();
      loadTab(tab);
    });
  });
}

// ---------- Events ----------
function initEvents() {
  els.btnCloseDetail.addEventListener("click", closeDetail);
  els.btnRefresh.addEventListener("click", () => loadTab(state.tab));
  els.txtFilter.addEventListener("input", applyFilterAndRender);
  els.selSort.addEventListener("change", applyFilterAndRender);
  els.selOddsMode.addEventListener("change", applyFilterAndRender);
  els.stakeInput.addEventListener("input", () => {
    els.estReturn.textContent = fmtMoney(calcEstReturn());
  });
  els.btnPlace.addEventListener("click", placeBet);
}

// ---------- Security: escape HTML ----------
function escapeHtml(str) {
  return (str ?? "")
    .toString()
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// ---------- Boot ----------
function boot() {
  setBank(1000);
  initTabs();
  initEvents();
  renderSlip();
  loadTab("live");
}

boot();
