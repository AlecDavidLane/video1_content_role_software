"""OpenAVC script: guided commissioning of a 3-display meeting room.

Drives the Transition Layer test source (device id: tl_source) through one
test session per signal path — left monitor, right monitor, projector —
with room prep (display power + switcher routing) folded into each path.

Panel elements this script expects (create them in the UI Builder with
these element IDs):

    btn_test_left / btn_test_right / btn_test_proj   start a path's session
    btn_pass                                         pass current step
    btn_fail                                         fail current step (uses note below)
    input_fail_note                                  text input for the failure note
    btn_complete                                     complete session + generate report
    lbl_step  / lbl_session / lbl_result             status labels (bind or leave;
                                                     script writes ui overrides)

Adjust DEVICE IDS, switcher command names and I/O numbers to your rig —
they're all in the ROOM table below. The test sequence per path is the
appliance's standard checklist minus audio for video-only paths; edit
TEST_SEQUENCE to taste (keys: identify, alignment, colour, motion, audio,
mode, soak).

The appliance enforces the rules regardless of what this script does: a
FAIL without a note is rejected, and a session can only complete as
Passed when every test's latest attempt passed.
"""

from openavc import on_event, devices, state, log

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

TEST_SEQUENCE = ["identify", "alignment", "colour", "motion", "mode"]


def _show(step_text: str = "", session_text: str = "", result_text: str = ""):
    state.set("ui.lbl_step.label", step_text or None)
    state.set("ui.lbl_session.label", session_text or None)
    state.set("ui.lbl_result.label", result_text or None)


def _current_test() -> str | None:
    index = state.get("var.tl_step_index")
    if index is None or index >= len(TEST_SEQUENCE):
        return None
    return TEST_SEQUENCE[index]


async def _open_step():
    """Show the pattern for the current step and update the panel."""
    test = _current_test()
    if test is None:
        _show("All steps answered — press Complete",
              state.get("var.tl_path_label", ""))
        return
    await devices.send(TL, f"show_{test}")
    index = state.get("var.tl_step_index")
    _show(f"Step {index + 1}/{len(TEST_SEQUENCE)}: {test.upper()}",
          state.get("var.tl_path_label", ""))


async def _start_path(path_key: str):
    display_id, output, path_text = ROOM_PATHS[path_key]

    # Room prep: display on, route the test source to this path.
    await devices.send(display_id, "power_on")
    await devices.send(SWITCHER, "route", {"input": TL_INPUT, "output": output})

    # One TL session per signal path (a session IS a path in the appliance).
    await devices.send(TL, "begin_session", {
        "project": PROJECT,
        "room": ROOM,
        "path": path_text,
    })
    state.set("var.tl_step_index", 0)
    state.set("var.tl_path_label", path_text)
    log.info(f"TL commissioning: started path '{path_key}' ({path_text})")
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
    test = _current_test()
    if test is None:
        return
    await devices.send(TL, "record_pass", {"test": test})
    state.set("var.tl_step_index", state.get("var.tl_step_index", 0) + 1)
    await _open_step()


@on_event("ui.press.btn_fail")
async def record_fail(event):
    test = _current_test()
    if test is None:
        return
    note = (state.get("ui.input_fail_note.value")
            or state.get("var.input_fail_note") or "").strip()
    if not note:
        _show(f"FAIL needs a note — type one first ({test.upper()})",
              state.get("var.tl_path_label", ""))
        return  # the appliance would reject it anyway (409)
    await devices.send(TL, "record_fail", {"test": test, "note": note})
    state.set("var.tl_step_index", state.get("var.tl_step_index", 0) + 1)
    await _open_step()


@on_event("ui.press.btn_complete")
async def complete_and_report(event):
    await devices.send(TL, "complete_session")
    await devices.send(TL, "generate_report")
    # Driver polling refreshes session_status a moment later; reflect it.
    result = state.get(f"device.{TL}.session_status", "completed")
    _show("", state.get("var.tl_path_label", ""),
          f"Session {result} — report saved on the appliance")
    state.set("var.tl_step_index", None)
    log.info("TL commissioning: session completed and report generated")


# Capture the fail-note text input when submitted from the panel keyboard.
@on_event("ui.submit.input_fail_note")
def keep_note(event):
    state.set("var.input_fail_note", event.get("value", ""))
