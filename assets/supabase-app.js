"use strict";

const SESSION_KEY = "myfailpro_supabase_session";
const PROFILE_KEY = "myfailpro_profile";
const defaults = {
  fungsi: ["400 Pengurusan Kewangan dan Perakaunan"],
  aktiviti: ["400-1 Tadbir Urus Kewangan/Akaun"],
  subAktiviti: ["400-1/1 Perwakilan Kewangan"],
  transaksi: ["400-1/1/1"],
  pegawai: [{ nama: "Ahmad Albab", sektor: "Unit Kewangan" }]
};

let config;
let session;
let currentUser;
const state = { files: [], agencies: [], settings: null };

function create(tag, options = {}, children = []) {
  const node = document.createElement(tag);
  Object.entries(options).forEach(([key, value]) => {
    if (key === "className") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value);
  });
  (Array.isArray(children) ? children : [children]).filter(Boolean).forEach(child => node.append(child));
  return node;
}

function toast(title, message, type = "success") {
  let region = document.querySelector(".toast-region");
  if (!region) {
    region = create("div", { className: "toast-region", "aria-live": "polite" });
    document.body.append(region);
  }
  const item = create("div", { className: `toast ${type}` }, [create("strong", { text: title }), create("span", { text: message })]);
  region.append(item);
  setTimeout(() => item.remove(), 5000);
}

function setBusy(button, busy, label = "Sila tunggu…") {
  if (!button) return;
  if (busy) {
    button.dataset.originalText = button.textContent;
    button.textContent = label;
    button.disabled = true;
  } else {
    button.textContent = button.dataset.originalText || button.textContent;
    button.disabled = false;
  }
}

async function responseError(response, fallback) {
  let body = {};
  try { body = await response.json(); } catch { /* Response was not JSON. */ }
  return new Error(body.error_description || body.msg || body.message || body.error || fallback);
}

async function loadConfig() {
  const publicConfig = globalThis.MYFAILPRO_CONFIG;
  if (!publicConfig?.url || !publicConfig?.publishableKey) {
    throw new Error("Konfigurasi awam Supabase belum lengkap dalam assets/runtime-config.js.");
  }
  config = {
    url: String(publicConfig.url).replace(/\/$/, ""),
    publishableKey: String(publicConfig.publishableKey)
  };
}

function saveSession(value) {
  session = value;
  if (value) sessionStorage.setItem(SESSION_KEY, JSON.stringify(value));
  else {
    sessionStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(PROFILE_KEY);
  }
}

function readSession() {
  try { return JSON.parse(sessionStorage.getItem(SESSION_KEY)); }
  catch { sessionStorage.removeItem(SESSION_KEY); return null; }
}

async function authRequest(path, options = {}) {
  return fetch(`${config.url}/auth/v1/${path}`, {
    ...options,
    headers: { apikey: config.publishableKey, "content-type": "application/json", ...(options.headers || {}) }
  });
}

async function refreshSession() {
  if (!session?.refresh_token) return false;
  const response = await authRequest("token?grant_type=refresh_token", {
    method: "POST",
    body: JSON.stringify({ refresh_token: session.refresh_token })
  });
  if (!response.ok) { saveSession(null); return false; }
  saveSession(await response.json());
  return true;
}

async function supabaseFetch(path, options = {}, retry = true) {
  if (!session?.access_token) throw new Error("Sesi log masuk tidak ditemui.");
  const response = await fetch(`${config.url}${path}`, {
    ...options,
    headers: {
      apikey: config.publishableKey,
      authorization: `Bearer ${session.access_token}`,
      "content-type": "application/json",
      ...(options.headers || {})
    }
  });
  if (response.status === 401 && retry && await refreshSession()) return supabaseFetch(path, options, false);
  return response;
}

