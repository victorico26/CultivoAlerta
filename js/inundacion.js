// CultivoAlerta · Módulo 2: simulador de inundación sobre la finca.
// Relieve: teselas Terrarium (AWS Terrain Tiles, SRTM ~30 m). Ríos, lagunas, canales, edificios y coberturas: mapa base
// OpenStreetMap (OpenMapTiles de OpenFreeMap). Lluvia, evaporación y humedad del suelo: Open-Meteo (ERA5 para La Niña,
// pronóstico para los próximos 16 días). Método del relieve, la grilla y el suelo adaptado del simulador de Diamela Dego.
"use strict";

const TERRARIUM = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";
const MARGEN_KM = 0.5;      // terreno real alrededor del círculo: el agua de afuera entra y la de adentro no sale por un borde falso
const MAX_CELDAS = 12000;   // tope de celdas del modelo (unos segundos a un minuto por corrida en un computador normal)
const CELDA_M = 30;         // celda del modelo (se duplica en círculos grandes)
const AGUA_MIN = 0.1;       // desde 10 cm se cuenta como superficie inundada
const AGUA_VER = 0.03;      // se dibuja desde 3 cm
const ZONA_BOG = "&timezone=America%2FBogota";
const TEXTURAS = {   // Green-Ampt (Rawls, Brakensiek y Miller 1983): conductividad (mm/h), succión (mm), porosidad
  arenoso: { ks: 117.8, psi: 49.5, thetaS: 0.437, nombre: "Arenoso" },
  "franco arenoso": { ks: 10.9, psi: 110.1, thetaS: 0.453, nombre: "Franco arenoso" },
  franco: { ks: 3.4, psi: 88.9, thetaS: 0.463, nombre: "Franco" },
  "franco limoso": { ks: 6.5, psi: 166.8, thetaS: 0.501, nombre: "Franco limoso" },
  "franco arcilloso": { ks: 1.0, psi: 208.8, thetaS: 0.464, nombre: "Franco arcilloso" },
  "arcilloso limoso": { ks: 0.5, psi: 292.2, thetaS: 0.479, nombre: "Arcilloso limoso" },
  arcilloso: { ks: 0.3, psi: 316.3, thetaS: 0.475, nombre: "Arcilloso" },
};
// Temporadas La Niña (ONI de NOAA) con lluvias fuertes en Colombia: la tabla de referencia del simulador
const NINAS = {
  "2010-11": { nombre: "La Niña 2010-2011 (fuerte)", desde: "2010-06-01", hasta: "2011-06-30" },
  "2021-22": { nombre: "La Niña 2021-2022", desde: "2021-09-01", hasta: "2022-12-31" },
  "2007-08": { nombre: "La Niña 2007-2008", desde: "2007-09-01", hasta: "2008-06-30" },
};
const COLOR_AGUA = [[0.03, [225, 240, 248, 0.55]], [0.1, [140, 196, 236, 0.8]], [0.3, [64, 140, 214, 0.88]], [0.6, [36, 88, 178, 0.92]], [1, [34, 52, 132, 0.95]], [2, [26, 29, 82, 0.97]]];

