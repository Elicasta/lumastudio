import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";

if (process.platform !== "darwin") {
  console.error("This developer voice-pack generator uses macOS say + afconvert.");
  process.exit(1);
}

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const voice = option("--voice", "Samantha");
const id = option(
  "--id",
  "dev-en-" + voice.toLowerCase().replace(/[^a-z0-9]+/g, "-")
);
const output = resolve(
  option("--out", join("voice-packs", "generated", id))
);

const tokens = [
  ...[
    "One","Two","Three","Four","Five","Six","Seven","Eight",
    "Nine","Ten","Eleven","Twelve","Thirteen","Fourteen","Fifteen","Sixteen"
  ].map((text, index) => ({
    token: "count." + (index + 1),
    text
  })),
  ...[
    ["intro","Intro"],
    ["verse","Verse"],
    ["prechorus","Pre-Chorus"],
    ["chorus","Chorus"],
    ["refrain","Refrain"],
    ["bridge","Bridge"],
    ["tag","Tag"],
    ["vamp","Vamp"],
    ["turnaround","Turnaround"],
    ["instrumental","Instrumental"],
    ["interlude","Interlude"],
    ["breakdown","Breakdown"],
    ["build","Build"],
    ["drop","Drop"],
    ["solo","Solo"],
    ["outro","Outro"],
    ["ending","Ending"]
  ].map(([name, text]) => ({
    token: "section." + name,
    text
  })),
  ...[
    ["hold","Hold"],
    ["stop","Stop"],
    ["repeat","Repeat"],
    ["again","Again"],
    ["last-time","Last time"],
    ["one-more","One more"],
    ["two-more","Two more"],
    ["build","Build"],
    ["down","Down"],
    ["big","Big"],
    ["soft","Soft"]
  ].map(([name, text]) => ({
    token: "direction." + name,
    text
  }))
];

mkdirSync(output, { recursive: true });

for (const item of tokens) {
  const aiff = join(output, item.token + ".aiff");
  const wav = join(output, item.token + ".wav");

  process.stdout.write("Recording " + item.token + " ... ");
  execFileSync("say", ["-v", voice, "-o", aiff, item.text], {
    stdio: "ignore"
  });
  execFileSync(
    "afconvert",
    ["-f", "WAVE", "-d", "LEI24@48000", "-c", "1", aiff, wav],
    { stdio: "ignore" }
  );
  rmSync(aiff, { force: true });
  console.log("done");
}

const manifest = {
  id,
  name: "Development English · " + voice,
  locale: "en-US",
  voice,
  version: 1,
  sampleRate: 48000,
  channels: 1,
  assets: tokens.map(({ token }) => ({
    token,
    file: token + ".wav",
    onsetMs: 0,
    gainDb: 0
  }))
};

writeFileSync(
  join(output, "manifest.json"),
  JSON.stringify(manifest, null, 2) + "\n"
);

console.log("\nCreated " + tokens.length + "-token voice pack:");
console.log(output);
console.log("\nIn LumaRig Studio open Devices → Guide Voice → Load Voice Pack.");
console.log("This generated pack is for local development/testing; do not treat it as the polished bundled voice.");
