// Minimal iCalendar parser: VEVENT properties + basic RRULE expansion.
// Covers common cases — not a full RFC 5545 implementation.

const WEEKDAY_MAP = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

function unfoldLines(text) {
  const rawLines = text.split(/\r\n|\n|\r/);
  const lines = [];
  for (const line of rawLines) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && lines.length > 0) {
      lines[lines.length - 1] += line.slice(1);
    } else if (line.length > 0) {
      lines.push(line);
    }
  }
  return lines;
}

function parseLine(line) {
  const colonIdx = line.indexOf(":");
  if (colonIdx === -1) return null;
  const left = line.slice(0, colonIdx);
  const value = line.slice(colonIdx + 1);
  const parts = left.split(";");
  const name = parts[0].toUpperCase();
  const params = {};
  for (let i = 1; i < parts.length; i++) {
    const eq = parts[i].indexOf("=");
    if (eq === -1) continue;
    params[parts[i].slice(0, eq).toUpperCase()] = parts[i].slice(eq + 1);
  }
  return { name, params, value };
}

function unescapeText(str) {
  return str.replace(/\\n/gi, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\");
}

function parseDateValue(rawValue, params) {
  const value = rawValue.trim();
  if (params && params.VALUE === "DATE") {
    const y = +value.slice(0, 4), mo = +value.slice(4, 6), d = +value.slice(6, 8);
    return { date: new Date(y, mo - 1, d), allDay: true };
  }
  const m = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/);
  if (m) {
    const [, y, mo, d, h, mi, s, z] = m;
    if (z) {
      return { date: new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s)), allDay: false };
    }
    return { date: new Date(+y, +mo - 1, +d, +h, +mi, +s), allDay: false };
  }
  if (/^\d{8}$/.test(value)) {
    const y = +value.slice(0, 4), mo = +value.slice(4, 6), d = +value.slice(6, 8);
    return { date: new Date(y, mo - 1, d), allDay: true };
  }
  return { date: new Date(value), allDay: false };
}

function addDays(date, n) {
  const d = new Date(date.getTime());
  d.setDate(d.getDate() + n);
  return d;
}

function addMonths(date, n) {
  const d = new Date(date.getTime());
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  const daysInTarget = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, daysInTarget));
  return d;
}

function addYears(date, n) {
  return addMonths(date, n * 12);
}

function startOfWeek(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() - d.getDay());
  return d;
}

/** Parse ICS text into a flat list of VEVENTs. */
export function parseICS(icsText) {
  const lines = unfoldLines(icsText);
  const events = [];
  let current = null;

  for (const rawLine of lines) {
    const parsed = parseLine(rawLine);
    if (!parsed) continue;
    const { name, params, value } = parsed;

    if (name === "BEGIN" && value === "VEVENT") {
      current = {
        uid: null,
        summary: "",
        location: "",
        start: null,
        end: null,
        allDay: false,
        rrule: null,
        exdates: [],
      };
      continue;
    }
    if (name === "END" && value === "VEVENT") {
      if (current && current.start) events.push(current);
      current = null;
      continue;
    }
    if (!current) continue;

    switch (name) {
      case "UID":
        current.uid = value;
        break;
      case "SUMMARY":
        current.summary = unescapeText(value);
        break;
      case "LOCATION":
        current.location = unescapeText(value);
        break;
      case "DTSTART": {
        const { date, allDay } = parseDateValue(value, params);
        current.start = date;
        current.allDay = allDay;
        break;
      }
      case "DTEND": {
        const { date } = parseDateValue(value, params);
        current.end = date;
        break;
      }
      case "RRULE":
        current.rrule = value;
        break;
      case "EXDATE":
        for (const v of value.split(",")) {
          const { date } = parseDateValue(v, params);
          current.exdates.push(date.getTime());
        }
        break;
      default:
        break;
    }
  }

  for (const ev of events) {
    if (!ev.end) {
      ev.end = ev.allDay ? addDays(ev.start, 1) : new Date(ev.start.getTime());
    }
  }
  return events;
}

