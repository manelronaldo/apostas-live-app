export async function handler(event) {
  try {
    const API_KEY = "32ef306218be45adcdb0932acf553c2535d7b055";
    const BASE_URL = "https://app.soccerdataapi.com/api/v1";

    // datas (YYYY-MM-DD) - se não vier nada, usamos hoje
    const today = new Date().toISOString().slice(0, 10);
    const date_from = event.queryStringParameters?.date_from || today;
    const date_to = event.queryStringParameters?.date_to || today;

    // endpoint (ajusta aqui se o teu painel da SoccerdataAPI usar outro path)
    const url = `${BASE_URL}/matches?date_from=${encodeURIComponent(date_from)}&date_to=${encodeURIComponent(date_to)}`;

    const res = await fetch(url, {
      headers: {
        // alguns serviços aceitam "Authorization", outros "x-api-key"
        "Authorization": API_KEY,
        "x-api-key": API_KEY,
        "Accept": "application/json",
      },
    });

    const text = await res.text();

    return {
      statusCode: res.status,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, x-api-key",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Content-Type": "application/json",
      },
      body: text,
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ error: String(err) }),
    };
  }
}
