// js/app.js (COMPLETO)
// App: Apostas Live — lista jogos (ao vivo/pré), múltiplas (betslip) e analisador de valor
// Requer no HTML IDs: list, detail, detailTitle, detailBody, btnRefresh, btnCloseDetail,
// txtFilter, selSort, selOddsMode, slipCount, slipItems, stakeInput, totalOdds, estReturn, bankAmount, btnPlace
// CSS: ./css/style.css

const WORKER_BASE = "https://apostas-live-api.manelronaldo1.workers.dev";
const ENDPOINTS = {
  live: "/live",   // já tens
  pre: "/live",    // fallback (porque a tua API está a devolver pre-match no /live)
  multis: "/live", // fallback
};

// ---------- Helpers ----------
const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function toNum(v, def = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function fmtOdd(v) {
  const n = toNum(v, 0);
  if (!n) return "-";
  return (Math.round(n * 100) / 100).toFixed(2);
}

function fmtMoney(v) {
  const n = toNum(v, 0);
  return (Math.round(n * 100) / 100).toFixed(2);
}

function safeText(s) {
  return (s ?? "").toString();
}

function normalizeMinute(m) {
  const n = toNum(m, -1);
  return n;
}

function badgeClass(score) {
  // score 0..100
  if (score >= 75) return "good";
  if (score >= 60) return "good"; // ainda bom
  if (score >= 45) return "warn";
  return "bad";
}

function labelFromScore(score) {
  if (score >= 80) return "Muito boa";
  if (score >= 70) return "Boa";
  if (score >= 55) return "Média";
  if (score >= 45) return "Arriscada";
  return "Má";
}

// ---------- State ----------
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

let activeTab = "live"; // live | pre | multis | bank
let games = [];
let selectedGame = null;

let slip = []; // { key, gameId, marketKey, label, odd, bookOdd, valueScore, reason }
let bank = 1000;

// ---------- Tabs ----------
function initTabs() {
  document.querySelectorAll(".tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      activeTab = btn.dataset.tab;
      render();
      closeDetail();
    });
  });
}

// ---------- Fetch ----------
async function fetchJSON(path) {
  const url = `${WORKER_BASE}${path}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Erro a buscar ${url}: ${res.status}`);
  return res.json();
}

async function loadData() {
  const endpoint = ENDPOINTS[activeTab] || ENDPOINTS.live;
  const data = await fetchJSON(endpoint);

  // Esperado: { count, results: [...] }
  games = Array.isArray(data?.results) ? data.results : [];
  render();
}

// ---------- Data mapping ----------
function mapGame(raw) {
  // A tua API tem este formato (pelo print):
  // league_name, country{name}, stage{matches:[{id,date,time,teams{home{name},away{name}}, status, minute, odds{match_winner{home,draw,away}} ... }]}
  // Alguns já vêm "achatados" (depende do teu worker). Vamos tentar suportar os dois.
  if (raw?.teams && raw?.league_name) {
    // já achatado
    const home = raw?.teams?.home?.name ?? "Casa";
    const away = raw?.teams?.away?.name ?? "Fora";
    const league = raw?.league_name ?? "-";
    const country = raw?.country?.name ?? raw?.country ?? "";
    const minute = normalizeMinute(raw?.minute);
    const status = raw?.status ?? "";
    const time = raw?.time ?? "";
    const date = raw?.date ?? "";
    const odds = raw?.odds?.match_winner ?? raw?.odds ?? {};
    const excitement = toNum(raw?.excitement_rating, 0);

    return {
      id: raw?.id ?? `${league}-${home}-${away}-${date}-${time}`,
      league,
      country,
      home,
      away,
      minute,
      status,
      date,
      time,
      odds, // {home, draw, away}
      raw,
      excitement,
    };
  }

  // Se vier “por liga” com stage/matches, vamos “explodir” noutro sítio
  return null;
}

