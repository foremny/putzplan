"""Tests for setup, entities, services and websocket."""

from __future__ import annotations

import datetime as dt
from typing import Any

import pytest
from freezegun.api import FrozenDateTimeFactory
from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import HomeAssistant, ServiceCall, SupportsResponse
from homeassistant.exceptions import ServiceValidationError
from homeassistant.helpers import entity_registry as er
from pytest_homeassistant_custom_component.common import (
    MockConfigEntry,
    async_capture_events,
    async_fire_time_changed,
)
from pytest_homeassistant_custom_component.typing import WebSocketGenerator

from custom_components.cleaning_plan.const import DOMAIN

from .conftest import PLAN


def _entity_id(hass: HomeAssistant, entry: MockConfigEntry, key: str, platform: str) -> str:
    entity_id = er.async_get(hass).async_get_entity_id(
        platform, DOMAIN, f"{entry.entry_id}_{key}"
    )
    assert entity_id
    return entity_id


async def test_setup_and_unload(hass: HomeAssistant, loaded: MockConfigEntry) -> None:
    """The entry loads, creates three entities and unloads."""
    assert loaded.state is ConfigEntryState.LOADED
    entities = er.async_entries_for_config_entry(er.async_get(hass), loaded.entry_id)
    assert sorted(e.domain for e in entities) == ["calendar", "sensor", "sensor"]
    assert await hass.config_entries.async_unload(loaded.entry_id)
    assert loaded.state is ConfigEntryState.NOT_LOADED


async def test_card_is_served(
    hass: HomeAssistant, loaded: MockConfigEntry, hass_client: Any
) -> None:
    """The bundled card is reachable over HTTP."""
    client = await hass_client()
    response = await client.get("/cleaning_plan_static/cleaning-plan-card.js")
    assert response.status == 200
    assert "cleaning-plan-visit-card" in await response.text()


async def test_sensors_follow_ticks(hass: HomeAssistant, loaded: MockConfigEntry) -> None:
    """Next visit is today; progress moves when tasks are ticked."""
    next_visit = _entity_id(hass, loaded, "next_visit", "sensor")
    progress = _entity_id(hass, loaded, "progress", "sensor")

    state = hass.states.get(next_visit)
    assert state.state == "2026-10-06"
    assert state.attributes["visit"] == 1
    assert state.attributes["days_until"] == 0
    assert state.attributes["tasks_due"] == 2  # Spüle, Toilette

    assert hass.states.get(progress).state == "0.0"
    await hass.services.async_call(
        DOMAIN,
        "set_task_done",
        {"config_entry_id": loaded.entry_id, "location": "Küche", "task": "Spüle"},
        blocking=True,
    )
    state = hass.states.get(progress)
    assert state.state == "50.0"
    assert state.attributes["open"] == 1


async def test_midnight_rolls_over(
    hass: HomeAssistant, loaded: MockConfigEntry, berlin: FrozenDateTimeFactory
) -> None:
    """After midnight following a visit, the next visit becomes current."""
    next_visit = _entity_id(hass, loaded, "next_visit", "sensor")
    berlin.move_to("2026-10-06 22:00:06+00:00")  # 00:00:06 on 7 Oct in Berlin
    async_fire_time_changed(hass)
    await hass.async_block_till_done()
    state = hass.states.get(next_visit)
    assert state.state == "2026-10-20"
    assert state.attributes["visit"] == 2
    assert state.attributes["tasks_due"] == 3  # Kühlschrank joins on visit 2


async def test_calendar(
    hass: HomeAssistant, loaded: MockConfigEntry, hass_client: Any
) -> None:
    """The calendar is on during a visit day and lists visits in a range."""
    calendar = _entity_id(hass, loaded, "visits", "calendar")
    state = hass.states.get(calendar)
    assert state.state == "on"
    assert state.attributes["message"] == "Cleaning visit 1"
    assert "Küche: Spüle" in state.attributes["description"]

    response = await hass.services.async_call(
        "calendar",
        "get_events",
        {
            "entity_id": calendar,
            "start_date_time": "2026-10-01 00:00:00",
            "end_date_time": "2026-11-01 00:00:00",
        },
        blocking=True,
        return_response=True,
    )
    events = response[calendar]["events"]
    assert [e["start"] for e in events] == ["2026-10-06", "2026-10-20"]
    assert events[1]["description"] == "Küche: Spüle, Kühlschrank\nBad: Toilette"


