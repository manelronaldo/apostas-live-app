const WORKER_URL = "https://apostas-live-api.manelronaldo1.workers.dev";

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
  games: [],
  selected: null,
  slip: [],
  bank: 1000,
};

function fmtMoney(n) {
  return Number(n || 0).toFixed(2);
}

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

function impliedProbFromOdds(odds) {
  const o = Number(odds);
  if (!o || o <= 1) return null;
  return 1 / o;
}

// score 0..1
function edgeScore(modelProb, odds) {
  const p = Number(modelProb);
  const ip = impliedProbFromOdds(odds);
  if (ip == null) return 0.0;
  // vantagem = p - prob implícita
  const diff = p - ip;
  // normaliza para 0..1 (diff -0.15..+0.15)
  return clamp((diff + 0.15) / 0.30, 0, 1);
}

function gradeFromScore(s) {
  // cores: vermelho < amarelo < azul < verde
  if (s >= 0.75) return { label: "Boa", cls: "good" };      // verde
  if (s >= 0.55) return { label: "Ok", cls: "blue" };       // azul
  if (s >= 0.40) return { label: "Arriscada", cls: "warn" };// amarelo
  return { label: "Fraca", cls: "bad" };                    // vermelho
}

async function api(path, opts = {}) {
  const r = await fetch(`${WORKER_URL}${path}`, {
    credentials: "include",
    ...opts,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = data?.error || `Erro ${r.status}`;
    throw new Error(msg);
  }
  return data;
}

// ---------- LOGIN UI ----------
async function ensureLogin() {
  // tenta ver se já está logado
  try {
    const me = await api("/auth/me");
    if (me.authed) return true;
  } catch (e) {}

  // prompt simples (mobile-friendly)
  const pass = prompt("Password para entrar na app:");
  if (!pass) throw new Error("Login cancelado.");

  await api("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: pass }),
  });

  return true;
}

// ---------- LOAD ----------
async function loadLive() {
  const data = await api("/live");
  // esperas: {count, results:[...]}
  return data?.results || [];
}

// Para já, “pré-jogo” vamos usar o live (porque no teu worker já tens dados pre-match também).
async function loadPre() {
  // Se quiseres, depois passamos ?date=YYYY-MM-DD no /pre
  try {
    const data = await api("/pre");
    return data?.results || [];
  } catch {
    // fallback: live
    const live = await loadLive();
    return live;
  }
}

function normalizeGames(rawList) {
  return rawList.map((g) => {
    const league = g?.league_name || g?.league?.name || "Liga";
    const country = g?.country?.name || g?.league?.country?.name || g?.country || "";
    const stage = g?.stage?.stage_name || g?.stage_name || "";
    const home = g?.teams?.home?.name || g?.home?.name || "Casa";
    const away = g?.teams?.away?.name || g?.away?.name || "Fora";
    const date = g?.date || "";
    const time = g?.time || "";
    const minute = g?.minute ?? g?.status?.minute ?? "-";
    const status = g?.status || g?.status_name || "";
    const match_id = g?.match_id || g?.id || g?.match?.id;

    // odds (se existirem) -> se não, simulamos
    const odds = g?.odds || null;

    return {
      raw: g,
      match_id,
      league,
      country,
      stage,
      home,
      away,
      date,
      time,
      minute,
      status,
      odds,
    };
  });
}

function textMatch(g, q) {
  const s = `${g.league} ${g.country} ${g.home} ${g.away}`.toLowerCase();
  return s.includes(q.toLowerCase());
}

// ---------- RENDER LIST ----------
function render() {
  // filtro
  const q = (els.txtFilter.value || "").trim();
  let list = [...state.games];
  if (q) list = list.filter((g) => textMatch(g, q));

  // ordenar
  const sort = els.selSort.value;
  if (sort === "league") {
    list.sort((a, b) => (a.league || "").localeCompare(b.league || ""));
  } else if (sort === "edge") {
    // ordena por “melhor aposta” (score do preview + odds 1X2)
    list.sort((a, b) => (b._score ?? 0) - (a._score ?? 0));
  } else {
    list.sort((a, b) => (a.time || "").localeCompare(b.time || ""));
  }

  els.list.innerHTML = "";
  for (const g of list) {
    els.list.appendChild(renderCard(g));
  }

  renderSlip();
  els.bankAmount.textContent = fmtMoney(state.bank);
}

function pickOdds(g) {
  // 1X2 se vier da API: odds.match_winner.home/draw/away
  const mode = els.selOddsMode.value;
  const o = g.raw?.odds?.match_winner;

  if (mode === "api" && o) {
    return {
      home: Number(o.home) || null,
      draw: Number(o.draw) || null,
      away: Number(o.away) || null,
    };
  }

  // simular
  const base = 1.8 + Math.random() * 1.8;
  return {
    home: Number((base).toFixed(2)),
    draw: Number((base + 0.6).toFixed(2)),
    away: Number((base + 1.1).toFixed(2)),
  };
}

