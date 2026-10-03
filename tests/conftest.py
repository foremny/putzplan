"""Fixtures for the Cleaning plan tests."""

from __future__ import annotations

from collections.abc import AsyncGenerator

import pytest
from freezegun.api import FrozenDateTimeFactory
from homeassistant.core import HomeAssistant
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.cleaning_plan.const import DOMAIN

PLAN = """# Config
- Rhythmus: 2 Wochen
- Starttag: 6.10.2026

# Schedule

### Küche
- Spüle
- Kühlschrank (alle 2. Mal ab 2)

### Bad
- Toilette
"""


@pytest.fixture(autouse=True)
def auto_enable_custom_integrations(enable_custom_integrations: None) -> None:
    """Allow loading custom_components/ in every test."""


@pytest.fixture
async def berlin(hass: HomeAssistant, freezer: FrozenDateTimeFactory) -> FrozenDateTimeFactory:
    """Run in Europe/Berlin on the first visit day, 6 Oct 2026 at 10:00."""
    await hass.config.async_set_time_zone("Europe/Berlin")
    freezer.move_to("2026-10-06 08:00:00+00:00")
    return freezer


@pytest.fixture
def entry(hass: HomeAssistant) -> MockConfigEntry:
    """A config entry, not yet set up."""
    entry = MockConfigEntry(domain=DOMAIN, title="Putzplan", data={})
    entry.add_to_hass(hass)
    return entry


@pytest.fixture
async def loaded(
    hass: HomeAssistant, entry: MockConfigEntry, berlin: FrozenDateTimeFactory
) -> AsyncGenerator[MockConfigEntry]:
    """A set-up entry with PLAN saved."""
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    await entry.runtime_data.async_set_plan(PLAN)
    await hass.async_block_till_done()
    yield entry
