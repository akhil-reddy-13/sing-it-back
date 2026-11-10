"""Generate a SYNTHETIC dataset in the exact format the app uploads, to test the
analysis pipeline end to end before any real data exist. Never report these numbers.

    python3 analysis/simulate.py --n 120 --out data/synthetic
    python3 analysis/analyze.py data/synthetic/events.ndjson --songs data/synthetic/songs.json --out data/synthetic/report

Ground truth built in (so you can check the pipeline recovers it):
  * 60% of people "remember" keys: deviation ~ Normal(0, 0.9 st); others sing in a random key
  * memory does NOT depend on language (the model's prediction)
  * naming: 30% of early tone-language speakers and 5% of others have absolute pitch
"""
import argparse, json, pathlib, uuid, copy
import numpy as np

ROOT = pathlib.Path(__file__).resolve().parents[1]
SCALE = {"major": [0, 2, 4, 5, 7, 9, 11], "minor": [0, 2, 3, 5, 7, 8, 10]}


def synth_template(rng, tonic_pc, mode):
    """A random singable chorus-like melody in the given key (stand-in for a verified template)."""
    deg, notes = 0, []
    for k in range(24):
        deg = int(np.clip(deg + rng.choice([-2, -1, -1, 0, 1, 1, 2]), -3, 8))
        if k in (0, 23): deg = 0
        octv, d = divmod(deg, 7)
        notes.append({"midi": int(60 + tonic_pc + 12 * octv + SCALE[mode][d]), "beats": float(rng.choice([0.5, 1, 1, 2]))})
    return notes


def track_from_notes(rng, notes, offset, bpm=100, octave=0):
    hop = 0.01
    f0, ap, rms = [], [], []
    for _ in range(int(0.4 / hop)): f0.append(0); ap.append(0.9); rms.append(0.0005)
    for n in notes:
        dur = n["beats"] * 60 / bpm
        err = rng.normal(0, 0.15)
        for i in range(int(dur / hop)):
            t = i * hop
            m = n["midi"] + offset + 12 * octave + err + 0.25 * np.sin(2 * np.pi * 5.5 * t) - 0.7 * np.exp(-t / 0.05)
            f0.append(round(440 * 2 ** ((m - 69) / 12), 1)); ap.append(0.05); rms.append(0.08)
        for _ in range(4): f0.append(0); ap.append(0.9); rms.append(0.0005)
    return {"sr": 16000, "hop": 160, "f0": f0, "ap": ap, "rms": rms}


def main():
    a = argparse.ArgumentParser(); a.add_argument("--n", type=int, default=120); a.add_argument("--out", default=str(ROOT / "data" / "synthetic")); a.add_argument("--seed", type=int, default=7)
    args = a.parse_args()
    rng = np.random.default_rng(args.seed)
    out = pathlib.Path(args.out); out.mkdir(parents=True, exist_ok=True)
    songs = copy.deepcopy(json.loads((ROOT / "public" / "songs.json").read_text()))
    import sys; sys.path.insert(0, str(ROOT / "analysis")); import pitchlib as P
    for s in songs["songs"]:
        if s["role"] == "target":
            s["reference"]["template"] = synth_template(rng, int(P.parse_pc(s["reference"]["tonic"])), s["reference"]["mode"])
            s["reference"]["verified"] = True
    songs["version"] = "synthetic"
    (out / "songs.json").write_text(json.dumps(songs, indent=1))
    targets = [s for s in songs["songs"] if s["role"] == "target"]
    hb = songs["songs"][0]
    with (out / "events.ndjson").open("w") as f:
        for p in range(args.n):
            sid, seq = str(uuid.UUID(int=int(rng.integers(0, 2**63)) << 64 | p, version=4)), 0
            def emit(kind, payload):
                nonlocal seq
                f.write(json.dumps({"session_id": sid, "kind": kind, "seq": seq, "app_version": "sim", "study_mode": "synthetic", "payload": payload}) + "\n"); seq += 1
            tone = rng.random() < 0.4
            remembers = rng.random() < 0.6
            has_ap = rng.random() < (0.30 if tone else 0.05)
            octave = -1 if rng.random() < 0.5 else 0
            emit("session_start", {"synthetic": True, "mode": "synthetic", "songs_version": "synthetic", "consent": {"agree": True}})
            emit("mic_check", {"snr_db": 30, "ok": True})
            known = rng.choice(len(targets), size=int(rng.integers(2, 6)), replace=False)
            emit("familiarity", {"ratings": [{"song_id": s["id"], "familiarity": 5 if i in known else 2, "heard_as": "original" if i in known else None, "performed": False} for i, s in enumerate(targets)]})
            plan = [targets[i] for i in known] + [hb, targets[known[0]]]
            roles = ["target"] * len(known) + ["control", "retest"]
            for ti, (s, role) in enumerate(zip(plan, roles)):
                if role == "control": off = rng.uniform(-6, 6)
                elif remembers: off = rng.normal(0, 0.9)
                else: off = rng.uniform(-6, 6)
                if role == "retest" and remembers: off = rng.normal(0, 0.9)
                notes = s["reference"]["template"]
                start = int(rng.integers(0, len(notes) // 3)); seg = notes[start:] + notes[: rng.integers(0, 6)]
                emit("trial", {"trial_id": f"{ti}_1", "trial_index": ti, "attempt": 1, "song_id": s["id"], "role": role, "reference_verified": True,
                               "rec_sec": 15, "input_sr": 48000, "noise_rms": 0.001, "confidence": int(rng.integers(1, 6)) if role != "control" else None,
                               "flags": [], "scores": {}, "track": track_from_notes(rng, seg, off, bpm=rng.uniform(80, 130), octave=octave)})
            seqn = rng.permutation(np.tile(np.arange(12), 2))
            trials = []
            for k, pc in enumerate(seqn):
                if has_ap: resp = pc if rng.random() < 0.9 else (pc + rng.choice([-1, 1])) % 12
                else: resp = int(rng.integers(0, 12))
                err = int(((resp - pc) % 12 + 6) % 12 - 6)
                trials.append({"k": k, "midi": int(60 + pc), "target_pc": int(pc), "response_pc": int(resp), "error": err, "rt_ms": 1500})
            emit("naming", {"skipped": False, "trials": trials})
            lang = [{"name": "Mandarin", "age_started": 0, "fluency": 5}, {"name": "English", "age_started": 5, "fluency": 5}] if tone else [{"name": "English", "age_started": 0, "fluency": 5}]
            emit("questionnaire", {"languages": lang, "lessons": "yes" if rng.random() < 0.6 else "no", "lesson_age": int(rng.integers(4, 12)), "solfege": str(rng.choice(["fixed", "movable", "none", "unsure"])),
                                   "ap_self": "yes" if has_ap else "no", "age": int(rng.integers(18, 30)), "hearing": "no", "heard_music": "no"})
            emit("complete", {})
    print(f"wrote {args.n} synthetic sessions to {out}")


if __name__ == "__main__":
    main()
