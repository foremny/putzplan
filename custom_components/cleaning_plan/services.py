"""Services of the Cleaning plan integration."""

from __future__ import annotations

from homeassistant.core import (
    HomeAssistant,
    ServiceCall,
    ServiceResponse,
    SupportsResponse,
    callback,
)
from homeassistant.exceptions import ServiceValidationError
from homeassistant.helpers import config_validation as cv

from .const import (
    ATTR_CONFIG_ENTRY_ID,
    ATTR_DATE,
    ATTR_DONE,
    ATTR_FLOOR,
    ATTR_LOCATION,
    ATTR_OFFSET,
    ATTR_PLAN,
    ATTR_TASK,
    DOMAIN,
    SERVICE_GET_VISIT,
    SERVICE_SET_PLAN,
    SERVICE_SET_TASK_DONE,
)
from .manager import InvalidPlan
from .util import get_manager, resolve_tick, vol

SET_PLAN_SCHEMA = vol.Schema(
    {
        vol.Required(ATTR_CONFIG_ENTRY_ID): cv.string,
        vol.Required(ATTR_PLAN): cv.string,
    }
)

SET_TASK_DONE_SCHEMA = vol.Schema(
    {
        vol.Required(ATTR_CONFIG_ENTRY_ID): cv.string,
        vol.Optional(ATTR_FLOOR, default=""): str,
        vol.Required(ATTR_LOCATION): cv.string,
        vol.Required(ATTR_TASK): cv.string,
        vol.Optional(ATTR_DONE, default=True): cv.boolean,
        vol.Optional(ATTR_DATE): cv.date,
    }
)

GET_VISIT_SCHEMA = vol.Schema(
    {
        vol.Required(ATTR_CONFIG_ENTRY_ID): cv.string,
        vol.Optional(ATTR_OFFSET, default=0): vol.Coerce(int),
        vol.Optional(ATTR_DATE): cv.date,
    }
)


async def _set_plan(call: ServiceCall) -> None:
    _, manager = get_manager(call.hass, call.data[ATTR_CONFIG_ENTRY_ID])
    try:
        await manager.async_set_plan(call.data[ATTR_PLAN])
    except InvalidPlan as err:
        first = err.errors[0]
        raise ServiceValidationError(
            translation_domain=DOMAIN,
            translation_key="invalid_plan",
            translation_placeholders={
                "count": str(len(err.errors)),
                "line": str(first.line or "-"),
                "code": first.code,
            },
        ) from err


async def _set_task_done(call: ServiceCall) -> None:
    _, manager = get_manager(call.hass, call.data[ATTR_CONFIG_ENTRY_ID])
    floor = call.data[ATTR_FLOOR].strip()
    location, task = call.data[ATTR_LOCATION], call.data[ATTR_TASK]
    day = resolve_tick(manager, call.data.get(ATTR_DATE), floor, location, task)
    await manager.async_set_done(day, floor, location, task, call.data[ATTR_DONE])


async def _get_visit(call: ServiceCall) -> ServiceResponse:
    entry, manager = get_manager(call.hass, call.data[ATTR_CONFIG_ENTRY_ID])
    plan = manager.plan
    if not plan.usable:
        raise ServiceValidationError(translation_domain=DOMAIN, translation_key="no_plan")
    base = call.data.get(ATTR_DATE) or manager.today()
    visit = max(1, plan.current_visit(base) + call.data[ATTR_OFFSET])
    return {"title": entry.title, **manager.visit_info(visit)}


@callback
def async_register_services(hass: HomeAssistant) -> None:
    """Register the services."""
    hass.services.async_register(DOMAIN, SERVICE_SET_PLAN, _set_plan, SET_PLAN_SCHEMA)
    hass.services.async_register(
        DOMAIN, SERVICE_SET_TASK_DONE, _set_task_done, SET_TASK_DONE_SCHEMA
    )
    hass.services.async_register(
        DOMAIN,
        SERVICE_GET_VISIT,
        _get_visit,
        GET_VISIT_SCHEMA,
        supports_response=SupportsResponse.ONLY,
    )
