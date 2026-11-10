"""Sing It Back: preregistered analysis pipeline (see docs/PROTOCOL.md section 8).

    python3 analysis/analyze.py                      # data/events.ndjson + public/songs.json
    python3 analysis/analyze.py EVENTS.ndjson --songs SONGS.json --out DIR [--mode irb]
                                [--include-unverified] [--no-rescore]

Outputs in --out (default analysis/out/):  trials.csv, participants.csv, report.md, fig_*.png
Every trial is re-scored from its stored pitch track with the *current* songs.json,
so fixing a reference melody later updates all past data.
"""
from __future__ import annotations

import argparse, collections, csv, json, math, pathlib, sys

import numpy as np
import pandas as pd
from scipy import stats

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import pitchlib as P  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parents[1]
EQ_BOUND = 0.5          # semitones: equivalence bound for H2 (memory)
AMBIGUITY_MAX = 0.9     # template fits worse than this are "unclear"
MIN_VOICED = 3.0        # seconds of singing needed for a valid trial
EXCLUDE_FLAGS = {"unsure_part", "heard_music", "interrupted"}


# ---------------------------------------------------------------- loading
def load_events(path):
    by = collections.defaultdict(list)
    with open(path) as f:
        for line in f:
            if line.strip():
                e = json.loads(line)
                by[e["session_id"]].append(e)
    for v in by.values():
        v.sort(key=lambda e: e["seq"])
    return by


def load_languages():
    table = {}
    with open(ROOT / "analysis" / "language_codes.csv") as f:
        for row in csv.DictReader(f):
            for a in [row["name"].lower()] + [x.strip() for x in row["aliases"].split(";") if x.strip()]:
                table[a] = row
    return table


def code_languages(langs, table):
    """Primary definition (preregistered): tone-language speaker = a lexical tone language
    learned by age 6 and spoken fluently or natively (fluency >= 4)."""
    tone_early = tone_any = accent_early = False
    names, unknown = [], []
    for l in langs or []:
        row = table.get((l.get("name") or "").strip().lower())
        cat = row["category"] if row else "unknown"
        if not row and (l.get("name") or "").strip():
            unknown.append(l["name"].strip())
        age, flu = l.get("age_started"), l.get("fluency") or 0
        early = age is not None and age <= 6
        if cat == "tone":
            names.append(row["name"])
            tone_any |= flu >= 2 or not l.get("fluency")  # listed with unknown fluency: not "non-tone"
            tone_early |= early and flu >= 4
        if cat == "pitch_accent" and early and flu >= 4:
            accent_early = True
    if tone_early:
        group = "tone"
    elif unknown:
        group = "uncoded"  # add the language to language_codes.csv, then re-run
        names += [f"?{u}" for u in unknown]
    elif not tone_any and not accent_early:
        group = "non_tone"
    else:
        group = "other"  # late/partial tone-language learners, pitch-accent natives: excluded from H2
    return group, ";".join(sorted(set(names)))


