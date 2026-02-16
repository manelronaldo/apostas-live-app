// js/app.js (COMPLETO) — pronto para GitHub Pages + Cloudflare Worker

const WORKER_URL = "https://apostas-live-api.manelronaldo1.workers.dev";

const ENDPOINTS = {
  live: "/live",
  pre: "/pre",
  multis: "/multis",
};

const $ = (id) => document.getElementById(id);

const els = {
  list: $("list"),
  detail: $("detail"),
  detailTitle: $("detailTitle"),
  detailBody: $("detailBody"),

  btnRefresh: $("btnRefresh"),
  btnCloseDetail: $("btnCloseDetail"),

  txtFilter: $("txtFilter"),
  selSort: $("selSort"),
  selOddsMode: $("selOddsMode"),

  slipCount: $("slipCount"),
  slipItems: $("slipItems"),
  stakeInput: $("stakeInput"),
  totalOdds: $("totalOdds"),
  estReturn: $("estReturn"),
  bankAmount: $("bankAmount"),
  btnPlace: $("btnPlace"),
};

let state = {
  tab: "live",
  raw: null,
  games: [],
  selected: null,
  slip: [],
  bank: 1000.0,
};

// ---------- STORAGE ----------
function loadBank() {
  const v = localStorage.getItem("bank");
  if (v) state.bank = Number(v) || 1000;
  els.bankAmount.textContent = state.bank.toFixed(2);
}
function saveBank() {
  localStorage.setItem("bank", String(state.bank));
  els.bankAmount.textContent = state.bank.toFixed(2);
}

function loadSlip() {
  try {
    const v = localStorage.getItem("slip");
    if (v) state.slip = JSON.parse(v) || [];
  } catch {
    state.slip = [];
  }
}
function saveSlip() {
  localStorage.setItem("slip", JSON.stringify(state.slip));
}

// ---------- API PARSING (AQUI ESTÁ A CORREÇÃO) ----------
function extractMatches(data) {
  // Worker devolve: { count, results:[ {league_name,country:{name}, stage:[{stage_name,matches:[...] }]} ] }
  try {
    const leagues = Array.isArray(data?.results) ? data.results : [];
    const matches = leagues
      .flatMap((l) => {
        const stages = Array.isArray(l?.stage) ? l.stage : [];
        return stages.flatMap((s) => {
          const ms = Array.isArray(s?.matches) ? s.matches : [];
          return ms.map((m) => ({
            ...m,
            _league_name: l?.league_name ?? "",
            _country: l?.country?.name ?? "",
            _stage_name: s?.stage_name ?? "",
            _league_id: l?.league_id ?? null,
          }));
        });
      })
      .filter(Boolean);

    return matches;
  } catch (e) {
    console.error("Erro a extrair matches:", e);
    return [];
  }
}

// ---------- HELPERS ----------
function norm(s) {
  return String(s ?? "").toLowerCase().trim();
}

function gameTitle(g) {
  const home = g?.teams?.home?.name ?? "Casa";
  const away = g?.teams?.away?.name ?? "Fora";
  return `${home} vs ${away}`;
}

function gameLeagueLine(g) {
  const league = g?._stage_name || g?._league_name || "Liga";
  const country = g?._country ? ` (${g._country})` : "";
  return `${league}${country}`;
}

function gameTimeLine(g) {
  const date = g?.date ?? "";
  const time = g?.time ?? "";
  const minute = g?.minute ?? "-";
  const status = g?.status ?? "";
  return `Data/Hora: ${date} ${time} • Min: ${minute} • ${status}`;
}

function getMarketOdds(g, mode) {
  // Se o Worker trouxer odds em g.odds.match_winner / over_under etc, tentamos usar.
  // Se não, simulamos odds para testar a app.
  if (mode === "api") {
    const mw = g?.odds?.match_winner;
    if (mw && (mw.home || mw.draw || mw.away)) {
      return {
        label: "1X2",
        home: mw.home ?? null,
        draw: mw.draw ?? null,
        away: mw.away ?? null,
      };
    }
  }

  // Simulação (leve e realista)
  const seed = (g?.id ?? 0) + (g?._league_id ?? 0);
  const r = (x) => {
    const t = Math.sin(seed * 999 + x) * 10000;
    return t - Math.floor(t);
  };
  const home = (1.6 + r(1) * 1.6).toFixed(2);
  const draw = (2.8 + r(2) * 1.8).toFixed(2);
  const away = (1.6 + r(3) * 1.6).toFixed(2);

  return { label: "1X2 (sim)", home, draw, away };
}

