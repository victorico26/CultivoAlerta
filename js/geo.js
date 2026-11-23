// CultivoAlerta · Geometría de la finca: lectura de archivos, sistemas de referencia y medidas.
// Formatos: shapefile comprimido (.zip con .shp, .shx, .dbf y .prj), KML / KMZ (Google Earth) y GeoJSON.
// Todo se procesa en el navegador: la finca no sale del computador del usuario.
"use strict";

// ---------- Sistemas de referencia usados en Colombia ----------
const CRS = {
  "EPSG:4326": { nombre: "WGS84 (GPS, grados)", def: "+proj=longlat +datum=WGS84 +no_defs" },
  "EPSG:4686": { nombre: "MAGNA-SIRGAS (grados)", def: "+proj=longlat +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +no_defs" },
  "EPSG:9377": { nombre: "MAGNA-SIRGAS Origen Nacional (CTM12)", def: "+proj=tmerc +lat_0=4 +lon_0=-73 +k=0.9992 +x_0=5000000 +y_0=2000000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs" },
  "EPSG:3116": { nombre: "MAGNA-SIRGAS Colombia Bogotá", def: "+proj=tmerc +lat_0=4.596200416666666 +lon_0=-74.07750791666666 +k=1 +x_0=1000000 +y_0=1000000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs" },
  "EPSG:3115": { nombre: "MAGNA-SIRGAS Colombia Oeste", def: "+proj=tmerc +lat_0=4.596200416666666 +lon_0=-77.07750791666666 +k=1 +x_0=1000000 +y_0=1000000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs" },
  "EPSG:3117": { nombre: "MAGNA-SIRGAS Colombia Este Central", def: "+proj=tmerc +lat_0=4.596200416666666 +lon_0=-71.07750791666666 +k=1 +x_0=1000000 +y_0=1000000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs" },
  "EPSG:3118": { nombre: "MAGNA-SIRGAS Colombia Este", def: "+proj=tmerc +lat_0=4.596200416666666 +lon_0=-68.07750791666666 +k=1 +x_0=1000000 +y_0=1000000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs" },
  "EPSG:3114": { nombre: "MAGNA-SIRGAS Colombia Oeste Oeste", def: "+proj=tmerc +lat_0=4.596200416666666 +lon_0=-80.07750791666666 +k=1 +x_0=1000000 +y_0=1000000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs" },
  "EPSG:32618": { nombre: "WGS84 UTM zona 18N", def: "+proj=utm +zone=18 +datum=WGS84 +units=m +no_defs" },
  "EPSG:32619": { nombre: "WGS84 UTM zona 19N", def: "+proj=utm +zone=19 +datum=WGS84 +units=m +no_defs" },
};
const COLOMBIA = [-79.5, -4.5, -66.5, 13.6];   // caja aproximada (oeste, sur, este, norte)

