const STORE_KEY = "contractorProductionCrm.v1";
const todayIso = new Date().toISOString().slice(0, 10);

const defaults = {
  companyName: "Production CRM",
  teamMembers: ["Seth", "Boss", "Alex PM", "Morgan Sales"],
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
  if (saved) return JSON.parse(saved);
  const seeded = {
    settings: { ...defaults },
    jobs: seedJobs()
  };
  localStorage.setItem(STORE_KEY, JSON.stringify(seeded));
  return seeded;
}

function saveState() {
  localStorage.setItem(STORE_KEY, JSON.stringify(state));
  companyLabel.textContent = state.settings.companyName || "Production CRM";
}

function seedJobs() {
  return [
    makeJob({
      name: "Smith Bathroom Remodel",
      phone: "555-0101",
      email: "smith@example.com",
      address: "114 Maple Ridge Dr",
      type: "Bathroom remodel",
      paymentType: "Self-pay",
      salesRep: "Morgan Sales",
      productionManager: "Seth",
      status: "In Progress",
      startDate: todayIso,
      targetDate: addDays(7),
      materialsStatus: "Delivered",
      homeownerUpdateNeeded: true,
      notes: "Vanity set. Waiting on tile niche trim.",
      tasks: [
        task("Confirm plumber for trim-out", "Seth", todayIso, "High"),
        task("Order missing niche trim", "Alex PM", addDays(-1), "High")
      ],
      schedule: [schedule("Tile", "Precision Tile / 555-1200", todayIso, "Scheduled")],
      punchList: [punch("Touch up ceiling paint", "Paint sub", false)]
    }),
    makeJob({
      name: "Johnson Roof Replacement",
      phone: "555-0102",
      email: "johnson@example.com",
      address: "809 Oak Bend Ln",
      type: "Roof replacement",
      paymentType: "Insurance",
      salesRep: "Morgan Sales",
      productionManager: "Boss",
      status: "Waiting on Sub",
      startDate: addDays(3),
      targetDate: addDays(5),
      materialsStatus: "Ordered",
      notes: "Check dumpster drop before crew arrival.",
      tasks: [task("Lock crew date with roofing sub", "Boss", todayIso, "High")],
      schedule: [schedule("Roofing", "Apex Roofing Crew / 555-2200", addDays(3), "Tentative")]
    }),
    makeJob({
      name: "Miller Water Loss",
      phone: "555-0103",
      email: "miller@example.com",
      address: "34 Cedar Hollow Ct",
      type: "Water loss",
      paymentType: "Insurance",
      salesRep: "Seth",
      productionManager: "Alex PM",
      status: "Materials Needed",
      startDate: addDays(1),
      targetDate: addDays(10),
      materialsStatus: "Missing",
      homeownerUpdateNeeded: true,
      notes: "Drywall and flooring selections pending.",
      tasks: [task("Get flooring selection from homeowner", "Alex PM", addDays(-2), "Normal")],
      schedule: [schedule("Drywall", "Level Line Drywall / 555-3300", addDays(2), "Needs materials")]
    }),
    makeJob({
      name: "Davis Kitchen Repair",
      phone: "555-0104",
      email: "davis@example.com",
      address: "611 Pine Market Rd",
      type: "Kitchen repair",
      paymentType: "Self-pay",
      salesRep: "Morgan Sales",
      productionManager: "Seth",
      status: "Punch List",
      startDate: addDays(-4),
      targetDate: todayIso,
      materialsStatus: "Delivered",
      notes: "Final walkthrough ready after cabinet touch-up.",
      tasks: [task("Schedule final walkthrough", "Seth", todayIso, "Normal")],
      schedule: [schedule("Punch list", "In-house", todayIso, "Scheduled")],
      punchList: [punch("Adjust cabinet door", "Trim sub", false), punch("Clean sink area", "Seth", true)]
    })
  ];
}

