/* Apostas Live - Frontend Avançado
   - Live + Próximos
   - Auto refresh
   - Odds + comparação com odd da casa
   - Cores (azul/verde/amarelo/vermelho)
   - Botão "Porquê" (explica score)
   - Favoritos
   - Múltiplas sugeridas
*/

(() => {
  // =========================
  // Config / Estado
  // =========================
  const $ = (id) => document.getElementById(id);

  const state = {
    mode: "live", // live | upcoming
    market: "match_winner", // match_winner | over_under_25 | btts
    onlyFav: false,
    favorites: new Set(),
    games: [],
    lastFetchAt: null,
    timer: null,
    lastParlay: null,
  };

  const STORAGE_KEY = "apostas_live_v2";
  function loadStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data?.favorites?.length) state.favorites = new Set(data.favorites);
      if (data?.apiBase) $("apiBase").value = data.apiBase;
      if (data?.apiPassword) $("apiPassword").value = data.apiPassword;
      if (data?.market) setMarket(data.market);
      if (typeof data?.minConfidence === "number") $("minConfidence").value = String(data.minConfidence);
      if (typeof data?.minEdge === "number") $("minEdge").value = String(data.minEdge);
      if (typeof data?.autoRefresh === "boolean") $("autoRefresh").checked = data.autoRefresh;
      if (data?.refreshEvery) $("refreshEvery").value = String(data.refreshEvery);
    } catch {}
  }
  function saveStorage() {
    try {
      const data = {
        favorites: Array.from(state.favorites),
        apiBase: $("apiBase").value.trim(),
        apiPassword: $("apiPassword").value || "",
        market: state.market,
        minConfidence: Number($("minConfidence").value),
        minEdge: Number($("minEdge").value),
        autoRefresh: $("autoRefresh").checked,
        refreshEvery: Number($("refreshEvery").value),
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {}
  }

  // =========================
  // UI helpers
  // =========================
  function setStatus(text, kind = "ok") {
    $("statusText").textContent = text;
    const dot = document.querySelector(".pill .dot");
    dot.classList.remove("ok", "warn", "bad");
    dot.classList.add(kind);
  }

  function fmtTime(dateStr, timeStr) {
    if (!dateStr && !timeStr) return "—";
    // date vem tipo "18/02/2026" e time "19:00"
    return `${dateStr || ""}${dateStr && timeStr ? ", " : ""}${timeStr || ""}`.trim();
  }

  function safeNum(x) {
    const n = Number(x);
    return Number.isFinite(n) ? n : null;
  }

  function round2(x) {
    return Math.round(x * 100) / 100;
  }

  function pct(x) {
    return `${Math.round(x)}%`;
  }

  // =========================
  // Mercado / odds parsing
  // =========================
  function extractMarketOdds(match, market) {
    // Soccerdata: match.odds.match_winner.home/draw/away
    // Soccerdata: match.odds.over_under.total/over/under
    // Nem sempre existe -> fallback null
    const odds = match?.odds || {};
    if (market === "match_winner") {
      const mw = odds.match_winner || {};
      const home = safeNum(mw.home);
      const draw = safeNum(mw.draw);
      const away = safeNum(mw.away);
      return {
        key: "1X2",
        picks: [
          { code: "1", label: "Casa", odd: home },
          { code: "X", label: "Empate", odd: draw },
          { code: "2", label: "Fora", odd: away },
        ],
      };
    }

    if (market === "over_under_25") {
      const ou = odds.over_under || {};
      const total = safeNum(ou.total);
      // queremos 2.5; se API já trouxer total 2.5 ok, senão usamos o que houver
      const over = safeNum(ou.over);
      const under = safeNum(ou.under);
      return {
        key: `O/U ${total ?? 2.5}`,
        picks: [
          { code: "O", label: `Over ${total ?? 2.5}`, odd: over },
          { code: "U", label: `Under ${total ?? 2.5}`, odd: under },
          { code: "-", label: "—", odd: null },
        ],
      };
    }

    if (market === "btts") {
      // soccerdata pode não ter btts. Se não tiver, devolve nulls.
      const btts = odds.btts || odds.both_teams_to_score || {};
      const yes = safeNum(btts.yes);
      const no = safeNum(btts.no);
      return {
        key: "BTTS",
        picks: [
          { code: "Y", label: "Sim", odd: yes },
          { code: "N", label: "Não", odd: no },
          { code: "-", label: "—", odd: null },
        ],
      };
    }

    return { key: "—", picks: [] };
  }

  function bestPickFromMarket(marketBlock) {
    // Escolhe a odd "mais interessante" pelo menor preço? (Mais provável)
    // Para betting value, muitas vezes o ideal é comparar contra tua odd.
    // Aqui escolhemos o pick com maior "probabilidade implícita" (odd menor) se existir.
    const picks = (marketBlock?.picks || []).filter(p => Number.isFinite(p.odd));
    if (!picks.length) return null;
    picks.sort((a,b) => a.odd - b.odd); // menor odd = mais provável
    return picks[0];
  }

  // =========================
  // Score: confiança + value
  // =========================
  function computeScore(match, market, userBookOdd) {
    const block = extractMarketOdds(match, market);
    const pick = bestPickFromMarket(block);

    // Se não houver odds -> confiança baixa
    if (!pick?.odd) {
      return {
        confidence: 20,
        edgePct: -999,
        grade: "red",
        reason: [
          "Não há odds disponíveis no payload da API para este mercado.",
          "Sem odds → não dá para calcular value → confiança reduzida."
        ],
        marketBlock: block,
        pick,
      };
    }

    const apiOdd = pick.odd;
    const implied = 1 / apiOdd; // prob. implícita
    // "Model": heurística simples (não invento estatística que não tenho):
    // Ajuste por estado do jogo (live) e minuto/estado
    const status = (match?.status || "").toLowerCase();
    const minute = safeNum(match?.minute);
    let modelProb = implied;

    // Heurísticas leves:
    // - Se ao vivo e já vai avançado, mercados "mais prováveis" ganham confiança ligeira
    if (status.includes("live") || status.includes("inplay") || status.includes("playing")) {
      if (Number.isFinite(minute)) {
        const t = Math.min(Math.max(minute, 0), 90);
        modelProb = implied * (1 + (t / 180)); // até +50% no máximo (muito suave)
      } else {
        modelProb = implied * 1.1;
      }
    } else if (status.includes("upcoming") || status.includes("pre") || status.includes("not started")) {
      modelProb = implied * 1.0;
    } else {
      modelProb = implied * 1.0;
    }

    // Clamp prob
    modelProb = Math.min(Math.max(modelProb, 0.02), 0.92);

    // Edge: comparação com a tua odd (se meter)
    let edgePct = null;
    let usedBook = false;
    const bookOdd = safeNum(userBookOdd);
    if (bookOdd && bookOdd > 1.01) {
      // edge = (prob_model * odd_book - 1)
      const edge = (modelProb * bookOdd) - 1;
      edgePct = edge * 100;
      usedBook = true;
    } else {
      // sem tua odd: avaliamos "value" só por robustez do mercado (odd baixa = mais provável)
      // isto não é value real — é um proxy para ordenar.
      edgePct = (modelProb - implied) * 100;
    }

    // Confiança: mistura (probabilidade + edge)
    // base em prob
    let confidence = (modelProb * 100);
    // reforço por edge
    confidence += Math.max(-10, Math.min(15, edgePct));
    // penalização se odds muito altas (muito volátil)
    confidence -= Math.max(0, (apiOdd - 2.2) * 7);
    // clamp
    confidence = Math.round(Math.min(Math.max(confidence, 0), 100));

    // Grade por cor
    let grade = "red";
    if (confidence >= 80) grade = "blue";
    else if (confidence >= 65) grade = "green";
    else if (confidence >= 45) grade = "yellow";

    const reason = [];
    reason.push(`Mercado: ${block.key} | Pick mais provável: ${pick.label} (odd API ${apiOdd}).`);
    reason.push(`Prob. implícita (API): ${Math.round(implied*100)}%. Prob. ajustada (heurística): ${Math.round(modelProb*100)}%.`);
    if (usedBook) {
      reason.push(`Tua odd: ${bookOdd}. Edge estimado: ${round2(edgePct)}% (valor > 0 é vantagem).`);
    } else {
      reason.push(`Sem tua odd → Edge é só um proxy (diferença entre prob. ajustada e implícita).`);
    }
    reason.push(`Confiança final: ${confidence}% (mistura de probabilidade + edge, com penalização de odds altas).`);
    reason.push(`Nota: isto é um score heurístico. Se quiseres “modelo real”, temos de ter métricas (cantos, remates, xG, etc.) no endpoint.`);

    return { confidence, edgePct, grade, reason, marketBlock: block, pick };
  }

  // =========================
  // Normalização do payload do Worker
  // =========================
  function normalizeWorkerPayload(payload, mode) {
    // Worker pode devolver:
    // /jogos -> {status:"OK",count:n,games:[{league,homeTeam,awayTeam,startTime,status,...}]}
    // ou /jogos?debug=1 -> {status:"OK_RAW", payload:[{ league_id, league_name, matches:[...] }]}
    // ou /proximos -> parecido
    // Vamos suportar os dois.

    // Caso A: raw
    if (payload?.status === "OK_RAW" && payload?.payload) {
      const arr = payload.payload; // no teu print: payload: {count, results:[...]} ou array
      // Já vi prints teus com: payload: { count:3, results:[{league_id,...,matches:[...]}, ...] }
      if (Array.isArray(arr)) {
        return flattenRaw(arr, mode);
      }
      if (arr?.results && Array.isArray(arr.results)) {
        return flattenRaw(arr.results, mode);
      }
      return [];
    }

    // Caso B: simplified
    if (payload?.status === "OK" && Array.isArray(payload.games)) {
      // Aqui pode faltar odds e ids. Então tratamos como “cards simples”.
      return payload.games.map((g, idx) => ({
        id: g.rawId || `simple_${mode}_${idx}`,
        league: g.league || "—",
        country: g.country || "",
        home: g.homeTeam || "—",
        away: g.awayTeam || "—",
        date: g.date || "",
        time: g.startTime || "",
        status: g.status || (mode === "live" ? "live" : "upcoming"),
        minute: safeNum(g.minute),
        goals: {
          home: safeNum(g.homeScore),
          away: safeNum(g.awayScore),
        },
        odds: g.odds || {},
        raw: g,
      }));
    }

    // Caso C: upstream errors encapsulados
    if (payload?.error || payload?.status === "ERROR") {
      throw new Error(payload?.error || "Erro no endpoint");
    }

    return [];
  }

  function flattenRaw(results, mode) {
    // results: [{league_id,league_name, country, matches:[{...}]}]
    const out = [];
    for (const leagueBlock of results) {
      const leagueName = leagueBlock.league_name || leagueBlock.league || "—";
      const countryName = leagueBlock?.country?.name || leagueBlock?.country || "";
      const matches = leagueBlock.matches || [];
      for (const m of matches) {
        out.push({
          id: m.id ?? `${leagueName}_${m?.teams?.home?.id}_${m?.teams?.away?.id}_${m?.date}_${m?.time}`,
          league: leagueName,
          country: countryName,
          home: m?.teams?.home?.name || "—",
          away: m?.teams?.away?.name || "—",
          date: m?.date || "",
          time: m?.time || "",
          status: m?.status || (mode === "live" ? "live" : "upcoming"),
          minute: safeNum(m?.minute),
          stadium: m?.stadium?.name || "",
          goals: {
            home: safeNum(m?.goals?.home_ft_goals ?? m?.goals?.home_ht_goals ?? m?.goals?.home),
            away: safeNum(m?.goals?.away_ft_goals ?? m?.goals?.away_ht_goals ?? m?.goals?.away),
            homeHT: safeNum(m?.goals?.home_ht_goals),
            awayHT: safeNum(m?.goals?.away_ht_goals),
            homeFT: safeNum(m?.goals?.home_ft_goals),
            awayFT: safeNum(m?.goals?.away_ft_goals),
          },
          odds: m?.odds || {},
          events: Array.isArray(m?.events) ? m.events : [],
          lineups: m?.lineups || null,
          raw: m,
          rawLeague: leagueBlock,
        });
      }
    }
    return out;
  }

  // =========================
  // Fetch
  // =========================
  async function fetchJson(url, password) {
    const headers = {
      "Accept": "application/json",
    };
    // Se o teu Worker exigir password por header, usamos X-APP-PASSWORD
    if (password) headers["X-APP-PASSWORD"] = password;

    const res = await fetch(url, { headers, method: "GET" });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { error: "Resposta não é JSON", raw: text }; }
    if (!res.ok) {
      const msg = data?.error || data?.detail || `HTTP ${res.status}`;
      throw new Error(msg);
    }
    return data;
  }

  async function loadGames() {
    const base = $("apiBase").value.trim().replace(/\/+$/, "");
    const pass = $("apiPassword").value || "";

    if (!base) {
      setStatus("Mete o API Base do Worker.", "warn");
      return;
    }

    const endpoint = state.mode === "live" ? "/jogos" : "/proximos";
    $("endpointText").textContent = endpoint;

    const url = `${base}${endpoint}?debug=1`; // debug=1 ajuda sempre (traz odds + ids)
    setStatus("A carregar...", "warn");

    try {
      const payload = await fetchJson(url, pass);
      const list = normalizeWorkerPayload(payload, state.mode);

      state.games = list;
      state.lastFetchAt = new Date();
      $("lastUpdate").textContent = state.lastFetchAt.toLocaleString();
      setStatus(`OK — ${list.length} jogos carregados.`, "ok");
      render();
    } catch (e) {
      console.error(e);
      setStatus(`Erro: ${e.message}`, "bad");
      state.games = [];
      render();
    } finally {
      saveStorage();
    }
  }

  // =========================
  // Render
  // =========================
  function render() {
    const grid = $("gamesGrid");
    grid.innerHTML = "";

    const q = $("search").value.trim().toLowerCase();
    const minConf = Number($("minConfidence").value);
    const minEdge = Number($("minEdge").value);

    let items = state.games.slice();

    // favoritos
    if (state.onlyFav) {
      items = items.filter(g => state.favorites.has(String(g.id)));
    }

    // search
    if (q) {
      items = items.filter(g => {
        const hay = `${g.league} ${g.country} ${g.home} ${g.away}`.toLowerCase();
        return hay.includes(q);
      });
    }

    // compute score (sem tua odd ainda) para filtrar/ordenar base
    items = items.map(g => {
      const s = computeScore(g, state.market, null);
      return { g, s };
    });

    // filtro minConf / minEdge
    items = items.filter(({s}) => (s.confidence >= minConf) && (s.edgePct >= minEdge));

    // sort
    const sortBy = $("sortBy").value;
    items.sort((a,b) => {
      if (sortBy === "confidence") return b.s.confidence - a.s.confidence;
      if (sortBy === "value") return b.s.edgePct - a.s.edgePct;
      if (sortBy === "league") return String(a.g.league).localeCompare(String(b.g.league));
      if (sortBy === "time") return String(a.g.date + " " + a.g.time).localeCompare(String(b.g.date + " " + b.g.time));
      return 0;
    });

    $("countBadge").textContent = String(items.length);

    const empty = $("emptyState");
    empty.style.display = items.length ? "none" : "block";

    for (const {g, s} of items) {
      grid.appendChild(gameCard(g, s));
    }
  }

  function gameCard(g, baseScore) {
    const el = document.createElement("div");
    el.className = "game";

    const favOn = state.favorites.has(String(g.id));
    const status = String(g.status || "").toLowerCase();
    const isLive = state.mode === "live" || status.includes("live") || status.includes("playing") || status.includes("inplay");
    const tagText = isLive ? "AO VIVO" : "PRÓXIMOS";

    // market odds
    const block = baseScore.marketBlock;
    const picks = block?.picks || [];

    el.innerHTML = `
      <div class="gameTop">
        <div>
          <div class="league">${escapeHtml(g.league)}${g.country ? ` <span class="tiny muted">• ${escapeHtml(g.country)}</span>` : ""}</div>
          <div class="meta">${escapeHtml(fmtTime(g.date, g.time))}${isLive && Number.isFinite(g.minute) ? ` • ${g.minute}'` : ""}</div>
        </div>
        <button class="fav" title="Favorito">${favOn ? "⭐" : "☆"}</button>
      </div>

      <div class="teams">
        <div><b>${escapeHtml(g.home)}</b> vs <b>${escapeHtml(g.away)}</b></div>
      </div>

      <div class="scoreLine">
        <div class="tag ${isLive ? "live" : "upcoming"}">${tagText}${!isLive && status ? ` — ${escapeHtml(status)}` : ""}</div>
        <div class="grade">
          <span class="pip ${baseScore.grade}"></span>
          <span>${baseScore.confidence}%</span>
          <span class="tiny muted">(${round2(baseScore.edgePct)}% edge)</span>
        </div>
      </div>

      <div class="oddsBox">
        ${renderOddCell(picks[0])}
        ${renderOddCell(picks[1])}
        ${renderOddCell(picks[2])}
      </div>

      <div class="compare">
        <input class="bookOdd" type="text" inputmode="decimal" placeholder="Tua odd (ex: 2.05) para comparar value">
        <button class="btn miniBtn ghost btnRecalc">Recalcular</button>
      </div>

      <div class="actions">
        <button class="btn ghost btnWhy">Porquê</button>
        <button class="btn primary btnDetails">Detalhes</button>
      </div>
    `;

    // handlers
    el.querySelector(".fav").addEventListener("click", () => {
      const id = String(g.id);
      if (state.favorites.has(id)) state.favorites.delete(id);
      else state.favorites.add(id);
      saveStorage();
      render();
    });

    const input = el.querySelector(".bookOdd");
    const recalcBtn = el.querySelector(".btnRecalc");
    const gradeBox = el.querySelector(".grade");

    function recalcFromInput() {
      const val = input.value.trim().replace(",", ".");
      const score = computeScore(g, state.market, val);
      gradeBox.innerHTML = `
        <span class="pip ${score.grade}"></span>
        <span>${score.confidence}%</span>
        <span class="tiny muted">(${round2(score.edgePct)}% edge)</span>
      `;
      // update actions to show correct explanation
      el.querySelector(".btnWhy").onclick = () => openWhy(g, score, val);
      el.querySelector(".btnDetails").onclick = () => openDetails(g, score);
    }

    recalcBtn.addEventListener("click", recalcFromInput);
    input.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") recalcFromInput();
    });

    // default modal uses baseScore
    el.querySelector(".btnWhy").addEventListener("click", () => openWhy(g, baseScore, null));
    el.querySelector(".btnDetails").addEventListener("click", () => openDetails(g, baseScore));

    return el;
  }

  function renderOddCell(pick) {
    if (!pick) return `<div class="odd"><div class="k">—</div><div class="v">—</div></div>`;
    const odd = Number.isFinite(pick.odd) ? pick.odd : null;
    return `
      <div class="odd">
        <div class="k">${escapeHtml(pick.label)}</div>
        <div class="v">${odd ? odd.toFixed(2) : "—"} ${odd ? `<small>(${pick.code})</small>` : ""}</div>
      </div>
    `;
  }

  // =========================
  // Modal
  // =========================
  function openModal(title, bodyHtml, copyText) {
    $("modalTitle").textContent = title;
    $("modalBody").innerHTML = bodyHtml;

    const modal = $("modal");
    modal.classList.remove("hidden");
    modal.setAttribute("aria-hidden", "false");

    $("btnCopy").onclick = async () => {
      try {
        await navigator.clipboard.writeText(copyText || stripHtml(bodyHtml));
        setStatus("Copiado ✔", "ok");
      } catch {
        setStatus("Não consegui copiar.", "warn");
      }
    };
  }

  function closeModal() {
    const modal = $("modal");
    modal.classList.add("hidden");
    modal.setAttribute("aria-hidden", "true");
  }

  function openWhy(g, score, userOdd) {
    const lines = score.reason.map(r => `• ${r}`).join("\n");
    const title = `Porquê — ${g.home} vs ${g.away}`;
    const html = `
      <div class="tiny muted">Explicação do score (confiança + value):</div>
      <hr/>
      <pre>${escapeHtml(lines)}</pre>
      <hr/>
      <div class="tiny muted">Dica: mete a <b>tua odd</b> no card e carrega <b>Recalcular</b> para ver edge real.</div>
    `;
    const copy = `${title}\n\n${lines}\n\nMercado: ${score.marketBlock?.key || "—"}\nTua odd: ${userOdd || "(não indicada)"}`;
    openModal(title, html, copy);
  }

  function openDetails(g, score) {
    const title = `Detalhes — ${g.home} vs ${g.away}`;
    const rawSmall = {
      id: g.id,
      league: g.league,
      country: g.country,
      date: g.date,
      time: g.time,
      status: g.status,
      minute: g.minute,
      odds: g.odds,
      stadium: g.stadium,
    };
    const html = `
      <div class="tiny muted"><b>Resumo</b></div>
      <pre>${escapeHtml(JSON.stringify(rawSmall, null, 2))}</pre>
      <hr/>
      <div class="tiny muted"><b>Odds (mercado atual: ${escapeHtml(score.marketBlock?.key || "—")})</b></div>
      <pre>${escapeHtml(JSON.stringify(score.marketBlock, null, 2))}</pre>
      <hr/>
      <div class="tiny muted"><b>Raw match (se existir no payload)</b></div>
      <pre>${escapeHtml(JSON.stringify(g.raw || {}, null, 2))}</pre>
    `;
    const copy = `${title}\n\n${JSON.stringify(rawSmall, null, 2)}`;
    openModal(title, html, copy);
  }

  // =========================
  // Múltiplas
  // =========================
  function generateParlay() {
    const size = Number($("parlaySize").value);
    const profile = $("parlayProfile").value;

    // Base list
    const items = state.games.map(g => {
      const sc = computeScore(g, state.market, null);
      return { g, sc };
    });

    // Perfil
    let minC = 55, minEdge = 0;
    if (profile === "safe") { minC = 65; minEdge = -1; }
    if (profile === "balanced") { minC = 55; minEdge = 0; }
    if (profile === "aggressive") { minC = 45; minEdge = 2; }

    const picked = items
      .filter(x => x.sc.confidence >= minC && x.sc.edgePct >= minEdge)
      .sort((a,b) => (b.sc.confidence + b.sc.edgePct) - (a.sc.confidence + a.sc.edgePct))
      .slice(0, size);

    const box = $("parlayBox");
    box.innerHTML = "";

    if (!picked.length) {
      box.innerHTML = `<div class="tiny muted">Não há jogos suficientes com este perfil. Baixa os filtros ou muda o perfil.</div>`;
      return;
    }

    let totalOdd = 1;
    const lines = [];

    for (const {g, sc} of picked) {
      const pick = sc.pick;
      const odd = pick?.odd || 1;
      totalOdd *= odd;

      const line = document.createElement("div");
      line.className = "parlayLine";
      line.innerHTML = `
        <div>
          <div class="tiny"><b>${escapeHtml(g.home)} vs ${escapeHtml(g.away)}</b></div>
          <div class="tiny muted">${escapeHtml(g.league)} • ${escapeHtml(sc.marketBlock?.key || "—")} • ${escapeHtml(pick?.label || "—")}</div>
        </div>
        <div class="tiny"><b>${odd ? odd.toFixed(2) : "—"}</b></div>
      `;
      box.appendChild(line);

      lines.push(`${g.home} vs ${g.away} | ${sc.marketBlock?.key || "—"} | ${pick?.label || "—"} | odd ${odd ? odd.toFixed(2) : "—"}`);
    }

    const total = document.createElement("div");
    total.className = "parlayTotal";
    total.innerHTML = `
      <div>Total (aprox.)</div>
      <div>${Number.isFinite(totalOdd) ? totalOdd.toFixed(2) : "—"}</div>
    `;
    box.appendChild(total);

    state.lastParlay = { totalOdd: Number.isFinite(totalOdd) ? totalOdd : null, lines };
  }

  // =========================
  // Mercado chips
  // =========================
  function setMarket(m) {
    state.market = m;
    for (const c of document.querySelectorAll("#marketChips .chip")) {
      c.classList.toggle("active", c.dataset.market === m);
    }
    $("marketText").textContent =
      m === "match_winner" ? "1X2" :
      m === "over_under_25" ? "Over/Under 2.5" :
      m === "btts" ? "BTTS" : "—";
    saveStorage();
    render();
  }

  // =========================
  // Auto refresh
  // =========================
  function setupAutoRefresh() {
    clearInterval(state.timer);
    const enabled = $("autoRefresh").checked;
    $("autoText").textContent = enabled ? "Ligado" : "Desligado";
    if (!enabled) return;

    const sec = Number($("refreshEvery").value);
    state.timer = setInterval(() => {
      loadGames();
    }, Math.max(5, sec) * 1000);
  }

  // =========================
  // Utils
  // =========================
  function escapeHtml(s) {
    return String(s ?? "")
      .replaceAll("&","&amp;")
      .replaceAll("<","&lt;")
      .replaceAll(">","&gt;")
      .replaceAll('"',"&quot;")
      .replaceAll("'","&#039;");
  }
  function stripHtml(html) {
    const div = document.createElement("div");
    div.innerHTML = html;
    return div.textContent || div.innerText || "";
  }

  // =========================
  // Init / Events
  // =========================
  function setMode(mode) {
    state.mode = mode;
    $("modeText").textContent = mode === "live" ? "AO VIVO" : "PRÓXIMOS";
    $("tabLive").classList.toggle("active", mode === "live");
    $("tabUpcoming").classList.toggle("active", mode === "upcoming");
    saveStorage();
    loadGames();
  }

  function init() {
    loadStorage();

    // sliders text
     const minConfidenceEl = document.getElementById("minConfidence") || document.getElementById("minConf");
const minEdgeEl = document.getElementById("minEdge") || document.getElementById("minValue") || document.getElementById("edge");

if (!minConfidenceEl || !minEdgeEl) {
  throw new Error("Faltam inputs minConfidence/minEdge no HTML (IDs não encontrados).");
}

minConfidenceElText.textContent = `${minConfidenceEl.value}%`;
minEdgeElText.textContent = `${minEdgeEl.value}%`;
     // Labels dos sliders (não rebenta se algum elemento não existir)
const minEdgeEl = $("minEdge");
const minEdgeTextEl = $("minEdgeText");
if (minEdgeEl && minEdgeTextEl) {
  minEdgeTextEl.textContent = `${minEdgeEl.value}%`;
}

const minConfEl = $("minConfidence");
const minConfTextEl = $("minConfidenceText");
if (minConfEl && minConfTextEl) {
  minConfTextEl.textContent = `${minConfEl.value}%`;
  minConfEl.addEventListener("input", () => {
    minConfTextEl.textContent = `${minConfEl.value}%`;
    saveStorage?.();
    render?.();
  });
}

function updateSlidersText() {
  if (minConfidenceTextEl && minConfidenceEl) {
    minConfidenceTextEl.textContent = `${minConfidenceEl.value}%`;
  }
  if (minEdgeTextEl && minEdgeEl) {
    minEdgeTextEl.textContent = `${minEdgeEl.value}%`;
  }
}

if (minConfidenceEl) {
  minConfidenceEl.addEventListener("input", () => {
    updateSlidersText();
    saveToStorage?.();
    render?.();
  });
}

if (minEdgeEl) {
  minEdgeEl.addEventListener("input", () => {
    updateSlidersText();
    saveToStorage?.();
    render?.();
  });
}

updateSlidersText();

      saveStorage();
      render();
    });
    $("minEdge").addEventListener("input", () => {
      $("minEdgeText").textContent = `${$("minEdge").value}%`;
      saveStorage();
      render();
    });

    $("search").addEventListener("input", render);
    $("sortBy").addEventListener("change", render);

    $("btnRefresh").addEventListener("click", loadGames);

    $("tabLive").addEventListener("click", () => setMode("live"));
    $("tabUpcoming").addEventListener("click", () => setMode("upcoming"));

    $("btnOnlyFav").addEventListener("click", () => {
      state.onlyFav = !state.onlyFav;
      $("btnOnlyFav").textContent = state.onlyFav ? "⭐ A mostrar favoritos" : "⭐ Só favoritos";
      render();
      saveStorage();
    });

    for (const chip of document.querySelectorAll("#marketChips .chip")) {
      chip.addEventListener("click", () => setMarket(chip.dataset.market));
    }

    $("btnGenerateParlay").addEventListener("click", generateParlay);

    $("apiBase").addEventListener("change", () => { saveStorage(); loadGames(); });
    $("apiPassword").addEventListener("change", () => { saveStorage(); loadGames(); });

    $("autoRefresh").addEventListener("change", () => { saveStorage(); setupAutoRefresh(); });
    $("refreshEvery").addEventListener("change", () => { saveStorage(); setupAutoRefresh(); });

    // Modal
    $("modalClose").addEventListener("click", closeModal);
    $("modalX").addEventListener("click", closeModal);
    $("modalOk").addEventListener("click", closeModal);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeModal();
    });

    // Defaults
    setupAutoRefresh();
    setMode("live");
  }

  init();
