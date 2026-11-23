/* ───────────────────────── Amigo invisible · app web ───────────────────────── */
(function () {
  'use strict';

  const CONFIG = window.AMIGO_CONFIG || {};
  const LS_DATOS = 'amigoInvisible.datos.v1';
  const LS_CLAVE = 'amigoInvisible.clave.v1';
  const EMAIL_RE = /^[^\s@,;<>()]+@[^\s@,;<>()]+\.[^\s@,;<>()]{2,}$/;
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const VISTAS = ['participantes', 'sorteo', 'ajustes'];
  const SIN_URL = 'Falta la dirección del servidor en js/config.js.';

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
    } catch (e) { /* sin almacenamiento: la app sigue funcionando en memoria */ }
  }

  function nuevoId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  // ── Fechas: se guardan como 'AAAA-MM-DD' y se muestran en castellano ──

  function fechaDesdeIso(iso) {
    const partes = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    if (!partes) return null;
    const fecha = new Date(Number(partes[1]), Number(partes[2]) - 1, Number(partes[3]));
    return isNaN(fecha) ? null : fecha;
  }

  /** La próxima Nochebuena (la de este año o, si ya ha pasado, la del siguiente). */
  function fechaPorDefecto() {
    return aIso(proximaFecha(11, 24));
  }

  /** «Navidad 2026»: el año sale de la fecha elegida (Reyes cuenta como la Navidad del año anterior). */
  function tituloAutomatico() {
    const fecha = fechaDesdeIso(datos.ajustes.fecha);
    const anio = fecha ? fecha.getFullYear() - (fecha.getMonth() === 0 ? 1 : 0) : new Date().getFullYear();
    return 'Navidad ' + anio;
  }

  function tituloEvento() {
    return datos.ajustes.titulo.trim() || tituloAutomatico();
  }

  /** «Jueves, 24 de diciembre de 2026» (para el campo de Ajustes). */
  function fechaLarga(iso) {
    const fecha = fechaDesdeIso(iso);
    if (!fecha) return '';
    const texto = fecha.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    return texto.charAt(0).toUpperCase() + texto.slice(1);
  }

  /** «24 de diciembre» (con el año solo si no es el actual), para el correo y el resumen. */
  function fechaCorta(iso) {
    const fecha = fechaDesdeIso(iso);
    if (!fecha) return '';
    const opciones = { day: 'numeric', month: 'long' };
    if (fecha.getFullYear() !== new Date().getFullYear()) opciones.year = 'numeric';
    return fecha.toLocaleDateString('es-ES', opciones);
  }

  function datosIniciales() {
    return {
      version: 3,
      participantes: [],
      // Título vacío = automático («Navidad» + año), para que no se quede anticuado.
      ajustes: { titulo: '', presupuesto: '', fecha: fechaPorDefecto(), mensaje: '', lugar: normalizarLugar(null) },
    };
  }

  /**
   * modo: 'direccion' (por defecto; si se deja en blanco no sale en el correo),
   * 'pendiente' («Por definir») o 'ninguno' (no sale en el correo).
   */
  function normalizarLugar(lugar) {
    const l = lugar && typeof lugar === 'object' ? lugar : {};
    return {
      modo: ['ninguno', 'pendiente', 'direccion'].includes(l.modo) ? l.modo : 'direccion',
      nombre: typeof l.nombre === 'string' ? l.nombre : '',
      direccion: typeof l.direccion === 'string' ? l.direccion : '',
    };
  }

  function normalizarDatos(bruto) {
    const base = datosIniciales();
    if (!bruto || typeof bruto !== 'object') return base;
    const participantes = (Array.isArray(bruto.participantes) ? bruto.participantes : [])
      .filter(p => p && String(p.nombre || '').trim())
      .map(p => ({ id: String(p.id || nuevoId()), nombre: String(p.nombre).trim(), email: String(p.email || '').trim() }));
    const a = bruto.ajustes || {};
    const texto = (v, porDefecto) => (typeof v === 'string' ? v : porDefecto);
    // Fechas de versiones anteriores (texto libre o vacío) pasan al 24 de diciembre.
    // Desde la versión 2, una fecha vacía significa que se ha borrado a propósito.
    let fecha = typeof a.fecha === 'string' && fechaDesdeIso(a.fecha) ? a.fecha : null;
    if (fecha === null) fecha = bruto.version >= 2 && a.fecha === '' ? '' : base.ajustes.fecha;
    // Una fecha que ya ha pasado no sirve para el próximo sorteo: se pasa a la próxima Nochebuena.
    if (fecha && fechaDesdeIso(fecha) < hoySinHora()) fecha = base.ajustes.fecha;
    // «Navidad 2026» y similares pasan a automático, para que el año se actualice solo.
    const titulo = texto(a.titulo, '').trim();
    // Antes de la versión 3 el lugar venía en «No mostrar»: si no se había escrito nada, pasa a «Dirección».
    const lugar = normalizarLugar(a.lugar);
    if (!(bruto.version >= 3) && lugar.modo === 'ninguno' && !lugar.nombre.trim() && !lugar.direccion.trim()) lugar.modo = 'direccion';
    return {
      version: 3,
      participantes,
      ajustes: {
        titulo: /^Navidad \d{4}$/i.test(titulo) ? '' : titulo,
        presupuesto: texto(a.presupuesto, ''),
        fecha,
        mensaje: texto(a.mensaje, ''),
        lugar,
      },
    };
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

  // ───────────────────────── Utilidades de interfaz ─────────────────────────

  function el(etiqueta, props) {
    const nodo = document.createElement(etiqueta);
    Object.entries(props || {}).forEach(([k, v]) => {
      if (v == null || v === false) return;
      if (k === 'class') nodo.className = v;
      else if (k === 'text') nodo.textContent = v;
      else if (k.startsWith('on')) nodo.addEventListener(k.slice(2), v);
      else nodo.setAttribute(k, v === true ? '' : v);
    });
    for (let i = 2; i < arguments.length; i++) {
      [].concat(arguments[i]).forEach(hijo => { if (hijo != null && hijo !== false) nodo.append(hijo); });
    }
    return nodo;
  }

  function icono(nombre) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'icono');
    svg.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS(SVG_NS, 'use');
    use.setAttribute('href', '#i-' + nombre);
    svg.append(use);
    return svg;
  }

  function botonIcono(nombreIcono, etiqueta, accion) {
    return el('button', { class: 'icono-boton', type: 'button', 'aria-label': etiqueta, title: etiqueta, onclick: accion }, icono(nombreIcono));
  }

  let temporizadorAviso = null;
  function avisar(texto, tipo) {
    const toast = $('#toast');
    toast.textContent = texto;
    toast.className = 'toast visible ' + (tipo || '');
    clearTimeout(temporizadorAviso);
    temporizadorAviso = setTimeout(() => { toast.className = 'toast ' + (tipo || ''); }, tipo === 'error' ? 5000 : 2800);
  }

  function confirmar(opciones) {
    const dialogo = $('#dlg-confirmar');
    $('#confirmar-titulo').textContent = opciones.titulo;
    $('#confirmar-texto').textContent = opciones.texto;
    $('#confirmar-ok').textContent = opciones.ok || 'Aceptar';
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
    if (isNaN(fecha)) return 'otro día';
    return fecha.toLocaleString('es-ES', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
  }

  function inicial(nombre) {
    return (Array.from(nombre.trim())[0] || '?').toUpperCase();
  }

  function plural(n, singular, varios) {
    return `${n} ${n === 1 ? singular : varios}`;
  }

  // ───────────────────────── Navegación ─────────────────────────

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
    if (location.hash.slice(1) !== nombre && history.replaceState) history.replaceState(null, '', '#' + nombre);
  }

  $$('.pestanas button').forEach(b => b.addEventListener('click', () => mostrarVista(b.dataset.vista)));
  $$('[data-cerrar]').forEach(b => b.addEventListener('click', () => b.closest('dialog').close()));

  // ───────────────────────── Participantes ─────────────────────────

  function limpiarNombre(nombre) {
    return String(nombre || '').trim().replace(/\s+/g, ' ');
  }

  function errorPersona(nombre, email, exceptoId) {
    if (!nombre) return 'Falta el nombre.';
    if (nombre.length > 40) return 'Ese nombre es demasiado largo.';
    if (!EMAIL_RE.test(email)) return `El correo de ${nombre} no parece válido.`;
    const repetido = datos.participantes.some(p => p.id !== exceptoId && p.nombre.toLowerCase() === nombre.toLowerCase());
    if (repetido) return `Ya hay alguien que se llama ${nombre}. Añade la inicial del apellido para distinguirlos.`;
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
      (!nombre || error.startsWith('Ya hay') ? form.nombre : form.email).focus();
      return;
    }
    datos.participantes.push({ id: nuevoId(), nombre, email });
    guardar();
    renderTodo();
    form.reset();
    form.nombre.focus();
    avisar(`${nombre} ya está en la lista.`);
  });

  $('#form-participante').nombre.addEventListener('keydown', ev => {
    if (ev.key === 'Enter') { ev.preventDefault(); $('#form-participante').email.focus(); }
  });

  async function quitarParticipante(id) {
    const p = participantePorId(id);
    if (!p) return;
    const ok = await confirmar({ titulo: `¿Quitar a ${p.nombre}?`, texto: 'Dejará de estar en el sorteo.', ok: 'Quitar' });
    if (!ok) return;
    datos.participantes = datos.participantes.filter(x => x.id !== id);
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
    avisar('Cambios guardados.');
  });

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
    const saltadas = problemas.length + ignoradas.length;
    avisar(`Añadidas ${plural(anadidos, 'persona', 'personas')}.` + (saltadas ? ` ${plural(saltadas, 'línea no se ha', 'líneas no se han')} podido añadir.` : ''));
  });

  function renderParticipantes() {
    $('#lista-participantes').replaceChildren(...datos.participantes.map(p => el('li', { class: 'fila' },
      el('span', { class: 'inicial', 'aria-hidden': 'true', text: inicial(p.nombre) }),
      el('div', { class: 'fila-texto' },
        el('div', { class: 'fila-nombre', text: p.nombre }),
        el('div', { class: 'fila-email', text: p.email })),
      el('div', { class: 'fila-acciones' },
        botonIcono('lapiz', `Editar a ${p.nombre}`, () => abrirEdicion(p.id)),
        botonIcono('cerrar', `Quitar a ${p.nombre}`, () => quitarParticipante(p.id)))
    )));
    const n = datos.participantes.length;
    $('#contador').textContent = n;
    $('#vacio-participantes').hidden = n > 0;
  }

  // ───────────────────────── Ajustes ─────────────────────────

  [['#aj-titulo', 'titulo'], ['#aj-presupuesto', 'presupuesto'], ['#aj-mensaje', 'mensaje']].forEach(([selector, campo]) => {
    $(selector).addEventListener('input', ev => {
      datos.ajustes[campo] = ev.target.value;
      guardar();
      if (campo === 'titulo') renderTitulo();
    });
  });

  // ── Lugar ──

  function enlaceMapa(direccion) {
    return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(direccion.trim());
  }

  $$('input[name=lugar-modo]').forEach(radio => radio.addEventListener('change', ev => {
    const lugar = datos.ajustes.lugar;
    lugar.modo = ev.target.value;
    guardar();
    renderLugar();
    renderSorteo();
    if (lugar.modo === 'direccion' && !lugar.nombre && !lugar.direccion) setTimeout(() => $('#aj-lugar-nombre').focus(), 50);
  }));

  [['#aj-lugar-nombre', 'nombre'], ['#aj-lugar-direccion', 'direccion']].forEach(([selector, campo]) => {
    $(selector).addEventListener('input', ev => {
      datos.ajustes.lugar[campo] = ev.target.value;
      guardar();
      renderEnlaceMapa();
      renderAyudaLugar();
    });
  });

  function renderAyudaLugar() {
    const lugar = datos.ajustes.lugar;
    let direccion = 'En el correo, la calle será un enlace a Google Maps.';
    if (!lugar.direccion.trim()) {
      direccion = lugar.nombre.trim()
        ? 'Saldrá el nombre del sitio, sin enlace al mapa. Añade la calle para que lo tenga.'
        : 'Mientras esté en blanco, el lugar no saldrá en el correo.';
    }
    $('#lugar-ayuda').textContent = {
      ninguno: 'El lugar no saldrá en el correo.',
      pendiente: 'En el correo saldrá «Lugar: Por definir».',
      direccion,
    }[lugar.modo];
  }

  function renderLugar() {
    const lugar = datos.ajustes.lugar;
    $$('input[name=lugar-modo]').forEach(radio => { radio.checked = radio.value === lugar.modo; });
    $('#lugar-detalle').hidden = lugar.modo !== 'direccion';
    renderAyudaLugar();
    if (document.activeElement !== $('#aj-lugar-nombre')) $('#aj-lugar-nombre').value = lugar.nombre;
    if (document.activeElement !== $('#aj-lugar-direccion')) $('#aj-lugar-direccion').value = lugar.direccion;
    renderEnlaceMapa();
  }

  function renderEnlaceMapa() {
    const direccion = datos.ajustes.lugar.direccion.trim();
    const enlace = $('#aj-lugar-mapa');
    enlace.hidden = !direccion;
    if (direccion) enlace.href = enlaceMapa(direccion);
  }

  /** Texto corto para el resumen del sorteo. */
  function lugarCorto() {
    const lugar = datos.ajustes.lugar;
    if (lugar.modo === 'pendiente') return 'lugar por definir';
    if (lugar.modo === 'direccion') return lugar.nombre.trim() || lugar.direccion.trim();
    return '';
  }

  function renderTitulo() {
    const automatico = tituloAutomatico();
    $('#aj-titulo').placeholder = automatico;
    $('#aj-titulo-ayuda').textContent = datos.ajustes.titulo.trim()
      ? `Si lo dejas vacío se pone solo: «${automatico}».`
      : 'Se pone solo con el año de la fecha. Escribe otro si quieres.';
  }

  // ── Calendario propio para la fecha ──

  const ATAJOS_FECHA = [
    { nombre: 'Nochebuena', mes: 11, dia: 24 },
    { nombre: 'Navidad', mes: 11, dia: 25 },
    { nombre: 'Nochevieja', mes: 11, dia: 31 },
    { nombre: 'Reyes', mes: 0, dia: 6 },
  ];
  let mesVisible = null;

  function hoySinHora() {
    const ahora = new Date();
    return new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate());
  }

  function aIso(fecha) {
    return fecha.getFullYear() + '-' + String(fecha.getMonth() + 1).padStart(2, '0') + '-' + String(fecha.getDate()).padStart(2, '0');
  }

  /** La próxima vez que cae ese día (este año o, si ya ha pasado, el siguiente). */
  function proximaFecha(mes, dia) {
    const hoy = hoySinHora();
    const fecha = new Date(hoy.getFullYear(), mes, dia);
    return fecha < hoy ? new Date(hoy.getFullYear() + 1, mes, dia) : fecha;
  }

  function tituloMes(fecha) {
    const mes = fecha.toLocaleDateString('es-ES', { month: 'long' });
    return mes.charAt(0).toUpperCase() + mes.slice(1) + ' ' + fecha.getFullYear();
  }

  function renderCalendario(enfocarIso) {
    const hoy = hoySinHora();
    const hoyIso = aIso(hoy);
    const elegida = datos.ajustes.fecha;
    const anio = mesVisible.getFullYear();
    const mes = mesVisible.getMonth();

    $('#cal-titulo').textContent = tituloMes(mesVisible);
    $('#cal-anterior').disabled = anio < hoy.getFullYear() || (anio === hoy.getFullYear() && mes <= hoy.getMonth());

    // Seis semanas fijas, empezando en lunes, para que el calendario no cambie de alto.
    const desfase = (new Date(anio, mes, 1).getDay() + 6) % 7;
    const dias = Array.from({ length: 42 }, (_, i) => new Date(anio, mes, 1 - desfase + i));
    const isos = dias.map(aIso);
    const seleccionable = i => dias[i] >= hoy && dias[i].getMonth() === mes;
    const enfocable = [enfocarIso, elegida, hoyIso].find(iso => iso && isos.includes(iso) && seleccionable(isos.indexOf(iso)))
      || isos.find((iso, i) => seleccionable(i));

    $('#cal-dias').replaceChildren(...dias.map((dia, i) => el('button', {
      type: 'button',
      class: 'cal-dia' + (dia.getMonth() !== mes ? ' fuera' : '') + (isos[i] === hoyIso ? ' hoy' : ''),
      'data-fecha': isos[i],
      'aria-label': dia.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
      'aria-pressed': isos[i] === elegida ? 'true' : 'false',
      'aria-current': isos[i] === hoyIso ? 'date' : null,
      tabindex: isos[i] === enfocable ? '0' : '-1',
      disabled: dia < hoy,
      text: String(dia.getDate()),
    })));

    $('#cal-atajos').replaceChildren(...ATAJOS_FECHA.map(atajo => {
      const iso = aIso(proximaFecha(atajo.mes, atajo.dia));
      return el('button', {
        type: 'button',
        class: 'cal-atajo',
        'aria-pressed': iso === elegida ? 'true' : 'false',
        'aria-label': `${atajo.nombre}: ${fechaLarga(iso)}`,
        text: atajo.nombre,
        onclick: () => elegirFecha(iso),
      });
    }));
    $('#cal-quitar').hidden = !elegida;

    if (enfocarIso) {
      const boton = $(`.cal-dia[data-fecha="${enfocarIso}"]`);
      if (boton && !boton.disabled) boton.focus();
    }
  }

  function abrirCalendario() {
    const base = fechaDesdeIso(datos.ajustes.fecha) || proximaFecha(11, 24);
    mesVisible = new Date(base.getFullYear(), base.getMonth(), 1);
    $('#dlg-fecha').showModal();
    renderCalendario();
    const foco = $('#cal-dias [tabindex="0"]');
    if (foco) foco.focus();
  }

  function elegirFecha(iso) {
    datos.ajustes.fecha = iso;
    guardar();
    renderFecha();
    renderTitulo();
    renderSorteo();
    $('#dlg-fecha').close();
  }

  function moverMes(delta) {
    mesVisible = new Date(mesVisible.getFullYear(), mesVisible.getMonth() + delta, 1);
    renderCalendario();
  }

  $('#aj-fecha').addEventListener('click', abrirCalendario);
  $('#cal-anterior').addEventListener('click', () => moverMes(-1));
  $('#cal-siguiente').addEventListener('click', () => moverMes(1));
  $('#cal-quitar').addEventListener('click', () => elegirFecha(''));

  $('#cal-dias').addEventListener('click', ev => {
    const boton = ev.target.closest('.cal-dia');
    if (boton && !boton.disabled) elegirFecha(boton.dataset.fecha);
  });

  // Teclado: flechas para moverse por días y semanas, RePág/AvPág para cambiar de mes.
  $('#cal-dias').addEventListener('keydown', ev => {
    const actual = ev.target.closest('.cal-dia');
    if (!actual) return;
    const f = fechaDesdeIso(actual.dataset.fecha);
    const pasos = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    let destino;
    if (Object.prototype.hasOwnProperty.call(pasos, ev.key)) destino = new Date(f.getFullYear(), f.getMonth(), f.getDate() + pasos[ev.key]);
    else if (ev.key === 'PageUp' || ev.key === 'PageDown') destino = new Date(f.getFullYear(), f.getMonth() + (ev.key === 'PageDown' ? 1 : -1), f.getDate());
    else return;
    ev.preventDefault();
    if (destino < hoySinHora()) return;
    const iso = aIso(destino);
    if (destino.getMonth() !== mesVisible.getMonth() || destino.getFullYear() !== mesVisible.getFullYear()) {
      mesVisible = new Date(destino.getFullYear(), destino.getMonth(), 1);
      renderCalendario(iso);
      return;
    }
    $$('.cal-dia', $('#cal-dias')).forEach(b => { b.tabIndex = b.dataset.fecha === iso ? 0 : -1; });
    const boton = $(`.cal-dia[data-fecha="${iso}"]`);
    if (boton) boton.focus();
  });

  function renderFecha() {
    const texto = $('#aj-fecha-texto');
    texto.textContent = fechaLarga(datos.ajustes.fecha) || 'Sin fecha';
    texto.classList.toggle('vacia', !datos.ajustes.fecha);
  }

  /** Ajustes tal y como se mandan al servidor (con la fecha ya en texto). */
  function ajustesParaCorreo() {
    return Object.assign({}, datos.ajustes, { titulo: tituloEvento(), fecha: fechaCorta(datos.ajustes.fecha) });
  }

  /** Dirección de la página del rasca y gana, junto a esta (el servidor solo la acepta si está en GitHub Pages). */
  function urlRasca() {
    return new URL('rasca.html', location.href).href;
  }

  $('#aj-clave').addEventListener('input', ev => {
    clave = ev.target.value;
    infoServidor = null;
    if ($('#aj-recordar').checked) escribirLocal(LS_CLAVE, clave || null);
    renderEstadoServidor();
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
  });

  function renderAjustes() {
    const a = datos.ajustes;
    const asignar = (selector, valor) => { if (document.activeElement !== $(selector)) $(selector).value = valor; };
    asignar('#aj-titulo', a.titulo);
    renderTitulo();
    asignar('#aj-presupuesto', a.presupuesto);
    renderFecha();
    renderLugar();
    asignar('#aj-mensaje', a.mensaje);
    asignar('#aj-clave', clave);
    $('#aj-recordar').checked = Boolean(leerLocal(LS_CLAVE));
  }

  function renderEstadoServidor(error) {
    const caja = $('#estado-servidor');
    if (error) {
      caja.className = 'estado-servidor mal';
      caja.textContent = error;
      return;
    }
    caja.className = 'estado-servidor';
    if (!infoServidor) { caja.textContent = ''; return; }
    const s = infoServidor;
    caja.replaceChildren(el('ul', null,
      el('li', { text: 'Conexión correcta.' }),
      el('li', { text: `Hoy se pueden mandar ${s.cuota} correos más.` }),
      el('li', { text: `Las pruebas llegan a ${s.emailPrueba}.` }),
      el('li', { text: s.ultimoSorteo ? `Último sorteo real: ${formatearFecha(s.ultimoSorteo.fecha)}.` : 'Todavía no se ha hecho ningún sorteo real.' })
    ));
  }

  // ───────────────────────── Servidor ─────────────────────────

  function errorConCodigo(mensaje, codigo, detalle) {
    const error = new Error(mensaje);
    error.codigo = codigo;
    error.detalle = detalle;
    return error;
  }

  async function llamar(accion, extra, claveUsada) {
    const claveFinal = claveUsada == null ? clave : claveUsada;
    if (!CONFIG.urlBackend) throw errorConCodigo(SIN_URL, 'SIN_URL');
    if (!claveFinal) throw errorConCodigo('Falta la clave. Escríbela en Ajustes.', 'SIN_CLAVE_LOCAL');
    let respuesta;
    try {
      respuesta = await fetch(CONFIG.urlBackend, {
        method: 'POST',
        // text/plain evita la petición previa CORS, que Apps Script no admite
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(Object.assign({ accion, clave: claveFinal }, extra || {})),
        redirect: 'follow',
      });
    } catch (e) {
      throw errorConCodigo('No hay conexión con el servidor. Comprueba que tienes internet y que el script está publicado para «Cualquier usuario».', 'RED');
    }
    let json;
    try { json = await respuesta.json(); } catch (e) {
      throw errorConCodigo('El servidor ha respondido algo raro. Revisa que la dirección de js/config.js termine en /exec.', 'RESPUESTA');
    }
    if (!json.ok) throw errorConCodigo(json.error || 'Algo ha fallado en el servidor.', json.codigo, json.detalle);
    return json;
  }

  function irAClave(mensaje) {
    avisar(mensaje, 'error');
    mostrarVista('ajustes');
    setTimeout(() => $('#aj-clave').focus(), 300);
  }

  function tratarError(e) {
    if (e.codigo === 'CLAVE' || e.codigo === 'SIN_CLAVE_LOCAL') return irAClave(e.message);
    return avisar(e.message, 'error');
  }

  async function consultarEstado(silencioso) {
    try {
      infoServidor = await llamar('estado');
      renderEstadoServidor();
      renderSorteo();
      if (!silencioso) avisar('Conexión correcta.');
    } catch (e) {
      infoServidor = null;
      renderEstadoServidor(e.message);
      if (!silencioso) avisar(e.message, 'error');
    }
  }

  $('#btn-probar').addEventListener('click', ev => conBoton(ev.currentTarget, () => consultarEstado(false)));

  $('#btn-vista-previa').addEventListener('click', ev => conBoton(ev.currentTarget, async () => {
    try {
      const r = await llamar('vistaPrevia', { ajustes: ajustesParaCorreo(), urlRasca: urlRasca() });
      $('#previa-asunto').textContent = 'Asunto: ' + r.asunto;
      $('#previa-iframe').srcdoc = r.html;
      $('#dlg-previa').showModal();
    } catch (e) { tratarError(e); }
  }));

  $('#btn-guardar-nube').addEventListener('click', ev => {
    if (!datos.participantes.length) return avisar('La lista está vacía.', 'error');
    return conBoton(ev.currentTarget, async () => {
      const ok = await confirmar({ titulo: 'Subir lista', texto: `Se guardará esta lista (${plural(datos.participantes.length, 'persona', 'personas')}) y sustituirá a la que hubiera subida.`, ok: 'Subir' });
      if (!ok) return;
      try {
        await llamar('guardar', { datos });
        avisar('Lista subida.');
      } catch (e) { tratarError(e); }
    });
  });

  $('#btn-cargar-nube').addEventListener('click', ev => conBoton(ev.currentTarget, async () => {
    try {
      const r = await llamar('cargar');
      if (!r.datos) return avisar('Todavía no hay ninguna lista subida.', 'error');
      const nueva = normalizarDatos(r.datos);
      if (datos.participantes.length) {
        const ok = await confirmar({ titulo: 'Bajar lista', texto: `La lista de este dispositivo (${plural(datos.participantes.length, 'persona', 'personas')}) se cambiará por la subida (${plural(nueva.participantes.length, 'persona', 'personas')}).`, ok: 'Cambiar' });
        if (!ok) return;
      }
      datos = nueva;
      guardar();
      renderTodo();
      avisar(`Lista bajada: ${plural(datos.participantes.length, 'persona', 'personas')}.`);
    } catch (e) { tratarError(e); }
  }));

  $('#btn-borrar-todo').addEventListener('click', async () => {
    const ok = await confirmar({ titulo: '¿Borrar todo?', texto: 'Se borran de este dispositivo la lista, los ajustes y la clave guardada. Lo que haya subido no se toca.', ok: 'Borrar' });
    if (!ok) return;
    datos = datosIniciales();
    clave = '';
    infoServidor = null;
    escribirLocal(LS_DATOS, null);
    escribirLocal(LS_CLAVE, null);
    $('#resultado').hidden = true;
    renderEstadoServidor();
    renderTodo();
    avisar('Datos borrados de este dispositivo.');
  });

  // ───────────────────────── Opciones del organizador ─────────────────────────
  // Las reglas (exclusiones, asignaciones fijas, parejas cruzadas) viven en el
  // servidor. Aquí solo se tienen en memoria mientras el panel está abierto, y
  // para abrirlo hay que escribir la clave cada vez.

  let reglas = null;
  let claveOrganizador = '';

  function bloquearOrganizador() {
    reglas = null;
    claveOrganizador = '';
    $('#org-clave').value = '';
    ['#org-error-clave', '#org-error', '#ex-error', '#fi-error'].forEach(s => { $(s).textContent = ''; });
    $('#org-bloqueo').hidden = false;
    $('#org-editor').hidden = true;
    $('#lista-exclusiones').replaceChildren();
    $('#lista-fijas').replaceChildren();
    $('#viabilidad').textContent = '';
  }

  $('#btn-organizador').addEventListener('click', () => {
    bloquearOrganizador();
    $('#dlg-organizador').showModal();
    setTimeout(() => $('#org-clave').focus(), 50);
  });

  $('#dlg-organizador').addEventListener('close', bloquearOrganizador);

  $('#form-org-clave').addEventListener('submit', ev => {
    ev.preventDefault();
    const intento = $('#org-clave').value;
    if (!intento) { $('#org-error-clave').textContent = 'Escribe la clave.'; return undefined; }
    return conBoton($('#btn-org-entrar'), async () => {
      try {
        const r = await llamar('leerReglas', null, intento);
        claveOrganizador = intento;
        reglas = {
          exclusiones: r.reglas.exclusiones.map(par => par.slice()),
          fijas: (r.reglas.fijas || []).map(par => par.slice()),
          evitarReciprocos: r.reglas.evitarReciprocos === true,
        };
        $('#org-clave').value = '';
        $('#org-bloqueo').hidden = true;
        $('#org-editor').hidden = false;
        renderReglas();
      } catch (e) {
        $('#org-error-clave').textContent = e.codigo === 'CLAVE' ? 'Esa no es la clave.' : e.message;
      }
    });
  });

  function rellenarSelect(select, lista, textoVacio) {
    const anterior = select.value;
    select.replaceChildren(
      el('option', { value: '', text: textoVacio || 'Elige…' }),
      ...lista.map(nombre => el('option', { value: nombre, text: nombre }))
    );
    if (lista.includes(anterior)) select.value = anterior;
  }

  const igual = (x, y) => x.toLowerCase() === y.toLowerCase();
  const limpiarErroresReglas = () => { $('#ex-error').textContent = ''; $('#fi-error').textContent = ''; };

  /** Las reglas cuyas dos personas siguen en la lista. */
  function aplicables(parejas) {
    const enLista = new Set(nombres().map(n => n.toLowerCase()));
    return parejas.filter(([a, b]) => enLista.has(a.toLowerCase()) && enLista.has(b.toLowerCase()));
  }

  function filasReglas(parejas, separador, textoQuitar, enLista) {
    return parejas.map(([a, b], i) => {
      const fuera = [a, b].filter(n => !enLista.has(n.toLowerCase()));
      const nombreEl = n => el('span', { class: enLista.has(n.toLowerCase()) ? null : 'ausente', text: n });
      return el('li', { class: 'fila' },
        el('div', { class: 'pareja' },
          nombreEl(a), el('span', { class: 'separador', text: separador }), nombreEl(b),
          fuera.length ? el('small', { text: `${fuera.join(' y ')} ya no ${fuera.length === 1 ? 'está' : 'están'} en la lista; esta regla no se aplica.` }) : null),
        botonIcono('cerrar', textoQuitar(a, b), () => { parejas.splice(i, 1); limpiarErroresReglas(); renderReglas(); }));
    });
  }

  function renderReglas() {
    if (!reglas) return;
    const lista = nombres();
    const enLista = new Set(lista.map(n => n.toLowerCase()));
    rellenarSelect($('#ex-a'), lista);
    rellenarSelect($('#ex-b'), lista);
    rellenarSelect($('#fi-a'), lista, 'Quién…');
    rellenarSelect($('#fi-b'), lista, 'A quién…');
    $('#org-sin-gente').hidden = lista.length > 0;
    $('#form-exclusion').hidden = lista.length < 2;
    $('#form-fija').hidden = lista.length < 2;

    $('#lista-exclusiones').replaceChildren(...filasReglas(reglas.exclusiones, 'y',
      (a, b) => `Quitar la exclusión entre ${a} y ${b}`, enLista));
    $('#lista-fijas').replaceChildren(...filasReglas(reglas.fijas, 'le regala a',
      (a, b) => `Quitar que ${a} le regale a ${b}`, enLista));

    $('#org-reciprocos').checked = reglas.evitarReciprocos;

    const caja = $('#viabilidad');
    if (lista.length < 2) {
      caja.textContent = '';
      caja.className = 'viabilidad';
      return;
    }
    const v = window.Sorteo.comprobar(lista, aplicables(reglas.exclusiones), {
      evitarReciprocos: reglas.evitarReciprocos,
      fijas: aplicables(reglas.fijas),
    });
    caja.className = 'viabilidad' + (v.posible ? '' : ' mal');
    caja.textContent = v.posible ? 'Con estas reglas el sorteo sale sin problema.' : v.motivo;
  }

  $('#form-exclusion').addEventListener('submit', ev => {
    ev.preventDefault();
    if (!reglas) return;
    const a = $('#ex-a').value;
    const b = $('#ex-b').value;
    const error = $('#ex-error');
    if (!a || !b) { error.textContent = 'Elige a las dos personas.'; return; }
    if (a === b) { error.textContent = 'Tienen que ser dos personas distintas.'; return; }
    const existe = reglas.exclusiones.some(([x, y]) => (igual(x, a) && igual(y, b)) || (igual(x, b) && igual(y, a)));
    if (existe) { error.textContent = 'Esa pareja ya está.'; return; }
    const fija = reglas.fijas.find(([x, y]) => (igual(x, a) && igual(y, b)) || (igual(x, b) && igual(y, a)));
    if (fija) {
      error.textContent = `${fija[0]} tiene fijado que le regala a ${fija[1]}. Quita esa asignación primero.`;
      return;
    }
    limpiarErroresReglas();
    reglas.exclusiones.push([a, b]);
    $('#ex-a').value = '';
    $('#ex-b').value = '';
    renderReglas();
  });

  $('#form-fija').addEventListener('submit', ev => {
    ev.preventDefault();
    if (!reglas) return;
    const a = $('#fi-a').value;
    const b = $('#fi-b').value;
    const error = $('#fi-error');
    if (!a || !b) { error.textContent = 'Elige quién regala y a quién.'; return; }
    if (a === b) { error.textContent = 'Nadie puede regalarse a sí mismo.'; return; }
    const daYa = reglas.fijas.find(([x]) => igual(x, a));
    if (daYa) {
      error.textContent = igual(daYa[1], b)
        ? 'Eso ya está fijado.'
        : `${daYa[0]} ya tiene fijado que le regala a ${daYa[1]}. Quítalo primero si quieres cambiarlo.`;
      return;
    }
    const recibeYa = reglas.fijas.find(([, y]) => igual(y, b));
    if (recibeYa) { error.textContent = `A ${recibeYa[1]} ya le regala ${recibeYa[0]}.`; return; }
    const excluidos = reglas.exclusiones.some(([x, y]) => (igual(x, a) && igual(y, b)) || (igual(x, b) && igual(y, a)));
    if (excluidos) { error.textContent = `${a} y ${b} están en las exclusiones. Quita esa exclusión primero.`; return; }
    limpiarErroresReglas();
    reglas.fijas.push([a, b]);
    $('#fi-a').value = '';
    $('#fi-b').value = '';
    renderReglas();
  });

  $('#org-reciprocos').addEventListener('change', ev => {
    if (!reglas) return;
    reglas.evitarReciprocos = ev.target.checked;
    renderReglas();
  });

  $('#btn-guardar-reglas').addEventListener('click', ev => conBoton(ev.currentTarget, async () => {
    if (!reglas) return;
    try {
      const r = await llamar('guardarReglas', { reglas }, claveOrganizador);
      // Un Code.gs antiguo guarda el resto y descarta las asignaciones fijas sin decir nada.
      if (reglas.fijas.length && !(r.reglas && Array.isArray(r.reglas.fijas))) {
        $('#org-error').textContent = 'Las exclusiones se han guardado, pero las asignaciones fijas no: el servidor tiene un Code.gs antiguo. Pega el nuevo en Apps Script y publica una versión nueva.';
        return;
      }
      $('#dlg-organizador').close();
      avisar('Opciones guardadas.');
    } catch (e) {
      $('#org-error').textContent = e.message;
    }
  }));

  // ───────────────────────── Sorteo ─────────────────────────

  const modoActual = () => ($('input[name=modo]:checked') || {}).value || 'prueba';

  $$('input[name=modo]').forEach(r => r.addEventListener('change', renderSorteo));

  function renderSorteo() {
    const a = datos.ajustes;
    const n = datos.participantes.length;
    const partes = [plural(n, 'persona', 'personas')];
    if (a.presupuesto.trim()) partes.push(a.presupuesto.trim());
    if (fechaCorta(a.fecha)) partes.push(fechaCorta(a.fecha));
    if (lugarCorto()) partes.push(lugarCorto());
    $('#resumen').textContent = partes.join(' · ');

    const prueba = modoActual() === 'prueba';
    const destino = infoServidor ? infoServidor.emailPrueba : 'la cuenta que manda los correos';
    $('#nota-modo').textContent = prueba
      ? `Los correos te llegan a ti (${destino}), no a los participantes. Sirve para ver que todo funciona.`
      : 'A cada persona le llega solo su correo. El resultado completo no lo ve nadie, tampoco tú.';

    if (!sorteando) {
      $('#btn-sortear').disabled = n < 2;
      $('#estado-sorteo').textContent = mensajeTrasSorteo || (n < 2
        ? 'Hacen falta al menos dos personas.'
        : (prueba ? `Se mandarán ${n} correos de prueba, todos a ti.` : `Se mandará un correo a cada una de las ${n} personas.`));
    }

    const ultimo = infoServidor && infoServidor.ultimoSorteo;
    $('#panel-reenviar').hidden = !ultimo;
    if (ultimo) {
      const select = $('#reenviar-nombre');
      const anterior = select.value;
      select.replaceChildren(...ultimo.participantes.map(nombre => el('option', { value: nombre, text: nombre })));
      if (ultimo.participantes.includes(anterior)) select.value = anterior;
    }
  }

  function estadoSello(estado, texto) {
    const boton = $('#btn-sortear');
    boton.classList.remove('cargando', 'hecho');
    if (estado) boton.classList.add(estado);
    $('#sello-texto').textContent = texto || 'Sortear';
  }

  let temporizadorEnvio = null;
  let temporizadorReposo = null;
  let mensajeTrasSorteo = null;

  async function sortear(repetir) {
    if (sorteando) return;
    const n = datos.participantes.length;
    if (n < 2) return avisar('Hacen falta al menos dos personas.', 'error');
    if (!CONFIG.urlBackend) return avisar(SIN_URL, 'error');
    if (!clave) return irAClave('Falta la clave. Escríbela aquí y vuelve al sorteo.');

    const prueba = modoActual() !== 'real';
    if (!repetir) {
      const destino = infoServidor ? infoServidor.emailPrueba : 'la cuenta que manda los correos';
      const ok = await confirmar(prueba
        ? { titulo: 'Sorteo de prueba', texto: `Se mandarán ${n} correos, todos a ${destino}. A los participantes no les llega nada.`, ok: 'Mandar prueba' }
        : { titulo: 'Sorteo real', texto: `Le llegará un correo a cada una de las ${n} personas. Antes de seguir, repasa que los correos estén bien escritos.`, ok: 'Sortear' });
      if (!ok) return;
    }

    sorteando = true;
    clearTimeout(temporizadorReposo);
    mensajeTrasSorteo = null;
    $('#resultado').hidden = true;
    $('#btn-sortear').disabled = true;
    estadoSello('cargando', 'Sorteando');
    $('#estado-sorteo').textContent = 'Haciendo el sorteo…';
    temporizadorEnvio = setTimeout(() => { $('#estado-sorteo').textContent = 'Mandando los correos…'; }, 1200);

    let yaSorteado = null;
    try {
      const r = await llamar('sortear', {
        participantes: datos.participantes.map(p => ({ nombre: p.nombre, email: p.email })),
        ajustes: ajustesParaCorreo(),
        prueba,
        repetir: repetir === true,
        urlRasca: urlRasca(),
      });
      estadoSello('hecho', 'Hecho');
      mensajeTrasSorteo = r.prueba ? 'Prueba enviada. Mira tu bandeja de entrada.' : 'Correos enviados.';
      mostrarResultado(r);
      temporizadorReposo = setTimeout(() => {
        if (sorteando) return;
        mensajeTrasSorteo = null;
        estadoSello('');
        renderSorteo();
      }, 5000);
    } catch (e) {
      estadoSello('');
      if (e.codigo === 'YA_SORTEADO') yaSorteado = e;
      else tratarError(e);
    } finally {
      clearTimeout(temporizadorEnvio);
      sorteando = false;
      renderSorteo();
    }

    if (!prueba) consultarEstado(true);

    if (yaSorteado) {
      const fecha = formatearFecha(yaSorteado.detalle && yaSorteado.detalle.fecha);
      const ok = await confirmar({
        titulo: 'Ya hay un sorteo hecho',
        texto: `El ${fecha} ya se mandaron los correos. Si repites, a todos les llegará uno nuevo con otra persona y el anterior dejará de valer.\n\nSi solo es que a alguien no le ha llegado, mejor usa «Reenviar un correo».`,
        ok: 'Repetir sorteo',
      });
      if (ok) await sortear(true);
    }
  }

  $('#btn-sortear').addEventListener('click', () => sortear(false));

  function mostrarResultado(r) {
    const tarjeta = $('#resultado');
    const fallidos = r.fallidos || [];
    const texto = r.prueba
      ? `Tienes ${plural(r.enviados.length, 'correo', 'correos')} en ${r.destinoPrueba}. Si todo está bien, cambia a «Real» y vuelve a sortear.`
      : `Se ha mandado el correo a ${plural(r.enviados.length, 'persona', 'personas')}.`;
    tarjeta.replaceChildren(...[
      el('h3', { class: 'titulo-panel', text: r.prueba ? 'Prueba enviada' : 'Correos enviados' }),
      el('p', { class: 'nota', text: texto }),
      el('ul', { class: 'lista' },
        r.enviados.map(nombre => el('li', { class: 'fila' }, icono('check'), el('span', { text: nombre }))),
        fallidos.map(f => el('li', { class: 'fila fallo' }, icono('cerrar'), el('span', null, f.nombre, el('small', { text: f.error }))))),
      fallidos.length && !r.prueba
        ? el('p', { class: 'nota', text: 'A los que tienen una cruz no les ha llegado. Puedes reenviárselo abajo, con otro correo si hace falta.' })
        : null,
      el('div', { class: 'botones' },
        el('button', { class: 'boton boton-secundario', type: 'button', text: 'Cerrar', onclick: () => { tarjeta.hidden = true; } })),
    ].filter(Boolean));
    tarjeta.hidden = false;
    tarjeta.focus({ preventScroll: true });
    tarjeta.scrollIntoView({ behavior: animacionReducida() ? 'auto' : 'smooth', block: 'nearest' });
  }

  $('#btn-reenviar').addEventListener('click', ev => {
    const nombre = $('#reenviar-nombre').value;
    const email = $('#reenviar-email').value.trim();
    if (!nombre) return undefined;
    if (email && !EMAIL_RE.test(email)) return avisar('Ese correo no parece válido.', 'error');
    return conBoton(ev.currentTarget, async () => {
      const ok = await confirmar({ titulo: 'Reenviar', texto: `A ${nombre} le volverá a llegar el correo${email ? ' en ' + email : ''}, con la misma persona que le tocó.`, ok: 'Reenviar' });
      if (!ok) return;
      try {
        const r = await llamar('reenviar', Object.assign({ nombre, urlRasca: urlRasca() }, email ? { email } : {}));
        if (email) {
          const local = datos.participantes.find(p => p.nombre.toLowerCase() === nombre.toLowerCase());
          if (local) { local.email = email; guardar(); renderParticipantes(); }
        }
        $('#reenviar-email').value = '';
        avisar(`Correo reenviado a ${r.reenviado}.`);
      } catch (e) { tratarError(e); }
    });
  });

  // ───────────────────────── Nieve ─────────────────────────

  function iniciarNieve() {
    const lienzo = $('#nieve');
    const ctx = lienzo.getContext && lienzo.getContext('2d');
    if (!ctx || animacionReducida()) return;
    let ancho = 0;
    let alto = 0;
    const copos = [];

    function nuevoCopo(enCualquierAltura) {
      const r = Math.random() * 1.4 + 0.4;
      return {
        x: Math.random() * ancho,
        y: enCualquierAltura ? Math.random() * alto : -4,
        r,
        vy: r * 0.22 + Math.random() * 0.18,
        fase: Math.random() * Math.PI * 2,
        deriva: Math.random() * 0.4 + 0.1,
        alfa: Math.random() * 0.3 + 0.12,
      };
    }

    function ajustar() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      ancho = window.innerWidth;
      alto = window.innerHeight;
      lienzo.width = Math.round(ancho * dpr);
      lienzo.height = Math.round(alto * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const objetivo = Math.round(Math.min(70, (ancho * alto) / 14000));
      while (copos.length < objetivo) copos.push(nuevoCopo(true));
      copos.length = objetivo;
    }

    let anterior = performance.now();
    function cuadro(ahora) {
      const dt = Math.min((ahora - anterior) / 16.67, 3);
      anterior = ahora;
      ctx.clearRect(0, 0, ancho, alto);
      ctx.fillStyle = '#ebe3d3';
      for (let i = 0; i < copos.length; i++) {
        const c = copos[i];
        c.fase += 0.008 * dt;
        c.y += c.vy * dt;
        c.x += Math.sin(c.fase) * c.deriva * 0.4 * dt;
        if (c.y > alto + 4) { copos[i] = nuevoCopo(false); continue; }
        if (c.x > ancho + 4) c.x = -4; else if (c.x < -4) c.x = ancho + 4;
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
    renderParticipantes();
    renderAjustes();
    renderSorteo();
  }

  // Reescribe lo guardado en el formato actual (borra exclusiones de versiones antiguas).
  if (leerLocal(LS_DATOS)) guardar();
  renderTodo();
  iniciarNieve();
  mostrarVista(location.hash.slice(1) || 'participantes', false);
  window.addEventListener('hashchange', () => mostrarVista(location.hash.slice(1)));
})();
