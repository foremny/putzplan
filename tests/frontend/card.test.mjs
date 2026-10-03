// Smoke tests for the card in jsdom with a fake Home Assistant connection.
// Run: cd tests/frontend && npm install && npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const CARD = new URL("../../custom_components/cleaning_plan/frontend/cleaning-plan-card.js", import.meta.url);
const MANIFEST = new URL("../../custom_components/cleaning_plan/manifest.json", import.meta.url);

const SNAPSHOT = {
  title: "Putzplan",
  text: "# Config\n- Rhythmus: 2 Wochen\n- Starttag: 6.10.2026\n# Schedule\n### Küche\n- Spüle\n- Kühlschrank (alle 2. Mal ab 2)\n### Bad\n- Toilette",
  plan: {
    rhythm: 14,
    start: "2026-10-06",
    locations: [
      { name: "Küche", tasks: [{ name: "Spüle", every: 1, from: 1 }, { name: "Kühlschrank", every: 2, from: 2 }] },
      { name: "Bad", tasks: [{ name: "Toilette", every: 1, from: 1 }] },
    ],
    errors: [],
  },
  today: "2026-10-06",
  current_visit: 1,
  done: { "2026-10-06": [["", "Bad", "Toilette"]] },
};

const plain = (o) => JSON.parse(JSON.stringify(o));
const tick = () => new Promise((r) => setTimeout(r, 0));

function setup(language = "de") {
  const dom = new JSDOM("<!doctype html><body></body>", { runScripts: "outside-only" });
  const { window } = dom;
  window.eval(readFileSync(CARD, "utf8"));
  const calls = [];
  const subs = [];
  const hass = {
    locale: { language, date_format: "language" },
    callWS: async (msg) => {
      calls.push(msg);
      if (msg.type === "cleaning_plan/plans") return [{ entry_id: "e1", title: "Putzplan" }];
      if (msg.type === "cleaning_plan/validate")
        return { errors: msg.text.includes("???") ? [{ code: "freq_invalid", line: 2 }] : [], plan: SNAPSHOT.plan };
      if (msg.type === "cleaning_plan/save_plan") return { saved: true, errors: [] };
      return null;
    },
    connection: {
      subscribeMessage: async (cb, msg) => {
        subs.push({ cb, msg, closed: false });
        const sub = subs[subs.length - 1];
        return async () => {
          sub.closed = true;
        };
      },
    },
  };
  const card = window.document.createElement("cleaning-plan-visit-card");
  return { window, card, hass, calls, subs };
}

const root = (card) => card.shadowRoot;
const text = (card) => root(card).textContent.replace(/\s+/g, " ");

test("card version matches the integration version", () => {
  const src = readFileSync(CARD, "utf8");
  const version = JSON.parse(readFileSync(MANIFEST, "utf8")).version;
  assert.match(src, new RegExp(`CARD_VERSION = "${version.replace(/\./g, "\\.")}"`));
});

test("subscribes to the first plan and renders the visit folded", async () => {
  const { window, card, hass, subs } = setup();
  card.setConfig({});
  window.document.body.appendChild(card);
  card.hass = hass;
  await tick();
  await tick();
  assert.equal(subs.length, 1);
  assert.deepEqual(plain(subs[0].msg), { type: "cleaning_plan/subscribe", entry_id: "e1" });

  subs[0].cb(SNAPSHOT);
  const t = text(card);
  assert.match(t, /Putzplan/);
  assert.match(t, /Dienstag, 6\. Oktober/);
  assert.match(t, /Heute, Besuch 1/);
  assert.match(t, /1 von 2 erledigt/);
  assert.match(t, /Küche 0\/1/);
  assert.match(t, /Bad 1\/1/);
  assert.equal(root(card).querySelectorAll(".task").length, 0, "all locations start folded");
  assert.ok(!t.includes("Kühlschrank"), "not due on visit 1");
});

test("unfold, tick a task and send set_done", async () => {
  const { window, card, hass, subs, calls } = setup();
  card.setConfig({ entry_id: "e1" });
  window.document.body.appendChild(card);
  card.hass = hass;
  await tick();
  subs[0].cb(SNAPSHOT);

  root(card).querySelector('[data-act="fold"]').click(); // Küche
  const task = root(card).querySelector(".task");
  assert.equal(task.dataset.task, "Spüle");
  task.click();
  await tick();
  const set = calls.find((c) => c.type === "cleaning_plan/set_done");
  assert.deepEqual(plain(set), {
    type: "cleaning_plan/set_done",
    entry_id: "e1",
    date: "2026-10-06",
    floor: "",
    location: "Küche",
    task: "Spüle",
    done: true,
  });
});

