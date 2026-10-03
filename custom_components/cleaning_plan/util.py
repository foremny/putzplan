"""Shared lookups and validation for services and websocket commands."""

from __future__ import annotations

import datetime as dt
from typing import TYPE_CHECKING

from homeassistant.config_entries import ConfigEntry, ConfigEntryState
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import ServiceValidationError

from .const import DOMAIN

if TYPE_CHECKING:
    from .manager import CleaningPlanManager

try:  # Home Assistant 2026.x validates with probatio, older releases with voluptuous
    import probatio as vol
except ImportError:  # pragma: no cover
    import voluptuous as vol  # type: ignore[no-redef]

__all__ = ["get_manager", "resolve_tick", "vol"]


def get_manager(
    hass: HomeAssistant, entry_id: str
) -> tuple[ConfigEntry, CleaningPlanManager]:
    """Return the loaded config entry and its manager, or raise."""
    entry = hass.config_entries.async_get_entry(entry_id)
    if entry is None or entry.domain != DOMAIN:
        raise ServiceValidationError(
            translation_domain=DOMAIN,
            translation_key="entry_not_found",
            translation_placeholders={"entry_id": entry_id},
        )
    if entry.state is not ConfigEntryState.LOADED:
        raise ServiceValidationError(
            translation_domain=DOMAIN,
            translation_key="entry_not_loaded",
            translation_placeholders={"title": entry.title},
        )
    return entry, entry.runtime_data


def resolve_tick(
    manager: CleaningPlanManager,
    day: dt.date | None,
    floor: str,
    location: str,
    task: str,
) -> dt.date:
    """Check that the task is due on the visit at day and return that date.

    day=None means the current visit.
    """
    plan = manager.plan
    if not plan.usable:
        raise ServiceValidationError(translation_domain=DOMAIN, translation_key="no_plan")
    if day is None:
        visit = plan.current_visit(manager.today())
        day = plan.visit_date(visit)
    else:
        found = plan.visit_of(day)
        if found is None:
            raise ServiceValidationError(
                translation_domain=DOMAIN,
                translation_key="not_a_visit",
                translation_placeholders={"date": day.isoformat()},
            )
        visit = found
    for loc, tasks in plan.due(visit):
        if loc.floor == floor and loc.name == location and any(t.name == task for t in tasks):
            return day
    key = "task_not_due" if plan.has_task(floor, location, task) else "task_not_found"
    raise ServiceValidationError(
        translation_domain=DOMAIN,
        translation_key=key,
        translation_placeholders={
            "location": f"{floor} / {location}" if floor else location,
            "task": task,
            "date": day.isoformat(),
        },
    )
