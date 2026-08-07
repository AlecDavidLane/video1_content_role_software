#!/usr/bin/env bash
set -euo pipefail

AUTH_MODE="both"
USERNAME=""
PASSWORD=""
ADD_SUDO_USER="false"
OPEN_FIREWALL="false"
PERMIT_ROOT_LOGIN="no"

usage() {
  cat <<'EOF'
Usage: linux-ssh-bootstrap.sh [options]

Prepares a Linux host for Ansible SSH access.

Options:
  --auth-mode <password|key|both>  SSH auth mode (default: both)
  --username <name>                Optional user to create/update
  --password <value>               Password for --username (or prompt if omitted)
  --sudo-user                      Add --username to sudo/wheel group
  --open-firewall                  Open TCP/22 in ufw or firewalld if present
  --permit-root-login <yes|no>     PermitRootLogin value (default: no)
  -h, --help                       Show this help text
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --auth-mode)
      AUTH_MODE="${2:-}"
      shift 2
      ;;
    --username)
      USERNAME="${2:-}"
      shift 2
      ;;
    --password)
      PASSWORD="${2:-}"
      shift 2
      ;;
    --sudo-user)
      ADD_SUDO_USER="true"
      shift
      ;;
    --open-firewall)
      OPEN_FIREWALL="true"
      shift
      ;;
    --permit-root-login)
      PERMIT_ROOT_LOGIN="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ "$EUID" -ne 0 ]]; then
  echo "Run as root (or via sudo)." >&2
  exit 1
fi

if [[ "$AUTH_MODE" != "password" && "$AUTH_MODE" != "key" && "$AUTH_MODE" != "both" ]]; then
  echo "Invalid --auth-mode: $AUTH_MODE" >&2
  exit 1
fi

if [[ "$PERMIT_ROOT_LOGIN" != "yes" && "$PERMIT_ROOT_LOGIN" != "no" ]]; then
  echo "Invalid --permit-root-login: $PERMIT_ROOT_LOGIN" >&2
  exit 1
fi

install_ssh_server() {
  if command -v apt-get >/dev/null 2>&1; then
    apt-get update -y
    DEBIAN_FRONTEND=noninteractive apt-get install -y openssh-server
  elif command -v dnf >/dev/null 2>&1; then
    dnf install -y openssh-server
  elif command -v yum >/dev/null 2>&1; then
    yum install -y openssh-server
  elif command -v zypper >/dev/null 2>&1; then
    zypper --non-interactive install openssh
  else
    echo "Unsupported package manager. Install OpenSSH server manually." >&2
    exit 1
  fi
}

ensure_sshd_service() {
  local service_name=""
  if systemctl list-unit-files --type=service --no-legend | awk '{print $1}' | grep -Fxq 'ssh.service'; then
    service_name="ssh"
  elif systemctl list-unit-files --type=service --no-legend | awk '{print $1}' | grep -Fxq 'sshd.service'; then
    service_name="sshd"
  else
    echo "Could not find ssh.service or sshd.service. Install OpenSSH service first." >&2
    exit 1
  fi
  systemctl enable --now "$service_name"
}

set_sshd_option() {
  local key="$1"
  local value="$2"
  if grep -Eq "^\s*#?\s*${key}\s+" /etc/ssh/sshd_config; then
    sed -i -E "s|^\s*#?\s*${key}\s+.*$|${key} ${value}|" /etc/ssh/sshd_config
  else
    printf '%s %s\n' "$key" "$value" >> /etc/ssh/sshd_config
  fi
}

configure_sshd_auth() {
  case "$AUTH_MODE" in
    password)
      set_sshd_option "PasswordAuthentication" "yes"
      set_sshd_option "PubkeyAuthentication" "no"
      ;;
    key)
      set_sshd_option "PasswordAuthentication" "no"
      set_sshd_option "PubkeyAuthentication" "yes"
      ;;
    both)
      set_sshd_option "PasswordAuthentication" "yes"
      set_sshd_option "PubkeyAuthentication" "yes"
      ;;
  esac
  set_sshd_option "ChallengeResponseAuthentication" "no"
  set_sshd_option "PermitRootLogin" "$PERMIT_ROOT_LOGIN"
  set_sshd_option "UsePAM" "yes"
}

ensure_user() {
  if [[ -z "$USERNAME" ]]; then
    return
  fi

  if ! id "$USERNAME" >/dev/null 2>&1; then
    useradd -m -s /bin/bash "$USERNAME"
  fi

  if [[ -z "$PASSWORD" && "$AUTH_MODE" != "key" ]]; then
    read -r -s -p "Password for ${USERNAME}: " PASSWORD
    echo
  fi

  if [[ -n "$PASSWORD" ]]; then
    echo "${USERNAME}:${PASSWORD}" | chpasswd
  fi

  if [[ "$ADD_SUDO_USER" == "true" ]]; then
    if getent group sudo >/dev/null 2>&1; then
      usermod -aG sudo "$USERNAME"
    elif getent group wheel >/dev/null 2>&1; then
      usermod -aG wheel "$USERNAME"
    fi
  fi
}

configure_firewall() {
  if [[ "$OPEN_FIREWALL" != "true" ]]; then
    return
  fi

  if command -v ufw >/dev/null 2>&1; then
    ufw allow 22/tcp || true
  elif command -v firewall-cmd >/dev/null 2>&1; then
    firewall-cmd --permanent --add-service=ssh || true
    firewall-cmd --reload || true
  fi
}

install_ssh_server
configure_sshd_auth
ensure_user
configure_firewall
ensure_sshd_service

echo "Linux SSH bootstrap complete"
echo "  auth_mode: ${AUTH_MODE}"
echo "  permit_root_login: ${PERMIT_ROOT_LOGIN}"
if [[ -n "$USERNAME" ]]; then
  echo "  user: ${USERNAME}"
fi
echo "  sshd listening:"
ss -ltnp | grep ':22' || true
