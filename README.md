# Diapps-BS

Repo de pruebas con varias apps web. Se publica con GitHub Pages:
https://diegobasan.github.io/Diapps-BS/

| Ruta | Qué es |
| --- | --- |
| `/` | Selector de proyectos (carpetas). Cada carpeta abre su app. |
| `/jetta/` | Mi Jetta MK6: tablero, servicio, testigos y fallas. |
| `/habitos/` | Rutinas: hábitos diarios y semanales con reloj del día, semana, progreso y fuerza de cada hábito. |
| `/musica/` | Riff: YouTube con loop y velocidad, audio propio con cambio de tono, acordes en diagrama y diapasón con escalas para el solo. |
| `/cajas/` | Cajas: mapa de contenedores a escala, fotos de cada caja abierta y buscador de contenido. |
| `/finanzas/` | Mis Finanzas: gastos, presupuesto, regla 50/30/20, mapa de gasto y asistente local. |

## Agregar un proyecto

1. Crea una carpeta nueva, por ejemplo `mi-app/`, con su `index.html`.
2. Agrega una entrada al arreglo `PROJECTS` en `index.html` con `href: "mi-app/"`.
   Sin `href`, la carpeta aparece como "Próximamente".

Cada app puede tener su propio `manifest.webmanifest`, íconos y `sw.js` dentro de su carpeta
para instalarse por separado en la pantalla de inicio del iPhone. Los service workers solo borran
cachés con su propio prefijo (`hub-`, `jetta-`, …) para no pisarse entre apps.

## IA

`shared/ia.js` concentra las llamadas a Gemini para todas las apps (búsqueda de canciones en Riff,
asistente de Finanzas, Coach de Rutinas, detección de contenido en Cajas y mecánico en Mi Jetta).
La clave no está en el código (el repo es público): cada app la pide la primera vez que usa la IA
y la guarda solo en el dispositivo. En Riff → menú → Búsqueda con IA se puede cambiar.

## Servidor de búsqueda de Riff (`riff-api/`)

Función de Netlify que busca de verdad lo que la app no puede pedir directo desde Safari (CORS):

- `/api/yt?q=` — resultados reales de YouTube y si cada video deja verse fuera de YouTube.
- `/api/cifra?artist=&title=` o `?url=` — acordes, tonalidad, cejilla, afinación, letra con acordes y tabs de Cifra Club.
- `/api/tabs?q=` — tablaturas en Songsterr.

La IA solo interpreta qué canción se escribió; si no está en Cifra Club, genera los acordes como respaldo.
Para desplegar: en Netlify → Add new project → Import from GitHub → este repo, con **Base directory** `riff-api`.
La app usa `https://diapps-riff.netlify.app` por defecto; otra dirección se cambia en Riff → menú → Búsqueda con IA.

## Cuenta y respaldo (`shared/nube.js`)

Firebase Authentication (correo y contraseña) + Firestore por REST, sin SDK. Cada app guarda su documento en
`users/{uid}/apps/{app}`; las reglas de Firestore solo dejan a cada cuenta leer y escribir lo suyo.
La configuración web de Firebase no es secreta. Incluye bloqueo con Face ID (passkey del dispositivo).

## Modo escritorio (`shared/desk.css`, `shared/desk.js`)

En pantallas de 1100px o más: el inicio se vuelve un mega dashboard que resume los datos de todas las apps
(leídos del almacenamiento del navegador) y cada app muestra todas sus pantallas a la vez en columnas.
