# Amigo Invisible

App web para hacer el sorteo del amigo invisible **desde el móvil**: a cada participante le llega un correo con la persona a la que tiene que regalar. Nadie, ni siquiera quien organiza, ve el resultado completo.

- **Web** (GitHub Pages): `index.html`, `css/`, `js/`. Participantes, ajustes del evento y el sorteo.
- **Servidor** (Google Apps Script): `backend/Code.gs`. Hace el sorteo, guarda las reglas privadas y manda los correos desde tu cuenta de Gmail.

```
Móvil ──(lista + clave)──▶ Apps Script ──▶ sorteo (+ reglas privadas) ──▶ Gmail ──▶ cada participante
  ◀──── "enviado a Ana, Luis…" (sin resultados) ────┘
```

## Qué hace

- **Participantes** con nombre y correo. Se pueden pegar de golpe desde un Excel o una lista.
- **Modo prueba** (activado por defecto): todos los correos te llegan a ti y a los participantes no les llega nada.
- **Protección contra repeticiones**: no deja repetir un sorteo real sin avisar antes.
- **Reenvío** del correo a quien no le haya llegado, con la misma persona y, si hace falta, a otra dirección.
- **Lista en la nube**: prepárala en el ordenador y haz el sorteo desde el móvil.
- **Vista previa** del correo y opción de instalar la app en la pantalla de inicio.
- **Opciones del organizador** (privadas):
  - Exclusiones: parejas que no se pueden tocar entre sí.
  - Asignaciones fijas: que a alguien le toque sí o sí una persona concreta. Al resto se le sortea como siempre.
  - Evitar parejas cruzadas (que A le regale a B y B a A).
  - Se guardan en el servidor, no en el móvil.
  - Para verlas hay que escribir la clave cada vez.
  - No aparecen en ninguna otra parte de la app ni en los correos.
  - Si las reglas hacen imposible el sorteo, el error que se ve no menciona a nadie.

---

## 1. Servidor en Google Apps Script

Hazlo con la cuenta desde la que quieres que salgan los correos.

1. Entra en <https://script.google.com> → **Nuevo proyecto** y llámalo `Amigo invisible`.
2. Borra el contenido de `Código.gs` y pega todo [`backend/Code.gs`](backend/Code.gs).
3. *(Opcional, recomendado)* ⚙️ **Configuración del proyecto** → marca «Mostrar el archivo de manifiesto `appsscript.json`» y pega en él [`backend/appsscript.json`](backend/appsscript.json). Así el script pide solo los permisos mínimos.
4. ⚙️ **Configuración del proyecto** → **Propiedades del script** → **Añadir propiedad**:
   - `CLAVE`: una contraseña larga que solo sepas tú.
   - *(Opcional)* `EMAIL_PRUEBA`: dónde quieres recibir las pruebas. Por defecto llegan a la propia cuenta.
5. En el editor, elige `comprobarConfiguracion` y pulsa **▶ Ejecutar**.
   - Google avisará de que la aplicación no está verificada: es tu propio script.
   - Pulsa *Configuración avanzada* → *Ir a Amigo invisible (no seguro)* → *Permitir*.
   - Esta función **no envía nada**.
   - Si tienes varias cuentas de Google abiertas y da error, hazlo en una ventana de incógnito.
6. *(Opcional)* Ejecuta `enviarCorreoDeMuestra` para recibir **en tu propia cuenta** un correo de ejemplo.
7. **Implementar** → **Nueva implementación** → tipo **Aplicación web**:
   - *Ejecutar como*: **Yo**
   - *Quién tiene acceso*: **Cualquier usuario**
8. Copia la **URL de la aplicación web** (termina en `/exec`).

> **Cada vez que cambies `Code.gs`**: pega el código nuevo, guarda y ve a *Implementar → Gestionar implementaciones → ✏️ Editar → Versión: Nueva versión → Implementar*. Así la URL no cambia.

## 2. Conectar la web con el servidor

