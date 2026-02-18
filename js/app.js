/* ====== CONFIG ====== */
const API_BASE = "https://apostas-live-api.manelronaldo1.workers.dev"; // o teu Worker
const ENDPOINTS = {
  live:  "/jogos",
  next:  "/proximos",
  match: "/match" // /match?match_id=...
};

const STORE = {
  get favs(){ return new Set(JSON.parse(localStorage.getItem("favs") || "[]")); },
  set favs(v){ localStorage.setItem("favs", JSON.stringify([...v])); },
};

const el = (id) => document.getElementById(id);
const listEl = el("list");
const statusText = el("statusText");

let mode = "live";           // "live" | "next"
let showFavsOnly = false;
let timer = null;
let lastData = [];           // cache para múltiplas
let leagueFilters = new Set();

/* ====== UTIL ====== */
function safeNum(x){
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}
function fmtDateTime(dateStr, timeStr){
  if(!dateStr && !timeStr) return "—";
  return `${dateStr || ""}${timeStr ? ", " + timeStr : ""}`.trim();
}
function confColor(score){
  // score 0..100 -> cor
  if (score >= 75) return "green";
  if (score >= 60) return "blue";
  if (score >= 45) return "yellow";
  return "red";
}

/**
 * Heurística simples (rápida) para “confiança/value”
 * - se houver odds, calcula implied prob e “value” comparando com baseline
 * - se não houver odds, usa fallback por estado (ao vivo/próximos)
 */
function scorePick({ odd, status, minute }){
  const o = safeNum(odd);
  let base = 50;
  if (status === "live") base += 8;
  if (Number.isFinite(minute) && minute >= 60) base += 5;

  if (o){
    // odds muito baixas -> mais “conf” (mas menos value); odds enormes -> mais risco
    if (o <= 1.45) base += 18;
    else if (o <= 1.75) base += 12;
    else if (o <= 2.10) base += 6;
    else if (o <= 3.00) base -= 2;
    else base -= 10;
  }
  return Math.max(0, Math.min(100, base));
}

function bySearch(item, q){
  if(!q) return true;
  const t = `${item.league || ""} ${item.homeTeam || ""} ${item.awayTeam || ""}`.toLowerCase();
  return t.includes(q.toLowerCase());
}

