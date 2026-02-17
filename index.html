// ==========================
// CONFIG
// ==========================
const WORKER_URL = "https://apostas-live-api.manelronaldo1.workers.dev"; // o teu Worker

// Endpoints no Worker (já tens /live a funcionar)
const ENDPOINTS = {
  live: "/live",
  pre: "/live",     // fallback: se ainda não tens /pre, usa /live (tu mudas depois no Worker)
  multis: "/live",  // fallback
};

// ==========================
// HELPERS
// ==========================
const $ = (id) => document.getElementById(id);

const els = {
  status: $("status"),
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
  games: [],
  selected: null,
  slip: [],
  bank: 1000.00,
};

function setStatus(msg) {
  els.status.textContent = msg || "";
}

function round2(n) {
  return (Math.round(n * 100) / 100).toFixed(2);
}

function safeNumber(x, fallback = 0) {
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
}

// ==========================
// AUTH (password)
// ==========================
//
// IMPORTANTE:
// - NÃO metas a SoccerDataAPI key no front-end.
// - A password da APP (APOSTAS2026) fica no Worker (env APP_PASSWORD).
// - O front-end só envia a password ao Worker para ele deixar passar.
//
// Como não sabemos 100% como o teu Worker valida,
// mando em 2 formatos para maximizar compatibilidade:
// 1) header: x-app-password
// 2) querystring: ?pw=...
//
const STORAGE_PW = "APP_PW";

function getPw() {
  return localStorage.getItem(STORAGE_PW) || "";
}

async function ensurePw() {
  let pw = getPw();
  if (!pw) {
    pw = prompt("Password para entrar na app:");
    if (!pw) throw new Error("Sem password.");
    localStorage.setItem(STORAGE_PW, pw);
  }
  return pw;
}

