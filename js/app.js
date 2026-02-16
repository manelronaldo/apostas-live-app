const WORKER_BASE = "https://apostas-live-api.manelronaldo1.workers.dev";

const ENDPOINTS = {
  live: "/live",
  pre: "/live",     // fallback, porque o teu /live traz pre-match também
  multis: "/live",  // usa a lista e gera múltiplas
  match: "/match",  // NOVO: /match?id=XXXX  (stats do jogo)
};

const $ = (id) => document.getElementById(id);
const clamp = (v,a,b)=>Math.max(a,Math.min(b,v));
const toNum = (v,def=0)=>Number.isFinite(Number(v))?Number(v):def;

function fmtOdd(v){ const n=toNum(v,0); if(!n) return "-"; return (Math.round(n*100)/100).toFixed(2); }
function fmtMoney(v){ const n=toNum(v,0); return (Math.round(n*100)/100).toFixed(2); }
function safeText(s){ return (s??"").toString(); }
function normalizeMinute(m){ return toNum(m,-1); }

function badgeClass(score){
  if(score>=75) return "good";
  if(score>=55) return "good";
  if(score>=45) return "warn";
  return "bad";
}
function labelFromScore(score){
  if(score>=85) return "Excelente";
  if(score>=75) return "Boa";
  if(score>=60) return "Média+";
  if(score>=45) return "Arriscada";
  return "Má";
}

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

let activeTab = "live";
let games = [];
let selectedGame = null;

let slip = [];
let bank = 1000;

// ---------- Fetch ----------
async function fetchJSON(path, params = null) {
  const url = new URL(`${WORKER_BASE}${path}`);
  if (params) Object.entries(params).forEach(([k,v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) throw new Error(`Erro: ${res.status}`);
  return res.json();
}

async function loadData() {
  const endpoint = ENDPOINTS[activeTab] || ENDPOINTS.live;
  const data = await fetchJSON(endpoint);
  games = Array.isArray(data?.results) ? data.results : [];
  render();
}

// ---------- Mapping ----------
function mapGame(raw) {
  if (raw?.teams && raw?.league_name) {
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

    return { id: raw?.id ?? `${league}-${home}-${away}-${date}-${time}`, league, country, home, away, minute, status, date, time, odds, raw, excitement };
  }
  return null;
}

function explodeGames(apiResults) {
  const out = [];
  for (const block of apiResults) {
    const flat = mapGame(block);
    if (flat) { out.push(flat); continue; }

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
        out.push({ id: m?.id ?? `${league}-${home}-${away}-${date}-${time}`, league, country, home, away, minute, status, date, time, odds, raw: m, excitement });
      }
    }
  }
  return out;
}

// ---------- Odds ----------
function pickOdd(game, marketKey, oddsMode) {
  const apiOdd =
    marketKey === "home" ? game.odds?.home :
    marketKey === "draw" ? game.odds?.draw :
    marketKey === "away" ? game.odds?.away : null;

  if (oddsMode === "api" && toNum(apiOdd, 0) > 1) return toNum(apiOdd, 0);

  const seed = (String(game.id).split("").reduce((a, c) => a + c.charCodeAt(0), 0) % 100) / 100;
  if (marketKey === "home") return 1.8 + seed * 0.9;
  if (marketKey === "draw") return 2.7 + seed * 1.0;
  if (marketKey === "away") return 2.2 + seed * 1.6;
  return 2.0;
}

// ---------- Value engine ----------
function impliedProbFromOdd(odd) {
  const o = toNum(odd, 0);
  if (!o || o <= 1.0001) return 0;
  return 1 / o;
}

