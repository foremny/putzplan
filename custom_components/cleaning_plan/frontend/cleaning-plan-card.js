/*
 * Cleaning plan card, shipped with the cleaning_plan integration.
 * The integration loads this file on every dashboard; no resource setup needed.
 *
 * Card config:
 *   type: custom:cleaning-plan-visit-card
 *   entry_id: <config entry id>   (optional, defaults to the first plan)
 *   title: Putzplan               (optional, defaults to the plan's name)
 *   allow_edit: true              (optional, false gives the cleaner view)
 *   column_width: 300             (optional, px; locations flow into as many columns as fit)
 *
 * Data comes from the websocket subscription cleaning_plan/subscribe. The
 * server owns parsing, storage and "today" (in the Home Assistant time zone).
 *
 * The plan editor has two views on the same plan:
 *   - Form: rhythm, start day, locations and tasks as inputs. Saving writes
 *     canonical plan text in the user's language and sends renames, so ticks
 *     follow renamed tasks.
 *   - Text: the raw plan text, validated on the server while typing.
 */

const CARD_VERSION = "0.9.0";
const CARD_TYPE = "cleaning-plan-visit-card";
const EDITOR_TYPE = "cleaning-plan-visit-card-editor";
const WS = "cleaning_plan";

const EXAMPLE_PLAN = `# Config
- rhythm: 2 weeks
- start day: 6.10.2026

# Schedule

## Ground floor

### Kitchen
- Counters, hob and sink
- Microwave inside (every 2. time)
- Fridge inside (every 4. time from 2)

## Upstairs

### Bathroom
- Toilet, sink, shower
- Descale taps (every 2. time from 2)
`;

const EXAMPLE_PLAN_DE = `# Config
- Rhythmus: 2 Wochen
- Starttag: 6.10.2026

# Schedule

## Erdgeschoss

### Küche
- Arbeitsflächen, Herd und Spüle
- Mikrowelle innen (alle 2. Mal)
- Kühlschrank innen (alle 4. Mal ab 2)

## Obergeschoss

### Bad
- Toilette, Waschbecken, Dusche
- Armaturen entkalken (alle 2. Mal ab 2)
`;

/* ---------- UI strings (picked from hass.locale.language, English fallback) ---------- */

const STRINGS = {
  en: {
    title: "Cleaning",
    example: EXAMPLE_PLAN,
    editPlan: "Edit plan",
    insertExample: "Insert example",
    cancel: "Cancel",
    save: "Save plan",
    hint:
      "Markdown: <code># Config</code> holds <code>- rhythm: 2 weeks</code> and <code>- start day: 6.10.2026</code>. " +
      "<code># Schedule</code> holds <code>## Floor</code> (optional), <code>### Room</code> and tasks as " +
      "<code>- Fridge (every 4. time from 2)</code>; without parentheses a task is due every time. " +
      "<code>from 2</code> starts a task on the 2nd visit, so big jobs don't land on the same day. " +
      "<code># Supplies</code> lists what the cleaner can report as missing. Comments: <code>&lt;!-- … --&gt;</code>.",
    loading: "Loading…",
    noPlans: "No cleaning plan yet. Add the Cleaning plan integration under Settings > Devices & services.",
    noPlan: "No plan yet. Select Edit plan to write one.",
    nothingDue: "Nothing due on this visit.",
    planProblems: "Plan has problems",
    couldNotLoad: "Could not load the cleaning plan",
    couldNotSave: "Could not save",
    couldNotSavePlan: "Could not save the plan",
    today: "Today",
    tomorrow: "Tomorrow",
    inDays: (n) => `In ${n} days`,
    daysAgo: (n) => `${n} days ago`,
    visit: (n) => `visit ${n}`,
    tapCurrent: "(tap for current)",
    prevVisit: "Previous visit",
    nextVisit: "Next visit",
    backToCurrent: "Back to the current visit",
    doneOf: (a, b) => `${a} of ${b} done`,
    collapseAll: "Collapse all",
    // feedback from the cleaner
    suppliesLabel: "Running out?",
    supplyMissing: "missing",
    reportProblem: "Report a problem",
    kinds: { skipped: "Couldn't do it", issue: "Problem" },
    notePh: "What's wrong? (optional)",
    send: "Send",
    withdraw: "Withdraw",
    feedbackTitle: (n) => `Feedback (${n})`,
    resolve: "Done",
    couldNotSend: "Could not send",
    expandAll: "Expand all",
    freqEvery: "every time",
    freqN: (n) => `every ${n}. time`,
    freqFrom: (s) => `, from ${s}.`,
    line: (ln, msg) => `Line ${ln}: ${msg}`,
    errors: {
      rhythm_min: "rhythm must be at least 1 day",
      start_invalid: "write the start day as 6.10.2026",
      start_missing: 'Add "- start day: 6.10.2026" under "# Config"',
      task_no_name: "task has no name",
      freq_invalid: 'write the frequency as "(every time)" or "(every 2. time)", optionally "(every 2. time from 2)"',
      floor_no_name: 'the floor needs a name after "##"',
      supply_no_name: "the supply has no name",
      room_no_name: 'the room needs a name after "###"',
      unknown_section: 'only "# Config" and "# Schedule" are allowed',
      unknown_setting: 'unknown setting; use "- rhythm: 2 weeks" or "- start day: 6.10.2026"',
      outside_section: 'this belongs under "# Config" or "# Schedule"',
      task_outside_room: 'the task needs a room above it ("### Kitchen")',
      heading_level: 'use "## Floor" and "### Room"; deeper headings are not allowed',
      unexpected_line: 'tasks start with "- "; other text is not allowed here',
      old_format:
        'The plan is in the old format. Since version 0.6 it is Markdown: "# Config" with the settings, ' +
        '"# Schedule" with "## Floor", "### Room" and tasks as "- Task (every 2. time)".',
    },
    // form editor
    tabForm: "Form",
    tabText: "Text",
    rhythm: "Cleaner comes every",
    weeks: "weeks",
    days: "days",
    startDay: "First visit",
    addLocation: "Add location",
    addTask: "Add task",
    addFloor: "Add floor",
    floorPh: "Floor, e.g. Ground floor",
    noFloorPh: "Without floor (optional: name it)",
    locCount: (n) => (n === 1 ? "1 location" : `${n} locations`),
    confirmDeleteFloor: (name, n) => `Delete the floor "${name}" with ${n} locations?`,
    locationPh: "Location, e.g. Kitchen",
    taskPh: "Task, e.g. Wipe the sink",
    every: "every",
    everyVisit: "visit",
    everyNth: ". visit",
    from: "starting with visit",
    taskCount: (n) => (n === 1 ? "1 task" : `${n} tasks`),
    suppliesTitle: "Supplies the cleaner can report as missing",
    supplyPh: "e.g. Bin bags",
    addSupply: "Add supply",
    moveUp: "Move up",
    moveDown: "Move down",
    remove: "Delete",
    confirmDeleteLoc: (name, n) => `Delete "${name}" with ${n} tasks?`,
    confirmDiscard: "Discard your changes?",
    commentsNote: "The plan text has comments. Saving from the form removes them; use the Text tab to keep them.",
    fixTextFirst: "Fix the errors in the text before switching to the form.",
    emptyForm: "No locations yet. Add the first one, then its tasks. Enter in a task adds the next one.",
    dueVisits: (list) => `Visits ${list} …`,
    nextDue: (date, v) => `next on ${date} (visit ${v})`,
    // schedule overview
    overview: "Overview",
    tabOverview: "Overview",
    back: "Back",
    ovIntro: "Tasks that are not due on every visit. Use this to spread heavy jobs evenly.",
    ovEditHint: "Tap an empty cell to move that task's turn to this visit; − and + change how often it is due.",
    ovMoreOften: "More often",
    ovLessOften: "Less often",
    ovNone: "Every task is due on every visit. Set a task to \"every 2. visit\" or more to plan it here.",
    ovVisit: "Visit",
    ovExtra: "Extra tasks",
    ovTotal: "All tasks",
    ovCycle: (n) => (n === 1 ? "" : `The schedule repeats every ${n} visits.`),
    ovCycleLong: (n, shown) => `The schedule repeats every ${n} visits; ${shown} are shown at a time.`,
    ovEarlier: "Earlier visits",
    ovLater: "Later visits",
    ovDue: "due",
    ovDone: "done",
    ovMoveHere: (v) => `Move to visit ${v}`,
    ovNeedsDates: "Set the rhythm and the first visit to see the overview.",
    formErrors: {
      rhythm: "The rhythm must be at least 1.",
      start: "Choose the date of the first visit.",
      locEmpty: "A location with tasks has no name.",
      nameHash: (n) => `"${n}" can't end with " #".`,
      floorEmpty: "A floor with locations has no name. Only the first floor may stay unnamed.",
      floorDup: (n) => `There are two floors called "${n}".`,
      supplyDup: (n) => `"${n}" is listed twice under supplies.`,
      locDup: (n) => `There are two locations called "${n}".`,
      taskDup: (loc, n) => `"${n}" appears twice in "${loc}".`,
      freq: (loc, n) => `"${n}" in "${loc}" needs whole numbers of at least 1.`,
    },
    editor: {
      entry_id: "Plan",
      title: "Title",
      allow_edit: "Allow editing (off gives the cleaner view)",
      column_width: "Minimum column width",
    },
  },
  de: {
    title: "Putzplan",
    example: EXAMPLE_PLAN_DE,
    editPlan: "Plan bearbeiten",
    insertExample: "Beispiel einfügen",
    cancel: "Abbrechen",
    save: "Plan speichern",
    hint:
      "Markdown: <code># Config</code> enthält <code>- Rhythmus: 2 Wochen</code> und <code>- Starttag: 6.10.2026</code>. " +
      "<code># Schedule</code> enthält <code>## Etage</code> (optional), <code>### Raum</code> und Aufgaben als " +
      "<code>- Kühlschrank (alle 4. Mal ab 2)</code>; ohne Klammer ist eine Aufgabe jedes Mal fällig. " +
      "Mit <code>ab 2</code> beginnt eine Aufgabe erst beim 2. Besuch, damit große Arbeiten nicht auf denselben Tag fallen. " +
      "<code># Supplies</code> listet Material, das die Putzkraft als fehlend melden kann. " +
      "Kommentare: <code>&lt;!-- … --&gt;</code>.",
    loading: "Lädt…",
    noPlans: "Noch kein Putzplan. Die Integration „Cleaning plan“ unter Einstellungen > Geräte & Dienste hinzufügen.",
    noPlan: "Noch kein Plan. Mit „Plan bearbeiten“ einen anlegen.",
    nothingDue: "Bei diesem Besuch ist nichts fällig.",
    planProblems: "Der Plan hat Fehler",
    couldNotLoad: "Putzplan konnte nicht geladen werden",
    couldNotSave: "Speichern fehlgeschlagen",
    couldNotSavePlan: "Plan konnte nicht gespeichert werden",
    today: "Heute",
    tomorrow: "Morgen",
    inDays: (n) => `In ${n} Tagen`,
    daysAgo: (n) => `Vor ${n} Tagen`,
    visit: (n) => `Besuch ${n}`,
    tapCurrent: "(tippen für aktuell)",
    prevVisit: "Vorheriger Besuch",
    nextVisit: "Nächster Besuch",
    backToCurrent: "Zurück zum aktuellen Besuch",
    doneOf: (a, b) => `${a} von ${b} erledigt`,
    collapseAll: "Alle einklappen",
    suppliesLabel: "Fehlt etwas?",
    supplyMissing: "fehlt",
    reportProblem: "Problem melden",
    kinds: { skipped: "Nicht geschafft", issue: "Problem" },
    notePh: "Was ist los? (optional)",
    send: "Senden",
    withdraw: "Zurückziehen",
    feedbackTitle: (n) => `Rückmeldungen (${n})`,
    resolve: "Erledigt",
    couldNotSend: "Senden fehlgeschlagen",
    expandAll: "Alle ausklappen",
    freqEvery: "jedes Mal",
    freqN: (n) => `alle ${n}. Mal`,
    freqFrom: (s) => `, ab ${s}.`,
    line: (ln, msg) => `Zeile ${ln}: ${msg}`,
    errors: {
      rhythm_min: "Rhythmus muss mindestens 1 Tag sein",
      start_invalid: "Starttag so schreiben: 6.10.2026",
      start_missing: "„- Starttag: 6.10.2026“ unter „# Config“ hinzufügen",
      task_no_name: "Aufgabe hat keinen Namen",
      freq_invalid: "Häufigkeit als „(jedes Mal)“ oder „(alle 2. Mal)“ schreiben, optional „(alle 2. Mal ab 2)“",
      floor_no_name: "Die Etage braucht einen Namen nach „##“",
      supply_no_name: "Das Material hat keinen Namen",
      room_no_name: "Der Raum braucht einen Namen nach „###“",
      unknown_section: "Erlaubt sind nur „# Config“ und „# Schedule“",
      unknown_setting: "Unbekannte Einstellung; „- Rhythmus: 2 Wochen“ oder „- Starttag: 6.10.2026“ verwenden",
      outside_section: "Das gehört unter „# Config“ oder „# Schedule“",
      task_outside_room: "Die Aufgabe braucht einen Raum darüber („### Küche“)",
      heading_level: "„## Etage“ und „### Raum“ verwenden; tiefere Überschriften gibt es nicht",
      unexpected_line: "Aufgaben beginnen mit „- “; anderer Text ist hier nicht erlaubt",
      old_format:
        "Der Plan ist im alten Format. Seit Version 0.6 ist er Markdown: „# Config“ mit den Einstellungen, " +
        "„# Schedule“ mit „## Etage“, „### Raum“ und Aufgaben als „- Aufgabe (alle 2. Mal)“.",
    },
    tabForm: "Formular",
    tabText: "Text",
    rhythm: "Putzkraft kommt alle",
    weeks: "Wochen",
    days: "Tage",
    startDay: "Erster Termin",
    addLocation: "Ort hinzufügen",
    addTask: "Aufgabe hinzufügen",
    addFloor: "Etage hinzufügen",
    floorPh: "Etage, z. B. Erdgeschoss",
    noFloorPh: "Ohne Etage (optional benennen)",
    locCount: (n) => (n === 1 ? "1 Ort" : `${n} Orte`),
    confirmDeleteFloor: (name, n) => `Etage „${name}“ mit ${n} Orten löschen?`,
    locationPh: "Ort, z. B. Küche",
    taskPh: "Aufgabe, z. B. Spüle putzen",
    every: "alle",
    everyVisit: "Mal",
    everyNth: ". Mal",
    from: "ab Besuch",
    taskCount: (n) => (n === 1 ? "1 Aufgabe" : `${n} Aufgaben`),
    suppliesTitle: "Verbrauchsmaterial, das die Putzkraft als fehlend melden kann",
    supplyPh: "z. B. Müllbeutel",
    addSupply: "Material hinzufügen",
    moveUp: "Nach oben",
    moveDown: "Nach unten",
    remove: "Löschen",
    confirmDeleteLoc: (name, n) => `„${name}“ mit ${n} Aufgaben löschen?`,
    confirmDiscard: "Änderungen verwerfen?",
    commentsNote: "Der Plantext enthält Kommentare. Beim Speichern aus dem Formular gehen sie verloren; im Tab „Text“ bleiben sie erhalten.",
    fixTextFirst: "Erst die Fehler im Text beheben, dann zum Formular wechseln.",
    emptyForm: "Noch keine Orte. Den ersten Ort anlegen, dann seine Aufgaben. Enter in einer Aufgabe legt die nächste an.",
    dueVisits: (list) => `Besuche ${list} …`,
    nextDue: (date, v) => `nächstes Mal ${date} (Besuch ${v})`,
    overview: "Übersicht",
    tabOverview: "Übersicht",
    back: "Zurück",
    ovIntro: "Aufgaben, die nicht bei jedem Besuch fällig sind. So lassen sich große Arbeiten gleichmäßig verteilen.",
    ovEditHint: "Auf ein leeres Feld tippen verschiebt die Aufgabe auf diesen Besuch; − und + ändern, wie oft sie fällig ist.",
    ovMoreOften: "Öfter",
    ovLessOften: "Seltener",
    ovNone: "Alle Aufgaben sind bei jedem Besuch fällig. Eine Aufgabe auf „alle 2. Mal“ oder mehr stellen, um sie hier zu planen.",
    ovVisit: "Besuch",
    ovExtra: "Zusätzliche Aufgaben",
    ovTotal: "Alle Aufgaben",
    ovCycle: (n) => (n === 1 ? "" : `Der Plan wiederholt sich alle ${n} Besuche.`),
    ovCycleLong: (n, shown) => `Der Plan wiederholt sich alle ${n} Besuche; ${shown} werden jeweils gezeigt.`,
    ovEarlier: "Frühere Besuche",
    ovLater: "Spätere Besuche",
    ovDue: "fällig",
    ovDone: "erledigt",
    ovMoveHere: (v) => `Auf Besuch ${v} verschieben`,
    ovNeedsDates: "Rhythmus und ersten Termin setzen, um die Übersicht zu sehen.",
    formErrors: {
      rhythm: "Der Rhythmus muss mindestens 1 sein.",
      start: "Datum des ersten Termins wählen.",
      locEmpty: "Ein Ort mit Aufgaben hat keinen Namen.",
      nameHash: (n) => `„${n}“ darf nicht mit „ #“ enden.`,
      floorEmpty: "Eine Etage mit Orten hat keinen Namen. Nur die erste Etage darf ohne Namen bleiben.",
      floorDup: (n) => `Es gibt zwei Etagen namens „${n}“.`,
      supplyDup: (n) => `„${n}“ steht zweimal beim Material.`,
      locDup: (n) => `Es gibt zwei Orte namens „${n}“.`,
      taskDup: (loc, n) => `„${n}“ steht zweimal in „${loc}“.`,
      freq: (loc, n) => `„${n}“ in „${loc}“ braucht ganze Zahlen ab 1.`,
    },
    editor: {
      entry_id: "Plan",
      title: "Titel",
      allow_edit: "Bearbeiten erlauben (aus = Ansicht für die Putzkraft)",
      column_width: "Minimale Spaltenbreite",
    },
  },
};

