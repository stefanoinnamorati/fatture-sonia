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
    appointments: [],
    settings: null,
    path: "",
    query: "",
    invoiceYear: String(new Date().getFullYear()),
    month: Money.todayISO().slice(0, 7),
    day: Money.todayISO(),
    exportFrom: new Date().getFullYear() + "-01-01",
    exportTo: new Date().getFullYear() + "-12-31",
    attachExcel: true,
    attachPdf: true,
  };

  let draft = null;
  let draftKey = "";

  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function route() {
    const raw = (location.hash || "#/").replace(/^#/, "");
    const bits = raw.split("?");
    return { parts: bits[0].split("/").filter(Boolean), q: new URLSearchParams(bits[1] || "") };
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
    return invoicesOf(patientId)[0];
  }

  function nextNumber(year, ignoreId) {
    let max = 0;
    S.invoices.forEach(function (i) {
      if (i.year === year && i.id !== ignoreId) max = Math.max(max, i.number);
    });
    return max + 1;
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
    S.patients = await DB.all("patients");
    S.invoices = await DB.all("invoices");
    S.appointments = await DB.all("appointments");
    S.settings = (await DB.getMeta("settings")) || Object.assign({}, window.activeSeed().professional);
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
    const parts = route().parts;
    const tabName = !parts.length ? "oggi" : ["pazienti", "fatture", "agenda"].includes(parts[0]) ? parts[0] : "altro";
    tab.querySelectorAll("a").forEach(function (a) {
      a.classList.toggle("on", a.dataset.tab === tabName);
    });
    app.innerHTML = screen();
  }

  function brandBlock(kicker) {
    const s = S.settings || {};
    const nome = s.nome || "Sonia Zaffarano";
    const ruolo = [s.titolo, s.qualifica].filter(Boolean).join(" · ");
    return '<header class="brand"><img class="brand-logo" src="assets/logo.png?v=3" alt="Logo di ' + esc(nome) + '">' +
      '<div><p class="kicker">' + esc(kicker || "Studio") + "</p><h1>" + esc(nome) + "</h1>" +
      (ruolo ? '<p class="brand-role">' + esc(ruolo) + "</p>" : "") +
      "</div></header>";
  }

  function viewLock() {
    return brandBlock("Accesso riservato") +
      '<div class="card"><p>Inserisci il PIN per aprire pazienti e fatture su questo dispositivo.</p>' +
      '<div class="field"><label for="pin">PIN</label><input id="pin" inputmode="numeric" autocomplete="off" type="password"></div>' +
      '<button class="btn" type="button" data-action="unlock">Apri</button></div>';
  }

  function viewOggi() {
    const year = String(new Date().getFullYear());
    const yearInvoices = S.invoices.filter(function (i) { return String(i.year) === year; });
    const totals = sumOf(yearInvoices);
    const open = S.invoices.filter(function (i) { return !i.paymentDate; });
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
      '<a class="btn secondary" href="#/agenda/nuovo">Nuovo appuntamento</a></div>' +
      '<div class="section-title"><h2>Prossimi appuntamenti</h2><a href="#/agenda">Agenda</a></div>' +
      (upcoming.length ? '<div class="list">' + upcoming.map(appointmentRow).join("") + "</div>" : '<div class="empty">Nessun appuntamento in programma.</div>') +
      '<div class="section-title"><h2>Ultime fatture</h2><a href="#/fatture">Tutte</a></div>' +
      '<div class="list">' + recent.map(invoiceRow).join("") + "</div>";
  }

  function invoiceRow(inv) {
    const paid = !!inv.paymentDate;
    return '<a class="row" href="#/fatture/' + esc(inv.id) + '"><div class="avatar">' + inv.number + "</div><div class=\"main\">" +
      '<div class="name">' + esc(inv.patientName) + "</div>" +
      '<div class="meta">n. ' + inv.number + "/" + inv.year + " · " + esc(Money.formatDateIT(inv.date)) + " · " + esc(inv.paymentMethod || "—") + "</div></div>" +
      '<div style="text-align:right"><div class="amount">' + esc(Money.formatEuro(inv.totale)) + "</div>" +
      '<span class="badge ' + (paid ? "ok" : "wait") + '">' + (paid ? "Incassata" : "Da incassare") + "</span></div></a>";
  }

  function appointmentRow(ap) {
    return '<a class="row" href="#/agenda/' + esc(ap.id) + '"><div class="avatar">' + esc((ap.time || "").slice(0, 2) || "•") + '</div><div class="main">' +
      '<div class="name">' + esc(ap.patientName) + "</div>" +
      '<div class="meta">' + esc(Money.formatDateIT(ap.date)) + (ap.time ? " · " + esc(ap.time) : "") + (ap.notes ? " · " + esc(ap.notes) : "") + "</div></div>" +
      '<span class="badge ' + (ap.invoiced ? "ok" : "neutral") + '">' + (ap.invoiced ? "Fatturato" : "In agenda") + "</span></a>";
  }

  function viewPatients() {
    const q = S.query;
    const list = sortedPatients().filter(function (p) {
      return matches(p.name + " " + p.cf + " " + p.phone, q);
    });
    return '<div class="top"><div><p class="kicker">Anagrafica</p><h1>Pazienti</h1></div>' +
      '<a class="btn small" href="#/pazienti/nuovo">Nuovo</a></div>' +
      '<input id="q" class="search" placeholder="Nome, telefono, codice fiscale" value="' + esc(q) + '">' +
      '<div id="results" class="list" style="margin-top:12px">' + patientResults(list) + "</div>";
  }

  function patientResults(list) {
    if (!list.length) return '<div class="empty">Nessun paziente trovato.</div>';
    return list.map(function (p) {
      return '<a class="row" href="#/pazienti/' + esc(p.id) + '"><div class="avatar">' + esc(initials(p.name)) + '</div><div class="main">' +
        '<div class="name">' + esc(p.name) + "</div>" +
        '<div class="meta">' + esc(p.phone || p.cf || "Scheda senza telefono") + "</div></div></a>";
    }).join("");
  }

  function viewPatient(p) {
    if (!p) return missing("Paziente non trovato", "#/pazienti");
    const inv = invoicesOf(p.id);
    const ap = S.appointments.filter(function (a) { return a.patientId === p.id; })
      .sort(function (a, b) { return (b.date + b.time).localeCompare(a.date + a.time); });
    return '<a class="back" href="#/pazienti">Pazienti</a>' +
      '<div class="top"><div><p class="kicker">Paziente</p><h1>' + esc(p.name) + "</h1></div></div>" +
      '<div class="card"><div class="meta">Codice fiscale</div><div>' + esc(p.cf || "Non indicato") + "</div>" +
      '<div class="meta" style="margin-top:8px">Telefono</div><div>' + (p.phone ? '<a href="tel:' + esc(p.phone) + '">' + esc(p.phone) + "</a>" : "Non indicato") + "</div>" +
      '<div class="meta" style="margin-top:8px">Email</div><div>' + (p.email ? '<a href="mailto:' + esc(p.email) + '">' + esc(p.email) + "</a>" : "Non indicata") + "</div>" +
      '<div class="meta" style="margin-top:8px">Indirizzo</div><div>' + esc(p.address || "Non indicato") + "</div>" +
      (p.notes ? '<div class="meta" style="margin-top:8px">Note</div><div>' + esc(p.notes) + "</div>" : "") +
      (p.since ? '<div class="meta" style="margin-top:8px">Paziente dal</div><div>' + esc(Money.formatDateIT(p.since)) + "</div>" : "") +
      (!p.cf || !Money.cfValid(p.cf) ? '<div class="warn-box" style="margin-top:12px">Il codice fiscale manca o non torna: serve per la fattura e per la detrazione.</div>' : "") +
      "</div>" +
      '<div class="stack" style="margin-top:12px"><a class="btn" href="#/fatture/nuova?paziente=' + encodeURIComponent(p.id) + '">Nuova fattura</a>' +
      '<a class="btn secondary" href="#/agenda/nuovo?paziente=' + encodeURIComponent(p.id) + '">Nuovo appuntamento</a>' +
      '<a class="btn secondary" href="#/pazienti/' + esc(p.id) + '/modifica">Modifica scheda</a></div>' +
      '<div class="section-title"><h2>Fatture</h2><span>' + esc(Money.formatEuro(sumOf(inv).totale)) + "</span></div>" +
      (inv.length ? '<div class="list">' + inv.map(invoiceRow).join("") + "</div>" : '<div class="empty">Ancora nessuna fattura.</div>') +
      '<div class="section-title"><h2>Appuntamenti</h2></div>' +
      (ap.length ? '<div class="list">' + ap.map(appointmentRow).join("") + "</div>" : '<div class="empty">Nessun appuntamento.</div>');
  }

  function viewPatientForm(existing) {
    const p = existing || { id: "", name: "", phone: "", email: "", cf: "", address: "", notes: "", since: Money.todayISO() };
    return '<a class="back" href="' + (p.id ? "#/pazienti/" + esc(p.id) : "#/pazienti") + '">Indietro</a>' +
      '<div class="top"><div><p class="kicker">Anagrafica</p><h1>' + (p.id ? "Modifica" : "Nuovo paziente") + "</h1></div></div>" +
      field("Nome e cognome", "p-name", p.name) +
      field("Telefono", "p-phone", p.phone, "tel") +
      field("Email", "p-email", p.email, "email") +
      field("Codice fiscale", "p-cf", p.cf) +
      field("Indirizzo", "p-address", p.address) +
      field("Paziente dal", "p-since", p.since, "date") +
      '<div class="field"><label for="p-notes">Note</label><textarea id="p-notes">' + esc(p.notes) + "</textarea></div>" +
      '<button class="btn" type="button" data-action="save-patient" data-id="' + esc(p.id) + '">Salva paziente</button>' +
      (p.id ? '<button class="btn ghost" type="button" data-action="delete-patient" data-id="' + esc(p.id) + '">Elimina paziente</button>' : "");
  }

  function viewInvoices() {
    const years = Array.from(new Set(S.invoices.map(function (i) { return String(i.year); }).concat([String(new Date().getFullYear())]))).sort().reverse();
    const q = S.query;
    const list = filteredInvoices(q);
    const chips = '<button class="chip' + (S.invoiceYear === "all" ? " on" : "") + '" type="button" data-action="chip-year" data-year="all">Tutte</button>' +
      years.map(function (y) {
        return '<button class="chip' + (S.invoiceYear === y ? " on" : "") + '" type="button" data-action="chip-year" data-year="' + y + '">' + y + "</button>";
      }).join("");
    return '<div class="top"><div><p class="kicker">Registro</p><h1>Fatture</h1></div><a class="btn small" href="#/fatture/nuova">Nuova</a></div>' +
      '<div class="chips">' + chips + "</div>" +
      '<input id="q" class="search" placeholder="Paziente o numero" value="' + esc(q) + '">' +
      '<p id="list-total" class="muted" style="margin:10px 2px">Totale elenco ' + esc(Money.formatEuro(sumOf(list).totale)) + "</p>" +
      '<div id="results" class="list">' + (list.length ? list.map(invoiceRow).join("") : '<div class="empty">Nessuna fattura in questo elenco.</div>') + "</div>";
  }

  function filteredInvoices(q) {
    return S.invoices.filter(function (i) {
      if (S.invoiceYear !== "all" && String(i.year) !== S.invoiceYear) return false;
      return matches(i.patientName + " " + i.number + " " + i.description, q);
    }).sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return b.number - a.number;
    });
  }

  function viewInvoice(inv) {
    if (!inv) return missing("Fattura non trovata", "#/fatture");
    const p = patientById(inv.patientId);
    const rows = [
      ["Competenze", inv.competenze],
      ["Cassa ENPAP 2%", inv.cassa],
      ["Imponibile", inv.imponibile],
      [S.settings.regime === "esente" ? "IVA esente" : "IVA non dovuta", inv.iva],
      ["Totale documento", inv.totaleDocumento],
      ["Marca da bollo", inv.bollo],
    ];
    return '<a class="back" href="#/fatture">Fatture</a>' +
      '<div class="top"><div><p class="kicker">Fattura ' + inv.number + "/" + inv.year + "</p><h1>" + esc(inv.patientName) + "</h1></div></div>" +
      '<div class="card"><div class="label">' + esc(Money.formatDateIT(inv.date)) + "</div>" +
      '<div class="figure">' + esc(Money.formatEuro(inv.totale)) + "</div>" +
      '<div class="sub">' + esc(inv.description || "") + "</div>" +
      '<div class="receipt">' + rows.map(function (r) {
        return "<div><span>" + esc(r[0]) + "</span><span>" + esc(Money.formatEuro(r[1])) + "</span></div>";
      }).join("") + '<div class="grand"><span>Da pagare</span><span>' + esc(Money.formatEuro(inv.totale)) + "</span></div></div>" +
      '<div>' + esc(inv.paymentMethod || "Pagamento non indicato") + (inv.paymentDate ? " · incasso " + esc(Money.formatDateIT(inv.paymentDate)) : " · da incassare") + "</div>" +
      (inv.notes ? "<p>" + esc(inv.notes) + "</p>" : "") +
      (p ? '<p><a href="#/pazienti/' + esc(p.id) + '">Apri scheda paziente</a></p>' : "") +
      "</div>" +
      '<div class="stack" style="margin-top:12px">' +
      '<button class="btn" type="button" data-action="share-invoice" data-id="' + esc(inv.id) + '">Invia PDF</button>' +
      '<button class="btn secondary" type="button" data-action="pdf-invoice" data-id="' + esc(inv.id) + '">Scarica PDF</button>' +
      '<a class="btn secondary" href="#/fatture/' + esc(inv.id) + '/modifica">Modifica</a>' +
      '<button class="btn ghost" type="button" data-action="delete-invoice" data-id="' + esc(inv.id) + '">Elimina</button></div>';
  }

  function ensureDraft(existing, q) {
    const key = location.hash;
    if (draft && draftKey === key) return draft;
    draftKey = key;
    if (existing) {
      draft = Object.assign({}, existing, {
        amountInput: Money.centsToInput(existing.calcMode === "competenze" ? existing.competenze : existing.totale),
        paid: !!existing.paymentDate,
      });
    } else {
      const patientId = q.get("paziente") || "";
      const last = patientId ? lastInvoiceFor(patientId) : null;
      draft = {
        id: "",
        patientId: patientId,
        date: q.get("data") || Money.todayISO(),
        description: S.settings.descrizioneDefault || DESCRIZIONI[0],
        calcMode: "totale",
        amountInput: last ? Money.centsToInput(last.totale) : "",
        paymentMethod: last ? last.paymentMethod : "BANCOMAT",
        paid: true,
        paymentDate: q.get("data") || Money.todayISO(),
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
    if (existing === undefined) return missing("Fattura non trovata", "#/fatture");
    const d = ensureDraft(existing, q);
    const options = sortedPatients().map(function (p) {
      return '<option value="' + esc(p.id) + '"' + (p.id === d.patientId ? " selected" : "") + ">" + esc(p.name) + "</option>";
    }).join("");
    const descOpts = DESCRIZIONI.map(function (x) { return '<option value="' + esc(x) + '">'; }).join("");
    const payOpts = PAGAMENTI.map(function (x) {
      return '<option' + (x === d.paymentMethod ? " selected" : "") + ">" + x + "</option>";
    }).join("");
    const year = Number((d.date || Money.todayISO()).slice(0, 4));
    const previewN = d.number || nextNumber(year, d.id);
    return '<a class="back" href="' + (d.id ? "#/fatture/" + esc(d.id) : "#/fatture") + '">Indietro</a>' +
      '<div class="top"><div><p class="kicker">Numero ' + previewN + "/" + year + '</p><h1>' + (d.id ? "Modifica fattura" : "Nuova fattura") + "</h1></div></div>" +
      '<div class="field"><label for="inv-patient">Paziente</label><select id="inv-patient">' +
      '<option value="">Scegli</option>' + options + "</select></div>" +
      '<div class="field"><label for="inv-date">Data fattura</label><input id="inv-date" type="date" value="' + esc(d.date) + '"></div>' +
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
      '<div class="field"><label for="inv-notes">Note in fattura</label><textarea id="inv-notes">' + esc(d.notes || "") + "</textarea></div>" +
      '<button class="btn" type="button" data-action="save-invoice">Salva fattura</button>';
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
    let cells = "";
    for (let i = 0; i < start; i++) cells += '<button type="button" class="out" tabindex="-1"></button>';
    for (let d = 1; d <= daysIn; d++) {
      const iso = y + "-" + String(m).padStart(2, "0") + "-" + String(d).padStart(2, "0");
      const cls = (iso === S.day ? " on" : "") + (iso === Money.todayISO() ? " today" : "") + (marks[iso] ? " has" : "");
      cells += '<button type="button" class="' + cls + '" data-action="pick-day" data-date="' + iso + '">' + d + "</button>";
    }
    const dayItems = S.appointments.filter(function (a) { return a.date === S.day; })
      .sort(function (a, b) { return (a.time || "").localeCompare(b.time || ""); });
    return '<div class="top"><div><p class="kicker">Calendario</p><h1>Agenda</h1></div>' +
      '<a class="btn small" href="#/agenda/nuovo?data=' + esc(S.day) + '">Nuovo</a></div>' +
      '<div class="card"><div class="cal-head"><button type="button" data-action="prev-month" aria-label="Mese precedente">‹</button>' +
      '<strong>' + MESI[m - 1] + " " + y + '</strong>' +
      '<button type="button" data-action="next-month" aria-label="Mese successivo">›</button></div>' +
      '<div class="weekdays"><span>L</span><span>M</span><span>M</span><span>G</span><span>V</span><span>S</span><span>D</span></div>' +
      '<div class="days">' + cells + "</div></div>" +
      '<div class="section-title"><h2>' + esc(Money.formatDateIT(S.day)) + "</h2></div>" +
      (dayItems.length ? '<div class="list">' + dayItems.map(appointmentRow).join("") + "</div>" : '<div class="empty">Nessun appuntamento in questo giorno.</div>');
  }

  function viewAppointment(ap) {
    if (!ap) return missing("Appuntamento non trovato", "#/agenda");
    const inv = ap.invoiceId ? S.invoices.find(function (i) { return i.id === ap.invoiceId; }) : null;
    return '<a class="back" href="#/agenda">Agenda</a>' +
      '<div class="top"><div><p class="kicker">' + esc(Money.formatDateIT(ap.date)) + (ap.time ? " · " + esc(ap.time) : "") + "</p><h1>" + esc(ap.patientName) + "</h1></div></div>" +
      '<div class="card">' + (ap.notes ? "<p>" + esc(ap.notes) + "</p>" : "<p class=\"muted\">Nessuna nota.</p>") +
      '<span class="badge ' + (ap.invoiced ? "ok" : "neutral") + '">' + (ap.invoiced ? "Fatturato" : "Da fatturare") + "</span></div>" +
      '<div class="stack" style="margin-top:12px">' +
      (inv ? '<a class="btn" href="#/fatture/' + esc(inv.id) + '">Apri fattura ' + inv.number + "/" + inv.year + "</a>" :
        '<a class="btn" href="#/fatture/nuova?paziente=' + encodeURIComponent(ap.patientId) + "&data=" + esc(ap.date) + "&app=" + encodeURIComponent(ap.id) + '">Crea fattura</a>') +
      '<a class="btn secondary" href="#/agenda/nuovo?id=' + encodeURIComponent(ap.id) + '">Modifica</a>' +
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
    return S.invoices.filter(function (i) { return inRange(i, S.exportFrom, S.exportTo); })
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
      '<div class="stack"><button class="btn" type="button" data-action="send-summary">Invia per email</button>' +
      '<button class="btn secondary" type="button" data-action="make-excel">Scarica Excel</button>' +
      '<button class="btn secondary" type="button" data-action="make-pdf-summary">Scarica PDF</button></div>' +
      '<div class="section-title"><h2>Nel periodo</h2></div>' +
      (list.length ? '<div class="list">' + list.map(invoiceRow).join("") + "</div>" : '<div class="empty">Nessuna fattura in queste date.</div>') +
      '<p class="muted">Il riepilogo ha le stesse colonne del foglio, più il codice fiscale del paziente.</p>';
  }

  function viewAltro() {
    return brandBlock("Studio") +
      '<div class="card" style="margin-bottom:12px"><h2>Archivio su iPhone e iPad</h2>' +
      '<p class="muted">I pazienti non passano da soli. Sul Mac tocca <strong>Esporta archivio</strong> e salva il file in iCloud. Sull\'altro dispositivo tocca <strong>Importa archivio</strong> e scegli quel file.</p>' +
      '<div class="stack"><button class="btn secondary" type="button" data-action="export-backup">Esporta archivio</button>' +
      '<label class="btn secondary">Importa archivio<input class="import-file" type="file" accept="application/json,.json" hidden></label></div></div>' +
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
    return '<div class="top"><div><p class="kicker">Intestazione</p><h1>Professionista</h1></div></div>' +
      '<div class="note-box">Questi dati finiscono su ogni PDF. Il regime è impostato sul forfettario, come nell\'autodichiarazione del 24/09/2026. Se il commercialista usa l\'esenzione sanitaria, cambialo qui.</div>' +
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
      '<div class="section-title"><h2>Copia di sicurezza</h2></div>' +
      '<p class="muted">iPhone e iPad non condividono l\'archivio da soli. Esporta il file e importalo sull\'altro dispositivo: finisce in File o in iCloud.</p>' +
      '<div class="stack"><button class="btn secondary" type="button" data-action="export-backup">Esporta archivio</button>' +
      '<label class="btn secondary">Importa archivio<input class="import-file" type="file" accept="application/json,.json" hidden></label>' +
      '<button class="btn ghost" type="button" data-action="restore-seed">Ripristina i dati del foglio Excel</button></div>';
  }

  function viewHelp() {
    return '<div class="top"><div><p class="kicker">iPhone e iPad</p><h1>Come usarla</h1></div></div>' +
      '<div class="card help"><ol>' +
      "<li>In Safari, su iPhone o iPad, apri <strong>https://stefanoinnamorati.github.io/fatture-sonia/</strong>. Il Mac può restare spento.</li>" +
      "<li>Tocca Condividi e poi <strong>Aggiungi a Home</strong>.</li>" +
      "<li>La prima volta i pazienti non ci sono. Sul Mac apri l'app, vai in <strong>Altro</strong>, tocca <strong>Esporta archivio</strong> e salva il file in iCloud.</li>" +
      "<li>Sull'iPad o sull'iPhone, in <strong>Altro</strong>, tocca <strong>Importa archivio</strong> e scegli quel file.</li>" +
      "<li>Per mandare il riepilogo: Esporta, scegli le date, poi <strong>Invia per email</strong>.</li>" +
      "</ol>" +
      "<p>I pazienti restano solo su questo dispositivo. Il PDF della singola fattura riporta albo, partita IVA, codice fiscale, studio, domicilio, prestazione, cassa ENPAP e bollo. Non sostituisce l'invio della fattura elettronica al Sistema di Interscambio, se è dovuto.</p></div>";
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
  }

  function readExportInputs() {
    const from = document.getElementById("ex-from");
    if (!from) return;
    S.exportFrom = from.value || S.exportFrom;
    S.exportTo = document.getElementById("ex-to").value || S.exportTo;
    S.attachExcel = document.getElementById("ex-xlsx").checked;
    S.attachPdf = document.getElementById("ex-pdf").checked;
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
    } else if (action === "save-settings") {
      await saveSettings();
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
      } else if (parts[0] === "fatture") {
        const list = filteredInvoices(S.query);
        box.innerHTML = list.length ? list.map(invoiceRow).join("") : '<div class="empty">Nessuna fattura in questo elenco.</div>';
        const total = document.getElementById("list-total");
        if (total) total.textContent = "Totale elenco " + Money.formatEuro(sumOf(list).totale);
      }
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
    const year = Number(draft.date.slice(0, 4));
    let id = draft.id;
    let number = draft.number;
    if (!id || draft.year !== year) {
      number = nextNumber(year, id);
      id = year + "-" + number;
    }
    const inv = {
      id: id,
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
    };
    if (draft.id && draft.id !== inv.id) await DB.del("invoices", draft.id);
    await DB.put("invoices", inv);
    if (draft.appointmentId) {
      const ap = S.appointments.find(function (a) { return a.id === draft.appointmentId; });
      if (ap) {
        ap.invoiced = true;
        ap.invoiceId = inv.id;
        await DB.put("appointments", ap);
      }
    }
    draft = null;
    await reload();
    toast("Fattura salvata");
    location.hash = "#/fatture/" + inv.id;
  }

  async function deleteInvoice(id) {
    const inv = S.invoices.find(function (i) { return i.id === id; });
    if (!inv) return;
    if (!confirm("Eliminare la fattura " + inv.number + "/" + inv.year + "?")) return;
    await DB.del("invoices", id);
    for (const ap of S.appointments) {
      if (ap.invoiceId === id) {
        ap.invoiceId = "";
        ap.invoiced = false;
        await DB.put("appointments", ap);
      }
    }
    await reload();
    toast("Fattura eliminata");
    location.hash = "#/fatture";
  }

  async function outputInvoice(id, share) {
    const inv = S.invoices.find(function (i) { return i.id === id; });
    if (!inv) return;
    const patient = patientById(inv.patientId) || { name: inv.patientName };
    const blob = await Pdf.invoicePdf(inv, patient, S.settings);
    const name = "Fattura_" + inv.number + "_" + inv.year + "_" + fileSafe(inv.patientName) + ".pdf";
    if (!share) {
      downloadBlob(blob, name);
      toast("PDF pronto");
      return;
    }
    const text = "Fattura n. " + inv.number + "/" + inv.year + " del " + Money.formatDateIT(inv.date) + " — " + Money.formatEuro(inv.totale);
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
    const patient = {
      id: id || ("ID-" + Math.random().toString(16).slice(2, 10)),
      name: name,
      phone: document.getElementById("p-phone").value.trim(),
      email: document.getElementById("p-email").value.trim(),
      cf: document.getElementById("p-cf").value.trim().toUpperCase(),
      address: document.getElementById("p-address").value.trim(),
      notes: document.getElementById("p-notes").value.trim(),
      since: document.getElementById("p-since").value,
    };
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

  async function saveSettings() {
    const next = Object.assign({}, S.settings);
    ["titolo", "nome", "qualifica", "ordine", "sezione", "numeroAlbo", "delibera", "piva", "cf", "studio", "domicilio", "telefono", "email", "pec", "sito", "iban", "banca", "intestatario", "enpap", "descrizioneDefault", "emailCommercialista"].forEach(function (key) {
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
    const payload = {
      kind: "fatture-sonia-backup",
      version: 1,
      exportedAt: new Date().toISOString(),
      patients: S.patients,
      invoices: S.invoices,
      appointments: S.appointments,
      professional: S.settings,
    };
    const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
    const name = "Archivio_fatture_sonia_" + Money.todayISO() + ".json";
    try {
      const how = await shareOrDownload([{ blob: blob, name: name }], "Copia di sicurezza delle fatture");
      toast(how === "shared" ? "Salva il file in iCloud o in File" : "Archivio scaricato");
    } catch (err) {
      if (err && err.name === "AbortError") return;
      downloadBlob(blob, name);
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
    if (!data || data.kind !== "fatture-sonia-backup" || !Array.isArray(data.patients) || !Array.isArray(data.invoices)) {
      return toast("Questo non è un archivio dell'app.");
    }
    if (!confirm("Sostituire tutti i dati di questo dispositivo con l'archivio?")) return;
    await DB.importAll({
      patients: data.patients,
      invoices: data.invoices,
      appointments: data.appointments || [],
      professional: data.professional || window.activeSeed().professional,
    });
    await reload();
    toast("Archivio importato");
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
    if (e.target.id === "ex-from" || e.target.id === "ex-to" || e.target.id === "ex-xlsx" || e.target.id === "ex-pdf" || e.target.id === "ex-mail") {
      readExportInputs();
      if (e.target.id === "ex-from" || e.target.id === "ex-to") render();
    }
    if (e.target.id === "inv-patient" && draft) {
      captureDraftFromDom();
      render();
    }
  });
  window.addEventListener("hashchange", render);
  document.addEventListener("focusin", function (e) {
    if (e.target.matches("input, textarea, select")) {
      setTimeout(function () { e.target.scrollIntoView({ block: "center" }); }, 280);
    }
  });

  DB.open().then(async function () {
    if (!(await DB.getMeta("seeded"))) await DB.importAll(window.activeSeed());
    await reload();
    if ("serviceWorker" in navigator && location.protocol !== "file:") {
      navigator.serviceWorker.register("sw.js").catch(function () {});
    }
    if (!location.hash) location.hash = "#/";
    render();
  }).catch(function (err) {
    console.error(err);
    document.getElementById("app").innerHTML = "<p>Non riesco ad aprire l'archivio su questo browser.</p>";
  });
})();
