// CultivoAlerta · Aplicación: mapa, registro de la finca y los dos módulos que la usan.
"use strict";
const $ = (id) => document.getElementById(id);
const fmt = (v, d = 1) => Number(v).toLocaleString("es-CO", { minimumFractionDigits: d, maximumFractionDigits: d });
const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const VACIO = { type: "FeatureCollection", features: [] };
const CLAVE_GUARDADO = "cultivoalerta.finca.v1";

let mapa, finca = null, circ = null, terreno = null, modelo = null, clima = null, ultimoArchivo = null;
let satelite = true, en3d = false, dibujo = null, reproduciendo = null;

// ===================== Mapa =====================
mapa = new maplibregl.Map({
  container: "mapa", style: "https://tiles.openfreemap.org/styles/liberty", center: [-74.08, 4.83], zoom: 11, maxPitch: 75,
  attributionControl: false,
});
mapa.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
mapa.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
mapa.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-right");
mapa.on("load", () => { prepararCapas(); restaurarFinca(); });

function prepararCapas() {
  const capas = mapa.getStyle().layers;
  const antesDe = capas.find((l) => l.id === "water" || (l.type === "fill" && /water/.test(l.id)))?.id;
  mapa.addSource("esri", { type: "raster", tiles: [ESRI], tileSize: 256, maxzoom: 19, attribution: "Imagen © Esri, Maxar, Earthstar Geographics" });
  mapa.addLayer({ id: "esri", type: "raster", source: "esri" }, antesDe);
  mapa.addSource("relieve", { type: "raster-dem", tiles: [TERRARIUM], tileSize: 256, encoding: "terrarium", maxzoom: 14, attribution: "Relieve: AWS Terrain Tiles" });
  mapa.addSource("finca", { type: "geojson", data: VACIO });
  mapa.addSource("circulo", { type: "geojson", data: VACIO });
  mapa.addSource("dibujo", { type: "geojson", data: VACIO });
  mapa.addSource("finca-etiqueta", { type: "geojson", data: VACIO });   // aparte: si faltara la fuente tipográfica, el lindero igual se dibuja
  mapa.addLayer({ id: "circulo", type: "line", source: "circulo", paint: { "line-color": "#12a4c8", "line-width": 2.4, "line-dasharray": [2, 1.4] } });
  mapa.addLayer({ id: "finca-relleno", type: "fill", source: "finca", paint: { "fill-color": "#f2b705", "fill-opacity": 0.12 } });
  mapa.addLayer({ id: "finca-casing", type: "line", source: "finca", paint: { "line-color": "#2b2100", "line-width": 5.5, "line-opacity": 0.75 } });
  mapa.addLayer({ id: "finca-borde", type: "line", source: "finca", paint: { "line-color": "#f2b705", "line-width": 2.8 } });
  mapa.addLayer({ id: "finca-etiqueta", type: "symbol", source: "finca-etiqueta",
    layout: { "text-field": ["get", "nombre"], "text-font": ["Noto Sans Bold"], "text-size": 14, "text-allow-overlap": true },
    paint: { "text-color": "#fff", "text-halo-color": "#2b2100", "text-halo-width": 2 } });
  mapa.addLayer({ id: "dibujo-linea", type: "line", source: "dibujo", paint: { "line-color": "#f2b705", "line-width": 2.5, "line-dasharray": [1, 1] } });
  mapa.addLayer({ id: "dibujo-puntos", type: "circle", source: "dibujo", filter: ["==", ["geometry-type"], "Point"], paint: { "circle-radius": 5, "circle-color": "#f2b705", "circle-stroke-color": "#2b2100", "circle-stroke-width": 2 } });
  aplicarBase();
}
function aplicarBase() {
  mapa.setLayoutProperty("esri", "visibility", satelite ? "visible" : "none");
  for (const l of mapa.getStyle().layers) {
    if (l.type === "fill-extrusion" || /^building/.test(l.id)) mapa.setLayoutProperty(l.id, "visibility", satelite ? "none" : "visible");
    if (l.id === "water" && l.type === "fill") mapa.setPaintProperty(l.id, "fill-opacity", satelite ? 0.35 : 1);
  }
  $("btn-base").textContent = satelite ? "Satélite" : "Mapa";
  $("btn-base").classList.toggle("activo", satelite);
}
$("btn-base").onclick = () => { satelite = !satelite; aplicarBase(); };
$("btn-3d").onclick = () => {
  en3d = !en3d;
  $("btn-3d").classList.toggle("activo", en3d);
  if (en3d) { mapa.setTerrain({ source: "relieve", exaggeration: 2.5 }); mapa.easeTo({ pitch: 62, bearing: -20, duration: 900 }); }
  else { mapa.setTerrain(null); mapa.easeTo({ pitch: 0, bearing: 0, duration: 700 }); }
};

