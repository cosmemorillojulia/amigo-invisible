/**
 * 🎄 Amigo Invisible — backend en Google Apps Script
 *
 * Hace el sorteo y envía un correo a cada participante desde la cuenta de Google
 * que despliega este script. La web (GitHub Pages) nunca recibe el resultado:
 * solo la lista de personas a las que se ha enviado el correo.
 *
 * Instalación: ver README.md → «1. Backend en Google Apps Script».
 *
 * Propiedades del script (Configuración del proyecto → Propiedades del script):
 *   CLAVE         (obligatoria) Contraseña que escribirás en la app.
 *   EMAIL_PRUEBA  (opcional)    Dónde llegan los correos en modo prueba.
 *                               Por defecto, la propia cuenta que envía.
 */

const MAX_PARTICIPANTES = 50;
const MAX_FALLOS_CLAVE = 8;
const SEGUNDOS_BLOQUEO = 15 * 60;
const MAX_BYTES_PROPIEDAD = 9000;
const NOMBRE_REMITENTE = 'Amigo Invisible';
const EMAIL_VALIDO = /^[^\s@,;<>()]+@[^\s@,;<>()]+\.[^\s@,;<>()]{2,}$/;

// ───────────────────────────── Entrada HTTP ─────────────────────────────

function doGet() {
  return ContentService.createTextOutput(
    '🎄 El backend del Amigo Invisible está funcionando. Usa la app web para hacer el sorteo.'
  );
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
    throw error_('Demasiados intentos con una clave equivocada. Espera 15 minutos.', 'BLOQUEADO');
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
  const texto = JSON.stringify(datos);
  if (bytes_(texto) > MAX_BYTES_PROPIEDAD) throw error_('La lista es demasiado grande para guardarla en la nube.', 'TAMANO');
  PropertiesService.getScriptProperties().setProperty('DATOS', texto);
  return { guardado: new Date().toISOString() };
}

function accionCargar_() {
  const texto = PropertiesService.getScriptProperties().getProperty('DATOS');
  return { datos: texto ? JSON.parse(texto) : null };
}

function accionVistaPrevia_(peticion) {
  const ajustes = validarAjustes_(peticion.ajustes);
  const datos = { nombre: 'Rudolf', asignado: 'Papá Noel', ajustes: ajustes, prueba: false };
  return { asunto: asunto_(ajustes), html: htmlCorreo_(datos) };
}

function accionSortear_(peticion) {
  const participantes = validarParticipantes_(peticion.participantes);
  const exclusiones = validarExclusiones_(peticion.exclusiones, participantes);
  const ajustes = validarAjustes_(peticion.ajustes);
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
        `Hoy solo quedan ${cuota} correos disponibles en la cuenta y hacen falta ${participantes.length}. Prueba mañana.`,
        'CUOTA'
      );
    }

    const nombres = participantes.map(p => p.nombre);
    const destino = resolverSorteo_(nombres, exclusiones, ajustes.evitarReciprocos);
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
  if (!sorteo) throw error_('Todavía no hay ningún sorteo real guardado.', 'SIN_SORTEO');

  const buscado = String(peticion.nombre || '').trim().toLowerCase();
  const i = sorteo.participantes.findIndex(p => p.nombre.toLowerCase() === buscado);
  if (i < 0) throw error_('Esa persona no está en el último sorteo.', 'DATOS');

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

function validarParticipantes_(lista) {
  if (!Array.isArray(lista)) throw error_('Falta la lista de participantes.', 'DATOS');
  if (lista.length < 2) throw error_('Hacen falta al menos 2 participantes.', 'DATOS');
  if (lista.length > MAX_PARTICIPANTES) throw error_(`Como máximo ${MAX_PARTICIPANTES} participantes.`, 'DATOS');

  const vistos = Object.create(null);
  return lista.map(p => {
    const nombre = String((p && p.nombre) || '').trim().replace(/\s+/g, ' ');
    const email = String((p && p.email) || '').trim();
    if (!nombre || nombre.length > 40) throw error_('Hay un participante sin nombre o con un nombre demasiado largo.', 'DATOS');
    if (!EMAIL_VALIDO.test(email) || email.length > 254) throw error_(`El correo de ${nombre} no es válido.`, 'DATOS');
    const clave = nombre.toLowerCase();
    if (vistos[clave]) throw error_(`El nombre «${nombre}» está repetido.`, 'DATOS');
    vistos[clave] = true;
    return { nombre: nombre, email: email };
  });
}

