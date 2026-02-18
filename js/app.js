(() => {
  const API_LIVE = "https://apostas-live-api.manelronaldo1.workers.dev/jogos";
  const API_NEXT = "https://apostas-live-api.manelronaldo1.workers.dev/proximos";

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
    gamesEl.innerHTML = `<div class="card ${isError ? "err" : ""}">${esc(msg)}</div>`;
  }

  function normalizeGames(payload){
    if (payload && Array.isArray(payload.games)) return payload.games;
    if (Array.isArray(payload)) return payload;
    return [];
  }

  function getField(obj, keys, fallback=""){
    for (const k of keys) if (obj && obj[k] != null && obj[k] !== "") return obj[k];
    return fallback;
  }

  function fmtTime(startTime){
    if (!startTime) return "";
    const d = new Date(startTime);
    if (Number.isNaN(d.getTime())) return startTime;
    return d.toLocaleString();
  }

  function renderGames(list, label){
    if (!list.length){
      renderMessage("Ainda não há jogos (nem live nem próximos).", true);
      return;
    }

    gamesEl.innerHTML = list.map((g) => {
      const league = getField(g, ["league"], "—");
      const home = getField(g, ["homeTeam"], "—");
      const away = getField(g, ["awayTeam"], "—");
      const time = fmtTime(getField(g, ["startTime"], ""));
      const status = getField(g, ["status"], "");
      const sh = getField(g, ["homeScore"], "");
      const sa = getField(g, ["awayScore"], "");
      const score = (sh !== "" || sa !== "") ? `<span class="pill">${esc(sh)} - ${esc(sa)}</span>` : "";

      return `
        <div class="card">
          <div class="row">
            <div class="league">${esc(league)}</div>
            <div class="row" style="align-items:center;gap:8px">
              <div class="time">${esc(time)}</div>
              ${score}
            </div>
          </div>
          <div class="teams">${esc(home)} <b>vs</b> ${esc(away)}</div>
          <div class="status">${esc(label)}${status ? " — " + esc(status) : ""}</div>
        </div>
      `;
    }).join("");
  }

  async function fetchJson(url, signal){
    const res = await fetch(url, { cache:"no-store", signal });
    const payload = await res.json();
    if (!res.ok) throw new Error(`API ${res.status}: ${JSON.stringify(payload).slice(0,200)}`);
    return payload;
  }

  async function loadGames(){
    btn.disabled = true;
    setMeta("A carregar…");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try{
      // 1) tenta LIVE
      let payload = await fetchJson(API_LIVE, controller.signal);
      let games = normalizeGames(payload);

      if (games.length > 0){
        setMeta(`LIVE — ${games.length} jogos.`, "ok");
        renderGames(games, "LIVE");
        return;
      }

      // 2) se não houver live, tenta PRÓXIMOS
      payload = await fetchJson(API_NEXT, controller.signal);
      games = normalizeGames(payload);

      if (games.length > 0){
        setMeta(`PRÓXIMOS — ${games.length} jogos.`, "ok");
        renderGames(games, "PRÓXIMOS");
        return;
      }

      setMeta("Sem jogos agora.", "err");
      renderMessage("Sem jogos AO VIVO e sem PRÓXIMOS no endpoint.", true);

    } catch (e){
      console.error(e);
      setMeta("Erro a pedir API.", "err");
      renderMessage("Erro a pedir o API. Abre o Console/Network para ver.", true);
    } finally {
      clearTimeout(timeout);
      btn.disabled = false;
    }
  }

  btn.addEventListener("click", loadGames);
  loadGames();
})();
