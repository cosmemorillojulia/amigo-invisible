/*
 * Algoritmo del sorteo del Amigo Invisible.
 *
 * La web lo usa para comprobar, antes de enviar nada, si el sorteo es posible
 * con las exclusiones elegidas. El sorteo de verdad se hace en el servidor
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

  /** permitido[i][j] === true  →  i puede regalar a j */
  function matrizPermitidos(nombres, exclusiones) {
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
    return permitido;
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
        throw crearError('Hay demasiadas exclusiones para encontrar un sorteo. Quita alguna.', 'DEMASIADO_RESTRINGIDO');
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
   */
  function resolver(nombres, exclusiones, opciones) {
    const n = nombres.length;
    const evitarReciprocos = Boolean(opciones && opciones.evitarReciprocos);
    if (n < 2) throw crearError('Hacen falta al menos 2 participantes.', 'POCOS');
    if (evitarReciprocos && n < 3) {
      throw crearError('Para evitar intercambios cruzados hacen falta al menos 3 participantes.', 'POCOS');
    }

    const permitido = matrizPermitidos(nombres, exclusiones);
    for (let i = 0; i < n; i++) {
      if (!permitido[i].some(Boolean)) {
        throw crearError(`${nombres[i]} no puede regalar a nadie con estas exclusiones.`, 'IMPOSIBLE');
      }
    }

    // Muestreo por rechazo: cada reparto válido tiene la misma probabilidad.
    for (let intento = 0; intento < INTENTOS_ALEATORIOS; intento++) {
      const destino = barajar(indices(n));
      if (esValida(destino, permitido, evitarReciprocos)) return destino;
    }

    const destino = vueltaAtras(permitido, evitarReciprocos);
    if (!destino) throw crearError('Con estas exclusiones el sorteo es imposible. Quita alguna.', 'IMPOSIBLE');
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