test("next visit shows the fortnightly task and English labels", async () => {
  const { window, card, hass, subs } = setup("en-GB");
  card.setConfig({ entry_id: "e1", title: "House" });
  window.document.body.appendChild(card);
  card.hass = hass;
  await tick();
  subs[0].cb(SNAPSHOT);
  root(card).querySelector('[data-act="next"]').click();
  root(card).querySelector('[data-act="fold-all"]').click();
  const t = text(card);
  assert.match(t, /House/);
  assert.match(t, /Tuesday 20 October/);
  assert.match(t, /In 14 days, visit 2/);
  assert.match(t, /Kühlschrank/);
  assert.match(t, /every 2\. time, from 2\./);
});

test("cleaner view hides editing, navigation, dates and frequencies", async () => {
  const { window, card, hass, subs } = setup();
  card.setConfig({ entry_id: "e1", allow_edit: false });
  window.document.body.appendChild(card);
  card.hass = hass;
  await tick();
  subs[0].cb({ ...SNAPSHOT, today: "2026-10-01" }); // visit 1 is in 5 days
  const t = text(card);
  assert.equal(root(card).querySelector('[data-act="edit"]'), null);
  assert.equal(root(card).querySelector('[data-act="prev"]'), null);
  assert.equal(root(card).querySelector(".visit"), null, "no date block");
  assert.ok(!/Oktober|Dienstag|In 5 Tagen|Heute|Besuch 1/.test(t), "no date, due line or visit number");
  assert.match(t, /1 von 2 erledigt/, "progress stays");
  root(card).querySelector('[data-act="fold"]').click();
  assert.ok(root(card).querySelector(".task"), "tasks stay");
  assert.equal(root(card).querySelector(".freq"), null);
});

/* ---------- plan editor ---------- */

const FIXTURE_DE = readFileSync(new URL("../fixtures/form_de.txt", import.meta.url), "utf8");
const FIXTURE_EN = readFileSync(new URL("../fixtures/form_en.txt", import.meta.url), "utf8");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function editor(snapshot = SNAPSHOT, language = "de") {
  const env = setup(language);
  const { window, card, hass, subs } = env;
  window.confirm = () => true;
  card.setConfig({ entry_id: "e1" });
  window.document.body.appendChild(card);
  card.hass = hass;
  await tick();
  subs[0].cb(snapshot);
  root(card).querySelector('[data-act="edit"]').click();
  const $ = (sel) => root(card).querySelector(sel);
  const type = (el, value) => {
    el.value = value;
    el.dispatchEvent(new window.Event("input", { bubbles: true }));
  };
  const enter = (el) => el.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  const save = async () => {
    $('[data-act="save"]').click();
    await tick();
    return env.calls.filter((c) => c.type === "cleaning_plan/save_plan").pop();
  };
  return { ...env, $, type, enter, save };
}

test("form opens with settings and folded locations", async () => {
  const { card, $ } = await editor();
  assert.equal($('.tab.active').dataset.mode, "form");
  assert.equal($('[data-f="rhythmN"]').value, "2");
  assert.equal($('[data-f="rhythmUnit"]').value, "w");
  assert.equal($('[data-f="start"]').value, "2026-10-06");
  const locs = [...root(card).querySelectorAll('[data-f="locName"]')].map((i) => i.value);
  assert.deepEqual(locs, ["Küche", "Bad"]);
  assert.match(text(card), /2 Aufgaben/);
  assert.equal(root(card).querySelectorAll(".ftask").length, 0, "locations start folded");
});

test("saving an unchanged form writes canonical German text", async () => {
  const { save } = await editor();
  const call = await save();
  assert.equal(call.text, FIXTURE_DE);
  assert.deepEqual(plain(call.renames), []);
});

test("English users get English keywords, days, ISO dates and colons in names", async () => {
  const snapshot = {
    ...SNAPSHOT,
    plan: {
      rhythm: 10,
      start: "2026-10-06",
      locations: [
        {
          name: "Kitchen",
          tasks: [
            { name: "Sink", every: 1, from: 1 },
            { name: "Oven: inside", every: 3, from: 1 },
            { name: "Fridge", every: 1, from: 2 },
            { name: "Window (inside)", every: 1, from: 1 },
          ],
        },
      ],
      errors: [],
    },
  };
  const { save } = await editor(snapshot, "en");
  assert.equal((await save()).text, FIXTURE_EN);
});

