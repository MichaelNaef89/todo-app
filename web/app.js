/* App-Zustand, Routing (ohne URL-Hash - reines In-Memory-View-Switching,
   analog zum data-screen-Muster der Stempeluhr-PWA) und Rendering aller
   Ansichten. */

const AREA_LABEL = { business: 'Business', privat: 'Privat' };
const PRIORITY_LABEL = { 1: 'P1', 2: 'P2', 3: 'P3', 4: 'P4' };

const state = {
  view: 'today',
  newTaskArea: 'business',
  currentProjectId: null,
  weekStart: mondayOf(new Date()),
  projects: { business: [], privat: [] },
  detail: null, // { type: 'task'|'project', id: number|'new', area?, projectId? }
};

// ------------------------------------------------------------------ Utils

function $(sel, root = document) { return root.querySelector(sel); }
function $all(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

function pad2(n) { return String(n).padStart(2, '0'); }

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function mondayOf(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diff = (d.getDay() + 6) % 7; // Montag = 0
  d.setDate(d.getDate() - diff);
  return d;
}

function isoOf(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function addDaysISO(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, m - 1, d + n);
  return isoOf(date);
}

function fmtDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString('de-CH', { weekday: 'short', day: 'numeric', month: 'short' });
}

function fmtDateLong(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString('de-CH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.hidden = true; }, 2400);
}

function projectById(id) {
  if (!id) return null;
  return [...state.projects.business, ...state.projects.privat].find((p) => p.id === id) || null;
}

async function withBusy(fn) {
  try {
    await fn();
  } catch (err) {
    console.error(err);
    toast(err.message || 'Fehler');
  }
}

// -------------------------------------------------------------- Init/Auth

async function init() {
  bindStaticEvents();
  applyStoredTheme();
  registerServiceWorker();
  try {
    const me = await API.me();
    if (me.authenticated) {
      await enterApp();
    } else {
      showLogin();
    }
  } catch {
    showLogin();
  }
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

function showLogin() {
  $('#loginScreen').hidden = false;
  $('#appShell').hidden = true;
  $('#loginPassword').focus();
}

async function enterApp() {
  $('#loginScreen').hidden = true;
  $('#appShell').hidden = false;
  await loadProjectsNav();
  await setView('today');
}

window.addEventListener('auth:required', () => {
  $('#appShell').hidden = true;
  showLogin();
});

// ------------------------------------------------------------- Nav/Layout

function bindStaticEvents() {
  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const pw = $('#loginPassword').value;
    $('#loginError').hidden = true;
    try {
      await API.login(pw);
      $('#loginPassword').value = '';
      await enterApp();
    } catch (err) {
      $('#loginError').textContent = err.message || 'Anmeldung fehlgeschlagen';
      $('#loginError').hidden = false;
    }
  });

  $('#logoutBtn').addEventListener('click', async () => {
    await API.logout();
    showLogin();
  });

  $('#themeToggle').addEventListener('click', toggleTheme);

  $('#menuToggle').addEventListener('click', () => {
    $('#sidebar').classList.add('open');
    $('#scrim').hidden = false;
  });
  $('#scrim').addEventListener('click', closeMobileNav);

  $('#mobileSearchBtn').addEventListener('click', () => setView('search'));

  $('#mainNav').addEventListener('click', (e) => {
    const addBtn = e.target.closest('[data-add-project]');
    if (addBtn) {
      openProjectDetail('new', addBtn.dataset.addProject);
      return;
    }
    const navBtn = e.target.closest('[data-view]');
    if (navBtn) {
      setView(navBtn.dataset.view);
      closeMobileNav();
    }
  });

  $('#newTaskBtn').addEventListener('click', () => openTaskDetail('new'));

  $('#overlay').addEventListener('click', closeDetail);
}

function closeMobileNav() {
  $('#sidebar').classList.remove('open');
  $('#scrim').hidden = true;
}

function applyStoredTheme() {
  const t = localStorage.getItem('todo:theme');
  if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme')
    || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('todo:theme', next);
}

async function loadProjectsNav() {
  const [biz, priv] = await Promise.all([
    API.projects({ area: 'business' }),
    API.projects({ area: 'privat' }),
  ]);
  state.projects.business = biz;
  state.projects.privat = priv;
  renderProjectNavList('#businessProjects', biz);
  renderProjectNavList('#privatProjects', priv);
}

function renderProjectNavList(sel, projects) {
  const container = $(sel);
  container.innerHTML = projects.filter((p) => !p.parent_project_id).map((p) => `
    <button class="nav-project" data-project-id="${p.id}">
      <span class="nav-project-name">${escapeHtml(p.name)}</span>
      <span class="nav-project-count">${p.open_count}</span>
    </button>
  `).join('');
  $all('.nav-project', container).forEach((btn) => {
    btn.addEventListener('click', () => setView('project', Number(btn.dataset.projectId)));
  });
}

