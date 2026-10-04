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
