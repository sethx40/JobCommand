import * as SupabaseConfig from "./supabase-config.js?v=20260609-2009";

const STORE_KEY = "contractorProductionCrm.v1";
const todayIso = new Date().toISOString().slice(0, 10);
const SUPABASE_URL = SupabaseConfig.SUPABASE_URL || "";
const SUPABASE_ANON_KEY = SupabaseConfig.SUPABASE_ANON_KEY || SupabaseConfig.SUPABASE_PUBLISHABLE_KEY || "";
const DEFAULT_COMPANY_NAME = SupabaseConfig.DEFAULT_COMPANY_NAME || "JobCommand Beta";
const isSupabaseConfigured = isValidSupabaseUrl(SUPABASE_URL) && isLikelyAnonKey(SUPABASE_ANON_KEY);
let supabase = null;
let session = null;
let profile = null;
let company = null;
let workspaceMembers = [];
let cloudReady = false;
let saveTimer = null;
let calendarCursor = new Date(`${todayIso}T12:00:00`);
let selectedCalendarDate = todayIso;
let supabaseInitError = null;
let authStatus = null;

const defaults = {
  companyName: "",
  currentUser: "Seth",
  teamMembers: ["Seth", "Lynn"],
  trades: [
    "Roofing", "Gutters", "Plumbing rough-in", "Electrical rough-in", "HVAC",
    "Drywall", "Paint", "Tile", "Flooring", "Trim",
    "Finale MEPs / Plumbing Finales", "Punch list", "Other"
  ],
  statuses: [
    "New Lead", "Estimate Scheduled", "Estimate Sent", "Approved", "Materials Needed",
    "Materials Ordered", "Scheduled", "In Progress", "Waiting on Sub", "Waiting on Homeowner",
    "Punch List", "Finale MEPs / Plumbing Finales", "Complete", "Invoiced", "Paid"
  ]
};

let state = loadState();
let currentView = "today";
let activeJobId = null;

const view = document.querySelector("#view");
const viewTitle = document.querySelector("#viewTitle");
const companyLabel = document.querySelector("#companyLabel");
const modal = document.querySelector("#modal");
const modalTitle = document.querySelector("#modalTitle");
const modalBody = document.querySelector("#modalBody");

function uid(prefix = "id") {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function addDays(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function loadState() {
  const saved = localStorage.getItem(STORE_KEY);
  if (saved) return sanitizeState(JSON.parse(saved));
  const fresh = {
    settings: { ...defaults },
    jobs: [],
    calendarEvents: [],
    notifications: []
  };
  localStorage.setItem(STORE_KEY, JSON.stringify(fresh));
  return fresh;
}

function sanitizeState(data) {
  const clean = {
    settings: { ...defaults, ...(data.settings || {}) },
    jobs: Array.isArray(data.jobs) ? data.jobs.filter((job) => !isOldDemoJob(job)).map(normalizeJob) : [],
    calendarEvents: Array.isArray(data.calendarEvents) ? data.calendarEvents : [],
    notifications: Array.isArray(data.notifications) ? data.notifications : []
  };
  localStorage.setItem(STORE_KEY, JSON.stringify(clean));
  return clean;
}

function normalizeJob(job) {
  return {
    ...makeJob({ timeline: [] }),
    ...job,
    tasks: Array.isArray(job.tasks) ? job.tasks.map((item) => ({ time: "", ...item })) : [],
    schedule: Array.isArray(job.schedule) ? job.schedule.map((item) => ({ time: "", ...item })) : [],
    subs: Array.isArray(job.subs) ? job.subs : [],
    workOrders: Array.isArray(job.workOrders) ? job.workOrders.map((item) => ({ time: "", ...item })) : [],
    punchList: Array.isArray(job.punchList) ? job.punchList.map((item) => ({ dueDate: "", time: "", notes: "", ...item })) : [],
    notesActivity: Array.isArray(job.notesActivity) ? job.notesActivity : [],
    reminders: Array.isArray(job.reminders) ? job.reminders : [],
    timeline: Array.isArray(job.timeline) ? job.timeline : []
  };
}

function isOldDemoJob(job) {
  const oldPhonePattern = new RegExp(`^${["555", "010"].join("-")}[1-4]$`);
  return oldPhonePattern.test(job.phone || "") && /@example\.com$/i.test(job.email || "");
}

function saveState() {
  localStorage.setItem(STORE_KEY, JSON.stringify(state));
  companyLabel.textContent = state.settings.companyName || "JobCommand";
  if (cloudReady) scheduleCloudSave();
}

async function boot() {
  try {
    cloudReady = false;
    if (!isSupabaseConfigured) {
      renderSetupRequired();
      return;
    }
    if (!supabase) {
      await initSupabaseClient();
    }
    if (!supabase) {
      renderLogin();
      return;
    }
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    session = data?.session || null;
    if (!session) {
      renderLogin();
      return;
    }
    await loadWorkspace();
    render();
  } catch (error) {
    authStatus = { ok: false, title: "Startup failed", error };
    renderLogin();
  }
}

async function initSupabaseClient() {
  try {
    const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
    supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false
      }
    });
    supabaseInitError = null;
    if (!window.jobCommandAuthListener) {
      supabase.auth.onAuthStateChange((_event, nextSession) => {
        session = nextSession;
        cloudReady = false;
        boot().catch((error) => renderError("Auth state error", error));
      });
      window.jobCommandAuthListener = true;
    }
  } catch (error) {
    supabaseInitError = error;
    supabase = null;
  }
}

function renderSetupRequired() {
  viewTitle.textContent = "Setup";
  view.innerHTML = `<section class="auth-card">
    <img class="auth-logo" src="icons/jobcommand-logo.png" alt="JobCommand" />
    <h2>Supabase setup required</h2>
    <p class="subtle">Paste your Supabase project URL and anon/public publishable key into <strong>supabase-config.js</strong>, then upload the app to GitHub Pages.</p>
    ${supabaseDiagnosticsCard()}
  </section>`;
}

function renderError(title, error, action = "") {
  const message = error?.message || String(error || "Unknown error");
  viewTitle.textContent = "Setup Error";
  companyLabel.textContent = "JobCommand";
  view.innerHTML = `<section class="auth-card error-card">
    <img class="auth-logo" src="icons/jobcommand-logo.png" alt="JobCommand" />
    <h2>${escapeHtml(title)}</h2>
    <p class="subtle">${escapeHtml(message)}</p>
    ${action ? `<p class="subtle">${escapeHtml(action)}</p>` : ""}
    <div class="row-actions">
      <button class="secondary-button" data-action="retry-boot" type="button">Retry</button>
      <button class="ghost-button" data-action="logout" type="button">Log out</button>
    </div>
  </section>`;
}

function renderLogin() {
  viewTitle.textContent = "Login";
  companyLabel.textContent = "JobCommand";
  document.querySelectorAll(".nav-item").forEach((button) => button.classList.remove("active"));
  view.innerHTML = `<section class="auth-card">
    <img class="auth-logo" src="icons/jobcommand-logo.png" alt="JobCommand" />
    <h2>Sign in to JobCommand</h2>
    <p class="subtle">Use the beta account created in Supabase for Seth or Lynn.</p>
    ${supabaseDiagnosticsCard()}
    <form id="loginForm" class="form-grid">
      <label>Email<input name="email" type="email" required autocomplete="email" /></label>
      <label>Password<input name="password" type="password" required autocomplete="current-password" /></label>
      <button class="primary-button full" type="submit">Log in</button>
    </form>
    <button class="secondary-button" data-action="test-supabase" type="button">Test Supabase Connection</button>
    <div id="authStatus">${authStatusMarkup()}</div>
  </section>`;
  document.querySelector("#loginForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = Object.fromEntries(new FormData(event.currentTarget).entries());
    authStatus = { ok: null, title: "Signing in", message: "Contacting Supabase Auth..." };
    renderLogin();
    try {
      if (!supabase) await initSupabaseClient();
      if (!supabase) throw supabaseInitError || new Error("Supabase client did not initialize.");
      const { error } = await supabase.auth.signInWithPassword(form);
      if (error) throw error;
      authStatus = { ok: true, title: "Login successful", message: "Loading shared workspace..." };
      await boot();
    } catch (error) {
      authStatus = { ok: false, title: "Login failed", error };
      renderLogin();
    }
  });
}

function supabaseDiagnosticsCard() {
  const urlValid = isValidSupabaseUrl(SUPABASE_URL);
  return `<div class="diagnostics-card">
    <div class="diag-row"><span>App build</span><strong>${escapeHtml(window.JOBCOMMAND_DEBUG_BUILD || "unknown")}</strong></div>
    <div class="diag-row"><span>Supabase URL</span><strong>${escapeHtml(SUPABASE_URL || "Missing")}</strong></div>
    <div class="diag-row"><span>URL looks valid</span><strong>${urlValid ? "Yes" : "No"}</strong></div>
    <div class="diag-row"><span>Anon key present</span><strong>${SUPABASE_ANON_KEY ? "Yes, " + maskKey(SUPABASE_ANON_KEY) : "No"}</strong></div>
    <div class="diag-row"><span>Anon key looks valid</span><strong>${isLikelyAnonKey(SUPABASE_ANON_KEY) ? "Yes" : "No"}</strong></div>
    <div class="diag-row"><span>Client initialized</span><strong>${supabase ? "Yes" : "No"}</strong></div>
    ${supabaseInitError ? `<p class="diag-error">${escapeHtml(errorSummary(supabaseInitError))}</p>` : ""}
  </div>`;
}