const VIEW_TITLES = {
  today: 'Heute', all: 'Alle', planned: 'Geplant', week: 'Woche',
  business: 'Business', privat: 'Privat', done: 'Erledigt', search: 'Suche',
};

async function setView(view, projectId = null) {
  state.view = view;
  state.currentProjectId = projectId;
  $all('#mainNav [data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  $all('.nav-project').forEach((b) => b.classList.toggle('active', view === 'project' && Number(b.dataset.projectId) === projectId));

  if (view === 'business' || view === 'privat') state.newTaskArea = view;

  $('#mobileTitle').textContent = view === 'project'
    ? (projectById(projectId)?.name || 'Projekt')
    : (VIEW_TITLES[view] || 'To-do');

  await renderCurrentView();
}

async function afterMutation() {
  await loadProjectsNav();
  await renderCurrentView();
}

async function renderCurrentView() {
  const screen = $('#screen');
  screen.innerHTML = '<div class="empty-state">Lädt…</div>';
  try {
    switch (state.view) {
      case 'today': return await renderToday();
      case 'all': return await renderAll();
      case 'planned': return await renderPlanned();
      case 'week': return await renderWeek();
      case 'business': return await renderArea('business');
      case 'privat': return await renderArea('privat');
      case 'project': return await renderProject(state.currentProjectId);
      case 'done': return await renderDone();
      case 'search': return await renderSearch();
      default: screen.innerHTML = '<div class="empty-state">Unbekannte Ansicht</div>';
    }
  } catch (err) {
    console.error(err);
    screen.innerHTML = `<div class="empty-state">Fehler beim Laden: ${escapeHtml(err.message)}</div>`;
  }
}

// ------------------------------------------------------------- Task-Rows

function taskRowHTML(task, { showProject = true, showArea = false } = {}) {
  const chips = [];
  const overdue = task.status === 'open' && task.due_date && task.due_date < todayISO();
  if (task.due_date) {
    chips.push(`<span class="chip ${overdue ? 'chip-overdue' : ''}">${escapeHtml(fmtDate(task.due_date))}${task.due_time ? ' · ' + task.due_time : ''}</span>`);
  }
  const project = task.project_id ? projectById(task.project_id) : null;
  if (showProject && project) {
    chips.push(`<span class="chip"><span class="area-dot area-${project.area}"></span> ${escapeHtml(project.name)}</span>`);
  } else if (showArea) {
    chips.push(`<span class="chip"><span class="area-dot area-${task.area}"></span> ${AREA_LABEL[task.area]}</span>`);
  }
  if (task.priority <= 2) {
    chips.push(`<span class="chip chip-priority-${task.priority}">${PRIORITY_LABEL[task.priority]}</span>`);
  }

  return `
    <div class="task-row" data-task-id="${task.id}" data-priority="${task.priority}" draggable="true">
      <button class="task-check ${task.status === 'done' ? 'checked' : ''}" data-action="toggle" aria-label="Erledigt"></button>
      <div class="task-body">
        <div class="task-title">${escapeHtml(task.title)}</div>
        ${chips.length ? `<div class="task-meta">${chips.join('')}</div>` : ''}
      </div>
    </div>
  `;
}

function taskListHTML(tasks, opts) {
  if (!tasks.length) return '<div class="empty-state">Keine Aufgaben.</div>';
  return `<div class="task-list">${tasks.map((t) => taskRowHTML(t, opts)).join('')}</div>`;
}

function attachTaskListEvents(container, tasksById, { sortable = true, onReorder } = {}) {
  $all('.task-row', container).forEach((row) => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('[data-action="toggle"]')) return;
      openTaskDetail(Number(row.dataset.taskId));
    });
    const checkBtn = $('[data-action="toggle"]', row);
    checkBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = Number(row.dataset.taskId);
      await withBusy(async () => {
        await toggleTaskComplete(tasksById[id]);
        await afterMutation();
      });
    });
  });

  if (sortable) makeSortable(container, tasksById, onReorder);
}

async function toggleTaskComplete(task) {
  if (task.status !== 'done') {
    const result = await API.completeTask(task.id);
    if (result.next_task) toast(`Erledigt – nächste Wiederholung: ${fmtDate(result.next_task.due_date)}`);
    else toast('Erledigt');
  } else {
    await API.updateTask(task.id, { ...taskToTaskIn(task), status: 'open', });
    toast('Wieder geöffnet');
  }
}

function taskToTaskIn(task) {
  return {
    title: task.title, notes: task.notes, area: task.area, project_id: task.project_id,
    parent_task_id: task.parent_task_id, due_date: task.due_date, due_time: task.due_time,
    priority: task.priority, status: task.status, tags: task.tags, link: task.link,
    assignee: task.assignee, waiting_person: task.waiting_person,
    waiting_follow_up_date: task.waiting_follow_up_date, recurrence: task.recurrence,
    focus_date: task.focus_date, sort_order: task.sort_order,
  };
}

// ------------------------------------------------------- Drag & Drop Sort

