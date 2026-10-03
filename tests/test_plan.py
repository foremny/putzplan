"""Tests for the pure plan parser and visit math."""

from __future__ import annotations

import datetime as dt
from pathlib import Path

import pytest

from custom_components.cleaning_plan.plan import (
    ERR_FLOOR_NO_NAME,
    ERR_FREQ_INVALID,
    ERR_HEADING_LEVEL,
    ERR_OLD_FORMAT,
    ERR_OUTSIDE_SECTION,
    ERR_RHYTHM_MIN,
    ERR_ROOM_NO_NAME,
    ERR_START_INVALID,
    ERR_START_MISSING,
    ERR_TASK_NO_NAME,
    ERR_TASK_OUTSIDE_ROOM,
    ERR_UNEXPECTED_LINE,
    ERR_UNKNOWN_SECTION,
    ERR_UNKNOWN_SETTING,
    parse_date,
    parse_frequency,
    parse_plan,
    split_task,
)

FIXTURES = Path(__file__).parent / "fixtures"

EN = """# Config
- rhythm: 2 weeks
- start day: 6.10.2026

# Schedule
### Kitchen
- Counters, hob and sink
- Microwave inside (every 2. time)
- Fridge inside (every 4. time from 2)
"""

DE = """# Einstellungen
- Rhythmus: 2 Wochen
- Starttag: 6.10.2026

# Putzplan
### Küche
- Arbeitsflächen (jedes Mal)
- Mikrowelle (alle 2. Mal)
- Kühlschrank (alle 4. Mal ab 2)
"""


def errors(text: str) -> list[tuple[str, int | None]]:
    return [(e.code, e.line) for e in parse_plan(text).errors]


@pytest.mark.parametrize("text", [EN, DE])
def test_parse_both_languages(text: str) -> None:
    """English and German plans parse to the same structure."""
    plan = parse_plan(text)
    assert plan.errors == []
    assert plan.rhythm == 14
    assert plan.start == dt.date(2026, 10, 6)
    [loc] = plan.locations
    assert loc.floor == ""
    assert [(t.every, t.start) for t in loc.tasks] == [(1, 1), (2, 1), (4, 2)]


@pytest.mark.parametrize(
    ("line", "days"),
    [
        ("- global rhythm: 2 weeks", 14),
        ("- rythm: 3 weeks", 21),
        ("- rhytm: 10 days", 10),
        ("- Rhythmus: 10 Tage", 10),
        ("Globaler Rhythmus: 1 Woche", 7),
        ("* Rhythmus: 1 Woche", 7),
    ],
)
def test_rhythm_variants(line: str, days: int) -> None:
    """Spelling variants, units and optional bullets in the config section."""
    assert parse_plan(f"# Config\n{line}\n- start: 2026-10-06").rhythm == days


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("", (1, 1)),
        ("every time", (1, 1)),
        ("Jedes Mal", (1, 1)),
        ("immer", (1, 1)),
        ("every 4th time", (4, 1)),
        ("every 4. time from 2", (4, 2)),
        ("every 3 visit, from 3.", (3, 3)),
        ("alle 2. Mal ab 2", (2, 2)),
        ("jedes 3. Mal", (3, 1)),
        ("every 0. time", None),
        ("sometimes", None),
    ],
)
def test_parse_frequency(text: str, expected: tuple[int, int] | None) -> None:
    """Frequencies in both languages."""
    assert parse_frequency(text) == expected


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("Spüle", ("Spüle", (1, 1))),
        ("Kühlschrank (alle 4. Mal ab 2)", ("Kühlschrank", (4, 2))),
        ("Fenster (innen)", ("Fenster (innen)", (1, 1))),
        ("Fenster (innen) (alle 3. Mal)", ("Fenster (innen)", (3, 1))),
        ("Fenster (innen) (jedes Mal)", ("Fenster (innen)", (1, 1))),
        ("Tür: Griff, Zarge", ("Tür: Griff, Zarge", (1, 1))),
        ("Dusche (alle zwei Mal)", ("Dusche", None)),
    ],
)
def test_split_task(text: str, expected: tuple[str, tuple[int, int] | None]) -> None:
    """Only a trailing parenthesis that is a frequency is split off."""
    assert split_task(text) == expected


