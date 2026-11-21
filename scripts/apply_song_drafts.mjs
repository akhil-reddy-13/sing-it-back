// One-off: write the researched draft references (docs/SONG_REFERENCES_DRAFT.md) into public/songs.json.
// All stay verified=false until checked against the recordings (PROTOCOL §5.3).
import { readFileSync, writeFileSync } from "node:fs";
import { parseTemplate } from "../public/js/pitch.js";
const path = new URL("../public/songs.json", import.meta.url);
const sj = JSON.parse(readFileSync(path));
const CHORUS = "Sing the chorus, the part with the title in it.";
const D = {
  rolling_in_the_deep: { tonic: "C", mode: "minor", t: "G4:0.5 Bb4:0.5 G4:0.5 Bb4:0.5 G4:0.5 Bb4:0.5 C5:0.5 Bb4:1 Bb4:0.5 G4:0.5 Bb4:0.5 G4:0.5 Bb4:0.5 C5:0.5 D5:0.5 Bb4:1.5", conf: "medium" },
  someone_like_you: { tonic: "A", mode: "major", t: "A4:0.5 A4:0.5 A4:1 G#4:1 G#4:0.5 F#4:1 F#4:0.5 G#4:0.5 G#4:0.5 A4:0.5 F#4:2", conf: "medium" },
  shape_of_you: { tonic: "C#", mode: "minor", t: "E4 F#4 G#4 F#4 E4 E4 F#4 F#4 E4 E4 F#4 G#4 F#4 E4 E4:0.5 F#4:0.5 C#4:2", conf: "medium" },
  blinding_lights: { tonic: "C", mode: "minor", t: "F4:0.5 G4:1 F4:1 Eb4:0.5 Eb4:1 C4:0.5 Eb4:1.5 C4:2 Eb4:1.5 Bb4:0.5 G4:1 F4:1 Eb4:1.5 Bb4:0.5 G4:1 F4:1 Eb4:2.5", conf: "medium-low", alt: ["a sped-up version"] },
  anti_hero: { tonic: "E", mode: "major", t: "E4 G#4 G#4 F#4 F#4 F#4 E4 E4 E4 E4 G#4 G#4 F#4 F#4 F#4 E4 E4 E4", conf: "medium", alt: ["a sped-up version"] },
  drivers_license: { tonic: "Bb", mode: "major", t: "F4 G4 G4 G4 G4 A4 A4 A4 A4 Bb4 Bb4 Bb4 Bb4 D5:0.5 C5:0.5 Bb4 G4 F4:2", conf: "medium", prompt: "Sing the chorus, the big part where her voice climbs up." },
  all_i_want_for_christmas: { tonic: "G", mode: "major", t: "D4 E4 G4 D5 C5:2 B4 A4 G4 E4 Eb4 A4 B4 A4:0.5 G4:2.5", conf: "medium-high", alt: ["the Justin Bieber duet"], prompt: "Sing the end of the chorus, the line with the title." },
  dont_stop_believin: { tonic: "E", mode: "major", t: "A4:0.5 G#4:0.5 G#4 F#4:0.5 A4:0.5 G#4:2 A4 G#4 A4 B4 C#5:0.5 B4:0.5 G#4:0.5 F#4:0.5 E4:2", conf: "medium-low", alt: ["the Glee version"] },
  someone_you_loved: { tonic: "Db", mode: "major", t: "Db4:0.5 Db4:0.5 Gb4:0.5 F4:0.5 Db4:0.5 Db4:0.5 Gb4:0.5 F4:0.5 Db4:0.5 Db4:0.5 Gb4:0.5 F4:0.5 Eb4:0.5 Db4:0.5 Db4:0.5 Db4:0.5 Ab4:0.5 Ab4:0.5 F4:1 Db4:0.5 Db4:0.5 Db4:0.5 Gb4:0.5 Gb4:0.5 F4:0.5 Eb4:1 F4:0.5 F4:0.5 F4:0.5 F4:0.5 F4:0.5 F4:0.5 F4:0.5 Eb4:0.5 Eb4:0.5 Db4:0.5 Db4:0.5 Eb4:0.5 Eb4:0.5 Eb4:1 Db4:2", conf: "medium", prompt: "Sing the chorus, from the start through the title line." },
  let_it_go: { tonic: "Ab", mode: "major", t: "F4:0.5 G4:0.5 Ab4:2 Eb4:0.5 Eb4:0.5 Bb4:2 Ab4:1 F4:0.5 F4:0.5 F4:0.5 F4:0.5 G4:0.5 Ab4:2 F4:0.5 G4:0.5 Ab4:2 Eb4:0.5 C5:0.5 C5:1 Bb4:1.5", conf: "high (pitch)", alt: ["Demi Lovato's version"] },
  never_gonna_give_you_up: { tonic: "Db", mode: "major", t: "Ab3:0.25 Bb3:0.25 Db4:0.25 Bb3:0.25 F4:0.75 F4:0.75 Eb4:1.5 Ab3:0.25 Bb3:0.25 Db4:0.25 Bb3:0.25 Eb4:0.75 Eb4:0.75 Db4:0.75 C4:0.25 Bb3:1", conf: "high (pitch)" },
  flowers: { tonic: "A", mode: "minor", t: "E4:0.5 E4:0.5 E4:0.5 D4:0.5 C4:1 E4:0.5 F4:1.5 D4:0.5 D4:0.5 D4:0.5 C4:0.5 A3:0.5 E4:0.5 D4:0.5 E4:1.5", conf: "medium", alt: ["a sped-up version"] },
  levitating: { tonic: "B", mode: "minor", t: "D4:0.5 D4:0.5 F#4:1 E4:0.5 E4:0.5 E4:0.5 E4:0.5 E4:0.5 E4:1 D4:0.5 D4:0.5 F#4:1 E4:0.5 E4:0.5 E4:0.5 E4:0.5 E4:0.5 D4:0.5 B3:1 F#4:0.5 E4:0.5 D4:0.5 B3:0.5 A3:2", conf: "medium" },
};
// Dropped for now (see docs/SONG_REFERENCES_DRAFT.md): bad_guy and uptown_funk (no sung interval hook),
// last_christmas and billie_jean (recording tuning off A440; measure from audio first).
const DROP = new Set(["bad_guy", "uptown_funk", "last_christmas", "billie_jean"]);
sj.songs = sj.songs.filter((s) => !DROP.has(s.id)).map((s) => {
  const d = D[s.id];
  if (!d) return s;
  const template = parseTemplate(d.t);
  if (template.some((n) => !Number.isFinite(n.midi))) throw new Error("bad note in " + s.id);
  return {
    ...s, prompt: d.prompt || CHORUS, alt_versions: d.alt || [],
    reference: { tonic: d.tonic, mode: d.mode, tuning_cents: 0, anchor_note: null, template, verified: false,
      source: `draft from published key (Musicnotes + Hooktheory) and letter-note transcriptions; melody confidence ${d.conf}. Verify against the recording.` },
  };
});
sj.version = "0.2.0-draft";
sj.updated = "2026-11-20";
writeFileSync(path, JSON.stringify(sj, null, 1) + "\n");
console.log(sj.songs.map((s) => `${s.id}: ${s.reference.tonic} ${s.reference.mode}, ${s.reference.template?.length ?? 0} notes`).join("\n"));
