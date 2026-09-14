#!/usr/bin/env bash
set -euo pipefail
# Disposable Debian/Ubuntu orb prerequisites; no accounts or native package edits.
sudo -n apt-get update -qq
sudo -n apt-get install -y -qq xvfb openbox dbus-x11 gir1.2-gtk-3.0 python3-gi at-spi2-core xdotool x11-utils
