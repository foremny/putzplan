"""State holder for one cleaning plan (one config entry)."""

from __future__ import annotations

import datetime as dt
import logging
from collections.abc import Callable
from typing import Any, TypedDict

from homeassistant.core import CALLBACK_TYPE, HomeAssistant, callback
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util

from .const import DOMAIN, STORAGE_VERSION
from .plan import NO_FLOOR, Plan, PlanError, parse_plan

_LOGGER = logging.getLogger(__name__)

# A tick: (floor, location, task). floor is "" for locations without a floor.
type Key = tuple[str, str, str]


class StoredData(TypedDict):
    """On-disk format, in .storage/cleaning_plan.<entry_id>."""

    plan: str
    # visit date (ISO) -> list of [floor, location, task]
    done: dict[str, list[list[str]]]


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

    def __init__(self, hass: HomeAssistant, entry_id: str, keep_days: int) -> None:
        """Initialize."""
        self.hass = hass
        self.entry_id = entry_id
        self.keep_days = keep_days
        self._store = _PlanStore(hass, STORAGE_VERSION, f"{DOMAIN}.{entry_id}")
        self.plan_text = ""
        self.plan: Plan = parse_plan("")
        self._done: dict[str, set[Key]] = {}
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

    def _data(self) -> StoredData:
        return {
            "plan": self.plan_text,
            "done": {
                day: sorted(list(key) for key in pairs)
                for day, pairs in sorted(self._done.items())
                if pairs
            },
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
        """Delete ticks for visits older than keep_days."""
        limit = (self.today() - dt.timedelta(days=self.keep_days)).isoformat()
        old = [day for day in self._done if day < limit]
        if not old:
            return
        for day in old:
            del self._done[day]
        await self._async_save()