function explodeGames(apiResults) {
  const out = [];
  for (const block of apiResults) {
    // caso 1: já achatado
    const flat = mapGame(block);
    if (flat) {
      out.push(flat);
      continue;
    }

    // caso 2: por liga
    const league = block?.league_name ?? "-";
    const country = block?.country?.name ?? "";
    const excitement = toNum(block?.excitement_rating, 0);

    const stages = Array.isArray(block?.stage) ? block.stage : [];
    for (const st of stages) {
      const matches = Array.isArray(st?.matches) ? st.matches : [];
      for (const m of matches) {
        const home = m?.teams?.home?.name ?? "Casa";
        const away = m?.teams?.away?.name ?? "Fora";
        const minute = normalizeMinute(m?.minute);
        const status = m?.status ?? "";
        const time = m?.time ?? "";
        const date = m?.date ?? "";
        const odds = m?.odds?.match_winner ?? {};

        out.push({
          id: m?.id ?? `${league}-${home}-${away}-${date}-${time}`,
          league,
          country,
          home,
          away,
          minute,
          status,
          date,
          time,
          odds,
          raw: m,
          excitement,
        });
      }
    }
  }
  return out;
}

// ---------- Analyzer (Value/Score) ----------
function impliedProbFromOdd(odd) {
  const o = toNum(odd, 0);
  if (!o || o <= 1.0001) return 0;
  return 1 / o;
}

/**
 * Modelo simples (placeholder) para estimar probabilidade.
 * Agora: usa "excitement_rating" + status/minuto para dar uma confiança base.
 * Depois: quando tiveres stats (cantos/remates/amarelos/h2h), melhoramos MUITO.
 */
function modelProb(game, marketKey) {
  // base por tipo de jogo
  const min = game.minute;
  const isPrematch = min < 0 || game.status?.includes("pre");
  const isLive = !isPrematch;

  // confiança base (0.40..0.62)
  let p = 0.48;

  // se a API tiver excitement_rating (0..10+), usa como “qualidade”/confiança
  const ex = toNum(game.excitement, 0);
  if (ex > 0) {
    // traz para 0..1 aproximadamente (cap)
    const exN = clamp(ex / 10, 0, 1);
    p += (exN - 0.5) * 0.10; // +- 5pp
  }

  // ao vivo: quanto mais avançado, menor “edge” sem stats
  if (isLive) {
    const t = clamp(min / 90, 0, 1);
    p -= t * 0.05;
  } else {
    // pré-jogo: ligeiramente mais “estável”
    p += 0.02;
  }

  // Ajuste leve por mercado (1x2)
  // (sem stats reais, isto é só um scaffold)
  if (marketKey === "home") p += 0.01;
  if (marketKey === "draw") p -= 0.02;
  if (marketKey === "away") p += 0.00;

  return clamp(p, 0.05, 0.95);
}

function valueScore(game, marketKey, odd) {
  const pModel = modelProb(game, marketKey);
  const pImplied = impliedProbFromOdd(odd);

  // “value” = prob_model - prob_implícita
  const edge = pModel - pImplied; // ex: 0.07 = +7pp

  // transforma em score 0..100
  // 0 edge => ~55 (média), +10pp => ~80, -10pp => ~30
  const score = clamp(55 + edge * 250, 0, 100);

  const reason = buildReason(game, marketKey, odd, pModel, pImplied, edge, score);
  return { score, reason, pModel, pImplied, edge };
}

function buildReason(game, marketKey, odd, pModel, pImpl, edge, score) {
  const min = game.minute;
  const prematch = min < 0 || game.status?.includes("pre");
  const phase = prematch ? "pré-jogo" : `ao vivo (${min}’ )`;

  const mkLabel =
    marketKey === "home" ? "Vitória Casa" :
    marketKey === "draw" ? "Empate" :
    marketKey === "away" ? "Vitória Fora" : marketKey;

  const ex = toNum(game.excitement, 0);
  const exTxt = ex ? ` (confiança-base pela liga: ${Math.round(ex * 10)}%)` : "";

  const edgePct = Math.round(edge * 1000) / 10; // 0.1%
  const pModelPct = Math.round(pModel * 1000) / 10;
  const pImplPct = Math.round(pImpl * 1000) / 10;

  const verdict = labelFromScore(score);

  let why = `Mercado: ${mkLabel}\n`;
  why += `Contexto: ${phase}${exTxt}\n`;
  why += `Odd: ${fmtOdd(odd)} (prob. implícita ~ ${pImplPct}%)\n`;
  why += `Estimativa do modelo (placeholder): ~ ${pModelPct}%\n`;
  why += `Valor (edge): ${edgePct}%\n`;
  why += `Classificação: ${verdict}\n`;
  why += `Nota: este “modelo” ainda não usa cantos/remates/amarelos/H2H — quando ligares stats reais, o “porquê” fica muito mais forte.`;

  return why;
}