async function rest(table, query = "", options = {}) {
  const response = await supabaseFetch(`/rest/v1/${table}${query ? `?${query}` : ""}`, options);
  if (!response.ok) throw await responseError(response, "Operasi pangkalan data gagal.");
  if (response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function rpc(functionName, parameters) {
  const response = await supabaseFetch(`/rest/v1/rpc/${functionName}`, {
    method: "POST",
    body: JSON.stringify(parameters)
  });
  if (!response.ok) throw await responseError(response, "Operasi pangkalan data gagal.");
  return response.json();
}

async function loadProfile(userId) {
  const rows = await rest("profiles", `id=eq.${encodeURIComponent(userId)}&select=id,email,name,agency_type,role`);
  if (!rows?.length) throw new Error("Profil pengguna tidak ditemui. Jalankan migrasi Supabase dan cipta semula pengguna ini.");
  const profile = rows[0];
  currentUser = {
    id: profile.id,
    email: profile.email,
    role: profile.role,
    data: { nama: profile.name, jenis: profile.agency_type }
  };
  sessionStorage.setItem(PROFILE_KEY, JSON.stringify(currentUser));
  return currentUser;
}

function renderShell(user) {
  if (!user) return;
  document.querySelectorAll("[data-admin]").forEach(el => el.classList.toggle("hidden", user.role !== "admin"));
  const name = document.querySelector("[data-user-name]");
  const role = document.querySelector("[data-user-role]");
  const displayName = user.data?.nama || (user.role === "admin" ? "Pentadbir" : "Agensi");
  const roleLabel = user.role === "admin" ? "Admin PPD" : (user.data?.jenis || "Agensi");
  if (name) name.textContent = displayName;
  if (role) role.textContent = roleLabel;
  document.querySelectorAll("[data-user-avatar]").forEach(el => {
    el.textContent = displayName.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join("").toUpperCase() || "MP";
    el.dataset.userTooltip = `${displayName} · ${roleLabel}`;
    el.title = `${displayName} — ${roleLabel}`;
    el.tabIndex = 0;
    el.setAttribute("aria-label", `${displayName}, ${roleLabel}`);
  });
  const date = document.querySelector("[data-current-date]");
  if (date) date.textContent = new Intl.DateTimeFormat("ms-MY", { dateStyle: "full" }).format(new Date());
}

function renderCachedShell() {
  try {
    const cached = JSON.parse(sessionStorage.getItem(PROFILE_KEY));
    if (cached?.id && cached?.role) renderShell(cached);
  } catch { sessionStorage.removeItem(PROFILE_KEY); }
}

async function restoreAuth() {
  session = readSession();
  if (!session?.access_token) return null;
  const userId = session.user?.id;
  if (!userId) { saveSession(null); return null; }
  try { return await loadProfile(userId); }
  catch (error) {
    if (!await refreshSession()) return null;
    return loadProfile(session.user?.id || userId);
  }
}

async function consumeAuthRedirect() {
  if (!location.hash) return null;
  const params = new URLSearchParams(location.hash.slice(1));
  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");
  if (!accessToken) return null;
  const response = await fetch(`${config.url}/auth/v1/user`, {
    headers: { apikey: config.publishableKey, authorization: `Bearer ${accessToken}` }
  });
  if (!response.ok) throw await responseError(response, "Sesi log masuk tidak dapat disahkan.");
  const user = await response.json();
  saveSession({
    access_token: accessToken,
    refresh_token: refreshToken,
    token_type: params.get("token_type") || "bearer",
    expires_in: Number(params.get("expires_in") || 3600),
    expires_at: Number(params.get("expires_at") || 0),
    user
  });
  history.replaceState(null, "", location.pathname);
  return { type: params.get("type"), user };
}

async function requireAuth(adminOnly = false) {
  const user = currentUser || await restoreAuth();
  if (!user || (adminOnly && user.role !== "admin")) {
    saveSession(null);
    location.replace("MyFailPro.html");
    return null;
  }
  return user;
}

async function initShell(adminOnly = false) {
  const user = await requireAuth(adminOnly);
  if (!user) return null;
  renderShell(user);
  document.querySelectorAll("[data-logout]").forEach(button => button.addEventListener("click", async () => {
    button.disabled = true;
    try { await authRequest("logout", { method: "POST", headers: { authorization: `Bearer ${session.access_token}` } }); }
    finally { saveSession(null); location.replace("MyFailPro.html"); }
  }));
  return user;
}

function fillSelect(select, values, prompt = "Pilih parameter…") {
  select.replaceChildren(create("option", { value: "", text: prompt }));
  values.forEach(value => select.append(create("option", { value, text: value })));
}

function formatDate(value, withTime = false) {
  if (!value) return "–";
  const date = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  if (Number.isNaN(date.getTime())) return "–";
  return new Intl.DateTimeFormat("ms-MY", withTime ? { dateStyle: "medium", timeStyle: "short" } : { dateStyle: "medium" }).format(date);
}

const validDateRange = (start, end) => !start || !end || end >= start;
const markReady = () => document.body.classList.add("auth-ready");

function initRevealAnimations() {
  const selector = [
    ".login-brand",
    ".login-intro",
    ".login-card",
    ".page-head",
    ".stats > .panel",
    "main > .panel",
    ".settings-grid > .panel",
    ".notice",
    "tbody tr",
    ".item-list > .item"
  ].join(",");
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const canObserve = "IntersectionObserver" in window && !reducedMotion;
  const loginPage = document.body.dataset.page === "login";
  const delayStep = loginPage ? 70 : 35;
  const delaySlots = loginPage ? 5 : 4;
  const observed = new WeakSet();
  let initialOrder = 0;

  const observer = canObserve ? new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add("is-visible");
      observer.unobserve(entry.target);
    });
  }, { threshold: 0.12, rootMargin: "0px 0px -36px 0px" }) : null;

  function register(element, dynamic = false) {
    if (!(element instanceof Element) || observed.has(element)) return;
    observed.add(element);
    if (!canObserve) return;
    const siblingIndex = Array.from(element.parentElement?.children || []).indexOf(element);
    const order = dynamic ? Math.max(0, siblingIndex) : initialOrder++;
    element.style.setProperty("--reveal-delay", `${Math.min(order % delaySlots, delaySlots - 1) * delayStep}ms`);
    element.classList.add("reveal-item");
    observer.observe(element);
  }

  function scan(root, dynamic = false) {
    if (root instanceof Element && root.matches(selector)) register(root, dynamic);
    root.querySelectorAll?.(selector).forEach(element => register(element, dynamic));
  }

  if (canObserve) document.documentElement.classList.add("reveal-enabled");
  scan(document);

  const mutationObserver = new MutationObserver(mutations => {
    mutations.forEach(mutation => mutation.addedNodes.forEach(node => scan(node, true)));
  });
  mutationObserver.observe(document.body, { childList: true, subtree: true });
}

