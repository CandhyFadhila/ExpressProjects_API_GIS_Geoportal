const chroma = require("chroma-js");

// Fungsi untuk menghasilkan palet warna berdasarkan colorscale
// Mengambil jumlah nilai yang unik dan menghasilkan warna dengan chroma
function generateColorPalette(values, colorscale) {
  // Jika jumlah values lebih sedikit atau sama dengan panjang colorscale, pakai 1:1 mapping
  if (values.length <= colorscale.length) {
    return colorscale.slice(0, values.length).map(toHex);
  }

  // Kalau lebih banyak, interpolasi warna menggunakan chroma
  return chroma.scale(colorscale).mode("lch").colors(values.length).map(toHex);
}

// Fungsi untuk mengonversi warna ke format hex
function toHex(c) {
  return chroma(c).hex();
}

// Fungsi utama yang menerima values dan colorscale dan mengembalikan mapping nilai ke warna
function mapValuesToColor(values, colorscale) {
  const palette = generateColorPalette(values, colorscale);

  // Membangun mapping nilai properti ke warna
  const valueToColor = new Map();
  values.forEach((value, index) => {
    valueToColor.set(value, palette[index]);
  });

  return valueToColor;
}

module.exports = { mapValuesToColor };