async function fetchJSON(path) {
  const pw = await ensurePw();

  const url = new URL(WORKER_URL + path);
  url.searchParams.set("pw", pw); // fallback

  const res = await fetch(url.toString(), {
    headers: {
      "accept": "application/json",
      "x-app-password": pw, // principal
    },
  });

  if (res.status === 401 || res.status === 403) {
    // password errada → limpa e pede outra
    localStorage.removeItem(STORAGE_PW);
    throw new Error("Password errada (401/403).");
  }

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Erro ${res.status}: ${txt.slice(0, 120)}`);
  }

  return res.json();
}

// ==========================
// DATA NORMALIZATION
// ==========================
function normalizeGames(payload) {
  // O teu /live devolve algo tipo: { count: X, results: [...] }
  const arr = payload?.results || payload?.data || payload || [];
  const games = Array.isArray(arr) ? arr : [];

  return games.map((g) => {
    const league = g.league_name || g.league?.name || "Liga";
    const country = g.country?.name || g.country || "";
    const home = g.teams?.home?.name || g.home_name || "Casa";
    const away = g.teams?.away?.name || g.away_name || "Fora";
    const date = g.date || "";
    const time = g.time || "";
    const minute = safeNumber(g.minute, -1);

    // odds (pode existir no payload)
    const o = g.odds || {};
    const apiOdds = {
      home: safeNumber(o.match_winner?.home, 0),
      draw: safeNumber(o.match_winner?.draw, 0),
      away: safeNumber(o.match_winner?.away, 0),
      ou_over: safeNumber(o.over_under?.over, 0),
      ou_under: safeNumber(o.over_under?.under, 0),
      ou_total: safeNumber(o.over_under?.total, 0),
    };

    return {
      raw: g,
      id: g.match_id || g.id || `${league}-${home}-${away}-${date}-${time}`,
      league,
      country,
      home,
      away,
      date,
      time,
      minute,
      status: g.status || (minute >= 0 ? "live" : "pre"),
      apiOdds,
    };
  });
}

// ==========================
// EDGE / PROB (simples, para começar)
//
// NOTA:
// Isto NÃO garante lucro. É só um "indicador".
// Para ficar sério, tens de treinar/validar modelo com histórico.
// ==========================
function estimateProb(game) {
  // heurística simples:
  // - se API traz excitement_rating -> usa como base
  // - caso contrário, usa 0.50 e ajusta ligeiro por minute
  const r = safeNumber(game.raw?.excitement_rating, 0);
  let p = 0.50;

  if (r > 0) {
    // ratings tipo 0-10 -> normaliza
    p = Math.min(0.90, Math.max(0.10, r / 10));
  }

  // se jogo já começou, ajusta ligeiramente (só para demo)
  if (game.minute >= 0) {
    p = Math.min(0.92, Math.max(0.08, p + 0.03));
  }

  return p;
}

function gradeFromProb(p) {
  // cores: verde/azul/amarelo/vermelho (verde melhor)
  if (p >= 0.70) return { label: `Alta • ${(p*100).toFixed(0)}%`, cls: "good" };
  if (p >= 0.60) return { label: `Boa • ${(p*100).toFixed(0)}%`, cls: "good" };
  if (p >= 0.52) return { label: `Média • ${(p*100).toFixed(0)}%`, cls: "warn" };
  return { label: `Baixa • ${(p*100).toFixed(0)}%`, cls: "bad" };
}

function impliedProbFromOdd(odd) {
  // prob implícita = 1/odd
  if (!odd || odd <= 1) return 0;
  return 1 / odd;
}

function valueScore(p, odd) {
  // value = p*odd - 1 (positivo = teoricamente “valor”)
  if (!odd || odd <= 1) return -1;
  return (p * odd) - 1;
}

// ==========================
// UI RENDER
// ==========================
function renderList() {
  const filter = (els.txtFilter.value || "").trim().toLowerCase();
  const sort = els.selSort.value;

  let items = [...state.games];

  if (filter) {
    items = items.filter(g =>
      `${g.league} ${g.home} ${g.away} ${g.country}`.toLowerCase().includes(filter)
    );
  }

  // sort
  items.sort((a, b) => {
    if (sort === "league") return (a.league || "").localeCompare(b.league || "");
    if (sort === "edge") {
      const pa = estimateProb(a);
      const pb = estimateProb(b);
      return pb - pa;
    }
    // time default
    return (`${a.date} ${a.time}`).localeCompare(`${b.date} ${b.time}`);
  });

  els.list.innerHTML = "";

  if (!items.length) {
    els.list.innerHTML = `<div class="hint">Sem jogos (ou falhou a autenticação / API).</div>`;
    return;
  }

  for (const g of items) {
    const p = estimateProb(g);
    const grade = gradeFromProb(p);

    const card = document.createElement("div");
    card.className = "card";
    card.onclick = () => openDetail(g);

    const minuteText = g.minute >= 0 ? `${g.minute}'` : "pre-match";
    const when = `${g.date || ""} ${g.time || ""} • Min: ${g.minute} • ${minuteText}`.replace(/\s+/g, " ").trim();

    // odds: API se existir, senão simulação
    const oddsMode = els.selOddsMode.value;
    const odds = getDisplayOdds(g, oddsMode);

    card.innerHTML = `
      <div class="row">
        <div class="league">${escapeHtml(g.league)} <span style="color:var(--muted);font-weight:800">(${escapeHtml(g.country || "")})</span></div>
        <div class="badge ${grade.cls}">${grade.label}</div>
      </div>

      <div class="teams">${escapeHtml(g.home)} <span style="color:var(--muted)">vs</span> ${escapeHtml(g.away)}</div>
      <div class="meta">${escapeHtml(when)}</div>

      <div class="odds">
        <button class="oddBtn" data-pick="home">
          Casa ${round2(odds.home)}
          <small>Vitória</small>
        </button>
        <button class="oddBtn" data-pick="draw">
          Empate ${round2(odds.draw)}
          <small>X</small>
        </button>
        <button class="oddBtn" data-pick="away">
          Fora ${round2(odds.away)}
          <small>Vitória</small>
        </button>
      </div>
    `;

    // add handlers odds
    card.querySelectorAll(".oddBtn").forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const pick = btn.getAttribute("data-pick");
        addToSlip(g, pick, odds[pick], p);
      });
    });

    els.list.appendChild(card);
  }
}