// hass.locale.language is the user's profile language, e.g. "de" or "en-GB"
function pickLang(hass) {
  const l = (hass && ((hass.locale && hass.locale.language) || hass.language)) || "en";
  const base = String(l).toLowerCase().split(/[-_]/)[0];
  return STRINGS[base] ? base : "en";
}

/* ---------- helpers ---------- */

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Day numbers in UTC, so DST never shifts a date
const isoToNum = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
};
const numToDate = (n) => new Date(n * 86400000);
const isoOf = (n) => numToDate(n).toISOString().slice(0, 10);
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

const freqLabel = (task, t) => {
  if (task.every === 1) return task.from > 1 ? t.freqEvery + t.freqFrom(task.from) : t.freqEvery;
  const base = t.freqN(task.every);
  return task.from > 1 ? base + t.freqFrom(task.from) : base;
};

const errorText = (e, t) => {
  const msg = t.errors[e.code] || e.code;
  return e.line ? t.line(e.line, msg) : msg;
};

// Date in the user's HA language. HA's date_format "system" means browser locale.
function formatDate(hass, dayN, opts = { weekday: "long", day: "numeric", month: "long" }) {
  const loc = hass && hass.locale;
  const lang = loc && loc.date_format !== "system" ? loc.language : undefined;
  try {
    return numToDate(dayN).toLocaleDateString(lang, { ...opts, timeZone: "UTC" });
  } catch (e) {
    return isoOf(dayN);
  }
}

const errMsg = (err) => (err && (err.message || err.code)) || String(err);

/* ---------- form model: plan <-> editable structure <-> canonical text ---------- */

let nextId = 1;
const newId = () => nextId++;

// From the server's parsed plan. Locations are grouped into floors in plan order;
// floor "" holds locations without a floor and always comes first.
// orig remembers the stored [floor, location, task], so renames can be sent.
function modelFromPlan(plan, today) {
  const weeks = plan.rhythm % 7 === 0;
  const floors = [];
  const byName = new Map();
  for (const loc of plan.locations) {
    const fname = loc.floor || "";
    if (!byName.has(fname)) {
      const floor = { id: newId(), name: fname, open: true, locations: [] };
      byName.set(fname, floor);
      if (fname === "") floors.unshift(floor);
      else floors.push(floor);
    }
    byName.get(fname).locations.push({
      id: newId(),
      name: loc.name,
      open: false,
      tasks: loc.tasks.map((task) => ({
        id: newId(),
        name: task.name,
        every: task.every,
        from: task.from,
        orig: [fname, loc.name, task.name],
      })),
    });
  }
  if (!floors.length) floors.push({ id: newId(), name: "", open: true, locations: [] });
  return {
    rhythmN: weeks ? plan.rhythm / 7 : plan.rhythm,
    rhythmUnit: weeks ? "w" : "d",
    start: plan.start || today || "",
    floors,
    supplies: (plan.supplies || []).map((name) => ({ id: newId(), name })),
  };
}

const rhythmDays = (m) => m.rhythmN * (m.rhythmUnit === "w" ? 7 : 1);

// Floor boxes are shown once there is more than the implicit "no floor" bucket
const usesFloors = (m) => m.floors.length > 1 || !!m.floors[0].name.trim();

const freqText = (task, de) => {
  if (task.every === 1 && task.from === 1) return de ? "jedes Mal" : "every time";
  const base = de ? `alle ${task.every}. Mal` : `every ${task.every}. time`;
  return task.from > 1 ? `${base} ${de ? "ab" : "from"} ${task.from}` : base;
};

// "- Name" for every time, "- Name (alle 2. Mal)" otherwise. A name that itself ends
// with ")" always gets the frequency, so "(innen)" is never read as one.
const taskLine = (task, de) => {
  const name = task.name.trim();
  const always = task.every === 1 && task.from === 1;
  return always && !name.endsWith(")") ? `- ${name}` : `- ${name} (${freqText(task, de)})`;
};

// Tasks without a name, nameless locations without tasks and floors without
// locations are dropped when saving
function keptFloors(m) {
  return m.floors
    .map((floor) => ({
      ...floor,
      locations: floor.locations
        .map((loc) => ({ ...loc, tasks: loc.tasks.filter((k) => k.name.trim()) }))
        .filter((loc) => loc.name.trim() || loc.tasks.length),
    }))
    .filter((floor) => floor.locations.length);
}

// Canonical plan text in the user's language; the server accepts both languages
function modelToText(m, lang) {
  const de = lang === "de";
  const n = m.rhythmN;
  const unit =
    m.rhythmUnit === "w"
      ? de ? (n === 1 ? "Woche" : "Wochen") : n === 1 ? "week" : "weeks"
      : de ? (n === 1 ? "Tag" : "Tage") : n === 1 ? "day" : "days";
  const lines = ["# Config", de ? `- Rhythmus: ${n} ${unit}` : `- rhythm: ${n} ${unit}`];
  if (m.start) {
    const [y, mo, d] = m.start.split("-").map(Number);
    lines.push(de ? `- Starttag: ${d}.${mo}.${y}` : `- start day: ${m.start}`);
  }
  lines.push("", "# Schedule");
  for (const floor of keptFloors(m)) {
    if (floor.name.trim()) lines.push("", `## ${floor.name.trim()}`);
    for (const loc of floor.locations) {
      lines.push("", `### ${loc.name.trim()}`);
      for (const task of loc.tasks) lines.push(taskLine(task, de));
    }
  }
  const supplies = (m.supplies || []).map((x) => x.name.trim()).filter(Boolean);
  if (supplies.length) lines.push("", "# Supplies", ...supplies.map((x) => `- ${x}`));
  return lines.join("\n") + "\n";
}

function modelRenames(m) {
  const out = [];
  for (const floor of keptFloors(m))
    for (const loc of floor.locations)
      for (const task of loc.tasks) {
        if (!task.orig) continue;
        const to = [floor.name.trim(), loc.name.trim(), task.name.trim()];
        if (to.some((v, i) => v !== task.orig[i])) out.push({ from: task.orig, to });
      }
  return out;
}

// All locations with their floor name and model indices, for the overview
function flattenModel(m) {
  const out = [];
  m.floors.forEach((floor, fi) =>
    floor.locations.forEach((loc, li) => out.push({ floor: floor.name.trim(), loc, fi, li }))
  );
  return out;
}