// prob base (1X2) placeholder
function modelProb1X2(game, marketKey) {
  const min = game.minute;
  const prematch = (min < 0) || String(game.status).includes("pre");
  let p = 0.48;

  const ex = toNum(game.excitement, 0);
  if (ex > 0) {
    const exN = clamp(ex / 10, 0, 1);
    p += (exN - 0.5) * 0.10;
  }

  if (!prematch) {
    const t = clamp(min / 90, 0, 1);
    p -= t * 0.05;
  } else {
    p += 0.02;
  }

  if (marketKey === "home") p += 0.01;
  if (marketKey === "draw") p -= 0.02;

  return clamp(p, 0.05, 0.95);
}

function valueScore1X2(game, marketKey, odd) {
  const pModel = modelProb1X2(game, marketKey);
  const pImplied = impliedProbFromOdd(odd);
  const edge = pModel - pImplied;
  const score = clamp(55 + edge * 250, 0, 100);
  const reason = buildReason1X2(game, marketKey, odd, pModel, pImplied, edge, score);
  return { score, reason, pModel, pImplied, edge };
}

function buildReason1X2(game, marketKey, odd, pModel, pImpl, edge, score) {
  const min = game.minute;
  const prematch = min < 0 || String(game.status).includes("pre");
  const phase = prematch ? "pré-jogo" : `ao vivo (${min}’ )`;

  const mkLabel =
    marketKey === "home" ? "Vitória Casa" :
    marketKey === "draw" ? "Empate" :
    marketKey === "away" ? "Vitória Fora" : marketKey;

  const edgePct = Math.round(edge * 1000) / 10;
  const pModelPct = Math.round(pModel * 1000) / 10;
  const pImplPct = Math.round(pImpl * 1000) / 10;

  return [
    `Mercado: ${mkLabel}`,
    `Contexto: ${phase}`,
    `Odd: ${fmtOdd(odd)} (prob. implícita ~ ${pImplPct}%)`,
    `Estimativa (placeholder 1X2): ~ ${pModelPct}%`,
    `Valor (edge): ${edgePct}%`,
    `Classificação: ${labelFromScore(score)} (${Math.round(score)}%)`,
    `Nota: para ficar mais forte, vamos usar stats reais (cantos/SOT/amarelos + ritmo) no “Criador de Mercado”.`
  ].join("\n");
}

/**
 * Probabilidade para mercados de TOTAIS (cantos / SOT / amarelos)
 * Usa ritmo (por minuto) + projeção até ao fim do período.
 * Períodos:
 *  - "1H" => 45
 *  - "2H" => 45 (assumimos começa aos 46)
 *  - "FT" => 90
 * Entrada: currentTotal (no período), minuteInMatch, line
 */
function modelProbTotal({ period, currentTotal, minuteInMatch, line }) {
  const L = toNum(line, 0);
  if (!L) return 0.5;

  // define janela
  let start = 0, end = 90;
  if (period === "1H") { start = 0; end = 45; }
  if (period === "2H") { start = 45; end = 90; }

  const t = clamp(toNum(minuteInMatch, 0), 0, 120);
  const elapsed = clamp(t - start, 0, end - start);
  const remaining = Math.max(0, (end - start) - elapsed);

  // ritmo atual
  const pace = elapsed > 0 ? (toNum(currentTotal,0) / elapsed) : 0;

  // se ainda não há ritmo, devolve neutro
  if (pace <= 0) return 0.5;

  // projeção: média = atual + pace*restante
  const meanFinal = toNum(currentTotal,0) + pace * remaining;

  // incerteza: aumenta quando falta muito tempo
  const sigma = Math.max(0.8, Math.sqrt(Math.max(1, meanFinal)) * 0.9);

  // Prob(Total >= line) usando aproximação normal
  // continuity correction
  const z = (meanFinal - (L - 0.5)) / sigma;

  // CDF normal aprox
  const p = 0.5 * (1 + erf(z / Math.SQRT2));
  return clamp(p, 0.05, 0.95);
}