// ===================== Pestañas =====================
function irA(tab) {
  document.querySelectorAll(".pestana").forEach((b) => b.classList.toggle("activa", b.dataset.tab === tab));
  document.querySelectorAll(".seccion").forEach((s) => s.classList.toggle("activa", s.id === `tab-${tab}`));
  if (tab === "vigor" && finca) cargarClima();
  $("menu-sat").hidden = !(tab === "vigor" && finca);
  if (tab === "vigor" && finca) {
    const c = cajaCirculo(circ.centro, circ.km * 1.1), ancho = mapa.getContainer().clientWidth;
    mapa.fitBounds([[c[0], c[1]], [c[2], c[3]]], { padding: { top: 110, bottom: 30, right: 40, left: Math.min(330, ancho * 0.45) }, duration: 700 });
    elegirCapaSat(capaSat);
  }
  else { ocultarCapaSat(); $("leyenda-sat").hidden = true; }
  if (mapa.getLayer("agua-sim")) mapa.setLayoutProperty("agua-sim", "visibility", tab === "vigor" ? "none" : "visible");
  $("leyenda").classList.toggle("oculta-vigor", tab === "vigor");
  if (tab === "inundacion" && circ) { const c = cajaCirculo(circ.centro, circ.km * 1.15); mapa.fitBounds([[c[0], c[1]], [c[2], c[3]]], { padding: 30, duration: 700 }); }
}
document.querySelectorAll(".pestana").forEach((b) => (b.onclick = () => !b.disabled && irA(b.dataset.tab)));
$("btn-ir-vigor").onclick = () => irA("vigor");

// ===================== Mi finca =====================
for (const [k, v] of Object.entries(CRS)) $("crs").add(new Option(`${v.nombre} · ${k}`, k));
const zona = $("zona-carga");
$("archivo").onchange = (e) => e.target.files[0] && cargarArchivo(e.target.files[0]);
["dragenter", "dragover"].forEach((t) => zona.addEventListener(t, (e) => { e.preventDefault(); zona.classList.add("encima"); }));
["dragleave", "drop"].forEach((t) => zona.addEventListener(t, (e) => { e.preventDefault(); zona.classList.remove("encima"); }));
zona.addEventListener("drop", (e) => e.dataTransfer.files[0] && cargarArchivo(e.dataTransfer.files[0]));
$("crs").onchange = () => { if (ultimoArchivo) usarDatos(ultimoArchivo); };
$("btn-ejemplo").onclick = () => { ultimoArchivo = null; $("crs").value = "auto"; establecerFinca(JSON.parse(JSON.stringify(FINCA_EJEMPLO))); };

function avisoFinca(txt, error = false) { const a = $("aviso-finca"); a.hidden = !txt; a.textContent = txt ?? ""; a.classList.toggle("error", error); }
async function cargarArchivo(archivo) {
  avisoFinca("Leyendo el archivo…");
  try { ultimoArchivo = await leerArchivoFinca(archivo); usarDatos(ultimoArchivo); }
  catch (e) { console.error(e); avisoFinca(e.message, true); }
  $("archivo").value = "";
}
function usarDatos(datos) {
  try {
    const f = armarFinca(datos, $("crs").value);
    if (f.properties.fueraDeColombia) {
      avisoFinca(`Con el sistema «${CRS[f.properties.crs]?.nombre ?? f.properties.crs}» la finca queda fuera de Colombia. Elige en la lista el sistema de referencia correcto.`, true);
      return;
    }
    const auto = $("crs").value === "auto";
    avisoFinca(auto && !datos.crsDetectado && f.properties.crs !== "EPSG:4326" ? `El archivo no trae .prj: se supuso ${CRS[f.properties.crs]?.nombre}. Si la finca no cae en su lugar, cambia el sistema de referencia.` : "");
    establecerFinca(f);
  } catch (e) { console.error(e); avisoFinca(e.message, true); }
}

function establecerFinca(f, encuadrar = true) {
  finca = f;
  const p = f.properties;
  p.areaHa = areaHa(f); p.perimKm = perimetroKm(f);
  circ = circuloParaFinca(f, +$("margen").value);
  const centro = circ.centro;
  mapa.getSource("finca").setData(f);
  mapa.getSource("finca-etiqueta").setData({ type: "Feature", geometry: { type: "Point", coordinates: centro }, properties: { nombre: p.nombre } });
  mapa.getSource("circulo").setData({ type: "Feature", geometry: circuloGeo(centro, circ.km), properties: {} });
  $("info-finca").hidden = false;
  $("f-nombre").textContent = p.nombre;
  $("f-area").textContent = `${fmt(p.areaHa, p.areaHa < 10 ? 2 : 1)} ha`;
  $("f-perim").textContent = `${fmt(p.perimKm, 2)} km`;
  $("f-lotes").textContent = p.lotes;
  $("f-centro").textContent = `${fmt(centro[1], 4)}, ${fmt(centro[0], 4)}`;
  $("f-origen").textContent = `${p.formato} · ${CRS[p.crs]?.nombre ?? p.crs}${p.crs !== "EPSG:4326" ? " → WGS84" : ""}`;
  actualizarRadio();
  document.querySelectorAll(".pestana").forEach((b) => (b.disabled = false));
  if (encuadrar) verFinca();
  try { localStorage.setItem(CLAVE_GUARDADO, JSON.stringify(f)); } catch {}
  terreno = null; clima = null; detenerModelo(); quitarAgua(); $("resultado").hidden = true; $("leyenda").hidden = true;
}
function actualizarRadio() {
  if (!finca) return;
  circ = circuloParaFinca(finca, +$("margen").value);
  mapa.getSource("circulo").setData({ type: "Feature", geometry: circuloGeo(circ.centro, circ.km), properties: {} });
  $("f-radio").textContent = `${fmt(circ.km, 2)} km${circ.km >= 3 ? " (máximo)" : ""}`;
}
$("margen").oninput = () => { $("margen-v").textContent = `${fmt(+$("margen").value, 1)} km`; actualizarRadio(); terreno = null; };
function verFinca() {
  const [o, s, e, n] = cajaDe(finca);
  const c = cajaCirculo(circ.centro, circ.km);
  mapa.fitBounds([[Math.min(o, c[0]), Math.min(s, c[1])], [Math.max(e, c[2]), Math.max(n, c[3])]], { padding: 40, duration: 900 });
}
$("btn-zoom").onclick = verFinca;
$("btn-borrar").onclick = () => {
  finca = circ = terreno = clima = null; detenerModelo(); quitarAgua();
  quitarCapaSat(); satCache = {}; $("menu-sat").hidden = true; $("leyenda-sat").hidden = true; $("sat-resumen").innerHTML = "";
  mapa.getSource("finca").setData(VACIO); mapa.getSource("finca-etiqueta").setData(VACIO); mapa.getSource("circulo").setData(VACIO);
  $("info-finca").hidden = true; $("resultado").hidden = true; $("leyenda").hidden = true; avisoFinca("");
  document.querySelectorAll(".pestana").forEach((b) => (b.disabled = b.dataset.tab !== "finca"));
  try { localStorage.removeItem(CLAVE_GUARDADO); } catch {}
};
$("btn-exportar").onclick = () => {
  const blob = new Blob([JSON.stringify(finca)], { type: "application/geo+json" });
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `${finca.properties.nombre.replace(/[^\w-]+/g, "_")}.geojson` });
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 3000);
};
function restaurarFinca() {
  try { const g = JSON.parse(localStorage.getItem(CLAVE_GUARDADO) ?? "null"); if (g?.geometry) establecerFinca(g); } catch {}
}

