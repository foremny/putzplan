"""Sensors: next visit date and progress of the current visit."""

from __future__ import annotations

import datetime as dt
from typing import Any

from homeassistant.components.sensor import (
    SensorDeviceClass,
    SensorEntity,
    SensorStateClass,
)
from homeassistant.const import PERCENTAGE
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from . import CleaningPlanConfigEntry
from .entity import CleaningPlanEntity


async def async_setup_entry(
    hass: HomeAssistant,
    entry: CleaningPlanConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    """Set up the sensors of one plan."""
    manager = entry.runtime_data
    async_add_entities(
        [
            NextVisitSensor(entry, manager, "next_visit"),
            ProgressSensor(entry, manager, "progress"),
        ]
    )


class NextVisitSensor(CleaningPlanEntity, SensorEntity):
    """Date of today's visit on a cleaning day, else of the next one."""

    _attr_device_class = SensorDeviceClass.DATE

    @property
    def native_value(self) -> dt.date | None:
        """Return the visit date."""
        visit = self.manager.current_visit
        return None if visit is None else self.manager.plan.visit_date(visit)

    @property
    def extra_state_attributes(self) -> dict[str, Any] | None:
        """Return visit number, days until the visit and number of due tasks."""
        visit = self.manager.current_visit
        if visit is None:
            return None
        info = self.manager.visit_info(visit)
        day = self.manager.plan.visit_date(visit)
        return {
            "visit": visit,
            "days_until": (day - self.manager.today()).days,
            "tasks_due": info["total"],
        }


class ProgressSensor(CleaningPlanEntity, SensorEntity):
    """Share of the current visit's tasks that are ticked."""

    _attr_native_unit_of_measurement = PERCENTAGE
    _attr_state_class = SensorStateClass.MEASUREMENT
    _attr_suggested_display_precision = 0

    @property
    def native_value(self) -> float | None:
        """Return the percentage of ticked tasks."""
        visit = self.manager.current_visit
        if visit is None:
            return None
        info = self.manager.visit_info(visit)
        if not info["total"]:
            return 100.0
        return round(100 * info["ticked"] / info["total"], 1)

    @property
    def extra_state_attributes(self) -> dict[str, Any] | None:
        """Return the counts and the visit."""
        visit = self.manager.current_visit
        if visit is None:
            return None
        info = self.manager.visit_info(visit)
        return {
            "visit": visit,
            "date": info["date"],
            "ticked": info["ticked"],
            "open": info["total"] - info["ticked"],
            "total": info["total"],
        }