// erro function approx
function erf(x){
  // Abramowitz-Stegun approximation
  const sign = x>=0 ? 1 : -1;
  x = Math.abs(x);
  const a1=0.254829592, a2=-0.284496736, a3=1.421413741, a4=-1.453152027, a5=1.061405429;
  const p=0.3275911;
  const t=1/(1+p*x);
  const y=1-((((a5*t+a4)*t+a3)*t+a2)*t+a1)*t*Math.exp(-x*x);
  return sign*y;
}

function valueScoreTotal({ period, metricLabel, currentTotal, minuteInMatch, line, odd }) {
  const pModel = modelProbTotal({ period, currentTotal, minuteInMatch, line });
  const pImplied = impliedProbFromOdd(odd);
  const edge = pModel - pImplied;
  const score = clamp(55 + edge * 250, 0, 100);

  const pModelPct = Math.round(pModel*1000)/10;
  const pImplPct  = Math.round(pImplied*1000)/10;
  const edgePct   = Math.round(edge*1000)/10;

  const reason = [
    `Mercado: ${metricLabel} OVER ${line} (${period})`,
    `Estado atual no período: ${currentTotal}`,
    `Odd: ${fmtOdd(odd)} (prob. implícita ~ ${pImplPct}%)`,
    `Modelo por ritmo (stats): ~ ${pModelPct}%`,
    `Valor (edge): ${edgePct}%`,
    `Classificação: ${labelFromScore(score)} (${Math.round(score)}%)`,
    `Nota: isto melhora muito quando o Worker devolve stats certinhas (cantos/SOT/amarelos) por parte.`
  ].join("\n");

  return { score, reason, pModel, pImplied, edge };
}

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

// ---------- Lists ----------
function currentList() {
  const exploded = explodeGames(games);

  const q = safeText(els.txtFilter?.value).trim().toLowerCase();
  let filtered = exploded;
  if (q) {
    filtered = exploded.filter((g) => (`${g.league} ${g.country} ${g.home} ${g.away}`).toLowerCase().includes(q));
  }

  if (activeTab === "live") {
    filtered = filtered.filter((g) => g.minute >= 0 && !String(g.status).includes("pre"));
  }
  if (activeTab === "pre") {
    filtered = filtered.filter((g) => g.minute < 0 || String(g.status).includes("pre"));
  }

  const sort = els.selSort?.value || "time";
  const oddsMode = els.selOddsMode?.value || "api";

  const scoreForSort = (g) => valueScore1X2(g, "home", pickOdd(g, "home", oddsMode)).score;

  filtered.sort((a, b) => {
    if (sort === "league") return `${a.league}`.localeCompare(`${b.league}`);
    if (sort === "edge") return scoreForSort(b) - scoreForSort(a);
    return `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`);
  });

  return filtered;
}

// ---------- Multis generator ----------
function generateMultis(list) {
  // apanha candidatos por score (1X2 home/away apenas para começar)
  const oddsMode = els.selOddsMode?.value || "api";
  const candidates = [];

  for (const g of list) {
    const oH = pickOdd(g,"home",oddsMode);
    const oA = pickOdd(g,"away",oddsMode);
    const vH = valueScore1X2(g,"home",oH);
    const vA = valueScore1X2(g,"away",oA);

    candidates.push({ game:g, market:"home", odd:oH, score:vH.score, reason:vH.reason, label:`${g.home} vs ${g.away} — Casa` });
    candidates.push({ game:g, market:"away", odd:oA, score:vA.score, reason:vA.reason, label:`${g.home} vs ${g.away} — Fora` });
  }

  // filtra "bons"
  const good = candidates
    .filter(c => c.score >= 70 && c.odd >= 1.4 && c.odd <= 3.2)
    .sort((a,b)=>b.score-a.score);

  // gera combos 2 e 3 (sem repetir jogo)
  const combos = [];

  for (let i=0;i<good.length;i++){
    for (let j=i+1;j<good.length;j++){
      if (good[i].game.id === good[j].game.id) continue;
      const totalOdd = good[i].odd * good[j].odd;
      combos.push({ picks:[good[i],good[j]], totalOdd, grade: (good[i].score+good[j].score)/2 });
    }
  }

  const combos3 = [];
  for (let i=0;i<good.length;i++){
    for (let j=i+1;j<good.length;j++){
      for (let k=j+1;k<good.length;k++){
        const ids = new Set([good[i].game.id, good[j].game.id, good[k].game.id]);
        if (ids.size !== 3) continue;
        const totalOdd = good[i].odd * good[j].odd * good[k].odd;
        const grade = (good[i].score+good[j].score+good[k].score)/3;
        combos3.push({ picks:[good[i],good[j],good[k]], totalOdd, grade });
      }
    }
  }

  combos.sort((a,b)=>b.grade-a.grade);
  combos3.sort((a,b)=>b.grade-a.grade);

  return {
    two: combos.slice(0, 5),
    three: combos3.slice(0, 5),
  };
}

