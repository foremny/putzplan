"""Websocket commands used by the Lovelace card.

cleaning_plan/plans      -> [{entry_id, title}] of loaded plans
cleaning_plan/subscribe  -> pushes a snapshot now and on every change
cleaning_plan/validate   -> {errors, plan} for plan text, without saving
cleaning_plan/save_plan  -> {saved, errors}; optional renames keep ticks
cleaning_plan/set_done   -> ticks or unticks one task of one visit
"""

from __future__ import annotations

from typing import Any

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import config_validation as cv

from .const import DOMAIN
from .manager import InvalidPlan
from .plan import parse_plan
from .util import get_manager, resolve_tick, vol


@callback
def async_register_websocket(hass: HomeAssistant) -> None:
    """Register the websocket commands."""
    websocket_api.async_register_command(hass, ws_plans)
    websocket_api.async_register_command(hass, ws_subscribe)
    websocket_api.async_register_command(hass, ws_validate)
    websocket_api.async_register_command(hass, ws_save_plan)
    websocket_api.async_register_command(hass, ws_set_done)


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/plans"})
@callback
def ws_plans(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """List the loaded plans."""
    connection.send_result(
        msg["id"],
        [
            {"entry_id": entry.entry_id, "title": entry.title}
            for entry in hass.config_entries.async_loaded_entries(DOMAIN)
        ],
    )


@websocket_api.websocket_command(
    {vol.Required("type"): f"{DOMAIN}/subscribe", vol.Required("entry_id"): cv.string}
)
@callback
def ws_subscribe(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Push the plan, the ticks and today's date now and on every change.

    When the entry is unloaded (reload, update, removal) a final
    {"reload": true} event is sent and the subscription ends; the card then
    subscribes again.
    """
    entry, manager = get_manager(hass, msg["entry_id"])
    msg_id = msg["id"]

    @callback
    def forward() -> None:
        if manager.unloaded:
            connection.send_message(websocket_api.event_message(msg_id, {"reload": True}))
            if unsub := connection.subscriptions.pop(msg_id, None):
                unsub()
            return
        connection.send_message(
            websocket_api.event_message(msg_id, manager.snapshot(entry.title))
        )

    connection.subscriptions[msg_id] = manager.async_add_listener(forward)
    connection.send_result(msg_id)
    forward()


@websocket_api.websocket_command(
    {vol.Required("type"): f"{DOMAIN}/validate", vol.Required("text"): str}
)
@callback
def ws_validate(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Parse a plan text without saving it. Returns the structure and the errors."""
    plan = parse_plan(msg["text"])
    connection.send_result(
        msg["id"], {"errors": [e.as_dict() for e in plan.errors], "plan": plan.as_dict()}
    )


# [floor, location, task]; floor is "" for locations without a floor
_KEY = vol.All([str], vol.Length(min=3, max=3))


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/save_plan",
        vol.Required("entry_id"): cv.string,
        vol.Required("text"): str,
        # [{"from": [floor, location, task], "to": [...]}], sent by the form editor
        vol.Optional("renames", default=[]): [
            {vol.Required("from"): _KEY, vol.Required("to"): _KEY}
        ],
    }
)
@websocket_api.async_response
async def ws_save_plan(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Save the plan text if it has no errors. Ticks follow renamed tasks."""
    _, manager = get_manager(hass, msg["entry_id"])
    renames = [(tuple(r["from"]), tuple(r["to"])) for r in msg["renames"]]
    try:
        await manager.async_set_plan(msg["text"], renames)
    except InvalidPlan as err:
        connection.send_result(
            msg["id"], {"saved": False, "errors": [e.as_dict() for e in err.errors]}
        )
        return
    connection.send_result(msg["id"], {"saved": True, "errors": []})


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/set_done",
        vol.Required("entry_id"): cv.string,
        vol.Required("date"): cv.date,
        vol.Optional("floor", default=""): str,
        vol.Required("location"): str,
        vol.Required("task"): str,
        vol.Required("done"): bool,
    }
)
@websocket_api.async_response
async def ws_set_done(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Tick or untick a task of the visit on date."""
    _, manager = get_manager(hass, msg["entry_id"])
    floor, location, task = msg["floor"], msg["location"], msg["task"]
    day = resolve_tick(manager, msg["date"], floor, location, task)
    await manager.async_set_done(day, floor, location, task, msg["done"])
    connection.send_result(msg["id"])