async def test_set_plan_service(hass: HomeAssistant, loaded: MockConfigEntry) -> None:
    """Invalid plans are rejected, valid ones replace the text."""
    with pytest.raises(ServiceValidationError) as err:
        await hass.services.async_call(
            DOMAIN,
            "set_plan",
            {"config_entry_id": loaded.entry_id, "plan": PLAN.replace("- Spüle", "- Spüle (alle zwei Mal)")},
            blocking=True,
        )
    assert err.value.translation_key == "invalid_plan"
    assert loaded.runtime_data.plan_text == PLAN

    new = PLAN.replace("2 Wochen", "1 Woche")
    await hass.services.async_call(
        DOMAIN, "set_plan", {"config_entry_id": loaded.entry_id, "plan": new}, blocking=True
    )
    assert loaded.runtime_data.plan.rhythm == 7


@pytest.mark.parametrize(
    ("data", "key"),
    [
        ({"location": "Küche", "task": "Kühlschrank"}, "task_not_due"),
        ({"location": "Küche", "task": "Backofen"}, "task_not_found"),
        ({"location": "Küche", "task": "Spüle", "date": "2026-10-07"}, "not_a_visit"),
        ({"location": "Küche", "task": "Spüle", "config_entry_id": "nope"}, "entry_not_found"),
    ],
)
async def test_set_task_done_validation(
    hass: HomeAssistant, loaded: MockConfigEntry, data: dict[str, Any], key: str
) -> None:
    """Ticks are only accepted for tasks due on a real visit."""
    with pytest.raises(ServiceValidationError) as err:
        await hass.services.async_call(
            DOMAIN,
            "set_task_done",
            {"config_entry_id": loaded.entry_id, **data},
            blocking=True,
        )
    assert err.value.translation_key == key


async def test_get_visit_service(hass: HomeAssistant, loaded: MockConfigEntry) -> None:
    """get_visit returns the due tasks with tick state."""
    await loaded.runtime_data.async_set_done(dt.date(2026, 10, 20), "", "Bad", "Toilette", True)
    response = await hass.services.async_call(
        DOMAIN,
        "get_visit",
        {"config_entry_id": loaded.entry_id, "offset": 1},
        blocking=True,
        return_response=True,
    )
    assert response == {
        "title": "Putzplan",
        "visit": 2,
        "date": "2026-10-20",
        "ticked": 1,
        "total": 3,
        "locations": [
            {"floor": "", "name": "Küche", "tasks": [{"name": "Spüle", "done": False}, {"name": "Kühlschrank", "done": False}]},
            {"floor": "", "name": "Bad", "tasks": [{"name": "Toilette", "done": True}]},
        ],
    }


