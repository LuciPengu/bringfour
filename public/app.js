/* bringfour dashboard — vanilla JS, hash routing, one shared server data layer. */
'use strict';

const TYPE_COLORS = {
  normal: '#9fa19f', fire: '#e62829', water: '#2980ef', electric: '#fac000',
  grass: '#3fa129', ice: '#3fd8ff', fighting: '#ff8000', poison: '#9141cb',
  ground: '#915121', flying: '#81b9ef', psychic: '#ef4179', bug: '#91a119',
  rock: '#afa981', ghost: '#704170', dragon: '#5060e1', dark: '#50413f',
  steel: '#60a1b8', fairy: '#ef70ef',
};

const NATURES = ['Adamant','Bashful','Bold','Brave','Calm','Careful','Docile','Gentle','Hardy','Hasty','Impish','Jolly','Lax','Lonely','Mild','Modest','Naive','Naughty','Quiet','Quirky','Rash','Relaxed','Sassy','Serious','Timid'];
const STAT_KEYS = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
const STAT_LABELS = { hp: 'HP', atk: 'Atk', def: 'Def', spa: 'SpA', spd: 'SpD', spe: 'Spe' };

const state = {
  config: null,
  format: null,           // current format id
  formatInfo: null,       // {label, evScale, teraAllowed} from last meta fetch
  meta: new Map(),        // formatId -> meta payload
  species: [],
  teams: [],
  threat: { teamName: null, topN: 20, report: null, running: false },
  calc: {
    attacker: { species: '', assumed: new Set(['item', 'ability', 'nature', 'evs']), detail: null },
    defender: { species: '', assumed: new Set(['item', 'ability', 'nature', 'evs']), detail: null },
    move: '', moveAssumed: true,
    field: {},
    result: null, running: false,
  },
};

const $view = document.getElementById('view');
const $badge = document.getElementById('source-badge');
const $format = document.getElementById('format-select');

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

async function api(path, opts) {
  const res = await fetch(path, opts && {
    method: opts.method ?? 'POST',
    headers: { 'content-type': 'application/json' },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function spriteImg(id, cls = 'sprite') {
  return `<img class="${cls}" src="/sprites/${esc(id)}.png" alt="" onerror="this.style.visibility='hidden'">`;
}

function typeBadges(types) {
  return (types ?? []).map((t) => {
    const key = String(t).toLowerCase();
    return `<span class="type" style="background:${TYPE_COLORS[key] ?? '#555'}">${esc(t)}</span>`;
  }).join('');
}

function koBadge(category, short = false) {
  const cls = {
    'guaranteed OHKO': 'ohko', 'possible OHKO': 'pohko',
    'guaranteed 2HKO': 'g2hko', 'possible 2HKO': 'p2hko', '3HKO or worse': 'safe',
  }[category] ?? 'safe';
  const compact = {
    'guaranteed OHKO': 'OHKO', 'possible OHKO': 'OHKO?',
    'guaranteed 2HKO': '2HKO', 'possible 2HKO': '2HKO?', '3HKO or worse': '3HKO+',
  }[category] ?? category;
  return `<span class="ko ${cls}" title="${esc(category)}">${esc(short ? compact : category)}</span>`;
}

function usageBar(percent, label) {
  const width = Math.max(0, Math.min(100, percent ?? 0));
  return `<div class="bar"><i style="width:${width}%"></i><b>${esc(label ?? `${percent}%`)}</b></div>`;
}

/**
 * The signature mark: damage as a depleting HP bar.
 * Solid fill = HP guaranteed to remain (worst roll), hatched slice = the
 * min–max uncertainty zone. Fill color follows the in-game rule for the
 * worst-case remaining HP: >50% green, >20% yellow, else red.
 */
function hpBar(minPercent, maxPercent, large = false) {
  const remainMin = Math.max(0, 100 - maxPercent); // worst case
  const remainMax = Math.max(0, 100 - minPercent); // best case
  const color = remainMin > 50 ? 'var(--hp)' : remainMin > 20 ? 'var(--warn)' : 'var(--critical)';
  return `<div class="hpbar${large ? ' lg' : ''}">
    <div class="hp-frame">
      <i class="hp-left" data-w="${remainMin}" style="width:100%;background:${color}"></i>
      <i class="hp-range" data-l="${remainMin}" data-w="${remainMax - remainMin}"
         style="left:100%;width:${Math.max(0, remainMax - remainMin)}%;color:${color}"></i>
    </div>
    <b>${minPercent}–${maxPercent}%</b>
  </div>`;
}

/** Kicks off the HP-drain animation for bars just inserted into the DOM. */
function animateHpBars() {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    document.querySelectorAll('.hp-frame .hp-left[data-w]').forEach((el) => { el.style.width = `${el.dataset.w}%`; });
    document.querySelectorAll('.hp-frame .hp-range[data-l]').forEach((el) => { el.style.left = `${el.dataset.l}%`; });
  }));
}

