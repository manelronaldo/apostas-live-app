(() => {
  // ✅ ESTE É O PASSO 5 — e é OBRIGATÓRIO
  const API_URL = "https://apostas-live-api.manelronaldo1.workers.dev/jogos";

  const btn = document.getElementById("btnRefresh");
  const meta = document.getElementById("meta");
  const gamesEl = document.getElementById("games");

  function esc(s) {
    return String(s ?? "")
      .replaceAll("&","&amp;")
      .replaceAll("<","&lt;")
      .replaceAll(">","&gt;")
      .replaceAll('"',"&quot;")
      .replaceAll("'","&#039;");
  }

  function setMeta(text, type = "") {
    meta.textContent = text;
    meta.className = "meta" + (type ? " " + type : "");
  }

  function renderMessage(msg, isError = false) {
    gamesEl.innerHTML = `<div class="card ${isError ? "err" : ""}">${esc(msg)}</div>`;
  }

  function normalizePayload(payload) {
    if (payload && Array.isArray(payload.games)) return payload.games;
    if (Array.isArray(payload)) return payload;
    if (payload && Array.isArray(payload.data)) return payload.data;
    if (payload && Array.isArray(payload.results)) return payload.results;
    return [];
  }

  function getField(obj, keys, fallback = "") {
    for (const k of keys) {
      if (obj && obj[k] !== undefined && obj[k] !== null && obj[k] !== "") return obj[k];
    }
    return fallback;
  }

  function renderGames(list) {
    if (!list.length) {
      renderMessage("Não há jogos a aparecer (0). Pode ser que não existam jogos AO VIVO agora.", true);
      return;
    }

    gamesEl.innerHTML = list.map((g) => {
      const league = getField(g, ["league"], "—");
      const home = getField(g, ["homeTeam","home","team1"], "—");
      const away = getField(g, ["awayTeam","away","team2"], "—");
      const startRaw = getField(g, ["startTime","date","time"], "");
      const time = startRaw ? new Date(startRaw).toLocaleString() : "";

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
          ${status ? `<div class="status">Estado: ${esc(status)}</div>` : ""}
        </div>
      `;
    }).join("");
  }

  async function loadGames() {
    btn.disabled = true;
    setMeta("A carregar jogos…");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
      const res = await fetch(API_URL, { cache: "no-store", signal: controller.signal });
      const payload = await res.json();

      if (!res.ok) {
        console.error("API erro:", res.status, payload);
        setMeta(`Erro API: ${res.status}`, "err");
        renderMessage("Erro a pedir jogos. Vê o Console.", true);
        return;
      }

      const games = normalizePayload(payload);
      setMeta(`OK — ${games.length} jogos carregados.`, "ok");
      renderGames(games);
    } catch (e) {
      console.error(e);
      setMeta("Falha a pedir o API.", "err");
      renderMessage(e?.name === "AbortError" ? "Timeout (15s)." : "Falha de rede/CORS/Worker.", true);
    } finally {
      clearTimeout(timeout);
      btn.disabled = false;
    }
  }

  btn.addEventListener("click", loadGames);
  loadGames();
})();