async def test_websocket(
    hass: HomeAssistant, loaded: MockConfigEntry, hass_ws_client: WebSocketGenerator
) -> None:
    """The card's websocket commands: list, subscribe, validate, save, tick."""
    client = await hass_ws_client(hass)

    await client.send_json_auto_id({"type": "cleaning_plan/plans"})
    msg = await client.receive_json()
    assert msg["result"] == [{"entry_id": loaded.entry_id, "title": "Putzplan"}]

    await client.send_json_auto_id({"type": "cleaning_plan/subscribe", "entry_id": loaded.entry_id})
    assert (await client.receive_json())["success"]
    snap = (await client.receive_json())["event"]
    assert snap["today"] == "2026-10-06"
    assert snap["current_visit"] == 1
    assert snap["plan"]["start"] == "2026-10-06"
    assert snap["done"] == {}

    await client.send_json_auto_id(
        {
            "type": "cleaning_plan/set_done",
            "entry_id": loaded.entry_id,
            "date": "2026-10-06",
            "location": "Bad",
            "task": "Toilette",
            "done": True,
        }
    )
    event = await client.receive_json()  # subscription push arrives before the result
    assert event["event"]["done"] == {"2026-10-06": [["", "Bad", "Toilette"]]}
    assert (await client.receive_json())["success"]

    await client.send_json_auto_id(
        {"type": "cleaning_plan/validate", "text": "# Schedule\n### Küche\n- x (alle paar Mal)"}
    )
    msg = await client.receive_json()
    assert msg["result"]["errors"] == [
        {"code": "freq_invalid", "line": 3},
        {"code": "start_missing", "line": None},
    ]
    assert msg["result"]["plan"]["locations"] == [{"floor": "", "name": "Küche", "tasks": []}]

    await client.send_json_auto_id(
        {"type": "cleaning_plan/save_plan", "entry_id": loaded.entry_id, "text": "nonsense"}
    )
    msg = await client.receive_json()
    assert msg["result"]["saved"] is False

    await client.send_json_auto_id(
        {
            "type": "cleaning_plan/set_done",
            "entry_id": loaded.entry_id,
            "date": "2026-10-06",
            "location": "Bad",
            "task": "Dusche",
            "done": True,
        }
    )
    msg = await client.receive_json()
    assert not msg["success"]
    assert msg["error"]["translation_key"] == "task_not_found"

    # Unloading tells the card to subscribe again
    assert await hass.config_entries.async_unload(loaded.entry_id)
    msg = await client.receive_json()
    assert msg["event"] == {"reload": True}


async def test_save_plan_with_renames_keeps_ticks(
    hass: HomeAssistant, loaded: MockConfigEntry, hass_ws_client: WebSocketGenerator
) -> None:
    """Renames from the form editor move ticks to the new names, swaps included."""
    manager = loaded.runtime_data
    day = dt.date(2026, 10, 6)
    await manager.async_set_done(day, "", "Küche", "Spüle", True)
    await manager.async_set_done(day, "", "Bad", "Toilette", True)
    await manager.async_set_done(dt.date(2026, 10, 20), "", "Küche", "Kühlschrank", True)

    new_text = (
        PLAN.replace("Spüle", "Spülbecken").replace("### Bad\n", "## OG\n### Badezimmer\n")
    )
    client = await hass_ws_client(hass)
    await client.send_json_auto_id(
        {
            "type": "cleaning_plan/save_plan",
            "entry_id": loaded.entry_id,
            "text": new_text,
            "renames": [
                {"from": ["", "Küche", "Spüle"], "to": ["", "Küche", "Spülbecken"]},
                {"from": ["", "Bad", "Toilette"], "to": ["OG", "Badezimmer", "Toilette"]},
            ],
        }
    )
    assert (await client.receive_json())["result"] == {"saved": True, "errors": []}
    assert manager.is_done(day, "", "Küche", "Spülbecken")
    assert manager.is_done(day, "OG", "Badezimmer", "Toilette")
    assert not manager.is_done(day, "", "Küche", "Spüle")
    assert manager.is_done(dt.date(2026, 10, 20), "", "Küche", "Kühlschrank")

    # Swapping two names swaps their ticks
    await manager.async_set_plan(
        new_text,
        [
            (("", "Küche", "Spülbecken"), ("OG", "Badezimmer", "Toilette")),
            (("OG", "Badezimmer", "Toilette"), ("", "Küche", "Spülbecken")),
        ],
    )
    assert manager.is_done(day, "", "Küche", "Spülbecken")
    assert manager.is_done(day, "OG", "Badezimmer", "Toilette")

    # Malformed renames are rejected by the schema
    await client.send_json_auto_id(
        {
            "type": "cleaning_plan/save_plan",
            "entry_id": loaded.entry_id,
            "text": new_text,
            "renames": [{"from": ["only", "two"], "to": ["a", "b", "c"]}],
        }
    )
    assert (await client.receive_json())["error"]["code"] == "invalid_format"


