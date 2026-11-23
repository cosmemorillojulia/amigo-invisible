/*
 * Algoritmo del sorteo del Amigo Invisible.
 *
 * La web lo usa para comprobar, antes de enviar nada, si el sorteo es posible
 * con las reglas elegidas (exclusiones, asignaciones fijas, parejas cruzadas). El sorteo de verdad se hace en el servidor
 * (backend/Code.gs lleva una copia equivalente), así el móvil nunca ve quién
 * le ha tocado a quién.
 */
(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica();
  else raiz.Sorteo = fabrica();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const INTENTOS_ALEATORIOS = 20000;
  const PASOS_MAXIMOS = 200000;

  function crearError(mensaje, codigo) {
    const error = new Error(mensaje);
    error.codigo = codigo;
    return error;
  }

  function enteroAleatorio(n) {
    const c = typeof crypto !== 'undefined' ? crypto : null;
    if (c && typeof c.getRandomValues === 'function') {
      const buffer = new Uint32Array(1);
      const limite = Math.floor(0x100000000 / n) * n;
      do { c.getRandomValues(buffer); } while (buffer[0] >= limite);
      return buffer[0] % n;
    }
    return Math.floor(Math.random() * n);
  }

  function barajar(lista) {
    const copia = lista.slice();
    for (let i = copia.length - 1; i > 0; i--) {
      const j = enteroAleatorio(i + 1);
      const tmp = copia[i]; copia[i] = copia[j]; copia[j] = tmp;
    }
    return copia;
  }

  function indices(n) {
    return Array.from({ length: n }, (_, i) => i);
  }

  function normalizar(nombre) {
    return String(nombre).trim().toLowerCase();
  }

  /**
   * permitido[i][j] === true  →  i puede regalar a j
   * fijo[i] === j             →  i tiene que regalar a j sí o sí (-1 si no hay nada fijado)
   */
  function matrizPermitidos(nombres, exclusiones, fijas) {
    const n = nombres.length;
    const indice = new Map();
    nombres.forEach((nombre, i) => indice.set(normalizar(nombre), i));
    if (indice.size !== n) throw crearError('Hay nombres repetidos en la lista.', 'DUPLICADO');

    const permitido = indices(n).map(i => indices(n).map(j => i !== j));
    (exclusiones || []).forEach(par => {
      const a = indice.get(normalizar(par[0]));
      const b = indice.get(normalizar(par[1]));
      if (a === undefined || b === undefined) {
        throw crearError(`La exclusión «${par[0]} – ${par[1]}» menciona a alguien que no participa.`, 'EXCLUSION');
      }
      permitido[a][b] = false;
      permitido[b][a] = false;
    });

    const fijo = new Array(n).fill(-1);
    const recibeDe = new Array(n).fill(-1);
    (fijas || []).forEach(par => {
      const a = indice.get(normalizar(par[0]));
      const b = indice.get(normalizar(par[1]));
      if (a === undefined || b === undefined) {
        throw crearError(`La asignación «${par[0]} → ${par[1]}» menciona a alguien que no participa.`, 'FIJA');
      }
      if (a === b) throw crearError(`${nombres[a]} no puede regalarse a sí mismo.`, 'FIJA');
      if (fijo[a] === b) return;
      if (fijo[a] !== -1) throw crearError(`${nombres[a]} tiene dos asignaciones fijas a la vez.`, 'FIJA');
      if (recibeDe[b] !== -1) throw crearError(`A ${nombres[b]} le tienen que regalar dos personas a la vez.`, 'FIJA');
      if (!permitido[a][b]) {
        throw crearError(`${nombres[a]} tiene que regalar a ${nombres[b]}, pero están en las exclusiones.`, 'IMPOSIBLE');
      }
      fijo[a] = b;
      recibeDe[b] = a;
    });

    // Quien tiene a alguien fijado solo puede regalar a esa persona, y a esa persona no le regala nadie más.
    for (let a = 0; a < n; a++) {
      const b = fijo[a];
      if (b === -1) continue;
      for (let j = 0; j < n; j++) permitido[a][j] = j === b;
      for (let i = 0; i < n; i++) if (i !== a) permitido[i][b] = false;
    }
    return { permitido, fijo };
  }

  function esValida(destino, permitido, evitarReciprocos) {
    for (let i = 0; i < destino.length; i++) {
      const j = destino[i];
      if (!permitido[i][j]) return false;
      if (evitarReciprocos && destino[j] === i) return false;
    }
    return true;
  }

  /** Búsqueda exhaustiva (con orden aleatorio) para casos muy restringidos. */
  function vueltaAtras(permitido, evitarReciprocos) {
    const n = permitido.length;
    const destino = new Array(n).fill(-1);
    const usado = new Array(n).fill(false);
    const opciones = permitido.map(fila => fila.filter(Boolean).length);
    const orden = barajar(indices(n)).sort((a, b) => opciones[a] - opciones[b]);
    let pasos = 0;

    function paso(k) {
      if (k === n) return true;
      if (++pasos > PASOS_MAXIMOS) {
        throw crearError('Hay demasiadas reglas para encontrar un sorteo. Quita alguna.', 'DEMASIADO_RESTRINGIDO');
      }
      const i = orden[k];
      for (const j of barajar(indices(n))) {
        if (usado[j] || !permitido[i][j]) continue;
        if (evitarReciprocos && destino[j] === i) continue;
        destino[i] = j; usado[j] = true;
        if (paso(k + 1)) return true;
        destino[i] = -1; usado[j] = false;
      }
      return false;
    }

    return paso(0) ? destino : null;
  }

  /**
   * Devuelve un array `destino` donde destino[i] es el índice de la persona
   * a la que regala nombres[i]. Lanza un error con `codigo` si es imposible.
   *
   * opciones.evitarReciprocos: que no pase que A le regale a B y B a A.
   * opciones.fijas: [[quien, aQuien], ...] asignaciones que tienen que salir sí o sí.
   */
  function resolver(nombres, exclusiones, opciones) {
    const n = nombres.length;
    const evitarReciprocos = Boolean(opciones && opciones.evitarReciprocos);
    if (n < 2) throw crearError('Hacen falta al menos 2 participantes.', 'POCOS');
    if (evitarReciprocos && n < 3) {
      throw crearError('Para evitar intercambios cruzados hacen falta al menos 3 participantes.', 'POCOS');
    }

    const { permitido, fijo } = matrizPermitidos(nombres, exclusiones, opciones && opciones.fijas);
    if (evitarReciprocos) {
      for (let a = 0; a < n; a++) {
        const b = fijo[a];
        if (b !== -1 && a < b && fijo[b] === a) {
          throw crearError(`Tienes fijado que ${nombres[a]} le regala a ${nombres[b]} y ${nombres[b]} a ${nombres[a]}: eso es una pareja cruzada.`, 'IMPOSIBLE');
        }
      }
    }
    for (let i = 0; i < n; i++) {
      if (!permitido[i].some(Boolean)) {
        throw crearError(`${nombres[i]} no puede regalar a nadie con estas reglas.`, 'IMPOSIBLE');
      }
      if (!permitido.some(fila => fila[i])) {
        throw crearError(`A ${nombres[i]} no le puede regalar nadie con estas reglas.`, 'IMPOSIBLE');
      }
    }

    // Muestreo por rechazo: cada reparto válido tiene la misma probabilidad.
    // Las asignaciones fijas se dejan puestas y solo se baraja al resto.
    const libres = indices(n).filter(i => fijo[i] === -1);
    const recibidos = new Set(fijo.filter(j => j !== -1));
    const destinosLibres = indices(n).filter(j => !recibidos.has(j));
    for (let intento = 0; intento < INTENTOS_ALEATORIOS; intento++) {
      const destino = fijo.slice();
      const barajados = barajar(destinosLibres);
      libres.forEach((i, k) => { destino[i] = barajados[k]; });
      if (esValida(destino, permitido, evitarReciprocos)) return destino;
    }

    const destino = vueltaAtras(permitido, evitarReciprocos);
    if (!destino) throw crearError('Con estas reglas el sorteo es imposible. Quita alguna.', 'IMPOSIBLE');
    return destino;
  }

  /** { 'Ana': 'Luis', 'Luis': 'Eva', ... } */
  function sortear(nombres, exclusiones, opciones) {
    const destino = resolver(nombres, exclusiones, opciones);
    const asignaciones = {};
    nombres.forEach((nombre, i) => { asignaciones[nombre] = nombres[destino[i]]; });
    return asignaciones;
  }

  /** Comprueba si el sorteo es posible sin revelar ningún resultado. */
  function comprobar(nombres, exclusiones, opciones) {
    try {
      resolver(nombres, exclusiones, opciones);
      return { posible: true };
    } catch (error) {
      return { posible: false, motivo: error.message, codigo: error.codigo || 'ERROR' };
    }
  }

  return { sortear, comprobar, resolver };
});