// Same checks as the server parser, plus duplicates. ref points at the input to mark.
// A heading ending in " #" would lose that part (Markdown closing sequence).
const HASH_END_RE = /\s#+$/;
function validateModel(m, t) {
  const fe = t.formErrors;
  const errs = [];
  if (!(Number.isInteger(m.rhythmN) && m.rhythmN >= 1)) errs.push({ msg: fe.rhythm, ref: { f: "rhythmN" } });
  if (!ISO_RE.test(m.start || "")) errs.push({ msg: fe.start, ref: { f: "start" } });
  const supplyNames = new Set();
  (m.supplies || []).forEach((x, si) => {
    const name = x.name.trim();
    if (name && supplyNames.has(name)) errs.push({ msg: fe.supplyDup(name), ref: { f: "supplyName", si } });
    supplyNames.add(name);
  });
  const floorNames = new Set();
  m.floors.forEach((floor, fi) => {
    const fname = floor.name.trim();
    const hasLocs = floor.locations.some((l) => l.name.trim() || l.tasks.some((k) => k.name.trim()));
    // Only the first floor may be nameless: its locations come before any floor line
    if (!fname && fi > 0 && hasLocs) errs.push({ msg: fe.floorEmpty, ref: { f: "floorName", fi } });
    else if (HASH_END_RE.test(fname)) errs.push({ msg: fe.nameHash(fname), ref: { f: "floorName", fi } });
    else if (fname && floorNames.has(fname)) errs.push({ msg: fe.floorDup(fname), ref: { f: "floorName", fi } });
    if (fname) floorNames.add(fname);
    const locNames = new Set();
    floor.locations.forEach((loc, li) => {
      const name = loc.name.trim();
      const named = loc.tasks.filter((k) => k.name.trim());
      if (!name) {
        if (named.length) errs.push({ msg: fe.locEmpty, ref: { f: "locName", fi, li } });
      } else if (HASH_END_RE.test(name)) {
        errs.push({ msg: fe.nameHash(name), ref: { f: "locName", fi, li } });
      } else if (locNames.has(name)) {
        errs.push({ msg: fe.locDup(name), ref: { f: "locName", fi, li } });
      }
      locNames.add(name);
      const taskNames = new Set();
      loc.tasks.forEach((task, ti) => {
        const tn = task.name.trim();
        if (!tn) return;
        if (taskNames.has(tn)) errs.push({ msg: fe.taskDup(name, tn), ref: { f: "taskName", fi, li, ti } });
        taskNames.add(tn);
        for (const f of ["every", "from"])
          if (!(Number.isInteger(task[f]) && task[f] >= 1)) errs.push({ msg: fe.freq(name, tn), ref: { f, fi, li, ti } });
      });
    });
  });
  return errs;
}

/* ---------- schedule overview: tasks that are not due on every visit ---------- */

const isDue = (task, v) => v >= task.from && (v - task.from) % task.every === 0;
const isIrregular = (task) => task.every > 1 || task.from > 1;
const gcd = (a, b) => (b ? gcd(b, a % b) : a);

// Number of visits after which the irregular tasks repeat (1 if there are none)
function cycleLength(locations) {
  let l = 1;
  for (const loc of locations)
    for (const task of loc.tasks) if (task.every > 1) l = Math.min(1000, (l * task.every) / gcd(l, task.every));
  return l;
}

// Enough columns for one full cycle, at least 8 and at most 16
const overviewCount = (locations) => Math.min(16, Math.max(8, cycleLength(locations)));

/*
 * plan: { rhythm (days), start (day number), locations: [{ floor, name, tasks: [{ name, every, from, ref? }] }] }
 * Returns the visits shown, their dates, the irregular tasks grouped by floor and location
 * with a due flag per visit, and per visit the count of irregular ("extra") and all tasks.
 */
function buildOverview(plan, firstVisit, count, keep = () => false) {
  const visits = Array.from({ length: count }, (_, i) => firstVisit + i);
  const extra = visits.map(() => 0);
  const total = visits.map(() => 0);
  const groups = [];
  for (const loc of plan.locations) {
    const rows = [];
    for (const task of loc.tasks) {
      const due = visits.map((v) => isDue(task, v));
      due.forEach((d, i) => d && total[i]++);
      if (isIrregular(task)) due.forEach((d, i) => d && extra[i]++);
      else if (!keep(task)) continue;
      rows.push({ task, due });
    }
    if (rows.length) groups.push({ floor: loc.floor || "", name: loc.name, rows });
  }
  return { visits, dates: visits.map((v) => plan.start + (v - 1) * plan.rhythm), groups, extra, total };
}

/* ---------- card ---------- */

class CleaningPlanVisitCard extends HTMLElement {
  setConfig(config) {
    const old = this._config;
    this._config = { allow_edit: true, column_width: 300, ...(config || {}) };
    const cw = Number(this._config.column_width);
    this._config.column_width = Number.isFinite(cw) && cw >= 150 ? cw : 300;
    if (!old) {
      this._shift = 0;
      this._editing = false;
      this._busy = new Set(); // keys of ticks being saved
      this._data = null;
      this._error = null;
      // Open floors and rooms of the tick-off list; everything else is folded.
      // Saved per plan in this browser's localStorage, see _loadOpen.
      this._open = {};
      this._wasDone = {}; // "visit-iso" + key -> was fully done at the last render
      this._visibleLocs = [];
      this._visibleFloors = [];
      this._view = "list"; // "list" | "overview"
      this._ovShift = 0; // overview window, in pages of visits
    }
    if (old && old.entry_id !== this._config.entry_id) this._resubscribe();
    else if (this.shadowRoot) this._render();
  }

  set hass(hass) {
    const first = !this._hass;
    const lang = pickLang(hass);
    this._hass = hass;
    if (!this.shadowRoot) this._setup();
    if (first) this._subscribe();
    // hass changes on every state change in HA; only re-render when the language changes
    if (lang !== this._lang) {
      this._lang = lang;
      if (!this._editing) this._render();
    }
  }

  connectedCallback() {
    this._connected = true;
    if (this._hass) this._subscribe();
  }

  disconnectedCallback() {
    this._connected = false;
    this._unsubscribe();
  }

  getCardSize() {
    return 6;
  }
  // Sections view (HA 2024.11+): take the full row width
  getGridOptions() {
    return { columns: "full", rows: "auto" };
  }
  // Sections view (HA 2024.3 - 2024.10): 4 columns was the full width
  getLayoutOptions() {
    return { grid_columns: 4, grid_rows: "auto" };
  }
  static getStubConfig() {
    return {};
  }
  static getConfigElement() {
    return document.createElement(EDITOR_TYPE);
  }

  get _t() {
    return STRINGS[pickLang(this._hass)];
  }

  _setup() {
    this.attachShadow({ mode: "open" });
    const root = this.shadowRoot;
    root.addEventListener("click", (e) => this._onClick(e));
    const onInput = (e) => {
      if (e.target.id === "plan-text") {
        this._ed.text = e.target.value;
        this._ed.dirty = true;
        this._validateTextSoon();
      } else if (e.target.dataset && e.target.dataset.f) this._onFormInput(e.target);
      else if (e.target.dataset && "pnote" in e.target.dataset && this._pedit) {
        this._pedit.note = e.target.value;
        this._pedit.focus = true;
      }
    };
    root.addEventListener("input", onInput);
    root.addEventListener("change", onInput);
    root.addEventListener("keydown", (e) => this._onKeyDown(e));
  }

  /* ----- subscription ----- */

  async _subscribe() {
    if (this._sub || !this._hass || this._connected === false) return;
    const token = {};
    this._sub = token;
    clearTimeout(this._retry);
    try {
      let entryId = this._config.entry_id;
      if (!entryId) {
        const plans = await this._hass.callWS({ type: `${WS}/plans` });
        if (!plans.length) {
          this._error = this._t.noPlans;
          this._sub = null;
          this._render();
          this._retry = setTimeout(() => this._subscribe(), 30000);
          return;
        }
        entryId = plans[0].entry_id;
      }
      this._entryId = entryId;
      this._loadOpen();
      const unsub = await this._hass.connection.subscribeMessage((msg) => this._onData(token, msg), {
        type: `${WS}/subscribe`,
        entry_id: entryId,
      });
      if (this._sub !== token) {
        // Disconnected or reconfigured while waiting
        unsub().catch(() => {});
        return;
      }
      token.unsub = unsub;
    } catch (err) {
      if (this._sub !== token) return;
      this._sub = null;
      this._error = `${this._t.couldNotLoad}: ${errMsg(err)}`;
      this._render();
      this._retry = setTimeout(() => this._subscribe(), 10000);
    }
  }

  _unsubscribe() {
    clearTimeout(this._retry);
    const sub = this._sub;
    this._sub = null;
    if (sub && sub.unsub) sub.unsub().catch(() => {});
  }

  _resubscribe() {
    this._unsubscribe();
    this._data = null;
    this._render();
    this._subscribe();
  }

  _onData(token, msg) {
    if (this._sub !== token) return;
    if (msg.reload) {
      // The integration was reloaded; the server already ended this subscription
      this._sub = null;
      this._retry = setTimeout(() => this._subscribe(), 1000);
      return;
    }
    this._data = msg;
    this._error = null;
    if (!this._editing) this._render();
  }

  /* ----- ticking ----- */

  async _toggle(el) {
    const { date, floor, loc, task } = el.dataset;
    const key = `${date}|${floor}|${loc}|${task}`;
    if (this._busy.has(key)) return;
    this._busy.add(key);
    const done = el.getAttribute("aria-checked") !== "true";
    // Optimistic: flip the box now, the subscription push confirms it
    el.classList.toggle("done", done);
    el.setAttribute("aria-checked", String(done));
    try {
      await this._hass.callWS({
        type: `${WS}/set_done`,
        entry_id: this._entryId,
        date,
        floor,
        location: loc,
        task,
        done,
      });
      this._error = null;
    } catch (err) {
      this._error = `${this._t.couldNotSave}: ${errMsg(err)}`;
    }
    this._busy.delete(key);
    this._render();
  }

  /* ----- plan editor: state ----- */

  // this._ed = { mode: "form"|"overview"|"text", model, text, dirty, serverErrors, note, focus, ovShift }
  _openEditor() {
    const data = this._data;
    const hasErrors = data.text && data.plan.errors.length > 0;
    this._ed = {
      mode: hasErrors ? "text" : "form",
      model: hasErrors
        ? null
        : modelFromPlan(data.text ? data.plan : { rhythm: 14, start: null, locations: [] }, data.today),
      text: data.text,
      dirty: false,
      serverErrors: hasErrors ? data.plan.errors : [],
      note: null,
    };
    const m = this._ed.model;
    if (m && !m.floors.some((f) => f.locations.length)) this._addLocation(0);
    this._editing = true;
    this._render();
  }

  _closeEditor(force) {
    if (!force && this._ed && this._ed.dirty && !window.confirm(this._t.confirmDiscard)) return;
    this._editing = false;
    this._ed = null;
    this._render();
  }

  // Modes: "form" and "overview" work on ed.model, "text" on ed.text
  async _switchMode(mode) {
    const ed = this._ed;
    if (ed.mode === mode) return;
    if (mode === "text") {
      ed.text = modelToText(ed.model, pickLang(this._hass));
      ed.mode = "text";
      ed.serverErrors = [];
      ed.note = null;
      this._render();
      return;
    }
    if (ed.mode !== "text") {
      // form <-> overview share the model
      ed.mode = mode;
      this._render();
      return;
    }
    // text -> form/overview: let the server parse the text
    try {
      const res = await this._hass.callWS({ type: `${WS}/validate`, text: ed.text });
      if (res.errors.length) {
        ed.serverErrors = res.errors;
        ed.note = this._t.fixTextFirst;
        this._renderEditMessages();
        return;
      }
      ed.model = modelFromPlan(res.plan, this._data && this._data.today);
      ed.mode = mode;
      ed.note = null;
      this._render();
    } catch (err) {
      ed.note = `${this._t.couldNotLoad}: ${errMsg(err)}`;
      this._renderEditMessages();
    }
  }

  async _insertExample() {
    const ed = this._ed;
    const text = this._t.example;
    if (ed.mode === "text") {
      ed.text = text;
      ed.dirty = true;
      this._render();
      return;
    }
    let res;
    try {
      res = await this._hass.callWS({ type: `${WS}/validate`, text });
    } catch (err) {
      ed.note = `${this._t.couldNotLoad}: ${errMsg(err)}`;
      return this._renderEditMessages();
    }
    ed.model = modelFromPlan(res.plan, this._data && this._data.today);
    for (const floor of ed.model.floors)
      for (const loc of floor.locations) {
        loc.open = true;
        loc.tasks.forEach((k) => (k.orig = null));
      }
    ed.dirty = true;
    this._render();
  }

  async _savePlan() {
    const ed = this._ed;
    const t = this._t;
    let msg;
    if (ed.mode !== "text") {
      if (validateModel(ed.model, t).length) return this._renderEditMessages();
      msg = { text: modelToText(ed.model, pickLang(this._hass)), renames: modelRenames(ed.model) };
    } else msg = { text: ed.text };
    try {
      const res = await this._hass.callWS({ type: `${WS}/save_plan`, entry_id: this._entryId, ...msg });
      if (!res.saved) {
        ed.serverErrors = res.errors;
        this._renderEditMessages();
        return;
      }
      this._error = null;
      this._closeEditor(true);
    } catch (err) {
      ed.note = `${t.couldNotSavePlan}: ${errMsg(err)}`;
      this._renderEditMessages();
    }
  }

