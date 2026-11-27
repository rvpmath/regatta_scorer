// Regatta Scorer: screens and interactions.

import * as S from './scoring.js';
import { createStore } from './store.js';
import { resultsCSV, resultsPDF, shareFile, fileSafeName } from './export.js';

const APP_VERSION = '1.0.0';
const UI_KEY = 'regatta-scorer.ui.v1';

// ---------- Storage ----------

function openStorage() {
  try {
    const probe = '__regatta_probe__';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return { storage: localStorage, persistent: true };
  } catch {
    const memory = new Map();
    return {
      storage: { getItem: (k) => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, String(v)) },
      persistent: false,
    };
  }
}

const { storage, persistent } = openStorage();
const store = createStore(storage);
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

// ---------- UI state ----------

let ui = loadUi();
let modal = null;
let pendingCode = null;
let raceMessage = null;
let focusAfterRender = null;
let scrollFinishToEnd = false;
let lastScreenKey = null;

function loadUi() {
  const fallback = { screen: 'home', tab: 'ranking', lastListId: null };
  try {
    const saved = JSON.parse(storage.getItem(UI_KEY) || 'null');
    return saved && typeof saved === 'object' ? { ...fallback, ...saved } : fallback;
  } catch {
    return fallback;
  }
}

function saveUi() {
  try {
    storage.setItem(UI_KEY, JSON.stringify(ui));
  } catch {
    /* not important */
  }
}

const root = document.getElementById('app');
const flashBox = document.getElementById('flash');

// ---------- Small helpers ----------

const h = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function attrs(data = {}) {
  return Object.entries(data)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => ` data-${k}="${h(v)}"`)
    .join('');
}

const ICON = {
  back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>',
  chevron: '<svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7" /></svg>',
  plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>',
  share: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V3M7 8l5-5 5 5M5 12v8h14v-8" /></svg>',
  undo: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 14L4 9l5-5" /><path d="M4 9h11a5 5 0 010 10h-3" /></svg>',
  more: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" /></svg>',
  grid: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="6" height="6" rx="1" /><rect x="14" y="4" width="6" height="6" rx="1" /><rect x="4" y="14" width="6" height="6" rx="1" /><rect x="14" y="14" width="6" height="6" rx="1" /></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>',
  flag: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 21V4M6 4h11l-2.5 4L17 12H6" /></svg>',
};

function button(label, action, { cls = '', data, disabled = false, icon = '', aria } = {}) {
  return `<button type="button" class="btn ${cls}" data-action="${action}"${attrs(data)}${disabled ? ' disabled' : ''}${aria ? ` aria-label="${h(aria)}"` : ''}>${icon}${label ? `<span>${h(label)}</span>` : ''}</button>`;
}

function bar({ left = '', title = '', right = '' }) {
  return `<header class="bar"><div class="bar-side">${left}</div><h1 class="bar-title">${h(title)}</h1><div class="bar-side bar-right">${right}</div></header>`;
}

function backButton(label, action, data) {
  return button(label, action, { cls: 'plain back', icon: ICON.back, data });
}

function showFlash(text, kind = 'info') {
  flashBox.className = `flash show ${kind}`;
  flashBox.textContent = text;
  clearTimeout(showFlash.timer);
  showFlash.timer = setTimeout(() => {
    flashBox.className = 'flash';
  }, kind === 'error' ? 6000 : 2500);
}