// Dibujo del lindero en el mapa
$("btn-dibujar").onclick = () => {
  dibujo = []; $("dibujo-barra").hidden = false; mapa.doubleClickZoom.disable(); mapa.getCanvas().style.cursor = "crosshair"; pintarDibujo();
};
function pintarDibujo() {
  const pts = (dibujo ?? []).map((c) => ({ type: "Feature", geometry: { type: "Point", coordinates: c }, properties: {} }));
  const linea = dibujo?.length > 1 ? [{ type: "Feature", geometry: { type: "LineString", coordinates: [...dibujo, dibujo[0]] }, properties: {} }] : [];
  mapa.getSource("dibujo").setData({ type: "FeatureCollection", features: [...linea, ...pts] });
}
function salirDibujo() { dibujo = null; $("dibujo-barra").hidden = true; mapa.doubleClickZoom.enable(); mapa.getCanvas().style.cursor = ""; mapa.getSource("dibujo").setData(VACIO); }
function terminarDibujo() {
  const pts = (dibujo ?? []).filter((c, i, a) => i === 0 || distanciaKm(c, a[i - 1]) > 0.002);
  if (pts.length < 3) { avisoFinca("Marca al menos tres esquinas para cerrar la finca.", true); return; }
  salirDibujo(); avisoFinca(""); ultimoArchivo = null;
  establecerFinca({ type: "Feature", geometry: { type: "MultiPolygon", coordinates: [[[...pts, pts[0]]]] }, properties: { nombre: "Finca dibujada", lotes: 1, crs: "EPSG:4326", formato: "Dibujada en el mapa" } });
}
mapa.on("click", (e) => { if (dibujo) { dibujo.push([e.lngLat.lng, e.lngLat.lat]); pintarDibujo(); } });
mapa.on("dblclick", (e) => { if (dibujo) { e.preventDefault(); terminarDibujo(); } });
$("btn-fin-dibujo").onclick = terminarDibujo;
$("btn-cancelar-dibujo").onclick = salirDibujo;
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && dibujo) salirDibujo(); });

// Copiar mensajes
document.querySelectorAll("[data-copiar]").forEach((b) => (b.onclick = async () => {
  try { await navigator.clipboard.writeText($(b.dataset.copiar).textContent); b.textContent = "Copiado ✓"; setTimeout(() => (b.textContent = "Copiar mensaje"), 1500); } catch { b.textContent = "No se pudo copiar"; }
}));

// ===================== Gráficos (SVG) =====================
const NS = "http://www.w3.org/2000/svg";
function svg(w, h) { const s = document.createElementNS(NS, "svg"); s.setAttribute("viewBox", `0 0 ${w} ${h}`); return s; }
function el(padre, tag, attrs = {}, texto) { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); if (texto != null) e.textContent = texto; padre.appendChild(e); return e; }
function escala(d0, d1, r0, r1) { return (v) => r0 + ((v - d0) / (d1 - d0 || 1)) * (r1 - r0); }
function marcas(min, max, n = 4) { const paso = [0.5, 1, 2, 2.5, 5, 10, 20, 25, 50, 100].find((p) => (max - min) / p <= n) ?? 200, out = []; for (let v = Math.ceil(min / paso) * paso; v <= max + 1e-9; v += paso) out.push(+v.toFixed(2)); return out; }
const diaCorto = (iso) => new Date(`${iso}T12:00:00-05:00`).toLocaleDateString("es-CO", { day: "numeric", month: "short" });