  _validateTextSoon() {
    clearTimeout(this._validateTimer);
    const save = this.shadowRoot.querySelector('[data-act="save"]');
    if (save) save.disabled = true;
    const text = this._ed.text;
    this._validateTimer = setTimeout(async () => {
      try {
        const res = await this._hass.callWS({ type: `${WS}/validate`, text });
        if (!this._ed || this._ed.text !== text) return; // outdated
        this._ed.serverErrors = res.errors;
        this._ed.note = null;
        this._renderEditMessages();
      } catch (err) {
        /* keep Save disabled; the next keystroke retries */
      }
    }, 250);
  }

  /* ----- plan editor: form changes ----- */

  _floor(fi) {
    return this._ed.model.floors[fi];
  }

  _loc(fi, li) {
    return this._floor(fi).locations[li];
  }

  _onFormInput(el) {
    const ed = this._ed;
    if (!ed || !ed.model) return;
    const m = ed.model;
    const { f } = el.dataset;
    const fi = Number(el.dataset.fi);
    const li = Number(el.dataset.li);
    const ti = Number(el.dataset.ti);
    const int = (v) => (/^\d+$/.test(v.trim()) ? parseInt(v, 10) : NaN);
    if (f === "rhythmN") m.rhythmN = int(el.value);
    else if (f === "rhythmUnit") m.rhythmUnit = el.value;
    else if (f === "start") m.start = el.value;
    else if (f === "floorName") this._floor(fi).name = el.value;
    else if (f === "supplyName") m.supplies[Number(el.dataset.si)].name = el.value;
    else if (f === "locName") this._loc(fi, li).name = el.value;
    else if (f === "taskName") this._loc(fi, li).tasks[ti].name = el.value;
    else if (f === "every" || f === "from") {
      const task = this._loc(fi, li).tasks[ti];
      task[f] = int(el.value);
      const row = el.closest(".ftask");
      const fromEl = row && row.querySelector(".from");
      if (fromEl) fromEl.hidden = !(task.every > 1 || task.from > 1);
    }
    ed.dirty = true;
    this._updateDueHints();
    this._renderEditMessages();
  }

  _onKeyDown(e) {
    if (e.key !== "Enter" || !e.target.dataset || !this._ed || this._ed.mode !== "form") return;
    const { f } = e.target.dataset;
    const fi = Number(e.target.dataset.fi);
    const li = Number(e.target.dataset.li);
    if (f === "taskName") {
      e.preventDefault();
      this._addTask(fi, li, Number(e.target.dataset.ti) + 1);
    } else if (f === "locName") {
      e.preventDefault();
      const loc = this._loc(fi, li);
      loc.open = true;
      if (!loc.tasks.length) this._addTask(fi, li, 0);
      else this._render({ f: "taskName", fi, li, ti: 0 });
    } else if (f === "supplyName") {
      e.preventDefault();
      this._addSupply(Number(e.target.dataset.si) + 1);
    } else if (f === "floorName") {
      e.preventDefault();
      const floor = this._floor(fi);
      floor.open = true;
      if (!floor.locations.length) {
        this._addLocation(fi);
        this._render(this._ed.focus);
      } else this._render({ f: "locName", fi, li: 0 });
    }
  }

  _addLocation(fi) {
    const floor = this._floor(fi);
    floor.open = true;
    floor.locations.push({ id: newId(), name: "", open: true, tasks: [] });
    this._ed.focus = { f: "locName", fi, li: floor.locations.length - 1 };
  }

  _addSupply(at) {
    const list = this._ed.model.supplies;
    const index = at == null ? list.length : at;
    list.splice(index, 0, { id: newId(), name: "" });
    this._ed.dirty = true;
    this._render({ f: "supplyName", si: index });
  }

  _addTask(fi, li, at) {
    const loc = this._loc(fi, li);
    const index = at == null ? loc.tasks.length : at;
    loc.tasks.splice(index, 0, { id: newId(), name: "", every: 1, from: 1, orig: null });
    loc.open = true;
    this._floor(fi).open = true;
    this._ed.dirty = true;
    this._render({ f: "taskName", fi, li, ti: index });
  }

  // Moves a location within its floor; past the first/last location it moves to the
  // end of the previous floor / the start of the next floor
  _moveLocation(fi, li, d) {
    const floors = this._ed.model.floors;
    const locs = floors[fi].locations;
    const j = li + d;
    if (j >= 0 && j < locs.length) {
      [locs[li], locs[j]] = [locs[j], locs[li]];
      return;
    }
    const target = floors[fi + d];
    if (!target) return;
    const [loc] = locs.splice(li, 1);
    if (d < 0) target.locations.push(loc);
    else target.locations.unshift(loc);
    target.open = true;
  }

  _formAction(act, el) {
    const ed = this._ed;
    const m = ed.model;
    const fi = Number(el.dataset.fi);
    const li = Number(el.dataset.li);
    const ti = Number(el.dataset.ti);
    const swap = (arr, i, d) => {
      const j = i + d;
      if (j < 0 || j >= arr.length) return;
      [arr[i], arr[j]] = [arr[j], arr[i]];
    };
    const named = (arr) => arr.filter((x) => x.name.trim()).length;
    let structural = true;
    if (act === "f-fold") ((this._loc(fi, li).open = !this._loc(fi, li).open), (structural = false));
    else if (act === "f-floor-fold") ((this._floor(fi).open = !this._floor(fi).open), (structural = false));
    else if (act === "f-fold-all") {
      const open = el.dataset.to === "1";
      for (const floor of m.floors) {
        if (open) floor.open = true;
        floor.locations.forEach((loc) => (loc.open = open));
      }
      structural = false;
    } else if (act === "f-add-floor") {
      m.floors.push({ id: newId(), name: "", open: true, locations: [] });
      ed.dirty = true;
      return this._render({ f: "floorName", fi: m.floors.length - 1 });
    } else if (act === "f-add-supply") return this._addSupply();
    else if (act === "f-supply-del") m.supplies.splice(Number(el.dataset.si), 1);
    else if (act === "f-add-loc") {
      this._addLocation(fi);
      ed.dirty = true;
      return this._render(ed.focus);
    } else if (act === "f-add-task") return this._addTask(fi, li);
    else if (act === "f-floor-up" || act === "f-floor-down") swap(m.floors, fi, act === "f-floor-up" ? -1 : 1);
    else if (act === "f-loc-up" || act === "f-loc-down") this._moveLocation(fi, li, act === "f-loc-up" ? -1 : 1);
    else if (act === "f-task-up" || act === "f-task-down") swap(this._loc(fi, li).tasks, ti, act === "f-task-up" ? -1 : 1);
    else if (act === "f-floor-del") {
      const floor = this._floor(fi);
      const n = named(floor.locations);
      if (n && !window.confirm(this._t.confirmDeleteFloor(floor.name.trim(), n))) return;
      m.floors.splice(fi, 1);
      if (!m.floors.length) m.floors.push({ id: newId(), name: "", open: true, locations: [] });
    } else if (act === "f-loc-del") {
      const loc = this._loc(fi, li);
      const n = named(loc.tasks);
      if (n && !window.confirm(this._t.confirmDeleteLoc(loc.name.trim(), n))) return;
      this._floor(fi).locations.splice(li, 1);
    } else if (act === "f-task-del") this._loc(fi, li).tasks.splice(ti, 1);
    else if (act === "f-ov-every") {
      // Overview: change the interval; the start visit stays, so the next turn is kept where possible
      const task = this._loc(fi, li).tasks[ti];
      task.every = Math.min(99, Math.max(1, task.every + Number(el.dataset.delta)));
      (ed.ovPinned ||= new Set()).add(task.id);
    } else if (act === "f-ov-set") {
      // Overview: move the task's turn so it is due on visit v (same interval)
      const task = this._loc(fi, li).tasks[ti];
      task.from = ((Number(el.dataset.v) - 1) % task.every) + 1;
    }
    if (structural) ed.dirty = true;
    this._render();
  }

  /* ----- events ----- */

  _onClick(e) {
    const el = e.target.closest("[data-act]");
    if (!el) return;
    const act = el.dataset.act;
    if (act.startsWith("f-")) return this._formAction(act, el);
    if (act === "toggle") this._toggle(el);
    else if (act === "prev") (this._shift--, this._render());
    else if (act === "next") (this._shift++, this._render());
    else if (act === "now") (this._shift = 0, this._render());
    else if (act === "edit") this._openEditor();
    else if (act === "overview") ((this._view = "overview"), (this._ovShift = 0), this._render());
    else if (act === "back") ((this._view = "list"), this._render());
    else if (act === "ov-prev" || act === "ov-next") {
      const d = act === "ov-prev" ? -1 : 1;
      if (this._editing) this._ed.ovShift = (this._ed.ovShift || 0) + d;
      else this._ovShift = (this._ovShift || 0) + d;
      this._render();
    } else if (act === "cancel") this._closeEditor(false);
    else if (act === "mode") this._switchMode(el.dataset.mode);
    else if (act === "example") this._insertExample();
    else if (act === "save") this._savePlan();
    else if (act === "fold") {
      this._setOpen(el.dataset.loc, el.dataset.folded === "1");
      this._render();
    } else if (act === "fold-all") {
      const open = el.dataset.to !== "1"; // data-to="1" means collapse
      [...this._visibleFloors, ...this._visibleLocs].forEach((k) => this._setOpen(k, open));
      this._render();
    } else if (act === "ffold") {
      this._setOpen(el.dataset.key, !this._isOpen(el.dataset.key));
      this._render();
    } else if (act === "supply") this._toggleSupply(el);
    else if (act === "flag") this._openProblem(el);
    else if (act === "p-kind") ((this._pedit.kind = el.dataset.kind), (this._pedit.focus = false), this._render());
    else if (act === "p-cancel") ((this._pedit = null), this._render());
    else if (act === "p-send") this._sendProblem();
    else if (act === "p-withdraw" || act === "p-resolve") this._resolveProblem(el.dataset.id);
  }

  /* ----- fold state of the tick-off list, kept per plan in localStorage ----- */

  get _openStorageKey() {
    return `cleaning-plan-card.open.${this._entryId}`;
  }

  _loadOpen() {
    try {
      this._open = JSON.parse(window.localStorage.getItem(this._openStorageKey)) || {};
    } catch (e) {
      this._open = {}; // no storage (private mode, embedded views): fold state lives in memory
    }
  }

  _isOpen(key) {
    return this._open[key] === true;
  }

  _setOpen(key, open) {
    if (open === this._isOpen(key)) return;
    if (open) this._open[key] = true;
    else delete this._open[key];
    try {
      window.localStorage.setItem(this._openStorageKey, JSON.stringify(this._open));
    } catch (e) {
      /* keep it in memory */
    }
  }

  /* ----- rendering ----- */

  _render(focus) {
    if (!this.shadowRoot || !this._config) return;
    const body = this._editing
      ? this._editView()
      : this._view === "overview" && this._canOverview()
        ? this._overviewView()
        : this._listView();
    this.shadowRoot.innerHTML = `<style>${STYLE}</style><ha-card>${body}</ha-card>`;
    if (!this._editing) {
      // Keep typing in the problem note across re-renders (pushes from other devices)
      const note = this._pedit && this._pedit.focus && this.shadowRoot.querySelector("[data-pnote]");
      if (note) {
        note.focus();
        note.setSelectionRange(note.value.length, note.value.length);
      }
      return;
    }
    this._renderEditMessages();
    if (this._ed.mode === "text" && !this._ed.serverErrors.length) this._validateTextSoon();
    const target = focus || this._ed.focus;
    this._ed.focus = null;
    if (target) {
      const sel = Object.entries(target)
        .map(([k, v]) => `[data-${k}="${v}"]`)
        .join("");
      const input = this.shadowRoot.querySelector(`input${sel}`);
      if (input) input.focus();
    }
  }

  // Errors, notes, invalid markers and the Save button, without re-rendering inputs
  _renderEditMessages() {
    const root = this.shadowRoot;
    const ed = this._ed;
    const box = root.getElementById("errors");
    if (!box || !ed) return;
    const t = this._t;
    let msgs;
    root.querySelectorAll(".invalid").forEach((n) => n.classList.remove("invalid"));
    if (ed.mode !== "text") {
      const errs = validateModel(ed.model, t);
      for (const { ref } of errs) {
        const sel = Object.entries(ref)
          .map(([k, v]) => `[data-${k}="${v}"]`)
          .join("");
        const input = root.querySelector(`input${sel}`);
        if (input) input.classList.add("invalid");
      }
      msgs = [...errs.map((x) => x.msg), ...ed.serverErrors.map((x) => errorText(x, t))];
    } else msgs = ed.serverErrors.map((x) => errorText(x, t));
    const save = root.querySelector('[data-act="save"]');
    if (save) save.disabled = msgs.length > 0; // a note alone (e.g. a failed save) allows retrying
    if (ed.note) msgs.unshift(ed.note);
    box.innerHTML = msgs.map((x) => `<div>${esc(x)}</div>`).join("");
  }