def test_parse_date() -> None:
    """Both date formats, and impossible dates are rejected."""
    assert parse_date("6.10.2026") == dt.date(2026, 10, 6)
    assert parse_date("2026-10-06") == dt.date(2026, 10, 6)
    assert parse_date("31.2.2026") is None
    assert parse_date("next tuesday") is None


def test_errors_have_codes_and_lines() -> None:
    """Every kind of error is reported with its line."""
    text = """Stray text
# Config
- Rhythmus: 0 Tage
- Starttag: morgen
- Farbe: blau
# Foo
# Schedule
- Spüle
##
###
#### Zu tief
### Bad
Toilette ohne Strich
- (alle 2. Mal)
- Dusche (alle zwei Mal)
"""
    assert errors(text) == [
        (ERR_OUTSIDE_SECTION, 1),
        (ERR_RHYTHM_MIN, 3),
        (ERR_START_INVALID, 4),
        (ERR_UNKNOWN_SETTING, 5),
        (ERR_UNKNOWN_SECTION, 6),
        (ERR_TASK_OUTSIDE_ROOM, 8),
        (ERR_FLOOR_NO_NAME, 9),
        (ERR_ROOM_NO_NAME, 10),
        (ERR_HEADING_LEVEL, 11),
        (ERR_UNEXPECTED_LINE, 13),
        (ERR_TASK_NO_NAME, 14),
        (ERR_FREQ_INVALID, 15),
    ]
    assert not parse_plan(text).usable


def test_floor_heading_outside_schedule() -> None:
    """Floors and rooms only exist in the schedule section."""
    assert errors("# Config\n- start: 2026-10-06\n### Küche") == [(ERR_OUTSIDE_SECTION, 3)]


def test_missing_start_day() -> None:
    """A plan without a start day gets one whole-plan error."""
    assert errors("# Schedule\n### Kitchen\n- Sink") == [(ERR_START_MISSING, None)]


def test_old_format_is_rejected() -> None:
    """Pre-0.6 plan text gets one clear error instead of a list of line errors."""
    old = "Rhythmus: 2 Wochen\nStarttag: 6.10.2026\n\nKüche\n* Spüle : jedes Mal\n"
    assert errors(old) == [(ERR_OLD_FORMAT, None)]
    assert errors("") == [(ERR_START_MISSING, None)]


def test_comments_keep_line_numbers() -> None:
    """HTML comments, also over several lines, are ignored without shifting lines."""
    text = "# Config\n<!-- a\nb\nc -->\n- Farbe: blau\n- start: 2026-10-06 <!-- inline -->"
    assert errors(text) == [(ERR_UNKNOWN_SETTING, 5)]
    assert parse_plan(text).start == dt.date(2026, 10, 6)


def test_closing_hashes_and_bullets() -> None:
    """ATX closing sequences are dropped; -, * and + all start tasks."""
    plan = parse_plan("# Config #\n- start: 2026-10-06\n# Schedule\n### Bad ###\n* a\n+ b\n- c")
    assert plan.errors == []
    assert [(loc.name, [t.name for t in loc.tasks]) for loc in plan.locations] == [("Bad", ["a", "b", "c"])]


def test_visit_math() -> None:
    """Current visit, visit dates and due tasks."""
    plan = parse_plan(EN)
    start = dt.date(2026, 10, 6)
    assert plan.current_visit(start - dt.timedelta(days=30)) == 1
    assert plan.current_visit(start) == 1
    assert plan.current_visit(start + dt.timedelta(days=1)) == 2
    assert plan.current_visit(start + dt.timedelta(days=14)) == 2
    assert plan.current_visit(start + dt.timedelta(days=15)) == 3
    assert plan.visit_date(3) == dt.date(2026, 11, 3)
    assert plan.visit_of(dt.date(2026, 11, 3)) == 3
    assert plan.visit_of(dt.date(2026, 11, 4)) is None
    assert plan.visit_of(dt.date(2026, 9, 22)) is None

    def names(visit: int) -> list[str]:
        return [t.name for _, tasks in plan.due(visit) for t in tasks]

    assert names(1) == ["Counters, hob and sink", "Microwave inside"]
    assert names(2) == ["Counters, hob and sink", "Fridge inside"]
    assert names(6) == ["Counters, hob and sink", "Fridge inside"]
    assert names(7) == ["Counters, hob and sink", "Microwave inside"]


