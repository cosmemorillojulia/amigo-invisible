// Tests del servidor de Apps Script (backend/Code.gs) con los servicios de Google simulados.
// No se envía ningún correo: MailApp es un doble que solo anota las llamadas.
// Ejecutar con: node --test tests/*.test.js
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
const NOMBRES = PARTICIPANTES.map(p => p.nombre);

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
  const ponerReglas = reglas => post({ clave: CLAVE, accion: 'guardarReglas', reglas });
  return { post, postCrudo, ponerReglas, correos, propiedades, cache };
}

/** Lee del texto plano de cada correo a quién le ha tocado. */
function repartoDesdeCorreos(correos) {
  const reparto = {};
  for (const c of correos) {
    const da = c.body.match(/^¡Hola, (.+)!$/m)[1];
    reparto[da] = c.body.match(/te ha tocado regalar a (.+)\.$/m)[1];
  }
  return reparto;
}

function comprobarReparto(reparto, nombres) {
  assert.deepEqual(Object.keys(reparto).sort(), [...nombres].sort());
  assert.deepEqual(Object.values(reparto).sort(), [...nombres].sort());
  for (const [da, recibe] of Object.entries(reparto)) assert.notEqual(da, recibe);
}

const sorteoReal = extra => Object.assign(
  { clave: CLAVE, accion: 'sortear', participantes: PARTICIPANTES, ajustes: { titulo: 'Navidad de prueba' }, prueba: false },
  extra
);

// ───────────────────────── Acceso ─────────────────────────

test('rechaza la clave incorrecta y bloquea tras varios intentos', () => {
  const b = crearBackend();
  const r = b.post({ clave: 'mala', accion: 'estado' });
  assert.equal(r.ok, false);
  assert.equal(r.codigo, 'CLAVE');
  for (let i = 0; i < 10; i++) b.post({ clave: 'mala', accion: 'estado' });
  assert.equal(b.post({ clave: CLAVE, accion: 'estado' }).codigo, 'BLOQUEADO');
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

test('las reglas no se pueden leer ni cambiar sin la clave', () => {
  const b = crearBackend();
  b.ponerReglas({ exclusiones: [['Ana', 'Bruno']] });
  const leer = b.post({ clave: 'mala', accion: 'leerReglas' });
  assert.equal(leer.ok, false);
  assert.equal(leer.reglas, undefined);
  assert.equal(b.post({ clave: 'mala', accion: 'guardarReglas', reglas: { exclusiones: [] } }).ok, false);
  assert.deepEqual(b.post({ clave: CLAVE, accion: 'leerReglas' }).reglas.exclusiones, [['Ana', 'Bruno']]);
});

// ───────────────────────── Estado ─────────────────────────

test('estado informa de cuota y correo de pruebas, y no menciona las reglas', () => {
  const b = crearBackend();
  b.ponerReglas({ exclusiones: [['Ana', 'Bruno']] });
  const r = b.post({ clave: CLAVE, accion: 'estado' });
  assert.equal(r.ok, true);
  assert.equal(r.cuota, 100);
  assert.equal(r.emailPrueba, ORGANIZADOR);
  assert.equal(r.ultimoSorteo, null);
  assert.ok(!JSON.stringify(r).includes('Bruno'));
});

// ───────────────────────── Reglas privadas ─────────────────────────

test('reglas vacías por defecto; se guardan limpias y sin duplicados', () => {
  const b = crearBackend();
  assert.deepEqual(b.post({ clave: CLAVE, accion: 'leerReglas' }).reglas, { exclusiones: [], fijas: [], evitarReciprocos: false });
  const r = b.ponerReglas({
    exclusiones: [['  Ana ', 'Bruno'], ['bruno', 'ana'], ['Carla', 'David']],
    fijas: [[' Íñigo ', 'Carla'], ['íñigo', 'CARLA'], ['Ana', 'David']],
    evitarReciprocos: true,
  });
  assert.equal(r.ok, true);
  assert.deepEqual(r.reglas, {
    exclusiones: [['Ana', 'Bruno'], ['Carla', 'David']],
    fijas: [['Íñigo', 'Carla'], ['Ana', 'David']],
    evitarReciprocos: true,
  });
  assert.deepEqual(b.post({ clave: CLAVE, accion: 'leerReglas' }).reglas, r.reglas);
});

test('las reglas guardadas antes de existir las asignaciones fijas siguen valiendo', () => {
  const b = crearBackend();
  b.propiedades.set('REGLAS', JSON.stringify({ exclusiones: [['Ana', 'Bruno']], evitarReciprocos: true }));
  assert.deepEqual(b.post({ clave: CLAVE, accion: 'leerReglas' }).reglas, { exclusiones: [['Ana', 'Bruno']], fijas: [], evitarReciprocos: true });
  assert.equal(b.post(sorteoReal()).ok, true);
});

test('rechaza reglas mal formadas', () => {
  const b = crearBackend();
  const malas = [
    null, { exclusiones: 'Ana' }, { exclusiones: [['Ana']] }, { exclusiones: [['Ana', 'ana']] }, { exclusiones: [['', 'Bruno']] },
    { fijas: 'Ana' }, { fijas: [['Ana']] }, { fijas: [['Ana', ' ana ']] }, { fijas: [['', 'Bruno']] },
    { fijas: [['Ana', 'Bruno'], ['ana', 'Carla']] }, { fijas: [['Ana', 'Bruno'], ['Carla', 'bruno']] },
  ];
  for (const reglas of malas) assert.equal(b.ponerReglas(reglas).ok, false, JSON.stringify(reglas));
  assert.equal(b.propiedades.has('REGLAS'), false);
});

// ───────────────────────── Sorteo ─────────────────────────

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
    assert.match(c.subject, /^\[Prueba · /);
    assert.match(c.htmlBody, /Esto es una prueba/);
  }
  assert.equal(b.propiedades.has('ULTIMO_SORTEO'), false);
});

