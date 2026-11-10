// Writes a WAV of a synthetic singer (Happy Birthday, +2 semitones, looped by Chrome)
import { writeFileSync, readFileSync } from "node:fs";
import { singMelody } from "./synth.mjs";
const songs = JSON.parse(readFileSync(new URL("../public/songs.json", import.meta.url)));
const hb = songs.songs.find((s) => s.id === "happy_birthday").reference.template;
const sr = +(process.env.FAKE_SR || 44100), x = singMelody(hb, { sr, offset: 2, bpm: 110, noise: 0.003 });
const buf = Buffer.alloc(44 + x.length * 2);
buf.write("RIFF", 0); buf.writeUInt32LE(36 + x.length * 2, 4); buf.write("WAVE", 8); buf.write("fmt ", 12);
buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(sr, 24);
buf.writeUInt32LE(sr * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write("data", 36); buf.writeUInt32LE(x.length * 2, 40);
for (let i = 0; i < x.length; i++) buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, x[i])) * 32767), 44 + i * 2);
writeFileSync(process.argv[2], buf);
console.log("wrote", process.argv[2], (x.length / sr).toFixed(1) + " s");
