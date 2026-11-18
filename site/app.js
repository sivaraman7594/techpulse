'use strict';

const DATA = 'data/';
const PAGE = 30;
const CHECK_EVERY_MS = 5 * 60 * 1000;
const $ = (s, el = document) => el.querySelector(s);

const store = {
  get(k, d) { try { const v = localStorage.getItem('tp.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('tp.' + k, JSON.stringify(v)); } catch { /* private mode */ } },
};

const OPP_KINDS = [
  ['all', 'All'], ['hackathon', 'Hackathons'], ['conference', 'Conferences'], ['cfp', 'Call for speakers'],
  ['open-source', 'Open source'], ['program', 'Programs & fellowships'], ['learning', 'Free learning'],
  ['competition', 'Competitions'],
];
const JOB_REGIONS = [['all', 'All'], ['match', 'Matches me'], ['india', 'India'], ['remote', 'Remote'], ['global', 'Global']];
const DOTNET_FILTERS = [['all', 'All'], ['net', '.NET & C#'], ['azure', 'Azure'], ['releases', 'Releases']];
const LEARN_MODES = [['interview', 'Interview'], ['scenario', 'Scenario'], ['qa', 'Top Q&A'], ['latest', 'Latest'], ['todo', 'Not known yet']];
const LEVEL_ORDER = { basic: 0, intermediate: 1, advanced: 2 };
const VIEWS = ['news', 'dotnet', 'learn', 'rising', 'jobs', 'opps', 'saved'];

const urlView = new URLSearchParams(location.search).get('view');
const state = {
  view: VIEWS.includes(urlView) ? urlView : (VIEWS.includes(store.get('view')) ? store.get('view') : 'news'),
  filter: Object.assign({ news: 'all', dotnet: 'all', learn: 'interview', jobs: 'all', opps: 'all' }, store.get('filter', {})),
  settings: Object.assign({ theme: 'auto', skills: '' }, store.get('settings', {})),
  saved: store.get('saved', {}),
  known: store.get('known', {}),
  learnTopic: store.get('learnTopic', 'csharp'),
  prevVisit: store.get('lastVisit', null),
  query: '',
  meta: null, news: [], jobs: [], opps: [], trends: [], health: [], learnIndex: null,
  learnCache: {}, openLearn: new Set(),
  newsById: new Map(),
  list: [], shown: 0, openTrend: null, lastLoad: 0,
};
store.set('lastVisit', new Date().toISOString());

// ------------------------------------------------------------------ utils

const safeUrl = u => (/^https?:\/\//i.test(u || '') ? u : '#');

function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'href') el.href = safeUrl(v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false && c !== '') el.append(c.nodeType ? c : String(c));
  return el;
}

function icon(path) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = path; // static strings only
  return svg;
}
const ICON = {
  save: '<path d="M6 3h12v18l-6-4-6 4z"/>',
  share: '<path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7M16 6l-4-4-4 4M12 2v14"/>',
  chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>',
};

function ago(iso) {
  if (!iso) return '';
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return fmtDate(iso);
}

function fmtDate(iso) {
  const d = new Date(iso);
  const opts = { day: 'numeric', month: 'short' };
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString(undefined, opts);
}

function until(iso) {
  const days = Math.ceil((Date.parse(iso) - Date.now()) / 86400000);
  if (days < 0) return 'ended';
  if (days === 0) return 'ends today';
  if (days === 1) return '1 day left';
  return `${days} days left`;
}

const itemTime = i => i.date || i.seen || '';
const isNew = i => state.prevVisit && i.seen && i.seen > state.prevVisit;

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, 2600);
}

function mySkills() {
  return state.settings.skills.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
}

// Whole-word match so "go" doesn't hit "google" and "java" doesn't hit "javascript".
const wordRx = s => new RegExp(`(^|[^a-z0-9+#])${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9+#])`);

function jobScore(j, skills) {
  if (!skills.length) return 0;
  const hay = `${j.title} | ${(j.skills || []).join(' | ')}`.toLowerCase();
  return skills.reduce((n, s) => n + (wordRx(s).test(hay) ? 1 : 0), 0);
}

