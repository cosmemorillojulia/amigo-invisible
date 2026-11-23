// Tests del backend de Apps Script (backend/Code.gs) con los servicios de Google simulados.
// No se envía ningún correo: MailApp es un doble que solo anota las llamadas.
// Ejecutar con: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const CODIGO = fs.readFileSync(path.join(__dirname, '..', 'backend', 'Code.gs'), 'utf8');
const CLAVE = 'clave-de-prueba-123';
const ORGANIZADOR = 'organizador@example.com';

const PARTICIPANTES = [
  { nombre: 'Ana', email: 'ana@example.com' },
  { nombre: 'Bruno', email: 'bruno@example.com' },
  { nombre: 'Carla', email: 'carla@example.com' },
  { nombre: 'David', email: 'david@example.com' },
  { nombre: 'Íñigo', email: 'inigo@example.com' },
];

function crearBackend({ clave = CLAVE, cuota = 100, fallarEnvioA = [] } = {}) {
  const correos = [];
  const propiedades = new Map(clave ? [['CLAVE', clave]] : []);
  const cache = new Map();
  const bytes = texto => Buffer.from(texto, 'utf8');

  const contexto = {
    console,
    MailApp: {
      sendEmail(opciones) {
        if (fallarEnvioA.includes(opciones.to)) throw new Error('Dirección rechazada');
        correos.push(opciones);
      },
      getRemainingDailyQuota: () => cuota - correos.length,
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: k => (propiedades.has(k) ? propiedades.get(k) : null),
        setProperty: (k, v) => { propiedades.set(k, String(v)); },
      }),
    },
    CacheService: {
      getScriptCache: () => ({
        get: k => (cache.has(k) ? cache.get(k) : null),
        put: (k, v) => { cache.set(k, String(v)); },
      }),
    },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: texto => ({ texto, setMimeType() { return this; } }),
    },
    Session: { getEffectiveUser: () => ({ getEmail: () => ORGANIZADOR }) },
    Utilities: {
      Charset: { UTF_8: 'UTF-8' },
      base64Encode: texto => bytes(texto).toString('base64'),
      base64Decode: b64 => Array.from(Buffer.from(b64, 'base64')),
      newBlob: datos => ({
        getBytes: () => Array.from(typeof datos === 'string' ? bytes(datos) : Buffer.from(datos)),
        getDataAsString: () => Buffer.from(datos).toString('utf8'),
      }),
    },
  };
  vm.createContext(contexto);
  vm.runInContext(CODIGO, contexto, { filename: 'Code.gs' });

  const postCrudo = contenido => JSON.parse(contexto.doPost({ postData: { contents: contenido } }).texto);
  const post = cuerpo => postCrudo(JSON.stringify(cuerpo));
  return { post, postCrudo, correos, propiedades, cache };
}

/** Lee del texto plano de cada correo a quién le ha tocado. */
function repartoDesdeCorreos(correos) {
  const reparto = {};
  for (const c of correos) {
    const da = c.body.match(/¡Hola (.+)!/)[1];
    reparto[da] = c.body.match(/Tu amigo invisible es: (.+)/)[1];
  }
  return reparto;
}

const sorteoReal = extra => Object.assign({ clave: CLAVE, accion: 'sortear', participantes: PARTICIPANTES, exclusiones: [], ajustes: { titulo: 'Navidad de prueba' }, prueba: false }, extra);

test('rechaza la clave incorrecta y bloquea tras varios intentos', () => {
  const b = crearBackend();
  const r = b.post({ clave: 'mala', accion: 'estado' });
  assert.equal(r.ok, false);
  assert.equal(r.codigo, 'CLAVE');
  for (let i = 0; i < 10; i++) b.post({ clave: 'mala', accion: 'estado' });
  const bloqueado = b.post({ clave: CLAVE, accion: 'estado' });
  assert.equal(bloqueado.codigo, 'BLOQUEADO');
  assert.equal(b.correos.length, 0);
});

test('sin propiedad CLAVE no hace nada', () => {
  const b = crearBackend({ clave: null });
  assert.equal(b.post(sorteoReal()).codigo, 'SIN_CLAVE');
  assert.equal(b.correos.length, 0);
});

