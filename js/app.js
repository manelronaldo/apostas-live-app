const API_URL = "https://apostas-live-api.manelronaldo1.workers.dev";

async function loadGames(){

    const container = document.getElementById("games-list");
    container.innerHTML = "A carregar...";

    const res = await fetch(API_URL);
    const data = await res.json();

    container.innerHTML = "";

    function render(matches){
        matches.forEach(m => {

            const div = document.createElement("div");
            div.className = "game";

            div.innerHTML = `
            <b>${m.teams.home.name}</b> vs
            <b>${m.teams.away.name}</b><br>
            ${m.league?.name || ""}
            `;

            container.appendChild(div);
        });
    }

    render(data.live);
    render(data.today);
}

loadGames();