function matchesQuery(i, q) {
  if (!q) return true;
  const answer = i.answer ? i.answer.map(b => b.x || '').join(' ') : '';
  const hay = [i.title, i.summary, i.source, i.company, i.location, (i.skills || []).join(' '), (i.tags || []).join(' '), i.kind, answer]
    .join(' ').toLowerCase();
  return q.split(/\s+/).every(w => hay.includes(w));
}

// ------------------------------------------------------------------ data

async function getJSON(name) {
  const r = await fetch(DATA + name, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`${name}: HTTP ${r.status}`);
  return r.json();
}

async function load({ quiet = false } = {}) {
  setStatus('Updating…');
  try {
    const meta = await getJSON('meta.json');
    if (quiet && state.meta && meta.updated === state.meta.updated) { setStatus(); return; }
    const [news, jobs, opps, trends, health, learnIndex] = await Promise.all([
      ...['news.json', 'jobs.json', 'opportunities.json', 'trends.json', 'health.json'].map(getJSON),
      getJSON('learn/index.json').catch(() => null),   // optional: older deployments have no learn data
    ]);
    const before = new Set(state.news.map(i => i.id));
    const hadData = state.news.length > 0;
    Object.assign(state, {
      meta, news: news.items, jobs: jobs.items, opps: opps.items, trends: trends.terms, health: health.sources,
      learnIndex, learnCache: {}, lastLoad: Date.now(),
    });
    state.newsById = new Map(state.news.map(i => [i.id, i]));
    if (hadData) {
      const fresh = state.news.filter(i => !before.has(i.id)).length;
      if (fresh) toast(`${fresh} new update${fresh > 1 ? 's' : ''}`);
    }
    render();
    renderSources();
  } catch (e) {
    console.error(e);
    if (!state.news.length) {
      $('#list').replaceChildren(h('div', { class: 'empty' },
        'Could not load updates. ', navigator.onLine ? 'The first data refresh may still be running — try again in a few minutes.' : 'You are offline.'));
    }
    toast(navigator.onLine ? 'Update failed — showing saved data' : 'Offline — showing saved data');
  }
  setStatus();
}

function setStatus(text) {
  const m = state.meta;
  $('#status').textContent = text || (m
    ? `Updated ${ago(m.updated)} · ${m.sources.ok}/${m.sources.total} sources live`
    : 'Loading…');
}

// ------------------------------------------------------------------ lists

function buildList() {
  const q = state.query.trim().toLowerCase();
  const f = state.filter[state.view];
  let list;
  switch (state.view) {
    case 'news': {
      list = state.news;
      if (f === 'top') {
        const cut = new Date(Date.now() - 36 * 3600e3).toISOString();
        const score = i => i.weight * 2 + Math.log10(1 + (i.points || 0)) * 2 + (i.also || []).length * 2;
        list = list.filter(i => itemTime(i) >= cut).sort((a, b) => score(b) - score(a));
      } else if (f !== 'all') {
        list = list.filter(i => (i.tags || []).includes(f));
      }
      break;
    }
    case 'dotnet': {
      list = state.news.filter(i => (i.tags || []).includes('dotnet'));
      if (f === 'azure') list = list.filter(i => /azure/i.test(`${i.title} ${i.summary}`));
      else if (f === 'net') list = list.filter(i => !/azure/i.test(i.title));
      else if (f === 'releases') list = list.filter(i => i.release);
      break;
    }
    case 'learn': {
      const items = state.learnCache[state.learnTopic] || [];
      const byLevel = (a, b) => (LEVEL_ORDER[a.level] ?? 1) - (LEVEL_ORDER[b.level] ?? 1);
      const byScore = (a, b) => (b.score || 0) - (a.score || 0);
      if (f === 'interview') list = items.filter(i => i.mode === 'interview').sort(byLevel);
      else if (f === 'scenario') list = items.filter(i => i.scenario).sort((a, b) =>
        (a.mode === 'interview' ? 0 : 1) - (b.mode === 'interview' ? 0 : 1) || byScore(a, b));
      else if (f === 'qa') list = items.filter(i => i.mode === 'qa').sort(byScore);
      else if (f === 'latest') list = items.filter(i => i.mode === 'latest').sort((a, b) => itemTime(b).localeCompare(itemTime(a)));
      else if (f === 'todo') list = items.filter(i => i.mode === 'interview' && !state.known[i.id]).sort(byLevel);
      else list = items;
      break;
    }
    case 'jobs': {
      const skills = mySkills();
      list = state.jobs;
      if (f === 'match') {
        list = list.map(j => [jobScore(j, skills), j]).filter(([s]) => s > 0)
          .sort((a, b) => b[0] - a[0] || itemTime(b[1]).localeCompare(itemTime(a[1]))).map(([, j]) => j);
      } else if (f !== 'all') {
        list = list.filter(j => (j.regions || []).includes(f));
      }
      break;
    }
    case 'opps': {
      list = f === 'all' ? state.opps : state.opps.filter(o => o.kind === f);
      const key = o => o.end || o.start || '';
      list = [...list].sort((a, b) => {
        const ka = key(a), kb = key(b);
        if (ka && kb) return ka.localeCompare(kb);
        if (ka || kb) return ka ? -1 : 1;
        return itemTime(b).localeCompare(itemTime(a));
      });
      break;
    }
    case 'saved':
      list = Object.values(state.saved).sort((a, b) => b.savedAt.localeCompare(a.savedAt)).map(s => s.item);
      break;
    default:
      list = [];
  }
  return q ? list.filter(i => matchesQuery(i, q)) : list;
}