function mapSettings(row) {
  return {
    fungsi: [...(row?.functions || defaults.fungsi)],
    aktiviti: [...(row?.activities || defaults.aktiviti)],
    subAktiviti: [...(row?.sub_activities || defaults.subAktiviti)],
    transaksi: [...(row?.transactions || defaults.transaksi)],
    pegawai: (row?.staff || defaults.pegawai).map(person => ({ ...person }))
  };
}

function settingsPayload(settings) {
  return {
    functions: settings.fungsi,
    activities: settings.aktiviti,
    sub_activities: settings.subAktiviti,
    transactions: settings.transaksi,
    staff: settings.pegawai
  };
}

async function loadSettings() {
  let rows = await rest("agency_settings", `owner_id=eq.${encodeURIComponent(currentUser.id)}&select=owner_id,functions,activities,sub_activities,transactions,staff`);
  if (!rows.length) {
    rows = await rest("agency_settings", "", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ owner_id: currentUser.id })
    });
  }
  state.settings = mapSettings(rows[0]);
  return state.settings;
}

async function saveSettings() {
  await rest("agency_settings", `owner_id=eq.${encodeURIComponent(currentUser.id)}`, {
    method: "PATCH",
    body: JSON.stringify(settingsPayload(state.settings))
  });
}

function mapFile(row) {
  return {
    id: row.id,
    ownerId: row.owner_id,
    fungsi: row.function_name,
    aktiviti: row.activity_name,
    subAktiviti: row.sub_activity_name,
    transaksi: row.transaction_code,
    jilid: row.volume,
    tarikhBuka: row.opened_on,
    tarikhTutup: row.closed_on || "",
    status: row.status,
    pemegangTerkini: row.current_holder,
    tarikhDaftar: row.created_at
  };
}