function renderCard(g) {
  const card = document.createElement("div");
  card.className = "card";
  card.addEventListener("click", () => openDetail(g));

  const odds = pickOdds(g);

  // badge com score
  const sc = g._score ?? 0.5;
  const grade = gradeFromScore(sc);

  card.innerHTML = `
    <div class="row">
      <div>
        <div class="league">${escapeHtml(g.league)} ${g.country ? `(${escapeHtml(g.country)})` : ""}</div>
        <div class="teams">${escapeHtml(g.home)} vs ${escapeHtml(g.away)}</div>
        <div class="meta">Data/Hora: ${escapeHtml(g.date)} ${escapeHtml(g.time)} • Min: ${escapeHtml(String(g.minute))} • ${escapeHtml(String(g.raw?.status_name || g.status || ""))}</div>
      </div>
      <div class="badge ${grade.cls}">${grade.label} • ${(sc * 100).toFixed(0)}%</div>
    </div>

    <div class="oddsRow">
      <button class="oddBtn" data-pick="home">Casa ${odds.home ?? "-"}</button>
      <button class="oddBtn" data-pick="draw">Empate ${odds.draw ?? "-"}</button>
      <button class="oddBtn" data-pick="away">Fora ${odds.away ?? "-"}</button>
    </div>
  `;

  // evitar que clicar em odd abra detalhe (só adiciona ao boletim)
  card.querySelectorAll(".oddBtn").forEach((btn) => {
    btn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const pick = btn.getAttribute("data-pick");
      const oddVal = odds[pick];
      if (!oddVal) return;

      addToSlip(g, pick, oddVal);
    });
  });

  return card;
}

// ---------- DETAIL ----------
async function openDetail(g) {
  state.selected = g;
  els.detailTitle.textContent = `${g.home} vs ${g.away}`;
  els.detailBody.innerHTML = `<div class="hint">A carregar dados do jogo...</div>`;

  try {
    const [match, preview] = await Promise.all([
      api(`/match?match_id=${encodeURIComponent(g.match_id)}`),
      api(`/preview?match_id=${encodeURIComponent(g.match_id)}`),
    ]);

    const model = extractModel(preview, match);
    // guarda score para ordenar “edge”
    g._score = model.score;

    els.detailBody.innerHTML = renderDetailHtml(g, match, preview, model);
    wireDetailInputs(model);
    render();
  } catch (e) {
    els.detailBody.innerHTML = `<div class="hint">Erro: ${escapeHtml(e.message)}</div>`;
  }

  els.detail.classList.add("open");
}

function extractModel(preview, match) {
  // Modelo simples (não “milagroso”):
  // usa excitement_rating (0..10) e prediction (se existir) para dar prob.
  const excitement = Number(preview?.match_data?.excitement_rating ?? preview?.match_data?.excitement ?? 5);
  const p = preview?.match_data?.prediction?.choice || "";
  const type = preview?.match_data?.prediction?.type || "";

  // base prob 0.50 + (excitement - 5)/20
  let prob = clamp(0.50 + (excitement - 5) / 20, 0.35, 0.70);

  let reason = [];
  reason.push(`Ex. rating: ${isFinite(excitement) ? excitement.toFixed(2) : "?"}/10`);

  if (type && p) {
    reason.push(`Previsão API: ${p} (${type})`);
    // se a API diz “Home Win/…”, empurra um pouco
    if (/win/i.test(p)) prob = clamp(prob + 0.05, 0.35, 0.78);
  }

  // em live, se existirem stats no match (nem sempre), podias reforçar (cantos/remates etc.)
  // (fica pronto para evoluir)

  const score = clamp((prob - 0.40) / 0.30, 0, 1); // 0..1
  return { prob, score, reason: reason.join(" • ") };
}

function renderDetailHtml(g, match, preview, model) {
  return `
    <div class="detailBlock">
      <div class="row">
        <div>
          <div class="league">${escapeHtml(g.league)} ${g.country ? `(${escapeHtml(g.country)})` : ""}</div>
          <div class="meta">Data/Hora: ${escapeHtml(g.date)} ${escapeHtml(g.time)} • Min: ${escapeHtml(String(g.minute))} • ${escapeHtml(String(g.raw?.status_name || g.status || ""))}</div>
        </div>
        <div class="badge ${gradeFromScore(model.score).cls}">
          ${gradeFromScore(model.score).label} • ${(model.score * 100).toFixed(0)}%
        </div>
      </div>

      <div class="hint">
        <b>Porque:</b> ${escapeHtml(model.reason)}
      </div>

      <hr class="sep"/>

      <div class="grid2">
        <div class="miniCard">
          <div class="miniTitle">Odds da casa (22Bet)</div>
          <div class="miniText">Mete a tua odd real e eu comparo com o “modelo”.</div>
          <div class="miniRow">
            <input id="odd22" placeholder="ex: 1.85" inputmode="decimal" />
            <button class="btn primary" id="btnCheckOdd">Ver se compensa</button>
          </div>
          <div id="oddResult" class="miniResult"></div>
        </div>

        <div class="miniCard">
          <div class="miniTitle">Prognóstico rápido</div>
          <div class="miniText">
            Prob. estimada (modelo): <b>${(model.prob * 100).toFixed(1)}%</b><br/>
            (Isto é um indicador estatístico — não garante ganhos.)
          </div>
        </div>
      </div>

      <hr class="sep"/>

      <details>
        <summary><b>Ver dados do jogo (debug)</b></summary>
        <pre class="pre">${escapeHtml(JSON.stringify(match, null, 2))}</pre>
        <pre class="pre">${escapeHtml(JSON.stringify(preview, null, 2))}</pre>
      </details>
    </div>
  `;
}