function getDisplayOdds(game, mode) {
  const o = game.apiOdds || {};
  const hasApi = o.home > 1 && o.draw > 1 && o.away > 1;

  if (mode === "api" && hasApi) {
    return { home: o.home, draw: o.draw, away: o.away };
  }

  // simulação (para testar UI)
  const base = 1.8 + Math.random() * 1.6;
  const home = base;
  const draw = 2.8 + Math.random() * 0.8;
  const away = 2.0 + Math.random() * 1.8;
  return { home, draw, away };
}

function openDetail(game) {
  state.selected = game;
  const p = estimateProb(game);
  const grade = gradeFromProb(p);

  els.detailTitle.textContent = `${game.home} vs ${game.away}`;

  const minuteText = game.minute >= 0 ? `${game.minute}'` : "pre-match";

  els.detailBody.innerHTML = `
    <div class="row" style="margin-bottom:10px">
      <div>
        <div class="league">${escapeHtml(game.league)} <span style="color:var(--muted);font-weight:800">(${escapeHtml(game.country || "")})</span></div>
        <div class="meta">Data/Hora: ${escapeHtml(game.date || "")} ${escapeHtml(game.time || "")} • Min: ${game.minute} • ${minuteText}</div>
      </div>
      <div class="badge ${grade.cls}">${grade.label}</div>
    </div>

    <div class="hint">
      (Próximo passo) Para cantos/remates/amarelos 1ª parte / 2ª parte / 90min:
      isso tem de vir de um endpoint de estatísticas no Worker (ou outra API).  
      Assim que me disseres qual endpoint tens no SoccerDataAPI para “match stats”, eu ligo aqui.
    </div>

    <div class="kv">
      <div class="box"><b>Prob. estimada</b><span>${(p*100).toFixed(0)}%</span></div>
      <div class="box"><b>Estado</b><span>${escapeHtml(game.status || "")}</span></div>
    </div>

    <div class="valueRow">
      <div class="field">
        <label>Odd tua (22Bet)</label>
        <input id="oddUser" type="number" step="0.01" min="1.01" placeholder="ex: 1.85" />
      </div>
      <button class="btn primary" id="btnCheckValue">Ver se compensa</button>
      <div id="valueOut" class="note"></div>
    </div>

    <details style="margin-top:12px">
      <summary style="cursor:pointer;font-weight:900">Ver dados do jogo (debug)</summary>
      <pre style="white-space:pre-wrap;color:var(--muted);font-size:12px">${escapeHtml(JSON.stringify(game.raw, null, 2))}</pre>
    </details>
  `;

  const btn = els.detailBody.querySelector("#btnCheckValue");
  const out = els.detailBody.querySelector("#valueOut");
  const oddInput = els.detailBody.querySelector("#oddUser");

  btn.onclick = () => {
    const odd = safeNumber(oddInput.value, 0);
    if (odd <= 1) {
      out.textContent = "Mete uma odd válida (ex: 1.85).";
      return;
    }

    const imp = impliedProbFromOdd(odd);
    const v = valueScore(p, odd);

    const tag =
      v >= 0.05 ? "🟢 Valor (teórico)" :
      v >= 0.00 ? "🔵 Marginal" :
      v >= -0.05 ? "🟡 Fraca" :
      "🔴 Não compensa";

    out.innerHTML = `
      <b>${tag}</b><br/>
      Prob. estimada: ${(p*100).toFixed(1)}% • Prob. implícita da odd: ${(imp*100).toFixed(1)}%<br/>
      Valor (p*odd - 1): <b>${(v*100).toFixed(1)}%</b><br/>
      <span style="color:var(--muted)">Nota: isto é só um indicador matemático. Não garante lucro.</span>
    `;
  };
}

