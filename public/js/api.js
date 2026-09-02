/**
 * TS3 Bot Admin Panel — API Client
 */
const API = {
  async request(method, url, body) {
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
    };
    if (body !== undefined) opts.body = JSON.stringify(body);

    const res = await fetch(url, opts);
    const data = await res.json().catch(() => ({ error: 'Invalid response' }));

    if (!res.ok) {
      throw new Error(data.error || `HTTP ${res.status}`);
    }
    return data;
  },

  get:    (url)        => API.request('GET',    url),
  post:   (url, body)  => API.request('POST',   url, body),
  put:    (url, body)  => API.request('PUT',    url, body),
  delete: (url)        => API.request('DELETE', url),

  // Auth
  login:  (username, password) => API.post('/api/auth/login',  { username, password }),
  logout: ()                   => API.post('/api/auth/logout'),
  me:     ()                   => API.get('/api/auth/me'),

  // Status
  status: () => API.get('/api/status'),

  // Temp channels
  getTempRules:   ()      => API.get('/api/temp-channels/rules'),
  getTempRule:    (id)    => API.get(`/api/temp-channels/rules/${id}`),
  createTempRule: (data)  => API.post('/api/temp-channels/rules', data),
  updateTempRule: (id, d) => API.put(`/api/temp-channels/rules/${id}`, d),
  deleteTempRule: (id)    => API.delete(`/api/temp-channels/rules/${id}`),
  setTempEnabled: (v)     => API.put('/api/temp-channels/global-enabled', { enabled: v }),
  getActiveChannels: ()   => API.get('/api/temp-channels/active'),

  // Clock / Date
  getClockDate:    ()     => API.get('/api/clock-date'),
  updateClockDate: (data) => API.put('/api/clock-date', data),
  previewClockDate:(params) => API.get(`/api/clock-date/preview?${new URLSearchParams(params)}`),

  // Poke
  getPoke:     ()     => API.get('/api/poke'),
  updatePoke:  (data) => API.put('/api/poke', data),
  previewPoke: (tmpl) => API.post('/api/poke/preview', { template: tmpl }),

  // Logs
  getLogs: (params) => API.get(`/api/logs?${new URLSearchParams(params)}`),
  clearLogs: (days) => API.delete(`/api/logs?days=${days}`),

  // Settings
  changePassword: (cur, nw) => API.put('/api/settings/password', { currentPassword: cur, newPassword: nw }),
  testTS:         ()        => API.post('/api/settings/ts-test'),
};
