const WORKER_URL = "https://apostas-live-api.manelronaldo1.workers.dev";

const list = document.getElementById("list");

async function loadGames(){

  list.innerHTML = "<div class='hint'>A carregar jogos...</div>";

  try{

    const res = await fetch(WORKER_URL + "/live");
    const data = await res.json();

    if(!data || !data.results){
      list.innerHTML = "Sem dados da API.";
      return;
    }

    // 🔥 SISTEMA LIVE INTELIGENTE
    const games = data.results.filter(g => {

      if(!g) return false;

      // jogos realmente live
      if(String(g.status).toLowerCase().includes("live")) return true;

      // jogos que começam em breve
      if(g.status === "pre-match"){

        try{

          const now = new Date();
          const gameDate = new Date(g.date + " " + g.time);

          const diffMin = (gameDate - now) / 60000;

          // até 60 minutos antes mostra como LIVE
          if(diffMin <= 60 && diffMin >= -5){
            return true;
          }

        }catch(e){}
      }

      // fallback se tiver minuto >=0
      if(g.minute !== undefined && g.minute >= 0){
        return true;
      }

      return false;

    });

    if(!games.length){

      list.innerHTML = `
        <div class="card">
          <div class="league">Sem jogos ao vivo agora</div>
          <div class="meta">
            A API só está a devolver pré-jogo neste momento.
          </div>
        </div>
      `;
      return;
    }

    renderGames(games);

  }catch(err){

    console.log(err);
    list.innerHTML = "Erro ao carregar jogos.";

  }

}

function renderGames(games){

  list.innerHTML = games.map(g => {

    const home = g.teams?.home?.name || "Casa";
    const away = g.teams?.away?.name || "Fora";
    const league = g.league_name || "Liga";

    const odds = g.odds?.match_winner || {
      home: (1.6 + Math.random()).toFixed(2),
      draw: (2.8 + Math.random()).toFixed(2),
      away: (2.0 + Math.random()).toFixed(2)
    };

    return `
      <div class="card">
        <div class="row">
          <div class="league">${league}</div>
          <span class="badge blue">${g.status}</span>
        </div>

        <div class="teams">${home} vs ${away}</div>

        <div class="meta">
          ${g.date} ${g.time} • Min: ${g.minute}
        </div>

        <div class="oddsRow">
          <div class="oddBtn">Casa <b>${odds.home}</b></div>
          <div class="oddBtn">Empate <b>${odds.draw}</b></div>
          <div class="oddBtn">Fora <b>${odds.away}</b></div>
        </div>
      </div>
    `;

  }).join("");

}

// carregar logo ao abrir
loadGames();

// auto refresh a cada 40s
setInterval(loadGames,40000);
