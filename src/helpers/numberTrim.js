// utils/numberTrim.js
const NUMERIC_RE = /^[+-]?\d+(?:\.\d+)?$/;

function trimZeroDecimalString(str) {
  if (typeof str !== "string") return str;
  let s = str.trim();
  if (!NUMERIC_RE.test(s)) return str;

  const sign = s.startsWith("-") ? "-" : "";
  if (sign) s = s.slice(1);

  s = s.replace(/(\.\d*?[1-9])0+$/, "$1"); // buang nol ekor fraksi
  s = s.replace(/\.0+$/, "");              // fraksi semua nol -> buang titik
  s = s.replace(/^0+(?=\d)/, "");          // leading zero integer (kecuali 0.xxx)

  if (s === "" || s === "0") return "0";
  return sign + s;
}

function trimZeroDecimal(
  value,
  { returnType = "string", maxFractionDigits = 12 } = {}
) {
  if (value == null) return value;

  if (typeof value === "number" && Number.isFinite(value)) {
    const s = value.toFixed(maxFractionDigits);
    const out = trimZeroDecimalString(s);
    return returnType === "number" && NUMERIC_RE.test(out) ? Number(out) : out;
  }

  if (typeof value === "string") {
    const out = trimZeroDecimalString(value);
    return returnType === "number" && NUMERIC_RE.test(out) ? Number(out) : out;
  }

  return value;
}

// --- plain object check (hindari Date/Buffer class instance) ---
function isPlainObject(obj) {
  if (!obj || typeof obj !== "object") return false;
  const proto = Object.getPrototypeOf(obj);
  return proto === Object.prototype || proto === null;
}

// --- tanggal: format ke Y-m-d ---
function pad2(n) {
  return String(n).padStart(2, "0");
}

function toYMD(date, useUTC = false) {
  if (!(date instanceof Date) || isNaN(date.getTime())) return null;
  const y = useUTC ? date.getUTCFullYear() : date.getFullYear();
  const m = useUTC ? date.getUTCMonth() + 1 : date.getMonth() + 1;
  const d = useUTC ? date.getUTCDate() : date.getDate();
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

// YYYY-MM-DD [time opsional]
function isISODateLikeString(s) {
  if (typeof s !== "string") return false;
  const str = s.trim();
  return /^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?)?$/.test(str);
}

/**
 * Deep trim + format tanggal:
 * options:
 * - onlyIfHasDecimalPoint (default true): STRING angka hanya di-trim jika ada '.'
 * - formatDates (default true): format Date/ISO datetime string ke "YYYY-MM-DD"
 * - useUTC (default false): jika true, pakai UTC saat format Y-m-d
 * - shouldTrim(value, key, pathArr): return false untuk skip trim angka pada key tertentu (mis. HAK)
 * - shouldFormatDate(value, key, pathArr): return false untuk skip format tanggal pada key tertentu
 */
function trimZeroDecimalsDeep(input, opts = {}) {
  const {
    returnType = "string",
    maxFractionDigits = 12,
    onlyIfHasDecimalPoint = true,
    formatDates = true,
    useUTC = false,
    shouldTrim,         // (val, key, path) => boolean
    shouldFormatDate,   // (val, key, path) => boolean
    _path = [],         // internal
  } = opts;

  const maybeFormatDate = (val, key) => {
    if (!formatDates) return val;

    // per-key veto
    if (typeof shouldFormatDate === "function" && shouldFormatDate(val, key, _path) === false) {
      return val;
    }

    // Date instance -> Y-m-d
    if (val instanceof Date && !isNaN(val.getTime())) {
      const ymd = toYMD(val, useUTC);
      return ymd ?? val;
    }

    // String ISO-like -> Y-m-d
    if (typeof val === "string" && isISODateLikeString(val)) {
      const d = new Date(val);
      if (!isNaN(d.getTime())) {
        const ymd = toYMD(d, useUTC);
        return ymd ?? val;
      }
    }

    return val;
  };

  const applyTrim = (val, key) => {
    // 1) Format tanggal dulu (jika applicable)
    val = maybeFormatDate(val, key);

    // 2) Lalu aturan trim angka
    if (typeof shouldTrim === "function" && shouldTrim(val, key, _path) === false) {
      return val;
    }

    if (typeof val === "string") {
      if (onlyIfHasDecimalPoint && !val.includes(".")) return val;   // cegah "0202..." ter-trim
      if (!NUMERIC_RE.test(val.trim())) return val;                  // bukan angka murni
      return trimZeroDecimal(val, { returnType, maxFractionDigits });
    }

    if (typeof val === "number") {
      if (Number.isInteger(val)) return val;                         // bilangan bulat: biarkan
      return trimZeroDecimal(val, { returnType, maxFractionDigits });
    }

    return val;
  };

  if (Array.isArray(input)) {
    return input.map((v, i) =>
      trimZeroDecimalsDeep(v, { ...opts, _path: _path.concat(String(i)) })
    );
  }

  if (isPlainObject(input)) {
    const out = {};
    for (const [k, v] of Object.entries(input)) {
      if (Array.isArray(v) || isPlainObject(v)) {
        out[k] = trimZeroDecimalsDeep(v, { ...opts, _path: _path.concat(k) });
      } else {
        out[k] = applyTrim(v, k);
      }
    }
    return out;
  }

  // primitif / non-plain object
  return applyTrim(input, _path[_path.length - 1]);
}

module.exports = { trimZeroDecimal, trimZeroDecimalsDeep, toYMD };
