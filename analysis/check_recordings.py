"""Check each song's reference (key, tuning, chorus template) against the actual recording.

Uses the public 30-second previews from the iTunes Search API and the Deezer API
(two sources, because they often cut different 30 s of the track). Audio is cached in
analysis/out/previews/ (git-ignored) and never committed.

For every song it measures:
  * recording tuning in cents vs A440, three ways (librosa.estimate_tuning on the
    harmonic mix; magnitude-weighted circular mean of spectral peaks in the bass band
    and in the mid band). Agreement across methods and sources is the check.
  * the template fit: vocals are separated (REPET-SIM), pitch-tracked with pYIN, and
    scored with pitchlib.score_trial exactly like a participant's take. If the preview
    contains the templated phrase, a correct template + key gives deviation ~ 0 with a
    low cost. A preview without the chorus gives a high cost and says nothing.

    pip install librosa soundfile   (plus ffmpeg on PATH)
    python analysis/check_recordings.py [song_id ...] [--write]

--write stores the result in songs.json as reference.audio_check.
"""
import json, os, subprocess, sys, urllib.parse, urllib.request
from datetime import date
import numpy as np
import librosa
import scipy.signal as sg

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import pitchlib as P  # noqa: E402

SONGS = os.path.join(HERE, "..", "public", "songs.json")
CACHE = os.path.join(HERE, "out", "previews")
# Songs that are held back from the live list but worth measuring.
EXTRA = {
    "bad_guy": ("Billie Eilish", "bad guy"),
    "uptown_funk": ("Mark Ronson", "Uptown Funk"),
    "last_christmas": ("Wham!", "Last Christmas"),
    "billie_jean": ("Michael Jackson", "Billie Jean"),
    "never_gonna_give_you_up": ("Rick Astley", "Never Gonna Give You Up"),
}
BAD_WORDS = ("remix", "mix)", "live", "sped", "instrumental", "karaoke", "acoustic", "tribute", "cover", "pianoforte")
COST_OK = 0.7  # looser than the live COST_MAX: pitch tracking a full mix is noisier than a solo voice


def _get(url):
    return json.load(urllib.request.urlopen(url, timeout=20))


def _clean(title):
    return not any(w in title.lower() for w in BAD_WORDS)


def _save(url, base):
    raw, wav = base + ".src", base + ".wav"
    subprocess.run(["curl", "-sL", url, "-o", raw], check=True)
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", raw, "-ac", "1", "-ar", "22050", wav], check=True)
    os.remove(raw)
    return wav


def fetch(sid, artist, title):
    """Return {source: (wav_path, label)} for the original studio recording."""
    os.makedirs(CACHE, exist_ok=True)
    got = {}
    for src in ("itunes", "deezer"):
        base = os.path.join(CACHE, f"{src}_{sid}")
        if os.path.exists(base + ".wav"):
            got[src] = (base + ".wav", open(base + ".txt").read())
            continue
        try:
            if src == "itunes":
                r = _get("https://itunes.apple.com/search?" + urllib.parse.urlencode(
                    {"term": f"{artist} {title}", "entity": "song", "limit": 10, "country": "US"}))["results"]
                r = [x for x in r if x["artistName"].lower().startswith(artist.lower()) and _clean(x["trackName"])]
                if not r:
                    continue
                x = r[0]
                label, url = f'{x["trackName"]} | {x["artistName"]} | {x.get("collectionName")}', x["previewUrl"]
            else:
                r = _get("https://api.deezer.com/search?" + urllib.parse.urlencode({"q": f"{artist} {title}"}))["data"]
                r = [x for x in r if x["artist"]["name"].lower() == artist.lower() and _clean(x["title"])]
                if not r:
                    continue
                x = r[0]
                label, url = f'{x["title"]} | {x["artist"]["name"]} | {x["album"]["title"]}', x["preview"]
        except Exception as e:  # network or API hiccup: just skip this source
            print(f"  {src}: {e}", file=sys.stderr)
            continue
        wav = _save(url, base)
        open(base + ".txt", "w").write(label)
        got[src] = (wav, label)
    return got