def test_visits_between() -> None:
    """Visits inside a date range, inclusive."""
    plan = parse_plan(EN)
    assert list(plan.visits_between(dt.date(2026, 9, 1), dt.date(2026, 11, 3))) == [1, 2, 3]
    assert list(plan.visits_between(dt.date(2026, 10, 7), dt.date(2026, 10, 19))) == []


FLOORS = """# Config
- start: 2026-10-06

# Schedule
### Keller
- Fegen

## Erdgeschoss
### Küche
- Spüle
### Bad
- Toilette (every 2. time)

## Obergeschoss
### Bad
- Toilette
- Dusche
"""


def test_floors() -> None:
    """Floor headings group the rooms below them; the same room name may repeat per floor."""
    plan = parse_plan(FLOORS)
    assert plan.errors == []
    assert [(loc.floor, loc.name) for loc in plan.locations] == [
        ("", "Keller"),
        ("Erdgeschoss", "Küche"),
        ("Erdgeschoss", "Bad"),
        ("Obergeschoss", "Bad"),
    ]
    assert plan.floors == ["", "Erdgeschoss", "Obergeschoss"]
    assert plan.has_task("Obergeschoss", "Bad", "Dusche")
    assert not plan.has_task("Erdgeschoss", "Bad", "Dusche")
    assert plan.as_dict()["locations"][1]["floor"] == "Erdgeschoss"
    # visit 2: the ground floor toilet (every 2nd) is not due
    due = [(loc.floor, loc.name, [t.name for t in tasks]) for loc, tasks in plan.due(2)]
    assert due == [
        ("", "Keller", ["Fegen"]),
        ("Erdgeschoss", "Küche", ["Spüle"]),
        ("Obergeschoss", "Bad", ["Toilette", "Dusche"]),
    ]


def test_task_directly_under_floor_needs_a_room() -> None:
    """A floor heading ends the previous room."""
    text = "# Config\n- start: 2026-10-06\n# Schedule\n### Keller\n- a\n## EG\n- b"
    assert errors(text) == [(ERR_TASK_OUTSIDE_ROOM, 7)]


def test_form_output_parses_back() -> None:
    """The texts the card's form writes (checked in card.test.mjs) parse as intended."""
    de = parse_plan((FIXTURES / "form_de.txt").read_text(encoding="utf-8"))
    assert de.errors == []
    assert (de.rhythm, de.start) == (14, dt.date(2026, 10, 6))
    assert [(loc.name, [(t.name, t.every, t.start) for t in loc.tasks]) for loc in de.locations] == [
        ("Küche", [("Spüle", 1, 1), ("Kühlschrank", 2, 2)]),
        ("Bad", [("Toilette", 1, 1)]),
    ]

    en = parse_plan((FIXTURES / "form_en.txt").read_text(encoding="utf-8"))
    assert en.errors == []
    assert (en.rhythm, en.start) == (10, dt.date(2026, 10, 6))
    assert [(t.name, t.every, t.start) for t in en.locations[0].tasks] == [
        ("Sink", 1, 1),
        ("Oven: inside", 3, 1),
        ("Fridge", 1, 2),
        ("Window (inside)", 1, 1),
    ]

    floors = parse_plan((FIXTURES / "form_floors_de.txt").read_text(encoding="utf-8"))
    assert floors.errors == []
    assert [
        (loc.floor, loc.name, [(t.name, t.every, t.start) for t in loc.tasks]) for loc in floors.locations
    ] == [
        ("", "Keller", [("Fegen", 1, 1)]),
        ("Erdgeschoss", "Küche", [("Spüle", 1, 1)]),
        ("Erdgeschoss", "Bad", [("Toilette", 2, 1)]),
        ("Obergeschoss", "Bad", [("Toilette", 1, 1), ("Dusche", 2, 2)]),
    ]


def test_real_plan_file_parses() -> None:
    """The household plan in the repo root parses without errors."""
    path = Path(__file__).parents[1] / "putzplan.txt"
    if not path.exists():
        pytest.skip("putzplan.txt not present")
    plan = parse_plan(path.read_text(encoding="utf-8"))
    assert plan.errors == []
    assert len(plan.locations) == 14
    assert sum(len(loc.tasks) for loc in plan.locations) == 96
