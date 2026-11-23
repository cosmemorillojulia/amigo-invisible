/**
 * Amigo Invisible — servidor (Google Apps Script)
 *
 * Hace el sorteo y manda un correo a cada participante desde la cuenta de Google
 * que publica este script. La web nunca recibe el resultado, solo la lista de
 * personas a las que se ha enviado el correo.
 *
 * Las reglas del organizador (exclusiones, asignaciones fijas y evitar parejas
 * cruzadas) se guardan aquí (propiedad REGLAS) y solo se pueden ver o cambiar
 * con la clave, desde «Opciones del organizador».
 *
 * Instalación: README.md → «1. Servidor en Google Apps Script».
 *
 * Propiedades del script (Configuración del proyecto → Propiedades del script):
 *   CLAVE         (obligatoria) Contraseña que escribirás en la app.
 *   EMAIL_PRUEBA  (opcional)    Dónde llegan los correos en modo prueba.
 *                               Por defecto, la propia cuenta que envía.
 */

const MAX_PARTICIPANTES = 50;
const MAX_EXCLUSIONES = 200;
const MAX_FALLOS_CLAVE = 8;
const SEGUNDOS_BLOQUEO = 15 * 60;
const MAX_BYTES_PROPIEDAD = 9000;
const NOMBRE_REMITENTE = 'Amigo Invisible';
const EMAIL_VALIDO = /^[^\s@,;<>()]+@[^\s@,;<>()]+\.[^\s@,;<>()]{2,}$/;

// ───────────────────────────── Entrada HTTP ─────────────────────────────

function doGet() {
  return ContentService.createTextOutput('El servidor del amigo invisible está funcionando.');
}

function doPost(e) {
  let peticion;
  try {
    peticion = JSON.parse((e && e.postData && e.postData.contents) || '');
    if (!peticion || typeof peticion !== 'object') throw new Error();
  } catch (err) {
    return responder_({ ok: false, codigo: 'PETICION', error: 'Petición no válida.' });
  }

  const acciones = {
    estado: accionEstado_,
    guardar: accionGuardar_,
    cargar: accionCargar_,
    vistaPrevia: accionVistaPrevia_,
    leerReglas: accionLeerReglas_,
    guardarReglas: accionGuardarReglas_,
    sortear: accionSortear_,
    reenviar: accionReenviar_,
  };

  try {
    comprobarClave_(peticion.clave);
    if (!Object.prototype.hasOwnProperty.call(acciones, peticion.accion)) {
      throw error_('Acción desconocida.', 'ACCION');
    }
    return responder_(Object.assign({ ok: true }, acciones[peticion.accion](peticion)));
  } catch (err) {
    return responder_({ ok: false, codigo: err.codigo || 'ERROR', error: err.message, detalle: err.detalle || null });
  }
}

function responder_(objeto) {
  return ContentService.createTextOutput(JSON.stringify(objeto)).setMimeType(ContentService.MimeType.JSON);
}

function error_(mensaje, codigo, detalle) {
  const err = new Error(mensaje);
  err.codigo = codigo;
  if (detalle) err.detalle = detalle;
  return err;
}

function comprobarClave_(clave) {
  const real = PropertiesService.getScriptProperties().getProperty('CLAVE');
  if (!real) throw error_('El servidor no tiene clave configurada (propiedad CLAVE del script).', 'SIN_CLAVE');

  const cache = CacheService.getScriptCache();
  const fallos = Number(cache.get('fallosClave') || 0);
  if (fallos >= MAX_FALLOS_CLAVE) {
    throw error_('Demasiados intentos con una clave equivocada. Espera un cuarto de hora.', 'BLOQUEADO');
  }
  if (typeof clave !== 'string' || clave !== real) {
    cache.put('fallosClave', String(fallos + 1), SEGUNDOS_BLOQUEO);
    throw error_('Clave incorrecta.', 'CLAVE');
  }
}

// ─────────────────────────────── Acciones ───────────────────────────────

function accionEstado_() {
  const ultimo = leerSorteo_();
  return {
    cuota: MailApp.getRemainingDailyQuota(),
    emailPrueba: emailPrueba_(),
    hayListaGuardada: Boolean(PropertiesService.getScriptProperties().getProperty('DATOS')),
    ultimoSorteo: ultimo
      ? { fecha: ultimo.fecha, titulo: ultimo.ajustes.titulo, participantes: ultimo.participantes.map(p => p.nombre) }
      : null,
  };
}