function graficoTemperatura(cont, dias) {
  const W = 380, H = 206, m = { l: 30, r: 8, t: 14, b: 36 }, s = svg(W, H);
  const vals = dias.flatMap((d) => [d.tmax, d.tmin, d.sueloMin]).filter((v) => v != null);
  const y0 = Math.min(-1, Math.floor(Math.min(...vals) - 1)), y1 = Math.ceil(Math.max(...vals) + 1);
  const X = escala(0, dias.length - 1, m.l, W - m.r), Y = escala(y0, y1, H - m.b, m.t);
  for (const v of marcas(y0, y1, 5)) { el(s, "line", { x1: m.l, x2: W - m.r, y1: Y(v), y2: Y(v), stroke: "#e6ebe7" }); el(s, "text", { x: m.l - 4, y: Y(v) + 3, "text-anchor": "end" }, `${v}°`); }
  const kh = dias.findIndex((d) => d.esHoy);
  if (kh >= 0) { el(s, "rect", { x: X(kh), y: m.t, width: W - m.r - X(kh), height: H - m.b - m.t, fill: "#f3f6f4" }); el(s, "text", { x: W - m.r - 2, y: m.t - 3, "text-anchor": "end" }, "pronóstico →"); }
  for (const [v, txt, col] of [[0, "helada 0 °C", "#2b7bba"], [3, "riesgo 3 °C", "#7fa9cf"]]) if (v >= y0 && v <= y1) { el(s, "line", { x1: m.l, x2: W - m.r, y1: Y(v), y2: Y(v), stroke: col, "stroke-dasharray": "4 3" }); el(s, "text", { x: W - m.r - 2, y: Y(v) - 3, "text-anchor": "end", fill: col }, txt); }
  const banda = dias.map((d, i) => `${X(i)},${Y(d.tmax)}`).join(" ") + " " + dias.map((d, i) => `${X(i)},${Y(d.tmin)}`).reverse().join(" ");
  el(s, "polygon", { points: banda, fill: "#f2b705", "fill-opacity": 0.13 });
  const linea = (k, col, extra = {}) => el(s, "polyline", { points: dias.map((d, i) => (d[k] == null ? null : `${X(i)},${Y(d[k])}`)).filter(Boolean).join(" "), fill: "none", stroke: col, "stroke-width": 1.8, ...extra });
  linea("tmax", "#d0533f"); linea("tmin", "#2b7bba"); linea("sueloMin", "#7b5cc4", { "stroke-dasharray": "2 2", "stroke-width": 1.4 });
  if (kh >= 0) el(s, "line", { x1: X(kh), x2: X(kh), y1: m.t, y2: H - m.b, stroke: "#1f5130", "stroke-width": 1.2 });
  [0, Math.floor(dias.length / 3), Math.floor((2 * dias.length) / 3), dias.length - 1].forEach((i) => el(s, "text", { x: X(i), y: H - m.b + 13, "text-anchor": i === 0 ? "start" : i === dias.length - 1 ? "end" : "middle" }, diaCorto(dias[i].dia)));
  const ley = el(s, "g", {});
  [["#d0533f", "Máxima del aire"], ["#2b7bba", "Mínima del aire"], ["#7b5cc4", "Mínima del suelo (superficie)"]].forEach(([c, t], j) => { const x0 = m.l + [0, 100, 200][j]; el(ley, "rect", { x: x0, y: H - 9, width: 10, height: 3, fill: c }); el(ley, "text", { x: x0 + 13, y: H - 5 }, t); });
  cont.replaceChildren(s);
}
function graficoLluvia(cont, dias) {
  const W = 380, H = 150, m = { l: 30, r: 8, t: 12, b: 22 }, s = svg(W, H);
  const y1 = Math.max(10, ...dias.map((d) => d.lluvia), ...dias.map((d) => d.et0)) * 1.1;
  const bw = (W - m.l - m.r) / dias.length, X = (i) => m.l + i * bw, Y = escala(0, y1, H - m.b, m.t);
  for (const v of marcas(0, y1, 4)) { el(s, "line", { x1: m.l, x2: W - m.r, y1: Y(v), y2: Y(v), stroke: "#e6ebe7" }); el(s, "text", { x: m.l - 4, y: Y(v) + 3, "text-anchor": "end" }, v); }
  dias.forEach((d, i) => el(s, "rect", { x: X(i) + 0.6, y: Y(d.lluvia), width: Math.max(1, bw - 1.2), height: H - m.b - Y(d.lluvia), fill: d.pasado ? "#3b8fd0" : "#9cc7ea" }));
  el(s, "polyline", { points: dias.map((d, i) => `${X(i) + bw / 2},${Y(d.et0)}`).join(" "), fill: "none", stroke: "#e08a00", "stroke-width": 1.6 });
  const kh = dias.findIndex((d) => d.esHoy);
  if (kh >= 0) el(s, "line", { x1: X(kh), x2: X(kh), y1: m.t, y2: H - m.b, stroke: "#1f5130", "stroke-width": 1.2 });
  [0, Math.floor(dias.length / 2), dias.length - 1].forEach((i) => el(s, "text", { x: X(i) + bw / 2, y: H - 6, "text-anchor": i === 0 ? "start" : i === dias.length - 1 ? "end" : "middle" }, diaCorto(dias[i].dia)));
  el(s, "text", { x: m.l, y: m.t - 2 }, "mm/día · barras: lluvia (claras = pronóstico) · línea: evapotranspiración");
  cont.replaceChildren(s);
}
function graficoSimulacion(cont, M, hora) {
  const W = 380, H = 160, m = { l: 34, r: 34, t: 14, b: 22 }, s = svg(W, H), n = M.stats.length;
  const ll = Array.from(M.lluvia.slice(0, n)), llMax = Math.max(1, ...ll) * 1.15, haMax = Math.max(0.05, ...M.stats.map((x) => x.haFinca)) * 1.15;
  const bw = (W - m.l - m.r) / n, X = (k) => m.l + k * bw, Yl = escala(0, llMax, m.t, H - m.b), Yh = escala(0, haMax, H - m.b, m.t);
  ll.forEach((v, k) => v > 0.05 && el(s, "rect", { x: X(k), y: m.t, width: Math.max(0.8, bw), height: Yl(v) - m.t, fill: "#9cc7ea" }));
  const area = `${X(0)},${H - m.b} ` + M.stats.map((x, k) => `${X(k) + bw / 2},${Yh(x.haFinca)}`).join(" ") + ` ${X(n - 1) + bw},${H - m.b}`;
  el(s, "polygon", { points: area, fill: "#2458b2", "fill-opacity": 0.25 });
  el(s, "polyline", { points: M.stats.map((x, k) => `${X(k) + bw / 2},${Yh(x.haFinca)}`).join(" "), fill: "none", stroke: "#2458b2", "stroke-width": 2 });
  for (const v of marcas(0, haMax, 3)) el(s, "text", { x: m.l - 4, y: Yh(v) + 3, "text-anchor": "end", fill: "#2458b2" }, fmt(v, v < 1 ? 1 : 0));
  for (const v of marcas(0, llMax, 3)) el(s, "text", { x: W - m.r + 4, y: Yl(v) + 3, fill: "#3b8fd0" }, v);
  el(s, "text", { x: m.l - 4, y: m.t - 4, "text-anchor": "end", fill: "#2458b2" }, "ha");
  el(s, "text", { x: W - m.r + 4, y: m.t - 4, fill: "#3b8fd0" }, "mm/h");
  el(s, "line", { x1: m.l, x2: W - m.r, y1: H - m.b, y2: H - m.b, stroke: "#c9d3cc" });
  const kx = X(hora) + bw / 2;
  el(s, "line", { x1: kx, x2: kx, y1: m.t, y2: H - m.b, stroke: "#1f5130", "stroke-width": 1.5 });
  const etiq = (k) => (M.inicio ? new Date(M.inicio + k * 3600e3).toLocaleDateString("es-CO", { day: "numeric", month: "short" }) : `h ${k}`);
  [0, Math.floor(n / 2), n - 1].forEach((k) => el(s, "text", { x: X(k) + bw / 2, y: H - 6, "text-anchor": k === 0 ? "start" : k === n - 1 ? "end" : "middle" }, etiq(k)));
  const zonaClic = el(s, "rect", { x: m.l, y: m.t, width: W - m.l - m.r, height: H - m.t - m.b, fill: "transparent", style: "cursor:pointer" });
  zonaClic.addEventListener("click", (e) => { const r = s.getBoundingClientRect(), x = ((e.clientX - r.left) / r.width) * W; irAHora(Math.max(0, Math.min(n - 1, Math.floor((x - m.l) / bw)))); });
  cont.replaceChildren(s);
}