test('sorteo real: un correo a cada uno, respeta las reglas privadas y la respuesta no revela nada', () => {
  const b = crearBackend();
  b.ponerReglas({ exclusiones: [['Ana', 'Bruno']] });
  const r = b.post(sorteoReal({ ajustes: { titulo: 'Navidad de prueba', presupuesto: '20 €', fecha: '24 de diciembre', mensaje: 'Hola <b>todos</b>' } }));
  assert.equal(r.ok, true);
  assert.equal(r.prueba, false);
  assert.deepEqual([...r.enviados].sort(), [...NOMBRES].sort());
  assert.deepEqual(Object.keys(r).sort(), ['destinoPrueba', 'enviados', 'fallidos', 'fecha', 'ok', 'prueba']);

  assert.deepEqual(b.correos.map(c => c.to).sort(), PARTICIPANTES.map(p => p.email).sort());
  const reparto = repartoDesdeCorreos(b.correos);
  comprobarReparto(reparto, NOMBRES);
  assert.notEqual(reparto.Ana, 'Bruno');
  assert.notEqual(reparto.Bruno, 'Ana');

  for (const c of b.correos) {
    assert.equal(c.subject, 'Tu amigo invisible · Navidad de prueba');
    assert.ok(c.htmlBody.includes('20 €'));
    assert.ok(c.htmlBody.includes('>Fecha<'), 'la etiqueta es «Fecha»');
    assert.ok(!c.htmlBody.includes('Intercambio'));
    assert.ok(c.htmlBody.includes('Hola &lt;b&gt;todos&lt;/b&gt;'), 'el mensaje se escapa');
    assert.ok(!c.htmlBody.includes('Esto es una prueba'));
    assert.ok(c.body.includes('Fecha: 24 de diciembre'));
  }
  // Guardado y codificado (no legible a simple vista)
  const guardado = b.propiedades.get('ULTIMO_SORTEO');
  assert.ok(guardado && !guardado.includes('Ana'));
});

