# CultivoAlerta · contexto para Claude Code

Prototipo web del trabajo final de TIG (Especialización en Análisis Espacial, Universidad Nacional de Colombia). Producto: alertas climáticas para la finca del pequeño productor. Piloto: Sabana de Bogotá.

## Idea del producto
- La finca se registra una sola vez (lindero en shapefile .zip, KML/KMZ, GeoJSON o dibujado) y la usan dos módulos.
- Módulo 1, vigor y temperatura: temperatura del aire y del suelo, heladas, lluvia y balance hídrico (Open-Meteo). NDVI, NDMI y LST satelital en Google Earth Engine (`gee/`), aún no integrados en la web.
- Módulo 2, amenaza de inundación: modelo hidráulico 2D sobre el relieve del círculo de análisis, con escenarios de lluvia (La Niña con ERA5, pronóstico 16 días, tormenta personalizada), crecida del río y suelo.
- En Colombia El Niño trae sequía y heladas; La Niña y las temporadas de lluvias traen inundaciones.

## Cómo correrlo
- Sin compilación: HTML, CSS y JavaScript plano. Librerías por CDN (MapLibre GL 4.7.1, JSZip, proj4).
- Abrir `index.html` o servir la carpeta: `python -m http.server 8000` → http://localhost:8000
- Necesita internet: OpenFreeMap (mapa), Esri World Imagery, AWS Terrain Tiles (Terrarium), Open-Meteo.

## Estructura
- `js/geo.js`: lectura de archivos, sistemas de referencia de Colombia (9377, 3114–3118, 4326, 4686, 32618, 32619), área, perímetro, círculo.
- `js/hidraulica.js`: motor hidráulico en Web Worker (creado desde Blob para que funcione con file://).
- `js/inundacion.js`: relieve, grilla (tope `MAX_CELDAS`), ríos/lagunas del mapa base, escenarios de lluvia, estadísticas y dibujo del agua.
- `js/clima.js`: clima y alertas del módulo 1.
- `js/app.js`: mapa, pestañas, registro de la finca, gráficos SVG y mensajes tipo WhatsApp.
- `datos/`: finca de ejemplo en shapefile (9377, 3116, UTM 18N) para probar la carga.

## Convenciones
- Interfaz, comentarios y textos en español de Colombia; números con formato es-CO.
- Mantener el crédito: el motor hidráulico, la grilla y los parámetros de suelo vienen, con permiso de la autora, del observatorio de Diamela Dego (https://github.com/diamedego/Mapa-de-riesgo-super-ni-o).
- La finca se procesa en el navegador; no enviarla a servidores.
- Herramienta orientativa: no presentar resultados como oficiales.

## Pendientes conocidos
- Integrar NDVI, NDMI y LST (GEE) en el módulo 1.
- Relieve: SRTM ~30 m incluye árboles e invernaderos; evaluar DEM del IGAC o Copernicus GLO-30.
- Suelo desde SoilGrids o el estudio de suelos del IGAC en lugar de la lista.
- Lluvia de estaciones IDEAM o IMERG; niveles del río Bogotá (IDEAM, CAR).
- Humedales (landcover wetland) como zonas de almacenamiento.
- Publicar en GitHub Pages.