function markTabs() {
  document.body.dataset.view = state.view;
  document.querySelectorAll('.tabs button').forEach(b =>
    b.setAttribute('aria-current', b.dataset.view === state.view ? 'page' : 'false'));
}

function render() {
  markTabs();
  renderChips();
  const main = $('#list');
  main.replaceChildren();
  state.list = [];
  if (state.view === 'rising') { renderTrends(main); return; }
  if (state.view === 'learn' && !state.learnCache[state.learnTopic]) {
    main.append(...Array.from({ length: 4 }, () => h('div', { class: 'skeleton' })));
    loadTopic(state.learnTopic);
    return;
  }
  if (state.view === 'dotnet') main.append(dotnetCallout());
  if (state.view === 'learn') main.append(learnNote());
  state.list = buildList();
  state.shown = 0;
  if (!state.list.length) {
    main.append(h('div', { class: 'empty' }, emptyText()));
    return;
  }
  more();
}

const learnPending = new Set();

async function loadTopic(topic) {
  if (learnPending.has(topic)) return;
  learnPending.add(topic);
  try {
    const data = await getJSON(`learn/${topic}.json`);
    state.learnCache[topic] = data.items || [];
  } catch (e) {
    console.error(e);
    state.learnCache[topic] = [];
    toast(navigator.onLine ? 'Could not load this topic yet' : 'Offline — open this topic once online to keep it');
  } finally {
    learnPending.delete(topic);
  }
  if (state.view === 'learn' && state.learnTopic === topic) render();
}

function openLearn(topic, mode) {
  state.learnTopic = topic;
  store.set('learnTopic', topic);
  state.filter.learn = mode;
  store.set('filter', state.filter);
  setView('learn');
}

function dotnetCallout() {
  return h('div', { class: 'callout' },
    h('strong', null, 'Prepare for .NET interviews'),
    h('button', { class: 'chip', onclick: () => openLearn('csharp', 'interview') }, 'C# interview ›'),
    h('button', { class: 'chip', onclick: () => openLearn('aspnet', 'interview') }, 'ASP.NET Core ›'),
    h('button', { class: 'chip', onclick: () => openLearn('azure', 'scenario') }, 'Azure scenarios ›'),
    h('button', { class: 'chip', onclick: () => openLearn('csharp', 'qa') }, 'Top C# Q&A ›'));
}