// ---------- Render ----------
function render() {
  els.bankAmount.textContent = fmtMoney(bank);

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
          Gestão simples (reduz risco): stake 1%–3% do banco por aposta (10€–30€ num banco de 1000€).
          Isto aumenta sobrevivência, mas <b>não garante lucro</b>.
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

  // MULTIS tab
  if (activeTab === "multis") {
    const { two, three } = generateMultis(list);
    els.list.innerHTML = `
      <div class="card">
        <div class="league">Múltiplas sugeridas (auto)</div>
        <div class="hint">Baseado no “value score” (cores). Escolhe com cabeça — apostar tem risco.</div>
      </div>

      <div class="card">
        <div class="row">
          <div class="league">Top 2 jogos</div>
          <span class="badge badge-good">Auto</span>
        </div>
        ${two.length ? two.map((c,idx)=>renderCombo(c, idx, 2)).join("") : `<div class="hint" style="margin-top:10px;">Sem combinações fortes agora.</div>`}
      </div>

      <div class="card">
        <div class="row">
          <div class="league">Top 3 jogos</div>
          <span class="badge badge-warn">Mais risco</span>
        </div>
        ${three.length ? three.map((c,idx)=>renderCombo(c, idx, 3)).join("") : `<div class="hint" style="margin-top:10px;">Sem combinações fortes agora.</div>`}
      </div>
    `;

    document.querySelectorAll("[data-add-combo]").forEach((btn)=>{
      btn.addEventListener("click", ()=>{
        const payload = JSON.parse(decodeURIComponent(btn.dataset.addCombo));
        payload.picks.forEach(p=>{
          addToSlip(p.game, p.market, p.odd, { labelOverride: p.label, reasonOverride: p.reason, scoreOverride: p.score });
        });
        updateSlipUI();
        alert("Múltipla adicionada ao boletim.");
      });
    });

    updateSlipUI();
    return;
  }

  // LIVE/PRE list
  if (!list.length) {
    els.list.innerHTML = `<div class="hint">Sem jogos para mostrar.</div>`;
    updateSlipUI();
    return;
  }

  const oddsMode = els.selOddsMode?.value || "api";

  els.list.innerHTML = list.map((g) => {
    const oddHome = pickOdd(g, "home", oddsMode);
    const oddDraw = pickOdd(g, "draw", oddsMode);
    const oddAway = pickOdd(g, "away", oddsMode);

    const vHome = valueScore1X2(g, "home", oddHome);
    const vDraw = valueScore1X2(g, "draw", oddDraw);
    const vAway = valueScore1X2(g, "away", oddAway);

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

  // open detail
  els.list.querySelectorAll(".card").forEach((card) => {
    card.addEventListener("click", (e) => {
      if (e.target?.classList?.contains("oddBtn")) return;
      const id = decodeURIComponent(card.dataset.game);
      const g = list.find((x) => x.id === id);
      if (g) openDetail(g);
    });
  });

  // add slip
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
      openDetail(g);
    });
  });

  updateSlipUI();
}

