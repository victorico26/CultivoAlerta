// =====================================================================================================
// CultivoAlerta · Módulo 1 · Vigor y temperatura del territorio (Google Earth Engine, Code Editor)
// -----------------------------------------------------------------------------------------------------
// Qué calcula sobre el polígono de la finca y su entorno:
//   · NDVI (vigor) y NDMI (humedad del cultivo) con Sentinel-2 (10 m, cada ~5 días), con máscara de nubes.
//   · Anomalía de NDVI: los últimos 30 días frente a las mismas fechas de los 3 años anteriores.
//   · Temperatura de superficie (LST) con Landsat 8 y 9 (banda térmica de 100 m entregada a 30 m).
//   · LST diaria de día y de noche con MODIS (1 km): la de noche ayuda a ver las madrugadas frías (heladas).
// Cómo usarlo:
//   1. Abre https://code.earthengine.google.com y pega este script.
//   2. Sube el shapefile de la finca (Assets → NEW → Shape files: .shp, .shx, .dbf, .prj) y escribe su ruta en
//      FINCA_ASSET. También puedes dibujar el polígono con la herramienta de geometría (queda como «geometry»).
//   3. Run. Los gráficos salen en la consola y los mapas en el visor.
// =====================================================================================================

var FINCA_ASSET = '';   // p. ej. 'projects/tu-proyecto/assets/finca'  ·  vacío = usa «geometry» o la finca de ejemplo
var MESES = 12;         // período de las series de tiempo

var ejemplo = ee.Geometry.Polygon([[[-74.08093, 4.83355], [-74.07844, 4.83425], [-74.07755, 4.83177], [-74.0801, 4.83101], [-74.08093, 4.83355]]]);
var finca = FINCA_ASSET !== '' ? ee.FeatureCollection(FINCA_ASSET).geometry()
  : (typeof geometry !== 'undefined' ? geometry : ejemplo);
var entorno = finca.buffer(3000).bounds();          // el territorio alrededor de la finca
var FIN = ee.Date(Date.now()), INI = FIN.advance(-MESES, 'month');

// ---------- Sentinel-2: NDVI y NDMI ----------
function mascaraS2(img) {
  var scl = img.select('SCL');
  var limpio = scl.neq(3).and(scl.neq(8)).and(scl.neq(9)).and(scl.neq(10)).and(scl.neq(11));   // sin sombra, nubes ni cirros
  var r = img.updateMask(limpio).divide(10000);
  return ee.Image(r.addBands(r.normalizedDifference(['B8', 'B4']).rename('NDVI'))
                   .addBands(r.normalizedDifference(['B8', 'B11']).rename('NDMI'))
                   .copyProperties(img, ['system:time_start']));
}
function coleccionS2(ini, fin) {
  return ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED').filterBounds(entorno).filterDate(ini, fin)
    .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 70)).map(mascaraS2);
}
var s2 = coleccionS2(INI, FIN);

print(ui.Chart.image.series({ imageCollection: s2.select(['NDVI', 'NDMI']), region: finca, reducer: ee.Reducer.mean(), scale: 10 })
  .setOptions({ title: 'Vigor (NDVI) y humedad del cultivo (NDMI) · promedio de la finca', vAxis: { title: 'Índice' },
                lineWidth: 1, pointSize: 3, colors: ['#2f7a47', '#2458b2'] }));

// Anomalía de NDVI: últimos 30 días frente a las mismas fechas de los 3 años anteriores
var reciente = coleccionS2(FIN.advance(-30, 'day'), FIN).select('NDVI').median();
var historico = ee.ImageCollection(ee.List.sequence(1, 3).map(function (k) {
  var f = FIN.advance(ee.Number(k).multiply(-1), 'year');
  return coleccionS2(f.advance(-30, 'day'), f).select('NDVI').median();
})).median();
var anomalia = reciente.subtract(historico).rename('anomalia');
var anomaliaFinca = anomalia.reduceRegion({ reducer: ee.Reducer.mean(), geometry: finca, scale: 10, maxPixels: 1e9 }).get('anomalia');
print('Anomalía de NDVI de la finca (últimos 30 días vs. años anteriores):', anomaliaFinca,
      '→ valores bajo −0,1 indican pérdida de vigor que conviene revisar en campo.');

