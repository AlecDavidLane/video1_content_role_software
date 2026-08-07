# Deploying with Ansible

The `tl_commissioning_source` role turns a fresh **Ubuntu 24.04 LTS
(Xorg)** machine into a complete TL commissioning test source appliance:

1. installs the `.deb` built by `packaging/build-deb.sh` (backend
   service, kiosk unit, bundled Chromium for PDF rendering, `tl-source`
   CLI on the PATH),
2. configures identity, branding, security and the panel QR
   non-interactively through `tl-source init` (no simulated GUI actions —
   §12 of the brief),
3. sets up the full-kiosk boot: GDM autologin on Xorg, kiosk unit
   enabled for the desktop session, screen blanking/locking/sleep
   disabled,
4. validates the install with `tl-source healthcheck` (AC-14) and
   records the deploying role version on the appliance (FR-40).

## Quick start

```bash
# 1. Build the package (on Ubuntu 24.04 / Python 3.12)
./packaging/build-deb.sh

# 2. Describe your appliances
cat > inventory.ini <<'EOF'
[test_sources]
tl-source-01 ansible_host=192.168.1.50 ansible_user=installer
EOF

# 3. Deploy
ansible-playbook -i inventory.ini ansible/playbook-example.yml
```

The example playbook shows per-host appliance IDs/source numbers derived
from the inventory, secrets from ansible-vault, and `tl_reboot: true` so
each machine comes back up in the kiosk.

## Variables

See `roles/tl_commissioning_source/defaults/main.yml` — every setting is
optional except `tl_deb_src`. Highlights:

| Variable | Purpose |
|---|---|
| `tl_deb_src` | Path on the controller to the built `.deb` (required) |
| `tl_appliance_id`, `tl_source_number`, `tl_friendly_name` | Appliance identity |
| `tl_company`, `tl_accent_colour`, `tl_logo_src`, `tl_report_footer` | Report branding |
| `tl_pin` | Control PIN (marks setup complete; keep in vault) |
| `tl_disable_pin` | `true` = open LAN control — trusted bench networks only |
| `tl_api_token` | Static bearer token for integrations (OpenAVC, validation) |
| `tl_panel_url` | Room-control panel QR on the Identify screen; use the literal `{ip}` placeholder for DHCP-safe URLs, e.g. `http://{ip}:8080/panel` |
| `tl_kiosk_user`, `tl_manage_autologin`, `tl_manage_dconf` | Kiosk boot behaviour |
| `tl_reboot` | Reboot at the end so the machine comes up in the kiosk |
| `tl_role_version` | Recorded on the appliance and shown in `/health` (FR-40) |

## Idempotency and re-runs

Re-running the play is safe: the deb install is skipped when the version
matches, `tl-source init` rewrites the same configuration, and the GDM /
dconf files are only rewritten on change. Upgrades are the same play with
a newer `tl_deb_src`.

## Replicating the room-control setup (OpenAVC)

The second role, `openavc_room_control`, makes a fresh machine come up
exactly like a reference machine — OpenAVC installed, plus the captured
project: devices, the TL driver, the panel UI, the room script and the
Programmer credentials. Everything OpenAVC knows lives in
`/var/lib/openavc`, so replication is a snapshot restore:

```bash
# On the reference machine (bench):
sudo systemctl stop openavc
sudo tar czf openavc-state.tgz -C /var/lib openavc
sudo systemctl start openavc
# copy openavc-state.tgz next to the playbook
```

Then set `openavc_state_src` (see the example playbook). Two things to
get right:

- **`tl_api_token` must be the same token stored inside the snapshot's
  TL device** (the one you pasted into the OpenAVC driver config on the
  bench). Deploy every machine with that vaulted token and the restored
  panel controls the local appliance out of the box. The panel URL QR
  needs no attention — `{ip}` resolves per machine.
- **Simulated devices don't run by themselves.** A restored snapshot
  lists whatever devices the bench had; simulated ones show offline
  until the simulator is started (demo rigs) or real hardware is present
  (deployments). The room script tolerates offline room devices — the
  TL test flow still runs.

The OpenAVC installer (`openavc_install: online`) needs internet on the
target and installs the latest release; re-running upgrades in place.
Set `openavc_install: skip` for machines that already have it.

## What the roles do NOT do

- **Network shares** for auto-saving reports (site-specific; see
  `integrations/openavc/README.md` §6).