function mapMovement(row) {
  return { id: row.id, idFail: row.file_id, ownerId: row.owner_id, tarikh: row.moved_at, dari: row.from_holder, kepada: row.to_holder, catatan: row.note };
}

async function loadFiles() {
  const columns = "id,owner_id,function_name,activity_name,sub_activity_name,transaction_code,volume,opened_on,closed_on,status,current_holder,created_at";
  const rows = await rest("files", `select=${columns}&order=transaction_code.asc,volume.asc`);
  state.files = rows.map(mapFile);
}

async function loadAgencies() {
  if (currentUser.role !== "admin") { state.agencies = []; return; }
  const rows = await rest("profiles", "role=eq.agency&select=id,email,name,agency_type,created_at&order=name.asc");
  state.agencies = rows.map(row => ({ id: row.id, emel: row.email, nama: row.name, jenis: row.agency_type, createdAt: row.created_at }));
}

async function initLogin() {
  const authRedirect = await consumeAuthRedirect();
  const recoveryMode = authRedirect?.type === "recovery";
  if (authRedirect && !recoveryMode) {
    await loadProfile(authRedirect.user.id);
    location.replace("dashboard.html");
    return;
  }
  if (!authRedirect && await restoreAuth()) { location.replace("dashboard.html"); return; }
  const form = document.querySelector("#formLogin");
  const emailField = document.querySelector("#loginEmail").closest(".field");
  const emailInput = document.querySelector("#loginEmail");
  const passwordInput = document.querySelector("#loginPassword");
  const passwordField = document.querySelector("#passwordField");
  const submitButton = form.querySelector("button[type=submit]");
  const submitLabel = submitButton.querySelector("[data-login-button-label]");
  let passwordStep = recoveryMode;

  if (recoveryMode) {
    emailField.classList.add("hidden");
    passwordField.classList.remove("hidden");
    passwordInput.required = true;
    passwordInput.placeholder = "Kata laluan baharu";
    document.querySelector("#loginTitle").textContent = "Tetapkan Kata Laluan";
    document.querySelector(".login-card-head p").textContent = "Masukkan kata laluan baharu untuk akaun anda.";
    submitLabel.textContent = "Simpan Kata Laluan";
    passwordInput.focus();
  }

  document.querySelector("#forgotPassword")?.addEventListener("click", async () => {
    const email = emailInput.value.trim().toLowerCase();
    if (!email || !emailInput.checkValidity()) {
      emailInput.reportValidity();
      emailInput.focus();
      return;
    }
    try {
      const response = await authRequest("recover", {
        method: "POST",
        body: JSON.stringify({ email, redirect_to: new URL("MyFailPro.html", location.href).href })
      });
      if (!response.ok) throw await responseError(response, "Permintaan tetapan semula gagal.");
      toast("E-mel dihantar", "Semak peti masuk anda untuk menetapkan semula kata laluan.");
    } catch (error) {
      toast("Tidak dapat menghantar e-mel", error.message, "error");
    }
  });

  document.querySelector("#requestAccount")?.addEventListener("click", () => {
    toast("Pendaftaran akaun", "Sila hubungi pentadbir PPD Limbang untuk mendapatkan akaun baharu.");
  });

  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (!passwordStep) {
      if (!emailInput.checkValidity()) { emailInput.reportValidity(); return; }
      passwordStep = true;
      passwordField.classList.remove("hidden");
      passwordInput.required = true;
      submitLabel.textContent = "Log Masuk";
      passwordInput.focus();
      return;
    }
    setBusy(submitButton, true, recoveryMode ? "Menyimpan…" : "Log masuk…");
    try {
      if (recoveryMode) {
        const response = await supabaseFetch("/auth/v1/user", {
          method: "PUT",
          body: JSON.stringify({ password: passwordInput.value })
        });
        if (!response.ok) throw await responseError(response, "Kata laluan baharu tidak dapat disimpan.");
        await loadProfile(session.user.id);
        location.assign("dashboard.html");
        return;
      }
      const email = emailInput.value.trim().toLowerCase();
      const password = passwordInput.value;
      const response = await authRequest("token?grant_type=password", { method: "POST", body: JSON.stringify({ email, password }) });
      if (!response.ok) throw await responseError(response, "Emel atau katalaluan salah.");
      saveSession(await response.json());
      await loadProfile(session.user.id);
      location.assign("dashboard.html");
    } catch (error) {
      if (!recoveryMode) saveSession(null);
      toast(recoveryMode ? "Kata laluan tidak dapat disimpan" : "Log masuk gagal", error.message, "error");
      setBusy(submitButton, false);
    }
  });
}

