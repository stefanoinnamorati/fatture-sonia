(function () {
  const FILE_NAME = "archivio-fatture-sonia.json";
  const state = {
    canPick: typeof window.showDirectoryPicker === "function",
    linked: false,
    needsAuth: false,
    folderName: "",
    updatedAt: "",
    lastSyncedAt: "",
    lastError: "",
    conflict: false,
  };
  let handle = null;
  let generation = 0;
  let timer = null;
  let applying = false;
  let pendingRemote = null;

  function notify() {
    if (window.onSyncStatus) window.onSyncStatus();
  }

  function safeName(name) {
    return String(name || "file").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "") || "file";
  }

  function blobToBase64(blob) {
    return new Promise(function (resolve, reject) {
      const reader = new FileReader();
      reader.onload = function () {
        const text = String(reader.result || "");
        resolve(text.slice(text.indexOf(",") + 1));
      };
      reader.onerror = function () { reject(reader.error); };
      reader.readAsDataURL(blob);
    });
  }

  function base64ToBlob(data, type) {
    const bin = atob(data || "");
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: type || "application/octet-stream" });
  }

  async function buildPayload(stamp) {
    const files = await DB.all("files");
    const encoded = [];
    for (const file of files) {
      if (!file || !file.blob) continue;
      encoded.push({
        id: file.id,
        invoiceId: file.invoiceId,
        role: file.role || "bollo",
        name: file.name,
        type: file.type,
        data: await blobToBase64(file.blob),
      });
    }
    const updatedAt = stamp || (await DB.getMeta("updatedAt")) || new Date().toISOString();
    return {
      kind: "fatture-sonia-backup",
      version: 2,
      updatedAt: updatedAt,
      patients: await DB.all("patients"),
      invoices: await DB.all("invoices"),
      appointments: await DB.all("appointments"),
      professional: await DB.getMeta("settings"),
      files: encoded,
    };
  }

  async function archiveBlob() {
    const payload = await buildPayload();
    return new Blob([JSON.stringify(payload)], { type: "application/json" });
  }

  function validArchive(data) {
    return !!(data && data.kind === "fatture-sonia-backup" && Array.isArray(data.patients) && Array.isArray(data.invoices));
  }

  async function applyPayload(data) {
    const files = (data.files || []).map(function (file) {
      return {
        id: file.id,
        invoiceId: file.invoiceId,
        role: file.role || "bollo",
        name: file.name,
        type: file.type,
        blob: base64ToBlob(file.data, file.type),
      };
    });
    const stamp = data.updatedAt || data.exportedAt || new Date().toISOString();
    applying = true;
    try {
      await DB.runQuiet(async function () {
        await DB.importAll({
          patients: data.patients,
          invoices: data.invoices,
          appointments: data.appointments || [],
          professional: data.professional || window.activeSeed().professional,
          files: files,
        });
        await DB.setMeta("updatedAt", stamp);
        await DB.setMeta("lastSyncedAt", stamp);
      });
    } finally {
      applying = false;
    }
    state.updatedAt = stamp;
    state.lastSyncedAt = stamp;
    state.conflict = false;
    pendingRemote = null;
    return stamp;
  }

  async function writeNamed(dir, name, blob) {
    const fh = await dir.getFileHandle(name, { create: true });
    const stream = await fh.createWritable();
    await stream.write(blob);
    await stream.close();
  }

  async function writeLooseScans(dir, payload) {
    const folder = await dir.getDirectoryHandle("bolli", { create: true });
    const keep = {};
    const invoices = payload.invoices || [];
    for (const file of payload.files || []) {
      if (file.role && file.role !== "bollo") continue;
      const inv = invoices.find(function (item) { return item.id === file.invoiceId; }) || {};
      const ext = file.type === "application/pdf" ? "pdf" : (String(file.type || "").indexOf("png") >= 0 ? "png" : "jpg");
      const name = safeName((inv.year || "") + "-" + (inv.number || "") + "_" + (inv.patientName || "bollo")) + "_" + String(file.id || "").slice(-4) + "." + ext;
      keep[name] = true;
      await writeNamed(folder, name, base64ToBlob(file.data, file.type));
    }
    const existing = [];
    for await (const [name] of folder.entries()) existing.push(name);
    for (const name of existing) {
      if (!keep[name]) await folder.removeEntry(name);
    }
  }

  async function writeReadme(dir) {
    const text = "Cartella di Fatture Sonia.\n\n" +
      "archivio-fatture-sonia.json contiene pazienti, fatture e scansioni della marca da bollo.\n" +
      "La cartella bolli contiene le stesse scansioni, apribili da File.\n" +
      "Non rinominare il file json: gli altri dispositivi lo cercano con questo nome.\n" +
      "Se la cartella è in iCloud Drive, iCloud la copia sui dispositivi con lo stesso Apple ID.\n";
    await writeNamed(dir, "LEGGIMI.txt", new Blob([text], { type: "text/plain" }));
  }

  async function writeToHandle(dir, stamp) {
    const payload = await buildPayload(stamp);
    await writeNamed(dir, FILE_NAME, new Blob([JSON.stringify(payload)], { type: "application/json" }));
    await writeLooseScans(dir, payload);
    await writeReadme(dir);
  }

  async function readFromHandle(dir) {
    const fh = await dir.getFileHandle(FILE_NAME);
    const file = await fh.getFile();
    const data = JSON.parse(await file.text());
    if (!validArchive(data)) throw new Error("archivio");
    return data;
  }

  async function permitted(dir, ask) {
    if (!dir || !dir.queryPermission) return false;
    const opts = { mode: "readwrite" };
    if ((await dir.queryPermission(opts)) === "granted") return true;
    if (!ask || !dir.requestPermission) return false;
    return (await dir.requestPermission(opts)) === "granted";
  }

  async function rememberStatus() {
    state.updatedAt = (await DB.getMeta("updatedAt")) || "";
    state.lastSyncedAt = (await DB.getMeta("lastSyncedAt")) || "";
    state.linked = !!handle;
    state.folderName = handle && handle.name ? handle.name : "";
    state.needsAuth = !!handle && !(await permitted(handle, false));
  }

  async function localCount() {
    const patients = await DB.all("patients");
    const invoices = await DB.all("invoices");
    return patients.length + invoices.length;
  }

  function remoteCount(data) {
    return (data.patients ? data.patients.length : 0) + (data.invoices ? data.invoices.length : 0);
  }

  async function reconcile(ask) {
    if (!handle) return "idle";
    if (!(await permitted(handle, !!ask))) {
      state.needsAuth = true;
      notify();
      return "auth";
    }
    state.needsAuth = false;
    let remote = null;
    try {
      remote = await readFromHandle(handle);
    } catch (err) {
      if (err && err.name === "NotFoundError") {
        await publishNow();
        return "pushed";
      }
      state.lastError = "La cartella non è leggibile. Se è su iCloud, apri il file in Finder e attendi il download.";
      notify();
      return "error";
    }
    const localStamp = (await DB.getMeta("updatedAt")) || "";
    const synced = (await DB.getMeta("lastSyncedAt")) || "";
    const remoteStamp = remote.updatedAt || remote.exportedAt || "";
    const localN = await localCount();
    const remoteN = remoteCount(remote);
    state.lastError = "";
    if (!remoteStamp && remoteN === 0) {
      await publishNow();
      return "pushed";
    }
    if (!localStamp && localN === 0 && remoteN > 0) {
      await applyPayload(remote);
      notify();
      return "applied";
    }
    if (!localStamp && localN > 0 && remoteN > 0) {
      state.conflict = true;
      pendingRemote = remote;
      notify();
      return "conflict";
    }
    if (remoteStamp && remoteStamp === localStamp) return "idle";
    if (localStamp && synced === localStamp && remoteStamp < localStamp) return "idle";
    if (remoteStamp > localStamp && (!localStamp || localStamp === synced)) {
      await applyPayload(remote);
      notify();
      return "applied";
    }
    if (localStamp > remoteStamp && (!synced || synced === remoteStamp || !remoteStamp)) {
      await publishNow();
      return "pushed";
    }
    state.conflict = true;
    pendingRemote = remote;
    notify();
    return "conflict";
  }

  async function publishNow(gen) {
    const stamp = new Date().toISOString();
    await DB.runQuiet(async function () {
      await DB.setMeta("updatedAt", stamp);
    });
    if (gen != null && gen !== generation) return stamp;
    if (handle && await permitted(handle, false)) {
      await writeToHandle(handle, stamp);
      if (gen != null && gen !== generation) return stamp;
      await DB.runQuiet(async function () {
        await DB.setMeta("lastSyncedAt", stamp);
      });
      state.lastSyncedAt = stamp;
      state.lastError = "";
      state.conflict = false;
      pendingRemote = null;
    }
    state.updatedAt = stamp;
    notify();
    return stamp;
  }

  function noteLocalChange() {
    if (applying) return;
    const gen = ++generation;
    clearTimeout(timer);
    timer = setTimeout(function () {
      publishNow(gen).catch(function () {
        if (gen !== generation) return;
        state.lastError = "Non riesco a scrivere nella cartella iCloud.";
        notify();
      });
    }, 700);
  }

  async function chooseFolder() {
    if (!state.canPick) throw new Error("unsupported");
    handle = await window.showDirectoryPicker({ mode: "readwrite", id: "fatture-sonia" });
    await DB.runQuiet(async function () {
      await DB.setMeta("dirHandle", handle);
    });
    state.linked = true;
    state.folderName = handle.name || "";
    state.needsAuth = false;
    await writeReadme(handle);
    return reconcile(true);
  }

  async function authorize() {
    if (!handle) return "idle";
    if (!(await permitted(handle, true))) {
      state.needsAuth = true;
      notify();
      return "auth";
    }
    state.needsAuth = false;
    return reconcile(true);
  }

  async function disconnect() {
    handle = null;
    await DB.runQuiet(async function () {
      await DB.setMeta("dirHandle", null);
    });
    state.linked = false;
    state.needsAuth = false;
    state.folderName = "";
    state.conflict = false;
    pendingRemote = null;
    notify();
  }

  async function keepRemote() {
    if (!pendingRemote) return "idle";
    await applyPayload(pendingRemote);
    notify();
    return "applied";
  }

  async function keepLocal() {
    pendingRemote = null;
    state.conflict = false;
    await publishNow();
    return "pushed";
  }

  async function boot() {
    await rememberStatus();
    const stored = await DB.getMeta("dirHandle");
    if (stored && stored.getFileHandle) {
      handle = stored;
      state.linked = true;
      state.folderName = handle.name || "";
      try {
        return await reconcile(false);
      } catch (err) {
        state.lastError = "Non riesco a leggere la cartella collegata.";
        notify();
        return "error";
      }
    }
    notify();
    return "idle";
  }

  window.Sync = {
    state: state,
    FILE_NAME: FILE_NAME,
    noteLocalChange: noteLocalChange,
    boot: boot,
    chooseFolder: chooseFolder,
    authorize: authorize,
    disconnect: disconnect,
    reconcile: reconcile,
    keepRemote: keepRemote,
    keepLocal: keepLocal,
    archiveBlob: archiveBlob,
    applyPayload: applyPayload,
    validArchive: validArchive,
  };
})();
