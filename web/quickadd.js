/* Natural-Language-Parser für die Schnellerfassung (Deutsch, best effort).
   "ENSIS Präsentation fertig machen morgen 14 Uhr P1" wird zerlegt in
   { title, due_date, due_time, priority } - Datum/Zeit/Priorität werden aus
   dem Text entfernt, der Rest bleibt der Titel. Nutzer kann jedes erkannte
   Feld danach im Task-Detail noch korrigieren. */

const QuickAdd = (() => {
  const WEEKDAYS = {
    sonntag: 0,
    montag: 1,
    dienstag: 2,
    mittwoch: 3,
    donnerstag: 4,
    freitag: 5,
    samstag: 6,
    sonnabend: 6,
  };

  // JS \b kennt nur ASCII-Wortzeichen - vor/nach Umlauten (ü, ö, ä) liefert
  // \b keine Wortgrenze. Deshalb eigene, Unicode-fähige Grenzen per Lookaround.
  function wb(pattern) {
    return `(?<![\\p{L}\\p{N}_])(?:${pattern})(?![\\p{L}\\p{N}_])`;
  }

  function reWB(pattern, flags = 'i') {
    return new RegExp(wb(pattern), flags.includes('u') ? flags : flags + 'u');
  }

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  function toISODate(d) {
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }

  function addDays(base, days) {
    const d = new Date(base);
    d.setDate(d.getDate() + days);
    return d;
  }

  function nextWeekday(base, targetDow, skipCurrentWeek) {
    const todayDow = base.getDay();
    let diff = (targetDow - todayDow + 7) % 7;
    if (diff === 0) diff = 7;
    if (skipCurrentWeek) diff += 7;
    return addDays(base, diff);
  }

  const WEEKDAY_ALTERNATION = 'montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonnabend|sonntag';

  function extractDate(text, today) {
    const patterns = [
      { re: reWB('übermorgen'), resolve: () => addDays(today, 2) },
      { re: reWB('heute'), resolve: () => today },
      { re: reWB('morgen'), resolve: () => addDays(today, 1) },
      {
        re: reWB(`nächste[nr]?\\s+woche\\s+(${WEEKDAY_ALTERNATION})`),
        resolve: (m) => nextWeekday(today, WEEKDAYS[m[1].toLowerCase()], true),
      },
      {
        re: reWB(`nächste[nr]?\\s+(${WEEKDAY_ALTERNATION})`),
        resolve: (m) => nextWeekday(today, WEEKDAYS[m[1].toLowerCase()], true),
      },
      {
        re: reWB(`(${WEEKDAY_ALTERNATION})`),
        resolve: (m) => nextWeekday(today, WEEKDAYS[m[1].toLowerCase()], false),
      },
      {
        re: reWB('in\\s+(\\d+)\\s+wochen'),
        resolve: (m) => addDays(today, 7 * parseInt(m[1], 10)),
      },
      {
        re: reWB('in\\s+(\\d+)\\s+tagen'),
        resolve: (m) => addDays(today, parseInt(m[1], 10)),
      },
      {
        // Datumsangabe wie 20.08. oder 20.08.2026 - bewusst ohne Zeitformat-Überschneidung
        // (Uhrzeiten werden ausschliesslich mit ':' erkannt, nie mit '.').
        re: reWB('(\\d{1,2})\\.(\\d{1,2})\\.(\\d{4})?'),
        resolve: (m) => {
          const day = parseInt(m[1], 10);
          const month = parseInt(m[2], 10) - 1;
          const year = m[3] ? parseInt(m[3], 10) : today.getFullYear();
          return new Date(year, month, day);
        },
      },
    ];

    for (const p of patterns) {
      const m = text.match(p.re);
      if (m) {
        const date = p.resolve(m);
        return { date, remainder: text.replace(p.re, ' ') };
      }
    }
    return { date: null, remainder: text };
  }

  function extractTime(text) {
    const patterns = [
      reWB('([01]?\\d|2[0-3]):([0-5]\\d)\\s*(?:uhr)?'),
      reWB('([01]?\\d|2[0-3])\\s*uhr'),
    ];
    for (const re of patterns) {
      const m = text.match(re);
      if (m) {
        const hh = pad2(parseInt(m[1], 10));
        const mm = pad2(m[2] ? parseInt(m[2], 10) : 0);
        return { time: `${hh}:${mm}`, remainder: text.replace(re, ' ') };
      }
    }
    return { time: null, remainder: text };
  }

  function extractPriority(text) {
    const re = reWB('p([1-4])');
    const m = text.match(re);
    if (m) {
      return { priority: parseInt(m[1], 10), remainder: text.replace(re, ' ') };
    }
    return { priority: null, remainder: text };
  }

  function cleanTitle(text) {
    return text
      .replace(/\s+/g, ' ')
      .replace(/^[\s,.-]+|[\s,.-]+$/g, '')
      .trim();
  }

  /** Zerlegt eine Quick-Add-Eingabe. `today` optional (Testbarkeit). */
  function parse(text, today = new Date()) {
    const anchor = new Date(today.getFullYear(), today.getMonth(), today.getDate());

    const priorityResult = extractPriority(text);
    const dateResult = extractDate(priorityResult.remainder, anchor);
    const timeResult = extractTime(dateResult.remainder);

    return {
      title: cleanTitle(timeResult.remainder),
      due_date: dateResult.date ? toISODate(dateResult.date) : null,
      due_time: timeResult.time,
      priority: priorityResult.priority,
    };
  }

  return { parse };
})();