  _title() {
    return this._config.title || (this._data && this._data.title) || this._t.title;
  }

  _editView() {
    const t = this._t;
    const ed = this._ed;
    const tab = (mode, label) =>
      `<button class="tab ${ed.mode === mode ? "active" : ""}" data-act="mode" data-mode="${mode}"
               aria-pressed="${ed.mode === mode}">${esc(label)}</button>`;
    const empty =
      ed.mode !== "text"
        ? !ed.model.floors.some((f) => f.name.trim() || f.locations.some((l) => l.name.trim() || l.tasks.length))
        : !ed.text.trim();
    const view = { form: () => this._formView(), overview: () => this._editOverview(), text: () => this._textView() };
    return `
      <div class="head">
        <div class="title">${esc(t.editPlan)}</div>
        <div class="tabs" role="group">${tab("form", t.tabForm)}${tab("overview", t.tabOverview)}${tab("text", t.tabText)}</div>
      </div>
      ${view[ed.mode]()}
      <div id="errors" class="errors" role="alert"></div>
      <div class="actions">
        ${empty ? `<button class="flat" data-act="example">${esc(t.insertExample)}</button>` : ""}
        <span class="spacer"></span>
        <button class="flat" data-act="cancel">${esc(t.cancel)}</button>
        <button class="primary" data-act="save">${esc(t.save)}</button>
      </div>`;
  }

  /* ----- schedule overview ----- */

  _canOverview() {
    return !!(this._config.allow_edit && this._data && this._data.plan.start && this._data.current_visit != null);
  }

  // Household view: the saved plan
  _overviewView() {
    const t = this._t;
    const data = this._data;
    const plan = { rhythm: data.plan.rhythm, start: isoToNum(data.plan.start), locations: data.plan.locations };
    return `
      <div class="head">
        <div class="title">${esc(this._title())}</div>
        <span class="head-btns">
          <button class="flat" data-act="back">${esc(t.back)}</button>
          <button class="flat" data-act="edit">${esc(t.editPlan)}</button>
        </span>
      </div>
      ${this._overviewHTML(plan, data.current_visit, isoToNum(data.today), this._ovShift || 0, false)}`;
  }

  // Editor tab: the unsaved model, with tap-to-move
  _editOverview() {
    const m = this._ed.model;
    if (!ISO_RE.test(m.start || "") || !(Number.isInteger(m.rhythmN) && m.rhythmN >= 1))
      return `<div class="msg">${esc(this._t.ovNeedsDates)}</div>`;
    const ok = (n) => Number.isInteger(n) && n >= 1;
    const plan = {
      rhythm: rhythmDays(m),
      start: isoToNum(m.start),
      locations: flattenModel(m).map(({ floor, loc, fi, li }) => ({
        floor,
        name: loc.name.trim(),
        tasks: loc.tasks
          .map((k, ti) => ({ name: k.name.trim(), every: k.every, from: k.from, ref: { fi, li, ti, id: k.id } }))
          .filter((k) => k.name && ok(k.every) && ok(k.from)),
      })),
    };
    const today = isoToNum((this._data && this._data.today) || isoOf(Math.floor(Date.now() / 86400000)));
    const diff = today - plan.start;
    const current = diff <= 0 ? 1 : Math.ceil(diff / plan.rhythm) + 1;
    // Tasks whose interval was changed here stay in the table, even when set to "every time"
    const pinned = this._ed.ovPinned || new Set();
    return this._overviewHTML(plan, current, today, this._ed.ovShift || 0, true, (task) => pinned.has(task.ref.id));
  }

  _overviewHTML(plan, current, today, shift, editable, keep) {
    const t = this._t;
    const count = overviewCount(plan.locations);
    const cycle = cycleLength(plan.locations);
    const first = Math.max(1, current + shift * count);
    const ov = buildOverview(plan, first, count, keep);
    if (!ov.groups.length) return `<div class="msg">${esc(t.ovNone)}</div>`;

    const doneSet = new Set();
    if (this._data)
      for (const [day, keys] of Object.entries(this._data.done))
        for (const [f, l, k] of keys) doneSet.add(`${day}|${f}|${l}|${k}`);
    const colCls = (i) => [ov.visits[i] === current ? "cur" : "", ov.dates[i] < today ? "past" : ""].join(" ").trim();
    const maxExtra = Math.max(1, ...ov.extra);

    const head = ov.visits
      .map(
        (v, i) => `<th scope="col" class="${colCls(i)}">
          <div class="ov-v">${v}</div>
          <div class="ov-d">${esc(formatDate(this._hass, ov.dates[i], { day: "numeric", month: "numeric" }))}</div>
        </th>`
      )
      .join("");

    let lastFloor = "";
    const body = ov.groups
      .map((g) => {
        const label = g.name;
        const floorRow =
          g.floor && g.floor !== lastFloor
            ? `<tr class="ov-floor"><th scope="rowgroup" colspan="${count + 1}">${esc(g.floor)}</th></tr>`
            : "";
        lastFloor = g.floor;
        const rows = g.rows
          .map(({ task, due }) => {
            const cells = due
              .map((d, i) => {
                const v = ov.visits[i];
                if (d) {
                  const done = doneSet.has(`${isoOf(ov.dates[i])}|${g.floor}|${g.name}|${task.name}`);
                  return `<td class="${colCls(i)}"><span class="dot ${done ? "ok" : ""}" title="${esc(done ? t.ovDone : t.ovDue)}"
                            aria-label="${esc(done ? t.ovDone : t.ovDue)}">${done ? CHECK_S : ""}</span></td>`;
                }
                if (editable && task.every > 1 && task.ref)
                  return `<td class="${colCls(i)}"><button class="ov-set" data-act="f-ov-set" data-fi="${task.ref.fi}"
                            data-li="${task.ref.li}" data-ti="${task.ref.ti}" data-v="${v}" title="${esc(t.ovMoveHere(v))}"
                            aria-label="${esc(`${task.name}: ${t.ovMoveHere(v)}`)}"></button></td>`;
                return `<td class="${colCls(i)}"></td>`;
              })
              .join("");
            const freq = `<span class="freq">${esc(freqLabel(task, t))}</span>`;
            const refs = task.ref ? `data-fi="${task.ref.fi}" data-li="${task.ref.li}" data-ti="${task.ref.ti}"` : "";
            const stepper =
              editable && task.ref
                ? `<span class="ov-every">
                    <button class="icon mini" data-act="f-ov-every" data-delta="-1" ${refs} ${task.every <= 1 ? "disabled" : ""}
                            aria-label="${esc(`${task.name}: ${t.ovMoreOften}`)}" title="${esc(t.ovMoreOften)}">${MINUS}</button>
                    ${freq}
                    <button class="icon mini" data-act="f-ov-every" data-delta="1" ${refs} ${task.every >= 99 ? "disabled" : ""}
                            aria-label="${esc(`${task.name}: ${t.ovLessOften}`)}" title="${esc(t.ovLessOften)}">${PLUS_S}</button>
                  </span>`
                : freq;
            return `<tr><th scope="row" class="ov-task">
                <span class="ov-name">${esc(task.name)}</span>${stepper}
              </th>${cells}</tr>`;
          })
          .join("");
        return `${floorRow}<tr class="ov-loc ${g.floor ? "in-floor" : ""}"><th scope="rowgroup" colspan="${count + 1}">${esc(label)}</th></tr>${rows}`;
      })
      .join("");

    const extra = ov.extra
      .map((n, i) => `<td class="${colCls(i)}"><span class="lvl" style="--lvl:${(n / maxExtra).toFixed(2)}">${n}</span></td>`)
      .join("");
    const total = ov.total.map((n, i) => `<td class="${colCls(i)}">${n}</td>`).join("");
    const cycleText = cycle > count ? t.ovCycleLong(cycle, count) : t.ovCycle(cycle);

    return `
      <div class="ov-bar">
        <button class="nav" data-act="ov-prev" aria-label="${esc(t.ovEarlier)}" ${first === 1 ? "disabled" : ""}>${CHEV_L}</button>
        <div class="ov-info">${esc([t.ovIntro, cycleText, editable ? t.ovEditHint : ""].filter(Boolean).join(" "))}</div>
        <button class="nav" data-act="ov-next" aria-label="${esc(t.ovLater)}">${CHEV_R}</button>
      </div>
      <div class="ov-wrap">
        <table class="ov">
          <thead><tr><th scope="col" class="ov-corner">${esc(t.ovVisit)}</th>${head}</tr></thead>
          <tbody>${body}</tbody>
          <tfoot>
            <tr class="ov-extra"><th scope="row">${esc(t.ovExtra)}</th>${extra}</tr>
            <tr class="ov-total"><th scope="row">${esc(t.ovTotal)}</th>${total}</tr>
          </tfoot>
        </table>
      </div>`;
  }

  _textView() {
    return `
      <div class="edit">
        <textarea id="plan-text" spellcheck="false">${esc(this._ed.text)}</textarea>
        <div class="hint">${this._t.hint}</div>
      </div>`;
  }

