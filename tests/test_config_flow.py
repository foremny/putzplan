"""Tests for the config and options flows."""

from __future__ import annotations

from homeassistant import config_entries
from homeassistant.core import HomeAssistant
from homeassistant.data_entry_flow import FlowResultType
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.cleaning_plan.const import (
    CONF_KEEP_DAYS,
    DOMAIN,
)


async def test_create_plain(hass: HomeAssistant) -> None:
    """A plan without import only needs a name."""
    result = await hass.config_entries.flow.async_init(
        DOMAIN, context={"source": config_entries.SOURCE_USER}
    )
    assert result["type"] is FlowResultType.FORM
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {"name": "  Haus  "}
    )
    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert result["title"] == "Haus"
    assert result["data"] == {}


async def test_name_required(hass: HomeAssistant) -> None:
    """A blank name is rejected."""
    result = await hass.config_entries.flow.async_init(
        DOMAIN, context={"source": config_entries.SOURCE_USER}
    )
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {"name": " "})
    assert result["errors"] == {"name": "name_required"}


async def test_options(hass: HomeAssistant, entry: MockConfigEntry) -> None:
    """keep_days can be changed."""
    result = await hass.config_entries.options.async_init(entry.entry_id)
    result = await hass.config_entries.options.async_configure(
        result["flow_id"], {CONF_KEEP_DAYS: 30}
    )
    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert entry.options == {CONF_KEEP_DAYS: 30}
