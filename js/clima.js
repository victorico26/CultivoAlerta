// CultivoAlerta · Módulo 1: vigor y temperatura del territorio (parte de clima en la finca).
// Temperatura del aire y del suelo, heladas, lluvia y balance hídrico en el centro de la finca (Open-Meteo, gratis, sin clave).
// El vigor (NDVI, NDMI) y la temperatura de superficie satelital (LST de Landsat y MODIS) se calculan en Google Earth Engine
// con el script gee/cultivoalerta_vigor_temperatura.js.
"use strict";

async function climaFinca(punto) {
  const [lon, lat] = punto.map((v) => v.toFixed(3));
  const u = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}`
    + "&current=temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m"
    + "&hourly=temperature_2m,soil_temperature_0cm,soil_temperature_6cm,soil_moisture_3_to_9cm"
    + "&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,et0_fao_evapotranspiration"
    + "&past_days=31&forecast_days=16&timezone=America%2FBogota";
  const d = await pedirJson(u);
  const hoy = d.current?.time?.slice(0, 10) ?? new Date().toISOString().slice(0, 10);
  // Temperatura mínima del suelo en superficie por día (la helada se forma en la superficie antes que a 2 m)
  const sueloMin = new Map(), sueloAhora = { t0: null, t6: null, hum: null };
  const ahora = Date.now();
  d.hourly.time.forEach((t, i) => {
    const dia = t.slice(0, 10), v = d.hourly.soil_temperature_0cm[i];
    if (v != null) sueloMin.set(dia, Math.min(sueloMin.get(dia) ?? Infinity, v));
    if (aMs(t) <= ahora) { sueloAhora.t0 = v ?? sueloAhora.t0; sueloAhora.t6 = d.hourly.soil_temperature_6cm[i] ?? sueloAhora.t6; sueloAhora.hum = d.hourly.soil_moisture_3_to_9cm[i] ?? sueloAhora.hum; }
  });
  const dias = d.daily.time.map((t, i) => ({ dia: t, tmax: d.daily.temperature_2m_max[i], tmin: d.daily.temperature_2m_min[i], lluvia: d.daily.precipitation_sum[i] ?? 0,
    et0: d.daily.et0_fao_evapotranspiration[i] ?? 0, sueloMin: sueloMin.get(t) ?? null, pasado: t < hoy, esHoy: t === hoy }));
  const pasados = dias.filter((x) => x.pasado), futuros = dias.filter((x) => !x.pasado);
  const lluvia30 = pasados.slice(-30).reduce((a, x) => a + x.lluvia, 0), et030 = pasados.slice(-30).reduce((a, x) => a + x.et0, 0);
  let secos = 0;
  for (let i = pasados.length - 1; i >= 0 && pasados[i].lluvia < 1; i--) secos++;
  return { actual: d.current, sueloAhora, dias, hoy, lluvia30, et030, balance30: lluvia30 - et030, secos, alertas: alertasClima(futuros, lluvia30 - et030, secos) };
}

function alertasClima(futuros, balance, secos) {
  const a = [], prox = futuros.slice(0, 7), fmt = (dia) => new Date(`${dia}T12:00:00-05:00`).toLocaleDateString("es-CO", { weekday: "short", day: "numeric", month: "short" });
  const helada = prox.filter((x) => x.tmin <= 0), riesgo = prox.filter((x) => x.tmin > 0 && (x.tmin <= 3 || (x.sueloMin != null && x.sueloMin <= 0)));
  if (helada.length) a.push({ nivel: "alta", titulo: "Helada pronosticada", texto: `Mínima de ${helada[0].tmin.toFixed(1)} °C el ${fmt(helada[0].dia)}. Riegue al atardecer y cubra los cultivos sensibles.` });
  if (riesgo.length) a.push({ nivel: "media", titulo: "Riesgo de helada en la madrugada", texto: `${riesgo.length} día(s) con mínima de 3 °C o menos o el suelo a 0 °C (primero: ${fmt(riesgo[0].dia)}, ${riesgo[0].tmin.toFixed(1)} °C).` });
  const calor = prox.filter((x) => x.tmax >= 24);
  if (calor.length) a.push({ nivel: "media", titulo: "Calor inusual para la Sabana", texto: `Máxima de ${Math.max(...calor.map((x) => x.tmax)).toFixed(1)} °C en los próximos 7 días: más evaporación y estrés del cultivo.` });
  if (balance < -40) a.push({ nivel: balance < -80 ? "alta" : "media", titulo: "Déficit de agua en el suelo", texto: `En los últimos 30 días llovió ${Math.abs(balance).toFixed(0)} mm menos de lo que pierde el cultivo por evapotranspiración.` });
  if (secos >= 10) a.push({ nivel: secos >= 20 ? "alta" : "media", titulo: "Racha seca", texto: `${secos} días seguidos sin lluvia de 1 mm o más.` });
  const lluviaSem = prox.reduce((s, x) => s + x.lluvia, 0);
  if (lluviaSem >= 60) a.push({ nivel: "media", titulo: "Lluvias fuertes en la semana", texto: `${lluviaSem.toFixed(0)} mm pronosticados en 7 días. Revise el simulador de inundación con el pronóstico.` });
  if (!a.length) a.push({ nivel: "ok", titulo: "Sin alertas de temperatura ni de agua", texto: "Las condiciones de los próximos 7 días están dentro de lo habitual." });
  return a;
}