# ---------------------------------------------------------------- tables
def build(events_by, songs, rescore=True, include_unverified=False):
    song_by = {s["id"]: s for s in songs["songs"]}
    lang_table = load_languages()
    trials, people = [], []
    for sid, evs in events_by.items():
        k = collections.defaultdict(list)
        for e in evs:
            k[e["kind"]].append(e["payload"])
        start = (k.get("session_start") or [{}])[0]
        q = (k.get("questionnaire") or [{}])[-1]
        fam = {r["song_id"]: r for r in (k.get("familiarity") or [{"ratings": []}])[-1]["ratings"]}
        mic = (k.get("mic_check") or [{}])[-1]
        # last attempt per trial slot
        last = {}
        for t in k.get("trial", []):
            last[t["trial_index"]] = t
        for t in last.values():
            song = song_by.get(t["song_id"])
            stored = t.get("scores") or {}
            use_stored = (not rescore or not song) and stored.get("voiced_sec") is not None
            sc = stored if use_stored else P.score_trial(t["track"], song, noise_rms=t.get("noise_rms") or 0)
            prim = sc.get("primary") or {}
            tmpl = sc.get("template") or {}
            f = fam.get(t["song_id"], {})
            verified = bool(song and song["reference"].get("verified"))
            reasons = []
            if sc["voiced_sec"] < MIN_VOICED: reasons.append("too_little_voice")
            if set(t.get("flags") or []) & EXCLUDE_FLAGS: reasons.append("participant_flag")
            if t["role"] != "control" and not verified and not include_unverified: reasons.append("reference_unverified")
            if prim.get("method") == "template" and tmpl.get("ambiguity", 0) > AMBIGUITY_MAX: reasons.append("ambiguous_fit")
            if "deviation" not in prim: reasons.append("unscorable")
            trials.append({
                "session_id": sid, "song_id": t["song_id"], "role": t["role"], "trial_index": t["trial_index"], "attempt": t["attempt"],
                "deviation": prim.get("deviation"), "abs_dev": abs(prim["deviation"]) if "deviation" in prim else None,
                "method": prim.get("method"), "ambiguity": tmpl.get("ambiguity") if prim.get("method") == "template" else (sc.get("key") or {}).get("ambiguity"),
                "anchor_dev": (sc.get("anchor") or {}).get("deviation"), "key_dev": (sc.get("key") or {}).get("deviation"),
                "octave": tmpl.get("octave"), "voiced_sec": sc["voiced_sec"], "median_midi": sc.get("median_midi"),
                "confidence": t.get("confidence"), "flags": ";".join(t.get("flags") or []),
                "familiarity": f.get("familiarity"), "heard_as": f.get("heard_as"), "performed": f.get("performed"),
                "ref_verified": verified, "valid": not reasons, "exclusion": ";".join(reasons),
            })
        group, tone_names = code_languages(q.get("languages"), lang_table)
        nm = (k.get("naming") or [{}])[-1]
        nt = nm.get("trials") or []
        hb = next((t for t in trials if t["session_id"] == sid and t["role"] == "control" and t["valid"]), None)
        sp = [s for s in k.get("speech", []) if s.get("task") == "english_sentence"]
        rg = (k.get("range") or [{}])[-1]
        people.append({
            "session_id": sid, "mode": start.get("mode"), "synthetic": bool(start.get("synthetic")),
            "songs_version": start.get("songs_version"), "completed": bool(k.get("complete")),
            "mic_snr_db": mic.get("snr_db"), "tone_group": group, "tone_languages": tone_names,
            "n_languages": len(q.get("languages") or []),
            "lessons": q.get("lessons"), "lesson_age": q.get("lesson_age"), "lesson_years": q.get("lesson_years"),
            "solfege": q.get("solfege"), "ap_self": q.get("ap_self"), "ap_family": q.get("ap_family"),
            "sing_freq": q.get("sing_freq"), "listen_hours": q.get("listen_hours"),
            "age": q.get("age"), "gender": q.get("gender"), "hearing": q.get("hearing"),
            "mic_type": q.get("mic_type"), "room": q.get("room"), "heard_music": q.get("heard_music"),
            "naming_n": len(nt) or None,
            "naming_exact": (sum(r["error"] == 0 for r in nt) / len(nt)) if nt else None,
            "naming_within1": (sum(abs(r["error"]) <= 1 for r in nt) / len(nt)) if nt else None,
            "hb_key_pc": (round(hb["deviation"]) % 12) if hb else None, "hb_median_midi": hb["median_midi"] if hb else None,
            "speech_median_midi": sp[-1].get("median_midi") if sp else None,
            "range_lo": rg.get("p05_midi"), "range_hi": rg.get("p95_midi"),
        })
    T, Pp = pd.DataFrame(trials), pd.DataFrame(people)
    if len(Pp):
        bad = Pp[(Pp.hearing == "yes") | (Pp.heard_music == "yes")].session_id
        if len(T):
            T.loc[T.session_id.isin(bad) & T.valid, "exclusion"] = "participant_excluded"
            T.loc[T.session_id.isin(bad), "valid"] = False
        tgt = T[(T.role == "target") & T.valid] if len(T) else T
        m = tgt.groupby("session_id").abs_dev.agg(["mean", "size"]) if len(tgt) else pd.DataFrame(columns=["mean", "size"])
        Pp = Pp.merge(m.rename(columns={"mean": "mean_abs_dev", "size": "n_valid_targets"}), left_on="session_id", right_index=True, how="left")
        Pp["n_valid_targets"] = Pp["n_valid_targets"].fillna(0).astype(int)
    return T, Pp


