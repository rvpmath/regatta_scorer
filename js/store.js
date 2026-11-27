// Keeps all events and the named boat lists, saved on the device after every change.

import * as S from './scoring.js';

const STORAGE_KEY = 'regatta-scorer.data.v1';
const BACKUP_FORMAT = 'regatta-scorer-backup';
const DEFAULT_LIST_NAME = 'Boat List';

export function createStore(storage) {
  let data = { events: [], lists: [] };

  function load() {
    try {
      const raw = storage.getItem(STORAGE_KEY);
      if (raw) data = validate(JSON.parse(raw));
    } catch (err) {
      console.error('Could not read saved data', err);
    }
    if (data.lists.length === 0) {
      data.lists.push(newList(DEFAULT_LIST_NAME));
    }
  }

  function save() {
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(data));
      store.saveError = null;
    } catch (err) {
      console.error('Could not save', err);
      store.saveError = err;
    }
  }

  /** Adds a boat to a list, or updates its name if the sail number is already there. */
  function recordInList(listId, boat) {
    const list = store.list(listId);
    if (!list) return;
    const existing = list.boats.find((b) => b.sailNumber === boat.sailNumber);
    if (existing) {
      if (boat.name) existing.name = boat.name;
    } else {
      list.boats.push({ id: S.newId(), sailNumber: boat.sailNumber, name: boat.name || '' });
    }
  }

  const store = {
    /** Set when the last save failed (for example, storage full). */
    saveError: null,

    get events() {
      return data.events;
    },

    event(id) {
      return data.events.find((e) => e.id === id) || null;
    },

    createEvent(name, listId, boats = []) {
      const event = S.createEvent(String(name).trim() || 'New Event');
      event.listId = store.list(listId) ? listId : data.lists[0].id;
      for (const boat of boats) S.ensureCompetitor(event, boat.sailNumber, boat.name);
      data.events.unshift(event);
      save();
      return event.id;
    },

    deleteEvent(id) {
      data.events = data.events.filter((e) => e.id !== id);
      save();
    },

    /**
     * Applies a change to one event and saves. Boats the change adds or
     * renames are recorded in the event's boat list only. Unrelated changes
     * never bring back a boat that was deleted from the list.
     */
    mutate(eventId, change) {
      const event = store.event(eventId);
      if (!event) return undefined;
      const key = (c) => c.sailNumber + '\u0000' + c.name;
      const before = new Set(event.competitors.map(key));
      const result = change(event);
      for (const c of event.competitors) {
        if (!before.has(key(c))) recordInList(event.listId, c);
      }
      save();
      return result;
    },

    // ----- Boat lists -----

    get lists() {
      return data.lists;
    },

    list(id) {
      return data.lists.find((l) => l.id === id) || null;
    },

    sortedBoats(listId) {
      const list = store.list(listId);
      return list ? S.sortBoats(list.boats) : [];
    },

    createList(name) {
      const list = newList(String(name).trim() || 'New List');
      data.lists.push(list);
      save();
      return list.id;
    },

    renameList(id, name) {
      const list = store.list(id);
      const clean = String(name).trim();
      if (!list || !clean) return;
      list.name = clean;
      save();
    },

    /** Deletes a list (never the last one). Events that used it keep their boats and results. */
    deleteList(id) {
      if (data.lists.length <= 1) return false;
      data.lists = data.lists.filter((l) => l.id !== id);
      save();
      return true;
    },

    eventsUsingList(id) {
      return data.events.filter((e) => e.listId === id);
    },

    boatBySail(listId, raw) {
      const list = store.list(listId);
      const sail = S.normalizeSail(raw);
      return (list && list.boats.find((b) => b.sailNumber === sail)) || null;
    },

    knownName(listId, raw) {
      const boat = store.boatBySail(listId, raw);
      return boat && boat.name ? boat.name : null;
    },

    /** Adds (id null) or edits a boat in a list. Returns its id, or null if the sail number is empty or taken. */
    saveListBoat(listId, id, rawSail, name) {
      const list = store.list(listId);
      const sail = S.normalizeSail(rawSail);
      if (!list || !sail) return null;
      if (list.boats.some((b) => b.sailNumber === sail && b.id !== id)) return null;
      const cleanName = String(name ?? '').trim();
      const existing = id ? list.boats.find((b) => b.id === id) : null;
      if (existing) {
        existing.sailNumber = sail;
        existing.name = cleanName;
        save();
        return existing.id;
      }
      const boat = { id: S.newId(), sailNumber: sail, name: cleanName };
      list.boats.push(boat);
      save();
      return boat.id;
    },

    deleteListBoat(listId, id) {
      const list = store.list(listId);
      if (!list) return;
      list.boats = list.boats.filter((b) => b.id !== id);
      save();
    },

    // ----- Backup -----

    backupJSON() {
      return JSON.stringify(
        { format: BACKUP_FORMAT, version: 2, savedAt: new Date().toISOString(), ...data },
        null,
        2
      );
    },

    /** Replaces everything with a backup. Throws if the file isn't a valid backup. */
    restoreJSON(text) {
      const parsed = JSON.parse(text);
      if (!parsed || parsed.format !== BACKUP_FORMAT) {
        throw new Error('This file is not a Regatta Scorer backup.');
      }
      data = validate(parsed);
      if (data.lists.length === 0) data.lists.push(newList(DEFAULT_LIST_NAME));
      save();
    },
  };

  load();
  return store;
}

function newList(name) {
  return { id: S.newId(), name, boats: [] };
}

/** Checks the shape of saved or restored data and fills in anything missing. */
function validate(parsed) {
  if (!parsed || !Array.isArray(parsed.events)) throw new Error('The data is damaged or incomplete.');
  const str = (v) => (typeof v === 'string' ? v : '');
  const boat = (b) => ({
    id: str(b && b.id) || S.newId(),
    sailNumber: S.normalizeSail(b && b.sailNumber),
    name: str(b && b.name),
  });
  const boats = (arr) => (Array.isArray(arr) ? arr : []).map(boat).filter((b) => b.sailNumber);

  let lists = (Array.isArray(parsed.lists) ? parsed.lists : []).map((l) => ({
    id: str(l && l.id) || S.newId(),
    name: str(l && l.name) || 'Boat List',
    boats: boats(l && l.boats),
  }));
  // A single "fleet" array is how a list was stored before named lists existed.
  if (lists.length === 0 && Array.isArray(parsed.fleet)) {
    lists = [{ id: S.newId(), name: DEFAULT_LIST_NAME, boats: boats(parsed.fleet) }];
  }

  const events = parsed.events.map((e) => ({
    id: str(e.id) || S.newId(),
    name: str(e.name) || 'Event',
    createdAt: str(e.createdAt) || new Date().toISOString(),
    listId: str(e.listId) || (lists[0] ? lists[0].id : ''),
    competitors: boats(e.competitors),
    races: (Array.isArray(e.races) ? e.races : []).map((r) => ({
      id: str(r && r.id) || S.newId(),
      entries: (Array.isArray(r && r.entries) ? r.entries : []).map((x) => ({
        id: str(x && x.id) || S.newId(),
        competitorId: str(x && x.competitorId),
        code: S.PENALTY_CODES.includes(x && x.code) ? x.code : null,
      })),
    })),
    settings: {
      racesPerDiscard: Number.isInteger(e.settings && e.settings.racesPerDiscard) ? e.settings.racesPerDiscard : 4,
      penaltyPoints: Number.isInteger(e.settings && e.settings.penaltyPoints) ? e.settings.penaltyPoints : 1,
    },
  }));
  return { events, lists };
}
