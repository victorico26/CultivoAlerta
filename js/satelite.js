// CultivoAlerta · Módulo 1: mapas satelitales del círculo de análisis (temperatura de superficie, lluvia, NDVI y NDMI).
// Las imágenes salen del catálogo público de Microsoft Planetary Computer (Sentinel-2 L2A y Landsat Colección 2 nivel 2,
// las mismas colecciones que usa el script de Google Earth Engine en gee/), sin clave ni cuenta. El servidor recorta la
// caja del círculo y calcula el índice; el navegador quita nubes, recorta al círculo, colorea y saca el promedio de la finca.
// Al servidor solo viaja la caja del círculo, nunca el lindero de la finca.
// La lluvia no es satelital: es el acumulado de 30 días de Open-Meteo en una malla de puntos sobre el círculo.
"use strict";

const PC_STAC = "https://planetarycomputer.microsoft.com/api/stac/v1/search";
const PC_CAJA = "https://planetarycomputer.microsoft.com/api/data/v1/item/bbox";
const SIN_DATO = -999;

// Colores: [valor, "#rrggbb"], interpolados entre paradas
const CAPAS_SAT = {
  temperatura: {
    boton: "Temperatura", titulo: "Temperatura de la superficie", unidad: "°C", decimales: 1,
    coleccion: "landsat-c2-l2", plataformas: ["landsat-8", "landsat-9"], resM: 30, dias: 120,
    // ST_B10 (lwir11) a °C; QA_PIXEL bits 1-4 = nube dilatada, cirros, nube y sombra (se quitan como en el script de GEE)
    expr: `where((qa_pixel%32)==0,lwir11*0.00341802+149.0-273.15,${SIN_DATO})`,
    paleta: [[10, "#313695"], [16, "#74add1"], [22, "#fee090"], [28, "#fdae61"], [34, "#f46d43"], [40, "#a50026"]],
    clases: [[-Infinity, 15, "Fresca"], [15, 25, "Templada"], [25, 32, "Caliente: el suelo pierde agua rápido"], [32, Infinity, "Muy caliente: techos, invernaderos o suelo desnudo"]],
    texto: "Qué tan caliente está el suelo y el cultivo visto desde el satélite, a la hora en que pasa (cerca de las 10 de la mañana). Las zonas más calientes pierden agua más rápido y sufren más en las sequías de El Niño. Las más frescas suelen tener cultivo tupido o suelo húmedo.",
    fuente: "Landsat 8 y 9 · banda térmica de 100 m entregada a 30 m",
  },
  lluvia: {
    boton: "Lluvia", titulo: "Lluvia de los últimos 30 días", unidad: "mm", decimales: 0, modelo: true,
    paleta: [[0, "#f6e7c8"], [30, "#eef5fb"], [60, "#c6dbef"], [100, "#6baed6"], [160, "#2171b5"], [250, "#08306b"]],
    clases: [[-Infinity, 50, "Mes seco"], [50, 100, "Lluvia moderada"], [100, 200, "Mes lluvioso"], [200, Infinity, "Muy lluvioso: suelo saturado"]],
    texto: "Cuánta agua cayó en el último mes. Viene de modelos del tiempo con celdas de varios kilómetros, así que casi no cambia dentro de la finca: sirve para saber si el mes fue seco o lluvioso, no para comparar lotes.",
    fuente: "Open-Meteo (modelos y ERA5, no es satelital) · malla de 7 × 7 puntos",
  },
  ndvi: {
    boton: "NDVI", titulo: "Vigor de las plantas (NDVI)", unidad: "", decimales: 2,
    coleccion: "sentinel-2-l2a", resM: 10, dias: 120,
    // Desde 2022 (línea base 04.00) las reflectancias traen un desfase de +1000: se descuenta en la suma (−2000)
    expr: `where((SCL>=4)&(SCL<=7),(B08-B04)/(B08+B04-2000),${SIN_DATO})`,
    paleta: [[-0.1, "#8c510a"], [0.15, "#d8b365"], [0.3, "#f6e8c3"], [0.45, "#a6d96a"], [0.6, "#4dac26"], [0.85, "#00441b"]],
    clases: [[-Infinity, 0.2, "Suelo desnudo, agua o construcciones"], [0.2, 0.4, "Planta débil, recién sembrada o pasto seco"], [0.4, 0.6, "Vigor medio"], [0.6, Infinity, "Cultivo o pasto vigoroso"]],
    texto: "Qué tan verdes y tupidas están las plantas. Verde oscuro es cultivo sano; amarillo o café es planta débil, recién cosechada o suelo desnudo. Si un lote se ve más claro que el resto, revíselo: puede ser plaga, falta de agua o de abono.",
    fuente: "Sentinel-2 · 10 m · pasa cada ~5 días",
  },
  ndmi: {
    boton: "NDMI", titulo: "Agua en las hojas (NDMI)", unidad: "", decimales: 2,
    coleccion: "sentinel-2-l2a", resM: 20, dias: 120,
    expr: `where((SCL>=4)&(SCL<=7),(B08-B11)/(B08+B11-2000),${SIN_DATO})`,
    paleta: [[-0.3, "#8c510a"], [-0.1, "#d8b365"], [0.05, "#f2efe6"], [0.2, "#80cdc1"], [0.35, "#2c7fb8"], [0.5, "#08306b"]],
    clases: [[-Infinity, -0.1, "Planta seca o suelo sin cubrir: posible falta de agua"], [-0.1, 0.1, "Humedad baja a media"], [0.1, 0.3, "Hojas bien hidratadas"], [0.3, Infinity, "Muy húmedo: follaje denso o encharcamiento"]],
    texto: "Cuánta agua tienen las hojas. Azul es planta bien hidratada; café es planta seca o con sed. Suele bajar antes de que el daño se vea a simple vista, así que avisa a tiempo para regar.",
    fuente: "Sentinel-2 · 20 m · pasa cada ~5 días",
  },
};