async def test_storage_survives_reload(hass: HomeAssistant, loaded: MockConfigEntry) -> None:
    """Plan and ticks are persisted."""
    await loaded.runtime_data.async_set_done(dt.date(2026, 10, 6), "", "Bad", "Toilette", True)
    assert await hass.config_entries.async_reload(loaded.entry_id)
    await hass.async_block_till_done()
    manager = loaded.runtime_data
    assert manager.plan_text == PLAN
    assert manager.is_done(dt.date(2026, 10, 6), "", "Bad", "Toilette")


async def test_old_ticks_are_cleaned_up(
    hass: HomeAssistant, loaded: MockConfigEntry, berlin: FrozenDateTimeFactory
) -> None:
    """Ticks older than keep_days disappear at midnight; options apply live."""
    manager = loaded.runtime_data
    await manager.async_set_done(dt.date(2026, 10, 6), "", "Bad", "Toilette", True)
    hass.config_entries.async_update_entry(loaded, options={"keep_days": 10})
    await hass.async_block_till_done()
    assert manager.keep_days == 10
    berlin.move_to("2026-10-20 22:00:06+00:00")
    async_fire_time_changed(hass)
    await hass.async_block_till_done()
    assert not manager.is_done(dt.date(2026, 10, 6), "", "Bad", "Toilette")


FLOOR_PLAN = """# Config
- Rhythmus: 2 Wochen
- Starttag: 6.10.2026

# Schedule

## Erdgeschoss
### Bad
- Toilette

## Obergeschoss
### Bad
- Toilette
"""


async def test_same_location_on_two_floors(
    hass: HomeAssistant, loaded: MockConfigEntry
) -> None:
    """Ticks, services and the calendar keep floors apart."""
    manager = loaded.runtime_data
    await manager.async_set_plan(FLOOR_PLAN)
    await hass.services.async_call(
        DOMAIN,
        "set_task_done",
        {"config_entry_id": loaded.entry_id, "floor": "Obergeschoss", "location": "Bad", "task": "Toilette"},
        blocking=True,
    )
    day = dt.date(2026, 10, 6)
    assert manager.is_done(day, "Obergeschoss", "Bad", "Toilette")
    assert not manager.is_done(day, "Erdgeschoss", "Bad", "Toilette")

    # Without the floor the task does not exist
    with pytest.raises(ServiceValidationError) as err:
        await hass.services.async_call(
            DOMAIN,
            "set_task_done",
            {"config_entry_id": loaded.entry_id, "location": "Bad", "task": "Toilette"},
            blocking=True,
        )
    assert err.value.translation_key == "task_not_found"

    info = manager.visit_info(1)
    assert [(loc["floor"], loc["name"], loc["tasks"][0]["done"]) for loc in info["locations"]] == [
        ("Erdgeschoss", "Bad", False),
        ("Obergeschoss", "Bad", True),
    ]
    await hass.async_block_till_done()
    calendar = _entity_id(hass, loaded, "visits", "calendar")
    assert hass.states.get(calendar).attributes["description"] == (
        "Erdgeschoss\nBad: Toilette\n\nObergeschoss\nBad: Toilette"
    )


async def test_storage_migrates_from_version_1(
    hass: HomeAssistant,
    entry: MockConfigEntry,
    berlin: FrozenDateTimeFactory,
    hass_storage: dict[str, Any],
) -> None:
    """Ticks stored as [location, task] become [floor, location, task]."""
    hass_storage[f"{DOMAIN}.{entry.entry_id}"] = {
        "version": 1,
        "minor_version": 1,
        "key": f"{DOMAIN}.{entry.entry_id}",
        "data": {
            "plan": PLAN,
            "done": {"2026-10-06": [["Bad", "Toilette"]]},
        },
    }
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    assert entry.runtime_data.is_done(dt.date(2026, 10, 6), "", "Bad", "Toilette")


