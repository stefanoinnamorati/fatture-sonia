(function () {
  const MESI = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];
  const DESCRIZIONI = [
    "Colloquio di psicoterapia",
    "Colloquio psicologico",
    "Colloquio di coppia",
    "Colloquio familiare",
    "Prestazione di sessuologia clinica",
  ];
  const PAGAMENTI = ["BANCOMAT", "BONIFICO", "CONTANTI"];

  const S = {
    patients: [],
    invoices: [],
    files: [],
    appointments: [],
    settings: null,
    path: "",
    query: "",
    invoiceYear: String(new Date().getFullYear()),
    invoiceKind: "tutte",
    month: Money.todayISO().slice(0, 7),
    day: Money.todayISO(),
    exportFrom: new Date().getFullYear() + "-01-01",
    exportTo: new Date().getFullYear() + "-12-31",
    attachExcel: true,
    attachPdf: true,
    attachInvoices: true,
    folds: {},
    sessions: null,
  };

  let draft = null;
  let draftKey = "";

  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function pathId(id) {
    return encodeURIComponent(id || "");
  }

  function readPart(part) {
    try { return decodeURIComponent(part); }
    catch (e) { return part; }
  }

  function route() {
    const raw = (location.hash || "#/").replace(/^#/, "");
    const bits = raw.split("?");
    return { parts: bits[0].split("/").filter(Boolean).map(readPart), q: new URLSearchParams(bits[1] || "") };
  }

  function toast(msg) {
    const el = document.getElementById("toast");
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.hidden = true; }, 2800);
  }

  function patientById(id) {
    return S.patients.find(function (p) { return p.id === id; });
  }

  function invoicesOf(patientId) {
    return S.invoices.filter(function (i) { return i.patientId === patientId; })
      .sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : b.number - a.number; });
  }

  function lastInvoiceFor(patientId) {
    const all = invoicesOf(patientId);
    return all.find(isFiscal) || all[0];
  }

  function isProforma(inv) {
    return !!(inv && inv.kind === "proforma");
  }

  function isFiscal(inv) {
    return !!(inv && !isProforma(inv));
  }

  function docId(year, number, proforma) {
    return (proforma ? "pf-" : "") + year + "-" + number;
  }

  function docLabel(inv) {
    return (isProforma(inv) ? "Pro forma " : "Fattura ") + inv.number + "/" + inv.year;
  }

  function series(year, proforma, ignoreId) {
    return S.invoices.filter(function (i) {
      return i.year === year && i.id !== ignoreId && isProforma(i) === !!proforma;
    });
  }

  function nextNumber(year, ignoreId, proforma) {
    let max = 0;
    series(year, proforma, ignoreId).forEach(function (i) {
      max = Math.max(max, Number(i.number) || 0);
    });
    return max + 1;
  }

  function numberTaken(year, number, ignoreId, proforma) {
    return series(year, proforma, ignoreId).some(function (i) { return Number(i.number) === number; });
  }

  function gapsWith(year, proforma, ignoreId, addNumber) {
    const set = {};
    series(year, proforma, ignoreId).forEach(function (i) { set[Number(i.number)] = true; });
    if (addNumber) set[addNumber] = true;
    const keys = Object.keys(set).map(Number).filter(function (n) { return n > 0; });
    if (!keys.length) return [];
    const max = Math.max.apply(null, keys);
    const missing = [];
    for (let n = 1; n < max; n++) if (!set[n]) missing.push(n);
    return missing;
  }

  function formatNums(list) {
    if (!list.length) return "";
    if (list.length === 1) return "il n. " + list[0];
    const shown = list.slice(0, 6);
    const tail = list.length > 6 ? "…" : "";
    if (shown.length === 2) return "i n. " + shown[0] + " e " + shown[1] + tail;
    return "i n. " + shown.slice(0, -1).join(", ") + " e " + shown[shown.length - 1] + tail;
  }

  function manca(list) {
    return (list.length === 1 ? "manca " : "mancano ") + formatNums(list);
  }

  function lasciaScoperto(list) {
    return (list.length === 1 ? "lascia scoperto " : "lascia scoperti ") + formatNums(list);
  }

  function invoiceKind() {
    const tipo = route().q.get("tipo");
    if (tipo === "proforma" || tipo === "fatture" || tipo === "tutte") return tipo;
    return S.invoiceKind || "tutte";
  }

  function numberHintHtml(year, raw, ignoreId, proforma) {
    const text = String(raw || "").trim();
    if (!/^\d+$/.test(text) || Number(text) < 1) {
      return '<div class="warn-box">Il numero è un intero da 1 in su. Il prossimo libero è ' + nextNumber(year, ignoreId, proforma) + ".</div>";
    }
    const n = Number(text);
    if (numberTaken(year, n, ignoreId, proforma)) {
      return '<div class="warn-box">Il n. ' + n + "/" + year + " è già usato " + (proforma ? "da un'altra pro forma." : "da un'altra fattura.") + "</div>";
    }
    const missing = gapsWith(year, proforma, ignoreId, n);
    if (proforma) {
      return '<div class="note-box">Numerazione solo delle pro forma: non occupa il progressivo delle fatture.' +
        (missing.length ? " " + (missing.length === 1 ? "Resta scoperto " : "Restano scoperti ") + formatNums(missing) + "." : "") + "</div>";
    }
    if (missing.length) {
      return '<div class="warn-box">Con questo numero la sequenza ' + year + " " + lasciaScoperto(missing) + ". Le fatture di un anno vanno di seguito, senza buchi. Se il numero è un errore, scrivi quello giusto.</div>";
    }
    return '<div class="note-box">Numero libero nella sequenza ' + year + ".</div>";
  }

  function sumOf(list) {
    const keys = ["totale", "competenze", "cassa", "imponibile", "iva", "totaleDocumento", "bollo"];
    const out = { count: list.length };
    keys.forEach(function (k) {
      out[k] = list.reduce(function (a, i) { return a + (i[k] || 0); }, 0);
    });
    return out;
  }

  function inRange(inv, from, to) {
    return inv.date >= from && inv.date <= to;
  }

  function sortedPatients() {
    return S.patients.slice().sort(function (a, b) {
      return a.name.localeCompare(b.name, "it", { sensitivity: "base" });
    });
  }

  function initials(name) {
    const parts = String(name || "").trim().split(/\s+/).slice(0, 2);
    return parts.map(function (p) { return p[0] || ""; }).join("").toUpperCase();
  }

  function matches(hay, q) {
    if (!q) return true;
    return String(hay || "").toLocaleLowerCase("it").includes(q.toLocaleLowerCase("it"));
  }

  function fileSafe(s) {
    return String(s || "file").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "") || "file";
  }

  function downloadBlob(blob, name) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1500);
  }

  async function shareOrDownload(files, text) {
    const list = files.map(function (f) {
      return new File([f.blob], f.name, { type: f.blob.type || "application/octet-stream" });
    });
    if (navigator.canShare && navigator.canShare({ files: list })) {
      await navigator.share({ files: list, title: "Fatture Sonia", text: text || "" });
      return "shared";
    }
    list.forEach(function (f, i) { downloadBlob(files[i].blob, f.name); });
    return "downloaded";
  }

  async function hashPin(pin) {
    const data = new TextEncoder().encode("fatture-sonia|" + pin);
    const buf = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(buf)).map(function (b) { return b.toString(16).padStart(2, "0"); }).join("");
  }

  async function reload() {
    if (reload.urls) {
      Object.keys(reload.urls).forEach(function (key) { URL.revokeObjectURL(reload.urls[key]); });
    }
    reload.urls = {};
    S.patients = await DB.all("patients");
    S.invoices = await DB.all("invoices");
    S.files = await DB.all("files");
    S.appointments = await DB.all("appointments");
    S.settings = (await DB.getMeta("settings")) || Object.assign({}, window.activeSeed().professional);
    await canonArchive();
  }

  async function canonArchive() {
    const writes = [];
    S.patients.forEach(function (p) {
      const name = Money.nameUpper(p.name);
      const cf = Money.cfCanon(p.cf);
      if (name !== (p.name || "") || cf !== (p.cf || "")) {
        p.name = name;
        p.cf = cf;
        writes.push(["patients", p]);
      }
    });
    S.invoices.forEach(function (inv) {
      const name = Money.nameUpper(inv.patientName);
      if (name && name !== inv.patientName) {
        inv.patientName = name;
        writes.push(["invoices", inv]);
      }
    });
    S.appointments.forEach(function (ap) {
      const name = Money.nameUpper(ap.patientName);
      if (name && name !== ap.patientName) {
        ap.patientName = name;
        writes.push(["appointments", ap]);
      }
    });
    if (!writes.length) return;
    await DB.runQuiet(async function () {
      for (const pair of writes) await DB.put(pair[0], pair[1]);
    });
    if (window.Sync) Sync.noteLocalChange();
  }

  function fileById(id) {
    return S.files.find(function (file) { return file.id === id; });
  }

  function fileUrl(file) {
    if (!file || !file.blob) return "";
    if (!reload.urls[file.id]) reload.urls[file.id] = URL.createObjectURL(file.blob);
    return reload.urls[file.id];
  }

  function bolloDue(inv) {
    return !!(inv && isFiscal(inv) && (inv.bollo || 0) > 0);
  }

  function bolloArchived(inv) {
    return !!(inv && inv.bolloProva && inv.bolloProva.fileId && fileById(inv.bolloProva.fileId));
  }

  function locked() {
    return !!(S.settings && S.settings.pinHash && sessionStorage.getItem("fatture-unlocked") !== "1");
  }

  function screen() {
    const r = route();
    const p = r.parts;
    if (!p.length) return viewOggi();
    if (p[0] === "pazienti" && p[1] === "nuovo") return viewPatientForm(null);
    if (p[0] === "pazienti" && p[2] === "modifica") return viewPatientForm(patientById(p[1]));
    if (p[0] === "pazienti" && p[1]) return viewPatient(patientById(p[1]));
    if (p[0] === "pazienti") return viewPatients();
    if (p[0] === "fatture" && p[1] === "nuova") return viewInvoiceForm(null, r.q);
    if (p[0] === "fatture" && p[2] === "modifica") return viewInvoiceForm(S.invoices.find(function (i) { return i.id === p[1]; }), r.q);
    if (p[0] === "fatture" && p[2] === "converti") return viewConvert(S.invoices.find(function (i) { return i.id === p[1]; }));
    if (p[0] === "fatture" && p[1]) return viewInvoice(S.invoices.find(function (i) { return i.id === p[1]; }));
    if (p[0] === "fatture") return viewInvoices();
    if (p[0] === "agenda" && p[1] === "nuovo") return viewAppointmentForm(null, r.q);
    if (p[0] === "agenda" && p[1]) return viewAppointment(S.appointments.find(function (a) { return a.id === p[1]; }));
    if (p[0] === "agenda") return viewAgenda();
    if (p[0] === "esporta") return viewExport();
    if (p[0] === "impostazioni") return viewSettings();
    if (p[0] === "aiuto") return viewHelp();
    return viewAltro();
  }

  function render() {
    const path = (location.hash || "#/").split("?")[0];
    if (path !== S.path) {
      S.path = path;
      S.query = "";
    }
    const app = document.getElementById("app");
    const tab = document.getElementById("tabbar");
    if (!S.settings) {
      app.innerHTML = "<p>Caricamento…</p>";
      return;
    }
    if (locked()) {
      tab.hidden = true;
      app.innerHTML = viewLock();
      return;
    }
    tab.hidden = false;
    S.sessions = null;
    const parts = route().parts;
    const tabName = !parts.length ? "oggi" : ["pazienti", "fatture", "agenda"].includes(parts[0]) ? parts[0] : "altro";
    tab.querySelectorAll("a").forEach(function (a) {
      a.classList.toggle("on", a.dataset.tab === tabName);
    });
    const who = (S.settings.studioNome || S.settings.nome || "Fatture").trim();
    document.title = "Fatture · " + who;
    app.innerHTML = syncBannerHtml() + screen();
  }

  function syncBannerHtml() {
    if (!window.Sync) return "";
    const st = Sync.state;
    if (st.conflict) {
      return '<div id="sync-banner" class="sync-banner">Il file e questo dispositivo hanno modifiche diverse.' +
        '<div class="stack" style="margin-top:8px"><button class="btn" type="button" data-action="sync-keep-remote">Tieni il file</button>' +
        '<button class="btn secondary" type="button" data-action="sync-keep-local">Tieni questo dispositivo</button></div></div>';
    }
    if (!st.canPick || !st.linked) return "";
    let text = "";
    if (st.needsAuth) text = "La cartella va autorizzata di nuovo. Apri Impostazioni.";
    else if (st.lastError) text = st.lastError;
    else if (st.syncing) text = "Aggiornamento del file…";
    if (!text) return "";
    return '<div id="sync-banner" class="sync-banner">' + esc(text) + "</div>";
  }

  function refreshSyncBanner() {
    const html = syncBannerHtml();
    const cur = document.getElementById("sync-banner");
    if (!html) {
      if (cur) cur.remove();
      return;
    }
    if (cur) cur.outerHTML = html;
    else {
      const app = document.getElementById("app");
      if (app) app.insertAdjacentHTML("afterbegin", html);
    }
  }

  function logoSrc() {
    return (S.settings && S.settings.logoData) || "assets/logo.png?v=3";
  }

  function brandBlock(kicker) {
    const s = S.settings || {};
    const nome = s.nome || "Studio";
    const ruolo = [s.studioNome, s.titolo, s.qualifica].filter(Boolean).join(" · ");
    return '<header class="brand"><img class="brand-logo" src="' + logoSrc() + '" alt="Logo di ' + esc(nome) + '">' +
      '<div><p class="kicker">' + esc(kicker || "Studio") + "</p><h1>" + esc(nome) + "</h1>" +
      (ruolo ? '<p class="brand-role">' + esc(ruolo) + "</p>" : "") +
      "</div></header>";
  }

  function ageLabel(age) {
    if (age == null || age < 0) return "";
    return age === 1 ? "1 anno" : age + " anni";
  }

  function birthFieldsHtml(cf) {
    const info = Money.cfDecode(cf);
    if (!info) return "";
    const place = info.place ? esc(info.place) + (info.foreign ? " · stato estero" : "") : "Codice " + esc(info.code);
    return '<div class="meta" style="margin-top:8px">Data di nascita</div><div>' + esc(Money.formatDateIT(info.date)) + "</div>" +
      '<div class="meta" style="margin-top:8px">Luogo di nascita</div><div>' + place + "</div>" +
      '<div class="meta" style="margin-top:8px">Età</div><div>' + esc(ageLabel(Money.ageYears(info.date))) + "</div>";
  }

  function birthNoteHtml(cf) {
    const raw = String(cf || "").trim();
    if (!raw) return '<p class="muted" id="cf-born-text">Dal codice fiscale compaiono data di nascita, luogo ed età.</p>';
    if (!Money.cfValid(raw)) return '<div class="warn-box">Il codice fiscale non torna: data, luogo ed età restano vuoti.</div>';
    const info = Money.cfDecode(raw);
    if (!info) return "";
    const who = info.sex === "F" ? "Nata" : "Nato";
    const place = info.place ? esc(info.place) + (info.foreign ? ", stato estero" : "") : "codice " + esc(info.code);
    return '<div class="note-box">' + who + " il " + esc(Money.formatDateIT(info.date)) + " · " + place + ". Età oggi: <strong>" + esc(ageLabel(Money.ageYears(info.date))) + "</strong>.</div>";
  }

  function birthdaysOn(iso) {
    const year = Number(String(iso || "").slice(0, 4));
    const list = [];
    S.patients.forEach(function (p) {
      const info = Money.cfDecode(p.cf);
      if (!info) return;
      const when = Money.birthdayOn(info.date, year);
      if (when.date !== iso) return;
      list.push({ patient: p, info: info, age: Money.ageYears(info.date, iso), shifted: when.shifted });
    });
    list.sort(function (a, b) { return a.patient.name.localeCompare(b.patient.name, "it"); });
    return list;
  }

  function birthdayRow(item) {
    const p = item.patient;
    const nato = item.info.sex === "F" ? "nata" : "nato";
    const extra = item.shifted ? " · " + nato + " il 29 febbraio" : "";
    return '<a class="row" href="#/pazienti/' + pathId(p.id) + '"><div class="avatar bday">' + esc(item.info.date.slice(8)) + '</div><div class="main">' +
      '<div class="name">' + esc(p.name) + '</div><div class="meta">Compleanno · ' + esc(compieText(item.age)) + extra + "</div></div></a>";
  }

  function compieText(n) {
    const age = Number(n);
    if (!age || age < 1) return "anno di nascita";
    if (age === 1) return "compie 1 anno";
    return "compie " + age + " anni";
  }

  function isoFromDate(d) {
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  function shiftISO(iso, days) {
    const p = String(iso || "").split("-").map(Number);
    const d = new Date(p[0], (p[1] || 1) - 1, p[2] || 1);
    d.setDate(d.getDate() + days);
    return isoFromDate(d);
  }

  function addMonthsISO(iso, months) {
    const p = String(iso || "").split("-").map(Number);
    const d = new Date(p[0], (p[1] || 1) - 1 + months, 1);
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(p[2] || 1, last));
    return isoFromDate(d);
  }

  function seduteBase(patient) {
    const n = Number(patient && patient.seduteFatte);
    if (!isFinite(n) || n <= 0) return 0;
    return Math.floor(n);
  }

  function sessionMap() {
    const groups = {};
    S.appointments.forEach(function (a) {
      if (!groups[a.patientId]) groups[a.patientId] = [];
      groups[a.patientId].push(a);
    });
    const map = {};
    Object.keys(groups).forEach(function (id) {
      const base = seduteBase(patientById(id));
      groups[id].sort(function (a, b) {
        const ka = (a.date || "") + "T" + (a.time || "") + "|" + a.id;
        const kb = (b.date || "") + "T" + (b.time || "") + "|" + b.id;
        return ka < kb ? -1 : ka > kb ? 1 : 0;
      });
      groups[id].forEach(function (a, i) { map[a.id] = base + i + 1; });
    });
    return map;
  }

  function sessionNumber(ap) {
    if (!ap) return 0;
    if (!S.sessions) S.sessions = sessionMap();
    return S.sessions[ap.id] || seduteBase(patientById(ap.patientId)) + 1;
  }

  function birthdaysInMonth(month) {
    const year = Number(String(month || "").slice(0, 4));
    const list = [];
    S.patients.forEach(function (p) {
      const info = Money.cfDecode(p.cf);
      if (!info) return;
      const when = Money.birthdayOn(info.date, year);
      if (when.date.slice(0, 7) !== month) return;
      list.push({
        patient: p,
        info: info,
        date: when.date,
        shifted: when.shifted,
        turning: year - Number(info.date.slice(0, 4)),
      });
    });
    list.sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      return a.patient.name.localeCompare(b.patient.name, "it");
    });
    return list;
  }

  function monthBirthdayRow(item) {
    const day = Number(item.date.slice(8));
    const monthName = MESI[Number(item.date.slice(5, 7)) - 1];
    const nato = item.info.sex === "F" ? "nata" : "nato";
    const extra = item.shifted ? " · " + nato + " il 29 febbraio" : "";
    return '<a class="row" href="#/pazienti/' + pathId(item.patient.id) + '"><div class="avatar bday">' + day + '</div><div class="main">' +
      '<div class="name">' + esc(item.patient.name) + " (" + esc(compieText(item.turning)) + ")</div>" +
      '<div class="meta">' + day + " " + esc(monthName) + extra + "</div></div></a>";
  }

  function foldSection(id, title, count, body) {
    return '<details class="fold"' + (S.folds[id] ? " open" : "") + ' data-fold="' + id + '">' +
      "<summary><span>" + esc(title) + '</span><span class="count">' + count + "</span></summary>" + body + "</details>";
  }

  function activePatientIds() {
    const today = Money.todayISO();
    const from = shiftISO(today, -30);
    const to = shiftISO(today, 30);
    const ids = {};
    S.appointments.forEach(function (a) {
      if (a.date >= from && a.date <= to) ids[a.patientId] = true;
    });
    return ids;
  }

  function viewLock() {
    return brandBlock("Accesso riservato") +
      '<div class="card"><p>Inserisci il PIN per aprire pazienti e fatture su questo dispositivo.</p>' +
      '<div class="field"><label for="pin">PIN</label><input id="pin" inputmode="numeric" autocomplete="off" type="password"></div>' +
      '<button class="btn" type="button" data-action="unlock">Apri</button></div>';
  }

  function viewOggi() {
    const year = String(new Date().getFullYear());
    const yearInvoices = S.invoices.filter(function (i) { return String(i.year) === year && isFiscal(i); });
    const totals = sumOf(yearInvoices);
    const open = S.invoices.filter(function (i) { return isFiscal(i) && !i.paymentDate; });
    const openPf = S.invoices.filter(function (i) { return isProforma(i) && !i.convertedInvoiceId; });
    const today = Money.todayISO();
    const upcoming = S.appointments.filter(function (a) { return a.date >= today; })
      .sort(function (a, b) { return (a.date + a.time).localeCompare(b.date + b.time); })
      .slice(0, 5);
    const recent = S.invoices.slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; }).slice(0, 4);
    const hour = new Date().getHours();
    const hello = hour < 12 ? "Buongiorno" : hour < 18 ? "Buon pomeriggio" : "Buonasera";
    return brandBlock(hello) +
      '<div class="grid-2">' +
      '<div class="card"><div class="label">Incassato ' + year + '</div><div class="figure">' + esc(Money.formatEuro(totals.totale)) + "</div>" +
      '<div class="sub">' + totals.count + " fatture</div></div>" +
      '<div class="card"><div class="label">Da incassare</div><div class="figure">' + esc(Money.formatEuro(sumOf(open).totale)) + "</div>" +
      '<div class="sub">' + open.length + " aperte</div></div></div>" +
      '<div class="stack" style="margin-top:14px"><a class="btn" href="#/fatture/nuova">Nuova fattura</a>' +
      '<a class="btn secondary" href="#/fatture/nuova?tipo=proforma">Nuova pro forma</a>' +
      '<a class="btn secondary" href="#/agenda/nuovo">Nuovo appuntamento</a></div>' +
      (function () {
        const todayBirth = birthdaysOn(today);
        return todayBirth.length ? '<div class="section-title"><h2>Compleanni</h2></div><div class="list">' + todayBirth.map(birthdayRow).join("") + "</div>" : "";
      })() +
      (openPf.length ? '<div class="note-box">' + openPf.length + ' pro forma ' + (openPf.length === 1 ? "aperta" : "aperte") + '. <a href="#/fatture?tipo=proforma">Apri l\'elenco</a></div>' : "") +
      (function () {
        const due = S.invoices.filter(function (i) { return bolloDue(i) && !bolloArchived(i); }).length;
        return due ? '<div class="warn-box">' + due + (due === 1 ? " fattura ha" : " fatture hanno") + ' la marca da bollo ancora da archiviare. Apri la fattura e aggiungi la scansione.</div>' : "";
      })() +
      '<div class="section-title"><h2>Prossimi appuntamenti</h2><a href="#/agenda">Agenda</a></div>' +
      (upcoming.length ? '<div class="list">' + upcoming.map(appointmentRow).join("") + "</div>" : '<div class="empty">Nessun appuntamento in programma.</div>') +
      '<div class="section-title"><h2>Ultime fatture</h2><a href="#/fatture">Tutte</a></div>' +
      '<div class="list">' + recent.map(invoiceRow).join("") + "</div>";
  }

  function invoiceRow(inv) {
    const proforma = isProforma(inv);
    const paid = !!inv.paymentDate;
    const badge = proforma
      ? (inv.convertedInvoiceId ? '<span class="badge ok">Convertita</span>' : '<span class="badge pf">Pro forma</span>')
      : '<span class="badge ' + (paid ? "ok" : "wait") + '">' + (paid ? "Incassata" : "Da incassare") + "</span>";
    return '<a class="row" href="#/fatture/' + pathId(inv.id) + '"><div class="avatar' + (proforma ? " pf" : "") + '">' + (proforma ? "PF" : inv.number) + "</div><div class=\"main\">" +
      '<div class="name">' + esc(inv.patientName) + "</div>" +
      '<div class="meta">' + (proforma ? "Pro forma n. " : "n. ") + inv.number + "/" + inv.year + " · " + esc(Money.formatDateIT(inv.date)) + " · " + esc(inv.paymentMethod || "—") +
      (bolloDue(inv) ? (bolloArchived(inv) ? " · bollo archiviato" : " · bollo da archiviare") : "") + "</div></div>" +
      '<div style="text-align:right"><div class="amount">' + esc(Money.formatEuro(inv.totale)) + "</div>" +
      badge + "</div></a>";
  }

  function appointmentRow(ap) {
    return '<a class="row" href="#/agenda/' + pathId(ap.id) + '"><div class="avatar">' + esc((ap.time || "").slice(0, 2) || "•") + '</div><div class="main">' +
      '<div class="name">' + esc(ap.patientName) + "</div>" +
      '<div class="meta">' + esc(Money.formatDateIT(ap.date)) + (ap.time ? " · " + esc(ap.time) : "") + " · seduta " + sessionNumber(ap) + (ap.notes ? " · " + esc(ap.notes) : "") + "</div></div>" +
      '<span class="badge ' + (ap.invoiced ? "ok" : ap.proformaId ? "pf" : "neutral") + '">' + (ap.invoiced ? "Fatturato" : ap.proformaId ? "Pro forma" : "In agenda") + "</span></a>";
  }

  function viewPatients() {
    const q = S.query;
    const list = sortedPatients().filter(function (p) {
      return matches(p.name + " " + p.cf + " " + p.phone, q);
    });
    const active = activePatientIds();
    const activeCount = S.patients.filter(function (p) { return active[p.id]; }).length;
    return '<div class="top"><div><p class="kicker">Anagrafica</p><h1>Pazienti</h1></div>' +
      '<a class="btn small" href="#/pazienti/nuovo">Nuovo</a></div>' +
      '<div class="grid-2"><div class="card"><div class="label">Contatti</div><div class="figure">' + S.patients.length + "</div></div>" +
      '<div class="card"><div class="label">Pazienti attivi</div><div class="figure">' + activeCount + "</div></div></div>" +
      '<p class="muted">Attivo è chi ha un appuntamento nei 30 giorni prima di oggi o nei prossimi 30.</p>' +
      '<input id="q" class="search" placeholder="Nome, telefono, codice fiscale" value="' + esc(q) + '">' +
      '<div id="results" class="list" style="margin-top:12px">' + patientResults(list) + "</div>";
  }

  function patientResults(list) {
    if (!list.length) return '<div class="empty">Nessun paziente trovato.</div>';
    return list.map(function (p) {
      return '<a class="row" href="#/pazienti/' + pathId(p.id) + '"><div class="avatar">' + esc(initials(p.name)) + '</div><div class="main">' +
        '<div class="name">' + esc(p.name) + "</div>" +
        '<div class="meta">' + esc(p.phone || p.cf || "Scheda senza telefono") + "</div></div></a>";
    }).join("");
  }

  function viewPatient(p) {
    if (!p) return missing("Paziente non trovato", "#/pazienti");
    const inv = invoicesOf(p.id);
    const fiscal = inv.filter(isFiscal);
    const openPf = inv.filter(function (i) { return isProforma(i) && !i.convertedInvoiceId; });
    const ap = S.appointments.filter(function (a) { return a.patientId === p.id; })
      .sort(function (a, b) { return (b.date + b.time).localeCompare(a.date + a.time); });
    return '<a class="back" href="#/pazienti">Pazienti</a>' +
      '<div class="top"><div><p class="kicker">Paziente</p><h1>' + esc(p.name) + "</h1></div></div>" +
      '<div class="card"><div class="meta">Codice fiscale</div><div>' + esc(p.cf || "Non indicato") + "</div>" +
      birthFieldsHtml(p.cf) +
      '<div class="meta" style="margin-top:8px">Telefono</div><div>' + (p.phone ? '<a href="tel:' + esc(p.phone) + '">' + esc(p.phone) + "</a>" : "Non indicato") + "</div>" +
      '<div class="meta" style="margin-top:8px">Email</div><div>' + (p.email ? '<a href="mailto:' + esc(p.email) + '">' + esc(p.email) + "</a>" : "Non indicata") + "</div>" +
      '<div class="meta" style="margin-top:8px">Indirizzo</div><div>' + esc(p.address || "Non indicato") + "</div>" +
      (p.notes ? '<div class="meta" style="margin-top:8px">Note</div><div>' + esc(p.notes) + "</div>" : "") +
      '<div class="meta" style="margin-top:8px">Sedute già effettuate</div><div>' + seduteBase(p) + ", da cui prosegue la numerazione. In agenda: " +
      ap.length + "</div>" +
      (p.since ? '<div class="meta" style="margin-top:8px">Paziente dal</div><div>' + esc(Money.formatDateIT(p.since)) + "</div>" : "") +
      (!p.cf || !Money.cfValid(p.cf) ? '<div class="warn-box" style="margin-top:12px">Il codice fiscale manca o non torna: serve per la fattura e per la detrazione.</div>' : "") +
      "</div>" +
      '<div class="stack" style="margin-top:12px"><a class="btn" href="#/fatture/nuova?paziente=' + encodeURIComponent(p.id) + '">Nuova fattura</a>' +
      '<a class="btn secondary" href="#/fatture/nuova?paziente=' + encodeURIComponent(p.id) + '&tipo=proforma">Nuova pro forma</a>' +
      '<a class="btn secondary" href="#/agenda/nuovo?paziente=' + encodeURIComponent(p.id) + '">Nuovo appuntamento</a>' +
      '<a class="btn secondary" href="#/pazienti/' + pathId(p.id) + '/modifica">Modifica scheda</a></div>' +
      '<div class="section-title"><h2>Fatture</h2><span>' + esc(Money.formatEuro(sumOf(fiscal).totale)) + "</span></div>" +
      (openPf.length ? '<p class="muted">Il totale è solo delle fatture. Le pro forma aperte non sono incluse.</p>' : "") +
      (inv.length ? '<div class="list">' + inv.map(invoiceRow).join("") + "</div>" : '<div class="empty">Ancora nessuna fattura.</div>') +
      '<div class="section-title"><h2>Appuntamenti</h2></div>' +
      (ap.length ? '<div class="list">' + ap.map(appointmentRow).join("") + "</div>" : '<div class="empty">Nessun appuntamento.</div>');
  }

  function viewPatientForm(existing) {
    const p = existing || { id: "", name: "", phone: "", email: "", cf: "", address: "", notes: "", since: Money.todayISO() };
    return '<a class="back" href="' + (p.id ? "#/pazienti/" + pathId(p.id) : "#/pazienti") + '">Indietro</a>' +
      '<div class="top"><div><p class="kicker">Anagrafica</p><h1>' + (p.id ? "Modifica" : "Nuovo paziente") + "</h1></div></div>" +
      field("Nome e cognome", "p-name", p.name) +
      field("Telefono", "p-phone", p.phone, "tel") +
      field("Email", "p-email", p.email, "email") +
      field("Codice fiscale", "p-cf", p.cf) +
      '<div id="cf-born">' + birthNoteHtml(p.cf) + "</div>" +
      field("Indirizzo", "p-address", p.address) +
      field("Paziente dal", "p-since", p.since, "date") +
      field("Sedute già effettuate", "p-sedute", String(seduteBase(p)), "number") +
      '<p class="muted">Numero di sedute precedenti a quelle segnate in agenda. Ogni appuntamento prende il numero successivo, in ordine di data.</p>' +
      '<div class="field"><label for="p-notes">Note</label><textarea id="p-notes">' + esc(p.notes) + "</textarea></div>" +
      '<button class="btn" type="button" data-action="save-patient" data-id="' + esc(p.id) + '">Salva paziente</button>' +
      (p.id ? '<button class="btn ghost" type="button" data-action="delete-patient" data-id="' + esc(p.id) + '">Elimina paziente</button>' : "");
  }

  function viewInvoices() {
    const years = Array.from(new Set(S.invoices.map(function (i) { return String(i.year); }).concat([String(new Date().getFullYear())]))).sort().reverse();
    const q = S.query;
    const kind = invoiceKind();
    const list = filteredInvoices(q);
    const chips = '<button class="chip' + (S.invoiceYear === "all" ? " on" : "") + '" type="button" data-action="chip-year" data-year="all">Tutti gli anni</button>' +
      years.map(function (y) {
        return '<button class="chip' + (S.invoiceYear === y ? " on" : "") + '" type="button" data-action="chip-year" data-year="' + y + '">' + y + "</button>";
      }).join("");
    const kindChips = [["tutte", "Tutte"], ["fatture", "Fatture"], ["proforma", "Pro forma"]].map(function (pair) {
      return '<button class="chip' + (kind === pair[0] ? " on" : "") + '" type="button" data-action="chip-kind" data-kind="' + pair[0] + '">' + pair[1] + "</button>";
    }).join("");
    const empty = kind === "proforma" ? "Nessuna pro forma in questo elenco." : kind === "fatture" ? "Nessuna fattura in questo elenco." : "Nessun documento in questo elenco.";
    return '<div class="top"><div><p class="kicker">Registro</p><h1>Fatture</h1></div><a class="btn small" href="#/fatture/nuova">Nuova</a></div>' +
      '<div class="chips">' + chips + "</div>" +
      '<div class="chips">' + kindChips + "</div>" +
      gapBanner() +
      '<input id="q" class="search" placeholder="Paziente o numero" value="' + esc(q) + '">' +
      '<p id="list-total" class="muted" style="margin:10px 2px">' + esc(listTotalText(list)) + "</p>" +
      '<div id="results" class="list">' + (list.length ? list.map(invoiceRow).join("") : '<div class="empty">' + empty + "</div>") + "</div>";
  }

  function listTotalText(list) {
    if (invoiceKind() === "proforma") return "Pro forma in elenco: " + list.length + ". Non entrano nel riepilogo fiscale.";
    return "Totale fatture in elenco " + Money.formatEuro(sumOf(list.filter(isFiscal)).totale);
  }

  function gapBanner() {
    if (S.invoiceYear === "all") return "";
    const year = Number(S.invoiceYear);
    const proforma = invoiceKind() === "proforma";
    const missing = gapsWith(year, proforma, "", 0);
    if (!missing.length) return "";
    if (proforma) {
      return '<div class="note-box">Nella numerazione pro forma del ' + year + " " + manca(missing) + ". Apri la pro forma e correggi il numero.</div>";
    }
    return '<div class="warn-box">Nella numerazione delle fatture ' + year + " " + manca(missing) + ". Apri la fattura con il numero sbagliato e cambialo: il nuovo numero deve restare libero.</div>";
  }

  function filteredInvoices(q) {
    const kind = invoiceKind();
    return S.invoices.filter(function (i) {
      if (S.invoiceYear !== "all" && String(i.year) !== S.invoiceYear) return false;
      if (kind === "fatture" && !isFiscal(i)) return false;
      if (kind === "proforma" && !isProforma(i)) return false;
      return matches(i.patientName + " " + i.number + " " + i.description + (isProforma(i) ? " pro forma" : ""), q);
    }).sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return b.number - a.number;
    });
  }

  function viewInvoice(inv) {
    if (!inv) return missing("Documento non trovato", "#/fatture");
    const proforma = isProforma(inv);
    const p = patientById(inv.patientId);
    const converted = proforma && inv.convertedInvoiceId ? S.invoices.find(function (i) { return i.id === inv.convertedInvoiceId; }) : null;
    const origin = !proforma && inv.proformaId ? S.invoices.find(function (i) { return i.id === inv.proformaId; }) : null;
    const rows = [
      ["Competenze", inv.competenze],
      ["Cassa ENPAP 2%", inv.cassa],
      ["Imponibile", inv.imponibile],
      [S.settings.regime === "esente" ? "IVA esente" : "IVA non dovuta", inv.iva],
      ["Totale documento", inv.totaleDocumento],
      ["Marca da bollo", inv.bollo],
    ];
    return '<a class="back" href="#/fatture">Fatture</a>' +
      '<div class="top"><div><p class="kicker">' + esc(docLabel(inv)) + "</p><h1>" + esc(inv.patientName) + "</h1></div></div>" +
      (proforma ? '<div class="note-box">Non è una fattura: non occupa un numero fiscale e non entra nel riepilogo per il commercialista. Quando la prestazione è assolta, convertila.</div>' : "") +
      (converted ? '<div class="note-box">Convertita nella fattura ' + converted.number + "/" + converted.year + '. <a href="#/fatture/' + pathId(converted.id) + '">Apri la fattura</a></div>' : "") +
      (proforma && inv.convertedInvoiceId && !converted ? '<div class="warn-box">Risultava convertita, ma quella fattura non è più in archivio. Puoi convertirla di nuovo.</div>' : "") +
      (inv.proformaNumber ? '<div class="note-box">Emessa dalla pro forma n. ' + esc(inv.proformaNumber) + "/" + esc(inv.proformaYear) +
        (origin ? '. <a href="#/fatture/' + pathId(origin.id) + '">Apri la pro forma</a>' : "") + "</div>" : "") +
      '<div class="card"><div class="label">' + esc(Money.formatDateIT(inv.date)) + "</div>" +
      '<div class="figure">' + esc(Money.formatEuro(inv.totale)) + "</div>" +
      '<div class="sub">' + esc(inv.description || "") + "</div>" +
      '<div class="receipt">' + rows.map(function (r) {
        return "<div><span>" + esc(r[0]) + "</span><span>" + esc(Money.formatEuro(r[1])) + "</span></div>";
      }).join("") + '<div class="grand"><span>Da pagare</span><span>' + esc(Money.formatEuro(inv.totale)) + "</span></div></div>" +
      '<div>' + esc(inv.paymentMethod || "Pagamento non indicato") + (inv.paymentDate ? " · incasso " + esc(Money.formatDateIT(inv.paymentDate)) : " · da incassare") + "</div>" +
      (inv.notes ? "<p>" + esc(inv.notes) + "</p>" : "") +
      (p ? '<p><a href="#/pazienti/' + pathId(p.id) + '">Apri scheda paziente</a></p>' : "") +
      "</div>" +
      bolloCard(inv) +
      '<div class="stack" style="margin-top:12px">' +
      (proforma && !converted ? '<a class="btn" href="#/fatture/' + pathId(inv.id) + '/converti">Converti in fattura</a>' : "") +
      '<button class="btn' + (proforma && !converted ? " secondary" : "") + '" type="button" data-action="share-invoice" data-id="' + esc(inv.id) + '">Invia PDF</button>' +
      '<button class="btn secondary" type="button" data-action="pdf-invoice" data-id="' + esc(inv.id) + '">Scarica PDF</button>' +
      '<a class="btn secondary" href="#/fatture/' + pathId(inv.id) + '/modifica">Modifica</a>' +
      '<button class="btn ghost" type="button" data-action="delete-invoice" data-id="' + esc(inv.id) + '">Elimina</button></div>';
  }

  function bolloCard(inv) {
    if (!bolloDue(inv)) return "";
    const prova = inv.bolloProva || {};
    const modo = prova.modo || (S.settings.bolloMode === "virtuale" ? "elettronica" : "cartacea");
    const file = prova.fileId ? fileById(prova.fileId) : null;
    const url = fileUrl(file);
    const preview = !file ? "" : (file.type === "application/pdf"
      ? '<a class="btn secondary" href="' + url + '" target="_blank" rel="noopener">Apri il PDF archiviato</a>'
      : '<img class="scan" src="' + url + '" alt="Scansione della marca da bollo">');
    return '<div class="card" style="margin-top:12px"><div class="label">Marca da bollo</div>' +
      '<p class="muted">Archivia la scansione del foglio stampato con la marca cartacea, oppure il PDF se l\'imposta è assolta in modo elettronico.</p>' +
      '<div class="seg"><button type="button" class="' + (modo === "cartacea" ? "on" : "") + '" data-action="bollo-modo" data-id="' + esc(inv.id) + '" data-modo="cartacea">Cartacea</button>' +
      '<button type="button" class="' + (modo === "elettronica" ? "on" : "") + '" data-action="bollo-modo" data-id="' + esc(inv.id) + '" data-modo="elettronica">Elettronica</button></div>' +
      '<div class="field"><label for="bollo-data">Data di assolvimento</label><input id="bollo-data" data-id="' + esc(inv.id) + '" type="date" value="' + esc(prova.data || "") + '"></div>' +
      preview +
      '<label class="btn secondary">' + (file ? "Sostituisci la scansione" : "Scatta o scegli la scansione") +
      '<input class="bollo-file" data-id="' + esc(inv.id) + '" type="file" accept="image/*,application/pdf" hidden></label>' +
      (file ? '<button class="btn ghost" type="button" data-action="bollo-remove" data-id="' + esc(inv.id) + '">Rimuovi scansione</button>' : "") +
      "</div>";
  }

  function icloudCard() {
    const st = window.Sync ? Sync.state : {};
    const when = st.updatedAt ? st.updatedAt.replace("T", " ").slice(0, 16) : "";
    const name = st.folderName || "Drive";
    let status = st.canPick ? "Nessuna cartella collegata: le modifiche restano su questo dispositivo." : "Su questo browser la cartella non si può tenere aperta.";
    if (st.linked && st.needsAuth) status = "Cartella «" + name + "»: serve di nuovo il permesso di scrittura.";
    else if (st.linked) status = "Sincronizzazione attiva con «" + name + "». Ogni modifica si scrive nel file.";
    const intro = st.canPick
      ? "Scegli una volta la cartella, in iCloud Drive oppure in Google Drive, e consenti l'accesso a ogni visita. Da quel momento la sincronizzazione è automatica: un salvataggio aggiorna il file e, all'apertura, l'app legge le modifiche arrivate dall'altro dispositivo. Scorrendo verso il basso si forza un aggiornamento subito."
      : "La sincronizzazione continua è disponibile in Chrome o Edge sul Mac: lì si sceglie la cartella una volta. Safari, anche su iPhone, non lascia a un sito il permesso duraturo su una cartella, quindi qui si può solo copiare il file o leggerne uno già salvato.";
    return '<div class="card" style="margin-bottom:12px"><h2>Cartella su Drive</h2>' +
      '<p class="muted">Pazienti, fatture e scansioni del bollo stanno nel file <strong>archivio-fatture-sonia.json</strong>. ' + intro + "</p>" +
      '<p>' + esc(status) + (when ? " Ultima modifica " + esc(when) + "." : "") + "</p>" +
      (st.lastError ? '<div class="warn-box">' + esc(st.lastError) + "</div>" : "") +
      (st.conflict ? '<div class="warn-box">Questo dispositivo e la cartella hanno modifiche diverse. Scegli quale copia tenere.</div>' +
        '<div class="stack"><button class="btn" type="button" data-action="sync-keep-remote">Tieni la copia della cartella</button>' +
        '<button class="btn secondary" type="button" data-action="sync-keep-local">Tieni questo dispositivo</button></div>' : "") +
      '<div class="stack">' +
      (st.canPick && !st.linked ? '<button class="btn" type="button" data-action="sync-choose">Scegli cartella su File o Drive</button>' : "") +
      (st.canPick && st.linked && st.needsAuth ? '<button class="btn" type="button" data-action="sync-auth">Autorizza la cartella</button>' : "") +
      (st.canPick && st.linked ? '<button class="btn secondary" type="button" data-action="sync-now">Aggiorna ora</button>' : "") +
      (st.canPick && st.linked ? '<button class="btn secondary" type="button" data-action="sync-choose">Cambia cartella</button>' : "") +
      (!st.canPick ? '<button class="btn secondary" type="button" data-action="export-backup">Copia il file</button>' +
        '<label class="btn secondary">Leggi un file<input class="import-file" type="file" accept="application/json,.json" hidden></label>' : "") +
      (st.linked ? '<button class="btn ghost" type="button" data-action="sync-disconnect">Scollega cartella</button>' : "") +
      "</div></div>";
  }

  function ensureDraft(existing, q) {
    const key = location.hash;
    if (draft && draftKey === key) return draft;
    draftKey = key;
    if (existing) {
      draft = Object.assign({}, existing, {
        kind: existing.kind === "proforma" ? "proforma" : "fattura",
        numberInput: String(existing.number),
        numberTouched: true,
        amountInput: Money.centsToInput(existing.calcMode === "competenze" ? existing.competenze : existing.totale),
        paid: !!existing.paymentDate,
      });
    } else {
      const patientId = q.get("paziente") || "";
      const proforma = q.get("tipo") === "proforma";
      const date = q.get("data") || Money.todayISO();
      const last = patientId ? lastInvoiceFor(patientId) : null;
      draft = {
        id: "",
        kind: proforma ? "proforma" : "fattura",
        numberInput: String(nextNumber(Number(date.slice(0, 4)), "", proforma)),
        numberTouched: false,
        patientId: patientId,
        date: date,
        description: S.settings.descrizioneDefault || DESCRIZIONI[0],
        calcMode: "totale",
        amountInput: last ? Money.centsToInput(last.totale) : "",
        paymentMethod: last ? last.paymentMethod : "BANCOMAT",
        paid: !proforma,
        paymentDate: date,
        notes: "",
        appointmentId: q.get("app") || "",
      };
    }
    return draft;
  }

  function calcDraft() {
    const cents = Money.parseEuroToCents(draft.amountInput);
    if (cents == null) return null;
    return draft.calcMode === "competenze" ? Money.fromCompetenze(cents) : Money.fromTotale(cents);
  }

  function breakdownHtml() {
    const calc = calcDraft();
    if (!draft.amountInput) return '<p class="muted">Scrivi l\'importo: il dettaglio si calcola da solo, come nel foglio.</p>';
    if (!calc) return '<div class="warn-box">Importo non valido. Usa ad esempio 60 oppure 60,50.</div>';
    if (calc.grey) {
      return '<div class="warn-box">Con questo totale il bollo da 2 € non è coerente. Il bollo è dovuto solo se il documento supera 77,47 €. Scegli fino a 77,47 €, oppure almeno 79,48 €, oppure parti dalle competenze.</div>';
    }
    const rows = [
      ["Competenze", calc.competenze],
      ["Cassa ENPAP 2%", calc.cassa],
      ["Imponibile", calc.imponibile],
      ["IVA", calc.iva],
      ["Totale documento", calc.totaleDocumento],
      ["Marca da bollo", calc.bollo],
    ];
    return '<div class="receipt">' + rows.map(function (r) {
      return "<div><span>" + r[0] + "</span><span>" + esc(Money.formatEuro(r[1])) + "</span></div>";
    }).join("") + '<div class="grand"><span>Da pagare</span><span>' + esc(Money.formatEuro(calc.totale)) + "</span></div></div>" +
      (calc.bollo ? '<div class="note-box">Bollo da 2 € perché il documento supera 77,47 €.</div>' : '<div class="note-box">Bollo non dovuto: il documento non supera 77,47 €.</div>');
  }

  function viewInvoiceForm(existing, q) {
    if (existing === undefined) return missing("Documento non trovato", "#/fatture");
    const d = ensureDraft(existing, q);
    const proforma = d.kind === "proforma";
    const options = sortedPatients().map(function (p) {
      return '<option value="' + esc(p.id) + '"' + (p.id === d.patientId ? " selected" : "") + ">" + esc(p.name) + "</option>";
    }).join("");
    const descOpts = DESCRIZIONI.map(function (x) { return '<option value="' + esc(x) + '">'; }).join("");
    const payOpts = PAGAMENTI.map(function (x) {
      return '<option' + (x === d.paymentMethod ? " selected" : "") + ">" + x + "</option>";
    }).join("");
    const year = Number((d.date || Money.todayISO()).slice(0, 4));
    const previewN = String(d.numberInput || nextNumber(year, d.id, proforma)).trim() || "—";
    const heading = d.id ? (proforma ? "Modifica pro forma" : "Modifica fattura") : (proforma ? "Nuova pro forma" : "Nuova fattura");
    const kindSeg = d.id ? "" :
      '<div class="seg"><button type="button" class="' + (proforma ? "" : "on") + '" data-action="seg-kind" data-kind="fattura">Fattura</button>' +
      '<button type="button" class="' + (proforma ? "on" : "") + '" data-action="seg-kind" data-kind="proforma">Pro forma</button></div>';
    return '<a class="back" href="' + (d.id ? "#/fatture/" + pathId(d.id) : "#/fatture") + '">Indietro</a>' +
      kindSeg +
      '<div class="top"><div><p class="kicker" id="doc-kicker">' + (proforma ? "Pro forma " : "Numero ") + esc(previewN) + "/" + year + "</p><h1>" + heading + "</h1></div></div>" +
      (proforma && d.convertedInvoiceId ? '<div class="note-box">Già convertita nella fattura ' + esc(d.convertedNumber) + "/" + esc(d.convertedYear) + ". Le modifiche restano sulla pro forma e non cambiano la fattura.</div>" : "") +
      (!proforma && d.proformaNumber ? '<div class="note-box">Questa fattura nasce dalla pro forma n. ' + esc(d.proformaNumber) + "/" + esc(d.proformaYear) + ".</div>" : "") +
      '<div class="field"><label for="inv-number">Numero</label><input id="inv-number" inputmode="numeric" value="' + esc(d.numberInput || "") + '"></div>' +
      '<div id="num-hint">' + numberHintHtml(year, d.numberInput, d.id, proforma) + "</div>" +
      '<div class="field"><label for="inv-patient">Paziente</label><select id="inv-patient">' +
      '<option value="">Scegli</option>' + options + "</select></div>" +
      '<div class="field"><label for="inv-date">Data ' + (proforma ? "pro forma" : "fattura") + '</label><input id="inv-date" type="date" value="' + esc(d.date) + '"></div>' +
      '<div class="seg"><button type="button" class="' + (d.calcMode !== "competenze" ? "on" : "") + '" data-action="seg-mode" data-mode="totale">Parto dal totale</button>' +
      '<button type="button" class="' + (d.calcMode === "competenze" ? "on" : "") + '" data-action="seg-mode" data-mode="competenze">Parto dalle competenze</button></div>' +
      '<div class="field"><label for="amount">' + (d.calcMode === "competenze" ? "Competenze" : "Totale da pagare") + '</label>' +
      '<input id="amount" class="amount-input" inputmode="decimal" value="' + esc(d.amountInput) + '" placeholder="0"></div>' +
      (d.patientId && lastInvoiceFor(d.patientId) ? '<button class="btn secondary" type="button" data-action="use-last">Usa l\'importo dell\'ultima fattura</button>' : "") +
      '<div id="breakdown">' + breakdownHtml() + "</div>" +
      '<div class="field"><label for="inv-desc">Prestazione</label><input id="inv-desc" list="desc-list" value="' + esc(d.description) + '"><datalist id="desc-list">' + descOpts + "</datalist></div>" +
      '<div class="field"><label for="inv-pay">Modalità</label><select id="inv-pay">' + payOpts + "</select></div>" +
      '<label class="check"><input id="inv-paid" type="checkbox"' + (d.paid ? " checked" : "") + "> Già incassata</label>" +
      '<div class="field"><label for="inv-paydate">Data di pagamento</label><input id="inv-paydate" type="date" value="' + esc(d.paymentDate || d.date) + '"></div>' +
      '<div class="field"><label for="inv-notes">Note</label><textarea id="inv-notes">' + esc(d.notes || "") + "</textarea></div>" +
      '<button class="btn" type="button" data-action="save-invoice">Salva ' + (proforma ? "pro forma" : "fattura") + "</button>";
  }

  function convertPreviewHtml(date) {
    if (!date || date.length < 4) return '<div class="warn-box">Scegli la data della fattura.</div>';
    const year = Number(date.slice(0, 4));
    const n = nextNumber(year, "", false);
    const missing = gapsWith(year, false, "", 0);
    return '<div class="note-box">Diventerà la fattura <strong>n. ' + n + "/" + year + "</strong>." +
      (missing.length ? " Nella sequenza " + manca(missing) + ". Se è un errore, correggi quel numero prima di convertire." : "") +
      "</div>";
  }

  function viewConvert(inv) {
    if (!inv) return missing("Pro forma non trovata", "#/fatture");
    if (!isProforma(inv)) return missing("Solo una pro forma si converte in fattura.", "#/fatture/" + inv.id);
    const linked = inv.convertedInvoiceId && S.invoices.find(function (i) { return i.id === inv.convertedInvoiceId; });
    if (linked) {
      return '<a class="back" href="#/fatture/' + pathId(inv.id) + '">Pro forma</a>' +
        '<div class="top"><div><p class="kicker">Già convertita</p><h1>Fattura ' + linked.number + "/" + linked.year + "</h1></div></div>" +
        '<p>Questa pro forma è già diventata una fattura. Il numero fiscale non viene assegnato una seconda volta.</p>' +
        '<a class="btn" href="#/fatture/' + pathId(linked.id) + '">Apri la fattura</a>';
    }
    const date = Money.todayISO();
    return '<a class="back" href="#/fatture/' + pathId(inv.id) + '">Pro forma</a>' +
      '<div class="top"><div><p class="kicker">Da pro forma ' + inv.number + "/" + inv.year + '</p><h1>Converti in fattura</h1></div></div>' +
      '<div class="card"><div class="label">' + esc(inv.patientName) + "</div>" +
      '<div class="figure">' + esc(Money.formatEuro(inv.totale)) + "</div>" +
      '<div class="sub">' + esc(inv.description || "") + "</div></div>" +
      '<div class="field"><label for="conv-date">Data della fattura</label><input id="conv-date" type="date" value="' + esc(date) + '"></div>' +
      '<div id="conv-preview">' + convertPreviewHtml(date) + "</div>" +
      '<p class="muted">Importi, prestazione e pagamento restano quelli della pro forma. La pro forma resta in archivio, segnata come convertita.</p>' +
      '<button class="btn" type="button" data-action="convert-invoice" data-id="' + esc(inv.id) + '">Crea la fattura</button>';
  }

  function viewAgenda() {
    const parts = S.month.split("-").map(Number);
    const y = parts[0];
    const m = parts[1];
    const first = new Date(y, m - 1, 1);
    const start = (first.getDay() + 6) % 7;
    const daysIn = new Date(y, m, 0).getDate();
    const marks = {};
    S.appointments.forEach(function (a) { if (a.date && a.date.slice(0, 7) === S.month) marks[a.date] = true; });
    const birthMarks = {};
    for (let d = 1; d <= daysIn; d++) {
      const iso = y + "-" + String(m).padStart(2, "0") + "-" + String(d).padStart(2, "0");
      if (birthdaysOn(iso).length) birthMarks[iso] = true;
    }
    let cells = "";
    for (let i = 0; i < start; i++) cells += '<button type="button" class="out" tabindex="-1"></button>';
    for (let d = 1; d <= daysIn; d++) {
      const iso = y + "-" + String(m).padStart(2, "0") + "-" + String(d).padStart(2, "0");
      const cls = (iso === S.day ? " on" : "") + (iso === Money.todayISO() ? " today" : "") + (marks[iso] ? " has" : "") + (birthMarks[iso] ? " bday" : "");
      cells += '<button type="button" class="' + cls + '" data-action="pick-day" data-date="' + iso + '">' + d + "</button>";
    }
    const dayItems = S.appointments.filter(function (a) { return a.date === S.day; })
      .sort(function (a, b) { return (a.time || "").localeCompare(b.time || ""); });
    const birthItems = birthdaysOn(S.day);
    return '<div class="top"><div><p class="kicker">Calendario</p><h1>Agenda</h1></div>' +
      '<a class="btn small" href="#/agenda/nuovo?data=' + esc(S.day) + '">Nuovo</a></div>' +
      '<div class="card"><div class="cal-head"><button type="button" data-action="prev-month" aria-label="Mese precedente">‹</button>' +
      '<strong>' + MESI[m - 1] + " " + y + '</strong>' +
      '<button type="button" data-action="next-month" aria-label="Mese successivo">›</button></div>' +
      '<div class="weekdays"><span>L</span><span>M</span><span>M</span><span>G</span><span>V</span><span>S</span><span>D</span></div>' +
      '<div class="days">' + cells + "</div></div>" +
      agendaMiddle() +
      '<div class="section-title"><h2>' + esc(Money.formatDateIT(S.day)) + "</h2></div>" +
      (birthItems.length ? '<div class="list">' + birthItems.map(birthdayRow).join("") + "</div>" : "") +
      (dayItems.length ? '<div class="list">' + dayItems.map(appointmentRow).join("") + "</div>" : "") +
      (!birthItems.length && !dayItems.length ? '<div class="empty">Nessun appuntamento in questo giorno.</div>' : "") +
      calendarCard();
  }

  function agendaMiddle() {
    const births = birthdaysInMonth(S.month);
    const today = Money.todayISO();
    const upcoming = S.appointments.filter(function (a) { return a.date >= today; })
      .sort(function (a, b) { return (a.date + (a.time || "")).localeCompare(b.date + (b.time || "")); });
    const birthBody = births.length
      ? '<div class="list">' + births.map(monthBirthdayRow).join("") + "</div>"
      : '<div class="empty">Nessun compleanno in questo mese.</div>';
    const nextBody = upcoming.length
      ? '<div class="list">' + upcoming.map(appointmentRow).join("") + "</div>"
      : '<div class="empty">Nessun appuntamento in programma.</div>';
    return foldSection("compleanni", "Compleanni del mese", births.length, birthBody) +
      foldSection("prossimi", "Prossimi appuntamenti", upcoming.length, nextBody);
  }

  function calendarCard() {
    return '<div class="card" style="margin-top:16px"><h2>Calendario del telefono</h2>' +
      '<p class="muted">Invia gli appuntamenti al calendario del telefono: nel foglio di condivisione scegli Calendario. Per portare qui un calendario già esistente, esportalo come file .ics da Apple o Google e importalo. Il collegamento non resta aperto da solo: si aggiorna quando invii o importi di nuovo.</p>' +
      '<div class="stack"><button class="btn" type="button" data-action="export-calendar">Invia al calendario del telefono</button>' +
      '<label class="btn secondary">Importa un calendario<input class="calendar-file" type="file" accept=".ics,.ical,text/calendar" hidden></label></div></div>';
  }

  function viewAppointment(ap) {
    if (!ap) return missing("Appuntamento non trovato", "#/agenda");
    const inv = ap.invoiceId ? S.invoices.find(function (i) { return i.id === ap.invoiceId; }) : null;
    const pf = ap.proformaId ? S.invoices.find(function (i) { return i.id === ap.proformaId; }) : null;
    const newQuery = "paziente=" + encodeURIComponent(ap.patientId) + "&data=" + esc(ap.date) + "&app=" + encodeURIComponent(ap.id);
    return '<a class="back" href="#/agenda">Agenda</a>' +
      '<div class="top"><div><p class="kicker">' + esc(Money.formatDateIT(ap.date)) + (ap.time ? " · " + esc(ap.time) : "") + "</p><h1>" + esc(ap.patientName) + "</h1></div></div>" +
      '<div class="card"><div class="meta">Seduta</div><div>' + sessionNumber(ap) + "</div>" +
      (ap.notes ? "<p>" + esc(ap.notes) + "</p>" : "<p class=\"muted\">Nessuna nota.</p>") +
      '<span class="badge ' + (inv ? "ok" : pf ? "pf" : "neutral") + '">' + (inv ? "Fatturato" : pf ? "Pro forma" : "Da fatturare") + "</span></div>" +
      '<div class="stack" style="margin-top:12px">' +
      (inv ? '<a class="btn" href="#/fatture/' + pathId(inv.id) + '">Apri fattura ' + inv.number + "/" + inv.year + "</a>" :
        '<a class="btn" href="#/fatture/nuova?' + newQuery + '">Crea fattura</a>') +
      (pf ? '<a class="btn secondary" href="#/fatture/' + pathId(pf.id) + '">Apri pro forma ' + pf.number + "/" + pf.year + "</a>" :
        (!inv ? '<a class="btn secondary" href="#/fatture/nuova?tipo=proforma&' + newQuery + '">Crea pro forma</a>' : "")) +
      '<a class="btn secondary" href="#/agenda/nuovo?id=' + encodeURIComponent(ap.id) + '">Modifica</a>' +
      '<button class="btn secondary" type="button" data-action="export-calendar" data-id="' + esc(ap.id) + '">Aggiungi al calendario</button>' +
      '<button class="btn ghost" type="button" data-action="delete-appointment" data-id="' + esc(ap.id) + '">Elimina</button></div>';
  }

  function viewAppointmentForm(existing, q) {
    const id = q.get("id");
    const ap = existing || S.appointments.find(function (a) { return a.id === id; }) || {
      id: "",
      patientId: q.get("paziente") || "",
      date: q.get("data") || S.day || Money.todayISO(),
      time: "15:00",
      notes: "",
      invoiced: false,
    };
    const options = sortedPatients().map(function (p) {
      return '<option value="' + esc(p.id) + '"' + (p.id === ap.patientId ? " selected" : "") + ">" + esc(p.name) + "</option>";
    }).join("");
    return '<a class="back" href="#/agenda">Agenda</a>' +
      '<div class="top"><div><p class="kicker">Calendario</p><h1>' + (ap.id ? "Modifica appuntamento" : "Nuovo appuntamento") + "</h1></div></div>" +
      '<div class="field"><label for="a-patient">Paziente</label><select id="a-patient"><option value="">Scegli</option>' + options + "</select></div>" +
      '<div class="inline"><div class="field"><label for="a-date">Data</label><input id="a-date" type="date" value="' + esc(ap.date) + '"></div>' +
      '<div class="field"><label for="a-time">Ora</label><input id="a-time" type="time" value="' + esc(ap.time || "") + '"></div></div>' +
      '<div class="field"><label for="a-notes">Note</label><textarea id="a-notes">' + esc(ap.notes || "") + "</textarea></div>" +
      '<label class="check"><input id="a-invoiced" type="checkbox"' + (ap.invoiced ? " checked" : "") + "> Già fatturato</label>" +
      '<button class="btn" type="button" data-action="save-appointment" data-id="' + esc(ap.id) + '">Salva appuntamento</button>';
  }

  function exportSelection() {
    return S.invoices.filter(function (i) { return isFiscal(i) && inRange(i, S.exportFrom, S.exportTo); })
      .sort(function (a, b) {
        if (a.date !== b.date) return a.date < b.date ? -1 : 1;
        return a.number - b.number;
      });
  }

  function summaryText(list) {
    const t = sumOf(list);
    return "Riepilogo fatture " + S.settings.nome + "\n" +
      "Periodo: " + Money.formatDateIT(S.exportFrom) + " – " + Money.formatDateIT(S.exportTo) + "\n" +
      "Numero fatture: " + t.count + "\n" +
      "Totale da pagare: " + Money.formatEuro(t.totale) + "\n" +
      "Competenze: " + Money.formatEuro(t.competenze) + "\n" +
      "Cassa ENPAP 2%: " + Money.formatEuro(t.cassa) + "\n" +
      "Imponibile: " + Money.formatEuro(t.imponibile) + "\n" +
      "Marca da bollo: " + Money.formatEuro(t.bollo) + "\n";
  }

  function exportMeta(list) {
    const t = sumOf(list);
    return {
      title: "Riepilogo fatture " + S.settings.nome,
      period: "Dal " + Money.formatDateIT(S.exportFrom) + " al " + Money.formatDateIT(S.exportTo),
      piva: S.settings.piva,
      cf: S.settings.cf,
      settings: S.settings,
      invoices: list,
      totals: t,
      patientOf: patientById,
    };
  }

  function viewExport() {
    const list = exportSelection();
    const t = sumOf(list);
    return '<div class="top"><div><p class="kicker">Commercialista</p><h1>Esporta</h1></div></div>' +
      '<div class="inline"><div class="field"><label for="ex-from">Dal</label><input id="ex-from" type="date" value="' + esc(S.exportFrom) + '"></div>' +
      '<div class="field"><label for="ex-to">Al</label><input id="ex-to" type="date" value="' + esc(S.exportTo) + '"></div></div>' +
      '<div class="card"><div class="label">' + t.count + " fatture</div><div class=\"figure\">" + esc(Money.formatEuro(t.totale)) + "</div>" +
      '<div class="sub">Competenze ' + esc(Money.formatEuro(t.competenze)) + " · cassa " + esc(Money.formatEuro(t.cassa)) + " · bollo " + esc(Money.formatEuro(t.bollo)) + "</div></div>" +
      '<div class="field" style="margin-top:12px"><label for="ex-mail">Email del commercialista</label><input id="ex-mail" type="email" value="' + esc(S.settings.emailCommercialista || "") + '" placeholder="nome@studio.it"></div>' +
      '<label class="check"><input id="ex-xlsx" type="checkbox"' + (S.attachExcel ? " checked" : "") + "> Allega Excel</label>" +
      '<label class="check"><input id="ex-pdf" type="checkbox"' + (S.attachPdf ? " checked" : "") + "> Allega PDF di riepilogo</label>" +
      '<label class="check"><input id="ex-invoices" type="checkbox"' + (S.attachInvoices ? " checked" : "") + "> Allega PDF con tutte le fatture</label>" +
      '<div class="stack"><button class="btn" type="button" data-action="send-summary">Invia per email</button>' +
      '<button class="btn secondary" type="button" data-action="make-excel">Scarica Excel</button>' +
      '<button class="btn secondary" type="button" data-action="make-pdf-summary">Scarica PDF</button></div>' +
      '<div class="section-title"><h2>Nel periodo</h2></div>' +
      (list.length ? '<div class="list">' + list.map(invoiceRow).join("") + "</div>" : '<div class="empty">Nessuna fattura in queste date.</div>') +
      '<p class="muted">Il riepilogo ha le stesse colonne del foglio, più il codice fiscale del paziente. Il PDF delle fatture mette una fattura per pagina. Le pro forma non sono incluse: entrano solo dopo la conversione in fattura.</p>';
  }

  function viewAltro() {
    return brandBlock("Studio") +
      icloudCard() +
      '<div class="list">' +
      linkRow("#/esporta", "Esporta e invia", "Excel o PDF dal giorno al giorno") +
      linkRow("#/impostazioni", "Dati del professionista", "Intestazione di legge sulle fatture") +
      linkRow("#/aiuto", "Come usarla su iPhone", "Safari, anche a Mac spento") +
      "</div>";
  }

  function linkRow(href, title, meta) {
    return '<a class="row" href="' + href + '"><div class="main"><div class="name">' + title + '</div><div class="meta">' + meta + "</div></div></a>";
  }

  function viewSettings() {
    const s = S.settings;
    const fields = [
      ["studioNome", "Nome dello studio", s.studioNome],
      ["titolo", "Titolo", s.titolo],
      ["nome", "Nome e cognome", s.nome],
      ["qualifica", "Qualifica", s.qualifica],
      ["ordine", "Ordine professionale", s.ordine],
      ["sezione", "Sezione albo", s.sezione],
      ["numeroAlbo", "Numero iscrizione", s.numeroAlbo],
      ["delibera", "Estremi iscrizione", s.delibera],
      ["piva", "Partita IVA", s.piva],
      ["cf", "Codice fiscale", s.cf],
      ["studio", "Studio", s.studio],
      ["domicilio", "Domicilio fiscale", s.domicilio],
      ["telefono", "Telefono", s.telefono],
      ["email", "Email", s.email],
      ["pec", "PEC", s.pec],
      ["sito", "Sito", s.sito],
      ["iban", "IBAN", s.iban],
      ["banca", "Banca", s.banca],
      ["intestatario", "Intestatario conto", s.intestatario],
      ["enpap", "Posizione ENPAP", s.enpap],
      ["descrizioneDefault", "Prestazione predefinita", s.descrizioneDefault],
      ["emailCommercialista", "Email commercialista", s.emailCommercialista],
    ];
    const customLogo = !!s.logoData;
    return '<div class="top"><div><p class="kicker">Intestazione</p><h1>Professionista</h1></div></div>' +
      '<div class="note-box">Logo, nome e dati dello studio sono il profilo di questo professionista. Restano nell\'archivio del dispositivo e nella cartella condivisa: un aggiornamento dell\'app non li sostituisce. Per un altro studio si compilano qui.</div>' +
      '<div class="logo-edit"><img class="brand-logo" src="' + logoSrc() + '" alt="Logo dello studio"><div class="stack">' +
      '<label class="btn secondary">Cambia logo<input id="logo-file" type="file" accept="image/png,image/jpeg,image/webp" hidden></label>' +
      (customLogo ? '<button class="btn ghost" type="button" data-action="logo-reset">Torna al logo predefinito</button>' : "") +
      "</div></div>" +
      '<p class="muted">Questi dati finiscono su ogni PDF. Il regime parte dal forfettario. Se il commercialista usa l\'esenzione sanitaria, cambialo qui.</p>' +
      fields.map(function (f) { return field(f[1], "s-" + f[0], f[2] || ""); }).join("") +
      '<div class="field"><label>Regime in fattura</label><select id="s-regime">' +
      '<option value="forfettario"' + (s.regime !== "esente" ? " selected" : "") + ">Regime forfettario, Legge 190/2014</option>" +
      '<option value="esente"' + (s.regime === "esente" ? " selected" : "") + ">Esente IVA, art. 10 n. 18 DPR 633/72</option></select></div>" +
      '<div class="field"><label>Marca da bollo</label><select id="s-bollo">' +
      '<option value="originale"' + (s.bolloMode !== "virtuale" ? " selected" : "") + ">Assolta sull'originale</option>" +
      '<option value="virtuale"' + (s.bolloMode === "virtuale" ? " selected" : "") + ">Assolta in modo virtuale</option></select></div>" +
      '<button class="btn" type="button" data-action="save-settings">Salva dati</button>' +
      '<div class="section-title"><h2>PIN del dispositivo</h2></div>' +
      '<div class="field"><label for="new-pin">Nuovo PIN (4-6 cifre)</label><input id="new-pin" inputmode="numeric" type="password" autocomplete="off"></div>' +
      '<div class="stack"><button class="btn secondary" type="button" data-action="set-pin">Imposta PIN</button>' +
      (s.pinHash ? '<button class="btn ghost" type="button" data-action="clear-pin">Rimuovi PIN</button>' : "") + "</div>" +
      '<div class="section-title"><h2>Copia e iCloud</h2></div>' +
      icloudCard() +
      '<button class="btn ghost" type="button" data-action="restore-seed">Ripristina i dati del foglio Excel</button>';
  }

  function viewHelp() {
    return '<div class="top"><div><p class="kicker">iPhone e iPad</p><h1>Come usarla</h1></div></div>' +
      '<div class="card help"><ol>' +
      "<li>In Safari, su iPhone o iPad, apri <strong>https://stefanoinnamorati.github.io/fatture-sonia/</strong>. Il Mac può restare spento.</li>" +
      "<li>Tocca Condividi e poi <strong>Aggiungi a Home</strong>.</li>" +
      "<li>La sincronizzazione continua si attiva in Chrome o Edge sul Mac: in <strong>Impostazioni</strong> scegli una volta la cartella su iCloud Drive o Google Drive. I salvataggi aggiornano il file da soli.</li>" +
      "<li>Safari e iPhone non possono tenere aperta quella cartella. Da lì, se serve un passaggio singolo, usa <strong>Copia il file</strong> e <strong>Leggi un file</strong>.</li>" +
      "<li>Se la fattura supera 77,47 €, apri la fattura e archivia la foto del foglio con la marca da bollo, oppure il PDF dell'assolvimento elettronico.</li>" +
      "<li>Per mandare il riepilogo: Esporta, scegli le date, poi <strong>Invia per email</strong>.</li>" +
      "<li>In Agenda tocca <strong>Compleanni del mese</strong> e <strong>Prossimi appuntamenti</strong>. Il numero di seduta prosegue da <strong>Sedute già effettuate</strong> nella scheda paziente.</li>" +
      "<li><strong>Invia al calendario del telefono</strong> prepara un file che Calendario può aggiungere. <strong>Importa un calendario</strong> legge un file .ics esportato da Apple o Google.</li>" +
      "</ol>" +
      "<p>I pazienti e le scansioni del bollo restano su questo dispositivo finché non li pubblichi nella cartella iCloud. Il PDF della singola fattura riporta albo, partita IVA, codice fiscale, studio, domicilio, prestazione, cassa ENPAP e bollo. Non sostituisce l'invio della fattura elettronica al Sistema di Interscambio, se è dovuto.</p>" +
      "<p>Una pro forma non è una fattura: ha una numerazione propria e non entra nel riepilogo. Quando la prestazione è assolta, aprila e tocca <strong>Converti in fattura</strong>: riceve il primo numero fiscale libero. Se un numero di fattura è sbagliato, aprila in modifica e cambialo. Il numero deve restare unico nell'anno; se la sequenza resta bucata, l'app lo segnala.</p></div>";
  }

  function field(label, id, value, type) {
    return '<div class="field"><label for="' + id + '">' + esc(label) + '</label><input id="' + id + '" type="' + (type || "text") + '" value="' + esc(value || "") + '"></div>';
  }

  function missing(text, href) {
    return '<a class="back" href="' + href + '">Indietro</a><div class="empty">' + esc(text) + "</div>";
  }

  function captureDraftFromDom() {
    if (!draft || !document.getElementById("amount")) return;
    draft.amountInput = document.getElementById("amount").value;
    draft.patientId = document.getElementById("inv-patient").value;
    draft.date = document.getElementById("inv-date").value;
    draft.description = document.getElementById("inv-desc").value;
    draft.paymentMethod = document.getElementById("inv-pay").value;
    draft.paid = document.getElementById("inv-paid").checked;
    draft.paymentDate = document.getElementById("inv-paydate").value;
    draft.notes = document.getElementById("inv-notes").value;
    const num = document.getElementById("inv-number");
    if (num) draft.numberInput = num.value;
  }

  function readExportInputs() {
    const from = document.getElementById("ex-from");
    if (!from) return;
    S.exportFrom = from.value || S.exportFrom;
    S.exportTo = document.getElementById("ex-to").value || S.exportTo;
    S.attachExcel = document.getElementById("ex-xlsx").checked;
    S.attachPdf = document.getElementById("ex-pdf").checked;
    S.attachInvoices = document.getElementById("ex-invoices").checked;
    S.settings.emailCommercialista = document.getElementById("ex-mail").value.trim();
  }

  async function onClick(e) {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    captureDraftFromDom();
    const action = btn.dataset.action;
    if (action === "chip-year") {
      S.invoiceYear = btn.dataset.year;
      render();
    } else if (action === "chip-kind") {
      S.invoiceKind = btn.dataset.kind;
      if ((location.hash || "").indexOf("?") !== -1) location.hash = "#/fatture";
      else render();
    } else if (action === "seg-kind") {
      if (!draft || draft.id) return;
      draft.kind = btn.dataset.kind === "proforma" ? "proforma" : "fattura";
      if (!draft.numberTouched) {
        const year = Number((draft.date || Money.todayISO()).slice(0, 4));
        draft.numberInput = String(nextNumber(year, "", draft.kind === "proforma"));
      }
      draft.paid = draft.kind !== "proforma";
      render();
    } else if (action === "seg-mode") {
      draft.calcMode = btn.dataset.mode;
      render();
    } else if (action === "use-last") {
      const last = lastInvoiceFor(draft.patientId);
      if (last) {
        draft.calcMode = "totale";
        draft.amountInput = Money.centsToInput(last.totale);
        draft.paymentMethod = last.paymentMethod || draft.paymentMethod;
        draft.description = last.description || draft.description;
        render();
      }
    } else if (action === "pick-day") {
      S.day = btn.dataset.date;
      render();
    } else if (action === "prev-month" || action === "next-month") {
      const parts = S.month.split("-").map(Number);
      const d = new Date(parts[0], parts[1] - 1 + (action === "next-month" ? 1 : -1), 1);
      S.month = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
      render();
    } else if (action === "save-invoice") {
      await saveInvoice();
    } else if (action === "convert-invoice") {
      await convertProforma(btn.dataset.id);
    } else if (action === "delete-invoice") {
      await deleteInvoice(btn.dataset.id);
    } else if (action === "pdf-invoice" || action === "share-invoice") {
      await outputInvoice(btn.dataset.id, action === "share-invoice");
    } else if (action === "save-patient") {
      await savePatient(btn.dataset.id);
    } else if (action === "delete-patient") {
      await deletePatient(btn.dataset.id);
    } else if (action === "save-appointment") {
      await saveAppointment(btn.dataset.id);
    } else if (action === "delete-appointment") {
      await deleteAppointment(btn.dataset.id);
    } else if (action === "export-calendar") {
      await exportCalendar(btn.dataset.id || "");
    } else if (action === "save-settings") {
      await saveSettings();
    } else if (action === "logo-reset") {
      S.settings.logoData = "";
      await DB.setMeta("settings", S.settings);
      toast("Logo predefinito ripristinato");
      render();
    } else if (action === "set-pin") {
      await setPin();
    } else if (action === "clear-pin") {
      S.settings.pinHash = "";
      await DB.setMeta("settings", S.settings);
      toast("PIN rimosso");
      render();
    } else if (action === "unlock") {
      await unlock();
    } else if (action === "export-backup") {
      await exportBackup();
    } else if (action === "sync-choose") {
      await chooseSyncFolder();
    } else if (action === "sync-auth") {
      await afterSync(Sync.authorize());
    } else if (action === "sync-now") {
      await afterSync(Sync.reconcile(true));
    } else if (action === "sync-disconnect") {
      if (!confirm("Scollegare la cartella? I file già salvati restano in iCloud.")) return;
      await Sync.disconnect();
      render();
    } else if (action === "sync-keep-remote") {
      await afterSync(Sync.keepRemote());
    } else if (action === "sync-keep-local") {
      await afterSync(Sync.keepLocal());
    } else if (action === "bollo-modo") {
      await saveBolloMeta(btn.dataset.id, { modo: btn.dataset.modo });
    } else if (action === "bollo-remove") {
      await removeBolloScan(btn.dataset.id);
    } else if (action === "restore-seed") {
      await restoreSeed();
    } else if (action === "make-excel") {
      await outputSummary("excel", false);
    } else if (action === "make-pdf-summary") {
      await outputSummary("pdf", false);
    } else if (action === "send-summary") {
      await outputSummary("send", true);
    }
  }

  function onInput(e) {
    if (e.target.id === "p-cf") {
      const box = document.getElementById("cf-born");
      if (box) box.innerHTML = birthNoteHtml(e.target.value);
    }
    if (e.target.id === "amount" && draft) {
      draft.amountInput = e.target.value;
      const box = document.getElementById("breakdown");
      if (box) box.innerHTML = breakdownHtml();
    }
    if (e.target.id === "q") {
      S.query = e.target.value;
      const box = document.getElementById("results");
      if (!box) return;
      const parts = route().parts;
      if (parts[0] === "pazienti") {
        const list = sortedPatients().filter(function (p) {
          return matches(p.name + " " + p.cf + " " + p.phone, S.query);
        });
        box.innerHTML = patientResults(list);
      }       else if (parts[0] === "fatture") {
        const list = filteredInvoices(S.query);
        const kind = invoiceKind();
        const empty = kind === "proforma" ? "Nessuna pro forma in questo elenco." : kind === "fatture" ? "Nessuna fattura in questo elenco." : "Nessun documento in questo elenco.";
        box.innerHTML = list.length ? list.map(invoiceRow).join("") : '<div class="empty">' + empty + "</div>";
        const total = document.getElementById("list-total");
        if (total) total.textContent = listTotalText(list);
      }
    }
    if (e.target.id === "inv-number" && draft) {
      draft.numberInput = e.target.value;
      draft.numberTouched = true;
      const year = Number((draft.date || Money.todayISO()).slice(0, 4));
      const hint = document.getElementById("num-hint");
      if (hint) hint.innerHTML = numberHintHtml(year, draft.numberInput, draft.id, draft.kind === "proforma");
      const kick = document.getElementById("doc-kicker");
      if (kick) {
        const n = /^\d+$/.test(String(draft.numberInput).trim()) ? String(draft.numberInput).trim() : "—";
        kick.textContent = (draft.kind === "proforma" ? "Pro forma " : "Numero ") + n + "/" + year;
      }
    }
    if (e.target.id === "conv-date") {
      const box = document.getElementById("conv-preview");
      if (box) box.innerHTML = convertPreviewHtml(e.target.value);
    }
    }

  async function syncDocumentLinks(inv, previousId) {
    const fromId = previousId || inv.id;
    for (const ap of S.appointments) {
      let changed = false;
      if (isProforma(inv)) {
        if (ap.proformaId === fromId || (inv.appointmentId && ap.id === inv.appointmentId)) {
          ap.proformaId = inv.id;
          changed = true;
        }
      } else if (ap.invoiceId === fromId || (inv.appointmentId && ap.id === inv.appointmentId)) {
        ap.invoiceId = inv.id;
        ap.invoiced = true;
        changed = true;
      }
      if (changed) await DB.put("appointments", ap);
    }
    for (const other of S.invoices) {
      if (other.id === fromId || other.id === inv.id) continue;
      let changed = false;
      if (other.convertedInvoiceId === fromId) {
        other.convertedInvoiceId = inv.id;
        other.convertedNumber = inv.number;
        other.convertedYear = inv.year;
        changed = true;
      }
      if (other.proformaId === fromId) {
        other.proformaId = inv.id;
        other.proformaNumber = inv.number;
        other.proformaYear = inv.year;
        other.proformaDate = inv.date;
        changed = true;
      }
      if (changed) await DB.put("invoices", other);
    }
  }

  async function saveInvoice() {
    const patient = patientById(draft.patientId);
    if (!patient) return toast("Scegli un paziente.");
    const cents = Money.parseEuroToCents(draft.amountInput);
    if (cents == null || cents <= 0) return toast("Inserisci un importo.");
    const calc = draft.calcMode === "competenze" ? Money.fromCompetenze(cents) : Money.fromTotale(cents);
    if (calc.grey) return toast("Importo non compatibile con il bollo.");
    if (!draft.date) return toast("Inserisci la data.");
    const proforma = draft.kind === "proforma";
    const year = Number(draft.date.slice(0, 4));
    const raw = String(draft.numberInput || "").trim();
    if (!/^\d+$/.test(raw)) return toast("Il numero deve essere un intero.");
    const number = Number(raw);
    if (number < 1 || number > 9999) return toast("Il numero deve essere tra 1 e 9999.");
    if (numberTaken(year, number, draft.id, proforma)) return toast("Il n. " + number + "/" + year + " è già usato.");
    const missing = gapsWith(year, proforma, draft.id, number);
    if (!proforma && missing.length) {
      if (!confirm("Con il n. " + number + " la sequenza " + year + " " + lasciaScoperto(missing) + ". Salvare lo stesso?")) return;
    }
    const id = docId(year, number, proforma);
    const prev = draft.id ? S.invoices.find(function (i) { return i.id === draft.id; }) : null;
    const inv = {
      id: id,
      kind: proforma ? "proforma" : "fattura",
      year: year,
      number: number,
      date: draft.date,
      patientId: patient.id,
      patientName: patient.name,
      description: (draft.description || "").trim() || S.settings.descrizioneDefault,
      competenze: calc.competenze,
      cassa: calc.cassa,
      imponibile: calc.imponibile,
      iva: calc.iva,
      totaleDocumento: calc.totaleDocumento,
      bollo: calc.bollo,
      totale: calc.totale,
      paymentMethod: draft.paymentMethod,
      paymentDate: draft.paid ? (draft.paymentDate || draft.date) : "",
      notes: (draft.notes || "").trim(),
      calcMode: draft.calcMode,
      appointmentId: (prev && prev.appointmentId) || draft.appointmentId || "",
      proformaId: (prev && prev.proformaId) || "",
      proformaNumber: (prev && prev.proformaNumber) || "",
      proformaYear: (prev && prev.proformaYear) || "",
      proformaDate: (prev && prev.proformaDate) || "",
      convertedInvoiceId: (prev && prev.convertedInvoiceId) || "",
      convertedNumber: (prev && prev.convertedNumber) || "",
      convertedYear: (prev && prev.convertedYear) || "",
      bolloProva: (prev && prev.bolloProva) || null,
    };
    await DB.put("invoices", inv);
    if (draft.id && draft.id !== inv.id) await DB.del("invoices", draft.id);
    if (inv.bolloProva && inv.bolloProva.fileId) {
      const scan = S.files.find(function (file) { return file.id === inv.bolloProva.fileId; });
      if (scan && scan.invoiceId !== inv.id) {
        scan.invoiceId = inv.id;
        await DB.put("files", scan);
      }
    }
    await syncDocumentLinks(inv, draft.id || inv.id);
    draft = null;
    await reload();
    toast(proforma ? "Pro forma salvata" : "Fattura salvata");
    location.hash = "#/fatture/" + inv.id;
  }

  async function convertProforma(id) {
    const pf = S.invoices.find(function (i) { return i.id === id; });
    if (!pf || !isProforma(pf)) return toast("Pro forma non trovata.");
    const linked = pf.convertedInvoiceId && S.invoices.find(function (i) { return i.id === pf.convertedInvoiceId; });
    if (linked) return toast("È già la fattura " + linked.number + "/" + linked.year + ".");
    const dateEl = document.getElementById("conv-date");
    const date = dateEl ? dateEl.value : "";
    if (!date) return toast("Scegli la data della fattura.");
    const year = Number(date.slice(0, 4));
    const number = nextNumber(year, "", false);
    const missing = gapsWith(year, false, "", 0);
    let msg = "Creare la fattura n. " + number + "/" + year + " del " + Money.formatDateIT(date) + "?";
    if (missing.length) msg += "\n\nNella sequenza " + manca(missing) + ".";
    if (!confirm(msg)) return;
    const inv = {
      id: docId(year, number, false),
      kind: "fattura",
      year: year,
      number: number,
      date: date,
      patientId: pf.patientId,
      patientName: pf.patientName,
      description: pf.description,
      competenze: pf.competenze,
      cassa: pf.cassa,
      imponibile: pf.imponibile,
      iva: pf.iva,
      totaleDocumento: pf.totaleDocumento,
      bollo: pf.bollo,
      totale: pf.totale,
      paymentMethod: pf.paymentMethod,
      paymentDate: pf.paymentDate || "",
      notes: pf.notes || "",
      calcMode: pf.calcMode || "totale",
      appointmentId: pf.appointmentId || "",
      proformaId: pf.id,
      proformaNumber: pf.number,
      proformaYear: pf.year,
      proformaDate: pf.date,
    };
    await DB.put("invoices", inv);
    pf.convertedInvoiceId = inv.id;
    pf.convertedNumber = number;
    pf.convertedYear = year;
    await DB.put("invoices", pf);
    await syncDocumentLinks(inv, inv.id);
    await reload();
    toast("Fattura " + number + "/" + year + " creata");
    location.hash = "#/fatture/" + inv.id;
  }

  async function deleteInvoice(id) {
    const inv = S.invoices.find(function (i) { return i.id === id; });
    if (!inv) return;
    const proforma = isProforma(inv);
    let extra = "";
    if (proforma && inv.convertedInvoiceId) extra = " La fattura già emessa resta in archivio.";
    if (!proforma && inv.proformaNumber) extra = " La pro forma torna disponibile e si può convertire di nuovo.";
    if (!confirm("Eliminare " + docLabel(inv) + "?" + extra)) return;
    await DB.del("invoices", id);
    for (const file of S.files) {
      if (file.invoiceId === id || (inv.bolloProva && file.id === inv.bolloProva.fileId)) await DB.del("files", file.id);
    }
    for (const ap of S.appointments) {
      let changed = false;
      if (ap.invoiceId === id) {
        ap.invoiceId = "";
        ap.invoiced = false;
        changed = true;
      }
      if (ap.proformaId === id) {
        ap.proformaId = "";
        changed = true;
      }
      if (changed) await DB.put("appointments", ap);
    }
    if (!proforma) {
      for (const other of S.invoices) {
        if (other.convertedInvoiceId === id) {
          other.convertedInvoiceId = "";
          other.convertedNumber = "";
          other.convertedYear = "";
          await DB.put("invoices", other);
        }
      }
    } else if (inv.convertedInvoiceId) {
      const fiscal = S.invoices.find(function (i) { return i.id === inv.convertedInvoiceId; });
      if (fiscal) {
        fiscal.proformaId = "";
        await DB.put("invoices", fiscal);
      }
    }
    await reload();
    toast(proforma ? "Pro forma eliminata" : "Fattura eliminata");
    location.hash = "#/fatture";
  }

  async function outputInvoice(id, share) {
    const inv = S.invoices.find(function (i) { return i.id === id; });
    if (!inv) return;
    const patient = patientById(inv.patientId) || { name: inv.patientName };
    const blob = await Pdf.invoicePdf(inv, patient, S.settings);
    const proforma = isProforma(inv);
    const name = (proforma ? "Proforma_" : "Fattura_") + inv.number + "_" + inv.year + "_" + fileSafe(inv.patientName) + ".pdf";
    if (!share) {
      downloadBlob(blob, name);
      toast("PDF pronto");
      return;
    }
    const text = (proforma ? "Pro forma n. " : "Fattura n. ") + inv.number + "/" + inv.year + " del " + Money.formatDateIT(inv.date) + " — " + Money.formatEuro(inv.totale);
    try {
      const how = await shareOrDownload([{ blob: blob, name: name }], text);
      toast(how === "shared" ? "Scegli Mail nel foglio di condivisione" : "PDF scaricato: allevalo alla mail");
    } catch (err) {
      if (err && err.name === "AbortError") return;
      downloadBlob(blob, name);
      toast("PDF scaricato");
    }
  }

  async function savePatient(id) {
    const name = document.getElementById("p-name").value.trim();
    if (!name) return toast("Scrivi il nome.");
    const seduteRaw = String(document.getElementById("p-sedute").value || "").trim().replace(",", ".");
    const sedute = seduteRaw === "" ? 0 : Number(seduteRaw);
    if (!isFinite(sedute) || sedute < 0 || Math.floor(sedute) !== sedute) return toast("Le sedute già effettuate sono un numero intero, da zero in su.");
    const prev = id ? patientById(id) : null;
    const patient = Object.assign({}, prev || {}, {
      id: id || ("ID-" + Math.random().toString(16).slice(2, 10)),
      name: Money.nameUpper(name),
      phone: document.getElementById("p-phone").value.trim(),
      email: document.getElementById("p-email").value.trim(),
      cf: Money.cfCanon(document.getElementById("p-cf").value),
      address: document.getElementById("p-address").value.trim(),
      notes: document.getElementById("p-notes").value.trim(),
      since: document.getElementById("p-since").value,
      seduteFatte: sedute,
    });
    if (patient.cf && !Money.cfValid(patient.cf)) toast("Codice fiscale da controllare: la scheda è salvata lo stesso.");
    await DB.put("patients", patient);
    for (const inv of S.invoices) {
      if (inv.patientId === patient.id && inv.patientName !== patient.name) {
        inv.patientName = patient.name;
        await DB.put("invoices", inv);
      }
    }
    for (const ap of S.appointments) {
      if (ap.patientId === patient.id) {
        ap.patientName = patient.name;
        await DB.put("appointments", ap);
      }
    }
    await reload();
    toast("Paziente salvato");
    location.hash = "#/pazienti/" + patient.id;
  }

  async function deletePatient(id) {
    const used = S.invoices.some(function (i) { return i.patientId === id; });
    if (used) return toast("Ha delle fatture: non si elimina.");
    if (!confirm("Eliminare questo paziente?")) return;
    await DB.del("patients", id);
    for (const ap of S.appointments.filter(function (a) { return a.patientId === id; })) {
      await DB.del("appointments", ap.id);
    }
    await reload();
    location.hash = "#/pazienti";
  }

  async function saveAppointment(id) {
    const patient = patientById(document.getElementById("a-patient").value);
    if (!patient) return toast("Scegli un paziente.");
    const date = document.getElementById("a-date").value;
    if (!date) return toast("Scegli il giorno.");
    const prev = id ? S.appointments.find(function (a) { return a.id === id; }) : null;
    const ap = {
      id: id || ("ap-" + Date.now().toString(36)),
      patientId: patient.id,
      patientName: patient.name,
      date: date,
      time: document.getElementById("a-time").value,
      notes: document.getElementById("a-notes").value.trim(),
      invoiced: document.getElementById("a-invoiced").checked || !!(prev && prev.invoiceId),
      invoiceId: prev ? prev.invoiceId || "" : "",
      proformaId: prev ? prev.proformaId || "" : "",
      calendarUid: prev ? prev.calendarUid || "" : "",
    };
    await DB.put("appointments", ap);
    await reload();
    S.day = ap.date;
    S.month = ap.date.slice(0, 7);
    toast("Appuntamento salvato");
    location.hash = "#/agenda/" + ap.id;
  }

  async function deleteAppointment(id) {
    if (!confirm("Eliminare l'appuntamento?")) return;
    await DB.del("appointments", id);
    await reload();
    location.hash = "#/agenda";
  }

  function icsEscape(value) {
    return String(value || "").replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
  }

  function icsUnescape(value) {
    return String(value || "").replace(/\\n/gi, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\");
  }

  function icsStamp() {
    return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  }

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  function icsWhen(value) {
    const v = String(value || "").trim();
    const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?)?(Z)?$/);
    if (!m) return null;
    if (m[7] && m[4] != null) {
      const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]) || 0));
      return { date: isoFromDate(d), time: pad2(d.getHours()) + ":" + pad2(d.getMinutes()) };
    }
    return { date: m[1] + "-" + m[2] + "-" + m[3], time: m[4] != null ? m[4] + ":" + m[5] : "" };
  }

  function plusMinutes(iso, time, minutes) {
    const p = iso.split("-").map(Number);
    const hm = String(time || "00:00").split(":").map(Number);
    const d = new Date(p[0], p[1] - 1, p[2], hm[0] || 0, hm[1] || 0);
    d.setMinutes(d.getMinutes() + minutes);
    return { date: isoFromDate(d), time: pad2(d.getHours()) + ":" + pad2(d.getMinutes()) };
  }

  function eventUid(ap) {
    return ap.calendarUid || (ap.id + "@fatture-sonia");
  }

  function appointmentIcs(list) {
    const now = icsStamp();
    const events = list.map(function (ap) {
      const timed = !!ap.time;
      const start = timed ? ap.date.replace(/-/g, "") + "T" + ap.time.replace(":", "") + "00" : ap.date.replace(/-/g, "");
      let end = "";
      if (timed) {
        const later = plusMinutes(ap.date, ap.time, 60);
        end = "DTEND:" + later.date.replace(/-/g, "") + "T" + later.time.replace(":", "") + "00";
      } else {
        end = "DTEND;VALUE=DATE:" + shiftISO(ap.date, 1).replace(/-/g, "");
      }
      const summary = ap.patientName + " · seduta " + sessionNumber(ap);
      const description = ap.notes || ("Seduta " + sessionNumber(ap));
      return "BEGIN:VEVENT\r\nUID:" + eventUid(ap) + "\r\nDTSTAMP:" + now + "\r\n" +
        (timed ? "DTSTART:" + start : "DTSTART;VALUE=DATE:" + start) + "\r\n" + end + "\r\n" +
        "SUMMARY:" + icsEscape(summary) + "\r\nDESCRIPTION:" + icsEscape(description) + "\r\nEND:VEVENT";
    });
    return "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Fatture Sonia//Agenda//IT\r\nCALSCALE:GREGORIAN\r\nMETHOD:PUBLISH\r\n" +
      events.join("\r\n") + "\r\nEND:VCALENDAR\r\n";
  }

  async function exportCalendar(id) {
    const list = (id ? S.appointments.filter(function (a) { return a.id === id; }) : S.appointments)
      .filter(function (a) { return a.date; });
    if (!list.length) return toast(id ? "Appuntamento senza data." : "Nessun appuntamento da inviare.");
    const blob = new Blob([appointmentIcs(list)], { type: "text/calendar" });
    const name = id ? "appuntamento.ics" : "agenda-fatture-sonia.ics";
    try {
      const how = await shareOrDownload([{ blob: blob, name: name }], "Agenda degli appuntamenti");
      toast(how === "shared" ? "Scegli Calendario per aggiungere gli appuntamenti" : "File calendario scaricato: aprilo sul telefono");
    } catch (err) {
      if (err && err.name === "AbortError") return;
      downloadBlob(blob, name);
      toast("File calendario scaricato");
    }
  }

  function expandOccurrences(start, rrule) {
    if (!start) return [];
    if (!rrule) return [start];
    const rule = {};
    String(rrule).split(";").forEach(function (part) {
      const bits = part.split("=");
      rule[String(bits[0] || "").toUpperCase()] = bits[1] || "";
    });
    const freq = rule.FREQ;
    const interval = Math.max(1, Number(rule.INTERVAL) || 1);
    const count = rule.COUNT ? Number(rule.COUNT) : 0;
    const until = rule.UNTIL ? icsWhen(rule.UNTIL) : null;
    const today = Money.todayISO();
    const windowStart = shiftISO(today, -1500);
    const windowEnd = until ? until.date : shiftISO(today, 500);
    const out = [];
    let cursor = start.date;
    let n = 0;
    const max = count > 0 ? Math.min(count, 300) : 300;
    while (cursor && n < max && cursor <= windowEnd && out.length < 200) {
      if (cursor >= windowStart) out.push({ date: cursor, time: start.time });
      n += 1;
      if (freq === "DAILY") cursor = shiftISO(cursor, interval);
      else if (freq === "WEEKLY") cursor = shiftISO(cursor, 7 * interval);
      else if (freq === "MONTHLY") cursor = addMonthsISO(cursor, interval);
      else if (freq === "YEARLY") cursor = addMonthsISO(cursor, 12 * interval);
      else break;
    }
    return out;
  }

  function parseIcsEvents(text) {
    const src = String(text || "").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n[ \t]/g, "");
    const blocks = src.split(/BEGIN:VEVENT/i).slice(1);
    const events = [];
    blocks.forEach(function (block) {
      const body = block.split(/END:VEVENT/i)[0];
      const fields = {};
      const excluded = {};
      body.split("\n").forEach(function (line) {
        const cut = line.indexOf(":");
        if (cut < 1) return;
        const key = line.slice(0, cut).split(";")[0].toUpperCase();
        const value = line.slice(cut + 1).trim();
        if (key === "EXDATE") {
          value.split(",").forEach(function (item) {
            const when = icsWhen(item.trim());
            if (when) excluded[when.date] = true;
          });
        } else if (fields[key] == null) fields[key] = value;
      });
      if (String(fields.STATUS || "").toUpperCase() === "CANCELLED") return;
      const start = icsWhen(fields.DTSTART);
      if (!start) return;
      const summary = icsUnescape(fields.SUMMARY || "").trim();
      const notes = icsUnescape(fields.DESCRIPTION || "").trim().slice(0, 400);
      const uid = fields.UID || "";
      expandOccurrences(start, fields.RRULE).forEach(function (when) {
        if (excluded[when.date]) return;
        events.push({ uid: uid, summary: summary, notes: notes, date: when.date, time: when.time });
      });
    });
    return events;
  }

  function personFromSummary(summary) {
    const head = String(summary || "").split("·")[0].replace(/\s*\(compie\s+\d+.*$/i, "").trim();
    return Money.nameUpper(head);
  }

  function knownCalendarUid(uid) {
    if (!uid) return false;
    if (S.appointments.some(function (a) { return a.calendarUid === uid; })) return true;
    if (uid.endsWith("@fatture-sonia")) {
      const id = uid.slice(0, -"@fatture-sonia".length);
      if (S.appointments.some(function (a) { return a.id === id; })) return true;
    }
    return false;
  }

  async function importCalendarFile(file) {
    const events = parseIcsEvents(await file.text());
    if (!events.length) return toast("Nel file non ci sono appuntamenti.");
    let added = 0;
    let skipped = 0;
    let people = 0;
    let cut = false;
    await DB.runQuiet(async function () {
      for (let i = 0; i < events.length; i++) {
        if (added >= 400) { cut = true; break; }
        const ev = events[i];
        const name = personFromSummary(ev.summary);
        if (name.length < 2) { skipped += 1; continue; }
        const slotUid = ev.uid ? ev.uid + ":" + ev.date + ":" + (ev.time || "") : "";
        if (knownCalendarUid(ev.uid) || knownCalendarUid(slotUid)) { skipped += 1; continue; }
        let patient = S.patients.find(function (p) { return p.name === name; });
        if (!patient) {
          patient = {
            id: "ID-" + Math.random().toString(16).slice(2, 10),
            name: name,
            phone: "",
            email: "",
            cf: "",
            address: "",
            notes: "Importato dal calendario",
            since: ev.date,
            seduteFatte: 0,
          };
          await DB.put("patients", patient);
          S.patients.push(patient);
          people += 1;
        }
        if (S.appointments.some(function (a) {
          return a.patientId === patient.id && a.date === ev.date && (a.time || "") === (ev.time || "");
        })) { skipped += 1; continue; }
        const ap = {
          id: "ap-" + Date.now().toString(36) + "-" + i.toString(36),
          patientId: patient.id,
          patientName: patient.name,
          date: ev.date,
          time: ev.time || "",
          notes: ev.notes,
          invoiced: false,
          invoiceId: "",
          proformaId: "",
          calendarUid: slotUid || ev.uid,
        };
        await DB.put("appointments", ap);
        S.appointments.push(ap);
        added += 1;
      }
    });
    if (added || people) {
      if (window.Sync) Sync.noteLocalChange();
      await reload();
    }
    let msg = added === 1 ? "Importato 1 appuntamento" : "Importati " + added + " appuntamenti";
    if (!added && !people) msg = "Nessun appuntamento nuovo.";
    if (people) msg += (added ? ", " : "") + (people === 1 ? "1 nuovo paziente" : people + " nuovi pazienti");
    if (skipped) msg += " Già presenti o senza nome: " + skipped + ".";
    if (cut) msg += " Importati i primi 400.";
    toast(msg);
    render();
  }

  function prepareLogo(file) {
    return new Promise(function (resolve) {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = function () {
        const max = 512;
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL("image/png"));
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        resolve("");
      };
      img.src = url;
    });
  }

  async function saveLogo(file) {
    const data = await prepareLogo(file);
    if (!data) return toast("Immagine non leggibile.");
    S.settings.logoData = data;
    await DB.setMeta("settings", S.settings);
    toast("Logo aggiornato");
    render();
  }

  async function saveSettings() {
    const next = Object.assign({}, S.settings);
    ["studioNome", "titolo", "nome", "qualifica", "ordine", "sezione", "numeroAlbo", "delibera", "piva", "cf", "studio", "domicilio", "telefono", "email", "pec", "sito", "iban", "banca", "intestatario", "enpap", "descrizioneDefault", "emailCommercialista"].forEach(function (key) {
      const el = document.getElementById("s-" + key);
      if (el) next[key] = el.value.trim();
    });
    next.regime = document.getElementById("s-regime").value;
    next.bolloMode = document.getElementById("s-bollo").value;
    if (!next.nome || !next.piva || !next.cf) return toast("Nome, partita IVA e codice fiscale sono obbligatori.");
    S.settings = next;
    await DB.setMeta("settings", next);
    toast("Dati salvati");
  }

  async function setPin() {
    const pin = document.getElementById("new-pin").value.trim();
    if (!/^\d{4,6}$/.test(pin)) return toast("Il PIN è di 4-6 cifre.");
    S.settings.pinHash = await hashPin(pin);
    await DB.setMeta("settings", S.settings);
    sessionStorage.setItem("fatture-unlocked", "1");
    toast("PIN impostato");
    render();
  }

  async function unlock() {
    const pin = document.getElementById("pin").value.trim();
    if (await hashPin(pin) !== S.settings.pinHash) return toast("PIN non corretto.");
    sessionStorage.setItem("fatture-unlocked", "1");
    render();
  }

  async function exportBackup() {
    if (Sync.state.canPick) {
      if (!Sync.state.linked) {
        toast("Scegli prima la cartella su File o Drive. Resta quella finché non la cambi.");
        return;
      }
      try {
        const result = await Sync.publishSaved();
        await finishSync(result, "Archivio pubblicato nella cartella");
      } catch (err) {
        console.error(err);
        toast("Non riesco a scrivere nella cartella.");
      }
      return;
    }
    const blob = await Sync.archiveBlob();
    const name = Sync.FILE_NAME;
    try {
      const how = await shareOrDownload([{ blob: blob, name: name }], "Archivio fatture, da sostituire nella cartella già scelta");
      toast(how === "shared" ? "Scegli dove salvare la copia del file" : "Copia del file scaricata");
    } catch (err) {
      if (err && err.name === "AbortError") return;
      downloadBlob(blob, name);
      toast("Archivio scaricato");
    }
  }

  async function restoreSeed() {
    if (!confirm("Sostituire pazienti, fatture e appuntamenti con quelli del foglio Excel? Le modifiche fatte qui si perdono.")) return;
    await DB.importAll(window.activeSeed());
    const pin = S.settings && S.settings.pinHash;
    await reload();
    if (pin) {
      S.settings.pinHash = pin;
      await DB.setMeta("settings", S.settings);
    }
    toast("Dati del foglio ripristinati");
    location.hash = "#/";
  }

  async function importBackup(file) {
    let data;
    try { data = JSON.parse(await file.text()); }
    catch (e) { return toast("File non leggibile."); }
    if (!Sync.validArchive(data)) return toast("Questo non è un archivio dell'app.");
    const localStamp = (await DB.getMeta("updatedAt")) || "";
    const remoteStamp = data.updatedAt || data.exportedAt || "";
    let message = "Sostituire i dati di questo dispositivo con il file iCloud?";
    if (localStamp && remoteStamp && remoteStamp < localStamp) {
      message = "Il file iCloud è più vecchio di questo dispositivo. Sostituire comunque i dati locali?";
    }
    if (!confirm(message)) return;
    await Sync.applyPayload(data);
    await reload();
    toast("Archivio aggiornato da iCloud");
    render();
  }

  function prepareBolloFile(file) {
    if (!file.type || file.type.indexOf("image/") !== 0) return Promise.resolve(file);
    return new Promise(function (resolve) {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = function () {
        const max = 1800;
        let w = img.width;
        let h = img.height;
        if (w > max || h > max) {
          const scale = max / Math.max(w, h);
          w = Math.round(w * scale);
          h = Math.round(h * scale);
        }
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        canvas.toBlob(function (blob) {
          URL.revokeObjectURL(url);
          const name = String(file.name || "bollo").replace(/\.\w+$/, "") + ".jpg";
          resolve(blob ? new File([blob], name, { type: "image/jpeg" }) : file);
        }, "image/jpeg", 0.72);
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        resolve(file);
      };
      img.src = url;
    });
  }

  async function saveBolloMeta(id, patch) {
    const inv = S.invoices.find(function (item) { return item.id === id; });
    if (!inv) return;
    const prev = inv.bolloProva || {};
    inv.bolloProva = {
      modo: (patch && patch.modo) || prev.modo || (S.settings.bolloMode === "virtuale" ? "elettronica" : "cartacea"),
      data: patch && patch.data != null ? patch.data : (prev.data || ""),
      fileId: prev.fileId || "",
    };
    await DB.put("invoices", inv);
    await reload();
    render();
  }

  async function saveBolloScan(id, file) {
    const inv = S.invoices.find(function (item) { return item.id === id; });
    if (!inv) return;
    const prepared = await prepareBolloFile(file);
    const prev = inv.bolloProva || {};
    const fileId = prev.fileId || ("bollo-" + id);
    await DB.put("files", {
      id: fileId,
      invoiceId: inv.id,
      role: "bollo",
      name: prepared.name || "bollo",
      type: prepared.type || "application/octet-stream",
      blob: prepared,
    });
    inv.bolloProva = {
      modo: prev.modo || (S.settings.bolloMode === "virtuale" ? "elettronica" : "cartacea"),
      data: prev.data || Money.todayISO(),
      fileId: fileId,
    };
    const dateEl = document.getElementById("bollo-data");
    if (dateEl && dateEl.value) inv.bolloProva.data = dateEl.value;
    await DB.put("invoices", inv);
    await reload();
    toast(inv.bolloProva.modo === "elettronica" ? "PDF del bollo archiviato" : "Scansione della marca archiviata");
    render();
  }

  async function removeBolloScan(id) {
    const inv = S.invoices.find(function (item) { return item.id === id; });
    if (!inv || !inv.bolloProva || !inv.bolloProva.fileId) return;
    if (!confirm("Rimuovere la scansione del bollo?")) return;
    await DB.del("files", inv.bolloProva.fileId);
    inv.bolloProva.fileId = "";
    await DB.put("invoices", inv);
    await reload();
    toast("Scansione rimossa");
    render();
  }

  async function chooseSyncFolder() {
    try {
      const result = await Sync.chooseFolder();
      await finishSync(result, "Cartella collegata: la sincronizzazione è attiva");
    } catch (err) {
      if (err && err.name === "AbortError") return;
      if (err && err.message === "unsupported") {
        toast("Qui la cartella si memorizza con Chrome o Edge.");
        return;
      }
      console.error(err);
      toast("Cartella non collegata.");
    }
  }

  async function afterSync(promise) {
    try {
      const result = await promise;
      await finishSync(result, "");
    } catch (err) {
      console.error(err);
      toast("Sincronizzazione non riuscita.");
    }
  }

  async function finishSync(result, okMessage) {
    if (result === "applied") {
      await reload();
      toast("Dati aggiornati da iCloud");
    } else if (result === "pushed") {
      toast(okMessage || "Cartella iCloud aggiornata");
    } else if (result === "auth") {
      toast("Autorizza di nuovo la cartella.");
    } else if (result === "conflict") {
      toast("Scegli quale copia tenere.");
    } else if (okMessage) {
      toast(okMessage);
    }
    render();
  }

  function baseName() {
    return "Fatture_Zaffarano_" + S.exportFrom + "_" + S.exportTo;
  }

  async function buildFiles(kind) {
    readExportInputs();
    await DB.setMeta("settings", S.settings);
    const list = exportSelection();
    if (!list.length) {
      toast("Nessuna fattura in queste date.");
      return null;
    }
    const meta = exportMeta(list);
    const files = [];
    if (kind === "excel" || kind === "send" && S.attachExcel) {
      files.push({ name: baseName() + ".xlsx", blob: await Xlsx.invoicesWorkbook(meta) });
    }
    if (kind === "pdf" || kind === "send" && S.attachPdf) {
      files.push({ name: baseName() + ".pdf", blob: await Pdf.summaryPdf(meta) });
    }
    if (kind === "pdf" || kind === "send" && S.attachInvoices) {
      files.push({ name: baseName() + "_fatture.pdf", blob: await Pdf.invoicesPdf(meta) });
    }
    if (!files.length) {
      toast("Scegli Excel, PDF o entrambi.");
      return null;
    }
    return { files: files, list: list };
  }

  async function outputSummary(kind) {
    const built = await buildFiles(kind);
    if (!built) return;
    if (kind !== "send") {
      built.files.forEach(function (f) { downloadBlob(f.blob, f.name); });
      toast(kind === "excel" ? "Excel pronto" : "PDF pronto");
      return;
    }
    const text = summaryText(built.list);
    try {
      const how = await shareOrDownload(built.files, text);
      if (how === "downloaded") {
        const mail = S.settings.emailCommercialista || "";
        location.href = "mailto:" + mail + "?subject=" + encodeURIComponent("Fatture " + S.exportFrom + " " + S.exportTo) + "&body=" + encodeURIComponent(text + "\nI file sono stati scaricati: allegalì alla mail.");
      } else toast("Scegli Mail e invia");
    } catch (err) {
      if (err && err.name === "AbortError") return;
      built.files.forEach(function (f) { downloadBlob(f.blob, f.name); });
      toast("File scaricati");
    }
  }

  document.addEventListener("toggle", function (e) {
    const el = e.target;
    if (!el || !el.dataset || !el.dataset.fold) return;
    S.folds[el.dataset.fold] = !!el.open;
  }, true);
  document.addEventListener("click", function (e) {
    onClick(e).catch(function (err) {
      console.error(err);
      toast("Qualcosa non ha funzionato. Riprova.");
    });
  });
  document.addEventListener("input", onInput);
  document.addEventListener("change", function (e) {
    if (e.target.classList.contains("import-file") && e.target.files && e.target.files[0]) {
      importBackup(e.target.files[0]).catch(function () { toast("Importazione non riuscita."); });
      e.target.value = "";
    }
    if (e.target.classList.contains("bollo-file") && e.target.files && e.target.files[0]) {
      saveBolloScan(e.target.dataset.id, e.target.files[0]).catch(function () { toast("Scansione non archiviata."); });
      e.target.value = "";
    }
    if (e.target.id === "p-cf") {
      const box = document.getElementById("cf-born");
      if (box) box.innerHTML = birthNoteHtml(e.target.value);
    }
    if (e.target.classList.contains("calendar-file") && e.target.files && e.target.files[0]) {
      importCalendarFile(e.target.files[0]).catch(function () { toast("Calendario non importato."); });
      e.target.value = "";
    }
    if (e.target.id === "logo-file" && e.target.files && e.target.files[0]) {
      saveLogo(e.target.files[0]).catch(function () { toast("Logo non aggiornato."); });
      e.target.value = "";
    }
    if (e.target.id === "bollo-data") {
      saveBolloMeta(e.target.dataset.id, { data: e.target.value }).catch(function () { toast("Data non salvata."); });
    }
    if (e.target.id === "ex-from" || e.target.id === "ex-to" || e.target.id === "ex-xlsx" || e.target.id === "ex-pdf" || e.target.id === "ex-invoices" || e.target.id === "ex-mail") {
      readExportInputs();
      if (e.target.id === "ex-from" || e.target.id === "ex-to") render();
    }
    if (e.target.id === "inv-patient" && draft) {
      captureDraftFromDom();
      render();
    }
    if (e.target.id === "inv-date" && draft) {
      captureDraftFromDom();
      if (!draft.numberTouched) {
        const year = Number((draft.date || Money.todayISO()).slice(0, 4));
        draft.numberInput = String(nextNumber(year, draft.id, draft.kind === "proforma"));
      }
      render();
    }
  });
  window.addEventListener("hashchange", render);
  document.addEventListener("focusin", function (e) {
    if (e.target.matches("input, textarea, select")) {
      setTimeout(function () { e.target.scrollIntoView({ block: "center" }); }, 280);
    }
  });

  function setPull(px, mode) {
    const el = document.getElementById("pull");
    const app = document.getElementById("app");
    const label = document.getElementById("pull-label");
    if (!el || !app) return;
    const n = Math.max(0, px || 0);
    el.hidden = n <= 0;
    el.style.height = n + "px";
    app.style.transform = n ? "translateY(" + n + "px)" : "";
    if (label) {
      label.textContent = mode === "sync" ? "Sincronizzazione…" : n >= 72 ? "Rilascia per sincronizzare" : "Scorri per sincronizzare";
    }
  }

  async function runPullSync() {
    if (!window.Sync || Sync.state.syncing || locked()) return;
    setPull(64, "sync");
    try {
      const result = await Sync.pullSync();
      if (result === "busy") return;
      if (result === "idle") toast("Il file è già aggiornato");
      else await finishSync(result, "File aggiornato");
    } catch (err) {
      console.error(err);
      toast("Sincronizzazione non riuscita.");
    } finally {
      setPull(0);
    }
  }

  function bindPull() {
    let startY = 0;
    let pulling = false;
    let dy = 0;
    let pointerId = null;
    function begin(y, target) {
      if (locked() || Sync.state.syncing || !Sync.state.canPick || !Sync.state.linked) return false;
      if (target && target.closest && target.closest("#tabbar, input, textarea, select, button, label")) return false;
      if ((document.scrollingElement || document.documentElement).scrollTop > 0) return false;
      startY = y;
      dy = 0;
      pulling = true;
      return true;
    }
    function move(y) {
      if (!pulling) return;
      const delta = y - startY;
      if (delta <= 0 || (document.scrollingElement || document.documentElement).scrollTop > 0) {
        dy = 0;
        setPull(0);
        return;
      }
      dy = Math.min(delta * 0.55, 120);
      setPull(dy);
    }
    function end() {
      if (!pulling) return;
      const fire = dy >= 72;
      pulling = false;
      dy = 0;
      if (fire) runPullSync();
      else setPull(0);
    }
    document.addEventListener("touchstart", function (e) {
      if (e.touches.length !== 1) return;
      begin(e.touches[0].clientY, e.target);
    }, { passive: true });
    document.addEventListener("touchmove", function (e) {
      if (!pulling || e.touches.length !== 1) return;
      move(e.touches[0].clientY);
      if (dy > 10 && e.cancelable) e.preventDefault();
    }, { passive: false });
    document.addEventListener("touchend", end);
    document.addEventListener("touchcancel", function () { pulling = false; dy = 0; setPull(0); });
    document.addEventListener("pointerdown", function (e) {
      if (e.pointerType === "touch") return;
      if (begin(e.clientY, e.target)) pointerId = e.pointerId;
    });
    document.addEventListener("pointermove", function (e) {
      if (e.pointerType === "touch" || e.pointerId !== pointerId) return;
      move(e.clientY);
    });
    document.addEventListener("pointerup", function (e) {
      if (e.pointerType === "touch" || e.pointerId !== pointerId) return;
      pointerId = null;
      end();
    });
  }
  bindPull();

  window.onSyncStatus = function () {
    if (!S.settings || locked()) return;
    const parts = route().parts;
    if (!parts.length || parts[0] === "altro" || parts[0] === "impostazioni") render();
    else refreshSyncBanner();
  };
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) return;
    Sync.reconcile(false).then(function (result) {
      if (result === "applied") {
        reload().then(function () {
          toast("Dati aggiornati da iCloud");
          render();
        });
      } else if (result === "conflict") {
        render();
      }
    }).catch(function () {});
  });

  DB.open().then(async function () {
    await DB.runQuiet(async function () {
      if (!(await DB.getMeta("seeded"))) await DB.importAll(window.activeSeed());
    });
    await reload();
    const syncResult = await Sync.boot();
    if (syncResult === "applied") await reload();
    if ("serviceWorker" in navigator && location.protocol !== "file:") {
      navigator.serviceWorker.register("sw.js").catch(function () {});
    }
    if (!location.hash) location.hash = "#/";
    render();
    if (syncResult === "applied") toast("Dati aggiornati da iCloud");
  }).catch(function (err) {
    console.error(err);
    document.getElementById("app").innerHTML = "<p>Non riesco ad aprire l'archivio su questo browser.</p>";
  });
})();
