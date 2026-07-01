const $ = (s) => document.querySelector(s);

const state = {
  mode: 'chat',
  model: 'qwen/qwen3.5-397b-a17b',
  models: [],
  history: [],
  streaming: false,
  temperature: 0.6,
  maxSteps: 20,
  perm: { mode: 'ask', scope: '', home: '' },
  attachment: null, // { url, name }
  convId: null,
  agentAbort: null,
  runTimer: null,
  runStart: 0,
  runStep: 0,
  convHasAgent: false, // did this conversation use agent mode?
  histTab: 'chat', // history sheet active tab
  orch: {}, // swarm dashboard state
  allConvos: [],
};

// ---------- tiny markdown ----------
function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function md(src) {
  const blocks = [];
  let s = String(src).replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    blocks.push(`<pre><code>${escapeHtml(code.replace(/\n$/, ''))}</code></pre>`);
    return ` ${blocks.length - 1} `;
  });
  s = escapeHtml(s);
  s = s.replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`);
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  s = s.replace(/^### (.*)$/gm, '<h3>$1</h3>').replace(/^## (.*)$/gm, '<h2>$1</h2>').replace(/^# (.*)$/gm, '<h2>$1</h2>');
  s = s.replace(/(?:^|\n)((?:[-*] .*(?:\n|$))+)/g, (m, items) => `\n<ul>${items.trim().split('\n').map((l) => `<li>${l.replace(/^[-*] /, '')}</li>`).join('')}</ul>`);
  s = s.replace(/(?:^|\n)((?:\d+\. .*(?:\n|$))+)/g, (m, items) => `\n<ol>${items.trim().split('\n').map((l) => `<li>${l.replace(/^\d+\. /, '')}</li>`).join('')}</ol>`);
  s = s.split(/\n{2,}/).map((p) => (/^<(h\d|ul|ol|pre)/.test(p.trim()) ? p : `<p>${p.replace(/\n/g, '<br>')}</p>`)).join('');
  s = s.replace(/(\d+)/g, (_, i) => blocks[+i]);
  return s;
}

// ---------- DOM ----------
const messagesEl = $('#messages');
function clearEmpty() { const e = $('#emptyState'); if (e) e.remove(); }
function scrollDown() { messagesEl.scrollTop = messagesEl.scrollHeight; }

function addMsg(role, text = '', imageUrl) {
  clearEmpty();
  const wrap = document.createElement('div');
  wrap.className = `msg ${role}`;
  const r = document.createElement('div');
  r.className = 'role';
  r.textContent = role === 'user' ? 'you' : 'agentos';
  const b = document.createElement('div');
  b.className = 'bubble';
  if (imageUrl) { const img = document.createElement('img'); img.className = 'att-img'; img.src = imageUrl; b.append(img); }
  const t = document.createElement('div');
  if (role === 'user') t.textContent = text; else t.innerHTML = md(text);
  b.append(t);
  wrap.append(r, b);
  messagesEl.append(wrap);
  scrollDown();
  return t;
}
function addCopyBtn(bubbleEl, getText) {
  const bar = document.createElement('div');
  bar.className = 'msg-tools';
  const btn = document.createElement('button');
  btn.className = 'copy-btn';
  btn.textContent = '⧉ copy';
  btn.type = 'button';
  btn.onclick = async () => {
    try {
      await copyText(getText());
      btn.textContent = '✓ copied';
      setTimeout(() => (btn.textContent = '⧉ copy'), 1200);
    } catch (err) {
      console.error('Copy failed:', err);
      btn.textContent = 'copy failed';
      setTimeout(() => (btn.textContent = '⧉ copy'), 1600);
    }
  };
  bar.append(btn);
  bubbleEl.closest('.msg').append(bar);
}

async function copyText(value) {
  const text = String(value ?? '');
  if (navigator.clipboard?.writeText && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch (err) {
      console.warn('Clipboard API failed, trying fallback:', err);
    }
  }
  fallbackCopyText(text);
}

function fallbackCopyText(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.top = '0';
  ta.style.left = '0';
  ta.style.width = '1px';
  ta.style.height = '1px';
  ta.style.opacity = '0';
  document.body.append(ta);
  ta.focus();
  ta.select();
  ta.setSelectionRange(0, ta.value.length);
  try {
    if (!document.execCommand('copy')) throw new Error('document.execCommand("copy") returned false');
  } finally {
    ta.remove();
  }
}
function addTraceContainer() { const t = document.createElement('div'); t.className = 'trace'; messagesEl.append(t); return t; }

// ---------- agent run bar ----------
function fmtElapsed(ms) { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }
function showRunBar() {
  state.runStart = Date.now(); state.runStep = 0;
  $('#runBar').classList.remove('hidden');
  const tick = () => { $('#runStatus').innerHTML = `Agent working… · step <b>${state.runStep}</b>/${state.maxSteps} · ${fmtElapsed(Date.now() - state.runStart)}`; };
  tick();
  state.runTimer = setInterval(tick, 1000);
}
function hideRunBar() {
  clearInterval(state.runTimer); state.runTimer = null;
  $('#runBar').classList.add('hidden');
  state.agentAbort = null;
}
function traceStep(container, cls, html) { const s = document.createElement('div'); s.className = `step ${cls}`; s.innerHTML = html; container.append(s); scrollDown(); return s; }

// Render one persisted/live tool step into a trace container.
function appendToolStep(container, s) {
  if (s.k === 'start') traceStep(container, '', `<span class="name">⚡ ${escapeHtml(s.name)}</span><pre>${escapeHtml(JSON.stringify(s.args ?? {}, null, 2))}</pre>`);
  else if (s.k === 'done') traceStep(container, '', `<details><summary><span class="name">✓ ${escapeHtml(s.name)}</span></summary><pre>${escapeHtml(String(s.result ?? '').slice(0, 4000))}</pre></details>`);
  else if (s.k === 'error') traceStep(container, 'err', `<span class="name">✕ ${escapeHtml(s.name)}</span><pre>${escapeHtml(String(s.error ?? ''))}</pre>`);
}

// Persist the current conversation (auto-save, every turn).
async function autosave() {
  if (!state.history.length) return;
  if (!state.convId) state.convId = (crypto.randomUUID && crypto.randomUUID()) || String(Date.now());
  try {
    await fetch('/api/conversations', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: state.convId, title: '', mode: state.convHasAgent ? 'agent' : 'chat', model: state.model, messages: state.history }),
    });
  } catch {}
}

// ---------- SSE ----------
async function streamPost(url, body, onEvent, signal) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const parts = buf.split('\n\n');
    buf = parts.pop();
    for (const part of parts) {
      const line = part.split('\n').find((l) => l.startsWith('data:'));
      if (!line) continue;
      try { onEvent(JSON.parse(line.slice(5).trim())); } catch {}
    }
  }
}

// ---------- approval ----------
function handleApproval(ev) {
  $('#apRisk').innerHTML = `<span class="risk ${ev.risk}">${ev.risk} risk</span>`;
  $('#apTool').innerHTML = `Tool <b>${ev.name}</b> wants to run:`;
  $('#apArgs').textContent = JSON.stringify(ev.args, null, 2);
  const modal = $('#approvalModal');
  modal.classList.remove('hidden');
  const decide = (decision) => {
    modal.classList.add('hidden');
    fetch('/api/approve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: ev.id, decision }) });
  };
  $('#apApprove').onclick = () => decide('approve');
  $('#apDeny').onclick = () => decide('deny');
}

// ---------- send ----------
async function send() {
  const input = $('#input');
  const text = input.value.trim();
  if ((!text && !state.attachment) || state.streaming) return;
  input.value = '';
  input.style.height = 'auto';
  setStreaming(true);

  const attach = state.attachment;
  clearAttachment();
  addMsg('user', text, attach?.url);

  if (state.mode === 'chat') await runChat(text, attach);
  else if (state.mode === 'orchestrate') await runOrchestrate(text);
  else await runAgent(text);
  setStreaming(false);
}

// ---------- orchestrator (Swarm) dashboard ----------
const STATUS_ICON = { pending: '○', planning: '◔', running: '', waiting: '⏳', reviewing: '🔍', done: '✓', failed: '✕', cancelled: '⊘' };

function orchNodeEl(agent) {
  const el = document.createElement('div');
  el.className = 'onode';
  el.innerHTML = `<div class="onode-row ${agent.status}">
      <span class="ocaret">▾</span>
      <span class="oicon"></span>
      <span class="orole">${escapeHtml(agent.role)}</span>
      <span class="ogoal">${escapeHtml(agent.goal)}</span>
      <span class="ometa"></span>
    </div>
    <div class="onode-children"></div>`;
  const row = el.querySelector('.onode-row');
  row.querySelector('.ocaret').onclick = (e) => { e.stopPropagation(); el.classList.toggle('collapsed'); };
  setNodeStatus(el, agent.status);
  return el;
}
function setNodeStatus(el, status, note) {
  const row = el.querySelector('.onode-row');
  row.className = 'onode-row ' + status;
  const icon = el.querySelector('.oicon');
  icon.innerHTML = status === 'running' ? '<span class="ospin"></span>' : (STATUS_ICON[status] || '•');
  if (note) el.querySelector('.ometa').textContent = note;
}
function renderStats(s) {
  if (!state.orch.statsEl) return;
  const sec = (s.elapsedMs / 1000).toFixed(0);
  state.orch.statsEl.innerHTML =
    `<span class="ochip">▦ ${s.total}</span>` +
    `<span class="ochip run">⚙ ${s.running}</span>` +
    `<span class="ochip ok">✓ ${s.done}</span>` +
    `<span class="ochip bad">✕ ${s.failed}</span>` +
    `<span class="ochip">~${s.tokensUsed.toLocaleString()} tok</span>` +
    `<span class="ochip">depth ${s.maxDepthReached}</span>` +
    `<span class="ochip">${sec}s</span>`;
}

async function runOrchestrate(goal) {
  clearEmpty();
  state.orch = { nodes: new Map() };
  const board = document.createElement('div');
  board.className = 'orch';
  board.innerHTML = `<div class="orch-head"><span>🕸 Swarm</span><button class="orch-stop">■ Stop</button></div>
     <div class="orch-stats"></div><div class="orch-tree"></div>`;
  messagesEl.append(board);
  state.orch.statsEl = board.querySelector('.orch-stats');
  state.orch.treeEl = board.querySelector('.orch-tree');
  const ac = new AbortController();
  state.agentAbort = ac;
  board.querySelector('.orch-stop').onclick = () => ac.abort();
  scrollDown();

  try {
    await streamPost('/api/orchestrate', { model: state.model, goal, decompose: true, temperature: state.temperature }, (ev) => {
      if (ev.type === 'agent.created') {
        const a = ev.agent;
        const el = orchNodeEl(a);
        state.orch.nodes.set(a.id, el);
        const parent = a.parentId && state.orch.nodes.get(a.parentId);
        (parent ? parent.querySelector('.onode-children') : state.orch.treeEl).append(el);
        scrollDown();
      } else if (ev.type === 'agent.status') {
        const el = state.orch.nodes.get(ev.id); if (el) setNodeStatus(el, ev.status, ev.note);
      } else if (ev.type === 'agent.tokens') {
        const el = state.orch.nodes.get(ev.id); if (el) el.querySelector('.ometa').textContent = `~${ev.tokensUsed.toLocaleString()} tok`;
      } else if (ev.type === 'agent.tool') {
        const el = state.orch.nodes.get(ev.id); if (el) el.querySelector('.ometa').textContent = `⚡ ${ev.name} ${ev.phase === 'done' ? '✓' : ev.phase === 'error' ? '✕' : '…'}`;
      } else if (ev.type === 'agent.failed') {
        const el = state.orch.nodes.get(ev.id); if (el) { setNodeStatus(el, 'failed'); el.querySelector('.ometa').textContent = ev.error?.slice(0, 60) || 'failed'; }
      } else if (ev.type === 'stats') {
        renderStats(ev.stats);
      } else if (ev.type === 'approval') {
        handleApproval(ev);
      } else if (ev.type === 'final') {
        renderStats(ev.stats);
        const b = addMsg('ai', ev.content);
        addCopyBtn(b, () => ev.content);
        if (ev.status !== 'success') { const w = document.createElement('div'); w.className = 'truncated'; w.textContent = `status: ${ev.status}`; b.after(w); }
      } else if (ev.type === 'error') {
        const w = addMsg('ai', `⚠ ${ev.error}`);
      }
    }, ac.signal);
  } catch (e) {
    if (e.name !== 'AbortError') addMsg('ai', `⚠ ${e.message}`);
  } finally {
    state.agentAbort = null;
  }
}

async function runChat(text, attach) {
  const content = attach
    ? [{ type: 'text', text: text || 'Describe this image.' }, { type: 'image_url', image_url: { url: attach.url } }]
    : text;
  state.history.push({ role: 'user', content });
  const bubble = addMsg('ai', '');
  bubble.classList.add('cursor');
  let full = '';
  try {
    await streamPost('/api/chat', { model: state.model, messages: state.history, temperature: state.temperature }, (ev) => {
      if (ev.type === 'token') { full += ev.text; bubble.innerHTML = md(full); scrollDown(); }
      else if (ev.type === 'done' && ev.finish === 'length') { const w = document.createElement('div'); w.className = 'truncated'; w.textContent = '⚠ truncated (token limit)'; bubble.after(w); }
      else if (ev.type === 'error') { full += `\n\n⚠ ${ev.error}`; bubble.innerHTML = md(full); }
    });
  } catch (e) { bubble.innerHTML = md(full + `\n\n⚠ ${e.message}`); }
  bubble.classList.remove('cursor');
  addCopyBtn(bubble, () => full);
  state.history.push({ role: 'assistant', content: full });
  autosave();
}

async function runAgent(text) {
  state.convHasAgent = true;
  const priorHistory = state.history.slice();       // sent to server (no current turn)
  state.history.push({ role: 'user', content: text }); // local record for display + save
  const trace = addTraceContainer();
  const thinking = traceStep(trace, '', '<span class="thinking">▚ thinking…</span>');
  const steps = []; // persisted trace
  const ac = new AbortController();
  state.agentAbort = ac;
  let done = false;
  showRunBar();
  try {
    await streamPost('/api/agent', { model: state.model, prompt: text, history: priorHistory, temperature: state.temperature, maxSteps: state.maxSteps }, (ev) => {
      if (ev.type === 'thinking') { state.runStep = ev.iter; thinking.innerHTML = `<span class="thinking">▚ reasoning (step ${ev.iter})…</span>`; }
      else if (ev.type === 'approval') handleApproval(ev);
      else if (ev.type === 'tool') {
        if (ev.phase === 'start') { const s = { k: 'start', name: ev.name, args: ev.args }; steps.push(s); appendToolStep(trace, s); }
        else if (ev.phase === 'done') { const r = typeof ev.result === 'string' ? ev.result : JSON.stringify(ev.result, null, 2); const s = { k: 'done', name: ev.name, result: r.slice(0, 4000) }; steps.push(s); appendToolStep(trace, s); }
        else if (ev.phase === 'error') { const s = { k: 'error', name: ev.name, error: String(ev.error) }; steps.push(s); appendToolStep(trace, s); }
      } else if (ev.type === 'final') {
        done = true;
        thinking.remove();
        const b = addMsg('ai', ev.content);
        addCopyBtn(b, () => ev.content);
        state.history.push({ role: 'assistant', content: ev.content, trace: steps });
        if (ev.status !== 'success') { const w = document.createElement('div'); w.className = 'truncated'; w.textContent = `status: ${ev.status} · ${ev.iterations} steps`; b.after(w); }
      } else if (ev.type === 'error') thinking.innerHTML = `<span class="name">⚠ ${ev.error}</span>`;
    }, ac.signal);
  } catch (e) {
    if (e.name === 'AbortError') { thinking.innerHTML = '<span class="thinking">■ stopped by you.</span>'; }
    else thinking.innerHTML = `<span class="name">⚠ ${e.message}</span>`;
  } finally {
    hideRunBar();
    // Record the run even if stopped/errored, so it's returnable in history.
    if (!done) state.history.push({ role: 'assistant', content: '_(run stopped)_', trace: steps });
    autosave();
  }
}

function setStreaming(on) { state.streaming = on; $('#sendBtn').disabled = on; }

// ---------- models ----------
async function loadModels() {
  try {
    const info = await (await fetch('/api/info')).json();
    state.model = info.defaultModel || state.model;
    setModelLabel();
    state.models = (await (await fetch('/api/models')).json()).models;
  } catch { $('#modelLabel').textContent = 'offline'; }
}
function setModelLabel() { $('#modelLabel').textContent = state.model; }
function renderModelList(filter = '') {
  const list = $('#modelList');
  const f = filter.toLowerCase();
  list.innerHTML = '';
  state.models.filter((m) => m.id.toLowerCase().includes(f)).forEach((m) => {
    const [vendor, ...rest] = m.id.split('/');
    const item = document.createElement('div');
    item.className = 'model-item' + (m.id === state.model ? ' sel' : '');
    item.innerHTML = rest.length ? `<span class="vendor">${vendor}/</span>${rest.join('/')}` : m.id;
    item.onclick = () => { state.model = m.id; setModelLabel(); closeSheets(); };
    list.append(item);
  });
  if (!list.children.length) list.innerHTML = '<p class="hint">No match.</p>';
}

// ---------- tools ----------
async function loadTools() {
  const { tools } = await (await fetch('/api/tools')).json();
  const list = $('#toolList');
  list.innerHTML = '';
  tools.forEach((t) => {
    const row = document.createElement('div');
    row.className = 'tool-item';
    row.innerHTML = `<div class="tmeta"><div class="tname">${t.name} <span class="risk ${t.riskLevel}">${t.riskLevel}</span></div><div class="tdesc">${t.description}</div></div><label class="switch"><input type="checkbox" ${t.enabled ? 'checked' : ''}><span class="slider"></span></label>`;
    row.querySelector('input').onchange = (e) =>
      fetch('/api/tools/toggle', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: t.name, enabled: e.target.checked }) });
    list.append(row);
  });
}

// ---------- skills browser ----------
async function loadSkills(filter = '') {
  const q = filter ? `?q=${encodeURIComponent(filter)}` : '';
  const d = await (await fetch('/api/skills' + q)).json();
  $('#skillsCount').textContent = `(${d.count})`;
  $('#skillView').classList.add('hidden');
  const list = $('#skillsList');
  list.classList.remove('hidden');
  list.innerHTML = '';
  (d.skills || []).forEach((s) => {
    const item = document.createElement('div');
    item.className = 'skill-item';
    item.innerHTML = `<div class="sname">${escapeHtml(s.name)}</div><div class="scat">${escapeHtml(s.category || '')}</div><div class="sdesc">${escapeHtml(s.description || '')}</div>`;
    item.onclick = () => viewSkill(s.name);
    list.append(item);
  });
  if (!list.children.length) list.innerHTML = '<p class="hint">No match.</p>';
}
async function viewSkill(name) {
  const s = await (await fetch('/api/skills/' + encodeURIComponent(name))).json();
  const v = $('#skillView');
  $('#skillsList').classList.add('hidden');
  v.classList.remove('hidden');
  v.innerHTML = '';
  const back = document.createElement('button');
  back.className = 'back';
  back.textContent = '← back';
  back.onclick = () => { v.classList.add('hidden'); $('#skillsList').classList.remove('hidden'); };
  const pre = document.createElement('pre');
  pre.textContent = s.instructions || s.error || '(empty)';
  v.append(back, pre);
  v.scrollIntoView({ block: 'start' });
}

// ---------- settings / permissions ----------
async function loadSettings() {
  const s = await (await fetch('/api/settings')).json();
  state.perm = s;
  $('#scopeInput').value = s.scope;
  applyPermUI();
}
function applyPermUI() {
  const badge = $('#permBadge');
  badge.textContent = state.perm.mode.toUpperCase();
  badge.className = 'perm-badge ' + state.perm.mode;
  document.querySelectorAll('.perm-btn').forEach((b) => b.classList.toggle('active', b.dataset.perm === state.perm.mode));
}
async function saveSettings(patch) {
  const s = await (await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) })).json();
  state.perm = s;
  $('#scopeInput').value = s.scope;
  applyPermUI();
}

// ---------- conversations / history ----------
async function loadChats() {
  const { conversations } = await (await fetch('/api/conversations')).json();
  state.allConvos = conversations || [];
  renderChats();
}
function renderChats() {
  const tab = state.histTab;
  const list = $('#chatsList');
  const items = state.allConvos.filter((c) => (c.mode === 'agent' ? 'agent' : 'chat') === tab);
  list.innerHTML = '';
  if (!items.length) { list.innerHTML = `<p class="hint">No ${tab === 'agent' ? 'agent runs' : 'chats'} yet.</p>`; return; }
  items.forEach((c) => {
    const row = document.createElement('div');
    row.className = 'chat-item';
    const d = new Date(c.updated).toLocaleString();
    const cur = c.id === state.convId ? ' • current' : '';
    row.innerHTML = `<div class="ctitle"><div class="cname">${escapeHtml(c.title)}</div><div class="cmeta">${c.model.split('/').pop()} · ${d}${cur}</div></div><button class="cdel">🗑</button>`;
    row.querySelector('.ctitle').onclick = () => loadConversation(c.id);
    row.querySelector('.cdel').onclick = async (e) => { e.stopPropagation(); await fetch('/api/conversations/' + c.id, { method: 'DELETE' }); if (c.id === state.convId) state.convId = null; loadChats(); };
    list.append(row);
  });
}
async function loadConversation(id) {
  const c = await (await fetch('/api/conversations/' + id)).json();
  state.history = c.messages || [];
  state.model = c.model; setModelLabel();
  state.convId = c.id;
  state.convHasAgent = c.mode === 'agent';
  messagesEl.innerHTML = '';
  (c.messages || []).forEach((m) => {
    if (m.role === 'assistant' && Array.isArray(m.trace) && m.trace.length) {
      const tc = addTraceContainer();
      m.trace.forEach((s) => appendToolStep(tc, s));
    }
    let text = m.content, img;
    if (Array.isArray(m.content)) {
      text = (m.content.find((x) => x.type === 'text') || {}).text || '';
      img = (m.content.find((x) => x.type === 'image_url') || {}).image_url?.url;
    }
    const bub = addMsg(m.role === 'assistant' ? 'ai' : m.role, text, img);
    if (m.role === 'assistant') addCopyBtn(bub, () => (typeof m.content === 'string' ? m.content : text));
  });
  closeSheets();
}

// ---------- attachment ----------
function clearAttachment() { state.attachment = null; $('#attachPreview').classList.add('hidden'); $('#attachPreview').innerHTML = ''; }
$('#attachBtn').onclick = () => $('#fileInput').click();
$('#fileInput').onchange = (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    state.attachment = { url: reader.result, name: file.name };
    // Auto-switch to a vision model if the current one isn't multimodal.
    let note = escapeHtml(file.name);
    if (!/vl|vision/i.test(state.model)) {
      state.model = 'meta/llama-3.2-11b-vision-instruct';
      setModelLabel();
      note = `${escapeHtml(file.name)} · switched to vision model`;
    }
    const pv = $('#attachPreview');
    pv.innerHTML = `<img src="${reader.result}"><span class="hint">${note}</span><button>✕</button>`;
    pv.querySelector('button').onclick = clearAttachment;
    pv.classList.remove('hidden');
  };
  reader.readAsDataURL(file);
  e.target.value = '';
};

// ---------- sheets ----------
function closeSheets() { document.querySelectorAll('.sheet').forEach((s) => s.classList.add('hidden')); }

// ---------- wire up ----------
$('#sendBtn').onclick = send;
$('#input').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
$('#input').addEventListener('input', (e) => { e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 140) + 'px'; });

document.querySelectorAll('.seg-btn').forEach((b) => {
  b.onclick = () => {
    document.querySelectorAll('.seg-btn').forEach((x) => x.classList.remove('active'));
    b.classList.add('active');
    state.mode = b.dataset.mode;
    $('#input').placeholder = state.mode === 'agent' ? 'Give the agent a task…' : state.mode === 'orchestrate' ? 'Give the swarm a complex goal…' : 'Message…';
  };
});

// model sheet
$('#modelBtn').onclick = () => { renderModelList($('#modelSearch').value); $('#modelSheet').classList.remove('hidden'); };
$('#modelClose').onclick = closeSheets;
$('#modelSearch').addEventListener('input', (e) => renderModelList(e.target.value));

// panel sheet
$('#menuBtn').onclick = () => { loadTools(); loadSettings(); $('#panelSheet').classList.remove('hidden'); };
$('#panelClose').onclick = closeSheets;
$('#tempSlider').addEventListener('input', (e) => { state.temperature = parseFloat(e.target.value); $('#tempVal').textContent = e.target.value; });
$('#stepsSlider').addEventListener('input', (e) => { state.maxSteps = parseInt(e.target.value, 10); $('#stepsVal').textContent = e.target.value; });
$('#stopBtn').onclick = () => { state.agentAbort?.abort(); };
$('#permBadge').onclick = () => { loadTools(); loadSettings(); $('#panelSheet').classList.remove('hidden'); };
document.querySelectorAll('.perm-btn').forEach((b) => (b.onclick = () => saveSettings({ mode: b.dataset.perm })));
document.querySelectorAll('.chip-btn[data-scope]').forEach((b) => (b.onclick = () => { const sc = b.dataset.scope === '__home' ? state.perm.home : b.dataset.scope; saveSettings({ scope: sc }); }));
$('#scopeSave').onclick = () => saveSettings({ scope: $('#scopeInput').value.trim() });

// chats sheet
$('#chatsBtn').onclick = () => { loadChats(); $('#chatsSheet').classList.remove('hidden'); };
$('#chatsClose').onclick = closeSheets;
document.querySelectorAll('.hist-tab').forEach((b) => {
  b.onclick = () => {
    document.querySelectorAll('.hist-tab').forEach((x) => x.classList.remove('active'));
    b.classList.add('active');
    state.histTab = b.dataset.htab;
    renderChats();
  };
});
$('#logoutBtn').onclick = async () => { await fetch('/api/logout', { method: 'POST' }); location.href = '/'; };

// skills sheet
$('#browseSkillsBtn').onclick = () => { $('#skillsSearch').value = ''; loadSkills(); $('#skillsSheet').classList.remove('hidden'); };
$('#skillsClose').onclick = closeSheets;
let skillsT;
$('#skillsSearch').addEventListener('input', (e) => { clearTimeout(skillsT); skillsT = setTimeout(() => loadSkills(e.target.value), 200); });

$('#newBtn').onclick = () => {
  if (state.streaming) return;
  state.history = []; state.convId = null; state.convHasAgent = false; clearAttachment();
  messagesEl.innerHTML = '<div class="empty" id="emptyState"><div class="logo">▚ AgentOS</div><p>New session. Chat or switch to <b>Agent</b> mode for tools &amp; web search.</p></div>';
};

document.querySelectorAll('.sheet').forEach((sh) => sh.addEventListener('click', (e) => { if (e.target === sh) closeSheets(); }));

loadModels();
loadSettings();