// ---------- Teselas y coordenadas ----------
const lonDeX = (x, z) => (x / 2 ** z) * 360 - 180;
const latDeY = (y, z) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** z))) * 180) / Math.PI;
const xDeLon = (lon, z) => ((lon + 180) / 360) * 2 ** z;
const yDeLat = (lat, z) => ((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * 2 ** z;

function lienzo(w, h) {
  const cv = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(w, h) : Object.assign(document.createElement("canvas"), { width: w, height: h });
  return { cv, c: cv.getContext("2d", { willReadFrequently: true }) };
}

async function relieveDe(caja, km) {
  const [x0, y0, x1, y1] = caja;
  let z = km <= 1.5 ? 14 : km <= 3 ? 13 : 12;
  while (z > 10 && (Math.floor(xDeLon(x1, z)) - Math.floor(xDeLon(x0, z)) > 7 || Math.floor(yDeLat(y0, z)) - Math.floor(yDeLat(y1, z)) > 7)) z--;
  const tx0 = Math.floor(xDeLon(x0, z)), tx1 = Math.floor(xDeLon(x1, z)), ty0 = Math.floor(yDeLat(y1, z)), ty1 = Math.floor(yDeLat(y0, z));
  const W = (tx1 - tx0 + 1) * 256, H = (ty1 - ty0 + 1) * 256;
  const { c } = lienzo(W, H), teselas = [];
  for (let tx = tx0; tx <= tx1; tx++) for (let ty = ty0; ty <= ty1; ty++) teselas.push([tx, ty]);
  await Promise.all(teselas.map(async ([tx, ty]) => {
    const r = await fetch(TERRARIUM.replace("{z}", z).replace("{x}", tx).replace("{y}", ty));
    if (!r.ok) throw new Error(`No se pudo descargar el relieve (${r.status})`);
    c.drawImage(await createImageBitmap(await r.blob()), (tx - tx0) * 256, (ty - ty0) * 256);
  }));
  const px = c.getImageData(0, 0, W, H).data, h = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) h[i] = px[4 * i] * 256 + px[4 * i + 1] + px[4 * i + 2] / 256 - 32768;
  return { W, H, z, tx0, ty0, h };
}

// Rasgos del mapa base (OpenStreetMap) ya cargados en el mapa
function rasgosBase(capa, filtro = () => true) {
  const fuentes = mapa.getStyle()?.sources ?? {};
  const id = fuentes.openmaptiles ? "openmaptiles" : Object.entries(fuentes).find(([, f]) => f.type === "vector")?.[0];
  return id ? mapa.querySourceFeatures(id, { sourceLayer: capa }).filter(filtro) : [];
}
function trazar(c, geom, aCel, ancho = 0) {
  const cs = geom.coordinates, t = geom.type;
  const anillos = t === "Polygon" ? cs : t === "MultiPolygon" ? cs.flat() : t === "LineString" ? [cs] : t === "MultiLineString" ? cs : [];
  c.beginPath();
  for (const a of anillos) { a.forEach(([lo, la], j) => { const [x, y] = aCel(lo, la); j ? c.lineTo(x, y) : c.moveTo(x, y); }); if (!ancho) c.closePath(); }
  if (ancho) { c.lineWidth = ancho; c.stroke(); } else c.fill("evenodd");
}
function leerFraccion(c, n) { const p = c.getImageData(0, 0, c.canvas.width, c.canvas.height).data, out = new Float32Array(n); for (let i = 0; i < n; i++) out[i] = p[4 * i + 3] / 255; return out; }
function minimoVentana(a, nx, ny, r) {
  const out = new Float32Array(a.length);
  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    let m = Infinity;
    for (let yy = Math.max(0, y - r); yy <= Math.min(ny - 1, y + r); yy++) for (let xx = Math.max(0, x - r); xx <= Math.min(nx - 1, x + r); xx++) m = Math.min(m, a[yy * nx + xx]);
    out[y * nx + x] = m;
  }
  return out;
}

// Encuadra el mapa en el área y espera a que carguen las teselas del mapa base
async function encuadrarYEsperar(caja) {
  mapa.fitBounds([[caja[0], caja[1]], [caja[2], caja[3]]], { padding: 30, duration: 0, pitch: mapa.getPitch() });
  await new Promise((ok) => { let listo = false; const fin = () => { if (!listo) { listo = true; ok(); } }; mapa.once("idle", fin); setTimeout(fin, 8000); });
}

