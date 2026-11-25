// CultivoAlerta · Módulo 2: maqueta 3D del círculo de análisis.
// Adaptada, con permiso de la autora, de la maqueta del observatorio de Diamela Dego
// (https://github.com/diamedego/Mapa-de-riesgo-super-ni-o, web/simulador.js): el círculo recortado como un terrón de tierra,
// con la imagen satelital encima, puntos cardinales alrededor y cámara que se gira arrastrando.
// Acá el agua que se ve es la del modelo hidráulico de CultivoAlerta, hora por hora, con los mismos colores del mapa.
"use strict";

const THREE_URL = "https://cdn.jsdelivr.net/npm/three@0.147.0/build/three.min.js";
const THREE_RESPALDO = "https://cdnjs.cloudflare.com/ajax/libs/three.js/r147/three.min.js";
const SAT_ALTA = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const SAT_EOX = "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/g/{z}/{y}/{x}.jpg";   // respaldo: Sentinel-2 sin nubes (~10 m)
const TESELA_VACIA = 3000;      // Esri devuelve una tesela «sin datos» de ~2,5 KB donde no tiene ese zoom
const TERRON_ANILLOS = 16;
const limitar = (v, a, b) => Math.min(b, Math.max(a, v));

let cargaThree = null, maqueta = null;
const cargarThree = () => (cargaThree ??= new Promise((ok, mal) => {
  const cargar = (url, siFalla) => {
    const sc = document.createElement("script"); sc.src = url; sc.onload = ok;
    sc.onerror = () => { sc.remove(); if (siFalla) cargar(siFalla); else { cargaThree = null; mal(new Error("No se pudo descargar three.js (revisa la conexión o el bloqueador de anuncios).")); } };
    document.head.appendChild(sc);
  };
  cargar(THREE_URL, THREE_RESPALDO);
}));

// Imagen satelital del recuadro del círculo (Esri hasta z 18; si no hay detalle, un zoom menor; si Esri no responde, EOX)
async function sateliteCaja(zoom, gx0, gy0, bw, bh, S) {
  const cv = Object.assign(document.createElement("canvas"), { width: Math.round(bw * S), height: Math.round(bh * S) }), c = cv.getContext("2d");
  c.fillStyle = "rgb(150,140,110)"; c.fillRect(0, 0, cv.width, cv.height);
  const k = Math.max(0, Math.min(Math.round(Math.log2(S)), 18 - zoom)), z = zoom + k, f = 2 ** k;
  const tiles = [];
  for (let tx = Math.floor((gx0 * f) / 256); tx <= Math.floor(((gx0 + bw) * f) / 256); tx++)
    for (let ty = Math.floor((gy0 * f) / 256); ty <= Math.floor(((gy0 + bh) * f) / 256); ty++) tiles.push([tx, ty]);
  const pedir = async (url) => {
    const ctl = new AbortController(), reloj = setTimeout(() => ctl.abort(), 15000);
    const r = await fetch(url, { signal: ctl.signal }).finally(() => clearTimeout(reloj));
    if (!r.ok) throw new Error(r.status);
    return r.blob();
  };
  const fuentes = [0, 1, 2, 3].filter((d) => z - d >= 10).map((d) => [SAT_ALTA, d]).concat([[SAT_EOX, Math.max(0, z - 15)]]);
  const bajar = async ([tx, ty]) => {
    const lado = (256 / f) * S, dx = ((tx * 256) / f - gx0) * S, dy = ((ty * 256) / f - gy0) * S;
    for (const [url, d] of fuentes) {
      const q = 2 ** d, px = Math.floor(tx / q), py = Math.floor(ty / q), sub = 256 / q;
      try {
        const b = await pedir(url.replace("{z}", z - d).replace("{x}", px).replace("{y}", py));
        if (url === SAT_ALTA && b.size < TESELA_VACIA) continue;
        c.drawImage(await createImageBitmap(b), (tx % q) * sub, (ty % q) * sub, sub, sub, dx, dy, lado, lado);
        return;
      } catch { /* siguiente fuente */ }
    }
  };
  for (let i = 0; i < tiles.length; i += 8) await Promise.all(tiles.slice(i, i + 8).map(bajar));
  return cv;
}

