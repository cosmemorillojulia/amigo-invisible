/* ───────────────────────── Amigo Invisible · app web ───────────────────────── */
(function () {
  'use strict';

  const CONFIG = window.AMIGO_CONFIG || {};
  const LS_DATOS = 'amigoInvisible.datos.v1';
  const LS_CLAVE = 'amigoInvisible.clave.v1';
  const EMAIL_RE = /^[^\s@,;<>()]+@[^\s@,;<>()]+\.[^\s@,;<>()]{2,}$/;
  const COLORES_AVATAR = ['#c8283c', '#1f6b4e', '#d29a2f', '#2f6fb3', '#8e3fa8', '#d2603a', '#13806f'];
  const COLORES_LUCES = ['#ff4d5e', '#f0c05a', '#4fd38a', '#5fb6ff', '#ff9f43'];
  const MENSAJES_ESPERA = [
    'Los elfos están barajando los nombres…',
    'Papá Noel revisa la lista (dos veces)…',
    'Envolviendo cada correo con cariño…',
    'Los renos ya van de camino…',
    'Casi listo, ¡que no se escape nadie!…',
  ];

  const $ = (selector, raiz) => (raiz || document).querySelector(selector);
  const $$ = (selector, raiz) => Array.from((raiz || document).querySelectorAll(selector));
  const animacionReducida = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ───────────────────────── Datos ─────────────────────────

  function leerLocal(clave) {
    try { return window.localStorage.getItem(clave); } catch (e) { return null; }
  }

  function escribirLocal(clave, valor) {
    try {
      if (valor == null) window.localStorage.removeItem(clave);
      else window.localStorage.setItem(clave, valor);
    } catch (e) { /* almacenamiento no disponible: la app sigue funcionando en memoria */ }
  }

  function nuevoId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function datosIniciales() {
    return {
      participantes: [],
      exclusiones: [],
      ajustes: {
        titulo: 'Navidad ' + new Date().getFullYear(),
        presupuesto: '',
        fecha: '',
        mensaje: '',
        evitarReciprocos: false,
      },
    };
  }

  function normalizarDatos(bruto) {
    const base = datosIniciales();
    if (!bruto || typeof bruto !== 'object') return base;

    const participantes = (Array.isArray(bruto.participantes) ? bruto.participantes : [])
      .filter(p => p && String(p.nombre || '').trim())
      .map(p => ({ id: String(p.id || nuevoId()), nombre: String(p.nombre).trim(), email: String(p.email || '').trim() }));
    const ids = new Set(participantes.map(p => p.id));
    const exclusiones = (Array.isArray(bruto.exclusiones) ? bruto.exclusiones : [])
      .filter(x => Array.isArray(x) && x.length === 2 && x[0] !== x[1] && ids.has(String(x[0])) && ids.has(String(x[1])))
      .map(x => [String(x[0]), String(x[1])]);

    const a = bruto.ajustes || {};
    const texto = (v, porDefecto) => (typeof v === 'string' ? v : porDefecto);
    const ajustes = {
      titulo: texto(a.titulo, base.ajustes.titulo),
      presupuesto: texto(a.presupuesto, ''),
      fecha: texto(a.fecha, ''),
      mensaje: texto(a.mensaje, ''),
      evitarReciprocos: a.evitarReciprocos === true,
    };
    return { participantes, exclusiones, ajustes };
  }

  function cargarDatosLocales() {
    try { return normalizarDatos(JSON.parse(leerLocal(LS_DATOS) || 'null')); } catch (e) { return datosIniciales(); }
  }

  let datos = cargarDatosLocales();
  let clave = leerLocal(LS_CLAVE) || '';
  let infoServidor = null;
  let sorteando = false;

  function guardar() {
    escribirLocal(LS_DATOS, JSON.stringify(datos));
  }

  const participantePorId = id => datos.participantes.find(p => p.id === id);
  const nombres = () => datos.participantes.map(p => p.nombre);
  const exclusionesPorNombre = () => datos.exclusiones
    .map(([a, b]) => [participantePorId(a), participantePorId(b)])
    .filter(([a, b]) => a && b)
    .map(([a, b]) => [a.nombre, b.nombre]);

  // ───────────────────────── Utilidades de interfaz ─────────────────────────

  function el(etiqueta, props) {
    const nodo = document.createElement(etiqueta);
    Object.entries(props || {}).forEach(([k, v]) => {
      if (v == null || v === false) return;
      if (k === 'class') nodo.className = v;
      else if (k === 'text') nodo.textContent = v;
      else if (k === 'style') nodo.style.cssText = v;
      else if (k.startsWith('on')) nodo.addEventListener(k.slice(2), v);
      else nodo.setAttribute(k, v === true ? '' : v);
    });
    for (let i = 2; i < arguments.length; i++) {
      [].concat(arguments[i]).forEach(hijo => { if (hijo != null && hijo !== false) nodo.append(hijo); });
    }
    return nodo;
  }

  let temporizadorAviso = null;
  function avisar(texto, tipo) {
    const toast = $('#toast');
    toast.textContent = texto;
    toast.className = 'toast visible ' + (tipo || '');
    clearTimeout(temporizadorAviso);
    temporizadorAviso = setTimeout(() => { toast.className = 'toast ' + (tipo || ''); }, tipo === 'error' ? 5000 : 3200);
  }

  function confirmar(opciones) {
    const dialogo = $('#dlg-confirmar');
    $('#confirmar-titulo').textContent = opciones.titulo;
    $('#confirmar-texto').textContent = opciones.texto;
    const ok = $('#confirmar-ok');
    ok.textContent = opciones.ok || 'Aceptar';
    ok.className = 'boton ' + (opciones.peligro ? 'boton-rojo' : 'boton-verde');
    $('#confirmar-cancelar').textContent = opciones.cancelar || 'Cancelar';
    dialogo.returnValue = '';
    return new Promise(resolve => {
      dialogo.addEventListener('close', () => resolve(dialogo.returnValue === 'ok'), { once: true });
      dialogo.showModal();
      $('#confirmar-cancelar').focus();
    });
  }

  async function conBoton(boton, tarea) {
    if (boton.disabled) return undefined;
    boton.disabled = true;
    boton.classList.add('cargando');
    try {
      return await tarea();
    } finally {
      boton.disabled = false;
      boton.classList.remove('cargando');
    }
  }

  function formatearFecha(iso) {
    const fecha = new Date(iso);
    if (isNaN(fecha)) return 'un día anterior';
    return fecha.toLocaleString('es-ES', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
  }

  function inicial(nombre) {
    return (Array.from(nombre.trim())[0] || '?').toUpperCase();
  }

  // ───────────────────────── Navegación ─────────────────────────

  const VISTAS = ['participantes', 'exclusiones', 'ajustes', 'sorteo'];

  function mostrarVista(nombre, desplazar) {
    if (!VISTAS.includes(nombre)) nombre = 'participantes';
    $$('.vista').forEach(v => v.classList.toggle('activa', v.id === 'vista-' + nombre));
    $$('.pestanas button').forEach(b => {
      const activa = b.dataset.vista === nombre;
      b.classList.toggle('activa', activa);
      if (activa) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    if (desplazar !== false) window.scrollTo({ top: 0, behavior: animacionReducida() ? 'auto' : 'smooth' });
    if (nombre === 'sorteo') {
      renderSorteo();
      if (clave && CONFIG.urlBackend && !infoServidor) consultarEstado(true);
    }
    if (history.replaceState) history.replaceState(null, '', '#' + nombre);
  }

  $$('.pestanas button').forEach(b => b.addEventListener('click', () => mostrarVista(b.dataset.vista)));

  // Cerrar diálogos con los botones marcados con data-cerrar
  $$('[data-cerrar]').forEach(b => b.addEventListener('click', () => b.closest('dialog').close()));

  // ───────────────────────── Participantes ─────────────────────────

  function limpiarNombre(nombre) {
    return String(nombre || '').trim().replace(/\s+/g, ' ');
  }

  function errorPersona(nombre, email, exceptoId) {
    if (!nombre) return 'Escribe un nombre.';
    if (nombre.length > 40) return 'El nombre es demasiado largo (máximo 40 letras).';
    if (!EMAIL_RE.test(email)) return `El correo de ${nombre} no parece válido.`;
    const repetido = datos.participantes.some(p => p.id !== exceptoId && p.nombre.toLowerCase() === nombre.toLowerCase());
    if (repetido) return `Ya hay alguien llamado ${nombre}. Usa un nombre distinto (p. ej. con la inicial del apellido).`;
    return null;
  }

  $('#form-participante').addEventListener('submit', ev => {
    ev.preventDefault();
    const form = ev.currentTarget;
    const nombre = limpiarNombre(form.nombre.value);
    const email = form.email.value.trim();
    const error = errorPersona(nombre, email);
    if (error) {
      avisar(error, 'error');
      (nombre && !error.startsWith('Ya hay') ? form.email : form.nombre).focus();
      return;
    }
    datos.participantes.push({ id: nuevoId(), nombre, email });
    guardar();
    renderTodo();
    form.reset();
    form.nombre.focus();
    avisar(`🎄 ${nombre} se une al sorteo`, 'exito');
  });

  // Intro en el campo nombre → saltar al correo
  $('#form-participante').nombre.addEventListener('keydown', ev => {
    if (ev.key === 'Enter') { ev.preventDefault(); $('#form-participante').email.focus(); }
  });

  async function quitarParticipante(id) {
    const p = participantePorId(id);
    if (!p) return;
    const ok = await confirmar({ titulo: '¿Quitar participante?', texto: `${p.nombre} saldrá del sorteo.`, ok: 'Quitar', peligro: true });
    if (!ok) return;
    datos.participantes = datos.participantes.filter(x => x.id !== id);
    datos.exclusiones = datos.exclusiones.filter(([a, b]) => a !== id && b !== id);
    guardar();
    renderTodo();
  }

  let editandoId = null;
  function abrirEdicion(id) {
    const p = participantePorId(id);
    if (!p) return;
    editandoId = id;
    $('#editar-nombre').value = p.nombre;
    $('#editar-email').value = p.email;
    $('#editar-error').textContent = '';
    $('#dlg-editar').showModal();
  }

  $('#form-editar').addEventListener('submit', ev => {
    ev.preventDefault();
    const p = participantePorId(editandoId);
    if (!p) return $('#dlg-editar').close();
    const nombre = limpiarNombre($('#editar-nombre').value);
    const email = $('#editar-email').value.trim();
    const error = errorPersona(nombre, email, editandoId);
    if (error) { $('#editar-error').textContent = error; return; }
    p.nombre = nombre;
    p.email = email;
    guardar();
    renderTodo();
    $('#dlg-editar').close();
    avisar('✏️ Cambios guardados', 'exito');
  });

  // Pegar lista
  $('#btn-pegar').addEventListener('click', () => {
    $('#pegar-texto').value = '';
    $('#pegar-error').textContent = '';
    $('#dlg-pegar').showModal();
  });

  function parsearLista(texto) {
    const correctas = [];
    const ignoradas = [];
    texto.split(/\r?\n/).forEach(linea => {
      const limpia = linea.trim();
      if (!limpia) return;
      const encontrado = limpia.match(/[^\s,;<>()"'|]+@[^\s,;<>()"'|]+/);
      if (!encontrado) { ignoradas.push(limpia); return; }
      const email = encontrado[0];
      const nombre = limpiarNombre(limpia.replace(email, ' ').replace(/[\t,;<>()"'|:]+/g, ' '));
      if (!nombre) { ignoradas.push(limpia); return; }
      correctas.push({ nombre, email });
    });
    return { correctas, ignoradas };
  }

  $('#form-pegar').addEventListener('submit', ev => {
    ev.preventDefault();
    const { correctas, ignoradas } = parsearLista($('#pegar-texto').value);
    const problemas = [];
    let anadidos = 0;
    correctas.forEach(({ nombre, email }) => {
      const error = errorPersona(nombre, email);
      if (error) { problemas.push(error); return; }
      datos.participantes.push({ id: nuevoId(), nombre, email });
      anadidos++;
    });
    if (!anadidos) {
      $('#pegar-error').textContent = problemas.length
        ? problemas.slice(0, 4).join('\n')
        : 'No he encontrado ninguna línea con nombre y correo.';
      return;
    }
    guardar();
    renderTodo();
    $('#dlg-pegar').close();
    const saltados = problemas.length + ignoradas.length;
    avisar(`🎁 ${anadidos} añadido${anadidos === 1 ? '' : 's'}` + (saltados ? ` · ${saltados} línea${saltados === 1 ? '' : 's'} sin añadir` : ''), 'exito');
  });

  function renderParticipantes() {
    const lista = $('#lista-participantes');
    lista.replaceChildren(...datos.participantes.map((p, i) => el('li', { class: 'item' },
      el('span', { class: 'avatar', style: `--c:${COLORES_AVATAR[i % COLORES_AVATAR.length]}`, 'aria-hidden': 'true', text: inicial(p.nombre) }),
      el('div', { class: 'item-texto' },
        el('div', { class: 'item-nombre', text: p.nombre }),
        el('div', { class: 'item-email', text: p.email })),
      el('button', { class: 'icono-boton', type: 'button', 'aria-label': `Editar a ${p.nombre}`, text: '✏️', onclick: () => abrirEdicion(p.id) }),
      el('button', { class: 'icono-boton', type: 'button', 'aria-label': `Quitar a ${p.nombre}`, text: '🗑️', onclick: () => quitarParticipante(p.id) })
    )));
    const n = datos.participantes.length;
    $('#contador').textContent = n;
    $('#vacio-participantes').hidden = n > 0;
    const insignia = $('#insignia-participantes');
    insignia.textContent = n;
    insignia.hidden = n === 0;
  }

  // ───────────────────────── Exclusiones ─────────────────────────

  function rellenarSelect(select, texto) {
    const anterior = select.value;
    select.replaceChildren(
      el('option', { value: '', text: texto }),
      ...datos.participantes.map(p => el('option', { value: p.id, text: p.nombre }))
    );
    if (participantePorId(anterior)) select.value = anterior;
  }

  $('#form-exclusion').addEventListener('submit', ev => {
    ev.preventDefault();
    const a = $('#ex-a').value;
    const b = $('#ex-b').value;
    if (!a || !b) return avisar('Elige a las dos personas.', 'error');
    if (a === b) return avisar('Elige a dos personas distintas.', 'error');
    const existe = datos.exclusiones.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
    if (existe) return avisar('Esa exclusión ya está en la lista.', 'error');
    datos.exclusiones.push([a, b]);
    guardar();
    renderTodo();
    $('#ex-a').value = '';
    $('#ex-b').value = '';
    avisar(`🚫 ${participantePorId(a).nombre} y ${participantePorId(b).nombre} no se tocarán`, 'exito');
  });

  function quitarExclusion(indice) {
    datos.exclusiones.splice(indice, 1);
    guardar();
    renderTodo();
  }

  $('#aj-reciprocos').addEventListener('change', ev => {
    datos.ajustes.evitarReciprocos = ev.target.checked;
    guardar();
    renderTodo();
  });

  function comprobarViabilidad() {
    if (datos.participantes.length < 2) return { posible: false, motivo: 'Añade al menos 2 participantes.' };
    return window.Sorteo.comprobar(nombres(), exclusionesPorNombre(), { evitarReciprocos: datos.ajustes.evitarReciprocos });
  }

  function renderExclusiones() {
    rellenarSelect($('#ex-a'), 'Persona…');
    rellenarSelect($('#ex-b'), 'Persona…');
    $('#lista-exclusiones').replaceChildren(...datos.exclusiones.map(([a, b], i) => {
      const pa = participantePorId(a);
      const pb = participantePorId(b);
      return el('li', { class: 'item item-exclusion' },
        el('div', { class: 'pareja' },
          el('span', { class: 'chip', text: pa.nombre }),
          el('span', { class: 'x', 'aria-label': 'no se tocan con', text: '✕' }),
          el('span', { class: 'chip', text: pb.nombre })),
        el('button', { class: 'icono-boton', type: 'button', 'aria-label': `Quitar la exclusión entre ${pa.nombre} y ${pb.nombre}`, text: '🗑️', onclick: () => quitarExclusion(i) }));
    }));
    $('#aj-reciprocos').checked = datos.ajustes.evitarReciprocos;

    const caja = $('#viabilidad');
    if (!datos.participantes.length) { caja.textContent = ''; caja.className = 'viabilidad'; return; }
    const v = comprobarViabilidad();
    caja.className = 'viabilidad ' + (v.posible ? 'ok' : 'mal');
    caja.textContent = v.posible ? '✅ Con estas reglas el sorteo es posible.' : '⚠️ ' + v.motivo;
  }

  // ───────────────────────── Ajustes ─────────────────────────

  [['#aj-titulo', 'titulo'], ['#aj-presupuesto', 'presupuesto'], ['#aj-fecha', 'fecha'], ['#aj-mensaje', 'mensaje']].forEach(([selector, campo]) => {
    $(selector).addEventListener('input', ev => {
      datos.ajustes[campo] = ev.target.value;
      guardar();
      renderCabecera();
    });
  });

  $('#aj-clave').addEventListener('input', ev => {
    clave = ev.target.value;
    infoServidor = null;
    if ($('#aj-recordar').checked) escribirLocal(LS_CLAVE, clave || null);
    $('#estado-servidor').textContent = '';
  });

  $('#aj-recordar').addEventListener('change', ev => {
    escribirLocal(LS_CLAVE, ev.target.checked && clave ? clave : null);
  });

  $('#btn-ver-clave').addEventListener('click', ev => {
    const input = $('#aj-clave');
    const mostrar = input.type === 'password';
    input.type = mostrar ? 'text' : 'password';
    ev.currentTarget.setAttribute('aria-pressed', String(mostrar));
    ev.currentTarget.setAttribute('aria-label', mostrar ? 'Ocultar la clave' : 'Mostrar la clave');
    ev.currentTarget.textContent = mostrar ? '🙈' : '👁️';
  });

  function renderAjustes() {
    const a = datos.ajustes;
    const asignar = (selector, valor) => { if (document.activeElement !== $(selector)) $(selector).value = valor; };
    asignar('#aj-titulo', a.titulo);
    asignar('#aj-presupuesto', a.presupuesto);
    asignar('#aj-fecha', a.fecha);
    asignar('#aj-mensaje', a.mensaje);
    asignar('#aj-clave', clave);
    $('#aj-recordar').checked = Boolean(leerLocal(LS_CLAVE));
  }

  function renderCabecera() {
    $('#subtitulo').textContent = datos.ajustes.titulo.trim() || 'Navidad ' + new Date().getFullYear();
  }

  function renderEstadoServidor(error) {
    const caja = $('#estado-servidor');
    if (error) {
      caja.className = 'estado-servidor mal';
      caja.textContent = '❌ ' + error;
      return;
    }
    if (!infoServidor) { caja.textContent = ''; return; }
    const s = infoServidor;
    caja.className = 'estado-servidor';
    caja.replaceChildren(el('ul', null,
      el('li', { text: '✅ Conectado con el servidor' }),
      el('li', { text: `✉️ Correos disponibles hoy: ${s.cuota}` }),
      el('li', { text: `🧪 Las pruebas llegan a: ${s.emailPrueba}` }),
      el('li', { text: s.ultimoSorteo ? `🎁 Último sorteo real: ${formatearFecha(s.ultimoSorteo.fecha)} (${s.ultimoSorteo.participantes.length} personas)` : '🎁 Aún no se ha hecho ningún sorteo real' })
    ));
  }

  // ───────────────────────── Servidor ─────────────────────────

  function errorConCodigo(mensaje, codigo, detalle) {
    const error = new Error(mensaje);
    error.codigo = codigo;
    error.detalle = detalle;
    return error;
  }

  async function llamar(accion, extra) {
    if (!CONFIG.urlBackend) {
      throw errorConCodigo('Falta configurar la dirección del servidor en js/config.js (mira el README).', 'SIN_URL');
    }
    if (!clave) {
      throw errorConCodigo('Escribe la clave del organizador en Ajustes → Conexión.', 'SIN_CLAVE_LOCAL');
    }
    let respuesta;
    try {
      respuesta = await fetch(CONFIG.urlBackend, {
        method: 'POST',
        // text/plain evita la petición previa CORS, que Apps Script no admite
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(Object.assign({ accion, clave }, extra || {})),
        redirect: 'follow',
      });
    } catch (e) {
      throw errorConCodigo('No se pudo conectar con el servidor. Revisa tu conexión y que el script esté desplegado con acceso para «Cualquier usuario».', 'RED');
    }
    let json;
    try { json = await respuesta.json(); } catch (e) {
      throw errorConCodigo('El servidor respondió algo inesperado. ¿La URL de js/config.js termina en /exec?', 'RESPUESTA');
    }
    if (!json.ok) throw errorConCodigo(json.error || 'Error desconocido en el servidor.', json.codigo, json.detalle);
    return json;
  }

  function irAClave(mensaje) {
    avisar(mensaje, 'error');
    mostrarVista('ajustes');
    setTimeout(() => $('#aj-clave').focus(), 300);
  }

  async function consultarEstado(silencioso) {
    try {
      infoServidor = await llamar('estado');
      renderEstadoServidor();
      renderSorteo();
      if (!silencioso) avisar('✅ Todo listo: el servidor responde', 'exito');
    } catch (e) {
      infoServidor = null;
      renderEstadoServidor(e.message);
      if (!silencioso) avisar(e.message, 'error');
    }
  }

  $('#btn-probar').addEventListener('click', ev => conBoton(ev.currentTarget, () => consultarEstado(false)));

  $('#btn-vista-previa').addEventListener('click', ev => conBoton(ev.currentTarget, async () => {
    try {
      const r = await llamar('vistaPrevia', { ajustes: datos.ajustes });
      $('#previa-asunto').textContent = 'Asunto: ' + r.asunto;
      $('#previa-iframe').srcdoc = r.html;
      $('#dlg-previa').showModal();
    } catch (e) {
      if (e.codigo === 'SIN_CLAVE_LOCAL') return irAClave(e.message);
      avisar(e.message, 'error');
    }
  }));

  $('#btn-guardar-nube').addEventListener('click', ev => {
    const boton = ev.currentTarget;
    if (!datos.participantes.length) return avisar('La lista está vacía: no hay nada que subir.', 'error');
    return conBoton(boton, async () => {
      const ok = await confirmar({ titulo: 'Subir lista', texto: `Se guardará la lista de este dispositivo (${datos.participantes.length} personas) en tu cuenta de Google y sustituirá a la que hubiera.`, ok: 'Subir' });
      if (!ok) return;
      try {
        await llamar('guardar', { datos });
        avisar('☁️ Lista guardada en la nube', 'exito');
      } catch (e) {
        if (e.codigo === 'SIN_CLAVE_LOCAL') return irAClave(e.message);
        avisar(e.message, 'error');
      }
    });
  });

  $('#btn-cargar-nube').addEventListener('click', ev => conBoton(ev.currentTarget, async () => {
    try {
      const r = await llamar('cargar');
      if (!r.datos) return avisar('Todavía no hay ninguna lista guardada en la nube.', 'error');
      const nueva = normalizarDatos(r.datos);
      if (datos.participantes.length) {
        const ok = await confirmar({ titulo: 'Descargar lista', texto: `Se sustituirá la lista de este dispositivo (${datos.participantes.length} personas) por la de la nube (${nueva.participantes.length} personas).`, ok: 'Sustituir' });
        if (!ok) return;
      }
      datos = nueva;
      guardar();
      renderTodo();
      avisar(`☁️ Lista descargada: ${datos.participantes.length} personas`, 'exito');
    } catch (e) {
      if (e.codigo === 'SIN_CLAVE_LOCAL') return irAClave(e.message);
      avisar(e.message, 'error');
    }
  }));

  $('#btn-borrar-todo').addEventListener('click', async () => {
    const ok = await confirmar({ titulo: '¿Borrar todo?', texto: 'Se borrarán de este dispositivo la lista, las exclusiones, los ajustes y la clave guardada. Lo que haya en la nube no se toca.', ok: 'Borrar todo', peligro: true });
    if (!ok) return;
    datos = datosIniciales();
    clave = '';
    infoServidor = null;
    escribirLocal(LS_DATOS, null);
    escribirLocal(LS_CLAVE, null);
    $('#resultado').hidden = true;
    renderEstadoServidor();
    renderTodo();
    avisar('🧹 Datos borrados de este dispositivo', 'exito');
  });

  // ───────────────────────── Sorteo ─────────────────────────

  const modoActual = () => ($('input[name=modo]:checked') || {}).value || 'prueba';

  $$('input[name=modo]').forEach(r => r.addEventListener('change', renderSorteo));

  function renderSorteo() {
    const a = datos.ajustes;
    const v = comprobarViabilidad();
    const n = datos.participantes.length;
    const chips = [
      el('li', { class: n < 2 ? 'mal' : null, text: `👥 ${n} participante${n === 1 ? '' : 's'}` }),
      el('li', { text: `🚫 ${datos.exclusiones.length} exclusi${datos.exclusiones.length === 1 ? 'ón' : 'ones'}` }),
    ];
    if (a.presupuesto.trim()) chips.push(el('li', { text: '💶 ' + a.presupuesto.trim() }));
    if (a.fecha.trim()) chips.push(el('li', { text: '📅 ' + a.fecha.trim() }));
    if (n >= 2 && !v.posible) chips.push(el('li', { class: 'mal', text: '⚠️ ' + v.motivo }));
    $('#resumen').replaceChildren(...chips);

    const destino = infoServidor ? infoServidor.emailPrueba : 'la cuenta de Google del script';
    $('#nota-modo').textContent = modoActual() === 'prueba'
      ? `Todos los correos llegarán a ${destino}, cada uno indicando a quién iba dirigido. Sirve para comprobar que todo funciona (verás los resultados de esa prueba).`
      : 'Cada participante recibirá su propio correo. Nadie, ni siquiera tú, verá quién le ha tocado a quién.';

    const boton = $('#btn-sortear');
    if (!sorteando) {
      boton.disabled = !v.posible;
      $('#texto-regalo').textContent = v.posible ? 'Toca el regalo para hacer el sorteo' : (n < 2 ? 'Añade al menos 2 participantes para sortear' : 'Revisa las exclusiones para poder sortear');
    }

    const ultimo = infoServidor && infoServidor.ultimoSorteo;
    $('#tarjeta-reenviar').hidden = !ultimo;
    if (ultimo) {
      const select = $('#reenviar-nombre');
      const anterior = select.value;
      select.replaceChildren(...ultimo.participantes.map(nombre => el('option', { value: nombre, text: nombre })));
      if (ultimo.participantes.includes(anterior)) select.value = anterior;
    }
  }

  function estadoRegalo(estado) {
    const boton = $('#btn-sortear');
    boton.classList.remove('cargando', 'abierto');
    if (estado) boton.classList.add(estado);
  }

  let temporizadorEspera = null;
  function empezarEspera() {
    let i = 0;
    const texto = $('#texto-regalo');
    texto.textContent = MENSAJES_ESPERA[0];
    temporizadorEspera = setInterval(() => {
      i = (i + 1) % MENSAJES_ESPERA.length;
      texto.textContent = MENSAJES_ESPERA[i];
    }, 2300);
  }
  function terminarEspera() {
    clearInterval(temporizadorEspera);
    temporizadorEspera = null;
  }

  async function sortear(repetir) {
    if (sorteando) return;
    const v = comprobarViabilidad();
    if (!v.posible) return avisar(v.motivo, 'error');
    if (!CONFIG.urlBackend) return avisar('Falta configurar la dirección del servidor en js/config.js (mira el README).', 'error');
    if (!clave) return irAClave('Antes de sortear, escribe la clave del organizador.');

    const prueba = modoActual() !== 'real';
    const n = datos.participantes.length;
    if (!repetir) {
      const destino = infoServidor ? infoServidor.emailPrueba : 'la cuenta de Google del script';
      const ok = await confirmar(prueba
        ? { titulo: '🧪 Sorteo de prueba', texto: `Se enviarán ${n} correos, TODOS a ${destino}.\nNingún participante recibirá nada.`, ok: 'Hacer la prueba' }
        : { titulo: '🎅 ¡Sorteo de verdad!', texto: `Se enviará un correo a cada uno de los ${n} participantes con su amigo invisible.\n\n¿Están bien todos los nombres y correos?`, ok: '¡Sí, sortear!', peligro: true });
      if (!ok) return;
    }

    sorteando = true;
    $('#resultado').hidden = true;
    const boton = $('#btn-sortear');
    boton.disabled = true;
    estadoRegalo('cargando');
    empezarEspera();

    let yaSorteado = null;
    try {
      const r = await llamar('sortear', {
        participantes: datos.participantes.map(p => ({ nombre: p.nombre, email: p.email })),
        exclusiones: exclusionesPorNombre(),
        ajustes: datos.ajustes,
        prueba,
        repetir: repetir === true,
      });
      terminarEspera();
      estadoRegalo('abierto');
      lanzarConfeti();
      mostrarResultado(r);
      setTimeout(() => estadoRegalo(''), 2600);
    } catch (e) {
      terminarEspera();
      estadoRegalo('');
      if (e.codigo === 'YA_SORTEADO') yaSorteado = e;
      else if (e.codigo === 'CLAVE' || e.codigo === 'SIN_CLAVE_LOCAL') irAClave(e.message);
      else avisar(e.message, 'error');
    } finally {
      sorteando = false;
      renderSorteo();
    }

    if (!prueba) consultarEstado(true);

    if (yaSorteado) {
      const fecha = formatearFecha(yaSorteado.detalle && yaSorteado.detalle.fecha);
      const ok = await confirmar({
        titulo: 'Ya hay un sorteo real',
        texto: `El ${fecha} ya se hizo un sorteo y se enviaron los correos.\n\nSi lo repites, todos recibirán un correo NUEVO con otro amigo invisible y el anterior dejará de valer.\n\nSi solo a alguien no le llegó, usa «Reenviar un correo».`,
        ok: 'Repetir el sorteo',
        peligro: true,
      });
      if (ok) await sortear(true);
    }
  }

  $('#btn-sortear').addEventListener('click', () => sortear(false));

  function mostrarResultado(r) {
    const tarjeta = $('#resultado');
    const fallidos = r.fallidos || [];
    const titulo = r.prueba ? '¡Prueba completada!' : '¡Sorteo hecho!';
    const texto = r.prueba
      ? `Mira la bandeja de ${r.destinoPrueba}: tienes ${r.enviados.length} correos de prueba. Cuando todo esté bien, cambia a «De verdad».`
      : `${r.enviados.length} personas ya tienen su amigo invisible en el correo. ¡Que empiece la caza de regalos!`;
    tarjeta.replaceChildren(...[
      el('div', { class: 'resultado-emoji', 'aria-hidden': 'true', text: r.prueba ? '🧪' : '🎉' }),
      el('h2', { text: titulo }),
      el('p', { class: 'nota', text: texto }),
      el('ul', { class: 'lista-enviados' },
        r.enviados.map(nombre => el('li', { text: '✅ ' + nombre })),
        fallidos.map(f => el('li', { class: 'fallo', title: f.error, text: '❌ ' + f.nombre }))),
      fallidos.length ? el('p', { class: 'nota', text: r.prueba
        ? 'Algunos correos de prueba fallaron: ' + fallidos.map(f => `${f.nombre} (${f.error})`).join(', ')
        : 'A los marcados con ❌ no les llegó: usa «Reenviar un correo» (puedes corregir su dirección).' }) : null,
      el('div', { class: 'botones' },
        el('button', { class: 'boton boton-suave', type: 'button', text: 'Cerrar', onclick: () => { tarjeta.hidden = true; } })),
    ].filter(Boolean));
    tarjeta.hidden = false;
    tarjeta.focus({ preventScroll: true });
    tarjeta.scrollIntoView({ behavior: animacionReducida() ? 'auto' : 'smooth', block: 'center' });
  }

  $('#btn-reenviar').addEventListener('click', ev => {
    const nombre = $('#reenviar-nombre').value;
    const email = $('#reenviar-email').value.trim();
    if (!nombre) return undefined;
    if (email && !EMAIL_RE.test(email)) return avisar('Ese correo no parece válido.', 'error');
    return conBoton(ev.currentTarget, async () => {
      const ok = await confirmar({ titulo: '📮 Reenviar', texto: `Se reenviará a ${nombre}${email ? ' (a ' + email + ')' : ''} el mismo amigo invisible que le tocó.`, ok: 'Reenviar' });
      if (!ok) return;
      try {
        const r = await llamar('reenviar', email ? { nombre, email } : { nombre });
        if (email) {
          const local = datos.participantes.find(p => p.nombre.toLowerCase() === nombre.toLowerCase());
          if (local) { local.email = email; guardar(); renderParticipantes(); }
        }
        $('#reenviar-email').value = '';
        avisar(`📮 Reenviado a ${r.reenviado}`, 'exito');
      } catch (e) {
        if (e.codigo === 'CLAVE' || e.codigo === 'SIN_CLAVE_LOCAL') return irAClave(e.message);
        avisar(e.message, 'error');
      }
    });
  });

  // ───────────────────────── Efectos navideños ─────────────────────────

  function colgarLuces() {
    const cantidad = Math.ceil(window.innerWidth / 52) + 1;
    $('.luces').replaceChildren(...Array.from({ length: cantidad }, (_, i) => el('li', {
      style: `--c:${COLORES_LUCES[i % COLORES_LUCES.length]};--d:${((i * 0.37) % 2.2).toFixed(2)}s`,
    })));
  }

  function iniciarNieve() {
    const lienzo = $('#nieve');
    const ctx = lienzo.getContext && lienzo.getContext('2d');
    if (!ctx || animacionReducida()) return;
    let ancho = 0;
    let alto = 0;
    const copos = [];

    function nuevoCopo(enCualquierAltura) {
      const r = Math.random() * 2.3 + 0.7;
      return {
        x: Math.random() * ancho,
        y: enCualquierAltura ? Math.random() * alto : -6,
        r,
        vy: r * 0.32 + Math.random() * 0.35,
        fase: Math.random() * Math.PI * 2,
        deriva: Math.random() * 0.6 + 0.2,
        alfa: Math.random() * 0.45 + 0.35,
      };
    }

    function ajustar() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      ancho = window.innerWidth;
      alto = window.innerHeight;
      lienzo.width = Math.round(ancho * dpr);
      lienzo.height = Math.round(alto * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const objetivo = Math.round(Math.min(150, (ancho * alto) / 7500));
      while (copos.length < objetivo) copos.push(nuevoCopo(true));
      copos.length = objetivo;
    }

    let anterior = performance.now();
    function cuadro(ahora) {
      const dt = Math.min((ahora - anterior) / 16.67, 3);
      anterior = ahora;
      ctx.clearRect(0, 0, ancho, alto);
      ctx.fillStyle = '#ffffff';
      for (let i = 0; i < copos.length; i++) {
        const c = copos[i];
        c.fase += 0.012 * dt;
        c.y += c.vy * dt;
        c.x += Math.sin(c.fase) * c.deriva * 0.5 * dt;
        if (c.y > alto + 6) { copos[i] = nuevoCopo(false); continue; }
        if (c.x > ancho + 6) c.x = -6; else if (c.x < -6) c.x = ancho + 6;
        ctx.globalAlpha = c.alfa;
        ctx.beginPath();
        ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      window.requestAnimationFrame(cuadro);
    }

    ajustar();
    window.addEventListener('resize', ajustar);
    window.requestAnimationFrame(cuadro);
  }

  function lanzarConfeti() {
    const lienzo = $('#confeti');
    const ctx = lienzo.getContext && lienzo.getContext('2d');
    if (!ctx || animacionReducida()) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const ancho = window.innerWidth;
    const alto = window.innerHeight;
    lienzo.width = Math.round(ancho * dpr);
    lienzo.height = Math.round(alto * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const caja = $('#btn-sortear').getBoundingClientRect();
    const ox = caja.left + caja.width / 2;
    const oy = caja.top + caja.height * 0.35;
    const colores = ['#f0c05a', '#c8283c', '#2fa36b', '#ffffff', '#e2475a', '#5fb6ff'];
    const piezas = Array.from({ length: 170 }, () => {
      const angulo = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.25;
      const velocidad = 6 + Math.random() * 10;
      return {
        x: ox, y: oy,
        vx: Math.cos(angulo) * velocidad,
        vy: Math.sin(angulo) * velocidad,
        w: 6 + Math.random() * 6,
        h: 4 + Math.random() * 6,
        giro: Math.random() * Math.PI,
        vgiro: (Math.random() - 0.5) * 0.35,
        color: colores[Math.floor(Math.random() * colores.length)],
      };
    });

    const inicio = performance.now();
    const duracion = 3600;
    function cuadro(ahora) {
      const t = ahora - inicio;
      ctx.clearRect(0, 0, ancho, alto);
      ctx.globalAlpha = Math.max(0, 1 - Math.max(0, t - duracion * 0.6) / (duracion * 0.4));
      piezas.forEach(p => {
        p.vy += 0.24;
        p.vx *= 0.985;
        p.vy *= 0.985;
        p.x += p.vx;
        p.y += p.vy;
        p.giro += p.vgiro;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.giro);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.giro * 1.7)) + 1);
        ctx.restore();
      });
      if (t < duracion) window.requestAnimationFrame(cuadro);
      else ctx.clearRect(0, 0, ancho, alto);
    }
    window.requestAnimationFrame(cuadro);
  }

  // Instalación como app (Android / escritorio)
  let eventoInstalar = null;
  window.addEventListener('beforeinstallprompt', ev => {
    ev.preventDefault();
    eventoInstalar = ev;
    $('#btn-instalar').hidden = false;
  });
  $('#btn-instalar').addEventListener('click', async () => {
    if (!eventoInstalar) return;
    eventoInstalar.prompt();
    await eventoInstalar.userChoice;
    eventoInstalar = null;
    $('#btn-instalar').hidden = true;
  });

  // ───────────────────────── Arranque ─────────────────────────

  function renderTodo() {
    renderCabecera();
    renderParticipantes();
    renderExclusiones();
    renderAjustes();
    renderSorteo();
  }

  renderTodo();
  colgarLuces();
  let temporizadorLuces = null;
  window.addEventListener('resize', () => {
    clearTimeout(temporizadorLuces);
    temporizadorLuces = setTimeout(colgarLuces, 200);
  });
  iniciarNieve();
  mostrarVista(location.hash.slice(1) || 'participantes', false);
  window.addEventListener('hashchange', () => mostrarVista(location.hash.slice(1)));
})();
