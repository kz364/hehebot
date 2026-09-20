#!/usr/bin/env bash
set -euo pipefail

# Disposable credential-free launch boundary. All root-owned paths are in a
# private tmpfs root/mount namespace; never create /.sprite or /etc/codex on
# the host. Network namespace has loopback only. The actual fixture runs as the
# original non-root user, not as the namespace setup helper.
if [[ "${1:-}" != --inside ]]; then
  ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  [[ $(id -u) != 0 ]] || { echo 'Run as a non-root fixture owner' >&2; exit 1; }
  BASE=$(mktemp -d "$ROOT/.local/launcher-boundary-XXXXXX")
  NODE=$(command -v node)
  HOST_MNT=$(readlink /proc/self/ns/mnt)
  HOST_NET=$(readlink /proc/self/ns/net)
  trap 'rmdir "$BASE/root" 2>/dev/null || true' EXIT
  sudo -n unshare --mount --net --propagation private bash "$ROOT/scripts/test-codex-launcher-boundary.sh" \
    --inside "$ROOT" "$BASE" "$(id -u)" "$(id -g)" "$NODE" "$HOST_MNT" "$HOST_NET" "${1:-}"
  exit
fi

shift
ROOT=$1 BASE=$2 UID_OWNER=$3 GID_OWNER=$4 NODE=$5 HOST_MNT=$6 HOST_NET=$7 MODE=$8
[[ $(id -u) == 0 && "$UID_OWNER" != 0 && $(readlink /proc/self/ns/mnt) != "$HOST_MNT" && $(readlink /proc/self/ns/net) != "$HOST_NET" ]]
[[ "$BASE" == "$ROOT"/.local/launcher-boundary-* && ! -L "$BASE" ]]
mkdir "$BASE/root"
mount -t tmpfs -o mode=755,nosuid,nodev tmpfs "$BASE/root"
R=$BASE/root
mkdir -p "$R"/{usr,dev,proc,tmp,etc/ssl,etc/codex,.sprite} "$R$ROOT"
for path in /usr /dev /proc; do
  mount --rbind "$path" "$R$path"
  mount --make-rslave "$R$path"
done
for path in /bin /sbin /lib /lib64; do
  if [[ -L "$path" ]]; then ln -s "$(readlink "$path")" "$R$path";
  elif [[ -d "$path" ]]; then mkdir "$R$path"; mount --bind "$path" "$R$path"; fi
done
# Only explicit non-secret OS lookup/crypto configuration; no home, auth cache,
# environment, /etc private keys or credential files are copied into the root.
for path in /etc/passwd /etc/group /etc/nsswitch.conf /etc/hosts /etc/ld.so.cache /etc/ssl/openssl.cnf; do
  [[ -f "$path" ]] || continue
  touch "$R$path"
  mount --bind "$path" "$R$path"
  mount -o remount,bind,ro "$R$path"
done
mkdir "$R/etc/ssl/certs"
mount --bind /etc/ssl/certs "$R/etc/ssl/certs"
mount -o remount,bind,ro "$R/etc/ssl/certs"
mount --bind "$ROOT" "$R$ROOT"
chmod 1777 "$R/tmp"
printf 'allow_remote_control = false\n\n[features]\nmemories = false\n' > "$R/etc/codex/requirements.toml"
: > "$R/etc/codex/config.toml"
chmod 644 "$R/etc/codex/"*.toml
chown "$UID_OWNER:$GID_OWNER" "$R/.sprite"
chmod 700 "$R/.sprite"
ip link set lo up
# A mere chroot makes Linux refuse nested user namespaces, preventing the real
# native filesystem sandbox from starting. Pivot the private mount root instead;
# no kernel setting or sandbox/capability requirement is changed.
mkdir "$R/.oldroot"
cd "$R"
pivot_root . .oldroot
cd /
umount -l /.oldroot
rmdir /.oldroot
exec setpriv --reuid="$UID_OWNER" --regid="$GID_OWNER" --clear-groups /usr/bin/env -i \
  PATH=/usr/local/bin:/usr/bin:/bin LANG=C.UTF-8 HOME=/home/user WRANGLER_SEND_METRICS=false \
  "$NODE" "$ROOT/scripts/test-codex-launcher-boundary.mjs" "$ROOT" "$BASE" "$HOST_MNT" "$HOST_NET" "$MODE"
