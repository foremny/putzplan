"""Constants for the Cleaning plan integration."""

from __future__ import annotations

from typing import Final

DOMAIN: Final = "cleaning_plan"

# 2: ticks are [floor, location, task] (were [location, task])
STORAGE_VERSION: Final = 2

CONF_KEEP_DAYS: Final = "keep_days"
CONF_SUPPLIES_TODO: Final = "supplies_todo"
DEFAULT_KEEP_DAYS: Final = 60

# Frontend card shipped with the integration
CARD_FILENAME: Final = "cleaning-plan-card.js"
CARD_URL_BASE: Final = f"/{DOMAIN}_static"

# Fired when the cleaner reports a missing supply or a problem with a task,
# and when either is cleared. data: entry_id, type and the details.
EVENT_FEEDBACK: Final = "cleaning_plan_feedback"
PROBLEM_KINDS: Final = ("skipped", "issue")
NOTE_MAX_LENGTH: Final = 500

# Service and websocket field names
ATTR_CONFIG_ENTRY_ID: Final = "config_entry_id"
ATTR_PLAN: Final = "plan"
ATTR_FLOOR: Final = "floor"
ATTR_LOCATION: Final = "location"
ATTR_TASK: Final = "task"
ATTR_DONE: Final = "done"
ATTR_DATE: Final = "date"
ATTR_OFFSET: Final = "offset"

SERVICE_SET_PLAN: Final = "set_plan"
SERVICE_SET_TASK_DONE: Final = "set_task_done"
SERVICE_GET_VISIT: Final = "get_visit"