// ---------- Rendering ----------
function currentList() {
  const exploded = explodeGames(games);

  // filtro
  const q = safeText(els.txtFilter?.value).trim().toLowerCase();
  let filtered = exploded;
  if (q) {
    filtered = exploded.filter((g) => {
      const hay = `${g.league} ${g.country} ${g.home} ${g.away}`.toLowerCase();
      return hay.includes(q);
    });
  }

  // tab logic (pre/live)
  if (activeTab === "live") {
    filtered = filtered.filter((g) => g.minute >= 0 && !String(g.status).includes("pre"));
  }
  if (activeTab === "pre") {
    filtered = filtered.filter((g) => g.minute < 0 || String(g.status).includes("pre"));
  }

  // sort
  const sort = els.selSort?.value || "time";
  const oddsMode = els.selOddsMode?.value || "api";

  const scoreForSort = (g) => {
    const oddHome = pickOdd(g, "home", oddsMode);
    const v = valueScore(g, "home", oddHome);
    return v.score;
  };

  filtered.sort((a, b) => {
    if (sort === "league") return `${a.league}`.localeCompare(`${b.league}`);
    if (sort === "edge") return scoreForSort(b) - scoreForSort(a);
    // time
    return `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`);
  });

  return filtered;
}

function pickOdd(game, marketKey, oddsMode) {
  // oddsMode: api | sim
  const apiOdd =
    marketKey === "home" ? game.odds?.home :
    marketKey === "draw" ? game.odds?.draw :
    marketKey === "away" ? game.odds?.away : null;

  if (oddsMode === "api" && toNum(apiOdd, 0) > 1) return toNum(apiOdd, 0);

  // simular odds (para testar UI)
  // base: casa ~2.1, empate ~3.1, fora ~3.0 (varia ligeiramente)
  const seed = (String(game.id).split("").reduce((a, c) => a + c.charCodeAt(0), 0) % 100) / 100;
  if (marketKey === "home") return 1.8 + seed * 0.9;
  if (marketKey === "draw") return 2.7 + seed * 1.0;
  if (marketKey === "away") return 2.2 + seed * 1.6;
  return 2.0;
}

