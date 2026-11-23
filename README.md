# 🎄 Amigo Invisible

App web para hacer el sorteo del Amigo Invisible **desde el móvil**: a cada participante le llega un correo navideño con la persona a la que tiene que regalar. Nadie, ni siquiera quien organiza, ve el resultado.

- **Web** (GitHub Pages): `index.html`, `css/`, `js/`. Aquí se gestionan participantes, exclusiones y detalles del evento.
- **Servidor** (Google Apps Script): `backend/Code.gs`. Hace el sorteo y envía los correos desde tu cuenta de Gmail.

```
Móvil ──(lista + clave)──▶ Apps Script ──▶ sorteo ──▶ Gmail ──▶ 📧 cada participante
  ◀──── "enviado a Ana, Luis…" (sin resultados) ────┘
```

## Funciones

- 👥 Participantes con nombre y correo. Se pueden pegar desde un Excel o una lista.
- 🚫 Exclusiones mutuas (parejas, hermanos…) y opción de evitar intercambios cruzados (A→B y B→A).
- ✅ Comprueba al momento si el sorteo es posible con esas reglas.
- 🧪 **Modo prueba** (activado por defecto): todos los correos llegan a tu cuenta y ninguno a los participantes.
- 🔒 Protección para no repetir un sorteo real por error.
- 📮 Reenvío del correo a quien no le haya llegado, con el mismo amigo invisible (también a una dirección corregida).
- ☁️ Lista guardada en la nube para prepararla en el ordenador y sortear desde el móvil.
- 👀 Vista previa del correo, y la app se puede instalar en la pantalla de inicio del móvil.

---

## 1. Servidor en Google Apps Script

Hazlo con la cuenta desde la que quieres que salgan los correos (p. ej. la cuenta del Amigo Invisible).

1. Entra en <https://script.google.com> → **Nuevo proyecto** y llámalo `Amigo Invisible`.
2. Borra el contenido de `Código.gs` y pega todo [`backend/Code.gs`](backend/Code.gs).
3. *(Opcional, recomendado)* ⚙️ **Configuración del proyecto** → marca «Mostrar el archivo de manifiesto `appsscript.json`» y pega en él [`backend/appsscript.json`](backend/appsscript.json). Así el script pide solo los permisos mínimos.
4. ⚙️ **Configuración del proyecto** → **Propiedades del script** → **Añadir propiedad**:
   - `CLAVE` = una contraseña larga que solo sepas tú (es la que escribirás en la app).
   - *(Opcional)* `EMAIL_PRUEBA` = el correo donde quieres recibir las pruebas. Por defecto llegan a la propia cuenta.
5. En el editor, elige la función `comprobarConfiguracion` y pulsa **▶ Ejecutar**. Google pedirá permisos: *Revisar permisos* → tu cuenta → *Configuración avanzada* → *Ir a Amigo Invisible (no seguro)* → *Permitir*. Es tu propio script. Esta función **no envía nada**: solo muestra en el registro si todo está bien.
6. *(Opcional)* Ejecuta `enviarCorreoDeMuestra` para recibir **en tu propia cuenta** un correo de ejemplo y ver el diseño.
7. **Implementar** → **Nueva implementación** → tipo ⚙️ **Aplicación web**:
   - *Ejecutar como*: **Yo**
   - *Quién tiene acceso*: **Cualquier usuario**
8. Copia la **URL de la aplicación web** (termina en `/exec`).

> **Si cambias el código más adelante**: *Implementar → Gestionar implementaciones → ✏️ Editar → Versión: Nueva versión*. Así la URL no cambia.

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
2. En el repositorio: **Settings → Pages → Build and deployment** → *Source*: **Deploy from a branch** → *Branch*: `main` / `/ (root)` → **Save**.
3. En un minuto estará en `https://TU-USUARIO.github.io/amigo-invisible/`.

> ⚠️ El repositorio es **público**. El `.gitignore` deja fuera los `.xlsx` y los `.ipynb` antiguos porque contienen correos reales. No subas listas de correos al repositorio: la lista vive en el navegador del móvil y, si quieres, en las propiedades de tu script de Google.

## 4. Hacer el sorteo desde el móvil

1. Abre la web en el móvil. Para instalarla: en Android, menú ⋮ → *Instalar app*; en iPhone, *Compartir* → *Añadir a pantalla de inicio*.
2. **⚙️ Ajustes**: escribe la `CLAVE` y pulsa **Probar conexión**. Rellena título, presupuesto, fecha y mensaje.
3. **👥 Gente**: añade a los participantes (o pégalos de golpe).
4. **🚫 Exclusiones**: añade las parejas que no pueden tocarse.
5. **🎁 Sorteo**:
   - Primero en **🧪 Prueba**: te llegan todos los correos a ti. Comprueba que se ven bien.
   - Después cambia a **🎅 De verdad** y toca el regalo. 🎉

Si a alguien no le llega el correo, usa **Reenviar un correo** en la pantalla del sorteo.

**Truco**: prepara la lista en el ordenador, pulsa *Subir lista* (Ajustes) y en el móvil pulsa *Bajar lista*.

## Límites

- Gmail gratuito permite unos **100 correos al día** desde Apps Script. La app avisa si no quedan suficientes.
- Máximo 50 participantes por sorteo.

## Tests

Requieren Node 18 o superior. No envían ningún correo: los servicios de Google están simulados y solo se usan direcciones `@example.com`.

```
node --test tests/*.test.js
```

## Estructura

```
index.html              Interfaz (4 pestañas: Gente, Exclusiones, Ajustes, Sorteo)
css/estilos.css         Estilos navideños
js/app.js               Lógica de la web
js/sorteo.js            Algoritmo del sorteo (para comprobar si es posible)
js/config.js            URL del servidor
backend/Code.gs         Servidor: sorteo + envío de correos (Google Apps Script)
backend/appsscript.json Manifiesto con los permisos mínimos
tests/                  Tests de Node
img/, manifest.webmanifest  Iconos e instalación como app
```
