"""The Cleaning plan integration.

One config entry is one cleaning plan. Each plan has:
  - a plan text (rhythm, start day, locations, tasks with "every N. time")
  - ticks per visit date, stored in .storage/cleaning_plan.<entry_id>
  - a calendar entity with one all-day event per visit
  - sensors for the next visit date and the progress of the current visit

The Lovelace card is shipped in ./frontend and loaded automatically.
"""

from __future__ import annotations

import datetime as dt
import logging
from pathlib import Path

from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.event import async_track_time_change
from homeassistant.helpers.typing import ConfigType
from homeassistant.loader import async_get_integration

from .const import (
    CARD_FILENAME,
    CARD_URL_BASE,
    CONF_KEEP_DAYS,
    DEFAULT_KEEP_DAYS,
    DOMAIN,
)
from .manager import CleaningPlanManager
from .services import async_register_services
from .websocket_api import async_register_websocket

_LOGGER = logging.getLogger(__name__)

PLATFORMS: list[Platform] = [Platform.CALENDAR, Platform.SENSOR]

CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)

type CleaningPlanConfigEntry = ConfigEntry[CleaningPlanManager]


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Register the card, websocket commands and services once."""
    await _async_register_card(hass)
    async_register_websocket(hass)
    async_register_services(hass)
    return True


async def _async_register_card(hass: HomeAssistant) -> None:
    """Serve the card and load it on every dashboard.

    The integration version is part of the URL, so browsers fetch the new
    card after an update without any manual cache busting.
    """
    if hass.http is None:
        return
    integration = await async_get_integration(hass, DOMAIN)
    await hass.http.async_register_static_paths(
        [StaticPathConfig(CARD_URL_BASE, str(Path(__file__).parent / "frontend"), True)]
    )
    if "frontend" in hass.config.components:
        # Imported here: the frontend is an after-dependency, not a hard one
        from homeassistant.components.frontend import add_extra_js_url

        add_extra_js_url(hass, f"{CARD_URL_BASE}/{CARD_FILENAME}?v={integration.version}")


async def async_setup_entry(hass: HomeAssistant, entry: CleaningPlanConfigEntry) -> bool:
    """Set up one cleaning plan."""
    manager = CleaningPlanManager(
        hass, entry.entry_id, entry.options.get(CONF_KEEP_DAYS, DEFAULT_KEEP_DAYS)
    )
    await manager.async_load()
    await manager.async_cleanup()
    entry.runtime_data = manager

    async def _midnight(now: dt.datetime) -> None:
        await manager.async_day_changed()

    # A few seconds after midnight, so the new date is certain
    entry.async_on_unload(
        async_track_time_change(hass, _midnight, hour=0, minute=0, second=5)
    )
    entry.async_on_unload(entry.add_update_listener(_async_options_updated))

    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    return True


async def _async_options_updated(
    hass: HomeAssistant, entry: CleaningPlanConfigEntry
) -> None:
    """Apply changed options without a reload."""
    manager = entry.runtime_data
    manager.keep_days = entry.options.get(CONF_KEEP_DAYS, DEFAULT_KEEP_DAYS)
    await manager.async_cleanup()
    manager.async_notify()


async def async_unload_entry(hass: HomeAssistant, entry: CleaningPlanConfigEntry) -> bool:
    """Unload a cleaning plan."""
    if unloaded := await hass.config_entries.async_unload_platforms(entry, PLATFORMS):
        entry.runtime_data.async_unload()
    return unloaded


async def async_remove_entry(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Delete the stored plan and ticks when the entry is deleted."""
    await CleaningPlanManager(hass, entry.entry_id, DEFAULT_KEEP_DAYS).async_remove()