  _formView() {
    const t = this._t;
    const m = this._ed.model;
    const hasComments = /<!--/.test((this._data && this._data.text) || "");
    const floored = usesFloors(m);
    const allLocs = m.floors.flatMap((f) => f.locations);
    const anyOpen = allLocs.some((l) => l.open);
    const lastFi = m.floors.length - 1;
    const iconBtn = (act, icon, label, attrs, disabled) =>
      `<button class="icon ${act.endsWith("del") ? "danger" : ""}" data-act="${act}" ${attrs}
               aria-label="${esc(label)}" title="${esc(label)}" ${disabled ? "disabled" : ""}>${icon}</button>`;

    const taskRow = (task, fi, li, ti, nTasks) => {
      const att = `data-fi="${fi}" data-li="${li}" data-ti="${ti}"`;
      const showFrom = task.every > 1 || task.from > 1;
      return `<div class="ftask" data-id="${task.id}">
        <input class="task-input" data-f="taskName" ${att} value="${esc(task.name)}"
               placeholder="${esc(t.taskPh)}" enterkeyhint="next" autocomplete="off">
        <span class="freq-ctl">
          ${esc(t.every)}
          <input class="num" type="number" inputmode="numeric" min="1" max="99" data-f="every" ${att}
                 value="${Number.isFinite(task.every) ? task.every : ""}" aria-label="${esc(t.every)}">
          <span>${esc(t.everyNth)}</span>
          <span class="from" ${showFrom ? "" : "hidden"}>
            ${esc(t.from)}
            <input class="num" type="number" inputmode="numeric" min="1" max="99" data-f="from" ${att}
                   value="${Number.isFinite(task.from) ? task.from : ""}" aria-label="${esc(t.from)}">
          </span>
        </span>
        <span class="row-btns">
          ${iconBtn("f-task-up", ARROW_UP, t.moveUp, att, ti === 0)}
          ${iconBtn("f-task-down", ARROW_DOWN, t.moveDown, att, ti === nTasks - 1)}
          ${iconBtn("f-task-del", DELETE, t.remove, att, false)}
        </span>
        <div class="due-hint" ${att}>${esc(this._dueHint(task))}</div>
      </div>`;
    };

    const locBox = (loc, fi, li, nLocs) => {
      const at = `data-fi="${fi}" data-li="${li}"`;
      const tasks = loc.open
        ? `<div class="ftasks">
            ${loc.tasks.map((task, ti) => taskRow(task, fi, li, ti, loc.tasks.length)).join("")}
            <button class="add" data-act="f-add-task" ${at}>${PLUS}<span>${esc(t.addTask)}</span></button>
          </div>`
        : "";
      const count = loc.tasks.filter((k) => k.name.trim()).length;
      return `<div class="floc ${loc.open ? "" : "folded"}" data-id="${loc.id}">
          <div class="floc-head">
            <button class="icon chev" data-act="f-fold" ${at} aria-expanded="${loc.open}">${CHEV_D}</button>
            <input class="loc-input" data-f="locName" ${at} value="${esc(loc.name)}"
                   placeholder="${esc(t.locationPh)}" enterkeyhint="next" autocomplete="off">
            <span class="loc-count">${esc(t.taskCount(count))}</span>
            <span class="row-btns">
              ${iconBtn("f-loc-up", ARROW_UP, t.moveUp, at, fi === 0 && li === 0)}
              ${iconBtn("f-loc-down", ARROW_DOWN, t.moveDown, at, fi === lastFi && li === nLocs - 1)}
              ${iconBtn("f-loc-del", DELETE, t.remove, at, false)}
            </span>
          </div>
          ${tasks}
        </div>`;
    };

    const floorBody = (floor, fi) =>
      `${floor.locations.map((loc, li) => locBox(loc, fi, li, floor.locations.length)).join("")}
       <button class="add" data-act="f-add-loc" data-fi="${fi}">${PLUS}<span>${esc(t.addLocation)}</span></button>`;

    let content;
    if (!floored) {
      const floor = m.floors[0];
      content = `${floor.locations.length ? "" : `<div class="msg">${esc(t.emptyForm)}</div>`}${floorBody(floor, 0)}`;
    } else {
      content = m.floors
        .map((floor, fi) => {
          const at = `data-fi="${fi}"`;
          const n = floor.locations.filter((l) => l.name.trim()).length;
          const ph = fi === 0 && !floor.name.trim() ? t.noFloorPh : t.floorPh;
          return `<div class="ffloor ${floor.open ? "" : "folded"}" data-id="${floor.id}">
              <div class="ffloor-head">
                <button class="icon chev" data-act="f-floor-fold" ${at} aria-expanded="${floor.open}">${CHEV_D}</button>
                <input class="floor-input" data-f="floorName" ${at} value="${esc(floor.name)}"
                       placeholder="${esc(ph)}" enterkeyhint="next" autocomplete="off">
                <span class="loc-count">${esc(t.locCount(n))}</span>
                <span class="row-btns">
                  ${iconBtn("f-floor-up", ARROW_UP, t.moveUp, at, fi === 0)}
                  ${iconBtn("f-floor-down", ARROW_DOWN, t.moveDown, at, fi === lastFi)}
                  ${iconBtn("f-floor-del", DELETE, t.remove, at, false)}
                </span>
              </div>
              ${floor.open ? `<div class="ffloor-body">${floorBody(floor, fi)}</div>` : ""}
            </div>`;
        })
        .join("");
    }

    return `
      <div class="form">
        ${hasComments ? `<div class="note">${esc(t.commentsNote)}</div>` : ""}
        <div class="settings">
          <label class="field">${esc(t.rhythm)}
            <span class="inline">
              <input class="num" type="number" inputmode="numeric" min="1" max="99" data-f="rhythmN"
                     value="${Number.isFinite(m.rhythmN) ? m.rhythmN : ""}">
              <select data-f="rhythmUnit">
                <option value="w" ${m.rhythmUnit === "w" ? "selected" : ""}>${esc(t.weeks)}</option>
                <option value="d" ${m.rhythmUnit === "d" ? "selected" : ""}>${esc(t.days)}</option>
              </select>
            </span>
          </label>
          <label class="field">${esc(t.startDay)}
            <input type="date" data-f="start" value="${esc(m.start)}">
          </label>
        </div>
        ${
          allLocs.length > 1
            ? `<div class="count"><button class="flat small" data-act="f-fold-all" data-to="${anyOpen ? 0 : 1}">${esc(
                anyOpen ? t.collapseAll : t.expandAll
              )}</button><span></span></div>`
            : ""
        }
        ${content}
        <button class="add add-floor" data-act="f-add-floor">${PLUS}<span>${esc(t.addFloor)}</span></button>
        <div class="fsupplies">
          <div class="field">${esc(t.suppliesTitle)}</div>
          ${m.supplies
            .map(
              (x, si) => `<div class="fsupply">
                <input class="supply-input" data-f="supplyName" data-si="${si}" value="${esc(x.name)}"
                       placeholder="${esc(t.supplyPh)}" enterkeyhint="next" autocomplete="off">
                ${iconBtn("f-supply-del", DELETE, t.remove, `data-si="${si}"`, false)}
              </div>`
            )
            .join("")}
          <button class="add" data-act="f-add-supply">${PLUS}<span>${esc(t.addSupply)}</span></button>
        </div>
      </div>`;
  }

  // "Visits 2, 6, 10 … · next on Tue, 20 Oct (visit 2)" for tasks not due every time
  _dueHint(task) {
    const m = this._ed.model;
    const t = this._t;
    if (!(task.every >= 1 && task.from >= 1) || (task.every === 1 && task.from === 1)) return "";
    if (!ISO_RE.test(m.start || "") || !(m.rhythmN >= 1)) return "";
    const r = rhythmDays(m);
    const start = isoToNum(m.start);
    const today = isoToNum((this._data && this._data.today) || isoOf(Math.floor(Date.now() / 86400000)));
    const diff = today - start;
    const current = diff <= 0 ? 1 : Math.ceil(diff / r) + 1;
    const v0 = Math.max(current, task.from);
    const v = v0 + ((task.every - ((v0 - task.from) % task.every)) % task.every);
    const list = [0, 1, 2].map((i) => task.from + i * task.every).join(", ");
    const date = formatDate(this._hass, start + (v - 1) * r, { weekday: "short", day: "numeric", month: "short" });
    return `${t.dueVisits(list)} · ${t.nextDue(date, v)}`;
  }

  _updateDueHints() {
    const m = this._ed.model;
    this.shadowRoot.querySelectorAll(".due-hint").forEach((el) => {
      const loc = m.floors[Number(el.dataset.fi)].locations[Number(el.dataset.li)];
      const task = loc && loc.tasks[Number(el.dataset.ti)];
      el.textContent = task ? this._dueHint(task) : "";
    });
  }

  _listView() {
    const c = this._config;
    const t = this._t;
    const title = this._title();
    const editBtn = c.allow_edit && this._data ? `<button class="flat" data-act="edit">${esc(t.editPlan)}</button>` : "";
    const ovBtn = this._canOverview() ? `<button class="flat" data-act="overview">${esc(t.overview)}</button>` : "";
    const head = `<div class="head"><div class="title">${esc(title)}</div><span class="head-btns">${ovBtn}${editBtn}</span></div>`;
    if (!this._data) {
      return this._error
        ? `${head}<div class="msg err">${esc(this._error)}</div>`
        : `<div class="msg">${esc(t.loading)}</div>`;
    }

    const data = this._data;
    const plan = data.plan;
    if (!data.text) return `${head}<div class="msg">${esc(t.noPlan)}</div>`;
    if (!plan.start || data.current_visit == null)
      return `${head}<div class="msg err">${plan.errors.map((e) => esc(errorText(e, t))).join("<br>")}</div>`;

    // Visit numbers are 1-based: visit 1 is the start day. "today" comes from the server.
    const start = isoToNum(plan.start);
    const today = isoToNum(data.today);
    const visit = Math.max(1, data.current_visit + this._shift);
    const vDay = start + (visit - 1) * plan.rhythm;
    const iso = isoOf(vDay);
    const done = new Set((data.done[iso] || []).map(([f, l, k]) => `${f}|${l}|${k}`));
    const problems = new Map((data.problems || []).map((p) => [`${p.date}|${p.floor}|${p.location}|${p.task}`, p]));

    let total = 0;
    let ticked = 0;
    this._visibleLocs = [];
    this._visibleFloors = [];
    // floor -> { sections: [html], ticked, total }, in plan order
    const floors = new Map();
    for (const loc of plan.locations) {
      const due = loc.tasks.filter((k) => visit >= k.from && (visit - k.from) % k.every === 0);
      if (!due.length) continue;
      const floor = loc.floor || "";
      // Keys don't contain the visit, so the fold state carries over to the next visit
      const locKey = JSON.stringify(["L", floor, loc.name]);
      this._visibleLocs.push(locKey);
      const keyed = due.map((task) => ({ task, isDone: done.has(`${floor}|${loc.name}|${task.name}`) }));
      const locTicked = keyed.filter((k) => k.isDone).length;
      total += keyed.length;
      ticked += locTicked;
      const locDone = locTicked === keyed.length;
      // Rooms start folded. When one becomes fully done it folds again;
      // a tap on the header reopens it.
      const doneKey = iso + locKey;
      if (locDone && !this._wasDone[doneKey]) this._setOpen(locKey, false);
      this._wasDone[doneKey] = locDone;
      const folded = !this._isOpen(locKey);
      const rows = folded
        ? ""
        : keyed
            .map(({ task, isDone }) => {
              const ids = `data-date="${iso}" data-floor="${esc(floor)}" data-loc="${esc(loc.name)}" data-task="${esc(task.name)}"`;
              const pkey = `${iso}|${floor}|${loc.name}|${task.name}`;
              const problem = problems.get(pkey);
              const editing = this._pedit && this._pedit.key === pkey;
              return `<div class="task-row ${problem ? "has-problem" : ""}">
                <button class="task ${isDone ? "done" : ""}" data-act="toggle" ${ids}
                        role="checkbox" aria-checked="${isDone}">
                  <span class="box">${CHECK}</span>
                  <span class="name">${esc(task.name)}</span>
                  ${c.allow_edit && task.every > 1 ? `<span class="freq">${esc(freqLabel(task, t))}</span>` : ""}
                </button>
                <button class="icon flag ${problem ? "on" : ""}" data-act="flag" ${ids}
                        aria-label="${esc(t.reportProblem)}" title="${esc(t.reportProblem)}"
                        aria-expanded="${!!editing}">${problem ? FLAG_ON : FLAG}</button>
              </div>
              ${problem && !editing ? `<div class="problem-note">${esc(t.kinds[problem.kind] || problem.kind)}${problem.note ? `: ${esc(problem.note)}` : ""}</div>` : ""}
              ${editing ? this._problemEditorHTML() : ""}`;
            })
            .join("");
      if (!floors.has(floor)) floors.set(floor, { sections: [], ticked: 0, total: 0 });
      const group = floors.get(floor);
      group.ticked += locTicked;
      group.total += keyed.length;
      group.sections.push(`<section class="${locDone ? "loc-done" : ""} ${folded ? "folded" : ""}">
          <button class="loc" data-act="fold" data-loc="${esc(locKey)}" data-folded="${folded ? 1 : 0}"
                  aria-expanded="${!folded}">
            <span class="chev">${CHEV_D}</span>
            <span class="loc-name">${esc(loc.name)}</span>
            <span class="loc-count">${locTicked}/${keyed.length}</span>
          </button>
          ${rows ? `<div class="tasks">${rows}</div>` : ""}
        </section>`);
    }

    const columns = (html) => `<div class="list" style="columns:${c.column_width}px">${html}</div>`;
    let body = "";
    for (const [floor, group] of floors) {
      if (!floor) {
        body += columns(group.sections.join(""));
        continue;
      }
      // Floors start folded too, and fold by themselves once all their tasks are done
      const fKey = JSON.stringify(["F", floor]);
      this._visibleFloors.push(fKey);
      const fDone = group.ticked === group.total;
      if (fDone && !this._wasDone[iso + fKey]) this._setOpen(fKey, false);
      this._wasDone[iso + fKey] = fDone;
      const folded = !this._isOpen(fKey);
      body += `<div class="floor ${folded ? "folded" : ""} ${fDone ? "floor-done" : ""}">
          <button class="floor-head" data-act="ffold" data-key="${esc(fKey)}" aria-expanded="${!folded}">
            <span class="chev">${CHEV_D}</span>
            <span class="floor-name">${esc(floor)}</span>
            <span class="loc-count">${group.ticked}/${group.total}</span>
          </button>
          ${folded ? "" : columns(group.sections.join(""))}
        </div>`;
    }

    // Something is visibly open: a floor, or a room outside the floors
    const noFloorLocs = this._visibleLocs.filter((k) => JSON.parse(k)[1] === "");
    const anyOpen = [...this._visibleFloors, ...noFloorLocs].some((k) => this._isOpen(k));
    const date = formatDate(this._hass, vDay);
    const rel =
      vDay === today ? t.today : vDay === today + 1 ? t.tomorrow : vDay > today ? t.inDays(vDay - today) : t.daysAgo(today - vDay);
    const pct = total ? Math.round((ticked / total) * 100) : 0;
    const doneOf = t.doneOf(ticked, total);

    // The cleaner view shows only the tasks: no date, no due line, no navigation
    const visitBar = c.allow_edit
      ? `<div class="visit">
          <button class="nav" data-act="prev" aria-label="${esc(t.prevVisit)}">${CHEV_L}</button>
          <div class="when" ${this._shift ? `data-act="now" title="${esc(t.backToCurrent)}"` : ""}>
            <div class="date">${esc(date)}</div>
            <div class="sub">${esc(rel)}, ${esc(t.visit(visit))}${this._shift ? ` ${esc(t.tapCurrent)}` : ""}</div>
          </div>
          <button class="nav" data-act="next" aria-label="${esc(t.nextVisit)}">${CHEV_R}</button>
        </div>`
      : "";

    return `
      ${head}
      ${visitBar}
      <div class="progress" title="${esc(doneOf)}">
        <div class="bar" style="width:${pct}%"></div>
      </div>
      <div class="count">
        ${
          this._visibleLocs.length > 1 || this._visibleFloors.length
            ? `<button class="flat small" data-act="fold-all" data-to="${anyOpen ? 1 : 0}">${esc(anyOpen ? t.collapseAll : t.expandAll)}</button>`
            : "<span></span>"
        }
        <span>${esc(doneOf)}</span>
      </div>
      ${c.allow_edit ? this._feedbackHTML() : ""}
      ${this._suppliesHTML()}
      ${this._error ? `<div class="msg err">${esc(this._error)}</div>` : ""}
      ${plan.errors.length ? `<div class="msg err">${esc(t.planProblems)}: ${plan.errors.map((e) => esc(errorText(e, t))).join("; ")}</div>` : ""}
      ${body || `<div class="msg">${esc(t.nothingDue)}</div>`}`;
  }
}