function edgeBadge(score) {
  // score 0..100 -> cor
  if (score >= 75) return { cls: "good", txt: "Boa" };
  if (score >= 55) return { cls: "warn", txt: "Média" };
  return { cls: "bad", txt: "Fraca" };
}

function computeEdge(g) {
  // Heurística simples para já (depois refinamos com estatísticas reais)
  // Se estiver ao vivo e minuto alto, aumenta um pouco
  const m = Number(g?.minute);
  const base = 40 + (((g?.id ?? 0) % 60) * 0.6); // 40..76
  const liveBoost = Number.isFinite(m) && m > 0 ? Math.min(18, m * 0.25) : 0;
  return Math.max(0, Math.min(100, Math.round(base + liveBoost)));
}

// ---------- RENDER ----------
function renderList() {
  const q = norm(els.txtFilter.value);

  let items = [...state.games];

  // filtro
  if (q) {
    items = items.filter((g) => {
      const a = norm(gameTitle(g));
      const b = norm(gameLeagueLine(g));
      return a.includes(q) || b.includes(q);
    });
  }

  // ordenar
  const sort = els.selSort.value;
  if (sort === "league") {
    items.sort((a, b) => norm(gameLeagueLine(a)).localeCompare(norm(gameLeagueLine(b))));
  } else if (sort === "edge") {
    items.sort((a, b) => computeEdge(b) - computeEdge(a));
  } else {
    // time: usa date+time se existir
    items.sort((a, b) => {
      const A = `${a?.date ?? ""} ${a?.time ?? ""}`;
      const B = `${b?.date ?? ""} ${b?.time ?? ""}`;
      return A.localeCompare(B);
    });
  }

  if (!items.length) {
    els.list.innerHTML = `<div class="hint">Sem jogos para mostrar. (Confirma o filtro ou o endpoint)</div>`;
    return;
  }

  els.list.innerHTML = items
    .map((g) => {
      const edge = computeEdge(g);
      const badge = edgeBadge(edge);
      const odds = getMarketOdds(g, els.selOddsMode.value);

      return `
        <div class="card" data-id="${g.id}">
          <div class="row">
            <div class="league">${escapeHtml(gameLeagueLine(g))}</div>
            <div class="badge badge-${badge.cls}">${badge.txt} • ${edge}%</div>
          </div>

          <div class="teams">${escapeHtml(gameTitle(g))}</div>
          <div class="meta">${escapeHtml(gameTimeLine(g))}</div>

          <div class="row" style="margin-top:10px; gap:8px; flex-wrap:wrap;">
            <button class="btn pick" data-pick="HOME" data-odd="${odds.home}">Casa ${odds.home ?? "-"}</button>
            <button class="btn pick" data-pick="DRAW" data-odd="${odds.draw}">Empate ${odds.draw ?? "-"}</button>
            <button class="btn pick" data-pick="AWAY" data-odd="${odds.away}">Fora ${odds.away ?? "-"}</button>
          </div>
        </div>
      `;
    })
    .join("");

  // clicar no card abre detalhe
  els.list.querySelectorAll(".card").forEach((card) => {
    card.addEventListener("click", (e) => {
      // se clicou num botão pick, não abrir detalhe automaticamente (mas pode abrir se quiseres)
      if (e.target?.classList?.contains("pick")) return;

      const id = card.getAttribute("data-id");
      const g = state.games.find((x) => String(x.id) === String(id));
      if (g) openDetail(g);
    });
  });

  // picks
  els.list.querySelectorAll(".pick").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const card = btn.closest(".card");
      const id = card.getAttribute("data-id");
      const g = state.games.find((x) => String(x.id) === String(id));
      if (!g) return;

      const pick = btn.getAttribute("data-pick");
      const odd = Number(btn.getAttribute("data-odd"));
      if (!odd || !Number.isFinite(odd)) return;

      addToSlip(g, pick, odd);
    });
  });
}

function openDetail(g) {
  state.selected = g;

  const edge = computeEdge(g);
  const badge = edgeBadge(edge);

  els.detailTitle.textContent = gameTitle(g);

  // mostra um resumo + JSON do jogo (para debug)
  els.detailBody.innerHTML = `
    <div class="row" style="margin-bottom:10px;">
      <div class="league">${escapeHtml(gameLeagueLine(g))}</div>
      <div class="badge badge-${badge.cls}">${badge.txt} • ${edge}%</div>
    </div>

    <div class="meta">${escapeHtml(gameTimeLine(g))}</div>

    <div style="margin-top:12px;">
      <div class="hint">
        (Próximo passo) Aqui vamos meter: cantos, remates, amarelos, 1ª parte/2ª parte, 90min e o “porquê” do prognóstico.
      </div>
    </div>

    <details style="margin-top:12px;">
      <summary style="cursor:pointer;">Ver dados do jogo (debug)</summary>
      <pre style="white-space:pre-wrap;word-break:break-word;">${escapeHtml(JSON.stringify(g, null, 2))}</pre>
    </details>
  `;

  // garante que a sidebar aparece
  els.detail.style.display = "";
}