function makeJob(data = {}) {
  return {
    id: uid("job"),
    name: "", phone: "", email: "", address: "", type: "", paymentType: "Insurance",
    salesRep: "Seth", productionManager: "Seth", status: "New Lead",
    startDate: "", targetDate: "", materialsStatus: "Not needed",
    homeownerUpdateNeeded: false, notes: "",
    tasks: [], schedule: [], subs: [], workOrders: [], punchList: [],
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
  companyLabel.textContent = state.settings.companyName;
  document.querySelectorAll(".nav-item").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === currentView);
  });
  const routes = {
    today: renderToday,
    jobs: renderJobs,
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
  const sections = [
    ["Jobs starting today", jobs.filter((job) => job.startDate === todayIso)],
    ["Jobs starting this week", jobs.filter((job) => job.startDate >= todayIso && job.startDate <= weekEnd)],
    ["Tasks due today", dueToday],
    ["Overdue tasks", overdue],
    ["Jobs waiting on subs", jobs.filter((job) => job.status === "Waiting on Sub")],
    ["Jobs missing materials", jobs.filter((job) => job.materialsStatus === "Missing" || job.status === "Materials Needed")],
    ["Jobs in punch list", jobs.filter((job) => openPunch(job).length || job.status === "Punch List")],
    ["Need homeowner update", jobs.filter((job) => job.homeownerUpdateNeeded)],
    ["Ready to invoice", jobs.filter((job) => job.status === "Complete")]
  ];
  view.innerHTML = `
    <section class="hero-card section">
      <h2>${attentionJobs().length} jobs need attention</h2>
      <p>Focus on overdue tasks, missing materials, homeowner updates, subs, and open punch work.</p>
      <button class="primary-button" data-action="add-job" type="button">Add Job</button>
    </section>
    <section class="metric-grid section">
      <div class="metric"><strong>${dueToday.length}</strong><span>Tasks due today</span></div>
      <div class="metric"><strong>${overdue.length}</strong><span>Overdue tasks</span></div>
      <div class="metric"><strong>${jobs.filter((j) => j.homeownerUpdateNeeded).length}</strong><span>Updates needed</span></div>
      <div class="metric"><strong>${jobs.filter((j) => j.materialsStatus === "Missing").length}</strong><span>Missing materials</span></div>
    </section>
    ${sections.map(renderTodaySection).join("")}
  `;
}