function makeSortable(container, tasksById, onReorder) {
  const list = $('.task-list', container);
  if (!list || !onReorder) return;
  let draggedId = null;

  list.addEventListener('dragstart', (e) => {
    const row = e.target.closest('.task-row');
    if (!row) return;
    draggedId = Number(row.dataset.taskId);
    row.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  });
  list.addEventListener('dragend', (e) => {
    const row = e.target.closest('.task-row');
    if (row) row.classList.remove('dragging');
  });
  list.addEventListener('dragover', (e) => {
    e.preventDefault();
    const afterRow = [...$all('.task-row:not(.dragging)', list)].find((row) => {
      const rect = row.getBoundingClientRect();
      return e.clientY < rect.top + rect.height / 2;
    });
    const dragging = $('.task-row.dragging', list);
    if (!dragging) return;
    if (afterRow) list.insertBefore(dragging, afterRow);
    else list.appendChild(dragging);
  });
  list.addEventListener('drop', async (e) => {
    e.preventDefault();
    const orderedIds = $all('.task-row', list).map((r) => Number(r.dataset.taskId));
    await withBusy(() => onReorder(orderedIds, tasksById));
  });
}

async function persistSortOrder(orderedIds, tasksById) {
  await Promise.all(orderedIds.map((id, idx) => {
    const task = tasksById[id];
    if (!task || task.sort_order === idx * 10) return null;
    return API.updateTask(id, { ...taskToTaskIn(task), sort_order: idx * 10 });
  }));
}

function indexById(tasks) {
  const map = {};
  tasks.forEach((t) => { map[t.id] = t; });
  return map;
}

// ------------------------------------------------------------------ Heute

async function renderToday() {
  const [tasks, counts] = await Promise.all([API.tasks({ view: 'today' }), API.counts()]);
  const today = todayISO();
  const overdue = tasks.filter((t) => t.status === 'open' && t.due_date && t.due_date < today);
  const focus = tasks.filter((t) => t.focus_date === today && t.status !== 'done');
  const dueToday = tasks.filter((t) => t.status === 'open' && t.due_date === today);
  const heute = dueToday.filter((t) => t.priority <= 2);
  const wennZeit = dueToday.filter((t) => t.priority > 2);

  const byId = indexById(tasks);

  $('#screen').innerHTML = `
    <div class="stat-row">
      <div class="stat-tile"><div class="num">${counts.today}</div><div class="label">Heute</div></div>
      <div class="stat-tile"><div class="num">${counts.focus}</div><div class="label">Fokus</div></div>
      <div class="stat-tile ${counts.overdue ? 'warn' : ''}"><div class="num">${counts.overdue}</div><div class="label">Überfällig</div></div>
      <div class="stat-tile"><div class="num">${counts.this_week}</div><div class="label">Diese Woche</div></div>
    </div>

    ${overdue.length ? `<div class="section-title">Überfällig <span class="count">${overdue.length}</span></div><div id="listOverdue"></div>` : ''}
    <div class="section-title">Fokus <span class="count">${focus.length}/5</span></div>
    <div id="listFocus"></div>
    <div class="section-title">Heute <span class="count">${heute.length}</span></div>
    <div id="listHeute"></div>
    ${wennZeit.length ? `<div class="section-title">Wenn Zeit bleibt <span class="count">${wennZeit.length}</span></div><div id="listWennZeit"></div>` : ''}
  `;

  const mount = (id, list) => {
    const el = $(id);
    if (!el) return;
    el.innerHTML = taskListHTML(list, { showProject: true });
    attachTaskListEvents(el, byId, { sortable: false });
  };
  mount('#listOverdue', overdue);
  mount('#listFocus', focus.length ? focus : []);
  if (!focus.length) $('#listFocus').innerHTML = '<div class="empty-state">Noch keine Fokus-Aufgaben gewählt – im Task öffnen und „Fokus heute“ setzen.</div>';
  mount('#listHeute', heute);
  if (wennZeit.length) mount('#listWennZeit', wennZeit);
}

// -------------------------------------------------------------------- Alle

async function renderAll() {
  const tasks = await API.tasks({ status: 'open' });
  const byId = indexById(tasks);
  $('#screen').innerHTML = `
    <div class="section-title">Alle offenen Aufgaben <span class="count">${tasks.length}</span></div>
    <div id="list"></div>
  `;
  const el = $('#list');
  el.innerHTML = taskListHTML(tasks, { showProject: true, showArea: true });
  attachTaskListEvents(el, byId, { onReorder: persistSortOrder });
}

// ---------------------------------------------------------------- Geplant

