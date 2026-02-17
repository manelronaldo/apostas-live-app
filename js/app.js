const API_URL = "https://apostas-live-api.manelronaldo1.workers.dev";

async function loadGames(){

    const container = document.getElementById("games-list");

    if(!container){
        console.log("DIV games-list não existe");
        return;
    }

    container.innerHTML = "A carregar jogos...";

    try{

        const res = await fetch(API_URL);
        const data = await res.json();

        console.log("API:", data);

        container.innerHTML = "";

        function render(matches){
            if(!matches) return;

            matches.forEach(m => {

                const div = document.createElement("div");
                div.style.margin = "10px";
                div.style.padding = "10px";
                div.style.background = "#0f1b2b";
                div.style.borderRadius = "8px";

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

    }catch(e){
        container.innerHTML = "Erro ao carregar jogos";
        console.log(e);
    }
}

loadGames();