function render() {
  // Banco
  els.bankAmount.textContent = fmtMoney(bank);

  // Conteúdo por tab
  if (activeTab === "bank") {
    els.list.innerHTML = `
      <div class="card">
        <div class="league">Gestão de banca</div>
        <div class="meta">Banco atual: €${fmtMoney(bank)}</div>
        <div style="margin-top:10px;display:flex;gap:10px;flex-wrap:wrap;">
          <button class="btn" id="btnBankReset">Reset para 1000</button>
          <button class="btn" id="btnBankAdd">+100</button>
          <button class="btn" id="btnBankSub">-100</button>
        </div>
        <div class="hint" style="margin-top:10px;">
          Sugestão (simples): stake 1%–3% por aposta (10€–30€ num banco de 1000€).
          Isto é gestão de risco, não é garantia de lucro.
        </div>
      </div>
    `;

    $("btnBankReset")?.addEventListener("click", () => { bank = 1000; render(); });
    $("btnBankAdd")?.addEventListener("click", () => { bank += 100; render(); });
    $("btnBankSub")?.addEventListener("click", () => { bank = Math.max(0, bank - 100); render(); });

    updateSlipUI();
    return;
  }

  const list = currentList();
  if (!list.length) {
    els.list.innerHTML = `<div class="hint">Sem jogos para mostrar (verifica filtro / tab).</div>`;
    updateSlipUI();
    return;
  }

  const oddsMode = els.selOddsMode?.value || "api";

  els.list.innerHTML = list.map((g) => {
    const oddHome = pickOdd(g, "home", oddsMode);
    const oddDraw = pickOdd(g, "draw", oddsMode);
    const oddAway = pickOdd(g, "away", oddsMode);

    const vHome = valueScore(g, "home", oddHome);
    const vDraw = valueScore(g, "draw", oddDraw);
    const vAway = valueScore(g, "away", oddAway);

    // “melhor” dos 3
    const best = [vHome, vDraw, vAway].sort((a, b) => b.score - a.score)[0];
    const badge = `<span class="badge badge-${badgeClass(best.score)}">${labelFromScore(best.score)} • ${Math.round(best.score)}%</span>`;

    const minuteTxt = g.minute >= 0 ? `${g.minute}’` : "pre-match";

    return `
      <div class="card" data-game="${encodeURIComponent(g.id)}">
        <div class="row">
          <div class="league">${safeText(g.league)} ${g.country ? `(${safeText(g.country)})` : ""}</div>
          ${badge}
        </div>

        <div class="teams">${safeText(g.home)} vs ${safeText(g.away)}</div>
        <div class="meta">Data/Hora: ${safeText(g.date)} ${safeText(g.time)} • Min: ${minuteTxt} • ${safeText(g.status)}</div>

        <div class="odds">
          <button class="oddBtn" data-market="home" data-odd="${oddHome}">Casa ${fmtOdd(oddHome)}</button>
          <button class="oddBtn" data-market="draw" data-odd="${oddDraw}">Empate ${fmtOdd(oddDraw)}</button>
          <button class="oddBtn" data-market="away" data-odd="${oddAway}">Fora ${fmtOdd(oddAway)}</button>
        </div>
      </div>
    `;
  }).join("");

  // Listeners (abrir detalhe)
  els.list.querySelectorAll(".card").forEach((card) => {
    card.addEventListener("click", (e) => {
      // não abrir detalhe ao clicar numa odd (isso adiciona ao boletim)
      if (e.target?.classList?.contains("oddBtn")) return;
      const id = decodeURIComponent(card.dataset.game);
      const g = list.find((x) => x.id === id);
      if (g) openDetail(g);
    });
  });

  // listeners odds buttons (add slip)
  els.list.querySelectorAll(".oddBtn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const card = btn.closest(".card");
      const id = decodeURIComponent(card.dataset.game);
      const g = list.find((x) => x.id === id);
      if (!g) return;

      const marketKey = btn.dataset.market;
      const odd = toNum(btn.dataset.odd, 0);

      addToSlip(g, marketKey, odd);
      openDetail(g); // abre detalhe para meter odd real (22bet) fácil
    });
  });

  updateSlipUI();
}