function authStatusMarkup() {
  if (!authStatus) return "";
  const tone = authStatus.ok === true ? "success" : authStatus.ok === false ? "error" : "pending";
  const message = authStatus.error ? errorSummary(authStatus.error) : authStatus.message;
  return `<div class="auth-status ${tone}"><strong>${escapeHtml(authStatus.title)}</strong><p>${escapeHtml(message || "")}</p></div>`;
}

async function loadWorkspace() {
  const user = session.user;
  const displayName = user.user_metadata?.full_name || user.email.split("@")[0];
  const { error: profileError } = await supabase.from("profiles").upsert({ id: user.id, email: user.email, full_name: displayName }, { onConflict: "id" });
  if (profileError) throw new Error(`Profile setup failed: ${profileError.message}`);
  const { data: memberships, error } = await supabase.from("company_members").select("company_id, role, companies(id, name)").eq("user_id", user.id).limit(1);
  if (error) throw new Error(`Workspace lookup failed: ${error.message}`);
  if (!memberships?.length) {
    const { data: newCompany, error: companyError } = await supabase.from("companies").insert({ name: DEFAULT_COMPANY_NAME, owner_id: user.id }).select().single();
    if (companyError) throw new Error(`Workspace creation failed: ${companyError.message}`);
    const { error: memberError } = await supabase.from("company_members").insert({ company_id: newCompany.id, user_id: user.id, role: "owner" });
    if (memberError) throw new Error(`Workspace membership setup failed: ${memberError.message}`);
    company = newCompany;
  } else {
    company = memberships[0].companies;
  }
  if (!company?.id) throw new Error("No workspace/company was found for this user. Add the user to company_members or sign in as the workspace owner first.");
  profile = { id: user.id, email: user.email, full_name: displayName };
  await loadCloudState();
  cloudReady = true;
}

async function loadCloudState() {
  const companyId = company.id;
  const [settingsRes, membersRes, jobsRes, tasksRes, scheduleRes, workOrdersRes, punchRes, notesRes, mentionsRes, notificationsRes, calendarRes] = await Promise.all([
    supabase.from("settings").select("*").eq("company_id", companyId).maybeSingle(),
    supabase.from("company_members").select("user_id, profiles(full_name, email)").eq("company_id", companyId),
    supabase.from("jobs").select("*").eq("company_id", companyId).order("created_at", { ascending: false }),
    supabase.from("tasks").select("*").eq("company_id", companyId),
    supabase.from("schedule_items").select("*").eq("company_id", companyId),
    supabase.from("work_orders").select("*").eq("company_id", companyId),
    supabase.from("punch_list_items").select("*").eq("company_id", companyId),
    supabase.from("notes").select("*").eq("company_id", companyId).order("created_at", { ascending: false }),
    supabase.from("mentions").select("*").eq("company_id", companyId),
    supabase.from("notifications").select("*").eq("company_id", companyId).eq("user_id", profile.id).order("created_at", { ascending: false }),
    supabase.from("calendar_events").select("*").eq("company_id", companyId)
  ]);
  const failed = [settingsRes, membersRes, jobsRes, tasksRes, scheduleRes, workOrdersRes, punchRes, notesRes, mentionsRes, notificationsRes, calendarRes].find((result) => result.error);
  if (failed) throw new Error(`Data fetch failed: ${failed.error.message}`);
  const teamMembers = membersRes.data?.map((m) => m.profiles?.full_name || m.profiles?.email?.split("@")[0]).filter(Boolean) || ["Seth", "Lynn"];
  workspaceMembers = membersRes.data || [];
  state = {
    settings: { ...defaults, ...(settingsRes.data?.data || {}), companyName: company.name, currentUser: profile.full_name, teamMembers },
    jobs: (jobsRes.data || []).map((row) => cloudJob(row, tasksRes.data || [], scheduleRes.data || [], workOrdersRes.data || [], punchRes.data || [], notesRes.data || [], mentionsRes.data || [], calendarRes.data || [])),
    calendarEvents: (calendarRes.data || []).filter((item) => !item.job_id).map(cloudStandaloneEvent),
    notifications: (notificationsRes.data || []).map(cloudNotification)
  };
  localStorage.setItem(STORE_KEY, JSON.stringify(state));
}

function cloudJob(row, tasks, schedules, workOrders, punches, notes, mentions, calendarEvents) {
  const jobNotes = notes.filter((item) => item.job_id === row.id);
  return normalizeJob({
    id: row.id,
    name: row.name,
    phone: row.phone || "",
    email: row.email || "",
    address: row.address || "",
    type: row.job_type || "",
    paymentType: row.payment_type || "",
    salesRep: row.sales_rep || "",
    productionManager: row.production_manager || "",
    status: row.status || "New Lead",
    startDate: row.start_date || "",
    targetDate: row.target_completion_date || "",
    inspectionDate: row.inspection_date || "",
    materialsStatus: row.materials_status || "Not needed",
    homeownerUpdateNeeded: Boolean(row.homeowner_update_needed),
    notes: row.notes || "",
    timeline: row.timeline || [],
    tasks: tasks.filter((item) => item.job_id === row.id).map((item) => ({ id: item.id, title: item.title, assignedTo: item.assigned_to || "", dueDate: item.due_date || "", time: item.due_time || "", priority: item.priority || "Normal", complete: Boolean(item.complete), notes: item.notes || "" })),
    schedule: schedules.filter((item) => item.job_id === row.id).map((item) => ({ id: item.id, trade: item.trade || "", subcontractor: item.subcontractor || "", date: item.scheduled_date || "", time: item.scheduled_time || "", status: item.status || "", notes: item.notes || "" })),
    workOrders: workOrders.filter((item) => item.job_id === row.id).map((item) => ({ id: item.id, trade: item.trade || "", scope: item.scope || "", date: item.scheduled_date || "", time: item.scheduled_time || "", subcontractor: item.subcontractor || "", notes: item.notes || "" })),
    punchList: punches.filter((item) => item.job_id === row.id).map((item) => ({ id: item.id, title: item.title, assignedTo: item.assigned_to || "", dueDate: item.due_date || "", time: item.due_time || "", complete: Boolean(item.complete), notes: item.notes || "" })),
    reminders: calendarEvents.filter((item) => item.job_id === row.id && ["Reminder", "Inspection", "Custom"].includes(item.event_type)).map((item) => ({ id: item.id, title: item.title, assignedTo: item.assigned_to || "", date: item.event_date || "", time: item.event_time || "", status: item.status || "", notes: item.notes || "", eventType: item.event_type })),
    notesActivity: jobNotes.map((item) => ({ id: item.id, author: item.author_name || "", authorId: item.author_id || "", text: item.body || "", mentions: mentions.filter((m) => m.note_id === item.id).map((m) => m.tagged_name), timestamp: item.created_at }))
  });
}

function cloudNotification(row) {
  return { id: row.id, type: row.type, userId: row.user_id, taggedUser: row.tagged_name || state.settings.currentUser, jobId: row.job_id, noteId: row.note_id, timestamp: row.created_at, read: Boolean(row.read) };
}

function cloudStandaloneEvent(row) {
  return { id: row.id, title: row.title, eventType: row.event_type || "Custom", date: row.event_date || "", time: row.event_time || "", assignedTo: row.assigned_to || "", status: row.status || "", notes: row.notes || "" };
}

function scheduleCloudSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveCloudState().catch((error) => console.error("Supabase save failed", error)), 700);
}