// ---------- Utilidades ----------
function colorDe(paleta, v) {
  if (v <= paleta[0][0]) return hexRgb(paleta[0][1]);
  for (let i = 1; i < paleta.length; i++) {
    if (v <= paleta[i][0]) {
      const [v0, c0] = paleta[i - 1], [v1, c1] = paleta[i], t = (v - v0) / (v1 - v0), a = hexRgb(c0), b = hexRgb(c1);
      return a.map((x, k) => Math.round(x + (b[k] - x) * t));
    }
  }
  return hexRgb(paleta[paleta.length - 1][1]);
}
function hexRgb(h) { return [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)); }
function claseDe(capa, v) { return capa.clases.find(([a, b]) => v >= a && v < b)?.[2] ?? ""; }

// Lee un .npy de titiler: forma (bandas, alto, ancho), banda 0 = valor, última = máscara (0 = sin dato)
function leerNpy(buf) {
  const dv = new DataView(buf), hl = dv.getUint16(8, true), cab = new TextDecoder().decode(new Uint8Array(buf, 10, hl));
  const tipo = cab.match(/'descr':\s*'([^']+)'/)[1], forma = cab.match(/'shape':\s*\(([^)]*)\)/)[1].split(",").map((s) => s.trim()).filter(Boolean).map(Number);
  const [nb, h, w] = forma.length === 3 ? forma : [1, ...forma], off = 10 + hl, n = w * h;
  const Ctor = { "<f8": Float64Array, "<f4": Float32Array, "<i2": Int16Array, "<u2": Uint16Array, "|u1": Uint8Array, "<i4": Int32Array }[tipo];
  if (!Ctor) throw new Error(`Formato de imagen no esperado (${tipo}).`);
  const todo = new Ctor(buf.slice(off, off + nb * n * Ctor.BYTES_PER_ELEMENT));
  const val = new Float32Array(n), masc = nb > 1 ? todo.subarray((nb - 1) * n) : null;
  for (let i = 0; i < n; i++) val[i] = masc && masc[i] === 0 ? SIN_DATO : todo[i];
  return { w, h, val };
}

// Para cada píxel: ¿dentro del círculo? ¿dentro de la finca?
function geometriaPixeles(caja, w, h, centro, km, finca) {
  const [o, s, e, n] = caja, enCirc = new Uint8Array(w * h), enFinca = new Uint8Array(w * h);
  const kx = 111.32 * Math.cos((centro[1] * Math.PI) / 180), ky = 110.574;
  const pols = finca?.geometry?.type === "Polygon" ? [finca.geometry.coordinates] : finca?.geometry?.coordinates ?? [];
  for (let j = 0; j < h; j++) {
    const lat = n - ((j + 0.5) / h) * (n - s);
    for (let i = 0; i < w; i++) {
      const lon = o + ((i + 0.5) / w) * (e - o), k = j * w + i;
      if (Math.hypot((lon - centro[0]) * kx, (lat - centro[1]) * ky) > km) continue;
      enCirc[k] = 1;
      if (pols.some((p) => puntoEnAnillo([lon, lat], p[0]) && !p.slice(1).some((hueco) => puntoEnAnillo([lon, lat], hueco)))) enFinca[k] = 1;
    }
  }
  return { enCirc, enFinca };
}