// ---------- Detail ----------
function openDetail(game) {
  selectedGame = game;
  els.detailTitle.textContent = `${game.home} vs ${game.away}`;

  const oddsMode = els.selOddsMode?.value || "api";
  const oddHome = pickOdd(game, "home", oddsMode);
  const oddDraw = pickOdd(game, "draw", oddsMode);
  const oddAway = pickOdd(game, "away", oddsMode);

  const aHome = valueScore(game, "home", oddHome);
  const aDraw = valueScore(game, "draw", oddDraw);
  const aAway = valueScore(game, "away", oddAway);

  const minuteTxt = game.minute >= 0 ? `${game.minute}’` : "pre-match";

  els.detailBody.innerHTML = `
    <div class="meta"><b>${safeText(game.league)}</b> ${game.country ? `(${safeText(game.country)})` : ""}</div>
    <div class="meta">Data/Hora: ${safeText(game.date)} ${safeText(game.time)} • Min: ${minuteTxt} • ${safeText(game.status)}</div>

    <div style="margin-top:12px;">
      <div class="row" style="align-items:flex-start;">
        <div style="flex:1;">
          <div class="league">Análise (auto)</div>
          <div class="hint">Escolhe um mercado e (opcional) mete a odd real da 22Bet para ver se ainda compensa.</div>
        </div>
      </div>

      ${renderMarketBlock(game, "home", "Vitória Casa", oddHome, aHome)}
      ${renderMarketBlock(game, "draw", "Empate", oddDraw, aDraw)}
      ${renderMarketBlock(game, "away", "Vitória Fora", oddAway, aAway)}

      <details style="margin-top:10px;">
        <summary style="cursor:pointer;">▶ Ver dados do jogo (debug)</summary>
        <pre style="white-space:pre-wrap;overflow:auto;max-height:240px;background:rgba(0,0,0,.25);padding:10px;border-radius:12px;border:1px solid rgba(255,255,255,.08);">
${safeText(JSON.stringify(game.raw, null, 2))}
        </pre>
      </details>

      <div class="hint" style="margin-top:12px;">
        Próximo passo: quando tiveres endpoints de <b>stats</b> (cantos, remates, amarelos, 1ª parte/2ª parte/90min, últimos encontros),
        eu ligo isso aqui e o “porquê” fica mesmo tipo 22Bet Analyzer.
      </div>
    </div>
  `;

  // listeners comparar odd 22bet
  ["home","draw","away"].forEach((mk) => {
    const btn = document.querySelector(`[data-compare-btn="${mk}"]`);
    const input = document.querySelector(`[data-book-odd="${mk}"]`);
    const out = document.querySelector(`[data-compare-out="${mk}"]`);

    btn?.addEventListener("click", () => {
      const bookOdd = toNum(input?.value, 0);
      if (!bookOdd || bookOdd <= 1) {
        out.textContent = "Mete uma odd válida (ex: 1.85)";
        return;
      }

      const apiOdd = mk === "home" ? oddHome : mk === "draw" ? oddDraw : oddAway;
      const ana = valueScore(game, mk, bookOdd);

      // comparação com odd “da app”
      const diff = (Math.round((bookOdd - apiOdd) * 100) / 100);
      const diffTxt = diff === 0 ? "igual" : (diff > 0 ? `+${fmtOdd(diff)}` : `${fmtOdd(diff)}`);

      out.textContent =
        `Odd 22Bet: ${fmtOdd(bookOdd)} (vs app ${fmtOdd(apiOdd)} → ${diffTxt}). ` +
        `Classificação: ${labelFromScore(ana.score)} (${Math.round(ana.score)}%).`;
    });

    // “Adicionar ao boletim” com odd 22bet
    const addBtn = document.querySelector(`[data-add-book="${mk}"]`);
    addBtn?.addEventListener("click", () => {
      const bookOdd = toNum(input?.value, 0);
      if (!bookOdd || bookOdd <= 1) {
        alert("Mete uma odd válida da 22Bet (ex: 1.85).");
        return;
      }
      addToSlip(game, mk, bookOdd, { isBook: true });
      updateSlipUI();
    });
  });

  els.detail.classList.add("open");
}

function renderMarketBlock(game, marketKey, label, odd, analysis) {
  const score = Math.round(analysis.score);
  const cls = badgeClass(score);

  return `
    <div class="card" style="margin-top:10px;">
      <div class="row">
        <div style="font-weight:900;">${label}</div>
        <span class="badge badge-${cls}">${labelFromScore(score)} • ${score}%</span>
      </div>

      <div class="meta" style="margin-top:6px;">Odd (app): <b>${fmtOdd(odd)}</b> • prob. implícita: <b>${Math.round(analysis.pImplied*1000)/10}%</b> • modelo: <b>${Math.round(analysis.pModel*1000)/10}%</b></div>

      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:10px;align-items:flex-end;">
        <button class="btn primary" onclick="window.__addMarket('${encodeURIComponent(game.id)}','${marketKey}',${odd})">Adicionar ao boletim</button>

        <div class="field" style="min-width:220px;">
          <label>Odd real (22Bet)</label>
          <input data-book-odd="${marketKey}" placeholder="ex: 1.85" />
        </div>

        <button class="btn" data-compare-btn="${marketKey}">Comparar</button>
        <button class="btn ghost" data-add-book="${marketKey}">Adicionar (22Bet)</button>
      </div>

      <div class="hint" data-compare-out="${marketKey}" style="margin-top:8px;"></div>

      <details style="margin-top:8px;">
        <summary style="cursor:pointer;">▶ Porquê?</summary>
        <pre style="white-space:pre-wrap;overflow:auto;background:rgba(0,0,0,.2);padding:10px;border-radius:12px;border:1px solid rgba(255,255,255,.08);">${safeText(analysis.reason)}</pre>
      </details>
    </div>
  `;
}

function closeDetail() {
  selectedGame = null;
  els.detail.classList.remove("open");
}

window.__addMarket = (encodedGameId, marketKey, odd) => {
  const id = decodeURIComponent(encodedGameId);
  const list = currentList();
  const g = list.find((x) => x.id === id) || selectedGame;
  if (!g) return;
  addToSlip(g, marketKey, odd);
  updateSlipUI();
};