function wireDetailInputs(model) {
  const btn = document.getElementById("btnCheckOdd");
  const inp = document.getElementById("odd22");
  const out = document.getElementById("oddResult");
  if (!btn || !inp || !out) return;

  btn.onclick = () => {
    const odd = Number(String(inp.value || "").replace(",", "."));
    if (!odd || odd <= 1) {
      out.innerHTML = `<span class="badTxt">Mete uma odd válida (ex: 1.85)</span>`;
      return;
    }

    const s = edgeScore(model.prob, odd);
    const grade = gradeFromScore(s);
    const implied = impliedProbFromOdds(odd);

    out.innerHTML = `
      <div class="badge ${grade.cls}">${grade.label}</div>
      <div class="miniText">
        Odd: <b>${odd.toFixed(2)}</b> • Prob. implícita: <b>${(implied * 100).toFixed(1)}%</b><br/>
        Prob. modelo: <b>${(model.prob * 100).toFixed(1)}%</b><br/>
        <b>Diferença:</b> ${(model.prob - implied >= 0 ? "+" : "")}${((model.prob - implied) * 100).toFixed(1)}%
      </div>
    `;
  };
}

// ---------- BETSLIP ----------
function addToSlip(game, pick, odds) {
  const id = `${game.match_id}:${pick}`;
  const exists = state.slip.some((s) => s.id === id);
  if (exists) return;

  state.slip.push({
    id,
    match_id: game.match_id,
    label: `${game.home} vs ${game.away} • ${pick.toUpperCase()}`,
    odds: Number(odds),
  });

  renderSlip();
}

function removeFromSlip(id) {
  state.slip = state.slip.filter((s) => s.id !== id);
  renderSlip();
}

function renderSlip() {
  els.slipCount.textContent = `${state.slip.length} seleções`;
  els.slipItems.innerHTML = "";

  let total = 1;
  for (const s of state.slip) {
    total *= Number(s.odds || 1);

    const item = document.createElement("div");
    item.className = "slipItem";
    item.innerHTML = `
      <div class="slipLabel">${escapeHtml(s.label)}</div>
      <div class="slipOdd">${Number(s.odds).toFixed(2)}</div>
      <button class="slipRemove" title="remover">×</button>
    `;
    item.querySelector(".slipRemove").onclick = () => removeFromSlip(s.id);
    els.slipItems.appendChild(item);
  }

  els.totalOdds.textContent = total.toFixed(2);

  const stake = Number(els.stakeInput.value || 0);
  els.estReturn.textContent = fmtMoney(stake * total);
}

els.stakeInput.addEventListener("input", renderSlip);

els.btnPlace.addEventListener("click", () => {
  const stake = Number(els.stakeInput.value || 0);
  if (state.slip.length === 0) return alert("Sem seleções.");
  if (!stake || stake <= 0) return alert("Stake inválida.");
  if (stake > state.bank) return alert("Banca insuficiente.");

  state.bank = Number((state.bank - stake).toFixed(2));
  state.slip = [];
  render();
  alert("Aposta registada (simulação).");
});

// ---------- TABS ----------
document.querySelectorAll(".tab").forEach((b) => {
  b.addEventListener("click", async () => {
    document.querySelectorAll(".tab").forEach((x) => x.classList.remove("active"));
    b.classList.add("active");
    state.tab = b.dataset.tab;
    await refresh();
  });
});

els.btnCloseDetail.addEventListener("click", () => {
  els.detail.classList.remove("open");
});

els.btnRefresh.addEventListener("click", refresh);
els.txtFilter.addEventListener("input", render);
els.selSort.addEventListener("change", render);
els.selOddsMode.addEventListener("change", render);

// ---------- REFRESH ----------
async function refresh() {
  els.list.innerHTML = `<div class="hint">A carregar...</div>`;
  els.detail.classList.remove("open");

  const raw = state.tab === "pre" ? await loadPre() : await loadLive();
  state.games = normalizeGames(raw);

  // dá score base (para badge) mesmo antes do preview
  state.games.forEach((g) => (g._score = 0.55 + Math.random() * 0.15));
  render();
}

// ---------- UTIL ----------
function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// ---------- BOOT ----------
(async function boot() {
  // banca inicial
  const saved = localStorage.getItem("bank");
  if (saved) state.bank = Number(saved) || 1000;

  // persist banca
  setInterval(() => {
    localStorage.setItem("bank", String(state.bank));
  }, 1000);

  await ensureLogin();
  await refresh();
})();

