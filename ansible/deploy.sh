#!/usr/bin/env bash
#
# One-command appliance deployment from a controller (Mac or Linux).
#
#   1. On the target: run ansible/bootstrap/linux-ssh-bootstrap.sh
#      (creates the SSH user, enables sshd):
#        sudo bash linux-ssh-bootstrap.sh --username installer --sudo-user
#   2. On this machine:
#        export TL_API_TOKEN=...     # must match the OpenAVC snapshot
#        export TL_PIN=...           # optional; empty = PIN disabled
#        ./deploy.sh <target-ip> [ssh-user]
#
# Artifacts must exist first (see artifacts/README.md):
#   artifacts/tl-commissioning-source.deb
#   artifacts/openavc-state.tgz
#
# The script copies your SSH key to the target (one password prompt),
# then runs the playbook; the target reboots into the finished appliance.

set -euo pipefail

HOST="${1:-}"
SSH_USER="${2:-installer}"
DIR="$(cd "$(dirname "$0")" && pwd)"

die() { echo "ERROR: $*" >&2; exit 1; }

[ -n "$HOST" ] || die "usage: ./deploy.sh <target-ip> [ssh-user]"
command -v ansible-playbook >/dev/null || die "ansible not found - on a Mac: brew install ansible"
[ -f "$DIR/artifacts/tl-commissioning-source.deb" ] || die "missing artifacts/tl-commissioning-source.deb (see artifacts/README.md)"
[ -f "$DIR/artifacts/openavc-state.tgz" ] || die "missing artifacts/openavc-state.tgz (see artifacts/README.md)"
[ -n "${TL_API_TOKEN:-}" ] || die "TL_API_TOKEN is not set - it must match the token in the OpenAVC snapshot"

# SSH key auth: generate a key if none, then install it (one password prompt).
if [ ! -f "$HOME/.ssh/id_ed25519" ] && [ ! -f "$HOME/.ssh/id_rsa" ]; then
  ssh-keygen -t ed25519 -N "" -f "$HOME/.ssh/id_ed25519"
fi
echo "==> Installing SSH key on $SSH_USER@$HOST (enter the target user's password once)"
ssh-copy-id -o StrictHostKeyChecking=accept-new "$SSH_USER@$HOST"

INVENTORY="$(mktemp)"
trap 'rm -f "$INVENTORY"' EXIT
cat > "$INVENTORY" <<EOF
[test_sources]
target ansible_host=$HOST ansible_user=$SSH_USER
EOF

echo "==> Deploying to $HOST (sudo password prompt follows)"
ansible-playbook -i "$INVENTORY" "$DIR/deploy.yml" --ask-become-pass

echo "==> Done. $HOST is rebooting into the finished appliance."