// ===================== Módulo 1: vigor y temperatura =====================
async function cargarClima() {
  if (clima?.finca === finca) return;
  $("clima-estado").hidden = false; $("clima-estado").textContent = "Cargando el clima de la finca…"; $("clima-cont").hidden = true;
  try {
    const c = await climaFinca(circ.centro);
    clima = { finca, ...c };
    pintarClima(c);
  } catch (e) { console.error(e); $("clima-estado").textContent = e.message; }
}
function pintarClima(c) {
  $("clima-estado").hidden = true; $("clima-cont").hidden = false;
  const a = c.actual ?? {}, hoyIdx = c.dias.findIndex((d) => d.esHoy), hoy = c.dias[hoyIdx] ?? {}, man = c.dias[hoyIdx + 1] ?? hoy;
  const minProx = Math.min(hoy.tmin ?? Infinity, man.tmin ?? Infinity);
  const kpi = (t, v, sub = "") => `<div class="kpi"><span>${t}</span><b>${v}</b><small>${sub}</small></div>`;
  $("clima-kpis").innerHTML = [
    kpi("Temperatura ahora", a.temperature_2m != null ? `${fmt(a.temperature_2m)} °C` : "–", a.relative_humidity_2m != null ? `Humedad relativa ${a.relative_humidity_2m} %` : ""),
    kpi("Mínima próxima noche", Number.isFinite(minProx) ? `${fmt(minProx)} °C` : "–", minProx <= 0 ? "Helada" : minProx <= 3 ? "Riesgo de helada" : "Sin riesgo de helada"),
    kpi("Suelo en superficie", c.sueloAhora.t0 != null ? `${fmt(c.sueloAhora.t0)} °C` : "–", c.sueloAhora.t6 != null ? `A 6 cm: ${fmt(c.sueloAhora.t6)} °C` : ""),
    kpi("Humedad del suelo", c.sueloAhora.hum != null ? `${fmt(c.sueloAhora.hum * 100, 0)} %` : "–", "Volumen de agua, 3 a 9 cm"),
    kpi("Lluvia últimos 30 días", `${fmt(c.lluvia30, 0)} mm`, c.secos ? `${c.secos} días seguidos sin lluvia` : "Llovió ayer u hoy"),
    kpi("Balance de agua 30 días", `${c.balance30 >= 0 ? "+" : ""}${fmt(c.balance30, 0)} mm`, "Lluvia menos evapotranspiración"),
  ].join("");
  $("clima-alertas").innerHTML = c.alertas.map((x) => `<li class="${x.nivel}"><b>${x.titulo}</b>${x.texto}</li>`).join("");
  graficoTemperatura($("graf-temp"), c.dias);
  graficoLluvia($("graf-lluvia"), c.dias);
  const fecha = new Date().toLocaleDateString("es-CO", { weekday: "long", day: "numeric", month: "long" });
  const principales = c.alertas.filter((x) => x.nivel !== "ok");
  $("msg-clima").textContent = `CultivoAlerta · ${finca.properties.nombre}\n${fecha}\n\nAhora: ${a.temperature_2m != null ? fmt(a.temperature_2m) + " °C" : "–"} · suelo ${c.sueloAhora.t0 != null ? fmt(c.sueloAhora.t0) + " °C" : "–"}\nMínima próxima noche: ${Number.isFinite(minProx) ? fmt(minProx) + " °C" : "–"}\nLluvia 30 días: ${fmt(c.lluvia30, 0)} mm (balance ${c.balance30 >= 0 ? "+" : ""}${fmt(c.balance30, 0)} mm)\n\n`
    + (principales.length ? principales.map((x) => `⚠️ ${x.titulo}: ${x.texto}`).join("\n") : "✅ Sin alertas para los próximos 7 días.");
}

