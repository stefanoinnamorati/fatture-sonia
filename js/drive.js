(function () {
  const FILE_NAME = "archivio-fatture-sonia.json";
  const SCOPE = "https://www.googleapis.com/auth/drive.file";
  const state = {
    linked: false,
    needsAuth: false,
    syncing: false,
    pending: false,
    conflict: false,
    lastError: "",
  };
  let token = "";
  let expiresAt = 0;
  let fileId = "";
  let timer = null;
  let generation = 0;
  let pendingRemote = null;
  let tokenWait = null;

  function notify() {
    if (window.onSyncStatus) window.onSyncStatus();
  }

  async function clientId() {
    const settings = await DB.getMeta("settings");
    return String((settings && settings.driveClientId) || "").trim();
  }

  function loadGis() {
    if (window.google && google.accounts && google.accounts.oauth2) return Promise.resolve();
    return new Promise(function (resolve, reject) {
      const script = document.createElement("script");
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.onload = function () { resolve(); };
      script.onerror = function () { reject(new Error("gis")); };
      document.head.appendChild(script);
    });
  }

  function rememberToken(resp) {
    token = resp.access_token || "";
    expiresAt = Date.now() + Math.max(0, (Number(resp.expires_in) || 3600) - 60) * 1000;
    state.linked = !!token;
    state.needsAuth = !token;
    return DB.setMeta("driveAuth", { accessToken: token, expiresAt: expiresAt });
  }

  async function requestToken(prompt) {
    const id = await clientId();
    if (!id) return Promise.reject(new Error("missing-client"));
    return loadGis().then(function () {
      return new Promise(function (resolve, reject) {
        tokenWait = { resolve: resolve, reject: reject };
        const client = google.accounts.oauth2.initTokenClient({
          client_id: id,
          scope: SCOPE,
          callback: function (resp) {
            const wait = tokenWait;
            tokenWait = null;
            if (!wait) return;
            if (!resp || resp.error || !resp.access_token) {
              wait.reject(new Error((resp && resp.error) || "auth"));
              return;
            }
            rememberToken(resp).then(function () { wait.resolve(token); }, wait.reject);
          },
          error_callback: function (err) {
            const wait = tokenWait;
            tokenWait = null;
            if (!wait) return;
            const type = err && (err.type || err.message) || "auth";
            const error = new Error(String(type));
            error.name = type === "popup_closed" ? "AbortError" : "Error";
            wait.reject(error);
          },
        });
        client.requestAccessToken({ prompt: prompt || "" });
      });
    });
  }

  async function accessToken(interactive) {
    if (token && expiresAt > Date.now()) return token;
    const saved = await DB.getMeta("driveAuth");
    if (saved && saved.accessToken && saved.expiresAt > Date.now()) {
      token = saved.accessToken;
      expiresAt = saved.expiresAt;
      state.linked = true;
      state.needsAuth = false;
      return token;
    }
    if (!interactive) {
      state.linked = !!(saved && saved.accessToken);
      state.needsAuth = state.linked;
      return "";
    }
    return requestToken(saved && saved.accessToken ? "" : "consent");
  }

  async function api(url, options) {
    const auth = await accessToken(false);
    if (!auth) {
      state.needsAuth = state.linked;
      throw new Error("auth");
    }
    const headers = Object.assign({ Authorization: "Bearer " + auth }, (options && options.headers) || {});
    const res = await fetch(url, Object.assign({}, options || {}, { headers: headers }));
    if (res.status === 401) {
      token = "";
      expiresAt = 0;
      state.needsAuth = true;
      notify();
      throw new Error("auth");
    }
    return res;
  }

  async function findFile() {
    if (fileId) {
      const check = await api("https://www.googleapis.com/drive/v3/files/" + encodeURIComponent(fileId) + "?fields=id,trashed");
      if (check.ok) {
        const info = await check.json();
        if (info && info.id && !info.trashed) return info.id;
      }
      fileId = "";
      await DB.setMeta("driveFileId", "");
    }
    const q = encodeURIComponent("name = '" + FILE_NAME + "' and trashed = false");
    const list = await api("https://www.googleapis.com/drive/v3/files?spaces=drive&pageSize=10&fields=files(id,name)&q=" + q);
    if (!list.ok) throw new Error("list");
    const found = await list.json();
    const id = found.files && found.files[0] && found.files[0].id;
    if (id) {
      fileId = id;
      await DB.setMeta("driveFileId", id);
    }
    return id || "";
  }

  async function upload() {
    const blob = await Sync.archiveBlob();
    const text = await blob.text();
    const payload = JSON.parse(text);
    const id = await findFile();
    let res;
    if (id) {
      res = await api("https://www.googleapis.com/upload/drive/v3/files/" + encodeURIComponent(id) + "?uploadType=media", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: text,
      });
      if (res.status === 404) {
        fileId = "";
        await DB.setMeta("driveFileId", "");
        return upload();
      }
    } else {
      const boundary = "fatture_sonia";
      const meta = JSON.stringify({ name: FILE_NAME, mimeType: "application/json" });
      const body = new Blob([
        "--" + boundary + "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n",
        meta,
        "\r\n--" + boundary + "\r\nContent-Type: application/json\r\n\r\n",
        text,
        "\r\n--" + boundary + "--",
      ]);
      res = await api("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart", {
        method: "POST",
        headers: { "Content-Type": "multipart/related; boundary=" + boundary },
        body: body,
      });
    }
    if (!res.ok) throw new Error("upload");
    const saved = await res.json();
    if (saved && saved.id) {
      fileId = saved.id;
      await DB.runQuiet(async function () { await DB.setMeta("driveFileId", fileId); });
    }
    const stamp = payload.updatedAt || new Date().toISOString();
    await DB.runQuiet(async function () { await DB.setMeta("lastSyncedAt", stamp); });
    if (window.Sync) {
      Sync.state.lastSyncedAt = stamp;
      Sync.state.updatedAt = (await DB.getMeta("updatedAt")) || stamp;
    }
    state.pending = false;
    state.lastError = "";
    state.needsAuth = false;
    state.conflict = false;
    pendingRemote = null;
    notify();
    return "pushed";
  }

  async function download() {
    const id = await findFile();
    if (!id) return null;
    const res = await api("https://www.googleapis.com/drive/v3/files/" + encodeURIComponent(id) + "?alt=media");
    if (res.status === 404) return null;
    if (!res.ok) throw new Error("download");
    const data = await res.json();
    if (!Sync.validArchive(data)) throw new Error("archivio");
    return data;
  }

  async function reconcile() {
    if (state.syncing) return "busy";
    state.syncing = true;
    notify();
    try {
      const remote = await download();
      if (!remote) return await upload();
      const localStamp = (await DB.getMeta("updatedAt")) || "";
      const synced = (await DB.getMeta("lastSyncedAt")) || "";
      const remoteStamp = remote.updatedAt || remote.exportedAt || "";
      state.lastError = "";
      if (remoteStamp && remoteStamp === localStamp) return "idle";
      if (remoteStamp > localStamp && (!localStamp || localStamp === synced)) {
        await Sync.applyPayload(remote);
        state.conflict = false;
        pendingRemote = null;
        notify();
        return "applied";
      }
      if (localStamp > remoteStamp && (!synced || synced === remoteStamp || synced === localStamp)) {
        return await upload();
      }
      state.conflict = true;
      pendingRemote = remote;
      notify();
      return "conflict";
    } finally {
      state.syncing = false;
      notify();
    }
  }

  function onLocalChange() {
    if (!state.linked || state.needsAuth) return;
    generation += 1;
    const gen = generation;
    state.pending = true;
    notify();
    clearTimeout(timer);
    timer = setTimeout(function () {
      if (gen !== generation) return;
      upload().catch(function (err) {
        if (gen !== generation) return;
        state.pending = false;
        if (err && err.message === "auth") state.needsAuth = true;
        else state.lastError = "Non riesco a scrivere su Drive.";
        notify();
      });
    }, 800);
  }

  async function connect() {
    await requestToken("consent");
    fileId = (await DB.getMeta("driveFileId")) || "";
    state.linked = true;
    state.needsAuth = false;
    state.lastError = "";
    return reconcile();
  }

  async function disconnect() {
    const current = token;
    token = "";
    expiresAt = 0;
    fileId = "";
    state.linked = false;
    state.needsAuth = false;
    state.conflict = false;
    state.pending = false;
    pendingRemote = null;
    await DB.setMeta("driveAuth", null);
    await DB.setMeta("driveFileId", "");
    if (current && window.google && google.accounts && google.accounts.oauth2) {
      try { google.accounts.oauth2.revoke(current); } catch (e) {}
    }
    notify();
  }

  async function keepRemote() {
    if (!pendingRemote) return "idle";
    await Sync.applyPayload(pendingRemote);
    pendingRemote = null;
    state.conflict = false;
    notify();
    return "applied";
  }

  async function keepLocal() {
    pendingRemote = null;
    state.conflict = false;
    return upload();
  }

  async function boot() {
    fileId = (await DB.getMeta("driveFileId")) || "";
    const saved = await DB.getMeta("driveAuth");
    if (!saved || !saved.accessToken) return "idle";
    state.linked = true;
    if (saved.expiresAt <= Date.now()) {
      state.needsAuth = true;
      notify();
      return "auth";
    }
    token = saved.accessToken;
    expiresAt = saved.expiresAt;
    state.needsAuth = false;
    try {
      return await reconcile();
    } catch (err) {
      if (err && err.message === "auth") return "auth";
      state.lastError = "Non riesco a leggere il file su Drive.";
      notify();
      return "error";
    }
  }

  async function pull() {
    if (!state.linked) return "idle";
    if (state.needsAuth) return "auth";
    try {
      return await reconcile();
    } catch (err) {
      if (err && err.message === "auth") return "auth";
      state.lastError = "Non riesco ad aggiornare Drive.";
      notify();
      return "error";
    }
  }

  window.Drive = {
    state: state,
    clientId: clientId,
    onLocalChange: onLocalChange,
    connect: connect,
    disconnect: disconnect,
    boot: boot,
    pull: pull,
    keepRemote: keepRemote,
    keepLocal: keepLocal,
  };
})();
