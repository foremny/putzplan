"""State holder for one cleaning plan (one config entry)."""

from __future__ import annotations

import datetime as dt
import logging
from collections.abc import Callable
from typing import Any, NotRequired, TypedDict
from uuid import uuid4

from homeassistant.core import CALLBACK_TYPE, HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util

from .const import DOMAIN, EVENT_FEEDBACK, STORAGE_VERSION
from .plan import NO_FLOOR, Plan, PlanError, parse_plan

_LOGGER = logging.getLogger(__name__)

# A tick: (floor, location, task). floor is "" for locations without a floor.
type Key = tuple[str, str, str]


class StoredData(TypedDict):
    """On-disk format, in .storage/cleaning_plan.<entry_id>."""

    plan: str
    # visit date (ISO) -> list of [floor, location, task]
    done: dict[str, list[list[str]]]
    # supply name -> when it was reported missing (ISO datetime, UTC)
    missing: NotRequired[dict[str, str]]
    # open problem reports, see async_report_problem
    problems: NotRequired[list[dict[str, str]]]


class InvalidPlan(Exception):
    """Raised when saving a plan that has errors."""

    def __init__(self, errors: list[PlanError]) -> None:
        """Store the errors."""
        super().__init__(", ".join(f"{e.code}@{e.line}" for e in errors))
        self.errors = errors


class _PlanStore(Store[StoredData]):
    """Store with migrations of the on-disk format."""

    async def _async_migrate_func(
        self, old_major_version: int, old_minor_version: int, old_data: dict[str, Any]
    ) -> dict[str, Any]:
        if old_major_version < 2:
            # 1 -> 2: ticks were [location, task]; floors were added
            old_data["done"] = {
                day: [[NO_FLOOR, *pair] for pair in pairs]
                for day, pairs in old_data.get("done", {}).items()
            }
        return old_data


