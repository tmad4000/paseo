// Fork branding for the desktop build.
//
// electron-builder.yml stays byte-for-byte upstream's so upstream's packaging
// pipeline (the Linux launcher install, /opt/Paseo, Paseo.desktop, the CI smoke
// jobs) keeps working unchanged. The fork's own build (`npm run build` in this
// package) uses this config instead: it loads the upstream file and replaces the
// identity fields. Replacement, not `extends` — electron-builder merges extended
// arrays by union, which would register both paseo:// and paseo-fork:// and ship
// both CLI shims.
const fs = require("node:fs");
const path = require("node:path");
const yaml = require("js-yaml");

const base = yaml.load(fs.readFileSync(path.join(__dirname, "electron-builder.yml"), "utf8"));

const rename = (artifactName) => artifactName.replace(/^Paseo-/, "Paseo-Fork-");
const FORK_SHIM_TARGETS = { "bin/paseo": "bin/paseo-fork", "bin/paseo.cmd": "bin/paseo-fork.cmd" };
const forkShim = (resources) =>
  (resources ?? []).map((entry) => {
    const to = FORK_SHIM_TARGETS[entry.to] ?? entry.to;
    const from = entry.from === "assets/icon.png" ? "assets/icon-fork.png" : entry.from;
    return Object.assign({}, entry, { from, to });
  });

module.exports = {
  ...base,
  appId: "sh.paseo.desktop.fork",
  productName: "Paseo Fork",
  executableName: "Paseo Fork",
  // The fork registers its own scheme so it does not take over paseo:// links
  // from a stock Paseo install sitting next to it.
  protocols: [{ name: "Paseo Fork agent link", schemes: ["paseo-fork"] }],
  publish: { ...base.publish, owner: "tmad4000", repo: "paseo" },
  mac: {
    ...base.mac,
    artifactName: rename(base.mac.artifactName),
    icon: "assets/icon-fork.icns",
    extraResources: forkShim(base.mac.extraResources),
  },
  linux: {
    ...base.linux,
    artifactName: rename(base.linux.artifactName),
    extraResources: forkShim(base.linux.extraResources),
  },
  appImage: { ...base.appImage, artifactName: rename(base.appImage.artifactName) },
  win: {
    ...base.win,
    artifactName: rename(base.win.artifactName),
    extraResources: forkShim(base.win.extraResources),
  },
};
