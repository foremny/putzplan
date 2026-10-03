"""Plan text parser and visit math.

Pure Python with no Home Assistant imports, so it can be tested on its own.

The plan is Markdown. English and German keywords are both accepted:

    # Config
    - Rhythmus: 2 Wochen                    - rhythm: 2 weeks
    - Starttag: 6.10.2026                   - start day: 2026-10-06

    # Schedule
    ## Erdgeschoss                          a floor (optional)
    ### Küche                               a room
    - Spüle                                 a task, due on every visit
    - Kühlschrank (alle 4. Mal ab 2)        - Fridge (every 4. time from 2)
    <!-- comment -->

    # Supplies                              optional; the cleaner reports
    - Müllbeutel                            what is running out

Rooms before the first floor heading have no floor (floor ""). A tick is
keyed by (floor, room, task), so "Bad" on two floors are separate.
Only a trailing "(...)" that is a frequency counts; "Fenster (innen)" is a
plain task name.

Visits are 1-based. Visit 1 is the start day, visit n is
start + (n - 1) * rhythm days. A task with every=N, start=S is due on
visits S, S+N, S+2N, ...
"""

from __future__ import annotations

import datetime as dt
import math
import re
from collections.abc import Iterator
from dataclasses import dataclass, field
from typing import Any

DEFAULT_RHYTHM_DAYS = 14

# Error codes. Frontends translate these.
ERR_RHYTHM_MIN = "rhythm_min"
ERR_START_INVALID = "start_invalid"
ERR_START_MISSING = "start_missing"
ERR_TASK_NO_NAME = "task_no_name"
ERR_FREQ_INVALID = "freq_invalid"
ERR_FLOOR_NO_NAME = "floor_no_name"
ERR_ROOM_NO_NAME = "room_no_name"
ERR_UNKNOWN_SECTION = "unknown_section"
ERR_UNKNOWN_SETTING = "unknown_setting"
ERR_OUTSIDE_SECTION = "outside_section"
ERR_TASK_OUTSIDE_ROOM = "task_outside_room"
ERR_HEADING_LEVEL = "heading_level"
ERR_UNEXPECTED_LINE = "unexpected_line"
ERR_OLD_FORMAT = "old_format"
ERR_SUPPLY_NO_NAME = "supply_no_name"

# Floor of rooms that come before any floor heading
NO_FLOOR = ""

_SECTION_CONFIG = {"config", "configuration", "settings", "einstellungen", "konfiguration"}
_SECTION_SCHEDULE = {"schedule", "plan", "putzplan", "zeitplan", "aufgaben", "tasks"}
_SECTION_SUPPLIES = {"supplies", "vorräte", "vorrat", "material", "verbrauchsmaterial", "putzmittel"}

_COMMENT_RE = re.compile(r"<!--.*?-->", re.DOTALL)
# ATX heading; an optional closing run of # after a space is dropped
_HEADING_RE = re.compile(r"^(#{1,6})(?:\s+(.*?))?(?:\s+#+)?\s*$")
_BULLET_RE = re.compile(r"^[-*+•]\s+(.*)$|^[-*+•]$")
_RHYTHM_KEY_RE = re.compile(r"^(?:global(?:er)?\s+)?rh?yt?h?m(?:us)?$", re.IGNORECASE)
_START_KEY_RE = re.compile(r"^start(?:\s*(?:day|date|tag|datum))?$", re.IGNORECASE)
_RHYTHM_VALUE_RE = re.compile(r"^(\d+)\s*([a-zäöü]*)$", re.IGNORECASE)
_TRAILING_PARENS_RE = re.compile(r"^(.*?)\s*\(([^()]*)\)\s*$")
_FREQ_START_RE = re.compile(r"^(every|jedes|jeden|alle|immer|always)\b", re.IGNORECASE)
_EVERY_TIME_RE = re.compile(
    r"^(every\s+time|always|every\s+visit|jedes\s+mal|immer|jeden\s+besuch)$"
)
_EVERY_N_RE = re.compile(
    r"^(?:every|jedes|jeden|alle)\s+(\d+)\s*\.?\s*(?:st|nd|rd|th|te[sn]?)?\s*"
    r"(?:time|visit|mal|besuch)?\s*(?:,?\s*(?:from|ab)\s+(\d+)\s*\.?)?$"
)
_DMY_RE = re.compile(r"^(\d{1,2})\.(\d{1,2})\.(\d{4})$")
_YMD_RE = re.compile(r"^(\d{4})-(\d{1,2})-(\d{1,2})$")


@dataclass(frozen=True)
class Task:
    """A task in a location."""

    name: str
    every: int = 1
    start: int = 1  # first visit the task is due on ("from" in the plan text)

    def due_on(self, visit: int) -> bool:
        """Return True if the task is due on the given visit number."""
        return visit >= self.start and (visit - self.start) % self.every == 0