function evString(evs, evScale) {
  const max = evScale === 'champions' ? 32 : 252;
  return STAT_KEYS.filter((k) => evs[k]).map((k) => `${evs[k]} ${STAT_LABELS[k]}`).join(' / ') || `0 EVs (max ${max}/stat)`;
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// ---------------------------------------------------------------------------
// header: format switcher, source badge, refresh
// ---------------------------------------------------------------------------

async function loadMeta(refresh = false) {
  const q = `format=${encodeURIComponent(state.format)}${refresh ? '&refresh=1' : ''}`;
  const data = await api(`/api/meta?${q}`);
  state.meta.set(state.format, data);
  state.formatInfo = data.format;
  $badge.innerHTML = `<b>${esc(data.source)}</b> · ${esc(data.month)} · rating ${esc(data.rating)}`;
  $badge.title = data.attribution;
  return data;
}

function initHeader() {
  $format.innerHTML = state.config.formats
    .map((f) => `<option value="${esc(f.id)}">${esc(f.label)}</option>`)
    .join('');
  $format.value = state.format;
  $format.addEventListener('change', async () => {
    state.format = $format.value;
    state.threat.report = null;
    state.calc.result = null;
    state.calc.attacker.detail = state.calc.defender.detail = null;
    try { await loadMeta(); } catch (e) { $badge.textContent = 'no data'; }
    route();
  });
  document.getElementById('refresh-btn').addEventListener('click', async (ev) => {
    ev.target.disabled = true;
    ev.target.textContent = 'Refreshing…';
    try { await loadMeta(true); route(); }
    catch (e) { alertBar(e.message); }
    finally { ev.target.disabled = false; ev.target.textContent = '↻ Refresh data'; }
  });
}

function alertBar(msg) {
  $view.insertAdjacentHTML('afterbegin', `<div class="error">${esc(msg)}</div>`);
}

// ---------------------------------------------------------------------------
// router
// ---------------------------------------------------------------------------

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '') || 'threats';
  const [pathPart, queryPart] = raw.split('?');
  const segments = pathPart.split('/').filter(Boolean);
  const params = new URLSearchParams(queryPart ?? '');
  return { segments, params };
}

function route() {
  const { segments, params } = parseHash();
  const name = segments[0] || 'threats';
  document.querySelectorAll('#nav a').forEach((a) => {
    a.classList.toggle('active', a.dataset.route === name || (name === 'pokemon' && a.dataset.route === 'meta'));
  });
  if (name === 'meta') return renderMeta();
  if (name === 'pokemon' && segments[1]) return renderPokemon(decodeURIComponent(segments[1]));
  if (name === 'teams') return renderTeams();
  if (name === 'calc') return renderCalc(params);
  return renderThreats();
}

window.addEventListener('hashchange', route);

// ---------------------------------------------------------------------------
// view: meta browser
// ---------------------------------------------------------------------------

let metaSort = { key: 'rank', dir: 1 };

