"""OpenAVC script: guided commissioning of a 3-display meeting room.

Drives the Transition Layer test source through one test session per
signal path — left monitor, right monitor, projector — with room prep
(display power + switcher routing) folded into each path.

The current step is ALWAYS read from the appliance (`next_test` in the
driver's polled state), never counted locally: a dropped or double-fired
button press can therefore never drift the panel out of sync with the
session. Requires appliance >= 0.1.10 and driver >= 1.1.2.

Panel elements this script expects (create them in the UI Builder with
these element IDs):

    btn_test_left / btn_test_right / btn_test_proj   start a path's session
    btn_pass                                         pass current step
    btn_fail                                         fail current step (note below)
    input_fail_note                                  text input for the failure note.
                                                     Bind its Shows->Value to
                                                     var.input_fail_note - the box then
                                                     always shows the note the next FAIL
                                                     will attach (reused across fails,
                                                     cleared when a new path starts)
    btn_complete                                     fallback: force-complete a session
                                                     (normally automatic after the last step)
    lbl_step / lbl_session / lbl_result              labels; bind each one's
                                                     Shows->Text to var.tl_step_text /
                                                     var.tl_session_text / var.tl_result_text

Adjust DEVICE IDS, switcher command names and I/O numbers to your rig —
they're all in the ROOM table below. TEST_SEQUENCE is passed to
begin_session so the session's required tests always match the panel's
plan (keys: identify, alignment, colour, motion, audio, mode, soak).

The appliance enforces the rules regardless of what this script does: a
FAIL without a note is rejected, and a session can only complete as
Passed when every test's latest attempt passed.
"""

import json

from openavc import on_event, devices, state, log, delay

TL = "tl_source"          # device id of the TL test source in this project
SWITCHER = "switcher"     # device id of your video switcher
TL_INPUT = 1              # switcher input the test source is plugged into

PROJECT = "Meeting Room 12"   # appears on the report cover
ROOM = "Meeting Room 12"

# path key -> (display device id, switcher output, human path description)
ROOM_PATHS = {
    "left":  ("display_left",  2, "Switcher in 1 -> out 2 -> Left monitor"),
    "right": ("display_right", 3, "Switcher in 1 -> out 3 -> Right monitor"),
    "proj":  ("projector",     1, "Switcher in 1 -> out 1 -> Projector"),
}

TEST_SEQUENCE = ["identify", "alignment", "colour", "motion", "audio", "mode"]

TOTAL = len(TEST_SEQUENCE)


def _show(step_text="", session_text="", result_text=""):
    state.set("var.tl_step_text", step_text)
    state.set("var.tl_session_text", session_text)
    state.set("var.tl_result_text", result_text)


def _next_test():
    """Server truth: the appliance's first unanswered test, '' when done."""
    return state.get(f"device.{TL}.next_test") or ""


def _remaining():
    return state.get(f"device.{TL}.unanswered_count") or 0


async def _sync(settle=1.5):
    """Ask the appliance for fresh status and give the reply time to land."""
    await devices.send(TL, "refresh_status")
    await delay(settle)


async def _open_step():
    test = _next_test()
    if not test:
        # Last step answered -> finish the session right now: complete,
        # generate the report, and the appliance shows the QR screen.
        await _finish_session()
        return
    await devices.send(TL, f"show_{test}")
    done = TOTAL - _remaining()
    _show(f"Step {done + 1}/{TOTAL}: {test.upper()}",
          state.get("var.tl_path_label", ""))


async def _finish_session():
    await devices.send(TL, "complete_session")
    await _sync(settle=2.5)
    result = state.get(f"device.{TL}.session_status", "unknown")
    if result in ("completed_passed", "completed_failed"):
        await devices.send(TL, "generate_report")
        _show("TEST COMPLETE — select the next signal path",
              state.get("var.tl_path_label", ""),
              f"Session {result} — scan the QR on the display for the report")
        log.info(f"TL commissioning: {result}, report generated")
    else:
        remaining = _remaining()
        _show(f"Completion BLOCKED — {remaining} step(s) unanswered"
              f" (next: {_next_test().upper() or '?'})",
              state.get("var.tl_path_label", ""),
              "Not completed — answer the remaining steps (panel or phone Review)")
        log.info("TL commissioning: completion blocked")


async def _start_path(path_key):
    display_id, output, path_text = ROOM_PATHS[path_key]

    # Room prep: display on, route the test source to this path. Must
    # never block the test - an offline display/switcher (or an
    # un-started simulator) only skips power/routing.
    try:
        await devices.send(display_id, "power_on")
        await devices.send(SWITCHER, "route", {"input": TL_INPUT, "output": output})
    except Exception as exc:  # noqa: BLE001
        log.info(f"room prep failed ({exc}) - continuing with the TL session anyway")

    # One TL session per signal path (a session IS a path in the appliance).
    await devices.send(TL, "begin_session", {
        "project": PROJECT,
        "room": ROOM,
        "path": path_text,
        "tests": json.dumps(TEST_SEQUENCE),
    })
    state.set("var.tl_path_label", path_text)
    state.set("var.input_fail_note", "")  # fresh path, fresh note box
    log.info(f"TL commissioning: started path '{path_key}' ({path_text})")
    await _sync()
    await _open_step()


@on_event("ui.press.btn_test_left")
async def test_left(event):
    await _start_path("left")


@on_event("ui.press.btn_test_right")
async def test_right(event):
    await _start_path("right")


@on_event("ui.press.btn_test_proj")
async def test_proj(event):
    await _start_path("proj")


@on_event("ui.press.btn_pass")
async def record_pass(event):
    test = _next_test()
    if not test:
        return
    await devices.send(TL, "record_pass", {"test": test})
    await _sync()
    await _open_step()


@on_event("ui.press.btn_fail")
async def record_fail(event):
    test = _next_test()
    if not test:
        return
    note = (state.get("var.input_fail_note") or "").strip()
    if not note:
        _show(f"FAIL needs a note — type it in the note box first ({test.upper()})",
              state.get("var.tl_path_label", ""))
        return  # the appliance would reject it anyway (409)
    # The note stays in the box afterwards: consecutive fails for the same
    # fault reuse it (the box always shows what the next FAIL will attach).
    # It clears when a new path starts. Clearing it here instead looks
    # broken on the panel - OpenAVC won't overwrite a focused text input,
    # so the box keeps showing a note the script no longer holds.
    await devices.send(TL, "record_fail", {"test": test, "note": note})
    await _sync()
    await _open_step()


# Fallback only: sessions now finish automatically when the last step is
# answered (_open_step -> _finish_session). Kept for stuck sessions.
@on_event("ui.press.btn_complete")
async def complete_and_report(event):
    await _finish_session()


# The panel's text input emits debounced ui.change events as the user
# types (~300 ms after the last keystroke) - capture the live value.
@on_event("ui.change.input_fail_note")
def keep_note(event):
    state.set("var.input_fail_note", event.get("value", ""))