// Sistema de referencia a partir del texto del .prj (WKT)
function crsDesdePrj(wkt) {
  if (!wkt) return null;
  const t = wkt.replace(/\s+/g, " ");
  const m = t.match(/AUTHORITY\["EPSG",\s*"?(\d+)"?\]\s*\]\s*$/i) || t.match(/ID\["EPSG",\s*(\d+)\]\s*\]\s*$/i);
  if (m && CRS[`EPSG:${m[1]}`]) return `EPSG:${m[1]}`;
  const u = t.toUpperCase();
  if (!u.includes("PROJCS") && !u.includes("PROJCRS")) return u.includes("MAGNA") ? "EPSG:4686" : "EPSG:4326";
  const nombre = (t.match(/PROJ(?:CS|CRS)\["([^"]+)"/i)?.[1] ?? "").toUpperCase();   // solo el nombre del sistema (no "False_Easting")
  if (/ORIGEN.NACIONAL|CTM12|CTM_12/.test(nombre)) return "EPSG:9377";
  if (nombre.includes("MAGNA") || nombre.includes("COLOMBIA")) {
    if (/OESTE.OESTE|FAR.WEST/.test(nombre)) return "EPSG:3114";
    if (/ESTE.CENTRAL|EAST.CENTRAL/.test(nombre)) return "EPSG:3117";
    if (/OESTE|WEST/.test(nombre)) return "EPSG:3115";
    if (/ESTE|EAST/.test(nombre)) return "EPSG:3118";
    if (/BOGOTA/.test(nombre)) return "EPSG:3116";
    // Por los parámetros: meridiano central
    const lon0 = t.match(/central_meridian"?,\s*(-?[\d.]+)/i);
    if (lon0) {
      const v = +lon0[1];
      if (Math.abs(v + 73) < 0.01) return "EPSG:9377";
      const tabla = { "-74.08": "EPSG:3116", "-77.08": "EPSG:3115", "-71.08": "EPSG:3117", "-68.08": "EPSG:3118", "-80.08": "EPSG:3114" };
      return tabla[v.toFixed(2)] ?? null;
    }
  }
  if (/UTM.*ZONE.?18N/.test(nombre)) return "EPSG:32618";
  if (/UTM.*ZONE.?19N/.test(nombre)) return "EPSG:32619";
  return null;
}

// Sin .prj: se adivina por la magnitud de las coordenadas
function adivinarCrs(x, y) {
  if (Math.abs(x) <= 180 && Math.abs(y) <= 90) return "EPSG:4326";
  if (x > 4.2e6 && x < 5.9e6 && y > 1.4e6 && y < 3.2e6) return "EPSG:9377";
  if (x > 0.8e6 && x < 1.25e6 && y > 0.3e6 && y < 2.1e6) return "EPSG:3116";   // origen 1.000.000 en la zona Bogotá
  if (x > 1.6e5 && x < 8.4e5 && y > 0 && y < 1.6e6) return "EPSG:32618";      // UTM 18N (GPS)
  return null;
}

// Reproyecta una colección de anillos { anillos: [[[x,y],...], ...] } a WGS84
function aWgs84(coords, crs) {
  if (!crs || crs === "EPSG:4326" || crs === "EPSG:4686") return coords;
  const def = CRS[crs]?.def ?? crs;   // puede llegar el WKT completo
  const tr = proj4(def, "WGS84");
  const rec = (c) => (typeof c[0] === "number" ? tr.forward([c[0], c[1]]) : c.map(rec));
  return rec(coords);
}

// ---------- Shapefile (.zip) ----------
function areaFirmada(anillo) {
  let s = 0;
  for (let i = 0, j = anillo.length - 1; i < anillo.length; j = i++) s += (anillo[j][0] - anillo[i][0]) * (anillo[j][1] + anillo[i][1]);
  return s / 2;   // > 0 = sentido horario (anillo exterior en shapefile)
}
function puntoEnAnillo([x, y], a) {
  let dentro = false;
  for (let i = 0, j = a.length - 1; i < a.length; j = i++) {
    const [xi, yi] = a[i], [xj, yj] = a[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) dentro = !dentro;
  }
  return dentro;
}
function leerShp(buf) {
  const dv = new DataView(buf), tipo = dv.getInt32(32, true), out = [];
  if (![5, 15, 25].includes(tipo)) throw new Error(tipo === 3 || tipo === 13 ? "El shapefile tiene líneas, no polígonos. Exporta el lindero como polígono." : tipo === 1 || tipo === 11 ? "El shapefile tiene puntos, no polígonos." : `Tipo de geometría no soportado (${tipo}).`);
  let p = 100;
  while (p + 8 <= buf.byteLength) {
    const largo = dv.getInt32(p + 4, false) * 2, c = p + 8, t = dv.getInt32(c, true);
    if (t === 5 || t === 15 || t === 25) {
      const nPartes = dv.getInt32(c + 36, true), nPuntos = dv.getInt32(c + 40, true);
      const partes = [];
      for (let k = 0; k < nPartes; k++) partes.push(dv.getInt32(c + 44 + 4 * k, true));
      const p0 = c + 44 + 4 * nPartes, anillos = [];
      for (let k = 0; k < nPartes; k++) {
        const a = [], fin = k + 1 < nPartes ? partes[k + 1] : nPuntos;
        for (let i = partes[k]; i < fin; i++) a.push([dv.getFloat64(p0 + 16 * i, true), dv.getFloat64(p0 + 16 * i + 8, true)]);
        if (a.length >= 4) anillos.push(a);
      }
      // Exteriores (horario) y huecos (antihorario) → polígonos
      const polis = [];
      for (const a of anillos) if (areaFirmada(a) >= 0) polis.push([a]);
      for (const a of anillos) if (areaFirmada(a) < 0) {
        const dueno = polis.find((pl) => puntoEnAnillo(a[0], pl[0]));
        if (dueno) dueno.push(a); else polis.push([a.slice().reverse()]);   // anillo mal orientado: se toma como exterior
      }
      out.push(polis);
    } else out.push(null);
    p = c + largo;
  }
  return out;
}
function leerDbf(buf, codificacion) {
  const dv = new DataView(buf), n = dv.getUint32(4, true), lh = dv.getUint16(8, true), lr = dv.getUint16(10, true);
  let dec;
  try { dec = new TextDecoder(codificacion || "windows-1252"); } catch { dec = new TextDecoder("utf-8"); }
  const campos = [];
  for (let p = 32; p < lh - 1 && dv.getUint8(p) !== 0x0d; p += 32) {
    const nombre = dec.decode(new Uint8Array(buf, p, 11)).replace(/\0.*$/, "").trim();
    campos.push({ nombre, tipo: String.fromCharCode(dv.getUint8(p + 11)), largo: dv.getUint8(p + 16) });
  }
  const filas = [];
  for (let r = 0; r < n; r++) {
    let p = lh + r * lr + 1;
    const fila = {};
    for (const f of campos) {
      const txt = dec.decode(new Uint8Array(buf, p, f.largo)).trim();
      fila[f.nombre] = f.tipo === "N" || f.tipo === "F" ? (txt === "" ? null : Number(txt)) : txt;
      p += f.largo;
    }
    filas.push(fila);
  }
  return filas;
}
async function leerZip(archivo) {
  const zip = await JSZip.loadAsync(archivo);
  const nombres = Object.keys(zip.files).filter((n) => !zip.files[n].dir && !n.startsWith("__MACOSX"));
  const kml = nombres.find((n) => /\.kml$/i.test(n));
  if (kml && !nombres.some((n) => /\.shp$/i.test(n))) return leerKml(await zip.file(kml).async("string"));   // KMZ
  const shps = nombres.filter((n) => /\.shp$/i.test(n));
  if (!shps.length) throw new Error("El .zip no contiene un archivo .shp.");
  const base = shps[0].replace(/\.shp$/i, ""), parte = (ext) => nombres.find((n) => n.toLowerCase() === `${base}.${ext}`.toLowerCase());
  const shp = await zip.file(shps[0]).async("arraybuffer");
  const dbf = parte("dbf") ? await zip.file(parte("dbf")).async("arraybuffer") : null;
  const prj = parte("prj") ? await zip.file(parte("prj")).async("string") : null;
  const cpg = parte("cpg") ? (await zip.file(parte("cpg")).async("string")).trim() : null;
  const geoms = leerShp(shp), attrs = dbf ? leerDbf(dbf, /utf.?8/i.test(cpg ?? "") ? "utf-8" : cpg && /1252|latin/i.test(cpg) ? "windows-1252" : undefined) : [];
  const rasgos = geoms.map((g, i) => (g && g.length ? { geom: g, props: attrs[i] ?? {} } : null)).filter(Boolean);
  if (!rasgos.length) throw new Error("No se encontraron polígonos en el shapefile.");
  return { rasgos, crsDetectado: crsDesdePrj(prj), prj, formato: `Shapefile (${base.split("/").pop()}.shp)` };
}

// ---------- KML / GeoJSON ----------
function leerKml(texto) {
  const doc = new DOMParser().parseFromString(texto, "text/xml"), rasgos = [];
  const anillo = (el) => (el?.textContent ?? "").trim().split(/\s+/).map((t) => t.split(",").map(Number)).filter((c) => c.length >= 2 && c.every(Number.isFinite)).map((c) => [c[0], c[1]]);
  for (const pm of doc.getElementsByTagName("Placemark")) {
    const polis = [];
    for (const pg of pm.getElementsByTagName("Polygon")) {
      const ext = anillo(pg.getElementsByTagName("outerBoundaryIs")[0]?.getElementsByTagName("coordinates")[0]);
      if (ext.length < 4) continue;
      const huecos = [...pg.getElementsByTagName("innerBoundaryIs")].map((ib) => anillo(ib.getElementsByTagName("coordinates")[0])).filter((a) => a.length >= 4);
      polis.push([ext, ...huecos]);
    }
    if (!polis.length) {   // lindero dibujado como línea cerrada
      for (const ls of pm.getElementsByTagName("LineString")) {
        const a = anillo(ls.getElementsByTagName("coordinates")[0]);
        if (a.length >= 4 && Math.hypot(a[0][0] - a.at(-1)[0], a[0][1] - a.at(-1)[1]) < 1e-5) polis.push([a]);
      }
    }
    if (polis.length) rasgos.push({ geom: polis, props: { nombre: pm.getElementsByTagName("name")[0]?.textContent?.trim() ?? "" } });
  }
  if (!rasgos.length) throw new Error("El KML no tiene polígonos (Placemark con Polygon).");
  return { rasgos, crsDetectado: "EPSG:4326", formato: "KML" };
}
function leerGeojson(texto) {
  const g = JSON.parse(texto), rasgos = [];
  const lista = g.type === "FeatureCollection" ? g.features : g.type === "Feature" ? [g] : [{ type: "Feature", geometry: g, properties: {} }];
  for (const f of lista) {
    const gm = f?.geometry;
    if (gm?.type === "Polygon") rasgos.push({ geom: [gm.coordinates], props: f.properties ?? {} });
    else if (gm?.type === "MultiPolygon") rasgos.push({ geom: gm.coordinates, props: f.properties ?? {} });
  }
  if (!rasgos.length) throw new Error("El GeoJSON no tiene polígonos.");
  const nombreCrs = g.crs?.properties?.name ?? "";
  const m = nombreCrs.match(/EPSG:{1,2}(\d+)/i);
  return { rasgos, crsDetectado: m ? `EPSG:${m[1]}` : null, formato: "GeoJSON" };
}

async function leerArchivoFinca(archivo) {
  const n = archivo.name.toLowerCase();
  if (n.endsWith(".zip") || n.endsWith(".kmz")) return leerZip(archivo);
  if (n.endsWith(".kml")) return leerKml(await archivo.text());
  if (n.endsWith(".geojson") || n.endsWith(".json")) return leerGeojson(await archivo.text());
  if (n.endsWith(".shp")) throw new Error("Sube el shapefile comprimido en un .zip (con .shp, .shx, .dbf y .prj), no el .shp suelto.");
  throw new Error("Formato no reconocido. Usa .zip (shapefile), .kml, .kmz o .geojson.");
}

// Datos leídos → Feature WGS84 (MultiPolygon) con su sistema de referencia resuelto
function armarFinca(datos, crsElegido) {
  const primero = datos.rasgos[0].geom[0][0][0];
  const crs = crsElegido && crsElegido !== "auto" ? crsElegido : datos.crsDetectado ?? adivinarCrs(primero[0], primero[1]);
  if (!crs) throw new Error("No se pudo reconocer el sistema de referencia. Elígelo en la lista.");
  const multi = datos.rasgos.flatMap((r) => aWgs84(r.geom, crs));
  const props = datos.rasgos[0].props ?? {};
  const claveNombre = Object.keys(props).find((k) => /^(nombre|name|finca|predio|nom_predio|nom_finca|lote)$/i.test(k));
  const f = { type: "Feature", geometry: { type: "MultiPolygon", coordinates: multi },
    properties: { nombre: (claveNombre && String(props[claveNombre]).trim()) || "Mi finca", lotes: datos.rasgos.length, crs, formato: datos.formato } };
  const c = centroide(f), [o, s, e, n] = COLOMBIA;
  f.properties.fueraDeColombia = !(c[0] > o && c[0] < e && c[1] > s && c[1] < n);
  return f;
}

// ---------- Medidas (proyección local equirectangular, suficiente a escala de finca) ----------
const R_TIERRA = 6371008.8;
// Metros por grado en el elipsoide WGS84 a la latitud dada (paralelo y meridiano)
function metrosGrado(lat0) { const f = (lat0 * Math.PI) / 180; return [111412.84 * Math.cos(f) - 93.5 * Math.cos(3 * f), 111132.954 - 559.822 * Math.cos(2 * f) + 1.175 * Math.cos(4 * f)]; }
function aLocal(lat0) { const [kx, ky] = metrosGrado(lat0); return ([lon, lat], lon0) => [(lon - lon0) * kx, (lat - lat0) * ky]; }
function cajaDe(f) {
  let o = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const pl of f.geometry.coordinates) for (const [x, y] of pl[0]) { o = Math.min(o, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y); }
  return [o, s, e, n];
}
function centroide(f) {
  const [o, s, e, n] = cajaDe(f), lon0 = (o + e) / 2, lat0 = (s + n) / 2, L = aLocal(lat0);
  let A = 0, cx = 0, cy = 0;
  for (const pl of f.geometry.coordinates) for (let k = 0; k < pl.length; k++) {
    const a = pl[k].map((p) => L(p, lon0));
    for (let i = 0, j = a.length - 1; i < a.length; j = i++) {
      const cr = a[j][0] * a[i][1] - a[i][0] * a[j][1];
      A += cr; cx += (a[j][0] + a[i][0]) * cr; cy += (a[j][1] + a[i][1]) * cr;
    }
  }
  if (Math.abs(A) < 1e-9) return [lon0, lat0];
  cx /= 3 * A; cy /= 3 * A;
  const [kx, ky] = metrosGrado(lat0);
  return [lon0 + cx / kx, lat0 + cy / ky];
}
function areaHa(f) {
  const [, s, , n] = cajaDe(f), lat0 = (s + n) / 2, L = aLocal(lat0);
  let A = 0;
  for (const pl of f.geometry.coordinates) pl.forEach((anillo, k) => {
    const a = anillo.map((p) => L(p, 0));
    let s2 = 0;
    for (let i = 0, j = a.length - 1; i < a.length; j = i++) s2 += a[j][0] * a[i][1] - a[i][0] * a[j][1];
    A += (k === 0 ? 1 : -1) * Math.abs(s2 / 2);
  });
  return A / 1e4;
}
function distanciaKm([lo1, la1], [lo2, la2]) {
  const r = Math.PI / 180, dLa = (la2 - la1) * r, dLo = (lo2 - lo1) * r;
  const a = Math.sin(dLa / 2) ** 2 + Math.cos(la1 * r) * Math.cos(la2 * r) * Math.sin(dLo / 2) ** 2;
  return (2 * R_TIERRA * Math.asin(Math.sqrt(a))) / 1000;
}
function perimetroKm(f) {
  let p = 0;
  for (const pl of f.geometry.coordinates) { const a = pl[0]; for (let i = 1; i < a.length; i++) p += distanciaKm(a[i - 1], a[i]); }
  return p;
}
// Círculo de análisis: centrado en la finca, con radio que la cubre más un margen (el agua de las laderas vecinas entra)
function circuloParaFinca(f, margenKm) {
  const c = centroide(f);
  let r = 0;
  for (const pl of f.geometry.coordinates) for (const p of pl[0]) r = Math.max(r, distanciaKm(c, p));
  return { centro: c, kmFinca: r, km: Math.min(3, Math.max(0.3, r + margenKm)) };
}
function circuloGeo([lon, lat], km, n = 128) {
  const dLat = km / 110.574, dLon = km / (111.32 * Math.cos((lat * Math.PI) / 180)), a = [];
  for (let i = 0; i <= n; i++) { const t = (2 * Math.PI * i) / n; a.push([lon + dLon * Math.cos(t), lat + dLat * Math.sin(t)]); }
  return { type: "Polygon", coordinates: [a] };
}
function cajaCirculo([lon, lat], km) {
  const dLat = km / 110.574, dLon = km / (111.32 * Math.cos((lat * Math.PI) / 180));
  return [lon - dLon, lat - dLat, lon + dLon, lat + dLat];
}

if (typeof module !== "undefined") module.exports = { CRS, crsDesdePrj, adivinarCrs, aWgs84, leerShp, leerDbf, leerKml, leerGeojson, armarFinca, centroide, areaHa, perimetroKm, circuloParaFinca, distanciaKm, puntoEnAnillo };
