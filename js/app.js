(() => {
  const API_BASE = "https://apostas-live-api.manelronaldo1.workers.dev";

  const CANDIDATES = [
    `${API_BASE}/jogos`,
    `${API_BASE}/games`,
    `${API_BASE}/live`,
    `${API_BASE}/matches`,
    `${API_BASE}/api/jogos`,
    `${API_BASE}/`, // por último
  ];

  const btn = document.getElementById("btnRefresh");
  const meta = document.getElementById("meta");
  const gamesEl = document.getElementById("games");

  const esc = (s) => String(s ?? "")
    .replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;")
    .replaceAll('"',"&quot;").replaceAll("'","&#039;");

  function setMeta(text, type=""){
    meta.textContent = text;
    meta.className = "meta" + (type ? " " + type : "");
  }

  function renderMessage(msg, isError=false){
    gamesEl.innerHTML = `<div class="card ${isError ? "err":""}">${esc(msg)}</div>`;
  }

  function normalizePayload(payload){
    if (Array.isArray(payload)) return payload;
    if (payload && Array.isArray(payload.games)) return payload.games;
    if (payload && Array.isArray(payload.data)) return payload.data;
    if (payload && Array.isArray(payload.events)) return payload.events;
    if (payload && Array.isArray(payload.matches)) return payload.matches;
    return [];
  }

  function getField(obj, keys, fallback=""){
    for (const k of keys) if (obj && obj[k] != null && obj[k] !== "") return obj[k];
    return fallback;
  }

  function renderGames(list){
    if (!list.length){
      renderMessage("O API respondeu mas veio lista vazia (0 jogos).", true);
      return;
    }

    gamesEl.innerHTML = list.map((g) => {
      const league = getField(g, ["league","competition","tournament","liga"], "—");
      const home = getField(g, ["homeTeam","home","team1","casa"], "—");
      const away = getField(g, ["awayTeam","away","team2","fora"], "—");
      const startRaw = getField(g, ["startTime","start","date","kickoff","time"], "");
      const time = startRaw ? new Date(startRaw).toLocaleString() : getField(g, ["clock","minute","statusTime"], "");
      const status = getField(g, ["status","state","phase"], "");
      const sh = getField(g, ["homeScore","scoreHome","goalsHome"], "");
      const sa = getField(g, ["awayScore","scoreAway","goalsAway"], "");
      const score = (sh !== "" || sa !== "") ? `<span class="pill">${esc(sh)} - ${esc(sa)}</span>` : "";

      return `
        <div class="card">
          <div class="row">
            <div class="league">${esc(league)}</div>
            <div class="row" style="align-items:center;gap:8px">
              <div class="time">${esc(time || "")}</div>
              ${score}
            </div>
          </div>
          <div class="teams">${esc(home)} <b>vs</b> ${esc(away)}</div>
          ${status ? `<div class="status">Estado: ${esc(status)}</div>` : ""}
        </div>
      `;
    }).join("");
  }

  async function fetchJson(url, signal){
    const res = await fetch(url, { cache:"no-store", signal });
    const text = await res.text();
    let payload;
    try { payload = JSON.parse(text); } catch { payload = null; }
    return { ok: res.ok, status: res.status, payload, raw: text, url };
  }

  async function loadGames(){
    btn.disabled = true;
    setMeta("A carregar jogos…");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try{
      let last;
      for (const url of CANDIDATES){
        last = await fetchJson(url, controller.signal);

        console.log("Tentei:", url, "->", last.status, last.payload);

        if (!last.ok) continue;

        const games = normalizePayload(last.payload);

        // Se for só {status:"API OK"}, isto dá 0 e tentamos a próxima rota
        if (games.length > 0){
          setMeta(`OK — ${games.length} jogos carregados.`, "ok");
          renderGames(games);
          return;
        }
      }

      // Se chegou aqui, nenhuma rota deu jogos
      setMeta("API OK mas sem jogos.", "err");
      renderMessage(
        "O teu Worker está a responder, mas não está a devolver a lista de jogos.\n" +
        "Provavelmente a rota dos jogos é outra (ex: /jogos) ou o Worker ainda não está implementado.",
        true
      );

      console.log("Última resposta recebida:", last);
    } catch (err){
      console.error(err);
      setMeta("Falha a pedir o API.", "err");
      renderMessage(err?.name === "AbortError" ? "Timeout (15s)." : "Falha de rede/CORS/Worker.", true);
    } finally {
      clearTimeout(timeout);
      btn.disabled = false;
    }
  }

  btn.addEventListener("click", loadGames);
  loadGames();
})();