function learnNote() {
  const items = state.learnCache[state.learnTopic] || [];
  const interview = items.filter(i => i.mode === 'interview');
  const known = interview.filter(i => state.known[i.id]).length;
  const notes = {
    interview: `Curated answers checked against official docs, plus open-licensed collections. You know ${known} of ${interview.length}.`,
    scenario: '"How would you…" questions: troubleshooting, design and real-world situations.',
    qa: 'Highest-voted Stack Overflow questions with accepted answers. Tap to read the answer.',
    latest: 'Recent Stack Overflow questions (last 30 days) that already have an accepted answer.',
    todo: `Interview questions you haven't marked as known yet (${interview.length - known} left).`,
  };
  return h('p', { class: 'section-note' }, notes[state.filter.learn] || '');
}

function emptyText() {
  if (state.query) return 'Nothing matches your search.';
  if (state.view === 'saved') return 'Tap the bookmark on any item to keep it here.';
  if (state.view === 'jobs' && state.filter.jobs === 'match')
    return mySkills().length ? 'No jobs match your skills right now.' : 'Add your skills in Settings (gear icon) to see matching jobs.';
  if (state.view === 'learn') {
    if (state.filter.learn === 'todo') return 'You know every interview question here. 🎉';
    return 'Nothing here yet for this topic — it fills in after the next daily refresh.';
  }
  return state.meta ? 'Nothing here yet.' : 'Loading…';
}

function more() {
  const main = $('#list');
  const slice = state.list.slice(state.shown, state.shown + PAGE);
  for (const item of slice) main.append(card(item));
  state.shown += slice.length;
}

function chip(label, value, count) {
  const f = state.filter[state.view];
  return h('button', {
    class: 'chip', 'aria-pressed': String(f === value),
    onclick: () => { state.filter[state.view] = value; store.set('filter', state.filter); render(); window.scrollTo({ top: 0 }); },
  }, label, count != null ? h('span', { class: 'n' }, count) : null);
}

function topicChip(t) {
  const c = t.counts || {};
  return h('button', {
    class: 'chip', 'aria-pressed': String(state.learnTopic === t.id),
    onclick: () => { state.learnTopic = t.id; store.set('learnTopic', t.id); render(); window.scrollTo({ top: 0 }); },
  }, t.label, h('span', { class: 'n' }, (c.interview || 0) + (c.qa || 0) + (c.latest || 0)));
}

function renderChips() {
  const bar = $('#chips');
  const modes = $('#chips2');
  bar.replaceChildren();
  modes.replaceChildren();
  modes.hidden = state.view !== 'learn';
  if (state.view === 'learn') {
    const topics = (state.learnIndex && state.learnIndex.topics) || [];
    for (const t of topics) bar.append(topicChip(t));
    const items = state.learnCache[state.learnTopic];
    const counts = items && {
      interview: items.filter(i => i.mode === 'interview').length,
      scenario: items.filter(i => i.scenario).length,
      qa: items.filter(i => i.mode === 'qa').length,
      latest: items.filter(i => i.mode === 'latest').length,
      todo: items.filter(i => i.mode === 'interview' && !state.known[i.id]).length,
    };
    for (const [v, l] of LEARN_MODES) {
      const b = chip(l, v, counts ? counts[v] : null);
      modes.append(b);
    }
    // keep the selected language visible in the scrollable row
    requestAnimationFrame(() => {
      const sel = bar.querySelector('[aria-pressed="true"]');
      if (sel) sel.scrollIntoView({ block: 'nearest', inline: 'center' });
    });
  } else if (state.view === 'dotnet') {
    const net = state.news.filter(i => (i.tags || []).includes('dotnet'));
    const counts = {
      all: net.length,
      net: net.filter(i => !/azure/i.test(i.title)).length,
      azure: net.filter(i => /azure/i.test(`${i.title} ${i.summary}`)).length,
      releases: net.filter(i => i.release).length,
    };
    for (const [v, l] of DOTNET_FILTERS) bar.append(chip(l, v, counts[v]));
  } else if (state.view === 'news') {
    const cats = (state.meta && state.meta.categories) || [];
    const counts = {};
    for (const i of state.news) for (const t of i.tags || []) counts[t] = (counts[t] || 0) + 1;
    bar.append(chip('All', 'all', state.news.length), chip('🔥 Top', 'top'));
    for (const c of cats) if (counts[c.id]) bar.append(chip(c.label, c.id, counts[c.id]));
  } else if (state.view === 'jobs') {
    const counts = { all: state.jobs.length };
    for (const j of state.jobs) for (const r of j.regions || []) counts[r] = (counts[r] || 0) + 1;
    for (const [v, l] of JOB_REGIONS) bar.append(chip(l, v, v === 'match' ? null : counts[v] || 0));
  } else if (state.view === 'opps') {
    const counts = { all: state.opps.length };
    for (const o of state.opps) counts[o.kind] = (counts[o.kind] || 0) + 1;
    for (const [v, l] of OPP_KINDS) if (v === 'all' || counts[v]) bar.append(chip(l, v, counts[v]));
  }
  bar.hidden = !bar.childElementCount;
}