/* ---------- feedback from the cleaner: missing supplies, problems on tasks ---------- */

Object.assign(CleaningPlanVisitCard.prototype, {
  _suppliesHTML() {
    const supplies = this._data.plan.supplies || [];
    if (!supplies.length) return "";
    const t = this._t;
    const missing = this._data.missing || {};
    return `<div class="supplies">
        <span class="sup-label">${esc(t.suppliesLabel)}</span>
        ${supplies
          .map((name) => {
            const on = name in missing;
            return `<button class="chip sup ${on ? "missing" : ""}" data-act="supply" data-supply="${esc(name)}"
                      aria-pressed="${on}" title="${on ? esc(t.supplyMissing) : ""}">${on ? ALERT : ""}${esc(name)}</button>`;
          })
          .join("")}
      </div>`;
  },

  // Household view: all open problem reports, newest first
  _feedbackHTML() {
    const problems = this._data.problems || [];
    if (!problems.length) return "";
    const t = this._t;
    const rows = problems
      .map((p) => {
        const where = p.floor ? `${p.floor} · ${p.location}` : p.location;
        const date = formatDate(this._hass, isoToNum(p.date), { day: "numeric", month: "numeric" });
        return `<div class="fb-row">
            <span class="fb-kind kind-${esc(p.kind)}">${esc(t.kinds[p.kind] || p.kind)}</span>
            <div class="fb-text">
              <div><b>${esc(p.task)}</b> <span class="fb-where">${esc(where)} · ${esc(date)}</span></div>
              ${p.note ? `<div class="fb-note">${esc(p.note)}</div>` : ""}
            </div>
            <button class="flat small" data-act="p-resolve" data-id="${esc(p.id)}">${esc(t.resolve)}</button>
          </div>`;
      })
      .join("");
    return `<div class="feedback"><div class="fb-title">${esc(t.feedbackTitle(problems.length))}</div>${rows}</div>`;
  },

  _problemEditorHTML() {
    const t = this._t;
    const pe = this._pedit;
    const kind = (k) =>
      `<button class="chip ${pe.kind === k ? "sel" : ""}" data-act="p-kind" data-kind="${k}" aria-pressed="${pe.kind === k}">${esc(t.kinds[k])}</button>`;
    return `<div class="problem-edit">
        <div class="kinds">${kind("skipped")}${kind("issue")}</div>
        <input class="p-note" data-pnote value="${esc(pe.note)}" placeholder="${esc(t.notePh)}" maxlength="500" autocomplete="off">
        <div class="p-actions">
          ${pe.id ? `<button class="flat small" data-act="p-withdraw" data-id="${esc(pe.id)}">${esc(t.withdraw)}</button>` : ""}
          <span class="spacer"></span>
          <button class="flat" data-act="p-cancel">${esc(t.cancel)}</button>
          <button class="primary" data-act="p-send" ${pe.kind ? "" : "disabled"}>${esc(t.send)}</button>
        </div>
      </div>`;
  },

  _openProblem(el) {
    const { date, floor, loc, task } = el.dataset;
    const key = `${date}|${floor}|${loc}|${task}`;
    if (this._pedit && this._pedit.key === key) {
      this._pedit = null;
    } else {
      const existing = (this._data.problems || []).find(
        (p) => p.date === date && p.floor === floor && p.location === loc && p.task === task
      );
      this._pedit = {
        key, date, floor, loc, task,
        id: existing ? existing.id : null,
        kind: existing ? existing.kind : null,
        note: existing ? existing.note : "",
        focus: false,
      };
    }
    this._render();
  },

  async _sendProblem() {
    const pe = this._pedit;
    if (!pe || !pe.kind) return;
    try {
      await this._hass.callWS({
        type: `${WS}/report_problem`,
        entry_id: this._entryId,
        date: pe.date,
        floor: pe.floor,
        location: pe.loc,
        task: pe.task,
        kind: pe.kind,
        note: pe.note.trim(),
      });
      this._pedit = null;
      this._error = null;
    } catch (err) {
      this._error = `${this._t.couldNotSend}: ${errMsg(err)}`;
    }
    this._render();
  },

  async _resolveProblem(id) {
    try {
      await this._hass.callWS({ type: `${WS}/resolve_problem`, entry_id: this._entryId, problem_id: id });
      if (this._pedit && this._pedit.id === id) this._pedit = null;
      this._error = null;
    } catch (err) {
      this._error = `${this._t.couldNotSend}: ${errMsg(err)}`;
    }
    this._render();
  },

  async _toggleSupply(el) {
    const supply = el.dataset.supply;
    const missing = el.getAttribute("aria-pressed") !== "true";
    // Optimistic, the subscription push confirms it
    el.classList.toggle("missing", missing);
    el.setAttribute("aria-pressed", String(missing));
    try {
      await this._hass.callWS({ type: `${WS}/set_supply_missing`, entry_id: this._entryId, supply, missing });
      this._error = null;
    } catch (err) {
      this._error = `${this._t.couldNotSend}: ${errMsg(err)}`;
    }
    this._render();
  },
});

/* ---------- visual card editor (dashboard edit mode) ---------- */