async function renderPlanned() {
  const tasks = await API.tasks({ view: 'planned' });
  const byId = indexById(tasks);
  const groups = new Map();
  tasks.forEach((t) => {
    if (!groups.has(t.due_date)) groups.set(t.due_date, []);
    groups.get(t.due_date).push(t);
  });
  const dates = [...groups.keys()].sort();
  $('#screen').innerHTML = dates.length ? dates.map((date) => `
    <div class="section-title">${escapeHtml(fmtDateLong(date))} <span class="count">${groups.get(date).length}</span></div>
    <div id="g-${date}"></div>
  `).join('') : '<div class="empty-state">Keine geplanten Aufgaben.</div>';
  dates.forEach((date) => {
    const el = $(`#g-${date}`);
    el.innerHTML = taskListHTML(groups.get(date), { showProject: true });
    attachTaskListEvents(el, byId, { sortable: false });
  });
}

// ------------------------------------------------------------ Business/Privat

async function renderArea(area) {
  const [tasks, projects] = await Promise.all([
    API.tasks({ area, status: 'open' }),
    API.projects({ area }),
  ]);
  const noProject = tasks.filter((t) => !t.project_id);
  const byId = indexById(tasks);

  $('#screen').innerHTML = `
    <div class="section-title">${AREA_LABEL[area]}-Projekte</div>
    <div class="project-grid ${area === 'privat' ? 'area-privat' : ''}" id="projGrid"></div>
    ${noProject.length ? `<div class="section-title">Ohne Projekt <span class="count">${noProject.length}</span></div><div id="listNoProj"></div>` : ''}
  `;

  $('#projGrid').innerHTML = projects.length ? projects.filter((p) => !p.parent_project_id).map(projectCardHTML).join('') : '<div class="empty-state">Noch keine Projekte.</div>';
  $all('.project-card', $('#projGrid')).forEach((card) => {
    card.addEventListener('click', () => setView('project', Number(card.dataset.projectId)));
  });

  if (noProject.length) {
    const el = $('#listNoProj');
    el.innerHTML = taskListHTML(noProject, { showProject: false });
    attachTaskListEvents(el, byId, { onReorder: persistSortOrder });
  }
}

function projectCardHTML(p) {
  const total = p.open_count + p.done_count;
  const pct = total ? Math.round((p.done_count / total) * 100) : 0;
  return `
    <div class="project-card area-${p.area}" data-project-id="${p.id}">
      <div class="name">${escapeHtml(p.name)}</div>
      <div class="project-progress"><div class="project-progress-bar" style="width:${pct}%"></div></div>
      <div class="project-card-meta">
        <span>${p.open_count} offen · ${p.done_count} erledigt</span>
        <span>${p.next_deadline ? fmtDate(p.next_deadline) : ''}</span>
      </div>
    </div>
  `;
}

// -------------------------------------------------------------- Projekt

async function renderProject(projectId) {
  const project = await API.project(projectId);
  const openTasks = project.tasks.filter((t) => t.status !== 'done');
  const doneTasks = project.tasks.filter((t) => t.status === 'done');
  const byId = indexById(openTasks);

  $('#screen').innerHTML = `
    <div class="section-title" style="margin-top:0">
      <span class="area-dot area-${project.area}"></span> ${escapeHtml(project.name)}
      <button class="btn btn-small" id="editProjectBtn" style="margin-left:auto">Bearbeiten</button>
    </div>
    ${project.notes ? `<p style="color:var(--text-dim);font-size:13.5px;margin-top:-6px">${escapeHtml(project.notes)}</p>` : ''}
    ${project.subprojects.length ? `<div class="project-grid">${project.subprojects.map(projectCardHTML).join('')}</div>` : ''}
    <div class="section-title">Offen <span class="count">${openTasks.length}</span></div>
    <div id="listOpen"></div>
    ${doneTasks.length ? `<div class="section-title">Erledigt <span class="count">${doneTasks.length}</span></div><div id="listDone"></div>` : ''}
  `;

  $('#editProjectBtn').addEventListener('click', () => openProjectDetail(projectId));
  $all('.project-card', $('#screen')).forEach((card) => {
    card.addEventListener('click', () => setView('project', Number(card.dataset.projectId)));
  });

  const elOpen = $('#listOpen');
  elOpen.innerHTML = taskListHTML(openTasks, { showProject: false });
  attachTaskListEvents(elOpen, byId, { onReorder: persistSortOrder });

  if (doneTasks.length) {
    const elDone = $('#listDone');
    elDone.innerHTML = taskListHTML(doneTasks, { showProject: false });
    attachTaskListEvents(elDone, indexById(doneTasks), { sortable: false });
  }
}

// -------------------------------------------------------------- Erledigt

async function renderDone() {
  const tasks = await API.tasks({ view: 'done' });
  const byId = indexById(tasks);
  $('#screen').innerHTML = `
    <div class="section-title">Erledigt <span class="count">${tasks.length}</span></div>
    <div id="list"></div>
  `;
  const el = $('#list');
  el.innerHTML = taskListHTML(tasks, { showProject: true });
  attachTaskListEvents(el, byId, { sortable: false });
}

// ------------------------------------------------------------------ Woche