test('peticiones mal formadas y acciones desconocidas', () => {
  const b = crearBackend();
  assert.equal(b.postCrudo('esto no es json').codigo, 'PETICION');
  assert.equal(b.postCrudo('null').codigo, 'PETICION');
  assert.equal(b.post({ clave: CLAVE, accion: 'constructor' }).codigo, 'ACCION');
  assert.equal(b.post({ clave: CLAVE, accion: 'borrarTodo' }).codigo, 'ACCION');
});

test('estado informa de cuota y correo de pruebas', () => {
  const r = crearBackend().post({ clave: CLAVE, accion: 'estado' });
  assert.equal(r.ok, true);
  assert.equal(r.cuota, 100);
  assert.equal(r.emailPrueba, ORGANIZADOR);
  assert.equal(r.ultimoSorteo, null);
});

test('si no se indica el modo, es una PRUEBA: todo va al organizador y no se guarda', () => {
  const b = crearBackend();
  const peticion = sorteoReal();
  delete peticion.prueba;
  const r = b.post(peticion);
  assert.equal(r.ok, true);
  assert.equal(r.prueba, true);
  assert.equal(b.correos.length, PARTICIPANTES.length);
  for (const c of b.correos) {
    assert.equal(c.to, ORGANIZADOR);
    assert.match(c.subject, /PRUEBA/);
    assert.match(c.htmlBody, /CORREO DE PRUEBA/);
  }
  assert.equal(b.propiedades.has('ULTIMO_SORTEO'), false);
});

test('sorteo real: un correo a cada uno, reparto válido y la respuesta no revela nada', () => {
  const b = crearBackend();
  const exclusiones = [['Ana', 'Bruno']];
  const r = b.post(sorteoReal({ exclusiones, ajustes: { titulo: 'Navidad de prueba', presupuesto: '20 €', fecha: '24 de diciembre', mensaje: 'Hola <b>todos</b>' } }));
  assert.equal(r.ok, true);
  assert.equal(r.prueba, false);
  assert.deepEqual([...r.enviados].sort(), PARTICIPANTES.map(p => p.nombre).sort());
  assert.deepEqual(Object.keys(r).sort(), ['destinoPrueba', 'enviados', 'fallidos', 'fecha', 'ok', 'prueba']);

  assert.deepEqual(b.correos.map(c => c.to).sort(), PARTICIPANTES.map(p => p.email).sort());
  const reparto = repartoDesdeCorreos(b.correos);
  const nombres = PARTICIPANTES.map(p => p.nombre);
  assert.deepEqual(Object.values(reparto).sort(), [...nombres].sort());
  for (const [da, recibe] of Object.entries(reparto)) assert.notEqual(da, recibe);
  assert.notEqual(reparto.Ana, 'Bruno');
  assert.notEqual(reparto.Bruno, 'Ana');

  for (const c of b.correos) {
    assert.ok(c.subject.includes('Navidad de prueba'));
    assert.ok(c.htmlBody.includes('20 €'));
    assert.ok(c.htmlBody.includes('Hola &lt;b&gt;todos&lt;/b&gt;'), 'el mensaje se escapa');
    assert.ok(!c.htmlBody.includes('CORREO DE PRUEBA'));
  }
  // Guardado y codificado (no legible a simple vista)
  const guardado = b.propiedades.get('ULTIMO_SORTEO');
  assert.ok(guardado && !guardado.includes('Ana'));
});

test('no repite un sorteo real sin confirmación explícita', () => {
  const b = crearBackend();
  b.post(sorteoReal());
  const segundo = b.post(sorteoReal());
  assert.equal(segundo.ok, false);
  assert.equal(segundo.codigo, 'YA_SORTEADO');
  assert.ok(segundo.detalle.fecha);
  assert.equal(b.correos.length, PARTICIPANTES.length);

  const repetido = b.post(sorteoReal({ repetir: true }));
  assert.equal(repetido.ok, true);
  assert.equal(b.correos.length, PARTICIPANTES.length * 2);
});