function renderCombo(combo, idx, size){
  const grade = Math.round(combo.grade);
  const cls = badgeClass(grade);
  const payload = encodeURIComponent(JSON.stringify(combo));

  return `
    <div class="card" style="margin-top:10px;">
      <div class="row">
        <div style="font-weight:900;">Combo #${idx+1} (${size} jogos)</div>
        <span class="badge badge-${cls}">${labelFromScore(grade)} • ${grade}%</span>
      </div>
      <div class="meta" style="margin-top:6px;">Total odds: <b>${fmtOdd(combo.totalOdd)}</b></div>
      <div style="margin-top:10px;display:flex;flex-direction:column;gap:8px;">
        ${combo.picks.map(p=>`<div class="meta">• ${safeText(p.label)} — <b>${fmtOdd(p.odd)}</b></div>`).join("")}
      </div>
      <div style="margin-top:10px;">
        <button class="btn primary" data-add-combo="${payload}">Adicionar ao boletim</button>
      </div>
    </div>
  `;
}

// ---------- Detail + stats ----------
async function openDetail(game) {
  selectedGame = game;
  els.detailTitle.textContent = `${game.home} vs ${game.away}`;

  const oddsMode = els.selOddsMode?.value || "api";
  const oddHome = pickOdd(game, "home", oddsMode);
  const oddDraw = pickOdd(game, "draw", oddsMode);
  const oddAway = pickOdd(game, "away", oddsMode);

  const aHome = valueScore1X2(game, "home", oddHome);
  const aDraw = valueScore1X2(game, "draw", oddDraw);
  const aAway = valueScore1X2(game, "away", oddAway);

  const minuteTxt = game.minute >= 0 ? `${game.minute}’` : "pre-match";

  els.detailBody.innerHTML = `
    <div class="meta"><b>${safeText(game.league)}</b> ${game.country ? `(${safeText(game.country)})` : ""}</div>
    <div class="meta">Data/Hora: ${safeText(game.date)} ${safeText(game.time)} • Min: ${minuteTxt} • ${safeText(game.status)}</div>

    <div class="card" style="margin-top:10px;">
      <div class="league">Stats (cantos / remates enquadrados / amarelos)</div>
      <div class="hint" id="statsHint" style="margin-top:6px;">A carregar stats…</div>
      <div id="statsArea"></div>
    </div>

    <div class="card" style="margin-top:10px;">
      <div class="league">Criador de Mercado (odd 22Bet)</div>
      <div class="hint" style="margin-top:6px;">
        Escolhe: métrica + período (1ª parte/2ª parte/90min) + linha (ex: 9.5) + tua odd → a app calcula valor e explica.
      </div>

      <div class="toolbar" style="border:none;padding:10px 0 0;">
        <div class="field">
          <label>Métrica</label>
          <select id="mkMetric">
            <option value="corners">Cantos</option>
            <option value="sot">Remates enquadrados</option>
            <option value="yellows">Amarelos</option>
          </select>
        </div>

        <div class="field">
          <label>Período</label>
          <select id="mkPeriod">
            <option value="1H">1ª parte</option>
            <option value="2H">2ª parte</option>
            <option value="FT">90 min</option>
          </select>
        </div>

        <div class="field">
          <label>Linha (ex: 9.5)</label>
          <input id="mkLine" placeholder="ex: 9.5" />
        </div>

        <div class="field">
          <label>Odd 22Bet</label>
          <input id="mkOdd" placeholder="ex: 1.80" />
        </div>

        <div class="field" style="min-width:140px;">
          <label>&nbsp;</label>
          <button class="btn primary" id="mkCalc">Calcular</button>
        </div>
      </div>

      <div id="mkResult" class="hint" style="margin-top:10px;"></div>
      <details style="margin-top:8px;">
        <summary style="cursor:pointer;">▶ Porquê?</summary>
        <pre id="mkWhy" style="white-space:pre-wrap;overflow:auto;background:rgba(0,0,0,.2);padding:10px;border-radius:12px;border:1px solid rgba(255,255,255,.08);"></pre>
      </details>
      <div style="margin-top:10px;">
        <button class="btn" id="mkAddSlip">Adicionar ao boletim (custom)</button>
      </div>
    </div>

    ${renderMarketBlock1X2(game, "home", "Vitória Casa", oddHome, aHome)}
    ${renderMarketBlock1X2(game, "draw", "Empate", oddDraw, aDraw)}
    ${renderMarketBlock1X2(game, "away", "Vitória Fora", oddAway, aAway)}
  `;

  // carrega stats do worker
  let stats = null;
  try{
    stats = await fetchJSON(ENDPOINTS.match, { id: String(game.id) });
  }catch(e){
    stats = null;
  }
  renderStats(stats, game);

  // criador de mercado
  let lastCustom = null;

  $("mkCalc")?.addEventListener("click", ()=>{
    const metric = $("mkMetric")?.value || "corners";
    const period = $("mkPeriod")?.value || "FT";
    const line = toNum($("mkLine")?.value, 0);
    const odd = toNum($("mkOdd")?.value, 0);

    if(!line || !odd || odd<=1){
      $("mkResult").textContent = "Mete uma linha válida (ex: 9.5) e uma odd válida (ex: 1.80).";
      $("mkWhy").textContent = "";
      lastCustom = null;
      return;
    }

    const s = extractMetric(stats, metric, period, game.minute);
    if(!s){
      $("mkResult").textContent = "Stats indisponíveis para esta métrica/período (precisas do /match no Worker).";
      $("mkWhy").textContent = "";
      lastCustom = null;
      return;
    }

    const metricLabel = metric==="corners"?"Cantos":metric==="sot"?"Remates enquadrados":"Amarelos";
    const ana = valueScoreTotal({
      period,
      metricLabel,
      currentTotal: s.currentTotal,
      minuteInMatch: game.minute >= 0 ? game.minute : 0,
      line,
      odd
    });

    const score = Math.round(ana.score);
    $("mkResult").innerHTML = `Resultado: <b>${labelFromScore(score)} (${score}%)</b> • Atual no período: <b>${s.currentTotal}</b>`;
    $("mkWhy").textContent = ana.reason;

    lastCustom = {
      label: `${game.home} vs ${game.away} — ${metricLabel} OVER ${line} (${period})`,
      odd,
      score: ana.score,
      reason: ana.reason,
      game,
      marketKey: `custom:${metric}:${period}:over:${line}`
    };
  });

  $("mkAddSlip")?.addEventListener("click", ()=>{
    if(!lastCustom){
      alert("Primeiro carrega em Calcular.");
      return;
    }
    slipAddCustom(lastCustom);
    updateSlipUI();
    alert("Seleção adicionada ao boletim.");
  });

  // comparar odd 22bet nos 1X2
  ["home","draw","away"].forEach((mk)=>{
    document.querySelector(`[data-compare-btn="${mk}"]`)?.addEventListener("click", ()=>{
      const input = document.querySelector(`[data-book-odd="${mk}"]`);
      const out = document.querySelector(`[data-compare-out="${mk}"]`);
      const bookOdd = toNum(input?.value, 0);
      if(!bookOdd || bookOdd<=1){ out.textContent = "Mete uma odd válida (ex: 1.85)"; return; }

      const apiOdd = mk==="home"?oddHome: mk==="draw"?oddDraw: oddAway;
      const ana = valueScore1X2(game, mk, bookOdd);

      const diff = Math.round((bookOdd - apiOdd)*100)/100;
      const diffTxt = diff===0 ? "igual" : (diff>0?`+${fmtOdd(diff)}`:`${fmtOdd(diff)}`);

      out.textContent = `Odd 22Bet: ${fmtOdd(bookOdd)} (vs app ${fmtOdd(apiOdd)} → ${diffTxt}). Classificação: ${labelFromScore(ana.score)} (${Math.round(ana.score)}%).`;
    });

    document.querySelector(`[data-add-book="${mk}"]`)?.addEventListener("click", ()=>{
      const input = document.querySelector(`[data-book-odd="${mk}"]`);
      const bookOdd = toNum(input?.value, 0);
      if(!bookOdd || bookOdd<=1){ alert("Mete uma odd válida da 22Bet (ex: 1.85)."); return; }
      addToSlip(game, mk, bookOdd, { isBook:true });
      updateSlipUI();
    });
  });

  els.detail.classList.add("open");
}