async function saveCloudState() {
  if (!cloudReady || !company) return;
  const companyId = company.id;
  if (state.settings.companyName && state.settings.companyName !== company.name) {
    await supabase.from("companies").update({ name: state.settings.companyName }).eq("id", companyId);
    company.name = state.settings.companyName;
  }
  await supabase.from("settings").upsert({ company_id: companyId, data: state.settings }, { onConflict: "company_id" });
  await supabase.from("jobs").upsert(state.jobs.map((job) => ({
    id: job.id,
    company_id: companyId,
    name: job.name,
    phone: job.phone,
    email: job.email,
    address: job.address,
    job_type: job.type,
    payment_type: job.paymentType,
    sales_rep: job.salesRep,
    production_manager: job.productionManager,
    status: job.status,
    start_date: job.startDate || null,
    target_completion_date: job.targetDate || null,
    inspection_date: job.inspectionDate || null,
    materials_status: job.materialsStatus,
    homeowner_update_needed: job.homeownerUpdateNeeded,
    notes: job.notes,
    timeline: job.timeline
  })), { onConflict: "id" });
  await replaceChildren("tasks", state.jobs.flatMap((job) => job.tasks.map((item) => ({ id: item.id, company_id: companyId, job_id: job.id, title: item.title, assigned_to: item.assignedTo, due_date: item.dueDate || null, due_time: item.time || null, priority: item.priority, complete: item.complete, notes: item.notes }))));
  await replaceChildren("schedule_items", state.jobs.flatMap((job) => job.schedule.map((item) => ({ id: item.id, company_id: companyId, job_id: job.id, trade: item.trade, subcontractor: item.subcontractor, scheduled_date: item.date || null, scheduled_time: item.time || null, status: item.status, notes: item.notes }))));
  await replaceChildren("work_orders", state.jobs.flatMap((job) => job.workOrders.map((item) => ({ id: item.id, company_id: companyId, job_id: job.id, trade: item.trade, scope: item.scope, scheduled_date: item.date || null, scheduled_time: item.time || null, subcontractor: item.subcontractor, notes: item.notes }))));
  await replaceChildren("punch_list_items", state.jobs.flatMap((job) => job.punchList.map((item) => ({ id: item.id, company_id: companyId, job_id: job.id, title: item.title, assigned_to: item.assignedTo, due_date: item.dueDate || null, due_time: item.time || null, complete: item.complete, notes: item.notes }))));
  await replaceChildren("calendar_events", state.jobs.flatMap((job) => job.reminders.map((item) => ({ id: item.id, company_id: companyId, job_id: job.id, title: item.title, event_type: item.eventType || "Reminder", event_date: item.date || null, event_time: item.time || null, assigned_to: item.assignedTo, status: item.status, notes: item.notes }))).concat((state.calendarEvents || []).map((item) => ({ id: item.id, company_id: companyId, job_id: null, title: item.title, event_type: item.eventType || "Custom", event_date: item.date || null, event_time: item.time || null, assigned_to: item.assignedTo, status: item.status, notes: item.notes }))));
  await replaceChildren("notes", state.jobs.flatMap((job) => job.notesActivity.map((item) => ({ id: item.id, company_id: companyId, job_id: job.id, author_id: item.authorId || profile.id, author_name: item.author || profile.full_name, body: item.text, created_at: item.timestamp }))));
  await replaceChildren("mentions", state.jobs.flatMap((job) => job.notesActivity.flatMap((note) => (note.mentions || []).map((name) => ({ id: `${note.id}_${name}`, company_id: companyId, job_id: job.id, note_id: note.id, tagged_name: name, tagged_user_id: memberIdByName(name) })))));
  await replaceChildren("notifications", state.notifications.map((item) => ({ id: item.id, company_id: companyId, user_id: item.userId || memberIdByName(item.taggedUser), type: item.type, tagged_name: item.taggedUser, job_id: item.jobId, note_id: item.noteId, read: item.read, created_at: item.timestamp })));
}

async function replaceChildren(table, rows) {
  await supabase.from(table).delete().eq("company_id", company.id);
  if (rows.length) await supabase.from(table).insert(rows);
}

function memberIdByName(name) {
  return workspaceMembers.find((member) => (member.profiles?.full_name || member.profiles?.email?.split("@")[0]) === name)?.user_id || profile.id;
}

async function testSupabaseConnection() {
  authStatus = { ok: null, title: "Testing Supabase", message: "Checking config, client, and Auth endpoint..." };
  renderLogin();
  try {
    if (!isSupabaseConfigured) throw new Error("Supabase URL or anon key is missing or malformed.");
    if (!supabase) await initSupabaseClient();
    if (!supabase) throw supabaseInitError || new Error("Supabase client failed to initialize.");
    const authSettingsUrl = `${trimSlash(SUPABASE_URL)}/auth/v1/settings`;
    const response = await fetch(authSettingsUrl, {
      method: "GET",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`
      },
      cache: "no-store"
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Auth settings request failed: HTTP ${response.status} ${response.statusText}. ${text.slice(0, 240)}`);
    }
    const { error } = await supabase.auth.getSession();
    if (error) throw error;
    authStatus = { ok: true, title: "Supabase connection works", message: `Reached ${authSettingsUrl}. Client initialized and auth session check completed.` };
  } catch (error) {
    authStatus = { ok: false, title: "Supabase connection failed", error };
  }
  renderLogin();
}

function makeJob(data = {}) {
  return {
    id: uid("job"),
    name: "", phone: "", email: "", address: "", type: "", paymentType: "",
    salesRep: "", productionManager: "", status: "New Lead",
    startDate: "", targetDate: "", materialsStatus: "Not needed",
    homeownerUpdateNeeded: false, notes: "",
    tasks: [], schedule: [], subs: [], workOrders: [], punchList: [],
    notesActivity: [], reminders: [],
    timeline: [{ id: uid("log"), date: todayIso, text: "Job created" }],
    ...data
  };
}

function task(title, assignedTo, dueDate, priority, complete = false) {
  return { id: uid("task"), title, assignedTo, dueDate, priority, complete, notes: "" };
}

function schedule(trade, sub, date, status, notes = "") {
  return { id: uid("sch"), trade, subcontractor: sub, date, status, notes };
}

function punch(title, assignedTo, complete = false) {
  return { id: uid("punch"), title, assignedTo, complete };
}

function render() {
  saveState();
  companyLabel.textContent = state.settings.companyName || "JobCommand";
  document.querySelectorAll(".nav-item").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === currentView);
  });
  const routes = {
    today: renderToday,
    jobs: renderJobs,
    calendar: renderCalendar,
    detail: renderJobDetail,
    schedule: renderSchedule,
    workOrders: renderWorkOrders,
    settings: renderSettings
  };
  routes[currentView]();
  view.focus({ preventScroll: true });
}

function renderToday() {
  viewTitle.textContent = "Today";
  const jobs = state.jobs;
  const weekEnd = addDays(7);
  const dueToday = allTasks().filter(({ item }) => !item.complete && item.dueDate === todayIso);
  const overdue = allTasks().filter(({ item }) => !item.complete && item.dueDate && item.dueDate < todayIso);
  const waitingOnSubs = jobs.filter((job) => job.status === "Waiting on Sub");
  const mentions = unreadMentions();
  const calendarToday = buildCalendarEvents().filter((event) => event.date === todayIso);
  const sections = [
    ["Notifications", inAppNotifications(mentions, dueToday, overdue, calendarToday)],
    ["Mentions", mentions],
    ["Calendar items due today", calendarToday],
    ["Jobs starting today", jobs.filter((job) => job.startDate === todayIso)],
    ["Jobs starting this week", jobs.filter((job) => job.startDate >= todayIso && job.startDate <= weekEnd)],
    ["Tasks due today", dueToday],
    ["Overdue tasks", overdue],
    ["Jobs waiting on subs", waitingOnSubs],
    ["Jobs missing materials", jobs.filter((job) => job.materialsStatus === "Missing" || job.status === "Materials Needed")],
    ["Jobs in punch list", jobs.filter((job) => openPunch(job).length || job.status === "Punch List")],
    ["Need homeowner update", jobs.filter((job) => job.homeownerUpdateNeeded)],
    ["Ready to invoice", jobs.filter((job) => job.status === "Complete")]
  ];
  if (!jobs.length) {
    view.innerHTML = `
      ${commandHeader("JobCommand", todayLabel(), "What jobs need attention today, and what needs to happen next?")}
      ${emptyState("No jobs need attention yet. Add your first job to start tracking production.", "Add Job")}
    `;
    return;
  }
  view.innerHTML = `
    ${commandHeader("JobCommand", todayLabel(), `${attentionJobs().length} jobs need attention today. ${mentions.length} unread mention${mentions.length === 1 ? "" : "s"}.`)}
    <section class="metric-grid section">
      <div class="metric"><strong>${activeJobs().length}</strong><span>Active Jobs</span></div>
      <div class="metric attention"><strong>${attentionJobs().length}</strong><span>Need Attention</span></div>
      <div class="metric"><strong>${dueToday.length}</strong><span>Due Today</span></div>
      <div class="metric"><strong>${waitingOnSubs.length}</strong><span>Waiting on Subs</span></div>
    </section>
    ${sections.map(renderTodaySection).join("")}
  `;
}

function commandHeader(title, date, summary) {
  return `<section class="command-header section">
    <div>
      <p class="eyebrow">${date}</p>
      <h2>${title}</h2>
      <p>${summary}</p>
    </div>
    <button class="primary-button compact-action" data-action="add-job" type="button">Add Job</button>
  </section>`;
}

function renderTodaySection([title, items]) {
  return `<section class="section"><h2>${title}</h2><div class="stack">${
    items.length ? items.map((entry) => {
      if (entry.note) return mentionRow(entry);
      if (entry.notice) return notificationRow(entry);
      if (entry.kind) return calendarCard(entry);
      return entry.job ? taskRow(entry) : miniJob(entry);
    }).join("") : `<div class="empty">Nothing here right now.</div>`
  }</div></section>`;
}

function notificationRow(entry) {
  return `<article class="list-row notification-card">
    <div class="row-between"><div><strong>${entry.title}</strong><p class="subtle">${entry.detail}</p></div>${pill(entry.type, entry.tone || "blue")}</div>
    ${entry.jobId ? `<button class="ghost-button" data-action="open-job" data-id="${entry.jobId}" type="button">Open job</button>` : ""}
  </article>`;
}

function mentionRow(entry) {
  return `<article class="list-row mention-card">
    <div class="row-between">
      <div><strong>${entry.job.name}</strong><p class="subtle">${highlightMentions(entry.note.text)}</p></div>
      ${pill("Unread", "warn")}
    </div>
    <p class="subtle">${entry.note.author || "Team"} / ${formatDateTime(entry.note.timestamp)}</p>
    <div class="row-actions"><button class="secondary-button" data-action="open-job" data-id="${entry.job.id}" type="button">Open job</button><button class="ghost-button" data-action="mark-mention-read" data-id="${entry.notification.id}" type="button">Mark read</button></div>
  </article>`;
}

