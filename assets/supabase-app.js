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
const state = {
  files: [],
  pedFileLetterNumbers: new Map(),
  lastMovementDates: new Map(),
  agencies: [],
  staffUsers: [],
  recipientUsers: [],
  notifications: [],
  notificationsAvailable: true,
  staffUsageAvailable: true,
  staffAvatarsAvailable: true,
  pedRecords: [],
  settings: null
};
const workspaceOwnerId = () => currentUser?.ownerId || currentUser?.id;
const SVG_TAGS = new Set(["svg", "path", "circle", "rect", "line", "polyline", "polygon"]);

function create(tag, options = {}, children = []) {
  const node = SVG_TAGS.has(tag)
    ? document.createElementNS("http://www.w3.org/2000/svg", tag)
    : document.createElement(tag);
  Object.entries(options).forEach(([key, value]) => {
    if (key === "className") {
      if (SVG_TAGS.has(tag)) node.setAttribute("class", value);
      else node.className = value;
    }
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

async function correctMovement(record, values) {
  return rpc("correct_file_movement", {
    p_movement_id: record.id,
    p_from_holder: values.from,
    p_to_holder: values.to,
    p_moved_at: values.movedAt,
    p_note: values.note
  });
}

async function pedAssignmentReturnContext(file, previousRecipient = "") {
  const columns = "id,file_id,owner_id,moved_at,from_holder,to_holder,note";
  const rows = await rest("movements", `file_id=eq.${encodeURIComponent(file.id)}&select=${columns}&order=moved_at.desc,created_at.desc&limit=1000`);
  const history = rows.map(mapMovement);
  const isAssignment = movement => /^Penugasan melalui PeD\s*:/i.test(movement.catatan || "");
  const isReturn = movement => /^Pemulangan selepas penugasan PeD\s*:/i.test(movement.catatan || "");
  const matchesRecipient = movement => normalizeRecipientName(movement.kepada) === normalizeRecipientName(previousRecipient);
  const latestReturn = isReturn(history[0] || {}) ? history[0] : null;
  let assignmentMovement = null;

  if (latestReturn) {
    const earlierHistory = history.slice(1);
    assignmentMovement = earlierHistory.find(movement => isAssignment(movement) && (!previousRecipient || matchesRecipient(movement)))
      || earlierHistory.find(isAssignment)
      || earlierHistory[0]
      || null;
  } else if (previousRecipient) {
    assignmentMovement = history.find(movement => isAssignment(movement) && matchesRecipient(movement))
      || history.find(matchesRecipient)
      || null;
  } else {
    assignmentMovement = history.find(isAssignment) || null;
  }

  const previousHolder = String(assignmentMovement?.dari || "").trim();
  return {
    previousHolder,
    correctionMovement: latestReturn && previousHolder ? latestReturn : null
  };
}

async function deleteMovement(record) {
  return rpc("delete_file_movement", { p_movement_id: record.id });
}

async function loadProfile(userId) {
  let rows;
  try {
    rows = await rest("profiles", `id=eq.${encodeURIComponent(userId)}&select=id,email,name,agency_type,role,agency_id,avatar_key,ped_office_id`);
  } catch (error) {
    if (!/agency_id|avatar_key|ped_office_id/i.test(error.message)) throw error;
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
    data: {
      nama: profile.name,
      jenis: profile.agency_type,
      avatarKey: profile.avatar_key || "initials",
      pedOfficeId: profile.ped_office_id || null
    }
  };
  sessionStorage.setItem(PROFILE_KEY, JSON.stringify(currentUser));
  return currentUser;
}

function renderShell(user) {
  if (!user) return;
  const topbarInner = document.querySelector(".topbar-inner");
  const shellUserBox = document.querySelector(".workspace-toolbar .user-box, .topbar-inner > .user-box");
  const shellNotificationButton = document.querySelector(".workspace-toolbar .notification-button, .topbar-inner .notification-button");
  const shellNavigation = topbarInner?.querySelector(".nav");
  const settingsNavigation = topbarInner?.querySelector(".nav-settings");
  if (shellNavigation && settingsNavigation?.parentElement !== shellNavigation) shellNavigation.append(settingsNavigation);
  const adminNavigation = shellNavigation?.querySelector('a[href="admin.html"]');
  if (adminNavigation) adminNavigation.classList.toggle("hidden", user.role !== "admin");
  let pedNavigation = shellNavigation?.querySelector('[data-ped-nav], a[href^="ped.html"]');
  if (shellNavigation && !pedNavigation) {
    pedNavigation = create("a", { href: "ped.html", "data-ped-nav": "" }, [
      create("span", { className: "nav-icon", "aria-hidden": "true" }, create("svg", { viewBox: "0 0 24 24" }, [
        create("path", { d: "M5 3h14v18H5Z" }),
        create("path", { d: "M8 7h8M8 11h8M8 15h5" })
      ])),
      create("span", { text: "PeD" })
    ]);
    shellNavigation.insertBefore(pedNavigation, settingsNavigation || null);
  }
  // Keep the PeD entry point aligned with the current role-aware workflow.
  if (pedNavigation) pedNavigation.setAttribute("href", "ped.html?v=20261110-01");
  if (pedNavigation && document.body.dataset.page === "ped") pedNavigation.setAttribute("aria-current", "page");
  if (topbarInner && shellUserBox) {
    shellUserBox.classList.add("topbar-user-box");
    if (shellUserBox.parentElement !== topbarInner) topbarInner.append(shellUserBox);
  }
  if (shellUserBox && shellNotificationButton) {
    shellNotificationButton.classList.add("topbar-notification-button");
    if (shellNotificationButton.parentElement !== shellUserBox) shellUserBox.insertBefore(shellNotificationButton, shellUserBox.firstChild);
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
    el.removeAttribute("aria-hidden");
    el.setAttribute("role", "img");
    el.setAttribute("aria-label", `${displayName}, ${roleLabel}`);
  });
  const date = document.querySelector("[data-current-date]");
  if (date) date.textContent = new Intl.DateTimeFormat("ms-MY", { dateStyle: "full" }).format(new Date());
}

function renderCachedShell() {
  try {
    const cachedSession = readSession();
    const cached = JSON.parse(sessionStorage.getItem(PROFILE_KEY));
    const sessionUserId = cachedSession?.user?.id;
    if (cached?.id && cached?.role && cachedSession?.access_token && sessionUserId === cached.id) {
      session = cachedSession;
      currentUser = cached;
      renderShell(cached);
    }
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
  if (!user) {
    saveSession(null);
    location.replace("MyFailPro.html");
    return null;
  }
  if (adminOnly && user.role !== "admin") {
    location.replace("dashboard.html");
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
  void initNotifications().catch(error => console.warn("Notifikasi tidak dapat dimulakan.", error));
  return user;
}

function fillSelect(select, values, prompt = "Pilih parameter…") {
  select.replaceChildren(create("option", { value: "", text: prompt }));
  values.forEach(value => select.append(create("option", { value, text: value })));
}

function formatPersonName(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("ms-MY")
    .replace(/(^|[\s@'’/-])(\p{L})/gu, (_match, prefix, letter) => `${prefix}${letter.toLocaleUpperCase("ms-MY")}`);
}

function normalizeRecipientName(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toLocaleLowerCase("ms");
}

function uniqueRecipientNames(values) {
  const seen = new Set();
  return values.reduce((names, value) => {
    const cleanName = String(value || "").trim().replace(/\s+/g, " ");
    const normalizedName = normalizeRecipientName(cleanName);
    if (!normalizedName || seen.has(normalizedName)) return names;
    seen.add(normalizedName);
    names.push(cleanName);
    return names;
  }, []);
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
    // Translating table rows creates overflow inside the PeD table scroller.
    if (document.body.dataset.page === "ped" && element.matches("tbody tr")) return;
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
    pegawai: (row?.staff || defaults.pegawai).map(person => ({ ...person, nama: formatPersonName(person.nama) }))
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
  return {
    id: row.id,
    idFail: row.file_id,
    ownerId: row.owner_id,
    tarikh: row.moved_at,
    dari: row.from_holder,
    kepada: row.to_holder,
    catatan: row.note,
    penggunaId: row.performed_by || null,
    penggunaNama: row.performed_by_name || "",
    penggunaEmel: row.performed_by_email || ""
  };
}

async function loadFiles() {
  const columns = "id,owner_id,function_name,activity_name,sub_activity_name,transaction_code,volume,opened_on,closed_on,status,current_holder,created_at";
  const rows = await rest("files", `select=${columns}&order=transaction_code.asc,volume.asc`);
  state.files = rows.map(mapFile);
}

function normalizePedFileReference(value) {
  const normalized = normalizeRecipientName(value);
  const volume = normalized.match(/\s*\(jilid\s+([^)]+)\)\s*$/i);
  if (!volume) return normalized;
  const reference = normalized.slice(0, volume.index).trim();
  const code = reference.match(/^\d+(?:[-/]\d+)+/);
  return `${code?.[0] || reference}|${volume[1].trim()}`;
}

async function loadLatestPedFileLetterNumbers() {
  const columns = "id,owner_id,school_id,category,reference_number,office_reference_file,office_reference_letter_number,registry_file_number,registry_file_letter_number,created_at";
  const legacyColumns = columns.replace("office_reference_letter_number,", "").replace("registry_file_letter_number,", "");
  const rows = [];
  let offset = 0;
  let selectedColumns = columns;
  const pageSize = 1000;
  while (true) {
    let page;
    try {
      page = await rest("ped_correspondence", `select=${selectedColumns}&order=created_at.desc,id.desc&limit=${pageSize}&offset=${offset}`);
    } catch (error) {
      if (selectedColumns !== columns || !/office_reference_letter_number|registry_file_letter_number/i.test(error.message || "")) throw error;
      selectedColumns = legacyColumns;
      page = await rest("ped_correspondence", `select=${selectedColumns}&order=created_at.desc,id.desc&limit=${pageSize}&offset=${offset}`);
    }
    if (!page?.length) break;
    rows.push(...page);
    if (page.length < pageSize) break;
    offset += page.length;
  }

  const latest = new Map();
  const add = (ownerId, reference, letterNumber) => {
    const fileReference = normalizePedFileReference(reference);
    const number = String(letterNumber || "").trim();
    if (!ownerId || !fileReference || !number) return;
    const key = `${ownerId}|${fileReference}`;
    if (!latest.has(key)) latest.set(key, number);
  };
  rows.forEach(row => {
    add(row.owner_id, row.registry_file_number, row.registry_file_letter_number);
    add(row.owner_id, row.office_reference_file, row.office_reference_letter_number);
    if (row.category === "outgoing" || (row.category === "school_in" && row.school_id === row.owner_id)) {
      const outgoingReference = splitPedOutgoingReference(row.reference_number);
      add(row.owner_id, outgoingReference.fileReference, outgoingReference.letterNumber);
    }
  });
  state.pedFileLetterNumbers = latest;
}

async function loadLastMovementDates() {
  const rows = await rest("movements", "select=file_id,moved_at&order=moved_at.desc,created_at.desc,id.desc");
  const dates = new Map();
  (rows || []).forEach(row => {
    if (row.file_id && row.moved_at && !dates.has(row.file_id)) dates.set(row.file_id, row.moved_at);
  });
  state.lastMovementDates = dates;
}

async function refreshLastMovementDate(fileId) {
  const rows = await rest("movements", `file_id=eq.${encodeURIComponent(fileId)}&select=file_id,moved_at&order=moved_at.desc,created_at.desc,id.desc&limit=1`);
  const latest = rows?.[0]?.moved_at || "";
  if (latest) state.lastMovementDates.set(fileId, latest);
  else state.lastMovementDates.delete(fileId);
  return latest;
}

async function loadAgencies() {
  if (currentUser.role !== "admin") { state.agencies = []; return; }
  const rows = await rest("profiles", "role=eq.agency&select=id,email,name,agency_type,parent_agency_id,ped_office_id,created_at&order=name.asc");
  state.agencies = rows.map(row => ({
    id: row.id, emel: row.email, nama: row.name, jenis: row.agency_type,
    parentAgencyId: row.parent_agency_id, pedOfficeId: row.ped_office_id,
    createdAt: row.created_at
  }));
}

function mapPedRecord(row) {
  return {
    id: row.id,
    ownerId: row.owner_id,
    category: row.category,
    schoolId: row.school_id || null,
    officeId: row.office_id || null,
    date: row.correspondence_date,
    reference: row.reference_number,
    correspondent: row.correspondent,
    sender: row.sender || "",
    schoolName: row.school_name || "",
    recipient: row.recipient || "",
    departmentSectors: row.department_sectors || [],
    assignedOfficers: row.assigned_officers || [],
    schoolSector: row.school_sector || "",
    assignedTo: row.assigned_to || "",
    officeReferenceFile: row.office_reference_file || "",
    officeReferenceLetterNumber: row.office_reference_letter_number || "",
    officePersonalFileNumber: row.office_personal_file_number || "",
    registryFileNumber: row.registry_file_number || "",
    registryFileLetterNumber: row.registry_file_letter_number || "",
    originSector: row.origin_sector || "",
    deliveryMethods: row.delivery_methods || [],
    subject: row.subject,
    status: row.status,
    notes: row.notes || "",
    attachmentPath: row.attachment_path || "",
    createdAt: row.created_at
  };
}

async function loadPedRecords() {
  const columns = "id,owner_id,school_id,office_id,category,correspondence_date,reference_number,correspondent,sender,school_name,recipient,department_sectors,assigned_officers,school_sector,assigned_to,office_reference_file,office_reference_letter_number,office_personal_file_number,registry_file_number,registry_file_letter_number,origin_sector,delivery_methods,subject,status,notes,attachment_path,created_at";
  const legacyColumns = columns.replace("office_personal_file_number,", "").replace("office_reference_letter_number,", "").replace("registry_file_letter_number,", "");
  const fetchSize = 1000;
  const rows = [];
  let offset = 0;
  let selectedColumns = columns;
  while (true) {
    let page;
    try {
      page = await rest("ped_correspondence", `select=${selectedColumns}&order=id.asc&limit=${fetchSize}&offset=${offset}`);
    } catch (error) {
      if (selectedColumns !== columns || !/office_personal_file_number|office_reference_letter_number|registry_file_letter_number/i.test(error.message || "")) throw error;
      selectedColumns = legacyColumns;
      page = await rest("ped_correspondence", `select=${selectedColumns}&order=id.asc&limit=${fetchSize}&offset=${offset}`);
    }
    if (!page?.length) break;
    rows.push(...page);
    if (page.length < fetchSize) break;
    offset += page.length;
  }
  state.pedRecords = rows.map(mapPedRecord);
}

async function pedStorageRequest(path, options = {}) {
  const response = await fetch(`${config.url}/storage/v1/${path}`, {
    ...options,
    headers: {
      apikey: config.publishableKey,
      authorization: `Bearer ${session.access_token}`,
      ...(options.headers || {})
    }
  });
  if (!response.ok) throw await responseError(response, "Lampiran PeD tidak dapat diproses.");
  if (response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

// Phone photos are several MB; delivery proof stays legible at 1600px JPEG.
// Formats the browser cannot decode (e.g. HEIC outside Safari) upload as-is.
const pedPhotoMaxDimension = 1600;
const pedPhotoQuality = 0.8;

// Decoding through an <img> applies the photo's EXIF rotation the same way in
// Chrome, Firefox and Safari (Safari also decodes iPhone HEIC this way).
async function shrinkPedPhoto(file) {
  if (!/^image\/(jpeg|png|webp|heic|heif)$/i.test(file.type || "")) return file;
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    try { await image.decode(); }
    catch { return file; }
    const width = image.naturalWidth;
    const height = image.naturalHeight;
    if (!width || !height) return file;
    const scale = Math.min(1, pedPhotoMaxDimension / Math.max(width, height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext("2d");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", pedPhotoQuality));
    if (!blob || (scale === 1 && blob.size >= file.size && file.type === "image/jpeg")) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
  } finally { URL.revokeObjectURL(url); }
}

// crypto.randomUUID needs Safari 15.4+ and a secure context; older browsers
// fall back to 16 random bytes in hex.
const pedRandomId = () => globalThis.crypto?.randomUUID?.()
  || [...crypto.getRandomValues(new Uint8Array(16))].map(byte => byte.toString(16).padStart(2, "0")).join("");

async function uploadPedAttachment(file) {
  const upload = await shrinkPedPhoto(file);
  const extension = upload.name.split(".").pop().toLocaleLowerCase("en-US").replace(/[^a-z0-9]/g, "") || "jpg";
  const path = `${workspaceOwnerId()}/${pedRandomId()}.${extension}`;
  await pedStorageRequest(`object/ped-correspondence/${path.split("/").map(encodeURIComponent).join("/")}`, {
    method: "POST",
    headers: { "content-type": upload.type || "application/octet-stream", "x-upsert": "false" },
    body: upload
  });
  return path;
}

async function deletePedAttachment(path) {
  if (!path) return;
  await pedStorageRequest("object/ped-correspondence", {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prefixes: [path] })
  });
}

async function signedPedAttachmentUrl(path) {
  const result = await pedStorageRequest(`object/sign/ped-correspondence/${path.split("/").map(encodeURIComponent).join("/")}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ expiresIn: 300 })
  });
  return `${config.url}/storage/v1${result.signedURL}`;
}

async function loadRecipientUsers() {
  if (!currentUser || currentUser.role === "admin") { state.recipientUsers = []; return; }
  try {
    const rows = await rpc("workspace_staff_recipients", {});
    state.recipientUsers = (rows || []).map(row => ({ id: row.id, name: formatPersonName(row.name) })).filter(person => person.name);
  } catch (error) {
    if (!missingRpc(error, "workspace_staff_recipients")) console.warn("Senarai penerima akaun tidak dapat dimuatkan.", error);
    state.recipientUsers = [];
  }
}

function mapFileNotification(row) {
  return {
    id: row.id,
    fileId: row.file_id,
    actorName: row.actor_name,
    actorEmail: row.actor_email || "",
    transactionCode: row.transaction_code,
    volume: row.volume,
    fromHolder: row.from_holder,
    toHolder: row.to_holder,
    movedAt: row.moved_at,
    readAt: row.read_at || "",
    createdAt: row.created_at
  };
}

function ensureNotificationModal() {
  let modal = document.querySelector("#notificationModal");
  if (modal) return modal;
  modal = create("div", {
    className: "modal hidden notification-modal",
    id: "notificationModal",
    role: "dialog",
    "aria-modal": "true",
    "aria-labelledby": "notificationTitle"
  }, create("section", { className: "modal-card notification-modal-card" }, [
    create("div", { className: "modal-head" }, [
      create("div", {}, [
        create("h2", { id: "notificationTitle", text: "Notifikasi Penerimaan Fail" }),
        create("p", { text: "Fail yang dipindahkan kepada akaun anda." })
      ]),
      create("button", { className: "icon-button", type: "button", "data-close": "", "aria-label": "Tutup", text: "×" })
    ]),
    create("div", { className: "notification-list", id: "notificationList" })
  ]));
  document.body.append(modal);
  wireModal(modal);
  return modal;
}

function ensureNotificationFileModal() {
  let modal = document.querySelector("#notificationFileModal");
  if (modal) return modal;
  modal = create("div", {
    className: "modal hidden notification-file-modal",
    id: "notificationFileModal",
    role: "dialog",
    "aria-modal": "true",
    "aria-labelledby": "notificationFileTitle"
  }, create("section", { className: "modal-card notification-file-modal-card" }, [
    create("div", { className: "modal-head" }, [
      create("div", {}, [
        create("h2", { id: "notificationFileTitle", text: "Butiran Fail Diserahkan" }),
        create("p", { "data-file-reference": "", text: "Memuatkan rekod fail…" })
      ]),
      create("button", { className: "icon-button", type: "button", "data-close": "", "aria-label": "Tutup", text: "×" })
    ]),
    create("div", { className: "notification-file-content", id: "notificationFileContent" }),
    create("div", { className: "form-actions notification-file-actions" },
      create("button", { className: "button secondary", type: "button", "data-close": "", text: "Tutup" })
    )
  ]));
  document.body.append(modal);
  wireModal(modal);
  return modal;
}

function notificationFileField(label, value, className = "") {
  return create("div", { className: `notification-file-field${className ? ` ${className}` : ""}` }, [
    create("dt", { text: label }),
    typeof value === "string" ? create("dd", { text: value }) : create("dd", {}, value)
  ]);
}

async function openNotificationFile(item, notificationModal) {
  const modal = ensureNotificationFileModal();
  const reference = modal.querySelector("[data-file-reference]");
  const content = modal.querySelector("#notificationFileContent");
  reference.textContent = `${item.transactionCode} (Jilid ${item.volume})`;
  content.replaceChildren(create("div", { className: "notification-file-loading", text: "Memuatkan butiran fail…" }));
  closeModal(notificationModal);
  showModal("#notificationFileModal");

  try {
    const columns = "id,owner_id,function_name,activity_name,sub_activity_name,transaction_code,volume,opened_on,closed_on,status,current_holder,created_at";
    const rows = await rest("files", `id=eq.${encodeURIComponent(item.fileId)}&select=${columns}&limit=1`);
    if (!rows.length) throw new Error("Rekod fail ini tidak lagi ditemui atau akses telah ditarik balik.");
    const file = mapFile(rows[0]);
    const inFileRoom = normalizeRecipientName(file.pemegangTerkini) === normalizeRecipientName("Bilik Fail");
    reference.textContent = `${file.transaksi} (Jilid ${file.jilid})`;
    content.replaceChildren(
      create("section", { className: "notification-file-handoff" }, [
        create("span", { className: "notification-file-handoff-icon", "aria-hidden": "true", text: "→" }),
        create("div", {}, [
          create("strong", { text: `Diserahkan oleh ${item.actorName}` }),
          create("p", { text: `${item.fromHolder} → ${item.toHolder}` }),
          create("time", { datetime: item.movedAt, text: formatDate(item.movedAt, true) }),
          item.actorEmail ? create("small", { text: item.actorEmail }) : null
        ])
      ]),
      create("dl", { className: "notification-file-grid" }, [
        notificationFileField("Kod Transaksi", file.transaksi, "wide"),
        notificationFileField("Jilid", String(file.jilid)),
        notificationFileField("Keberadaan Semasa", create("span", { className: `badge ${inFileRoom ? "archive" : "moving"}`, text: file.pemegangTerkini })),
        notificationFileField("Tarikh Buka", formatDate(file.tarikhBuka)),
        notificationFileField("Tarikh Tutup", file.tarikhTutup ? formatDate(file.tarikhTutup) : "Belum ditutup"),
        notificationFileField("Fungsi", file.fungsi, "wide"),
        notificationFileField("Aktiviti", file.aktiviti, "wide"),
        notificationFileField("Sub-Aktiviti", file.subAktiviti, "wide")
      ])
    );
  } catch (error) {
    content.replaceChildren(create("div", { className: "notification-file-error" }, [
      create("strong", { text: "Fail tidak dapat dipaparkan" }),
      create("p", { text: error.message })
    ]));
  }
}

function updateNotificationBadge(button) {
  const unreadCount = state.notifications.filter(item => !item.readAt).length;
  const indicator = button.querySelector("span");
  if (indicator) {
    indicator.textContent = unreadCount > 99 ? "99+" : String(unreadCount || "");
    indicator.classList.toggle("hidden", unreadCount === 0);
  }
  button.setAttribute("aria-label", unreadCount ? `Pemberitahuan, ${unreadCount} belum dibaca` : "Pemberitahuan, tiada yang baharu");
}

function renderNotifications(modal) {
  const list = modal.querySelector("#notificationList");
  list.replaceChildren();
  if (!state.notifications.length) {
    list.append(create("div", { className: "notification-empty" }, [
      create("strong", { text: "Tiada notifikasi" }),
      create("p", { text: "Pindahan fail kepada anda akan dipaparkan di sini." })
    ]));
    return;
  }
  state.notifications.forEach(item => {
    list.append(create("button", {
      className: `notification-item${item.readAt ? "" : " unread"}`,
      type: "button",
      "aria-label": `Paparkan fail ${item.transactionCode}, Jilid ${item.volume}`,
      onclick: () => openNotificationFile(item, modal)
    }, [
      create("span", { className: "notification-item-icon", "aria-hidden": "true", text: "→" }),
      create("span", { className: "notification-item-copy" }, [
        create("strong", { text: `${item.transactionCode} · Jilid ${item.volume}` }),
        create("span", { text: `${item.actorName} memindahkan fail daripada ${item.fromHolder} kepada anda.` }),
        item.actorEmail ? create("small", { text: item.actorEmail }) : null,
        create("time", { datetime: item.movedAt, text: formatDate(item.movedAt, true) })
      ])
    ]));
  });
}

async function loadNotifications() {
  const columns = "id,file_id,actor_name,actor_email,transaction_code,volume,from_holder,to_holder,moved_at,read_at,created_at";
  const query = `recipient_id=eq.${encodeURIComponent(currentUser.id)}&select=${columns}&order=created_at.desc&limit=50`;
  state.notifications = (await rest("file_notifications", query)).map(mapFileNotification);
  return state.notifications;
}

async function initNotifications() {
  const button = document.querySelector(".notification-button");
  if (!button) return;
  const modal = ensureNotificationModal();
  let refreshing = false;
  const refresh = async () => {
    if (refreshing || !state.notificationsAvailable) return;
    refreshing = true;
    try {
      await loadNotifications();
      updateNotificationBadge(button);
      if (!modal.classList.contains("hidden")) renderNotifications(modal);
    } catch (error) {
      if (/file_notifications|schema cache/i.test(error.message)) {
        state.notificationsAvailable = false;
        state.notifications = [];
        updateNotificationBadge(button);
      }
      else console.warn("Notifikasi tidak dapat dimuatkan.", error);
    } finally { refreshing = false; }
  };
  await refresh();
  button.addEventListener("click", async () => {
    if (!state.notificationsAvailable) {
      toast("Notifikasi belum diaktifkan", "Jalankan migrasi Supabase 20260908030000_add_file_notifications.sql.", "error");
      return;
    }
    await refresh();
    renderNotifications(modal);
    showModal("#notificationModal");
    const unread = state.notifications.filter(item => !item.readAt);
    if (!unread.length) return;
    const readAt = new Date().toISOString();
    try {
      await rest("file_notifications", `recipient_id=eq.${encodeURIComponent(currentUser.id)}&read_at=is.null`, {
        method: "PATCH",
        body: JSON.stringify({ read_at: readAt })
      });
      state.notifications.forEach(item => { if (!item.readAt) item.readAt = readAt; });
      updateNotificationBadge(button);
      renderNotifications(modal);
    } catch (error) { console.warn("Status notifikasi tidak dapat dikemaskini.", error); }
  });
  if (state.notificationsAvailable) {
    window.addEventListener("focus", refresh);
    window.setInterval(() => { if (document.visibilityState === "visible") refresh(); }, 45000);
  }
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
    name: formatPersonName(row.name),
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
  const passwordToggle = document.querySelector("[data-password-toggle]");
  const submitButton = form.querySelector("button[type=submit]");
  const submitLabel = submitButton.querySelector("[data-login-button-label]");
  let passwordStep = recoveryMode;

  passwordToggle?.addEventListener("click", () => {
    const visible = passwordInput.type === "text";
    passwordInput.type = visible ? "password" : "text";
    passwordToggle.classList.toggle("is-visible", !visible);
    passwordToggle.setAttribute("aria-pressed", String(!visible));
    passwordToggle.setAttribute("aria-label", visible ? "Lihat kata laluan" : "Sembunyikan kata laluan");
    passwordInput.focus();
  });

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
  await Promise.all([
    loadSettings(), loadFiles(), loadLastMovementDates(), loadAgencies(), loadRecipientUsers(),
    loadLatestPedFileLetterNumbers().catch(error => {
      state.pedFileLetterNumbers = new Map();
      console.warn("Nombor surat PeD untuk paparan fail tidak dapat dimuatkan.", error);
    })
  ]);
  const body = document.querySelector("#fileRows");
  const archiveBody = document.querySelector("#archiveRows");
  const search = document.querySelector("#searchFile");
  const archiveSearch = document.querySelector("#searchArchive");
  const filter = document.querySelector("#filterFungsi");
  const locationCards = document.querySelectorAll("[data-file-location]");
  const locationSummary = document.querySelector("#fileLocationSummary");
  let locationFilter = "all";
  const isInFileRoom = file => normalizeRecipientName(file.pemegangTerkini) === "bilik fail";
  const matchesLocation = file => locationFilter === "all" ||
    (locationFilter === "room" ? isInFileRoom(file) : !isInFileRoom(file));
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
    const total = state.files.length;
    const archive = state.files.filter(isInFileRoom).length;
    const moving = total - archive;
    const numberFormat = new Intl.NumberFormat("ms-MY");
    const percentFormat = new Intl.NumberFormat("ms-MY", { style: "percent", maximumFractionDigits: 1 });
    document.querySelector("#statTotal").textContent = numberFormat.format(total);
    document.querySelector("#statArchive").textContent = numberFormat.format(archive);
    document.querySelector("#statMoving").textContent = numberFormat.format(moving);
    const distribution = document.querySelector("#statDistribution");
    if (distribution) distribution.textContent = total
      ? `${numberFormat.format(archive)} di bilik fail · ${numberFormat.format(moving)} beredar`
      : "Belum ada rekod fail";
    [["archive", archive, "#statArchiveShare"], ["moving", moving, "#statMovingShare"]].forEach(([key, value, selector]) => {
      const share = total ? value / total : 0;
      const label = document.querySelector(selector);
      if (label) label.textContent = percentFormat.format(share);
      document.querySelectorAll(`[data-stat-share="${key}"]`).forEach(meter => {
        meter.style.width = `${share * 100}%`;
      });
    });
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
      .filter(file => !file.tarikhTutup && matchesLocation(file) && matchesSearch(file, term) && (!selected || file.fungsi === selected))
      .sort(compareByTransaction);
    const archivedFiles = state.files
      .filter(file => Boolean(file.tarikhTutup) && matchesLocation(file) && matchesSearch(file, archiveTerm))
      .sort(compareByTransaction);
    const activeResult = pagedRecords(activeFiles, activePage, pagination.active);
    const archiveResult = pagedRecords(archivedFiles, archivePage, pagination.archive);
    activePage = activeResult.page;
    archivePage = archiveResult.page;
    body.replaceChildren();
    archiveBody.replaceChildren();
    document.querySelector("#emptyFiles").classList.toggle("hidden", activeFiles.length > 0);
    document.querySelector("#emptyArchive").classList.toggle("hidden", archivedFiles.length > 0);
    const activeCount = document.querySelector("#activeFileCount");
    if (activeCount) activeCount.textContent = term || selected || locationFilter !== "all"
      ? `${activeFiles.length} daripada ${state.files.length - totalArchived} rekod`
      : `${activeFiles.length} rekod`;
    document.querySelector("#archiveCount").textContent = archiveTerm || locationFilter !== "all"
      ? `${archivedFiles.length} daripada ${totalArchived} rekod`
      : `${totalArchived} rekod`;
    document.querySelector("#emptyArchiveTitle").textContent = archiveTerm || locationFilter !== "all" ? "Tiada arkib ditemui" : "Belum ada fail ditutup";
    document.querySelector("#emptyArchiveCopy").textContent = archiveTerm || locationFilter !== "all"
      ? "Ubah carian atau pilih kad Jumlah Fail untuk melihat rekod arkib lain."
      : "Fail akan dipindahkan ke arkib secara automatik apabila Tarikh Tutup diisi.";
    locationCards.forEach(card => card.setAttribute("aria-pressed", String(card.dataset.fileLocation === locationFilter)));
    document.querySelector("#fileLocationFilter").classList.toggle("hidden", locationFilter === "all");
    locationSummary.textContent = locationFilter === "all" ? "" :
      `${locationFilter === "room" ? "Di bilik fail" : "Sedang beredar"}: ${activeFiles.length} fail aktif · ${archivedFiles.length} fail ditutup`;
    const tableIcon = path => create("svg", {
      viewBox: "0 0 24 24", fill: "none", stroke: "currentColor",
      "stroke-width": "1.8", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true"
    }, create("path", { d: path }));
    const action = (file, label, icon, callback, primary = false) => create("button", {
      className: `button small${primary ? "" : " secondary"}`,
      type: "button",
      "aria-label": `${label} fail ${file.transaksi}, Jilid ${file.jilid}`,
      onclick: () => callback(file, render)
    }, [tableIcon(icon), create("span", { text: label })]);
    const renderFileRow = (file, closed) => {
      // Split the reference for display only; stored values and search stay unchanged.
      const reference = String(file.transaksi || "");
      const parts = reference.match(/^(\d+(?:[-/]\d+)+)\s*(.*)$/);
      const code = parts && parts[2] ? parts[1] : "";
      const title = code ? parts[2] : reference;
      const latestLetterNumber = state.pedFileLetterNumbers.get(
        `${file.ownerId}|${normalizePedFileReference(`${file.transaksi} (Jilid ${file.jilid})`)}`
      );
      const dateIcon = "M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14H3V6a2 2 0 0 1 2-2Z";
      const dateElement = date => create("div", { className: "file-date" }, [
        tableIcon(dateIcon),
        create("time", { datetime: date, text: formatDate(date) })
      ]);
      const dates = create("div", { className: "file-dates" }, dateElement(file.tarikhBuka));
      const lastMovementAt = state.lastMovementDates.get(file.id);
      const lastMovementDate = lastMovementAt
        ? create("div", { className: "file-last-movement" }, [
          tableIcon("M12 8v5l3 2M21 12a9 9 0 1 1-3-6.7"),
          create("time", { datetime: lastMovementAt, text: formatDate(lastMovementAt, true) })
        ])
        : create("span", { className: "muted", text: "Tiada log" });
      const inFileRoom = isInFileRoom(file);
      const editButton = action(file, "Edit", "m15 5 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15v5Z", openEdit);
      if (closed) editButton.title = "Ubah tarikh atau buka semula fail";
      const rowCells = [
        create("td", {}, [
          create("div", { className: "file-reference" }, [
            code ? create("span", { className: "file-code", text: code }) : null,
            create("span", { className: "file-volume", text: `Jilid ${file.jilid}` }),
            latestLetterNumber ? create("span", { className: "file-letter-number", text: `(No. Surat ${latestLetterNumber})` }) : null
          ]),
          create("div", { className: "record-title", text: title }),
          create("div", { className: "record-meta", text: file.subAktiviti })
        ]),
        create("td", {}, closed ? dateElement(file.tarikhBuka) : dates)
      ];
      if (closed) rowCells.push(create("td", {}, dateElement(file.tarikhTutup)));
      rowCells.push(
        create("td", {}, create("span", {
          className: `badge ${inFileRoom ? "archive" : "moving"}`, text: file.pemegangTerkini
        }))
      );
      if (!closed) rowCells.push(create("td", {}, lastMovementDate));
      rowCells.push(
        create("td", {}, create("div", { className: "actions" }, [
          !closed ? action(file, "Pindah", "M4 7h13M14 4l3 3-3 3M20 17H7M10 14l-3 3 3 3", openMovement, true) : null,
          editButton,
          action(file, "Log", "M3 11a9 9 0 1 1 2.6 7M3 4v7h7M12 7v5l3 2", openHistory),
          deleteAction(file, render)
        ]))
      );
      return create("tr", {}, rowCells);
    };
    activeResult.records.forEach(file => body.append(renderFileRow(file, false)));
    archiveResult.records.forEach(file => archiveBody.append(renderFileRow(file, true)));
  };
  const selectLocation = location => {
    locationFilter = location;
    search.value = "";
    archiveSearch.value = "";
    filter.value = "";
    activePage = 1;
    archivePage = 1;
    render();
  };
  locationCards.forEach(card => {
    card.addEventListener("click", () => selectLocation(card.dataset.fileLocation));
    card.addEventListener("keydown", event => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      selectLocation(card.dataset.fileLocation);
    });
  });
  document.querySelector("#clearFileLocation").addEventListener("click", () => {
    selectLocation("all");
    document.querySelector('[data-file-location="all"]').focus();
  });
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

async function initMovementLog() {
  if (!await initShell()) return;
  await Promise.all([
    loadFiles(), loadSettings(), loadRecipientUsers(), loadAgencies(),
    loadLatestPedFileLetterNumbers().catch(error => {
      state.pedFileLetterNumbers = new Map();
      console.warn("Nombor surat PeD untuk pergerakan fail tidak dapat dimuatkan.", error);
    })
  ]);
  const form = document.querySelector("#movementLogFilter");
  const searchInput = document.querySelector("#movementLogSearch");
  const dateInput = document.querySelector("#movementLogDate");
  const showLogButton = document.querySelector("#showMovementLog");
  const showAssignedButton = document.querySelector("#showAssignedFiles");
  const body = document.querySelector("#movementLogRows");
  const empty = document.querySelector("#emptyMovementLog");
  const emptyTitle = document.querySelector("#emptyMovementLogTitle");
  const emptyCopy = document.querySelector("#emptyMovementLogCopy");
  const count = document.querySelector("#movementLogCount");
  const subtitle = document.querySelector("#movementLogSubtitle");
  const listTitle = document.querySelector("#movementListTitle");
  const listCopy = document.querySelector("#movementListCopy");
  const caption = document.querySelector("#movementLogCaption");
  const userHeading = document.querySelector("#movementUserHeading");
  const pagination = document.querySelector("#movementLogPagination");
  const pageInfo = document.querySelector("#movementLogPageInfo");
  const previous = document.querySelector("#movementLogPrevious");
  const next = document.querySelector("#movementLogNext");
  const fileById = new Map(state.files.map(file => [file.id, file]));
  const pageSize = 12;
  let records = [];
  let currentPage = 1;
  let viewMode = "log";
  let searchTimer;
  let requestSequence = 0;

  const canViewAssignedFiles = ["agency", "staff"].includes(currentUser.role);
  showAssignedButton.classList.toggle("hidden", !canViewAssignedFiles);

  const malaysiaDateValue = () => {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kuching",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(new Date());
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  };

  const updateView = (selectedLabel, searchTerm = "") => {
    const assignedView = viewMode === "assigned";
    const searchView = viewMode === "search";
    showLogButton.classList.toggle("secondary", assignedView || searchView);
    showAssignedButton.classList.toggle("secondary", !assignedView);
    showLogButton.setAttribute("aria-pressed", String(!assignedView && !searchView));
    showAssignedButton.setAttribute("aria-pressed", String(assignedView));
    dateInput.disabled = assignedView;
    searchInput.placeholder = assignedView ? "Cari fail diterima…" : "Cari semua tarikh…";
    listTitle.textContent = assignedView ? "Fail Diterima Saya" : searchView ? "Hasil Carian Pergerakan" : "Senarai Pergerakan";
    listCopy.textContent = assignedView
      ? "Fail yang diserahkan oleh pengguna lain dan masih dalam pegangan anda, tanpa had tarikh."
      : searchView
        ? `Carian “${searchTerm}” merangkumi semua tarikh log pergerakan.`
        : "Pilih tarikh untuk melihat Pindah Keberadaan terakhir dan pengguna yang melakukannya.";
    caption.textContent = assignedView
      ? "Fail yang sedang diserahkan kepada pengguna agensi"
      : searchView
        ? "Hasil carian log pergerakan bagi semua tarikh"
        : "Log pergerakan fail mengikut tarikh dan pengguna pindahan terakhir";
    userHeading.textContent = assignedView ? "Diserahkan Oleh" : "Pengguna Terakhir";
    userHeading.title = assignedView
      ? "Pengguna yang menyerahkan fail kepada anda"
      : "Pengguna yang membuat perubahan Pindah Keberadaan";
    emptyTitle.textContent = assignedView ? "Tiada fail dalam pegangan anda" : searchView ? "Tiada hasil carian" : "Tiada pindahan direkodkan";
    emptyCopy.textContent = assignedView
      ? "Fail akan dipaparkan di sini apabila pengguna lain memindahkannya kepada anda."
      : searchView
        ? "Cuba kata carian lain seperti nombor fail, nama pengguna, penerima atau catatan."
        : "Tiada tindakan Pindah Keberadaan pada tarikh yang dipilih.";
    subtitle.textContent = assignedView
      ? "Fail yang sedang diserahkan kepada akaun anda."
      : searchView
        ? `Hasil carian log pergerakan bagi “${searchTerm}” tanpa had tarikh.`
        : `Pindah Keberadaan terakhir setiap fail yang direkodkan pada ${selectedLabel}.`;
  };

  const refreshCurrentView = async () => {
    if (viewMode === "assigned") await loadAssignedFiles();
    else if (viewMode === "search") await searchMovements();
    else await loadMovements();
  };

  const render = () => {
    const pageCount = Math.max(1, Math.ceil(records.length / pageSize));
    currentPage = Math.min(Math.max(currentPage, 1), pageCount);
    const startIndex = (currentPage - 1) * pageSize;
    const endIndex = Math.min(startIndex + pageSize, records.length);
    const visibleRecords = records.slice(startIndex, endIndex);
    body.replaceChildren();
    visibleRecords.forEach(record => {
      const file = fileById.get(record.idFail);
      const latestLetterNumber = file && state.pedFileLetterNumbers.get(
        `${file.ownerId}|${normalizePedFileReference(`${file.transaksi} (Jilid ${file.jilid})`)}`
      );
      const fileReference = file
        ? `${file.transaksi} · Jilid ${file.jilid}${latestLetterNumber ? ` (No. Surat ${latestLetterNumber})` : ""}`
        : "Rekod fail";
      const fileDetail = file?.subAktiviti || "Maklumat fail tidak tersedia";
      const movementTime = new Intl.DateTimeFormat("ms-MY", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Asia/Kuching"
      }).format(new Date(record.tarikh));
      body.append(create("tr", {}, [
        create("td", {}, create("time", { datetime: record.tarikh, text: movementTime })),
        create("td", {}, [create("div", { className: "record-title", text: fileReference }), create("div", { className: "record-meta", text: fileDetail })]),
        create("td", {}, create("div", { className: "movement-route" }, [
          create("span", { className: "movement-holder from", text: record.dari, title: record.dari }),
          create("span", { className: "movement-route-arrow", text: "→", "aria-hidden": "true" }),
          create("span", { className: "movement-holder to", text: record.kepada, title: record.kepada })
        ])),
        create("td", {}, create("div", { className: "movement-user" }, [
          create("span", { className: "movement-user-avatar", "aria-hidden": "true", text: avatarPresentation("initials", record.penggunaNama || "TD").symbol }),
          create("span", { className: "movement-user-copy" }, [
            create("strong", { text: record.penggunaNama || "Tidak direkodkan" }),
            record.penggunaEmel ? create("small", { text: record.penggunaEmel }) : create("small", { text: "Log terdahulu" })
          ])
        ])),
        create("td", { text: record.catatan || "Tiada catatan" }),
        create("td", {}, record.synthetic
          ? create("span", { className: "record-meta", text: "Log tidak tersedia" })
          : create("div", { className: "movement-log-actions" }, [
            create("button", { className: "button secondary small", type: "button", text: "Edit", "aria-label": `Edit log ${fileReference}`, onclick: () => openMovementLogEditor(record, file, async (_updatedRecord, updatedFile) => {
              if (file) Object.assign(file, updatedFile);
              await refreshCurrentView();
            }) }),
            create("button", { className: "button secondary small movement-log-delete-button", type: "button", text: "Padam", "aria-label": `Padam log ${fileReference}`, onclick: () => openMovementLogDelete(record, file, async updatedFile => {
              if (file) Object.assign(file, updatedFile);
              await refreshCurrentView();
            }) })
          ]))
      ]));
    });
    count.textContent = `${records.length} fail`;
    empty.classList.toggle("hidden", records.length > 0);
    pagination.classList.toggle("hidden", records.length <= pageSize);
    pageInfo.textContent = records.length ? `${startIndex + 1}–${endIndex} daripada ${records.length} rekod` : "0 rekod";
    previous.disabled = currentPage === 1;
    next.disabled = currentPage === pageCount;
  };

  async function movementRows(filters) {
    const baseColumns = "id,file_id,owner_id,moved_at,from_holder,to_holder,note";
    const actorColumns = `${baseColumns},performed_by,performed_by_name,performed_by_email`;
    try {
      return await rest("movements", `select=${actorColumns}&${filters}`);
    } catch (error) {
      if (!/performed_by|performed_by_name|performed_by_email/i.test(error.message)) throw error;
      return rest("movements", `select=${baseColumns}&${filters}`);
    }
  }

  async function loadMovements() {
    dateInput.disabled = false;
    const requestId = ++requestSequence;
    const selectedDate = dateInput.value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(selectedDate)) {
      toast("Tarikh diperlukan", "Pilih tarikh log pergerakan yang ingin dipaparkan.", "error");
      return;
    }
    viewMode = "log";
    const start = new Date(`${selectedDate}T00:00:00+08:00`);
    const selectedLabel = new Intl.DateTimeFormat("ms-MY", { dateStyle: "full", timeZone: "Asia/Kuching" }).format(start);
    updateView(selectedLabel);
    setBusy(showLogButton, true, "Memuatkan…");
    try {
      const end = new Date(start.getTime() + 86400000);
      const filters = `moved_at=gte.${encodeURIComponent(start.toISOString())}&moved_at=lt.${encodeURIComponent(end.toISOString())}&order=moved_at.desc`;
      const rows = await movementRows(filters);
      if (requestId !== requestSequence) return;
      const latestByFile = new Map();
      rows.map(mapMovement)
        .filter(record => record.dari.toLocaleLowerCase("ms") !== "sistem pendaftaran")
        .forEach(record => {
          if (!latestByFile.has(record.idFail)) latestByFile.set(record.idFail, record);
        });
      records = [...latestByFile.values()];
      currentPage = 1;
      render();
    } catch (error) {
      if (requestId !== requestSequence) return;
      records = [];
      render();
      toast("Log tidak dapat dimuatkan", error.message, "error");
    } finally { setBusy(showLogButton, false); }
  }

  function movementSearchValue(record) {
    const file = fileById.get(record.idFail);
    const latestLetterNumber = file && state.pedFileLetterNumbers.get(
      `${file.ownerId}|${normalizePedFileReference(`${file.transaksi} (Jilid ${file.jilid})`)}`
    );
    return [
      file?.transaksi,
      file?.subAktiviti,
      file?.aktiviti,
      file?.fungsi,
      file?.jilid ? `jilid ${file.jilid}` : "",
      latestLetterNumber ? `no. surat ${latestLetterNumber}` : "",
      record.dari,
      record.kepada,
      record.penggunaNama,
      record.penggunaEmel,
      record.catatan,
      formatDate(record.tarikh, true)
    ].filter(Boolean).join(" ").toLocaleLowerCase("ms");
  }

  async function searchMovements() {
    const term = searchInput.value.trim();
    if (!term) {
      await loadMovements();
      return;
    }
    const requestId = ++requestSequence;
    viewMode = "search";
    updateView("", term);
    searchInput.setAttribute("aria-busy", "true");
    try {
      const rows = await movementRows("order=moved_at.desc");
      if (requestId !== requestSequence) return;
      const normalizedTerm = term.toLocaleLowerCase("ms");
      records = rows.map(mapMovement)
        .filter(record => record.dari.toLocaleLowerCase("ms") !== "sistem pendaftaran")
        .filter(record => movementSearchValue(record).includes(normalizedTerm));
      currentPage = 1;
      render();
    } catch (error) {
      if (requestId !== requestSequence) return;
      records = [];
      render();
      toast("Carian tidak dapat dimuatkan", error.message, "error");
    } finally {
      if (requestId === requestSequence) searchInput.removeAttribute("aria-busy");
    }
  }

  async function loadAssignedFiles() {
    if (!canViewAssignedFiles) return;
    const requestId = ++requestSequence;
    viewMode = "assigned";
    updateView("");
    setBusy(showAssignedButton, true, "Memuatkan…");
    try {
      await loadFiles();
      if (requestId !== requestSequence) return;
      fileById.clear();
      state.files.forEach(file => fileById.set(file.id, file));
      const userName = normalizeRecipientName(currentUser.data?.nama);
      const assignedFiles = state.files.filter(file => userName && normalizeRecipientName(file.pemegangTerkini) === userName);
      const latestMovementByFile = new Map();
      if (!assignedFiles.length) {
        records = [];
        currentPage = 1;
        render();
        return;
      }
      // Small batches keep URLs bounded; pagination includes older handovers too.
      for (let index = 0; index < assignedFiles.length; index += 50) {
        const fileIds = assignedFiles.slice(index, index + 50).map(file => file.id).join(",");
        let offset = 0;
        while (true) {
          const rows = await movementRows(`file_id=in.(${fileIds})&order=moved_at.desc,id.desc&limit=500&offset=${offset}`);
          if (requestId !== requestSequence) return;
          rows.map(mapMovement).forEach(record => {
            if (!latestMovementByFile.has(record.idFail)) latestMovementByFile.set(record.idFail, record);
          });
          if (rows.length < 500) break;
          offset += rows.length;
        }
      }
      const term = searchInput.value.trim().toLocaleLowerCase("ms");
      records = [...latestMovementByFile.values()].filter(record =>
        normalizeRecipientName(record.kepada) === userName &&
        normalizeRecipientName(record.dari) !== "sistem pendaftaran" &&
        record.penggunaId && record.penggunaId !== currentUser.id &&
        (!term || movementSearchValue(record).includes(term))
      ).sort((first, second) => new Date(second.tarikh) - new Date(first.tarikh));
      currentPage = 1;
      render();
    } catch (error) {
      if (requestId !== requestSequence) return;
      records = [];
      render();
      toast("Fail diterima tidak dapat dimuatkan", error.message, "error");
    } finally {
      setBusy(showAssignedButton, false);
    }
  }

  const requestedDate = new URLSearchParams(location.search).get("date");
  dateInput.value = /^\d{4}-\d{2}-\d{2}$/.test(requestedDate || "") ? requestedDate : malaysiaDateValue();
  form.addEventListener("submit", event => {
    event.preventDefault();
    clearTimeout(searchTimer);
    searchInput.value = "";
    loadMovements();
  });
  searchInput.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => viewMode === "assigned" ? loadAssignedFiles() : searchMovements(), 280);
  });
  searchInput.addEventListener("keydown", event => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    clearTimeout(searchTimer);
    if (viewMode === "assigned") loadAssignedFiles();
    else searchMovements();
  });
  showAssignedButton.addEventListener("click", () => {
    clearTimeout(searchTimer);
    searchInput.value = "";
    loadAssignedFiles();
  });
  previous.addEventListener("click", () => { currentPage -= 1; render(); });
  next.addEventListener("click", () => { currentPage += 1; render(); });
  await loadMovements();
  markReady();
}

function showModal(id) { document.querySelector(id).classList.remove("hidden"); document.body.style.overflow = "hidden"; }
function closeModal(modal) {
  modal.classList.add("hidden");
  if (!document.querySelector(".modal:not(.hidden)")) document.body.style.overflow = "";
}
function wireModal(modal) {
  modal.querySelectorAll("[data-close]").forEach(el => el.addEventListener("click", () => closeModal(modal)));
  modal.addEventListener("click", event => { if (event.target === modal) closeModal(modal); });
}

function openMovement(file, refresh) {
  const modal = document.querySelector("#movementModal");
  modal.querySelector("[data-file-reference]").textContent = `${file.transaksi} (Jilid ${file.jilid})`;
  const recipient = modal.querySelector("#recipient");
  const recipients = [
    "Bilik Fail",
    file.pemegangTerkini,
    ...state.settings.pegawai.map(p => p.nama),
    ...state.recipientUsers.map(person => person.name),
    ...state.agencies.map(a => a.nama)
  ];
  const uniqueRecipients = uniqueRecipientNames(recipients);
  fillSelect(recipient, uniqueRecipients, "Pilih keberadaan…");
  recipient.value = uniqueRecipients.find(name => normalizeRecipientName(name) === normalizeRecipientName(file.pemegangTerkini)) || "";
  modal.querySelector("#movementDate").value = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  modal.querySelector("#movementNote").value = "";
  modal.onsubmit = async event => {
    event.preventDefault();
    const button = modal.querySelector("button[type=submit]");
    const to = recipient.value;
    const movedAt = modal.querySelector("#movementDate").value;
    const note = modal.querySelector("#movementNote").value.trim();
    const from = file.pemegangTerkini;
    if (normalizeRecipientName(from) === normalizeRecipientName(to) && !note) { toast("Tiada perubahan", "Pilih penerima baharu atau masukkan catatan.", "error"); return; }
    setBusy(button, true, "Menyimpan…");
    try {
      const movedAtIso = new Date(movedAt).toISOString();
      const result = await moveFile(file, {
        p_file_id: file.id,
        p_to_holder: to,
        p_moved_at: movedAtIso,
        p_note: note
      });
      Object.assign(file, mapFile(result.file));
      state.lastMovementDates.set(file.id, result.movement?.moved_at || movedAtIso);
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

function movementDateTimeInput(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function movementHolderSuggestions(record) {
  return uniqueRecipientNames([
    "Bilik Fail",
    "Sistem Pendaftaran",
    record.dari,
    record.kepada,
    ...(state.settings?.pegawai || []).map(person => person.nama),
    ...state.recipientUsers.map(person => person.name),
    ...state.agencies.map(agency => agency.nama)
  ]);
}

function ensureMovementLogEditor() {
  let modal = document.querySelector("#movementLogEditModal");
  if (modal) return modal;
  modal = create("form", { className: "modal hidden", id: "movementLogEditModal", role: "dialog", "aria-modal": "true", "aria-labelledby": "movementLogEditTitle" },
    create("section", { className: "modal-card movement-log-edit-card" }, [
      create("div", { className: "modal-head" }, [
        create("div", {}, [create("h2", { id: "movementLogEditTitle", text: "Edit Log Pergerakan" }), create("p", { "data-file-reference": "" })]),
        create("button", { className: "icon-button", type: "button", "data-close": "", "aria-label": "Tutup", text: "×" })
      ]),
      create("div", { className: "movement-log-edit-grid" }, [
        create("div", { className: "field" }, [create("label", { for: "movementLogFrom", text: "Daripada" }), create("select", { className: "input", id: "movementLogFrom", name: "from", required: "" })]),
        create("div", { className: "field" }, [create("label", { for: "movementLogTo", text: "Kepada" }), create("select", { className: "input", id: "movementLogTo", name: "to", required: "" })])
      ]),
      create("div", { className: "field" }, [create("label", { for: "movementLogTime", text: "Tarikh dan masa" }), create("input", { className: "input", id: "movementLogTime", name: "movedAt", type: "datetime-local", required: "" })]),
      create("div", { className: "field" }, [create("label", { for: "movementLogNote", text: "Catatan" }), create("textarea", { className: "input", id: "movementLogNote", name: "note", rows: "3", placeholder: "Masukkan catatan jika perlu" })]),
      create("div", { className: "form-actions" }, [
        create("button", { className: "button secondary", type: "button", "data-close": "", text: "Batal" }),
        create("button", { className: "button", type: "submit", text: "Simpan Perubahan" })
      ])
    ])
  );
  document.body.append(modal);
  wireModal(modal);
  return modal;
}

function ensureMovementLogDeleteModal() {
  let modal = document.querySelector("#movementLogDeleteModal");
  if (modal) return modal;
  modal = create("div", { className: "modal hidden", id: "movementLogDeleteModal", role: "dialog", "aria-modal": "true", "aria-labelledby": "movementLogDeleteTitle" },
    create("section", { className: "modal-card delete-modal-card" }, [
      create("div", { className: "modal-head" }, [
        create("div", {}, [create("h2", { id: "movementLogDeleteTitle", text: "Padam Log Pergerakan?" }), create("p", { "data-file-reference": "" })]),
        create("button", { className: "icon-button", type: "button", "data-close": "", "aria-label": "Tutup", text: "×" })
      ]),
      create("p", { className: "delete-warning", text: "Log ini akan dipadam secara kekal. Keberadaan semasa fail akan dikira semula menggunakan log terakhir yang masih ada." }),
      create("div", { className: "form-actions" }, [
        create("button", { className: "button secondary", type: "button", "data-close": "", text: "Batal" }),
        create("button", { className: "button danger delete-confirm-button", type: "button", "data-confirm-delete-movement": "", text: "Ya, Padam Log" })
      ])
    ])
  );
  document.body.append(modal);
  wireModal(modal);
  return modal;
}

function movementMutationError(error, functionName) {
  return missingRpc(error, functionName)
    ? "Jalankan migrasi Supabase 20260908070000_manage_file_movement_logs.sql terlebih dahulu."
    : error.message;
}

function openMovementLogEditor(record, file, onSaved) {
  const modal = ensureMovementLogEditor();
  const holders = movementHolderSuggestions(record);
  fillSelect(modal.elements.from, holders, "Pilih keberadaan asal…");
  fillSelect(modal.elements.to, holders, "Pilih keberadaan baharu…");
  modal.querySelector("[data-file-reference]").textContent = `${file?.transaksi || "Rekod fail"}${file ? ` (Jilid ${file.jilid})` : ""}`;
  modal.elements.from.value = record.dari;
  modal.elements.to.value = record.kepada;
  modal.elements.movedAt.value = movementDateTimeInput(record.tarikh);
  modal.elements.note.value = record.catatan || "";
  modal.onsubmit = async event => {
    event.preventDefault();
    const button = modal.querySelector("button[type=submit]");
    const from = modal.elements.from.value.trim().replace(/\s+/g, " ");
    const to = modal.elements.to.value.trim().replace(/\s+/g, " ");
    const movedAt = modal.elements.movedAt.value;
    if (!from || !to || !movedAt) {
      toast("Maklumat diperlukan", "Lengkapkan Daripada, Kepada serta tarikh dan masa.", "error");
      return;
    }
    setBusy(button, true, "Menyimpan…");
    try {
      const result = await correctMovement(record, {
        from,
        to,
        movedAt: new Date(movedAt).toISOString(),
        note: modal.elements.note.value.trim()
      });
      closeModal(modal);
      await onSaved?.(mapMovement(result.movement), mapFile(result.file));
      toast("Log dikemas kini", "Pembetulan log dan keberadaan fail telah disimpan.");
    } catch (error) {
      toast("Log tidak dapat dikemas kini", movementMutationError(error, "correct_file_movement"), "error");
    } finally { setBusy(button, false); }
  };
  showModal("#movementLogEditModal");
  modal.elements.from.focus();
}

function openMovementLogDelete(record, file, onDeleted) {
  const modal = ensureMovementLogDeleteModal();
  const confirmButton = modal.querySelector("[data-confirm-delete-movement]");
  modal.querySelector("[data-file-reference]").textContent = `${file?.transaksi || "Rekod fail"}${file ? ` (Jilid ${file.jilid})` : ""} · ${record.dari} → ${record.kepada}`;
  confirmButton.onclick = async () => {
    setBusy(confirmButton, true, "Memadam…");
    try {
      const result = await deleteMovement(record);
      closeModal(modal);
      await onDeleted?.(mapFile(result.file));
      toast("Log dipadam", "Log telah dipadam dan keberadaan fail dikira semula.");
    } catch (error) {
      toast("Log tidak dapat dipadam", movementMutationError(error, "delete_file_movement"), "error");
    } finally { setBusy(confirmButton, false); }
  };
  showModal("#movementLogDeleteModal");
  confirmButton.focus();
}

async function openHistory(file, refresh = () => {}) {
  const modal = document.querySelector("#historyModal");
  const list = modal.querySelector("#historyList");
  modal.querySelector("[data-file-reference]").textContent = `${file.transaksi} (Jilid ${file.jilid})`;
  showModal("#historyModal");
  const reload = async () => {
    list.replaceChildren(create("li", { text: "Memuatkan sejarah…" }));
    try {
      const columns = "id,file_id,owner_id,moved_at,from_holder,to_holder,note";
      const rows = await rest("movements", `file_id=eq.${encodeURIComponent(file.id)}&select=${columns}&order=moved_at.desc`);
      const records = rows.map(mapMovement);
      list.replaceChildren();
      if (!records.length) list.append(create("li", { text: "Tiada rekod pergerakan." }));
      records.forEach(record => {
        const actionCallback = async updatedFile => {
          Object.assign(file, updatedFile);
          await refreshLastMovementDate(file.id);
          refresh();
          await reload();
        };
        list.append(create("li", {}, [
          create("div", { className: "history-entry-copy" }, [
            create("strong", { text: `${record.dari} → ${record.kepada}` }),
            record.catatan ? create("div", { text: record.catatan }) : null,
            create("time", { text: formatDate(record.tarikh, true) })
          ]),
          create("div", { className: "history-entry-actions" }, [
            create("button", { className: "button secondary small", type: "button", text: "Edit", "aria-label": `Edit log ${record.dari} kepada ${record.kepada}`, onclick: () => openMovementLogEditor(record, file, async (_updatedRecord, updatedFile) => actionCallback(updatedFile)) }),
            create("button", { className: "button secondary small movement-log-delete-button", type: "button", text: "Padam", "aria-label": `Padam log ${record.dari} kepada ${record.kepada}`, onclick: () => openMovementLogDelete(record, file, actionCallback) })
          ])
        ]));
      });
    } catch (error) {
      list.replaceChildren(create("li", { text: `Sejarah tidak dapat dimuatkan: ${error.message}` }));
    }
  };
  await reload();
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
  // Tolerate en dashes, spaces around separators and leading zeros ("600 – 12 / 01").
  const classificationCode = value => (String(value || "").trim()
    .replace(/[‐-―−]/g, "-")
    .replace(/\s*([-/])\s*/g, "$1")
    .match(/^(\d+(?:[-/]\d+)*)/)?.[1] || "")
    .replace(/\d+/g, digits => String(Number(digits)));
  const hasChildCode = (value, parentCode) => {
    const code = classificationCode(value);
    return Boolean(parentCode && (code === parentCode || code.startsWith(`${parentCode}-`) || code.startsWith(`${parentCode}/`)));
  };
  const selectValue = (select, value) => {
    select.value = value || "";
    if (value && select.value !== value) select.append(create("option", { value, text: value }));
    select.value = value || "";
  };
  const fillFilteredSelect = (key, parentValue, select = form.elements[key]) => {
    const parentCode = classificationCode(parentValue);
    const values = parentCode ? (settings[key] || []).filter(value => hasChildCode(value, parentCode)) : [];
    fillSelect(select, values);
    return values;
  };
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
  // The closest parent by code, e.g. "600-12/1/3" -> "600-12/1 …" (or "600-12 …" when the
  // sub-activity is not listed in Tetapan, so the levels above are still filled).
  const findParent = (key, value) => (settings[key] || [])
    .filter(parent => hasChildCode(value, classificationCode(parent)))
    .sort((a, b) => classificationCode(b).length - classificationCode(a).length)[0] || "";
  // Picking any level fills the levels above it, keeps the levels below that still belong,
  // and fills a lower level automatically when only one choice remains.
  const syncClassification = changedKey => {
    const changedIndex = ids.indexOf(changedKey);
    const chosen = ids.map(id => form.elements[id].value);
    const changedValue = chosen[changedIndex];
    for (let index = 0; index < changedIndex; index += 1) {
      if (changedValue) chosen[index] = findParent(ids[index], changedValue);
    }
    ids.forEach((id, index) => {
      const ancestor = chosen.slice(0, index).reverse().find(Boolean);
      const values = index && ancestor ? fillFilteredSelect(id, ancestor) : (fillSelect(form.elements[id], settings[id] || []), settings[id] || []);
      if (index > changedIndex && !changedValue) chosen[index] = "";
      else if (index > changedIndex) {
        if (chosen[index] && !values.includes(chosen[index])) chosen[index] = "";
        if (!chosen[index] && values.length === 1) chosen[index] = values[0];
      }
      selectValue(form.elements[id], chosen[index]);
    });
    updateDuplicateStatus();
  };
  ids.forEach(id => fillSelect(form.elements[id], settings[id] || []));
  ids.forEach(id => form.elements[id].addEventListener("change", () => syncClassification(id)));
  form.elements.jilid.addEventListener("input", updateDuplicateStatus);
  form.addEventListener("reset", () => setTimeout(() => { ids.forEach(id => fillSelect(form.elements[id], settings[id] || [])); form.elements.jilid.value = 1; updateDuplicateStatus(); }, 0));
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
  const officeSchoolAccountsPanel = document.querySelector("#officeSchoolAccountsPanel");
  let officePanelVisible = false;
  if (officeSchoolAccountsPanel) {
    try {
      const officeProfile = isAgencyOwner
        ? { id: user.id, agency_type: user.data?.jenis || "" }
        : user.role === "staff" ? await rpc("ped_workspace_profile", {}) : null;
      if (String(officeProfile?.agency_type || "").trim().toLocaleLowerCase("ms") === "pejabat") {
        officeSchoolAccountsPanel.classList.remove("hidden");
        officePanelVisible = true;
        const accountRows = document.querySelector("#officeSchoolAccountRows");
        const editSchoolModal = document.querySelector("#officeSchoolAccountEditModal");
        let officeSchools = [];
        let officeSchoolUsageAvailable = true;
        const renderOfficeSchools = () => {
          accountRows.replaceChildren();
          if (!officeSchools.length) {
            accountRows.append(create("tr", {}, create("td", { colspan: "5", className: "empty-row", text: "Tiada akaun sekolah didaftarkan di bawah pejabat ini." })));
            return;
          }
          officeSchools.forEach(school => accountRows.append(create("tr", {}, [
            create("td", { text: school.name || "Nama sekolah tidak dinyatakan" }),
            create("td", { text: school.email || "E-mel tidak tersedia" }),
            create("td", {}, create("span", { className: "badge archive", text: "Aktif" })),
            create("td", {}, create("div", { className: "staff-usage-log" }, [
              create("strong", { text: officeSchoolUsageAvailable ? `${school.loginCount} kali log masuk` : "Belum tersedia" }),
              create("span", { text: officeSchoolUsageAvailable && school.lastLoginAt ? `Terakhir: ${formatDate(school.lastLoginAt, true)}` : "Tiada rekod penggunaan" })
            ])),
            create("td", { className: "staff-account-actions" }, create("button", { className: "button secondary small staff-account-edit", type: "button", text: "Edit", "aria-label": `Edit akaun ${school.name}`, onclick: () => {
              editSchoolModal.querySelector("[data-school-account-reference]").textContent = "Kemas kini nama sekolah, e-mel log masuk atau kata laluan.";
              editSchoolModal.elements.nama.value = school.name;
              editSchoolModal.elements.emel.value = school.email;
              editSchoolModal.elements.password.value = "";
              editSchoolModal.onsubmit = async event => {
                event.preventDefault();
                const data = Object.fromEntries(new FormData(editSchoolModal));
                const button = editSchoolModal.querySelector("button[type=submit]");
                setBusy(button, true, "Menyimpan…");
                try {
                  const updated = await callAdminFunction("office-update-school-account", {
                    id: school.id,
                    name: data.nama,
                    email: data.emel,
                    password: data.password
                  });
                  school.name = updated.name;
                  school.email = updated.email;
                  closeModal(editSchoolModal);
                  renderOfficeSchools();
                  toast("Akaun sekolah dikemas kini", data.password ? "Nama, e-mel dan kata laluan akaun sekolah telah dikemas kini." : "Nama dan e-mel akaun sekolah telah dikemas kini.");
                } catch (error) {
                  toast("Akaun sekolah tidak dapat dikemas kini", error.message, "error");
                } finally { setBusy(button, false); }
              };
              showModal("#officeSchoolAccountEditModal");
              editSchoolModal.elements.nama.focus();
            } }))
          ])));
        };
        const loadOfficeSchools = async () => {
          const baseQuery = `role=eq.agency&agency_type=ilike.sekolah&ped_office_id=eq.${encodeURIComponent(officeProfile.id)}`;
          let rows;
          officeSchoolUsageAvailable = true;
          try {
            rows = await rest("profiles", `${baseQuery}&select=id,name,email,login_count,last_login_at&order=name.asc`);
          } catch (error) {
            if (!/login_count|last_login_at/i.test(error.message)) throw error;
            officeSchoolUsageAvailable = false;
            rows = await rest("profiles", `${baseQuery}&select=id,name,email&order=name.asc`);
          }
          officeSchools = rows.map(row => ({
            id: row.id,
            name: String(row.name || "").trim(),
            email: row.email || "",
            loginCount: Number(row.login_count || 0),
            lastLoginAt: row.last_login_at || null
          }));
          renderOfficeSchools();
        };
        await loadOfficeSchools();
      }
    } catch (error) {
      if (officePanelVisible) {
        officeSchoolAccountsPanel.classList.remove("hidden");
        const status = document.querySelector("#officeSchoolAccountsStatus");
        status.classList.remove("hidden");
        status.textContent = `Senarai akaun sekolah tidak dapat dimuatkan: ${error.message}`;
      }
    }
  }
  let staffUsersError = null;
  if (isAgencyOwner) {
    try { await loadStaffUsers(); }
    catch (error) { staffUsersError = error; }
  }
  const linkedAccountFor = person => state.staffUsers.find(account =>
    (person.user_id && account.id === person.user_id)
    || normalizeSettingValue(account.name) === normalizeSettingValue(person.nama)
  );
  const withDirectoryAccountLink = person => {
    if (!isAgencyOwner || staffUsersError) return person;
    const account = linkedAccountFor(person);
    if (!account) {
      const { user_id, email, avatar_key, ...unlinkedPerson } = person;
      return unlinkedPerson;
    }
    return { ...person, user_id: account.id, email: account.email, avatar_key: account.avatarKey };
  };
  if (isAgencyMember) {
    document.querySelector("#settingsTitle").textContent = "Tetapan Agensi";
    document.querySelector("#settingsSubtitle").textContent = `Konfigurasi khusus untuk ${user.data.nama || user.email}`;
    document.querySelector("#settingsScope").textContent = "Semua perubahan di halaman ini hanya digunakan oleh agensi anda dan tidak mengubah data agensi lain.";
  } else {
    document.querySelector("#settingsScope").textContent = "Tetapan ini dimiliki oleh akaun pentadbir dan diasingkan daripada tetapan setiap agensi.";
  }
  const grid = document.querySelector("#settingsGrid");
  const bulkPanel = document.querySelector("#bulkSettingsPanel");
  if (isAgencyOwner && bulkPanel) {
    bulkPanel.classList.remove("hidden");
    const bulkForm = document.querySelector("#bulkSettingsForm");
    bulkForm.addEventListener("submit", async event => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(bulkForm));
      const category = String(data.category || "");
      const values = String(data.values || "").split(/\r?\n/).map(value => value.trim()).filter(Boolean);
      if (!values.length) {
        toast("Data diperlukan", "Masukkan sekurang-kurangnya satu rekod pada baris baharu.", "error");
        bulkForm.elements.values.focus();
        return;
      }
      if (values.length > 500) {
        toast("Terlalu banyak rekod", "Maksimum 500 rekod dibenarkan bagi setiap pengisian.", "error");
        return;
      }
      const button = bulkForm.querySelector("button[type=submit]");
      setBusy(button, true, "Menyimpan…");
      try {
        const result = await rpc("bulk_add_agency_settings", { p_category: category, p_values: values });
        const addedValues = Array.isArray(result?.added_values) ? result.added_values : [];
        settings[category].push(...addedValues);
        settings[category].sort((first, second) => classificationCollator.compare(first, second));
        bulkForm.elements.values.value = "";
        render();
        if (result.added_count) {
          toast("Data pukal berjaya", `${result.added_count} rekod ${labels[category]} ditambah${result.skipped_count ? `; ${result.skipped_count} rekod pendua dilangkau` : ""}.`);
        } else {
          toast("Tiada data baharu", "Semua rekod yang dimasukkan telah wujud.", "error");
        }
      } catch (error) {
        const message = missingRpc(error, "bulk_add_agency_settings")
          ? "Jalankan migrasi Supabase 20260908010000_add_agency_bulk_settings.sql terlebih dahulu."
          : error.message;
        toast("Data pukal tidak dapat disimpan", message, "error");
      } finally { setBusy(button, false); }
    });
  }
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
    settings.pegawai[index] = withDirectoryAccountLink(person);
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
      const linkedAccount = linkedAccountFor(person);
      const isLinked = Boolean(person.user_id || linkedAccount);
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
          const nextPerson = { nama: formatPersonName(nameInput.value), sektor: sectorInput.value.trim() };
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
      const identity = create("div", { className: "staff-directory-identity" }, [
        create("span", { text: `${person.nama} — ${person.sektor}` }),
        isLinked ? create("span", {
          className: "staff-sync-badge",
          text: "Diselaraskan",
          title: linkedAccount?.email ? `Dipautkan kepada ${linkedAccount.email}` : "Dipautkan kepada akaun pengguna pegawai"
        }) : null
      ]);
      item.append(identity, create("div", { className: "item-actions" }, [edit, remove]));
      staffList.append(item);
    });
  };
  staffForm.addEventListener("submit", async event => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(staffForm));
    const person = withDirectoryAccountLink({ nama: formatPersonName(data.nama), sektor: data.sektor.trim() });
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
    const directoryNames = document.querySelector("#staffDirectoryNames");
    settings.pegawai.forEach(person => directoryNames.append(create("option", { value: person.nama })));
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
      const nameInput = editAccountModal.elements.nama;
      const emailInput = editAccountModal.elements.emel;
      const passwordInput = editAccountModal.elements.password;
      const selectedAvatar = editAccountModal.querySelector(`input[name=avatar][value="${person.avatarKey}"]`)
        || editAccountModal.querySelector("input[name=avatar][value=initials]");
      const initialsPreview = editAccountModal.querySelector("input[name=avatar][value=initials] + .avatar-choice");
      const updateEditInitials = () => { initialsPreview.textContent = avatarPresentation("initials", nameInput.value).symbol; };
      reference.textContent = "Kemas kini identiti, akses dan avatar pengguna ini.";
      nameInput.value = person.name;
      emailInput.value = person.email;
      passwordInput.value = "";
      selectedAvatar.checked = true;
      nameInput.oninput = updateEditInitials;
      updateEditInitials();
      editAccountModal.onsubmit = async event => {
        event.preventDefault();
        const data = Object.fromEntries(new FormData(editAccountModal));
        const button = editAccountModal.querySelector("button[type=submit]");
        setBusy(button, true, "Menyimpan…");
        try {
          const updatedAccount = await callAdminFunction("agency-update-staff", {
            id: person.id,
            name: formatPersonName(data.nama),
            email: data.emel.trim().toLowerCase(),
            password: data.password,
            avatar: data.avatar
          });
          const linkedDirectoryEntry = settings.pegawai.find(entry => entry.user_id === person.id)
            || settings.pegawai.find(entry => normalizeSettingValue(entry.nama) === normalizeSettingValue(person.name));
          if (linkedDirectoryEntry) {
            linkedDirectoryEntry.nama = updatedAccount.name;
            linkedDirectoryEntry.email = updatedAccount.email;
            linkedDirectoryEntry.avatar_key = updatedAccount.avatar;
            linkedDirectoryEntry.user_id = person.id;
          }
          await loadStaffUsers();
          closeModal(editAccountModal);
          renderStaffUsers();
          renderStaff();
          toast("Akaun dikemas kini", data.password ? "Nama, e-mel, avatar dan kata laluan pegawai telah dikemas kini." : "Nama, e-mel dan avatar pegawai telah dikemas kini.");
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
          const directoryPerson = settings.pegawai.find(person => normalizeSettingValue(person.nama) === normalizeSettingValue(data.nama));
          const accountName = formatPersonName(directoryPerson?.nama || data.nama);
          const createdAccount = await callAdminFunction("agency-create-staff", {
            name: accountName,
            email: data.emel.trim().toLowerCase(),
            password: data.password,
            avatar: data.avatar
          });
          if (directoryPerson) {
            directoryPerson.user_id = createdAccount.id;
            directoryPerson.email = createdAccount.email;
            directoryPerson.avatar_key = createdAccount.avatar || data.avatar;
          }
          await loadStaffUsers();
          accountForm.reset();
          updateAvatarPreviews();
          renderStaffUsers();
          renderStaff();
          toast(
            "Akaun berjaya dicipta",
            directoryPerson
              ? "Akaun telah diselaraskan dengan Direktori Pegawai Penerima dan sedia menerima notifikasi fail."
              : "Pegawai kini boleh log masuk menggunakan e-mel dan kata laluan yang didaftarkan."
          );
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

const pedLetterNumberSeparator = " · No. Surat ";

function splitPedOutgoingReference(reference) {
  const value = String(reference || "");
  const separatorIndex = value.lastIndexOf(pedLetterNumberSeparator);
  if (separatorIndex < 0) return { fileReference: value, letterNumber: "" };
  const letterNumber = value.slice(separatorIndex + pedLetterNumberSeparator.length);
  if (!/^[0-9]+$/.test(letterNumber)) return { fileReference: value, letterNumber: "" };
  return { fileReference: value.slice(0, separatorIndex), letterNumber };
}

const pedCategoryMeta = {
  agency_in: {
    title: "Surat Masuk Jabatan dan Agensi", party: "Daripada", date: "Tarikh Terima",
    referenceLabel: "No. Fail Rujukan & Tarikh", statuses: ["Belum diminit", "Dalam proses", "Sudah diminit", "Selesai"], defaultStatus: "Belum diminit"
  },
  school_in: {
    title: "Surat Masuk Sekolah", party: "Nama Sekolah", date: "Tarikh Terima",
    referenceLabel: "No. Fail Rujukan & Tarikh", statuses: ["Belum diminit", "Dalam proses", "Sudah diminit", "Dihantar", "Diterima", "Selesai", "Dikembalikan", "Dihantar Semula"], defaultStatus: "Belum diminit"
  },
  school_received: {
    title: "Surat Masuk", party: "Daripada", date: "Tarikh Terima",
    referenceLabel: "No. Fail Rujukan & Tarikh", statuses: ["Belum diminit", "Dalam proses", "Sudah diminit", "Selesai"], defaultStatus: "Belum diminit"
  },
  outgoing: {
    title: "Surat Keluar", party: "Kepada", date: "Tarikh Surat",
    referenceLabel: "No. Fail Rujukan", statuses: ["Dihantar", "Diterima", "Dalam proses", "Selesai"], defaultStatus: "Dihantar"
  }
};

const pedFormOptions = {
  schools: [
    "SK BUKIT LUBA", "SK KUBONG", "SK BATU EMPAT", "SK KAMPUNG PAHLAWAN", "SK LIMPAKU PINANG",
    "SK TEDUNGAN (BAMBANGAN)", "SK MELAYU PUSAT", "SK GADONG", "SK BATU DANAU", "SK LIMPAKI",
    "SK TELAHAK", "SK SUNGAI POYAN", "SK KUALA AWANG", "SK PENGKALAN JAWA", "SK MERAMBUT",
    "SK TIGA KAMPUNG", "SK TANJONG", "SK LUBOK TEKUROK", "SK MERITAM", "SK BANDAR", "SK LIMBANG",
    "SK UKONG", "SK NANGA MEDAMIT", "SK MENUANG", "SK KUALA PENGANAN", "SK LONG NAPIR",
    "SK NANGA MERIT", "SK KUALA MEDALAM", "SK ULU LUBAI", "SK MELABAN", "SK BUKIT BATU",
    "SK ST EDMUND", "SK RC KUBONG", "SJK (C) CHUNG HWA", "SJK (C) YUK HIN", "SMK SERI PATIAMBUN",
    "SMK KUBONG", "SMK MEDAMIT", "SMK LIMBANG", "SMK AGAMA LIMBANG"
  ],
  sectors: [
    "SEKTOR PEMBANGUNAN MURID", "SEKTOR PEMBELAJARAN", "SEKTOR PENGURUSAN SEKOLAH", "SEKTOR PENGURUSAN",
    "SEKTOR PERANCANGAN", "PPD", "PASUKAN TEKNIKAL ICT SEKOLAH", "SEKTOR PENTAKSIRAN & PEPERIKSAAN",
    "SEKTOR KAUNSELING", "SEKTOR PSIKOLOGI & KAUNSELING", "UNIT SUMBER MANUSIA, ICT & PENTADBIRAN AM",
    "UNIT KEWANGAN, INFRASTRUKTUR & PEROLEHAN"
  ],
  schoolSectors: [
    "SEKTOR PEMBANGUNAN MURID", "SEKTOR PEMBELAJARAN", "SEKTOR PENGURUSAN SEKOLAH", "SEKTOR PENGURUSAN",
    "SEKTOR PERANCANGAN", "PPD", "SEKTOR PENTAKSIRAN & PEPERIKSAAN", "SEKTOR KAUNSELING",
    "PASUKAN TEKNIKAL ICT SEKOLAH"
  ],
  deliveryMethods: ["POSLAJU", "POS BIASA", "SERAHAN TANGAN", "E-MEL", "PETI SURAT SEKOLAH"]
};

// PeD printouts follow the office's paper log sheets: crest, boxed title,
// Bil/Perkara/No. Rujukan/Daripada-Kepada/Tarikh table and a signature
// block. The browser's print dialog saves them as PDF ("Save as PDF").
// Empty @page margin boxes stop Chrome adding its own date/title/URL lines.
function escapePrintText(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

const pedPrintStyles = `
@page { size: A4; margin: 16mm 14mm 18mm; @top-left { content: ""; } @top-center { content: ""; } @top-right { content: ""; } @bottom-left { content: ""; } @bottom-center { content: ""; } @bottom-right { content: ""; } }
* { box-sizing: border-box; }
body { margin: 0; color: #000; font: 400 10pt/1.5 Poppins, Inter, "Segoe UI", Arial, sans-serif; background: #fff; }
.sheet + .sheet { break-before: page; }
.letterhead { display: grid; grid-template-columns: 34mm 1fr 34mm; align-items: center; gap: 4mm; margin-bottom: 7mm; }
.letterhead img { width: 34mm; height: auto; }
.title-box { justify-self: center; width: min(100%, 112mm); padding: 3.4mm 5mm; border: 1.5pt solid #000; text-align: center; font-size: 11.5pt; font-weight: 700; letter-spacing: .02em; line-height: 1.35; }
.context { margin: 0 0 4mm; font-size: 10.5pt; font-weight: 700; }
table { width: 100%; border-collapse: collapse; table-layout: fixed; }
thead { display: table-header-group; }
tr { break-inside: avoid; }
th { padding: 2.2mm 2mm; border: .6pt solid #000; color: #000; background: #fff; font-size: 9pt; font-weight: 700; text-align: left; }
td { padding: 2.2mm 2mm; border: .6pt solid #000; vertical-align: top; font-size: 9pt; overflow-wrap: anywhere; }
.col-bil { width: 10mm; text-align: center; }
.col-ref { width: 42mm; }
.col-party { width: 38mm; }
.col-date { width: 22mm; text-align: center; white-space: nowrap; }
.signature { margin-top: 12mm; break-inside: avoid; font-size: 10pt; }
.signature .line { margin: 11mm 0 2mm; width: 70mm; border-bottom: .8pt solid #000; }
.empty { padding: 8mm; border: .6pt solid #000; text-align: center; }
.detail-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 3mm; margin: 0 0 5mm; }
.detail-category { font-size: 9pt; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; }
.detail-status { padding: 1mm 3mm; border: .6pt solid #000; font-size: 8.5pt; font-weight: 700; }
.detail-subject { margin: 0 0 6mm; font-size: 14pt; font-weight: 700; line-height: 1.35; }
.detail th { width: 52mm; font-weight: 700; }
.detail td { font-size: 10pt; }
`;

function pedLetterheadHtml(title) {
  const crest = new URL("assets/ped-letterhead.png", location.href).href;
  return `<header class="letterhead"><img src="${escapePrintText(crest)}" alt="Logo Korporat KPM"><div class="title-box">${escapePrintText(title)}</div><span></span></header>`;
}

function pedLogSheetHtml(section) {
  const rows = section.rows.map((row, index) => `<tr><td class="col-bil">${index + 1}</td><td>${escapePrintText(row.subject || "-")}</td><td class="col-ref">${escapePrintText(row.reference || "-")}</td><td class="col-party">${escapePrintText(row.counterpart || "-")}</td><td class="col-date">${escapePrintText(row.date ? new Intl.DateTimeFormat("ms-MY", { day: "numeric", month: "numeric", year: "numeric" }).format(new Date(`${row.date}T00:00:00`)) : "-")}</td></tr>`).join("");
  return `<section class="sheet">${pedLetterheadHtml(section.title)}`
    + (section.contextValue ? `<p class="context">${escapePrintText(section.contextValue)}</p>` : "")
    + (section.rows.length
      ? `<table><thead><tr><th class="col-bil">Bil</th><th>Perkara</th><th class="col-ref">No. Fail Rujukan</th><th class="col-party">${escapePrintText(section.counterpartLabel)}</th><th class="col-date">Tarikh</th></tr></thead><tbody>${rows}</tbody></table>`
      : `<p class="empty">Tiada rekod surat bagi tapisan ini.</p>`)
    + `<div class="signature"><div>Disahkan Oleh:</div><div class="line"></div><div>(${"&nbsp;".repeat(64)})</div></div></section>`;
}

function pedDetailSheetHtml(detail) {
  const rows = detail.fields.map(([label, value]) => `<tr><th scope="row">${escapePrintText(label)}</th><td>${escapePrintText(value || "-")}</td></tr>`).join("");
  return `<section class="sheet">${pedLetterheadHtml("BUTIRAN SURAT")}<div class="detail-meta"><span class="detail-category">${escapePrintText(detail.category)}</span><span class="detail-status">${escapePrintText(detail.status || "-")}</span></div><h1 class="detail-subject">${escapePrintText(detail.subject || "-")}</h1><table class="detail"><tbody>${rows}</tbody></table></section>`;
}

// Safari (desktop and every iOS browser) and phone browsers print the parent
// page, or nothing, from a hidden iframe, so they print from a new tab instead.
function pedPrintsInNewTab() {
  const agent = navigator.userAgent;
  const appleTouch = /iP(hone|ad|od)/.test(agent) || (/Macintosh/.test(agent) && navigator.maxTouchPoints > 1);
  const desktopSafari = /Safari\//.test(agent) && !/(Chrome|Chromium|CriOS|FxiOS|EdgiOS|Edg|OPR|OPX|SamsungBrowser|Android)\//.test(agent);
  return appleTouch || desktopSafari || /Android/.test(agent) || matchMedia("(pointer: coarse)").matches;
}

async function waitForPrintAssets(printDocument) {
  const images = [...printDocument.images].map(image => image.complete ? null : new Promise(resolve => { image.onload = image.onerror = resolve; }));
  await Promise.race([Promise.all([printDocument.fonts?.ready, ...images]), new Promise(resolve => setTimeout(resolve, 4000))]);
}

async function printPedDocument(documentTitle, sheetsHtml) {
  const html = `<!doctype html><html lang="ms"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapePrintText(documentTitle)}</title>`
    + `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap">`
    + `<style>${pedPrintStyles}</style></head>`
    + `<body>${sheetsHtml}</body></html>`;
  // Opened before the first await so the browser treats it as part of the click.
  const tab = pedPrintsInNewTab() ? window.open("", "_blank") : null;
  if (tab) {
    tab.document.open();
    tab.document.write(html);
    tab.document.close();
    if (tab.document.readyState !== "complete") await new Promise(resolve => tab.addEventListener("load", resolve, { once: true }));
    await waitForPrintAssets(tab.document);
    tab.focus();
    tab.print();
    return;
  }
  document.querySelector("#pedPrintFrame")?.remove();
  const frame = create("iframe", { id: "pedPrintFrame", title: "Cetakan PeD", "aria-hidden": "true", tabindex: "-1" });
  // A page-sized frame off screen: some browsers lay out a 0×0 frame's print at that size.
  frame.style.cssText = "position:fixed;left:-10000px;top:0;width:210mm;height:297mm;border:0;opacity:0;pointer-events:none";
  // Wait for the srcdoc page itself, not an initial about:blank load.
  const loaded = new Promise(resolve => frame.addEventListener("load", function ready() {
    if (!frame.contentDocument?.querySelector(".sheet")) return;
    frame.removeEventListener("load", ready);
    resolve();
  }));
  frame.srcdoc = html;
  document.body.append(frame);
  await loaded;
  await waitForPrintAssets(frame.contentDocument);
  frame.contentWindow.addEventListener("afterprint", () => setTimeout(() => frame.remove(), 1000), { once: true });
  frame.contentWindow.focus();
  frame.contentWindow.print();
}

async function initPed() {
  const shellUser = await initShell();
  if (!shellUser) return;
  // The shell may have been rendered from sessionStorage before this page loads.
  // Refresh the authorization profile so changed agency types and roles take effect.
  const [user, hasPedAccess] = await Promise.all([
    loadProfile(shellUser.id),
    rpc("can_access_ped", {})
  ]);
  renderShell(user);
  if (!hasPedAccess) {
    document.querySelector("#pedComingSoon").classList.remove("hidden");
    document.querySelector("#pedIntro").textContent = "Ruang baharu untuk pengurusan surat anda.";
    markReady();
    return;
  }

  const workspaceProfile = user.role === "staff"
    ? await rpc("ped_workspace_profile", {})
    : {
      id: user.id,
      name: user.data?.nama || "",
      agency_type: user.data?.jenis || "",
      ped_office_id: user.data?.pedOfficeId || null
    };
  if (!workspaceProfile || workspaceProfile.id !== user.ownerId) {
    throw new Error("Profil ruang kerja PeD tidak dapat disahkan. Hubungi pentadbir sistem.");
  }

  document.querySelector("#pedComingSoon").classList.add("hidden");
  document.querySelector("#pedWorkspace").classList.remove("hidden");
  const pedOwnerId = workspaceProfile.id;
  const workspaceAgencyType = String(workspaceProfile.agency_type || "").trim().toLocaleLowerCase("ms-MY");
  const schoolAccount = user.role !== "admin" && workspaceAgencyType === "sekolah";
  const officeAccount = user.role !== "admin" && workspaceAgencyType === "pejabat";
  const canDeletePedRecord = record => {
    if (!record) return false;
    if (user.role === "admin") return record.category !== "school_received";
    if (record.ownerId === pedOwnerId) return true;
    return officeAccount && record.category === "school_in" && record.officeId === pedOwnerId;
  };
  // Row Level Security refuses a delete silently (204, no rows), so ask for the
  // deleted row back and treat "nothing deleted" as a failure.
  const deletePedRecord = async record => {
    const removed = await rest("ped_correspondence", `id=eq.${encodeURIComponent(record.id)}&select=id`, {
      method: "DELETE",
      headers: { Prefer: "return=representation" }
    });
    if (!removed?.length) {
      throw new Error("Surat ini tidak dipadam kerana pangkalan data menolak akses atau surat telah tiada. Muat semula halaman PeD dan cuba lagi.");
    }
  };
  const activeCategories = schoolAccount ? ["school_received", "school_in"] : ["agency_in", "school_in", "outgoing"];
  document.querySelectorAll("[data-ped-section]").forEach(section => {
    section.classList.toggle("hidden", !activeCategories.includes(section.dataset.pedSection));
  });
  if (schoolAccount) {
    document.querySelector(".ped-stats").classList.add("ped-stats-school");
    document.querySelector(".ped-table-stack").classList.add("ped-table-stack-school");
    document.querySelector("#pedIntro").textContent = "Urus Surat Masuk sekolah dan Surat Keluar kepada Pejabat yang ditetapkan.";
    document.querySelector('[data-ped-title="school_in"]').textContent = "Surat Keluar";
    document.querySelector('[data-ped-section="school_in"] .ped-stat-value > span').textContent = "surat dihantar";
    document.querySelector("#pedSchoolTitle").textContent = "Surat Keluar";
    document.querySelector("#pedSchoolDescription").textContent = "Surat sekolah yang dihantar kepada Pejabat. Rekod yang sama dipaparkan sebagai Surat Masuk Sekolah di Pejabat.";
    document.querySelector('[data-ped-section="school_in"] .table-wrap').setAttribute("aria-label", "Jadual surat keluar sekolah");
    document.querySelector('[data-ped-pagination="school_in"]').setAttribute("aria-label", "Halaman surat keluar sekolah");
  }
  // Show the authorized workspace immediately. Data tables keep their loading
  // rows until the parallel Supabase requests below have completed.
  markReady();
  const pedLoadWarnings = [];
  let assignedOffice = null;
  let assignedSchools = [];
  const [recordsResult, settingsResult, filesResult, officeResult, schoolsResult] = await Promise.allSettled([
    loadPedRecords(), loadSettings(), loadFiles(),
    schoolAccount ? (async () => {
      const officeId = workspaceProfile.ped_office_id;
      if (!officeId) return [];
      const office = (await rest("profiles", `id=eq.${encodeURIComponent(officeId)}&select=id,name`))?.[0];
      return [{ ped_office_id: officeId, office_name: office?.name || "Pejabat" }];
    })() : Promise.resolve([]),
    officeAccount ? rest("profiles", `ped_office_id=eq.${encodeURIComponent(pedOwnerId)}&role=eq.agency&select=id,name&order=name.asc`) : Promise.resolve([])
  ]);
  if (recordsResult.status === "rejected") {
    state.pedRecords = [];
    pedLoadWarnings.push(`Rekod surat: ${recordsResult.reason?.message || "tidak dapat dimuatkan"}`);
    console.error("Rekod PeD tidak dapat dimuatkan.", recordsResult.reason);
  }
  if (settingsResult.status === "rejected") {
    state.settings = { pegawai: [] };
    pedLoadWarnings.push(`Direktori pegawai: ${settingsResult.reason?.message || "tidak dapat dimuatkan"}`);
    console.error("Direktori pegawai untuk PeD tidak dapat dimuatkan.", settingsResult.reason);
  }
  if (filesResult.status === "rejected") {
    state.files = [];
    pedLoadWarnings.push(`Senarai fail berdaftar: ${filesResult.reason?.message || "tidak dapat dimuatkan"}`);
    console.error("Fail rujukan PeD tidak dapat dimuatkan.", filesResult.reason);
  }
  if (officeResult.status === "fulfilled") {
    const profile = officeResult.value?.[0];
    assignedOffice = profile?.ped_office_id ? { id: profile.ped_office_id, name: profile.office_name } : null;
  } else if (schoolAccount) {
    pedLoadWarnings.push(`Pejabat sekolah: ${officeResult.reason?.message || "tidak dapat dimuatkan"}`);
  }
  if (schoolsResult.status === "fulfilled") assignedSchools = schoolsResult.value || [];
  else if (officeAccount) pedLoadWarnings.push(`Senarai sekolah: ${schoolsResult.reason?.message || "tidak dapat dimuatkan"}`);
  if (officeAccount && !assignedSchools.length) {
    document.querySelector('[data-add-ped="school_in"]').disabled = true;
    document.querySelector("#pedSchoolDescription").textContent = "Admin sistem perlu menetapkan sekurang-kurangnya satu sekolah kepada Pejabat ini sebelum rekod baharu boleh ditambah.";
  }
  if (schoolAccount && !assignedOffice) {
    document.querySelector('[data-add-ped="school_in"]').disabled = true;
    document.querySelector("#pedWorkspace").prepend(create("p", {
      className: "notice error",
      text: "Pejabat penerima belum ditetapkan. Hubungi admin sistem untuk memilih Pejabat bagi akaun sekolah ini sebelum menambah Surat Keluar."
    }));
    pedLoadWarnings.push("Pejabat penerima belum ditetapkan untuk sekolah ini. Admin sistem perlu memilih Pejabat pada Pengurusan Pengguna");
  }

  const search = document.querySelector("#pedSearch");
  const statusFilter = document.querySelector("#pedStatusFilter");
  const dateFrom = document.querySelector("#pedDateFrom");
  const dateTo = document.querySelector("#pedDateTo");
  const pageSize = 10;
  const tableState = Object.fromEntries(activeCategories.map(category => [category, { page: 0, dateAscending: false }]));
  const form = document.querySelector("#pedForm");
  const modal = document.querySelector("#pedModal");
  const modalTitle = document.querySelector("#pedModalTitle");
  const partyLabel = document.querySelector("#pedCorrespondentLabel");
  const dateLabel = document.querySelector("#pedDateLabel");
  const submitButton = form.querySelector('button[type="submit"]');
  const deleteRecordButton = document.querySelector("#pedDeleteRecord");
  const printRecordButton = document.querySelector("#pedPrintRecord");
  const partyTextField = document.querySelector("#pedPartyTextField");
  const partyInput = document.querySelector("#pedCorrespondent");
  const schoolNameSelect = document.querySelector("#pedSchoolName");
  const referenceTextField = document.querySelector("#pedReferenceTextField");
  const referenceInput = document.querySelector("#pedReference");
  const referenceLabel = document.querySelector("#pedReferenceLabel");
  const outgoingReferenceField = document.querySelector("#pedOutgoingReferenceField");
  const outgoingReferenceSelect = document.querySelector("#pedOutgoingReference");
  const registeredReferenceControl = document.querySelector("#pedRegisteredReferenceControl");
  const manualReferenceControl = document.querySelector("#pedManualReferenceControl");
  const manualReferenceInput = document.querySelector("#pedManualReference");
  const schoolReferenceModes = document.querySelector("#pedSchoolReferenceModes");
  const referenceModeInputs = [...schoolReferenceModes.querySelectorAll('input[name="ped_reference_mode"]')];
  const letterNumberField = document.querySelector("#pedLetterNumberField");
  const letterNumberInput = document.querySelector("#pedLetterNumber");
  const letterNumberHint = letterNumberField.querySelector(".field-hint");
  const statusSelect = document.querySelector("#pedStatus");
  const attachmentInput = document.querySelector("#pedAttachment");
  const attachmentName = document.querySelector("#pedAttachmentName");
  const viewAttachmentButton = document.querySelector("#pedViewAttachment");
  const clearAttachmentButton = document.querySelector("#pedClearAttachment");
  let selectedAttachment = null;
  let clearExistingAttachment = false;

  const recipientDirectoryNames = [...new Set((state.settings?.pegawai || []).map(person => formatPersonName(person.nama)).filter(Boolean))];
  const officeReferenceFileSelect = document.querySelector("#pedOfficeReferenceFile");
  const officePersonalFileNumberInput = document.querySelector("#pedOfficePersonalFileNumber");
  const officeReferenceLetterNumberField = document.querySelector("#pedOfficeReferenceLetterNumberField");
  const officeReferenceLetterNumberInput = document.querySelector("#pedOfficeReferenceLetterNumber");
  const registryFileNumberSelect = document.querySelector("#pedRegistryFileNumber");
  const registryLetterNumberField = document.querySelector("#pedRegistryLetterNumberField");
  const registryLetterNumberInput = document.querySelector("#pedRegistryLetterNumber");
  const registeredFileOptions = state.files.map(file => `${file.transaksi} (Jilid ${file.jilid})`);
  fillSelect(officeReferenceFileSelect, registeredFileOptions, "Pilih fail yang telah didaftarkan");
  fillSelect(registryFileNumberSelect, registeredFileOptions, "Pilih fail yang telah didaftarkan");
  fillSelect(outgoingReferenceSelect, registeredFileOptions, "Pilih fail yang telah didaftarkan");
  if (officeAccount) {
    schoolNameSelect.replaceChildren(
      create("option", { value: "", text: "Pilih sekolah" }),
      ...assignedSchools.map(school => create("option", { value: school.id, text: school.name }))
    );
  } else fillSelect(schoolNameSelect, pedFormOptions.schools, "Pilih sekolah");
  fillSelect(document.querySelector("#pedSchoolSector"), pedFormOptions.schoolSectors, "Pilih sektor");
  fillSelect(document.querySelector("#pedOriginSector"), pedFormOptions.sectors, "Pilih sektor");
  fillSelect(document.querySelector("#pedAssignedTo"), recipientDirectoryNames, "Pilih pegawai");
  fillSelect(document.querySelector("#pedSchoolReceivedOfficer"), recipientDirectoryNames, "Pilih pegawai");
  [
    ["#pedDepartmentSectors", pedFormOptions.sectors],
    ["#pedAssignedOfficers", recipientDirectoryNames],
    ["#pedDeliveryMethods", pedFormOptions.deliveryMethods]
  ].forEach(([selector, values]) => {
    document.querySelector(selector).replaceChildren(...values.map(value => create("option", { value, text: value })));
  });
  // Only statuses that can occur in this account's own tables are offered.
  const allStatuses = [...new Set(activeCategories.flatMap(category => pedCategoryMeta[category].statuses))];
  fillSelect(statusFilter, allStatuses, "Semua status");

  const pedStatusVisuals = {
    baru: { tone: "new", paths: ["M6 2.8h5.5L16 7v10.2H5V2.8h1Z", "M11.5 3v4.5H16", "M8 11h5M8 14h5"] },
    "belum diminit": { tone: "pending", paths: ["M10 2.5a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15Z", "M10 6v4.5l3 1.8"] },
    "dalam proses": { tone: "processing", paths: ["M16.8 6.2A7 7 0 0 0 5 5.7L3.5 7.2", "M3.5 3.8v3.5H7", "M3.2 13.8A7 7 0 0 0 15 14.3l1.5-1.5", "M16.5 16.2v-3.5H13"] },
    "dalam tindakan": { tone: "action", paths: ["M12 16.5a4.5 4.5 0 0 0-9 0", "M7.5 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z", "M15 10.5v5", "M12.5 13h5"] },
    "sudah diminit": { tone: "reviewed", paths: ["M10 2.7 12 4l2.5-.2 1 2.2 2 1.3-.6 2.5.6 2.5-2 1.3-1 2.2L12 15.6l-2 1.3-2.5-1.3-2.5.2-1-2.2-2-1.3.6-2.5L2 7.3l2-1.3 1-2.2L7.5 4l2.5-1.3Z", "m6.5 10 2.2 2.2 4.8-4.8"] },
    dihantar: { tone: "sent", paths: ["m2.5 9.5 15-6-6 15-2.2-6.8-6.8-2.2Z", "m9.3 11.7 4-4"] },
    "dihantar semula": { tone: "resent", paths: ["M16.5 6.5H7a4 4 0 0 0 0 8h1", "m14 4 2.5 2.5L14 9", "M3.5 13.5H13a4 4 0 0 0 0-8h-1", "m6 16-2.5-2.5L6 11"] },
    diterima: { tone: "received", paths: ["M3 8h14l1.5 8h-17L3 8Z", "M3 8l2-4h10l2 4", "m7 11 2 2 4-4"] },
    dikembalikan: { tone: "returned", paths: ["M4 7V3.5L1.5 6 4 8.5V7h8a4.5 4.5 0 1 1-4.5 4.5", "M8 11.5 7.5 13A4.5 4.5 0 1 0 12 7"] },
    selesai: { tone: "complete", paths: ["M10 2.5a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15Z", "m6.3 10.2 2.4 2.4 5-5"] }
  };
  const pedStatusVisual = status => {
    const key = String(status || "").trim().toLocaleLowerCase("ms-MY");
    return pedStatusVisuals[key] || pedStatusVisuals.baru;
  };
  const pedStatusIcon = status => create("svg", {
    className: "ped-status-icon",
    viewBox: "0 0 20 20",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "1.7",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "aria-hidden": "true"
  }, pedStatusVisual(status).paths.map(d => create("path", { d })));
  const pedPickerStates = new Map();
  const refreshPedPicker = select => {
    const picker = pedPickerStates.get(select);
    if (!picker) return;
    const selectedOptions = [...select.options].filter(option => option.selected && option.value);
    picker.selected.replaceChildren();
    if (picker.multiple) {
      selectedOptions.forEach(option => {
        const chip = create("span", { className: "ped-picker-chip" }, [
          create("span", { text: option.textContent }),
          create("button", { type: "button", text: "×", "aria-label": `Buang ${option.textContent}` })
        ]);
        chip.querySelector("button").addEventListener("click", () => {
          option.selected = false;
          select.dispatchEvent(new Event("change", { bubbles: true }));
        });
        picker.selected.append(chip);
      });
      if (document.activeElement !== picker.input) picker.input.value = "";
    } else if (document.activeElement !== picker.input) {
      picker.input.value = picker.status && !picker.inlineValue ? "" : selectedOptions[0]?.textContent || "";
    }
    if (picker.status && !picker.inlineValue && selectedOptions[0]) {
      const visual = pedStatusVisual(selectedOptions[0].value);
      picker.selected.append(create("span", { className: `ped-status-preview ped-tone-${visual.tone}` }, [
        pedStatusIcon(selectedOptions[0].value),
        create("span", { text: selectedOptions[0].textContent })
      ]));
    }
    picker.input.setCustomValidity(picker.required && !select.value ? "Sila pilih satu pilihan daripada senarai." : "");
    if (picker.open) picker.renderMenu();
  };
  const mountPedPicker = select => {
    const multiple = select.multiple;
    const required = select.required;
    select.required = false;
    select.tabIndex = -1;
    select.setAttribute("aria-hidden", "true");
    select.classList.add("ped-picker-source");
    const wrapper = create("div", { className: "ped-picker" });
    const input = create("input", {
      className: "input ped-picker-search",
      id: `${select.id}PickerSearch`,
      type: "search",
      role: "combobox",
      // A wrapping <label> also contains the option texts, so prefer its caption span.
      "aria-label": select.closest("label")?.querySelector(":scope > span")?.textContent.trim() || select.labels?.[0]?.textContent.trim() || "Pilihan",
      "aria-autocomplete": "list",
      "aria-haspopup": "listbox",
      "aria-expanded": "false",
      autocomplete: "off",
      placeholder: multiple ? "Taip untuk mencari dan memilih…" : "Taip untuk mencari pilihan…"
    });
    if (select.labels?.[0]) select.labels[0].htmlFor = input.id;
    const selected = create("div", { className: "ped-picker-selected", "aria-live": "polite" });
    const menu = create("div", { className: "ped-picker-menu hidden", role: "listbox", id: `${select.id}PickerOptions` });
    if (multiple) menu.setAttribute("aria-multiselectable", "true");
    input.setAttribute("aria-controls", menu.id);
    wrapper.append(input, selected, menu);
    select.insertAdjacentElement("afterend", wrapper);

    const picker = {
      input, selected, menu, multiple, required,
      status: select.id === "pedStatus" || select.id === "pedStatusFilter",
      // Status dropdowns show the chosen status inside the field, like a native select.
      inlineValue: select.id === "pedStatus" || select.id === "pedStatusFilter",
      open: false,
      query: "",
      renderMenu() {
        const query = this.query.trim().toLocaleLowerCase("ms-MY");
        const choices = [...select.options].filter(option => option.value && option.textContent.toLocaleLowerCase("ms-MY").includes(query));
        menu.replaceChildren();
        if (!multiple && select.value) {
          const clear = create("button", { type: "button", className: "ped-picker-option ped-picker-clear", role: "option", text: "Buang pilihan" });
          clear.addEventListener("mousedown", event => event.preventDefault());
          clear.addEventListener("click", () => {
            select.value = "";
            this.query = "";
            select.dispatchEvent(new Event("change", { bubbles: true }));
            this.close();
            input.value = "";
          });
          menu.append(clear);
        }
        choices.forEach(option => {
          const visual = this.status ? pedStatusVisual(option.value) : null;
          const button = create("button", {
            type: "button",
            className: `ped-picker-option${option.selected ? " selected" : ""}${visual ? ` ped-picker-status ped-tone-${visual.tone}` : ""}`,
            role: "option",
            "aria-selected": String(option.selected)
          }, visual ? [pedStatusIcon(option.value), create("span", { text: option.textContent })] : create("span", { text: option.textContent }));
          button.addEventListener("mousedown", event => event.preventDefault());
          button.addEventListener("click", () => {
            if (multiple) {
              option.selected = !option.selected;
              this.query = input.value;
              select.dispatchEvent(new Event("change", { bubbles: true }));
              input.focus();
            } else {
              select.value = option.value;
              this.query = "";
              this.close();
              input.value = this.status && !this.inlineValue ? "" : option.textContent;
              select.dispatchEvent(new Event("change", { bubbles: true }));
            }
          });
          menu.append(button);
        });
        if (!choices.length) menu.append(create("div", { className: "ped-picker-empty", text: "Tiada pilihan yang sepadan." }));
      },
      show() {
        this.open = true;
        wrapper.classList.add("is-open");
        menu.classList.remove("hidden");
        input.setAttribute("aria-expanded", "true");
        this.renderMenu();
      },
      close() {
        this.open = false;
        this.query = "";
        wrapper.classList.remove("is-open");
        menu.classList.add("hidden");
        input.setAttribute("aria-expanded", "false");
        if (document.activeElement === input) input.blur();
        refreshPedPicker(select);
      }
    };
    pedPickerStates.set(select, picker);
    // Status is a fixed list: a plain dropdown with no typing and no phone keyboard.
    if (picker.status) {
      wrapper.classList.add("ped-picker-dropdown");
      input.type = "text";
      input.setAttribute("inputmode", "none");
      input.setAttribute("aria-autocomplete", "none");
      ["beforeinput", "paste", "drop"].forEach(type => input.addEventListener(type, event => event.preventDefault()));
      input.addEventListener("click", () => { if (!picker.open) picker.show(); });
    }
    input.addEventListener("focus", () => {
      picker.query = "";
      input.value = "";
      picker.show();
    });
    input.addEventListener("input", () => {
      picker.query = input.value;
      if (!multiple) {
        const exact = [...select.options].find(option => option.value && option.textContent.toLocaleLowerCase("ms-MY") === input.value.trim().toLocaleLowerCase("ms-MY"));
        select.value = exact?.value || "";
      }
      refreshPedPicker(select);
    });
    input.addEventListener("keydown", event => {
      if (event.key === "Escape") { event.preventDefault(); picker.close(); input.blur(); }
      if (event.key === "ArrowDown") { event.preventDefault(); menu.querySelector(".ped-picker-option:not(.ped-picker-clear)")?.focus(); }
      if (event.key === "Enter" && picker.open) {
        event.preventDefault();
        menu.querySelector(".ped-picker-option:not(.ped-picker-clear)")?.click();
      }
    });
    menu.addEventListener("keydown", event => {
      if (event.key === "Escape") { event.preventDefault(); picker.close(); input.focus(); return; }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const options = [...menu.querySelectorAll(".ped-picker-option")];
        const current = options.indexOf(document.activeElement);
        const next = event.key === "ArrowDown" ? Math.min(options.length - 1, current + 1) : Math.max(0, current - 1);
        options[next]?.focus();
      }
    });
    select.addEventListener("change", () => refreshPedPicker(select));
    refreshPedPicker(select);
  };
  const setPedPickerRequired = (select, required) => {
    const picker = pedPickerStates.get(select);
    if (!picker) { select.required = required; return; }
    picker.required = required;
    refreshPedPicker(select);
  };
  // Tapisan lanjut choices come from this account's own records plus the form lists.
  const visiblePedRecords = () => state.pedRecords.filter(record => activeCategories.includes(record.category));
  const recordSectors = record => [...record.departmentSectors, record.schoolSector, record.originSector].filter(Boolean);
  const recordOfficers = record => [...record.assignedOfficers, record.assignedTo].filter(Boolean);
  const sortedChoices = values => uniqueRecipientNames(values).sort((first, second) => first.localeCompare(second, "ms"));
  const fillFilterChoices = (selector, values) => {
    const select = document.querySelector(selector);
    const selected = new Set([...select.selectedOptions].map(option => normalizeRecipientName(option.value)));
    select.replaceChildren(...sortedChoices(values).map(value => create("option", {
      value, text: value, ...(selected.has(normalizeRecipientName(value)) ? { selected: "selected" } : {})
    })));
    refreshPedPicker(select);
  };
  const refreshAdvancedChoices = () => {
    const records = visiblePedRecords();
    fillFilterChoices("#pedFilterSectors", [...(schoolAccount ? [] : [...pedFormOptions.sectors, ...pedFormOptions.schoolSectors]), ...records.flatMap(recordSectors)]);
    fillFilterChoices("#pedFilterOfficers", [...recipientDirectoryNames, ...records.flatMap(recordOfficers)]);
    fillFilterChoices("#pedFilterSchools", [
      ...(officeAccount ? assignedSchools.map(school => school.name) : pedFormOptions.schools),
      ...records.filter(record => record.category === "school_in").map(record => record.schoolName || record.correspondent)
    ]);
    fillFilterChoices("#pedFilterDeliveryMethods", [...pedFormOptions.deliveryMethods, ...records.flatMap(record => record.deliveryMethods)]);
  };
  refreshAdvancedChoices();
  document.querySelectorAll('[data-ped-filter-scope="office"]').forEach(field => field.classList.toggle("hidden", schoolAccount));
  document.querySelectorAll("#pedStatusFilter, #pedSchoolName, #pedSchoolSector, #pedAssignedTo, #pedSchoolReceivedOfficer, #pedOriginSector, #pedDepartmentSectors, #pedAssignedOfficers, #pedOfficeReferenceFile, #pedRegistryFileNumber, #pedOutgoingReference, #pedDeliveryMethods, #pedStatus, #pedFilterSectors, #pedFilterOfficers, #pedFilterSchools, #pedFilterDeliveryMethods").forEach(mountPedPicker);
  pedPickerStates.get(statusFilter).input.placeholder = "Semua status";
  let referenceViewOnly = false;
  const schoolUsesManualReference = () => schoolAccount && form.elements.category.value === "school_in"
    && referenceModeInputs.find(input => input.checked)?.value === "manual";
  const syncLetterNumberField = () => {
    const selected = !outgoingReferenceField.classList.contains("hidden")
      && Boolean(schoolUsesManualReference() ? manualReferenceInput.value.trim() : outgoingReferenceSelect.value);
    letterNumberField.classList.toggle("hidden", !selected);
    letterNumberInput.disabled = !selected || referenceViewOnly;
    letterNumberInput.required = !letterNumberInput.disabled;
  };
  const syncReferenceMode = () => {
    const manual = schoolUsesManualReference();
    const outgoing = !outgoingReferenceField.classList.contains("hidden");
    // Class twin of label:has(input:checked) for browsers without :has().
    referenceModeInputs.forEach(input => input.closest("label").classList.toggle("is-checked", input.checked));
    registeredReferenceControl.classList.toggle("hidden", manual);
    manualReferenceControl.classList.toggle("hidden", !manual);
    outgoingReferenceField.querySelector("label").htmlFor = manual
      ? manualReferenceInput.id : pedPickerStates.get(outgoingReferenceSelect).input.id;
    outgoingReferenceSelect.disabled = !outgoing || manual || referenceViewOnly;
    pedPickerStates.get(outgoingReferenceSelect).input.disabled = outgoingReferenceSelect.disabled;
    // No. Fail Rujukan is optional in Surat Keluar; school letters to the office still need it.
    setPedPickerRequired(outgoingReferenceSelect, outgoing && !manual && !referenceViewOnly && form.elements.category.value !== "outgoing");
    manualReferenceInput.disabled = !outgoing || !manual || referenceViewOnly;
    manualReferenceInput.required = !manualReferenceInput.disabled;
    letterNumberHint.textContent = manual
      ? "Masukkan nombor surat selepas menaip No. Fail Rujukan."
      : "Masukkan nombor surat selepas memilih No. Fail Rujukan.";
    syncLetterNumberField();
  };
  referenceModeInputs.forEach(input => input.addEventListener("change", () => {
    letterNumberInput.value = "";
    syncReferenceMode();
    (schoolUsesManualReference() ? manualReferenceInput : pedPickerStates.get(outgoingReferenceSelect).input).focus();
  }));
  outgoingReferenceSelect.addEventListener("change", () => {
    letterNumberInput.value = "";
    syncLetterNumberField();
    if (!letterNumberInput.disabled) letterNumberInput.focus();
  });
  pedPickerStates.get(outgoingReferenceSelect).input.addEventListener("input", () => {
    letterNumberInput.value = "";
    syncLetterNumberField();
  });
  manualReferenceInput.addEventListener("input", () => {
    letterNumberInput.value = "";
    syncLetterNumberField();
  });
  document.addEventListener("pointerdown", event => {
    pedPickerStates.forEach(picker => { if (picker.open && !picker.input.closest(".ped-picker").contains(event.target)) picker.close(); });
  });
  activeCategories.forEach(category => {
    const meta = pedCategoryMeta[category];
    const table = document.querySelector(`[data-ped-rows="${category}"]`).closest("table");
    table.querySelectorAll("thead th").forEach(header => header.setAttribute("scope", "col"));
    table.querySelector("thead th:nth-child(2)").textContent = "No. Fail Rujukan";
    table.querySelector("thead th:nth-child(3)").textContent = schoolAccount && category === "school_in" ? "Kepada" : meta.party;
  });

  const advancedFileInput = document.querySelector("#pedFilterFileNumber");
  const advancedNotesInput = document.querySelector("#pedFilterNotes");
  const advancedFilters = () => ({
    sectors: schoolAccount ? [] : selectedValues("#pedFilterSectors").map(normalizeRecipientName),
    officers: selectedValues("#pedFilterOfficers").map(normalizeRecipientName),
    schools: schoolAccount ? [] : selectedValues("#pedFilterSchools").map(normalizeRecipientName),
    deliveryMethods: schoolAccount ? [] : selectedValues("#pedFilterDeliveryMethods").map(normalizeRecipientName),
    fileNumber: normalizeRecipientName(advancedFileInput.value),
    notes: normalizeRecipientName(advancedNotesInput.value)
  });
  const advancedFilterCount = filters => [filters.sectors.length, filters.officers.length, filters.schools.length,
    filters.deliveryMethods.length, filters.fileNumber, filters.notes].filter(Boolean).length;
  const pedFiltersActive = () => Boolean(String(search.value || "").trim() || statusFilter.value || dateFrom.value || dateTo.value
    || advancedFilterCount(advancedFilters()));
  const anyMatches = (values, wanted) => !wanted.length || values.map(normalizeRecipientName).some(value => wanted.includes(value));
  // Lower-cased search text is built once per record object; saved records are
  // replaced by new objects, so the cache never serves stale text.
  const pedSearchText = new WeakMap();
  const recordSearchText = record => {
    let text = pedSearchText.get(record);
    if (text === undefined) {
      text = [record.reference, record.correspondent, record.subject, record.status]
        .map(value => String(value || "").toLocaleLowerCase("ms-MY")).join("\u0000");
      pedSearchText.set(record, text);
    }
    return text;
  };
  // Reads every filter control once, then tests records against that snapshot;
  // reading the controls per record made each keystroke scale with the record count.
  const pedRecordMatcher = () => {
    const term = String(search.value || "").trim().toLocaleLowerCase("ms-MY");
    const status = statusFilter.value;
    const from = dateFrom.value;
    const to = dateTo.value;
    const filters = advancedFilters();
    return record => (!term || recordSearchText(record).includes(term))
      && (!status || record.status === status)
      && (!from || record.date >= from)
      && (!to || record.date <= to)
      && anyMatches(recordSectors(record), filters.sectors)
      && anyMatches(recordOfficers(record), filters.officers)
      && anyMatches(record.category === "school_in" ? [record.schoolName || record.correspondent]
        : record.category === "outgoing" ? [record.recipient || record.correspondent] : [], filters.schools)
      && anyMatches(record.deliveryMethods, filters.deliveryMethods)
      && (!filters.fileNumber || [record.officeReferenceFile, record.registryFileNumber]
        .some(value => normalizeRecipientName(value).includes(filters.fileNumber)))
      && (!filters.notes || normalizeRecipientName(record.notes).includes(filters.notes));
  };

  const render = () => {
    const pedRecordMatches = pedRecordMatcher();
    const totalLetters = state.pedRecords.filter(record => activeCategories.includes(record.category)).length;
    const shareFormat = new Intl.NumberFormat("ms-MY", { style: "percent", maximumFractionDigits: 1 });
    activeCategories.forEach(category => {
      const body = document.querySelector(`[data-ped-rows="${category}"]`);
      const count = document.querySelector(`[data-ped-count="${category}"]`);
      const categoryRecords = state.pedRecords.filter(record => record.category === category);
      const statCount = document.querySelector(`[data-ped-stat-count="${category}"]`);
      if (statCount) statCount.textContent = String(categoryRecords.length);
      const share = totalLetters ? categoryRecords.length / totalLetters : 0;
      const statShare = document.querySelector(`[data-ped-stat-share="${category}"]`);
      const statMeter = document.querySelector(`[data-ped-stat-meter="${category}"]`);
      if (statShare) statShare.textContent = shareFormat.format(share);
      if (statMeter) statMeter.style.width = `${share * 100}%`;
      const stateForTable = tableState[category];
      const records = categoryRecords.filter(pedRecordMatches).sort((a, b) => {
        const compared = String(a.date || "").localeCompare(String(b.date || ""))
          || String(a.createdAt || "").localeCompare(String(b.createdAt || ""));
        return stateForTable.dateAscending ? compared : -compared;
      });

      const totalPages = Math.max(1, Math.ceil(records.length / pageSize));
      stateForTable.page = Math.min(stateForTable.page, totalPages - 1);
      const start = stateForTable.page * pageSize;
      const pageRecords = records.slice(start, start + pageSize);
      const pageInfo = document.querySelector(`[data-ped-page-info="${category}"]`);
      const pagination = document.querySelector(`[data-ped-pagination="${category}"]`);
      const previous = pagination.querySelector('[data-direction="previous"]');
      const next = pagination.querySelector('[data-direction="next"]');
      const sortButton = document.querySelector(`[data-ped-sort="${category}"]`);

      count.textContent = String(records.length);
      pageInfo.textContent = records.length
        ? `Paparan ${start + 1}–${Math.min(start + pageSize, records.length)} daripada ${records.length} · halaman ${stateForTable.page + 1}/${totalPages}`
        : `${records.length} rekod`;
      previous.disabled = stateForTable.page === 0;
      next.disabled = stateForTable.page >= totalPages - 1;
      pagination.classList.remove("hidden");
      previous.parentElement.classList.toggle("hidden", totalPages <= 1);
      const tableDateLabel = schoolAccount && category === "school_in" ? "Tarikh Surat" : pedCategoryMeta[category].date;
      const tablePartyLabel = schoolAccount && category === "school_in" ? "Kepada" : pedCategoryMeta[category].party;
      sortButton.textContent = `${tableDateLabel} ${stateForTable.dateAscending ? "↑" : "↓"}`;
      sortButton.closest("th").setAttribute("aria-sort", stateForTable.dateAscending ? "ascending" : "descending");
      body.replaceChildren();
      body.closest("table").classList.remove("ped-table-has-receive");
      if (!records.length) {
        const filtered = pedFiltersActive();
        body.append(create("tr", { className: "ped-empty-row" }, create("td", { colspan: "6" },
          create("div", { className: "ped-empty-state" }, [
            create("svg", { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": "1.5", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" }, create("path", { d: "M5 3h10l4 4v14H5V3ZM14 3v5h5M8 12h8M8 16h5" })),
            create("strong", { text: filtered ? "Tiada padanan ditemui" : "Belum ada rekod surat" }),
            create("span", { text: filtered ? "Cuba carian lain atau kosongkan tapisan." : "Gunakan Tambah Rekod untuk mendaftarkan surat dalam kategori ini." })
          ])
        )));
        return;
      }

      pageRecords.forEach(record => {
        const schoolLetterLocked = schoolAccount && category === "school_in"
          && (record.ownerId !== pedOwnerId || !["Dihantar", "Dihantar Semula", "Dikembalikan"].includes(record.status));
        const edit = create("button", { className: "button secondary small", type: "button", "aria-label": `${schoolLetterLocked ? "Lihat" : "Kemas kini"} ${record.reference || "surat"}`, text: schoolLetterLocked ? "Lihat" : "Kemas kini" });
        edit.addEventListener("click", () => openEditor(record.category, record));
        const referenceText = record.reference || "surat tanpa nombor rujukan";
        const canMarkReceived = officeAccount && category === "school_in"
          && record.ownerId !== pedOwnerId && record.officeId === pedOwnerId
          && ["Dihantar", "Dihantar Semula"].includes(record.status);
        const receive = canMarkReceived ? create("button", {
          className: "button small ped-receive-button",
          type: "button",
          "aria-label": `Tandakan ${referenceText} sebagai sudah diterima`,
          text: "Sudah Terima"
        }) : null;
        receive?.addEventListener("click", async () => {
          setBusy(receive, true, "Menyimpan…");
          try {
            const rows = await rest("ped_correspondence", `id=eq.${encodeURIComponent(record.id)}`, {
              method: "PATCH",
              headers: { Prefer: "return=representation" },
              body: JSON.stringify({ status: "Diterima" })
            });
            const saved = mapPedRecord(rows?.[0]);
            if (!saved?.id) throw new Error("Pengesahan penerimaan surat tidak diterima daripada pelayan.");
            state.pedRecords = state.pedRecords.map(item => item.id === saved.id ? saved : item);
            render();
            toast("Surat diterima", `${referenceText} telah ditandakan sebagai diterima.`);
          } catch (error) {
            toast("Status tidak dapat dikemas kini", error.message, "error");
            setBusy(receive, false);
          }
        });
        const remove = create("button", { className: "button danger small ped-delete", type: "button", "aria-label": `Padam ${referenceText}`, title: "Padam rekod" },
          create("svg", { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": "1.7", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" }, create("path", { d: "M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7" })));
        remove.addEventListener("click", async () => {
          if (!confirm(`Padam rekod ${referenceText}?`)) return;
          remove.disabled = true;
          remove.setAttribute("aria-busy", "true");
          try {
            await deletePedRecord(record);
            state.pedRecords = state.pedRecords.filter(item => item.id !== record.id);
            if (record.attachmentPath) {
              await deletePedAttachment(record.attachmentPath).catch(error => console.warn("Lampiran rekod PeD tidak dapat dipadam.", error));
            }
            render();
            toast("Rekod dipadam", "Rekod surat telah dikeluarkan daripada PeD.");
          } catch (error) {
            toast("Tidak berjaya", error.message, "error");
            remove.disabled = false;
            remove.removeAttribute("aria-busy");
          }
        });
        const canDelete = canDeletePedRecord(record);
        const party = schoolAccount && category === "school_in"
          ? record.officeId === assignedOffice?.id ? assignedOffice.name : "Pejabat terdahulu"
          : record.correspondent;
        const referenceParts = splitPedOutgoingReference(record.reference);
        const referenceDisplay = referenceParts.letterNumber
          ? `${referenceParts.fileReference} (${referenceParts.letterNumber})`
          : referenceParts.fileReference || "—";
        body.append(create("tr", {}, [
          create("td", { className: "ped-cell-date", "data-label": tableDateLabel }, create("time", { datetime: record.date, text: formatDate(record.date) })),
          create("td", { className: "ped-cell-reference", "data-label": "No. Fail Rujukan" },
            create("strong", { className: "ped-reference", text: referenceDisplay })),
          create("td", { className: "ped-cell-party", "data-label": tablePartyLabel }, create("span", { className: "ped-party", text: party || "—" })),
          create("td", { className: "ped-cell-subject", "data-label": "Perkara" }, create("span", { className: "ped-subject", text: record.subject })),
          create("td", { className: "ped-cell-status", "data-label": "Status" }, create("span", { className: `ped-status ped-tone-${pedStatusVisual(record.status).tone}` }, [
            pedStatusIcon(record.status),
            create("span", { text: record.status })
          ])),
          create("td", { className: "ped-cell-actions", "data-label": "Tindakan" }, create("div", { className: "actions ped-row-actions" }, [
            ...(receive ? [receive] : []), edit, ...(canDelete ? [remove] : [])
          ]))
        ]));
      });
      // Class twin of table:has(.ped-receive-button) for browsers without :has().
      body.closest("table").classList.toggle("ped-table-has-receive", Boolean(body.querySelector(".ped-receive-button")));
    });
    renderPedExtraViews();
  };

  const setSelectValue = (select, value) => {
    if (value && ![...select.options].some(option => option.value === value)) {
      select.append(create("option", { value, text: value }));
    }
    select.value = value || "";
  };
  const syncReferenceLetterNumber = (category, select, field, input) => {
    const isSchoolOutgoing = schoolAccount && category === "school_in";
    const visible = form.elements.category.value === category && !isSchoolOutgoing && Boolean(select.value);
    field.classList.toggle("hidden", !visible);
    input.disabled = !visible;
    input.required = visible;
  };
  officeReferenceFileSelect.addEventListener("change", () => {
    officeReferenceLetterNumberInput.value = "";
    syncReferenceLetterNumber("agency_in", officeReferenceFileSelect, officeReferenceLetterNumberField, officeReferenceLetterNumberInput);
  });
  registryFileNumberSelect.addEventListener("change", () => {
    registryLetterNumberInput.value = "";
    syncReferenceLetterNumber("school_in", registryFileNumberSelect, registryLetterNumberField, registryLetterNumberInput);
  });
  const setMultiValues = (select, values = []) => {
    const selected = new Set(values.map(value => String(value).toLocaleUpperCase("ms-MY")));
    select.querySelectorAll("option").forEach(option => { option.selected = selected.has(option.value.toLocaleUpperCase("ms-MY")); });
    values.filter(value => ![...select.options].some(option => option.value.toLocaleUpperCase("ms-MY") === String(value).toLocaleUpperCase("ms-MY")))
      .forEach(value => select.append(create("option", { value, text: value, selected: "selected" })));
  };
  const selectedValues = selector => [...document.querySelector(selector).selectedOptions].map(option => option.value);
  const openEditor = (category, record = null) => {
    const meta = pedCategoryMeta[category];
    const schoolOutgoing = schoolAccount && category === "school_in";
    const outgoingForm = category === "outgoing" || schoolOutgoing;
    const officeProcessingSchoolLetter = officeAccount && category === "school_in" && record && record.ownerId !== pedOwnerId;
    const viewOnly = schoolOutgoing && record
      && (record.ownerId !== pedOwnerId || !["Dihantar", "Dihantar Semula", "Dikembalikan"].includes(record.status));
    referenceViewOnly = Boolean(viewOnly);
    form.reset();
    form.elements.id.value = record?.id || "";
    form.elements.category.value = category;
    form.elements.correspondence_date.value = record?.date || new Date().toISOString().slice(0, 10);
    referenceInput.value = outgoingForm ? "" : record?.reference || "";
    const outgoingReference = splitPedOutgoingReference(record?.reference);
    const manualMode = schoolOutgoing && (record
      ? !registeredFileOptions.includes(outgoingReference.fileReference)
      : !registeredFileOptions.length);
    schoolReferenceModes.classList.toggle("hidden", !schoolOutgoing);
    referenceModeInputs.forEach(input => {
      input.disabled = Boolean(viewOnly) || (input.value === "registered" && schoolOutgoing && !registeredFileOptions.length);
    });
    referenceModeInputs.find(input => input.value === (manualMode ? "manual" : "registered")).checked = true;
    fillSelect(outgoingReferenceSelect, registeredFileOptions, "Pilih fail yang telah didaftarkan");
    setSelectValue(outgoingReferenceSelect, outgoingForm && !manualMode ? outgoingReference.fileReference : "");
    manualReferenceInput.value = manualMode ? outgoingReference.fileReference : "";
    letterNumberInput.value = outgoingForm ? outgoingReference.letterNumber : "";
    referenceTextField.classList.toggle("hidden", outgoingForm);
    outgoingReferenceField.classList.toggle("hidden", !outgoingForm);
    referenceInput.disabled = outgoingForm;
    partyInput.value = schoolOutgoing
      ? record && record.officeId !== assignedOffice?.id ? "Pejabat terdahulu" : assignedOffice?.name || "Pejabat"
      : record?.correspondent || "";
    partyInput.readOnly = Boolean(schoolOutgoing || officeProcessingSchoolLetter || viewOnly);
    schoolNameSelect.disabled = category !== "school_in" || schoolOutgoing || officeProcessingSchoolLetter;
    setPedPickerRequired(schoolNameSelect, category === "school_in" && !schoolOutgoing && !officeProcessingSchoolLetter);
    pedPickerStates.get(schoolNameSelect).input.disabled = schoolNameSelect.disabled;
    setSelectValue(schoolNameSelect, officeAccount ? record?.schoolId || record?.schoolName || "" : record?.schoolName || "");
    partyTextField.classList.toggle("hidden", category === "school_in" && !schoolOutgoing);
    partyInput.disabled = category === "school_in" && !schoolOutgoing;
    partyInput.required = category !== "school_in";
    form.elements.correspondence_date.readOnly = Boolean(officeProcessingSchoolLetter || viewOnly);
    referenceInput.readOnly = Boolean(officeProcessingSchoolLetter);
    syncReferenceMode();
    form.elements.subject.readOnly = Boolean(officeProcessingSchoolLetter || viewOnly);
    form.elements.subject.value = record?.subject || "";
    const statuses = schoolOutgoing
      ? record?.status === "Dikembalikan" || record?.status === "Dihantar Semula"
        ? ["Dihantar Semula"] : ["Dihantar"]
      : officeAccount && category === "school_in"
        ? meta.statuses.filter(status => status !== "Dihantar Semula")
        : [...meta.statuses];
    if (record?.status && !statuses.includes(record.status) && (!schoolOutgoing || viewOnly)) statuses.push(record.status);
    statusSelect.replaceChildren(
      ...(schoolOutgoing && !record ? [create("option", { value: "", text: "Pilih status sebelum hantar" })] : []),
      ...statuses.map(status => create("option", { value: status, text: status }))
    );
    statusSelect.value = schoolOutgoing && record?.status === "Dikembalikan"
      ? "Dihantar Semula" : record?.status || "";
    refreshPedPicker(statusSelect);
    setPedPickerRequired(statusSelect, true);
    if (schoolOutgoing && !record) {
      statusSelect.selectedIndex = 0;
      statusSelect.value = "";
      pedPickerStates.get(statusSelect).query = "";
      refreshPedPicker(statusSelect);
    }
    pedPickerStates.get(statusSelect).input.placeholder = schoolOutgoing && !record
      ? "Pilih status sebelum hantar" : "Pilih status surat";

    document.querySelectorAll("[data-ped-category-fields]").forEach(field => {
      field.classList.toggle("hidden", field.dataset.pedCategoryFields !== category || schoolOutgoing);
    });
    setMultiValues(document.querySelector("#pedDepartmentSectors"), record?.departmentSectors || []);
    setMultiValues(document.querySelector("#pedAssignedOfficers"), record?.assignedOfficers || []);
    setSelectValue(document.querySelector("#pedSchoolSector"), record?.schoolSector || "");
    document.querySelector("#pedAssignedTo").value = record?.assignedTo || "";
    setSelectValue(officeReferenceFileSelect, record?.officeReferenceFile || "");
    officePersonalFileNumberInput.value = record?.officePersonalFileNumber || "";
    setSelectValue(registryFileNumberSelect, record?.registryFileNumber || "");
    officeReferenceLetterNumberInput.value = record?.officeReferenceLetterNumber || "";
    registryLetterNumberInput.value = record?.registryFileLetterNumber || "";
    syncReferenceLetterNumber("agency_in", officeReferenceFileSelect, officeReferenceLetterNumberField, officeReferenceLetterNumberInput);
    syncReferenceLetterNumber("school_in", registryFileNumberSelect, registryLetterNumberField, registryLetterNumberInput);
    document.querySelector("#pedAgencyNotes").value = category === "agency_in" ? record?.notes || "" : "";
    document.querySelector("#pedSchoolNotes").value = category === "school_in" ? record?.notes || "" : "";
    setSelectValue(document.querySelector("#pedOriginSector"), record?.originSector || "");
    const deliveryMethodsSelect = document.querySelector("#pedDeliveryMethods");
    setMultiValues(deliveryMethodsSelect, record?.deliveryMethods || []);
    document.querySelector("#pedOutgoingNotes").value = category === "outgoing" ? record?.notes || "" : "";
    document.querySelector("#pedSchoolReceivedNotes").value = category === "school_received" ? record?.notes || "" : "";
    setSelectValue(document.querySelector("#pedSchoolReceivedOfficer"), category === "school_received" ? record?.assignedTo || "" : "");
    document.querySelector("#pedSchoolReceivedFile").value = category === "school_received" ? record?.registryFileNumber || "" : "";
    pedPickerStates.forEach((picker, select) => refreshPedPicker(select));

    selectedAttachment = null;
    clearExistingAttachment = false;
    attachmentInput.value = "";
    attachmentName.textContent = record?.attachmentPath ? "Gambar telah dilampirkan." : "Lampiran pilihan, maksimum 20 MB.";
    viewAttachmentButton.classList.toggle("hidden", !record?.attachmentPath);
    clearAttachmentButton.classList.toggle("hidden", !record?.attachmentPath);
    viewAttachmentButton.dataset.path = record?.attachmentPath || "";
    clearAttachmentButton.dataset.path = record?.attachmentPath || "";

    const title = schoolOutgoing ? "Surat Keluar" : meta.title;
    modalTitle.textContent = viewOnly ? `Lihat ${title}` : record ? `Kemas Kini ${title}` : `Tambah ${title}`;
    referenceLabel.textContent = meta.referenceLabel;
    partyLabel.textContent = category === "outgoing" || schoolOutgoing ? "Kepada" : "Daripada";
    partyInput.placeholder = category === "outgoing" ? "Nama penerima" : "Nama pengirim";
    dateLabel.textContent = outgoingForm ? "Tarikh Surat" : meta.date;
    submitButton.textContent = record ? "Simpan Perubahan" : "Simpan Rekod";
    submitButton.classList.toggle("hidden", Boolean(viewOnly));
    deleteRecordButton.classList.toggle("hidden", !canDeletePedRecord(record));
    printRecordButton.classList.toggle("hidden", !record);
    showModal("#pedModal");
  };

  deleteRecordButton.addEventListener("click", async () => {
    const record = state.pedRecords.find(item => item.id === form.elements.id.value);
    if (!record) return;
    const referenceText = record.reference || "surat tanpa nombor rujukan";
    if (!confirm(`Padam rekod ${referenceText}?`)) return;
    setBusy(deleteRecordButton, true, "Memadam…");
    deleteRecordButton.setAttribute("aria-busy", "true");
    try {
      await deletePedRecord(record);
      state.pedRecords = state.pedRecords.filter(item => item.id !== record.id);
      if (record.attachmentPath) {
        await deletePedAttachment(record.attachmentPath).catch(error => console.warn("Lampiran rekod PeD tidak dapat dipadam.", error));
      }
      closeModal(modal);
      render();
      toast("Surat dipadam", `${referenceText} telah dikeluarkan daripada PeD.`);
    } catch (error) {
      toast("Tidak berjaya", error.message, "error");
    } finally {
      setBusy(deleteRecordButton, false);
      deleteRecordButton.removeAttribute("aria-busy");
    }
  });

  document.querySelectorAll("[data-add-ped]").forEach(button => {
    button.addEventListener("click", () => {
      try { openEditor(button.dataset.addPed); }
      catch (error) {
        console.error("Borang PeD tidak dapat dibuka.", error);
        toast("Borang tidak dapat dibuka", error.message || "Sila muat semula halaman PeD.", "error");
      }
    });
  });
  attachmentInput.addEventListener("change", () => {
    const file = attachmentInput.files?.[0] || null;
    if (file && (!file.type.startsWith("image/") || file.size > 20 * 1024 * 1024)) {
      attachmentInput.value = "";
      toast("Lampiran tidak sah", "Pilih fail gambar berukuran tidak melebihi 20 MB.", "error");
      return;
    }
    selectedAttachment = file;
    if (file) clearExistingAttachment = false;
    attachmentName.textContent = file?.name || (clearExistingAttachment ? "Gambar semasa akan dibuang." : "Lampiran pilihan, maksimum 20 MB.");
  });
  clearAttachmentButton.addEventListener("click", () => {
    clearExistingAttachment = true;
    selectedAttachment = null;
    attachmentInput.value = "";
    attachmentName.textContent = "Gambar semasa akan dibuang.";
    viewAttachmentButton.classList.add("hidden");
    clearAttachmentButton.classList.add("hidden");
  });
  viewAttachmentButton.addEventListener("click", async () => {
    // "noopener" would make window.open return null and replace this PeD page instead.
    const popup = window.open("about:blank", "_blank");
    if (popup) popup.opener = null;
    try {
      const url = await signedPedAttachmentUrl(viewAttachmentButton.dataset.path);
      if (popup) popup.location.href = url;
      else window.location.assign(url);
    } catch (error) {
      popup?.close();
      toast("Gambar tidak dapat dibuka", error.message, "error");
    }
  });
  const resetPages = () => {
    Object.values(tableState).forEach(table => { table.page = 0; });
    extraViewState.historyPage = 0;
    extraViewState.schoolPage = 0;
  };
  search.addEventListener("input", () => { resetPages(); render(); });
  [statusFilter, dateFrom, dateTo].forEach(control => control.addEventListener("change", () => { resetPages(); render(); }));
  document.querySelector("#pedClearFilters").addEventListener("click", () => {
    search.value = "";
    statusFilter.value = "";
    dateFrom.value = "";
    dateTo.value = "";
    ["#pedFilterSectors", "#pedFilterOfficers", "#pedFilterSchools", "#pedFilterDeliveryMethods"].forEach(selector => {
      document.querySelectorAll(`${selector} option`).forEach(option => { option.selected = false; });
    });
    advancedFileInput.value = "";
    advancedNotesInput.value = "";
    pedPickerStates.forEach((picker, select) => refreshPedPicker(select));
    updateAdvancedCount();
    resetPages();
    render();
  });
  document.querySelectorAll("[data-ped-sort]").forEach(button => button.addEventListener("click", () => {
    const table = tableState[button.dataset.pedSort];
    table.dateAscending = !table.dateAscending;
    table.page = 0;
    render();
  }));
  document.querySelectorAll("[data-ped-page]").forEach(button => button.addEventListener("click", () => {
    const table = tableState[button.dataset.pedPage];
    table.page += button.dataset.direction === "next" ? 1 : -1;
    render();
  }));
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    const recordId = data.id;
    const category = data.category;
    const outgoingForm = category === "outgoing" || (schoolAccount && category === "school_in");
    const manualMode = schoolAccount && category === "school_in" && schoolUsesManualReference();
    const referenceFile = manualMode ? manualReferenceInput.value.trim() : outgoingReferenceSelect.value;
    const correspondent = category === "school_in"
      ? schoolAccount ? workspaceProfile.name : officeAccount ? schoolNameSelect.selectedOptions[0]?.textContent || "" : schoolNameSelect.value
      : partyInput.value.trim();
    const existingRecord = recordId ? state.pedRecords.find(record => record.id === recordId) : null;
    const officeProcessingSchoolLetter = Boolean(officeAccount && category === "school_in" && existingRecord && existingRecord.ownerId !== pedOwnerId);
    if (schoolAccount && category === "school_in" && !statusSelect.value) {
      toast("Pilih status surat", "Pilih status surat sebelum menghantar Surat Keluar kepada Pejabat.", "error");
      pedPickerStates.get(statusSelect).input.focus();
      return;
    }
    const outgoingReferenceSkipped = category === "outgoing" && !referenceFile;
    if (outgoingForm && !outgoingReferenceSkipped && (!referenceFile || !/^[0-9]+$/.test(letterNumberInput.value.trim()))) {
      toast("Lengkapkan rujukan surat", "Isi No. Fail Rujukan dan masukkan Nombor Surat menggunakan digit.", "error");
      (!referenceFile ? manualMode ? manualReferenceInput : pedPickerStates.get(outgoingReferenceSelect).input : letterNumberInput).focus();
      return;
    }
    const referenceLetterNumber = category === "agency_in" && officeReferenceFileSelect.value
      ? officeReferenceLetterNumberInput
      : category === "school_in" && !schoolAccount && registryFileNumberSelect.value
        ? registryLetterNumberInput : null;
    if (referenceLetterNumber && !/^[0-9]+$/.test(referenceLetterNumber.value.trim())) {
      toast("Masukkan No. Surat", "Isi nombor surat selepas memilih nombor fail rujukan.", "error");
      referenceLetterNumber.focus();
      return;
    }
    const referenceNumber = outgoingReferenceSkipped ? null : outgoingForm
      ? `${referenceFile}${pedLetterNumberSeparator}${letterNumberInput.value.trim()}`
      : referenceInput.value.trim() || null;
    if (outgoingForm && referenceNumber && state.pedRecords.some(record =>
      record.id !== recordId && record.ownerId === workspaceOwnerId() && record.category === category
      && record.reference?.toLocaleLowerCase("ms-MY") === referenceNumber.toLocaleLowerCase("ms-MY"))) {
      toast("Nombor surat telah digunakan", "Pilih nombor surat lain untuk fail rujukan ini.", "error");
      letterNumberInput.focus();
      return;
    }
    let uploadedAttachmentPath = "";
    let attachmentPath = clearExistingAttachment ? null : existingRecord?.attachmentPath || null;
    const payload = {
      category,
      school_id: category === "school_in"
        ? schoolAccount ? pedOwnerId : officeAccount ? assignedSchools.find(school => school.id === schoolNameSelect.value)?.id || existingRecord?.schoolId || null : null
        : category === "school_received" ? pedOwnerId : null,
      office_id: category === "school_in" ? schoolAccount ? assignedOffice?.id || null : officeAccount ? pedOwnerId : null : null,
      correspondence_date: data.correspondence_date,
      reference_number: referenceNumber,
      correspondent,
      sender: category === "agency_in" || category === "school_received" ? correspondent : "",
      school_name: category === "school_in" ? correspondent : "",
      recipient: category === "outgoing" ? correspondent : "",
      department_sectors: category === "agency_in" ? selectedValues("#pedDepartmentSectors") : [],
      assigned_officers: category === "agency_in" ? selectedValues("#pedAssignedOfficers") : [],
      school_sector: category === "school_in" && !schoolAccount ? document.querySelector("#pedSchoolSector").value
        : category === "school_received" ? existingRecord?.schoolSector || "" : "",
      assigned_to: category === "school_in" && !schoolAccount ? document.querySelector("#pedAssignedTo").value.trim()
        : category === "school_received" ? document.querySelector("#pedSchoolReceivedOfficer").value : "",
      office_reference_file: category === "agency_in" ? officeReferenceFileSelect.value : "",
      office_reference_letter_number: category === "agency_in" && officeReferenceFileSelect.value ? officeReferenceLetterNumberInput.value.trim() : "",
      office_personal_file_number: category === "agency_in" ? officePersonalFileNumberInput.value.trim() : undefined,
      registry_file_number: category === "school_in" && !schoolAccount ? registryFileNumberSelect.value
        : category === "school_received" ? document.querySelector("#pedSchoolReceivedFile").value.trim() : "",
      registry_file_letter_number: category === "school_in" && !schoolAccount && registryFileNumberSelect.value ? registryLetterNumberInput.value.trim() : "",
      origin_sector: category === "outgoing" ? document.querySelector("#pedOriginSector").value : "",
      delivery_methods: category === "outgoing" ? selectedValues("#pedDeliveryMethods") : [],
      subject: document.querySelector("#pedSubject").value.trim(),
      status: statusSelect.value,
      notes: category === "agency_in"
        ? document.querySelector("#pedAgencyNotes").value.trim()
        : category === "school_in" && !schoolAccount
          ? document.querySelector("#pedSchoolNotes").value.trim()
          : category === "school_received"
            ? document.querySelector("#pedSchoolReceivedNotes").value.trim()
            : category === "outgoing" ? document.querySelector("#pedOutgoingNotes").value.trim() : "",
      attachment_path: null
    };
    if (!payload.office_reference_letter_number) delete payload.office_reference_letter_number;
    if (category !== "agency_in") delete payload.office_personal_file_number;
    if (!payload.registry_file_letter_number) delete payload.registry_file_letter_number;
    const movementRecipient = category === "agency_in" ? payload.assigned_officers[0] || ""
      : officeAccount && category === "school_in" ? payload.assigned_to : "";
    const movementReference = category === "agency_in" ? payload.office_reference_file
      : category === "school_in" ? payload.registry_file_number : "";
    const previousMovementRecipient = category === "agency_in"
      ? existingRecord?.assignedOfficers?.[0] || ""
      : existingRecord?.assignedTo || "";
    const previousMovementReference = category === "agency_in"
      ? existingRecord?.officeReferenceFile || ""
      : existingRecord?.registryFileNumber || "";
    const movementAssignmentSelected = Boolean(movementRecipient);
    const movementFileReference = existingRecord && !movementAssignmentSelected
      ? previousMovementReference || movementReference
      : movementReference;
    const movementAssignmentChanged = movementAssignmentSelected
      && (!existingRecord || previousMovementRecipient !== movementRecipient
        || previousMovementReference !== movementReference);
    const normalizeFileReference = value => String(value || "").trim().replace(/\s+/g, " ").toLocaleLowerCase("ms-MY");
    const referencedMovementFile = movementFileReference
      ? state.files.find(file => normalizeFileReference(`${file.transaksi} (Jilid ${file.jilid})`) === normalizeFileReference(movementFileReference))
      : null;
    let movementReturnContext = null;
    if (existingRecord && !movementAssignmentSelected && referencedMovementFile) {
      try {
        movementReturnContext = await pedAssignmentReturnContext(referencedMovementFile, previousMovementRecipient);
      } catch (error) {
        toast("Log pergerakan tidak dapat dibaca", error.message, "error");
        return;
      }
    }
    const movementAssignmentCleared = Boolean(existingRecord && !movementAssignmentSelected
      && (previousMovementRecipient || movementReturnContext?.previousHolder));
    const assignedMovementFile = (movementAssignmentSelected || movementAssignmentCleared)
      ? referencedMovementFile
      : null;
    const movementTarget = movementAssignmentCleared ? movementReturnContext?.previousHolder || "" : movementRecipient;
    const movementReturnRequired = Boolean(movementAssignmentCleared && assignedMovementFile && movementTarget
      && normalizeRecipientName(assignedMovementFile.pemegangTerkini) !== normalizeRecipientName(movementTarget));
    if ((movementAssignmentChanged || movementAssignmentCleared) && !movementFileReference) {
      const referenceMessage = movementAssignmentCleared
        ? "No. Fail Rujukan diperlukan supaya fail boleh dipulangkan kepada pemegang sebelum ini."
        : "Pilih No. Fail Rujukan supaya pergerakan fail dapat direkodkan kepada pegawai.";
      toast("Pilih No. Fail Rujukan", referenceMessage, "error");
      pedPickerStates.get(category === "agency_in" ? officeReferenceFileSelect : registryFileNumberSelect).input.focus();
      return;
    }
    if (movementAssignmentCleared && !movementTarget) {
      toast("Pemegang sebelum ini tidak ditemui", "Log pergerakan asal tiada, jadi nama pegawai sebelumnya tidak dapat dipastikan. Rekod belum disimpan.", "error");
      return;
    }
    if ((movementAssignmentSelected || movementAssignmentCleared) && movementFileReference && !assignedMovementFile) {
      toast("Fail tidak ditemui", "Fail yang dipilih tidak sepadan dengan Daftar Fail Pejabat. Pilih semula No. Fail Rujukan.", "error");
      pedPickerStates.get(category === "agency_in" ? officeReferenceFileSelect : registryFileNumberSelect).input.focus();
      return;
    }
    setBusy(submitButton, true, "Menyimpan...");
    try {
      if (category === "outgoing" && selectedAttachment) {
        uploadedAttachmentPath = await uploadPedAttachment(selectedAttachment);
        attachmentPath = uploadedAttachmentPath;
      }
      payload.attachment_path = attachmentPath;
      const updatePayload = officeProcessingSchoolLetter
        ? {
          status: payload.status, school_sector: payload.school_sector,
          assigned_to: payload.assigned_to, registry_file_number: payload.registry_file_number,
          ...(payload.registry_file_letter_number ? { registry_file_letter_number: payload.registry_file_letter_number } : {}),
          notes: payload.notes
        }
        : schoolAccount && category === "school_in" && recordId
          ? {
            correspondence_date: payload.correspondence_date, reference_number: payload.reference_number,
            correspondent: payload.correspondent, school_name: payload.school_name,
            subject: payload.subject, status: payload.status
          }
          : payload;
      const rows = recordId
        ? await rest("ped_correspondence", "id=eq." + encodeURIComponent(recordId), {
          method: "PATCH",
          headers: { Prefer: "return=representation" },
          body: JSON.stringify(updatePayload)
        })
        : await rest("ped_correspondence", "", {
          method: "POST",
          headers: { Prefer: "return=representation" },
          body: JSON.stringify({ ...payload, owner_id: workspaceOwnerId() })
        });
      const saved = mapPedRecord(rows[0]);
      if (existingRecord?.attachmentPath && existingRecord.attachmentPath !== saved.attachmentPath) {
        await deletePedAttachment(existingRecord.attachmentPath).catch(error => console.warn("Lampiran lama PeD tidak dapat dipadam.", error));
      }
      state.pedRecords = recordId
        ? state.pedRecords.map(record => record.id === saved.id ? saved : record)
        : [saved, ...state.pedRecords];
      let movementError = null;
      let assignmentMovementRecorded = false;
      if (assignedMovementFile && (movementReturnRequired || (movementAssignmentSelected && (
        movementAssignmentChanged
        || normalizeRecipientName(assignedMovementFile.pemegangTerkini) !== normalizeRecipientName(movementRecipient)
      )))) {
        const movedAtIso = new Date().toISOString();
        try {
          const movementNote = `${movementAssignmentCleared ? "Pemulangan selepas penugasan PeD" : "Penugasan melalui PeD"}: ${saved.reference || saved.subject || "Surat PeD"}`;
          const movement = movementAssignmentCleared && movementReturnContext?.correctionMovement
            ? await correctMovement(movementReturnContext.correctionMovement, {
              from: movementReturnContext.correctionMovement.dari,
              to: movementTarget,
              movedAt: movementReturnContext.correctionMovement.tarikh,
              note: movementNote
            })
            : await moveFile(assignedMovementFile, {
              p_file_id: assignedMovementFile.id,
              p_to_holder: movementTarget,
              p_moved_at: movedAtIso,
              p_note: movementNote
            });
          Object.assign(assignedMovementFile, mapFile(movement.file));
          state.lastMovementDates.set(assignedMovementFile.id, movement.movement?.moved_at || movedAtIso);
          assignmentMovementRecorded = true;
        } catch (error) {
          movementError = error;
        }
      }
      closeModal(modal);
      render();
      if (movementError) {
        const failureMessage = movementAssignmentCleared
          ? `Surat telah disimpan tetapi fail belum dapat dipulangkan kepada ${movementTarget}. ${movementError.message}`
          : `Surat telah disimpan tetapi fail belum bergerak kepada ${movementRecipient}. ${movementError.message}`;
        toast("Rekod PeD disimpan, pergerakan gagal", failureMessage, "error");
      } else {
        const movementMessage = assignmentMovementRecorded
          ? movementAssignmentCleared
            ? ` Fail rujukan dipulangkan kepada ${movementTarget} dan log dikemas kini.`
            : ` Fail rujukan dipindahkan kepada ${movementRecipient}.`
          : movementAssignmentSelected && !movementReference
            ? " Pergerakan belum direkodkan kerana No. Fail Rujukan belum dipilih."
            : "";
        toast(recordId ? "Rekod dikemas kini" : "Rekod ditambah", (saved.reference || "Rekod tanpa nombor rujukan") + " telah disimpan dalam PeD." + movementMessage);
      }
    } catch (error) {
      if (uploadedAttachmentPath) await deletePedAttachment(uploadedAttachmentPath).catch(() => {});
      if (/office_personal_file_number/i.test(error.message || "")) {
        toast("Migrasi Supabase diperlukan", "Jalankan migrasi 20261113010000_add_office_personal_file_number.sql sebelum menyimpan No. Fail Peribadi.", "error");
      } else if (/office_reference_letter_number|registry_file_letter_number/i.test(error.message || "")) {
        toast("Migrasi Supabase diperlukan", "Jalankan migrasi 20261105020000_add_ped_reference_letter_numbers.sql sebelum menyimpan nombor surat bagi fail rujukan.", "error");
      } else if (/ped_correspondence_owner_category_reference_idx/i.test(error.message || "")) {
        toast("Surat ini telah direkodkan", "Surat dengan rujukan, No. Fail Rujukan dan No. Surat yang sama telah wujud. Semak No. Surat atau cari surat tersebut dalam senarai.", "error");
      } else {
        toast("Tidak berjaya", error.message, "error");
      }
    } finally {
      setBusy(submitButton, false);
    }
  });

  // Tapisan lanjut: a collapsible panel under the main filter bar.
  const advancedToggle = document.querySelector("#pedAdvancedToggle");
  const advancedPanel = document.querySelector("#pedAdvancedFilters");
  const advancedCount = document.querySelector("#pedAdvancedCount");
  const updateAdvancedCount = () => {
    const active = advancedFilterCount(advancedFilters());
    advancedCount.textContent = String(active);
    advancedCount.classList.toggle("hidden", !active);
    advancedToggle.setAttribute("aria-label", active ? `Tapisan lanjut, ${active} tapisan aktif` : "Tapisan lanjut");
  };
  advancedToggle.addEventListener("click", () => {
    const open = advancedPanel.classList.contains("hidden");
    advancedPanel.classList.toggle("hidden", !open);
    advancedToggle.setAttribute("aria-expanded", String(open));
  });
  const applyAdvancedFilters = () => { updateAdvancedCount(); resetPages(); render(); };
  ["#pedFilterSectors", "#pedFilterOfficers", "#pedFilterSchools", "#pedFilterDeliveryMethods"].forEach(selector => {
    document.querySelector(selector).addEventListener("change", applyAdvancedFilters);
  });
  [advancedFileInput, advancedNotesInput].forEach(input => input.addEventListener("input", applyAdvancedFilters));

  // Shared presentation for the Sejarah and Surat Sekolah tables.
  const extraViewState = { view: "list", historyPage: 0, historyAscending: false, schoolPage: 0, schoolAscending: false, school: null, choicesSource: null };
  const isOutgoingCategory = category => category === "outgoing" || (schoolAccount && category === "school_in");
  const pedCategoryLabel = category => schoolAccount && category === "school_in" ? "Surat Keluar"
    : category === "school_received" ? "Surat Masuk" : pedCategoryMeta[category].title;
  const pedPartyLabel = category => isOutgoingCategory(category) ? "Kepada" : category === "school_in" ? "Nama Sekolah" : "Daripada";
  const pedPartyName = record => schoolAccount && record.category === "school_in"
    ? record.officeId === assignedOffice?.id ? assignedOffice.name : "Pejabat terdahulu"
    : record.correspondent;
  const pedReferenceText = record => {
    const parts = splitPedOutgoingReference(record.reference);
    return parts.letterNumber ? `${parts.fileReference} (${parts.letterNumber})` : parts.fileReference;
  };
  const byPedDate = ascending => (a, b) => {
    const compared = String(a.date || "").localeCompare(String(b.date || ""))
      || String(a.createdAt || "").localeCompare(String(b.createdAt || ""));
    return ascending ? compared : -compared;
  };
  const pedEmptyRow = (title, message) => create("tr", { className: "ped-empty-row" }, create("td", { colspan: "6" },
    create("div", { className: "ped-empty-state" }, [
      create("svg", { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": "1.5", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" }, create("path", { d: "M5 3h10l4 4v14H5V3ZM14 3v5h5M8 12h8M8 16h5" })),
      create("strong", { text: title }),
      create("span", { text: message })
    ])
  ));
  const pedOverviewRow = record => {
    const locked = schoolAccount && record.category === "school_in"
      && (record.ownerId !== pedOwnerId || !["Dihantar", "Dihantar Semula", "Dikembalikan"].includes(record.status));
    const reference = pedReferenceText(record);
    const open = create("button", { className: "button secondary small", type: "button", "aria-label": `${locked ? "Lihat" : "Kemas kini"} ${reference || "surat"}`, text: locked ? "Lihat" : "Kemas kini" });
    open.addEventListener("click", () => openEditor(record.category, record));
    return create("tr", {}, [
      create("td", { className: "ped-cell-date", "data-label": isOutgoingCategory(record.category) ? "Tarikh Surat" : "Tarikh Terima" }, [
        create("time", { datetime: record.date, text: formatDate(record.date) }),
        create("span", { className: `ped-category-chip ped-category-${record.category}`, text: pedCategoryLabel(record.category) })
      ]),
      create("td", { className: "ped-cell-reference", "data-label": "No. Fail Rujukan" }, create("strong", { className: "ped-reference", text: reference || "—" })),
      create("td", { className: "ped-cell-party", "data-label": pedPartyLabel(record.category) }, create("span", { className: "ped-party", text: pedPartyName(record) || "—" })),
      create("td", { className: "ped-cell-subject", "data-label": "Perkara" }, create("span", { className: "ped-subject", text: record.subject })),
      create("td", { className: "ped-cell-status", "data-label": "Status" }, create("span", { className: `ped-status ped-tone-${pedStatusVisual(record.status).tone}` }, [
        pedStatusIcon(record.status),
        create("span", { text: record.status })
      ])),
      create("td", { className: "ped-cell-actions", "data-label": "Tindakan" }, create("div", { className: "actions ped-row-actions" }, open))
    ]);
  };
  const renderPagedRecords = ({ body, info, pager, records, page, emptyTitle, emptyMessage }) => {
    const totalPages = Math.max(1, Math.ceil(records.length / pageSize));
    const current = Math.min(Math.max(page, 0), totalPages - 1);
    const start = current * pageSize;
    body.replaceChildren(...(records.length
      ? records.slice(start, start + pageSize).map(pedOverviewRow)
      : [pedFiltersActive() ? pedEmptyRow("Tiada padanan ditemui", "Cuba carian lain atau kosongkan tapisan.") : pedEmptyRow(emptyTitle, emptyMessage)]));
    info.textContent = records.length
      ? `Paparan ${start + 1}–${Math.min(start + pageSize, records.length)} daripada ${records.length} · halaman ${current + 1}/${totalPages}`
      : "0 rekod";
    const [previous, next] = pager.querySelectorAll("button");
    previous.disabled = current === 0;
    next.disabled = current >= totalPages - 1;
    previous.parentElement.classList.toggle("hidden", totalPages <= 1);
    return current;
  };
  const setSortButton = (button, label, ascending) => {
    button.textContent = `${label} ${ascending ? "↑" : "↓"}`;
    button.closest("th").setAttribute("aria-sort", ascending ? "ascending" : "descending");
  };

  // Sejarah: every visible letter type in one date-ordered list.
  const historyRows = document.querySelector("#pedHistoryRows");
  const historySort = document.querySelector("#pedHistorySort");
  historySort.closest("table").querySelectorAll("thead th").forEach(header => header.setAttribute("scope", "col"));
  if (schoolAccount) document.querySelector("#pedHistoryDescription").textContent = "Surat Masuk sekolah dan Surat Keluar kepada Pejabat dalam satu senarai mengikut tarikh.";
  const historyRecords = () => visiblePedRecords().filter(pedRecordMatcher()).sort(byPedDate(extraViewState.historyAscending));
  const renderHistory = () => {
    const records = historyRecords();
    document.querySelector("#pedHistoryCount").textContent = String(records.length);
    setSortButton(historySort, "Tarikh", extraViewState.historyAscending);
    extraViewState.historyPage = renderPagedRecords({
      body: historyRows, info: document.querySelector("#pedHistoryPageInfo"),
      pager: historyRows.closest(".ped-panel").querySelector(".ped-pagination"), records, page: extraViewState.historyPage,
      emptyTitle: "Belum ada rekod surat", emptyMessage: "Surat yang didaftarkan akan dipaparkan di sini."
    });
  };
  historySort.addEventListener("click", () => {
    extraViewState.historyAscending = !extraViewState.historyAscending;
    extraViewState.historyPage = 0;
    renderHistory();
  });
  document.querySelectorAll("[data-ped-history-page]").forEach(button => button.addEventListener("click", () => {
    extraViewState.historyPage += button.dataset.pedHistoryPage === "next" ? 1 : -1;
    renderHistory();
  }));

  // Surat Sekolah: a folder per school, opening every letter from or to it.
  const schoolGrid = document.querySelector("#pedSchoolGrid");
  const schoolDirectory = document.querySelector("#pedSchoolDirectory");
  const schoolDetail = document.querySelector("#pedSchoolDetail");
  const schoolRows = document.querySelector("#pedSchoolRows");
  const schoolSort = document.querySelector("#pedSchoolSort");
  schoolSort.closest("table").querySelectorAll("thead th").forEach(header => header.setAttribute("scope", "col"));
  const schoolEntries = () => {
    const entries = new Map();
    const add = (name, id = null) => {
      const key = normalizeRecipientName(name);
      if (!key) return;
      const entry = entries.get(key);
      if (entry) entry.id ||= id;
      else entries.set(key, { id, name: String(name).trim().replace(/\s+/g, " ") });
    };
    if (officeAccount) assignedSchools.forEach(school => add(school.name, school.id));
    else pedFormOptions.schools.forEach(name => add(name));
    state.pedRecords.filter(record => record.category === "school_in").forEach(record => add(record.schoolName || record.correspondent, record.schoolId));
    return [...entries.values()].sort((first, second) => first.name.localeCompare(second.name, "ms"));
  };
  const recordBelongsToSchool = (record, school) => record.category === "school_in"
    ? Boolean(school.id && record.schoolId === school.id) || normalizeRecipientName(record.schoolName || record.correspondent) === normalizeRecipientName(school.name)
    : record.category === "outgoing" && normalizeRecipientName(record.recipient || record.correspondent) === normalizeRecipientName(school.name);
  const recordsForSchool = school => visiblePedRecords().filter(record => recordBelongsToSchool(record, school));
  const schoolCard = ({ school, matching, filtered }) => {
    const awaiting = matching.filter(record => record.category === "school_in" && ["Dihantar", "Dihantar Semula"].includes(record.status)).length;
    const card = create("button", { className: "ped-school-card", type: "button", "aria-label": `${school.name}, ${matching.length} surat${awaiting ? `, ${awaiting} belum diterima` : ""}` }, [
      create("span", { className: "ped-school-card-icon", "aria-hidden": "true" }, create("svg", { viewBox: "0 0 24 24" }, [
        create("path", { d: "M3 7h7l2 2h9v10H3V7Z" }), create("path", { d: "M3 10h18" })
      ])),
      create("span", { className: "ped-school-card-copy" }, [
        create("strong", { text: school.name }),
        create("span", { text: `${matching.length} surat${filtered ? " sepadan" : ""}` })
      ]),
      awaiting ? create("span", { className: "ped-school-card-badge", text: `${awaiting} belum diterima` }) : null
    ]);
    card.addEventListener("click", () => {
      extraViewState.school = school;
      extraViewState.schoolPage = 0;
      renderSchools();
      document.querySelector("#pedSchoolBack").focus();
    });
    return card;
  };
  const renderSchools = () => {
    const filtered = pedFiltersActive();
    const selected = extraViewState.school;
    schoolDirectory.classList.toggle("hidden", Boolean(selected));
    schoolDetail.classList.toggle("hidden", !selected);
    if (selected) {
      const records = recordsForSchool(selected).filter(pedRecordMatcher()).sort(byPedDate(extraViewState.schoolAscending));
      document.querySelector("#pedSchoolDetailTitle").textContent = selected.name;
      document.querySelector("#pedSchoolDetailCount").textContent = String(records.length);
      setSortButton(schoolSort, "Tarikh", extraViewState.schoolAscending);
      extraViewState.schoolPage = renderPagedRecords({
        body: schoolRows, info: document.querySelector("#pedSchoolPageInfo"),
        pager: schoolDetail.querySelector(".ped-pagination"), records, page: extraViewState.schoolPage,
        emptyTitle: "Belum ada surat untuk sekolah ini", emptyMessage: "Surat masuk daripada sekolah dan surat keluar kepadanya akan dipaparkan di sini."
      });
      return;
    }
    const pedRecordMatches = pedRecordMatcher();
    const cards = schoolEntries()
      .map(school => ({ school, matching: recordsForSchool(school).filter(pedRecordMatches), filtered }))
      .filter(item => !filtered || item.matching.length);
    document.querySelector("#pedSchoolDirectoryCount").textContent = String(cards.length);
    schoolGrid.replaceChildren(...(cards.length ? cards.map(schoolCard) : [create("div", { className: "ped-empty-state ped-school-empty" }, [
      create("strong", { text: filtered ? "Tiada sekolah sepadan" : "Belum ada sekolah" }),
      create("span", { text: filtered ? "Cuba carian lain atau kosongkan tapisan." : officeAccount ? "Admin sistem perlu menetapkan sekolah kepada Pejabat ini." : "Surat sekolah yang didaftarkan akan dipaparkan di sini." })
    ])]));
  };
  document.querySelector("#pedSchoolBack").addEventListener("click", () => {
    const previous = extraViewState.school;
    extraViewState.school = null;
    renderSchools();
    [...schoolGrid.querySelectorAll(".ped-school-card")].find(card => card.querySelector("strong")?.textContent === previous?.name)?.focus();
  });
  schoolSort.addEventListener("click", () => {
    extraViewState.schoolAscending = !extraViewState.schoolAscending;
    extraViewState.schoolPage = 0;
    renderSchools();
  });
  document.querySelectorAll("[data-ped-school-page]").forEach(button => button.addEventListener("click", () => {
    extraViewState.schoolPage += button.dataset.pedSchoolPage === "next" ? 1 : -1;
    renderSchools();
  }));

  // View tabs: Senarai Surat (the original tables), Sejarah and Surat Sekolah.
  const viewTabs = [...document.querySelectorAll("[data-ped-view]")];
  const viewPanels = { list: document.querySelector("#pedListView"), history: document.querySelector("#pedHistoryView"), schools: document.querySelector("#pedSchoolsView") };
  document.querySelector("#pedViewTabSchools").classList.toggle("hidden", schoolAccount);
  const setPedView = (view, focusTab = false) => {
    extraViewState.view = view;
    viewTabs.forEach(tab => {
      const selected = tab.dataset.pedView === view;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
      if (selected && focusTab) tab.focus();
    });
    Object.entries(viewPanels).forEach(([name, panel]) => panel.classList.toggle("hidden", name !== view));
    renderPedExtraViews();
  };
  viewTabs.forEach(tab => {
    tab.addEventListener("click", () => setPedView(tab.dataset.pedView));
    tab.addEventListener("keydown", event => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const tabs = viewTabs.filter(item => !item.classList.contains("hidden"));
      const index = tabs.indexOf(tab);
      const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1
        : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
      setPedView(tabs[nextIndex].dataset.pedView, true);
    });
  });
  function renderPedExtraViews() {
    if (extraViewState.choicesSource !== state.pedRecords) {
      extraViewState.choicesSource = state.pedRecords;
      refreshAdvancedChoices();
    }
    if (extraViewState.view === "history") renderHistory();
    if (extraViewState.view === "schools") renderSchools();
  }

  // Cetak PDF: log sheets for lists, a detail sheet for one letter.
  const ownName = user.role === "admin" ? "" : String(workspaceProfile.name || "").toLocaleUpperCase("ms-MY");
  const pedLogSection = (category, records, context = null) => {
    const title = category === "agency_in" ? "REKOD SURAT MASUK JABATAN DAN AGENSI"
      : category === "school_in"
        ? schoolAccount ? `REKOD PENYERAHAN SURAT KE ${String(assignedOffice?.name || "Pejabat").toLocaleUpperCase("ms-MY")}` : "REKOD SURAT MASUK SEKOLAH"
        : category === "outgoing" ? "REKOD SURAT KELUAR" : "REKOD SURAT MASUK SEKOLAH";
    let section = { contextValue: ownName };
    if (category === "school_in" && !schoolAccount) {
      const schools = uniqueRecipientNames(records.map(record => record.schoolName || record.correspondent));
      if (schools.length === 1) section = { contextValue: schools[0].toLocaleUpperCase("ms-MY") };
    }
    return {
      ...section, ...(context || {}), title,
      counterpartLabel: isOutgoingCategory(category) ? "Kepada" : "Daripada",
      rows: records.map(record => ({ subject: record.subject, reference: pedReferenceText(record), counterpart: pedPartyName(record), date: record.date }))
    };
  };
  const printFileStamp = () => {
    const now = new Date();
    const pad = value => String(value).padStart(2, "0");
    return `${pad(now.getDate())}${pad(now.getMonth() + 1)}${now.getFullYear()}_${pad(now.getHours())}${pad(now.getMinutes())}`;
  };
  const runPrint = async (button, documentTitle, sheetsHtml) => {
    setBusy(button, true, "Menyediakan…");
    try { await printPedDocument(`${documentTitle} - ${printFileStamp()}`, sheetsHtml); }
    catch (error) { toast("PDF tidak dapat disediakan", error.message, "error"); }
    finally { setBusy(button, false); }
  };
  const printLogSections = (button, documentTitle, sections) => {
    const filledSections = sections.filter(section => section.rows.length);
    if (!filledSections.length) {
      toast("Tiada rekod untuk dicetak", "Tiada surat yang sepadan dengan carian dan tapisan semasa.", "error");
      return;
    }
    return runPrint(button, documentTitle, filledSections.map(pedLogSheetHtml).join(""));
  };
  document.querySelectorAll("[data-print-ped]").forEach(button => button.addEventListener("click", () => {
    const category = button.dataset.printPed;
    if (!activeCategories.includes(category)) return;
    const records = state.pedRecords.filter(record => record.category === category).filter(pedRecordMatcher())
      .sort(byPedDate(tableState[category].dateAscending));
    printLogSections(button, `Rekod ${pedCategoryLabel(category)}`, [pedLogSection(category, records)]);
  }));
  document.querySelector("#pedHistoryPrint").addEventListener("click", event => {
    const records = historyRecords();
    printLogSections(event.currentTarget, "Rekod Sejarah Surat", activeCategories.map(category =>
      pedLogSection(category, records.filter(record => record.category === category))));
  });
  document.querySelector("#pedSchoolPrint").addEventListener("click", event => {
    const school = extraViewState.school;
    if (!school) return;
    const records = recordsForSchool(school).filter(pedRecordMatcher()).sort(byPedDate(extraViewState.schoolAscending));
    const context = { contextValue: school.name.toLocaleUpperCase("ms-MY") };
    printLogSections(event.currentTarget, `Rekod Surat ${school.name}`, ["school_in", "outgoing"].map(category =>
      pedLogSection(category, records.filter(record => record.category === category), context)));
  });
  const pedDetailFields = record => {
    const category = record.category;
    const fields = [
      ["Jenis Surat", pedCategoryLabel(category)],
      [isOutgoingCategory(category) ? "Tarikh Surat" : "Tarikh Terima", formatDate(record.date)],
      [isOutgoingCategory(category) ? "No. Fail Rujukan" : pedCategoryMeta[category].referenceLabel, pedReferenceText(record)],
      [pedPartyLabel(category), pedPartyName(record)]
    ];
    // Labels follow the letter form, including the No. Surat beside each reference file.
    if (category === "agency_in") fields.push(["Sektor", record.departmentSectors.join(", ")], ["Untuk Tindakan Pegawai", record.assignedOfficers.join(", ")],
      ["No. Fail Rujukan", record.officeReferenceFile], ["No. Fail Peribadi", record.officePersonalFileNumber],
      ["No. Surat", record.officeReferenceLetterNumber], ["Catatan PPD", record.notes]);
    if (category === "school_in" && schoolAccount) fields.push(["Nama Sekolah", record.schoolName || workspaceProfile.name]);
    if (category === "school_in" && !schoolAccount) fields.push(["Sektor", record.schoolSector], ["Untuk Tindakan / Nama Pegawai", record.assignedTo],
      ["No. Fail Rujukan", record.registryFileNumber], ["No. Surat", record.registryFileLetterNumber], ["Catatan PPD", record.notes]);
    if (category === "outgoing") fields.push(["Daripada Sektor", record.originSector], ["Kaedah Penghantaran Surat", record.deliveryMethods.join(", ")],
      ["Catatan", record.notes], ["Gambar (Poslaju / Pos Biasa)", record.attachmentPath ? "Dilampirkan dalam MyFailPro" : "Tiada"]);
    if (category === "school_received") fields.push(["Untuk Tindakan / Nama Pegawai", record.assignedTo],
      ["No. Fail Rujukan", record.registryFileNumber], ["Catatan Guru Besar/Pengetua", record.notes]);
    fields.push(["Tarikh Didaftarkan", formatDate(record.createdAt, true)]);
    return fields;
  };
  printRecordButton.addEventListener("click", () => {
    const record = state.pedRecords.find(item => item.id === form.elements.id.value);
    if (!record) return;
    runPrint(printRecordButton, `Butiran Surat ${pedReferenceText(record) || record.subject}`, pedDetailSheetHtml({
      category: pedCategoryLabel(record.category), status: record.status, subject: record.subject, fields: pedDetailFields(record)
    }));
  });

  render();
  if (pedLoadWarnings.length) {
    toast("Data PeD belum lengkap", pedLoadWarnings.join("; "), "error");
  }
}

async function initAdmin() {
  if (!await initShell(true)) return;
  markReady();
  await loadAgencies();
  const form = document.querySelector("#agencyForm");
  const body = document.querySelector("#agencyRows");
  const agencyType = document.querySelector("#agencyType");
  const educationOfficeField = document.querySelector("#educationOfficeField");
  const educationOffice = document.querySelector("#educationOffice");
  const officeAccounts = () => state.agencies.filter(agency => String(agency.jenis).trim().toLocaleLowerCase("ms-MY") === "pejabat");
  const officeOptions = selectedId => [
    create("option", { value: "", text: "Pilih Pejabat" }),
    ...officeAccounts().map(office => create("option", { value: office.id, text: office.nama, ...(office.id === selectedId ? { selected: "selected" } : {}) }))
  ];
  const refreshEducationOffices = () => {
    const offices = officeAccounts();
    educationOffice.replaceChildren(create("option", { value: "", text: offices.length ? "Pilih Pejabat Pendidikan…" : "Tiada akaun Pejabat didaftarkan" }));
    offices.forEach(item => educationOffice.append(create("option", { value: item.id, text: item.nama })));
    const isSchool = agencyType.value === "Sekolah";
    educationOfficeField.classList.toggle("hidden", !isSchool);
    educationOffice.required = isSchool;
    if (!isSchool) educationOffice.value = "";
  };
  agencyType.addEventListener("change", refreshEducationOffices);
  const render = () => {
    body.replaceChildren();
    state.agencies.forEach(agency => {
      const isSchool = String(agency.jenis).trim().toLocaleLowerCase("ms-MY") === "sekolah";
      const assignedOfficeSelect = isSchool ? create("select", { className: "input", "aria-label": `Pejabat Pendidikan bagi ${agency.nama}` }, officeOptions(agency.pedOfficeId || agency.parentAgencyId)) : null;
      assignedOfficeSelect?.addEventListener("change", async () => {
        const selected = assignedOfficeSelect.value || null;
        assignedOfficeSelect.disabled = true;
        try {
          await rest("profiles", `id=eq.${encodeURIComponent(agency.id)}`, {
            method: "PATCH", body: JSON.stringify({ parent_agency_id: selected, ped_office_id: selected })
          });
          agency.pedOfficeId = selected;
          agency.parentAgencyId = selected;
          toast("Pejabat dikemas kini", `${agency.nama} dipautkan kepada ${officeAccounts().find(office => office.id === selected)?.nama || "tiada Pejabat"}.`);
        } catch (error) {
          assignedOfficeSelect.value = agency.pedOfficeId || agency.parentAgencyId || "";
          toast("Tidak berjaya", error.message, "error");
        } finally { assignedOfficeSelect.disabled = false; }
      });
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
        create("td", {}, assignedOfficeSelect || create("span", { text: "—" })),
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
      await callAdminFunction("admin-create-user", { email: data.emel.trim().toLowerCase(), password: data.password, name: data.nama.trim(), agencyType: data.jenis, parentAgencyId: data.pejabat_pendidikan || null });
      await loadAgencies();
      form.reset();
      render();
      toast("Berjaya", "Pengguna agensi telah ditambah ke Supabase.");
    } catch (error) { toast("Tidak berjaya", error.message, "error"); }
    finally { setBusy(button, false); }
  });
  refreshEducationOffices();
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
    await ({ login: initLogin, dashboard: initDashboard, "movement-log": initMovementLog, register: initRegister, settings: initSettings, ped: initPed, admin: initAdmin }[page] || (async () => {}))();
  } catch (error) { showFatal(error); }
});