function renderMarketBlock1X2(game, marketKey, label, odd, analysis) {
  const score = Math.round(analysis.score);
  const cls = badgeClass(score);
  return `
    <div class="card" style="margin-top:10px;">
      <div class="row">
        <div style="font-weight:900;">${label}</div>
        <span class="badge badge-${cls}">${labelFromScore(score)} • ${score}%</span>
      </div>
      <div class="meta" style="margin-top:6px;">Odd (app): <b>${fmtOdd(odd)}</b></div>

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

function renderStats(stats, game){
  const hint = $("statsHint");
  const area = $("statsArea");

  if(!stats || stats.error){
    hint.textContent = "Stats indisponíveis (precisas do endpoint /match no Worker).";
    area.innerHTML = "";
    return;
  }

  hint.textContent = "Atualizado.";
  const minute = game.minute >= 0 ? game.minute : 0;

  // tenta ler em vários formatos possíveis
  const total = (stats.total || stats.stats || stats) ?? {};
  const corners = pickStat(total, ["corners", "corner_kicks", "total_corners"]);
  const sot = pickStat(total, ["shots_on_target","sot","on_target"]);
  const yellows = pickStat(total, ["yellow_cards","yellows","cards_yellow"]);

  const first = (stats.firstHalf || stats.first_half || stats.h1 || {}) ?? {};
  const second = (stats.secondHalf || stats.second_half || stats.h2 || {}) ?? {};

  const corners1 = pickStat(first, ["corners","corner_kicks","total_corners"]);
  const corners2 = pickStat(second, ["corners","corner_kicks","total_corners"]);
  const sot1 = pickStat(first, ["shots_on_target","sot","on_target"]);
  const sot2 = pickStat(second, ["shots_on_target","sot","on_target"]);
  const y1 = pickStat(first, ["yellow_cards","yellows","cards_yellow"]);
  const y2 = pickStat(second, ["yellow_cards","yellows","cards_yellow"]);

  area.innerHTML = `
    <div class="statsGrid">
      <div class="statBox">
        <div class="statLabel">Cantos (90m)</div>
        <div class="statValue">${corners ?? "-"}</div>
        <div class="meta">1ª: ${corners1 ?? "-"} • 2ª: ${corners2 ?? "-"}</div>
      </div>
      <div class="statBox">
        <div class="statLabel">Remates enquadrados (90m)</div>
        <div class="statValue">${sot ?? "-"}</div>
        <div class="meta">1ª: ${sot1 ?? "-"} • 2ª: ${sot2 ?? "-"}</div>
      </div>
      <div class="statBox">
        <div class="statLabel">Amarelos (90m)</div>
        <div class="statValue">${yellows ?? "-"}</div>
        <div class="meta">1ª: ${y1 ?? "-"} • 2ª: ${y2 ?? "-"}</div>
      </div>
      <div class="statBox">
        <div class="statLabel">Minuto</div>
        <div class="statValue">${minute}’</div>
        <div class="meta">Usado para projeção por ritmo</div>
      </div>
    </div>
  `;
}

function pickStat(obj, keys){
  for(const k of keys){
    if(obj && obj[k] != null) return obj[k];
  }
  return null;
}

function extractMetric(stats, metric, period, minuteInMatch){
  if(!stats) return null;

  // tenta ler totals e halves em formatos diferentes
  const total = (stats.total || stats.stats || stats) ?? {};
  const first = (stats.firstHalf || stats.first_half || stats.h1 || {}) ?? {};
  const second = (stats.secondHalf || stats.second_half || stats.h2 || {}) ?? {};

  const keys =
    metric==="corners" ? ["corners","corner_kicks","total_corners"] :
    metric==="sot" ? ["shots_on_target","sot","on_target"] :
    ["yellow_cards","yellows","cards_yellow"];

  if(period==="FT"){
    const v = pickStat(total, keys);
    if(v==null) return null;
    return { currentTotal: toNum(v,0) };
  }
  if(period==="1H"){
    const v = pickStat(first, keys);
    if(v==null) return null;
    return { currentTotal: toNum(v,0) };
  }
  if(period==="2H"){
    const v = pickStat(second, keys);
    if(v==null) return null;
    return { currentTotal: toNum(v,0) };
  }
  return null;
}

// ---------- Detail control ----------
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
function addToSlip(game, marketKey, odd, opts = {}) {
  const key = `${game.id}:${marketKey}`;

  const ana = valueScore1X2(game, marketKey, odd);
  const item = {
    key,
    gameId: game.id,
    marketKey,
    label: opts.labelOverride || `${game.home} vs ${game.away} — ${marketName(marketKey)}`,
    odd: toNum(odd, 0),
    valueScore: opts.scoreOverride ?? ana.score,
    reason: opts.reasonOverride ?? ana.reason,
  };

  const idx = slip.findIndex((s) => s.key === key);
  if (idx >= 0) slip[idx] = item;
  else slip.push(item);
}

function slipAddCustom(custom){
  const key = `${custom.game.id}:${custom.marketKey}`;
  const item = {
    key,
    gameId: custom.game.id,
    marketKey: custom.marketKey,
    label: custom.label,
    odd: toNum(custom.odd,0),
    valueScore: custom.score,
    reason: custom.reason,
  };
  const idx = slip.findIndex(s=>s.key===key);
  if(idx>=0) slip[idx]=item;
  else slip.push(item);
}

function removeFromSlip(key) {
  slip = slip.filter((s) => s.key !== key);
}

function marketName(mk) {
  if (mk === "home") return "Casa";
  if (mk === "draw") return "Empate";
  if (mk === "away") return "Fora";
  return mk;
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

function placeBet() {
  if (!slip.length) return alert("Sem seleções no boletim.");
  const stake = toNum(els.stakeInput.value, 0);
  if (stake <= 0) return alert("Stake inválida.");
  if (stake > bank) return alert("Não tens banca suficiente.");

  bank -= stake;
  els.bankAmount.textContent = fmtMoney(bank);

  const total = computeTotalOdds();
  const est = stake * total;

  alert(
    `Aposta registada (simulação)\n\n` +
    `Stake: €${fmtMoney(stake)}\n` +
    `Total odds: ${fmtOdd(total)}\n` +
    `Retorno estimado: €${fmtMoney(est)}\n\n` +
    `Nota: apostar tem risco e não há garantias.`
  );

  slip = [];
  updateSlipUI();
}

// ---------- UI bind ----------
function bindUI() {
  els.btnRefresh?.addEventListener("click", loadData);
  els.btnCloseDetail?.addEventListener("click", closeDetail);

  els.txtFilter?.addEventListener("input", render);
  els.selSort?.addEventListener("change", render);
  els.selOddsMode?.addEventListener("change", render);

  els.stakeInput?.addEventListener("input", updateSlipUI);
  els.btnPlace?.addEventListener("click", placeBet);
}

(async function boot() {
  initTabs();
  bindUI();
  updateSlipUI();
  try { await loadData(); }
  catch (e) {
    console.error(e);
    els.list.innerHTML = `<div class="hint">Erro a carregar. Confirma WORKER_BASE e endpoints.</div>`;
  }
})();
