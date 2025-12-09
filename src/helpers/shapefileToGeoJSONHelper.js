const wkx = require("wkx");

function convertShapefileRowsToGeoJSON(rows, geometryColumn = "geom") {
  if (!Array.isArray(rows) || rows.length === 0) {
    return {
      type: "FeatureCollection",
      features: [],
    };
  }

  const features = [];
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;

  for (const row of rows) {
    const rowData = { ...row };
    const geomHex = rowData[geometryColumn];
    delete rowData[geometryColumn];

    let geometry = null;
    try {
      geometry = wkx.Geometry.parse(Buffer.from(geomHex, "hex")).toGeoJSON();

      // Hitung bounding box geometry ini
      const coords = extractAllCoordinates(geometry);
      for (const [x, y] of coords) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    } catch (error) {
      geometry = null;
    }

    features.push({
      type: "Feature",
      geometry,
      properties: rowData,
    });
  }

  const bbox = [minX, minY, maxX, maxY];
  const center = calculateCenterFromBBox(bbox);

  return {
    type: "FeatureCollection",
    bbox,
    center,
    features: features,
  };
}

function extractAllCoordinates(geometry) {
  const coords = [];

  function extract(coordsArray) {
    if (typeof coordsArray[0] === "number") {
      coords.push(coordsArray);
    } else {
      coordsArray.forEach(extract);
    }
  }

  if (geometry && geometry.coordinates) {
    extract(geometry.coordinates);
  }

  return coords;
}

function calculateCenterFromBBox(bbox) {
  if (
    !Array.isArray(bbox) ||
    bbox.length !== 4 ||
    bbox.some((val) => typeof val !== "number")
  ) {
    throw new Error("BBOX tidak valid. Format harus [minX, minY, maxX, maxY]");
  }

  const [minX, minY, maxX, maxY] = bbox;
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;

  return [centerX, centerY];
}

module.exports = {
  convertShapefileRowsToGeoJSON,
};