// ---------- Terreno y grilla del modelo ----------
async function prepararTerreno(finca, circ, avisar = () => {}) {
  const s = { punto: circ.centro, km: circ.km };
  const caja = cajaCirculo(s.punto, s.km + MARGEN_KM);
  avisar("Descargando relieve y mapa base…");
  const [D] = await Promise.all([relieveDe(caja, s.km), encuadrarYEsperar(caja)]);
  const metrosPx = (40075016 * Math.cos((s.punto[1] * Math.PI) / 180)) / (256 * 2 ** D.z);
  const aPx = (lon, lat) => [(xDeLon(lon, D.z) - D.tx0) * 256, (yDeLat(lat, D.z) - D.ty0) * 256];
  const [px0, py1] = aPx(caja[0], caja[1]), [px1, py0] = aPx(caja[2], caja[3]);
  const bx0 = Math.max(0, Math.floor(px0)), by0 = Math.max(0, Math.floor(py0));
  let f = Math.max(1, Math.round(CELDA_M / metrosPx));
  while (((px1 - bx0) / f) * ((py1 - by0) / f) > MAX_CELDAS) f++;   // círculos grandes: celdas más grandes
  const nx = Math.floor((Math.min(D.W, Math.ceil(px1)) - bx0) / f), ny = Math.floor((Math.min(D.H, Math.ceil(py1)) - by0) / f), N = nx * ny;
  const dx = f * metrosPx;
  const aCel = (lo, la) => { const [x, y] = aPx(lo, la); return [(x - bx0) / f, (y - by0) / f]; };
  avisar("Armando la grilla del modelo…");
  // Altura media de cada celda
  const z = new Float32Array(N);
  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    let suma = 0;
    for (let yy = 0; yy < f; yy++) for (let xx = 0; xx < f; xx++) suma += D.h[(by0 + y * f + yy) * D.W + bx0 + x * f + xx];
    z[y * nx + x] = suma / (f * f);
  }
  // Agua del mapa base: ríos (nivel fijo + crecida), lagunas y humedales (guardan agua) y cauces chicos (grabados en el terreno)
  const rio = lienzo(nx, ny), lag = lienzo(nx, ny), cau = lienzo(nx, ny);
  rio.c.fillStyle = lag.c.fillStyle = "#000"; rio.c.strokeStyle = "#000"; rio.c.lineCap = cau.c.lineCap = "round";
  let nRios = 0, nLagunas = 0;
  for (const ft of rasgosBase("water")) {
    const cl = ft.properties.class;
    if (cl === "river" || cl === "ocean") { trazar(rio.c, ft.geometry, aCel); nRios++; } else { trazar(lag.c, ft.geometry, aCel); nLagunas++; }
  }
  for (const ft of rasgosBase("waterway")) {
    const cl = ft.properties.class;
    if (cl === "river") { trazar(rio.c, ft.geometry, aCel, Math.max(1, 30 / dx)); nRios++; }
    else { cau.c.strokeStyle = `rgba(0,0,0,${cl === "canal" ? 1 : 0.5})`; trazar(cau.c, ft.geometry, aCel, Math.max(1, 10 / dx)); }
  }
  const fr = leerFraccion(rio.c, N), fl = leerFraccion(lag.c, N), fc = leerFraccion(cau.c, N);
  const tipo2 = new Uint8Array(N).fill(1), cauce = new Float32Array(N), lago = new Int32Array(N).fill(-1);
  for (let i = 0; i < N; i++) {
    if (fr[i] > 0.35) tipo2[i] = 3; else if (fl[i] > 0.5) tipo2[i] = 2;
    else if (fc[i] > 0.15) { cauce[i] = Math.round(fc[i] * 2 * 2) / 2; z[i] -= cauce[i]; }
  }
  // Lagunas pegadas al río: son parte del río
  const pila0 = [];
  for (let c = 0; c < N; c++) if (tipo2[c] === 3) pila0.push(c);
  while (pila0.length) {
    const k = pila0.pop(), x = k % nx, y = (k / nx) | 0;
    for (const [vx, vy] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) { const v = vy * nx + vx; if (vx >= 0 && vy >= 0 && vx < nx && vy < ny && tipo2[v] === 2) { tipo2[v] = 3; pila0.push(v); } }
  }
  let nl = 0;
  for (let c = 0; c < N; c++) {
    if (tipo2[c] !== 2 || lago[c] >= 0) continue;
    const pila = [c]; lago[c] = nl;
    while (pila.length) {
      const k = pila.pop(), x = k % nx, y = (k / nx) | 0;
      for (const [vx, vy] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) { const v = vy * nx + vx; if (vx >= 0 && vy >= 0 && vx < nx && vy < ny && tipo2[v] === 2 && lago[v] < 0) { lago[v] = nl; pila.push(v); } }
    }
    nl++;
  }
  // Nivel base de cada celda de río: el mínimo del relieve a ~60 m (el satélite ve orillas y árboles más altos que el agua)
  const zmin = minimoVentana(z, nx, ny, 2), baseRio = new Float32Array(N);
  for (let i = 0; i < N; i++) if (tipo2[i] === 3) baseRio[i] = zmin[i];
  // Cobertura: impermeable (0 a 1) y rugosidad de Manning
  const imp = lienzo(nx, ny), monte = lienzo(nx, ny);
  const urbano = { residential: 0.5, commercial: 0.75, retail: 0.75, industrial: 0.7, railway: 0.4, hospital: 0.55, school: 0.45 };
  for (const ft of rasgosBase("landuse")) { const v = urbano[ft.properties.class]; if (v) { imp.c.fillStyle = `rgba(0,0,0,${v})`; trazar(imp.c, ft.geometry, aCel); } }
  imp.c.fillStyle = "rgba(0,0,0,0.9)";
  for (const ft of rasgosBase("building")) trazar(imp.c, ft.geometry, aCel);
  imp.c.strokeStyle = "rgba(0,0,0,0.95)";
  for (const ft of rasgosBase("transportation", (x) => ["motorway", "trunk", "primary", "secondary", "tertiary", "minor"].includes(x.properties.class))) trazar(imp.c, ft.geometry, aCel, Math.max(0.4, 9 / dx));
  monte.c.fillStyle = "#000";
  for (const ft of rasgosBase("landcover", (x) => x.properties.class === "wood")) trazar(monte.c, ft.geometry, aCel);
  const fi = leerFraccion(imp.c, N), fm = leerFraccion(monte.c, N), nMan = new Float32Array(N);
  for (let i = 0; i < N; i++) nMan[i] = 0.035 + 0.045 * fi[i] + 0.065 * fm[i];   // pasto 0,035 · urbano ~0,08 · bosque ~0,10
  // Máscaras: círculo y finca
  const lonC = new Float64Array(nx), latC = new Float64Array(ny);
  for (let x = 0; x < nx; x++) lonC[x] = lonDeX(D.tx0 + (bx0 + (x + 0.5) * f) / 256, D.z);
  for (let y = 0; y < ny; y++) latC[y] = latDeY(D.ty0 + (by0 + (y + 0.5) * f) / 256, D.z);
  const dentro = new Uint8Array(N);
  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) if (distanciaKm(s.punto, [lonC[x], latC[y]]) <= s.km) dentro[y * nx + x] = 1;
  const fin = lienzo(nx, ny); fin.c.fillStyle = "#000";
  trazar(fin.c, finca.geometry, aCel);
  const ff = leerFraccion(fin.c, N), enFinca = new Uint8Array(N);
  let nFinca = 0, nDentro = 0;
  for (let i = 0; i < N; i++) { if (ff[i] >= 0.5) { enFinca[i] = 1; nFinca++; } if (dentro[i]) nDentro++; }
  if (!nFinca) {   // finca más chica que una celda: la celda de su centro
    const [cx, cy] = aCel(...circ.centro), i = Math.min(ny - 1, Math.max(0, Math.floor(cy))) * nx + Math.min(nx - 1, Math.max(0, Math.floor(cx)));
    enFinca[i] = 1; nFinca = 1;
  }
  // Relieve fino (cada píxel de las teselas) para dibujar el borde del agua con más detalle que la celda
  const FW = nx * f, FH = ny * f, zFino = new Float32Array(FW * FH), dentroFino = new Uint8Array(FW * FH);
  const lonF = new Float64Array(FW), latF = new Float64Array(FH);
  for (let x = 0; x < FW; x++) lonF[x] = lonDeX(D.tx0 + (bx0 + x + 0.5) / 256, D.z);
  for (let y = 0; y < FH; y++) latF[y] = latDeY(D.ty0 + (by0 + y + 0.5) / 256, D.z);
  for (let y = 0; y < FH; y++) for (let x = 0; x < FW; x++) {
    zFino[y * FW + x] = D.h[(by0 + y) * D.W + bx0 + x];
    if (distanciaKm(s.punto, [lonF[x], latF[y]]) <= s.km) dentroFino[y * FW + x] = 1;
  }
  // Esquinas de la grilla para dibujarla sobre el mapa
  const esq = (px, py) => [lonDeX(D.tx0 + px / 256, D.z), latDeY(D.ty0 + py / 256, D.z)];
  const X0 = bx0, Y0 = by0, X1 = bx0 + nx * f, Y1 = by0 + ny * f;
  const coordenadas = [esq(X0, Y0), esq(X1, Y0), esq(X1, Y1), esq(X0, Y1)];
  let zf = [Infinity, -Infinity];
  for (let i = 0; i < N; i++) if (enFinca[i]) zf = [Math.min(zf[0], z[i]), Math.max(zf[1], z[i])];
  return { s, nx, ny, N, dx, f, FW, FH, zFino, dentroFino, zoom: D.z, gx0: D.tx0 * 256 + bx0, gy0: D.ty0 * 256 + by0, metrosPx, z, tipo2, lago, nLagos: nl, cauce, baseRio, imp: fi, nMan, dentro, enFinca, nFinca, nDentro, coordenadas,
    resumen: { rios: nRios, lagunas: nLagunas, celdaM: dx, altFinca: zf, hayRio: tipo2.some((t) => t === 3) } };
}