async function fetchJson(path){
  const res = await fetch(`${API_BASE}${path}`, { headers: { "Accept":"application/json" } });
  if(!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/* ====== RENDER LISTA (estilo 22Bet) ====== */
function render(data){
  const q = el("search").value.trim();
  const favs = STORE.favs;

  const groups = new Map(); // league -> []
  for(const g of data){
    // g pode vir em formatos diferentes; normalizamos:
    // esperado: { league, matches:[{id, date, time, teams:{home:{name}, away:{name}}, status, minute, odds...}] }
    const leagueName = g.league_name || g.league || g.leagueName || g.league_name || "Liga";
    const matches = g.matches || g.results || g.match_previews || [];
    if(!groups.has(leagueName)) groups.set(leagueName, []);
    for(const m of matches){
      const home = m.teams?.home?.name || m.homeTeam || m.home?.name || "";
      const away = m.teams?.away?.name || m.awayTeam || m.away?.name || "";
      const id = m.id || m.match_id || m.rawId;
      const date = m.date || m.match_date || "";
      const time = m.time || m.match_time || "";
      const st = (mode === "live") ? "live" : "next";
      const minute = safeNum(m.minute);
      const odds = m.odds?.match_winner || m.match_winner || m.odds?.matchWinner || {};
      const row = {
        league: leagueName,
        id,
        date, time,
        homeTeam: home,
        awayTeam: away,
        status: st,
        minute,
        odds: {
          home: safeNum(odds.home),
          draw: safeNum(odds.draw),
          away: safeNum(odds.away),
        }
      };
      if(bySearch(row, q)) groups.get(leagueName).push(row);
    }
  }

  // filtros por liga (se existir)
  const activeLeagueFilters = leagueFilters.size ? leagueFilters : null;

  // ordenar
  for (const [lg, arr] of groups){
    arr.sort((a,b)=>{
      const ad = `${a.date} ${a.time}`.trim();
      const bd = `${b.date} ${b.time}`.trim();
      return ad.localeCompare(bd);
    });
  }

  // render
  listEl.innerHTML = "";
  let total = 0;

  for(const [league, matches] of groups){
    const isFavLeague = favs.has(`L:${league}`);
    if(showFavsOnly && !isFavLeague) continue;
    if(activeLeagueFilters && !activeLeagueFilters.has(league)) continue;
    if(matches.length === 0) continue;

    total += matches.length;

    const card = document.createElement("div");
    card.className = "leagueCard";

    const head = document.createElement("div");
    head.className = "leagueHead";
    head.innerHTML = `
      <div>
        <div class="leagueName">${league}</div>
        <div class="leagueMeta">${mode === "live" ? "AO VIVO" : "PRÓXIMOS"} — ${matches.length} jogos</div>
      </div>
      <div class="leagueActions">
        <div class="star ${isFavLeague ? "on":""}" title="Favoritar liga">⭐</div>
      </div>
    `;
    head.querySelector(".star").onclick = () => {
      const s = STORE.favs;
      const key = `L:${league}`;
      if (s.has(key)) s.delete(key); else s.add(key);
      STORE.favs = s;
      render(lastData);
    };

    const grid = document.createElement("div");
    grid.className = "matchesGrid";

    for(const m of matches){
      const confH = confColor(scorePick({ odd: m.odds.home, status: m.status, minute:m.minute }));
      const confD = confColor(scorePick({ odd: m.odds.draw, status: m.status, minute:m.minute }));
      const confA = confColor(scorePick({ odd: m.odds.away, status: m.status, minute:m.minute }));

      const mc = document.createElement("div");
      mc.className = "matchCard";
      mc.innerHTML = `
        <div class="matchTop">
          <div>
            <div class="matchTeams">${m.homeTeam} <span>vs</span> ${m.awayTeam}</div>
          </div>
          <div class="matchTime">${fmtDateTime(m.date, m.time)}${(m.status==="live" && m.minute!=null) ? `<div>${m.minute}'</div>` : ""}</div>
        </div>

        <div class="badge ${m.status==="live" ? "live":"next"}">
          ${m.status==="live" ? "AO VIVO" : "PRÓXIMOS"} — ${m.status==="live" ? "live" : "upcoming"}
        </div>

        <div class="oddsRow">
          <div class="oddBtn" data-pick="home">
            <div class="k"><span class="conf ${confH}"></span>1</div>
            <div class="v">${m.odds.home ?? "—"}</div>
          </div>
          <div class="oddBtn" data-pick="draw">
            <div class="k"><span class="conf ${confD}"></span>X</div>
            <div class="v">${m.odds.draw ?? "—"}</div>
          </div>
          <div class="oddBtn" data-pick="away">
            <div class="k"><span class="conf ${confA}"></span>2</div>
            <div class="v">${m.odds.away ?? "—"}</div>
          </div>
        </div>
      `;

      mc.onclick = () => openMatch(m);
      grid.appendChild(mc);
    }

    card.appendChild(head);
    card.appendChild(grid);
    listEl.appendChild(card);
  }

  statusText.textContent = `${mode === "live" ? "AO VIVO" : "PRÓXIMOS"} — ${total} jogos.`;
}

/* ====== DETALHE DO JOGO (tabs + mercados + “porquê?” + comparar odds) ====== */
async function openMatch(match){
  showModal(true);
  el("modalTitle").textContent = `${match.homeTeam} vs ${match.awayTeam}`;

  // header com comparação manual 22Bet
  el("matchHeader").innerHTML = `
    <div class="mhLeft">
      <div class="big">${match.homeTeam} vs ${match.awayTeam}</div>
      <div class="small">${match.league} · ${fmtDateTime(match.date, match.time)} ${match.status==="live" && match.minute!=null ? `· ${match.minute}'` : ""}</div>
    </div>
    <div class="mhRight">
      <input id="bookOdd" class="input" placeholder="Odd da 22Bet (ex: 1.95)" />
      <button id="btnCompare" class="secondary">Comparar</button>
      <div id="cmpResult" class="badge">Comparação: —</div>
    </div>
  `;

  el("btnCompare").onclick = () => {
    const v = safeNum(el("bookOdd").value);
    const apiOdd = match.odds.home || match.odds.draw || match.odds.away;
    const out = el("cmpResult");
    if(!v || !apiOdd){
      out.textContent = "Comparação: —";
      return;
    }
    const diff = ((v - apiOdd) / apiOdd) * 100;
    const sign = diff >= 0 ? "+" : "";
    out.textContent = `Comparação: ${sign}${diff.toFixed(1)}% vs API`;
  };

  // carregar dados completos do match pelo Worker (precisas do endpoint /match)
  let full = null;
  try{
    full = await fetchJson(`${ENDPOINTS.match}?match_id=${encodeURIComponent(match.id)}`);
  }catch(e){
    full = null;
  }

  const markets = buildMarkets(match, full);

  // 90min / 1ª parte / 2ª parte (aqui é “estrutura igual 22bet”; dados dependem do que a API der)
  el("panelFull").innerHTML = renderMarkets(markets.full);
  el("panelHT").innerHTML   = renderMarkets(markets.ht);
  el("panelSH").innerHTML   = renderMarkets(markets.sh);

  // stats (se existirem)
  el("panelStats").innerHTML = renderStats(full);

  // tabs
  document.querySelectorAll(".tab").forEach(btn=>{
    btn.onclick = () => {
      document.querySelectorAll(".tab").forEach(x=>x.classList.remove("active"));
      btn.classList.add("active");
      const t = btn.dataset.tab;
      el("panelFull").classList.toggle("hidden", t!=="full");
      el("panelHT").classList.toggle("hidden", t!=="ht");
      el("panelSH").classList.toggle("hidden", t!=="sh");
      el("panelStats").classList.toggle("hidden", t!=="stats");
    };
  });
}

function buildMarkets(match, full){
  // Preferimos odds vindas de full, se existirem; fallback ao match da lista.
  const mw = full?.odds?.match_winner || full?.match_winner || full?.odds?.matchWinner || null;
  const ou = full?.odds?.over_under || full?.over_under || null;
  const hc = full?.odds?.handicap || full?.handicap || null;

  const home = mw?.home ?? match.odds.home;
  const draw = mw?.draw ?? match.odds.draw;
  const away = mw?.away ?? match.odds.away;

  const baseScore = (odd)=> scorePick({ odd, status: match.status, minute: match.minute });

  const fullMkts = [
    {
      name:"Resultado (1X2)",
      why: explainPick(full, "1X2"),
      type:"3",
      items:[
        { k:"1", label:"Casa", v: home, score: baseScore(home) },
        { k:"X", label:"Empate", v: draw, score: baseScore(draw) },
        { k:"2", label:"Fora", v: away, score: baseScore(away) },
      ]
    },
    {
      name:`Total Golos (O/U ${ou?.total ?? 2.5})`,
      why: explainPick(full, "O/U"),
      type:"2",
      items:[
        { k:"Over", label:"Mais", v: ou?.over ?? null, score: baseScore(ou?.over) },
        { k:"Under", label:"Menos", v: ou?.under ?? null, score: baseScore(ou?.under) },
      ]
    },
    {
      name:`Handicap (${hc?.market ?? "—"})`,
      why: explainPick(full, "Handicap"),
      type:"2",
      items:[
        { k:"Home", label:"Casa", v: hc?.home ?? null, score: baseScore(hc?.home) },
        { k:"Away", label:"Fora", v: hc?.away ?? null, score: baseScore(hc?.away) },
      ]
    }
  ];

  // “1ª parte / 2ª parte”: estrutura pronta; quando tiveres odds específicas na API, ligamos aqui.
  const htMkts = [
    { name:"1ª Parte — Resultado (estrutura)", why:"Quando a API fornecer odds HT, isto fica igual ao 90min.", type:"3",
      items:[
        { k:"1", label:"Casa", v:null, score:55 },
        { k:"X", label:"Empate", v:null, score:50 },
        { k:"2", label:"Fora", v:null, score:45 },
      ]
    }
  ];
  const shMkts = [
    { name:"2ª Parte — Resultado (estrutura)", why:"Quando a API fornecer odds 2H, isto fica igual ao 90min.", type:"3",
      items:[
        { k:"1", label:"Casa", v:null, score:55 },
        { k:"X", label:"Empate", v:null, score:50 },
        { k:"2", label:"Fora", v:null, score:45 },
      ]
    }
  ];

  return { full: fullMkts, ht: htMkts, sh: shMkts };
}

function renderMarkets(markets){
  return markets.map(m=>{
    const gridClass = m.type==="3" ? "marketGrid3" : "marketGrid2";
    const itemsHtml = m.items.map(it=>{
      const c = confColor(it.score ?? 50);
      return `
        <div class="oddBtn" onclick='window.__pick("${escapeHtml(m.name)}","${escapeHtml(it.label)}","${it.v ?? ""}","${escapeHtml(m.why || "")}")'>
          <div class="k"><span class="conf ${c}"></span>${it.k}</div>
          <div class="v">${it.v ?? "—"}</div>
        </div>
      `;
    }).join("");

    return `
      <div class="market">
        <div class="marketHead">
          <div class="marketName">${m.name}</div>
          <div class="marketWhy" onclick='window.__why("${escapeHtml(m.name)}","${escapeHtml(m.why || "Sem detalhe ainda.")}")'>Porquê?</div>
        </div>
        <div class="${gridClass}">
          ${itemsHtml}
        </div>
      </div>
    `;
  }).join("");
}

function renderStats(full){
  const ev = full?.events?.length ? full.events.slice(0, 24) : [];
  const injuries = full?.lineups?.sidelined || null;
  const preview = full?.match_preview || full?.matchPreview || null;

  let html = `<div class="market"><div class="marketHead"><div class="marketName">Resumo</div></div><div style="padding:12px;color:rgba(255,255,255,.75);font-weight:800;">`;

  if(preview){
    html += `Preview: ${preview.has_preview || preview.has_previews ? "Sim" : "Não"} · Palavras: ${preview.word_count ?? "—"}<br/>`;
  } else {
    html += `Preview: —<br/>`;
  }

  html += `</div></div>`;

  html += `<div class="market"><div class="marketHead"><div class="marketName">Eventos (últimos)</div></div><div style="padding:12px;color:rgba(255,255,255,.75);font-weight:800;">`;
  if(!ev.length) html += `Sem eventos disponíveis no endpoint.`;
  else html += ev.map(e=> `• ${e.event_minute || "—"}' ${e.event_type || "evento"} (${e.team || "—"}) ${e.player?.name ? "· " + e.player.name : ""}`).join("<br/>");
  html += `</div></div>`;

  html += `<div class="market"><div class="marketHead"><div class="marketName">Lesões / Suspensões</div></div><div style="padding:12px;color:rgba(255,255,255,.75);font-weight:800;">`;
  if(!injuries) html += `Sem dados (a API pode não devolver).`;
  else {
    const h = injuries.home || [];
    const a = injuries.away || [];
    html += `<div style="color:rgba(255,255,255,.9);font-weight:950;">Casa</div>${h.length ? h.map(x=>`• ${x.player?.name} — ${x.status} (${x.desc||""})`).join("<br/>") : "—"}<br/><br/>`;
    html += `<div style="color:rgba(255,255,255,.9);font-weight:950;">Fora</div>${a.length ? a.map(x=>`• ${x.player?.name} — ${x.status} (${x.desc||""})`).join("<br/>") : "—"}`;
  }
  html += `</div></div>`;

  return html;
}

/* ====== PORQUÊ? (explicações) ====== */
function explainPick(full, kind){
  // isto é “base”; quando ligares stats avançadas (xG, forma, etc.), eu substituo por explicação real.
  const hints = [];
  if(full?.match_preview?.has_preview || full?.match_preview?.has_previews) hints.push("Tem preview/AI disponível");
  if(full?.lineups?.lineup_type) hints.push(`Lineups: ${full.lineups.lineup_type}`);
  if(full?.odds?.last_modified_timestamp) hints.push("Odds atualizadas recentemente");
  if(full?.events?.length) hints.push("Há eventos registados no jogo");

  const base = {
    "1X2": "Cálculo de confiança: estado do jogo + risco da odd (heurística).",
    "O/U": "Cálculo de confiança: risco da odd + contexto do jogo (se disponível).",
    "Handicap": "Cálculo de confiança: risco da odd + spread (se disponível).",
  }[kind] || "Cálculo base.";

  return `${base}${hints.length ? "\n\nSinais:\n- " + hints.join("\n- ") : ""}`;
}

window.__why = (title, text) => {
  openDrawer("Porque é que isto é bom/mau?", `
    <div class="market">
      <div class="marketHead"><div class="marketName">${title}</div></div>
      <div style="padding:12px;color:rgba(255,255,255,.80);font-weight:800;white-space:pre-wrap;">${text}</div>
    </div>
    <div class="market">
      <div class="marketHead"><div class="marketName">Como eu pinto as cores</div></div>
      <div style="padding:12px;color:rgba(255,255,255,.80);font-weight:800;">
        <div><span class="conf green"></span> Verde: alta confiança</div>
        <div style="margin-top:6px;"><span class="conf blue"></span> Azul: boa, conservadora</div>
        <div style="margin-top:6px;"><span class="conf yellow"></span> Amarelo: risco médio</div>
        <div style="margin-top:6px;"><span class="conf red"></span> Vermelho: evitar</div>
      </div>
    </div>
  `);
};

window.__pick = (market, pick, odd, why) => {
  openDrawer("Selecionaste uma odd", `
    <div class="market">
      <div class="marketHead"><div class="marketName">${market}</div></div>
      <div style="padding:12px;color:rgba(255,255,255,.85);font-weight:900;">
        <div>Escolha: <span style="color:rgba(255,255,255,.95)">${pick}</span></div>
        <div style="margin-top:8px;">Odd (API): <span style="color:rgba(255,255,255,.95)">${odd || "—"}</span></div>
        <div style="margin-top:10px;color:rgba(255,255,255,.70);font-weight:800;white-space:pre-wrap;">${why || ""}</div>
      </div>
    </div>
    <div class="market">
      <div class="marketHead"><div class="marketName">Comparar com a tua casa</div></div>
      <div style="padding:12px;color:rgba(255,255,255,.80);font-weight:800;">
        Mete a odd da 22Bet no topo do detalhe do jogo para comparar.
      </div>
    </div>
  `);
};

/* ====== DRAWER / MODAL ====== */
function openDrawer(title, html){
  el("drawerTitle").textContent = title;
  el("drawerContent").innerHTML = html;
  el("drawerBack").classList.remove("hidden");
  el("drawer").classList.remove("hidden");
  el("drawer").setAttribute("aria-hidden","false");
}
function closeDrawer(){
  el("drawerBack").classList.add("hidden");
  el("drawer").classList.add("hidden");
  el("drawer").setAttribute("aria-hidden","true");
}
function showModal(on){
  el("modalBack").classList.toggle("hidden", !on);
  el("modal").classList.toggle("hidden", !on);
  el("modal").setAttribute("aria-hidden", String(!on));
}

el("drawerClose").onclick = closeDrawer;
el("drawerBack").onclick = closeDrawer;
el("modalClose").onclick = () => showModal(false);
el("modalBack").onclick = () => showModal(false);

function escapeHtml(s){
  return String(s||"")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

/* ====== FILTROS / FAVORITOS ====== */
function openFilters(){
  // lista de ligas do cache
  const leagues = [...new Set(lastData.flatMap(g => [g.league_name || g.league || g.leagueName].filter(Boolean)))].sort();
  const current = leagueFilters;

  const rows = leagues.map(lg=>{
    const on = current.has(lg);
    return `
      <label style="display:flex;gap:10px;align-items:center;padding:10px;border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(255,255,255,.03);margin-bottom:10px;">
        <input type="checkbox" data-lg="${escapeHtml(lg)}" ${on ? "checked":""}/>
        <div style="font-weight:900;">${lg}</div>
      </label>
    `;
  }).join("");

  openDrawer("Filtros (Ligas)", `
    <div style="color:rgba(255,255,255,.70);font-weight:800;margin-bottom:10px;">
      Marca as ligas que queres ver. (Se não marcares nada, mostra tudo.)
    </div>
    ${rows || `<div style="color:rgba(255,255,255,.65);font-weight:800;">Sem dados ainda. Atualiza.</div>`}
    <button id="fltApply" class="primary" style="width:100%;margin-top:10px;">Aplicar</button>
    <button id="fltClear" class="secondary" style="width:100%;margin-top:10px;">Limpar</button>
  `);

  setTimeout(()=>{
    const apply = document.getElementById("fltApply");
    const clear = document.getElementById("fltClear");

    apply.onclick = ()=>{
      const sel = new Set();
      el("drawerContent").querySelectorAll("input[type=checkbox]").forEach(cb=>{
        if(cb.checked) sel.add(cb.getAttribute("data-lg"));
      });
      leagueFilters = sel;
      closeDrawer();
      render(lastData);
    };
    clear.onclick = ()=>{
      leagueFilters = new Set();
      closeDrawer();
      render(lastData);
    };
  }, 0);
}

function openFavs(){
  showFavsOnly = !showFavsOnly;
  openDrawer("Favoritos", `
    <div class="market">
      <div class="marketHead"><div class="marketName">Modo favoritos</div></div>
      <div style="padding:12px;color:rgba(255,255,255,.80);font-weight:900;">
        ${showFavsOnly ? "A mostrar só ligas favoritas." : "A mostrar todas as ligas."}
        <div style="margin-top:12px;">
          <button id="toggleFavMode" class="primary" style="width:100%;">
            ${showFavsOnly ? "Mostrar tudo" : "Mostrar só favoritos"}
          </button>
        </div>
        <div style="margin-top:12px;color:rgba(255,255,255,.65);font-weight:800;">
          Para favoritar uma liga, carrega ⭐ no cabeçalho da liga.
        </div>
      </div>
    </div>
  `);

  setTimeout(()=>{
    document.getElementById("toggleFavMode").onclick = ()=>{
      showFavsOnly = !showFavsOnly;
      closeDrawer();
      render(lastData);
    };
  }, 0);
}

/* ====== MÚLTIPLAS ====== */
function buildAccumulator(){
  // Apanha picks simples: escolhe 1 pick por jogo (o de melhor score)
  // (Isto é a base. Depois fazemos “múltiplas por mercado”, cantos, cartões, etc.)
  const flat = [];
  for(const g of lastData){
    const leagueName = g.league_name || g.league || g.leagueName || "Liga";
    const matches = g.matches || g.results || g.match_previews || [];
    for(const m of matches){
      const home = m.teams?.home?.name || "";
      const away = m.teams?.away?.name || "";
      const id = m.id || m.match_id;
      const odds = m.odds?.match_winner || {};
      const candidates = [
        { pick:"1", odd: safeNum(odds.home), label:"Casa" },
        { pick:"X", odd: safeNum(odds.draw), label:"Empate" },
        { pick:"2", odd: safeNum(odds.away), label:"Fora" },
      ].filter(x=>x.odd);

      if(!candidates.length) continue;

      // score e escolhe melhor
      const scored = candidates.map(c=>({ ...c, score: scorePick({ odd:c.odd, status: mode==="live" ? "live":"next", minute:safeNum(m.minute) }) }));
      scored.sort((a,b)=> b.score - a.score);

      flat.push({
        league: leagueName,
        id,
        match: `${home} vs ${away}`,
        pick: scored[0].pick,
        label: scored[0].label,
        odd: scored[0].odd,
        score: scored[0].score
      });
    }
  }

  // modo
  const modeSel = el("accMode").value;
  let need = 4;
  let minScore = 60;
  if(modeSel==="conservative"){ need = 3; minScore = 70; }
  if(modeSel==="balanced"){ need = 4; minScore = 62; }
  if(modeSel==="aggressive"){ need = 6; minScore = 55; }

  const picks = flat.filter(p=>p.score >= minScore).sort((a,b)=> b.score - a.score).slice(0, need);

  const acc = el("accBody");
  if(!picks.length){
    acc.textContent = "Sem picks suficientes para o modo escolhido. Tenta Equilibrado/Agressivo ou muda para PRÓXIMOS.";
    return;
  }

  // odd total
  const totalOdd = picks.reduce((x,p)=> x * p.odd, 1);

  acc.innerHTML = `
    <div style="color:rgba(255,255,255,.85);font-weight:950;">Odd total estimada: ${totalOdd.toFixed(2)}</div>
    <div style="color:rgba(255,255,255,.60);font-weight:800;margin-top:6px;">(isto é heurístico — eu depois ligo stats avançadas para ficar inteligente a sério)</div>
    ${picks.map(p=>{
      const c = confColor(p.score);
      return `
        <div class="accPick">
          <div class="line">
            <div style="font-weight:950;"><span class="conf ${c}"></span>${p.match}</div>
            <div style="font-weight:950;">${p.pick} @ ${p.odd}</div>
          </div>
          <div class="small">${p.league} · Confiança: ${p.score}/100</div>
        </div>
      `;
    }).join("")}
  `;
}

/* ====== LOAD + AUTO REFRESH ====== */
async function load(){
  statusText.textContent = "A carregar…";
  try{
    const data = await fetchJson(mode === "live" ? ENDPOINTS.live : ENDPOINTS.next);
    lastData = Array.isArray(data) ? data : (data?.payload?.results ? data.payload.results : data);
    render(lastData);
  }catch(e){
    statusText.textContent = `Erro a pedir API (${e.message}).`;
    listEl.innerHTML = `<div class="leagueCard"><div class="leagueHead"><div><div class="leagueName">Erro</div><div class="leagueMeta">Abre a consola/network para ver.</div></div></div></div>`;
  }
}

function startAuto(){
  stopAuto();
  if(!el("autoRefresh").checked) return;
  const sec = Number(el("refreshRate").value || 20);
  timer = setInterval(load, sec * 1000);
}
function stopAuto(){
  if(timer) clearInterval(timer);
  timer = null;
}

/* ====== EVENTS ====== */
el("btnLive").onclick = () => { mode="live"; el("btnLive").classList.add("active"); el("btnNext").classList.remove("active"); load(); startAuto(); };
el("btnNext").onclick = () => { mode="next"; el("btnNext").classList.add("active"); el("btnLive").classList.remove("active"); load(); startAuto(); };
el("btnRefresh").onclick = load;
el("autoRefresh").onchange = startAuto;
el("refreshRate").onchange = startAuto;
el("search").oninput = () => render(lastData);

el("btnFilters").onclick = openFilters;
el("btnFavs").onclick = openFavs;

el("btnBuildAcc").onclick = buildAccumulator;

/* ====== INIT ====== */
load();
startAuto();