// ---------- Mapas satelitales del círculo (temperatura, lluvia, NDVI, NDMI) ----------
let capaSat = "ndvi", satCache = {}, satTurno = 0;
document.querySelectorAll("#menu-sat button").forEach((b) => (b.onclick = () => elegirCapaSat(b.dataset.capa)));
const fechaSat = (f) => new Date(f.length > 10 ? f : `${f}T12:00:00-05:00`).toLocaleDateString("es-CO", { day: "numeric", month: "long", year: "numeric", timeZone: "America/Bogota" });
async function elegirCapaSat(clave) {
  capaSat = clave;
  document.querySelectorAll("#menu-sat button").forEach((b) => b.classList.toggle("activo", b.dataset.capa === clave));
  const turno = ++satTurno;
  if (!clave || !circ) { ocultarCapaSat(); $("leyenda-sat").hidden = true; return; }
  const ck = `${circ.centro.join()}|${circ.km}|${finca.properties.nombre}`;
  if (satCache.ck !== ck) { satCache = { ck }; $("sat-resumen").innerHTML = ""; }
  const capa = CAPAS_SAT[clave], ley = $("leyenda-sat");
  ley.hidden = false;
  const avance = (t) => { if (satTurno === turno) ley.innerHTML = `<b>${capa.titulo}</b><div class="cargando">${t}</div>`; };
  if (!satCache[clave]) {
    ocultarCapaSat(); avance("Preparando…");
    satCache[clave] = (clave === "lluvia" ? capaLluvia(circ.centro, circ.km, finca, avance) : capaSatelital(clave, circ.centro, circ.km, finca, avance))
      .catch((e) => { delete satCache[clave]; throw e; });
  } else if (!satCache[clave].listo) { ocultarCapaSat(); avance("Cargando…"); }
  let r;
  try { r = await satCache[clave]; if (satCache[clave]) satCache[clave].listo = true; }
  catch (e) { console.error(e); if (satTurno === turno) ley.innerHTML = `<b>${capa.titulo}</b><p class="aviso error">${e.message}</p>`; return; }
  pintarResumenSat();
  if (satTurno !== turno || !$("tab-vigor").classList.contains("activa")) return;
  mostrarCapaSat(r); pintarLeyendaSat(capa, r);
}
function pintarLeyendaSat(capa, r) {
  const p = capa.paleta, v0 = p[0][0], v1 = p[p.length - 1][0], pct = (v) => (((v - v0) / (v1 - v0)) * 100).toFixed(1);
  const u = capa.unidad ? ` ${capa.unidad}` : "", f = (v) => `${fmt(v, capa.decimales)}${u}`;
  const marcasTxt = p.map(([v], i) => `<span>${fmt(v, capa.decimales && !capa.unidad ? (Number.isInteger(Math.round(v * 100) / 10) ? 1 : 2) : 0)}${i === p.length - 1 ? u : ""}</span>`).join("");
  const clases = capa.clases.map(([a, b, txt], i) => {
    const medio = Math.min(v1, Math.max(v0, Number.isFinite(a) && Number.isFinite(b) ? (a + b) / 2 : Number.isFinite(a) ? (a + v1) / 2 : (v0 + b) / 2));
    const lim = !Number.isFinite(a) ? `menos de ${fmt(b, capa.decimales)}` : !Number.isFinite(b) ? `más de ${fmt(a, capa.decimales)}` : `${fmt(a, capa.decimales)} a ${fmt(b, capa.decimales)}`;
    const parte = r.clasesFinca ? `<span>${fmt(r.clasesFinca[i] * 100, 0)} %</span>` : "";
    return `<li title="${lim}"><i style="background:rgb(${colorDe(p, medio).join(",")})"></i>${txt}${parte}</li>`;
  }).join("");
  const enFinca = r.mediaFinca != null ? `En tu finca: <b>${f(r.mediaFinca)}</b> · ${claseDe(capa, r.mediaFinca)}`
    : "La finca quedó bajo nubes en esta imagen: mira el entorno del círculo.";
  const cuando = capa.modelo ? `Del ${fechaSat(new Date(new Date(r.fecha) - 30 * 864e5).toISOString().slice(0, 10))} al ${fechaSat(r.fecha)}` : `Imagen del ${fechaSat(r.fecha)}${r.nubes > 0.01 ? ` · ${fmt(r.nubes * 100, 0)} % del círculo bajo nubes (sin color)` : " · sin nubes sobre el círculo"}`;
  $("leyenda-sat").innerHTML = `<b>${capa.titulo}</b><div class="sat-fecha">${cuando}</div>
    <div class="barra-color" style="background:linear-gradient(to right,${p.map(([v, c]) => `${c} ${pct(v)}%`).join(",")})"></div>
    <div class="escala-txt">${marcasTxt}</div>
    <div class="sat-finca">${enFinca}</div>
    <ul class="sat-clases">${clases}</ul>
    ${r.clasesFinca ? '<p class="mini">El porcentaje es la parte de la finca en cada clase.</p>' : ""}
    <p>${capa.texto}</p>
    <p class="mini">${capa.fuente}. En el círculo: de ${f(r.min)} a ${f(r.max)}. Herramienta orientativa: confirme en campo.</p>`;
}
async function pintarResumenSat() {
  const filas = [];
  for (const [k, capa] of Object.entries(CAPAS_SAT)) {
    if (!satCache[k]?.listo) continue;
    const r = await satCache[k];
    if (r.mediaFinca == null) continue;
    filas.push(`<li><b>${capa.boton}:</b> ${fmt(r.mediaFinca, capa.decimales)}${capa.unidad ? " " + capa.unidad : ""} en la finca · ${claseDe(capa, r.mediaFinca)}</li>`);
  }
  $("sat-resumen").innerHTML = filas.join("");
}

