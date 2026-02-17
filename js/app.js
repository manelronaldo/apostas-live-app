const API_URL = "https://apostas-live-api-manelronaldo1.workers.dev/live";

async function loadGames(){

  const container = document.getElementById("games");
  container.innerHTML = "A carregar jogos...";

  try{

    const res = await fetch(API_URL);
    const data = await res.json();

    console.log("API:", data);

    container.innerHTML = "";

    if(!data.results || data.results.length === 0){
      container.innerHTML = "Sem jogos disponíveis.";
      return;
    }

    data.results.forEach(league => {

      if(!league.stage) return;

      league.stage.forEach(stage => {

        if(!stage.matches) return;

        stage.matches.forEach(match => {

          const div = document.createElement("div");
          div.className = "game";

          div.innerHTML = `
            <b>${match.teams.home.name} vs ${match.teams.away.name}</b><br>
            Liga: ${league.league_name}<br>
            Hora: ${match.time}<br>
            País: ${league.country.name}
          `;

          container.appendChild(div);

        });

      });

    });

  }catch(err){
    console.error(err);
    container.innerHTML = "Erro ao carregar jogos.";
  }
}

loadGames();