// Forma del terrón (de la maqueta de Diamela Dego): radio, corrimientos, profundidad y color de tierra de cada vértice de la pared
function terronForma(N, J, Rm) {
  let semilla = 7;
  const azar = () => ((semilla = (semilla * 16807) % 2147483647) / 2147483647);
  const ondas = (n) => Array.from({ length: n }, (_, i) => ({ f: 2 + i * 2 + Math.floor(azar() * 3), fase: azar() * 6.283, a: 1 / (1 + i * 0.8) }));
  const oR = ondas(6), oY = ondas(5), oC = ondas(4);
  const ruido = (o, a, t) => o.reduce((s, w) => s + w.a * Math.sin(w.f * a + w.fase + t * (2 + w.f * 0.7)), 0) / o.reduce((s, w) => s + w.a, 0);
  const prof = Rm * 0.75, punta = [(azar() - 0.5) * Rm * 0.18, (azar() - 0.5) * Rm * 0.18];
  const n = (N + 1) * (J + 1), rf = new Float32Array(n), dx = new Float32Array(n), dy = new Float32Array(n), dz = new Float32Array(n), color = new Float32Array(n * 3);
  for (let k = 0; k <= N; k++) {
    const a = ((k % N) / N) * Math.PI * 2;
    for (let j = 0; j <= J; j++) {
      const v = k * (J + 1) + j, t = j <= 1 ? 0 : (j - 1) / (J - 1), grano = azar();
      const perfil = j <= 1 ? 1 : Math.pow(1 - t, 0.75) * (1 + 0.16 * ruido(oR, a, t) * Math.sin(Math.PI * Math.min(1, t * 1.6)) + (grano - 0.5) * 0.05 * (1 - t));
      rf[v] = Math.max(0.015, perfil);
      dx[v] = punta[0] * Math.pow(t, 2); dz[v] = punta[1] * Math.pow(t, 2);
      dy[v] = j === 0 ? 0 : j === 1 ? prof * 0.035 : prof * (0.035 + 0.965 * Math.pow(t, 0.9) * (1 + 0.22 * ruido(oY, a, 0.3) * t) + (grano - 0.5) * 0.02);
      const veta = 0.5 + 0.5 * ruido(oC, a, t * 3), c = j <= 1 ? [62, 46, 31] : [118 + 38 * veta - 26 * t, 92 + 28 * veta - 22 * t, 62 + 20 * veta - 16 * t];
      const luz = 0.86 + grano * 0.28;
      for (let q = 0; q < 3; q++) color[v * 3 + q] = Math.min(255, c[q] * luz) / 255;
    }
  }
  return { rf, dx, dy, dz, color, prof };
}

function crearRenderer() {
  const intentos = [{ antialias: true, alpha: true }, { antialias: false, alpha: true }, { antialias: false, alpha: false, powerPreference: "low-power", failIfMajorPerformanceCaveat: false }];
  let ultimo;
  for (const o of intentos) { try { return new THREE.WebGLRenderer(o); } catch (e) { ultimo = e; } }
  throw new Error(`Este navegador no pudo iniciar WebGL (${ultimo?.message ?? "sin detalle"}). Revisa que esté activada la aceleración por hardware.`);
}

