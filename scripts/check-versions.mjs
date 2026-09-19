import fs from "node:fs";

const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
const tauri = JSON.parse(fs.readFileSync("src-tauri/tauri.conf.json", "utf8"));
const cargo = fs.readFileSync("src-tauri/Cargo.toml", "utf8");

const cargoVersion = cargo.match(/^version\s*=\s*"([^"]+)"/m)?.[1];

const versions = {
  package: pkg.version,
  tauri: tauri.version,
  cargo: cargoVersion
};

const unique = new Set(Object.values(versions));

if (unique.size !== 1 || [...unique].includes(undefined)) {
  console.error("Version mismatch:", versions);
  process.exit(1);
}

console.log("Version sync OK:", pkg.version);