async function renderWeek() {
  const weekStartISO = isoOf(state.weekStart);
  const [weekTasks, backlog] = await Promise.all([
    API.tasks({ view: 'week', week_start: weekStartISO }),
    API.tasks({ view: 'backlog' }),
  ]);
  const byId = indexById([...weekTasks, ...backlog]);

  const dayLabels = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Wochenende'];
  const dayDates = [0, 1, 2, 3, 4].map((i) => addDaysISO(weekStartISO, i));
  const weekendDates = [addDaysISO(weekStartISO, 5), addDaysISO(weekStartISO, 6)];

  const tasksForDate = (iso) => weekTasks.filter((t) => t.due_date === iso);
  const tasksForWeekend = () => weekTasks.filter((t) => weekendDates.includes(t.due_date));

  const columns = [...dayDates.map((iso, i) => ({ label: dayLabels[i], dates: [iso] })), { label: dayLabels[5], dates: weekendDates }];

  $('#screen').innerHTML = `
    <div class="section-title" style="align-items:center">
      <button class="btn btn-small" id="weekPrev">←</button>
      <span>${escapeHtml(fmtDateLong(weekStartISO))} – ${escapeHtml(fmtDateLong(addDaysISO(weekStartISO, 6)))}</span>
      <button class="btn btn-small" id="weekNext">→</button>
      <button class="btn btn-small" id="weekToday" style="margin-left:auto">Diese Woche</button>
    </div>
    <div class="week-grid">
      ${columns.map((col, i) => `
        <div class="week-day ${col.dates.includes(todayISO()) ? 'is-today' : ''}" data-day-index="${i}" data-dates="${col.dates.join(',')}">
          <div class="week-day-head">${col.label}</div>
          <div class="week-day-body" id="wk-${i}"></div>
        </div>
      `).join('')}
    </div>
    <div class="section-title">Backlog (ohne Datum) <span class="count">${backlog.length}</span></div>
    <div class="backlog-panel" id="backlogPanel"></div>
  `;

  $('#weekPrev').addEventListener('click', () => { state.weekStart = new Date(state.weekStart.getFullYear(), state.weekStart.getMonth(), state.weekStart.getDate() - 7); renderWeek(); });
  $('#weekNext').addEventListener('click', () => { state.weekStart = new Date(state.weekStart.getFullYear(), state.weekStart.getMonth(), state.weekStart.getDate() + 7); renderWeek(); });
  $('#weekToday').addEventListener('click', () => { state.weekStart = mondayOf(new Date()); renderWeek(); });

  columns.forEach((col, i) => {
    const list = col.dates.length > 1 ? tasksForWeekend() : tasksForDate(col.dates[0]);
    $(`#wk-${i}`).innerHTML = list.map(weekTaskChipHTML).join('');
  });
  $('#backlogPanel').innerHTML = backlog.length ? backlog.map(weekTaskChipHTML).join('') : '<div class="empty-state">Backlog leer.</div>';

  bindWeekDragDrop(byId);
  bindWeekTaskClicks();
}

function weekTaskChipHTML(task) {
  return `<div class="week-task area-${task.area}" draggable="true" data-task-id="${task.id}">${escapeHtml(task.title)}</div>`;
}

function bindWeekTaskClicks() {
  $all('.week-task', $('#screen')).forEach((el) => {
    el.addEventListener('click', () => openTaskDetail(Number(el.dataset.taskId)));
  });
}

function bindWeekDragDrop(byId) {
  $all('.week-task', $('#screen')).forEach((el) => {
    el.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', el.dataset.taskId);
      e.dataTransfer.effectAllowed = 'move';
    });
  });

  const dropTargets = [...$all('.week-day', $('#screen')), $('#backlogPanel')];
  dropTargets.forEach((target) => {
    target.addEventListener('dragover', (e) => { e.preventDefault(); target.classList.add('drag-over'); });
    target.addEventListener('dragleave', () => target.classList.remove('drag-over'));
    target.addEventListener('drop', async (e) => {
      e.preventDefault();
      target.classList.remove('drag-over');
      const taskId = Number(e.dataTransfer.getData('text/plain'));
      const task = byId[taskId];
      if (!task) return;
      const dates = target.dataset.dates ? target.dataset.dates.split(',') : [];
      const newDueDate = dates.length ? dates[0] : null; // Wochenende-Spalte -> Samstag
      await withBusy(async () => {
        await API.updateTask(taskId, { ...taskToTaskIn(task), due_date: newDueDate });
        await renderWeek();
      });
    });
  });
}

// ------------------------------------------------------------------ Suche

async function renderSearch() {
  $('#screen').innerHTML = `
    <div class="search-input-wrap"><input type="text" id="searchInput" placeholder="Suche nach Titel, Notiz, Tag, Person…" /></div>
    <div id="searchResults"></div>
  `;
  const input = $('#searchInput');
  input.focus();
  let debounceT;
  input.addEventListener('input', () => {
    clearTimeout(debounceT);
    debounceT = setTimeout(() => runSearch(input.value), 250);
  });
}