// ------------------------------------------------------------------ cards

function itemType(i) {
  if (i.answer) return 'learn';
  if (i.kind) return 'opp';
  if (i.company !== undefined) return 'job';
  return 'news';
}

function card(i) {
  const type = itemType(i);
  return type === 'learn' ? learnCard(i) : type === 'job' ? jobCard(i) : type === 'opp' ? oppCard(i) : newsCard(i);
}

// Answers arrive as plain-text blocks and are rendered with textContent only.
function renderBlocks(blocks) {
  const out = [];
  let ul = null;
  for (const b of blocks || []) {
    if (b.t === 'li') {
      if (!ul) { ul = h('ul'); out.push(ul); }
      ul.append(h('li', null, b.x));
      continue;
    }
    ul = null;
    if (b.t === 'code') out.push(h('pre', null, h('code', null, b.x)));
    else if (b.t === 'h') out.push(h('h4', null, b.x));
    else if (b.t === 'more') out.push(h('p', { class: 'more' }, 'Answer shortened — open the original for the full text.'));
    else out.push(h('p', null, b.x));
  }
  return out;
}

const MODE_LABEL = { interview: 'Interview', qa: 'Q&A', latest: 'Latest Q&A' };

function learnCard(i) {
  const open = state.openLearn.has(i.id);
  const known = !!state.known[i.id];
  const isSO = i.sid === 'stackoverflow';
  const toggle = () => {
    if (state.openLearn.has(i.id)) state.openLearn.delete(i.id); else state.openLearn.add(i.id);
    el.replaceWith(learnCard(i));
  };
  const knownBtn = h('button', {
    class: 'act' + (known ? ' on' : ''), 'aria-pressed': String(known),
    onclick: () => {
      if (state.known[i.id]) delete state.known[i.id]; else state.known[i.id] = true;
      store.set('known', state.known);
      if (state.view === 'learn' && state.filter.learn === 'todo') { render(); return; }
      el.replaceWith(learnCard(i));
      if (state.view === 'learn') {   // refresh "You know X of Y" and chip counts without losing scroll
        renderChips();
        const note = $('#list .section-note');
        if (note) note.replaceWith(learnNote());
      }
    },
  }, known ? '✓ Known' : 'Mark known');

  let attribution;
  if (isSO) {
    attribution = h('p', { class: 'attrib' },
      `Answer by ${i.author || 'a Stack Overflow user'} · ▲ ${(i.answer_score ?? 0).toLocaleString()} · `,
      h('a', { href: i.answer_url || i.url, target: '_blank', rel: 'noopener' }, 'Stack Overflow'),
      ` · ${i.license}`);
  } else if (i.sid === 'curated') {
    attribution = h('p', { class: 'attrib' }, 'TechPulse curated · ',
      h('a', { href: i.ref || i.url, target: '_blank', rel: 'noopener' }, 'Official docs ›'));
  } else {
    attribution = h('p', { class: 'attrib' }, `From `,
      h('a', { href: i.url, target: '_blank', rel: 'noopener' }, i.source),
      i.stars ? ` (★ ${i.stars.toLocaleString()})` : '', i.license ? ` · ${i.license}` : '');
  }

  const el = h('article', { class: 'card' + (known ? ' known' : '') },
    h('div', { class: 'meta' },
      isNew(i) ? h('span', { class: 'dot', title: 'New since your last visit' }) : null,
      h('span', { class: 'src' }, MODE_LABEL[i.mode] || i.mode),
      h('span', null, '·'), h('span', null, isSO ? 'Stack Overflow' : i.source),
      i.mode === 'latest' && i.date ? [h('span', null, '·'), h('span', null, ago(i.date))] : null),
    h('button', { class: 'learn-q', 'aria-expanded': String(open), onclick: toggle }, i.title),
    open ? h('div', { class: 'ans' },
      i.question && i.question.length ? h('div', { class: 'q-ctx' }, renderBlocks(i.question)) : null,
      renderBlocks(i.answer),
      attribution) : null,
    h('div', { class: 'foot' },
      i.scenario ? h('span', { class: 'tag hl' }, 'Scenario') : null,
      i.level ? h('span', { class: 'tag' }, i.level) : null,
      isSO ? h('span', { class: 'tag ok-tag' }, '✓ accepted') : null,
      i.score ? h('span', { class: 'tag' }, `▲ ${i.score.toLocaleString()}`) : null,
      h('span', { class: 'spacer' }),
      i.mode === 'interview' ? knownBtn : null,
      actions(i)));
  return el;
}

