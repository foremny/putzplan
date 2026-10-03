"""Config flow for the Cleaning plan integration."""

from __future__ import annotations

from typing import Any

from homeassistant.config_entries import (
    ConfigEntry,
    ConfigFlow,
    ConfigFlowResult,
    OptionsFlow,
)
from homeassistant.const import CONF_NAME
from homeassistant.core import callback
from homeassistant.helpers.selector import (
    EntitySelector,
    EntitySelectorConfig,
    NumberSelector,
    NumberSelectorConfig,
    NumberSelectorMode,
    TextSelector,
)

from .const import (
    CONF_KEEP_DAYS,
    CONF_SUPPLIES_TODO,
    DEFAULT_KEEP_DAYS,
    DOMAIN,
)
from .util import vol

_DEFAULT_NAMES = {"de": "Putzplan", "en": "Cleaning plan"}


class CleaningPlanConfigFlow(ConfigFlow, domain=DOMAIN):
    """Create a cleaning plan. The plan itself is written in the card."""

    VERSION = 1

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Ask for a name."""
        errors: dict[str, str] = {}
        if user_input is not None:
            name = user_input[CONF_NAME].strip()
            if not name:
                errors[CONF_NAME] = "name_required"
            else:
                return self.async_create_entry(title=name, data={})

        lang = (self.hass.config.language or "en").split("-")[0].lower()
        default_name = _DEFAULT_NAMES.get(lang, _DEFAULT_NAMES["en"])
        schema = vol.Schema(
            {
                vol.Required(CONF_NAME, default=default_name): TextSelector(),
            }
        )
        return self.async_show_form(
            step_id="user",
            data_schema=self.add_suggested_values_to_schema(schema, user_input),
            errors=errors,
        )

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: ConfigEntry) -> OptionsFlow:
        """Return the options flow."""
        return CleaningPlanOptionsFlow()


class CleaningPlanOptionsFlow(OptionsFlow):
    """How long ticks are kept, and where missing supplies go."""

    async def async_step_init(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Show the options form."""
        if user_input is not None:
            data: dict[str, Any] = {CONF_KEEP_DAYS: int(user_input[CONF_KEEP_DAYS])}
            if todo := user_input.get(CONF_SUPPLIES_TODO):
                data[CONF_SUPPLIES_TODO] = todo
            return self.async_create_entry(data=data)
        options = self.config_entry.options
        schema = vol.Schema(
            {
                vol.Required(
                    CONF_KEEP_DAYS,
                    default=self.config_entry.options.get(CONF_KEEP_DAYS, DEFAULT_KEEP_DAYS),
                ): NumberSelector(
                    NumberSelectorConfig(
                        min=1,
                        max=3650,
                        step=1,
                        mode=NumberSelectorMode.BOX,
                        unit_of_measurement="d",
                    )
                ),
                # Optional and clearable, so a suggested value instead of a default
                vol.Optional(
                    CONF_SUPPLIES_TODO,
                    description={"suggested_value": options.get(CONF_SUPPLIES_TODO)},
                ): EntitySelector(EntitySelectorConfig(domain="todo")),
            }
        )
        return self.async_show_form(step_id="init", data_schema=schema)
