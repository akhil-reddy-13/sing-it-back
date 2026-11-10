"""Python port of public/js/pitch.js (scoring half).

Used to re-score stored pitch tracks offline, e.g. after reference melodies
are verified or the scoring is improved. tests/test_parity.py checks that it
matches the JavaScript implementation on the same tracks.
"""
from __future__ import annotations

import math
import numpy as np

ANALYSIS_VERSION = "1.0.0"
PC_OF = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
NOTE_NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"]
KK = {
    "major": [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88],
    "minor": [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17],
}


def wrap12(x):
    """Fold semitone differences into [-6, 6)."""
    return ((np.asarray(x, dtype=float) + 6) % 12) - 6


def hz_to_midi(f):
    return 69 + 12 * np.log2(np.asarray(f, dtype=float) / 440.0)


def parse_note(s: str) -> float:
    import re
    m = re.match(r"^\s*([A-Ga-g])([#b♯♭]?)(-?\d)\s*$", s or "")
    if not m:
        return math.nan
    acc = {"#": 1, "♯": 1, "b": -1, "♭": -1}.get(m.group(2), 0)
    return 12 * (int(m.group(3)) + 1) + PC_OF[m.group(1).upper()] + acc


def parse_pc(s: str) -> float:
    n = parse_note(str(s).strip() + "4")
    return math.nan if math.isnan(n) else n % 12


def _median(a):
    a = np.asarray(a, dtype=float)
    a = a[np.isfinite(a)]
    return float(np.median(a)) if a.size else math.nan


def _quantile(a, q):
    a = np.asarray(a, dtype=float)
    a = a[np.isfinite(a)]
    return float(np.quantile(a, q)) if a.size else math.nan


def voicing(track, ap_max=0.25, noise_rms=0.0, min_rms=0.0015):
    rms = np.asarray(track["rms"], dtype=float)
    loud = _quantile(rms, 0.95)
    gate = max(min_rms, min(2.5 * (noise_rms or 0.0), 0.3 * loud if math.isfinite(loud) else math.inf))
    f0 = np.asarray(track["f0"], dtype=float)
    ap = np.asarray(track["ap"], dtype=float)
    return (ap <= ap_max) & (rms >= gate) & (f0 > 0)


def clean_midi(track, **vopts):
    v = voicing(track, **vopts)
    f0 = np.asarray(track["f0"], dtype=float)
    n = len(f0)
    raw = np.full(n, np.nan)
    raw[v] = hz_to_midi(f0[v])
    m = np.full(n, np.nan)
    for i in range(n):
        if not np.isfinite(raw[i]):
            continue
        w = raw[max(0, i - 2): i + 3]
        m[i] = np.median(w[np.isfinite(w)])
    i = 0
    while i < n:
        if not np.isfinite(m[i]):
            i += 1
            continue
        j = i
        while j < n and np.isfinite(m[j]):
            j += 1
        if j - i < 5:
            m[i:j] = np.nan
        i = j
    return m


def first_stable_note(m, min_frames=15, tol=0.6, hop_sec=0.01):
    n = len(m)
    for i in range(0, n - min_frames + 1):
        w = m[i: i + min_frames]
        if not np.all(np.isfinite(w)):
            continue
        med = float(np.median(w))
        if np.max(np.abs(w - med)) > tol:
            continue
        j = i + min_frames
        while j < n and np.isfinite(m[j]) and abs(m[j] - med) <= tol:
            j += 1
        return {"midi": float(np.median(m[i:j])), "start_sec": i * hop_sec, "dur_sec": (j - i) * hop_sec}
    return None


def contour(m, chunk=5):
    q = []
    for i in range(0, len(m) - chunk + 1, chunk):
        w = m[i: i + chunk]
        w = w[np.isfinite(w)]
        if w.size >= 3:
            q.append(float(np.median(w)))
    return np.array(q)


def expand_template(notes, per_beat=2):
    r = []
    for n in notes:
        r += [n["midi"]] * max(1, int(math.floor(n["beats"] * per_beat + 0.5)))
    return np.array(r, dtype=float)


