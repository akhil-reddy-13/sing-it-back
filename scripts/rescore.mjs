// Re-score stored sessions with the current songs.json. Usage: node scripts/rescore.mjs events.ndjson
import { readFileSync } from "node:fs";
import { scoreTrial, unpackTrack, scoreTemplate, cleanMidi } from "../public/js/pitch.js";
const songs = JSON.parse(readFileSync(new URL("../public/songs.json", import.meta.url))).songs;
const byId = Object.fromEntries(songs.map((s) => [s.id, s]));
for (const line of readFileSync(process.argv[2], "utf8").split("\n").filter(Boolean)) {
  const e = JSON.parse(line);
  if (e.kind !== "trial") continue;
  const t = e.payload, song = byId[t.song_id];
  if (!song) { console.log(t.song_id, "— no longer in songs.json"); continue; }
  const tr = unpackTrack(t.track);
  const sc = scoreTrial(tr, song, { noiseRms: t.noise_rms });
  const old = t.scores.primary;
  // how specific is the fit? score this take against every other song's template too
  const m = cleanMidi(tr, { noiseRms: t.noise_rms });
  const others = songs.filter((s) => s.id !== song.id && s.reference?.template).map((s) => ({ id: s.id, cost: scoreTemplate(m, s.reference.template)?.cost ?? 9 })).sort((a, b) => a.cost - b.cost);
  console.log(`${t.song_id.padEnd(26)} old ${old.method}:${old.deviation.toFixed(1).padStart(5)}  →  template ${sc.template ? sc.template.deviation.toFixed(2).padStart(6) : "  –  "}  cost ${sc.template?.cost.toFixed(3)}  ambiguity ${sc.template?.ambiguity.toFixed(2)}  | best other song: ${others[0].id} ${others[0].cost.toFixed(3)}`);
}
