const $ = (selector) => document.querySelector(selector);
const form = $('#check-form');
const history = $('#history');
let filter = '';
let checking = false;
let historyRequest = 0;

function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}
function notice(message = '') { $('#notice').textContent = message; $('#notice').hidden = !message; }
function connection(ok) {
  $('#connection').className = `connection ${ok ? 'online' : 'offline'}`;
  $('#connection-text').textContent = ok ? 'Система на связи' : 'Нет соединения';
}
async function api(path, options = {}) {
  const response = await fetch(path, { ...options, signal: AbortSignal.timeout(15_000) });
  let data;
  try { data = await response.json(); } catch { throw new Error('Сервер недоступен. Попробуйте ещё раз.'); }
  if (!response.ok) throw new Error(data.error ?? 'Не удалось выполнить запрос.');
  return data;
}
function renderRows(checks) {
  history.replaceChildren();
  for (const check of checks) {
    const row = node('tr');
    const site = node('td');
    const wrap = node('div', undefined, 'site-cell');
    wrap.append(node('span', '◎', 'site-icon'));
    const info = node('div');
    const parsed = new URL(check.url);
    const title = node('div', check.is_demo ? 'Демо-сайт' : parsed.hostname, 'site-name');
    if (check.is_demo) title.append(node('span', 'ДЕМО', 'demo-tag'));
    const detail = node('div', check.error || check.url, 'site-detail');
    detail.title = check.error ? `${check.url} — ${check.error}` : check.url;
    info.append(title, detail); wrap.append(info); site.append(wrap);
    const status = node('td');
    const badge = node('span', undefined, `status-pill ${check.status === 'down' ? 'down-pill' : ''}`);
    badge.append(node('i', undefined, `dot ${check.status}`), node('span', check.status === 'up' ? 'Доступен' : 'Недоступен'));
    status.append(badge);
    const time = node('td', new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(check.checked_at)), 'time-cell');
    row.append(site, status, node('td', check.http_status ?? '—', 'http-code'), node('td', `${check.response_time_ms.toLocaleString('ru-RU')} мс`, 'response-time'), time);
    history.append(row);
  }
  $('#empty').hidden = checks.length !== 0;
  $('#empty-title').textContent = 'В журнале пока тихо';
  $('#empty-text').textContent = filter ? 'Проверок с таким статусом пока нет.' : 'Запустите первую проверку сайта.';
  $('#visible-count').textContent = checks.length;
}
async function loadHistory({ clearNotice = true } = {}) {
  const request = ++historyRequest;
  if (clearNotice) notice();
  $('#load-history').disabled = true;
  history.setAttribute('aria-busy', 'true');
  try {
    const data = await api(`/api/checks${filter ? `?status=${filter}` : ''}`);
    if (request !== historyRequest) return;
    renderRows(data.checks);
    for (const key of ['total', 'up', 'down']) $(`#stat-${key}`).textContent = data.summary[key].toLocaleString('ru-RU');
    $('#stat-time').textContent = data.summary.average_ms.toLocaleString('ru-RU');
    $('#updated').textContent = `Обновлено в ${new Date().toLocaleTimeString('ru-RU')}`;
    return true;
  } catch (error) {
    if (request !== historyRequest) return;
    notice(`Не удалось загрузить журнал: ${error.message}`);
    $('#updated').textContent = 'Не удалось обновить';
    if (!history.children.length) {
      $('#empty').hidden = false;
      $('#empty-title').textContent = 'Журнал недоступен';
      $('#empty-text').textContent = 'Проверьте запуск контейнеров и нажмите «Загрузить журнал».';
    }
    return false;
  } finally {
    if (request === historyRequest) { $('#load-history').disabled = false; history.setAttribute('aria-busy', 'false'); }
  }
}
async function updateHealth() {
  try { await api('/api/health'); connection(true); } catch { connection(false); }
}
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (checking) return;
  checking = true; notice();
  $('#check-button').disabled = true;
  $('#check-button').textContent = 'Проверяем…';
  $('#url').disabled = true;
  document.querySelectorAll('.demo-button').forEach(button => { button.disabled = true; });
  $('#latest-result').hidden = true;
  try {
    const { check } = await api('/api/checks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: $('#url').value.trim() }) });
    const result = $('#latest-result');
    result.className = `latest-result ${check.status === 'down' ? 'down-result' : ''}`;
    result.textContent = `${check.is_demo ? 'Демо-проверка. ' : ''}${check.status === 'up' ? 'Сайт доступен' : 'Сайт недоступен'} · ${check.http_status ? `HTTP ${check.http_status} · ` : ''}${check.response_time_ms} мс. ${check.error && !check.http_status ? `${check.error} ` : ''}Результат сохранён в журнале.`;
    result.hidden = false;
    filter = ''; updateFilters();
    await loadHistory({ clearNotice: false });
  } catch (error) { notice(error.message); }
  finally {
    checking = false;
    $('#check-button').disabled = false; $('#check-button').textContent = '↗ Проверить сайт';
    $('#url').disabled = false;
    document.querySelectorAll('.demo-button').forEach(button => { button.disabled = false; });
    void updateHealth();
  }
});
function updateFilters() {
  document.querySelectorAll('.filter').forEach(button => {
    const selected = button.dataset.status === filter;
    button.classList.toggle('active', selected); button.setAttribute('aria-pressed', String(selected));
  });
}
document.querySelectorAll('.filter').forEach(button => button.addEventListener('click', () => {
  filter = button.dataset.status; updateFilters(); void loadHistory();
}));
document.querySelectorAll('.demo-button').forEach(button => button.addEventListener('click', () => {
  $('#url').value = `http://web-service:4000/demo/${button.dataset.demo}`; form.requestSubmit();
}));
$('#load-history').addEventListener('click', () => { void loadHistory(); void updateHealth(); });
void loadHistory(); void updateHealth();