async function initDashboard() {
  if (!await initShell()) return;
  await Promise.all([loadSettings(), loadFiles(), loadAgencies()]);
  const body = document.querySelector("#fileRows");
  const search = document.querySelector("#searchFile");
  const filter = document.querySelector("#filterFungsi");
  fillSelect(filter, state.settings.fungsi, "Semua fungsi");
  const updateStats = () => {
    document.querySelector("#statTotal").textContent = state.files.length;
    document.querySelector("#statArchive").textContent = state.files.filter(f => f.pemegangTerkini === "Bilik Fail").length;
    document.querySelector("#statMoving").textContent = state.files.filter(f => f.pemegangTerkini !== "Bilik Fail").length;
  };
  const render = () => {
    updateStats();
    const term = search.value.trim().toLowerCase();
    const selected = filter.value;
    const files = state.files.filter(file => {
      const haystack = [file.transaksi, file.subAktiviti, file.pemegangTerkini].filter(Boolean).join(" ").toLowerCase();
      return haystack.includes(term) && (!selected || file.fungsi === selected);
    });
    body.replaceChildren();
    document.querySelector("#emptyFiles").classList.toggle("hidden", files.length > 0);
    files.forEach(file => {
      const archive = file.pemegangTerkini.toLowerCase() === "bilik fail";
      const buttons = create("div", { className: "actions" }, [
        create("button", { className: "button small", type: "button", text: "Pindah", onclick: () => openMovement(file, render) }),
        create("button", { className: "button secondary small", type: "button", text: "Edit", onclick: () => openEdit(file, render) }),
        create("button", { className: "button secondary small", type: "button", text: "Log", onclick: () => openHistory(file) })
      ]);
      body.append(create("tr", {}, [
        create("td", {}, [create("div", { className: "record-title", text: file.transaksi }), create("div", { className: "record-meta", text: `Jilid ${file.jilid} · ${file.subAktiviti}` })]),
        create("td", { text: `${formatDate(file.tarikhBuka)} — ${file.tarikhTutup ? formatDate(file.tarikhTutup) : "Aktif"}` }),
        create("td", {}, create("span", { className: `badge ${archive ? "archive" : "moving"}`, text: file.pemegangTerkini })),
        create("td", {}, buttons)
      ]));
    });
  };
  search.addEventListener("input", render);
  filter.addEventListener("change", render);
  render();
  markReady();
}

function showModal(id) { document.querySelector(id).classList.remove("hidden"); document.body.style.overflow = "hidden"; }
function closeModal(modal) { modal.classList.add("hidden"); document.body.style.overflow = ""; }
function wireModal(modal) {
  modal.querySelectorAll("[data-close]").forEach(el => el.addEventListener("click", () => closeModal(modal)));
  modal.addEventListener("click", event => { if (event.target === modal) closeModal(modal); });
}

