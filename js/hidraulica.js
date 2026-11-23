// CultivoAlerta · Modelo hidráulico 2D (corre en un Web Worker para no trabar la página).
// Adaptado, con permiso de la autora, del simulador del «Observatorio de riesgo de inundación · Argentina frente a El Niño 2026-27»
// de Diamela Dego (https://github.com/diamedego/Mapa-de-riesgo-super-ni-o).
//
// Ecuaciones: aproximación inercial local de las aguas poco profundas (Bates, Horritt y Fewtrell 2010; de Almeida y otros 2012),
// la misma familia de LISFLOOD-FP. Infiltración de Green-Ampt con humedad del suelo que evoluciona.
// Cambio para Colombia: cada celda de río tiene su propio nivel base (en la Sabana el río Bogotá baja poco, pero en una ventana
// de varios kilómetros un nivel único dejaba el río más bajo que la llanura aguas arriba). Sobre ese nivel se suma la crecida.
// Bordes del área: salida libre.
function trabajoHidraulico() {
  "use strict";
  const G = 9.81, ALFA = 0.7, H_MIN = 0.002;
  let S = null, cortar = false;

  onmessage = (e) => {
    const m = e.data;
    if (m.tipo === "iniciar") { cortar = false; iniciar(m); correr(); }
    else if (m.tipo === "parar") cortar = true;
  };

  function iniciar(m) {
    const { nx, ny, dx } = m, N = nx * ny;
    S = { ...m, par: m.suelo, N, h: new Float32Array(N), qx: new Float32Array((nx + 1) * ny), qy: new Float32Array(nx * (ny + 1)),
      hMax: new Float32Array(N), suelo: new Float32Array(N), fEvento: new Float32Array(N), secas: new Uint16Array(N) };
    S.nLagos = 0;
    for (let i = 0; i < N; i++) if (m.tipo2[i] === 2) S.nLagos = Math.max(S.nLagos, m.lago[i] + 1);
    S.nivelLago = new Float64Array(S.nLagos).fill(Infinity); S.areaLago = new Float64Array(S.nLagos);
    const orilla = (i, fn) => { const x = i % nx, y = (i / nx) | 0; for (const [vx, vy] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) if (vx >= 0 && vy >= 0 && vx < nx && vy < ny) fn(vy * nx + vx); };
    for (let i = 0; i < N; i++) if (m.tipo2[i] === 2) {
      const l = m.lago[i]; S.nivelLago[l] = Math.min(S.nivelLago[l], m.z[i]); S.areaLago[l] += dx * dx;
      orilla(i, (v) => { if (m.tipo2[v] === 1) S.nivelLago[l] = Math.min(S.nivelLago[l], m.z[v] - 0.05); });
    }
    if (m.lagoOffset) for (let l = 0; l < S.nLagos; l++) S.nivelLago[l] += m.lagoOffset;
    S.nivel0 = Float64Array.from(S.nivelLago);
    S.crecida = m.crecida || 0;
    S.cuenta = { lluvia: 0, infiltrada: 0, desague: 0, evaporada: 0, salida: 0, lagos: 0, rio: 0 };
    for (let i = 0; i < N; i++) S.suelo[i] = Math.min(m.suelo.thetaS, m.theta0) * 300;   // mm en la capa de 30 cm
    calcularFondos();
  }

  function eta(i) {
    const t = S.tipo2[i];
    if (t === 1) return S.z[i] + S.h[i];
    if (t === 2) return S.nivelLago[S.lago[i]];
    if (t === 3) return S.baseRio[i] + S.crecida;
    return NaN;
  }
  // Fondo de cada celda (fijo): tierra = relieve; lagunas y ríos = 5 m bajo su superficie
  function calcularFondos() {
    S.fondo = new Float32Array(S.N);
    for (let i = 0; i < S.N; i++) S.fondo[i] = S.tipo2[i] === 1 ? S.z[i] : Math.min(S.z[i], S.tipo2[i] === 3 ? S.baseRio[i] : S.nivel0[S.lago[i]]) - 5;
  }

  function caudal(qViejo, a, b, dt, n) {
    const ea = eta(a), eb = eta(b);
    const hf = Math.max(ea, eb) - Math.max(S.fondo[a], S.fondo[b]);
    if (!(hf > H_MIN)) return 0;
    let q = (qViejo - G * hf * dt * (eb - ea) / S.dx) / (1 + G * dt * n * n * Math.abs(qViejo) / (hf * hf * Math.cbrt(hf)));
    // Limitador: no sacar de una celda de tierra más agua de la que tiene
    if (q > 0) { if (S.tipo2[a] === 1) q = Math.min(q, S.h[a] * S.dx / (4 * dt)); }
    else if (S.tipo2[b] === 1) q = Math.max(q, -S.h[b] * S.dx / (4 * dt));
    return q;
  }

  function pasoHidraulico(dt) {
    const { nx, ny, dx, h, qx, qy, tipo2, nMan } = S;
    for (let y = 0; y < ny; y++) for (let x = 1; x < nx; x++) {
      const a = y * nx + x - 1, b = a + 1, f = y * (nx + 1) + x;
      if ((tipo2[a] !== 1 && tipo2[b] !== 1) || (tipo2[a] === 1 && tipo2[b] === 1 && h[a] < H_MIN && h[b] < H_MIN)) { qx[f] = 0; continue; }
      qx[f] = caudal(qx[f], a, b, dt, 0.5 * (nMan[a] + nMan[b]));
    }
    for (let y = 1; y < ny; y++) for (let x = 0; x < nx; x++) {
      const a = (y - 1) * nx + x, b = a + nx, f = y * nx + x;
      if ((tipo2[a] !== 1 && tipo2[b] !== 1) || (tipo2[a] === 1 && tipo2[b] === 1 && h[a] < H_MIN && h[b] < H_MIN)) { qy[f] = 0; continue; }
      qy[f] = caudal(qy[f], a, b, dt, 0.5 * (nMan[a] + nMan[b]));
    }
    const salida = (i) => (tipo2[i] === 1 && h[i] > H_MIN ? Math.min(Math.pow(h[i], 5 / 3) * 0.0316 / nMan[i], h[i] * dx / (4 * dt)) : 0);
    for (let y = 0; y < ny; y++) { qx[y * (nx + 1)] = -salida(y * nx); qx[y * (nx + 1) + nx] = salida(y * nx + nx - 1); }
    for (let x = 0; x < nx; x++) { qy[x] = -salida(x); qy[ny * nx + x] = salida((ny - 1) * nx + x); }
    let sal = 0;
    for (let y = 0; y < ny; y++) sal += qx[y * (nx + 1) + nx] - qx[y * (nx + 1)];
    for (let x = 0; x < nx; x++) sal += qy[ny * nx + x] - qy[x];
    S.cuenta.salida += sal * dt * dx;
    const dV = S.nLagos ? new Float64Array(S.nLagos) : null;
    for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
      const i = y * nx + x, neto = qx[y * (nx + 1) + x] - qx[y * (nx + 1) + x + 1] + qy[y * nx + x] - qy[(y + 1) * nx + x];
      if (tipo2[i] === 1) h[i] = Math.max(0, h[i] + dt * neto / dx);
      else if (tipo2[i] === 2) dV[S.lago[i]] += dt * neto * dx;
      else if (tipo2[i] === 3) S.cuenta.rio += dt * neto * dx;
    }
    if (dV) for (let l = 0; l < S.nLagos; l++) S.nivelLago[l] += dV[l] / S.areaLago[l];
  }

  function balance(horas, lluviaMm, et0Mm) {
    const { N, h, tipo2, imp, suelo, fEvento, secas } = S, P = S.par;
    for (let i = 0; i < N; i++) {
      if (tipo2[i] !== 1) continue;
      let agua = h[i] * 1000 + lluviaMm;
      const a2 = S.dx * S.dx / 1000;
      S.cuenta.lluvia += lluviaMm * a2;
      const theta = suelo[i] / 300, hueco = Math.max(0, P.thetaS - theta);
      const fcap = P.ks * (1 + P.psi * hueco / Math.max(fEvento[i], 5)) * horas;
      const inf = Math.min(agua * (1 - imp[i]), fcap * (1 - imp[i]), hueco * 300);
      agua -= inf; suelo[i] += inf; fEvento[i] += inf; S.cuenta.infiltrada += inf * a2;
      const des = Math.min(agua, S.desague * imp[i] * horas); agua -= des; S.cuenta.desague += des * a2;
      if (agua > 0) { const ev = Math.min(agua, et0Mm); agua -= ev; S.cuenta.evaporada += ev * a2; }
      else suelo[i] = Math.max(0, suelo[i] - et0Mm * 0.7 * (theta / P.thetaS));
      suelo[i] = Math.max(0, suelo[i] - P.ks * 0.1 * Math.pow(theta / P.thetaS, 4) * horas);
      if (lluviaMm > 0.01 || agua > 1) secas[i] = 0; else if ((secas[i] += horas >= 1 ? 1 : 0) > 24) fEvento[i] = 0;
      h[i] = agua / 1000;
    }
    for (let l = 0; l < S.nLagos; l++) { S.nivelLago[l] += (lluviaMm - et0Mm) / 1000; S.cuenta.lluvia += lluviaMm * S.areaLago[l] / 1000; S.cuenta.evaporada += et0Mm * S.areaLago[l] / 1000; }
  }

  function correr() {
    const { lluvia, et0, N } = S, horas = lluvia.length;
    let hayRio = false;
    for (let i = 0; i < N; i++) if (S.tipo2[i] === 3) { hayRio = true; break; }
    let quietas = hayRio && S.crecida > 0 ? 0 : 99;   // con el río crecido el agua arranca en movimiento
    const t0 = performance.now();
    for (let k = 0; k < horas; k++) {
      if (cortar) { postMessage({ tipo: "cortado" }); return; }
      const r = lluvia[k], e = et0[k];
      let hAntes = null;
      const mover = r > 0.05 || quietas < 12;
      if (mover) {
        hAntes = Float32Array.from(S.h);
        for (let tramo = 0; tramo < 12; tramo++) {
          balance(1 / 12, r / 12, e / 12);
          let t = 0;
          while (t < 300) {
            let hm = 0.05;
            for (let i = 0; i < N; i++) if (S.h[i] > hm) hm = S.h[i];
            const dt = Math.min(300 - t, 30, ALFA * S.dx / Math.sqrt(G * (hm + 0.3)));
            pasoHidraulico(dt);
            t += dt;
          }
        }
      } else {
        S.qx.fill(0); S.qy.fill(0);
        balance(1, r, e);
      }
      if (hAntes) {
        let dmax = 0;
        for (let i = 0; i < N; i++) { const d = Math.abs(S.h[i] - hAntes[i]); if (d > dmax) dmax = d; }
        quietas = r > 0.05 ? 0 : dmax < 0.002 ? quietas + 1 : 0;
      } else quietas++;
      for (let i = 0; i < N; i++) if (S.h[i] > S.hMax[i]) S.hMax[i] = S.h[i];
      postMessage({ tipo: "hora", k, horas, h: Float32Array.from(S.h), seg: (performance.now() - t0) / 1000 });
    }
    let sup = 0;
    for (let i = 0; i < N; i++) if (S.tipo2[i] === 1) sup += S.h[i] * S.dx * S.dx;
    for (let l = 0; l < S.nLagos; l++) S.cuenta.lagos += (S.nivelLago[l] - S.nivel0[l]) * S.areaLago[l];
    postMessage({ tipo: "fin", hMax: S.hMax, cuenta: { ...S.cuenta, superficie: sup } });
  }
}

// Crea el Web Worker desde el código de arriba (funciona también abriendo index.html sin servidor)
function crearTrabajadorHidraulico() {
  const blob = new Blob([`(${trabajoHidraulico.toString()})();`], { type: "text/javascript" });
  return new Worker(URL.createObjectURL(blob));
}
if (typeof module !== "undefined") module.exports = { trabajoHidraulico };