function miniJob(job) {
  return `<article class="list-row">
    <div class="row-between">
      <div><button class="job-title" data-action="open-job" data-id="${job.id}" type="button">${job.name}</button>
      <p class="subtle">${job.type || "Job"} / ${job.status}</p></div>
      ${attentionPill(job)}
    </div>
    <div class="pill-row">${job.startDate ? pill(`Start ${fmt(job.startDate)}`, "blue") : pill("No start date", "warn")}${pill(job.productionManager || "No PM")}</div>
  </article>`;
}

function taskRow({ job, item }) {
  return `<article class="list-row">
    <div class="row-between"><div><strong>${item.title}</strong><p class="subtle">${job.name} / ${item.assignedTo || "Unassigned"}</p></div>${pill(item.priority || "Normal", item.priority === "High" ? "danger" : "blue")}</div>
    <div class="row-actions"><button class="secondary-button" data-action="open-job" data-id="${job.id}" type="button">Open job</button><button class="ghost-button" data-action="complete-task" data-job="${job.id}" data-id="${item.id}" type="button">Complete</button></div>
  </article>`;
}

function renderJobs() {
  viewTitle.textContent = "Jobs";
  const filters = getFilters();
  const jobs = state.jobs.filter((job) => matchesFilters(job, filters));
  if (!state.jobs.length) {
    view.innerHTML = emptyState("No jobs yet. Add your first job to build your production board.", "Add Job");
    return;
  }
  view.innerHTML = `
    <section class="toolbar board-toolbar">
      <div><h2>Production Board</h2><p class="subtle">${jobs.length} of ${state.jobs.length} jobs shown</p></div>
      <button class="primary-button" data-action="add-job" type="button">Add Job</button>
    </section>
    <section class="filters">
      <input id="search" placeholder="Search jobs, customer, address" value="${filters.search}" />
      ${selectHtml("statusFilter", ["All statuses", ...state.settings.statuses], filters.status)}
      ${selectHtml("typeFilter", ["All job types", ...unique(state.jobs.map((j) => j.type).filter(Boolean))], filters.type)}
      ${selectHtml("salesFilter", ["All sales reps", ...state.settings.teamMembers], filters.sales)}
      ${selectHtml("pmFilter", ["All PMs", ...state.settings.teamMembers], filters.pm)}
      ${selectHtml("tradeFilter", ["All trades", ...state.settings.trades], filters.trade)}
    </section>
    <section class="stack">${jobs.length ? jobs.map(jobCard).join("") : `<div class="empty">No jobs match those filters.</div>`}</section>
  `;
  ["search", "statusFilter", "typeFilter", "salesFilter", "pmFilter", "tradeFilter"].forEach((id) => {
    document.querySelector(`#${id}`).addEventListener("input", () => {
      sessionStorage.setItem(`filter.${id}`, document.querySelector(`#${id}`).value);
      renderJobs();
    });
  });
}

function getFilters() {
  return {
    search: sessionStorage.getItem("filter.search") || "",
    status: sessionStorage.getItem("filter.statusFilter") || "All statuses",
    type: sessionStorage.getItem("filter.typeFilter") || "All job types",
    sales: sessionStorage.getItem("filter.salesFilter") || "All sales reps",
    pm: sessionStorage.getItem("filter.pmFilter") || "All PMs",
    trade: sessionStorage.getItem("filter.tradeFilter") || "All trades"
  };
}

function matchesFilters(job, f) {
  const haystack = `${job.name} ${job.address} ${job.type} ${job.status}`.toLowerCase();
  return (!f.search || haystack.includes(f.search.toLowerCase()))
    && (f.status.startsWith("All") || job.status === f.status)
    && (f.type.startsWith("All") || job.type === f.type)
    && (f.sales.startsWith("All") || job.salesRep === f.sales)
    && (f.pm.startsWith("All") || job.productionManager === f.pm)
    && (f.trade.startsWith("All") || job.schedule.some((s) => s.trade === f.trade) || job.workOrders.some((w) => w.trade === f.trade));
}

function jobCard(job) {
  return `<article class="job-card">
    <div class="card-head">
      <div><button class="job-title" data-action="open-job" data-id="${job.id}" type="button">${job.name}</button>
      <p class="subtle">${job.type || "No type"} / ${job.address || "No address"}</p></div>
      ${statusBadge(job.status)}
    </div>
    <p class="next-step"><strong>Next:</strong> ${nextStep(job)}</p>
    <select class="quick-status" data-action="status" data-id="${job.id}">${state.settings.statuses.map((s) => `<option ${s === job.status ? "selected" : ""}>${s}</option>`).join("")}</select>
    <div class="job-meta"><span>PM: ${job.productionManager || "Unassigned"}</span><span>Sales: ${job.salesRep || "Unassigned"}</span></div>
    <div class="pill-row">${attentionPill(job)}${job.startDate ? pill(fmt(job.startDate), "blue") : pill("Missing schedule", "warn")}${job.materialsStatus === "Missing" ? pill("Missing materials", "danger") : pill(job.materialsStatus)}</div>
  </article>`;
}

function renderJobDetail() {
  const job = findJob(activeJobId) || state.jobs[0];
  if (!job) return renderJobs();
  activeJobId = job.id;
  viewTitle.textContent = job.name;
  view.innerHTML = `
    <section class="detail-grid">
      <div class="stack">
        <article class="card">
          <div class="card-head"><h2>Job Info</h2><button class="secondary-button" data-action="edit-job" data-id="${job.id}" type="button">Edit</button></div>
          <div class="field-grid">${field("Phone", job.phone)}${field("Email", job.email)}${field("Address", job.address)}${field("Type", job.type)}${field("Payment", job.paymentType)}${field("Sales rep", job.salesRep)}${field("PM", job.productionManager)}${field("Status", job.status)}${field("Start", fmt(job.startDate))}${field("Target", fmt(job.targetDate))}${field("Materials", job.materialsStatus)}${field("Update needed", job.homeownerUpdateNeeded ? "Yes" : "No")}</div>
          <p class="subtle">${job.notes || "No notes yet."}</p>
          <div class="row-actions"><button class="secondary-button" data-action="draft-update" data-id="${job.id}" type="button">Draft homeowner update</button><button class="ghost-button" data-action="toggle-update" data-id="${job.id}" type="button">${job.homeownerUpdateNeeded ? "Clear update flag" : "Needs update"}</button></div>
        </article>
        <article class="card">
          <div class="card-head"><h2>Notes / Activity Feed</h2><button class="secondary-button" data-action="add-note" data-id="${job.id}" type="button">Add Note</button></div>
          ${noteFilter(job)}
          <div class="stack">${job.notesActivity.length ? job.notesActivity.map((note) => noteDetail(job, note)).join("") : `<div class="empty">No tagged notes yet.</div>`}</div>
        </article>
        ${detailSection("Tasks", job.tasks.map((t) => taskDetail(job, t)).join(""), "add-task", job.id)}
        ${detailSection("Schedule", job.schedule.map((s) => scheduleDetail(job, s)).join(""), "add-schedule", job.id)}
        ${detailSection("Work Orders", job.workOrders.map((w) => workOrderDetail(job, w)).join(""), "add-work-order", job.id)}
      </div>
      <div class="stack">
    ${detailSection("Subcontractors / Trades", subSummary(job), "add-sub", job.id)}
        ${detailSection("Reminders", job.reminders.map((r) => reminderDetail(job, r)).join(""), "add-reminder", job.id)}
        ${detailSection("Punch List", job.punchList.map((p) => punchDetail(job, p)).join(""), "add-punch", job.id)}
        <article class="card"><h2>Timeline</h2><div class="stack">${job.timeline.map((l) => `<div class="list-row"><strong>${fmt(l.date)}</strong><span class="subtle">${l.text}</span></div>`).join("")}</div></article>
      </div>
    </section>
  `;
}

function detailSection(title, content, action, id) {
  return `<article class="card"><div class="card-head"><h2>${title}</h2><button class="secondary-button" data-action="${action}" data-id="${id}" type="button">Add</button></div><div class="stack">${content || `<div class="empty">No ${title.toLowerCase()} yet.</div>`}</div></article>`;
}

function taskDetail(job, t) {
  return `<div class="list-row"><label class="check-row"><input data-action="toggle-task" data-job="${job.id}" data-id="${t.id}" type="checkbox" ${t.complete ? "checked" : ""}> <strong>${t.title}</strong></label><p class="subtle">${t.assignedTo || "Unassigned"} / Due ${fmt(t.dueDate)} ${t.time || ""} / ${t.priority || "Normal"}</p><div class="row-actions"><button class="secondary-button" data-action="export-calendar" data-job="${job.id}" data-kind="task" data-id="${t.id}" type="button">Export Calendar Event</button><button class="ghost-button" data-action="edit-task" data-job="${job.id}" data-id="${t.id}" type="button">Edit</button><button class="ghost-button" data-action="delete-task" data-job="${job.id}" data-id="${t.id}" type="button">Delete</button></div></div>`;
}