async function runSearch(q) {
  const resultsEl = $('#searchResults');
  if (!q.trim()) { resultsEl.innerHTML = ''; return; }
  const { tasks, projects } = await API.search(q);
  const byId = indexById(tasks);
  resultsEl.innerHTML = `
    ${projects.length ? `<div class="section-title">Projekte <span class="count">${projects.length}</span></div><div class="project-grid" id="searchProjects"></div>` : ''}
    <div class="section-title">Aufgaben <span class="count">${tasks.length}</span></div>
    <div id="searchTasks"></div>
  `;
  if (projects.length) {
    $('#searchProjects').innerHTML = projects.map(projectCardHTML).join('');
    $all('.project-card', $('#searchProjects')).forEach((card) => {
      card.addEventListener('click', () => setView('project', Number(card.dataset.projectId)));
    });
  }
  const elTasks = $('#searchTasks');
  elTasks.innerHTML = taskListHTML(tasks, { showProject: true });
  attachTaskListEvents(elTasks, byId, { sortable: false });
}

// ------------------------------------------------------------ Task-Detail

function closeDetail() {
  $('#overlay').hidden = true;
  $('#taskDetail').hidden = true;
  $('#taskDetail').innerHTML = '';
  state.detail = null;
}

async function openTaskDetail(idOrNew, defaults = {}) {
  const isNew = idOrNew === 'new';
  const task = isNew ? {
    id: null, title: '', notes: '', area: defaults.area || state.newTaskArea,
    project_id: defaults.projectId || null, parent_task_id: null, due_date: null, due_time: null,
    priority: 3, status: 'open', tags: [], link: null, assignee: '', waiting_person: null,
    waiting_follow_up_date: null, recurrence: null, focus_date: null, sort_order: 0, subtasks: [],
  } : await API.task(idOrNew);

  state.detail = { type: 'task', id: isNew ? 'new' : task.id };
  $('#overlay').hidden = false;
  const panel = $('#taskDetail');
  panel.hidden = false;
  if (isNew) {
    panel.innerHTML = newTaskFormHTML(task);
    bindNewTaskFormEvents(task);
  } else {
    panel.innerHTML = taskFormHTML(task, isNew);
    bindTaskFormEvents(task, isNew);
  }
}

function newTaskFormHTML(task) {
  return `
    <div class="slideover-header">
      <div class="slideover-title">Neue Aufgabe</div>
      <button class="icon-btn" id="closeDetailBtn">✕</button>
    </div>

    <div class="field">
      <label>Titel</label>
      <input type="text" id="nTitle" value="${escapeHtml(task.title)}" />
    </div>

    <div class="field">
      <label>Notiz</label>
      <textarea id="nNotes" rows="3">${escapeHtml(task.notes)}</textarea>
    </div>

    <div class="field-row">
      <div class="field">
        <label>Bereich</label>
        <select id="nArea">
          <option value="business" ${task.area === 'business' ? 'selected' : ''}>Business</option>
          <option value="privat" ${task.area === 'privat' ? 'selected' : ''}>Privat</option>
        </select>
      </div>
      <div class="field">
        <label>Fälligkeitsdatum</label>
        <input type="date" id="nDueDate" value="${task.due_date || ''}" />
      </div>
    </div>

    <div class="slideover-footer">
      <div></div>
      <button class="btn btn-primary" id="saveNewTaskBtn" type="button">Erstellen</button>
    </div>
  `;
}

function bindNewTaskFormEvents(task) {
  $('#closeDetailBtn').addEventListener('click', closeDetail);

  const submit = async () => {
    const title = $('#nTitle').value.trim();
    if (!title) { toast('Titel darf nicht leer sein'); return; }
    await withBusy(async () => {
      await API.createTask({
        title,
        notes: $('#nNotes').value,
        area: $('#nArea').value,
        due_date: $('#nDueDate').value || null,
        priority: 3,
      });
      toast('Aufgabe erstellt');
      closeDetail();
      await afterMutation();
    });
  };

  $('#saveNewTaskBtn').addEventListener('click', submit);
  $('#nTitle').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submit();
  });
}

function projectOptionsHTML(area, selectedId) {
  const projects = state.projects[area] || [];
  const opts = ['<option value="">Kein Projekt</option>'];
  projects.forEach((p) => {
    const prefix = p.parent_project_id ? '— ' : '';
    opts.push(`<option value="${p.id}" ${p.id === selectedId ? 'selected' : ''}>${prefix}${escapeHtml(p.name)}</option>`);
  });
  return opts.join('');
}

