const { getPgConnectionString } = require("../config/pgConfig");

/**
 * getOgrConfigByEnv
 * Menyiapkan command dan env untuk menjalankan ogr2ogr sesuai PG_ENV
 */
function getOgrConfigByEnv(
  shpFilePath,
  tableName,
  schemaName = "public",
  layerType
) {
  const env = process.env.PG_ENV || "windows";

  const baseEnvWin = {
    PROJ_DATA: "C:\\Program Files\\QGIS 3.44.0\\share\\proj",
    PROJ_LIB: "C:\\Program Files\\QGIS 3.44.0\\share\\proj",
    GDAL_DATA: "C:\\Program Files\\QGIS 3.44.0\\apps\\gdal\\share\\gdal",
    PATH: `C:\\Program Files\\QGIS 3.44.0\\bin;${process.env.PATH}`,
  };

  const nltFlag = `-nlt GEOMETRY`;

  const commonFlags =
    `-nln "${schemaName}"."${tableName}" ` +
    `${nltFlag} ` +
    `-lco GEOMETRY_NAME=geom -lco LAUNDER=NO ` +
    `-overwrite -t_srs EPSG:4326 ` +
    `-fieldTypeToString Date,DateTime,Time ` +
    `-unsetFid`;

  const pgConnString = getPgConnectionString();

  if (env === "linux") {
    const ogrPath = "ogr2ogr";
    const ogrCmd = `${ogrPath} -f "PostgreSQL" PG:"${pgConnString}" "${shpFilePath}" ${commonFlags}`;
    return { ogrPath, ogrCmd, env: process.env };
  } else {
    const ogrPath = `"C:\\Program Files\\QGIS 3.44.0\\bin\\ogr2ogr.exe"`;
    const ogrCmd = `${ogrPath} -f "PostgreSQL" PG:"${pgConnString}" "${shpFilePath}" ${commonFlags}`;
    return { ogrPath, ogrCmd, env: { ...process.env, ...baseEnvWin } };
  }
}

module.exports = { getOgrConfigByEnv };