// ---------- Lluvia ----------
async function pedirJson(u, intentos = 2) {
  for (let k = 0; k < intentos; k++) {
    const r = await fetch(u).catch(() => null);
    if (r?.ok) return r.json();
    if (k + 1 < intentos) await new Promise((ok) => setTimeout(ok, 1500));
  }
  throw new Error("No se pudo consultar Open-Meteo (revisa la conexión o intenta en un minuto).");
}
const aMs = (t) => Date.parse(`${t}:00-05:00`);

// La peor tormenta de 72 h de una temporada La Niña en el punto (ERA5 de Open-Meteo, hora por hora)
// Resumen de la lluvia de una temporada en el punto (ERA5 diario): total, mes más lluvioso y peor racha de 3 días
async function lluviaTemporada(punto, T) {
  const [lon, lat] = punto.map((v) => v.toFixed(3));
  const d = await pedirJson(`https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&start_date=${T.desde}&end_date=${T.hasta}&daily=precipitation_sum${ZONA_BOG}`);
  const t = d.daily.time, p = d.daily.precipitation_sum.map((v) => v ?? 0), porMes = new Map();
  t.forEach((dia, i) => porMes.set(dia.slice(0, 7), (porMes.get(dia.slice(0, 7)) ?? 0) + p[i]));
  const [mes, mesMm] = [...porMes].reduce((a, b) => (b[1] > a[1] ? b : a));
  let racha = 0, rachaIni = t[0];
  for (let i = 2; i < p.length; i++) { const s3 = p[i] + p[i - 1] + p[i - 2]; if (s3 > racha) { racha = s3; rachaIni = t[i - 2]; } }
  return { total: p.reduce((a, b) => a + b, 0), meses: porMes.size, mes, mesMm, racha, rachaIni };
}
// Pronóstico hora por hora de los próximos 16 días (mejor modelo disponible para el punto)
async function lluviaPronostico(punto) {
  const [lon, lat] = punto.map((v) => v.toFixed(3));
  const d = await pedirJson(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=precipitation,et0_fao_evapotranspiration,soil_moisture_3_to_9cm&past_days=1&forecast_days=16${ZONA_BOG}`);
  const horas = d.hourly.time.map(aMs), ahora = Date.now();
  let k0 = horas.findIndex((t) => t > ahora - 3600e3); if (k0 < 0) k0 = 0;
  const ll = d.hourly.precipitation.slice(k0).map((v) => v ?? 0), et = d.hourly.et0_fao_evapotranspiration.slice(k0).map((v) => v ?? 0.1);
  const theta = d.hourly.soil_moisture_3_to_9cm.slice(0, k0 + 1).filter((v) => v != null).at(-1) ?? 0.3;
  return { tipo: "pronostico", titulo: "Pronóstico de los próximos 16 días", lluvia: ll, et0: et, theta, total: ll.reduce((x, y) => x + y, 0), pico: Math.max(...ll),
    inicio: horas[k0], fin: horas.at(-1), fuente: "Pronóstico Open-Meteo (mejor modelo para el punto)" };
}
// Tormenta definida por el usuario: forma triangular (hietograma del SCS simplificado)
function lluviaPersonalizada(mm, horas) {
  const w = Array.from({ length: horas }, (_, j) => 1 - Math.abs(((j + 0.5) / horas) * 2 - 1) + 0.15), s = w.reduce((a, b) => a + b, 0);
  const ll = w.map((v) => (v / s) * mm);
  return { tipo: "personalizada", titulo: `Tormenta de ${mm} mm en ${horas} h`, lluvia: ll, et0: ll.map(() => 0.1), theta: null, total: mm, pico: Math.max(...ll), inicio: null, fuente: "Escenario definido por el usuario" };
}

// ---------- Corrida ----------
// esc: escenario de lluvia; par: { suelo, theta0, crecida, factor, horasDespues }
function correrModelo(d, esc, par, alHora, alFin) {
  const antes = esc.tipo === "pronostico" ? 0 : 2, despues = esc.tipo === "pronostico" ? 0 : par.horasDespues ?? 24;
  const n = antes + esc.lluvia.length + despues;
  const lluvia = new Float32Array(n), et0 = new Float32Array(n).fill(0.12);
  esc.lluvia.forEach((v, j) => { lluvia[antes + j] = v * (par.factor ?? 1); et0[antes + j] = esc.et0[j] ?? 0.12; });
  const M = { d, esc, par, n, antes, lluvia, frames: [], stats: [], corriendo: true, inicio: esc.inicio ? esc.inicio - antes * 3600e3 : null };
  const w = (M.worker = crearTrabajadorHidraulico());
  w.onmessage = (e) => {
    const m = e.data;
    if (m.tipo === "hora") {
      const fr = new Uint16Array(m.h.length);
      for (let i = 0; i < fr.length; i++) fr[i] = Math.min(65535, Math.round(m.h[i] * 1000));
      M.frames.push(fr); M.stats.push(estadisticaHora(d, m.h));
      alHora?.(M, m.k, m.horas);
    } else if (m.tipo === "fin") {
      M.corriendo = false; M.cuenta = m.cuenta; M.hMax = m.hMax; w.terminate();
      M.resumen = resumenCorrida(M);
      alFin?.(M);
    }
  };
  w.onerror = (e) => { console.error(e); M.corriendo = false; alFin?.(M, e); };
  w.postMessage({ tipo: "iniciar", nx: d.nx, ny: d.ny, dx: d.dx, z: d.z, tipo2: d.tipo2, lago: d.lago, nMan: d.nMan, imp: d.imp, baseRio: d.baseRio,
    suelo: par.suelo, theta0: par.theta0, desague: 5, crecida: par.crecida ?? 0, lluvia, et0 });
  return M;
}
function estadisticaHora(d, h) {
  let nF = 0, nC = 0, maxF = 0, sumF = 0;
  for (let c = 0; c < d.N; c++) {
    if (d.tipo2[c] !== 1) continue;
    const p = h[c] - d.cauce[c];
    if (d.enFinca[c]) { if (p >= AGUA_MIN) { nF++; sumF += p; } if (p > maxF) maxF = p; }
    if (d.dentro[c] && p >= AGUA_MIN) nC++;
  }
  const ha = (nF * d.dx * d.dx) / 1e4;
  return { haFinca: ha, pctFinca: (100 * nF) / Math.max(1, d.nFinca), maxFinca: Math.max(0, maxF), mediaFinca: nF ? sumF / nF : 0, pctCirculo: (100 * nC) / Math.max(1, d.nDentro) };
}
function resumenCorrida(M) {
  let pico = 0, horasAgua = 0;
  M.stats.forEach((s, k) => { if (s.haFinca > M.stats[pico].haFinca) pico = k; if (s.pctFinca >= 5) horasAgua++; });
  let maxProf = 0;
  for (let c = 0; c < M.d.N; c++) if (M.d.enFinca[c] && M.d.tipo2[c] === 1) maxProf = Math.max(maxProf, M.hMax[c] - M.d.cauce[c]);
  const sp = M.stats[pico] ?? { haFinca: 0, pctFinca: 0, pctCirculo: 0 };
  // Nivel de amenaza para la finca (orientativo)
  const nivel = sp.pctFinca >= 25 || maxProf >= 0.5 ? "alta" : sp.pctFinca >= 5 || maxProf >= 0.2 ? "media" : sp.pctFinca > 0 ? "baja" : "sin";
  return { pico, horasAgua, maxProf: Math.max(0, maxProf), haPico: sp.haFinca, pctPico: sp.pctFinca, pctCirculoPico: sp.pctCirculo, nivel };
}

// ---------- Dibujo del agua sobre el mapa ----------
function colorAgua(p) {
  if (p < AGUA_VER) return null;
  let k = 0;
  while (k + 1 < COLOR_AGUA.length && p >= COLOR_AGUA[k + 1][0]) k++;
  return COLOR_AGUA[k][1];
}
function imagenAgua(M, k, verMax = false) {
  const d = M.d, { cv, c } = lienzo(d.FW, d.FH), img = c.createImageData(d.FW, d.FH), px = img.data;
  const fr = verMax ? null : M.frames[k];
  for (let y = 0; y < d.FH; y++) {
    const cy = ((y / d.f) | 0) * d.nx;
    for (let x = 0; x < d.FW; x++) {
      const i = y * d.FW + x, ci = cy + ((x / d.f) | 0);
      if (!d.dentroFino[i] || d.tipo2[ci] !== 1) continue;
      const h = verMax ? M.hMax[ci] : fr[ci] / 1000;
      if (h - d.cauce[ci] < AGUA_VER) continue;
      // Nivel del agua de la celda contra la altura del píxel (sin pasar la profundidad de la celda en más de 50 cm)
      const p = Math.min(d.z[ci] + h - d.zFino[i], h - d.cauce[ci] + 0.5), col = colorAgua(p);
      if (!col) continue;
      px[4 * i] = col[0]; px[4 * i + 1] = col[1]; px[4 * i + 2] = col[2]; px[4 * i + 3] = Math.round(col[3] * 255);
    }
  }
  c.putImageData(img, 0, 0);
  return cv;
}
async function dibujarAgua(M, k, verMax = false) {
  const cv = imagenAgua(M, k, verMax);
  const blob = cv.convertToBlob ? await cv.convertToBlob() : await new Promise((ok) => cv.toBlob(ok));
  const url = URL.createObjectURL(blob);
  const src = mapa.getSource("agua-sim");
  if (src) src.updateImage({ url, coordinates: M.d.coordenadas });
  else {
    mapa.addSource("agua-sim", { type: "image", url, coordinates: M.d.coordenadas });
    mapa.addLayer({ id: "agua-sim", type: "raster", source: "agua-sim", paint: { "raster-opacity": 0.9, "raster-resampling": "linear", "raster-fade-duration": 0 } }, mapa.getLayer("finca-relleno") ? "finca-relleno" : undefined);
  }
  if (dibujarAgua.ultima) setTimeout(((u) => () => URL.revokeObjectURL(u))(dibujarAgua.ultima), 2000);
  dibujarAgua.ultima = url;
}
function quitarAgua() { if (mapa.getLayer("agua-sim")) mapa.removeLayer("agua-sim"); if (mapa.getSource("agua-sim")) mapa.removeSource("agua-sim"); }
