// Finca de ejemplo (polígono ficticio sobre cultivos de la llanura del río Bogotá, entre Chía y Cota, a ~100 m del río) para probar el prototipo.
const FINCA_EJEMPLO = {
  type: "Feature",
  properties: { nombre: "Finca El Ejemplo", lotes: 1, crs: "EPSG:4326", formato: "Ejemplo incluido" },
  geometry: { type: "MultiPolygon", coordinates: [[[[-74.08093, 4.83355], [-74.07844, 4.83425], [-74.07755, 4.83177], [-74.0801, 4.83101], [-74.08093, 4.83355]]]] },
};
