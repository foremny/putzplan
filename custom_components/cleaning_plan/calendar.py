"""Calendar with one all-day event per visit."""

from __future__ import annotations

import datetime as dt

from homeassistant.components.calendar import CalendarEntity, CalendarEvent
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback
from homeassistant.util import dt as dt_util

from . import CleaningPlanConfigEntry
from .entity import CleaningPlanEntity

# Event texts follow the server language (Settings > System > General)
_TEXTS = {
    "en": {"visit": "Cleaning visit {n}", "nothing": "Nothing due"},
    "de": {"visit": "Putztermin {n}", "nothing": "Nichts fällig"},
}

# Upper bound for one query, so a huge range can't build millions of events
_MAX_EVENTS = 1000


async def async_setup_entry(
    hass: HomeAssistant,
    entry: CleaningPlanConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    """Set up the calendar of one plan."""
    async_add_entities([CleaningPlanCalendar(entry, entry.runtime_data, "visits")])


class CleaningPlanCalendar(CleaningPlanEntity, CalendarEntity):
    """Visits of a cleaning plan as all-day events, with the due tasks as description."""

    @property
    def _texts(self) -> dict[str, str]:
        lang = (self.hass.config.language or "en").split("-")[0].lower()
        return _TEXTS.get(lang, _TEXTS["en"])

    def _event(self, visit: int) -> CalendarEvent:
        texts = self._texts
        info = self.manager.visit_info(visit)
        # Floors as their own lines, locations below them
        lines: list[str] = []
        floor: str | None = None
        for loc in info["locations"]:
            if loc["floor"] != floor:
                floor = loc["floor"]
                if floor:
                    # blank line between floors
                    lines.append(f"\n{floor}" if lines else floor)
            lines.append(f"{loc['name']}: " + ", ".join(t["name"] for t in loc["tasks"]))
        day = self.manager.plan.visit_date(visit)
        return CalendarEvent(
            start=day,
            end=day + dt.timedelta(days=1),
            summary=texts["visit"].format(n=visit),
            description="\n".join(lines) or texts["nothing"],
            uid=f"{self.manager.entry_id}-{visit}",
        )

    @property
    def event(self) -> CalendarEvent | None:
        """Return today's visit on a cleaning day, else the next one."""
        visit = self.manager.current_visit
        return None if visit is None else self._event(visit)

    async def async_get_events(
        self, hass: HomeAssistant, start_date: dt.datetime, end_date: dt.datetime
    ) -> list[CalendarEvent]:
        """Return the visits overlapping [start_date, end_date)."""
        first = dt_util.as_local(start_date).date()
        # end is exclusive: a range ending at midnight does not include that day
        last = (dt_util.as_local(end_date) - dt.timedelta(microseconds=1)).date()
        events: list[CalendarEvent] = []
        for visit in self.manager.plan.visits_between(first, last):
            events.append(self._event(visit))
            if len(events) >= _MAX_EVENTS:
                break
        return events
