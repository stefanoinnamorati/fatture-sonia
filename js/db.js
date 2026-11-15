(function () {
  const DB_NAME = "fatture-sonia";
  const DB_VERSION = 2;
  let dbp = null;
  let quiet = 0;

  function touch() {
    if (quiet) return;
    if (window.Sync && Sync.noteLocalChange) Sync.noteLocalChange();
  }

  function open() {
    if (dbp) return dbp;
    dbp = new Promise(function (resolve, reject) {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function () {
        const db = req.result;
        ["patients", "invoices", "appointments", "meta", "files"].forEach(function (name) {
          if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: "id" });
        });
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { dbp = null; reject(req.error); };
    });
    return dbp;
  }

  function txDone(tx) {
    return new Promise(function (resolve, reject) {
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function () { reject(tx.error); };
      tx.onabort = function () { reject(tx.error || new Error("abort")); };
    });
  }

  async function put(store, value) {
    const db = await open();
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).put(value);
    await txDone(tx);
    touch();
  }

  async function get(store, id) {
    const db = await open();
    return new Promise(function (resolve, reject) {
      const tx = db.transaction(store, "readonly");
      const req = tx.objectStore(store).get(id);
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  async function all(store) {
    const db = await open();
    return new Promise(function (resolve, reject) {
      const tx = db.transaction(store, "readonly");
      const req = tx.objectStore(store).getAll();
      req.onsuccess = function () { resolve(req.result || []); };
      req.onerror = function () { reject(req.error); };
    });
  }

  async function del(store, id) {
    const db = await open();
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).delete(id);
    await txDone(tx);
    touch();
  }

  async function clear(store) {
    const db = await open();
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).clear();
    await txDone(tx);
    touch();
  }

  async function getMeta(id) {
    const row = await get("meta", id);
    return row ? row.data : undefined;
  }

  async function setMeta(id, data) {
    await put("meta", { id: id, data: data });
  }

  async function importAll(seed) {
    await runQuiet(async function () {
      await clear("patients");
      await clear("invoices");
      await clear("appointments");
      await clear("files");
      for (const p of seed.patients) await put("patients", p);
      for (const i of seed.invoices) await put("invoices", i);
      for (const a of seed.appointments) await put("appointments", a);
      if (seed.files) {
        for (const f of seed.files) await put("files", f);
      }
      await setMeta("settings", seed.professional);
      await setMeta("seeded", true);
    });
    touch();
  }

  async function runQuiet(fn) {
    quiet++;
    try { return await fn(); }
    finally { quiet--; }
  }

  window.DB = {
    open: open,
    put: put,
    get: get,
    all: all,
    del: del,
    clear: clear,
    getMeta: getMeta,
    setMeta: setMeta,
    importAll: importAll,
    runQuiet: runQuiet,
  };
})();