async function renderMeta() {
  $view.innerHTML = '<h2>Meta</h2><div class="sub">Loading usage data…</div>';
  let data = state.meta.get(state.format);
  try { if (!data) data = await loadMeta(); }
  catch (e) { $view.innerHTML = `<h2>Meta</h2><div class="error">${esc(e.message)}</div>`; return; }

  const entries = [...data.entries].sort((a, b) => {
    const av = a[metaSort.key] ?? -Infinity, bv = b[metaSort.key] ?? -Infinity;
    return (av < bv ? -1 : av > bv ? 1 : 0) * metaSort.dir;
  });
  const maxUsage = Math.max(...data.entries.map((e) => e.usagePercent ?? 0), 1);
  // In-game Champions data ranks without usage %; drop the empty column there.
  const hasUsage = data.entries.some((e) => e.usagePercent != null);

  const cols = [
    ['rank', '#'], ['name', 'Pokemon'],
    ...(hasUsage ? [['usagePercent', 'Usage']] : []),
    ['winPercent', 'Win %'], ['games', 'Games'],
  ];
  $view.innerHTML = `
    <h2>Meta — ${esc(data.format.label)}</h2>
    <div class="sub">${esc(data.source)} · ${esc(data.month)} · click a row for the deep-dive</div>
    <table>
      <thead><tr>${cols.map(([k, label]) =>
        `<th class="${metaSort.key === k ? 'sorted' : ''} ${k !== 'name' ? 'num' : ''}" data-key="${k}">${label}${metaSort.key === k ? (metaSort.dir === 1 ? ' ↑' : ' ↓') : ''}</th>`).join('')}
      </tr></thead>
      <tbody>
        ${entries.map((e) => `
          <tr class="rowlink" data-name="${esc(e.name)}">
            <td class="num">${e.rank}</td>
            <td><span class="mon">${spriteImg(e.sprite)}${esc(e.name)}</span></td>
            ${hasUsage ? `<td class="num" style="width:200px">${e.usagePercent != null ? usageBar((e.usagePercent / maxUsage) * 100, `${e.usagePercent.toFixed(1)}%`) : '<span class="sub">—</span>'}</td>` : ''}
            <td class="num">${e.winPercent != null ? e.winPercent.toFixed(1) + '%' : '—'}</td>
            <td class="num">${e.games != null ? e.games.toLocaleString() : '—'}</td>
          </tr>`).join('')}
      </tbody>
    </table>
    <div class="attribution">${esc(data.attribution)}</div>`;

  $view.querySelectorAll('th').forEach((th) => th.addEventListener('click', () => {
    const key = th.dataset.key;
    metaSort = { key, dir: metaSort.key === key ? -metaSort.dir : key === 'rank' || key === 'name' ? 1 : -1 };
    renderMeta();
  }));
  $view.querySelectorAll('tr.rowlink').forEach((tr) =>
    tr.addEventListener('click', () => { location.hash = `#/pokemon/${encodeURIComponent(tr.dataset.name)}`; }));
}

// ---------------------------------------------------------------------------
// view: pokemon deep-dive
// ---------------------------------------------------------------------------

function shareTable(rows, opts = {}) {
  if (!rows?.length) return '<div class="sub">no data</div>';
  const max = Math.max(...rows.map((r) => r.percent ?? 0), 1);
  return `<table>${rows.slice(0, opts.limit ?? 12).map((r) => `
    <tr${opts.link ? ` class="rowlink" data-name="${esc(r.name)}"` : ''}>
      <td style="width:45%"><span class="mon">${r.sprite ? spriteImg(r.sprite) : ''}${esc(r.name)}</span></td>
      <td>${r.percent != null ? usageBar((r.percent / max) * 100, `${r.percent.toFixed(1)}%`) : '<span class="sub">ranked</span>'}</td>
    </tr>`).join('')}</table>`;
}

