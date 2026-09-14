"""Synthetic GTK target and sentinel; no network, subprocesses, or personal files."""
import json
import os
import sys
import gi
gi.require_version('Gtk', '3.0')
from gi.repository import Gtk, GLib

directory = sys.argv[1]
target = Gtk.Window(title='OpenClaw CUA X11 Target')
target.set_default_size(520, 220)
target.move(70, 80)
box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=20)
box.set_border_width(24)
box.pack_start(Gtk.Label(label='Synthetic local fixture — no account or external effects'), False, False, 0)
entry = Gtk.Entry()
entry.get_accessible().set_name('Proof text')
entry.set_text('INITIAL LOCAL FIXTURE')
box.pack_start(entry, False, False, 0)
target.add(box)

def record(*_):
    path = os.path.join(directory, 'fixture-state.json')
    with open(path, 'w') as output:
        json.dump({'text': entry.get_text()}, output)
    os.chmod(path, 0o600)

entry.connect('changed', record)
record()
target.connect('destroy', Gtk.main_quit)
target.show_all()
sentinel = Gtk.Window(title='OpenClaw CUA X11 Sentinel')
sentinel.set_default_size(440, 220)
sentinel.move(730, 80)
sentinel.add(Gtk.Label(label='Sentinel window: background input must not steal focus.'))
sentinel.show_all()
GLib.timeout_add(500, lambda: (sentinel.present(), False)[1])
Gtk.main()
