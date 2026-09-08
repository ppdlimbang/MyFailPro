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
const classificationKeys = ["fungsi", "aktiviti", "subAktiviti", "transaksi"];
const classificationCollator = new Intl.Collator("ms", { numeric: true, sensitivity: "base" });
const avatarOptions = {
  initials: { label: "Inisial", symbol: "" },
  professional: { label: "Profesional", symbol: "🧑‍💼" },
  man: { label: "Lelaki", symbol: "👨‍💼" },
  woman: { label: "Wanita", symbol: "👩‍💼" },
  technology: { label: "Teknologi", symbol: "🧑‍💻" },
  educator: { label: "Pendidik", symbol: "🧑‍🏫" }
};

function avatarPresentation(key, name) {
  const resolvedKey = Object.hasOwn(avatarOptions, key) ? key : "initials";
  const option = avatarOptions[resolvedKey];
  const initials = String(name || "MP").split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join("").toUpperCase() || "MP";
  return { key: resolvedKey, label: option.label, symbol: option.symbol || initials, emoji: Boolean(option.symbol) };
}

function sortClassificationSettings(settings) {
  classificationKeys.forEach(key => settings[key].sort((first, second) => classificationCollator.compare(first, second)));
  return settings;
}

let config;
let session;
let currentUser;
const state = { files: [], agencies: [], staffUsers: [], staffUsageAvailable: true, staffAvatarsAvailable: true, settings: null };
const workspaceOwnerId = () => currentUser?.ownerId || currentUser?.id;
const SVG_TAGS = new Set(["svg", "path", "circle", "rect", "line", "polyline", "polygon"]);

function create(tag, options = {}, children = []) {
  const node = SVG_TAGS.has(tag)
    ? document.createElementNS("http://www.w3.org/2000/svg", tag)
    : document.createElement(tag);
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

async function recordLoginActivity() {
  try {
    await rpc("record_login_activity", {});
  } catch (error) {
    if (!missingRpc(error, "record_login_activity")) console.warn("Log penggunaan tidak dapat direkodkan.", error);
  }
}

function missingRpc(error, functionName) {
  const message = String(error?.message || "");
  return message.includes("PGRST202") || new RegExp(`Could not find the function public\\.${functionName}\\b`, "i").test(message);
}

async function registerFile(payload) {
  try {
    return await rpc("register_file", payload);
  } catch (error) {
    if (!missingRpc(error, "register_file")) throw error;

    const rows = await rest("files", "", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        owner_id: workspaceOwnerId(),
        function_name: payload.p_function_name,
        activity_name: payload.p_activity_name,
        sub_activity_name: payload.p_sub_activity_name,
        transaction_code: payload.p_transaction_code,
        volume: payload.p_volume,
        opened_on: payload.p_opened_on,
        closed_on: payload.p_closed_on,
        status: "Bilik Fail",
        current_holder: "Bilik Fail"
      })
    });
    const file = rows?.[0];
    if (!file?.id) throw new Error("Rekod fail telah dihantar tetapi pengesahan Supabase tidak diterima.");

    try {
      await rest("movements", "", {
        method: "POST",
        body: JSON.stringify({
          file_id: file.id,
          owner_id: workspaceOwnerId(),
          from_holder: "Sistem Pendaftaran",
          to_holder: "Bilik Fail",
          note: "Rekod asal dicipta"
        })
      });
    } catch (movementError) {
      try { await rest("files", `id=eq.${encodeURIComponent(file.id)}`, { method: "DELETE" }); }
      catch { /* Preserve the original movement error. */ }
      throw movementError;
    }

    return { file };
  }
}

async function moveFile(file, payload) {
  try {
    return await rpc("move_file", payload);
  } catch (error) {
    if (!missingRpc(error, "move_file")) throw error;

    const nextStatus = payload.p_to_holder.toLowerCase() === "bilik fail" ? "Bilik Fail" : "Sedang Beredar";
    const rows = await rest("files", `id=eq.${encodeURIComponent(file.id)}`, {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ current_holder: payload.p_to_holder, status: nextStatus })
    });
    const updatedFile = rows?.[0];
    if (!updatedFile?.id) throw new Error("Pergerakan fail telah dihantar tetapi pengesahan Supabase tidak diterima.");

    try {
      await rest("movements", "", {
        method: "POST",
        body: JSON.stringify({
          file_id: file.id,
          owner_id: file.ownerId,
          moved_at: payload.p_moved_at,
          from_holder: file.pemegangTerkini,
          to_holder: payload.p_to_holder,
          note: payload.p_note || ""
        })
      });
    } catch (movementError) {
      try {
        await rest("files", `id=eq.${encodeURIComponent(file.id)}`, {
          method: "PATCH",
          body: JSON.stringify({ current_holder: file.pemegangTerkini, status: file.status })
        });
      } catch { /* Preserve the original movement error. */ }
      throw movementError;
    }

    return { file: updatedFile };
  }
}

async function deleteFile(file) {
  await rest("files", `id=eq.${encodeURIComponent(file.id)}`, {
    method: "DELETE"
  });
}