// ---------- Crear la maqueta para un terreno (la grilla de prepararTerreno) ----------
async function crearMaqueta(d, cont, finca, avance = () => {}) {
  avance("Cargando la maqueta 3D…");
  await cargarThree();
  const FW = d.FW, m = d.metrosPx;
  let x0 = FW, x1 = 0, y0 = d.FH, y1 = 0;
  for (let i = 0; i < d.dentroFino.length; i++) if (d.dentroFino[i]) { const x = i % FW, y = (i / FW) | 0; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
  const S = 2 ** Math.max(0, Math.min(18 - d.zoom, Math.floor(Math.log2((innerWidth < 700 ? 1536 : 2048) / Math.max(bw, bh)))));
  avance("Descargando la imagen satelital de la maqueta…");
  const sat = await sateliteCaja(d.zoom, d.gx0 + x0, d.gy0 + y0, bw, bh, S);
  // Lindero de la finca (amarillo, como en el mapa) en un lienzo aparte: va encima de las capas y del agua
  const lindero = Object.assign(document.createElement("canvas"), { width: sat.width, height: sat.height });
  {
    const c = lindero.getContext("2d"), aT = ([lo, la]) => [(xDeLon(lo, d.zoom) * 256 - d.gx0 - x0) * S, (yDeLat(la, d.zoom) * 256 - d.gy0 - y0) * S];
    const pols = finca.geometry.type === "Polygon" ? [finca.geometry.coordinates] : finca.geometry.coordinates;
    c.lineJoin = "round";
    for (const [w, col] of [[Math.max(4, S * 1.6), "rgba(43,33,0,0.75)"], [Math.max(2, S * 0.8), "#f2b705"]]) {
      c.beginPath();
      for (const p of pols) for (const a of p) { a.forEach((q, j) => { const [x, y] = aT(q); j ? c.lineTo(x, y) : c.moveTo(x, y); }); c.closePath(); }
      c.lineWidth = w; c.strokeStyle = col; c.stroke();
    }
  }

  const capa = document.createElement("div");
  capa.className = "maqueta";
  capa.innerHTML = `<div class="maqueta-relieve"><span>Relieve</span><button class="chip" data-ex="1">× 1</button><button class="chip" data-ex="3">× 3</button><button class="chip" data-ex="6">× 6</button></div>
    <p class="maqueta-ayuda">Arrastra para girar · rueda o pellizco para acercar</p>
    <p class="maqueta-credito">Maqueta adaptada, con permiso, del observatorio de <a href="https://github.com/diamedego/Mapa-de-riesgo-super-ni-o" target="_blank" rel="noopener">Diamela Dego</a> · Imagen: Esri World Imagery</p>`;
  cont.appendChild(capa);
  const ren = crearRenderer();
  ren.setPixelRatio(Math.min(2, devicePixelRatio));
  capa.prepend(ren.domElement);

  // Malla del terreno: un vértice cada `paso` píxeles del relieve dentro del círculo
  const cx = (x0 + x1 + 1) / 2, cy = (y0 + y1 + 1) / 2, R = bw / 2;
  const paso = Math.max(1, Math.ceil(bw / 260)), pix = [], pos = [], uv = [], idx = [], id = new Map();
  for (let y = y0; y <= y1; y += paso) for (let x = x0; x <= x1; x += paso) {
    const i = y * FW + x;
    if (!d.dentroFino[i]) continue;
    id.set(i, pix.length); pix.push(i);
    pos.push((x + 0.5 - cx) * m, 0, (y + 0.5 - cy) * m);
    uv.push((x - x0 + 0.5) / bw, 1 - (y - y0 + 0.5) / bh);
  }
  for (let y = y0; y + paso <= y1; y += paso) for (let x = x0; x + paso <= x1; x += paso) {
    const a = id.get(y * FW + x), b = id.get(y * FW + x + paso), c = id.get((y + paso) * FW + x), e = id.get((y + paso) * FW + x + paso);
    if (a != null && b != null && c != null) idx.push(a, c, b);
    if (b != null && c != null && e != null) idx.push(b, c, e);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  const textura = Object.assign(document.createElement("canvas"), { width: sat.width, height: sat.height });
  const tex = new THREE.CanvasTexture(textura);
  tex.anisotropy = 4;
  const escena = new THREE.Scene();
  escena.add(new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide })));

  // Borde del círculo y terrón de tierra debajo (decorativo)
  const N = 360, borde = [];
  for (let k = 0; k <= N; k++) {
    const an = (k / N) * Math.PI * 2;
    let i = -1;
    for (let f = 0.995; f > 0.85 && i < 0; f -= 0.005) {
      const j = Math.round(cy - 0.5 + Math.sin(an) * R * f) * FW + Math.round(cx - 0.5 + Math.cos(an) * R * f);
      if (d.dentroFino[j]) i = j;
    }
    borde.push({ x: Math.cos(an) * R * m, z: Math.sin(an) * R * m, i });
  }
  const J = TERRON_ANILLOS, terron = terronForma(N, J, R * m), pared = new THREE.BufferGeometry(), pi = [];
  for (let k = 0; k < N; k++) for (let j = 0; j < J; j++) { const a = k * (J + 1) + j, b = a + J + 1; pi.push(a, a + 1, b, b, a + 1, b + 1); }
  pared.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array((N + 1) * (J + 1) * 3), 3));
  pared.setAttribute("color", new THREE.Float32BufferAttribute(terron.color, 3));
  pared.setIndex(pi);
  const mallaPared = new THREE.Mesh(pared, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  mallaPared.frustumCulled = false;
  escena.add(mallaPared);
  const sombra = new THREE.Mesh(new THREE.CircleGeometry(R * m * 0.75, 96), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.07 }));
  sombra.rotation.x = -Math.PI / 2; escena.add(sombra);
  escena.add(new THREE.AmbientLight(0xffffff, 0.62));
  const sol = new THREE.DirectionalLight(0xffffff, 0.75); sol.position.set(-1, 1.4, -0.6); escena.add(sol);
  const cam = new THREE.PerspectiveCamera(32, 1, 10, 1e7);

  // Alturas del círculo (mínimo, máximo) para la base y la cámara
  let hMin = Infinity, hMax = -Infinity;
  for (const i of pix) { hMin = Math.min(hMin, d.zFino[i]); hMax = Math.max(hMax, d.zFino[i]); }

  const M = { d, capa, ren, escena, cam, geo, pared, sombra, tex, textura, sat, lindero, pix, borde, terron, R: R * m, x0, y0, bw, bh, S, hMin, hMax,
    ex: 3, azimut: 0.6, elevacion: 0.42, distancia: 0.8, dibujar: 0, prof: null, agua: null, capaExtra: null };

  // Norte, sur, este y oeste alrededor del círculo (el norte es −z y el este +x, como en la imagen)
  const card = new THREE.Group(); escena.add(card); M.cardinales = card;
  { const Rm = R * m, dir = { N: [0, -1], S: [0, 1], E: [1, 0], O: [-1, 0] };
    for (const [p, [dx, dz]] of Object.entries(dir)) {
      const L = 0.034 * Rm, w = 0.018 * Rm, g = new THREE.BufferGeometry(), col = p === "N" ? 0x1f5130 : 0x4b5563;
      g.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, -w, L, 0, 0, 0, 0, w], 3));
      const flecha = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: col, side: THREE.DoubleSide, transparent: true, depthWrite: false }));
      flecha.position.set(dx * 1.2 * Rm, 0, dz * 1.2 * Rm); flecha.rotation.y = -Math.atan2(dz, dx); card.add(flecha);
      const cv = Object.assign(document.createElement("canvas"), { width: 64, height: 64 }), c2 = cv.getContext("2d");
      c2.font = "700 32px Inter, sans-serif"; c2.textAlign = "center"; c2.textBaseline = "middle";
      c2.lineWidth = 4; c2.strokeStyle = "rgba(255,255,255,0.85)"; c2.fillStyle = p === "N" ? "#1f5130" : "#4b5563";
      c2.strokeText(p, 32, 34); c2.fillText(p, 32, 34);
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthWrite: false }));
      const esc = innerWidth < 700 ? 0.1 : 0.07;
      sp.scale.set(esc * Rm, esc * Rm, 1); sp.position.set(dx * 1.42 * Rm, 0.01 * Rm, dz * 1.42 * Rm); card.add(sp);
    } }

  // Cámara orbital: arrastrar gira, rueda o pellizco acercan
  const lienzo = ren.domElement, toques = new Map();
  let previo = null;
  lienzo.addEventListener("pointerdown", (e) => { lienzo.setPointerCapture(e.pointerId); toques.set(e.pointerId, [e.clientX, e.clientY]); previo = null; });
  lienzo.addEventListener("pointermove", (e) => {
    if (!toques.has(e.pointerId)) return;
    const ant = toques.get(e.pointerId);
    toques.set(e.pointerId, [e.clientX, e.clientY]);
    if (toques.size === 1) { M.azimut -= (e.clientX - ant[0]) * 0.008; M.elevacion = limitar(M.elevacion + (e.clientY - ant[1]) * 0.006, 0.08, 1.45); }
    else {
      const [p, q] = [...toques.values()], dist = Math.hypot(p[0] - q[0], p[1] - q[1]);
      if (previo) M.distancia = limitar(M.distancia * (previo / dist), 0.3, 2.5);
      previo = dist;
    }
    cuadroMaqueta();
  });
  const soltar = (e) => { toques.delete(e.pointerId); previo = null; };
  lienzo.addEventListener("pointerup", soltar); lienzo.addEventListener("pointercancel", soltar);
  lienzo.addEventListener("wheel", (e) => { e.preventDefault(); M.distancia = limitar(M.distancia * Math.exp(e.deltaY * 0.001), 0.3, 2.5); cuadroMaqueta(); }, { passive: false });
  M.redimensionar = () => {
    const w = capa.clientWidth, h = capa.clientHeight;
    if (!w || !h) return;
    ren.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix();
    cuadroMaqueta();
  };
  M.observador = new ResizeObserver(() => M.redimensionar());
  M.observador.observe(capa);
  capa.querySelectorAll("[data-ex]").forEach((b) => (b.onclick = () => { M.ex = +b.dataset.ex; marcarRelieve(M); alturasMaqueta(M); cuadroMaqueta(); }));
  marcarRelieve(M);
  maqueta = M;
  return M;
}
function marcarRelieve(M) { M.capa.querySelectorAll("[data-ex]").forEach((b) => b.classList.toggle("activo", +b.dataset.ex === M.ex)); }