@dataclass
class Location:
    """A location with its tasks, in plan order."""

    name: str
    tasks: list[Task] = field(default_factory=list)
    floor: str = NO_FLOOR


@dataclass(frozen=True)
class PlanError:
    """A problem in the plan text. line is 1-based, None for whole-plan errors."""

    code: str
    line: int | None = None

    def as_dict(self) -> dict[str, Any]:
        """Return a JSON-friendly dict."""
        return {"code": self.code, "line": self.line}


@dataclass
class Plan:
    """A parsed plan."""

    rhythm: int = DEFAULT_RHYTHM_DAYS
    start: dt.date | None = None
    locations: list[Location] = field(default_factory=list)
    # Things the cleaner can report as missing, in plan order, without duplicates
    supplies: list[str] = field(default_factory=list)
    errors: list[PlanError] = field(default_factory=list)

    @property
    def valid(self) -> bool:
        """Return True if the plan has no errors."""
        return not self.errors

    @property
    def usable(self) -> bool:
        """Return True if visits can be computed. Task-line errors are tolerated."""
        return self.start is not None and self.rhythm >= 1

    def visit_date(self, visit: int) -> dt.date:
        """Return the date of a visit (1-based)."""
        assert self.start is not None
        return self.start + dt.timedelta(days=(visit - 1) * self.rhythm)

    def current_visit(self, today: dt.date) -> int:
        """Return today's visit on a cleaning day, else the next upcoming one."""
        assert self.start is not None
        diff = (today - self.start).days
        if diff <= 0:
            return 1
        return math.ceil(diff / self.rhythm) + 1

    def visit_of(self, day: dt.date) -> int | None:
        """Return the visit number falling on day, or None if day is no visit."""
        assert self.start is not None
        diff = (day - self.start).days
        if diff < 0 or diff % self.rhythm:
            return None
        return diff // self.rhythm + 1

    def visits_between(self, first: dt.date, last: dt.date) -> Iterator[int]:
        """Yield visit numbers whose date lies in [first, last]."""
        if not self.usable or last < first:
            return
        visit = self.current_visit(first)
        while self.visit_date(visit) <= last:
            yield visit
            visit += 1

    def due(self, visit: int) -> list[tuple[Location, list[Task]]]:
        """Return the locations with tasks due on a visit, skipping empty ones."""
        result = []
        for loc in self.locations:
            tasks = [t for t in loc.tasks if t.due_on(visit)]
            if tasks:
                result.append((loc, tasks))
        return result

    def has_task(self, floor: str, location: str, task: str) -> bool:
        """Return True if the plan contains the task in the location on the floor."""
        return any(
            loc.floor == floor
            and loc.name == location
            and any(t.name == task for t in loc.tasks)
            for loc in self.locations
        )

    @property
    def floors(self) -> list[str]:
        """Return the floors in plan order, without duplicates."""
        return list(dict.fromkeys(loc.floor for loc in self.locations))

    def as_dict(self) -> dict[str, Any]:
        """Return a JSON-friendly dict for frontends."""
        return {
            "rhythm": self.rhythm,
            "start": self.start.isoformat() if self.start else None,
            "locations": [
                {
                    "floor": loc.floor,
                    "name": loc.name,
                    "tasks": [
                        {"name": t.name, "every": t.every, "from": t.start}
                        for t in loc.tasks
                    ],
                }
                for loc in self.locations
            ],
            "supplies": list(self.supplies),
            "errors": [e.as_dict() for e in self.errors],
        }


def parse_date(text: str) -> dt.date | None:
    """Parse 6.10.2026 or 2026-10-06. Return None for anything else."""
    text = text.strip()
    try:
        if m := _DMY_RE.match(text):
            return dt.date(int(m[3]), int(m[2]), int(m[1]))
        if m := _YMD_RE.match(text):
            return dt.date(int(m[1]), int(m[2]), int(m[3]))
    except ValueError:
        return None
    return None


def parse_frequency(text: str) -> tuple[int, int] | None:
    """Parse the part after the colon. Return (every, start) or None."""
    text = text.strip().lower()
    if not text or _EVERY_TIME_RE.match(text):
        return 1, 1
    m = _EVERY_N_RE.match(text)
    if not m:
        return None
    every = int(m[1])
    start = int(m[2]) if m[2] else 1
    if every < 1 or start < 1:
        return None
    return every, start