test('reenviar manda el mismo amigo invisible, también a un correo corregido', () => {
  const b = crearBackend();
  b.post(sorteoReal());
  const original = repartoDesdeCorreos(b.correos);
  b.correos.length = 0;

  const r1 = b.post({ clave: CLAVE, accion: 'reenviar', nombre: 'íñigo' });
  assert.equal(r1.ok, true);
  assert.equal(b.correos[0].to, 'inigo@example.com');
  assert.equal(repartoDesdeCorreos(b.correos)['Íñigo'], original['Íñigo']);

  const r2 = b.post({ clave: CLAVE, accion: 'reenviar', nombre: 'Ana', email: 'ana.nueva@example.com' });
  assert.equal(r2.ok, true);
  assert.equal(b.correos[1].to, 'ana.nueva@example.com');
  assert.equal(repartoDesdeCorreos([b.correos[1]]).Ana, original.Ana);

  assert.equal(b.post({ clave: CLAVE, accion: 'reenviar', nombre: 'Zoe' }).codigo, 'DATOS');
  assert.equal(b.post({ clave: CLAVE, accion: 'estado' }).ultimoSorteo.participantes.length, PARTICIPANTES.length);
});

test('reenviar sin sorteo previo da error', () => {
  assert.equal(crearBackend().post({ clave: CLAVE, accion: 'reenviar', nombre: 'Ana' }).codigo, 'SIN_SORTEO');
});

test('valida los datos antes de enviar nada', () => {
  const b = crearBackend();
  const casos = [
    sorteoReal({ participantes: PARTICIPANTES.slice(0, 1) }),
    sorteoReal({ participantes: [...PARTICIPANTES, { nombre: 'ana', email: 'otra@example.com' }] }),
    sorteoReal({ participantes: [...PARTICIPANTES, { nombre: 'Zoe', email: 'no-es-un-correo' }] }),
    sorteoReal({ exclusiones: [['Ana', 'Desconocido']] }),
    sorteoReal({ participantes: PARTICIPANTES.slice(0, 2), exclusiones: [['Ana', 'Bruno']] }),
  ];
  for (const caso of casos) assert.equal(b.post(caso).ok, false);
  assert.equal(b.correos.length, 0);
  assert.equal(b.propiedades.has('ULTIMO_SORTEO'), false);
});

test('no empieza si no hay cuota suficiente', () => {
  const b = crearBackend({ cuota: 3 });
  const r = b.post(sorteoReal());
  assert.equal(r.codigo, 'CUOTA');
  assert.equal(b.correos.length, 0);
});

test('informa de los correos que fallan sin detener el resto', () => {
  const b = crearBackend({ fallarEnvioA: ['carla@example.com'] });
  const r = b.post(sorteoReal());
  assert.equal(r.ok, true);
  assert.equal(r.enviados.length, PARTICIPANTES.length - 1);
  assert.deepEqual(r.fallidos.map(f => f.nombre), ['Carla']);
});

test('evitar intercambios cruzados en el servidor', () => {
  for (let i = 0; i < 30; i++) {
    const b = crearBackend();
    b.post(sorteoReal({ ajustes: { evitarReciprocos: true } }));
    const reparto = repartoDesdeCorreos(b.correos);
    for (const [da, recibe] of Object.entries(reparto)) assert.notEqual(reparto[recibe], da);
  }
});

test('guardar y cargar la lista en la nube', () => {
  const b = crearBackend();
  const datos = { participantes: [{ id: 'x1', nombre: 'Íñigo', email: 'inigo@example.com' }], exclusiones: [], ajustes: { titulo: 'Navidad' } };
  assert.equal(b.post({ clave: CLAVE, accion: 'cargar' }).datos, null);
  assert.equal(b.post({ clave: CLAVE, accion: 'guardar', datos }).ok, true);
  assert.deepEqual(b.post({ clave: CLAVE, accion: 'cargar' }).datos, datos);
  assert.equal(b.post({ clave: CLAVE, accion: 'estado' }).hayListaGuardada, true);
});

test('vista previa del correo sin enviar nada', () => {
  const b = crearBackend();
  const r = b.post({ clave: CLAVE, accion: 'vistaPrevia', ajustes: { titulo: 'Navidad 2026', presupuesto: '15 €' } });
  assert.equal(r.ok, true);
  assert.match(r.asunto, /Navidad 2026/);
  assert.ok(r.html.includes('15 €'));
  assert.equal(b.correos.length, 0);
});