// ===================== Módulo 2: inundación =====================
for (const [k, v] of Object.entries(NINAS)) $("temporada").add(new Option(v.nombre, k));
for (const [k, v] of Object.entries(TEXTURAS)) $("suelo").add(new Option(v.nombre + (k === "franco arcilloso" ? " (típico de la Sabana)" : ""), k));
$("suelo").value = "franco arcilloso";
document.querySelectorAll("input[name=esc]").forEach((r) => (r.onchange = () => {
  const v = document.querySelector("input[name=esc]:checked").value;
  document.querySelectorAll(".sub[data-para]").forEach((s) => (s.hidden = s.dataset.para !== v));
}));
const etiquetas = { factor: (v) => `× ${fmt(v, 1)}`, mm: (v) => `${v} mm`, horas: (v) => `${v} h`, crecida: (v) => `${fmt(v, v % 1 ? 2 : 0)} m` };
for (const [k, f] of Object.entries(etiquetas)) $(k).addEventListener("input", () => ($(`${k}-v`).textContent = f(+$(k).value)));

function avisoSim(txt, error = false) { const a = $("aviso-sim"); a.hidden = !txt; a.textContent = txt ?? ""; a.classList.toggle("error", error); }
function progreso(txt, frac) { $("progreso").hidden = false; $("prog-txt").textContent = txt; if (frac != null) $("prog-barra").style.width = `${Math.round(frac * 100)}%`; }
function detenerModelo() { modelo?.worker?.terminate(); modelo = null; pararReproduccion(); }

$("btn-simular").onclick = async () => {
  if (!finca) return;
  const btn = $("btn-simular"); btn.disabled = true; avisoSim(""); detenerModelo();
  try {
    const clave = `${circ.centro.join()}|${circ.km}`;
    if (!terreno || terreno.clave !== clave) {
      progreso("Descargando relieve y mapa base…", 0.03);
      terreno = await prepararTerreno(finca, circ, (t) => progreso(t, 0.08));
      terreno.clave = clave;
    } else await encuadrarYEsperar(cajaCirculo(circ.centro, circ.km + MARGEN_KM));
    const tipo = document.querySelector("input[name=esc]:checked").value;
    progreso(tipo === "personalizada" ? "Preparando la tormenta…" : "Consultando la lluvia en Open-Meteo…", 0.12);
    const esc = tipo === "nina" ? await lluviaNina(circ.centro, $("temporada").value) : tipo === "pronostico" ? await lluviaPronostico(circ.centro) : lluviaPersonalizada(+$("mm").value, +$("horas").value);
    const suelo = TEXTURAS[$("suelo").value], hum = $("humedad").value;
    const theta0 = hum === "datos" ? (esc.theta ?? 0.7 * suelo.thetaS) : +hum * suelo.thetaS;
    const par = { suelo, theta0, crecida: +$("crecida").value, factor: tipo === "nina" ? +$("factor").value : 1 };
    if (par.crecida > 0 && !terreno.resumen.hayRio) avisoSim("No hay un río del mapa dentro del círculo: la crecida no cambia el resultado. Amplía el margen si la finca está cerca de un río.");
    progreso("Simulando el agua hora por hora…", 0.15);
    modelo = correrModelo(terreno, esc, par,
      (M, k, n) => progreso(`Simulando hora ${k + 1} de ${n}…`, 0.15 + 0.85 * ((k + 1) / n)),
      (M, err) => { btn.disabled = false; $("progreso").hidden = true; if (err) avisoSim("El cálculo falló. Prueba con un círculo más chico.", true); else mostrarResultado(M); });
  } catch (e) { console.error(e); avisoSim(e.message, true); btn.disabled = false; $("progreso").hidden = true; }
};