function parseRRule(rruleStr) {
  const parts = {};
  for (const kv of rruleStr.split(";")) {
    const [k, v] = kv.split("=");
    if (k && v) parts[k.toUpperCase()] = v;
  }
  return {
    freq: parts.FREQ,
    interval: parts.INTERVAL ? parseInt(parts.INTERVAL, 10) : 1,
    count: parts.COUNT ? parseInt(parts.COUNT, 10) : null,
    until: parts.UNTIL ? parseDateValue(parts.UNTIL, {}).date : null,
    byday: parts.BYDAY ? parts.BYDAY.split(",").map((d) => d.trim()) : null,
  };
}

function matchesByDay(date, byday) {
  if (!byday) return true;
  const dow = date.getDay();
  return byday.some((code) => {
    const letters = code.replace(/^[+-]?\d*/, "");
    return WEEKDAY_MAP[letters] === dow;
  });
}

const MAX_ITER = 2000;

function generateOccurrenceDates(dtstart, rule, rangeEnd) {
  const dates = [];

  if (rule.freq === "WEEKLY" && rule.byday && rule.byday.length) {
    const weekStart = startOfWeek(dtstart);
    let cursor = new Date(dtstart.getTime());
    let count = 0;
    let iter = 0;
    while (iter < MAX_ITER && cursor < rangeEnd) {
      iter++;
      if (rule.until && cursor > rule.until) break;
      if (rule.count && count >= rule.count) break;
      const weeksSince = Math.round((startOfWeek(cursor) - weekStart) / (7 * 86400000));
      if (weeksSince % rule.interval === 0 && cursor >= dtstart && matchesByDay(cursor, rule.byday)) {
        dates.push(new Date(cursor.getTime()));
        count++;
      }
      cursor = addDays(cursor, 1);
    }
    return dates;
  }

  let cursor = new Date(dtstart.getTime());
  let count = 0;
  let iter = 0;
  while (iter < MAX_ITER && cursor < rangeEnd) {
    iter++;
    if (rule.until && cursor > rule.until) break;
    if (rule.count && count >= rule.count) break;
    dates.push(new Date(cursor.getTime()));
    count++;
    if (rule.freq === "DAILY") cursor = addDays(cursor, rule.interval);
    else if (rule.freq === "WEEKLY") cursor = addDays(cursor, 7 * rule.interval);
    else if (rule.freq === "MONTHLY") cursor = addMonths(cursor, rule.interval);
    else if (rule.freq === "YEARLY") cursor = addYears(cursor, rule.interval);
      else break; // unsupported FREQ — treat as single occurrence
  }
  return dates;
}

function toOccurrence(ev, start, end) {
  return { uid: ev.uid, summary: ev.summary, location: ev.location, allDay: ev.allDay, start, end };
}

/**
 * Expand VEVENTs (including recurring) into concrete occurrences
 * in [rangeStart, rangeEnd). Supports DAILY/WEEKLY/MONTHLY/YEARLY
 * with INTERVAL, COUNT, UNTIL, and simple BYDAY.
 */
export function expandEvents(events, rangeStart, rangeEnd) {
  const occurrences = [];
  for (const ev of events) {
    const duration = ev.end.getTime() - ev.start.getTime();

    if (!ev.rrule) {
      if (ev.end > rangeStart && ev.start < rangeEnd) {
        occurrences.push(toOccurrence(ev, ev.start, ev.end));
      }
      continue;
    }

    const rule = parseRRule(ev.rrule);
    const scanEnd = rule.until && rule.until < rangeEnd ? new Date(rule.until.getTime() + 86400000) : rangeEnd;
    const dates = generateOccurrenceDates(ev.start, rule, scanEnd);
    for (const occStart of dates) {
      if (ev.exdates.includes(occStart.getTime())) continue;
      const occEnd = new Date(occStart.getTime() + duration);
      if (occEnd > rangeStart && occStart < rangeEnd) {
        occurrences.push(toOccurrence(ev, occStart, occEnd));
      }
    }
  }
  occurrences.sort((a, b) => a.start - b.start);
  return occurrences;
}