function accionGuardar_(peticion) {
  const datos = peticion.datos;
  if (!datos || !Array.isArray(datos.participantes)) throw error_('No hay ninguna lista que guardar.', 'DATOS');
  const guardado = { participantes: datos.participantes, ajustes: datos.ajustes || {} };
  // La versión hace falta para que, al bajar la lista, la app no la tome por una antigua y la «actualice».
  if (Number.isInteger(datos.version) && datos.version > 0) guardado.version = datos.version;
  const texto = JSON.stringify(guardado);
  if (bytes_(texto) > MAX_BYTES_PROPIEDAD) throw error_('La lista es demasiado grande para guardarla.', 'TAMANO');
  PropertiesService.getScriptProperties().setProperty('DATOS', texto);
  return { guardado: new Date().toISOString() };
}

function accionCargar_() {
  const texto = PropertiesService.getScriptProperties().getProperty('DATOS');
  return { datos: texto ? JSON.parse(texto) : null };
}

function accionVistaPrevia_(peticion) {
  const ajustes = validarAjustes_(peticion.ajustes);
  const datos = { nombre: 'Marta', asignado: 'Pablo', ajustes: ajustes, prueba: false };
  return { asunto: asunto_(ajustes), html: htmlCorreo_(datos) };
}

function accionLeerReglas_() {
  return { reglas: leerReglas_() };
}

function accionGuardarReglas_(peticion) {
  const reglas = validarReglas_(peticion.reglas);
  const texto = JSON.stringify(reglas);
  if (bytes_(texto) > MAX_BYTES_PROPIEDAD) throw error_('Hay demasiadas reglas para guardarlas.', 'TAMANO');
  PropertiesService.getScriptProperties().setProperty('REGLAS', texto);
  return { reglas: reglas };
}

function accionSortear_(peticion) {
  const participantes = validarParticipantes_(peticion.participantes);
  const ajustes = validarAjustes_(peticion.ajustes);
  const reglas = leerReglas_();
  // Por seguridad, solo es un sorteo real si se pide de forma explícita.
  const prueba = peticion.prueba !== false;

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw error_('Ya hay un sorteo en marcha. Espera un momento.', 'OCUPADO');
  try {
    if (!prueba) {
      const anterior = leerSorteo_();
      if (anterior && peticion.repetir !== true) {
        throw error_('Ya se hizo un sorteo real.', 'YA_SORTEADO', { fecha: anterior.fecha });
      }
    }

    const cuota = MailApp.getRemainingDailyQuota();
    if (cuota < participantes.length) {
      throw error_(
        `Hoy solo se pueden mandar ${cuota} correos más desde esta cuenta y hacen falta ${participantes.length}. Prueba mañana.`,
        'CUOTA'
      );
    }

    const nombres = participantes.map(p => p.nombre);
    const exclusiones = parejasAplicables_(reglas.exclusiones, nombres);
    const fijas = parejasAplicables_(reglas.fijas, nombres);
    let destino;
    try {
      destino = resolverSorteo_(nombres, exclusiones, reglas.evitarReciprocos, fijas);
    } catch (err) {
      // Mensaje genérico: el sorteo puede hacerse delante de otros y las reglas son privadas.
      if (err.codigo === 'IMPOSIBLE') {
        throw error_('Con las reglas que hay puestas no sale ningún reparto posible. Revísalas en Ajustes → Opciones del organizador.', 'IMPOSIBLE');
      }
      throw err;
    }

    const sorteo = { fecha: new Date().toISOString(), ajustes: ajustes, participantes: participantes, destino: destino };
    // Se guarda ANTES de enviar: así se puede reenviar a quien falle.
    if (!prueba) guardarSorteo_(sorteo);

    const destinoPrueba = prueba ? emailPrueba_() : null;
    const enviados = [];
    const fallidos = [];
    participantes.forEach((persona, i) => {
      try {
        enviarCorreo_(persona, participantes[destino[i]].nombre, ajustes, destinoPrueba);
        enviados.push(persona.nombre);
      } catch (err) {
        fallidos.push({ nombre: persona.nombre, error: err.message });
      }
    });

    return { prueba: prueba, destinoPrueba: destinoPrueba, enviados: enviados, fallidos: fallidos, fecha: sorteo.fecha };
  } finally {
    lock.releaseLock();
  }
}