// ---------- Landsat 8 y 9: temperatura de superficie (°C) ----------
function lstLandsat(img) {
  var qa = img.select('QA_PIXEL');
  var nubes = qa.bitwiseAnd(1 << 1).or(qa.bitwiseAnd(1 << 2)).or(qa.bitwiseAnd(1 << 3)).or(qa.bitwiseAnd(1 << 4)).neq(0);
  var lst = img.select('ST_B10').multiply(0.00341802).add(149.0).subtract(273.15).rename('LST');
  return ee.Image(lst.updateMask(nubes.not()).copyProperties(img, ['system:time_start']));
}
var landsat = ee.ImageCollection('LANDSAT/LC08/C02/T1_L2').merge(ee.ImageCollection('LANDSAT/LC09/C02/T1_L2'))
  .filterBounds(entorno).filterDate(INI, FIN).map(lstLandsat);
print(ui.Chart.image.series({ imageCollection: landsat, region: finca, reducer: ee.Reducer.mean(), scale: 30 })
  .setOptions({ title: 'Temperatura de superficie de la finca · Landsat 8/9 (hacia las 10:15 a. m.)', vAxis: { title: '°C' },
                lineWidth: 0, pointSize: 4, colors: ['#d0533f'] }));

// ---------- MODIS: temperatura de superficie diaria de día y de noche (1 km) ----------
var modis = ee.ImageCollection('MODIS/061/MOD11A1').filterBounds(entorno).filterDate(FIN.advance(-3, 'month'), FIN)
  .map(function (img) {
    var dia = img.select('LST_Day_1km').multiply(0.02).subtract(273.15).rename('Dia');
    var noche = img.select('LST_Night_1km').multiply(0.02).subtract(273.15).rename('Noche');
    return dia.addBands(noche).copyProperties(img, ['system:time_start']);
  });
print(ui.Chart.image.series({ imageCollection: modis, region: finca.centroid(1).buffer(500), reducer: ee.Reducer.mean(), scale: 1000 })
  .setOptions({ title: 'Temperatura de superficie diaria · MODIS (día ~10:30 a. m., noche ~10:30 p. m.)', vAxis: { title: '°C' },
                lineWidth: 1, pointSize: 2, colors: ['#d0533f', '#2b7bba'] }));

// ---------- Mapas ----------
Map.centerObject(finca, 15);
Map.setOptions('SATELLITE');
var ndviRec = coleccionS2(FIN.advance(-45, 'day'), FIN).select('NDVI').median().clip(entorno);
Map.addLayer(ndviRec, { min: 0.1, max: 0.85, palette: ['#a50026', '#f46d43', '#fee08b', '#a6d96a', '#1a9850', '#004529'] }, 'NDVI · últimos 45 días');
Map.addLayer(anomalia.clip(entorno), { min: -0.25, max: 0.25, palette: ['#b2182b', '#f4a582', '#f7f7f7', '#92c5de', '#2166ac'] }, 'Anomalía de NDVI', false);
var lstRec = landsat.filterDate(FIN.advance(-4, 'month'), FIN).median().clip(entorno);
Map.addLayer(lstRec, { min: 15, max: 40, palette: ['#313695', '#74add1', '#ffffbf', '#f46d43', '#a50026'] }, 'Temperatura de superficie · Landsat (mediana 4 meses)', false);
Map.addLayer(ee.Image().byte().paint(ee.FeatureCollection([ee.Feature(finca)]), 1, 3), { palette: ['#f2b705'] }, 'Lindero de la finca');

// ---------- Exportar las series (CSV a Google Drive) para el tablero ----------
var serie = s2.map(function (img) {
  var v = img.select(['NDVI', 'NDMI']).reduceRegion({ reducer: ee.Reducer.mean(), geometry: finca, scale: 10, maxPixels: 1e9 });
  return ee.Feature(null, v).set('fecha', img.date().format('YYYY-MM-dd'));
}).filter(ee.Filter.notNull(['NDVI']));
Export.table.toDrive({ collection: serie, description: 'CultivoAlerta_NDVI_NDMI_finca', fileFormat: 'CSV', selectors: ['fecha', 'NDVI', 'NDMI'] });