function scheduleDetail(job, s) {
  return `<div class="list-row"><strong>${s.trade} / ${fmt(s.date)} ${s.time || ""}</strong><p class="subtle">${s.subcontractor || "No sub"} / ${s.status || "Scheduled"} ${s.notes ? "/ " + s.notes : ""}</p><div class="row-actions"><button class="secondary-button" data-action="export-calendar" data-job="${job.id}" data-kind="schedule" data-id="${s.id}" type="button">Export Calendar Event</button><button class="ghost-button" data-action="edit-schedule" data-job="${job.id}" data-id="${s.id}" type="button">Edit</button><button class="ghost-button" data-action="delete-schedule" data-job="${job.id}" data-id="${s.id}" type="button">Delete</button></div></div>`;
}

function workOrderDetail(job, w) {
  return `<div class="list-row"><strong>${w.trade} / ${fmt(w.date)} ${w.time || ""}</strong><p class="subtle">${w.subcontractor || "No sub"} / ${w.scope || "No scope"}</p><div class="row-actions"><button class="secondary-button" data-action="print-work-order" data-job="${job.id}" data-id="${w.id}" type="button">Print/export</button><button class="secondary-button" data-action="export-calendar" data-job="${job.id}" data-kind="work-order" data-id="${w.id}" type="button">Export Calendar Event</button><button class="ghost-button" data-action="edit-work-order" data-job="${job.id}" data-id="${w.id}" type="button">Edit</button><button class="ghost-button" data-action="delete-work-order" data-job="${job.id}" data-id="${w.id}" type="button">Delete</button></div></div>`;
}

function punchDetail(job, p) {
  return `<div class="list-row"><label class="check-row"><input data-action="toggle-punch" data-job="${job.id}" data-id="${p.id}" type="checkbox" ${p.complete ? "checked" : ""}> <strong>${p.title}</strong></label><p class="subtle">${p.assignedTo || "Unassigned"} ${p.dueDate ? "/ Due " + fmt(p.dueDate) : ""}</p><div class="row-actions"><button class="secondary-button" data-action="export-calendar" data-job="${job.id}" data-kind="punch" data-id="${p.id}" type="button">Export Calendar Event</button><button class="ghost-button" data-action="edit-punch" data-job="${job.id}" data-id="${p.id}" type="button">Edit</button><button class="ghost-button" data-action="delete-punch" data-job="${job.id}" data-id="${p.id}" type="button">Delete</button></div></div>`;
}

function reminderDetail(job, r) {
  return `<div class="list-row"><strong>${r.title || "Reminder"}</strong><p class="subtle">${fmt(r.date)} ${r.time || ""} / ${r.assignedTo || "Unassigned"} ${r.notes ? "/ " + r.notes : ""}</p><div class="row-actions"><button class="secondary-button" data-action="export-calendar" data-job="${job.id}" data-kind="reminder" data-id="${r.id}" type="button">Export Calendar Event</button><button class="ghost-button" data-action="edit-reminder" data-job="${job.id}" data-id="${r.id}" type="button">Edit</button><button class="ghost-button" data-action="delete-reminder" data-job="${job.id}" data-id="${r.id}" type="button">Delete</button></div></div>`;
}

function noteFilter(job) {
  const tagged = unique(job.notesActivity.flatMap((note) => note.mentions || []));
  if (!tagged.length) return "";
  return `<div class="note-filter"><span class="tiny">Tagged:</span>${tagged.map((name) => `<button class="tag-chip" data-action="filter-notes" data-job="${job.id}" data-user="${name}" type="button">@${name}</button>`).join("")}<button class="tag-chip" data-action="filter-notes" data-job="${job.id}" data-user="" type="button">All</button></div>`;
}

function noteDetail(job, note) {
  if (job.noteFilter && !(note.mentions || []).includes(job.noteFilter)) return "";
  return `<div class="list-row note-card"><div class="row-between"><strong>${note.author || "Team"}</strong>${pill(formatDateTime(note.timestamp), "blue")}</div><p>${highlightMentions(note.text)}</p>${(note.mentions || []).length ? `<div class="pill-row">${note.mentions.map((name) => pill("@" + name, "warn")).join("")}</div>` : ""}</div>`;
}

function subSummary(job) {
  const directSubs = job.subs.map((sub) => `<div class="list-row"><strong>${sub.trade}</strong><span class="subtle">${sub.name || "No contact added"} ${sub.notes ? "/ " + sub.notes : ""}</span><div class="row-actions"><button class="ghost-button" data-action="edit-sub" data-job="${job.id}" data-id="${sub.id}" type="button">Edit</button><button class="ghost-button" data-action="delete-sub" data-job="${job.id}" data-id="${sub.id}" type="button">Delete</button></div></div>`);
  const linkedSubs = [...job.schedule.map((s) => ({ trade: s.trade, name: s.subcontractor })), ...job.workOrders.map((w) => ({ trade: w.trade, name: w.subcontractor }))];
  return directSubs.concat(linkedSubs.map((s) => `<div class="list-row"><strong>${s.trade}</strong><span class="subtle">${s.name || "No contact added"}</span></div>`)).join("");
}

function renderSchedule() {
  viewTitle.textContent = "Schedule";
  const rows = state.jobs.flatMap((job) => job.schedule.map((item) => ({ job, item }))).sort((a, b) => (a.item.date || "").localeCompare(b.item.date || ""));
  let lastDate = "";
  view.innerHTML = `<section class="stack">${rows.map(({ job, item }) => {
    const header = item.date !== lastDate ? `<h2 class="date-group">${fmt(item.date)}</h2>` : "";
    lastDate = item.date;
    return `${header}<article class="list-row"><div class="row-between"><div><strong>${item.trade}</strong><p class="subtle">${job.name} / ${item.subcontractor || "No sub"}</p></div>${pill(item.status || "Scheduled", item.status === "Needs materials" ? "warn" : "blue")}</div><div class="row-actions"><button class="secondary-button" data-action="export-calendar" data-job="${job.id}" data-kind="schedule" data-id="${item.id}" type="button">Export Calendar Event</button><button class="ghost-button" data-action="open-job" data-id="${job.id}" type="button">Open job</button></div></article>`;
  }).join("") || `<div class="empty">No scheduled work yet.</div>`}</section>`;
}

function renderCalendar() {
  viewTitle.textContent = "Calendar";
  const events = buildCalendarEvents();
  const monthEvents = events.filter((event) => event.date?.startsWith(monthKey(calendarCursor)));
  const selectedEvents = events.filter((event) => event.date === selectedCalendarDate);
  view.innerHTML = `
    <section class="calendar-head section">
      <div><h2>${calendarCursor.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</h2><p class="subtle">Jobs, tasks, trades, work orders, reminders, inspections, and custom events.</p></div>
      <div class="calendar-controls">
        <button class="ghost-button" data-action="calendar-prev" type="button">Prev</button>
        <button class="secondary-button" data-action="calendar-today" type="button">Today</button>
        <button class="ghost-button" data-action="calendar-next" type="button">Next</button>
      </div>
    </section>
    <section class="calendar-grid-card section">
      <div class="calendar-weekdays">${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => `<span>${day}</span>`).join("")}</div>
      <div class="calendar-grid">${monthCells(calendarCursor, monthEvents)}</div>
    </section>
    <section class="toolbar board-toolbar">
      <div><h2>${fmt(selectedCalendarDate)}</h2><p class="subtle">${selectedEvents.length} event${selectedEvents.length === 1 ? "" : "s"} selected</p></div>
      <button class="primary-button" data-action="add-calendar-event" type="button">Add Calendar Event</button>
    </section>
    <section class="stack">${selectedEvents.length ? selectedEvents.map(calendarCard).join("") : `<div class="empty">No calendar items for this date.</div>`}</section>
  `;
}

function monthCells(cursor, events) {
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const first = new Date(year, month, 1);
  const start = new Date(first);
  start.setDate(first.getDate() - first.getDay());
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    const iso = date.toISOString().slice(0, 10);
    const dayEvents = events.filter((event) => event.date === iso);
    const visible = dayEvents.slice(0, 2);
    return `<button class="calendar-day ${date.getMonth() !== month ? "muted-day" : ""} ${iso === todayIso ? "today-day" : ""} ${iso === selectedCalendarDate ? "selected-day" : ""}" data-action="select-calendar-date" data-date="${iso}" type="button">
      <span class="day-number">${date.getDate()}</span>
      <span class="day-events">${visible.map((event) => `<span class="event-chip">${shortEvent(event)}</span>`).join("")}${dayEvents.length > 2 ? `<span class="event-chip more">+${dayEvents.length - 2} more</span>` : ""}</span>
    </button>`;
  }).join("");
}

function calendarCard(event) {
  return `<article class="calendar-card list-row">
    <div class="row-between">
      <div><strong>${event.title}</strong><p class="subtle">${event.job?.name || "General calendar"}${event.job?.address ? " / " + event.job.address : ""}</p></div>
      ${pill(event.type, event.tone || "blue")}
    </div>
    <p class="subtle">${event.time || "All day"} ${event.trade ? "/ " + event.trade : ""} ${event.assignedTo ? "/ " + event.assignedTo : ""} ${event.status ? "/ " + event.status : ""}</p>
    ${event.notes ? `<p>${event.notes}</p>` : ""}
    <div class="row-actions">${event.job?.id ? `<button class="secondary-button" data-action="open-job" data-id="${event.job.id}" type="button">Open job</button>` : ""}<button class="ghost-button" data-action="export-calendar" data-job="${event.job?.id || ""}" data-kind="${event.kind}" data-id="${event.sourceId}" type="button">Add to Phone Calendar</button></div>
  </article>`;
}