Pega la URL en [`js/config.js`](js/config.js):

```js
window.AMIGO_CONFIG = {
  urlBackend: 'https://script.google.com/macros/s/XXXXXXXX/exec'
};
```

La URL no es secreta: sin la `CLAVE` el servidor no hace nada, y tras 8 intentos fallidos se bloquea 15 minutos.

## 3. Publicar en GitHub Pages

1. Crea un repositorio en GitHub (p. ej. `amigo-invisible`) y sube esta carpeta.
2. En el repositorio, ve a **Settings → Pages**. En *Source* elige **Deploy from a branch**, en *Branch* `main` / `/ (root)`, y pulsa **Save**.
3. En un minuto estará en `https://TU-USUARIO.github.io/amigo-invisible/`.

> El repositorio es **público**. El `.gitignore` deja fuera la carpeta `old/`, los `.xlsx` y los `.ipynb`, porque contienen correos reales. La lista vive en el navegador y, si la subes, en las propiedades de tu script de Google.

## 4. Hacer el sorteo

1. **Ajustes**:
   - Escribe la clave y pulsa *Comprobar conexión*.
   - Rellena fecha, presupuesto, lugar y, si quieres, un mensaje para todos (sale justo después del saludo).
2. **Participantes**: añade a la gente (o pega la lista).
3. **Ajustes → Opciones del organizador**: pon las exclusiones y asignaciones fijas que quieras. Nadie más las ve.
4. **Sorteo**:
   - Primero en **Prueba**: te llegan todos los correos a ti.
   - Después cambia a **Real** y pulsa *Sortear*.

Si a alguien no le llega el correo, usa *Reenviar un correo* en la pantalla del sorteo.

## Editar el correo

El diseño y los textos del correo están en [`backend/Code.gs`](backend/Code.gs), en la sección **Correos**:
- `EMOJI_CORREO`: el emoji que sale encima del nombre.
- `COLORES_CORREO`: los colores, cada uno con su versión en claro y en modo oscuro.
- `htmlCorreo_`: el diseño.
- `textoCorreo_`: la versión en texto plano.

Sobre el modo oscuro:
- Mail del iPhone, Apple Mail y Outlook usan los colores oscuros de `COLORES_CORREO`.
- Gmail no deja elegirlos: en el móvil aplica su propio modo oscuro.

Para ver los cambios al momento, sin enviar nada:

```
node herramientas/vista-correo.js
```

Se abre el navegador con el correo en tamaño móvil y ordenador.
- Cada vez que guardas `Code.gs`, la página se recarga sola.
- Arriba puedes cambiar el nombre, el presupuesto, la fecha o el mensaje.
- En *Modo* puedes verlo en claro, en oscuro y en una aproximación del oscuro de Gmail.
- Puedes ver también la versión de prueba y el texto plano.
- Para pararla, pulsa `Ctrl + C`.

Cuando te guste, pega el `Code.gs` nuevo en Apps Script y publica una **nueva versión** (ver el aviso del paso 1).

## Límites

- Una cuenta gratuita de Gmail puede mandar unos **100 correos al día** desde Apps Script. La app avisa si no quedan suficientes.
- Máximo 50 participantes por sorteo.

## Tests

Requieren Node 18 o superior. No envían ningún correo: los servicios de Google están simulados y solo se usan direcciones `@example.com`.

```
node --test tests/*.test.js
```

## Estructura

```
index.html              Interfaz (Participantes, Sorteo, Ajustes)
css/estilos.css         Estilos
js/app.js               Lógica de la web
js/sorteo.js            Algoritmo del sorteo (para comprobar las reglas en el panel privado)
js/config.js            URL del servidor
backend/Code.gs         Servidor: sorteo, reglas privadas y envío de correos
backend/appsscript.json Manifiesto con los permisos mínimos
herramientas/           Vista previa del correo en directo
tests/                  Tests de Node
img/, manifest.webmanifest  Iconos e instalación como app
```