function openMovement(file, refresh) {
  const modal = document.querySelector("#movementModal");
  modal.querySelector("[data-file-reference]").textContent = `${file.transaksi} (Jilid ${file.jilid})`;
  const recipient = modal.querySelector("#recipient");
  const recipients = ["Bilik Fail", ...state.settings.pegawai.map(p => p.nama), ...state.agencies.map(a => a.nama)];
  fillSelect(recipient, [...new Set(recipients)], "Pilih keberadaan…");
  recipient.value = file.pemegangTerkini;
  modal.querySelector("#movementDate").value = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  modal.querySelector("#movementNote").value = "";
  modal.onsubmit = async event => {
    event.preventDefault();
    const button = modal.querySelector("button[type=submit]");
    const to = recipient.value;
    const movedAt = modal.querySelector("#movementDate").value;
    const note = modal.querySelector("#movementNote").value.trim();
    const from = file.pemegangTerkini;
    if (from === to && !note) { toast("Tiada perubahan", "Pilih penerima baharu atau masukkan catatan.", "error"); return; }
    setBusy(button, true, "Menyimpan…");
    try {
      const result = await rpc("move_file", {
        p_file_id: file.id,
        p_to_holder: to,
        p_moved_at: new Date(movedAt).toISOString(),
        p_note: note
      });
      Object.assign(file, mapFile(result.file));
      closeModal(modal);
      refresh();
      toast("Berjaya", `Fail kini bersama ${to}.`);
    } catch (error) { toast("Tidak berjaya", error.message, "error"); }
    finally { setBusy(button, false); }
  };
  showModal("#movementModal");
  recipient.focus();
}

function openEdit(file, refresh) {
  const modal = document.querySelector("#editModal");
  modal.querySelector("[data-file-reference]").textContent = `${file.transaksi} (Jilid ${file.jilid})`;
  const start = modal.querySelector("#editOpenDate");
  const end = modal.querySelector("#editCloseDate");
  start.value = file.tarikhBuka;
  end.value = file.tarikhTutup;
  modal.onsubmit = async event => {
    event.preventDefault();
    if (!validDateRange(start.value, end.value)) { toast("Tarikh tidak sah", "Tarikh tutup tidak boleh mendahului tarikh buka.", "error"); return; }
    const button = modal.querySelector("button[type=submit]");
    setBusy(button, true, "Menyimpan…");
    try {
      await rest("files", `id=eq.${encodeURIComponent(file.id)}`, { method: "PATCH", body: JSON.stringify({ opened_on: start.value, closed_on: end.value || null }) });
      file.tarikhBuka = start.value;
      file.tarikhTutup = end.value;
      closeModal(modal);
      refresh();
      toast("Berjaya", "Tarikh fail dikemaskini.");
    } catch (error) { toast("Tidak berjaya", error.message, "error"); }
    finally { setBusy(button, false); }
  };
  showModal("#editModal");
  start.focus();
}

async function openHistory(file) {
  const modal = document.querySelector("#historyModal");
  const list = modal.querySelector("#historyList");
  list.replaceChildren(create("li", { text: "Memuatkan sejarah…" }));
  modal.querySelector("[data-file-reference]").textContent = `${file.transaksi} (Jilid ${file.jilid})`;
  showModal("#historyModal");
  try {
    const columns = "id,file_id,owner_id,moved_at,from_holder,to_holder,note";
    const rows = await rest("movements", `file_id=eq.${encodeURIComponent(file.id)}&select=${columns}&order=moved_at.desc`);
    const records = rows.map(mapMovement);
    list.replaceChildren();
    if (!records.length) list.append(create("li", { text: "Tiada rekod pergerakan." }));
    records.forEach(record => list.append(create("li", {}, [
      create("strong", { text: `${record.dari} → ${record.kepada}` }),
      record.catatan ? create("div", { text: record.catatan }) : null,
      create("time", { text: formatDate(record.tarikh, true) })
    ])));
  } catch (error) {
    list.replaceChildren(create("li", { text: `Sejarah tidak dapat dimuatkan: ${error.message}` }));
  }
}