function actions(i) {
  const saved = !!state.saved[i.id];
  const saveBtn = h('button', {
    class: 'act' + (saved ? ' on' : ''), 'aria-label': saved ? 'Remove from saved' : 'Save', 'aria-pressed': String(saved),
    onclick: e => toggleSave(i, e.currentTarget),
  }, icon(ICON.save));
  const shareBtn = h('button', { class: 'act', 'aria-label': 'Share', onclick: () => share(i) }, icon(ICON.share));
  return [saveBtn, shareBtn];
}

function categoryLabel(id) {
  const c = state.meta && state.meta.categories.find(x => x.id === id);
  return c ? c.label : id;
}

function newsCard(i) {
  const also = (i.also || []).length;
  return h('article', { class: 'card' },
    h('div', { class: 'meta' },
      isNew(i) ? h('span', { class: 'dot', title: 'New since your last visit' }) : null,
      h('span', { class: 'src' }, i.source),
      also ? h('span', { title: i.also.join(', ') }, `+${also} more`) : null,
      h('span', null, '·'), h('time', { datetime: itemTime(i) }, ago(itemTime(i)))),
    h('a', { class: 'title', href: i.url, target: '_blank', rel: 'noopener' }, i.title),
    i.summary ? h('p', { class: 'sum' }, i.summary) : null,
    h('div', { class: 'foot' },
      (i.tags || []).slice(0, 3).map((t, n) => h('span', { class: 'tag' + (n === 0 ? ' hl' : '') }, categoryLabel(t))),
      i.points ? h('span', { class: 'tag' }, `▲ ${i.points.toLocaleString()}`) : null,
      h('span', { class: 'spacer' }),
      i.discuss ? h('a', { class: 'act', href: i.discuss, target: '_blank', rel: 'noopener', 'aria-label': 'Discussion' },
        icon(ICON.chat), i.comments ? String(i.comments) : '') : null,
      actions(i)));
}

const REGION_LABEL = { india: '🇮🇳 India', remote: '🌍 Remote', global: '✈︎ Global' };

function jobCard(j) {
  const skills = mySkills();
  return h('article', { class: 'card' },
    h('div', { class: 'meta' },
      isNew(j) ? h('span', { class: 'dot', title: 'New since your last visit' }) : null,
      h('span', { class: 'src' }, j.company || 'Company'),
      h('span', null, '·'), h('time', { datetime: itemTime(j) }, ago(itemTime(j)))),
    h('a', { class: 'title', href: j.url, target: '_blank', rel: 'noopener' }, j.title),
    j.location ? h('p', { class: 'sub' }, j.location) : null,
    h('div', { class: 'foot' },
      (j.regions || []).map(r => h('span', { class: 'tag hl' }, REGION_LABEL[r] || r)),
      j.salary ? h('span', { class: 'tag good' }, j.salary) : null,
      (j.skills || []).slice(0, 4).map(s => h('span', { class: 'tag' + (skills.includes(s) ? ' good' : '') }, s)),
      h('span', { class: 'spacer' }),
      h('span', { class: 'tag' }, j.source),
      actions(j)));
}

