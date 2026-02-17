// ================================
// CONFIG
// ================================
const API_BASE = "https://apostas-live-api.manelronaldo1.workers.dev";

// ================================
// FETCH SIMPLES (SEM PASSWORD)
// ================================
async function apiFetch(path) {
  const res = await fetch(`${API_BASE}${path}`);

  if (!res.ok) {
    throw new Error("Erro HTTP: " + res.status);
  }

  return res.json();
}

// ================================
// RENDER DOS JOGOS
// ================================
function renderGames(data) {
  const container = document.querySelector("#games-list");

  if (!container) return;

  container.innerHTML = "";

  if (!data || !data.results || !data.results.length) {
    container.innerHTML = `<div>Sem jogos disponíveis.</div>`;
    return;
  }

  data.results.forEach(league => {
    league.stage.forEach(stage => {
      stage.matches.forEach(match => {

        const el = document.createElement("div");
        el.className = "game-item";

        el.innerHTML = `
          <div class="game">
            <strong>${match.teams.home.name}</strong>
            vs
            <strong>${match.teams.away.name}</strong>
            <br>
            <small>${league.league_name} • ${match.time}</small>
          </div>
        `;

        container.appendChild(el);
      });
    });
  });
}

// ================================
// LOAD GAMES
// ================================
async function loadGames() {
  const container = document.querySelector("#games-list");

  try {
    container.innerHTML = "A carregar jogos...";

    const data = await apiFetch("/live");

    console.log("DATA:", data);

    renderGames(data);

  } catch (err) {
    console.error(err);
    container.innerHTML = "Erro ao carregar jogos.";
  }
}

// ================================
// START
// ================================
document.addEventListener("DOMContentLoaded", () => {
  loadGames();
});
