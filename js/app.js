const WORKER_URL = "https://apostas-live-api.manelronaldo1.workers.dev/";

const $ = (id) => document.getElementById(id);

const els = {
  list: $("list"),
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

let allMatches = [];
let slip = [];
let bank = 1000;

function safe(v, fallback = "-") {
  return (v === undefined || v === null || v === "") ? fallback : v;
}

function getBank() {
  const saved = localStorage.getItem("bank");
  if (saved) bank = Number(saved) || 1000;
  els.bankAmount.textContent = bank.toFixed(2);
}

function setBank(v) {
  bank = Math.max(0, Number(v) || 0);
  localStorage.setItem("bank", String(bank));
  els.bankAmount.textContent = bank.toFixed(2);
}

function flattenMatches(apiJson) {
  const out = [];
  const leagues = Array.isArray(apiJson?.results) ? apiJson.results : [];
  for (const lg of leagues) {
    const leagueName = safe(lg?.league_name);
    const countryName = safe(lg?.country?.name, "");
    const stages = Array.isArray(lg?.stage) ? lg.stage : [];
    for (const st of stages) {
      const matches = Array.isArray(st?.matches) ? st.matches : [];
      for (const m of matches) {
        const home = safe(m?.teams?.home?.name, safe(m?.home?.name, safe(m?.home_name)));
        const away = safe(m?.teams?.away?.name, safe(m?.away?.name, safe(m?.away_name)));
        const minute = safe(m?.minute);
        const status = safe(m?.status);
        const date = safe(m?.date);
        const time = safe(m?.time);

        out.push({
          id: String(m?.id ?? `${leagueName}-${home}-${away}-${date}-${time}`),
          league: `${leagueName}${countryName ? ` (${countryName})` : ""}`,
          home,
          away,
          minute,
          status,
          date,
          time,
          raw: m,
        });
      }
    }
  }
  return out;
}

async function loadMatches() {
  els.list.innerHTML = `<div class="hint">A carregar jogos…</div>`;
  try {
    const r = await fetch(WORKER_URL, { cache: "no-store" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const json = await r.json();

    allMatches = flattenMatches(json);
    render();
  } catch (e) {
    els.list.innerHTML = `<div class="hint">Erro a carregar: ${String(e?.message || e)}</div>`;
  }
}

function scoreBadge(m) {
  // placeholder simples: se tiver minuto numérico e >= 1 => "Ao vivo"
  const min = Number(m.minute);
  if (!Number.isNaN(min) && min > 0) return { text: `LIVE ${min}'`, cls: "good" };
  if (m.status && m.status !== "-") return { text: m.status, cls: "warn" };
  return { text: "Pré", cls: "" };
}

function render() {
  const q = (els.txtFilter.value || "").toLowerCase().trim();

  let arr = allMatches.filter(m => {
    if (!q) return true;
    return (
      m.league.toLowerCase().includes(q) ||
      m.home.toLowerCase().includes(q) ||
      m.away.toLowerCase().includes(q)
    );
  });

  const sort = els.selSort.value;
  if (sort === "league") arr.sort((a,b)=>a.league.localeCompare(b.league));
  if (sort === "time") arr.sort((a,b)=>(a.time||"").localeCompare(b.time||""));
  if (sort === "edge") arr.sort((a,b)=>scoreBadge(b).text.localeCompare(scoreBadge(a).text));

  els.list.innerHTML = "";
  if (!arr.length) {
    els.list.innerHTML = `<div class="hint">Sem jogos para mostrar.</div>`;
    return;
  }

  for (const m of arr) {
    const badge = scoreBadge(m);
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <div class="row">
        <div class="league">${m.league}</div>
        <div class="badge ${badge.cls}">${badge.text}</div>
      </div>
      <div class="teams">${m.home} <span style="color:var(--muted)">vs</span> ${m.away}</div>
      <div class="meta">${safe(m.date)} • ${safe(m.time)} • Minuto: ${safe(m.minute)}</div>
    `;
    card.addEventListener("click", () => openDetail(m));
    els.list.appendChild(card);
  }
}

function openDetail(m) {
  els.detailTitle.textContent = `${m.home} vs ${m.away}`;
  els.detailBody.innerHTML = `
    <div class="hint">
      <b>Liga:</b> ${m.league}<br/>
      <b>Data:</b> ${safe(m.date)} ${safe(m.time)}<br/>
      <b>Status:</b> ${safe(m.status)}<br/>
      <b>Minuto:</b> ${safe(m.minute)}<br/><br/>
      (Próximo passo: aqui vamos meter estatísticas/cantos/remates quando ligares esse endpoint.)
    </div>
    <div style="margin-top:10px;display:flex;gap:10px;flex-wrap:wrap">
      <button class="btn primary" id="addOver">Adicionar: Over 1.5 (simulado)</button>
      <button class="btn" id="addCorners">Adicionar: Cantos +7.5 (simulado)</button>
    </div>
  `;

  // botões simulados para o boletim
  els.detailBody.querySelector("#addOver").addEventListener("click", () => addToSlip(m, "Over 1.5", 1.75));
  els.detailBody.querySelector("#addCorners").addEventListener("click", () => addToSlip(m, "Cantos +7.5", 1.90));
}

function addToSlip(m, market, odd) {
  const key = `${m.id}-${market}`;
  if (slip.some(x => x.key === key)) return;

  slip.push({ key, match: `${m.home} vs ${m.away}`, market, odd });
  renderSlip();
}

function removeFromSlip(key) {
  slip = slip.filter(x => x.key !== key);
  renderSlip();
}

function renderSlip() {
  els.slipCount.textContent = `${slip.length} seleções`;
  els.slipItems.innerHTML = "";

  let total = 1;
  for (const s of slip) total *= Number(s.odd) || 1;
  els.totalOdds.textContent = total.toFixed(2);

  const stake = Number(els.stakeInput.value) || 0;
  els.estReturn.textContent = (stake * total).toFixed(2);

  for (const s of slip) {
    const div = document.createElement("div");
    div.className = "slipItem";
    div.innerHTML = `
      <span class="x" title="remover">✕</span>
      <div>
        <div style="font-weight:900">${s.market} <span style="color:var(--muted)">(${s.odd})</span></div>
        <div style="font-size:12px;color:var(--muted)">${s.match}</div>
      </div>
    `;
    div.querySelector(".x").addEventListener("click", () => removeFromSlip(s.key));
    els.slipItems.appendChild(div);
  }
}

function placeBet() {
  const stake = Number(els.stakeInput.value) || 0;
  if (!slip.length) return alert("Boletim vazio.");
  if (stake <= 0) return alert("Stake inválida.");
  if (stake > bank) return alert("Banca insuficiente.");

  setBank(bank - stake);
  slip = [];
  renderSlip();
  alert("Aposta registada (simulação).");
}

function wire() {
  els.btnRefresh.addEventListener("click", loadMatches);
  els.btnCloseDetail.addEventListener("click", () => {
    els.detailTitle.textContent = "Seleciona um jogo";
    els.detailBody.innerHTML = `<div class="hint">Clica num jogo para abrir detalhes, estatísticas e prognósticos.</div>`;
  });
  els.txtFilter.addEventListener("input", render);
  els.selSort.addEventListener("change", render);
  els.stakeInput.addEventListener("input", renderSlip);
  els.btnPlace.addEventListener("click", placeBet);
}

getBank();
wire();
loadMatches();
