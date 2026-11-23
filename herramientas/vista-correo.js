/*
 * Vista previa del correo en directo.
 *
 *   node herramientas/vista-correo.js
 *
 * Abre el navegador con el correo tal y como lo genera backend/Code.gs, en
 * tamaño móvil y ordenador. Cada vez que guardas Code.gs la página se recarga
 * sola. Arriba puedes cambiar los datos de ejemplo (nombre, presupuesto…).
 *
 * No envía nada: solo pinta el HTML con datos inventados.
 * Para pararlo: Ctrl + C.
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { exec } = require('node:child_process');

const PUERTO = Number(process.env.PUERTO) || 4321;
const CODIGO = path.join(__dirname, '..', 'backend', 'Code.gs');

const EJEMPLO = {
  nombre: 'Lucía',
  asignado: 'Valeria',
  titulo: 'Navidad 2026',
  presupuesto: '20 €',
  fecha: '24 de diciembre',
  mensaje: 'Nada de calcetines, por favor.',
};

function cargarCodigo() {
  const contexto = { console };
  vm.createContext(contexto);
  vm.runInContext(fs.readFileSync(CODIGO, 'utf8'), contexto, { filename: 'Code.gs' });
  return contexto;
}

function renderizar(parametros) {
  const valor = campo => (parametros.has(campo) ? parametros.get(campo) : EJEMPLO[campo]);
  const prueba = parametros.get('prueba') === '1';
  const gs = cargarCodigo();
  const ajustes = gs.validarAjustes_({ titulo: valor('titulo'), presupuesto: valor('presupuesto'), fecha: valor('fecha'), mensaje: valor('mensaje') });
  const datos = { nombre: valor('nombre'), asignado: valor('asignado'), ajustes, prueba, emailReal: 'lucia@ejemplo.com' };
  return {
    asunto: gs.asuntoCorreo_(datos.nombre, ajustes, prueba),
    html: gs.htmlCorreo_(datos),
    texto: gs.textoCorreo_(datos),
  };
}

const escapar = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const PAGINA = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>Vista previa del correo</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; font: 14px/1.4 system-ui, -apple-system, 'Segoe UI', sans-serif; color: #e9e4da; background: #171b19; }
  header { position: sticky; top: 0; z-index: 1; display: flex; flex-wrap: wrap; gap: 10px 16px; align-items: end; padding: 14px 20px; background: #0f1311; border-bottom: 1px solid #29302c; }
  h1 { flex: 1 1 100%; margin: 0; font-size: 15px; font-weight: 600; }
  label { display: grid; gap: 4px; font-size: 12px; color: #a59e92; }
  label.check { display: flex; align-items: center; gap: 6px; padding-bottom: 6px; color: #e9e4da; }
  input[type=text] { width: 140px; padding: 6px 8px; font: inherit; color: inherit; background: #1c221f; border: 1px solid #343c37; border-radius: 6px; }
  input#mensaje { width: 260px; }
  .asunto { flex: 1 1 100%; color: #a59e92; }
  .asunto b { color: #e9e4da; font-weight: 600; }
  .estado { margin-left: auto; padding-bottom: 6px; font-size: 12px; color: #6f7b74; }
  .estado.error { color: #e0907f; }
  main { display: flex; flex-wrap: wrap; gap: 28px; justify-content: center; align-items: flex-start; padding: 28px 20px 60px; }
  figure { margin: 0; }
  figcaption { margin-bottom: 8px; font-size: 12px; color: #6f7b74; text-align: center; }
  iframe { display: block; border: 0; border-radius: 12px; background: #fff; box-shadow: 0 12px 40px rgba(0, 0, 0, .45); }
  #movil { width: 390px; height: 860px; }
  #escritorio { width: 720px; height: 860px; }
</style>
</head>
<body>
<header>
  <h1>Vista previa del correo <span style="font-weight:400;color:#6f7b74">— se recarga sola al guardar backend/Code.gs</span></h1>
  <label>Nombre<input type="text" id="nombre"></label>
  <label>Le toca<input type="text" id="asignado"></label>
  <label>Título<input type="text" id="titulo"></label>
  <label>Presupuesto<input type="text" id="presupuesto"></label>
  <label>Fecha<input type="text" id="fecha"></label>
  <label>Mensaje para todos<input type="text" id="mensaje"></label>
  <label class="check"><input type="checkbox" id="prueba"> Versión de prueba</label>
  <label class="check"><input type="checkbox" id="texto"> Texto plano</label>
  <span class="estado" id="estado"></span>
  <div class="asunto">Asunto: <b id="asunto"></b></div>
</header>
<main>
  <figure><figcaption>Móvil · 390 px</figcaption><iframe id="movil" title="Correo en móvil"></iframe></figure>
  <figure><figcaption>Ordenador · 720 px</figcaption><iframe id="escritorio" title="Correo en ordenador"></iframe></figure>
</main>
<script>
  var EJEMPLO = ${JSON.stringify(EJEMPLO)};
  var CAMPOS = ['nombre', 'asignado', 'titulo', 'presupuesto', 'fecha', 'mensaje'];
  var $ = function (id) { return document.getElementById(id); };
  CAMPOS.forEach(function (c) { $(c).value = EJEMPLO[c]; });

  function parametros() {
    var p = new URLSearchParams();
    CAMPOS.forEach(function (c) { p.set(c, $(c).value); });
    p.set('prueba', $('prueba').checked ? '1' : '0');
    p.set('texto', $('texto').checked ? '1' : '0');
    return p.toString();
  }

  function actualizar() {
    var p = parametros();
    fetch('/datos?' + p).then(function (r) { return r.json(); }).then(function (d) {
      $('asunto').textContent = d.asunto || '—';
      var estado = $('estado');
      estado.className = 'estado' + (d.error ? ' error' : '');
      estado.textContent = d.error ? 'Hay un error en Code.gs (míralo abajo)' : 'Actualizado a las ' + new Date().toLocaleTimeString('es-ES');
    });
    var src = '/correo?' + p + '&t=' + Date.now();
    $('movil').src = src;
    $('escritorio').src = src;
  }

  var espera;
  document.querySelectorAll('input').forEach(function (i) {
    i.addEventListener('input', function () { clearTimeout(espera); espera = setTimeout(actualizar, 250); });
  });
  new EventSource('/eventos').onmessage = actualizar;
  actualizar();
</script>
</body>
</html>`;

const clientes = new Set();

const servidor = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(PAGINA);
  }

  if (url.pathname === '/eventos') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write('retry: 1000\n\n');
    clientes.add(res);
    req.on('close', () => clientes.delete(res));
    return undefined;
  }

  let resultado;
  try {
    resultado = renderizar(url.searchParams);
  } catch (err) {
    resultado = { error: (err && err.stack) || String(err) };
  }

  if (url.pathname === '/datos') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ asunto: resultado.asunto, error: resultado.error || null }));
  }

  if (url.pathname === '/correo') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    if (resultado.error) {
      return res.end(`<pre style="margin:0;padding:20px;font:13px/1.5 Consolas,monospace;white-space:pre-wrap;color:#8a1f12;background:#fff4f1;min-height:100vh">${escapar(resultado.error)}</pre>`);
    }
    if (url.searchParams.get('texto') === '1') {
      return res.end(`<pre style="margin:0;padding:24px;font:15px/1.6 Consolas,monospace;white-space:pre-wrap;color:#222;background:#fff;min-height:100vh">${escapar(resultado.texto)}</pre>`);
    }
    return res.end(resultado.html);
  }

  res.writeHead(404);
  return res.end();
});

servidor.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    console.error(`El puerto ${PUERTO} está ocupado. ¿Ya tienes la vista previa abierta? Si no, prueba con otro puerto, por ejemplo en PowerShell:  $env:PUERTO=4322; node herramientas/vista-correo.js`);
  } else {
    console.error(err);
  }
  process.exit(1);
});

// Solo escucha en este ordenador (127.0.0.1), no en la red.
servidor.listen(PUERTO, '127.0.0.1', () => {
  const direccion = `http://localhost:${PUERTO}`;
  console.log(`Vista previa del correo en ${direccion}`);
  console.log('Edita backend/Code.gs y guarda: la página se recarga sola. Ctrl + C para parar.');
  if (process.env.NO_ABRIR) return;
  const abrir = process.platform === 'win32' ? `start "" "${direccion}"` : process.platform === 'darwin' ? `open "${direccion}"` : `xdg-open "${direccion}"`;
  exec(abrir, () => { /* si no se puede abrir, la dirección ya está en la consola */ });
});

fs.watchFile(CODIGO, { interval: 250 }, (actual, anterior) => {
  if (actual.mtimeMs === anterior.mtimeMs) return;
  console.log(`[${new Date().toLocaleTimeString('es-ES')}] Code.gs guardado → recargando`);
  clientes.forEach(cliente => cliente.write('data: cambio\n\n'));
});