function accionReenviar_(peticion) {
  const sorteo = leerSorteo_();
  if (!sorteo) throw error_('Todavía no se ha hecho ningún sorteo real.', 'SIN_SORTEO');

  const buscado = limpiarNombre_(peticion.nombre).toLowerCase();
  const i = sorteo.participantes.findIndex(p => p.nombre.toLowerCase() === buscado);
  if (i < 0) throw error_('Esa persona no estaba en el último sorteo.', 'DATOS');

  if (peticion.email) {
    const email = String(peticion.email).trim();
    if (!EMAIL_VALIDO.test(email) || email.length > 254) throw error_('El correo nuevo no es válido.', 'DATOS');
    sorteo.participantes[i].email = email;
    guardarSorteo_(sorteo);
  }

  const persona = sorteo.participantes[i];
  enviarCorreo_(persona, sorteo.participantes[sorteo.destino[i]].nombre, sorteo.ajustes, null);
  return { reenviado: persona.nombre, email: persona.email };
}

// ────────────────────────────── Validación ──────────────────────────────

function limpiarNombre_(valor) {
  return String(valor == null ? '' : valor).trim().replace(/\s+/g, ' ');
}

function validarParticipantes_(lista) {
  if (!Array.isArray(lista)) throw error_('Falta la lista de participantes.', 'DATOS');
  if (lista.length < 2) throw error_('Hacen falta al menos dos personas.', 'DATOS');
  if (lista.length > MAX_PARTICIPANTES) throw error_(`Como máximo pueden participar ${MAX_PARTICIPANTES} personas.`, 'DATOS');

  const vistos = Object.create(null);
  return lista.map(p => {
    const nombre = limpiarNombre_(p && p.nombre);
    const email = String((p && p.email) || '').trim();
    if (!nombre || nombre.length > 40) throw error_('Hay alguien sin nombre o con un nombre demasiado largo.', 'DATOS');
    if (!EMAIL_VALIDO.test(email) || email.length > 254) throw error_(`El correo de ${nombre} no es válido.`, 'DATOS');
    const clave = nombre.toLowerCase();
    if (vistos[clave]) throw error_(`Hay dos personas que se llaman «${nombre}».`, 'DATOS');
    vistos[clave] = true;
    return { nombre: nombre, email: email };
  });
}

function validarAjustes_(ajustes) {
  const a = ajustes || {};
  const texto = (valor, max) => String(valor == null ? '' : valor).trim().slice(0, max);
  return {
    titulo: texto(a.titulo, 60) || 'Navidad ' + new Date().getFullYear(),
    presupuesto: texto(a.presupuesto, 40),
    fecha: texto(a.fecha, 80),
    mensaje: texto(a.mensaje, 600),
    lugar: validarLugar_(a.lugar),
  };
}

/**
 * Lugar del intercambio. modo: 'ninguno' (no sale en el correo), 'pendiente' («Por definir»)
 * o 'direccion' (nombre opcional + calle, con enlace a Google Maps).
 */
function validarLugar_(lugar) {
  const l = lugar && typeof lugar === 'object' ? lugar : {};
  const texto = (valor, max) => String(valor == null ? '' : valor).trim().replace(/\s+/g, ' ').slice(0, max);
  const nombre = texto(l.nombre, 60);
  const direccion = texto(l.direccion, 120);
  if (l.modo === 'pendiente') return { modo: 'pendiente', nombre: '', direccion: '' };
  if (l.modo === 'direccion' && (nombre || direccion)) return { modo: 'direccion', nombre: nombre, direccion: direccion };
  return { modo: 'ninguno', nombre: '', direccion: '' };
}

/** El enlace siempre se construye aquí a partir del texto de la dirección. */
function enlaceMapa_(direccion) {
  return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(direccion);
}

