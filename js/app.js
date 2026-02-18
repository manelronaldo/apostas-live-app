(() => {
  // Teu Worker/API
  const API_URL = "https://apostas-live-api.manelronaldo1.workers.dev/";

  const btn = document.getElementById("btnRefresh");
  const meta = document.getElementById("meta");
  const gamesEl = document.getElementById("games");

  function esc(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function setMeta(text, type = "") {
    meta.textContent = text;
    meta.className = "meta" + (type ? " " + type : "");
  }

  function renderMessage(msg, isError = false) {
    gamesEl.innerHTML = `<div class="card ${isError ? "err" : ""}">${esc(msg)}</div>`;
  }

  // Suporta vários formatos que o Worker pode devolver
  function normalizePayload(payload) {
    if (Array.isArray(payload)) return payload;
    if (payload && Array.isArray(payload.games)) return payload.games;
    if (payload && Array.isArray(payload.data)) return payload.data;
    if (payload && Array.isArray(payload.events)) return payload.events;
    if (payload && Array.isArray(payload.matches)) return payload.matches;
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
      renderMessage("O API respondeu mas veio lista vazia (0 jogos).", true);
      return;
    }

    // tentar ordenar por data/hora
    list.sort((a, b) => {
      const ta = Date.parse(getField(a, ["startTime", "start", "date", "kickoff", "time"], "")) || 0;
      const tb = Date.parse(getField(b, ["startTime", "start", "date", "kickoff", "time"], "")) || 0;
      return ta - tb;
    });

    gamesEl.innerHTML = list.map((g) => {
      const league = getField(g, ["league", "competition", "tournament", "liga"], "—");
      const home = getField(g, ["homeTeam", "home", "team1", "casa"], "—");
      const away = getField(g, ["awayTeam", "away", "team2", "fora"], "—");

      const startRaw = getField(g, ["startTime", "start", "date", "kickoff", "time"], "");
      const time = startRaw ? new Date(startRaw).toLocaleString() : getField(g, ["clock", "minute", "statusTime"], "");

      const status = getField(g, ["status", "state", "phase"], "");
      const scoreHome = getField(g, ["homeScore", "scoreHome", "golsCasa", "goalsHome"], "");
      const scoreAway = getField(g, ["awayScore", "scoreAway", "golsFora", "goalsAway"], "");

      const score =
        (scoreHome !== "" || scoreAway !== "")
          ? `<span class="pill">${esc(scoreHome)} - ${esc(scoreAway)}</span>`
          : "";

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

  async function loadGames() {
    btn.disabled = true;
    setMeta("A carregar jogos…");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
      const res = await fetch(API_URL, {
        method: "GET",
        cache: "no-store",
        signal: controller.signal,
      });

      const text = await res.text();
      let payload;

      try {
        payload = JSON.parse(text);
      } catch {
        console.error("Resposta não é JSON:", text);
        setMeta("Erro: API não devolveu JSON.", "err");
        renderMessage("O API respondeu, mas não veio JSON válido. Vê o Console.", true);
        return;
      }

      if (!res.ok) {
        console.error("API erro:", res.status, payload);
        setMeta(`Erro do API: ${res.status}`, "err");
        renderMessage(`API respondeu erro ${res.status}. Vê o Console.`, true);
        return;
      }

      const games = normalizePayload(payload);

      console.log("API payload:", payload);
      console.log("Games normalizados:", games);

      setMeta(`OK — ${games.length} jogos carregados.`, "ok");
      renderGames(games);
    } catch (err) {
      console.error("Falha no fetch:", err);
      setMeta("Falha a pedir o API.", "err");
      renderMessage(
        err?.name === "AbortError"
          ? "Timeout a pedir o API (15s)."
          : "Falha a pedir o API (CORS / rede / Worker). Vê o Console.",
        true
      );
    } finally {
      clearTimeout(timeout);
      btn.disabled = false;
    }
  }

  btn.addEventListener("click", loadGames);
  loadGames();
})();
