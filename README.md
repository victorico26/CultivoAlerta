# CultivoAlerta · Prototipo (piloto Sabana de Bogotá)

Prototipo funcional del trabajo final de TIG. Una sola finca registrada alimenta dos módulos:

1. **Mi finca**: carga del lindero (shapefile en .zip, KML/KMZ o GeoJSON) o dibujo en el mapa. Reproyección automática desde MAGNA-SIRGAS (Origen Nacional EPSG:9377, zonas Bogotá/Oeste/Este EPSG:3114–3118), WGS84 o UTM 18N/19N. Se dibuja el perímetro y un círculo de análisis que cubre la finca más un margen.
2. **Vigor y temperatura**: temperatura del aire y del suelo, heladas, lluvia y balance hídrico en la finca (Open-Meteo). El NDVI, el NDMI y la temperatura de superficie satelital (Landsat, MODIS) se calculan con `gee/cultivoalerta_vigor_temperatura.js` en Google Earth Engine.
3. **Amenaza de inundación**: modelo hidráulico 2D (aguas someras inercial + infiltración Green-Ampt) sobre el relieve real del círculo, con tres escenarios de lluvia (peor tormenta de una temporada La Niña con ERA5, pronóstico de 16 días o tormenta personalizada), crecida del río y tipo de suelo. Resultados para la finca: hectáreas con más de 10 cm de agua, profundidad máxima, duración y un mensaje tipo WhatsApp.

## Cómo abrirlo

- Doble clic en `index.html` (Chrome o Edge). Necesita internet: descarga el mapa, el relieve y el clima.
- Si el navegador bloquea algo al abrirlo como archivo, sirve la carpeta: `python -m http.server 8000` y abre `http://localhost:8000`.
- Archivos de prueba en `datos/`: la misma finca de ejemplo en shapefile con distintos sistemas de referencia.

## Estructura

| Archivo | Contenido |
|---|---|
| `index.html`, `css/estilos.css` | Interfaz |
| `js/geo.js` | Lectura de shapefile/KML/GeoJSON, sistemas de referencia de Colombia, área, perímetro y círculo |
| `js/hidraulica.js` | Motor hidráulico (Web Worker) |
| `js/inundacion.js` | Relieve, grilla del modelo, escenarios de lluvia, resultados y dibujo del agua |
| `js/clima.js` | Temperatura, heladas y balance hídrico (módulo 1) |
| `js/app.js` | Mapa, registro de la finca, pestañas y gráficos |
| `gee/cultivoalerta_vigor_temperatura.js` | NDVI, NDMI y temperatura de superficie en Google Earth Engine |

## Fuentes y créditos

Relieve: AWS Terrain Tiles (SRTM ~30 m). Mapa base: © OpenStreetMap (OpenMapTiles, OpenFreeMap). Imagen: Esri World Imagery. Clima: Open-Meteo (ERA5 y pronósticos). Motor hidráulico, grilla y parámetros de suelo adaptados, con permiso de la autora, del observatorio de riesgo de inundación de Diamela Dego (<https://github.com/diamedego/Mapa-de-riesgo-super-ni-o>).

## Limitaciones conocidas (para las siguientes versiones)

- El relieve SRTM incluye árboles e invernaderos y tiene ~30 m: en terrenos muy planos los bajos chicos pueden no verse. Siguiente paso: DEM del IGAC o Copernicus GLO-30.
- El suelo se elige de una lista (por defecto franco arcilloso, típico de los suelos lacustres de la Sabana). Siguiente paso: textura de SoilGrids o del estudio de suelos del IGAC.
- La lluvia de ERA5 subestima las tormentas fuertes (por eso el ajuste ×1,3). Siguiente paso: estaciones del IDEAM o satélite IMERG.
- El nivel del río es un escenario (metros sobre lo normal). Siguiente paso: niveles de las estaciones del IDEAM y la CAR sobre el río Bogotá.
- Herramienta orientativa, no oficial.