function renderWorkOrders() {
  viewTitle.textContent = "Work Orders";
  const rows = state.jobs.flatMap((job) => job.workOrders.map((item) => ({ job, item }))).sort((a, b) => (a.item.date || "").localeCompare(b.item.date || ""));
  view.innerHTML = `<section class="stack">${rows.map(({ job, item }) => `<article class="list-row"><strong>${item.trade} / ${job.name}</strong><p class="subtle">${fmt(item.date)} / ${item.subcontractor || "No sub"}</p><p>${item.scope || "No scope added."}</p><div class="row-actions"><button class="secondary-button" data-action="print-work-order" data-job="${job.id}" data-id="${item.id}" type="button">Print/export</button><button class="secondary-button" data-action="export-calendar" data-job="${job.id}" data-kind="work-order" data-id="${item.id}" type="button">Export Calendar Event</button><button class="ghost-button" data-action="open-job" data-id="${job.id}" type="button">Open job</button></div></article>`).join("") || `<div class="empty">No work orders yet.</div>`}</section>`;
}

function renderSettings() {
  viewTitle.textContent = "Settings";
  view.innerHTML = `
    <section class="stack">
      <article class="card"><h2>Account</h2><p class="subtle">${profile?.email || "Signed in"}</p><button class="ghost-button" data-action="logout" type="button">Log out</button></article>
      <article class="card"><h2>Company</h2><label>Company name<input id="companyName" value="${state.settings.companyName}"></label><label>Current user<select id="currentUser">${options(state.settings.teamMembers, state.settings.currentUser)}</select></label></article>
      <article class="card"><h2>Lists</h2><label>Team members<textarea id="teamMembers" rows="4">${state.settings.teamMembers.join("\n")}</textarea></label><label>Trades<textarea id="trades" rows="6">${state.settings.trades.join("\n")}</textarea></label><label>Job statuses<textarea id="statuses" rows="7">${state.settings.statuses.join("\n")}</textarea></label><button class="primary-button" data-action="save-settings" type="button">Save settings</button></article>
      <article class="card"><h2>Backup & Migration</h2><p class="subtle">Use export for a backup. Use import to bring an old localStorage backup into the active Supabase workspace.</p><div class="row-actions"><button class="secondary-button" data-action="export" type="button">Export backup JSON</button><button class="ghost-button" data-action="import" type="button">Import backup JSON to Workspace</button></div></article>
      <article class="card"><h2>Reset</h2><button class="danger-button" data-action="clear-data" type="button">Clear all data</button></article>
    </section>
  `;
}

function openJobForm(job = makeJob()) {
  const template = document.querySelector("#jobFormTemplate").content.cloneNode(true);
  const form = document.createElement("form");
  form.append(template);
  form.querySelector("[name=salesRep]").innerHTML = options(state.settings.teamMembers, job.salesRep);
  form.querySelector("[name=productionManager]").innerHTML = options(state.settings.teamMembers, job.productionManager);
  form.querySelector("[name=status]").innerHTML = options(state.settings.statuses, job.status);
  Object.entries(job).forEach(([key, value]) => {
    const input = form.querySelector(`[name="${key}"]`);
    if (!input) return;
    if (input.type === "checkbox") input.checked = Boolean(value);
    else input.value = value || "";
  });
  openModal(job.id && findJob(job.id) ? "Edit Job" : "Add Job", form);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form).entries());
    data.homeownerUpdateNeeded = form.querySelector("[name=homeownerUpdateNeeded]").checked;
    const existing = findJob(job.id);
    if (existing) Object.assign(existing, data);
    else state.jobs.unshift(makeJob(data));
    log(existing || state.jobs[0], existing ? "Job details updated" : "Job added");
    closeModal();
    currentView = existing ? "detail" : "jobs";
    activeJobId = (existing || state.jobs[0]).id;
    render();
  });
}

function openItemForm(kind, jobId, itemId) {
  const job = findJob(jobId);
  const maps = {
    task: { list: "tasks", title: "Task", fields: [["title", "Task title"], ["assignedTo", "Assigned to"], ["dueDate", "Due date", "date"], ["time", "Time", "time"], ["priority", "Priority", "select", ["Low", "Normal", "High"]], ["notes", "Notes", "textarea"]] },
    schedule: { list: "schedule", title: "Schedule Item", fields: [["trade", "Trade", "select", state.settings.trades], ["subcontractor", "Subcontractor/contact"], ["date", "Scheduled date", "date"], ["time", "Time", "time"], ["status", "Status"], ["notes", "Notes", "textarea"]] },
    "work-order": { list: "workOrders", title: "Work Order", fields: [["trade", "Trade", "select", state.settings.trades], ["scope", "Scope of work", "textarea"], ["date", "Scheduled date", "date"], ["time", "Time", "time"], ["subcontractor", "Subcontractor/contact"], ["notes", "Notes", "textarea"]] },
    punch: { list: "punchList", title: "Punch List Item", fields: [["title", "Item"], ["assignedTo", "Assigned to"], ["dueDate", "Due date", "date"], ["time", "Time", "time"], ["notes", "Notes", "textarea"]] },
    reminder: { list: "reminders", title: "Reminder", fields: [["title", "Reminder title"], ["assignedTo", "Assigned to"], ["date", "Date", "date"], ["time", "Time", "time"], ["status", "Status"], ["notes", "Notes", "textarea"]] },
    sub: { list: "subs", title: "Subcontractor / Trade", fields: [["trade", "Trade", "select", state.settings.trades], ["name", "Name/contact"], ["notes", "Notes", "textarea"]] }
  };
  const config = maps[kind];
  const item = itemId ? job[config.list].find((x) => x.id === itemId) : {};
  const form = document.createElement("form");
  form.className = "form-grid";
  form.innerHTML = config.fields.map(([name, label, type, choices]) => inputField(name, label, type, choices, item[name])).join("") + `<div class="modal-actions full"><button class="primary-button" type="submit">Save ${config.title.toLowerCase()}</button></div>`;
  openModal(itemId ? `Edit ${config.title}` : `Add ${config.title}`, form);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form).entries());
    if (itemId) Object.assign(item, data);
    else job[config.list].push({ id: uid(kind), complete: false, ...data });
    log(job, `${config.title} ${itemId ? "updated" : "added"}`);
    closeModal();
    render();
  });
}

function inputField(name, label, type = "text", choices = [], value = "") {
  if (type === "textarea") return `<label class="full">${label}<textarea name="${name}" rows="4">${value || ""}</textarea></label>`;
  if (type === "select") return `<label>${label}<select name="${name}">${options(choices, value)}</select></label>`;
  return `<label>${label}<input name="${name}" type="${type}" value="${value || ""}" /></label>`;
}

function openNoteForm(jobId) {
  const job = findJob(jobId);
  const form = document.createElement("form");
  form.className = "form-grid";
  form.innerHTML = `
    <label>Author<select name="author">${options(state.settings.teamMembers, state.settings.currentUser)}</select></label>
    <label class="full">Note<textarea name="text" rows="5" placeholder="Type a note. Use @Seth or @Lynn to tag someone."></textarea></label>
    <p class="subtle full">Mentions create in-app notifications only. Real push notifications will require notification permissions and a backend service later.</p>
    <div class="modal-actions split-actions full"><button class="ghost-button" data-action="close-modal" type="button">Cancel</button><button class="primary-button" type="submit">Save note</button></div>
  `;
  openModal("Add Note", form);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form).entries());
    const mentions = extractMentions(data.text);
    const note = { id: uid("note"), author: data.author, authorId: profile?.id || "", text: data.text, mentions, timestamp: new Date().toISOString() };
    job.notesActivity.unshift(note);
    log(job, `Note added by ${data.author || "Team"}`);
    mentions.forEach((name) => {
      state.notifications.unshift({ id: uid("mention"), type: "mention", taggedUser: name, userId: memberIdByName(name), jobId: job.id, noteId: note.id, timestamp: note.timestamp, read: false });
    });
    closeModal();
    render();
  });
}

function openCalendarEventForm() {
  const form = document.createElement("form");
  form.className = "form-grid";
  form.innerHTML = `
    <label>Event title<input name="title" required /></label>
    <label>Type<select name="eventType">${options(["Custom", "Reminder", "Inspection"], "Custom")}</select></label>
    <label>Date<input name="date" type="date" value="${selectedCalendarDate}" required /></label>
    <label>Time<input name="time" type="time" /></label>
    <label>Assigned to<input name="assignedTo" /></label>
    <label>Status<input name="status" /></label>
    <label class="full">Notes<textarea name="notes" rows="4"></textarea></label>
    <div class="modal-actions split-actions full"><button class="ghost-button" data-action="close-modal" type="button">Cancel</button><button class="primary-button" type="submit">Save event</button></div>
  `;
  openModal("Add Calendar Event", form);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    state.calendarEvents.unshift({ id: uid("cal"), ...Object.fromEntries(new FormData(form).entries()) });
    closeModal();
    render();
  });
}