function taskFormHTML(task) {
  return `
    <div class="slideover-header">
      <div class="slideover-title">Aufgabe bearbeiten</div>
      <button class="icon-btn" id="closeDetailBtn">✕</button>
    </div>

    <div class="field">
      <label>Titel</label>
      <input type="text" id="fTitle" value="${escapeHtml(task.title)}" />
    </div>

    <div class="field">
      <label>Notizen</label>
      <textarea id="fNotes" rows="3">${escapeHtml(task.notes)}</textarea>
    </div>

    <div class="field-row">
      <div class="field">
        <label>Bereich</label>
        <select id="fArea">
          <option value="business" ${task.area === 'business' ? 'selected' : ''}>Business</option>
          <option value="privat" ${task.area === 'privat' ? 'selected' : ''}>Privat</option>
        </select>
      </div>
      <div class="field">
        <label>Projekt</label>
        <select id="fProject">${projectOptionsHTML(task.area, task.project_id)}</select>
      </div>
    </div>

    <div class="field-row">
      <div class="field">
        <label>Fälligkeitsdatum</label>
        <input type="date" id="fDueDate" value="${task.due_date || ''}" />
      </div>
      <div class="field">
        <label>Uhrzeit</label>
        <input type="time" id="fDueTime" value="${task.due_time || ''}" />
      </div>
    </div>

    <div class="field-row">
      <div class="field">
        <label>Priorität</label>
        <select id="fPriority">
          ${[1, 2, 3, 4].map((p) => `<option value="${p}" ${task.priority === p ? 'selected' : ''}>${PRIORITY_LABEL[p]}</option>`).join('')}
        </select>
      </div>
      <div class="field">
        <label>Verantwortlich</label>
        <input type="text" id="fAssignee" value="${escapeHtml(task.assignee || '')}" />
      </div>
    </div>

    <div class="field-row">
      <button class="btn ${task.focus_date === todayISO() ? 'btn-primary' : ''}" id="fFocusToggle" type="button">
        ${task.focus_date === todayISO() ? '★ Im Fokus heute' : '☆ Zum Fokus heute hinzufügen'}
      </button>
    </div>

    ${subtasksHTML(task)}

    <div class="slideover-footer">
      <div>
        <button class="btn btn-danger" id="deleteTaskBtn" type="button">Löschen</button>
      </div>
      <div style="display:flex;gap:8px">
        ${task.status !== 'done' ? '<button class="btn" id="completeTaskBtn" type="button">Erledigt</button>' : ''}
        <button class="btn btn-primary" id="saveTaskBtn" type="button">Speichern</button>
      </div>
    </div>
  `;
}

function subtasksHTML(task) {
  const items = (task.subtasks || []).map((st) => `
    <div class="task-row" data-subtask-id="${st.id}" style="margin-bottom:4px">
      <button class="task-check ${st.status === 'done' ? 'checked' : ''}" data-action="toggle-sub"></button>
      <div class="task-body"><div class="task-title">${escapeHtml(st.title)}</div></div>
    </div>
  `).join('');
  return `
    <div class="field">
      <label>Unteraufgaben</label>
      <div id="subtaskList">${items}</div>
      <div class="field-row" style="margin-top:6px">
        <input type="text" id="newSubtaskTitle" placeholder="Neue Unteraufgabe…" />
        <button class="btn btn-small" id="addSubtaskBtn" type="button">+</button>
      </div>
    </div>
  `;
}

function bindTaskFormEvents(task) {
  $('#closeDetailBtn').addEventListener('click', closeDetail);

  $('#fArea').addEventListener('change', () => {
    $('#fProject').innerHTML = projectOptionsHTML($('#fArea').value, null);
  });

  $('#fFocusToggle').addEventListener('click', async () => {
    const isFocused = task.focus_date === todayISO();
    await withBusy(async () => {
      await API.setFocus(task.id, isFocused ? null : todayISO());
      toast(isFocused ? 'Fokus entfernt' : 'Zum Fokus hinzugefügt');
      closeDetail();
      await afterMutation();
    });
  });

  const completeBtn = $('#completeTaskBtn');
  if (completeBtn) completeBtn.addEventListener('click', async () => {
    await withBusy(async () => {
      const result = await API.completeTask(task.id);
      toast(result.next_task ? `Erledigt – nächste Wiederholung: ${fmtDate(result.next_task.due_date)}` : 'Erledigt');
      closeDetail();
      await afterMutation();
    });
  });

  $('#deleteTaskBtn').addEventListener('click', async () => {
    if (!confirm('Aufgabe wirklich löschen?')) return;
    await withBusy(async () => {
      await API.deleteTask(task.id);
      toast('Gelöscht');
      closeDetail();
      await afterMutation();
    });
  });

  $('#addSubtaskBtn').addEventListener('click', async () => {
    const input = $('#newSubtaskTitle');
    if (!input.value.trim()) return;
    await withBusy(async () => {
      await API.createTask({ title: input.value.trim(), area: task.area, parent_task_id: task.id, project_id: task.project_id });
      await openTaskDetail(task.id);
    });
  });

  $all('[data-action="toggle-sub"]', $('#taskDetail')).forEach((btn) => {
    btn.addEventListener('click', async () => {
      const row = btn.closest('[data-subtask-id]');
      const subId = Number(row.dataset.subtaskId);
      const sub = task.subtasks.find((s) => s.id === subId);
      await withBusy(async () => {
        await toggleTaskComplete(sub);
        await openTaskDetail(task.id);
      });
    });
  });

  $('#saveTaskBtn').addEventListener('click', async () => {
    const title = $('#fTitle').value.trim();
    if (!title) { toast('Titel darf nicht leer sein'); return; }
    const payload = {
      title,
      notes: $('#fNotes').value,
      area: $('#fArea').value,
      project_id: $('#fProject').value ? Number($('#fProject').value) : null,
      parent_task_id: task.parent_task_id || null,
      due_date: $('#fDueDate').value || null,
      due_time: $('#fDueTime').value || null,
      priority: Number($('#fPriority').value),
      status: task.status,
      tags: task.tags || [],
      link: task.link || null,
      assignee: $('#fAssignee').value.trim() || null,
      waiting_person: task.waiting_person || null,
      waiting_follow_up_date: task.waiting_follow_up_date || null,
      recurrence: task.recurrence || null,
      focus_date: task.focus_date || null,
      sort_order: task.sort_order || 0,
    };
    await withBusy(async () => {
      await API.updateTask(task.id, payload);
      toast('Gespeichert');
      closeDetail();
      await afterMutation();
    });
  });
}