function renderTodaySection([title, items]) {
  return `<section class="section"><h2>${title}</h2><div class="stack">${
    items.length ? items.map((entry) => entry.job ? taskRow(entry) : miniJob(entry)).join("") : `<div class="empty">Nothing here right now.</div>`
  }</div></section>`;
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
  view.innerHTML = `
    <section class="toolbar">
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
      <p class="subtle">${job.address || "No address"} / ${job.type || "No type"}</p></div>
      ${attentionPill(job)}
    </div>
    <select class="quick-status" data-action="status" data-id="${job.id}">${state.settings.statuses.map((s) => `<option ${s === job.status ? "selected" : ""}>${s}</option>`).join("")}</select>
    <div class="pill-row">${pill(job.productionManager || "No PM")}${pill(job.salesRep || "No sales")}${job.startDate ? pill(fmt(job.startDate), "blue") : pill("Missing schedule", "warn")}${job.materialsStatus === "Missing" ? pill("Missing materials", "danger") : pill(job.materialsStatus)}</div>
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
        ${detailSection("Tasks", job.tasks.map((t) => taskDetail(job, t)).join(""), "add-task", job.id)}
        ${detailSection("Schedule", job.schedule.map((s) => scheduleDetail(job, s)).join(""), "add-schedule", job.id)}
        ${detailSection("Work Orders", job.workOrders.map((w) => workOrderDetail(job, w)).join(""), "add-work-order", job.id)}
      </div>
      <div class="stack">
    ${detailSection("Subcontractors / Trades", subSummary(job), "add-sub", job.id)}
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
  return `<div class="list-row"><label class="check-row"><input data-action="toggle-task" data-job="${job.id}" data-id="${t.id}" type="checkbox" ${t.complete ? "checked" : ""}> <strong>${t.title}</strong></label><p class="subtle">${t.assignedTo || "Unassigned"} / Due ${fmt(t.dueDate)} / ${t.priority || "Normal"}</p><div class="row-actions"><button class="ghost-button" data-action="edit-task" data-job="${job.id}" data-id="${t.id}" type="button">Edit</button><button class="ghost-button" data-action="delete-task" data-job="${job.id}" data-id="${t.id}" type="button">Delete</button></div></div>`;
}

function scheduleDetail(job, s) {
  return `<div class="list-row"><strong>${s.trade} / ${fmt(s.date)}</strong><p class="subtle">${s.subcontractor || "No sub"} / ${s.status || "Scheduled"} ${s.notes ? "/ " + s.notes : ""}</p><div class="row-actions"><button class="ghost-button" data-action="edit-schedule" data-job="${job.id}" data-id="${s.id}" type="button">Edit</button><button class="ghost-button" data-action="delete-schedule" data-job="${job.id}" data-id="${s.id}" type="button">Delete</button></div></div>`;
}

function workOrderDetail(job, w) {
  return `<div class="list-row"><strong>${w.trade} / ${fmt(w.date)}</strong><p class="subtle">${w.subcontractor || "No sub"} / ${w.scope || "No scope"}</p><div class="row-actions"><button class="secondary-button" data-action="print-work-order" data-job="${job.id}" data-id="${w.id}" type="button">Print/export</button><button class="ghost-button" data-action="edit-work-order" data-job="${job.id}" data-id="${w.id}" type="button">Edit</button><button class="ghost-button" data-action="delete-work-order" data-job="${job.id}" data-id="${w.id}" type="button">Delete</button></div></div>`;
}

function punchDetail(job, p) {
  return `<div class="list-row"><label class="check-row"><input data-action="toggle-punch" data-job="${job.id}" data-id="${p.id}" type="checkbox" ${p.complete ? "checked" : ""}> <strong>${p.title}</strong></label><p class="subtle">${p.assignedTo || "Unassigned"}</p><div class="row-actions"><button class="ghost-button" data-action="edit-punch" data-job="${job.id}" data-id="${p.id}" type="button">Edit</button><button class="ghost-button" data-action="delete-punch" data-job="${job.id}" data-id="${p.id}" type="button">Delete</button></div></div>`;
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
    return `${header}<article class="list-row"><div class="row-between"><div><strong>${item.trade}</strong><p class="subtle">${job.name} / ${item.subcontractor || "No sub"}</p></div>${pill(item.status || "Scheduled", item.status === "Needs materials" ? "warn" : "blue")}</div><button class="ghost-button" data-action="open-job" data-id="${job.id}" type="button">Open job</button></article>`;
  }).join("") || `<div class="empty">No schedule items yet.</div>`}</section>`;
}

function renderWorkOrders() {
  viewTitle.textContent = "Work Orders";
  const rows = state.jobs.flatMap((job) => job.workOrders.map((item) => ({ job, item }))).sort((a, b) => (a.item.date || "").localeCompare(b.item.date || ""));
  view.innerHTML = `<section class="stack">${rows.map(({ job, item }) => `<article class="list-row"><strong>${item.trade} / ${job.name}</strong><p class="subtle">${fmt(item.date)} / ${item.subcontractor || "No sub"}</p><p>${item.scope || "No scope added."}</p><div class="row-actions"><button class="secondary-button" data-action="print-work-order" data-job="${job.id}" data-id="${item.id}" type="button">Print/export</button><button class="ghost-button" data-action="open-job" data-id="${job.id}" type="button">Open job</button></div></article>`).join("") || `<div class="empty">Create work orders from a job detail screen.</div>`}</section>`;
}