async function loadProfile(userId) {
  let rows;
  try {
    rows = await rest("profiles", `id=eq.${encodeURIComponent(userId)}&select=id,email,name,agency_type,role,agency_id,avatar_key`);
  } catch (error) {
    if (!/agency_id|avatar_key/i.test(error.message)) throw error;
    try {
      rows = await rest("profiles", `id=eq.${encodeURIComponent(userId)}&select=id,email,name,agency_type,role,agency_id`);
    } catch (fallbackError) {
      if (!/agency_id/i.test(fallbackError.message)) throw fallbackError;
      rows = await rest("profiles", `id=eq.${encodeURIComponent(userId)}&select=id,email,name,agency_type,role`);
    }
  }
  if (!rows?.length) throw new Error("Profil pengguna tidak ditemui. Jalankan migrasi Supabase dan cipta semula pengguna ini.");
  const profile = rows[0];
  currentUser = {
    id: profile.id,
    ownerId: profile.agency_id || profile.id,
    agencyId: profile.agency_id || null,
    email: profile.email,
    role: profile.role,
    data: { nama: profile.name, jenis: profile.agency_type, avatarKey: profile.avatar_key || "initials" }
  };
  sessionStorage.setItem(PROFILE_KEY, JSON.stringify(currentUser));
  return currentUser;
}

function renderShell(user) {
  if (!user) return;
  const topbarInner = document.querySelector(".topbar-inner");
  const shellUserBox = document.querySelector(".workspace-toolbar .user-box, .topbar-inner > .user-box");
  const shellNavigation = topbarInner?.querySelector(".nav");
  const settingsNavigation = topbarInner?.querySelector(".nav-settings");
  if (shellNavigation && settingsNavigation?.parentElement !== shellNavigation) shellNavigation.append(settingsNavigation);
  if (topbarInner && shellUserBox) {
    shellUserBox.classList.add("topbar-user-box");
    if (shellUserBox.parentElement !== topbarInner) topbarInner.append(shellUserBox);
  }
  document.querySelectorAll("[data-admin]").forEach(el => el.classList.toggle("hidden", user.role !== "admin"));
  const name = document.querySelector("[data-user-name]");
  const role = document.querySelector("[data-user-role]");
  const displayName = user.data?.nama || (user.role === "admin" ? "Pentadbir" : "Agensi");
  const roleLabel = user.role === "admin" ? "Admin PPD" : user.role === "staff" ? "Pegawai Agensi" : (user.data?.jenis || "Agensi");
  if (name) name.textContent = displayName;
  if (role) role.textContent = roleLabel;
  const selectedAvatar = avatarPresentation(user.data?.avatarKey, displayName);
  document.querySelectorAll("[data-user-avatar]").forEach(el => {
    el.textContent = selectedAvatar.symbol;
    el.classList.toggle("avatar-emoji", selectedAvatar.emoji);
    el.dataset.avatar = selectedAvatar.key;
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
  return sortClassificationSettings({
    fungsi: [...(row?.functions || defaults.fungsi)],
    aktiviti: [...(row?.activities || defaults.aktiviti)],
    subAktiviti: [...(row?.sub_activities || defaults.subAktiviti)],
    transaksi: [...(row?.transactions || defaults.transaksi)],
    pegawai: (row?.staff || defaults.pegawai).map(person => ({ ...person }))
  });
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
  let rows = await rest("agency_settings", `owner_id=eq.${encodeURIComponent(workspaceOwnerId())}&select=owner_id,functions,activities,sub_activities,transactions,staff`);
  if (!rows.length) {
    rows = await rest("agency_settings", "", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ owner_id: workspaceOwnerId() })
    });
  }
  state.settings = mapSettings(rows[0]);
  return state.settings;
}