# ---------------------------------------------------------------- stats helpers
def v_test(dev):
    th = 2 * np.pi * np.asarray(dev) / 12
    n = len(th)
    V = np.cos(th).sum()
    u = V * math.sqrt(2 / n)
    return u, 1 - stats.norm.cdf(u)


def rayleigh(dev):
    th = 2 * np.pi * np.asarray(dev) / 12
    n = len(th)
    R = abs(np.exp(1j * th).mean())
    Z = n * R * R
    p = math.exp(-Z) * (1 + (2 * Z - Z * Z) / (4 * n) - (24 * Z - 132 * Z ** 2 + 76 * Z ** 3 - 9 * Z ** 4) / (288 * n * n))
    return R, Z, min(1.0, max(0.0, p))


def circ_corr(a, b):
    a, b = 2 * np.pi * np.asarray(a) / 12, 2 * np.pi * np.asarray(b) / 12
    ma, mb = np.angle(np.exp(1j * a).mean()), np.angle(np.exp(1j * b).mean())
    sa, sb = np.sin(a - ma), np.sin(b - mb)
    return float((sa * sb).sum() / math.sqrt((sa ** 2).sum() * (sb ** 2).sum()))


def cluster_boot(df, fn, n=2000, seed=0):
    rng = np.random.default_rng(seed)
    ids = df.session_id.unique()
    groups = {i: g for i, g in df.groupby("session_id")}
    out = []
    for _ in range(n):
        s = rng.choice(ids, len(ids), replace=True)
        out.append(fn(pd.concat([groups[i] for i in s])))
    return np.percentile(out, [2.5, 97.5])


def song_shuffle_test(tgt, songs, n_perm=5000, seed=1):
    """Is accuracy song-specific? Compare against each person's own songs with keys swapped.
    If people just sang everything in one comfortable key, true references would fit no better."""
    ref = {s["id"]: P.parse_pc(s["reference"]["tonic"]) + (s["reference"].get("tuning_cents") or 0) / 100 for s in songs["songs"] if s["role"] == "target"}
    rng = np.random.default_rng(seed)
    per = []
    for sid, g in tgt.groupby("session_id"):
        if len(g) < 2:
            continue
        r = np.array([ref[s] for s in g.song_id])
        sung = r + g.deviation.to_numpy()  # sung tonic (pitch class), recovered from the deviation
        per.append((sung, r))
    if not per:
        return None
    obs = np.mean([np.abs(P.wrap12(s - r)).mean() for s, r in per])
    null = np.empty(n_perm)
    for i in range(n_perm):
        null[i] = np.mean([np.abs(P.wrap12(s - rng.permutation(r))).mean() for s, r in per])
    return obs, null.mean(), (np.sum(null <= obs) + 1) / (n_perm + 1), len(per)


def tost(a, b, bound):
    a, b = np.asarray(a, float), np.asarray(b, float)
    d = a.mean() - b.mean()
    va, vb = a.var(ddof=1) / len(a), b.var(ddof=1) / len(b)
    se = math.sqrt(va + vb)
    df = (va + vb) ** 2 / (va ** 2 / (len(a) - 1) + vb ** 2 / (len(b) - 1))
    p_lo = 1 - stats.t.cdf((d + bound) / se, df)
    p_hi = stats.t.cdf((d - bound) / se, df)
    ci90 = (d - stats.t.ppf(0.95, df) * se, d + stats.t.ppf(0.95, df) * se)
    return d, ci90, max(p_lo, p_hi)