// ---------- Slip ----------
function marketName(mk) {
  if (mk === "home") return "Casa";
  if (mk === "draw") return "Empate";
  if (mk === "away") return "Fora";
  return mk;
}

function addToSlip(game, marketKey, odd, opts = {}) {
  const key = `${game.id}:${marketKey}`;

  // se já existir, atualiza odd
  const idx = slip.findIndex((s) => s.key === key);
  const ana = valueScore(game, marketKey, odd);

  const item = {
    key,
    gameId: game.id,
    marketKey,
    label: `${game.home} vs ${game.away} — ${marketName(marketKey)}`,
    odd: toNum(odd, 0),
    bookOdd: opts.isBook ? toNum(odd, 0) : null,
    valueScore: ana.score,
    reason: ana.reason,
  };

  if (idx >= 0) slip[idx] = item;
  else slip.push(item);
}

function removeFromSlip(key) {
  slip = slip.filter((s) => s.key !== key);
}

function computeTotalOdds() {
  if (!slip.length) return 1;
  return slip.reduce((acc, s) => acc * (toNum(s.odd, 1) || 1), 1);
}

function updateSlipUI() {
  els.slipCount.textContent = `${slip.length} seleções`;

  if (!slip.length) {
    els.slipItems.innerHTML = `<div class="hint">Sem seleções</div>`;
  } else {
    els.slipItems.innerHTML = slip.map((s) => {
      const score = Math.round(s.valueScore);
      const cls = badgeClass(score);

      return `
        <div class="slipItem">
          <div class="slipTop">
            <div class="slipLabel">${safeText(s.label)}</div>
            <button class="slipX" data-x="${encodeURIComponent(s.key)}">✕</button>
          </div>
          <div class="slipMeta">
            Odd: <b>${fmtOdd(s.odd)}</b>
            <span class="badge badge-${cls}" style="margin-left:8px;">${Math.round(s.valueScore)}%</span>
          </div>
        </div>
      `;
    }).join("");

    els.slipItems.querySelectorAll(".slipX").forEach((btn) => {
      btn.addEventListener("click", () => {
        const key = decodeURIComponent(btn.dataset.x);
        removeFromSlip(key);
        updateSlipUI();
      });
    });
  }

  const total = computeTotalOdds();
  els.totalOdds.textContent = fmtOdd(total);

  const stake = toNum(els.stakeInput.value, 0);
  els.estReturn.textContent = fmtMoney(stake * total);
}

// ---------- Place bet (simulado / registo) ----------
function placeBet() {
  if (!slip.length) {
    alert("Sem seleções no boletim.");
    return;
  }

  const stake = toNum(els.stakeInput.value, 0);
  if (stake <= 0) {
    alert("Stake inválida.");
    return;
  }
  if (stake > bank) {
    alert("Não tens banca suficiente.");
    return;
  }

  // retira da banca (simulação)
  bank -= stake;
  els.bankAmount.textContent = fmtMoney(bank);

  // resumo
  const total = computeTotalOdds();
  const est = stake * total;

  // Aviso responsável
  alert(
    `Aposta registada (simulação)\n\n` +
    `Stake: €${fmtMoney(stake)}\n` +
    `Total odds: ${fmtOdd(total)}\n` +
    `Retorno estimado: €${fmtMoney(est)}\n\n` +
    `Nota: isto não garante lucro. Apostar tem risco.`
  );

  // limpar slip
  slip = [];
  updateSlipUI();
}

// ---------- Init ----------
function bindUI() {
  els.btnRefresh?.addEventListener("click", loadData);
  els.btnCloseDetail?.addEventListener("click", closeDetail);

  els.txtFilter?.addEventListener("input", render);
  els.selSort?.addEventListener("change", render);
  els.selOddsMode?.addEventListener("change", render);

  els.stakeInput?.addEventListener("input", updateSlipUI);
  els.btnPlace?.addEventListener("click", placeBet);
}

// ---------- Boot ----------
(async function boot() {
  initTabs();
  bindUI();
  updateSlipUI();
  try {
    await loadData();
  } catch (err) {
    console.error(err);
    els.list.innerHTML = `<div class="hint">Erro a carregar jogos. Confirma o WORKER_BASE e o endpoint.</div>`;
  }
})();