function renderSettings() {
  viewTitle.textContent = "Settings";
  view.innerHTML = `
    <section class="stack">
      <article class="card"><h2>Company</h2><label>Company name<input id="companyName" value="${state.settings.companyName}"></label></article>
      <article class="card"><h2>Lists</h2><label>Team members<textarea id="teamMembers" rows="4">${state.settings.teamMembers.join("\n")}</textarea></label><label>Trades<textarea id="trades" rows="6">${state.settings.trades.join("\n")}</textarea></label><label>Job statuses<textarea id="statuses" rows="7">${state.settings.statuses.join("\n")}</textarea></label><button class="primary-button" data-action="save-settings" type="button">Save settings</button></article>
      <article class="card"><h2>Backup</h2><div class="row-actions"><button class="secondary-button" data-action="export" type="button">Export backup JSON</button><button class="ghost-button" data-action="import" type="button">Import backup JSON</button></div></article>
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
    task: { list: "tasks", title: "Task", fields: [["title", "Task title"], ["assignedTo", "Assigned to"], ["dueDate", "Due date", "date"], ["priority", "Priority", "select", ["Low", "Normal", "High"]], ["notes", "Notes", "textarea"]] },
    schedule: { list: "schedule", title: "Schedule Item", fields: [["trade", "Trade", "select", state.settings.trades], ["subcontractor", "Subcontractor/contact"], ["date", "Scheduled date", "date"], ["status", "Status"], ["notes", "Notes", "textarea"]] },
    "work-order": { list: "workOrders", title: "Work Order", fields: [["trade", "Trade", "select", state.settings.trades], ["scope", "Scope of work", "textarea"], ["date", "Scheduled date", "date"], ["subcontractor", "Subcontractor/contact"], ["notes", "Notes", "textarea"]] },
    punch: { list: "punchList", title: "Punch List Item", fields: [["title", "Item"], ["assignedTo", "Assigned to"]] },
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
      state = JSON.parse(new FormData(form).get("json"));
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
  const action = target.dataset.action;
  if (!action) return;
  const job = findJob(target.dataset.job || target.dataset.id);
  const id = target.dataset.id;
  if (action === "add-job") return openJobForm();
  if (action === "open-job") { activeJobId = id; currentView = "detail"; return render(); }
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
  if (action === "export") return exportBackup();
  if (action === "import") return openImport();
  if (action === "clear-data" && confirm("Clear all CRM data on this device?")) { localStorage.removeItem(STORE_KEY); state = loadState(); return render(); }
}

function deleteItem(kind, jobId, id) {
  const map = { task: "tasks", schedule: "schedule", "work-order": "workOrders", punch: "punchList", sub: "subs" };
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
  state.settings.companyName = document.querySelector("#companyName").value || "Production CRM";
  state.settings.teamMembers = lines("#teamMembers");
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
function needsAttention(job) { return job.tasks.some((t) => !t.complete && t.dueDate < todayIso) || !job.startDate || openPunch(job).length || job.homeownerUpdateNeeded || job.materialsStatus === "Missing"; }
function attentionPill(job) { return needsAttention(job) ? pill("Needs attention", "danger") : pill("On track", "good"); }
function pill(text, tone = "") { return `<span class="pill ${tone}">${text}</span>`; }
function field(label, value) { return `<div class="field"><span>${label}</span><strong>${value || "Not set"}</strong></div>`; }
function options(items, selected) { return items.map((item) => `<option ${item === selected ? "selected" : ""}>${item}</option>`).join(""); }
function selectHtml(id, items, selected) { return `<select id="${id}">${options(items, selected)}</select>`; }
function unique(items) { return [...new Set(items)]; }
function fmt(date) { return date ? new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "Not set"; }
function log(job, text) { job?.timeline?.unshift({ id: uid("log"), date: todayIso, text }); }
function openModal(title, content) { modalTitle.textContent = title; modalBody.replaceChildren(content); modal.showModal(); }
function closeModal() { modal.close(); modalBody.replaceChildren(); }

document.querySelector("#quickAddBtn").addEventListener("click", () => openJobForm());
document.querySelector("#modalCloseBtn").addEventListener("click", closeModal);
document.querySelector(".bottom-nav").addEventListener("click", (event) => {
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

render();