function draftHomeownerUpdate(job) {
  const next = job.schedule.filter((s) => !s.date || s.date >= todayIso).sort((a, b) => (a.date || "").localeCompare(b.date || ""))[0];
  const text = `Hi ${job.name.split(" ")[0]}, quick update on your project: the current status is ${job.status}. ${next ? `Next scheduled item is ${next.trade} on ${fmt(next.date)} with ${next.subcontractor || "our crew"}. ` : "We are confirming the next scheduled step. "}${job.notes ? `Note: ${job.notes}` : "We will keep you posted as production moves forward."}`;
  const box = document.createElement("div");
  box.innerHTML = `<label>Copyable update draft<textarea rows="8">${text}</textarea></label><div class="modal-actions"><button class="primary-button" data-action="copy-draft" type="button">Copy text</button></div>`;
  openModal("Homeowner Update Draft", box);
  box.querySelector("button").addEventListener("click", () => navigator.clipboard?.writeText(text));
}

function printWorkOrder(job, item) {
  const sheet = document.createElement("div");
  sheet.className = "print-sheet";
  sheet.innerHTML = `<h1>Work Order</h1><h2>${job.name}</h2><p><strong>Address:</strong> ${job.address || ""}</p><p><strong>Trade:</strong> ${item.trade || ""}</p><p><strong>Scheduled:</strong> ${fmt(item.date)}</p><p><strong>Subcontractor:</strong> ${item.subcontractor || ""}</p><h3>Scope of Work</h3><p>${item.scope || ""}</p><h3>Notes</h3><p>${item.notes || ""}</p><p><strong>Production manager:</strong> ${job.productionManager || ""}</p>`;
  openModal("Print / Export Work Order", sheet);
  const button = document.createElement("button");
  button.className = "primary-button";
  button.type = "button";
  button.textContent = "Print";
  sheet.append(button);
  button.addEventListener("click", () => window.print());
}

function openImport() {
  const form = document.createElement("form");
  form.innerHTML = `<label>Paste backup JSON<textarea name="json" rows="10"></textarea></label><div class="modal-actions"><button class="primary-button" type="submit">Import backup</button></div>`;
  openModal("Import Backup", form);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    try {
      state = sanitizeState(JSON.parse(new FormData(form).get("json")));
      saveState();
      closeModal();
      render();
    } catch {
      alert("That backup JSON could not be imported.");
    }
  });
}

function exportBackup() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `production-crm-backup-${todayIso}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function handleAction(target) {
  const action = target?.dataset?.action;
  if (!action) return;
  const job = findJob(target.dataset.job || target.dataset.id);
  const id = target.dataset.id;
  if (action === "close-modal") return closeModal();
  if (action === "add-job") return openJobForm();
  if (action === "add-note") return openNoteForm(id);
  if (action === "open-job") { activeJobId = id; currentView = "detail"; return render(); }
  if (action === "calendar-mode") { sessionStorage.setItem("calendar.mode", target.dataset.mode); return renderCalendar(); }
  if (action === "calendar-prev") { calendarCursor.setMonth(calendarCursor.getMonth() - 1); return renderCalendar(); }
  if (action === "calendar-next") { calendarCursor.setMonth(calendarCursor.getMonth() + 1); return renderCalendar(); }
  if (action === "calendar-today") { calendarCursor = new Date(`${todayIso}T12:00:00`); selectedCalendarDate = todayIso; return renderCalendar(); }
  if (action === "select-calendar-date") { selectedCalendarDate = target.dataset.date; return renderCalendar(); }
  if (action === "add-calendar-event") return openCalendarEventForm();
  if (action === "export-calendar") return exportCalendarEvent(target.dataset.job, target.dataset.kind, id);
  if (action === "filter-notes") { findJob(target.dataset.job).noteFilter = target.dataset.user; return render(); }
  if (action === "mark-mention-read") { markMentionRead(id); return render(); }
  if (action === "edit-job") return openJobForm(job);
  if (action === "toggle-update") { job.homeownerUpdateNeeded = !job.homeownerUpdateNeeded; log(job, "Homeowner update flag changed"); return render(); }
  if (action === "draft-update") return draftHomeownerUpdate(job);
  if (action === "status") { findJob(id).status = target.value; log(findJob(id), `Status changed to ${target.value}`); return render(); }
  if (action.startsWith("add-")) return openItemForm(action.replace("add-", ""), id);
  if (action.startsWith("edit-")) return openItemForm(action.replace("edit-", ""), target.dataset.job, id);
  if (action.startsWith("delete-")) return deleteItem(action.replace("delete-", ""), target.dataset.job, id);
  if (action === "toggle-task") return toggleItem("tasks", target.dataset.job, id, target.checked);
  if (action === "toggle-punch") return toggleItem("punchList", target.dataset.job, id, target.checked);
  if (action === "complete-task") return toggleItem("tasks", target.dataset.job, id, true);
  if (action === "print-work-order") return printWorkOrder(findJob(target.dataset.job), findJob(target.dataset.job).workOrders.find((w) => w.id === id));
  if (action === "save-settings") return saveSettings();
  if (action === "retry-boot") return boot();
  if (action === "test-supabase") return testSupabaseConnection();
  if (action === "logout") return supabase ? supabase.auth.signOut() : renderLogin();
  if (action === "export") return exportBackup();
  if (action === "import") return openImport();
  if (action === "clear-data" && confirm("Clear all shared JobCommand data for this workspace?")) return clearWorkspaceData();
}

async function clearWorkspaceData() {
  state = { settings: { ...defaults, companyName: company?.name || "" }, jobs: [], calendarEvents: [], notifications: [] };
  localStorage.setItem(STORE_KEY, JSON.stringify(state));
  if (cloudReady) {
    for (const table of ["notifications", "mentions", "notes", "calendar_events", "punch_list_items", "work_orders", "schedule_items", "tasks", "jobs"]) {
      await supabase.from(table).delete().eq("company_id", company.id);
    }
  }
  render();
}

function deleteItem(kind, jobId, id) {
  const map = { task: "tasks", schedule: "schedule", "work-order": "workOrders", punch: "punchList", reminder: "reminders", sub: "subs" };
  const job = findJob(jobId);
  if (!confirm("Delete this item?")) return;
  job[map[kind]] = job[map[kind]].filter((item) => item.id !== id);
  log(job, `${kind.replace("-", " ")} deleted`);
  render();
}

function toggleItem(list, jobId, id, complete) {
  const job = findJob(jobId);
  const item = job[list].find((x) => x.id === id);
  item.complete = complete;
  log(job, `${item.title || item.trade || "Item"} marked ${complete ? "complete" : "open"}`);
  render();
}

function saveSettings() {
  state.settings.companyName = document.querySelector("#companyName").value || "";
  state.settings.teamMembers = lines("#teamMembers");
  state.settings.currentUser = document.querySelector("#currentUser").value || state.settings.teamMembers[0] || "";
  state.settings.trades = lines("#trades");
  state.settings.statuses = lines("#statuses");
  render();
}

function lines(selector) {
  return document.querySelector(selector).value.split("\n").map((x) => x.trim()).filter(Boolean);
}

function findJob(id) { return state.jobs.find((job) => job.id === id); }
function allTasks() { return state.jobs.flatMap((job) => job.tasks.map((item) => ({ job, item }))); }
function openPunch(job) { return job.punchList.filter((item) => !item.complete); }
function attentionJobs() { return state.jobs.filter((job) => needsAttention(job)); }
function activeJobs() { return state.jobs.filter((job) => !["Complete", "Invoiced", "Paid"].includes(job.status)); }
function needsAttention(job) { return job.tasks.some((t) => !t.complete && t.dueDate < todayIso) || !job.startDate || openPunch(job).length || job.homeownerUpdateNeeded || job.materialsStatus === "Missing"; }
function attentionPill(job) { return needsAttention(job) ? pill("Needs attention", "danger") : pill("On track", "good"); }
function statusBadge(status) { return `<span class="status-badge">${status || "No status"}</span>`; }
function unreadMentions() {
  return state.notifications
    .filter((item) => item.type === "mention" && !item.read && item.taggedUser === state.settings.currentUser)
    .map((notification) => {
      const job = findJob(notification.jobId);
      const note = job?.notesActivity.find((entry) => entry.id === notification.noteId);
      return job && note ? { notification, job, note } : null;
    })
    .filter(Boolean);
}

function inAppNotifications(mentions, dueToday, overdue, calendarToday) {
  const assignedToMe = dueToday.filter(({ item }) => item.assignedTo === state.settings.currentUser);
  const notices = [
    ...mentions.map(({ job, note }) => ({ notice: true, type: "Mention", tone: "warn", title: `Tagged on ${job.name}`, detail: note.text, jobId: job.id })),
    ...assignedToMe.map(({ job, item }) => ({ notice: true, type: "Task", title: item.title, detail: `${job.name} is assigned to you today.`, jobId: job.id })),
    ...calendarToday.map((event) => ({ notice: true, type: event.type, title: event.title, detail: `${event.job?.name || "Calendar"} ${event.time ? "at " + event.time : "today"}`, jobId: event.job?.id })),
    ...overdue.map(({ job, item }) => ({ notice: true, type: "Overdue", tone: "danger", title: item.title, detail: `${job.name} is overdue.`, jobId: job.id })),
    ...attentionJobs().map((job) => ({ notice: true, type: "Attention", tone: "warn", title: job.name, detail: nextStep(job), jobId: job.id }))
  ];
  return notices.slice(0, 12);
}

function markMentionRead(id) {
  const notification = state.notifications.find((item) => item.id === id);
  if (notification) notification.read = true;
}

function extractMentions(text) {
  const names = new Set(state.settings.teamMembers);
  return unique((text.match(/@[A-Za-z][A-Za-z0-9_-]*/g) || []).map((tag) => tag.slice(1)).filter((name) => names.has(name)));
}

function highlightMentions(text = "") {
  return text.replace(/@([A-Za-z][A-Za-z0-9_-]*)/g, `<span class="mention">@$1</span>`);
}

function nextStep(job) {
  const overdue = job.tasks.find((taskItem) => !taskItem.complete && taskItem.dueDate && taskItem.dueDate < todayIso);
  if (overdue) return `Overdue task: ${overdue.title}`;
  const due = job.tasks.find((taskItem) => !taskItem.complete && taskItem.dueDate === todayIso);
  if (due) return `Task due today: ${due.title}`;
  if (job.materialsStatus === "Missing") return "Resolve missing materials";
  if (job.homeownerUpdateNeeded) return "Send homeowner update";
  const nextSchedule = job.schedule.filter((item) => !item.date || item.date >= todayIso).sort((a, b) => (a.date || "").localeCompare(b.date || ""))[0];
  if (nextSchedule) return `${nextSchedule.trade} scheduled ${fmt(nextSchedule.date)}`;
  if (openPunch(job).length) return "Complete open punch list items";
  return job.status || "Confirm next production step";
}

function buildCalendarEvents() {
  const jobEvents = state.jobs.flatMap((job) => {
    const events = [];
    if (job.startDate) events.push(calendarEvent(job, "start", "Job Start", job.startDate, "", "Job Start", "", job.productionManager, job.status, job.notes));
    if (job.targetDate) events.push(calendarEvent(job, "target", "Target Completion", job.targetDate, "", "Target", "", job.productionManager, job.status, job.notes));
    if (job.homeownerUpdateNeeded) events.push(calendarEvent(job, "homeowner-update", "Homeowner Update Reminder", todayIso, "", "Reminder", "", job.productionManager, "Open", job.notes));
    job.tasks.forEach((item) => item.dueDate && events.push(calendarEvent(job, "task", item.title, item.dueDate, item.time, "Task", "", item.assignedTo, item.priority, item.notes, item.id)));
    job.schedule.forEach((item) => item.date && events.push(calendarEvent(job, "schedule", item.trade, item.date, item.time, "Schedule", item.trade, item.subcontractor, item.status, item.notes, item.id)));
    job.workOrders.forEach((item) => item.date && events.push(calendarEvent(job, "work-order", item.trade, item.date, item.time, "Work Order", item.trade, item.subcontractor, "", `${item.scope || ""} ${item.notes || ""}`.trim(), item.id)));
    job.punchList.forEach((item) => item.dueDate && events.push(calendarEvent(job, "punch", item.title, item.dueDate, item.time, "Punch List", "Punch list", item.assignedTo, item.complete ? "Complete" : "Open", item.notes, item.id)));
    job.reminders.forEach((item) => item.date && events.push(calendarEvent(job, "reminder", item.title, item.date, item.time, "Reminder", "", item.assignedTo, item.status, item.notes, item.id)));
    return events;
  });
  const customEvents = (state.calendarEvents || []).filter((item) => item.date).map((item) => calendarEvent(null, "custom", item.title, item.date, item.time, item.eventType || "Custom", "", item.assignedTo, item.status, item.notes, item.id));
  return jobEvents.concat(customEvents).sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
}

function calendarEvent(job, kind, title, date, time, type, trade, assignedTo, status, notes, sourceId = kind) {
  return { job, kind, sourceId, title, date, time, type, trade, assignedTo, status, notes, tone: type === "Reminder" ? "warn" : type === "Punch List" ? "danger" : "blue" };
}

function filterCalendarEvents(events, mode) {
  const start = new Date(`${todayIso}T00:00:00`);
  const end = new Date(start);
  if (mode === "today") end.setDate(start.getDate() + 1);
  if (mode === "week") end.setDate(start.getDate() + 7);
  if (mode === "month") end.setMonth(start.getMonth() + 1);
  return events.filter((event) => {
    const eventDate = new Date(`${event.date}T00:00:00`);
    return eventDate >= start && eventDate < end;
  });
}

function exportCalendarEvent(jobId, kind, sourceId) {
  const event = buildCalendarEvents().find((item) => (item.job?.id || "") === jobId && item.kind === kind && item.sourceId === sourceId);
  if (!event) return alert("This item needs a date before it can be exported.");
  // True Apple/Google/Outlook calendar sync will require OAuth/API authentication and a backend service later.
  const ics = makeIcs(event);
  const blob = new Blob([ics], { type: "text/calendar" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${slug(event.job?.name || "jobcommand")}-${slug(event.title)}.ics`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function makeIcs(event) {
  const start = icsDate(event.date, event.time);
  const end = icsDate(event.date, addOneHour(event.time));
  const description = [
    `Job: ${event.job?.name || "General calendar event"}`,
    `Address: ${event.job?.address || ""}`,
    `Type: ${event.type}`,
    `Trade/Sub: ${event.trade || event.assignedTo || ""}`,
    `Status: ${event.status || ""}`,
    `Notes: ${event.notes || ""}`,
    `Related job phone: ${event.job?.phone || ""}`,
    `Related job email: ${event.job?.email || ""}`
  ].map(escapeIcs).join("\\n");
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//JobCommand//Internal Beta//EN",
    "BEGIN:VEVENT",
    `UID:${event.kind}-${event.sourceId}-${event.job?.id || "general"}@jobcommand.local`,
    `DTSTAMP:${icsDate(todayIso, "12:00")}`,
    `DTSTART:${start}`,
    `DTEND:${end}`,
    `SUMMARY:${escapeIcs(`${event.title} - ${event.job?.name || "JobCommand"}`)}`,
    `LOCATION:${escapeIcs(event.job?.address || "")}`,
    `DESCRIPTION:${description}`,
    "END:VEVENT",
    "END:VCALENDAR"
  ].join("\r\n");
}

