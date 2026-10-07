#!/usr/bin/env bash
set -euo pipefail

# Diagnose gVisor's rootless systemd D-Bus failure without changing the
# system/rootful Docker daemon or disabling cgroup resource enforcement.
if [[ $(id -u) -ne 0 || $# -ne 1 || ! $1 =~ ^sha256:[a-f0-9]{64}$ ]]; then
  echo 'Usage: sudo bash deployment/probe-runsc-fs-rootless.sh sha256:<sandbox-image-id>' >&2
  exit 2
fi

broker_home=$(getent passwd mypi-broker | cut -d: -f6)
broker_uid=$(id -u mypi-broker)
config="$broker_home/.config/docker/daemon.json"
if [[ $broker_home != /home/mypi-broker || $broker_uid != 1004 || ! -f $config ]]; then
  echo 'Unexpected Broker account or Docker configuration; refusing to modify it' >&2
  exit 1
fi
backup=$(mktemp "$broker_home/.config/docker/daemon.json.probe.XXXXXX")
cp -a "$config" "$backup"
chmod 600 "$backup"
wrapper=/opt/mypi-runsc/runsc-fs-probe
if [[ -e $wrapper ]]; then
  rm -f "$backup"
  echo 'Probe runtime wrapper already exists; refusing to replace it' >&2
  exit 1
fi
restore() {
  local status=0
  mv -f "$backup" "$config" || status=1
  runuser -u mypi-broker -- env \
    "XDG_RUNTIME_DIR=/run/user/$broker_uid" \
    "DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/$broker_uid/bus" \
    systemctl --user restart docker || status=1
  rm -f "$wrapper" || status=1
  return "$status"
}
trap restore EXIT

# The daemon.json runtimeArgs override did not change the observed behavior.
# This probe strips the systemd cgroup flag from runsc's final argv while
# only that flag while retaining the OCI resource spec and all hard limits.
cat > "$wrapper" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
args=()
for arg in "$@"; do
  case "$arg" in
    --systemd-cgroup|--systemd-cgroup=true|--systemd-cgroup=false|-systemd-cgroup|-systemd-cgroup=true|-systemd-cgroup=false)
      ;;
    *) args+=("$arg") ;;
  esac
done
exec /opt/mypi-runsc/runsc --systemd-cgroup=false "${args[@]}"
SH
chown root:root "$wrapper"
chmod 755 "$wrapper"

python3 - "$config" <<'PY'
import json
import os
import pathlib
import pwd
import sys

target = pathlib.Path(sys.argv[1])
settings = json.loads(target.read_text())
runtimes = settings.get('runtimes', {})
if runtimes.get('runsc') != {'path': '/opt/mypi-runsc/runsc'}:
    raise SystemExit('Unexpected runsc definition; refusing to change it')
if 'runsc-fs-probe' in runtimes:
    raise SystemExit('Probe runtime already exists; refusing to replace it')
runtimes['runsc-fs-probe'] = {
    'path': '/opt/mypi-runsc/runsc-fs-probe',
}
candidate = target.with_suffix('.json.probe-new')
candidate.write_text(json.dumps(settings, indent=2) + '\n')
os.chmod(candidate, 0o600)
account = pwd.getpwnam('mypi-broker')
os.chown(candidate, account.pw_uid, account.pw_gid)
candidate.replace(target)
PY

runuser -u mypi-broker -- env \
  "XDG_RUNTIME_DIR=/run/user/$broker_uid" \
  "DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/$broker_uid/bus" \
  systemctl --user restart docker

runuser -u mypi-broker -- env \
  "XDG_RUNTIME_DIR=/run/user/$broker_uid" \
  "DOCKER_HOST=unix:///run/user/$broker_uid/docker.sock" \
  docker run --rm --pull=never --runtime=runsc-fs-probe --network=none \
  --cpus=0.5 --memory=512m --memory-swap=512m --pids-limit=64 \
  "$1" node -e 'console.log("runsc-fs-probe-ok")'
