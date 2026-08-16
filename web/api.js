/* Dünner fetch-Wrapper fürs Backend. Server/SQLite ist die alleinige
   Datenquelle (kein Offline-Cache wie bei der Stempeluhr-PWA) - jeder
   Aufruf geht direkt durchs Netz. Bei 401 wird global ein 'auth:required'
   Event ausgelöst, auf das app.js mit dem Login-Screen reagiert. */

const API = (() => {
  async function request(path, options = {}) {
    const isFormData = options.body instanceof FormData;
    const res = await fetch(`/api${path}`, {
      credentials: 'same-origin',
      // FormData setzt den Content-Type (inkl. Boundary) selbst - nicht überschreiben.
      headers: options.body && !isFormData ? { 'Content-Type': 'application/json' } : undefined,
      ...options,
    });
    if (res.status === 401) {
      window.dispatchEvent(new CustomEvent('auth:required'));
      throw new Error('Nicht angemeldet');
    }
    if (!res.ok) {
      let detail = res.statusText;
      try {
        const body = await res.json();
        detail = body.detail || detail;
      } catch {}
      throw new Error(detail);
    }
    if (res.status === 204) return null;
    return res.json();
  }

  const get = (path) => request(path);
  const post = (path, body) => request(path, { method: 'POST', body: JSON.stringify(body ?? {}) });
  const put = (path, body) => request(path, { method: 'PUT', body: JSON.stringify(body) });
  const del = (path) => request(path, { method: 'DELETE' });

  return {
    login: (password) => post('/login', { password }),
    logout: () => post('/logout'),
    me: () => get('/me'),

    tasks: (params = {}) => {
      const qs = new URLSearchParams(
        Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')
      );
      const suffix = qs.toString() ? `?${qs}` : '';
      return get(`/tasks${suffix}`);
    },
    task: (id) => get(`/tasks/${id}`),
    createTask: (task) => post('/tasks', task),
    updateTask: (id, task) => put(`/tasks/${id}`, task),
    deleteTask: (id) => del(`/tasks/${id}`),
    completeTask: (id) => post(`/tasks/${id}/complete`),
    setFocus: (id, focusDate) => post(`/tasks/${id}/focus`, { focus_date: focusDate }),
    uploadTaskImage: (id, file) => {
      const form = new FormData();
      form.append('file', file);
      return request(`/tasks/${id}/image`, { method: 'POST', body: form });
    },
    deleteTaskImage: (id) => del(`/tasks/${id}/image`),
    taskImageUrl: (id) => `/api/tasks/${id}/image`,

    projects: (params = {}) => {
      const qs = new URLSearchParams(
        Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')
      );
      const suffix = qs.toString() ? `?${qs}` : '';
      return get(`/projects${suffix}`);
    },
    project: (id) => get(`/projects/${id}`),
    createProject: (project) => post('/projects', project),
    updateProject: (id, project) => put(`/projects/${id}`, project),
    deleteProject: (id) => del(`/projects/${id}`),

    search: (q) => get(`/search?q=${encodeURIComponent(q)}`),
    counts: () => get('/counts'),

    loans: (params = {}) => {
      const qs = new URLSearchParams(
        Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')
      );
      const suffix = qs.toString() ? `?${qs}` : '';
      return get(`/loans${suffix}`);
    },
    createLoan: (loan) => post('/loans', loan),
    updateLoan: (id, loan) => put(`/loans/${id}`, loan),
    deleteLoan: (id) => del(`/loans/${id}`),
    returnLoan: (id) => post(`/loans/${id}/return`),
    unreturnLoan: (id) => post(`/loans/${id}/unreturn`),
  };
})();