test('las exclusiones que manda la web se ignoran: solo cuentan las del servidor', () => {
  const b = crearBackend();
  const r = b.post(sorteoReal({ exclusiones: [['Ana', 'Desconocido'], ['Ana', 'Bruno'], ['Ana', 'Carla'], ['Ana', 'David'], ['Ana', 'Íñigo']] }));
  assert.equal(r.ok, true);
});

test('las reglas con personas que ya no participan se ignoran', () => {
  const b = crearBackend();
  b.ponerReglas({ exclusiones: [['Ana', 'Zoe'], ['zoe', 'Yago']] });
  const r = b.post(sorteoReal());
  assert.equal(r.ok, true);
  comprobarReparto(repartoDesdeCorreos(b.correos), NOMBRES);
});

test('las reglas no distinguen mayúsculas', () => {
  for (let i = 0; i < 20; i++) {
    const b = crearBackend();
    b.ponerReglas({ exclusiones: [['ana', 'BRUNO'], ['íñigo', 'carla']] });
    b.post(sorteoReal());
    const reparto = repartoDesdeCorreos(b.correos);
    assert.notEqual(reparto.Ana, 'Bruno');
    assert.notEqual(reparto.Bruno, 'Ana');
    assert.notEqual(reparto['Íñigo'], 'Carla');
    assert.notEqual(reparto.Carla, 'Íñigo');
  }
});

test('si las reglas lo hacen imposible, el error no da nombres y no se envía nada', () => {
  const b = crearBackend();
  b.ponerReglas({ exclusiones: [['Ana', 'Bruno'], ['Ana', 'Carla'], ['Ana', 'David'], ['Ana', 'Íñigo']] });
  const r = b.post(sorteoReal());
  assert.equal(r.ok, false);
  assert.equal(r.codigo, 'IMPOSIBLE');
  for (const nombre of NOMBRES) assert.ok(!r.error.includes(nombre), `el error menciona a ${nombre}`);
  assert.equal(b.correos.length, 0);
  assert.equal(b.propiedades.has('ULTIMO_SORTEO'), false);
});

test('evitar parejas cruzadas desde las reglas', () => {
  for (let i = 0; i < 30; i++) {
    const b = crearBackend();
    b.ponerReglas({ exclusiones: [], evitarReciprocos: true });
    b.post(sorteoReal());
    const reparto = repartoDesdeCorreos(b.correos);
    for (const [da, recibe] of Object.entries(reparto)) assert.notEqual(reparto[recibe], da);
  }
});

test('las asignaciones fijas se cumplen siempre en el sorteo real', () => {
  for (let i = 0; i < 30; i++) {
    const b = crearBackend();
    b.ponerReglas({ exclusiones: [['Ana', 'Bruno']], fijas: [['ana', 'ÍÑIGO'], ['Carla', 'Bruno']], evitarReciprocos: true });
    assert.equal(b.post(sorteoReal()).ok, true);
    const reparto = repartoDesdeCorreos(b.correos);
    comprobarReparto(reparto, NOMBRES);
    assert.equal(reparto.Ana, 'Íñigo');
    assert.equal(reparto.Carla, 'Bruno');
    assert.notEqual(reparto.Bruno, 'Ana');
    for (const [da, recibe] of Object.entries(reparto)) assert.notEqual(reparto[recibe], da);
  }
});

test('las asignaciones fijas que manda la web se ignoran: solo cuentan las del servidor', () => {
  // Sin reglas en el servidor, a Ana le toca Bruno 1 de cada 4 veces: 40 seguidas no pasaría nunca.
  const veces = { si: 0, no: 0 };
  for (let i = 0; i < 40; i++) {
    const b = crearBackend();
    b.post(sorteoReal({ fijas: [['Ana', 'Bruno']], reglas: { fijas: [['Ana', 'Bruno']] } }));
    veces[repartoDesdeCorreos(b.correos).Ana === 'Bruno' ? 'si' : 'no']++;
  }
  assert.ok(veces.no > 0);
});