class CleaningPlanVisitCardEditor extends HTMLElement {
  setConfig(config) {
    this._config = { ...config };
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  _render() {
    if (!this._hass || !this._config) return;
    if (!this._form) {
      this._form = document.createElement("ha-form");
      this._form.addEventListener("value-changed", (e) => {
        const config = { ...e.detail.value };
        for (const k of Object.keys(config)) if (config[k] === "" || config[k] == null) delete config[k];
        this._config = config;
        this.dispatchEvent(new CustomEvent("config-changed", { detail: { config }, bubbles: true, composed: true }));
      });
      this.appendChild(this._form);
    }
    const labels = STRINGS[pickLang(this._hass)].editor;
    this._form.hass = this._hass;
    this._form.schema = [
      { name: "entry_id", selector: { config_entry: { integration: WS } } },
      { name: "title", selector: { text: {} } },
      { name: "allow_edit", selector: { boolean: {} } },
      { name: "column_width", selector: { number: { min: 150, max: 2000, step: 10, mode: "box", unit_of_measurement: "px" } } },
    ];
    this._form.data = { allow_edit: true, column_width: 300, ...this._config };
    this._form.computeLabel = (s) => labels[s.name] || s.name;
  }
}

const svg = (d, size = 24) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true"><path fill="currentColor" d="${d}"/></svg>`;
const CHECK = svg("M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z", 18);
const CHECK_S = svg("M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z", 14);
const CHEV_L = svg("M15.4 7.4 14 6l-6 6 6 6 1.4-1.4L10.8 12z");
const CHEV_R = svg("M8.6 16.6 10 18l6-6-6-6-1.4 1.4 4.6 4.6z");
const CHEV_D = svg("M7.4 8.6 6 10l6 6 6-6-1.4-1.4L12 13.2z", 22);
const ARROW_UP = svg("M13 20h-2V8l-5.5 5.5-1.42-1.42L12 4.16l7.92 7.92-1.42 1.42L13 8z", 20);
const ARROW_DOWN = svg("M11 4h2v12l5.5-5.5 1.42 1.42L12 19.84l-7.92-7.92L5.5 10.5 11 16z", 20);
const DELETE = svg("M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6zM8 9h8v10H8zm7.5-5-1-1h-5l-1 1H5v2h14V4z", 20);
const FLAG = svg("M12.36 6l.4 2H18v6h-3.36l-.4-2H7V6h5.36M14 4H5v17h2v-7h5.6l.4 2h7V6h-5.6z", 20);
const FLAG_ON = svg("M14.4 6 14 4H5v17h2v-7h5.6l.4 2h7V6z", 20);
const ALERT = svg("M13 14h-2V9h2m0 9h-2v-2h2M1 21h22L12 2z", 16);
const MINUS = svg("M19 13H5v-2h14z", 18);
const PLUS_S = svg("M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6z", 18);
const PLUS = svg("M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6z", 20);

const STYLE = `
  ha-card { padding: 16px 16px 12px; }
  button { font: inherit; color: inherit; background: none; border: 0; cursor: pointer; }
  button:focus-visible { outline: 2px solid var(--primary-color); outline-offset: 2px; border-radius: 6px; }
  .head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; flex-wrap: wrap; }
  .title { font-size: 1.35rem; font-weight: 500; color: var(--primary-text-color); }
  .flat { color: var(--primary-color); padding: 6px 10px; border-radius: 6px; font-weight: 500; }
  .flat:hover { background: rgba(var(--rgb-primary-color, 3,169,244), 0.08); }
  .primary { background: var(--primary-color); color: var(--text-primary-color, #fff); padding: 8px 16px; border-radius: 6px; font-weight: 500; }
  .primary:disabled { opacity: 0.4; cursor: not-allowed; }

  .visit { display: flex; align-items: center; gap: 4px; }
  .nav { width: 40px; height: 40px; border-radius: 50%; display: grid; place-items: center; color: var(--secondary-text-color); }
  .nav:hover { background: var(--secondary-background-color); }
  .when { flex: 1; text-align: center; }
  .when[data-act] { cursor: pointer; }
  .date { font-size: 1.1rem; font-weight: 500; color: var(--primary-text-color); }
  .sub { font-size: 0.85rem; color: var(--secondary-text-color); }
  .progress { height: 6px; border-radius: 3px; background: var(--divider-color); margin: 12px 0 4px; overflow: hidden; }
  .bar { height: 100%; background: var(--success-color, #43a047); transition: width .25s ease; }
  .count { display: flex; align-items: center; justify-content: space-between;
           font-size: 0.8rem; color: var(--secondary-text-color); margin-bottom: 4px; }
  .flat.small { font-size: 0.8rem; padding: 4px 8px; margin-left: -8px; }

  /* Locations flow into as many columns as fit the card width */
  .list { column-gap: 28px; }
  section { break-inside: avoid; -webkit-column-break-inside: avoid; page-break-inside: avoid;
            margin: 0 0 12px; padding-top: 2px; }
  .loc { display: flex; align-items: center; gap: 6px; width: 100%; text-align: left; min-height: 44px;
         padding: 4px 4px 4px 0; border-radius: 8px; border-bottom: 1px solid var(--divider-color);
         font-size: 1rem; font-weight: 600; color: var(--primary-text-color); }
  .loc:hover { background: var(--secondary-background-color); }
  .chev { flex: none; display: grid; place-items: center; color: var(--secondary-text-color);
          transition: transform .15s ease; }
  .folded .chev { transform: rotate(-90deg); }
  .loc-name { flex: 1; }
  .loc-count { flex: none; font-size: 0.8rem; font-weight: 500; color: var(--secondary-text-color);
               font-variant-numeric: tabular-nums; }
  .loc-done .loc-name, .loc-done .loc-count { color: var(--success-color, #43a047); }
  .tasks { padding-top: 2px; }
  .task { display: flex; align-items: center; gap: 12px; width: 100%; text-align: left;
          min-height: 48px; padding: 6px 4px; border-radius: 8px; }
  .task:hover { background: var(--secondary-background-color); }
  .box { flex: none; width: 24px; height: 24px; border-radius: 6px; display: grid; place-items: center;
         border: 2px solid var(--secondary-text-color); color: transparent; }
  .done .box { background: var(--success-color, #43a047); border-color: var(--success-color, #43a047);
               color: var(--text-primary-color, #fff); }
  .name { flex: 1; color: var(--primary-text-color); }
  .done .name { color: var(--secondary-text-color); text-decoration: line-through; }
  .freq { flex: none; font-size: 0.75rem; color: var(--secondary-text-color);
          border: 1px solid var(--divider-color); border-radius: 10px; padding: 1px 8px; }

  .head-btns { display: inline-flex; gap: 4px; flex-wrap: wrap; }

  /* feedback: supplies, problems */
  .chip { display: inline-flex; align-items: center; gap: 4px; min-height: 36px; padding: 4px 12px; border-radius: 18px;
          border: 1px solid var(--divider-color); font-size: 0.9rem; color: var(--primary-text-color); }
  .chip:hover { background: var(--secondary-background-color); }
  .chip.sel { background: var(--primary-color); border-color: var(--primary-color); color: var(--text-primary-color, #fff); }
  .supplies { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 8px 0 14px; }
  .sup-label { font-size: 0.85rem; font-weight: 500; color: var(--secondary-text-color); margin-right: 4px; }
  .chip.sup.missing { background: var(--warning-color, #ffa600); border-color: var(--warning-color, #ffa600); color: #fff; font-weight: 500; }
  .task-row { display: flex; align-items: center; }
  .task-row .task { flex: 1; min-width: 0; }
  .icon.flag { width: 40px; height: 40px; color: var(--secondary-text-color); opacity: 0.55; }
  .icon.flag:hover { opacity: 1; }
  .icon.flag.on { color: var(--warning-color, #ffa600); opacity: 1; }
  .problem-note { margin: -6px 44px 6px 40px; font-size: 0.8rem; color: var(--warning-color, #ffa600); font-weight: 500; }
  .problem-edit { margin: 0 0 10px 40px; padding: 10px; border-radius: 10px; background: var(--secondary-background-color);
                  display: flex; flex-direction: column; gap: 8px; }
  .problem-edit .kinds { display: flex; gap: 8px; flex-wrap: wrap; }
  .problem-edit .p-note { font: inherit; color: var(--primary-text-color); background: var(--card-background-color);
                          border: 1px solid var(--divider-color); border-radius: 6px; padding: 8px; min-height: 40px; }
  .p-actions { display: flex; align-items: center; gap: 8px; }
  .feedback { border: 1px solid var(--warning-color, #ffa600); border-radius: 10px; padding: 6px 10px; margin: 8px 0 12px; }
  .fb-title { font-weight: 600; font-size: 0.9rem; color: var(--primary-text-color); padding: 4px 0; }
  .fb-row { display: flex; align-items: flex-start; gap: 10px; padding: 6px 0; border-top: 1px dashed var(--divider-color); }
  .fb-kind { flex: none; font-size: 0.75rem; font-weight: 600; border-radius: 10px; padding: 2px 8px; margin-top: 2px;
             background: var(--warning-color, #ffa600); color: #fff; }
  .fb-kind.kind-skipped { background: var(--secondary-text-color); }
  .fb-text { flex: 1; min-width: 0; font-size: 0.9rem; color: var(--primary-text-color); }
  .fb-where { color: var(--secondary-text-color); font-size: 0.8rem; }
  .fb-note { color: var(--secondary-text-color); font-size: 0.85rem; }
  .fsupplies { margin-top: 18px; display: flex; flex-direction: column; gap: 6px; }
  .fsupply { display: flex; align-items: center; gap: 6px; }
  .fsupply .supply-input { flex: 1; min-width: 0; max-width: 420px; }

  /* floors in the tick-off list */
  .floor { margin: 4px 0 8px; }
  .floor-head { display: flex; align-items: center; gap: 6px; width: 100%; text-align: left; min-height: 44px;
                padding: 6px 8px 6px 4px; margin-bottom: 8px; border-radius: 8px;
                background: var(--secondary-background-color); color: var(--primary-text-color);
                font-size: 1.05rem; font-weight: 600; letter-spacing: 0.01em; }
  .floor-name { flex: 1; }
  .floor.folded .chev { transform: rotate(-90deg); }
  .floor-done .floor-name, .floor-done .floor-head .loc-count { color: var(--success-color, #43a047); }

  /* schedule overview */
  .ov-bar { display: flex; align-items: center; gap: 4px; margin-bottom: 8px; }
  .ov-bar .nav:disabled { opacity: 0.3; cursor: default; }
  .ov-info { flex: 1; font-size: 0.8rem; line-height: 1.4; color: var(--secondary-text-color); text-align: center; }
  .ov-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; margin: 0 -4px; padding: 0 4px 4px; }
  .ov { border-collapse: separate; border-spacing: 0; font-size: 0.85rem; min-width: 100%; }
  .ov th, .ov td { padding: 0; text-align: center; height: 36px; min-width: 40px; }
  .ov thead th { position: sticky; top: 0; background: var(--card-background-color); font-weight: 500;
                 color: var(--secondary-text-color); padding: 2px 2px 6px; border-bottom: 1px solid var(--divider-color); }
  .ov-v { font-size: 0.95rem; font-weight: 600; color: var(--primary-text-color); }
  .ov-d { font-size: 0.7rem; font-variant-numeric: tabular-nums; }
  .ov tr > th:first-child { position: sticky; left: 0; z-index: 1; background: var(--card-background-color);
                            text-align: left; padding: 4px 12px 4px 0; min-width: 9em; max-width: 16em; }
  .ov-corner { font-size: 0.75rem; vertical-align: bottom; }
  .ov-task { font-weight: 400; color: var(--primary-text-color); }
  .ov-name { display: block; line-height: 1.25; }
  .ov-task .freq { display: inline-block; margin-top: 2px; }
  .ov-every { display: inline-flex; align-items: center; gap: 2px; margin-top: 2px; }
  .ov-every .freq { margin-top: 0; min-width: 7.5em; text-align: center; }
  .icon.mini { width: 30px; height: 30px; }
  .ov-loc th { font-weight: 600; color: var(--primary-text-color); padding-top: 12px !important; height: auto;
               border-bottom: 1px solid var(--divider-color); }
  .ov-floor th { font-weight: 700; font-size: 0.95rem; color: var(--primary-text-color); padding-top: 16px !important;
                 height: auto; text-transform: uppercase; letter-spacing: 0.04em; }
  .ov-loc.in-floor th { padding-left: 10px !important; }
  .ov tbody tr:not(.ov-loc):not(.ov-floor) td, .ov tbody tr:not(.ov-loc):not(.ov-floor) th {
    border-bottom: 1px dashed var(--divider-color); }
  .ov .cur { background: rgba(var(--rgb-primary-color, 3,169,244), 0.08); }
  .ov thead th.cur .ov-v { color: var(--primary-color); }
  .ov .past { opacity: 0.5; }
  .dot { display: inline-grid; place-items: center; width: 18px; height: 18px; border-radius: 50%;
         background: var(--primary-color); color: var(--text-primary-color, #fff); vertical-align: middle; }
  .dot.ok { background: var(--success-color, #43a047); }
  .ov-set { width: 100%; height: 36px; border-radius: 6px; }
  .ov-set:hover::after, .ov-set:focus-visible::after { content: ""; display: inline-block; width: 14px; height: 14px;
         border-radius: 50%; border: 2px dashed var(--primary-color); vertical-align: middle; }
  .ov tfoot th { font-size: 0.8rem; font-weight: 500; color: var(--secondary-text-color); }
  .ov tfoot td { font-variant-numeric: tabular-nums; color: var(--secondary-text-color); }
  .ov-extra th, .ov-extra td { padding-top: 6px; }
  .lvl { display: inline-grid; place-items: center; min-width: 26px; height: 26px; border-radius: 6px; font-weight: 600;
         color: var(--primary-text-color);
         background: rgba(var(--rgb-primary-color, 3,169,244), calc(0.08 + var(--lvl) * 0.4)); }

  /* editor: tabs */
  .tabs { display: inline-flex; border: 1px solid var(--divider-color); border-radius: 8px; overflow: hidden; }
  .tab { padding: 6px 14px; font-size: 0.85rem; font-weight: 500; color: var(--secondary-text-color); border-radius: 0; }
  .tab.active { background: var(--primary-color); color: var(--text-primary-color, #fff); }

  /* editor: form */
  .form input, .form select {
    font: inherit; color: var(--primary-text-color); background: var(--card-background-color);
    border: 1px solid var(--divider-color); border-radius: 6px; padding: 6px 8px; min-height: 40px; box-sizing: border-box; }
  .form input:focus, .form select:focus { outline: 2px solid var(--primary-color); outline-offset: -1px; }
  .form input::placeholder { color: var(--secondary-text-color); opacity: 0.7; }
  .form input.invalid { border-color: var(--error-color, #db4437); outline-color: var(--error-color, #db4437); }
  .form input.num { width: 4.2em; text-align: center; padding: 6px 4px; }
  .settings { display: flex; flex-wrap: wrap; gap: 12px 32px; margin: 4px 0 16px; }
  .field { display: flex; flex-direction: column; gap: 4px; font-size: 0.8rem; color: var(--secondary-text-color); }
  .inline { display: flex; align-items: center; gap: 6px; }
  .ffloor { border-radius: 12px; margin-bottom: 12px; background: var(--secondary-background-color); }
  .ffloor-head { display: flex; align-items: center; gap: 6px; padding: 8px 6px 8px 2px; }
  .ffloor-head .floor-input { flex: 1; min-width: 0; font-weight: 600; font-size: 1.05rem; }
  .ffloor .loc-count { min-width: 5.5em; text-align: right; }
  .ffloor-body { padding: 0 8px 4px 12px; }
  .ffloor-body .floc { background: var(--card-background-color); }
  .add-floor { margin-top: 4px; }
  .floc { border: 1px solid var(--divider-color); border-radius: 10px; margin-bottom: 10px; }
  .floc-head { display: flex; align-items: center; gap: 6px; padding: 6px 6px 6px 2px; }
  .floc-head .loc-input { flex: 1; min-width: 0; font-weight: 600; }
  .floc .loc-count { min-width: 5.5em; text-align: right; }
  .ftasks { padding: 0 8px 4px 12px; border-top: 1px solid var(--divider-color); }
  .ftask { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; padding: 8px 0;
           border-bottom: 1px dashed var(--divider-color); }
  .ftask .task-input { flex: 1 1 220px; min-width: 0; }
  .freq-ctl { display: inline-flex; align-items: center; gap: 6px; font-size: 0.85rem; color: var(--secondary-text-color); flex-wrap: wrap; }
  .from { display: inline-flex; align-items: center; gap: 6px; }
  .from[hidden] { display: none; }
  .row-btns { display: inline-flex; margin-left: auto; }
  .due-hint { flex-basis: 100%; font-size: 0.75rem; color: var(--secondary-text-color); }
  .due-hint:empty { display: none; }
  .icon { width: 36px; height: 36px; border-radius: 50%; display: grid; place-items: center; color: var(--secondary-text-color); flex: none; }
  .icon:hover:not(:disabled) { background: var(--secondary-background-color); }
  .icon:disabled { opacity: 0.25; cursor: default; }
  .icon.danger:hover:not(:disabled) { color: var(--error-color, #db4437); }
  .add { display: inline-flex; align-items: center; gap: 6px; color: var(--primary-color); font-weight: 500;
         padding: 10px 6px; border-radius: 6px; }
  .add:hover { background: rgba(var(--rgb-primary-color, 3,169,244), 0.08); }
  .note { font-size: 0.8rem; line-height: 1.4; background: var(--secondary-background-color); color: var(--secondary-text-color);
          padding: 8px 10px; border-radius: 8px; margin-bottom: 12px; }

  /* editor: text */
  .edit textarea { width: 100%; box-sizing: border-box; min-height: min(70vh, 1000px); resize: vertical;
         font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.9rem; line-height: 1.5;
         padding: 10px; border-radius: 8px; border: 1px solid var(--divider-color);
         background: var(--card-background-color); color: var(--primary-text-color); }
  .hint { font-size: 0.8rem; color: var(--secondary-text-color); margin: 8px 0; line-height: 1.5; }
  .hint code { background: var(--secondary-background-color); padding: 0 4px; border-radius: 4px; }
  .errors { color: var(--error-color, #db4437); font-size: 0.85rem; line-height: 1.5; margin-top: 8px; }
  .actions { display: flex; align-items: center; gap: 8px; margin-top: 10px; }
  .spacer { flex: 1; }
  .msg { padding: 12px 0; color: var(--secondary-text-color); }
  .msg.err { color: var(--error-color, #db4437); }
  @media (prefers-reduced-motion: reduce) { .bar, .chev { transition: none; } }
`;

if (!customElements.get(CARD_TYPE)) {
  customElements.define(CARD_TYPE, CleaningPlanVisitCard);
  customElements.define(EDITOR_TYPE, CleaningPlanVisitCardEditor);
  window.customCards = window.customCards || [];
  window.customCards.push({
    type: CARD_TYPE,
    name: "Cleaning plan",
    description: "Tick-off list of a cleaning plan, grouped by location, with a plan editor",
    preview: true,
  });
  console.info(`%c CLEANING-PLAN-CARD %c ${CARD_VERSION} `, "background:#43a047;color:#fff", "");
}

// For tests in Node (no effect in the browser)
if (typeof module !== "undefined")
  module.exports = { modelFromPlan, modelToText, modelRenames, validateModel, buildOverview, cycleLength, flattenModel, STRINGS };
