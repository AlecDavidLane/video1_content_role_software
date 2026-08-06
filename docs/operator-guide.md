# Operator Guide — TL Commissioning Test Source

For the AV engineer using the appliance on site.

## 1. First run

1. Connect the appliance's HDMI output to the start of the signal path and
   power it on. Within about a minute the display shows the black holding
   screen, then the **Identify** pattern.
2. Join your phone to the same network as the appliance, then either scan
   the QR code shown on the Home screen of a connected browser, or open
   `http://<appliance-ip>:8808`.
3. The first visit prompts **First-run setup**: company name, report accent
   colour, default engineer, appliance identity and the **control PIN**.
   The PIN protects every state-changing action from then on.
   If a unit lives on a trusted bench network you can switch the PIN off
   entirely with `sudo -u tl-source tl-source init --disable-pin`
   (re-enable with `--enable-pin`). The shipped default keeps it on.
4. Upload your report logo under **Maintain → Branding**.

## 2. Running a guided test

1. **Home → New test session.** Enter project, client, site, room and
   engineer. Previous projects can be reused from the drop-down.
2. Describe the signal path — structured endpoints (source, TX, network,
   RX, destination) and/or free text.
3. Tick the tests required for this path. Soak is optional; set its
   duration when selected.
4. **Create session → Start guided test.** Each step:
   - The correct pattern appears on the HDMI output automatically.
   - Read the instruction and the expected observation.
   - Confirm at the destination, then press **PASS & CONTINUE**.
   - Problems? Press **Fail…** — a short note is mandatory, a fault
     category and photos are optional. You can retest a failed step at any
     time; every attempt stays in the history.
   - **Attach photo** uploads pictures straight from the phone camera and
     they are attached to the current step's result.
5. **Review** lists every step, missing answers and failures. Completion as
   *Passed* is only offered when every required test's latest attempt
   passed — this is enforced by the appliance, not just the screen.
6. **Complete** → generate the report. Download the PDF/JSON on the phone,
   or collect them later from the appliance's reports folder
   (`/var/lib/tl-commissioning-source/reports`).

A completed session is read-only. **Reopen** (on the session page) records
a revision event with your reason and never rewrites history.

## 3. Manual patterns

**Patterns** gives direct control outside a session: the seven patterns,
output mode quick-picks (720p/1080p/2160p at 50/60 where the display
advertises them), the full advertised-mode list, audio sink selection and
soak start/stop. Only modes advertised by the connected display can be
selected.

## 4. What the patterns tell you

| Pattern | Look for |
|---|---|
| Identify | Right route, live image (clock/frame counter moving), expected mode |
| Alignment | Border touches all four edges; circle round; no cropping/stretch |
| Colour | All bars/blocks present, distinct grayscale steps, no clipped near-black/near-white |
| Motion | Smooth sweep, no freezes/judder/jumps of the bouncing block |
| Audio | "Left" heard left only, "Right" right only (stereo MVP) |
| Mode | Destination accepts and reports the shown resolution/refresh |
| Soak | Route stays up for the whole duration; faults are logged automatically |

## 5. Faults and recovery

- If the HDMI output disappears the UI shows **HDMI output disconnected**
  and a timestamped event is recorded (visible in Maintain → events and in
  the report's soak section).
- The appliance recovers from power loss by itself: services restart,
  the output returns to the holding/Identify screen, and no previously
  submitted result is lost. Just reload the phone page.
- Health details are on **Maintain**; each check has a plain-language
  detail string.

## 6. Limits to keep in mind

The appliance never certifies HDMI/HDCP compliance, colour accuracy, audio
level or network performance. Pass/fail is your confirmed observation at
the destination. For calibration or protocol analysis, use specialist
instruments.