def dtw_cost(Q, R, t, cap=2.0):
    """Subsequence DTW (free start/end on the template), same recurrence as pitch.js.

    The horizontal step makes each row a running min-plus scan, which is
    vectorised as  cur = S + cummin(b - S)  with S the row's prefix cost.
    """
    C = np.minimum(cap, np.abs(wrap12(Q[:, None] - t - R[None, :])))
    prev = C[0].copy()
    for i in range(1, len(Q)):
        b = np.empty_like(prev)
        b[0] = C[i, 0] + prev[0]
        b[1:] = C[i, 1:] + np.minimum(prev[1:], prev[:-1])
        S = np.concatenate([[0.0], np.cumsum(C[i, 1:])])
        prev = S + np.minimum.accumulate(b - S)
    return float(prev.min() / len(Q))


def score_template(m, notes, tuning_cents=0.0):
    Q = contour(m)
    if len(Q) < 20 or not notes:
        return None
    one = expand_template(notes) + tuning_cents / 100
    R = np.concatenate([one, one, one])
    coarse = [(-6 + k * 0.25, dtw_cost(Q, R, -6 + k * 0.25)) for k in range(48)]
    bi = int(np.argmin([c for _, c in coarse]))
    best_t, best_c = coarse[bi]
    t = coarse[bi][0] - 0.25
    while t <= coarse[bi][0] + 0.25 + 1e-9:
        c = dtw_cost(Q, R, t)
        if c < best_c:
            best_t, best_c = t, c
        t += 0.02
    rivals = [c for tt, c in coarse if abs(wrap12(tt - best_t)) >= 1.5]
    second = min(rivals)
    return {
        "deviation": round(float(wrap12(best_t)), 3),
        "cost": round(best_c, 4),
        "ambiguity": round(best_c / max(second, 1e-9), 3),
        "octave": int(round((np.median(Q) - (np.median(R) + best_t)) / 12)),
    }


def score_key(m, tonic_pc, mode="major", tuning_cents=0.0):
    B, sigma = 120, 0.3
    x = m[np.isfinite(m)]
    if x.size < 200:
        return None
    pcs = x % 12
    bins = np.arange(B) / 10
    d = wrap12(bins[:, None] - pcs[None, :])
    h = np.exp(-(d ** 2) / (2 * sigma ** 2)).sum(axis=1)
    prof = np.array(KK.get(mode, KK["major"]))
    dk = wrap12(bins[:, None] - np.arange(12)[None, :])
    base = (prof[None, :] * np.exp(-(dk ** 2) / (2 * sigma ** 2))).sum(axis=1)
    r = np.array([np.corrcoef(h, np.roll(base, s))[0, 1] for s in range(B)])
    bs = int(np.argmax(r))
    far = np.abs(wrap12((np.arange(B) - bs) / 10)) >= 1.5
    r2 = max(0.0, float(r[far].max()))
    return {
        "deviation": round(float(wrap12(bs / 10 - (tonic_pc + tuning_cents / 100))), 3),
        "r": round(float(r[bs]), 4),
        "ambiguity": round(r2 / r[bs], 3) if r[bs] > 0 else 1.0,
    }


def score_trial(track, song, **vopts):
    m = clean_midi(track, **vopts)
    hop_sec = track["hop"] / track["sr"]
    voiced = int(np.isfinite(m).sum())
    out = {
        "analysis_version": ANALYSIS_VERSION,
        "voiced_sec": round(voiced * hop_sec, 2),
        "median_midi": round(_median(m), 2) if voiced else None,
        "anchor": None, "template": None, "key": None, "primary": None,
    }
    ref = (song or {}).get("reference")
    if not ref or voiced < 100:
        return out
    tune = ref.get("tuning_cents") or 0
    first = first_stable_note(m, hop_sec=hop_sec)
    tmpl = ref.get("template")
    anchor = tmpl[0]["midi"] if tmpl else (parse_note(ref["anchor_note"]) if ref.get("anchor_note") else None)
    if anchor is not None and isinstance(anchor, float) and math.isnan(anchor):
        anchor = None
    if first:
        out["anchor"] = {"sung_midi": round(first["midi"], 2), "start_sec": round(first["start_sec"], 2)}
        if anchor is not None:
            out["anchor"]["deviation"] = round(float(wrap12(first["midi"] - (anchor + tune / 100))), 3)
    if tmpl:
        out["template"] = score_template(m, tmpl, tune)
    tonic = parse_pc(ref.get("tonic", ""))
    if not math.isnan(tonic):
        out["key"] = score_key(m, tonic, ref.get("mode", "major"), tune)
    if out["template"]:
        out["primary"] = {"method": "template", "deviation": out["template"]["deviation"]}
    elif out["key"]:
        out["primary"] = {"method": "key", "deviation": out["key"]["deviation"]}
    return out
