#!/usr/bin/env bash
set -euo pipefail

# Installs one pinned gVisor release for MyPI's separate rootless Docker user.
# Does not change /etc/docker/daemon.json or restart the system Docker daemon.
if [[ $(id -u) -ne 0 ]]; then
  echo 'Run this script with sudo.' >&2
  exit 1
fi
if [[ $# -ne 1 || ! -f $1 ]]; then
  echo 'Usage: sudo bash deployment/install-runsc-rootless.sh /path/to/gvisor.tar.zstd' >&2
  exit 1
fi
if ! id mypi-broker >/dev/null 2>&1; then
  echo 'Create the dedicated mypi-broker account first.' >&2
  exit 1
fi

archive=$1
expected_archive='4ce35ca83aef7f96b06cde668e0b23aa98b05aa1829508e974196c2a1e02786c95f5bf79315fd7ddcfd88fe7a00f083ed8053e25eff7673d28d5256440caae8b'
expected_runsc='88a87d5d6d06160d4c144f51f95ec6dd6fe0fc6b02697eb877876683c5b57a91'
printf '%s  %s\n' "$expected_archive" "$archive" | sha512sum -c -

runtime_dir=/opt/mypi-runsc
if [[ -e $runtime_dir/runsc ]]; then
  printf '%s  %s\n' "$expected_runsc" "$runtime_dir/runsc" | sha256sum -c -
else
  install -d -o root -g root -m 755 "$runtime_dir"
  tar --zstd -xf "$archive" -C "$runtime_dir"
  chown -R root:root "$runtime_dir"
  chmod -R go-w "$runtime_dir"
  printf '%s  %s\n' "$expected_runsc" "$runtime_dir/runsc" | sha256sum -c -
fi

broker_home=$(getent passwd mypi-broker | cut -d: -f6)
broker_uid=$(id -u mypi-broker)
install -d -o mypi-broker -g mypi-broker -m 700 "$broker_home/.config/docker"
python3 - "$broker_home/.config/docker/daemon.json" <<'PY'
import json
import os
import pathlib
import pwd
import sys

target = pathlib.Path(sys.argv[1])
settings = json.loads(target.read_text()) if target.exists() else {}
runtimes = settings.setdefault('runtimes', {})
expected = {'path': '/opt/mypi-runsc/runsc'}
if 'runsc' in runtimes and runtimes['runsc'] != expected:
    raise SystemExit('Existing runsc runtime differs; refusing to replace it')
runtimes['runsc'] = expected
candidate = target.with_suffix('.json.new')
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
  "DOCKER_HOST=unix:///run/user/$broker_uid/docker.sock" \
  docker info --format 'Security={{json .SecurityOptions}} Cgroup={{.CgroupVersion}}/{{.CgroupDriver}} Runtimes={{json .Runtimes}}'
