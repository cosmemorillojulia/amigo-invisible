// Tests del boleto del rasca y gana: lo que codifica el servidor (backend/Code.gs)
// lo tiene que leer igual la página (js/boleto.js). Ejecutar con: node --test tests/*.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Boleto = require('../js/boleto.js');

/** Code.gs con lo justo de Utilities para codificar (como hace Apps Script, con bytes con signo). */
function servidor() {
  const contexto = {
    Utilities: {
      newBlob: texto => ({ getBytes: () => Array.from(Buffer.from(texto, 'utf8')).map(b => (b > 127 ? b - 256 : b)) }),
      base64EncodeWebSafe: bytes => Buffer.from(bytes.map(b => b & 255)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'),
    },
  };
  vm.createContext(contexto);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'backend', 'Code.gs'), 'utf8'), contexto);
  return contexto;
}

const EJEMPLOS = [
  { de: 'Lucía', a: 'Valeria', titulo: 'Navidad 2026', fecha: '24 de diciembre', presupuesto: '20 €' },
  { de: 'Íñigo', a: 'María de los Ángeles', titulo: 'Cumple de «Ana» & cía', fecha: '', presupuesto: '' },
  { de: 'Zoë', a: 'Ñoño 🎄', titulo: 'Reyes', fecha: '6 de enero de 2027', presupuesto: '15–20 €' },
];

test('lo que codifica el servidor lo lee igual la página', () => {
  const gs = servidor();
  for (const datos of EJEMPLOS) {
    const enlace = gs.enlaceRasca_({
      urlRasca: 'https://alguien.github.io/amigo-invisible/rasca.html',
      nombre: datos.de,
      asignado: datos.a,
      ajustes: { titulo: datos.titulo, fecha: datos.fecha, presupuesto: datos.presupuesto },
    });
    const [url, boleto] = enlace.split('#');
    assert.equal(url, 'https://alguien.github.io/amigo-invisible/rasca.html');
    assert.match(boleto, /^[A-Za-z0-9_-]+$/, 'sin caracteres que haya que escapar en un enlace');
    assert.deepEqual(Boleto.leer(boleto), datos);
  }
});

test('sin página del rasca no hay enlace', () => {
  const gs = servidor();
  assert.equal(gs.enlaceRasca_({ urlRasca: '', nombre: 'Ana', asignado: 'Luis', ajustes: {} }), '');
});

test('crear y leer en la página son simétricos', () => {
  for (const datos of EJEMPLOS) assert.deepEqual(Boleto.leer(Boleto.crear(datos)), datos);
  assert.deepEqual(Boleto.leer('#' + Boleto.crear(EJEMPLOS[0])), EJEMPLOS[0], 'admite la # delante');
});

test('el nombre no se lee a simple vista en el enlace', () => {
  for (const datos of EJEMPLOS) {
    const boleto = Boleto.crear(datos);
    const comoTexto = Buffer.from(boleto.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('latin1');
    for (const nombre of [datos.a, datos.de]) {
      assert.ok(!boleto.includes(nombre) && !comoTexto.includes(nombre), `se ve «${nombre}»`);
      assert.ok(!boleto.includes(Buffer.from(nombre).toString('base64').slice(0, 6)), `«${nombre}» en Base64 sin más`);
    }
  }
});

test('boletos rotos o manipulados no se leen', () => {
  const bueno = Boleto.crear(EJEMPLOS[0]);
  for (const malo of ['', '#', 'abc', 'no es un boleto', bueno.slice(0, 10), '!!!!' + bueno, Buffer.from('{"v":1,"a":"X"}').toString('base64')]) {
    assert.equal(Boleto.leer(malo), null, JSON.stringify(malo));
  }
  // Sin «a quién» o con otra versión
  const sinNombre = Boleto.crear({ de: 'Ana', a: '', titulo: '', fecha: '', presupuesto: '' });
  assert.equal(Boleto.leer(sinNombre), null);
});

test('los textos llegan recortados y sin espacios sobrantes', () => {
  const largo = 'x'.repeat(500);
  const leido = Boleto.leer(Boleto.crear({ de: '  Ana  ', a: largo, titulo: largo, fecha: largo, presupuesto: largo }));
  assert.equal(leido.de, 'Ana');
  assert.equal(leido.a.length, 80);
  assert.equal(leido.presupuesto.length, 60);
});