def _peak_tuning(y, sr, fmin, fmax):
    p, mag = librosa.piptrack(y=y, sr=sr, fmin=fmin, fmax=fmax, threshold=0.1)
    sel = p > 0
    f, w = p[sel], mag[sel]
    keep = w >= np.quantile(w, 0.75)
    c = (1200 * np.log2(f[keep] / 440)) % 100
    return float(np.angle(np.sum(w[keep] * np.exp(2j * np.pi * c / 100))) * 100 / (2 * np.pi))


def tuning(y, sr):
    yh = librosa.effects.harmonic(y)
    bass = sg.sosfiltfilt(sg.butter(6, 300, "low", fs=sr, output="sos"), yh)
    return {
        "estimate_tuning": round(float(librosa.estimate_tuning(y=yh, sr=sr)) * 100),  # 12 bins/oct: cents vs A440
        "bass_peaks": round(_peak_tuning(bass, sr, 35, 300)),
        "mid_peaks": round(_peak_tuning(yh, sr, 150, 2000)),
    }


def vocal_track(y, sr):
    S_full, phase = librosa.magphase(librosa.stft(y))
    S_filter = np.minimum(S_full, librosa.decompose.nn_filter(
        S_full, aggregate=np.median, metric="cosine", width=int(librosa.time_to_frames(2, sr=sr))))
    mask = librosa.util.softmask(S_full - S_filter, 10 * S_filter, power=2)
    yv = librosa.resample(librosa.istft(mask * S_full * phase), orig_sr=sr, target_sr=16000)
    f0, voiced, _ = librosa.pyin(yv, fmin=80, fmax=1000, sr=16000, frame_length=1024, hop_length=160)
    rms = librosa.feature.rms(y=yv, frame_length=1024, hop_length=160)[0][: len(f0)]
    return {"f0": np.nan_to_num(f0).tolist(), "ap": np.where(voiced, 0.05, 1.0).tolist(),
            "rms": (rms / (rms.max() + 1e-9) * 0.2).tolist(), "sr": 16000, "hop": 160}


def check(song, others, got):
    out = {"date": date.today().isoformat(), "sources": {}}
    for src, (wav, label) in got.items():
        y, sr = librosa.load(wav, sr=22050)
        r = {"track": label, "tuning_cents": tuning(y, sr)}
        if song.get("reference", {}).get("template"):
            o = P.score_trial(vocal_track(y, sr), song, others=others)
            t = o["template"] or {}
            r["template"] = {"deviation": t.get("deviation"), "cost": t.get("cost"), "ambiguity": t.get("ambiguity"),
                             "margin": (o.get("specificity") or {}).get("margin")}
        out["sources"][src] = r
    tun = [v for r in out["sources"].values() for v in r["tuning_cents"].values()]
    out["tuning_cents_median"] = int(np.median(tun)) if tun else None
    out["tuning_cents_spread"] = int(max(tun) - min(tun)) if tun else None
    fits = [r["template"] for r in out["sources"].values() if r.get("template")]
    good = [f for f in fits if f["cost"] is not None and f["cost"] <= COST_OK]
    if not fits:
        out["template_status"] = "no_template"
    elif good and all(abs(f["deviation"]) <= 0.5 for f in good):
        out["template_status"] = "matches_recording"
    elif good:
        out["template_status"] = "MISMATCH"
    elif len(fits) >= 2 and all(abs(f["deviation"]) <= 0.5 for f in fits):
        # Noisy fits, but two independent clips both land on ~0 st (chance ~1/144).
        out["template_status"] = "consistent_noisy"
    else:
        out["template_status"] = "chorus_not_in_previews"
    return out


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    write = "--write" in sys.argv
    data = json.load(open(SONGS))
    songs = data["songs"]
    todo = [(s["id"], s.get("artist"), s["title"], s) for s in songs if s.get("artist")]
    todo += [(k, a, t, {"id": k, "title": t}) for k, (a, t) in EXTRA.items()]
    if args:
        todo = [x for x in todo if x[0] in args]
    for sid, artist, title, song in todo:
        res = check(song, songs, fetch(sid, artist, title))
        print(f"{sid:<26} tuning {res['tuning_cents_median']:+}c (spread {res['tuning_cents_spread']})  "
              f"template: {res['template_status']}  ",
              {k: v.get("template") for k, v in res["sources"].items()}, flush=True)
        if write and song in songs:
            song["reference"]["audio_check"] = res
    if write:
        json.dump(data, open(SONGS, "w"), indent=1)
        open(SONGS, "a").write("\n")


if __name__ == "__main__":
    main()