function validarExclusiones_(lista, participantes) {
  if (lista == null) return [];
  if (!Array.isArray(lista)) throw error_('Las exclusiones no son válidas.', 'DATOS');
  const porNombre = Object.create(null);
  participantes.forEach(p => { porNombre[p.nombre.toLowerCase()] = p.nombre; });
  return lista.map(par => {
    if (!Array.isArray(par) || par.length !== 2) throw error_('Las exclusiones no son válidas.', 'DATOS');
    const a = porNombre[String(par[0]).trim().toLowerCase()];
    const b = porNombre[String(par[1]).trim().toLowerCase()];
    if (!a || !b) throw error_(`La exclusión «${par[0]} – ${par[1]}» menciona a alguien que no participa.`, 'DATOS');
    if (a === b) throw error_('Una exclusión no puede ser de alguien consigo mismo.', 'DATOS');
    return [a, b];
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
    evitarReciprocos: a.evitarReciprocos === true,
  };
}

// ───────────────────────────── Almacenamiento ───────────────────────────

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

function resolverSorteo_(nombres, exclusiones, evitarReciprocos) {
  const n = nombres.length;
  if (evitarReciprocos && n < 3) {
    throw error_('Para evitar intercambios cruzados hacen falta al menos 3 participantes.', 'IMPOSIBLE');
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
  for (let i = 0; i < n; i++) {
    if (!permitido[i].some(Boolean)) throw error_(`${nombres[i]} no puede regalar a nadie con estas exclusiones.`, 'IMPOSIBLE');
  }

  const esValida = destino => destino.every((j, i) => permitido[i][j] && !(evitarReciprocos && destino[j] === i));

  // Muestreo por rechazo: cada reparto válido tiene la misma probabilidad.
  for (let intento = 0; intento < 20000; intento++) {
    const destino = barajar_(rango_(n));
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
    if (++pasos > 200000) throw error_('Hay demasiadas exclusiones para encontrar un sorteo. Quita alguna.', 'IMPOSIBLE');
    const i = orden[k];
    for (const j of barajar_(rango_(n))) {
      if (usado[j] || !permitido[i][j] || (evitarReciprocos && destino[j] === i)) continue;
      destino[i] = j; usado[j] = true;
      if (paso(k + 1)) return true;
      destino[i] = -1; usado[j] = false;
    }
    return false;
  };
  if (!paso(0)) throw error_('Con estas exclusiones el sorteo es imposible. Quita alguna.', 'IMPOSIBLE');
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

function asunto_(ajustes) {
  return `🎄 ¡Tu Amigo Invisible de ${ajustes.titulo}! 🎁`;
}

function enviarCorreo_(persona, asignado, ajustes, destinoPrueba) {
  const datos = { nombre: persona.nombre, asignado: asignado, ajustes: ajustes, prueba: Boolean(destinoPrueba), emailReal: persona.email };
  const asunto = destinoPrueba ? `🧪 [PRUEBA · ${persona.nombre}] ${asunto_(ajustes)}` : asunto_(ajustes);
  MailApp.sendEmail({
    to: destinoPrueba || persona.email,
    subject: asunto,
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
  if (d.prueba) lineas.push(`[CORREO DE PRUEBA — en el sorteo real iría a ${d.nombre} (${d.emailReal})]`, '');
  lineas.push(`¡Hola ${d.nombre}!`, '', `Ha llegado el momento del Amigo Invisible de ${a.titulo}.`, '');
  lineas.push(`Tu amigo invisible es: ${d.asignado}`, '');
  if (a.presupuesto) lineas.push(`Presupuesto: ${a.presupuesto}`);
  if (a.fecha) lineas.push(`Intercambio: ${a.fecha}`);
  if (a.mensaje) lineas.push('', a.mensaje);
  lineas.push('', '¡Shhh! Que no se entere nadie. ¡Feliz Navidad! 🎄');
  return lineas.join('\n');
}

function htmlCorreo_(d) {
  const e = escaparHtml_;
  const a = d.ajustes;

  const bannerPrueba = d.prueba
    ? `<tr><td style="background-color:#fff3cd;color:#7a5b00;padding:14px 20px;text-align:center;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;">
         🧪 <strong>CORREO DE PRUEBA</strong> — en el sorteo real iría a <strong>${e(d.nombre)}</strong> (${e(d.emailReal)})
       </td></tr>`
    : '';

  const detalles = [];
  if (a.presupuesto) detalles.push(['💶', 'Presupuesto', a.presupuesto]);
  if (a.fecha) detalles.push(['📅', 'Intercambio', a.fecha]);
  const bloqueDetalles = detalles.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 28px 0;">
         ${detalles.map(([icono, etiqueta, valor]) => `
         <tr><td style="padding:12px 16px;background-color:#f1f6f2;border-radius:12px;font-size:16px;line-height:1.4;color:#1a472a;text-align:left;">
           ${icono}&nbsp; <strong>${etiqueta}:</strong> ${e(valor)}
         </td></tr>
         <tr><td style="height:8px;line-height:8px;font-size:0;">&nbsp;</td></tr>`).join('')}
       </table>`
    : '';

  const bloqueMensaje = a.mensaje
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 28px 0;">
         <tr><td style="padding:18px 20px;border-left:4px solid #c41e3a;background-color:#fdf3f4;border-radius:0 12px 12px 0;text-align:left;">
           <div style="font-size:13px;letter-spacing:1px;text-transform:uppercase;color:#a01830;font-weight:bold;margin-bottom:6px;">💌 Mensaje del organizador</div>
           <div style="font-size:16px;line-height:1.6;color:#444444;">${e(a.mensaje).replace(/\n/g, '<br>')}</div>
         </td></tr>
       </table>`
    : '';

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${e(asunto_(a))}</title>
</head>
<body style="margin:0;padding:0;background-color:#1a472a;font-family:Georgia,'Times New Roman',serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#1a472a;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background-color:#ffffff;border-radius:24px;overflow:hidden;">
        ${bannerPrueba}
        <tr>
          <td style="background-color:#c41e3a;background-image:linear-gradient(135deg,#c41e3a 0%,#8b0000 100%);padding:44px 24px 40px;text-align:center;">
            <div style="font-size:26px;letter-spacing:6px;">❄️⭐🎄⭐❄️</div>
            <h1 style="color:#ffffff;margin:18px 0 10px;font-size:38px;line-height:1.15;letter-spacing:2px;font-weight:bold;">AMIGO INVISIBLE</h1>
            <p style="color:#ffe5e5;font-size:19px;margin:0;font-style:italic;">✨ ${e(a.titulo)} ✨</p>
          </td>
        </tr>
        <tr>
          <td style="padding:44px 28px 20px;text-align:center;">
            <div style="font-size:30px;color:#2d5a3d;margin-bottom:22px;font-weight:bold;">¡Hola ${e(d.nombre)}! 🎅</div>
            <p style="font-size:18px;color:#444444;line-height:1.7;margin:0 0 30px;">
              ¡Ha llegado el momento más emocionante del año!<br>
              <strong style="color:#c41e3a;">Es hora de descubrir a quién vas a hacer feliz esta Navidad.</strong>
            </p>
            <div style="font-size:56px;line-height:1;margin-bottom:12px;">🎁</div>
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 32px;">
              <tr><td style="background-color:#ffd700;background-image:linear-gradient(135deg,#ffd700 0%,#ffed4e 50%,#ffd700 100%);border:4px solid #c41e3a;border-radius:20px;padding:28px 18px;text-align:center;">
                <div style="font-size:20px;color:#1a472a;margin-bottom:16px;font-weight:bold;">🌟 Tu amigo invisible es... 🌟</div>
                <div style="font-size:34px;line-height:1.2;color:#c41e3a;font-weight:bold;text-transform:uppercase;letter-spacing:3px;padding:18px 12px;background-color:#fffbea;border-radius:14px;word-break:break-word;">
                  ${e(d.asignado)}
                </div>
              </td></tr>
            </table>
            ${bloqueDetalles}
            ${bloqueMensaje}
            <p style="font-size:17px;color:#444444;line-height:1.7;margin:0 0 20px;">
              Ahora empieza lo divertido: encontrar el regalo perfecto.<br>
              Y recuerda: <strong style="color:#c41e3a;">¡shhh, que no se entere nadie!</strong> 🤫
            </p>
            <div style="font-size:26px;letter-spacing:8px;margin:10px 0 18px;">❄️❄️❄️</div>
          </td>
        </tr>
        <tr>
          <td style="background-color:#1a472a;background-image:linear-gradient(135deg,#1a472a 0%,#2d5a3d 100%);padding:32px 24px;text-align:center;color:#ffffff;">
            <p style="margin:0 0 10px;font-size:17px;"><strong>🎊 ¡Feliz Navidad y a disfrutar preparando tu regalo! 🎊</strong></p>
            <p style="margin:0;font-size:15px;opacity:0.9;font-style:italic;">Con cariño, el equipo organizador 💚❤️</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ──────────────────── Utilidades para ejecutar desde el editor ────────────────────

/**
 * Ejecútala una vez desde el editor (botón ▶ Ejecutar) para dar permisos al
 * script y revisar la configuración. NO envía ningún correo.
 */
function comprobarConfiguracion() {
  const propiedades = PropertiesService.getScriptProperties();
  console.log('CLAVE configurada: ' + (propiedades.getProperty('CLAVE') ? 'sí ✅' : 'NO ❌ → añádela en Configuración del proyecto → Propiedades del script'));
  console.log('Correos que quedan hoy: ' + MailApp.getRemainingDailyQuota());
  console.log('Los correos de prueba llegarán a: ' + emailPrueba_());
  console.log('Hay un sorteo real guardado: ' + (propiedades.getProperty('ULTIMO_SORTEO') ? 'sí' : 'no'));
}

/** Envía un correo de muestra SOLO a tu propia cuenta (o a EMAIL_PRUEBA) para ver el diseño. */
function enviarCorreoDeMuestra() {
  const ajustes = validarAjustes_({ presupuesto: '20 €', fecha: '24 de diciembre', mensaje: '¡Esto es un correo de muestra!' });
  enviarCorreo_({ nombre: 'Rudolf', email: emailPrueba_() }, 'Papá Noel', ajustes, emailPrueba_());
}