function icsDate(date, time = "") {
  const cleanTime = (time || "09:00").replace(":", "");
  return `${date.replaceAll("-", "")}T${cleanTime}00`;
}

function addOneHour(time = "") {
  if (!time) return "10:00";
  const [hours, minutes] = time.split(":").map(Number);
  return `${String((hours + 1) % 24).padStart(2, "0")}:${String(minutes || 0).padStart(2, "0")}`;
}

function escapeIcs(value = "") {
  return String(value).replaceAll("\\", "\\\\").replaceAll(";", "\\;").replaceAll(",", "\\,").replaceAll("\n", "\\n");
}

function slug(value = "") {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "event";
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function errorSummary(error) {
  if (!error) return "Unknown error";
  const parts = [
    error.name ? `name=${error.name}` : "",
    error.status ? `status=${error.status}` : "",
    error.message || String(error)
  ].filter(Boolean);
  return parts.join(" / ");
}

function maskKey(key = "") {
  if (!key) return "missing";
  return `${key.slice(0, 8)}...${key.slice(-4)} (${key.length} chars)`;
}

function trimSlash(value = "") {
  return value.replace(/\/+$/, "");
}

function isValidSupabaseUrl(value = "") {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname.endsWith(".supabase.co");
  } catch {
    return false;
  }
}

function isLikelyAnonKey(value = "") {
  return Boolean(value) && value.length > 30 && !value.startsWith("http://") && !value.startsWith("https://") && !value.includes(".supabase.co");
}

function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function shortEvent(event) {
  const label = event.time ? event.time : event.type;
  return `${label} ${event.title}`.slice(0, 18);
}

function emptyState(message, buttonText = "") {
  return `<section class="empty-state">
    <div class="empty-mark"></div>
    <h2>${message}</h2>
    ${buttonText ? `<button class="primary-button" data-action="add-job" type="button">${buttonText}</button>` : ""}
  </section>`;
}
function pill(text, tone = "") { return `<span class="pill ${tone}">${text}</span>`; }
function field(label, value) { return `<div class="field"><span>${label}</span><strong>${value || "Not set"}</strong></div>`; }
function options(items, selected) { return items.map((item) => `<option ${item === selected ? "selected" : ""}>${item}</option>`).join(""); }
function selectHtml(id, items, selected) { return `<select id="${id}">${options(items, selected)}</select>`; }
function unique(items) { return [...new Set(items)]; }
function fmt(date) { return date ? new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "Not set"; }
function todayLabel() { return new Date(`${todayIso}T12:00:00`).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }); }
function formatDateTime(value) { return new Date(value).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); }
function log(job, text) { job?.timeline?.unshift({ id: uid("log"), date: todayIso, text }); }
function openModal(title, content) { modalTitle.textContent = title; modalBody.replaceChildren(content); modal.showModal(); }
function closeModal() { modal.close(); modalBody.replaceChildren(); }

document.querySelector("#quickAddBtn")?.addEventListener("click", () => openJobForm());
document.querySelector("#modalCloseBtn")?.addEventListener("click", closeModal);
document.querySelector(".bottom-nav")?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-view]");
  if (!button) return;
  currentView = button.dataset.view;
  render();
});
document.addEventListener("click", (event) => handleAction(event.target.closest("[data-action]") || {}));
document.addEventListener("input", (event) => {
  if (event.target?.dataset?.action === "status") handleAction(event.target);
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./service-worker.js");
}

boot();