const KIND_LABEL = Object.fromEntries(OPP_KINDS);

function oppCard(o) {
  const when = o.start && o.end && o.start.slice(0, 10) !== o.end.slice(0, 10)
    ? `${fmtDate(o.start)} – ${fmtDate(o.end)}` : (o.start || o.end) ? fmtDate(o.start || o.end) : '';
  const deadline = o.kind === 'cfp' || o.kind === 'hackathon' ? o.end : null;
  const place = o.online ? 'Online' : o.location;
  return h('article', { class: 'card' },
    h('div', { class: 'meta' },
      isNew(o) ? h('span', { class: 'dot', title: 'New since your last visit' }) : null,
      h('span', { class: 'src' }, KIND_LABEL[o.kind] || o.kind),
      h('span', null, '·'), h('span', null, o.org || o.source)),
    h('a', { class: 'title', href: o.url, target: '_blank', rel: 'noopener' }, o.title),
    when || place ? h('p', { class: 'sub' }, [when, place].filter(Boolean).join(' · ')) : null,
    o.summary ? h('p', { class: 'sum' }, o.summary) : null,
    h('div', { class: 'foot' },
      deadline ? h('span', { class: 'tag warn' }, o.deadline_text || until(deadline)) : null,
      o.prize ? h('span', { class: 'tag good' }, `🏆 ${o.prize}`) : null,
      o.topic ? h('span', { class: 'tag' }, o.topic) : null,
      o.lang ? h('span', { class: 'tag' }, o.lang) : null,
      h('span', { class: 'spacer' }),
      actions(o)));
}

function renderTrends(main) {
  if (!state.trends.length) {
    main.append(h('div', { class: 'empty' }, state.meta ? 'No rising topics yet — trends appear once a few hours of news have been collected.' : 'Loading…'));
    return;
  }
  main.append(h('p', { class: 'section-note' }, 'Topics many sources started covering in the last 24 hours, compared with the days before.'));
  const max = state.trends[0].score;
  const q = state.query.trim().toLowerCase();
  for (const t of state.trends) {
    const items = t.items.map(id => state.newsById.get(id)).filter(Boolean);
    if (q && !t.term.includes(q) && !items.some(i => matchesQuery(i, q))) continue;
    const open = state.openTrend === t.term;
    const body = h('article', {
      class: 'card trend', role: 'button', tabindex: '0', 'aria-expanded': String(open),
      onclick: e => {
        if (e.target.closest('a, .act')) return;
        state.openTrend = open ? null : t.term;
        render();
      },
    },
    h('div', { class: 'trend-head' },
      h('span', { class: 'trend-term' }, t.term),
      t.new ? h('span', { class: 'tag hl' }, 'NEW') : null),
    h('div', { class: 'meta' }, `${t.count} stories · ${t.sources} sources`),
    h('div', { class: 'trend-bar' }, h('span', { style: `width:${Math.max(6, (t.score / max) * 100)}%` })),
    open ? h('div', { class: 'trend-items' }, items.map(newsCard)) : null);
    main.append(body);
  }
}

// ------------------------------------------------------------------ actions

function toggleSave(i, btn) {
  if (state.saved[i.id]) {
    delete state.saved[i.id];
    toast('Removed from saved');
  } else {
    state.saved[i.id] = { savedAt: new Date().toISOString(), item: i };
    toast('Saved');
  }
  store.set('saved', state.saved);
  if (state.view === 'saved') { render(); return; }
  const on = !!state.saved[i.id];
  btn.classList.toggle('on', on);
  btn.setAttribute('aria-pressed', String(on));
}

async function share(i) {
  const data = { title: i.title, url: i.url };
  try {
    if (navigator.share) { await navigator.share(data); return; }
    await navigator.clipboard.writeText(`${i.title}\n${i.url}`);
    toast('Link copied');
  } catch { /* user cancelled */ }
}

// ------------------------------------------------------------------ settings