async function saveSettings() {
  await rest("agency_settings", `owner_id=eq.${encodeURIComponent(workspaceOwnerId())}`, {
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

async function loadStaffUsers() {
  if (currentUser.role !== "agency") { state.staffUsers = []; return; }
  const baseQuery = `agency_id=eq.${encodeURIComponent(currentUser.id)}&role=eq.staff`;
  const baseColumns = "id,email,name,created_at";
  let rows;
  state.staffUsageAvailable = true;
  state.staffAvatarsAvailable = true;
  try {
    rows = await rest("profiles", `${baseQuery}&select=${baseColumns},login_count,last_login_at,avatar_key&order=name.asc`);
  } catch (error) {
    if (!/login_count|last_login_at|avatar_key/i.test(error.message)) throw error;
    if (/login_count|last_login_at/i.test(error.message)) state.staffUsageAvailable = false;
    if (/avatar_key/i.test(error.message)) state.staffAvatarsAvailable = false;
    const optionalColumns = [
      ...(state.staffUsageAvailable ? ["login_count", "last_login_at"] : []),
      ...(state.staffAvatarsAvailable ? ["avatar_key"] : [])
    ];
    try {
      rows = await rest("profiles", `${baseQuery}&select=${[baseColumns, ...optionalColumns].join(",")}&order=name.asc`);
    } catch (fallbackError) {
      if (!/login_count|last_login_at|avatar_key/i.test(fallbackError.message)) throw fallbackError;
      if (/login_count|last_login_at/i.test(fallbackError.message)) state.staffUsageAvailable = false;
      if (/avatar_key/i.test(fallbackError.message)) state.staffAvatarsAvailable = false;
      rows = await rest("profiles", `${baseQuery}&select=${baseColumns}&order=name.asc`);
    }
  }
  state.staffUsers = rows.map(row => ({
    id: row.id,
    email: row.email,
    name: row.name,
    createdAt: row.created_at,
    loginCount: Number(row.login_count || 0),
    lastLoginAt: row.last_login_at || null,
    avatarKey: row.avatar_key || "initials"
  }));
}

async function initLogin() {
  const authRedirect = await consumeAuthRedirect();
  const recoveryMode = authRedirect?.type === "recovery";
  if (authRedirect && !recoveryMode) {
    await loadProfile(authRedirect.user.id);
    await recordLoginActivity();
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
      await recordLoginActivity();
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
  const archiveBody = document.querySelector("#archiveRows");
  const search = document.querySelector("#searchFile");
  const archiveSearch = document.querySelector("#searchArchive");
  const filter = document.querySelector("#filterFungsi");
  const pageSize = 6;
  let activePage = 1;
  let archivePage = 1;
  const pagination = {
    active: {
      root: document.querySelector("#filePagination"),
      info: document.querySelector("#filePageInfo"),
      previous: document.querySelector("#filePrevious"),
      next: document.querySelector("#fileNext")
    },
    archive: {
      root: document.querySelector("#archivePagination"),
      info: document.querySelector("#archivePageInfo"),
      previous: document.querySelector("#archivePrevious"),
      next: document.querySelector("#archiveNext")
    }
  };
  fillSelect(filter, state.settings.fungsi, "Semua fungsi");
  const compareByTransaction = (first, second) =>
    classificationCollator.compare(first.transaksi || "", second.transaksi || "") ||
    Number(first.jilid || 0) - Number(second.jilid || 0) ||
    String(first.tarikhBuka || "").localeCompare(String(second.tarikhBuka || ""));
  const matchesSearch = (file, term) => {
    const haystack = [file.transaksi, file.subAktiviti, file.pemegangTerkini].filter(Boolean).join(" ").toLowerCase();
    return haystack.includes(term);
  };
  const pagedRecords = (records, requestedPage, controls) => {
    const pageCount = Math.max(1, Math.ceil(records.length / pageSize));
    const page = Math.min(Math.max(requestedPage, 1), pageCount);
    const start = (page - 1) * pageSize;
    const end = Math.min(start + pageSize, records.length);
    controls.root.classList.toggle("hidden", records.length <= pageSize);
    controls.info.textContent = records.length ? `${start + 1}–${end} daripada ${records.length} rekod` : "0 rekod";
    controls.previous.disabled = page === 1;
    controls.next.disabled = page === pageCount;
    return { page, records: records.slice(start, end) };
  };
  const updateStats = () => {
    document.querySelector("#statTotal").textContent = state.files.length;
    document.querySelector("#statArchive").textContent = state.files.filter(f => f.pemegangTerkini === "Bilik Fail").length;
    document.querySelector("#statMoving").textContent = state.files.filter(f => f.pemegangTerkini !== "Bilik Fail").length;
  };
  const deleteAction = (file, refresh) => create("button", {
    className: "icon-button delete-file-button",
    type: "button",
    title: "Padam fail",
    "aria-label": `Padam fail ${file.transaksi}, Jilid ${file.jilid}`,
    onclick: () => openDelete(file, refresh)
  }, create("svg", { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": "1.8", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" }, [
    create("path", { d: "M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5" })
  ]));
  const render = () => {
    updateStats();
    const term = search.value.trim().toLowerCase();
    const archiveTerm = archiveSearch.value.trim().toLowerCase();
    const selected = filter.value;
    const totalArchived = state.files.filter(file => Boolean(file.tarikhTutup)).length;
    const activeFiles = state.files
      .filter(file => !file.tarikhTutup && matchesSearch(file, term) && (!selected || file.fungsi === selected))
      .sort(compareByTransaction);
    const archivedFiles = state.files
      .filter(file => Boolean(file.tarikhTutup) && matchesSearch(file, archiveTerm))
      .sort(compareByTransaction);
    const activeResult = pagedRecords(activeFiles, activePage, pagination.active);
    const archiveResult = pagedRecords(archivedFiles, archivePage, pagination.archive);
    activePage = activeResult.page;
    archivePage = archiveResult.page;
    body.replaceChildren();
    archiveBody.replaceChildren();
    document.querySelector("#emptyFiles").classList.toggle("hidden", activeFiles.length > 0);
    document.querySelector("#emptyArchive").classList.toggle("hidden", archivedFiles.length > 0);
    document.querySelector("#archiveCount").textContent = archiveTerm
      ? `${archivedFiles.length} daripada ${totalArchived} rekod`
      : `${totalArchived} rekod`;
    document.querySelector("#emptyArchiveTitle").textContent = archiveTerm ? "Tiada arkib ditemui" : "Belum ada fail ditutup";
    document.querySelector("#emptyArchiveCopy").textContent = archiveTerm
      ? "Ubah kata carian untuk melihat rekod arkib lain."
      : "Fail akan dipindahkan ke arkib secara automatik apabila Tarikh Tutup diisi.";
    activeResult.records.forEach(file => {
      const archive = file.pemegangTerkini.toLowerCase() === "bilik fail";
      const buttons = create("div", { className: "actions" }, [
        create("button", { className: "button small", type: "button", text: "Pindah", onclick: () => openMovement(file, render) }),
        create("button", { className: "button secondary small", type: "button", text: "Edit", onclick: () => openEdit(file, render) }),
        create("button", { className: "button secondary small", type: "button", text: "Log", onclick: () => openHistory(file) }),
        deleteAction(file, render)
      ]);
      body.append(create("tr", {}, [
        create("td", {}, [create("div", { className: "record-title", text: file.transaksi }), create("div", { className: "record-meta", text: `Jilid ${file.jilid} · ${file.subAktiviti}` })]),
        create("td", { text: `${formatDate(file.tarikhBuka)} — ${file.tarikhTutup ? formatDate(file.tarikhTutup) : "Aktif"}` }),
        create("td", {}, create("span", { className: `badge ${archive ? "archive" : "moving"}`, text: file.pemegangTerkini })),
        create("td", {}, buttons)
      ]));
    });
    archiveResult.records.forEach(file => {
      const archive = file.pemegangTerkini.toLowerCase() === "bilik fail";
      const buttons = create("div", { className: "actions" }, [
        create("button", { className: "button secondary small", type: "button", text: "Edit", title: "Ubah tarikh atau buka semula fail", onclick: () => openEdit(file, render) }),
        create("button", { className: "button secondary small", type: "button", text: "Log", onclick: () => openHistory(file) }),
        deleteAction(file, render)
      ]);
      archiveBody.append(create("tr", {}, [
        create("td", {}, [create("div", { className: "record-title", text: file.transaksi }), create("div", { className: "record-meta", text: `Jilid ${file.jilid} · ${file.subAktiviti}` })]),
        create("td", { text: `${formatDate(file.tarikhBuka)} — ${formatDate(file.tarikhTutup)}` }),
        create("td", {}, create("span", { className: `badge ${archive ? "archive" : "moving"}`, text: file.pemegangTerkini })),
        create("td", {}, buttons)
      ]));
    });
  };
  search.addEventListener("input", () => { activePage = 1; render(); });
  archiveSearch.addEventListener("input", () => { archivePage = 1; render(); });
  filter.addEventListener("change", () => { activePage = 1; render(); });
  pagination.active.previous.addEventListener("click", () => { activePage -= 1; render(); });
  pagination.active.next.addEventListener("click", () => { activePage += 1; render(); });
  pagination.archive.previous.addEventListener("click", () => { archivePage -= 1; render(); });
  pagination.archive.next.addEventListener("click", () => { archivePage += 1; render(); });
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
      const result = await moveFile(file, {
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

function openDelete(file, refresh) {
  const modal = document.querySelector("#deleteModal");
  const confirmButton = modal.querySelector("[data-confirm-delete]");
  modal.querySelector("[data-file-reference]").textContent = `${file.transaksi} (Jilid ${file.jilid})`;
  confirmButton.onclick = async () => {
    confirmButton.disabled = true;
    confirmButton.textContent = "Memadam…";
    try {
      await deleteFile(file);
      state.files = state.files.filter(item => item.id !== file.id);
      closeModal(modal);
      refresh();
      toast("Fail dipadam", `${file.transaksi}, Jilid ${file.jilid} telah dipadam bersama log pergerakannya.`);
    } catch (error) {
      toast("Fail tidak dapat dipadam", error.message, "error");
    } finally {
      confirmButton.disabled = false;
      confirmButton.textContent = "Ya, Padam Fail";
    }
  };
  showModal("#deleteModal");
  confirmButton.focus();
}

async function initRegister() {
  if (!await initShell()) return;
  await Promise.all([loadSettings(), loadFiles()]);
  const settings = state.settings;
  const form = document.querySelector("#registerFile");
  const duplicateStatus = document.querySelector("#duplicateStatus");
  const ids = ["fungsi", "aktiviti", "subAktiviti", "transaksi"];
  const findDuplicate = data => {
    const transaction = String(data.transaksi || "").trim().toLowerCase();
    const volume = Number(data.jilid);
    if (!transaction || !Number.isInteger(volume) || volume < 1) return null;
    return state.files.find(file => file.ownerId === workspaceOwnerId() && file.transaksi.trim().toLowerCase() === transaction && Number(file.jilid) === volume) || null;
  };
  const updateDuplicateStatus = () => {
    const data = Object.fromEntries(new FormData(form));
    const duplicate = findDuplicate(data);
    const ready = data.transaksi && Number(data.jilid) > 0;
    duplicateStatus.className = `duplicate-status ${duplicate ? "is-duplicate" : ready ? "is-available" : "is-idle"}`;
    duplicateStatus.textContent = duplicate
      ? `Rekod sama telah wujud: ${duplicate.transaksi}, Jilid ${duplicate.jilid}. Sila semak Senarai Fail atau gunakan nombor jilid lain.`
      : ready
        ? "Tiada rekod sama ditemui. Kod transaksi dan nombor jilid ini boleh digunakan."
        : "Pilih Transaksi Fail dan Nombor Jilid untuk menyemak rekod pendua.";
    return duplicate;
  };
  ids.forEach(id => fillSelect(form.elements[id], settings[id] || []));
  form.elements.fungsi.addEventListener("change", () => fillSelect(form.elements.aktiviti, settings.aktiviti.filter(v => v.startsWith(form.elements.fungsi.value.split(" ")[0]))));
  form.elements.aktiviti.addEventListener("change", () => fillSelect(form.elements.subAktiviti, settings.subAktiviti.filter(v => v.startsWith(form.elements.aktiviti.value.split(" ")[0]))));
  form.elements.subAktiviti.addEventListener("change", () => { fillSelect(form.elements.transaksi, settings.transaksi.filter(v => v.startsWith(form.elements.subAktiviti.value.split(" ")[0]))); updateDuplicateStatus(); });
  form.elements.transaksi.addEventListener("change", updateDuplicateStatus);
  form.elements.jilid.addEventListener("input", updateDuplicateStatus);
  form.addEventListener("reset", () => setTimeout(() => { ids.forEach(id => fillSelect(form.elements[id], id === "fungsi" ? settings.fungsi : [])); form.elements.jilid.value = 1; updateDuplicateStatus(); }, 0));
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    if (!validDateRange(data.tarikhBuka, data.tarikhTutup)) { toast("Tarikh tidak sah", "Tarikh tutup tidak boleh mendahului tarikh buka.", "error"); return; }
    if (findDuplicate(data)) {
      updateDuplicateStatus();
      toast("Rekod telah wujud", `Fail ${data.transaksi}, Jilid ${data.jilid} telah didaftarkan.`, "error");
      return;
    }
    const button = form.querySelector("button[type=submit]");
    setBusy(button, true, "Menyimpan…");
    try {
      await registerFile({
        p_function_name: data.fungsi,
        p_activity_name: data.aktiviti,
        p_sub_activity_name: data.subAktiviti,
        p_transaction_code: data.transaksi,
        p_volume: Number(data.jilid),
        p_opened_on: data.tarikhBuka,
        p_closed_on: data.tarikhTutup || null
      });
      await loadFiles();
      form.reset();
      toast("Pendaftaran berjaya", "Fail baharu telah disimpan ke Supabase.");
    } catch (error) {
      const duplicate = /duplicate|unique_agency_file_volume/i.test(error.message);
      if (duplicate) {
        await loadFiles().catch(() => {});
        updateDuplicateStatus();
      }
      toast(duplicate ? "Rekod telah wujud" : "Pendaftaran gagal", duplicate ? `Fail ${data.transaksi}, Jilid ${data.jilid} telah didaftarkan.` : error.message, "error");
    } finally { setBusy(button, false); }
  });
  updateDuplicateStatus();
  markReady();
}

const labels = { fungsi: "Fungsi", aktiviti: "Aktiviti", subAktiviti: "Sub-Aktiviti", transaksi: "Transaksi Fail" };

async function initSettings() {
  const user = await initShell();
  if (!user) return;
  await loadSettings();
  const settings = state.settings;
  const normalizeSettingValue = value => String(value || "").trim().replace(/\s+/g, " ").toLocaleLowerCase("ms");
  const isAgencyOwner = user.role === "agency";
  const isAgencyMember = isAgencyOwner || user.role === "staff";
  let staffUsersError = null;
  if (isAgencyOwner) {
    try { await loadStaffUsers(); }
    catch (error) { staffUsersError = error; }
  }
  if (isAgencyMember) {
    document.querySelector("#settingsTitle").textContent = "Tetapan Agensi";
    document.querySelector("#settingsSubtitle").textContent = `Konfigurasi khusus untuk ${user.data.nama || user.email}`;
    document.querySelector("#settingsScope").textContent = "Semua perubahan di halaman ini hanya digunakan oleh agensi anda dan tidak mengubah data agensi lain.";
  } else {
    document.querySelector("#settingsScope").textContent = "Tetapan ini dimiliki oleh akaun pentadbir dan diasingkan daripada tetapan setiap agensi.";
  }
  const grid = document.querySelector("#settingsGrid");
  const fileColumns = {
    fungsi: "function_name",
    aktiviti: "activity_name",
    subAktiviti: "sub_activity_name",
    transaksi: "transaction_code"
  };
  const updateFileReferences = async (column, oldValue, newValue) => {
    if (!column || oldValue === newValue) return;
    await rest("files", `owner_id=eq.${encodeURIComponent(workspaceOwnerId())}&${column}=eq.${encodeURIComponent(oldValue)}`, {
      method: "PATCH",
      body: JSON.stringify({ [column]: newValue })
    });
  };
  const saveCategoryEdit = async (category, index, value) => {
    const previousValues = [...settings[category]];
    const previous = settings[category][index];
    settings[category][index] = value;
    settings[category].sort((first, second) => classificationCollator.compare(first, second));
    let referencesUpdated = false;
    try {
      await updateFileReferences(fileColumns[category], previous, value);
      referencesUpdated = previous !== value;
      await saveSettings();
    } catch (error) {
      settings[category] = previousValues;
      if (referencesUpdated) {
        try { await updateFileReferences(fileColumns[category], value, previous); }
        catch { /* Preserve the original save error. */ }
      }
      throw error;
    }
  };
  const saveStaffEdit = async (index, person) => {
    const previous = { ...settings.pegawai[index] };
    settings.pegawai[index] = person;
    let holdersUpdated = false;
    try {
      await updateFileReferences("current_holder", previous.nama, person.nama);
      holdersUpdated = previous.nama !== person.nama;
      await saveSettings();
    } catch (error) {
      settings.pegawai[index] = previous;
      if (holdersUpdated) {
        try { await updateFileReferences("current_holder", person.nama, previous.nama); }
        catch { /* Preserve the original save error. */ }
      }
      throw error;
    }
  };
  const render = () => {
    grid.replaceChildren();
    Object.keys(labels).forEach(category => {
      const input = create("input", { className: "input", placeholder: "Tambah pilihan…", "aria-label": `Tambah ${labels[category]}` });
      const add = create("button", { className: "button", type: "submit", text: "Tambah" });
      const form = create("form", { className: "inline-form" }, [input, add]);
      form.addEventListener("submit", async event => {
        event.preventDefault();
        const value = input.value.trim();
        if (!value) {
          toast("Nilai diperlukan", `${labels[category]} tidak boleh kosong.`, "error");
          input.focus();
          return;
        }
        const duplicate = settings[category].some(entry => normalizeSettingValue(entry) === normalizeSettingValue(value));
        if (duplicate) {
          toast("Data telah wujud", `${labels[category]} “${value}” sudah disenaraikan.`, "error");
          input.focus();
          input.select();
          return;
        }
        const previousValues = [...settings[category]];
        settings[category].push(value);
        settings[category].sort((first, second) => classificationCollator.compare(first, second));
        setBusy(add, true, "Menyimpan…");
        try { await saveSettings(); render(); toast("Berjaya", `${labels[category]} telah ditambah.`); }
        catch (error) { settings[category] = previousValues; toast("Tidak berjaya", error.message, "error"); }
        finally { setBusy(add, false); }
      });
      const totalRecords = settings[category].length;
      const count = create("span", { className: "settings-count", text: `${totalRecords} rekod`, "aria-live": "polite" });
      const cardHead = create("div", { className: "settings-card-head" }, [create("h2", { text: labels[category] }), count]);
      const search = create("input", {
        className: "input settings-search",
        type: "search",
        placeholder: `Cari ${labels[category].toLocaleLowerCase("ms")}…`,
        "aria-label": `Cari ${labels[category]}`
      });
      const list = create("ul", { className: "item-list" });
      const emptySearch = create("p", { className: "settings-empty", text: totalRecords ? "Tiada data sepadan dengan carian." : "Belum ada data dalam kategori ini." });
      emptySearch.hidden = totalRecords > 0;
      list.hidden = totalRecords === 0;
      settings[category].forEach((value, index) => {
        const item = create("li", { className: "item", "data-search": normalizeSettingValue(value) });
        const edit = create("button", { type: "button", text: "Edit", "aria-label": `Edit ${value}`, onclick: () => {
          const editInput = create("input", { className: "input item-edit-input", value, "aria-label": `Nilai baharu untuk ${labels[category]}` });
          const save = create("button", { className: "item-save", type: "submit", text: "Simpan" });
          const cancel = create("button", { className: "item-cancel", type: "button", text: "Batal", onclick: render });
          const editForm = create("form", { className: "item-edit-form" }, [
            editInput,
            create("div", { className: "item-edit-actions" }, [save, cancel])
          ]);
          editForm.addEventListener("submit", async event => {
            event.preventDefault();
            const nextValue = editInput.value.trim();
            const duplicate = settings[category].some((entry, entryIndex) => entryIndex !== index && normalizeSettingValue(entry) === normalizeSettingValue(nextValue));
            if (!nextValue) { toast("Nilai diperlukan", `${labels[category]} tidak boleh kosong.`, "error"); editInput.focus(); return; }
            if (duplicate) { toast("Data telah wujud", `${labels[category]} yang sama sudah disenaraikan.`, "error"); editInput.focus(); editInput.select(); return; }
            setBusy(save, true, "Menyimpan…");
            try {
              await saveCategoryEdit(category, index, nextValue);
              render();
              toast("Perubahan disimpan", `${labels[category]} telah dikemas kini.`);
            } catch (error) {
              toast("Tidak berjaya", error.message, "error");
              setBusy(save, false);
            }
          });
          item.replaceChildren(editForm);
          editInput.focus();
          editInput.select();
        } });
        const remove = create("button", { type: "button", text: "Padam", "aria-label": `Padam ${value}`, onclick: async () => {
          const removed = settings[category].splice(index, 1)[0];
          remove.disabled = true;
          try { await saveSettings(); render(); }
          catch (error) { settings[category].splice(index, 0, removed); remove.disabled = false; toast("Tidak berjaya", error.message, "error"); }
        } });
        item.append(create("span", { text: value, title: value }), create("div", { className: "item-actions" }, [edit, remove]));
        list.append(item);
      });
      search.addEventListener("input", () => {
        const query = normalizeSettingValue(search.value);
        let visibleRecords = 0;
        Array.from(list.children).forEach(item => {
          const matches = !query || item.dataset.search.includes(query);
          item.hidden = !matches;
          if (matches) visibleRecords += 1;
        });
        count.textContent = query ? `${visibleRecords} daripada ${totalRecords}` : `${totalRecords} rekod`;
        list.hidden = visibleRecords === 0;
        emptySearch.hidden = visibleRecords > 0;
      });
      grid.append(create("section", { className: "panel panel-body settings-card" }, [cardHead, form, search, emptySearch, list]));
    });
  };
  const staffForm = document.querySelector("#staffForm");
  const staffList = document.querySelector("#staffList");
  const renderStaff = () => {
    staffList.replaceChildren();
    settings.pegawai.forEach((person, index) => {
      const item = create("li", { className: "item staff-item" });
      const edit = create("button", { type: "button", text: "Edit", "aria-label": `Edit ${person.nama}`, onclick: () => {
        const nameInput = create("input", { className: "input", value: person.nama, placeholder: "Nama penuh", "aria-label": "Nama penuh" });
        const sectorInput = create("input", { className: "input", value: person.sektor, placeholder: "Sektor atau unit", "aria-label": "Sektor atau unit" });
        const save = create("button", { className: "item-save", type: "submit", text: "Simpan" });
        const cancel = create("button", { className: "item-cancel", type: "button", text: "Batal", onclick: renderStaff });
        const editForm = create("form", { className: "item-edit-form staff-edit-form" }, [
          create("div", { className: "staff-edit-fields" }, [nameInput, sectorInput]),
          create("div", { className: "item-edit-actions" }, [save, cancel])
        ]);
        editForm.addEventListener("submit", async event => {
          event.preventDefault();
          const nextPerson = { nama: nameInput.value.trim(), sektor: sectorInput.value.trim() };
          if (!nextPerson.nama || !nextPerson.sektor) { toast("Maklumat diperlukan", "Nama dan sektor pegawai perlu diisi.", "error"); return; }
          const duplicate = settings.pegawai.some((entry, entryIndex) => entryIndex !== index
            && normalizeSettingValue(entry.nama) === normalizeSettingValue(nextPerson.nama)
            && normalizeSettingValue(entry.sektor) === normalizeSettingValue(nextPerson.sektor));
          if (duplicate) {
            toast("Data telah wujud", `${nextPerson.nama} bagi ${nextPerson.sektor} sudah disenaraikan.`, "error");
            nameInput.focus();
            nameInput.select();
            return;
          }
          setBusy(save, true, "Menyimpan…");
          try {
            await saveStaffEdit(index, nextPerson);
            renderStaff();
            toast("Perubahan disimpan", "Maklumat pegawai telah dikemas kini.");
          } catch (error) {
            toast("Tidak berjaya", error.message, "error");
            setBusy(save, false);
          }
        });
        item.replaceChildren(editForm);
        nameInput.focus();
        nameInput.select();
      } });
      const remove = create("button", { type: "button", text: "Padam", onclick: async () => {
        const removed = settings.pegawai.splice(index, 1)[0];
        remove.disabled = true;
        try { await saveSettings(); renderStaff(); }
        catch (error) { settings.pegawai.splice(index, 0, removed); remove.disabled = false; toast("Tidak berjaya", error.message, "error"); }
      } });
      item.append(create("span", { text: `${person.nama} — ${person.sektor}` }), create("div", { className: "item-actions" }, [edit, remove]));
      staffList.append(item);
    });
  };
  staffForm.addEventListener("submit", async event => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(staffForm));
    const person = { nama: data.nama.trim(), sektor: data.sektor.trim() };
    const button = staffForm.querySelector("button[type=submit]");
    if (!person.nama || !person.sektor) {
      toast("Maklumat diperlukan", "Nama dan sektor pegawai perlu diisi.", "error");
      return;
    }
    const duplicate = settings.pegawai.some(entry => normalizeSettingValue(entry.nama) === normalizeSettingValue(person.nama)
      && normalizeSettingValue(entry.sektor) === normalizeSettingValue(person.sektor));
    if (duplicate) {
      toast("Data telah wujud", `${person.nama} bagi ${person.sektor} sudah disenaraikan.`, "error");
      staffForm.elements.nama.focus();
      staffForm.elements.nama.select();
      return;
    }
    settings.pegawai.push(person);
    setBusy(button, true, "Menyimpan…");
    try { await saveSettings(); staffForm.reset(); renderStaff(); toast("Berjaya", "Pegawai telah ditambah."); }
    catch (error) { settings.pegawai.pop(); toast("Tidak berjaya", error.message, "error"); }
    finally { setBusy(button, false); }
  });
  const staffUsersPanel = document.querySelector("#staffUsersPanel");
  if (isAgencyOwner && staffUsersPanel) {
    staffUsersPanel.classList.remove("hidden");
    const accountForm = document.querySelector("#staffUserForm");
    const accountRows = document.querySelector("#staffUserRows");
    const accountStatus = document.querySelector("#staffUserStatus");
    const accountNameInput = accountForm.elements.nama;
    const avatarPreviews = accountForm.querySelectorAll("[data-avatar-preview]");
    const updateAvatarPreviews = () => avatarPreviews.forEach(preview => {
      const avatar = avatarPresentation(preview.dataset.avatarPreview, accountNameInput.value);
      preview.textContent = avatar.symbol;
    });
    accountNameInput.addEventListener("input", updateAvatarPreviews);
    updateAvatarPreviews();
    const editAccountModal = document.querySelector("#staffAccountEditModal");
    const openStaffAccountEditor = person => {
      const reference = editAccountModal.querySelector("[data-staff-reference]");
      const passwordInput = editAccountModal.elements.password;
      const selectedAvatar = editAccountModal.querySelector(`input[name=avatar][value="${person.avatarKey}"]`)
        || editAccountModal.querySelector("input[name=avatar][value=initials]");
      editAccountModal.querySelector("input[name=avatar][value=initials] + .avatar-choice").textContent = avatarPresentation("initials", person.name).symbol;
      reference.textContent = `${person.name} · ${person.email}`;
      passwordInput.value = "";
      selectedAvatar.checked = true;
      editAccountModal.onsubmit = async event => {
        event.preventDefault();
        const data = Object.fromEntries(new FormData(editAccountModal));
        const button = editAccountModal.querySelector("button[type=submit]");
        setBusy(button, true, "Menyimpan…");
        try {
          await callAdminFunction("agency-update-staff", {
            id: person.id,
            password: data.password,
            avatar: data.avatar
          });
          await loadStaffUsers();
          closeModal(editAccountModal);
          renderStaffUsers();
          toast("Akaun dikemas kini", data.password ? "Avatar dan kata laluan pegawai telah ditukar." : "Avatar pegawai telah ditukar.");
        } catch (error) {
          toast("Akaun tidak dapat dikemas kini", error.message, "error");
        } finally { setBusy(button, false); }
      };
      showModal("#staffAccountEditModal");
      selectedAvatar.focus();
    };
    const renderStaffUsers = () => {
      accountRows.replaceChildren();
      if (!state.staffUsers.length) {
        accountRows.append(create("tr", {}, create("td", { colspan: "5", className: "empty-row", text: "Belum ada akaun pengguna pegawai." })));
        return;
      }
      state.staffUsers.forEach(person => {
        const avatar = avatarPresentation(person.avatarKey, person.name);
        accountRows.append(create("tr", {}, [
        create("td", {}, create("div", { className: "staff-user-identity" }, [
          create("span", { className: `staff-avatar${avatar.emoji ? " avatar-emoji" : ""}`, text: avatar.symbol, title: avatar.label, "aria-hidden": "true" }),
          create("span", { text: person.name })
        ])),
        create("td", { text: person.email }),
        create("td", {}, create("span", { className: "badge archive", text: "Aktif" })),
        create("td", {}, create("div", { className: "staff-usage-log" }, [
          create("strong", { text: state.staffUsageAvailable ? `${person.loginCount} kali log masuk` : "Belum tersedia" }),
          create("span", { text: state.staffUsageAvailable && person.lastLoginAt ? `Terakhir: ${formatDate(person.lastLoginAt, true)}` : "Tiada rekod penggunaan" })
        ])),
        create("td", { className: "staff-account-actions" }, create("button", { className: "button secondary small staff-account-edit", type: "button", text: "Edit", "aria-label": `Edit akaun ${person.name}`, onclick: () => openStaffAccountEditor(person) }))
        ]));
      });
    };
    if (staffUsersError) {
      accountStatus.classList.remove("hidden");
      accountStatus.textContent = /agency_id/i.test(staffUsersError.message)
        ? "Modul pengguna pegawai memerlukan migrasi Supabase 20260907030000_add_agency_staff_users.sql."
        : `Akaun pegawai tidak dapat dimuatkan: ${staffUsersError.message}`;
      Array.from(accountForm.elements).forEach(element => { element.disabled = true; });
    } else {
      const unavailableFeatures = [];
      if (!state.staffUsageAvailable) {
        unavailableFeatures.push("log penggunaan: 20260907050000_add_staff_login_activity.sql");
      }
      if (!state.staffAvatarsAvailable) {
        unavailableFeatures.push("pilihan avatar: 20260907060000_add_staff_avatar.sql");
      }
      if (unavailableFeatures.length) {
        accountStatus.classList.remove("hidden");
        accountStatus.textContent = `Ciri tambahan memerlukan migrasi Supabase (${unavailableFeatures.join("; ")}).`;
      }
      accountForm.addEventListener("submit", async event => {
        event.preventDefault();
        const data = Object.fromEntries(new FormData(accountForm));
        const button = accountForm.querySelector("button[type=submit]");
        setBusy(button, true, "Mencipta…");
        try {
          await callAdminFunction("agency-create-staff", {
            name: data.nama.trim(),
            email: data.emel.trim().toLowerCase(),
            password: data.password,
            avatar: data.avatar
          });
          await loadStaffUsers();
          accountForm.reset();
          updateAvatarPreviews();
          renderStaffUsers();
          toast("Akaun berjaya dicipta", "Pegawai kini boleh log masuk menggunakan e-mel dan kata laluan yang didaftarkan.");
        } catch (error) {
          toast("Akaun tidak dapat dicipta", error.message, "error");
        } finally { setBusy(button, false); }
      });
      renderStaffUsers();
    }
  }
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