function today() {
  return new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

function currentEvent() {
  return ui.eventId ? store.event(ui.eventId) : null;
}

function listName(listId) {
  const list = store.list(listId);
  return list ? list.name : 'a deleted list';
}

function defaultListId() {
  return store.list(ui.lastListId) ? ui.lastListId : store.lists[0].id;
}

function eventSummary(ev) {
  return `${S.plural(ev.competitors.length, 'boat')} · ${S.plural(S.sailedRaceCount(ev), 'race')} · ${listName(ev.listId)}`;
}

// ---------- Rendering ----------

function render() {
  const key = screenKey();
  const scroll = key === lastScreenKey ? captureScroll() : null;
  root.innerHTML = renderScreen() + renderModal();
  if (scroll) restoreScroll(scroll);
  else window.scrollTo(0, 0);
  lastScreenKey = key;

  if (scrollFinishToEnd) {
    scrollFinishToEnd = false;
    const col = root.querySelector('[data-scroll="finish"]');
    if (col) col.scrollTop = col.scrollHeight;
  }
  if (focusAfterRender) {
    const el = document.getElementById(focusAfterRender);
    focusAfterRender = null;
    if (el) el.focus();
  }
  saveUi();
  updateWakeLock();
}

function screenKey() {
  return [ui.screen, ui.eventId, ui.raceId, ui.tab, ui.fleet && ui.fleet.mode, ui.fleet && ui.fleet.listId].join('|');
}

function captureScroll() {
  const map = { window: window.scrollY };
  root.querySelectorAll('[data-scroll]').forEach((el) => (map[el.dataset.scroll] = el.scrollTop));
  return map;
}

function restoreScroll(map) {
  window.scrollTo(0, map.window || 0);
  root.querySelectorAll('[data-scroll]').forEach((el) => {
    if (map[el.dataset.scroll] != null) el.scrollTop = map[el.dataset.scroll];
  });
}

function renderScreen() {
  const ev = currentEvent();
  switch (ui.screen) {
    case 'event':
      if (ev) return renderEvent(ev);
      break;
    case 'race': {
      const race = ev && S.raceById(ev, ui.raceId);
      if (race) return renderRace(ev, race);
      if (ev) {
        ui.screen = 'event';
        return renderEvent(ev);
      }
      break;
    }
    case 'lists':
      return renderLists();
    case 'fleet':
      if (ui.fleet) return renderFleet();
      break;
  }
  ui.screen = 'home';
  return renderHome();
}

// ----- Home -----

function renderHome() {
  const events = store.events;
  const right =
    button('Boat Lists', 'openLists', { cls: 'plain', icon: ICON.grid }) +
    button('New Event', 'newEvent', { cls: 'plain strong', icon: ICON.plus });
  const list = events.length
    ? `<ul class="list">${events
        .map(
          (ev) => `<li><button type="button" class="row" data-action="openEvent" data-longpress="eventMenu"${attrs({ id: ev.id })}>
            <span class="row-main"><span class="row-title">${h(ev.name)}</span><span class="row-sub">${h(eventSummary(ev))}</span></span>${ICON.chevron}</button></li>`
        )
        .join('')}</ul>
       <p class="note">Touch and hold an event to rename or delete it.</p>`
    : `<div class="empty"><h2>No events yet</h2><p>Create an event, tap the boats that are racing, and start scoring.</p>${button('New Event', 'newEvent', { cls: 'primary big', icon: ICON.plus })}</div>`;

  return `${bar({ title: 'Regatta Scorer', right })}
    <main class="page">
      ${persistent ? '' : '<p class="banner error">This browser is not letting the app save data. Results will be lost when it closes. Open the app from the Home Screen icon, and turn off Private Browsing.</p>'}
      ${list}
      <section class="card footer-card">
        <h2>Backup</h2>
        <p class="note">Everything is stored on this device only. Save a backup file now and then (for example to Files or iCloud Drive), so nothing is lost if the iPad is reset.</p>
        <div class="button-row">
          ${button('Save Backup', 'backup', { cls: 'secondary' })}
          ${button('Restore Backup', 'restoreConfirm', { cls: 'secondary' })}
        </div>
        <p class="note small">Regatta Scorer ${APP_VERSION} · works offline</p>
      </section>
    </main>`;
}

// ----- Boat lists -----

function renderLists() {
  const rows = store.lists
    .map((list) => {
      const used = store.eventsUsingList(list.id).length;
      return `<li><button type="button" class="row" data-action="openList" data-longpress="listMenu"${attrs({ id: list.id })}>
        <span class="row-main"><span class="row-title">${h(list.name)}</span><span class="row-sub">${h(S.plural(list.boats.length, 'boat'))}${used ? ` · used by ${h(S.plural(used, 'event'))}` : ''}</span></span>${ICON.chevron}</button></li>`;
    })
    .join('');
  return `${bar({ left: backButton('Events', 'goHome'), title: 'Boat Lists', right: button('New List', 'newList', { cls: 'plain strong', icon: ICON.plus }) })}
    <main class="page">
      <ul class="list">${rows}</ul>
      <p class="note">Each event uses one boat list. Boats added to an event are saved to that event's list only. Touch and hold a list to rename or delete it.</p>
    </main>`;
}

// ----- Boat grid (pick boats for an event, or look after a list) -----

function renderFleet() {
  const f = ui.fleet;
  if (!store.list(f.listId)) f.listId = defaultListId();
  const event = f.mode === 'addToEvent' ? store.event(f.eventId) : null;
  const inEvent = new Set(event ? event.competitors.map((c) => c.sailNumber) : []);
  const boats = store.sortedBoats(f.listId).filter((b) => !inEvent.has(b.sailNumber));
  const selected = new Set(f.selected);
  const chosen = boats.filter((b) => selected.has(b.id));
  const picking = f.mode !== 'manage';

  let left, right, title;
  if (f.mode === 'manage') {
    title = listName(f.listId);
    left = backButton('Boat Lists', 'openLists');
    right = button('Add Boat', 'fleetAddNew', { cls: 'plain strong', icon: ICON.plus });
  } else if (f.mode === 'newEvent') {
    title = 'New Event';
    left = button('Cancel', 'fleetCancel', { cls: 'plain' });
    right = button('Create', 'fleetConfirm', { cls: 'plain strong' });
  } else {
    title = 'Add Boats';
    left = button('Cancel', 'fleetCancel', { cls: 'plain' });
    right = button(chosen.length === 1 ? 'Add 1 Boat' : `Add ${chosen.length} Boats`, 'fleetConfirm', { cls: 'plain strong', disabled: chosen.length === 0 });
  }

  const nameField =
    f.mode === 'newEvent'
      ? `<label class="field"><span>Event name</span><input id="fleet-name" data-input="fleetName" value="${h(f.name)}" autocomplete="off" enterkeyhint="done"></label>`
      : '';

  const listChooser =
    f.mode === 'newEvent'
      ? `<div class="field"><span>Boat list</span><div class="chips">${store.lists
          .map((l) => `<button type="button" class="chip${l.id === f.listId ? ' on' : ''}" data-action="fleetChooseList"${attrs({ id: l.id })}>${h(l.name)} <small>${l.boats.length}</small></button>`)
          .join('')}<button type="button" class="chip add" data-action="newList"${attrs({ from: 'newEvent' })}>+ New List</button></div></div>`
      : f.mode === 'addToEvent'
        ? `<p class="note">From the boat list <strong>${h(listName(f.listId))}</strong>.</p>`
        : '';

  const hint = picking
    ? `Tap the boats that are racing. Touch and hold a boat to edit it or delete it from the list.${inEvent.size ? ' Boats already in this event aren’t shown.' : ''}`
    : 'Tap or touch and hold a boat to edit it or delete it from this list.';

  let grid;
  if (boats.length === 0) {
    grid = `<p class="note">${
      store.list(f.listId).boats.length === 0
        ? 'This list has no boats yet. Add the boats that are racing and they’ll be remembered for next time.'
        : 'Every boat in this list is already in the event.'
    }</p>`;
  } else {
    grid = `${
      picking
        ? `<div class="select-row">${button('Select All', 'fleetSelectAll', { cls: 'secondary small' })}${button('Clear', 'fleetClear', { cls: 'secondary small', disabled: chosen.length === 0 })}<span class="note">${chosen.length} of ${boats.length} selected</span></div>`
        : ''
    }<div class="tile-grid">${boats
      .map((b) => {
        const on = selected.has(b.id);
        return `<button type="button" class="tile${on ? ' on' : ''}" data-action="fleetTap" data-longpress="fleetMenu"${attrs({ id: b.id })} aria-pressed="${on}">
          ${on ? `<span class="tick">${ICON.check}</span>` : ''}<span class="tile-sail">${h(b.sailNumber)}</span><span class="tile-name">${h(b.name || ' ')}</span></button>`;
      })
      .join('')}</div>`;
  }

  return `${bar({ left, title, right })}
    <main class="page">
      ${nameField}
      ${listChooser}
      <p class="note">${hint}</p>
      ${grid}
      ${picking ? `<div class="button-row">${button('Add New Boat', 'fleetAddNew', { cls: 'secondary', icon: ICON.plus })}</div>` : ''}
    </main>`;
}

// ----- Event -----

const TABS = [
  ['ranking', 'Ranking'],
  ['races', 'Races'],
  ['boats', 'Boats'],
  ['settings', 'Settings'],
];

function renderEvent(ev) {
  if (!TABS.some(([k]) => k === ui.tab)) ui.tab = 'ranking';
  const tabs = `<div class="segmented tabs" role="tablist">${TABS.map(
    ([key, label]) => `<button type="button" role="tab" aria-selected="${ui.tab === key}" class="${ui.tab === key ? 'on' : ''}" data-action="tab"${attrs({ tab: key })}>${label}</button>`
  ).join('')}</div>`;

  let body;
  if (ui.tab === 'races') body = renderRacesTab(ev);
  else if (ui.tab === 'boats') body = renderBoatsTab(ev);
  else if (ui.tab === 'settings') body = renderSettingsTab(ev);
  else body = renderRankingTab(ev);

  return `${bar({
    left: backButton('Events', 'goHome'),
    title: ev.name,
    right: button('Share', 'shareMenu', { cls: 'plain', icon: ICON.share }),
  })}
    <main class="page">${tabs}${body}</main>`;
}

function renderRankingTab(ev) {
  if (S.sailedRaceCount(ev) === 0) {
    return `<div class="empty"><h2>No results yet</h2><p>Enter finishes in the Races tab and the ranking appears here.</p>${button('Go to Races', 'tab', { cls: 'primary', data: { tab: 'races' } })}</div>`;
  }
  const rows = S.ranking(ev);
  const head = `<tr><th class="num">#</th><th>Sail no.</th><th>Name</th>${ev.races.map((_, i) => `<th class="num">R${i + 1}</th>`).join('')}<th class="num">Total</th><th class="num">Nett</th></tr>`;
  const body = rows
    .map(
      (row) => `<tr><td class="num">${row.rank}</td><td class="sail">${h(row.competitor.sailNumber)}</td><td>${h(row.competitor.name)}</td>${row.results
        .map((r) => `<td class="num${r.discarded || !r.sailed ? ' muted' : ''}${r.code ? ' pen' : ''}">${h(S.resultText(r))}</td>`)
        .join('')}<td class="num muted">${row.total}</td><td class="num nett">${row.nett}</td></tr>`
    )
    .join('');
  return `<div class="table-wrap" data-scroll="table"><table class="results"><thead>${head}</thead><tbody>${body}</tbody></table></div>
    <p class="note">${h(S.scoringSummary(ev))} Discarded results are in brackets.</p>`;
}

function raceSummary(race) {
  if (!S.isSailed(race)) return 'No finishes yet';
  const finished = race.entries.filter((e) => !e.code).length;
  const penalties = race.entries.length - finished;
  return `${finished} finished${penalties ? ` · ${S.plural(penalties, 'penalty', 'penalties')}` : ''}`;
}

function renderRacesTab(ev) {
  const rows = ev.races
    .map(
      (race, i) => `<li><button type="button" class="row" data-action="openRace"${attrs({ id: race.id })}>
        <span class="row-main"><span class="row-title">Race ${i + 1}</span></span><span class="row-value">${h(raceSummary(race))}</span>${ICON.chevron}</button></li>`
    )
    .join('');
  return `${rows ? `<ul class="list">${rows}</ul>` : ''}
    ${ev.competitors.length === 0 ? '<p class="note">This event has no boats yet. You can add them in the Boats tab, or type sail numbers while entering the race.</p>' : ''}
    <div class="button-row">${button(`Start Race ${ev.races.length + 1}`, 'startRace', { cls: 'primary big', icon: ICON.flag })}</div>`;
}

function renderBoatsTab(ev) {
  const rows = S.sortBoats(ev.competitors)
    .map(
      (c) => `<li><button type="button" class="row" data-action="editEventBoat"${attrs({ id: c.id })}>
        <span class="row-sail">${h(c.sailNumber)}</span><span class="row-main"><span class="row-title${c.name ? '' : ' muted'}">${h(c.name || 'No name')}</span></span>${ICON.chevron}</button></li>`
    )
    .join('');
  return `<div class="button-row">
      ${button('Add from Boat List', 'addFromList', { cls: 'secondary', icon: ICON.grid })}
      ${button('Add New Boat', 'addEventBoat', { cls: 'secondary', icon: ICON.plus })}
    </div>
    <h2 class="section-title">${h(S.plural(ev.competitors.length, 'boat'))} in this event</h2>
    ${rows ? `<ul class="list">${rows}</ul>` : ''}
    <p class="note">New boats are also saved to the boat list <strong>${h(listName(ev.listId))}</strong>. Tap a boat to edit it or remove it from this event.</p>`;
}

function stepper(label, key, value, min, max) {
  return `<div class="stepper"><span>${h(label)}</span><div class="stepper-buttons">
    ${button('', 'setting', { cls: 'secondary', data: { key, delta: -1 }, disabled: value <= min, icon: '−', aria: 'Decrease' })}
    ${button('', 'setting', { cls: 'secondary', data: { key, delta: 1 }, disabled: value >= max, icon: '+', aria: 'Increase' })}
  </div></div>`;
}

function renderSettingsTab(ev) {
  const st = ev.settings;
  const sailed = S.sailedRaceCount(ev);
  const discards = S.discardCount(sailed, st);
  const discardLabel = st.racesPerDiscard === 0 ? 'No discards' : `One discard per ${S.plural(st.racesPerDiscard, 'race')}`;
  return `<section class="card">
      <label class="field"><span>Event name</span><input id="event-name" data-input="eventName" value="${h(ev.name)}" autocomplete="off" enterkeyhint="done"></label>
    </section>
    <section class="card">
      <h2>Boat list</h2>
      <div class="chips">${store.lists
        .map((l) => `<button type="button" class="chip${l.id === ev.listId ? ' on' : ''}" data-action="setEventList"${attrs({ id: l.id })}>${h(l.name)}</button>`)
        .join('')}</div>
      <p class="note">Boats added to this event are saved to this list. Changing it doesn't move boats that were already added.</p>
    </section>
    <section class="card">
      <h2>Discards</h2>
      ${stepper(discardLabel, 'racesPerDiscard', st.racesPerDiscard, 0, 20)}
      <p class="note">With ${S.plural(sailed, 'race')} sailed, each boat's worst ${discards === 1 ? 'result doesn’t' : `${discards} results don’t`} count. Discarded results are shown in brackets.</p>
    </section>
    <section class="card">
      <h2>OCS, DSQ, DNS and DNF</h2>
      ${stepper(`Penalty points: ${st.penaltyPoints}`, 'penaltyPoints', st.penaltyPoints, 0, 10)}
      <p class="note">These score the number of boats (${ev.competitors.length}) plus the penalty points, so ${S.penaltyScore(ev)} points. A boat left out of a race's finish order scores DNF.</p>
    </section>
    <section class="card">
      <h2>Ties</h2>
      <p class="note">Boats level on points are separated by who has the most first places, then second places, and so on (discards not included). If still level, the better result in the last race decides, then the race before that.</p>
    </section>
    <div class="button-row">${button('Delete Event', 'deleteEventConfirm', { cls: 'danger', data: { id: ev.id } })}</div>`;
}

// ----- Race entry -----

function renderRace(ev, race) {
  const number = S.raceNumber(ev, race.id);
  const labels = S.placeLabels(race);
  const entered = new Set(race.entries.map((e) => e.competitorId));
  const remaining = S.sortBoats(ev.competitors).filter((c) => !entered.has(c.id));

  const finishRows = race.entries
    .map((entry) => {
      const c = S.competitorById(ev, entry.competitorId);
      return `<li><button type="button" class="finish-row" data-action="finishMenu"${attrs({ id: entry.id })}>
        <span class="place${entry.code ? ' pen' : ''}">${h(labels.get(entry.id))}</span>
        <span class="fr-main"><span class="fr-sail">${h(c ? c.sailNumber : '?')}</span>${c && c.name ? `<span class="fr-name">${h(c.name)}</span>` : ''}</span></button></li>`;
    })
    .join('');

  const codes = [['', 'Finish'], ...S.PENALTY_CODES.map((c) => [c, c])];
  const codeButtons = `<div class="segmented codes">${codes
    .map(([code, label]) => `<button type="button" class="${(pendingCode || '') === code ? 'on' : ''}${code ? ' pen' : ''}" data-action="pendingCode"${attrs({ code })}>${label}</button>`)
    .join('')}</div>`;

  const hint = pendingCode
    ? `The next boat you tap scores ${pendingCode} (${S.CODE_EXPLANATIONS[pendingCode]}).`
    : 'Tap each boat as it finishes.';

  const tiles = remaining.length
    ? `<div class="tile-grid">${remaining
        .map(
          (c) => `<button type="button" class="tile${pendingCode ? ' pen' : ''}" data-action="recordFinish"${attrs({ id: c.id })}>
            <span class="tile-sail">${h(c.sailNumber)}</span><span class="tile-name">${h(c.name || ' ')}</span></button>`
        )
        .join('')}</div>`
    : `<p class="note">${ev.competitors.length ? 'Every boat has been entered for this race.' : 'No boats yet. Type a sail number below to add the first finisher.'}</p>`;

  const penalty = S.penaltyScore(ev);

  return `${bar({
    left: backButton(ev.name, 'backToEvent'),
    title: `Race ${number}`,
    right:
      button('Undo', 'undoFinish', { cls: 'plain', icon: ICON.undo, disabled: race.entries.length === 0 }) +
      button('', 'raceMenu', { cls: 'plain', icon: ICON.more, aria: 'More' }),
  })}
    <main class="race-layout">
      <section class="finish-col" data-scroll="finish">
        <h2 class="section-title">Finish order</h2>
        ${finishRows ? `<ol class="finish-list">${finishRows}</ol>` : ''}
        <p class="note">${race.entries.length ? 'Tap a boat here to change its result, move it up or down, or remove it.' : 'Tap sail numbers in the order boats finish.'}</p>
      </section>
      <section class="boats-col" data-scroll="boats">
        ${codeButtons}
        <p class="note${pendingCode ? ' warn' : ''}">${h(hint)}</p>
        ${tiles}
        <form class="add-sail" data-form="addSail" autocomplete="off">
          <input id="sail-input" name="sail" inputmode="numeric" autocapitalize="characters" autocorrect="off" spellcheck="false" enterkeyhint="done" placeholder="Other sail number" aria-label="Other sail number">
          <button type="submit" class="btn primary">Add</button>
        </form>
        ${raceMessage ? `<p class="note">${h(raceMessage)}</p>` : ''}
        ${remaining.length && S.isSailed(race) ? `<p class="note small">${h(S.plural(remaining.length, 'boat'))} not entered yet. Any boat left out scores DNF (${penalty} points).</p>` : ''}
      </section>
    </main>`;
}

// ----- Modals -----

function renderModal() {
  if (!modal) return '';
  let inner = '';
  if (modal.type === 'menu') {
    inner = `${modal.title ? `<h2>${h(modal.title)}</h2>` : ''}${modal.message ? `<p class="note">${h(modal.message)}</p>` : ''}
      <div class="menu">${modal.items
        .map(
          (it) => `<button type="button" class="menu-item${it.danger ? ' danger' : ''}${it.checked ? ' checked' : ''}" data-action="${it.action}" data-close="1"${attrs(it.data)}>
            <span>${h(it.label)}</span>${it.checked ? ICON.check : ''}</button>`
        )
        .join('')}</div>
      <div class="sheet-buttons">${button('Cancel', 'closeModal', { cls: 'secondary' })}</div>`;
  } else if (modal.type === 'confirm') {
    inner = `<h2>${h(modal.title)}</h2>${modal.message ? `<p class="note">${h(modal.message)}</p>` : ''}
      <div class="sheet-buttons">${button('Cancel', 'closeModal', { cls: 'secondary' })}
      <button type="button" class="btn ${modal.danger ? 'danger' : 'primary'}" data-action="${modal.action}" data-close="1"${attrs(modal.data)}><span>${h(modal.confirmLabel)}</span></button></div>`;
  } else if (modal.type === 'prompt') {
    inner = `<form data-form="prompt" autocomplete="off"><h2>${h(modal.title)}</h2>
      <label class="field"><span>${h(modal.label)}</span><input id="prompt-input" data-input="prompt" value="${h(modal.value)}" enterkeyhint="done"></label>
      <div class="sheet-buttons">${button('Cancel', 'closeModal', { cls: 'secondary' })}<button type="submit" class="btn primary"><span>${h(modal.confirmLabel)}</span></button></div></form>`;
  } else if (modal.type === 'boat') {
    const m = modal;
    const isNew = !m.boatId;
    const note = m.error
      ? `<p class="note error" id="boat-note">${h(m.error)}</p>`
      : `<p class="note" id="boat-note">${m.autoFilled ? 'Name filled in from the boat list.' : ''}</p>`;
    inner = `<form data-form="boat" autocomplete="off"><h2>${isNew ? 'Add Boat' : 'Edit Boat'}</h2>
      ${m.target === 'list' ? `<p class="note">Boat list: <strong>${h(listName(m.listId))}</strong></p>` : ''}
      <label class="field"><span>Sail number</span><input id="boat-sail" data-input="boatSail" value="${h(m.sail)}" inputmode="numeric" autocapitalize="characters" autocorrect="off" spellcheck="false" enterkeyhint="next"></label>
      <label class="field"><span>Skipper name (optional)</span><input id="boat-name" data-input="boatName" value="${h(m.name)}" autocorrect="off" enterkeyhint="done"></label>
      ${note}
      <div class="sheet-buttons">
        ${button('Cancel', 'closeModal', { cls: 'secondary' })}
        ${isNew ? button('Save and Add Another', 'boatSaveAnother', { cls: 'secondary' }) : ''}
        <button type="submit" class="btn primary"><span>Save</span></button>
      </div>
      ${!isNew && m.target === 'event' ? `<div class="sheet-buttons">${button('Remove from Event', 'removeEventBoatConfirm', { cls: 'danger', data: { id: m.boatId } })}</div>` : ''}
      ${!isNew && m.target === 'list' ? `<div class="sheet-buttons">${button('Delete from Boat List', 'listBoatDeleteConfirm', { cls: 'danger', data: { id: m.boatId } })}</div>` : ''}
      </form>`;
  }
  return `<div class="overlay" data-action="backdrop"><div class="sheet" role="dialog" aria-modal="true">${inner}</div></div>`;
}

function openBoatEditor({ target, listId = null, eventId = null, boat = null }) {
  modal = {
    type: 'boat',
    target,
    listId,
    eventId,
    boatId: boat ? boat.id : null,
    sail: boat ? boat.sailNumber : '',
    name: boat ? boat.name : '',
    autoFilled: false,
    error: null,
  };
  focusAfterRender = boat ? null : 'boat-sail';
}

/** The list whose names fill in automatically while typing a sail number. */
function boatEditorListId(m) {
  if (m.target === 'list') return m.listId;
  const ev = store.event(m.eventId);
  return ev ? ev.listId : null;
}

/** Saves the boat editor. Returns true when saved. */
function saveBoatEditor() {
  const m = modal;
  const sail = S.normalizeSail(m.sail);
  if (!sail) {
    m.error = 'Enter a sail number.';
    return false;
  }
  if (m.target === 'list') {
    const id = store.saveListBoat(m.listId, m.boatId, sail, m.name);
    if (!id) {
      m.error = `Sail number ${sail} is already in this boat list.`;
      return false;
    }
    if (!m.boatId && ui.screen === 'fleet' && ui.fleet.mode !== 'manage') ui.fleet.selected.push(id);
  } else {
    const ok = store.mutate(m.eventId, (ev) => S.upsertCompetitor(ev, m.boatId, sail, m.name));
    if (!ok) {
      m.error = `Another boat in this event already has sail number ${sail}.`;
      return false;
    }
  }
  return true;
}

// ---------- Actions ----------

function goEvent(eventId, tab) {
  ui.screen = 'event';
  ui.eventId = eventId;
  if (tab) ui.tab = tab;
  pendingCode = null;
  raceMessage = null;
}

function openFleet(mode, { listId, eventId = null, back = 'home' } = {}) {
  ui.fleet = { mode, listId: listId || defaultListId(), eventId, selected: [], name: today(), back };
  ui.screen = 'fleet';
}

function leaveFleet() {
  const f = ui.fleet;
  if (f && f.back === 'event' && store.event(f.eventId)) goEvent(f.eventId, 'boats');
  else if (f && f.back === 'lists') ui.screen = 'lists';
  else ui.screen = 'home';
  ui.fleet = null;
}

function fleetBoatsShown() {
  const f = ui.fleet;
  const event = f.mode === 'addToEvent' ? store.event(f.eventId) : null;
  const inEvent = new Set(event ? event.competitors.map((c) => c.sailNumber) : []);
  return store.sortedBoats(f.listId).filter((b) => !inEvent.has(b.sailNumber));
}

const actions = {
  closeModal() {
    modal = null;
  },
  backdrop() {
    modal = null;
  },

  // Home and events
  goHome() {
    ui.screen = 'home';
  },
  openEvent({ id }) {
    goEvent(id, 'ranking');
  },
  eventMenu({ id }) {
    const ev = store.event(id);
    if (!ev) return;
    modal = {
      type: 'menu',
      title: ev.name,
      items: [
        { label: 'Rename', action: 'renameEvent', data: { id } },
        { label: 'Delete Event', action: 'deleteEventConfirm', data: { id }, danger: true },
      ],
    };
  },
  renameEvent({ id }) {
    const ev = store.event(id);
    if (!ev) return;
    modal = { type: 'prompt', title: 'Rename Event', label: 'Event name', value: ev.name, confirmLabel: 'Save', submit: 'renameEvent', id };
    focusAfterRender = 'prompt-input';
  },
  deleteEventConfirm({ id }) {
    const ev = store.event(id);
    if (!ev) return;
    modal = {
      type: 'confirm',
      title: `Delete ${ev.name}?`,
      message: 'All races and results in this event will be deleted. This can’t be undone.',
      confirmLabel: 'Delete Event',
      danger: true,
      action: 'deleteEvent',
      data: { id },
    };
  },
  deleteEvent({ id }) {
    store.deleteEvent(id);
    if (ui.eventId === id) {
      ui.eventId = null;
      ui.screen = 'home';
    }
  },
  newEvent() {
    openFleet('newEvent', { back: 'home' });
  },

  // Boat lists
  openLists() {
    ui.screen = 'lists';
    ui.fleet = null;
  },
  openList({ id }) {
    openFleet('manage', { listId: id, back: 'lists' });
  },
  newList({ from }) {
    modal = { type: 'prompt', title: 'New Boat List', label: 'List name', value: '', confirmLabel: 'Create', submit: 'newList', from };
    focusAfterRender = 'prompt-input';
  },
  listMenu({ id }) {
    const list = store.list(id);
    if (!list) return;
    const items = [{ label: 'Rename', action: 'renameList', data: { id } }];
    if (store.lists.length > 1) items.push({ label: 'Delete List', action: 'deleteListConfirm', data: { id }, danger: true });
    modal = { type: 'menu', title: list.name, message: store.lists.length > 1 ? '' : 'The only list can’t be deleted.', items };
  },
  renameList({ id }) {
    const list = store.list(id);
    if (!list) return;
    modal = { type: 'prompt', title: 'Rename Boat List', label: 'List name', value: list.name, confirmLabel: 'Save', submit: 'renameList', id };
    focusAfterRender = 'prompt-input';
  },
  deleteListConfirm({ id }) {
    const list = store.list(id);
    if (!list) return;
    const used = store.eventsUsingList(id).length;
    modal = {
      type: 'confirm',
      title: `Delete the list ${list.name}?`,
      message: `Its ${S.plural(list.boats.length, 'boat')} will be removed from the list.${used ? ` ${S.plural(used, 'event')} used it; they keep their boats and results, but new boats in them won't be saved to any list until you pick another in the event's Settings.` : ''}`,
      confirmLabel: 'Delete List',
      danger: true,
      action: 'deleteList',
      data: { id },
    };
  },
  deleteList({ id }) {
    store.deleteList(id);
    if (ui.lastListId === id) ui.lastListId = null;
  },

  // Boat grid
  fleetChooseList({ id }) {
    ui.fleet.listId = id;
    ui.fleet.selected = [];
  },
  fleetTap({ id }) {
    const f = ui.fleet;
    if (f.mode === 'manage') {
      actions.fleetEdit({ id });
      return;
    }
    f.selected = f.selected.includes(id) ? f.selected.filter((x) => x !== id) : [...f.selected, id];
  },
  fleetMenu({ id }) {
    const boat = store.sortedBoats(ui.fleet.listId).find((b) => b.id === id);
    if (!boat) return;
    modal = {
      type: 'menu',
      title: `Sail ${boat.sailNumber}${boat.name ? ` · ${boat.name}` : ''}`,
      items: [
        { label: 'Edit Details', action: 'fleetEdit', data: { id } },
        { label: 'Delete from Boat List', action: 'listBoatDeleteConfirm', data: { id }, danger: true },
      ],
    };
  },
  fleetEdit({ id }) {
    const boat = store.sortedBoats(ui.fleet.listId).find((b) => b.id === id);
    if (boat) openBoatEditor({ target: 'list', listId: ui.fleet.listId, boat });
  },
  listBoatDeleteConfirm({ id }) {
    const boat = store.sortedBoats(ui.fleet.listId).find((b) => b.id === id);
    if (!boat) return;
    modal = {
      type: 'confirm',
      title: `Delete ${boat.sailNumber} from ${listName(ui.fleet.listId)}?`,
      message: 'Its results in past events are kept.',
      confirmLabel: 'Delete from Boat List',
      danger: true,
      action: 'listBoatDelete',
      data: { id },
    };
  },
  listBoatDelete({ id }) {
    store.deleteListBoat(ui.fleet.listId, id);
    ui.fleet.selected = ui.fleet.selected.filter((x) => x !== id);
  },
  fleetSelectAll() {
    ui.fleet.selected = fleetBoatsShown().map((b) => b.id);
  },
  fleetClear() {
    ui.fleet.selected = [];
  },
  fleetAddNew() {
    openBoatEditor({ target: 'list', listId: ui.fleet.listId });
  },
  fleetCancel() {
    leaveFleet();
  },
  fleetConfirm() {
    const f = ui.fleet;
    const selected = new Set(f.selected);
    const chosen = fleetBoatsShown().filter((b) => selected.has(b.id));
    if (f.mode === 'newEvent') {
      const id = store.createEvent(f.name || today(), f.listId, chosen);
      ui.lastListId = f.listId;
      ui.fleet = null;
      goEvent(id, 'races');
    } else if (f.mode === 'addToEvent') {
      store.mutate(f.eventId, (ev) => chosen.forEach((b) => S.ensureCompetitor(ev, b.sailNumber, b.name)));
      leaveFleet();
    } else {
      leaveFleet();
    }
  },

  // Event screen
  tab({ tab }) {
    ui.tab = tab;
  },
  shareMenu() {
    modal = {
      type: 'menu',
      title: 'Share Results',
      message: 'The PDF can also be printed from the share sheet.',
      items: [
        { label: 'Results as PDF', action: 'sharePDF' },
        { label: 'Results as CSV (Excel, Numbers)', action: 'shareCSV' },
      ],
    };
  },
  sharePDF() {
    const ev = currentEvent();
    if (!ev) return;
    shareFile(resultsPDF(ev), `${fileSafeName(ev.name)} results.pdf`, 'application/pdf').catch((err) => showFlash(`Couldn't share: ${err.message}`, 'error'));
  },
  shareCSV() {
    const ev = currentEvent();
    if (!ev) return;
    shareFile(resultsCSV(ev), `${fileSafeName(ev.name)} results.csv`, 'text/csv').catch((err) => showFlash(`Couldn't share: ${err.message}`, 'error'));
  },
  startRace() {
    const ev = currentEvent();
    if (!ev) return;
    const raceId = store.mutate(ev.id, (e) => S.addRace(e));
    ui.screen = 'race';
    ui.raceId = raceId;
    pendingCode = null;
    raceMessage = null;
  },
  openRace({ id }) {
    ui.screen = 'race';
    ui.raceId = id;
    pendingCode = null;
    raceMessage = null;
  },
  addFromList() {
    const ev = currentEvent();
    if (!ev) return;
    if (!store.list(ev.listId)) {
      showFlash('This event’s boat list was deleted. Pick another list in Settings.', 'error');
      return;
    }
    openFleet('addToEvent', { listId: ev.listId, eventId: ev.id, back: 'event' });
  },
  addEventBoat() {
    const ev = currentEvent();
    if (ev) openBoatEditor({ target: 'event', eventId: ev.id });
  },
  editEventBoat({ id }) {
    const ev = currentEvent();
    const boat = ev && S.competitorById(ev, id);
    if (boat) openBoatEditor({ target: 'event', eventId: ev.id, boat });
  },
  removeEventBoatConfirm({ id }) {
    const ev = currentEvent();
    const boat = ev && S.competitorById(ev, id);
    if (!boat) return;
    modal = {
      type: 'confirm',
      title: `Remove ${boat.sailNumber} from this event?`,
      message: 'Its results in every race of this event will be deleted. It stays in the boat list.',
      confirmLabel: 'Remove from Event',
      danger: true,
      action: 'removeEventBoat',
      data: { id },
    };
  },
  removeEventBoat({ id }) {
    const ev = currentEvent();
    if (ev) store.mutate(ev.id, (e) => S.removeCompetitor(e, id));
  },
  setting({ key, delta }) {
    const ev = currentEvent();
    if (!ev) return;
    const limits = { racesPerDiscard: [0, 20], penaltyPoints: [0, 10] }[key];
    if (!limits) return;
    store.mutate(ev.id, (e) => {
      e.settings[key] = Math.min(limits[1], Math.max(limits[0], e.settings[key] + Number(delta)));
    });
  },
  setEventList({ id }) {
    const ev = currentEvent();
    if (ev) store.mutate(ev.id, (e) => (e.listId = id));
  },

  // Race screen
  backToEvent() {
    if (ui.eventId) goEvent(ui.eventId, 'races');
  },
  pendingCode({ code }) {
    pendingCode = code || null;
  },
  recordFinish({ id }) {
    const ev = currentEvent();
    if (!ev) return;
    store.mutate(ev.id, (e) => S.appendFinish(e, ui.raceId, id, pendingCode));
    pendingCode = null;
    raceMessage = null;
    scrollFinishToEnd = true;
  },
  undoFinish() {
    const ev = currentEvent();
    if (ev) store.mutate(ev.id, (e) => S.removeLastFinish(e, ui.raceId));
    raceMessage = null;
  },
  finishMenu({ id }) {
    const ev = currentEvent();
    const race = ev && S.raceById(ev, ui.raceId);
    const index = race ? race.entries.findIndex((e) => e.id === id) : -1;
    if (index < 0) return;
    const entry = race.entries[index];
    const boat = S.competitorById(ev, entry.competitorId);
    const items = [
      { label: 'Finished', action: 'setFinishCode', data: { id, code: '' }, checked: !entry.code },
      ...S.PENALTY_CODES.map((code) => ({
        label: `${code}, ${S.CODE_EXPLANATIONS[code]}`,
        action: 'setFinishCode',
        data: { id, code },
        checked: entry.code === code,
      })),
    ];
    if (index > 0) items.push({ label: 'Move Up', action: 'moveFinish', data: { id, delta: -1 } });
    if (index < race.entries.length - 1) items.push({ label: 'Move Down', action: 'moveFinish', data: { id, delta: 1 } });
    items.push({ label: 'Remove from Race', action: 'removeFinish', data: { id }, danger: true });
    modal = { type: 'menu', title: `Sail ${boat ? boat.sailNumber : '?'}${boat && boat.name ? ` · ${boat.name}` : ''}`, items };
  },
  setFinishCode({ id, code }) {
    const ev = currentEvent();
    if (ev) store.mutate(ev.id, (e) => S.setCode(e, ui.raceId, id, code || null));
  },
  moveFinish({ id, delta }) {
    const ev = currentEvent();
    if (ev) store.mutate(ev.id, (e) => S.moveFinish(e, ui.raceId, id, Number(delta)));
  },
  removeFinish({ id }) {
    const ev = currentEvent();
    if (ev) store.mutate(ev.id, (e) => S.removeFinish(e, ui.raceId, id));
  },
  raceMenu() {
    const ev = currentEvent();
    if (!ev) return;
    modal = {
      type: 'menu',
      title: `Race ${S.raceNumber(ev, ui.raceId)}`,
      items: [{ label: 'Delete Race', action: 'deleteRaceConfirm', danger: true }],
    };
  },
  deleteRaceConfirm() {
    const ev = currentEvent();
    if (!ev) return;
    modal = {
      type: 'confirm',
      title: `Delete Race ${S.raceNumber(ev, ui.raceId)}?`,
      message: 'Its finish order will be deleted and the races after it are renumbered.',
      confirmLabel: 'Delete Race',
      danger: true,
      action: 'deleteRace',
    };
  },
  deleteRace() {
    const ev = currentEvent();
    if (!ev) return;
    store.mutate(ev.id, (e) => S.deleteRace(e, ui.raceId));
    goEvent(ev.id, 'races');
  },

  // Boat editor
  boatSaveAnother() {
    readBoatFields();
    if (saveBoatEditor()) {
      openBoatEditor({ target: modal.target, listId: modal.listId, eventId: modal.eventId });
    }
  },
  // Backup
  backup() {
    const date = new Date().toISOString().slice(0, 10);
    shareFile(store.backupJSON(), `Regatta Scorer backup ${date}.json`, 'application/json')
      .then((result) => {
        if (result !== 'cancelled') showFlash('Backup saved.');
      })
      .catch((err) => showFlash(`Couldn't save the backup: ${err.message}`, 'error'));
  },
  restoreConfirm() {
    modal = {
      type: 'confirm',
      title: 'Restore a backup?',
      message: 'Everything on this device (all events and boat lists) is replaced by the backup file you pick next.',
      confirmLabel: 'Choose Backup File',
      action: 'restorePick',
    };
  },
  restorePick() {
    const input = document.getElementById('restore-file');
    if (input) input.click();
  },
};

/** Copies the boat editor's fields into its state before re-rendering. */
function readBoatFields() {
  const sail = document.getElementById('boat-sail');
  const name = document.getElementById('boat-name');
  if (sail) modal.sail = sail.value;
  if (name) modal.name = name.value;
}

const forms = {
  addSail(form) {
    const ev = currentEvent();
    const race = ev && S.raceById(ev, ui.raceId);
    if (!race) return;
    const sail = S.normalizeSail(form.elements.sail.value);
    focusAfterRender = 'sail-input';
    if (!sail) return;
    const existing = S.competitorBySail(ev, sail);
    if (existing && race.entries.some((e) => e.competitorId === existing.id)) {
      raceMessage = `Sail number ${sail} is already in this race.`;
      return;
    }
    const known = store.knownName(ev.listId, sail) || '';
    const code = pendingCode;
    store.mutate(ev.id, (e) => {
      const id = S.ensureCompetitor(e, sail, known);
      S.appendFinish(e, race.id, id, code);
    });
    raceMessage = existing ? null : `Added new boat ${sail}${known ? ` (${known})` : ''} to the event.`;
    pendingCode = null;
    scrollFinishToEnd = true;
  },
  boat() {
    readBoatFields();
    if (saveBoatEditor()) modal = null;
  },
  prompt() {
    const value = (document.getElementById('prompt-input') || {}).value || '';
    const m = modal;
    modal = null;
    if (m.submit === 'renameEvent') {
      const name = value.trim();
      if (name) store.mutate(m.id, (ev) => (ev.name = name));
    } else if (m.submit === 'renameList') {
      store.renameList(m.id, value);
    } else if (m.submit === 'newList') {
      const id = store.createList(value);
      if (m.from === 'newEvent' && ui.fleet) {
        ui.fleet.listId = id;
        ui.fleet.selected = [];
      } else {
        openFleet('manage', { listId: id, back: 'lists' });
      }
    }
  },
};

const inputs = {
  fleetName(value) {
    if (ui.fleet) ui.fleet.name = value;
    saveUi();
  },
  eventName(value) {
    const ev = currentEvent();
    const name = value.trim();
    if (!ev || !name) return;
    store.mutate(ev.id, (e) => (e.name = name));
    const title = root.querySelector('.bar-title');
    if (title) title.textContent = name;
  },
  boatSail(value) {
    const m = modal;
    m.sail = value;
    m.error = null;
    if (!m.boatId && (m.name === '' || m.autoFilled)) {
      const known = store.knownName(boatEditorListId(m), value);
      const nameInput = document.getElementById('boat-name');
      if (known) {
        m.name = known;
        m.autoFilled = true;
      } else if (m.autoFilled) {
        m.name = '';
        m.autoFilled = false;
      }
      if (nameInput) nameInput.value = m.name;
    }
    const note = document.getElementById('boat-note');
    if (note) {
      note.className = 'note';
      note.textContent = m.autoFilled ? 'Name filled in from the boat list.' : '';
    }
  },
  boatName(value) {
    modal.name = value;
    modal.autoFilled = false;
  },
  prompt(value) {
    modal.value = value;
  },
};

function afterAction() {
  if (store.saveError) {
    showFlash('Couldn’t save on this device. The storage may be full; save a backup now.', 'error');
  }
  render();
}

// ---------- Event wiring ----------

let longPress = null;
let suppressClick = false;

document.addEventListener('pointerdown', (e) => {
  suppressClick = false;
  const el = e.target.closest('[data-longpress]');
  if (!el) return;
  const start = { x: e.clientX, y: e.clientY };
  longPress = {
    start,
    timer: setTimeout(() => {
      longPress = null;
      suppressClick = true;
      if (navigator.vibrate) navigator.vibrate(10);
      const fn = actions[el.dataset.longpress];
      if (fn) {
        fn({ ...el.dataset });
        afterAction();
      }
    }, 500),
  };
});

function cancelLongPress() {
  if (longPress) {
    clearTimeout(longPress.timer);
    longPress = null;
  }
}

document.addEventListener('pointerup', cancelLongPress);
document.addEventListener('pointercancel', cancelLongPress);
document.addEventListener('pointermove', (e) => {
  if (longPress && Math.hypot(e.clientX - longPress.start.x, e.clientY - longPress.start.y) > 10) cancelLongPress();
});
document.addEventListener('contextmenu', (e) => {
  if (e.target.closest('[data-longpress]')) e.preventDefault();
});

document.addEventListener('click', (e) => {
  if (suppressClick) {
    suppressClick = false;
    e.preventDefault();
    e.stopPropagation();
    return;
  }
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  if (el.dataset.action === 'backdrop' && e.target !== el) return;
  e.preventDefault();
  if (el.dataset.close) modal = null;
  const fn = actions[el.dataset.action];
  if (fn) {
    fn({ ...el.dataset });
    afterAction();
  }
});

document.addEventListener('submit', (e) => {
  const form = e.target.closest('[data-form]');
  if (!form) return;
  e.preventDefault();
  const fn = forms[form.dataset.form];
  if (fn) {
    fn(form);
    afterAction();
  }
});

document.addEventListener('input', (e) => {
  const el = e.target.closest('[data-input]');
  if (!el) return;
  const fn = inputs[el.dataset.input];
  if (fn) fn(el.value, el);
});

document.addEventListener('change', (e) => {
  if (e.target.id !== 'restore-file') return;
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;
  file
    .text()
    .then((text) => {
      store.restoreJSON(text);
      ui = { screen: 'home', tab: 'ranking', lastListId: null };
      modal = null;
      showFlash('Backup restored.');
      afterAction();
    })
    .catch((err) => showFlash(`Couldn't restore: ${err.message}`, 'error'));
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && modal) {
    modal = null;
    render();
  }
  // Return in the sail number field moves on to the name instead of saving.
  if (e.key === 'Enter' && e.target.id === 'boat-sail') {
    e.preventDefault();
    const name = document.getElementById('boat-name');
    if (name) name.focus();
  }
});

// ---------- Keep the screen on while entering a race ----------

let wakeLock = null;
let wakeLockPending = false;

async function updateWakeLock() {
  const want = ui.screen === 'race' && document.visibilityState === 'visible';
  if (want && !wakeLock && !wakeLockPending && 'wakeLock' in navigator) {
    wakeLockPending = true;
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => {
        wakeLock = null;
      });
    } catch {
      /* not supported here; the screen may dim */
    } finally {
      wakeLockPending = false;
    }
  } else if (!want && wakeLock) {
    wakeLock.release().catch(() => {});
    wakeLock = null;
  }
}

document.addEventListener('visibilitychange', updateWakeLock);

// ---------- Offline support ----------

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('Offline support unavailable', err));
  });
}

render();
