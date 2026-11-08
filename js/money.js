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

  function cfValid(cf) {
    if (!cf) return true;
    const s = String(cf).toUpperCase().replace(/\s/g, "");
    if (!/^[A-Z]{6}[0-9]{2}[A-Z][0-9]{2}[A-Z][0-9]{3}[A-Z]$/.test(s)) return false;
    const odd = {
      0: 1, 1: 0, 2: 5, 3: 7, 4: 9, 5: 13, 6: 15, 7: 17, 8: 19, 9: 21,
      A: 1, B: 0, C: 5, D: 7, E: 9, F: 13, G: 15, H: 17, I: 19, J: 21,
      K: 2, L: 4, M: 18, N: 20, O: 11, P: 3, Q: 6, R: 8, S: 12, T: 14,
      U: 16, V: 10, W: 22, X: 25, Y: 24, Z: 23,
    };
    const even = {};
    "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").forEach(function (ch, i) { even[ch] = i; });
    let sum = 0;
    for (let i = 0; i < 15; i++) sum += i % 2 === 0 ? odd[s[i]] : even[s[i]];
    return "ABCDEFGHIJKLMNOPQRSTUVWXYZ"[sum % 26] === s[15];
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
    cfValid: cfValid,
  };
})();