// --------------------------------------------------------- Projekt-Detail

async function openProjectDetail(idOrNew, area) {
  const isNew = idOrNew === 'new';
  const project = isNew
    ? { id: null, name: '', area: area || 'business', parent_project_id: null, notes: '', archived: false }
    : await API.project(idOrNew);

  state.detail = { type: 'project', id: isNew ? 'new' : project.id };
  $('#overlay').hidden = false;
  const panel = $('#taskDetail');
  panel.hidden = false;
  panel.innerHTML = projectFormHTML(project, isNew);
  bindProjectFormEvents(project, isNew);
}

function projectFormHTML(project, isNew) {
  const siblings = (state.projects[project.area] || []).filter((p) => p.id !== project.id && !p.parent_project_id);
  return `
    <div class="slideover-header">
      <div class="slideover-title">${isNew ? 'Neues Projekt' : 'Projekt bearbeiten'}</div>
      <button class="icon-btn" id="closeDetailBtn">✕</button>
    </div>
    <div class="field">
      <label>Name</label>
      <input type="text" id="pName" value="${escapeHtml(project.name)}" />
    </div>
    <div class="field-row">
      <div class="field">
        <label>Bereich</label>
        <select id="pArea">
          <option value="business" ${project.area === 'business' ? 'selected' : ''}>Business</option>
          <option value="privat" ${project.area === 'privat' ? 'selected' : ''}>Privat</option>
        </select>
      </div>
      <div class="field">
        <label>Übergeordnetes Projekt</label>
        <select id="pParent">
          <option value="">– keins –</option>
          ${siblings.map((s) => `<option value="${s.id}" ${s.id === project.parent_project_id ? 'selected' : ''}>${escapeHtml(s.name)}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="field">
      <label>Notizen</label>
      <textarea id="pNotes" rows="3">${escapeHtml(project.notes || '')}</textarea>
    </div>
    ${!isNew ? `
    <div class="field">
      <label><input type="checkbox" id="pArchived" ${project.archived ? 'checked' : ''} style="width:auto;margin-right:6px" />Archiviert</label>
    </div>` : ''}
    <div class="slideover-footer">
      <div>${!isNew ? '<button class="btn btn-danger" id="deleteProjectBtn" type="button">Löschen</button>' : ''}</div>
      <button class="btn btn-primary" id="saveProjectBtn" type="button">Speichern</button>
    </div>
  `;
}

function bindProjectFormEvents(project, isNew) {
  $('#closeDetailBtn').addEventListener('click', closeDetail);

  if (!isNew) {
    $('#deleteProjectBtn').addEventListener('click', async () => {
      if (!confirm('Projekt wirklich löschen? (nur möglich ohne Aufgaben/Unterprojekte)')) return;
      await withBusy(async () => {
        await API.deleteProject(project.id);
        toast('Projekt gelöscht');
        closeDetail();
        await afterMutation();
      });
    });
  }

  $('#saveProjectBtn').addEventListener('click', async () => {
    const name = $('#pName').value.trim();
    if (!name) { toast('Name darf nicht leer sein'); return; }
    const payload = {
      name,
      area: $('#pArea').value,
      parent_project_id: $('#pParent').value ? Number($('#pParent').value) : null,
      notes: $('#pNotes').value,
      archived: $('#pArchived')?.checked || false,
      sort_order: 0,
    };
    await withBusy(async () => {
      if (isNew) {
        const created = await API.createProject(payload);
        toast('Projekt erstellt');
        closeDetail();
        await afterMutation();
        setView('project', created.id);
      } else {
        await API.updateProject(project.id, payload);
        toast('Gespeichert');
        closeDetail();
        await afterMutation();
      }
    });
  });
}

init();