async function renderPokemon(name) {
  $view.innerHTML = `<h2>${esc(name)}</h2><div class="sub">Loading…</div>`;
  let d;
  try { d = await api(`/api/pokemon/${encodeURIComponent(name)}?format=${encodeURIComponent(state.format)}`); }
  catch (e) { $view.innerHTML = `<h2>${esc(name)}</h2><div class="error">${esc(e.message)}</div>`; return; }

  const evScale = d.format.evScale;
  const spreadRows = (d.spreads ?? []).slice(0, 8).map((s) => ({
    name: `${s.nature ?? '—'} ${STAT_KEYS.map((k) => s.evs[k]).join('/')}`,
    percent: s.percent,
  }));

  $view.innerHTML = `
    <div class="card" style="max-width:680px">
      <div class="head">
        ${spriteImg(d.sprite, 'sprite lg')}
        <div class="grow">
          <div class="title" style="font-size:20px">${esc(d.name)}</div>
          <div>${typeBadges(d.types)}</div>
          <div class="meta-line">
            ${d.rank ? `rank #${d.rank}` : ''} ${d.usagePercent != null ? `· ${d.usagePercent}% usage` : ''}
            ${d.winPercent != null ? `· ${d.winPercent}% win` : ''}
          </div>
        </div>
        <button id="dd-atk">Calc as attacker</button>
        <button id="dd-def">Calc as defender</button>
      </div>
      ${(d.notes ?? []).map((n) => `<div class="notice">${esc(n)}</div>`).join('')}
    </div>
    <div class="cards" style="margin-top:14px">
      <div class="card"><h3>Items</h3>${shareTable(d.items)}</div>
      <div class="card"><h3>Moves</h3>${shareTable(d.moves)}</div>
      <div class="card"><h3>Abilities</h3>${shareTable(d.abilities)}
        <h3>Natures</h3>${shareTable(d.natures, { limit: 5 })}</div>
      <div class="card"><h3>Spreads (${evScale === 'champions' ? '0–32 units' : 'EVs'})</h3>${shareTable(spreadRows)}</div>
      ${d.format.teraAllowed ? `<div class="card"><h3>Tera types</h3>${shareTable(d.teraTypes)}</div>` : ''}
      <div class="card"><h3>Teammates</h3>${shareTable(d.teammates, { link: true })}</div>
    </div>
    <div class="attribution">${esc(d.attribution)}</div>`;

  document.getElementById('dd-atk').addEventListener('click', () => { location.hash = `#/calc?attacker=${encodeURIComponent(d.name)}`; });
  document.getElementById('dd-def').addEventListener('click', () => { location.hash = `#/calc?defender=${encodeURIComponent(d.name)}`; });
  $view.querySelectorAll('tr.rowlink').forEach((tr) =>
    tr.addEventListener('click', () => { location.hash = `#/pokemon/${encodeURIComponent(tr.dataset.name)}`; }));
}

// ---------------------------------------------------------------------------
// view: teams
// ---------------------------------------------------------------------------

async function refreshTeams() {
  state.teams = await api('/api/teams');
}

async function renderTeams() {
  $view.innerHTML = '<h2>Teams</h2><div class="sub">Loading…</div>';
  try { await refreshTeams(); }
  catch (e) { $view.innerHTML = `<h2>Teams</h2><div class="error">${esc(e.message)}</div>`; return; }

  $view.innerHTML = `
    <h2>Teams</h2>
    <div class="sub">Plain Showdown pastes stored in <code>teams/</code> — edit here or in your editor.</div>
    <div class="formrow">
      <input type="url" id="imp-url" placeholder="https://pokepast.es/…" style="width:320px">
      <input type="text" id="imp-name" placeholder="team name" style="width:160px">
      <button id="imp-btn" class="primary">Import from pokepaste</button>
      <span class="spacer"></span>
      <button id="new-btn">+ New team</button>
    </div>
    <div id="team-list" class="cards" style="grid-template-columns: 1fr;"></div>`;

  const $list = document.getElementById('team-list');

  const editorCard = (t) => `
    <div class="card teamcard" data-name="${esc(t?.name ?? '')}">
      <div class="head">
        <div class="grow">
          <div class="title">${t ? esc(t.name) : 'New team'}</div>
          <div class="sprites-row">${t ? t.sprites.map((s) => spriteImg(s)).join('') : ''}</div>
        </div>
        ${t ? `<button class="analyze-btn">Threat-check</button>` : ''}
        <button class="edit-btn">${t ? 'Edit' : 'Cancel'}</button>
        ${t ? '<button class="del-btn">Delete</button>' : ''}
      </div>
      <div class="pastebox">
        ${t ? '' : `<div class="formrow"><input type="text" class="name-input" placeholder="team name" style="width:220px"></div>`}
        <textarea class="paste-input" placeholder="Paste a Showdown export here…">${esc(t?.paste ?? '')}</textarea>
        <div class="formrow"><button class="save-btn primary">Save</button><span class="save-msg sub"></span></div>
      </div>
    </div>`;

  const wireCard = ($card) => {
    const name = $card.dataset.name;
    $card.querySelector('.edit-btn').addEventListener('click', () => {
      if (!name) { $card.remove(); return; }
      $card.classList.toggle('open');
    });
    $card.querySelector('.save-btn').addEventListener('click', async () => {
      const saveName = name || $card.querySelector('.name-input')?.value?.trim();
      const paste = $card.querySelector('.paste-input').value;
      const $msg = $card.querySelector('.save-msg');
      if (!saveName) { $msg.textContent = 'Name required.'; return; }
      try {
        await api(`/api/teams/${encodeURIComponent(saveName)}`, { method: 'PUT', body: { paste } });
        renderTeams();
      } catch (e) { $msg.textContent = e.message; }
    });
    $card.querySelector('.analyze-btn')?.addEventListener('click', () => {
      state.threat.teamName = name;
      state.threat.report = null;
      location.hash = '#/threats';
    });
    const $del = $card.querySelector('.del-btn');
    $del?.addEventListener('click', async () => {
      if (!$del.classList.contains('danger-armed')) {
        $del.classList.add('danger-armed');
        $del.textContent = 'Really delete?';
        setTimeout(() => { $del.classList.remove('danger-armed'); $del.textContent = 'Delete'; }, 2500);
        return;
      }
      await api(`/api/teams/${encodeURIComponent(name)}`, { method: 'DELETE', body: undefined });
      renderTeams();
    });
  };

  $list.innerHTML = state.teams.length
    ? state.teams.map(editorCard).join('')
    : '<div class="sub">No teams yet — create or import one.</div>';
  $list.querySelectorAll('.teamcard').forEach(wireCard);

  document.getElementById('new-btn').addEventListener('click', () => {
    $list.insertAdjacentHTML('afterbegin', editorCard(null));
    const $card = $list.querySelector('.teamcard');
    $card.classList.add('open');
    wireCard($card);
  });

  document.getElementById('imp-btn').addEventListener('click', async (ev) => {
    const url = document.getElementById('imp-url').value.trim();
    const name = document.getElementById('imp-name').value.trim();
    ev.target.disabled = true;
    try {
      await api('/api/teams/import', { body: { url, name } });
      renderTeams();
    } catch (e) { alertBar(e.message); ev.target.disabled = false; }
  });
}