function applyTheme() {
  const t = state.settings.theme;
  if (t === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
  document.querySelectorAll('#theme button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.theme === t)));
}

function saveSettings() {
  store.set('settings', state.settings);
}

function renderSources() {
  const ul = $('#sources');
  ul.replaceChildren();
  const groups = { news: 'News', jobs: 'Jobs', opportunities: 'Opportunities', learn: 'Learn' };
  const list = [...state.health].sort((a, b) => (!!a.ok - !!b.ok) || a.name.localeCompare(b.name));
  for (const s of list) {
    const cls = s.disabled ? 'off' : s.ok ? 'ok' : 'bad';
    const mark = s.disabled ? '○' : s.ok ? '●' : '▲';
    ul.append(h('li', null,
      h('span', { class: cls, 'aria-hidden': 'true' }, mark),
      h('span', { class: 'name' }, `${s.name} `, h('span', { class: 'muted' }, `· ${groups[s.group] || s.group}`),
        !s.ok && s.error ? h('span', { class: 'err' }, s.error) : null,
        s.ok && s.partial ? h('span', { class: 'err' }, `Partly failing — ${s.partial}`) : null),
      h('span', { class: 'muted' }, s.ok ? `${s.count ?? 0} · ${ago(s.last_ok)}` : s.disabled ? 'off' : 'failing')));
  }
  const m = state.meta;
  $('#srcSummary').textContent = m ? `${m.sources.ok}/${m.sources.total} live` : '';
}

// ------------------------------------------------------------------ wiring

let typing;

function setView(v) {
  clearTimeout(typing);
  state.view = v;
  $('#savedBtn').setAttribute('aria-pressed', String(v === 'saved'));
  state.query = '';
  $('#search').value = '';
  store.set('view', v);
  render();
  window.scrollTo({ top: 0 });
}

function init() {
  applyTheme();
  markTabs();
  document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));

  $('#search').addEventListener('input', e => {
    clearTimeout(typing);
    typing = setTimeout(() => { state.query = e.target.value; render(); }, 180);
  });

  $('#refreshBtn').addEventListener('click', () => load());
  $('#savedBtn').addEventListener('click', () => setView(state.view === 'saved' ? 'news' : 'saved'));
  $('#savedBtn').setAttribute('aria-pressed', String(state.view === 'saved'));
  $('#settingsBtn').addEventListener('click', () => { $('#skills').value = state.settings.skills; $('#settings').showModal(); });
  $('#settings').addEventListener('click', e => { if (e.target === e.currentTarget) e.currentTarget.close(); });
  $('#settings').addEventListener('close', () => { if (state.view === 'jobs') render(); });
  $('#skills').addEventListener('change', e => { state.settings.skills = e.target.value; saveSettings(); });
  document.querySelectorAll('#theme button').forEach(b => b.addEventListener('click', () => {
    state.settings.theme = b.dataset.theme; saveSettings(); applyTheme();
  }));

  new IntersectionObserver(entries => {
    if (entries[0].isIntersecting && state.view !== 'rising' && state.shown < state.list.length) more();
  }, { rootMargin: '600px' }).observe($('#sentinel'));

  // Install prompts
  let deferred;
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; $('#installBtn').hidden = false; });
  $('#installBtn').addEventListener('click', async () => {
    if (!deferred) return;
    deferred.prompt();
    await deferred.userChoice;
    deferred = null;
    $('#installBtn').hidden = true;
  });
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = navigator.standalone || matchMedia('(display-mode: standalone)').matches;
  if (ios && !standalone && !store.get('iosHintDone', false)) $('#iosHint').hidden = false;
  $('#iosHintClose').addEventListener('click', () => { $('#iosHint').hidden = true; store.set('iosHintDone', true); });

  // Keep fresh: check on return to the app and periodically while open.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - state.lastLoad > 60e3) load({ quiet: true });
  });
  setInterval(() => { if (document.visibilityState === 'visible') load({ quiet: true }); }, CHECK_EVERY_MS);
  setInterval(() => setStatus(), 60e3);

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

  $('#list').replaceChildren(...Array.from({ length: 5 }, () => h('div', { class: 'skeleton' })));
  load();
}

init();
