/**
 * TS3 Bot Admin Panel — Shared Utilities
 */

// ── Alert helper ──────────────────────────────────────────────────────────────
function showAlert(id, message, type = 'success', timeout = 4000) {
  const el = document.getElementById(id);
  if (!el) return;
  el.className = `alert alert-${type} show`;
  el.textContent = message;
  if (timeout > 0) setTimeout(() => hideAlert(id), timeout);
}
function hideAlert(id) {
  const el = document.getElementById(id);
  if (el) el.className = 'alert';
}

// ── Loading state ─────────────────────────────────────────────────────────────
function setLoading(btnId, loading, originalText) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  btn.disabled = loading;
  if (loading) {
    btn.dataset.orig = btn.innerHTML;
    btn.innerHTML = '<span class="spinner"></span> Saving...';
  } else {
    btn.innerHTML = originalText || btn.dataset.orig || btn.innerHTML;
  }
}

// ── Format date ───────────────────────────────────────────────────────────────
function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'medium' });
}

// ── Format uptime ─────────────────────────────────────────────────────────────
function fmtUptime(sec) {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const parts = [];
  if (d) parts.push(d + 'd');
  if (h) parts.push(h + 'h');
  if (m) parts.push(m + 'm');
  parts.push(s + 's');
  return parts.join(' ');
}

// ── Set TS status badge ───────────────────────────────────────────────────────
function setTSBadge(status) {
  const badge = document.getElementById('ts-status-badge');
  if (!badge) return;
  badge.className = 'ts-status-badge ' + (status === 'connected' ? 'connected' : status === 'reconnecting' ? 'reconnecting' : 'disconnected');
  const text = badge.querySelector('.ts-text');
  if (text) text.textContent = status.charAt(0).toUpperCase() + status.slice(1);
}

// ── Sidebar toggle (mobile) ───────────────────────────────────────────────────
function initSidebar() {
  const sidebar  = document.getElementById('sidebar');
  const overlay  = document.getElementById('sidebar-overlay');
  const hamburger= document.getElementById('hamburger');

  if (!sidebar || !hamburger) return;

  hamburger.addEventListener('click', () => {
    sidebar.classList.toggle('open');
    if (overlay) overlay.classList.toggle('show');
  });
  if (overlay) {
    overlay.addEventListener('click', () => {
      sidebar.classList.remove('open');
      overlay.classList.remove('show');
    });
  }
}

// ── Logout button ─────────────────────────────────────────────────────────────
function initLogout() {
  const btn = document.getElementById('btn-logout');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    try {
      await API.logout();
    } finally {
      window.location.href = '/login';
    }
  });
}

// ── Poll status (topbar) ──────────────────────────────────────────────────────
async function pollStatus() {
  try {
    const data = await API.status();
    setTSBadge(data.tsStatus);
  } catch {
    setTSBadge('disconnected');
  }
}

// ── Init shared on DOMContentLoaded ───────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initSidebar();
  initLogout();
  // Poll TS status every 15s
  pollStatus();
  setInterval(pollStatus, 15_000);
});