// Profundidad del agua en cada píxel fino (la misma cuenta que imagenAgua: nivel de la celda contra la altura del píxel)
function profundidadesFinas(Mod, k, verMax) {
  const d = Mod.d, out = new Float32Array(d.FW * d.FH), fr = verMax ? null : Mod.frames[k];
  for (let y = 0; y < d.FH; y++) {
    const cy = ((y / d.f) | 0) * d.nx;
    for (let x = 0; x < d.FW; x++) {
      const i = y * d.FW + x, ci = cy + ((x / d.f) | 0);
      if (!d.dentroFino[i] || d.tipo2[ci] !== 1) continue;
      const h = verMax ? Mod.hMax[ci] : fr[ci] / 1000;
      if (h - d.cauce[ci] < AGUA_VER) continue;
      out[i] = Math.max(0, Math.min(d.z[ci] + h - d.zFino[i], h - d.cauce[ci] + 0.5));
    }
  }
  return out;
}

// Alturas: terreno + lámina de agua (desde 10 cm), con la exageración del relieve elegida
function alturasMaqueta(M) {
  const d = M.d, ex = M.ex, piso = M.hMin - 2, prof = M.prof;
  const fondo = -Math.max(10, (M.hMax - M.hMin) * 0.35) * ex;
  const altura = (i) => (i < 0 ? 0 : (d.zFino[i] + (prof && prof[i] >= AGUA_MIN ? prof[i] : 0) - piso) * ex);
  const P = M.geo.attributes.position;
  M.pix.forEach((i, k) => P.setY(k, altura(i)));
  P.needsUpdate = true; M.geo.computeVertexNormals();
  const Q = M.pared.attributes.position, T = M.terron, J = TERRON_ANILLOS;
  M.borde.forEach((b, k) => {
    const arriba = altura(b.i);
    for (let j = 0; j <= J; j++) {
      const v = k * (J + 1) + j, rf = T.rf[v];
      Q.setXYZ(v, b.x * rf + T.dx[v], j === 0 ? arriba : fondo - T.dy[v], b.z * rf + T.dz[v]);
    }
  });
  Q.needsUpdate = true; M.pared.computeVertexNormals();
  M.sombra.position.y = fondo - T.prof * 1.25;
  M.fondo = fondo; M.alto = (M.hMax - piso) * ex;
  M.cardinales.position.y = 0;
}