async function pedirNpy(coleccion, item, caja, px, expr) {
  const u = `${PC_CAJA}/${caja.map((v) => v.toFixed(5)).join(",")}/${px}x${px}.npy?collection=${coleccion}&item=${encodeURIComponent(item)}`
    + `&expression=${encodeURIComponent(expr)}&asset_as_band=true&resampling=nearest`;
  const r = await fetch(u).catch(() => null);
  if (!r?.ok) throw new Error("No se pudo descargar la imagen satelital (Planetary Computer no respondió).");
  return leerNpy(await r.arrayBuffer());
}

// Escenas recientes que cubren el círculo, de la más nueva a la más vieja
async function buscarEscenas(capa, caja) {
  const hasta = new Date(), desde = new Date(hasta - capa.dias * 864e5), q = { "eo:cloud_cover": { lt: 85 } };
  if (capa.plataformas) q.platform = { in: capa.plataformas };
  const cuerpo = { collections: [capa.coleccion], bbox: caja, datetime: `${desde.toISOString().slice(0, 10)}/${hasta.toISOString().slice(0, 10)}`,
    query: q, sortby: [{ field: "datetime", direction: "desc" }], limit: 16, fields: { include: ["id", "properties.datetime", "properties.eo:cloud_cover"], exclude: ["assets", "links"] } };
  const r = await fetch(PC_STAC, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) }).catch(() => null);
  if (!r?.ok) throw new Error("No se pudo consultar el catálogo de imágenes satelitales (Planetary Computer).");
  return (await r.json()).features.map((f) => ({ id: f.id, fecha: f.properties.datetime }));
}

// ---------- Capa satelital (Sentinel-2 o Landsat) ----------
async function capaSatelital(clave, centro, km, finca, avance) {
  const capa = CAPAS_SAT[clave], caja = cajaCirculo(centro, km);
  avance?.("Buscando imágenes recientes del satélite…");
  const escenas = await buscarEscenas(capa, caja);
  if (!escenas.length) throw new Error(`No hay imágenes de ${capa.fuente.split(" ·")[0]} de los últimos ${capa.dias} días sobre la finca.`);
  // Revisa las nubes sobre el círculo en versión pequeña (48 px), de 4 en 4, y se queda con la más reciente despejada
  const chica = 48, gChica = geometriaPixeles(caja, chica, chica, centro, km, null);
  let elegida = null;
  for (let k = 0; k < Math.min(escenas.length, 12) && !(elegida?.despejado >= 0.8); k += 4) {
    avance?.(`Revisando nubes en las imágenes (${Math.min(k + 4, escenas.length)} de ${Math.min(escenas.length, 12)})…`);
    const lote = await Promise.all(escenas.slice(k, k + 4).map(async (es) => {
      try {
        const im = await pedirNpy(capa.coleccion, es.id, caja, chica, capa.expr);
        let tot = 0, ok = 0;
        for (let i = 0; i < im.val.length; i++) if (gChica.enCirc[i]) { tot++; if (im.val[i] !== SIN_DATO && Number.isFinite(im.val[i])) ok++; }
        return { ...es, despejado: tot ? ok / tot : 0 };
      } catch { return { ...es, despejado: -1 }; }
    }));
    for (const es of lote) if (es.despejado >= 0.8 && !(elegida?.despejado >= 0.8)) elegida = es;   // la más reciente que pase
    if (!(elegida?.despejado >= 0.8)) for (const es of lote) if (es.despejado > (elegida?.despejado ?? 0)) elegida = es;
  }
  if (!elegida || elegida.despejado <= 0.02) throw new Error("Las imágenes recientes están cubiertas de nubes sobre la finca. Intente en unos días.");
  avance?.("Descargando la imagen de la fecha más despejada…");
  const px = Math.max(64, Math.min(500, Math.round((2 * km * 1000) / capa.resM)));
  const im = await pedirNpy(capa.coleccion, elegida.id, caja, px, capa.expr);
  return { ...armarImagen(capa, im, caja, centro, km, finca), fecha: elegida.fecha, despejado: elegida.despejado, escena: elegida.id };
}

