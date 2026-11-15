/* Importi in centesimi, stesso arrotondamento del foglio CALCOLI. */
(function () {
  const BOLLO = 200;
  const SOGLIA = 7747;

  function roundHalfUpDiv(numerator, denominator) {
    return Math.round(numerator / denominator);
  }

  function fromTotale(cents) {
    const grey = cents > SOGLIA && cents - BOLLO <= SOGLIA;
    let bollo = 0;
    let doc = cents;
    if (!grey && cents - BOLLO > SOGLIA) {
      bollo = BOLLO;
      doc = cents - BOLLO;
    }
    const competenze = roundHalfUpDiv(doc * 50, 51);
    const cassa = doc - competenze;
    return {
      grey,
      calcMode: "totale",
      competenze,
      cassa,
      imponibile: doc,
      iva: 0,
      totaleDocumento: doc,
      bollo,
      totale: doc + bollo,
    };
  }

  function fromCompetenze(cents) {
    const cassa = roundHalfUpDiv(cents * 2, 100);
    const doc = cents + cassa;
    const bollo = doc > SOGLIA ? BOLLO : 0;
    return {
      grey: false,
      calcMode: "competenze",
      competenze: cents,
      cassa,
      imponibile: doc,
      iva: 0,
      totaleDocumento: doc,
      bollo,
      totale: doc + bollo,
    };
  }

  function parseEuroToCents(str) {
    if (str == null) return null;
    let s = String(str).trim().replace(/\s/g, "").replace(/€/g, "");
    if (!s) return null;
    if (s.includes(",") && s.includes(".")) s = s.replace(/\./g, "").replace(",", ".");
    else if (s.includes(",")) s = s.replace(",", ".");
    if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
    const n = Number(s);
    if (!Number.isFinite(n) || n < 0) return null;
    return Math.round(n * 100);
  }

  function centsToInput(cents) {
    const a = Math.abs(cents || 0);
    const eur = Math.floor(a / 100);
    const c = a % 100;
    const body = c === 0 ? String(eur) : eur + "," + String(c).padStart(2, "0");
    return cents < 0 ? "-" + body : body;
  }

  function formatEuro(cents) {
    const neg = cents < 0;
    const a = Math.abs(cents || 0);
    const eur = Math.floor(a / 100);
    const c = String(a % 100).padStart(2, "0");
    const eurStr = String(eur).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    return (neg ? "-" : "") + eurStr + "," + c + " €";
  }

  function formatDateIT(iso) {
    if (!iso) return "";
    const [y, m, d] = iso.split("-");
    if (!y || !m || !d) return iso;
    return d + "/" + m + "/" + y;
  }

  function todayISO() {
    const d = new Date();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return d.getFullYear() + "-" + m + "-" + day;
  }

  function nameUpper(name) {
    return String(name || "").trim().replace(/\s+/g, " ").toLocaleUpperCase("it");
  }

  function cfCanon(cf) {
    const s = String(cf || "").toUpperCase().replace(/\s/g, "");
    if (!/^[A-Z0-9]{16}$/.test(s)) return s;
    const chars = s.split("");
    [6, 7, 9, 10, 12, 13, 14].forEach(function (i) {
      if (chars[i] === "O") chars[i] = "0";
      if (chars[i] === "I") chars[i] = "1";
    });
    return chars.join("");
  }

  function cfValid(cf) {
    if (!cf) return true;
    const s = cfCanon(cf);
    if (!/^[A-Z]{6}[A-Z0-9]{2}[A-Z][A-Z0-9]{2}[A-Z][A-Z0-9]{3}[A-Z]$/.test(s)) return false;
    const odd = {
      0: 1, 1: 0, 2: 5, 3: 7, 4: 9, 5: 13, 6: 15, 7: 17, 8: 19, 9: 21,
      A: 1, B: 0, C: 5, D: 7, E: 9, F: 13, G: 15, H: 17, I: 19, J: 21,
      K: 2, L: 4, M: 18, N: 20, O: 11, P: 3, Q: 6, R: 8, S: 12, T: 14,
      U: 16, V: 10, W: 22, X: 25, Y: 24, Z: 23,
    };
    function evenValue(ch) {
      if (ch >= "0" && ch <= "9") return ch.charCodeAt(0) - 48;
      return ch.charCodeAt(0) - 65;
    }
    let sum = 0;
    for (let i = 0; i < 15; i++) {
      const value = i % 2 === 0 ? odd[s[i]] : evenValue(s[i]);
      if (value == null || value < 0) return false;
      sum += value;
    }
    return "ABCDEFGHIJKLMNOPQRSTUVWXYZ"[sum % 26] === s[15];
  }

  const CF_MONTH = { A: 1, B: 2, C: 3, D: 4, E: 5, H: 6, L: 7, M: 8, P: 9, R: 10, S: 11, T: 12 };
  const CF_OMO = { L: "0", M: "1", N: "2", P: "3", Q: "4", R: "5", S: "6", T: "7", U: "8", V: "9" };

  function leapYear(year) {
    return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  }

  function cfDecode(cf, today) {
    if (!cf || !cfValid(cf)) return null;
    const raw = cfCanon(cf);
    if (raw.length !== 16) return null;
    const chars = raw.split("");
    [6, 7, 9, 10, 12, 13, 14].forEach(function (i) {
      if (CF_OMO[chars[i]]) chars[i] = CF_OMO[chars[i]];
    });
    const month = CF_MONTH[chars[8]];
    if (!month) return null;
    let day = parseInt(chars[9] + chars[10], 10);
    if (isNaN(day)) return null;
    const sex = day > 40 ? "F" : "M";
    if (day > 40) day -= 40;
    if (day < 1 || day > 31) return null;
    const yy = parseInt(chars[6] + chars[7], 10);
    if (isNaN(yy)) return null;
    const todayIso = today || todayISO();
    let year = 2000 + yy;
    const mm = String(month).padStart(2, "0");
    const dd = String(day).padStart(2, "0");
    if (year + "-" + mm + "-" + dd > todayIso) year -= 100;
    const check = new Date(year, month - 1, day);
    if (check.getFullYear() !== year || check.getMonth() !== month - 1 || check.getDate() !== day) return null;
    const code = chars[11] + chars[12] + chars[13] + chars[14];
    const place = window.Places && window.Places[code] ? window.Places[code] : "";
    return {
      date: year + "-" + mm + "-" + dd,
      sex: sex,
      code: code,
      place: place,
      foreign: code.charAt(0) === "Z",
    };
  }

  function ageYears(birth, today) {
    if (!birth || birth.length < 10) return null;
    const t = today || todayISO();
    let age = Number(t.slice(0, 4)) - Number(birth.slice(0, 4));
    if (t.slice(5) < birth.slice(5)) age -= 1;
    return age;
  }

  function birthdayOn(birth, year) {
    const md = birth.slice(5);
    if (md === "02-29" && !leapYear(year)) return { date: year + "-02-28", shifted: true };
    return { date: year + "-" + md, shifted: false };
  }

  window.Money = {
    BOLLO: BOLLO,
    SOGLIA: SOGLIA,
    fromTotale: fromTotale,
    fromCompetenze: fromCompetenze,
    parseEuroToCents: parseEuroToCents,
    centsToInput: centsToInput,
    formatEuro: formatEuro,
    formatDateIT: formatDateIT,
    todayISO: todayISO,
    nameUpper: nameUpper,
    cfCanon: cfCanon,
    cfValid: cfValid,
    cfDecode: cfDecode,
    ageYears: ageYears,
    birthdayOn: birthdayOn,
  };
})();