# ----- feedback: missing supplies and problem reports -----


async def test_supplies_missing_and_event(
    hass: HomeAssistant, loaded: MockConfigEntry, hass_ws_client: WebSocketGenerator
) -> None:
    """Supplies from the plan can be reported missing and available again."""
    events = async_capture_events(hass, "cleaning_plan_feedback")
    client = await hass_ws_client(hass)
    manager = loaded.runtime_data
    assert manager.plan.supplies == ["Müllbeutel", "Spülmittel"]

    await client.send_json_auto_id(
        {"type": "cleaning_plan/set_supply_missing", "entry_id": loaded.entry_id, "supply": "Müllbeutel", "missing": True}
    )
    assert (await client.receive_json())["success"]
    assert manager.is_missing("Müllbeutel")
    assert list(manager.snapshot("x")["missing"]) == ["Müllbeutel"]
    await hass.async_block_till_done()
    assert [e.data for e in events] == [
        {"entry_id": loaded.entry_id, "type": "supply_missing", "supply": "Müllbeutel"}
    ]

    # Reporting again changes nothing and fires nothing
    await manager.async_set_supply_missing("Müllbeutel", True)
    await hass.async_block_till_done()
    assert len(events) == 1

    await client.send_json_auto_id(
        {"type": "cleaning_plan/set_supply_missing", "entry_id": loaded.entry_id, "supply": "Gold", "missing": True}
    )
    msg = await client.receive_json()
    assert msg["error"]["translation_key"] == "supply_not_found"

    # A supply removed from the plan is no longer missing
    await manager.async_set_supply_missing("Spülmittel", True)
    await manager.async_set_plan(PLAN.replace("- Müllbeutel\n", ""))
    assert manager.snapshot("x")["missing"].keys() == {"Spülmittel"}
    assert not manager.is_missing("Müllbeutel")

    await manager.async_set_supply_missing("Spülmittel", False)
    await hass.async_block_till_done()
    assert events[-1].data["type"] == "supply_available"


async def test_missing_supply_goes_to_todo_list(
    hass: HomeAssistant, loaded: MockConfigEntry
) -> None:
    """With the option set, a missing supply is added to the to-do list once."""
    items: list[dict[str, Any]] = [{"summary": "Milch", "uid": "1", "status": "needs_action"}]
    added: list[str] = []
    hass.states.async_set("todo.shopping_list", "1")

    async def get_items(call: ServiceCall) -> dict[str, Any]:
        return {"todo.shopping_list": {"items": items}}

    async def add_item(call: ServiceCall) -> None:
        added.append(call.data["item"])
        items.append({"summary": call.data["item"], "uid": str(len(items) + 1), "status": "needs_action"})

    hass.services.async_register("todo", "get_items", get_items, supports_response=SupportsResponse.ONLY)
    hass.services.async_register("todo", "add_item", add_item)

    hass.config_entries.async_update_entry(loaded, options={"keep_days": 60, "supplies_todo": "todo.shopping_list"})
    await hass.async_block_till_done()
    manager = loaded.runtime_data
    assert manager.supplies_todo == "todo.shopping_list"

    await manager.async_set_supply_missing("Müllbeutel", True)
    assert added == ["Müllbeutel"]
    # Cleared and reported again while still open on the list: not added twice
    await manager.async_set_supply_missing("Müllbeutel", False)
    await manager.async_set_supply_missing("Müllbeutel", True)
    assert added == ["Müllbeutel"]


async def test_missing_todo_list_only_logs(
    hass: HomeAssistant, loaded: MockConfigEntry, caplog: pytest.LogCaptureFixture
) -> None:
    """A to-do list that does not exist does not break reporting."""
    loaded.runtime_data.supplies_todo = "todo.gone"
    await loaded.runtime_data.async_set_supply_missing("Müllbeutel", True)
    assert loaded.runtime_data.is_missing("Müllbeutel")
    assert "todo.gone" in caplog.text


