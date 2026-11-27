// Data model and low-point scoring. No browser APIs, so it can be tested on its own.

export const PENALTY_CODES = ['OCS', 'DSQ', 'DNS', 'DNF'];

export const CODE_EXPLANATIONS = {
  OCS: 'on course side at the start',
  DSQ: 'disqualified',
  DNS: 'did not start',
  DNF: 'did not finish',
};

export function newId() {
  if (globalThis.crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

export function normalizeSail(raw) {
  return String(raw ?? '').trim().toUpperCase();
}

/** Sail numbers sort as numbers: 9 before 10. */
export function compareSail(a, b) {
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}

export function sortBoats(boats) {
  return [...boats].sort((a, b) => compareSail(a.sailNumber, b.sailNumber));
}

export function createEvent(name) {
  return {
    id: newId(),
    name,
    createdAt: new Date().toISOString(),
    competitors: [],
    races: [],
    settings: { racesPerDiscard: 4, penaltyPoints: 1 },
  };
}

// ---------- Lookups ----------

export function competitorById(event, id) {
  return event.competitors.find((c) => c.id === id) || null;
}

export function competitorBySail(event, raw) {
  const sail = normalizeSail(raw);
  return event.competitors.find((c) => c.sailNumber === sail) || null;
}

export function raceById(event, raceId) {
  return event.races.find((r) => r.id === raceId) || null;
}

export function raceNumber(event, raceId) {
  return event.races.findIndex((r) => r.id === raceId) + 1;
}

export function isSailed(race) {
  return race.entries.length > 0;
}

export function sailedRaceCount(event) {
  return event.races.filter(isSailed).length;
}

// ---------- Changes (they modify the event in place) ----------

/** Returns the competitor with this sail number, adding them if new. */
export function ensureCompetitor(event, rawSail, name = '') {
  const sail = normalizeSail(rawSail);
  if (!sail) return null;
  const existing = competitorBySail(event, sail);
  if (existing) return existing.id;
  const competitor = { id: newId(), sailNumber: sail, name: String(name).trim() };
  event.competitors.push(competitor);
  return competitor.id;
}

/** Adds (id null) or edits a competitor. False if the sail number is empty or taken. */
export function upsertCompetitor(event, id, rawSail, name) {
  const sail = normalizeSail(rawSail);
  if (!sail) return false;
  if (event.competitors.some((c) => c.sailNumber === sail && c.id !== id)) return false;
  const cleanName = String(name ?? '').trim();
  const existing = id ? competitorById(event, id) : null;
  if (existing) {
    existing.sailNumber = sail;
    existing.name = cleanName;
  } else {
    event.competitors.push({ id: newId(), sailNumber: sail, name: cleanName });
  }
  return true;
}

/** Removes a boat and all its results in this event. */
export function removeCompetitor(event, id) {
  event.competitors = event.competitors.filter((c) => c.id !== id);
  for (const race of event.races) {
    race.entries = race.entries.filter((e) => e.competitorId !== id);
  }
}

export function addRace(event) {
  const race = { id: newId(), entries: [] };
  event.races.push(race);
  return race.id;
}

export function deleteRace(event, raceId) {
  event.races = event.races.filter((r) => r.id !== raceId);
}

/** Adds a boat to the end of the finish order. False if it's already in the race. */
export function appendFinish(event, raceId, competitorId, code = null) {
  const race = raceById(event, raceId);
  if (!race || race.entries.some((e) => e.competitorId === competitorId)) return false;
  race.entries.push({ id: newId(), competitorId, code: code || null });
  return true;
}

export function removeLastFinish(event, raceId) {
  const race = raceById(event, raceId);
  if (race) race.entries.pop();
}

export function removeFinish(event, raceId, entryId) {
  const race = raceById(event, raceId);
  if (race) race.entries = race.entries.filter((e) => e.id !== entryId);
}

/** Moves a finish-order line up (delta -1) or down (delta +1). */
export function moveFinish(event, raceId, entryId, delta) {
  const race = raceById(event, raceId);
  if (!race) return;
  const from = race.entries.findIndex((e) => e.id === entryId);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= race.entries.length) return;
  const [entry] = race.entries.splice(from, 1);
  race.entries.splice(to, 0, entry);
}

export function setCode(event, raceId, entryId, code) {
  const race = raceById(event, raceId);
  const entry = race && race.entries.find((e) => e.id === entryId);
  if (entry) entry.code = code || null;
}

// ---------- Scoring ----------

/** OCS, DSQ, DNS, DNF and boats missing from a race score this. */
export function penaltyScore(event) {
  return event.competitors.length + event.settings.penaltyPoints;
}

export function discardCount(racesSailed, settings) {
  if (!(settings.racesPerDiscard > 0)) return 0;
  return Math.floor(racesSailed / settings.racesPerDiscard);
}

/** Map of competitorId -> { points, code } for boats in the finish order. */
export function raceResults(race, penalty) {
  const results = new Map();
  let place = 0;
  for (const entry of race.entries) {
    if (results.has(entry.competitorId)) continue;
    if (entry.code) {
      results.set(entry.competitorId, { points: penalty, code: entry.code });
    } else {
      place += 1;
      results.set(entry.competitorId, { points: place, code: null });
    }
  }
  return results;
}

/** Place (or penalty code) for each finish-order line, keyed by entry id. */
export function placeLabels(race) {
  const labels = new Map();
  let place = 0;
  for (const entry of race.entries) {
    if (entry.code) {
      labels.set(entry.id, entry.code);
    } else {
      place += 1;
      labels.set(entry.id, String(place));
    }
  }
  return labels;
}

export function resultText(result) {
  if (!result.sailed) return '–';
  const base = result.code ? `${result.points} ${result.code}` : String(result.points);
  return result.discarded ? `(${base})` : base;
}

/**
 * Ranked rows: { competitor, rank, results: [{points, code, sailed, discarded}], total, nett }.
 * One result per race in the event's race order; races with no finishes don't count.
 */
export function ranking(event) {
  const penalty = penaltyScore(event);
  const perRace = event.races.map((race) => raceResults(race, penalty));
  const discards = discardCount(sailedRaceCount(event), event.settings);

  const rows = event.competitors.map((competitor) => {
    const results = event.races.map((race, i) => {
      if (!isSailed(race)) return { points: 0, code: null, sailed: false, discarded: false };
      const r = perRace[i].get(competitor.id) || { points: penalty, code: 'DNF' };
      return { points: r.points, code: r.code, sailed: true, discarded: false };
    });

    const sailedIdx = results.map((r, i) => (r.sailed ? i : -1)).filter((i) => i >= 0);
    // Worst scores first; between equal scores the earlier race is discarded.
    const worst = [...sailedIdx].sort((a, b) =>
      results[a].points !== results[b].points ? results[b].points - results[a].points : a - b
    );
    for (const i of worst.slice(0, discards)) results[i].discarded = true;

    const total = sailedIdx.reduce((sum, i) => sum + results[i].points, 0);
    const nett = sailedIdx.reduce((sum, i) => sum + (results[i].discarded ? 0 : results[i].points), 0);
    return { competitor, rank: 0, results, total, nett };
  });

  rows.sort((a, b) => compareRows(a, b) || compareSail(a.competitor.sailNumber, b.competitor.sailNumber));
  rows.forEach((row, i) => {
    row.rank = i > 0 && compareRows(rows[i - 1], row) === 0 ? rows[i - 1].rank : i + 1;
  });
  return rows;
}

/**
 * Negative if a ranks ahead of b, positive if behind, 0 if fully tied.
 * Ties on nett points follow the Racing Rules of Sailing, appendix A8: most
 * firsts, seconds, ... among counted results, then the last race, the one
 * before, and so on.
 */
export function compareRows(a, b) {
  if (a.nett !== b.nett) return a.nett - b.nett;

  const counted = (row) =>
    row.results.filter((r) => r.sailed && !r.discarded).map((r) => r.points).sort((x, y) => x - y);
  const ac = counted(a);
  const bc = counted(b);
  for (let i = 0; i < Math.min(ac.length, bc.length); i++) {
    if (ac[i] !== bc[i]) return ac[i] - bc[i];
  }

  for (let i = a.results.length - 1; i >= 0; i--) {
    const x = a.results[i];
    const y = b.results[i];
    if (x.sailed && x.points !== y.points) return x.points - y.points;
  }
  return 0;
}

export function plural(n, one, many = one + 's') {
  return `${n} ${n === 1 ? one : many}`;
}

export function scoringSummary(event) {
  const sailed = sailedRaceCount(event);
  const discards = discardCount(sailed, event.settings);
  const discardText = discards === 0 ? 'no discards' : plural(discards, 'discard');
  return `${plural(sailed, 'race')} sailed, ${discardText}. OCS, DSQ, DNS and DNF score ${penaltyScore(event)} points.`;
}