function validarReglas_(reglas) {
  if (!reglas || typeof reglas !== 'object') throw error_('Las reglas no son válidas.', 'DATOS');
  const lista = reglas.exclusiones == null ? [] : reglas.exclusiones;
  if (!Array.isArray(lista)) throw error_('Las exclusiones no son válidas.', 'DATOS');
  if (lista.length > MAX_EXCLUSIONES) throw error_(`Como máximo se pueden poner ${MAX_EXCLUSIONES} exclusiones.`, 'DATOS');

  const vistas = Object.create(null);
  const exclusiones = [];
  lista.forEach(par => {
    if (!Array.isArray(par) || par.length !== 2) throw error_('Hay una exclusión mal formada.', 'DATOS');
    const a = limpiarNombre_(par[0]);
    const b = limpiarNombre_(par[1]);
    if (!a || !b || a.length > 40 || b.length > 40) throw error_('Hay una exclusión con un nombre vacío o demasiado largo.', 'DATOS');
    if (a.toLowerCase() === b.toLowerCase()) throw error_('Una exclusión tiene que ser entre dos personas distintas.', 'DATOS');
    const clave = [a.toLowerCase(), b.toLowerCase()].sort().join('\u0000');
    if (vistas[clave]) return;
    vistas[clave] = true;
    exclusiones.push([a, b]);
  });
  return { exclusiones: exclusiones, fijas: validarFijas_(reglas.fijas), evitarReciprocos: reglas.evitarReciprocos === true };
}

/** Asignaciones fijas: [[quien, aQuien], ...]. Cada persona da y recibe como mucho una. */
function validarFijas_(valor) {
  const lista = valor == null ? [] : valor;
  if (!Array.isArray(lista)) throw error_('Las asignaciones fijas no son válidas.', 'DATOS');
  if (lista.length > MAX_PARTICIPANTES) throw error_(`Como máximo se pueden poner ${MAX_PARTICIPANTES} asignaciones fijas.`, 'DATOS');

  const da = Object.create(null);
  const recibe = Object.create(null);
  const fijas = [];
  lista.forEach(par => {
    if (!Array.isArray(par) || par.length !== 2) throw error_('Hay una asignación fija mal formada.', 'DATOS');
    const a = limpiarNombre_(par[0]);
    const b = limpiarNombre_(par[1]);
    if (!a || !b || a.length > 40 || b.length > 40) throw error_('Hay una asignación fija con un nombre vacío o demasiado largo.', 'DATOS');
    const ka = a.toLowerCase();
    const kb = b.toLowerCase();
    if (ka === kb) throw error_('Nadie puede regalarse a sí mismo.', 'DATOS');
    if (da[ka] === kb) return;
    if (da[ka]) throw error_(`${a} tiene más de una asignación fija.`, 'DATOS');
    if (recibe[kb]) throw error_(`A ${b} le regalan dos personas en las asignaciones fijas.`, 'DATOS');
    da[ka] = kb;
    recibe[kb] = ka;
    fijas.push([a, b]);
  });
  return fijas;
}

/** Se queda con las parejas cuyas dos personas participan (con el nombre tal y como viene en la lista). */
function parejasAplicables_(parejas, nombres) {
  const porNombre = Object.create(null);
  nombres.forEach(n => { porNombre[n.toLowerCase()] = n; });
  return (parejas || [])
    .map(par => [porNombre[par[0].toLowerCase()], porNombre[par[1].toLowerCase()]])
    .filter(par => par[0] && par[1]);
}

// ───────────────────────────── Almacenamiento ───────────────────────────

function leerReglas_() {
  const texto = PropertiesService.getScriptProperties().getProperty('REGLAS');
  if (!texto) return { exclusiones: [], fijas: [], evitarReciprocos: false };
  try {
    return validarReglas_(JSON.parse(texto));
  } catch (err) {
    return { exclusiones: [], fijas: [], evitarReciprocos: false };
  }
}

/** Se guarda en Base64 para que no veas el resultado sin querer al abrir las propiedades. */
function guardarSorteo_(sorteo) {
  const codificado = Utilities.base64Encode(JSON.stringify(sorteo), Utilities.Charset.UTF_8);
  if (codificado.length > MAX_BYTES_PROPIEDAD) throw error_('Hay demasiados datos para guardar el sorteo.', 'TAMANO');
  PropertiesService.getScriptProperties().setProperty('ULTIMO_SORTEO', codificado);
}

function leerSorteo_() {
  const codificado = PropertiesService.getScriptProperties().getProperty('ULTIMO_SORTEO');
  if (!codificado) return null;
  const bytes = Utilities.base64Decode(codificado, Utilities.Charset.UTF_8);
  return JSON.parse(Utilities.newBlob(bytes).getDataAsString('UTF-8'));
}