async def test_problem_report_and_resolve(
    hass: HomeAssistant, loaded: MockConfigEntry, hass_ws_client: WebSocketGenerator
) -> None:
    """The cleaner reports a problem on a due task; the household resolves it."""
    events = async_capture_events(hass, "cleaning_plan_feedback")
    client = await hass_ws_client(hass)
    manager = loaded.runtime_data
    base = {"type": "cleaning_plan/report_problem", "entry_id": loaded.entry_id, "date": "2026-10-06"}

    await client.send_json_auto_id({**base, "location": "Bad", "task": "Toilette", "kind": "issue", "note": " Spülung defekt "})
    first = (await client.receive_json())["result"]["id"]
    [problem] = manager.snapshot("x")["problems"]
    assert problem["id"] == first
    assert (problem["floor"], problem["location"], problem["task"]) == ("", "Bad", "Toilette")
    assert (problem["kind"], problem["note"], problem["date"]) == ("issue", "Spülung defekt", "2026-10-06")
    await hass.async_block_till_done()
    assert events[-1].data == {
        "entry_id": loaded.entry_id,
        "type": "task_problem",
        "id": first,
        "date": "2026-10-06",
        "floor": "",
        "location": "Bad",
        "task": "Toilette",
        "kind": "issue",
        "note": "Spülung defekt",
    }

    # A second report for the same task and visit replaces the first
    await client.send_json_auto_id({**base, "location": "Bad", "task": "Toilette", "kind": "skipped"})
    second = (await client.receive_json())["result"]["id"]
    assert [p["id"] for p in manager.snapshot("x")["problems"]] == [second]

    # Only due tasks, only known kinds
    await client.send_json_auto_id({**base, "location": "Küche", "task": "Kühlschrank", "kind": "issue"})
    assert (await client.receive_json())["error"]["translation_key"] == "task_not_due"
    await client.send_json_auto_id({**base, "location": "Bad", "task": "Toilette", "kind": "kaputt"})
    assert (await client.receive_json())["error"]["code"] == "invalid_format"
    await client.send_json_auto_id({**base, "location": "Bad", "task": "Toilette", "kind": "issue", "note": "x" * 501})
    assert (await client.receive_json())["error"]["code"] == "invalid_format"

    await client.send_json_auto_id({"type": "cleaning_plan/resolve_problem", "entry_id": loaded.entry_id, "problem_id": second})
    assert (await client.receive_json())["success"]
    assert manager.snapshot("x")["problems"] == []
    await hass.async_block_till_done()
    assert events[-1].data["type"] == "problem_resolved"

    await client.send_json_auto_id({"type": "cleaning_plan/resolve_problem", "entry_id": loaded.entry_id, "problem_id": second})
    assert (await client.receive_json())["error"]["translation_key"] == "problem_not_found"


async def test_problems_follow_renames_and_expire(
    hass: HomeAssistant, loaded: MockConfigEntry, berlin: FrozenDateTimeFactory
) -> None:
    """Problem reports move with renamed tasks and expire with keep_days."""
    manager = loaded.runtime_data
    await manager.async_report_problem(dt.date(2026, 10, 6), "", "Bad", "Toilette", "issue", "")
    await manager.async_set_plan(
        PLAN.replace("### Bad\n- Toilette", "### Bad\n- WC"),
        [(("", "Bad", "Toilette"), ("", "Bad", "WC"))],
    )
    assert manager.snapshot("x")["problems"][0]["task"] == "WC"

    # Survives a reload
    assert await hass.config_entries.async_reload(loaded.entry_id)
    await hass.async_block_till_done()
    manager = loaded.runtime_data
    assert len(manager.snapshot("x")["problems"]) == 1

    hass.config_entries.async_update_entry(loaded, options={"keep_days": 10})
    await hass.async_block_till_done()
    berlin.move_to("2026-10-20 22:00:06+00:00")
    async_fire_time_changed(hass)
    await hass.async_block_till_done()
    assert manager.snapshot("x")["problems"] == []
