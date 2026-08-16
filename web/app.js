/* App-Zustand, Routing (ohne URL-Hash - reines In-Memory-View-Switching,
   analog zum data-screen-Muster der Stempeluhr-PWA) und Rendering aller
   Ansichten. Bewusst minimal: nur Alle Aufgaben, Ausleihe, Erledigt. */

const AREA_LABEL = { business: 'Business', privat: 'Privat' };
const PRIORITY_LABEL = { 1: 'P1', 2: 'P2', 3: 'P3', 4: 'P4' };

const state = {
  view: 'all',
  newTaskArea: 'business',
  detail: null, // { type: 'task'|'loan', id: number|'new' }
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

function fmtDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString('de-CH', { weekday: 'short', day: 'numeric', month: 'short' });
}

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.hidden = true; }, 2400);
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
  await setView('all');
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

  $('#mainNav').addEventListener('click', (e) => {
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

const VIEW_TITLES = { all: 'Alle', loans: 'Ausleihe', done: 'Erledigt' };

async function setView(view) {
  state.view = view;
  $all('#mainNav [data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  $('#mobileTitle').textContent = VIEW_TITLES[view] || 'To-do';
  await renderCurrentView();
}

async function afterMutation() {
  await renderCurrentView();
}

async function renderCurrentView() {
  const screen = $('#screen');
  screen.innerHTML = '<div class="empty-state">Lädt…</div>';
  try {
    switch (state.view) {
      case 'all': return await renderAll();
      case 'loans': return await renderLoans();
      case 'done': return await renderDone();
      default: screen.innerHTML = '<div class="empty-state">Unbekannte Ansicht</div>';
    }
  } catch (err) {
    console.error(err);
    screen.innerHTML = `<div class="empty-state">Fehler beim Laden: ${escapeHtml(err.message)}</div>`;
  }
}

// ------------------------------------------------------------- Task-Rows

function taskRowHTML(task) {
  const chips = [];
  const overdue = task.status === 'open' && task.due_date && task.due_date < todayISO();
  if (task.due_date) {
    chips.push(`<span class="chip ${overdue ? 'chip-overdue' : ''}">${escapeHtml(fmtDate(task.due_date))}${task.due_time ? ' · ' + task.due_time : ''}</span>`);
  }
  chips.push(`<span class="chip"><span class="area-dot area-${task.area}"></span> ${AREA_LABEL[task.area]}</span>`);
  if (task.priority <= 2) {
    chips.push(`<span class="chip chip-priority-${task.priority}">${PRIORITY_LABEL[task.priority]}</span>`);
  }
  if (task.image_filename) {
    chips.push('<span class="chip">📷</span>');
  }

  return `
    <div class="task-row" data-task-id="${task.id}" data-priority="${task.priority}" draggable="true">
      <button class="task-check ${task.status === 'done' ? 'checked' : ''}" data-action="toggle" aria-label="Erledigt"></button>
      <div class="task-body">
        <div class="task-title">${escapeHtml(task.title)}</div>
        <div class="task-meta">${chips.join('')}</div>
      </div>
    </div>
  `;
}

function taskListHTML(tasks) {
  if (!tasks.length) return '<div class="empty-state">Keine Aufgaben.</div>';
  return `<div class="task-list">${tasks.map(taskRowHTML).join('')}</div>`;
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

  list.addEventListener('dragstart', (e) => {
    const row = e.target.closest('.task-row');
    if (!row) return;
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

// -------------------------------------------------------------------- Alle

async function renderAll() {
  const tasks = await API.tasks({ status: 'open' });
  const byId = indexById(tasks);
  $('#screen').innerHTML = `
    <div class="section-title">Alle offenen Aufgaben <span class="count">${tasks.length}</span></div>
    <div id="list"></div>
  `;
  const el = $('#list');
  el.innerHTML = taskListHTML(tasks);
  attachTaskListEvents(el, byId, { onReorder: persistSortOrder });
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
  el.innerHTML = taskListHTML(tasks);
  attachTaskListEvents(el, byId, { sortable: false });
}

// --------------------------------------------------------------- Ausleihe

function loanRowHTML(loan) {
  const statusChip = loan.returned_date
    ? `<span class="chip">zurück am ${escapeHtml(fmtDate(loan.returned_date))}</span>`
    : `<span class="chip">seit ${escapeHtml(fmtDate(loan.lent_date))}</span>`;
  return `
    <div class="task-row" data-loan-id="${loan.id}">
      <div class="task-body">
        <div class="task-title">${escapeHtml(loan.product)}</div>
        <div class="task-meta">
          <span class="chip"><span class="area-dot area-${loan.area}"></span> ${AREA_LABEL[loan.area]}</span>
          <span class="chip">${escapeHtml(loan.person)}</span>
          ${statusChip}
        </div>
      </div>
      <button class="btn btn-small" data-action="toggle-return" type="button">
        ${loan.returned_date ? 'Wieder ausleihen' : 'Zurück'}
      </button>
    </div>
  `;
}

function attachLoanListEvents(container, loansById) {
  $all('.task-row', container).forEach((row) => {
    const id = Number(row.dataset.loanId);
    row.addEventListener('click', (e) => {
      if (e.target.closest('[data-action="toggle-return"]')) return;
      openLoanDetail(id);
    });
    $('[data-action="toggle-return"]', row).addEventListener('click', async (e) => {
      e.stopPropagation();
      const loan = loansById[id];
      await withBusy(async () => {
        if (loan.returned_date) await API.unreturnLoan(id);
        else await API.returnLoan(id);
        await renderLoans();
      });
    });
  });
}

async function renderLoans() {
  const loans = await API.loans();
  const active = loans.filter((l) => !l.returned_date);
  const returned = loans.filter((l) => l.returned_date);
  const byId = indexById(loans);

  $('#screen').innerHTML = `
    <div class="section-title" style="align-items:center">
      Ausgeliehen <span class="count">${active.length}</span>
      <button class="btn btn-small btn-primary" id="newLoanBtn" style="margin-left:auto" type="button">+ Neue Ausleihe</button>
    </div>
    <div id="listActive"></div>
    ${returned.length ? `<div class="section-title">Zurückgegeben <span class="count">${returned.length}</span></div><div id="listReturned"></div>` : ''}
  `;

  $('#newLoanBtn').addEventListener('click', () => openLoanDetail('new'));

  const listActive = $('#listActive');
  listActive.innerHTML = active.length
    ? `<div class="task-list">${active.map(loanRowHTML).join('')}</div>`
    : '<div class="empty-state">Nichts ausgeliehen.</div>';
  attachLoanListEvents(listActive, byId);

  if (returned.length) {
    const listReturned = $('#listReturned');
    listReturned.innerHTML = `<div class="task-list">${returned.map(loanRowHTML).join('')}</div>`;
    attachLoanListEvents(listReturned, byId);
  }
}

function loanFormHTML(loan, isNew) {
  return `
    <div class="slideover-header">
      <div class="slideover-title">${isNew ? 'Neue Ausleihe' : 'Ausleihe bearbeiten'}</div>
      <button class="icon-btn" id="closeDetailBtn">✕</button>
    </div>

    <div class="field">
      <label>Produkt</label>
      <input type="text" id="lProduct" value="${escapeHtml(loan.product)}" placeholder="z. B. Wing Score 4.5m2" />
    </div>

    <div class="field">
      <label>Person</label>
      <input type="text" id="lPerson" value="${escapeHtml(loan.person)}" />
    </div>

    <div class="field-row">
      <div class="field">
        <label>Bereich</label>
        <select id="lArea">
          <option value="business" ${loan.area === 'business' ? 'selected' : ''}>Business</option>
          <option value="privat" ${loan.area === 'privat' ? 'selected' : ''}>Privat</option>
        </select>
      </div>
      <div class="field">
        <label>Ausleihdatum</label>
        <input type="date" id="lLentDate" value="${loan.lent_date}" />
      </div>
    </div>

    <div class="field">
      <label>Notizen</label>
      <textarea id="lNotes" rows="3">${escapeHtml(loan.notes || '')}</textarea>
    </div>

    ${!isNew ? `
    <div class="field-row">
      <button class="btn ${loan.returned_date ? 'btn-primary' : ''}" id="lReturnToggle" type="button">
        ${loan.returned_date ? `Wieder ausleihen (zurück am ${escapeHtml(fmtDate(loan.returned_date))})` : 'Als zurückgegeben markieren'}
      </button>
    </div>` : ''}

    <div class="slideover-footer">
      <div>${!isNew ? '<button class="btn btn-danger" id="deleteLoanBtn" type="button">Löschen</button>' : ''}</div>
      <button class="btn btn-primary" id="saveLoanBtn" type="button">${isNew ? 'Erstellen' : 'Speichern'}</button>
    </div>
  `;
}

async function openLoanDetail(idOrNew) {
  const isNew = idOrNew === 'new';
  const loan = isNew
    ? { id: null, product: '', person: '', area: state.newTaskArea, lent_date: todayISO(), notes: '', returned_date: null }
    : (await API.loans()).find((l) => l.id === idOrNew);

  state.detail = { type: 'loan', id: isNew ? 'new' : loan.id };
  $('#overlay').hidden = false;
  const panel = $('#taskDetail');
  panel.hidden = false;
  panel.innerHTML = loanFormHTML(loan, isNew);
  bindLoanFormEvents(loan, isNew);
}

function bindLoanFormEvents(loan, isNew) {
  $('#closeDetailBtn').addEventListener('click', closeDetail);

  if (!isNew) {
    $('#lReturnToggle').addEventListener('click', async () => {
      await withBusy(async () => {
        if (loan.returned_date) await API.unreturnLoan(loan.id);
        else await API.returnLoan(loan.id);
        toast(loan.returned_date ? 'Wieder ausgeliehen' : 'Als zurückgegeben markiert');
        closeDetail();
        await renderLoans();
      });
    });

    $('#deleteLoanBtn').addEventListener('click', async () => {
      if (!confirm('Ausleihe wirklich löschen?')) return;
      await withBusy(async () => {
        await API.deleteLoan(loan.id);
        toast('Gelöscht');
        closeDetail();
        await renderLoans();
      });
    });
  }

  $('#saveLoanBtn').addEventListener('click', async () => {
    const product = $('#lProduct').value.trim();
    const person = $('#lPerson').value.trim();
    if (!product || !person) { toast('Produkt und Person dürfen nicht leer sein'); return; }
    const payload = {
      product,
      person,
      area: $('#lArea').value,
      lent_date: $('#lLentDate').value || todayISO(),
      notes: $('#lNotes').value,
    };
    await withBusy(async () => {
      if (isNew) {
        await API.createLoan(payload);
        toast('Ausleihe erstellt');
      } else {
        await API.updateLoan(loan.id, payload);
        toast('Gespeichert');
      }
      closeDetail();
      await renderLoans();
    });
  });
}

// ------------------------------------------------------------ Task-Detail

function closeDetail() {
  $('#overlay').hidden = true;
  $('#taskDetail').hidden = true;
  $('#taskDetail').innerHTML = '';
  state.detail = null;
}

async function openTaskDetail(idOrNew) {
  const isNew = idOrNew === 'new';
  const task = isNew ? {
    id: null, title: '', notes: '', area: state.newTaskArea,
    project_id: null, parent_task_id: null, due_date: null, due_time: null,
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
    panel.innerHTML = taskFormHTML(task);
    bindTaskFormEvents(task);
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

    <div class="field">
      <label>Bildnotiz</label>
      <input type="file" accept="image/*" id="nImage" />
      <img id="nImagePreview" class="image-preview" hidden />
    </div>

    <div class="slideover-footer">
      <div></div>
      <button class="btn btn-primary" id="saveNewTaskBtn" type="button">Erstellen</button>
    </div>
  `;
}

function bindNewTaskFormEvents(task) {
  $('#closeDetailBtn').addEventListener('click', closeDetail);

  $('#nImage').addEventListener('change', () => {
    const file = $('#nImage').files[0];
    const preview = $('#nImagePreview');
    if (!file) { preview.hidden = true; return; }
    preview.src = URL.createObjectURL(file);
    preview.hidden = false;
  });

  const submit = async () => {
    const title = $('#nTitle').value.trim();
    if (!title) { toast('Titel darf nicht leer sein'); return; }
    const imageFile = $('#nImage').files[0] || null;
    await withBusy(async () => {
      const created = await API.createTask({
        title,
        notes: $('#nNotes').value,
        area: $('#nArea').value,
        due_date: $('#nDueDate').value || null,
        priority: 3,
      });
      if (imageFile) await API.uploadTaskImage(created.id, imageFile);
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
        <label>Priorität</label>
        <select id="fPriority">
          ${[1, 2, 3, 4].map((p) => `<option value="${p}" ${task.priority === p ? 'selected' : ''}>${PRIORITY_LABEL[p]}</option>`).join('')}
        </select>
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

    <div class="field">
      <label>Verantwortlich</label>
      <input type="text" id="fAssignee" value="${escapeHtml(task.assignee || '')}" />
    </div>

    <div class="field">
      <label>Bildnotiz</label>
      <img
        id="fImagePreview"
        class="image-preview"
        ${task.image_filename ? `src="${API.taskImageUrl(task.id)}?v=${escapeHtml(task.image_filename)}"` : 'hidden'}
      />
      <div class="field-row" style="margin-top:6px">
        <input type="file" accept="image/*" id="fImage" />
        ${task.image_filename ? '<button class="btn btn-small btn-danger" id="deleteImageBtn" type="button">Entfernen</button>' : ''}
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

  $('#fImage').addEventListener('change', async () => {
    const file = $('#fImage').files[0];
    if (!file) return;
    await withBusy(async () => {
      await API.uploadTaskImage(task.id, file);
      toast('Bild gespeichert');
      await openTaskDetail(task.id);
    });
  });

  const deleteImageBtn = $('#deleteImageBtn');
  if (deleteImageBtn) deleteImageBtn.addEventListener('click', async () => {
    await withBusy(async () => {
      await API.deleteTaskImage(task.id);
      toast('Bild entfernt');
      await openTaskDetail(task.id);
    });
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
      project_id: task.project_id || null,
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

init();