async function initRegister() {
  if (!await initShell()) return;
  await loadSettings();
  const settings = state.settings;
  const form = document.querySelector("#registerFile");
  const ids = ["fungsi", "aktiviti", "subAktiviti", "transaksi"];
  ids.forEach(id => fillSelect(form.elements[id], settings[id] || []));
  form.elements.fungsi.addEventListener("change", () => fillSelect(form.elements.aktiviti, settings.aktiviti.filter(v => v.startsWith(form.elements.fungsi.value.split(" ")[0]))));
  form.elements.aktiviti.addEventListener("change", () => fillSelect(form.elements.subAktiviti, settings.subAktiviti.filter(v => v.startsWith(form.elements.aktiviti.value.split(" ")[0]))));
  form.elements.subAktiviti.addEventListener("change", () => fillSelect(form.elements.transaksi, settings.transaksi.filter(v => v.startsWith(form.elements.subAktiviti.value.split(" ")[0]))));
  form.addEventListener("reset", () => setTimeout(() => { ids.forEach(id => fillSelect(form.elements[id], id === "fungsi" ? settings.fungsi : [])); form.elements.jilid.value = 1; }, 0));
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    if (!validDateRange(data.tarikhBuka, data.tarikhTutup)) { toast("Tarikh tidak sah", "Tarikh tutup tidak boleh mendahului tarikh buka.", "error"); return; }
    const button = form.querySelector("button[type=submit]");
    setBusy(button, true, "Menyimpan…");
    try {
      await rpc("register_file", {
        p_function_name: data.fungsi,
        p_activity_name: data.aktiviti,
        p_sub_activity_name: data.subAktiviti,
        p_transaction_code: data.transaksi,
        p_volume: Number(data.jilid),
        p_opened_on: data.tarikhBuka,
        p_closed_on: data.tarikhTutup || null
      });
      form.reset();
      toast("Pendaftaran berjaya", "Fail baharu telah disimpan ke Supabase.");
    } catch (error) {
      const duplicate = /duplicate|unique_agency_file_volume/i.test(error.message);
      toast(duplicate ? "Rekod telah wujud" : "Pendaftaran gagal", duplicate ? `Fail ${data.transaksi}, Jilid ${data.jilid} telah didaftarkan.` : error.message, "error");
    } finally { setBusy(button, false); }
  });
  markReady();
}

const labels = { fungsi: "Fungsi", aktiviti: "Aktiviti", subAktiviti: "Sub-Aktiviti", transaksi: "Transaksi Fail" };

async function initSettings() {
  const user = await initShell();
  if (!user) return;
  await loadSettings();
  const settings = state.settings;
  const isAgency = user.role === "agency";
  if (isAgency) {
    document.querySelector("#settingsTitle").textContent = "Tetapan Agensi";
    document.querySelector("#settingsSubtitle").textContent = `Konfigurasi khusus untuk ${user.data.nama || user.email}`;
    document.querySelector("#settingsScope").textContent = "Semua perubahan di halaman ini hanya digunakan oleh agensi anda dan tidak mengubah data agensi lain.";
  } else {
    document.querySelector("#settingsScope").textContent = "Tetapan ini dimiliki oleh akaun pentadbir dan diasingkan daripada tetapan setiap agensi.";
  }
  const grid = document.querySelector("#settingsGrid");
  const render = () => {
    grid.replaceChildren();
    Object.keys(labels).forEach(category => {
      const input = create("input", { className: "input", placeholder: "Tambah pilihan…", "aria-label": `Tambah ${labels[category]}` });
      const add = create("button", { className: "button", type: "submit", text: "Tambah" });
      const form = create("form", { className: "inline-form" }, [input, add]);
      form.addEventListener("submit", async event => {
        event.preventDefault();
        const value = input.value.trim();
        if (!value || settings[category].includes(value)) return;
        settings[category].push(value);
        setBusy(add, true, "Menyimpan…");
        try { await saveSettings(); render(); toast("Berjaya", `${labels[category]} telah ditambah.`); }
        catch (error) { settings[category].pop(); toast("Tidak berjaya", error.message, "error"); }
        finally { setBusy(add, false); }
      });
      const list = create("ul", { className: "item-list" });
      settings[category].forEach((value, index) => {
        const remove = create("button", { type: "button", text: "Padam", "aria-label": `Padam ${value}`, onclick: async () => {
          const removed = settings[category].splice(index, 1)[0];
          remove.disabled = true;
          try { await saveSettings(); render(); }
          catch (error) { settings[category].splice(index, 0, removed); remove.disabled = false; toast("Tidak berjaya", error.message, "error"); }
        } });
        list.append(create("li", { className: "item" }, [create("span", { text: value }), remove]));
      });
      grid.append(create("section", { className: "panel panel-body" }, [create("h2", { text: labels[category] }), form, list]));
    });
  };
  const staffForm = document.querySelector("#staffForm");
  const staffList = document.querySelector("#staffList");
  const renderStaff = () => {
    staffList.replaceChildren();
    settings.pegawai.forEach((person, index) => {
      const remove = create("button", { type: "button", text: "Padam", onclick: async () => {
        const removed = settings.pegawai.splice(index, 1)[0];
        remove.disabled = true;
        try { await saveSettings(); renderStaff(); }
        catch (error) { settings.pegawai.splice(index, 0, removed); remove.disabled = false; toast("Tidak berjaya", error.message, "error"); }
      } });
      staffList.append(create("li", { className: "item" }, [create("span", { text: `${person.nama} — ${person.sektor}` }), remove]));
    });
  };
  staffForm.addEventListener("submit", async event => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(staffForm));
    const person = { nama: data.nama.trim(), sektor: data.sektor.trim() };
    const button = staffForm.querySelector("button[type=submit]");
    settings.pegawai.push(person);
    setBusy(button, true, "Menyimpan…");
    try { await saveSettings(); staffForm.reset(); renderStaff(); toast("Berjaya", "Pegawai telah ditambah."); }
    catch (error) { settings.pegawai.pop(); toast("Tidak berjaya", error.message, "error"); }
    finally { setBusy(button, false); }
  });
  render();
  renderStaff();
  markReady();
}

