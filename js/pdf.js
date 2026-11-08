(function () {
  let logoPromise = null;

  function loadLogo() {
    if (!logoPromise) {
      logoPromise = fetch("assets/logo.png?v=3")
        .then(function (r) { return r.blob(); })
        .then(function (blob) {
          return new Promise(function (resolve, reject) {
            const reader = new FileReader();
            reader.onload = function () { resolve(reader.result); };
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
        })
        .catch(function () { return null; });
    }
    return logoPromise;
  }

  function euro(cents) {
    return Money.formatEuro(cents).replace(" €", "");
  }

  function regimeText(settings) {
    if (settings.regime === "esente") {
      return "Operazione esente IVA ai sensi dell'art. 10, comma 1, n. 18, del D.P.R. 26 ottobre 1972, n. 633 (prestazione sanitaria di diagnosi, cura e riabilitazione resa alla persona).";
    }
    return "Operazione effettuata ai sensi dell'art. 1, commi da 54 a 89, della Legge 23 dicembre 2014, n. 190 (regime forfettario). Compenso non soggetto a IVA. Non soggetta a ritenuta d'acconto ai sensi dell'art. 1, comma 67, della Legge n. 190/2014.";
  }

  function bolloText(inv, settings) {
    if ((inv.bollo || 0) > 0) {
      if (settings.bolloMode === "virtuale") {
        return "Imposta di bollo assolta in modo virtuale ai sensi dell'art. 15 del D.P.R. 642/1972, per € 2,00.";
      }
      return "Imposta di bollo da € 2,00 assolta sull'originale ai sensi del D.P.R. 26 ottobre 1972, n. 642 (importo superiore a € 77,47).";
    }
    return "Imposta di bollo non dovuta: importo del documento non superiore a € 77,47.";
  }

  function enpapLine(settings) {
    const n = settings.enpap ? " Posizione ENPAP " + settings.enpap + "." : "";
    return "Contributo integrativo ENPAP del 2% a carico del cliente (rivalsa)." + n;
  }

  async function invoicePdf(inv, patient, settings) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: "mm", format: "a4" });
    const pageW = 210;
    const left = 16;
    const right = pageW - 16;
    const logo = await loadLogo();
    doc.setProperties({
      title: "Fattura " + inv.number + "/" + inv.year,
      author: (settings.titolo ? settings.titolo + " " : "") + settings.nome,
      subject: "Fattura per prestazione sanitaria",
    });

    if (logo) {
      doc.addImage(logo, "PNG", left, 12, 26, 26);
    }

    const textX = logo ? left + 30 : left;
    doc.setTextColor(28, 25, 21);
    doc.setFont("times", "bold");
    doc.setFontSize(16);
    doc.text((settings.titolo ? settings.titolo + " " : "") + settings.nome, textX, 18);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(70, 64, 58);
    doc.text(settings.qualifica || "", textX, 24);
    doc.setFontSize(8);
    const albo = (settings.ordine || "") + (settings.sezione ? " — sez. " + settings.sezione : "") + (settings.numeroAlbo ? ", n. " + settings.numeroAlbo : "");
    const lines = [
      albo,
      settings.delibera || "",
      "P. IVA " + (settings.piva || "—") + "    C.F. " + (settings.cf || "—"),
      "Studio: " + (settings.studio || "—"),
      "Domicilio fiscale: " + (settings.domicilio || "—"),
      [settings.telefono ? "Tel. " + settings.telefono : "", settings.email || "", settings.pec ? "PEC " + settings.pec : ""].filter(Boolean).join("  ·  "),
    ].filter(Boolean);
    let y = 29;
    lines.forEach(function (line) {
      const wrapped = doc.splitTextToSize(line, 108);
      doc.text(wrapped, textX, y);
      y += wrapped.length * 3.6;
    });

    doc.setDrawColor(15, 95, 87);
    doc.setLineWidth(0.4);
    doc.line(left, y + 2, right, y + 2);

    doc.setTextColor(15, 95, 87);
    doc.setFont("times", "bold");
    doc.setFontSize(18);
    doc.text("FATTURA", right, 18, { align: "right" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(28, 25, 21);
    doc.text("n. " + inv.number + "/" + inv.year, right, 25, { align: "right" });
    doc.text("del " + Money.formatDateIT(inv.date), right, 30, { align: "right" });

    y = Math.max(y + 10, 62);
    doc.setFillColor(247, 244, 238);
    doc.roundedRect(left, y, right - left, 28, 2, 2, "F");
    doc.setFontSize(8);
    doc.setTextColor(111, 103, 94);
    doc.text("INTESTATA A", left + 4, y + 6);
    doc.setTextColor(28, 25, 21);
    doc.setFont("times", "bold");
    doc.setFontSize(13);
    doc.text(patient ? patient.name : inv.patientName, left + 4, y + 13);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    const cf = patient && patient.cf ? "C.F. " + patient.cf : "Codice fiscale non indicato";
    doc.text(cf, left + 4, y + 18.5);
    doc.text(patient && patient.address ? patient.address : "Indirizzo non indicato", left + 4, y + 23.5);

    y += 36;
    doc.setFillColor(15, 95, 87);
    doc.rect(left, y, right - left, 8, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text("Descrizione", left + 3, y + 5.3);
    doc.text("Importo", right - 3, y + 5.3, { align: "right" });

    const rows = [
      [inv.description || settings.descrizioneDefault || "Prestazione sanitaria", euro(inv.competenze)],
      ["Contributo integrativo ENPAP 2%", euro(inv.cassa)],
    ];
    y += 8;
    doc.setFont("helvetica", "normal");
    doc.setTextColor(28, 25, 21);
    rows.forEach(function (row, i) {
      if (i % 2 === 0) {
        doc.setFillColor(255, 252, 247);
        doc.rect(left, y, right - left, 8, "F");
      }
      doc.text(row[0], left + 3, y + 5.3);
      doc.text(row[1] + " €", right - 3, y + 5.3, { align: "right" });
      y += 8;
    });

    y += 4;
    const totals = [
      ["Imponibile", euro(inv.imponibile), false],
      [settings.regime === "esente" ? "IVA esente art. 10" : "IVA non dovuta (regime forfettario)", euro(inv.iva), false],
      ["Totale documento", euro(inv.totaleDocumento), false],
      ["Marca da bollo", euro(inv.bollo), false],
      ["Totale da pagare", euro(inv.totale), true],
    ];
    totals.forEach(function (row) {
      if (row[2]) {
        doc.setFillColor(15, 95, 87);
        doc.roundedRect(right - 92, y, 92, 10, 1.5, 1.5, "F");
        doc.setTextColor(255, 255, 255);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(11);
        doc.text(row[0], right - 88, y + 6.6);
        doc.text(row[1] + " €", right - 3, y + 6.6, { align: "right" });
        y += 14;
      } else {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(9);
        doc.setTextColor(70, 64, 58);
        doc.text(row[0], right - 88, y + 5);
        doc.setTextColor(28, 25, 21);
        doc.text(row[1] + " €", right - 3, y + 5, { align: "right" });
        y += 6.5;
      }
    });

    y += 4;
    doc.setDrawColor(230, 223, 212);
    doc.setLineWidth(0.2);
    doc.line(left, y, right, y);
    y += 8;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(28, 25, 21);
    doc.text("Pagamento", left, y);
    doc.setFont("helvetica", "normal");
    y += 5;
    doc.text("Modalità: " + (inv.paymentMethod || "—"), left, y);
    y += 5;
    if (inv.paymentDate) doc.text("Data di pagamento: " + Money.formatDateIT(inv.paymentDate), left, y);
    else doc.text("Da incassare", left, y);
    y += 5;
    if ((inv.paymentMethod || "").toUpperCase() === "BONIFICO" && settings.iban) {
      doc.text("IBAN " + settings.iban, left, y);
      y += 5;
      doc.text([settings.banca, settings.intestatario].filter(Boolean).join("  ·  "), left, y);
      y += 5;
    }
    if (inv.notes) {
      y += 2;
      const noteLines = doc.splitTextToSize("Note: " + inv.notes, right - left);
      doc.text(noteLines, left, y);
      y += noteLines.length * 4.5;
    }

    const legal = [
      regimeText(settings),
      enpapLine(settings),
      bolloText(inv, settings),
      "Documento emesso da " + (settings.titolo ? settings.titolo + " " : "") + settings.nome +
        (settings.numeroAlbo ? ", iscritta all'Albo degli Psicologi n. " + settings.numeroAlbo : "") + ".",
    ].join(" ");
    const legalLines = doc.splitTextToSize(legal, right - left - 6);
    const boxH = legalLines.length * 3.7 + 6;
    const boxY = Math.min(y + 6, 272 - boxH);
    doc.setFillColor(247, 244, 238);
    doc.roundedRect(left, boxY, right - left, boxH, 2, 2, "F");
    doc.setFontSize(7.5);
    doc.setTextColor(70, 64, 58);
    doc.text(legalLines, left + 3, boxY + 5);

    doc.setFontSize(7);
    doc.setTextColor(140, 132, 122);
    doc.text("Pagina 1 di 1", right, 290, { align: "right" });

    return doc.output("blob");
  }

  function drawHeaderRow(doc, cols, y, left) {
    doc.setFillColor(15, 95, 87);
    const width = cols.reduce(function (a, c) { return a + c.w; }, 0);
    doc.rect(left, y, width, 10, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(6);
    let x = left;
    cols.forEach(function (c) {
      const parts = doc.splitTextToSize(c.label, c.w - 1.5);
      doc.text(parts, x + 1, y + 3.4);
      x += c.w;
    });
    return y + 10;
  }

  async function summaryPdf(meta) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "landscape" });
    const settings = meta.settings;
    const cols = [
      { label: "N", w: 8, key: "n" },
      { label: "Data", w: 20, key: "date" },
      { label: "Paziente", w: 42, key: "name" },
      { label: "Codice fiscale", w: 32, key: "cf" },
      { label: "Da pagare", w: 22, key: "totale" },
      { label: "Competenze", w: 20, key: "comp" },
      { label: "Cassa 2%", w: 16, key: "cassa" },
      { label: "Imponibile", w: 20, key: "imp" },
      { label: "IVA", w: 14, key: "iva" },
      { label: "Documento", w: 22, key: "doc" },
      { label: "Bollo", w: 12, key: "bollo" },
      { label: "Pagamento", w: 20, key: "pay" },
      { label: "Data pag.", w: 22, key: "paydate" },
    ];
    const left = 8;
    const pageH = 210;
    const logo = await loadLogo();

    function pageChrome(page, pages) {
      if (logo) doc.addImage(logo, "PNG", left, 6, 14, 14);
      const textX = logo ? left + 16 : left;
      doc.setFont("times", "bold");
      doc.setFontSize(14);
      doc.setTextColor(28, 25, 21);
      doc.text("Riepilogo fatture", textX, 12);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(70, 64, 58);
      doc.text((settings.titolo ? settings.titolo + " " : "") + settings.nome + "  ·  P. IVA " + (settings.piva || "—") + "  ·  C.F. " + (settings.cf || "—"), textX, 17);
      doc.text(meta.period, textX, 21.5);
      doc.text("Pagina " + page + " di " + pages, 289, 12, { align: "right" });
    }

    const rowH = 6.2;
    const usable = pageH - 18;
    const firstTop = 26;
    const rowsPerFirst = Math.floor((usable - firstTop - 10) / rowH);
    const rowsPerNext = Math.floor((usable - 28 - 10) / rowH);
    const pages = [];
    let rest = meta.invoices.slice();
    if (!rest.length) pages.push([]);
    while (rest.length) {
      const take = pages.length === 0 ? rowsPerFirst : rowsPerNext;
      pages.push(rest.splice(0, Math.max(take, 1)));
    }

    pages.forEach(function (chunk, pi) {
      if (pi > 0) doc.addPage();
      pageChrome(pi + 1, pages.length);
      let y = pi === 0 ? firstTop : 26;
      y = drawHeaderRow(doc, cols, y, left);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(6.5);
      chunk.forEach(function (inv, idx) {
        if (idx % 2 === 0) {
          doc.setFillColor(247, 244, 238);
          doc.rect(left, y, cols.reduce(function (a, c) { return a + c.w; }, 0), rowH, "F");
        }
        const patient = meta.patientOf(inv);
        const values = [
          String(inv.number),
          Money.formatDateIT(inv.date),
          inv.patientName,
          patient && patient.cf ? patient.cf : "",
          euro(inv.totale),
          euro(inv.competenze),
          euro(inv.cassa),
          euro(inv.imponibile),
          euro(inv.iva),
          euro(inv.totaleDocumento),
          inv.bollo ? euro(inv.bollo) : "",
          inv.paymentMethod || "",
          inv.paymentDate ? Money.formatDateIT(inv.paymentDate) : "",
        ];
        doc.setTextColor(28, 25, 21);
        let x = left;
        values.forEach(function (val, i) {
          const shown = doc.splitTextToSize(String(val), cols[i].w - 1.6)[0] || "";
          const alignRight = i >= 4 && i <= 10;
          if (alignRight) doc.text(shown, x + cols[i].w - 1, y + 4.2, { align: "right" });
          else doc.text(shown, x + 1, y + 4.2);
          x += cols[i].w;
        });
        y += rowH;
      });
    });

    const t = meta.totals;
    let y = 26 + 10 + pages[pages.length - 1].length * rowH + 4;
    if (y > 188) {
      doc.addPage();
      pageChrome(pages.length + 1, pages.length + 1);
      y = 28;
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(15, 95, 87);
    doc.text("Totali  ·  " + t.count + " fatture", left, y);
    y += 6;
    doc.setFontSize(8);
    doc.setTextColor(28, 25, 21);
    const bits = [
      ["Da pagare", t.totale],
      ["Competenze", t.competenze],
      ["Cassa 2%", t.cassa],
      ["Imponibile", t.imponibile],
      ["IVA", t.iva],
      ["Documento", t.totaleDocumento],
      ["Bollo", t.bollo],
    ];
    bits.forEach(function (b, i) {
      const x = left + (i % 4) * 70;
      const yy = y + Math.floor(i / 4) * 6;
      doc.setFont("helvetica", "normal");
      doc.text(b[0], x, yy);
      doc.setFont("helvetica", "bold");
      doc.text(Money.formatEuro(b[1]), x + 28, yy);
    });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(111, 103, 94);
    doc.text("Riepilogo per il commercialista. Il codice fiscale è quello dell'anagrafica pazienti. Non sostituisce le singole fatture.", left, 202);

    return doc.output("blob");
  }

  window.Pdf = { invoicePdf: invoicePdf, summaryPdf: summaryPdf };
})();