// ---------- Capa de lluvia (malla de puntos de Open-Meteo, interpolada) ----------
async function capaLluvia(centro, km, finca, avance) {
  avance?.("Consultando la lluvia de los últimos 30 días…");
  const caja = cajaCirculo(centro, km), N = 7, lats = [], lons = [];
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { lons.push((caja[0] + (i / (N - 1)) * (caja[2] - caja[0])).toFixed(4)); lats.push((caja[3] - (j / (N - 1)) * (caja[3] - caja[1])).toFixed(4)); }
  const u = `https://api.open-meteo.com/v1/forecast?latitude=${lats.join(",")}&longitude=${lons.join(",")}&daily=precipitation_sum&past_days=30&forecast_days=1&timezone=America%2FBogota`;
  const d = await pedirJson(u), lista = Array.isArray(d) ? d : [d];
  const hoy = lista[0].daily.time.at(-1);
  const suma = lista.map((p) => p.daily.time.reduce((a, t, i) => a + (t < hoy ? p.daily.precipitation_sum[i] ?? 0 : 0), 0));
  const px = 140, val = new Float32Array(px * px);
  for (let j = 0; j < px; j++) for (let i = 0; i < px; i++) {   // interpolación bilineal entre los puntos de la malla
    const x = (i / (px - 1)) * (N - 1), y = (j / (px - 1)) * (N - 1), i0 = Math.min(N - 2, Math.floor(x)), j0 = Math.min(N - 2, Math.floor(y)), tx = x - i0, ty = y - j0;
    const v = (a, b) => suma[b * N + a];
    val[j * px + i] = (v(i0, j0) * (1 - tx) + v(i0 + 1, j0) * tx) * (1 - ty) + (v(i0, j0 + 1) * (1 - tx) + v(i0 + 1, j0 + 1) * tx) * ty;
  }
  return { ...armarImagen(CAPAS_SAT.lluvia, { w: px, h: px, val }, caja, centro, km, finca), fecha: hoy, despejado: 1 };
}

// ---------- Recorte al círculo, color y estadísticas ----------
function armarImagen(capa, im, caja, centro, km, finca) {
  const { w, h, val } = im, { enCirc, enFinca } = geometriaPixeles(caja, w, h, centro, km, finca);
  // Estadísticas sobre los píxeles originales del satélite
  let sF = 0, nF = 0, nC = 0, tC = 0, min = Infinity, max = -Infinity;
  const cuentaClases = capa.clases.map(() => 0);
  for (let k = 0; k < w * h; k++) {
    if (!enCirc[k]) continue;
    tC++;
    const v = val[k];
    if (v === SIN_DATO || !Number.isFinite(v)) continue;
    nC++; min = Math.min(min, v); max = Math.max(max, v);
    if (enFinca[k]) { sF += v; nF++; cuentaClases[capa.clases.findIndex(([a, c]) => v >= a && v < c)]++; }
  }
  // Imagen de salida más fina que el satélite (cada píxel se repite) para que el borde del círculo quede liso
  // y para no entregarle a MapLibre texturas chicas de lado potencia de 2, que con «nearest» se ven negras
  const W = Math.max(w, 481), H = Math.round((W * h) / w), mascara = geometriaPixeles(caja, W, H, centro, km, null).enCirc;
  const cv = Object.assign(document.createElement("canvas"), { width: W, height: H }), ctx = cv.getContext("2d"), img = ctx.createImageData(W, H);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const k = j * W + i;
    if (!mascara[k]) continue;
    const v = val[Math.min(h - 1, Math.floor((j * h) / H)) * w + Math.min(w - 1, Math.floor((i * w) / W))];
    if (v === SIN_DATO || !Number.isFinite(v)) continue;
    const [r, g, b] = colorDe(capa.paleta, v);
    img.data.set([r, g, b, 235], k * 4);
  }
  ctx.putImageData(img, 0, 0);
  const [o, s, e, n] = caja;
  return {
    url: cv.toDataURL("image/png"), lienzo: cv, coordenadas: [[o, n], [e, n], [e, s], [o, s]],
    mediaFinca: nF ? sF / nF : null, min, max,
    nubes: tC ? 1 - nC / tC : 0, clasesFinca: nF ? cuentaClases.map((c) => c / nF) : null,
  };
}

// ---------- Dibujo sobre el mapa ----------
function mostrarCapaSat(r) {
  const src = mapa.getSource("sat-capa");
  if (src) src.updateImage({ url: r.url, coordinates: r.coordenadas });
  else {
    mapa.addSource("sat-capa", { type: "image", url: r.url, coordinates: r.coordenadas });
    mapa.addLayer({ id: "sat-capa", type: "raster", source: "sat-capa", paint: { "raster-opacity": 0.92, "raster-fade-duration": 0, "raster-resampling": "linear" } }, mapa.getLayer("circulo") ? "circulo" : undefined);
  }
  mapa.setLayoutProperty("sat-capa", "visibility", "visible");
}
function ocultarCapaSat() { if (mapa.getLayer("sat-capa")) mapa.setLayoutProperty("sat-capa", "visibility", "none"); }
function quitarCapaSat() { if (mapa.getLayer("sat-capa")) mapa.removeLayer("sat-capa"); if (mapa.getSource("sat-capa")) mapa.removeSource("sat-capa"); }
