# Diapps-BS

Repo de pruebas con varias apps web. Se publica con GitHub Pages:
https://diegobasan.github.io/Diapps-BS/

| Ruta | Qué es |
| --- | --- |
| `/` | Selector de proyectos (carpetas). Cada carpeta abre su app. |
| `/jetta/` | Mi Jetta MK6: tablero, servicio, testigos y fallas. |
| `/finanzas/` | Mis Finanzas: gastos, presupuesto, regla 50/30/20, mapa de gasto y asistente local. |

## Agregar un proyecto

1. Crea una carpeta nueva, por ejemplo `mi-app/`, con su `index.html`.
2. Agrega una entrada al arreglo `PROJECTS` en `index.html` con `href: "mi-app/"`.
   Sin `href`, la carpeta aparece como "Próximamente".

Cada app puede tener su propio `manifest.webmanifest`, íconos y `sw.js` dentro de su carpeta
para instalarse por separado en la pantalla de inicio del iPhone. Los service workers solo borran
cachés con su propio prefijo (`hub-`, `jetta-`, …) para no pisarse entre apps.
