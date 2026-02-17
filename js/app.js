// ===============================
// APOSTAS LIVE APP - APP.JS FINAL
// ===============================

// 🔥 URL do teu Worker (API)
const API_BASE = "https://apostas-live-api.manelronaldo1.workers.dev";

// 🔐 password definida no Cloudflare
const APP_PASSWORD = "APOSTAS2026";


// ===============================
// ELEMENTOS
// ===============================
const els = {
  list: document.getElementById("list"),
  detail: document.getElementById("detail"),
  detailTitle: document.getElementById("detailTitle"),
  detailBody: document.getElementById("detailBody"),
};


// ===============================
// FETCH BASE (com password)
// ===============================
async function apiFetch(path) {
  const res = await fetch(API_BASE + path, {
    headers: {
      "x-app-password": APP_PASSWORD
    }
  });

  if (!res.ok) throw new Error("API error");

  return await res.json();
}


// ===============================
// CARREGAR JOGOS AO VIVO
// ===============================
async function loadGames() {
  if (!els.list) return;

  els.list.innerHTML = "A carregar jogos...";

  try {
    const data = await apiFetch("/live");

    if (!data || !data.results || !data.results.length) {
      els.list.innerHTML = "Sem jogos ao vivo neste momento.";
      return;
    }

    renderGames(data.results);

  } catch (err) {
    console.error(err);
    els.list.innerHTML = "Erro ao carregar jogos.";
  }
}


// ===============================
// RENDER JOGOS
// ===============================
function renderGames(matches) {
  els.list.innerHTML = "";

  matches.forEach(match => {

    const div = document.createElement("div");
    div.className = "card";

    const home = match.teams?.home?.name || "Home";
    const away = match.teams?.away?.name || "Away";
    const league = match.league_name || "";
    const time = match.time || "";

    div.innerHTML = `
      <h3>${home} vs ${away}</h3>
      <p>${league} • ${time}</p>
    `;

    div.onclick = () => openDetail(match);

    els.list.appendChild(div);
  });
}


// ===============================
// DETALHE DO JOGO
// ===============================
function openDetail(match) {
  if (!els.detailTitle || !els.detailBody) return;

  const home = match.teams?.home?.name || "";
  const away = match.teams?.away?.name || "";

  els.detailTitle.innerText = `${home} vs ${away}`;

  els.detailBody.innerHTML = `
    <p>Liga: ${match.league_name || "-"}</p>
    <p>Estado: ${match.status || "-"}</p>
    <p>Minuto: ${match.minute || "-"}</p>
  `;
}


// ===============================
// INICIAR APP
// ===============================
document.addEventListener("DOMContentLoaded", () => {
  loadGames();
});