// Textura: imagen satelital → capa del módulo 1 (NDVI, etc.) → agua del modelo → lindero
function texturaMaqueta(M) {
  const ct = M.textura.getContext("2d"), d = M.d;
  ct.drawImage(M.sat, 0, 0);
  ct.imageSmoothingEnabled = true;
  if (M.capaExtra) {   // imagen en grados (caja del círculo): se ubica por sus esquinas en la textura (Mercator ≈ lineal a esta escala)
    const [[o, n], , [e, s]] = M.capaExtra.coordenadas, aT = (lo, la) => [(xDeLon(lo, d.zoom) * 256 - d.gx0 - M.x0) * M.S, (yDeLat(la, d.zoom) * 256 - d.gy0 - M.y0) * M.S];
    const [x0, y0] = aT(o, n), [x1, y1] = aT(e, s);
    ct.globalAlpha = 0.92; ct.drawImage(M.capaExtra.lienzo, x0, y0, x1 - x0, y1 - y0); ct.globalAlpha = 1;
  }
  if (M.agua) ct.drawImage(M.agua, M.x0, M.y0, M.bw, M.bh, 0, 0, M.bw * M.S, M.bh * M.S);
  ct.drawImage(M.lindero, 0, 0);
  M.tex.needsUpdate = true;
}