test("renaming a task and a location sends renames so ticks follow", async () => {
  const { card, $, type, save } = await editor();
  $('[data-act="f-fold"][data-li="0"]').click();
  type($('[data-f="taskName"][data-li="0"][data-ti="0"]'), "Spülbecken");
  type($('[data-f="locName"][data-li="1"]'), "Badezimmer");
  const call = await save();
  assert.match(call.text, /\n- Spülbecken\n/);
  assert.match(call.text, /\n### Badezimmer\n/);
  assert.deepEqual(plain(call.renames), [
    { from: ["", "Küche", "Spüle"], to: ["", "Küche", "Spülbecken"] },
    { from: ["", "Bad", "Toilette"], to: ["", "Badezimmer", "Toilette"] },
  ]);
  assert.ok(root(card).querySelector(".list"), "back in the list view after saving");
});

test("add a location and tasks with Enter, set a frequency, see the due hint", async () => {
  const { card, $, type, enter, save } = await editor();
  $('[data-act="f-add-loc"]').click();
  const locInput = $('[data-f="locName"][data-li="2"]');
  assert.equal(root(card).activeElement, locInput, "new location name is focused");
  type(locInput, "Fenster");
  enter(locInput);
  const task0 = $('[data-f="taskName"][data-li="2"][data-ti="0"]');
  assert.equal(root(card).activeElement, task0, "Enter in the location name starts the first task");
  type(task0, "Innen putzen");
  assert.equal($('[data-li="2"][data-ti="0"] ~ .from, .ftask .from').hidden, true, "no 'from' for every time");
  type($('[data-f="every"][data-li="2"][data-ti="0"]'), "4");
  const from = $('[data-f="from"][data-li="2"][data-ti="0"]');
  assert.equal(from.closest(".from").hidden, false);
  type(from, "2");
  assert.match($('.due-hint[data-li="2"][data-ti="0"]').textContent, /Besuche 2, 6, 10 … · nächstes Mal Di\., 20\. Okt\. \(Besuch 2\)/);
  enter(task0);
  const task1 = $('[data-f="taskName"][data-li="2"][data-ti="1"]');
  assert.equal(root(card).activeElement, task1, "Enter in a task adds the next one");
  // task1 stays empty and is dropped on save
  const call = await save();
  assert.match(call.text, /\n\n### Fenster\n- Innen putzen \(alle 4\. Mal ab 2\)\n$/);
});

test("form errors mark the input and block saving", async () => {
  const { card, $, type } = await editor();
  const bad = $('[data-f="locName"][data-li="1"]');
  type(bad, "Küche");
  assert.match($("#errors").textContent, /zwei Orte namens „Küche“/);
  assert.ok(bad.classList.contains("invalid"));
  assert.equal($('[data-act="save"]').disabled, true);
  type(bad, "Bad #");
  assert.match($("#errors").textContent, /„Bad #“ darf nicht mit „ #“ enden/);
  type(bad, "Bad");
  type($('[data-f="rhythmN"]'), "0");
  assert.match($("#errors").textContent, /Rhythmus muss mindestens 1/);
  type($('[data-f="rhythmN"]'), "1");
  type($('[data-f="start"]'), "");
  assert.match($("#errors").textContent, /ersten Termins/);
  type($('[data-f="start"]'), "2026-10-06");
  assert.equal($("#errors").textContent, "");
  assert.equal($('[data-act="save"]').disabled, false);
  assert.equal(root(card).querySelectorAll(".invalid").length, 0);
});

test("move and delete locations and tasks", async () => {
  const { card, $, save } = await editor();
  $('[data-act="f-loc-down"][data-li="0"]').click(); // Bad, Küche
  assert.equal($('[data-act="f-loc-up"][data-li="0"]').disabled, true);
  $('[data-act="f-fold"][data-li="1"]').click(); // open Küche
  $('[data-act="f-task-up"][data-li="1"][data-ti="1"]').click(); // Kühlschrank, Spüle
  $('[data-act="f-task-del"][data-li="1"][data-ti="1"]').click(); // drop Spüle
  const call = await save();
  assert.match(call.text, /# Schedule\n\n### Bad\n- Toilette\n\n### Küche\n- Kühlschrank \(alle 2\. Mal ab 2\)\n$/);

  // Deleting a location with tasks asks first
  const env = await editor();
  let asked = null;
  env.window.confirm = (q) => ((asked = q), false);
  env.$('[data-act="f-loc-del"][data-li="0"]').click();
  assert.match(asked, /„Küche“ mit 2 Aufgaben löschen\?/);
  assert.equal(root(env.card).querySelectorAll(".floc").length, 2, "kept after cancelling");
});

test("switch between form and text", async () => {
  const { card, $, type } = await editor();
  $('[data-act="f-fold"][data-li="1"]').click();
  type($('[data-f="taskName"][data-li="1"][data-ti="0"]'), "WC");
  $('[data-act="mode"][data-mode="text"]').click();
  await tick();
  const ta = $("#plan-text");
  assert.match(ta.value, /\n- WC\n/, "form edits carry over to the text");
  type(ta, "# Schedule\n### Küche\n- x (???)");
  await wait(300);
  $('[data-act="mode"][data-mode="form"]').click();
  await tick();
  assert.equal($('.tab.active').dataset.mode, "text", "stays in text while it has errors");
  assert.match($("#errors").textContent, /Erst die Fehler im Text beheben/);
  type(ta, FIXTURE_DE);
  await wait(300);
  $('[data-act="mode"][data-mode="form"]').click();
  await tick();
  assert.equal($('.tab.active').dataset.mode, "form");
});

test("a new plan starts with an empty location; cancel asks when dirty", async () => {
  const empty = { ...SNAPSHOT, text: "", plan: { rhythm: 14, start: null, locations: [], errors: [{ code: "start_missing", line: null }] } };
  const { window, card, $, type } = await editor(empty);
  assert.equal($('.tab.active').dataset.mode, "form");
  assert.equal($('[data-f="start"]').value, "2026-10-06", "start defaults to today");
  assert.equal(root(card).activeElement, $('[data-f="locName"][data-li="0"]'));
  assert.ok($('[data-act="example"]'), "example offered for an empty plan");
  type($('[data-f="locName"][data-li="0"]'), "Flur");
  let asked = false;
  window.confirm = () => ((asked = true), false);
  $('[data-act="cancel"]').click();
  assert.ok(asked);
  assert.ok($(".form"), "still editing after declining");
});

test("plans with comments warn before the form drops them", async () => {
  const { $ } = await editor({ ...SNAPSHOT, text: "<!-- Notiz -->\n" + SNAPSHOT.text });
  assert.match($(".note").textContent, /Kommentare/);
});

test("text editor validates on the server and saves", async () => {
  const { window, card, hass, subs, calls } = setup();
  card.setConfig({ entry_id: "e1" });
  window.document.body.appendChild(card);
  card.hass = hass;
  await tick();
  subs[0].cb(SNAPSHOT);
  root(card).querySelector('[data-act="edit"]').click();
  root(card).querySelector('[data-act="mode"][data-mode="text"]').click();
  const ta = root(card).getElementById("plan-text");
  assert.equal(ta.value, FIXTURE_DE, "the text tab shows the form's canonical text");

  ta.value = "# Schedule\n### Küche\n- x (???)";
  ta.dispatchEvent(new window.Event("input", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 300));
  assert.match(root(card).getElementById("errors").textContent, /Zeile 2: Häufigkeit als „\(jedes Mal\)“/);
  assert.equal(root(card).querySelector('[data-act="save"]').disabled, true);

  ta.value = SNAPSHOT.text;
  ta.dispatchEvent(new window.Event("input", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 300));
  const save = root(card).querySelector('[data-act="save"]');
  assert.equal(save.disabled, false);
  save.click();
  await tick();
  assert.ok(calls.some((c) => c.type === "cleaning_plan/save_plan" && c.text === SNAPSHOT.text));
  assert.ok(root(card).querySelector(".list"), "back in the list view");
});

test("reload event resubscribes; disconnect unsubscribes", async () => {
  const { window, card, hass, subs } = setup();
  card.setConfig({ entry_id: "e1" });
  window.document.body.appendChild(card);
  card.hass = hass;
  await tick();
  subs[0].cb(SNAPSHOT);
  subs[0].cb({ reload: true });
  await new Promise((r) => setTimeout(r, 1100));
  assert.equal(subs.length, 2);
  card.remove();
  await tick();
  assert.equal(subs[1].closed, true);
});

/* ---------- schedule overview ---------- */

async function household(snapshot = SNAPSHOT, config = {}) {
  const env = setup();
  const { window, card, hass, subs } = env;
  card.setConfig({ entry_id: "e1", ...config });
  window.document.body.appendChild(card);
  card.hass = hass;
  await tick();
  subs[0].cb(snapshot);
  const $ = (sel) => root(card).querySelector(sel);
  const $$ = (sel) => [...root(card).querySelectorAll(sel)];
  return { ...env, $, $$ };
}

const planWith = (tasks) => ({
  ...SNAPSHOT,
  plan: { ...SNAPSHOT.plan, locations: [{ name: "Haus", tasks }] },
  done: {},
});

test("household overview shows irregular tasks per visit with load", async () => {
  const snap = { ...SNAPSHOT, done: { "2026-10-20": [["", "Küche", "Kühlschrank"]] } };
  const { $, $$ } = await household(snap);
  $('[data-act="overview"]').click();
  const visits = $$(".ov thead .ov-v").map((n) => n.textContent);
  assert.deepEqual(visits, ["1", "2", "3", "4", "5", "6", "7", "8"], "at least 8 visits");
  assert.match($$(".ov thead .ov-d")[1].textContent, /20\.10\./);
  assert.ok($$(".ov thead th")[1].classList.contains("cur"), "current visit highlighted");
  const rows = $$(".ov tbody tr:not(.ov-loc)");
  assert.equal(rows.length, 1, "only the irregular task (Kühlschrank)");
  assert.match(rows[0].querySelector("th").textContent, /Kühlschrank\s*alle 2\. Mal, ab 2\./);
  const due = [...rows[0].querySelectorAll("td")].map((td) => (td.querySelector(".dot.ok") ? "✓" : td.querySelector(".dot") ? "●" : "·"));
  assert.deepEqual(due, ["·", "✓", "·", "●", "·", "●", "·", "●"]);
  const nums = (sel) => $$(sel).map((n) => n.textContent.trim());
  assert.deepEqual(nums(".ov-extra td"), ["0", "1", "0", "1", "0", "1", "0", "1"]);
  assert.deepEqual(nums(".ov-total td"), ["2", "3", "2", "3", "2", "3", "2", "3"]);
  assert.equal($(".ov-set"), null, "no tap-to-move outside the editor");
  $('[data-act="back"]').click();
  assert.ok($(".list"));
});

test("overview pages through visits", async () => {
  const { $, $$ } = await household();
  $('[data-act="overview"]').click();
  assert.equal($('[data-act="ov-prev"]').disabled, true);
  $('[data-act="ov-next"]').click();
  assert.deepEqual($$(".ov thead .ov-v").map((n) => n.textContent), ["9", "10", "11", "12", "13", "14", "15", "16"]);
  $('[data-act="ov-prev"]').click();
  assert.equal($$(".ov thead .ov-v")[0].textContent, "1");
});

test("overview covers one full cycle, up to 16 visits", async () => {
  let env = await household(planWith([{ name: "A", every: 3, from: 1 }, { name: "B", every: 4, from: 2 }]));
  env.$('[data-act="overview"]').click();
  assert.equal(env.$$(".ov thead .ov-v").length, 12);
  assert.match(env.$(".ov-info").textContent, /alle 12 Besuche/);

  env = await household(planWith([{ name: "A", every: 5, from: 1 }, { name: "B", every: 7, from: 1 }]));
  env.$('[data-act="overview"]').click();
  assert.equal(env.$$(".ov thead .ov-v").length, 16);
  assert.match(env.$(".ov-info").textContent, /alle 35 Besuche; 16 werden jeweils gezeigt/);

  env = await household(planWith([{ name: "A", every: 1, from: 1 }]));
  env.$('[data-act="overview"]').click();
  assert.match(text(env.card), /Alle Aufgaben sind bei jedem Besuch fällig/);
});

test("overview is for planners only", async () => {
  const { $ } = await household(SNAPSHOT, { allow_edit: false });
  assert.equal($('[data-act="overview"]'), null);
});

test("editor overview tab follows unsaved edits and moves a task's turn", async () => {
  const { card, $, type, save } = await editor();
  $('[data-act="f-fold"][data-li="0"]').click();
  type($('[data-f="every"][data-li="0"][data-ti="0"]'), "3"); // Spüle: every 3rd visit
  $('[data-act="mode"][data-mode="overview"]').click();
  await tick();
  const names = [...root(card).querySelectorAll(".ov-name")].map((n) => n.textContent);
  assert.deepEqual(names, ["Spüle", "Kühlschrank"], "unsaved change shows up");
  assert.match($(".ov-info").textContent, /alle 6 Besuche/);
  // Move Kühlschrank (every 2 from 2) to visit 3 -> from 1
  $('[data-act="f-ov-set"][data-li="0"][data-ti="1"][data-v="3"]').click();
  const row = [...root(card).querySelectorAll(".ov tbody tr")].find((r) => /Kühlschrank/.test(r.textContent));
  assert.match(row.querySelector(".freq").textContent, /^alle 2\. Mal$/);
  assert.ok(row.querySelectorAll("td")[2].querySelector(".dot"), "now due on visit 3");
  const call = await save();
  assert.match(call.text, /\n- Spüle \(alle 3\. Mal\)\n- Kühlschrank \(alle 2\. Mal\)\n/);
});

test("buildOverview counts extra and total tasks", () => {
  const dom = new JSDOM("", { runScripts: "outside-only" });
  dom.window.module = { exports: {} };
  dom.window.eval(readFileSync(CARD, "utf8"));
  const { buildOverview, cycleLength } = dom.window.module.exports;
  const locations = [
    { name: "K", tasks: [{ name: "a", every: 1, from: 1 }, { name: "b", every: 2, from: 2 }] },
    { name: "B", tasks: [{ name: "c", every: 1, from: 3 }] },
  ];
  assert.equal(cycleLength(locations), 2);
  const ov = buildOverview({ rhythm: 14, start: 100, locations }, 1, 4);
  assert.deepEqual(plain(ov.visits), [1, 2, 3, 4]);
  assert.deepEqual(plain(ov.dates), [100, 114, 128, 142]);
  assert.deepEqual(plain(ov.extra), [0, 1, 1, 2]);
  assert.deepEqual(plain(ov.total), [1, 2, 2, 3]);
  assert.deepEqual(plain(ov.groups.map((g) => [g.name, g.rows.map((r) => r.task.name)])), [["K", ["b"]], ["B", ["c"]]]);
});

/* ---------- floors ---------- */

const FIXTURE_FLOORS = readFileSync(new URL("../fixtures/form_floors_de.txt", import.meta.url), "utf8");

const FLOORS = {
  ...SNAPSHOT,
  text: FIXTURE_FLOORS,
  plan: {
    rhythm: 14,
    start: "2026-10-06",
    locations: [
      { floor: "", name: "Keller", tasks: [{ name: "Fegen", every: 1, from: 1 }] },
      { floor: "Erdgeschoss", name: "Küche", tasks: [{ name: "Spüle", every: 1, from: 1 }] },
      { floor: "Erdgeschoss", name: "Bad", tasks: [{ name: "Toilette", every: 2, from: 1 }] },
      {
        floor: "Obergeschoss",
        name: "Bad",
        tasks: [
          { name: "Toilette", every: 1, from: 1 },
          { name: "Dusche", every: 2, from: 2 },
        ],
      },
    ],
    errors: [],
  },
  done: { "2026-10-06": [["Obergeschoss", "Bad", "Toilette"]] },
};

test("tick-off list groups locations under floors and keeps same-named locations apart", async () => {
  const { card, $, $$, calls } = await household(FLOORS);
  assert.deepEqual($$(".floor-name").map((n) => n.textContent), ["Erdgeschoss", "Obergeschoss"]);
  assert.deepEqual($$(".floor-head .loc-count").map((n) => n.textContent), ["0/2", "1/1"]);
  assert.ok($$(".floor")[1].classList.contains("folded"), "a finished floor folds by itself");
  assert.match(text(card), /Keller 0\/1/, "locations without a floor come first, without a header");
  assert.match(text(card), /Bad 0\/1/, "ground floor bathroom is not ticked");

  $$(".floor-head")[1].click(); // reopen the upper floor
  const og = $$(".floor")[1];
  assert.ok(!og.classList.contains("folded"));
  og.querySelector('[data-act="fold"]').click();
  const upper = $$(".floor")[1].querySelector(".task");
  assert.equal(upper.dataset.floor, "Obergeschoss");
  assert.equal(upper.getAttribute("aria-checked"), "true");

  $$(".floor")[0].querySelectorAll('[data-act="fold"]')[1].click(); // open EG / Bad
  const lower = $$(".floor")[0].querySelector('.task[data-loc="Bad"]');
  assert.equal(lower.getAttribute("aria-checked"), "false");
  lower.click();
  await tick();
  const set = calls.filter((c) => c.type === "cleaning_plan/set_done").pop();
  assert.deepEqual(plain(set), {
    type: "cleaning_plan/set_done",
    entry_id: "e1",
    date: "2026-10-06",
    floor: "Erdgeschoss",
    location: "Bad",
    task: "Toilette",
    done: true,
  });
});

test("form shows floors as boxes and writes floor lines", async () => {
  const { card, $, save } = await editor(FLOORS);
  const floors = [...root(card).querySelectorAll('[data-f="floorName"]')];
  assert.deepEqual(floors.map((i) => i.value), ["", "Erdgeschoss", "Obergeschoss"]);
  assert.match(floors[0].placeholder, /Ohne Etage/);
  assert.match(text(card), /2 Orte/);
  const call = await save();
  assert.equal(call.text, FIXTURE_FLOORS);
  assert.deepEqual(plain(call.renames), []);
});

test("add a floor to a plan without floors, then a location in it", async () => {
  const { card, $, type, enter, save } = await editor();
  assert.equal($('[data-f="floorName"]'), null, "no floor boxes until floors are used");
  $('[data-act="f-add-floor"]').click();
  const names = [...root(card).querySelectorAll('[data-f="floorName"]')];
  assert.equal(names.length, 2);
  assert.equal(root(card).activeElement, names[1], "new floor name is focused");
  type(names[1], "Obergeschoss");
  enter(names[1]);
  const loc = $('[data-f="locName"][data-fi="1"][data-li="0"]');
  assert.equal(root(card).activeElement, loc, "Enter in a floor name starts its first location");
  type(loc, "Flur");
  enter(loc);
  type($('[data-f="taskName"][data-fi="1"][data-li="0"][data-ti="0"]'), "Saugen");
  const call = await save();
  assert.match(call.text, /\n- Toilette\n\n## Obergeschoss\n\n### Flur\n- Saugen\n$/);
});

test("moving a location past the end of a floor moves it to the next floor, ticks follow", async () => {
  const { card, $, save } = await editor(FLOORS);
  // Küche is the first location of Erdgeschoss; up moves it to the end of the unnamed floor
  $('[data-act="f-loc-up"][data-fi="1"][data-li="0"]').click();
  const first = [...root(card).querySelectorAll('[data-fi="0"][data-f="locName"]')].map((i) => i.value);
  assert.deepEqual(first, ["Keller", "Küche"]);
  // OG Bad down is disabled (last location of the last floor)
  assert.equal($('[data-act="f-loc-down"][data-fi="2"][data-li="0"]').disabled, true);
  const call = await save();
  assert.match(call.text, /### Keller\n- Fegen\n\n### Küche\n- Spüle\n\n## Erdgeschoss\n/);
  assert.deepEqual(plain(call.renames), [{ from: ["Erdgeschoss", "Küche", "Spüle"], to: ["", "Küche", "Spüle"] }]);
});

test("floor names are checked", async () => {
  const { card, $, type } = await editor(FLOORS);
  const og = $('[data-f="floorName"][data-fi="2"]');
  type(og, "Erdgeschoss");
  assert.match($("#errors").textContent, /zwei Etagen namens „Erdgeschoss“/);
  assert.ok(og.classList.contains("invalid"));
  type(og, "");
  assert.match($("#errors").textContent, /Nur die erste Etage darf ohne Namen bleiben/);
  assert.equal($('[data-act="save"]').disabled, true);
  type(og, "Obergeschoss");
  type($('[data-f="floorName"][data-fi="0"]'), "Keller");
  assert.equal($("#errors").textContent, "", "the first floor may get a name too");
  // deleting a floor with locations asks first
  const env = await editor(FLOORS);
  let asked = null;
  env.window.confirm = (q) => ((asked = q), true);
  env.$('[data-act="f-floor-del"][data-fi="1"]').click();
  assert.match(asked, /Etage „Erdgeschoss“ mit 2 Orten löschen\?/);
  assert.equal(root(env.card).querySelectorAll(".ffloor").length, 2);
});

test("overview groups irregular tasks under floors", async () => {
  const { $, $$ } = await household(FLOORS);
  $('[data-act="overview"]').click();
  assert.deepEqual($$(".ov-floor th").map((n) => n.textContent), ["Erdgeschoss", "Obergeschoss"]);
  assert.deepEqual($$(".ov tbody .ov-name").map((n) => n.textContent), ["Toilette", "Dusche"]);
});

test("a plan in the old format explains the new one and opens in the text tab", async () => {
  const old = {
    ...SNAPSHOT,
    text: "Rhythmus: 2 Wochen\nStarttag: 6.10.2026\nKüche\n* Spüle : jedes Mal",
    plan: { rhythm: 14, start: null, locations: [], errors: [{ code: "old_format", line: null }] },
    current_visit: null,
  };
  const { card, $ } = await household(old);
  assert.match(text(card), /Der Plan ist im alten Format\. Seit Version 0\.6 ist er Markdown/);
  $('[data-act="edit"]').click();
  assert.equal($(".tab.active").dataset.mode, "text");
  assert.equal($("#plan-text").value, old.text);
  assert.match($("#errors").textContent, /alten Format/);
});

/* ---------- feedback: supplies and problems ---------- */

const FEEDBACK = {
  ...SNAPSHOT,
  plan: { ...SNAPSHOT.plan, supplies: ["Müllbeutel", "Spülmittel"] },
  missing: { Spülmittel: "2026-10-06T08:00:00+00:00" },
  problems: [
    {
      id: "p1",
      date: "2026-10-06",
      floor: "",
      location: "Bad",
      task: "Toilette",
      kind: "issue",
      note: "Spülung defekt",
      reported: "2026-10-06T09:00:00+00:00",
    },
  ],
};

test("supply chips show what is missing and toggle it", async () => {
  for (const config of [{}, { allow_edit: false }]) {
    const { $, $$, calls } = await household(FEEDBACK, config);
    assert.match($(".sup-label").textContent, /Fehlt etwas\?/);
    const chips = $$(".chip.sup");
    assert.deepEqual(chips.map((c) => c.textContent.trim()), ["Müllbeutel", "Spülmittel"]);
    assert.ok(chips[1].classList.contains("missing"));
    chips[0].click();
    await tick();
    assert.deepEqual(plain(calls.filter((c) => c.type === "cleaning_plan/set_supply_missing").pop()), {
      type: "cleaning_plan/set_supply_missing",
      entry_id: "e1",
      supply: "Müllbeutel",
      missing: true,
    });
    $$(".chip.sup")[1].click();
    await tick();
    assert.equal(calls.filter((c) => c.type === "cleaning_plan/set_supply_missing").pop().missing, false);
  }
  const { $ } = await household(SNAPSHOT);
  assert.equal($(".supplies"), null, "no chips without supplies in the plan");
});

test("cleaner flags a task: pick a kind, add a note, send", async () => {
  const { window, card, $, $$, calls, subs } = await household(FEEDBACK, { allow_edit: false });
  assert.equal($(".feedback"), null, "no feedback list in the cleaner view");
  $('[data-act="fold"]').click(); // Küche
  const flag = $('.flag[data-task="Spüle"]');
  flag.click();
  assert.ok($(".problem-edit"));
  assert.equal($('[data-act="p-send"]').disabled, true, "a kind must be chosen first");
  $('[data-act="p-kind"][data-kind="skipped"]').click();
  const note = $("[data-pnote]");
  note.value = "Kein Spülmittel mehr";
  note.dispatchEvent(new window.Event("input", { bubbles: true }));
  // A push from another device while typing keeps the note and the focus
  subs[0].cb({ ...FEEDBACK });
  assert.equal($("[data-pnote]").value, "Kein Spülmittel mehr");
  assert.equal(root(card).activeElement, $("[data-pnote]"));
  $('[data-act="p-send"]').click();
  await tick();
  assert.deepEqual(plain(calls.filter((c) => c.type === "cleaning_plan/report_problem").pop()), {
    type: "cleaning_plan/report_problem",
    entry_id: "e1",
    date: "2026-10-06",
    floor: "",
    location: "Küche",
    task: "Spüle",
    kind: "skipped",
    note: "Kein Spülmittel mehr",
  });
  assert.equal($(".problem-edit"), null, "editor closes after sending");
  assert.equal($$(".problem-note").length, 0, "Küche has no report yet");
});

test("a reported task shows its note; the cleaner can withdraw it", async () => {
  const { $, $$, calls } = await household(FEEDBACK, { allow_edit: false });
  $$('[data-act="fold"]')[1].click(); // Bad
  assert.ok($(".task-row.has-problem"));
  assert.equal($(".flag.on").dataset.task, "Toilette");
  assert.match($(".problem-note").textContent, /Problem: Spülung defekt/);
  $(".flag.on").click();
  assert.equal($("[data-pnote]").value, "Spülung defekt", "editor opens with the report");
  assert.ok($('[data-act="p-kind"][data-kind="issue"]').classList.contains("sel"));
  $('[data-act="p-withdraw"]').click();
  await tick();
  assert.deepEqual(plain(calls.filter((c) => c.type === "cleaning_plan/resolve_problem").pop()), {
    type: "cleaning_plan/resolve_problem",
    entry_id: "e1",
    problem_id: "p1",
  });
});

test("household view lists open feedback with a done button", async () => {
  const { $, $$, calls } = await household(FEEDBACK);
  assert.match($(".fb-title").textContent, /Rückmeldungen \(1\)/);
  assert.match($(".fb-row").textContent.replace(/\s+/g, " "), /Problem Toilette Bad · 6\.10\. Spülung defekt/);
  $('[data-act="p-resolve"]').click();
  await tick();
  assert.equal(calls.filter((c) => c.type === "cleaning_plan/resolve_problem").pop().problem_id, "p1");
});

test("form edits the supplies list", async () => {
  const { card, $, type, enter, save } = await editor(FEEDBACK);
  const inputs = () => [...root(card).querySelectorAll('[data-f="supplyName"]')];
  assert.deepEqual(inputs().map((i) => i.value), ["Müllbeutel", "Spülmittel"]);
  enter(inputs()[1]);
  assert.equal(root(card).activeElement, inputs()[2], "Enter adds the next supply");
  type(inputs()[2], "Müllbeutel");
  assert.match($("#errors").textContent, /„Müllbeutel“ steht zweimal beim Material/);
  type(inputs()[2], "Toilettenpapier");
  $('[data-act="f-supply-del"][data-si="0"]').click();
  $('[data-act="f-add-supply"]').click(); // empty ones are dropped
  const call = await save();
  assert.match(call.text, /\n\n# Supplies\n- Spülmittel\n- Toilettenpapier\n$/);
});