test('las asignaciones fijas con personas que ya no participan se ignoran', () => {
  const b = crearBackend();
  b.ponerReglas({ fijas: [['Ana', 'Zoe'], ['Yago', 'Bruno']] });
  assert.equal(b.post(sorteoReal()).ok, true);
  comprobarReparto(repartoDesdeCorreos(b.correos), NOMBRES);
});

test('si una asignación fija choca con las reglas, el error no da nombres y no se envía nada', () => {
  const casos = [
    { exclusiones: [['Bruno', 'Ana']], fijas: [['Ana', 'Bruno']] },
    { fijas: [['Ana', 'Bruno'], ['Bruno', 'Ana']], evitarReciprocos: true },
  ];
  for (const reglas of casos) {
    const b = crearBackend();
    assert.equal(b.ponerReglas(reglas).ok, true);
    const r = b.post(sorteoReal());
    assert.equal(r.ok, false);
    assert.equal(r.codigo, 'IMPOSIBLE');
    for (const nombre of NOMBRES) assert.ok(!r.error.includes(nombre), `el error menciona a ${nombre}`);
    assert.equal(b.correos.length, 0);
    assert.equal(b.propiedades.has('ULTIMO_SORTEO'), false);
  }
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

test('reenviar manda la misma persona, también a un correo corregido', () => {
  const b = crearBackend();
  b.post(sorteoReal());
  const original = repartoDesdeCorreos(b.correos);
  b.correos.length = 0;

  assert.equal(b.post({ clave: CLAVE, accion: 'reenviar', nombre: 'íñigo' }).ok, true);
  assert.equal(b.correos[0].to, 'inigo@example.com');
  assert.equal(repartoDesdeCorreos(b.correos)['Íñigo'], original['Íñigo']);

  assert.equal(b.post({ clave: CLAVE, accion: 'reenviar', nombre: 'Ana', email: 'ana.nueva@example.com' }).ok, true);
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
    sorteoReal({ participantes: [...PARTICIPANTES, { nombre: '', email: 'vacio@example.com' }] }),
  ];
  for (const caso of casos) assert.equal(b.post(caso).ok, false);
  assert.equal(b.correos.length, 0);
  assert.equal(b.propiedades.has('ULTIMO_SORTEO'), false);
});

test('no empieza si no hay cuota suficiente', () => {
  const b = crearBackend({ cuota: 3 });
  assert.equal(b.post(sorteoReal()).codigo, 'CUOTA');
  assert.equal(b.correos.length, 0);
});

test('informa de los correos que fallan sin detener el resto', () => {
  const b = crearBackend({ fallarEnvioA: ['carla@example.com'] });
  const r = b.post(sorteoReal());
  assert.equal(r.ok, true);
  assert.equal(r.enviados.length, PARTICIPANTES.length - 1);
  assert.deepEqual(r.fallidos.map(f => f.nombre), ['Carla']);
});

// ───────────────────────── Lista en la nube y vista previa ─────────────────────────

test('guardar y cargar la lista (sin exclusiones)', () => {
  const b = crearBackend();
  const datos = { participantes: [{ id: 'x1', nombre: 'Íñigo', email: 'inigo@example.com' }], ajustes: { titulo: 'Navidad' } };
  assert.equal(b.post({ clave: CLAVE, accion: 'cargar' }).datos, null);
  assert.equal(b.post({ clave: CLAVE, accion: 'guardar', datos: Object.assign({ exclusiones: [['a', 'b']] }, datos) }).ok, true);
  assert.deepEqual(b.post({ clave: CLAVE, accion: 'cargar' }).datos, datos);
  assert.equal(b.post({ clave: CLAVE, accion: 'estado' }).hayListaGuardada, true);
});

test('el correo no lleva frases genéricas y el mensaje del organizador va como texto normal', () => {
  const b = crearBackend();
  const mensaje = 'Primera línea\nsegunda línea\n\nOtro párrafo <b>sin</b> HTML';
  const { html } = b.post({ clave: CLAVE, accion: 'vistaPrevia', ajustes: { titulo: 'Cumple de Ana', mensaje } });
  for (const generica of ['Feliz Navidad', 'pierde la gracia', 'Piensa en algo']) assert.ok(!html.includes(generica), `sobra «${generica}»`);
  const parrafos = [...html.matchAll(/<p[^>]*style="([^"]*)">([\s\S]*?)<\/p>/g)].map(m => ({ estilo: m[1], texto: m[2] }));
  const primero = parrafos.find(p => p.texto.includes('Primera línea'));
  const segundo = parrafos.find(p => p.texto.includes('Otro párrafo'));
  assert.equal(primero.texto, 'Primera línea<br>segunda línea');
  assert.equal(segundo.texto, 'Otro párrafo &lt;b&gt;sin&lt;/b&gt; HTML');
  for (const p of [primero, segundo]) assert.ok(!p.estilo.includes('italic') && !p.estilo.includes('border-left'), 'sin formato de cita');

  // Sin mensaje no queda ningún párrafo extra después de los datos
  const sinMensaje = b.post({ clave: CLAVE, accion: 'vistaPrevia', ajustes: { presupuesto: '20 €' } }).html;
  assert.ok(!sinMensaje.includes('Otro párrafo'));
  const textoPlano = b.post({ clave: CLAVE, accion: 'vistaPrevia', ajustes: {} });
  assert.equal(textoPlano.ok, true);
});

test('lugar: no mostrar, por definir o dirección con enlace a Google Maps', () => {
  const b = crearBackend();
  const previa = lugar => b.post({ clave: CLAVE, accion: 'vistaPrevia', ajustes: { presupuesto: '20 €', fecha: '24 de diciembre', lugar } }).html;

  // No mostrar (por defecto, o con un modo desconocido)
  for (const lugar of [undefined, { modo: 'ninguno', nombre: 'Casa de Ana' }, { modo: 'raro' }]) {
    assert.ok(!previa(lugar).includes('>Lugar<'), JSON.stringify(lugar));
  }

  // Por definir
  const pendiente = previa({ modo: 'pendiente', nombre: 'Casa de Ana', direccion: 'c/ Falsa, 1' });
  assert.ok(pendiente.includes('>Lugar<') && pendiente.includes('Por definir'));
  assert.ok(!pendiente.includes('google.com/maps') && !pendiente.includes('Casa de Ana'));

  // Dirección con nombre: la calle enlaza a Maps (URL construida en el servidor y bien escapada)
  const conNombre = previa({ modo: 'direccion', nombre: 'Casa de Ana', direccion: 'c/ Cerro del Fresno, 15, Madrid' });
  assert.ok(conNombre.includes('>Lugar<') && conNombre.includes('Casa de Ana'));
  assert.ok(conNombre.includes('href="https://www.google.com/maps/search/?api=1&amp;query=c%2F%20Cerro%20del%20Fresno%2C%2015%2C%20Madrid"'));
  assert.ok(conNombre.includes('>c/ Cerro del Fresno, 15, Madrid</a>'));

  // Solo nombre: sin enlace
  const soloNombre = previa({ modo: 'direccion', nombre: 'Casa de Ana', direccion: '' });
  assert.ok(soloNombre.includes('Casa de Ana') && !soloNombre.includes('google.com/maps'));

  // Dirección vacía y sin nombre = no mostrar
  assert.ok(!previa({ modo: 'direccion', nombre: ' ', direccion: '' }).includes('>Lugar<'));

  // Nada de HTML ni enlaces colados desde la dirección
  const malicioso = previa({ modo: 'direccion', direccion: '"><script>alert(1)</script> javascript:alert(1)' });
  assert.ok(!malicioso.includes('<script>'));
  assert.ok(malicioso.includes('href="https://www.google.com/maps/search/?api=1&amp;query=%22%3E%3Cscript%3E'));

  // Sin presupuesto ni fecha, el lugar va solo en la caja
  const soloLugar = b.post({ clave: CLAVE, accion: 'vistaPrevia', ajustes: { lugar: { modo: 'pendiente' } } }).html;
  assert.ok(soloLugar.includes('colspan="1"') && !soloLugar.includes('>Fecha<'));
});

test('el lugar llega en el correo real y en el texto plano, también al reenviar', () => {
  const b = crearBackend();
  b.post(sorteoReal({ ajustes: { titulo: 'Navidad', lugar: { modo: 'direccion', nombre: 'Casa de Ana', direccion: 'c/ Cerro del Fresno, 15' } } }));
  const correo = b.correos[0];
  assert.ok(correo.htmlBody.includes('Casa de Ana'));
  assert.ok(correo.body.includes('Lugar: Casa de Ana, c/ Cerro del Fresno, 15'));
  assert.ok(correo.body.includes('Mapa: https://www.google.com/maps/search/?api=1&query=c%2F%20Cerro%20del%20Fresno%2C%2015'));
  b.correos.length = 0;
  b.post({ clave: CLAVE, accion: 'reenviar', nombre: 'Ana' });
  assert.ok(b.correos[0].htmlBody.includes('Casa de Ana'));
});

test('la fecha va antes que el presupuesto, en el HTML y en el texto plano', () => {
  const b = crearBackend();
  b.post(sorteoReal({ ajustes: { titulo: 'Navidad', presupuesto: '20 €', fecha: '24 de diciembre', lugar: { modo: 'pendiente' } } }));
  const { htmlBody, body } = b.correos[0];
  assert.ok(htmlBody.indexOf('>Fecha<') < htmlBody.indexOf('>Presupuesto<'));
  assert.ok(htmlBody.indexOf('>Presupuesto<') < htmlBody.indexOf('>Lugar<'), 'el lugar sigue debajo');
  assert.ok(body.indexOf('Fecha: 24 de diciembre') < body.indexOf('Presupuesto: 20 €'));
});

test('el correo trae modo oscuro y todas sus clases tienen color en claro y en oscuro', () => {
  const b = crearBackend();
  const { html } = b.post({ clave: CLAVE, accion: 'vistaPrevia', ajustes: {
    titulo: 'Navidad', presupuesto: '20 €', fecha: '24 de diciembre', mensaje: 'Hola',
    lugar: { modo: 'direccion', nombre: 'Casa de Ana', direccion: 'c/ Falsa, 1' },
  } });
  assert.ok(html.includes('<meta name="color-scheme" content="light dark">'));
  assert.ok(html.includes('@media (prefers-color-scheme: dark)'));
  assert.match(html, /Amigo <em [^>]*>Invisible<\/em>/);

  const usadas = new Set([...html.matchAll(/class="([^"]+)"/g)].flatMap(m => m[1].split(' ')));
  assert.ok(usadas.size > 5);
  for (const clase of usadas) {
    assert.match(clase, /^ai-/);
    assert.ok(html.includes(`    .${clase} {`), `falta el color oscuro de ${clase}`);
    assert.ok(html.includes(`[data-ogs`) && new RegExp(`\\[data-ogs[bc]\\] \\.${clase} `).test(html), `falta ${clase} para Outlook`);
  }
  // Cada elemento con clase lleva también su color claro en línea (Gmail ignora el <style> de modo oscuro).
  for (const m of html.matchAll(/<[a-z]+ class="[^"]+" style="([^"]*)"/g)) {
    assert.match(m[1], /(color|background-color|border-color):#[0-9a-f]{6};/);
  }
});

test('vista previa del correo sin enviar nada', () => {
  const b = crearBackend();
  const r = b.post({ clave: CLAVE, accion: 'vistaPrevia', ajustes: { titulo: 'Navidad 2026', presupuesto: '15 €', fecha: '24 de diciembre' } });
  assert.equal(r.ok, true);
  assert.equal(r.asunto, 'Tu amigo invisible · Navidad 2026');
  assert.ok(r.html.includes('15 €'));
  assert.ok(r.html.includes('24 de diciembre'));
  assert.equal(b.correos.length, 0);
});