// Agua del modelo a una hora (o sin modelo: maqueta seca)
function aguaMaqueta(Mod, k, verMax = false) {
  const M = maqueta;
  if (!M) return;
  if (Mod?.frames?.length && Mod.d === M.d) { M.prof = profundidadesFinas(Mod, k, verMax); M.agua = imagenAgua(Mod, k, verMax); }
  else { M.prof = null; M.agua = null; }
  alturasMaqueta(M); texturaMaqueta(M); cuadroMaqueta();
}
// Capa satelital del módulo 1 sobre la maqueta ({ lienzo, coordenadas } o null)
function capaMaqueta(r) {
  const M = maqueta;
  if (!M) return;
  M.capaExtra = r?.lienzo ? r : null;
  texturaMaqueta(M); cuadroMaqueta();
}
function ayudaMaqueta(txt) { maqueta?.capa.querySelector(".maqueta-ayuda") && (maqueta.capa.querySelector(".maqueta-ayuda").textContent = txt); }

function cuadroMaqueta() {
  const M = maqueta;
  if (!M || M.dibujar) return;
  M.dibujar = requestAnimationFrame(() => {
    M.dibujar = 0;
    const fovV = (M.cam.fov * Math.PI) / 180, fovH = 2 * Math.atan(Math.tan(fovV / 2) * M.cam.aspect);
    const dist = ((M.R * 1.38) / Math.sin(Math.min(fovV, fovH) / 2)) * M.distancia, bajar = (M.terron?.prof ?? 0) * 0.32, ce = Math.cos(M.elevacion);
    M.cam.position.set(Math.sin(M.azimut) * ce * dist, Math.sin(M.elevacion) * dist + (M.fondo ?? 0) * 0.3 - bajar, Math.cos(M.azimut) * ce * dist);
    M.cam.lookAt(0, ((M.fondo ?? 0) + (M.alto ?? 0)) * 0.3 - bajar, 0);
    M.ren.render(M.escena, M.cam);
  });
}

function cerrarMaqueta() {
  const M = maqueta;
  if (!M) return;
  if (M.dibujar) cancelAnimationFrame(M.dibujar);
  M.observador.disconnect();
  M.ren.dispose(); M.ren.forceContextLoss?.();
  M.capa.remove();
  maqueta = null;
}