function bytes_(texto) {
  return Utilities.newBlob(texto).getBytes().length;
}

function emailPrueba_() {
  const propiedad = PropertiesService.getScriptProperties().getProperty('EMAIL_PRUEBA');
  const email = (propiedad && propiedad.trim()) || Session.getEffectiveUser().getEmail();
  if (!email) throw error_('No sé a qué correo mandar las pruebas: añade la propiedad EMAIL_PRUEBA al script.', 'SIN_EMAIL_PRUEBA');
  return email;
}

// ─────────────────────────────── Sorteo ─────────────────────────────────
// Copia del algoritmo de js/sorteo.js (los tests comprueban que ambos cumplen las reglas).

function resolverSorteo_(nombres, exclusiones, evitarReciprocos, fijas) {
  const n = nombres.length;
  if (evitarReciprocos && n < 3) {
    throw error_('Para evitar parejas cruzadas hacen falta al menos tres personas.', 'IMPOSIBLE');
  }
  const indice = Object.create(null);
  nombres.forEach((nombre, i) => { indice[nombre.toLowerCase()] = i; });

  const permitido = [];
  for (let i = 0; i < n; i++) {
    permitido.push([]);
    for (let j = 0; j < n; j++) permitido[i].push(i !== j);
  }
  exclusiones.forEach(par => {
    const a = indice[par[0].toLowerCase()];
    const b = indice[par[1].toLowerCase()];
    permitido[a][b] = false;
    permitido[b][a] = false;
  });

  // Asignaciones fijas: fijo[a] = b → a le regala a b sí o sí.
  const fijo = new Array(n).fill(-1);
  const recibeDe = new Array(n).fill(-1);
  (fijas || []).forEach(par => {
    const a = indice[par[0].toLowerCase()];
    const b = indice[par[1].toLowerCase()];
    if (a === b || (fijo[a] !== -1 && fijo[a] !== b) || (recibeDe[b] !== -1 && recibeDe[b] !== a) || !permitido[a][b]) {
      throw error_('Las asignaciones fijas chocan entre sí o con las exclusiones.', 'IMPOSIBLE');
    }
    fijo[a] = b;
    recibeDe[b] = a;
  });
  for (let a = 0; a < n; a++) {
    const b = fijo[a];
    if (b === -1) continue;
    if (evitarReciprocos && fijo[b] === a) throw error_('Hay dos personas fijadas la una a la otra.', 'IMPOSIBLE');
    for (let j = 0; j < n; j++) permitido[a][j] = j === b;
    for (let i = 0; i < n; i++) if (i !== a) permitido[i][b] = false;
  }

  for (let i = 0; i < n; i++) {
    if (!permitido[i].some(Boolean)) throw error_(`${nombres[i]} no puede regalar a nadie.`, 'IMPOSIBLE');
    if (!permitido.some(fila => fila[i])) throw error_(`A ${nombres[i]} no le puede regalar nadie.`, 'IMPOSIBLE');
  }

  const esValida = destino => destino.every((j, i) => permitido[i][j] && !(evitarReciprocos && destino[j] === i));

  // Muestreo por rechazo: cada reparto válido tiene la misma probabilidad.
  // Las asignaciones fijas se dejan puestas y solo se baraja al resto.
  const libres = rango_(n).filter(i => fijo[i] === -1);
  const destinosLibres = rango_(n).filter(j => recibeDe[j] === -1);
  for (let intento = 0; intento < 20000; intento++) {
    const destino = fijo.slice();
    const barajados = barajar_(destinosLibres);
    libres.forEach((i, k) => { destino[i] = barajados[k]; });
    if (esValida(destino)) return destino;
  }

  // Casos muy restringidos: búsqueda exhaustiva con orden aleatorio.
  const destino = new Array(n).fill(-1);
  const usado = new Array(n).fill(false);
  const opciones = permitido.map(fila => fila.filter(Boolean).length);
  const orden = barajar_(rango_(n)).sort((a, b) => opciones[a] - opciones[b]);
  let pasos = 0;
  const paso = k => {
    if (k === n) return true;
    if (++pasos > 200000) throw error_('Hay demasiadas reglas para encontrar un reparto.', 'IMPOSIBLE');
    const i = orden[k];
    for (const j of barajar_(rango_(n))) {
      if (usado[j] || !permitido[i][j] || (evitarReciprocos && destino[j] === i)) continue;
      destino[i] = j; usado[j] = true;
      if (paso(k + 1)) return true;
      destino[i] = -1; usado[j] = false;
    }
    return false;
  };
  if (!paso(0)) throw error_('Con estas reglas no hay ningún reparto posible.', 'IMPOSIBLE');
  return destino;
}