// ==========================
// BETSLIP
// ==========================
function addToSlip(game, pick, odd, p) {
  const label = pick === "home" ? "Casa" : pick === "draw" ? "Empate" : "Fora";

  const item = {
    key: `${game.id}:${pick}`,
    match: `${game.home} vs ${game.away}`,
    pick: label,
    odd: safeNumber(odd, 1.01),
    p,
  };

  // toggle
  const idx = state.slip.findIndex(x => x.key === item.key);
  if (idx >= 0) state.slip.splice(idx, 1);
  else state.slip.push(item);

  renderSlip();
}

function renderSlip() {
  els.slipItems.innerHTML = "";

  if (!state.slip.length) {
    els.slipCount.textContent = "0 seleções";
    els.totalOdds.textContent = "1.00";
    els.estReturn.textContent = "0.00";
    return;
  }

  els.slipCount.textContent = `${state.slip.length} seleção(ões)`;

  let totalOdds = 1;
  for (const s of state.slip) totalOdds *= s.odd;

  const stake = safeNumber(els.stakeInput.value, 0);
  const estReturn = stake > 0 ? stake * totalOdds : 0;

  els.totalOdds.textContent = totalOdds.toFixed(2);
  els.estReturn.textContent = round2(estReturn);

  for (const s of state.slip) {
    const chip = document.createElement("div");
    chip.className = "slipChip";
    chip.innerHTML = `
      <span><b>${escapeHtml(s.pick)}</b> @ ${s.odd.toFixed(2)} <span style="color:var(--muted)">(${escapeHtml(s.match)})</span></span>
      <button title="Remover">×</button>
    `;
    chip.querySelector("button").onclick = () => {
      state.slip = state.slip.filter(x => x.key !== s.key);
      renderSlip();
    };
    els.slipItems.appendChild(chip);
  }
}

els.btnPlace.onclick = () => {
  const stake = safeNumber(els.stakeInput.value, 0);
  if (!state.slip.length) return alert("Sem seleções.");
  if (stake <= 0) return alert("Stake inválida.");

  if (stake > state.bank) return alert("Stake maior que a banca.");

  state.bank -= stake;
  els.bankAmount.textContent = round2(state.bank);
  alert("Aposta registada (simulada).");
  state.slip = [];
  renderSlip();
};

// ==========================
// LOAD
// ==========================
async function loadTab(tab) {
  state.tab = tab;
  setStatus("A carregar…");

  try {
    const path = ENDPOINTS[tab] || "/live";
    const payload = await fetchJSON(path);
    const games = normalizeGames(payload);
    state.games = games;

    setStatus(`Jogos: ${games.length} • Fonte: Worker + SoccerDataAPI`);
    renderList();
  } catch (err) {
    console.error(err);
    setStatus(`Erro: ${String(err.message || err)} (se for password, mete de novo e atualiza)`);
    els.list.innerHTML = `<div class="hint">Falhou o carregamento. Clica em “Atualizar”.</div>`;
  }
}

function bindTabs() {
  document.querySelectorAll(".tab").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      loadTab(btn.dataset.tab);
    });
  });
}

els.btnRefresh.onclick = () => loadTab(state.tab);
els.btnCloseDetail.onclick = () => {
  state.selected = null;
  els.detailTitle.textContent = "Seleciona um jogo";
  els.detailBody.innerHTML = `<div class="hint">Clica num jogo para abrir detalhes, estatísticas e prognósticos.</div>`;
};

els.txtFilter.addEventListener("input", () => renderList());
els.selSort.addEventListener("change", () => renderList());
els.selOddsMode.addEventListener("change", () => renderList());
els.stakeInput.addEventListener("input", () => renderSlip());

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

bindTabs();
renderSlip();
loadTab("live");