function mostrarResultado(M) {
  const R = M.resumen, esc = M.esc, p = finca.properties;
  $("resultado").hidden = false; $("leyenda").hidden = false;
  const titulos = { alta: "Amenaza alta para tu finca", media: "Amenaza media para tu finca", baja: "Amenaza baja para tu finca", sin: "Tu finca no se inunda con este escenario" };
  const total = esc.total * (M.par.factor ?? 1);
  const fechas = esc.inicio && esc.tipo === "nina" ? ` · ${new Date(esc.inicio).toLocaleDateString("es-CO", { day: "numeric", month: "short", year: "numeric" })}` : "";
  $("res-nivel").className = `nivel ${R.nivel}`;
  $("res-nivel").innerHTML = `${titulos[R.nivel]}<small>${esc.titulo}: ${fmt(total, 0)} mm${fechas}${M.par.crecida ? ` · río ${fmt(M.par.crecida, 2)} m sobre lo normal` : ""}</small>`;
  const kpi = (t, v, sub = "") => `<div class="kpi"><span>${t}</span><b>${v}</b><small>${sub}</small></div>`;
  $("res-kpis").innerHTML = [
    kpi("Finca con agua (pico)", `${fmt(R.haPico, R.haPico < 10 ? 2 : 1)} ha`, `${fmt(R.pctPico, 0)} % de ${fmt(p.areaHa, 1)} ha · más de 10 cm`),
    kpi("Profundidad máxima", `${fmt(R.maxProf, 2)} m`, "En el punto más bajo de la finca"),
    kpi("Tiempo con agua", `${R.horasAgua} h`, "Horas con más del 5 % de la finca inundado"),
    kpi("Círculo con agua (pico)", `${fmt(R.pctCirculoPico, 0)} %`, `Radio de ${fmt(circ.km, 2)} km alrededor`),
  ].join("");
  const h = $("hora"); h.max = M.stats.length - 1; M.hora = R.pico;
  $("ver-max").checked = false;
  irAHora(R.pico);
  const reco = { alta: "Saque animales, maquinaria e insumos de los bajos; limpie zanjas y drenajes; si puede, adelante la cosecha de los lotes bajos.",
    media: "Limpie zanjas y drenajes y evite dejar maquinaria o insumos en los bajos señalados.",
    baja: "Riesgo bajo: revise que los drenajes de los bajos estén despejados.", sin: "Sin acciones necesarias con este escenario." };
  $("msg-sim").textContent = `CultivoAlerta · Amenaza de inundación\nFinca: ${p.nombre} (${fmt(p.areaHa, 1)} ha)\nEscenario: ${esc.titulo} (${fmt(total, 0)} mm${fechas})${M.par.crecida ? `, río ${fmt(M.par.crecida, 2)} m arriba` : ""}\n\n`
    + (R.nivel === "sin" ? "Con este escenario su finca no tendría zonas con más de 10 cm de agua.\n" : `${fmt(R.haPico, 2)} ha (${fmt(R.pctPico, 0)} %) de su finca quedarían con más de 10 cm de agua, hasta ${fmt(R.maxProf, 2)} m en la parte más baja. El agua duraría unas ${R.horasAgua} horas.\n`)
    + `\nRecomendación: ${reco[R.nivel]}`;
  const cu = M.cuenta, ll = cu.lluvia || 1;
  $("res-datos").textContent = `Grilla de ${M.d.nx} × ${M.d.ny} celdas de ${fmt(M.d.dx, 0)} m · relieve SRTM ~30 m · ${M.d.resumen.hayRio ? "río del mapa dentro del círculo" : "sin río del mapa en el círculo"} · suelo ${M.par.suelo.nombre.toLowerCase()} · humedad inicial ${fmt((M.par.theta0 / M.par.suelo.thetaS) * 100, 0)} % de saturación. `
    + `Balance del agua de lluvia: ${fmt((100 * cu.infiltrada) / ll, 0)} % se infiltró, ${fmt((100 * cu.evaporada) / ll, 0)} % se evaporó, ${fmt((100 * Math.max(0, cu.salida)) / ll, 0)} % salió del área y ${fmt((100 * cu.superficie) / ll, 0)} % quedó en superficie. Fuente de la lluvia: ${esc.fuente}.`;
}
async function irAHora(k) {
  if (!modelo?.stats?.length) return;
  modelo.hora = k; $("hora").value = k;
  const st = modelo.stats[k], verMax = $("ver-max").checked;
  const cuando = modelo.inicio ? new Date(modelo.inicio + k * 3600e3).toLocaleString("es-CO", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : `Hora ${k}`;
  $("hora-txt").textContent = verMax ? "Máximo alcanzado" : `${cuando} · ${fmt(st.haFinca, 2)} ha`;
  graficoSimulacion($("graf-sim"), modelo, k);
  await dibujarAgua(modelo, k, verMax);
}
$("hora").oninput = () => { pararReproduccion(); $("ver-max").checked = false; irAHora(+$("hora").value); };
$("ver-max").onchange = () => irAHora(modelo?.hora ?? 0);
function pararReproduccion() { if (reproduciendo) { clearInterval(reproduciendo); reproduciendo = null; } $("btn-play").textContent = "▶"; }
$("btn-play").onclick = () => {
  if (!modelo) return;
  if (reproduciendo) return pararReproduccion();
  $("ver-max").checked = false;
  let k = modelo.hora >= modelo.stats.length - 1 ? 0 : modelo.hora;
  $("btn-play").textContent = "❚❚";
  reproduciendo = setInterval(() => { if (k >= modelo.stats.length - 1) return pararReproduccion(); irAHora(++k); }, 140);
};