function rango_(n) {
  return Array.from({ length: n }, (_, i) => i);
}

function barajar_(lista) {
  const copia = lista.slice();
  for (let i = copia.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = copia[i]; copia[i] = copia[j]; copia[j] = tmp;
  }
  return copia;
}

// ─────────────────────────────── Correos ────────────────────────────────
// Para ver los cambios al momento: node herramientas/vista-correo.js
// (abre el correo en el navegador y se recarga cada vez que guardas este archivo).

const EMOJI_CORREO = '🎁';

function asunto_(ajustes) {
  return `Tu amigo invisible · ${ajustes.titulo}`;
}

function asuntoCorreo_(nombre, ajustes, prueba) {
  return prueba ? `[Prueba · ${nombre}] ${asunto_(ajustes)}` : asunto_(ajustes);
}

function enviarCorreo_(persona, asignado, ajustes, destinoPrueba) {
  const datos = { nombre: persona.nombre, asignado: asignado, ajustes: ajustes, prueba: Boolean(destinoPrueba), emailReal: persona.email };
  MailApp.sendEmail({
    to: destinoPrueba || persona.email,
    subject: asuntoCorreo_(persona.nombre, ajustes, Boolean(destinoPrueba)),
    body: textoCorreo_(datos),
    htmlBody: htmlCorreo_(datos),
    name: NOMBRE_REMITENTE,
  });
}