def split_task(text: str) -> tuple[str, tuple[int, int] | None]:
    """Split "Kühlschrank (alle 4. Mal ab 2)" into the name and (every, start).

    Returns (name, None) if a trailing "(...)" starts like a frequency but is
    not one. A trailing "(...)" that is not a frequency stays in the name.
    """
    text = text.strip()
    m = _TRAILING_PARENS_RE.match(text)
    if m:
        freq = parse_frequency(m[2])
        if freq is not None:
            return m[1].strip(), freq
        if _FREQ_START_RE.match(m[2].strip()):
            return m[1].strip(), None
    return text, (1, 1)


def _parse_setting(plan: Plan, body: str, ln: int) -> None:
    key, sep, value = body.partition(":")
    key, value = key.strip(), value.strip()
    if not sep:
        plan.errors.append(PlanError(ERR_UNKNOWN_SETTING, ln))
    elif _RHYTHM_KEY_RE.match(key):
        m = _RHYTHM_VALUE_RE.match(value)
        if not m:
            plan.errors.append(PlanError(ERR_RHYTHM_MIN, ln))
            return
        n = int(m[1])
        # days / Tage, otherwise weeks / Wochen
        plan.rhythm = n if m[2][:1].lower() in ("d", "t") else n * 7
        if plan.rhythm < 1:
            plan.errors.append(PlanError(ERR_RHYTHM_MIN, ln))
    elif _START_KEY_RE.match(key):
        plan.start = parse_date(value)
        if plan.start is None:
            plan.errors.append(PlanError(ERR_START_INVALID, ln))
    else:
        plan.errors.append(PlanError(ERR_UNKNOWN_SETTING, ln))


def parse_plan(text: str | None) -> Plan:
    """Parse plan Markdown. Never raises; problems end up in plan.errors."""
    plan = Plan()
    # Drop comments but keep their line breaks, so line numbers stay right
    text = _COMMENT_RE.sub(lambda m: "\n" * m[0].count("\n"), text or "")
    lines = text.splitlines()

    if any(line.strip() for line in lines) and not any(
        _HEADING_RE.match(line.strip()) for line in lines
    ):
        # Text without a single heading: most likely the pre-0.6 format
        plan.errors.append(PlanError(ERR_OLD_FORMAT))
        return plan

    section: str | None = None
    floor = NO_FLOOR
    room: Location | None = None
    start_seen = False

    for ln, raw in enumerate(lines, start=1):
        line = raw.strip()
        if not line:
            continue

        if heading := _HEADING_RE.match(line):
            level, title = len(heading[1]), (heading[2] or "").strip()
            if level == 1:
                key = title.lower()
                section = (
                    "config" if key in _SECTION_CONFIG
                    else "schedule" if key in _SECTION_SCHEDULE
                    else "supplies" if key in _SECTION_SUPPLIES
                    else None
                )
                if section is None:
                    plan.errors.append(PlanError(ERR_UNKNOWN_SECTION, ln))
                floor, room = NO_FLOOR, None
            elif section != "schedule":
                plan.errors.append(PlanError(ERR_OUTSIDE_SECTION, ln))
            elif level == 2:
                room = None
                if title:
                    floor = title
                else:
                    plan.errors.append(PlanError(ERR_FLOOR_NO_NAME, ln))
            elif level == 3:
                if title:
                    room = Location(title, floor=floor)
                    plan.locations.append(room)
                else:
                    room = None
                    plan.errors.append(PlanError(ERR_ROOM_NO_NAME, ln))
            else:
                plan.errors.append(PlanError(ERR_HEADING_LEVEL, ln))
            continue

        bullet = _BULLET_RE.match(line)
        if section == "config":
            body = (bullet[1] or "") if bullet else line
            if _START_KEY_RE.match(body.partition(":")[0].strip()):
                start_seen = True
            _parse_setting(plan, body, ln)
        elif section == "schedule":
            if not bullet:
                plan.errors.append(PlanError(ERR_UNEXPECTED_LINE, ln))
                continue
            name, freq = split_task(bullet[1] or "")
            if not name:
                plan.errors.append(PlanError(ERR_TASK_NO_NAME, ln))
            elif freq is None:
                plan.errors.append(PlanError(ERR_FREQ_INVALID, ln))
            elif room is None:
                plan.errors.append(PlanError(ERR_TASK_OUTSIDE_ROOM, ln))
            else:
                room.tasks.append(Task(name, *freq))
        elif section == "supplies":
            name = (bullet[1] or "").strip() if bullet else None
            if name is None:
                plan.errors.append(PlanError(ERR_UNEXPECTED_LINE, ln))
            elif not name:
                plan.errors.append(PlanError(ERR_SUPPLY_NO_NAME, ln))
            elif name not in plan.supplies:
                plan.supplies.append(name)
        else:
            plan.errors.append(PlanError(ERR_OUTSIDE_SECTION, ln))

    if plan.start is None and not start_seen:
        plan.errors.append(PlanError(ERR_START_MISSING))
    return plan