def hedges_g(a, b):
    a, b = np.asarray(a, float), np.asarray(b, float)
    sp = math.sqrt(((len(a) - 1) * a.var(ddof=1) + (len(b) - 1) * b.var(ddof=1)) / (len(a) + len(b) - 2))
    return (a.mean() - b.mean()) / sp * (1 - 3 / (4 * (len(a) + len(b)) - 9))


def fmt_p(p):
    return "< .001" if p < 0.001 else f"= {p:.3f}"


# ---------------------------------------------------------------- report
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("events", nargs="?", default=str(ROOT / "data" / "events.ndjson"))
    ap.add_argument("--songs", default=str(ROOT / "public" / "songs.json"))
    ap.add_argument("--out", default=str(ROOT / "analysis" / "out"))
    ap.add_argument("--mode", default=None, help="keep only sessions run in this STUDY_MODE (e.g. irb)")
    ap.add_argument("--include-unverified", action="store_true")
    ap.add_argument("--no-rescore", action="store_true")
    a = ap.parse_args()
    out = pathlib.Path(a.out); out.mkdir(parents=True, exist_ok=True)
    songs = json.loads(pathlib.Path(a.songs).read_text())
    T, Pp = build(load_events(a.events), songs, rescore=not a.no_rescore, include_unverified=a.include_unverified)
    if a.mode:
        keep = set(Pp[Pp["mode"] == a.mode].session_id)
        T, Pp = T[T.session_id.isin(keep)], Pp[Pp.session_id.isin(keep)]
    T.to_csv(out / "trials.csv", index=False)
    Pp.to_csv(out / "participants.csv", index=False)

    L = []
    w = L.append
    w("# Sing It Back: analysis report\n")
    if len(Pp) and Pp.synthetic.any():
        w("> **SYNTHETIC DATA.** These numbers come from `analysis/simulate.py` and only show that the pipeline runs. They are not findings.\n")
    if not songs["songs"] or any(not s["reference"].get("verified") for s in songs["songs"] if s["role"] == "target"):
        w(f"> Reference keys not all verified (songs.json `{songs['version']}`). {'Unverified songs INCLUDED.' if a.include_unverified else 'Unverified songs excluded.'}\n")
    w(f"Sessions: **{len(Pp)}** ({int(Pp.completed.sum()) if len(Pp) else 0} completed). Trials: {len(T)}, valid: {int(T.valid.sum()) if len(T) else 0}.\n")
    if len(T):
        ex = T[~T.valid].exclusion.str.split(";").explode().value_counts()
        if len(ex):
            w("Exclusions (trial-level, can overlap): " + ", ".join(f"{k} {v}" for k, v in ex.items()) + "\n")
        w("Groups: " + ", ".join(f"{k} {v}" for k, v in Pp.tone_group.value_counts().items()) + "\n")
        unc = sorted({n[1:] for x in Pp.tone_languages.dropna() for n in x.split(";") if n.startswith("?")})
        if unc:
            w("**Uncoded languages (add to analysis/language_codes.csv):** " + ", ".join(unc) + "\n")

    tgt = T[(T.role == "target") & T.valid] if len(T) else T
    if len(tgt) >= 5 and tgt.session_id.nunique() >= 3:
        pm = tgt.groupby("session_id").abs_dev.mean()
        w("\n## H1. People remember the key of familiar recordings (Levitin, 1994)\n")
        t1 = stats.ttest_1samp(pm, 3.0, alternative="less")
        wil = stats.wilcoxon(pm - 3.0, alternative="less") if len(pm) > 5 else None
        w(f"- Participant mean |deviation| = **{pm.mean():.2f} st** (SD {pm.std(ddof=1):.2f}, n = {len(pm)}); chance = 3.00. "
          f"One-sample t({len(pm)-1}) = {t1.statistic:.2f}, p {fmt_p(t1.pvalue)}" + (f"; Wilcoxon p {fmt_p(wil.pvalue)}" if wil else "") + ".")
        for k, ch in [(1, 1 / 6), (2, 1 / 3)]:
            prop = (tgt.abs_dev <= k).mean()
            ci = cluster_boot(tgt, lambda d: (d.abs_dev <= k).mean())
            w(f"- Within ±{k} st: **{prop:.0%}** of trials (95% cluster-bootstrap CI {ci[0]:.0%}–{ci[1]:.0%}); chance {ch:.0%}.")
        u, pv = v_test(tgt.deviation)
        R, Z, pr = rayleigh(tgt.deviation)
        w(f"- V-test toward the original key: u = {u:.2f}, p {fmt_p(pv)}. Rayleigh R = {R:.2f}, p {fmt_p(pr)} (trial-level; treat as descriptive).")
        w(f"- Mean signed deviation {tgt.deviation.mean():+.2f} st (positive = sharp).")
        sh = song_shuffle_test(tgt, songs)
        if sh:
            obs, nullm, pp, n = sh
            w(f"- **Song-shuffle control** (n = {n} people with ≥ 2 songs): mean |dev| {obs:.2f} st with the true keys vs {nullm:.2f} st with keys swapped among each person's own songs; permutation p {fmt_p(pp)}. "
              "A small p means accuracy is song-specific, not just a comfortable vocal range.")
        by_song = tgt.groupby("song_id").abs_dev.agg(["mean", "size"]).sort_values("mean")
        w("\n| Song | n | mean abs dev (st) |\n|---|---:|---:|\n" + "\n".join(f"| {i} | {int(r['size'])} | {r['mean']:.2f} |" for i, r in by_song.iterrows()))
        try:
            import matplotlib; matplotlib.use("Agg")
            import matplotlib.pyplot as plt
            fig, ax = plt.subplots(figsize=(7, 3.6))
            ax.hist(tgt.deviation, bins=np.arange(-6, 6.01, 0.5), color="#8C1515", edgecolor="white")
            ax.axhline(len(tgt) / 24, color="#53565A", ls="--", lw=1.2, label="chance (random key)")
            ax.set_xlabel("Sung key minus original key (semitones, octave-free)"); ax.set_ylabel("Trials")
            ax.spines[["top", "right"]].set_visible(False); ax.legend(frameon=False)
            fig.tight_layout(); fig.savefig(out / "fig_deviation_hist.png", dpi=200); plt.close(fig)
            w("\n![](fig_deviation_hist.png)\n")
        except Exception as e:  # plotting is optional
            w(f"\n(figure skipped: {e})\n")

    w("\n## H2. Language helps naming, not memory (the poster's Insight 1)\n")
    tone, non = Pp[Pp.tone_group == "tone"], Pp[Pp.tone_group == "non_tone"]
    mt, mn = tone.mean_abs_dev.dropna(), non.mean_abs_dev.dropna()
    if len(mt) >= 3 and len(mn) >= 3:
        d, ci, p = tost(mt, mn, EQ_BOUND)
        w(f"- **Memory** (mean |dev|): tone {mt.mean():.2f} (n = {len(mt)}) vs non-tone {mn.mean():.2f} (n = {len(mn)}); difference {d:+.2f} st, 90% CI [{ci[0]:+.2f}, {ci[1]:+.2f}]. "
          f"TOST with bounds ±{EQ_BOUND} st: p {fmt_p(p)} ({'equivalent' if p < 0.05 else 'not shown equivalent'}). Hedges g = {hedges_g(mt, mn):+.2f}.")
    else:
        w("- Memory: not enough participants in both groups yet.")
    nt_, nn_ = tone.naming_exact.dropna(), non.naming_exact.dropna()
    if len(nt_) >= 3 and len(nn_) >= 3:
        r = stats.ttest_ind(nt_, nn_, equal_var=False, alternative="greater")
        w(f"- **Naming** (proportion exact): tone {nt_.mean():.0%} vs non-tone {nn_.mean():.0%}; Welch t = {r.statistic:.2f}, one-sided p {fmt_p(r.pvalue)}, Hedges g = {hedges_g(nt_, nn_):+.2f}.")
        w(f"- Share meeting an absolute-pitch criterion (≥ 85% exact, as in Deutsch et al., 2006): tone {(nt_ >= .85).mean():.0%}, non-tone {(nn_ >= .85).mean():.0%}.")
    else:
        w("- Naming: not enough participants in both groups yet.")
    sub = tgt.merge(Pp[["session_id", "tone_group", "lessons", "lesson_years"]], on="session_id") if len(tgt) else pd.DataFrame()
    sub = sub[sub.tone_group.isin(["tone", "non_tone"])] if len(sub) else sub
    if len(sub) >= 30 and sub.session_id.nunique() >= 10 and sub.tone_group.nunique() == 2:
        try:
            import statsmodels.formula.api as smf
            sub = sub.assign(tone=(sub.tone_group == "tone").astype(int), trained=(sub.lessons == "yes").astype(int), fam5=(sub.familiarity == 5).astype(int))
            terms = ["tone"] + [c for c in ("trained", "fam5") if sub[c].nunique() > 1] + (["C(song_id)"] if sub.song_id.nunique() > 1 else [])
            fit = smf.mixedlm("abs_dev ~ " + " + ".join(terms), sub, groups=sub["session_id"]).fit(reml=True)
            b, se = fit.params["tone"], fit.bse["tone"]
            w(f"- Mixed model (|dev| ~ {' + '.join(terms)}, random intercept per person): tone b = {b:+.2f} st (95% CI {b-1.96*se:+.2f} to {b+1.96*se:+.2f}).")
        except Exception as e:
            w(f"- Mixed model failed: {e}")

    w("\n## Secondary\n")
    rt = T[(T.role == "retest") & T.valid] if len(T) else T
    if len(rt) >= 5:
        first = T[(T.role == "target") & T.valid][["session_id", "song_id", "deviation"]]
        pr = rt.merge(first, on=["session_id", "song_id"], suffixes=("_2", "_1"))
        if len(pr) >= 5:
            w(f"- Test–retest (same song, ~5 minutes apart, n = {len(pr)}): circular r = {circ_corr(pr.deviation_1, pr.deviation_2):.2f}; "
              f"mean |difference| = {np.abs(P.wrap12(pr.deviation_1 - pr.deviation_2)).mean():.2f} st.")
    if len(tgt) >= 10:
        for col, lab in [("confidence", "confidence rating"), ("familiarity", "familiarity (4 vs 5)")]:
            g = tgt.dropna(subset=[col])
            if g[col].nunique() > 1:
                rho = stats.spearmanr(g[col], g.abs_dev)
                w(f"- |dev| vs {lab}: Spearman ρ = {rho.statistic:+.2f} (trial-level, n = {len(g)}).")
        g = tgt[tgt.heard_as.isin(["original", "other", "both"])]
        if g.heard_as.nunique() > 1:
            w("- |dev| by how the song was mostly heard: " + ", ".join(f"{k} {v:.2f} (n={int(n)})" for k, (v, n) in g.groupby("heard_as").abs_dev.agg(["mean", "size"]).iterrows()))
    ok = Pp.dropna(subset=["naming_exact", "mean_abs_dev"])
    if len(ok) >= 10:
        rho = stats.spearmanr(ok.naming_exact, ok.mean_abs_dev)
        w(f"- Naming accuracy vs singing accuracy across people: Spearman ρ = {rho.statistic:+.2f} (n = {len(ok)}). The model predicts a weak link: memory is common, naming is rare.")
    if len(Pp.dropna(subset=["naming_exact"])):
        w("- Naming accuracy by solfège training: " + ", ".join(f"{k} {v:.0%} (n={int(n)})" for k, (v, n) in Pp.dropna(subset=["naming_exact"]).groupby("solfege").naming_exact.agg(["mean", "size"]).iterrows()))

    (out / "report.md").write_text("\n".join(L) + "\n")
    print("\n".join(L))
    print(f"\nwrote {out}/report.md, trials.csv, participants.csv")


if __name__ == "__main__":
    main()