// ---------------------------------------------------------------------------
// view: threats
// ---------------------------------------------------------------------------

async function renderThreats() {
  if (!state.teams.length) { try { await refreshTeams(); } catch {} }
  const t = state.threat;
  if (!t.teamName && state.teams.length) t.teamName = state.teams[0].name;

  $view.innerHTML = `
    <h2>Threat analysis</h2>
    <div class="sub">Top meta Pokemon at their most common sets, real damage calcs into your actual spreads.</div>
    <div class="formrow">
      <select id="th-team">${state.teams.map((x) => `<option ${x.name === t.teamName ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>
      <select id="th-topn">${[10, 20, 30].map((n) => `<option ${n === t.topN ? 'selected' : ''}>${n}</option>`).join('')}</select>
      <button id="th-run" class="primary" ${t.running || !state.teams.length ? 'disabled' : ''}>${t.running ? 'Analyzing…' : 'Analyze'}</button>
      ${!state.teams.length ? '<span class="sub">Save a team first (Teams tab).</span>' : ''}
    </div>
    <div id="th-out">${t.report ? '' : '<div class="sub">Run an analysis to see the report.</div>'}</div>`;

  document.getElementById('th-team').addEventListener('change', (e) => { t.teamName = e.target.value; });
  document.getElementById('th-topn').addEventListener('change', (e) => { t.topN = Number(e.target.value); });
  document.getElementById('th-run').addEventListener('click', runThreats);
  if (t.report) drawThreatReport(t.report);
}

async function runThreats() {
  const t = state.threat;
  t.running = true;
  renderThreats();
  try {
    t.report = await api('/api/analyze', { body: { team_name: t.teamName, format: state.format, top_n: t.topN } });
  } catch (e) {
    t.report = null;
    t.running = false;
    renderThreats();
    alertBar(e.message);
    return;
  }
  t.running = false;
  renderThreats();
}

function drawThreatReport(r) {
  const out = document.getElementById('th-out');
  const ts = r.teamSpeed;
  const memberSprites = Object.fromEntries(r.team.map((m) => [m.species, m.sprite]));

  out.innerHTML = `
    <div style="margin:10px 0">
      <span class="chip">team <b>${r.team.map((m) => esc(m.species)).join(', ')}</b></span>
      <span class="chip">${ts.threatCount} threats checked</span>
      <span class="chip ${ts.hasTailwind ? 'on' : ''}">Tailwind: ${ts.hasTailwind ? 'yes' : 'no'}</span>
      <span class="chip ${ts.hasTrickRoom ? 'on' : ''}">Trick Room: ${ts.hasTrickRoom ? 'yes' : 'no'}</span>
      <span class="chip ${ts.underspeedCount > ts.teamSize / 2 ? 'warn' : ''}">${ts.underspeedCount}/${ts.teamSize} outsped by most threats</span>
    </div>
    ${r.assumptions.map((a) => `<div class="notice">${esc(a)}</div>`).join('')}
    <h3>Threats, most dangerous first</h3>
    <div class="cards" id="th-cards"></div>
    <h3>Speed ladder</h3>
    <div class="ladder">
      ${r.speedTiers.map((row) => `
        <div class="lrow ${row.side}">
          <span class="spd">${row.speed}</span>
          ${spriteImg(row.side === 'team' ? memberSprites[row.name] ?? '' : (r.threats.find((x) => x.name === row.name)?.sprite ?? ''), '')}
          <span>${esc(row.name)}</span>
          <span class="tag">${row.side === 'team' ? 'your team' : 'meta'}</span>
        </div>`).join('')}
    </div>
    ${r.skipped.length ? `<h3>Skipped</h3><div class="sub">${r.skipped.map((s) => `${esc(s.name)} (${esc(s.reason)})`).join(' · ')}</div>` : ''}
    <div class="attribution">${esc(r.attribution)}</div>`;

  document.getElementById('th-cards').innerHTML = r.threats.map((th) => `
    <div class="card">
      <div class="head">
        ${spriteImg(th.sprite)}
        <div class="grow">
          <div class="title">${esc(th.name)}</div>
          <div class="meta-line">
            ${th.rank ? `#${th.rank}` : ''} ${th.usagePercent != null ? `· ${th.usagePercent}%` : ''}
            · Spe ${th.speed.stat ?? '?'}${th.speed.outspeeds.length ? ` (outspeeds ${th.speed.outspeeds.length})` : ''}
            ${th.speed.speedControl.length ? ` · <span style="color:var(--warning)">${th.speed.speedControl.map(esc).join(', ')}</span>` : ''}
          </div>
        </div>
        <span class="score-pill" title="Threat score">${th.score.toFixed(1)}</span>
      </div>
      <div class="setline">${esc(th.set.item ?? 'no item')} · ${esc(th.set.ability ?? '?')} · ${esc(th.set.nature)}</div>
      ${th.vs.map((v) => `
        <div class="vsrow">
          <span class="who">${spriteImg(memberSprites[v.member] ?? '', '')}${esc(v.member)}</span>
          <span class="mv" title="${esc(v.bestMove)}">${esc(v.bestMove)}</span>
          ${hpBar(v.minPercent, v.maxPercent)}
          ${koBadge(v.category, true)}
        </div>`).join('')}
    </div>`).join('');
  animateHpBars();
}

// ---------------------------------------------------------------------------
// view: calc
// ---------------------------------------------------------------------------

function calcPanel(role) {
  const evScale = state.formatInfo?.evScale ?? 'champions';
  const evMax = evScale === 'champions' ? 32 : 252;
  return `
    <div class="panel" data-role="${role}">
      <h4>${role}</h4>
      <div class="field"><label>Species</label>
        <input type="text" class="sp" list="species-list" placeholder="e.g. Garchomp" autocomplete="off"></div>
      <div class="field"><label>Item</label><input type="text" class="item assumed" list="items-${role}"></div>
      <div class="field"><label>Ability</label><input type="text" class="ability assumed" list="abilities-${role}"></div>
      <div class="field"><label>Nature</label><input type="text" class="nature assumed" list="natures-list"></div>
      <div class="field"><label>EVs (${evScale === 'champions' ? 'Champions units, 0–32' : '0–252'})</label>
        <div class="evgrid">
          ${STAT_KEYS.map((k) => `<span><label>${STAT_LABELS[k]}</label><input type="number" class="ev assumed" data-stat="${k}" min="0" max="${evMax}" value="0"></span>`).join('')}
        </div></div>
      <datalist id="items-${role}"></datalist>
      <datalist id="abilities-${role}"></datalist>
    </div>`;
}

async function renderCalc(params) {
  const c = state.calc;
  if (params?.get('attacker')) { c.attacker.species = params.get('attacker'); c.attacker.assumed = new Set(['item','ability','nature','evs']); c.attacker.detail = null; c.moveAssumed = true; }
  if (params?.get('defender')) { c.defender.species = params.get('defender'); c.defender.assumed = new Set(['item','ability','nature','evs']); c.defender.detail = null; }

  $view.innerHTML = `
    <h2>Damage calc</h2>
    <div class="sub">Grayed-italic fields are assumed from meta data — type in one to take it over. Doubles field by default.</div>
    <datalist id="species-list">${state.species.map((s) => `<option>${esc(s)}</option>`).join('')}</datalist>
    <datalist id="natures-list">${NATURES.map((n) => `<option>${n}</option>`).join('')}</datalist>
    <datalist id="moves-list"></datalist>
    <div class="calc-grid">
      ${calcPanel('attacker')}
      <div class="swap"><span class="vs">VS</span><button id="swap-btn" title="Swap attacker and defender">⇄</button></div>
      ${calcPanel('defender')}
    </div>
    <div class="formrow" style="margin-top:12px">
      <label class="inline">Move <input type="text" id="calc-move" list="moves-list" style="width:180px"></label>
      <label class="inline">Weather
        <select id="f-weather"><option value="">—</option><option>Sun</option><option>Rain</option><option>Sand</option><option>Snow</option></select></label>
      <label class="inline">Terrain
        <select id="f-terrain"><option value="">—</option><option>Electric</option><option>Grassy</option><option>Psychic</option><option>Misty</option></select></label>
      <label class="inline"><input type="checkbox" id="f-single"> single target</label>
      <label class="inline"><input type="checkbox" id="f-hh"> Helping Hand</label>
      <label class="inline"><input type="checkbox" id="f-reflect"> Reflect</label>
      <label class="inline"><input type="checkbox" id="f-ls"> Light Screen</label>
    </div>
    <div id="calc-out"></div>`;

  const debouncedRun = debounce(runCalcView, 350);

  for (const role of ['attacker', 'defender']) {
    const $panel = $view.querySelector(`.panel[data-role="${role}"]`);
    const side = c[role];
    $panel.querySelector('.sp').value = side.species;

    $panel.querySelector('.sp').addEventListener('change', async (e) => {
      side.species = e.target.value.trim();
      side.assumed = new Set(['item', 'ability', 'nature', 'evs']);
      side.detail = null;
      if (role === 'attacker') c.moveAssumed = true;
      await prefillSide(role);
      debouncedRun();
    });
    for (const cls of ['item', 'ability', 'nature']) {
      $panel.querySelector(`.${cls}`).addEventListener('input', (e) => {
        side.assumed.delete(cls);
        e.target.classList.remove('assumed');
        debouncedRun();
      });
    }
    $panel.querySelectorAll('.ev').forEach(($ev) => $ev.addEventListener('input', () => {
      side.assumed.delete('evs');
      $panel.querySelectorAll('.ev').forEach((x) => x.classList.remove('assumed'));
      debouncedRun();
    }));
  }

  document.getElementById('calc-move').addEventListener('input', () => { c.moveAssumed = false; debouncedRun(); });
  for (const id of ['f-weather', 'f-terrain', 'f-single', 'f-hh', 'f-reflect', 'f-ls']) {
    document.getElementById(id).addEventListener('change', debouncedRun);
  }
  document.getElementById('swap-btn').addEventListener('click', async () => {
    [c.attacker, c.defender] = [c.defender, c.attacker];
    c.moveAssumed = true;
    renderCalc();
  });

  if (c.attacker.species) await prefillSide('attacker');
  if (c.defender.species) await prefillSide('defender');
  if (c.attacker.species && c.defender.species) runCalcView();
}

async function prefillSide(role) {
  const c = state.calc;
  const side = c[role];
  const $panel = $view.querySelector(`.panel[data-role="${role}"]`);
  if (!side.species || !$panel) return;
  try {
    side.detail = await api(`/api/pokemon/${encodeURIComponent(side.species)}?format=${encodeURIComponent(state.format)}`);
  } catch {
    side.detail = null;
  }
  const d = side.detail;
  const setVal = (cls, value) => {
    const $el = $panel.querySelector(`.${cls}`);
    if (side.assumed.has(cls)) { $el.value = value ?? ''; $el.classList.add('assumed'); }
  };
  setVal('item', d?.items?.[0]?.name);
  setVal('ability', d?.abilities?.[0]?.name);
  setVal('nature', d?.spreads?.[0]?.nature ?? d?.natures?.[0]?.name);
  if (side.assumed.has('evs')) {
    const evs = d?.spreads?.[0]?.evs ?? {};
    $panel.querySelectorAll('.ev').forEach(($ev) => {
      $ev.value = evs[$ev.dataset.stat] ?? 0;
      $ev.classList.add('assumed');
    });
  }
  if (role === 'attacker') {
    const moves = (d?.moves ?? []).map((m) => m.name);
    document.getElementById('moves-list').innerHTML = moves.map((m) => `<option>${esc(m)}</option>`).join('');
    const $move = document.getElementById('calc-move');
    if (c.moveAssumed && moves.length) { $move.value = moves[0]; }
  }
}

function readSide(role) {
  const c = state.calc;
  const side = c[role];
  const $panel = $view.querySelector(`.panel[data-role="${role}"]`);
  const input = { species: side.species };
  // Fields still marked "assumed" are omitted — the server fills them and
  // echoes the assumption, exactly like the MCP tool.
  if (!side.assumed.has('item')) input.item = $panel.querySelector('.item').value.trim() || undefined;
  if (!side.assumed.has('ability')) input.ability = $panel.querySelector('.ability').value.trim() || undefined;
  if (!side.assumed.has('nature')) input.nature = $panel.querySelector('.nature').value.trim() || undefined;
  if (!side.assumed.has('evs')) {
    input.evs = {};
    $panel.querySelectorAll('.ev').forEach(($ev) => { input.evs[$ev.dataset.stat] = Number($ev.value) || 0; });
  }
  return input;
}

async function runCalcView() {
  const c = state.calc;
  const move = document.getElementById('calc-move')?.value.trim();
  const $out = document.getElementById('calc-out');
  if (!c.attacker.species || !c.defender.species || !move || !$out) return;
  $out.innerHTML = '<div class="sub" style="margin-top:12px">Calculating…</div>';
  let r;
  try {
    r = await api('/api/calc', {
      body: {
        attacker: readSide('attacker'), defender: readSide('defender'), move,
        format: state.format,
        field: {
          weather: document.getElementById('f-weather').value || undefined,
          terrain: document.getElementById('f-terrain').value || undefined,
          singleTarget: document.getElementById('f-single').checked || undefined,
          attackerHelpingHand: document.getElementById('f-hh').checked || undefined,
          defenderReflect: document.getElementById('f-reflect').checked || undefined,
          defenderLightScreen: document.getElementById('f-ls').checked || undefined,
        },
      },
    });
  } catch (e) { $out.innerHTML = `<div class="error">${esc(e.message)}</div>`; return; }

  if (!r.ok) { $out.innerHTML = `<div class="error">${esc(r.error)}</div>`; return; }
  const category =
    r.damage.minPercent >= 100 ? 'guaranteed OHKO' : r.damage.maxPercent >= 100 ? 'possible OHKO'
    : r.damage.minPercent >= 50 ? 'guaranteed 2HKO' : r.damage.maxPercent >= 50 ? 'possible 2HKO' : '3HKO or worse';
  $out.innerHTML = `
    <div class="result">
      <div class="big">${r.damage.minPercent}% – ${r.damage.maxPercent}% ${koBadge(category)}</div>
      <div class="desc">${esc(r.description)}</div>
      ${hpBar(r.damage.minPercent, r.damage.maxPercent, true)}
      ${r.koChance && !r.description?.includes(r.koChance) ? `<div class="desc">${esc(r.koChance)}</div>` : ''}
      ${r.assumptions.length ? `<ul class="assumptions">${r.assumptions.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>` : ''}
      <div class="attribution">${esc(r.attribution)}</div>
    </div>`;
  animateHpBars();
}

// ---------------------------------------------------------------------------
// boot
// ---------------------------------------------------------------------------

(async function boot() {
  try {
    state.config = await api('/api/config');
    state.format = state.config.defaultFormat;
    initHeader();
    api('/api/species').then((s) => { state.species = s; }).catch(() => {});
    loadMeta().catch(() => { $badge.textContent = 'no data yet'; });
    route();
  } catch (e) {
    $view.innerHTML = `<div class="error">Failed to reach the local server: ${esc(e.message)}</div>`;
  }
})();