class CleaningPlanManager:
    """Holds the plan text and the ticks, persists them, and notifies listeners."""

    def __init__(
        self,
        hass: HomeAssistant,
        entry_id: str,
        keep_days: int,
        supplies_todo: str | None = None,
    ) -> None:
        """Initialize."""
        self.hass = hass
        self.entry_id = entry_id
        self.keep_days = keep_days
        # to-do entity that missing supplies are added to, if any
        self.supplies_todo = supplies_todo
        self._store = _PlanStore(hass, STORAGE_VERSION, f"{DOMAIN}.{entry_id}")
        self.plan_text = ""
        self.plan: Plan = parse_plan("")
        self._done: dict[str, set[Key]] = {}
        self._missing: dict[str, str] = {}
        self._problems: list[dict[str, str]] = []
        self._listeners: list[Callable[[], None]] = []
        self.unloaded = False

    # ----- persistence -----

    async def async_load(self) -> None:
        """Load data from disk."""
        data = await self._store.async_load()
        if data is None:
            return
        self._set_plan_text(data.get("plan", ""))
        self._done = {
            day: {(floor, loc, task) for floor, loc, task in pairs}
            for day, pairs in data.get("done", {}).items()
        }
        self._missing = dict(data.get("missing", {}))
        self._problems = list(data.get("problems", []))

    def _data(self) -> StoredData:
        return {
            "plan": self.plan_text,
            "done": {
                day: sorted(list(key) for key in pairs)
                for day, pairs in sorted(self._done.items())
                if pairs
            },
            "missing": dict(sorted(self._missing.items())),
            "problems": list(self._problems),
        }

    async def _async_save(self) -> None:
        await self._store.async_save(self._data())

    async def async_remove(self) -> None:
        """Delete the stored data (config entry removed)."""
        await self._store.async_remove()

    # ----- listeners -----

    @callback
    def async_add_listener(self, update: Callable[[], None]) -> CALLBACK_TYPE:
        """Call update() whenever the plan, the ticks or the day changes."""
        self._listeners.append(update)

        @callback
        def remove() -> None:
            self._listeners.remove(update)

        return remove

    @callback
    def async_notify(self) -> None:
        """Notify all listeners."""
        for update in list(self._listeners):
            update()

    @callback
    def async_unload(self) -> None:
        """Tell remaining listeners (websocket subscriptions) that this plan is gone."""
        self.unloaded = True
        self.async_notify()
        self._listeners.clear()

    # ----- queries -----

    @staticmethod
    def today() -> dt.date:
        """Return today's date in the Home Assistant time zone."""
        return dt_util.now().date()

    @property
    def current_visit(self) -> int | None:
        """Return the current visit number, or None without a usable plan."""
        if not self.plan.usable:
            return None
        return self.plan.current_visit(self.today())

    def is_done(self, day: dt.date, floor: str, location: str, task: str) -> bool:
        """Return True if the task is ticked for the visit on day."""
        return (floor, location, task) in self._done.get(day.isoformat(), set())

    def visit_info(self, visit: int) -> dict[str, Any]:
        """Return the due tasks of a visit with their tick state."""
        day = self.plan.visit_date(visit)
        locations = []
        ticked = total = 0
        for loc, tasks in self.plan.due(visit):
            rows = [
                {"name": t.name, "done": self.is_done(day, loc.floor, loc.name, t.name)}
                for t in tasks
            ]
            ticked += sum(r["done"] for r in rows)
            total += len(rows)
            locations.append({"floor": loc.floor, "name": loc.name, "tasks": rows})
        return {
            "visit": visit,
            "date": day.isoformat(),
            "ticked": ticked,
            "total": total,
            "locations": locations,
        }

    def snapshot(self, title: str) -> dict[str, Any]:
        """Return everything a frontend needs, JSON-friendly."""
        return {
            "title": title,
            "text": self.plan_text,
            "plan": self.plan.as_dict(),
            "today": self.today().isoformat(),
            "current_visit": self.current_visit,
            "done": self._data()["done"],
            # only supplies that are still in the plan
            "missing": {k: v for k, v in self._missing.items() if k in self.plan.supplies},
            # newest first
            "problems": sorted(self._problems, key=lambda p: (p["date"], p["reported"]), reverse=True),
        }

    # ----- changes -----

    def _set_plan_text(self, text: str) -> None:
        self.plan_text = text
        self.plan = parse_plan(text)

    async def async_set_plan(
        self,
        text: str,
        renames: list[tuple[Key, Key]] | None = None,
    ) -> None:
        """Validate and store new plan text. Raises InvalidPlan.

        renames maps old (floor, location, task) names to new ones, so ticks of
        renamed tasks are kept. All renames apply at once, so swaps work.
        """
        plan = parse_plan(text)
        if plan.errors:
            raise InvalidPlan(plan.errors)
        self._set_plan_text(text)
        if renames:
            mapping = dict(renames)
            self._done = {
                day: {mapping.get(pair, pair) for pair in pairs}
                for day, pairs in self._done.items()
            }
            for problem in self._problems:
                key = (problem["floor"], problem["location"], problem["task"])
                if key in mapping:
                    problem["floor"], problem["location"], problem["task"] = mapping[key]
        # Supplies removed from the plan can't be missing any more
        self._missing = {k: v for k, v in self._missing.items() if k in plan.supplies}
        await self._async_save()
        self.async_notify()

    async def async_set_done(
        self, day: dt.date, floor: str, location: str, task: str, done: bool
    ) -> None:
        """Tick or untick a task for the visit on day."""
        keys = self._done.setdefault(day.isoformat(), set())
        key = (floor, location, task)
        if done == (key in keys):
            return
        if done:
            keys.add(key)
        else:
            keys.discard(key)
        await self._async_save()
        self.async_notify()

    async def async_day_changed(self) -> None:
        """Run at midnight: drop old ticks and refresh listeners."""
        await self.async_cleanup()
        self.async_notify()

    async def async_cleanup(self) -> None:
        """Delete ticks and problem reports for visits older than keep_days."""
        limit = (self.today() - dt.timedelta(days=self.keep_days)).isoformat()
        old = [day for day in self._done if day < limit]
        problems = [p for p in self._problems if p["date"] >= limit]
        if not old and len(problems) == len(self._problems):
            return
        for day in old:
            del self._done[day]
        self._problems = problems
        await self._async_save()

    # ----- feedback from the cleaner -----

    @callback
    def _fire(self, event_type: str, /, **data: Any) -> None:
        self.hass.bus.async_fire(
            EVENT_FEEDBACK, {"entry_id": self.entry_id, "type": event_type, **data}
        )

    def is_missing(self, supply: str) -> bool:
        """Return True if the supply is reported missing."""
        return supply in self._missing

    async def async_set_supply_missing(self, supply: str, missing: bool) -> None:
        """Report a supply as missing, or as available again."""
        if missing == (supply in self._missing):
            return
        if missing:
            self._missing[supply] = dt_util.utcnow().isoformat()
        else:
            del self._missing[supply]
        await self._async_save()
        self.async_notify()
        self._fire("supply_missing" if missing else "supply_available", supply=supply)
        if missing and self.supplies_todo:
            await self._async_add_to_todo(supply)

    async def _async_add_to_todo(self, supply: str) -> None:
        """Add the supply to the configured to-do list, unless it is already open there."""
        entity_id = self.supplies_todo
        if entity_id is None or self.hass.states.get(entity_id) is None:
            _LOGGER.warning("To-do list %s for missing supplies is not available", entity_id)
            return
        try:
            response: Any = await self.hass.services.async_call(
                "todo",
                "get_items",
                {"entity_id": entity_id, "status": ["needs_action"]},
                blocking=True,
                return_response=True,
            )
            items = response.get(entity_id, {}).get("items", [])
            if any((i.get("summary") or "").strip().casefold() == supply.casefold() for i in items):
                return
            await self.hass.services.async_call(
                "todo", "add_item", {"entity_id": entity_id, "item": supply}, blocking=True
            )
        except HomeAssistantError as err:
            _LOGGER.warning("Could not add %s to %s: %s", supply, entity_id, err)

    async def async_report_problem(
        self, day: dt.date, floor: str, location: str, task: str, kind: str, note: str
    ) -> dict[str, str]:
        """Report a problem with a task of a visit. Replaces an earlier report for it."""
        key = (day.isoformat(), floor, location, task)
        self._problems = [
            p for p in self._problems if (p["date"], p["floor"], p["location"], p["task"]) != key
        ]
        problem = {
            "id": uuid4().hex,
            "date": day.isoformat(),
            "floor": floor,
            "location": location,
            "task": task,
            "kind": kind,
            "note": note.strip(),
            "reported": dt_util.utcnow().isoformat(),
        }
        self._problems.append(problem)
        await self._async_save()
        self.async_notify()
        self._fire("task_problem", **{k: v for k, v in problem.items() if k != "reported"})
        return problem

    async def async_resolve_problem(self, problem_id: str) -> bool:
        """Remove a problem report. Returns False if it does not exist."""
        problem = next((p for p in self._problems if p["id"] == problem_id), None)
        if problem is None:
            return False
        self._problems.remove(problem)
        await self._async_save()
        self.async_notify()
        self._fire(
            "problem_resolved",
            id=problem_id,
            date=problem["date"],
            floor=problem["floor"],
            location=problem["location"],
            task=problem["task"],
        )
        return True
