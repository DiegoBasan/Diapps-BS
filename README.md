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
| `/ciudad/` | Mi Ciudad: mapa isométrico donde cada barrio es una app y los edificios crecen con tus datos. |
| `/control/` | Control: tablero de rendimiento con relieve de actividad, alertas y estado de todas tus apps. |
| `/compa/` | Compa: robot 3D en una isla flotante con un objeto por app; reacciona a tus datos, camina a cada objeto y permite check-in de hábitos. |
| `/linea/` | Línea: tablero de la línea de ensamble de tractores con escena 3D (PBR, sombras y oclusión ambiental), estaciones con andon, órdenes, OEE y alarmas simuladas. |
| `/ruta/` | Ruta: navegación en tiempo real con tu ubicación (búsqueda, rutas alternativas, indicaciones por voz, recálculo, gasolineras, costo del viaje y km al Jetta). |
| `/papeles/` | Papeles: carpetas de documentos en un carrusel 3D, con fotos/PDF guardados en el dispositivo y fechas de vencimiento. |
| `/neon/` | Neón: juego de mundo abierto. Vuelas una nave futurista por una ciudad procedural infinita (ventanas, neón y anuncios por shader, niebla de altura, lluvia, día/noche, bloom, GTAO, reflejos en vivo), con tráfico aéreo, drones patrulla y carreras de anillos. Modelos de Sketchfab. |
| `/bruma/` | Bruma: manejo libre de un Jetta A6 gris en una ciudad con niebla y lluvia. Three.js r186 con WebGPU (o WebGL2): reflejos en pantalla sobre el asfalto mojado, niebla volumétrica iluminada por faroles y faros, TRAA, GTAO y bloom. Física de vehículo con suspensión, llantas, ABS y control de tracción. Edificios, autos y texturas de Sketchfab. |
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

## Bruma: compilar

`bruma/` usa Three.js r186 (WebGPU) empaquetado con esbuild. El código está en `bruma/src/` y el resultado en
`bruma/app.js`, que es el que se publica. Después de cambiar algo en `src/`: `cd bruma && npm install && npm run build`.

## Cuenta y respaldo (`shared/nube.js`)

Firebase Authentication (correo y contraseña) + Firestore por REST, sin SDK. Cada app guarda su documento en
`users/{uid}/apps/{app}`; las reglas de Firestore solo dejan a cada cuenta leer y escribir lo suyo.
La configuración web de Firebase no es secreta. Incluye bloqueo con Face ID (passkey del dispositivo).

## Modo escritorio (`shared/desk.css`, `shared/desk.js`)

En pantallas de 1100px o más: el inicio se vuelve un mega dashboard que resume los datos de todas las apps
(leídos del almacenamiento del navegador) y cada app muestra todas sus pantallas a la vez en columnas.

## Créditos de modelos 3D
- `jetta/models/concept.glb`: "Car Concept" de Khronos Group (glTF-Sample-Assets), basado en un modelo CC0 de Unity Fan. Licencia CC BY 4.0 (ver `jetta/models/LICENSE-CarConcept.md`). Se quitaron texturas y logotipos y se simplificó la geometría para el HUD.
- `compa/models/robot.glb`: "RobotExpressive" de Tomás Laulhé (Quaternius), CC0, con modificaciones de Don McCurdy.
- `compa/models/sedan.glb` y `box.glb`: Car Kit de Kenney, CC0.
- `linea/models/tractor.glb`: Car Kit de Kenney, CC0.
- `shared/vendor/maplibre`: MapLibre GL JS 4.7.1 (BSD-3). Mapas: © colaboradores de OpenStreetMap (ODbL), estilos de OpenFreeMap y CARTO. Búsqueda: Photon (komoot). Rutas: OSRM (servidor de FOSSGIS routing.openstreetmap.de y demo de OSRM). Gasolineras: Overpass API.
- `neon/models/*.glb`: 11 modelos de Sketchfab con licencia CC BY 4.0 (naves, autos voladores, pirámide, rascacielos, letreros de neón y dron). Autores y enlaces en `neon/models/CREDITOS.md` y en el menú del juego → Créditos.
- `bruma/models/*.glb` y `bruma/textures/`: modelos de Sketchfab con licencia CC BY 4.0 (Jetta A6, Corolla, edificios, farol, multitud, calle mojada y fachadas). Autores y enlaces en `bruma/models/CREDITOS.md` y en el menú del juego.
- `shared/vendor/three`: Three.js r160 (MIT), con addons de posprocesado (GTAO, bloom) y RoomEnvironment.
