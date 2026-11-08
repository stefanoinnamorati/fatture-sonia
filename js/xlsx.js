/* Excel .xlsx minimo, senza librerie esterne. */
(function () {
  const CRC_TABLE = (function () {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function u16(n) { return [n & 255, (n >>> 8) & 255]; }
  function u32(n) { return [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]; }

  function concat(parts) {
    let len = 0;
    parts.forEach(function (p) { len += p.length; });
    const out = new Uint8Array(len);
    let o = 0;
    parts.forEach(function (p) { out.set(p, o); o += p.length; });
    return out;
  }

  async function deflateRaw(data) {
    if (typeof CompressionStream === "undefined") return { method: 0, data: data };
    const cs = new CompressionStream("deflate-raw");
    const stream = new Blob([data]).stream().pipeThrough(cs);
    const buf = new Uint8Array(await new Response(stream).arrayBuffer());
    return { method: 8, data: buf };
  }

  async function makeZip(files) {
    const chunks = [];
    const centrals = [];
    let offset = 0;
    const now = new Date();
    const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    for (const f of files) {
      const nameBytes = new TextEncoder().encode(f.name);
      const raw = typeof f.data === "string" ? new TextEncoder().encode(f.data) : f.data;
      const crc = crc32(raw);
      const comp = await deflateRaw(raw);
      const localHead = new Uint8Array([].concat(
        u32(0x04034b50), u16(20), u16(0), u16(comp.method), u16(time), u16(date),
        u32(crc), u32(comp.data.length), u32(raw.length), u16(nameBytes.length), u16(0)
      ));
      const local = concat([localHead, nameBytes, comp.data]);
      chunks.push(local);
      const centralHead = new Uint8Array([].concat(
        u32(0x02014b50), u16(20), u16(20), u16(0), u16(comp.method), u16(time), u16(date),
        u32(crc), u32(comp.data.length), u32(raw.length), u16(nameBytes.length), u16(0), u16(0),
        u16(0), u16(0), u32(0), u32(offset)
      ));
      centrals.push(concat([centralHead, nameBytes]));
      offset += local.length;
    }
    const centralStart = offset;
    let centralSize = 0;
    centrals.forEach(function (c) { chunks.push(c); centralSize += c.length; });
    chunks.push(new Uint8Array([].concat(
      u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length),
      u32(centralSize), u32(centralStart), u16(0)
    )));
    return new Blob(chunks, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  }

  function xmlEscape(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function colName(i) {
    let n = i + 1;
    let s = "";
    while (n > 0) {
      const m = (n - 1) % 26;
      s = String.fromCharCode(65 + m) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  }

  function sheetXml(rows) {
    const strings = [];
    const index = new Map();
    function si(value) {
      const k = String(value);
      if (index.has(k)) return index.get(k);
      const i = strings.length;
      strings.push(k);
      index.set(k, i);
      return i;
    }
    let body = "";
    rows.forEach(function (row, r) {
      body += '<row r="' + (r + 1) + '">';
      row.forEach(function (cell, c) {
        if (cell == null || cell === "") return;
        const ref = colName(c) + (r + 1);
        if (typeof cell === "number") {
          body += '<c r="' + ref + '" s="1"><v>' + cell.toFixed(2) + "</v></c>";
        } else if (cell && typeof cell === "object" && Object.prototype.hasOwnProperty.call(cell, "bold")) {
          body += '<c r="' + ref + '" t="s" s="2"><v>' + si(cell.bold) + "</v></c>";
        } else {
          body += '<c r="' + ref + '" t="s"><v>' + si(cell) + "</v></c>";
        }
      });
      body += "</row>";
    });
    const sst = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="' + strings.length + '" uniqueCount="' + strings.length + '">' +
      strings.map(function (s) { return "<si><t>" + xmlEscape(s) + "</t></si>"; }).join("") +
      "</sst>";
    const sheet = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      "<cols>" +
      '<col min="1" max="1" width="12"/>' +
      '<col min="2" max="2" width="14"/>' +
      '<col min="3" max="3" width="28"/>' +
      '<col min="4" max="4" width="20"/>' +
      '<col min="5" max="14" width="18"/>' +
      "</cols><sheetData>" + body + "</sheetData></worksheet>";
    return { sheet: sheet, sst: sst };
  }

  async function invoicesWorkbook(meta) {
    const header = [
      "N FATTURA", "DATA FATTURA", "PAZIENTE", "CODICE FISCALE",
      "IMPORTO TOTALE DA PAGARE", "COMPETENZE", "CASSA (2% DI COMPETENZE)",
      "IMPONIBILE", "IVA 0% DI IMPONIBILE", "TOTALE DOCUMENTO", "MARCA DA BOLLO",
      "MODALITA' DI PAGAMENTO", "DATA DI PAGAMENTO",
    ].map(function (h) { return { bold: h }; });
    const rows = [
      [{ bold: meta.title }],
      [meta.period],
      ["P. IVA " + (meta.piva || "") + "  ·  C.F. " + (meta.cf || "")],
      [],
      header,
    ];
    meta.invoices.forEach(function (inv) {
      const patient = meta.patientOf(inv);
      rows.push([
        String(inv.number),
        Money.formatDateIT(inv.date),
        inv.patientName,
        patient && patient.cf ? patient.cf : "",
        inv.totale / 100,
        inv.competenze / 100,
        inv.cassa / 100,
        inv.imponibile / 100,
        inv.iva / 100,
        inv.totaleDocumento / 100,
        inv.bollo / 100,
        inv.paymentMethod || "",
        inv.paymentDate ? Money.formatDateIT(inv.paymentDate) : "",
      ]);
    });
    const t = meta.totals;
    rows.push([
      { bold: "TOTALI" },
      "",
      { bold: String(t.count) + " fatture" },
      "",
      t.totale / 100,
      t.competenze / 100,
      t.cassa / 100,
      t.imponibile / 100,
      t.iva / 100,
      t.totaleDocumento / 100,
      t.bollo / 100,
      "",
      "",
    ]);
    const built = sheetXml(rows);
    const contentTypes = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>' +
      "</Types>";
    const rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      "</Relationships>";
    const wbRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>' +
      "</Relationships>";
    const workbook = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheets><sheet name="Fatture" sheetId="1" r:id="rId1"/></sheets></workbook>';
    const styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00"/></numFmts>' +
      '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
      '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
      '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      '<cellXfs count="3">' +
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
      '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
      '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
      "</cellXfs></styleSheet>";
    return makeZip([
      { name: "[Content_Types].xml", data: contentTypes },
      { name: "_rels/.rels", data: rels },
      { name: "xl/workbook.xml", data: workbook },
      { name: "xl/_rels/workbook.xml.rels", data: wbRels },
      { name: "xl/styles.xml", data: styles },
      { name: "xl/sharedStrings.xml", data: built.sst },
      { name: "xl/worksheets/sheet1.xml", data: built.sheet },
    ]);
  }

  window.Xlsx = { invoicesWorkbook: invoicesWorkbook };
})();