async function callAdminFunction(name, payload, retry = true) {
  const response = await fetch(`${config.url}/functions/v1/${name}`, {
    method: "POST",
    headers: {
      apikey: config.publishableKey,
      authorization: `Bearer ${session.access_token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  if (response.status === 401 && retry && await refreshSession()) return callAdminFunction(name, payload, false);
  if (!response.ok) throw await responseError(response, "Operasi pentadbir gagal.");
  return response.json();
}

async function initAdmin() {
  if (!await initShell(true)) return;
  markReady();
  await loadAgencies();
  const form = document.querySelector("#agencyForm");
  const body = document.querySelector("#agencyRows");
  const render = () => {
    body.replaceChildren();
    state.agencies.forEach(agency => {
      const remove = create("button", { className: "button danger small", type: "button", text: "Padam", onclick: async () => {
        if (!confirm(`Padam akaun ${agency.nama}?`)) return;
        setBusy(remove, true, "Memadam…");
        try {
          await callAdminFunction("admin-delete-user", { id: agency.id });
          state.agencies = state.agencies.filter(item => item.id !== agency.id);
          render();
          toast("Berjaya", "Akaun agensi telah dipadam.");
        } catch (error) { toast("Tidak berjaya", `${error.message} Pastikan agensi tidak mempunyai rekod fail.`, "error"); setBusy(remove, false); }
      } });
      body.append(create("tr", {}, [
        create("td", { text: agency.emel }),
        create("td", { text: agency.jenis }),
        create("td", { text: agency.nama }),
        create("td", { text: "Supabase Auth" }),
        create("td", {}, remove)
      ]));
    });
  };
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    const button = form.querySelector("button[type=submit]");
    setBusy(button, true, "Mencipta…");
    try {
      await callAdminFunction("admin-create-user", { email: data.emel.trim().toLowerCase(), password: data.password, name: data.nama.trim(), agencyType: data.jenis });
      await loadAgencies();
      form.reset();
      render();
      toast("Berjaya", "Pengguna agensi telah ditambah ke Supabase.");
    } catch (error) { toast("Tidak berjaya", error.message, "error"); }
    finally { setBusy(button, false); }
  });
  render();
}

function showFatal(error) {
  console.error(error);
  markReady();
  if (document.body.dataset.page === "login") toast("Supabase belum bersambung", error.message, "error");
  else {
    const main = document.querySelector("main");
    if (main) main.prepend(create("p", { className: "notice error", text: `Sistem tidak dapat memuatkan data: ${error.message}` }));
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  renderCachedShell();
  initRevealAnimations();
  document.querySelectorAll(".modal").forEach(wireModal);
  try {
    await loadConfig();
    const page = document.body.dataset.page;
    await ({ login: initLogin, dashboard: initDashboard, register: initRegister, settings: initSettings, admin: initAdmin }[page] || (async () => {}))();
  } catch (error) { showFatal(error); }
});
