# Fork icon

`source.svg` is the self-contained artwork source. It preserves the upstream mark and adds a blue fork badge with contrasting rings. Badge color `#294ac4` is the **provisional** Ideaflow accent from index.ideaflow.app, approved by root d3caa262 for this icon task; Jacob can override it. `upstream.png` is the unmodified comparison reference, not a generation input.

Use Python 3.12 with Cairo installed, create an isolated virtual environment, install `requirements.txt`, then run `nice -n 19 python scripts/generate-fork-icons.py`. Pass `--check` to verify all generated outputs and the SHA-256 manifest without writing. No app dependencies change.

The generator writes the existing desktop, mobile and web identity asset paths. macOS exports have an optical inset and rounded tile. iOS uses an opaque full canvas (Expo generates the native Paseo AppIcon set during prebuild); Android adaptive foregrounds place the full mark and badge inside the central safe circle. Status favicons retain their status colors at the opposite corner. The contact sheet compares upstream and actual macOS exports at native 16, 32, 64, 128 and 1024 pixels on light and dark backgrounds.

Linux checks validate generated pixels and containers. They do not establish actual Dock, menu bar or home-screen behavior on Apple devices.
