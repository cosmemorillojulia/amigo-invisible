/* ───────────────────────── Amigo Invisible · rasca y gana ─────────────────────────
 *
 * La página que abre el enlace del correo. Todo pasa en este navegador: no se
 * manda nada a ningún sitio. El boleto llega tras la # del enlace (js/boleto.js).
 */
(function () {
  'use strict';

  const $ = s => document.querySelector(s);
  const reducirMovimiento = Boolean(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const conDedo = Boolean(window.matchMedia && matchMedia('(pointer: coarse)').matches);

  // Cuándo se da por visto el nombre (suena la campanita). La capa no se quita sola: se rasca entera a mano.
  const UMBRAL = 0.6;         // con más de la mitad rascada…
  const UMBRAL_CENTRO = 0.65; // …o con buena parte del centro, que es donde está el nombre
  const TODO = 0.96;          // prácticamente todo rascado
  const CELDA = 6;            // px de las celdas con las que se mide lo rascado
  const LS_SONIDO = 'amigoInvisible.rasca.sonido';
  const ORO = ['#c9a961', '#e6cf98', '#a8864a', '#f3e4b8', '#b8964f', '#d8bd84'];

  const leerLocal = clave => { try { return localStorage.getItem(clave); } catch (e) { return null; } };
  const guardarLocal = (clave, valor) => { try { localStorage.setItem(clave, valor); } catch (e) { /* sin almacenamiento */ } };

  // ───────────────────────── El boleto ─────────────────────────

  // Si se abre otro boleto en la misma pestaña solo cambia lo de tras la #: hay que volver a empezar.
  window.addEventListener('hashchange', () => location.reload());

  const crudo = location.hash.slice(1) || new URLSearchParams(location.search).get('b') || '';
  const boleto = window.Boleto ? window.Boleto.leer(crudo) : null;
  if (!boleto) {
    $('#roto').hidden = false;
    return;
  }

  const escena = $('#escena');
  const tarjeta = $('#boleto');
  const sombra = $('.boleto-sombra');
  const zona = $('#zona');
  const capa = $('#capa');
  const ctx = capa.getContext('2d');
  const lienzoVirutas = $('#virutas');
  const vctx = lienzoVirutas.getContext('2d');

  /** Número de serie de mentira, pero siempre el mismo para el mismo boleto. */
  function numeroDeSerie(texto) {
    let h = 2166136261;
    for (let i = 0; i < texto.length; i++) {
      h ^= texto.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return String((h >>> 0) % 10000).padStart(4, '0');
  }

  function rellenar() {
    $('#saludo').textContent = boleto.de ? `Hola, ${boleto.de}.` : 'Hola.';
    $('#boleto-titulo').textContent = boleto.titulo || 'Sorteo';
    $('#numero').textContent = 'Nº ' + numeroDeSerie(crudo);
    $('#nombre').textContent = boleto.a;
    const detalles = [['Fecha', boleto.fecha], ['Presupuesto', boleto.presupuesto]].filter(([, valor]) => valor);
    $('#detalles').replaceChildren(...detalles.map(([titulo, valor]) => {
      const fila = document.createElement('div');
      const dt = document.createElement('dt');
      const dd = document.createElement('dd');
      dt.textContent = titulo;
      dd.textContent = valor;
      fila.append(dt, dd);
      return fila;
    }));
  }

  /** El nombre, lo más grande que quepa; si ni así, en dos líneas. */
  function ajustarNombre() {
    const el = $('#nombre');
    el.style.whiteSpace = 'nowrap';
    let tam = 54;
    el.style.fontSize = tam + 'px';
    while (el.scrollWidth > el.clientWidth && tam > 28) {
      tam -= 2;
      el.style.fontSize = tam + 'px';
    }
    if (el.scrollWidth > el.clientWidth) el.style.whiteSpace = 'normal';
  }

  /** Las muescas de los lados van a la altura de la línea troquelada. */
  function colocarCorte() {
    tarjeta.style.setProperty('--corte', $('#pie').offsetTop + 'px');
  }

  let ultimoEstado = '';
  function ponerEstado(texto) {
    if (texto === ultimoEstado) return;
    ultimoEstado = texto;
    $('#estado').textContent = texto;
  }

  // ───────────────────────── Sonido y vibración ─────────────────────────
  // Sin archivos: el rascado es ruido filtrado y la campanita, tres notas.

  const Sonido = (function () {
    const AC = window.AudioContext || window.webkitAudioContext;
    let activo = leerLocal(LS_SONIDO) !== 'no';
    let ac = null;
    let filtro = null;
    let volumen = null;
    let silencio = null;

    function preparar() {
      if (!AC || !activo) return;
      if (!ac) {
        try {
          ac = new AC();
          const buffer = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
          const datos = buffer.getChannelData(0);
          // Ruido con «granos» sueltos: suena más a cartón rascado que a radio mal sintonizada.
          for (let i = 0; i < datos.length; i++) datos[i] = (Math.random() * 2 - 1) * (Math.random() < 0.06 ? 1 : 0.35);
          const ruido = ac.createBufferSource();
          ruido.buffer = buffer;
          ruido.loop = true;
          filtro = ac.createBiquadFilter();
          filtro.type = 'bandpass';
          filtro.frequency.value = 3000;
          filtro.Q.value = 0.8;
          const sinGraves = ac.createBiquadFilter();
          sinGraves.type = 'highpass';
          sinGraves.frequency.value = 700;
          volumen = ac.createGain();
          volumen.gain.value = 0;
          ruido.connect(filtro);
          filtro.connect(sinGraves);
          sinGraves.connect(volumen);
          volumen.connect(ac.destination);
          ruido.start();
        } catch (e) {
          ac = null;
          return;
        }
      }
      if (ac.state === 'suspended') ac.resume();
    }

    function rascar(velocidad) {
      if (!ac || !activo) return;
      const t = ac.currentTime;
      volumen.gain.setTargetAtTime(Math.min(0.2, 0.035 + velocidad * 0.07), t, 0.015);
      filtro.frequency.setTargetAtTime(2200 + Math.min(3000, velocidad * 1100), t, 0.04);
      clearTimeout(silencio);
      silencio = setTimeout(parar, 60);
    }

    function parar() {
      if (ac) volumen.gain.setTargetAtTime(0, ac.currentTime, 0.025);
    }

    function campanita() {
      if (!ac || !activo) return;
      const t = ac.currentTime + 0.03;
      [[1318.5, 0], [1975.5, 0.12], [2637, 0.24]].forEach(([frecuencia, retraso]) => {
        const nota = ac.createOscillator();
        const envolvente = ac.createGain();
        nota.type = 'sine';
        nota.frequency.value = frecuencia;
        envolvente.gain.setValueAtTime(0, t + retraso);
        envolvente.gain.linearRampToValueAtTime(0.08, t + retraso + 0.01);
        envolvente.gain.exponentialRampToValueAtTime(0.0001, t + retraso + 1.1);
        nota.connect(envolvente);
        envolvente.connect(ac.destination);
        nota.start(t + retraso);
        nota.stop(t + retraso + 1.2);
      });
    }

    function alternar() {
      activo = !activo;
      guardarLocal(LS_SONIDO, activo ? 'si' : 'no');
      if (activo) preparar(); else parar();
      return activo;
    }

    return { preparar, rascar, parar, campanita, alternar, get activo() { return activo; } };
  })();

  let ultimaVibracion = 0;
  function vibrar(patron) {
    if (!Sonido.activo || !navigator.vibrate) return;
    // El navegador no deja vibrar hasta que se levanta el dedo por primera vez.
    if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
    if (!patron) {
      const ahora = performance.now();
      if (ahora - ultimaVibracion < 80) return;
      ultimaVibracion = ahora;
    }
    try { navigator.vibrate(patron || 4); } catch (e) { /* no pasa nada */ }
  }

  function pintarBotonSonido() {
    const boton = $('#btn-sonido');
    boton.setAttribute('aria-pressed', String(Sonido.activo));
    boton.setAttribute('aria-label', Sonido.activo ? 'Quitar el sonido' : 'Poner el sonido');
    boton.querySelector('use').setAttribute('href', Sonido.activo ? '#i-sonido' : '#i-silencio');
  }

  $('#btn-sonido').addEventListener('click', () => {
    Sonido.alternar();
    pintarBotonSonido();
  });

  // ───────────────────────── La capa dorada ─────────────────────────

  let ancho = 0;
  let alto = 0;
  let dpr = 1;

  function prepararLienzo() {
    ancho = zona.offsetWidth;
    alto = zona.offsetHeight;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    capa.width = Math.round(ancho * dpr);
    capa.height = Math.round(alto * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function rectanguloRedondeado(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  function textoEspaciado(texto, x, y, espacio) {
    const letras = Array.from(texto);
    const anchos = letras.map(l => ctx.measureText(l).width);
    const total = anchos.reduce((a, b) => a + b, 0) + espacio * (letras.length - 1);
    let cursor = x - total / 2;
    letras.forEach((letra, i) => {
      ctx.fillText(letra, cursor, y);
      cursor += anchos[i] + espacio;
    });
  }

  function pintarCapa() {
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, ancho, alto);

    // Base metálica
    const brillo = ctx.createLinearGradient(0, 0, ancho, alto);
    [[0, '#a8874c'], [0.16, '#d8bf88'], [0.3, '#f0e0b0'], [0.46, '#c4a363'], [0.62, '#e9d6a2'], [0.8, '#b18f51'], [1, '#d4b97f']]
      .forEach(([p, color]) => brillo.addColorStop(p, color));
    ctx.fillStyle = brillo;
    ctx.fillRect(0, 0, ancho, alto);

    // Cepillado
    for (let i = 0; i < 160; i++) {
      const claro = Math.random() < 0.55;
      ctx.strokeStyle = claro ? `rgba(255, 248, 225, ${Math.random() * 0.12})` : `rgba(100, 72, 25, ${Math.random() * 0.09})`;
      ctx.lineWidth = 0.4 + Math.random() * 1.1;
      const y = Math.random() * alto;
      ctx.beginPath();
      ctx.moveTo(-5, y);
      ctx.lineTo(ancho + 5, y + (Math.random() - 0.5) * 10);
      ctx.stroke();
    }
    ctx.restore();

    // Grano, a la resolución real de la pantalla
    const imagen = ctx.getImageData(0, 0, capa.width, capa.height);
    const px = imagen.data;
    for (let i = 0; i < px.length; i += 4) {
      const n = (Math.random() - 0.5) * 26;
      px[i] += n;
      px[i + 1] += n;
      px[i + 2] += n;
    }
    ctx.putImageData(imagen, 0, 0);

    // Estrellitas en relieve
    ctx.save();
    ctx.font = '10px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let y = 9, fila = 0; y < alto + 9; y += 17, fila++) {
      for (let x = fila % 2 ? 8.5 : 0; x < ancho + 9; x += 17) {
        ctx.fillStyle = 'rgba(255, 246, 220, .3)';
        ctx.fillText('✦', x + 0.6, y + 0.6);
        ctx.fillStyle = 'rgba(96, 68, 22, .2)';
        ctx.fillText('✦', x, y);
      }
    }

    // Cartela central con «RASCA AQUÍ»
    const cw = Math.min(ancho - 40, 214);
    const ch = 46;
    const cx = (ancho - cw) / 2;
    const cy = (alto - ch) / 2;
    rectanguloRedondeado(ctx, cx, cy, cw, ch, 8);
    ctx.fillStyle = 'rgba(206, 177, 113, .96)';
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(96, 68, 22, .38)';
    ctx.stroke();
    rectanguloRedondeado(ctx, cx + 3.5, cy + 3.5, cw - 7, ch - 7, 5);
    ctx.strokeStyle = 'rgba(255, 246, 222, .55)';
    ctx.stroke();

    ctx.font = '600 14px Figtree, system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(255, 248, 228, .75)';
    textoEspaciado('RASCA AQUÍ', ancho / 2, alto / 2 + 1, 3.6);
    ctx.fillStyle = 'rgba(78, 56, 18, .82)';
    textoEspaciado('RASCA AQUÍ', ancho / 2, alto / 2, 3.6);
    ctx.restore();
  }

  // ───────────────────────── Lo rascado ─────────────────────────
  // Una rejilla de celdas de 6 px: así se sabe cuánto queda sin mirar píxel a píxel.

  let rejilla = new Uint8Array(0);
  let columnas = 0;
  let filas = 0;
  let rascadas = 0;
  let enCentro = 0;
  let totalCentro = 1;
  let centro = { c0: 0, c1: 0, f0: 0, f1: 0 };

  function crearRejilla() {
    columnas = Math.ceil(ancho / CELDA);
    filas = Math.ceil(alto / CELDA);
    rejilla = new Uint8Array(columnas * filas);
    rascadas = 0;
    enCentro = 0;
    centro = {
      c0: Math.floor(columnas * 0.12), c1: Math.ceil(columnas * 0.88) - 1,
      f0: Math.floor(filas * 0.28), f1: Math.ceil(filas * 0.72) - 1,
    };
    totalCentro = Math.max(1, (centro.c1 - centro.c0 + 1) * (centro.f1 - centro.f0 + 1));
  }

  function marcarCelda(f, c) {
    const i = f * columnas + c;
    if (rejilla[i]) return 0;
    rejilla[i] = 1;
    rascadas++;
    if (c >= centro.c0 && c <= centro.c1 && f >= centro.f0 && f <= centro.f1) enCentro++;
    return 1;
  }

  function marcar(x, y, r) {
    let nuevas = 0;
    const c0 = Math.max(0, Math.floor((x - r) / CELDA));
    const c1 = Math.min(columnas - 1, Math.floor((x + r) / CELDA));
    const f0 = Math.max(0, Math.floor((y - r) / CELDA));
    const f1 = Math.min(filas - 1, Math.floor((y + r) / CELDA));
    for (let f = f0; f <= f1; f++) {
      for (let c = c0; c <= c1; c++) {
        const dx = (c + 0.5) * CELDA - x;
        const dy = (f + 0.5) * CELDA - y;
        if (dx * dx + dy * dy <= r * r) nuevas += marcarCelda(f, c);
      }
    }
    return nuevas;
  }

  /** Rehace la rejilla mirando los píxeles (tras girar el móvil o cambiar el tamaño). */
  function recontar() {
    crearRejilla();
    const datos = ctx.getImageData(0, 0, capa.width, capa.height).data;
    for (let f = 0; f < filas; f++) {
      for (let c = 0; c < columnas; c++) {
        const x = Math.min(capa.width - 1, Math.round((c + 0.5) * CELDA * dpr));
        const y = Math.min(capa.height - 1, Math.round((f + 0.5) * CELDA * dpr));
        if (datos[(y * capa.width + x) * 4 + 3] < 128) marcarCelda(f, c);
      }
    }
  }

  const progreso = () => Math.max(rascadas / rejilla.length / UMBRAL, enCentro / totalCentro / UMBRAL_CENTRO);

  // ───────────────────────── El pincel ─────────────────────────
  // Borde irregular, con motas: rascar no deja círculos perfectos.

  let radio = 21;
  let pinceles = [];

  function crearPinceles(r) {
    pinceles = [0, 1, 2, 3].map(() => {
      const tam = Math.ceil(r * 2 + 6);
      const lienzo = document.createElement('canvas');
      lienzo.width = lienzo.height = Math.ceil(tam * dpr);
      const p = lienzo.getContext('2d');
      p.scale(dpr, dpr);
      const m = tam / 2;
      p.fillStyle = '#000';
      p.beginPath();
      p.arc(m, m, r * 0.74, 0, Math.PI * 2);
      p.fill();
      for (let i = 0; i < 90; i++) {
        const angulo = Math.random() * Math.PI * 2;
        const distancia = r * (0.62 + Math.random() * 0.4);
        p.globalAlpha = 0.3 + Math.random() * 0.7;
        p.beginPath();
        p.arc(m + Math.cos(angulo) * distancia, m + Math.sin(angulo) * distancia, 0.5 + Math.random() * 2.2, 0, Math.PI * 2);
        p.fill();
      }
      return { lienzo, tam };
    });
  }

  function sellar(x, y) {
    const p = pinceles[(Math.random() * pinceles.length) | 0];
    ctx.globalCompositeOperation = 'destination-out';
    ctx.drawImage(p.lienzo, x - p.tam / 2, y - p.tam / 2, p.tam, p.tam);
    return marcar(x, y, radio * 0.8);
  }

  // ───────────────────────── Rascar ─────────────────────────

  let listo = false;
  let celebrado = false; // ya se ha llegado al nombre (campanita, destello…)
  let quitada = false;   // la capa se ha quitado entera con «Destapar sin rascar»
  let empezado = false;
  let trazo = null;
  let caja = null;
  let angulo = 0;

  /** El boleto está algo torcido: se deshace el giro para saber dónde se toca de verdad. */
  function leerAngulo() {
    const m = getComputedStyle(sombra).transform;
    const v = m && m.match(/matrix\(([^)]+)\)/);
    if (!v) return 0;
    const [a, b] = v[1].split(',').map(parseFloat);
    return Math.atan2(b, a);
  }

  function puntoLocal(ev) {
    const cx = caja.left + caja.width / 2;
    const cy = caja.top + caja.height / 2;
    const dx = ev.clientX - cx;
    const dy = ev.clientY - cy;
    const cos = Math.cos(-angulo);
    const sin = Math.sin(-angulo);
    return { x: dx * cos - dy * sin + ancho / 2, y: dx * sin + dy * cos + alto / 2 };
  }

  function empezar() {
    if (empezado) return;
    empezado = true;
    $('#pista').hidden = true;
  }

  function rascarHasta(x, y, t, clientX, clientY) {
    const dx = x - trazo.x;
    const dy = y - trazo.y;
    const distancia = Math.hypot(dx, dy);
    const pasos = Math.max(1, Math.ceil(distancia / (radio * 0.28)));
    let nuevas = 0;
    for (let i = 1; i <= pasos; i++) nuevas += sellar(trazo.x + (dx * i) / pasos, trazo.y + (dy * i) / pasos);
    const dt = Math.max(8, t - trazo.t);
    trazo.x = x;
    trazo.y = y;
    trazo.t = t;
    if (nuevas > 0) {
      soltarVirutas(clientX, clientY, Math.min(9, Math.ceil(nuevas * 0.45)), dx, dy);
      Sonido.rascar(distancia / dt);
      vibrar();
    }
    comprobar();
  }

  function comprobar() {
    if (celebrado) {
      if (rascadas / rejilla.length >= TODO) ponerEstado('Rascado hasta la última mota.');
      return;
    }
    const p = progreso();
    if (p >= 1) {
      celebrar();
      return;
    }
    if (p > 0.7) ponerEstado('¡Casi!');
    else if (p > 0.35) ponerEstado('Algo se ve ya…');
    else if (p > 0.02) ponerEstado('Eso es, sigue.');
  }

  capa.addEventListener('pointerdown', ev => {
    if (!listo || quitada || trazo) return;
    ev.preventDefault();
    try { capa.setPointerCapture(ev.pointerId); } catch (e) { /* sin captura también funciona */ }
    const r = ev.pointerType === 'mouse' ? 16 : 21;
    if (r !== radio || !pinceles.length) {
      radio = r;
      crearPinceles(r);
    }
    Sonido.preparar();
    caja = capa.getBoundingClientRect();
    angulo = leerAngulo();
    const p = puntoLocal(ev);
    trazo = { id: ev.pointerId, x: p.x, y: p.y, t: ev.timeStamp };
    empezar();
    rascarHasta(p.x, p.y, ev.timeStamp, ev.clientX, ev.clientY);
  });

  capa.addEventListener('pointermove', ev => {
    if (!trazo || ev.pointerId !== trazo.id || quitada) return;
    const seguidos = typeof ev.getCoalescedEvents === 'function' ? ev.getCoalescedEvents() : [];
    (seguidos.length ? seguidos : [ev]).forEach(e => {
      if (!trazo) return;
      const p = puntoLocal(e);
      rascarHasta(p.x, p.y, e.timeStamp, e.clientX, e.clientY);
    });
  });

  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(tipo => {
    capa.addEventListener(tipo, ev => {
      if (!trazo || ev.pointerId !== trazo.id) return;
      trazo = null;
      Sonido.parar();
      // En el móvil el sonido solo se puede activar al levantar el dedo: así suena desde el segundo trazo.
      Sonido.preparar();
    });
  });

  zona.addEventListener('contextmenu', ev => ev.preventDefault());

  // ───────────────────────── Destapar y tapar ─────────────────────────

  /** Se ha llegado al nombre: campanita y destello. Lo que queda de capa sigue ahí para seguir rascando. */
  function celebrar() {
    if (celebrado) return;
    celebrado = true;
    empezar();
    escena.classList.add('destapado');
    $('#premio').removeAttribute('aria-hidden');
    ponerEstado('Ya lo sabes. Ahora, ni una palabra 🤫');
    $('#anuncio').textContent = `Te toca regalar a ${boleto.a}.`;
    $('#btn-destapar').hidden = true;
    $('#btn-tapar').hidden = false;
    Sonido.campanita();
    vibrar([14, 60, 26]);
    const nombre = $('#nombre').getBoundingClientRect();
    destello(nombre.left + nombre.width / 2, nombre.top + nombre.height / 2);
  }

  /** «Destapar sin rascar»: aquí sí se quita la capa entera. */
  function destapar() {
    trazo = null;
    Sonido.parar();
    quitada = true;
    capa.classList.add('fuera');
    celebrar();
  }

  function tapar() {
    celebrado = false;
    quitada = false;
    escena.classList.remove('destapado');
    $('#premio').setAttribute('aria-hidden', 'true');
    $('#anuncio').textContent = '';
    prepararLienzo();
    pintarCapa();
    crearRejilla();
    capa.classList.remove('fuera');
    ponerEstado('Tapado otra vez, por si alguien miraba.');
    $('#btn-tapar').hidden = true;
    $('#btn-destapar').hidden = false;
  }

  $('#btn-destapar').addEventListener('click', () => {
    Sonido.preparar();
    destapar();
  });
  $('#btn-tapar').addEventListener('click', tapar);

  // ───────────────────────── Virutas y destellos ─────────────────────────

  const particulas = [];
  let animando = false;
  let ultimoFotograma = 0;

  function redimensionarVirutas() {
    const d = Math.min(window.devicePixelRatio || 1, 2);
    lienzoVirutas.width = Math.round(innerWidth * d);
    lienzoVirutas.height = Math.round(innerHeight * d);
    vctx.setTransform(d, 0, 0, d, 0, 0);
  }

  function soltarVirutas(x, y, cantidad, dx, dy) {
    if (reducirMovimiento) return;
    const largo = Math.hypot(dx, dy) || 1;
    for (let i = 0; i < cantidad && particulas.length < 320; i++) {
      particulas.push({
        tipo: 'viruta',
        x: x + (Math.random() - 0.5) * radio,
        y: y + (Math.random() - 0.5) * radio * 0.6,
        vx: (Math.random() - 0.5) * 2.4 + (dx / largo) * 1.2,
        vy: -Math.random() * 2.2 - 0.4,
        g: 0.17 + Math.random() * 0.1,
        roce: 0.985,
        rot: Math.random() * Math.PI * 2,
        giro: (Math.random() - 0.5) * 0.5,
        tam: 1.2 + Math.random() * 2.6,
        color: ORO[(Math.random() * ORO.length) | 0],
        forma: [Math.random(), Math.random(), Math.random(), Math.random()].map(v => 0.55 + v * 0.45),
        edad: 0,
        vida: 55 + Math.random() * 45,
      });
    }
    arrancar();
  }

  function destello(x, y) {
    if (reducirMovimiento) return;
    for (let i = 0; i < 34; i++) {
      const direccion = Math.random() * Math.PI * 2;
      const velocidad = 2 + Math.random() * 4.5;
      particulas.push({
        tipo: 'estrella',
        x,
        y,
        vx: Math.cos(direccion) * velocidad,
        vy: Math.sin(direccion) * velocidad - 1.2,
        g: 0.06,
        roce: 0.965,
        rot: Math.random() * Math.PI * 2,
        giro: (Math.random() - 0.5) * 0.2,
        tam: 3 + Math.random() * 5,
        color: ['#f3e4b8', '#e0c690', '#fffaf0', '#c4a46a'][(Math.random() * 4) | 0],
        edad: 0,
        vida: 60 + Math.random() * 40,
      });
    }
    arrancar();
  }

  function arrancar() {
    if (animando) return;
    animando = true;
    ultimoFotograma = performance.now();
    requestAnimationFrame(fotograma);
  }

  function dibujarViruta(p) {
    const t = p.tam;
    const f = p.forma;
    vctx.beginPath();
    vctx.moveTo(-t * f[0], -t * 0.6 * f[1]);
    vctx.lineTo(t * f[1], -t * 0.5 * f[2]);
    vctx.lineTo(t * f[2], t * 0.6 * f[3]);
    vctx.lineTo(-t * f[3], t * 0.5 * f[0]);
    vctx.closePath();
    vctx.fill();
  }

  /** Estrella de cuatro puntas, como la ✦ del correo. */
  function dibujarEstrella(t) {
    const k = t * 0.14;
    vctx.beginPath();
    vctx.moveTo(0, -t);
    vctx.quadraticCurveTo(k, -k, t, 0);
    vctx.quadraticCurveTo(k, k, 0, t);
    vctx.quadraticCurveTo(-k, k, -t, 0);
    vctx.quadraticCurveTo(-k, -k, 0, -t);
    vctx.fill();
  }

  function fotograma(ahora) {
    const dt = Math.min(3, (ahora - ultimoFotograma) / 16.67);
    ultimoFotograma = ahora;
    vctx.clearRect(0, 0, innerWidth, innerHeight);
    for (let i = particulas.length - 1; i >= 0; i--) {
      const p = particulas[i];
      p.edad += dt;
      p.vy += p.g * dt;
      p.vx *= Math.pow(p.roce, dt);
      if (p.tipo === 'estrella') p.vy *= Math.pow(p.roce, dt);
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.giro * dt;
      if (p.edad > p.vida || p.y > innerHeight + 30) {
        particulas.splice(i, 1);
        continue;
      }
      vctx.save();
      vctx.globalAlpha = Math.max(0, Math.min(1, (p.vida - p.edad) / (p.vida * 0.35)));
      vctx.translate(p.x, p.y);
      vctx.rotate(p.rot);
      if (p.tipo === 'estrella') {
        vctx.fillStyle = p.color;
        dibujarEstrella(p.tam);
      } else {
        // Al girar, alguna viruta pilla la luz
        vctx.fillStyle = Math.cos(p.rot * 2) > 0.75 ? '#fff6dc' : p.color;
        dibujarViruta(p);
      }
      vctx.restore();
    }
    if (particulas.length) {
      requestAnimationFrame(fotograma);
    } else {
      animando = false;
      vctx.clearRect(0, 0, innerWidth, innerHeight);
    }
  }

  // ───────────────────────── Tamaño ─────────────────────────

  let esperaTamano = null;
  window.addEventListener('resize', () => {
    clearTimeout(esperaTamano);
    esperaTamano = setTimeout(reajustar, 120);
  });

  function reajustar() {
    redimensionarVirutas();
    ajustarNombre();
    colocarCorte();
    if (!listo) return;
    if (Math.abs(zona.offsetWidth - ancho) < 1 && Math.abs(zona.offsetHeight - alto) < 1) return;
    if (quitada) {
      prepararLienzo();
      pintarCapa();
      crearRejilla();
      return;
    }
    // Se conserva lo rascado: se copia, se cambia el tamaño y se vuelve a pegar
    const copia = document.createElement('canvas');
    copia.width = capa.width;
    copia.height = capa.height;
    copia.getContext('2d').drawImage(capa, 0, 0);
    prepararLienzo();
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(copia, 0, 0, capa.width, capa.height);
    ctx.restore();
    if (pinceles.length) crearPinceles(radio);
    recontar();
  }

  // ───────────────────────── Arranque ─────────────────────────

  rellenar();
  escena.hidden = false;
  $('#btn-sonido').hidden = !(window.AudioContext || window.webkitAudioContext || navigator.vibrate);
  pintarBotonSonido();
  redimensionarVirutas();
  ajustarNombre();
  colocarCorte();

  // Se espera a las fuentes (para el rótulo de la capa), pero como mucho un segundo y medio.
  const fuentes = document.fonts && document.fonts.load
    ? Promise.all([document.fonts.load('600 14px Figtree'), document.fonts.load('italic 400 54px Fraunces')]).catch(() => null)
    : Promise.resolve();
  Promise.race([fuentes, new Promise(r => setTimeout(r, 1500))]).then(() => {
    ajustarNombre();
    colocarCorte();
    prepararLienzo();
    pintarCapa();
    crearRejilla();
    listo = true;
    tarjeta.classList.add('listo');
    ponerEstado(conDedo ? 'Rasca con el dedo.' : 'Rasca con el ratón: mantén pulsado y arrastra.');
  });
})();
