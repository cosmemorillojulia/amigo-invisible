/*
 * Boleto del rasca y gana.
 *
 * El correo enlaza a rasca.html#<boleto>, donde <boleto> lleva quién regala, a
 * quién y los datos del evento. Va mezclado con una clave (la misma que
 * CLAVE_BOLETO en backend/Code.gs) solo para que el nombre no se lea a simple
 * vista en el enlace: no es cifrado. Lo que va tras la # nunca sale del
 * navegador, así que GitHub no lo ve.
 */
(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica();
  else raiz.Boleto = fabrica();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const CLAVE = 'amigo-invisible/rasca';

  const mezclar = bytes => bytes.map((b, i) => b ^ CLAVE.charCodeAt(i % CLAVE.length));
  const texto = (valor, max) => (typeof valor === 'string' ? valor.trim().slice(0, max) : '');

  /** Devuelve { de, a, titulo, fecha, presupuesto } o null si el boleto no se puede leer. */
  function leer(boleto) {
    const limpio = (String(boleto || '').replace(/^#/, '').match(/^[A-Za-z0-9_-]+/) || [''])[0];
    if (limpio.length < 8) return null;
    try {
      const b64 = limpio.replace(/-/g, '+').replace(/_/g, '/');
      const binario = atob(b64 + '==='.slice((b64.length + 3) % 4));
      const bytes = mezclar(Uint8Array.from(binario, c => c.charCodeAt(0)));
      const datos = JSON.parse(new TextDecoder().decode(bytes));
      if (!datos || datos.v !== 1 || !texto(datos.a, 80)) return null;
      return {
        de: texto(datos.de, 80),
        a: texto(datos.a, 80),
        titulo: texto(datos.t, 80),
        fecha: texto(datos.f, 80),
        presupuesto: texto(datos.p, 60),
      };
    } catch (e) {
      return null;
    }
  }

  /** Lo contrario de leer (el servidor tiene su propia versión en Code.gs). */
  function crear(datos) {
    const json = JSON.stringify({ v: 1, de: datos.de, a: datos.a, t: datos.titulo, f: datos.fecha, p: datos.presupuesto });
    const bytes = mezclar(new TextEncoder().encode(json));
    let binario = '';
    bytes.forEach(b => { binario += String.fromCharCode(b); });
    return btoa(binario).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  return { leer, crear };
});