function closeDetail() {
  state.selected = null;
  els.detailTitle.textContent = "Seleciona um jogo";
  els.detailBody.innerHTML = `<div class="hint">Clica num jogo para abrir detalhes, estatísticas e prognósticos.</div>`;
}

// ---------- BETSLIP ----------
function addToSlip(g, pick, odd) {
  const key = `${g.id}-${pick}`;
  const exists = state.slip.find((x) => x.key === key);
  if (exists) return;

  const item = {
    key,
    gameId: g.id,
    title: gameTitle(g),
    league: gameLeagueLine(g),
    pick,
    odd,
  };

  state.slip.push(item);
  saveSlip();
  renderSlip();
}

function removeFromSlip(key) {
  state.slip = state.slip.filter((x) => x.key !== key);
  saveSlip();
  renderSlip();
}

function renderSlip() {
  els.slipCount.textContent = `${state.slip.length} seleções`;

  if (!state.slip.length) {
    els.slipItems.innerHTML = `<div class="hint">Sem seleções</div>`;
    els.totalOdds.textContent = "1.00";
    els.estReturn.textContent = "0.00";
    return;
  }

  els.slipItems.innerHTML = state.slip
    .map((x) => {
      return `
        <div class="slip-item" style="display:flex;gap:10px;align-items:center;">
          <div style="min-width:220px;">
            <div style="font-weight:800;">${escapeHtml(x.title)}</div>
            <div class="meta">${escapeHtml(x.pick)} • Odd ${x.odd.toFixed(2)}</div>
          </div>
          <button class="btn ghost" data-remove="${x.key}">X</button>
        </div>
      `;
    })
    .join("");

  els.slipItems.querySelectorAll("[data-remove]").forEach((b) => {
    b.addEventListener("click", () => removeFromSlip(b.getAttribute("data-remove")));
  });

  const totalOdds = state.slip.reduce((acc, x) => acc * Number(x.odd), 1);
  els.totalOdds.textContent = totalOdds.toFixed(2);

  const stake = Number(els.stakeInput.value) || 0;
  els.estReturn.textContent = (stake * totalOdds).toFixed(2);
}

// ---------- LOAD DATA ----------
async function fetchTab(tab) {
  const path = ENDPOINTS[tab] || ENDPOINTS.live;
  const url = `${WORKER_URL}${path}`;

  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Erro HTTP ${res.status}`);
  const data = await res.json();
  return data;
}

async function refresh() {
  els.list.innerHTML = `<div class="hint">A carregar...</div>`;
  closeDetail();

  try {
    const data = await fetchTab(state.tab);
    state.raw = data;
    state.games = extractMatches(data);

    renderList();
  } catch (e) {
    console.error(e);
    els.list.innerHTML = `<div class="hint">Erro a carregar jogos. Confirma o Worker e o endpoint (${state.tab}).</div>`;
  }
}

// ---------- TABS ----------
function setTab(tab) {
  state.tab = tab;

  document.querySelectorAll(".tab").forEach((t) => {
    t.classList.toggle("active", t.getAttribute("data-tab") === tab);
  });

  refresh();
}

// ---------- HTML SAFE ----------
function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// ---------- INIT ----------
function bindEvents() {
  // tabs
  document.querySelectorAll(".tab").forEach((t) => {
    t.addEventListener("click", () => setTab(t.getAttribute("data-tab")));
  });

  els.btnRefresh.addEventListener("click", refresh);
  els.btnCloseDetail.addEventListener("click", closeDetail);

  els.txtFilter.addEventListener("input", renderList);
  els.selSort.addEventListener("change", renderList);
  els.selOddsMode.addEventListener("change", renderList);

  els.stakeInput.addEventListener("input", renderSlip);

  els.btnPlace.addEventListener("click", () => {
    const stake = Number(els.stakeInput.value) || 0;
    if (!state.slip.length) return alert("Seleciona pelo menos 1 aposta.");
    if (stake <= 0) return alert("Stake inválida.");
    if (stake > state.bank) return alert("Banca insuficiente.");

    // tira da banca
    state.bank -= stake;
    saveBank();

    // limpa slip
    state.slip = [];
    saveSlip();
    renderSlip();

    alert("Aposta registada ✅ (modo demo)");
  });
}

loadBank();
loadSlip();
bindEvents();
renderSlip();
setTab("live");