function escaparHtml_(texto) {
  return String(texto)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function textoCorreo_(d) {
  const a = d.ajustes;
  const lineas = [];
  if (d.prueba) lineas.push(`(Esto es una prueba. En el sorteo de verdad, este correo le llegaría a ${d.nombre}, ${d.emailReal}.)`, '');
  lineas.push(`¡Hola, ${d.nombre}!`, '');
  if (a.mensaje) lineas.push(a.mensaje, '');
  lineas.push(`Ya está hecho el sorteo y te ha tocado regalar a ${d.asignado}.`);
  const detalles = [];
  if (a.fecha) detalles.push(`Fecha: ${a.fecha}`);
  if (a.presupuesto) detalles.push(`Presupuesto: ${a.presupuesto}`);
  const lugar = a.lugar || {};
  if (lugar.modo === 'pendiente') detalles.push('Lugar: por definir');
  if (lugar.modo === 'direccion') {
    detalles.push('Lugar: ' + [lugar.nombre, lugar.direccion].filter(Boolean).join(', '));
    if (lugar.direccion) detalles.push('Mapa: ' + enlaceMapa_(lugar.direccion));
  }
  if (detalles.length) lineas.push('', ...detalles);
  return lineas.join('\n');
}

/**
 * Colores del correo: cada papel tiene su color en claro y en modo oscuro.
 *
 * En claro: cabecera verde muy oscuro, papel crema y detalles dorados.
 * El modo oscuro solo lo usan los programas que lo respetan (Mail del iPhone,
 * Apple Mail y Outlook): ahí todo pasa a los colores de la app. Gmail no deja
 * elegirlo y aplica su propio modo oscuro.
 */
const COLORES_CORREO = {
  //               propiedad           claro      oscuro
  fondo:         ['background-color', '#ebe3d4', '#0d1915'],
  cabecera:      ['background-color', '#13241e', '#1a3029'],
  papel:         ['background-color', '#fbf7ef', '#13241e'],
  caja:          ['background-color', '#f3ecdf', '#1a2f28'],
  raya:          ['background-color', '#b08d52', '#c4a46a'],
  tinta:         ['color', '#2a2520', '#ebe3d3'],
  suave:         ['color', '#6b6257', '#a9a08f'],
  titulo:        ['color', '#efe7d8', '#efe7d8'],
  'oro-cabecera': ['color', '#d6bb86', '#d6bb86'],
  nombre:        ['color', '#1f3a2f', '#e0c690'],
  // Etiquetas pequeñas sobre fondo claro: un dorado más oscuro para que se lean bien.
  oro:           ['color', '#94733d', '#c4a46a'],
  borde:         ['border-color', '#e3d8c4', '#2c4139'],
  aviso:         ['border-color', '#b08d52', '#c4a46a'],
};

/** class + style en línea (en claro) para uno o varios papeles: atributos(['papel'], 'padding:0;') */
function atributosCorreo_(papeles, extra) {
  const enLinea = papeles.map(p => `${COLORES_CORREO[p][0]}:${COLORES_CORREO[p][1]};`).join('');
  return `class="${papeles.map(p => 'ai-' + p).join(' ')}" style="${extra || ''}${enLinea}"`;
}

function cssModoOscuro_() {
  const reglas = prefijo => Object.keys(COLORES_CORREO)
    .map(p => {
      const [propiedad, , oscuro] = COLORES_CORREO[p];
      const pre = prefijo === 'outlook' ? (propiedad === 'background-color' ? '[data-ogsb] ' : '[data-ogsc] ') : '';
      return `    ${pre}.ai-${p} { ${propiedad}: ${oscuro} !important; }`;
    })
    .join('\n');
  // Dos bloques aparte: si algún programa no entiende uno, lo descarta sin tocar el resto.
  return `<style>
    :root { color-scheme: light dark; supported-color-schemes: light dark; }
    @media (prefers-color-scheme: dark) {
${reglas('')}
    }
  </style>
  <style>
${reglas('outlook')}
  </style>`;
}

function htmlCorreo_(d) {
  const e = escaparHtml_;
  const a = d.ajustes;
  const at = atributosCorreo_;
  const serif = "Georgia, 'Times New Roman', serif";
  const sans = "'Helvetica Neue', Helvetica, Arial, sans-serif";
  const parrafo = `margin:0 0 18px;font-family:${serif};font-size:17px;line-height:1.65;`;

  const aviso = d.prueba
    ? `<tr><td style="padding:0 0 14px;">
         <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
           <td ${at(['suave', 'aviso'], `padding:12px 16px;border:1px dashed;border-radius:8px;font-family:${sans};font-size:13px;line-height:1.5;`)}>
             Esto es una prueba. En el sorteo de verdad, este correo le llegaría a <strong ${at(['tinta'])}>${e(d.nombre)}</strong> (${e(d.emailReal)}).
           </td>
         </tr></table>
       </td></tr>`
    : '';

  // Caja de datos: fecha y presupuesto en dos columnas; debajo, el lugar a todo el ancho.
  const etiqueta = texto => `<div ${at(['oro'], `font-family:${sans};font-size:11px;letter-spacing:2px;text-transform:uppercase;padding-bottom:6px;`)}>${texto}</div>`;
  const valor = (texto, papel) => `<div ${at([papel || 'tinta'], `font-family:${serif};font-size:17px;line-height:1.4;`)}>${texto}</div>`;

  const datos = [];
  if (a.fecha) datos.push(['Fecha', a.fecha]);
  if (a.presupuesto) datos.push(['Presupuesto', a.presupuesto]);

  const lugar = a.lugar || {};
  let contenidoLugar = '';
  if (lugar.modo === 'pendiente') contenidoLugar = valor('Por definir', 'suave');
  if (lugar.modo === 'direccion') {
    if (lugar.nombre) contenidoLugar += valor(e(lugar.nombre));
    if (lugar.direccion) {
      contenidoLugar += `<div style="margin-top:${lugar.nombre ? 4 : 0}px;font-family:${serif};font-size:${lugar.nombre ? 15 : 17}px;line-height:1.4;">`
        + `<a href="${e(enlaceMapa_(lugar.direccion))}" target="_blank" ${at(['nombre'], 'text-decoration:underline;')}>${e(lugar.direccion)}</a></div>`;
    }
  }

  const filas = [];
  if (datos.length) {
    filas.push(`<tr>${datos.map(([titulo, texto], i) => `
         <td valign="top" width="${Math.floor(100 / datos.length)}%" ${i ? at(['borde'], 'padding:16px 8px;text-align:center;border-left:1px solid;') : 'style="padding:16px 8px;text-align:center;"'}>
           ${etiqueta(titulo)}${valor(e(texto))}
         </td>`).join('')}</tr>`);
  }
  if (contenidoLugar) {
    filas.push(`<tr><td colspan="${Math.max(1, datos.length)}" ${datos.length ? at(['borde'], 'padding:16px 12px;text-align:center;border-top:1px solid;') : 'style="padding:16px 12px;text-align:center;"'}>
           ${etiqueta('Lugar')}${contenidoLugar}
         </td></tr>`);
  }
  const bloqueDatos = filas.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" ${at(['caja'], 'border-radius:10px;')}>${filas.join('')}</table>`
    : '';

  // El mensaje del organizador va tal cual, como texto normal, justo después del saludo.
  // Una línea en blanco empieza un párrafo nuevo.
  const bloqueMensaje = a.mensaje.split(/\n\s*\n/).map(t => t.trim()).filter(Boolean)
    .map(t => `<p ${at(['tinta'], parrafo)}>${e(t).replace(/\n/g, '<br>')}</p>`)
    .join('\n          ');

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light dark">
  <meta name="supported-color-schemes" content="light dark">
  <title>${e(asunto_(a))}</title>
  ${cssModoOscuro_()}
</head>
<body ${at(['fondo'], 'margin:0;padding:0;')}>
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">Ya está hecho el sorteo. Mira a quién te ha tocado.</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" ${at(['fondo'])}>
    <tr><td align="center" style="padding:28px 12px 36px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;">
        ${aviso}
        <tr><td ${at(['cabecera'], 'border-radius:12px 12px 0 0;padding:30px 24px 26px;text-align:center;')}>
          <div ${at(['oro-cabecera'], `font-family:${sans};font-size:11px;letter-spacing:3px;text-transform:uppercase;`)}>${e(a.titulo)}</div>
          <div ${at(['titulo'], `margin-top:10px;font-family:${serif};font-size:32px;line-height:1.1;`)}>Amigo <em ${at(['oro-cabecera'])}>Invisible</em></div>
        </td></tr>
        <tr><td ${at(['papel'], 'border-radius:0 0 12px 12px;padding:34px 24px 32px;')}>
          <p ${at(['tinta'], parrafo)}>¡Hola, ${e(d.nombre)}!</p>
          ${bloqueMensaje}
          <p ${at(['tinta'], parrafo + 'margin-bottom:0;')}>Ya está hecho el sorteo y este año te toca regalar a…</p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:26px 0 ${filas.length ? 30 : 0}px;"><tr>
            <td style="padding:6px 4px 0;text-align:center;">
              <div style="font-size:34px;line-height:1;">${EMOJI_CORREO}</div>
              <div ${at(['nombre'], `margin-top:14px;font-family:${serif};font-style:italic;font-size:42px;line-height:1.15;word-break:break-word;`)}>${e(d.asignado)}</div>
              <div ${at(['raya'], 'width:48px;height:1px;margin:20px auto 0;font-size:0;line-height:1px;')}>&nbsp;</div>
            </td>
          </tr></table>
          ${bloqueDatos}
        </td></tr>
        <tr><td ${at(['oro'], `padding:20px 0 0;text-align:center;font-family:${serif};font-size:15px;`)}>&#10022;</td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ──────────────────── Utilidades para ejecutar desde el editor ────────────────────

/**
 * Ejecútala desde el editor (▶ Ejecutar) para dar permisos al script y revisar
 * la configuración. NO envía ningún correo.
 */
function comprobarConfiguracion() {
  const propiedades = PropertiesService.getScriptProperties();
  console.log('CLAVE configurada: ' + (propiedades.getProperty('CLAVE') ? 'sí' : 'NO → añádela en Configuración del proyecto → Propiedades del script'));
  console.log('Correos que quedan hoy: ' + MailApp.getRemainingDailyQuota());
  console.log('Los correos de prueba llegarán a: ' + emailPrueba_());
  console.log('Hay un sorteo real guardado: ' + (propiedades.getProperty('ULTIMO_SORTEO') ? 'sí' : 'no'));
}

/** Manda un correo de muestra SOLO a tu propia cuenta (o a EMAIL_PRUEBA) para ver el diseño. */
function enviarCorreoDeMuestra() {
  const ajustes = validarAjustes_({ presupuesto: '20 €', fecha: '24 de diciembre', mensaje: 'Esto es un correo de muestra.' });
  enviarCorreo_({ nombre: 'Marta', email: emailPrueba_() }, 'Pablo', ajustes, emailPrueba_());
}
