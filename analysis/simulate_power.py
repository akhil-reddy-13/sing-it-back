"""Power / sample-size simulation for the two preregistered H2 tests.

    python3 analysis/simulate_power.py

Model of a participant's mean |deviation| (memory): a mixture of "rememberers"
(deviation ~ Normal(0, sd_mem)) and people who sing in a random key, averaged over
k songs. Parameters are deliberately conservative guesses; replace them with pilot
estimates (participants.csv) before finalising N.
"""
import numpy as np
from scipy import stats

rng = np.random.default_rng(0)
K_SONGS, P_REMEMBER, SD_MEM, BOUND, SIMS = 4, 0.5, 1.0, 0.5, 2000


def mean_abs_dev(n, p_rem=P_REMEMBER):
    # rememberer status is a property of the person (conservative: larger between-person spread)
    rem = np.repeat(rng.random((n, 1)) < p_rem, K_SONGS, axis=1)
    dev = np.where(rem, rng.normal(0, SD_MEM, (n, K_SONGS)), rng.uniform(-6, 6, (n, K_SONGS)))
    dev = (dev + 6) % 12 - 6
    return np.abs(dev).mean(axis=1)


def tost_p(a, b, bound):
    d = a.mean() - b.mean(); va, vb = a.var(ddof=1) / len(a), b.var(ddof=1) / len(b); se = np.sqrt(va + vb)
    df = (va + vb) ** 2 / (va ** 2 / (len(a) - 1) + vb ** 2 / (len(b) - 1))
    return max(1 - stats.t.cdf((d + bound) / se, df), stats.t.cdf((d - bound) / se, df))


def naming_props(n, p_ap):
    ap = rng.random(n) < p_ap
    return np.where(ap, rng.binomial(24, 0.9, n), rng.binomial(24, 1 / 12, n)) / 24


print(f"Assumptions: {K_SONGS} songs/person, {P_REMEMBER:.0%} 'rememberers' (sd {SD_MEM} st), equivalence bound ±{BOUND} st")
print("Naming: absolute-pitch prevalence 15% (tone) vs 4% (non-tone) among participants; AP = 90% exact, others guess\n")
print(f"{'n per group':>12} | {'memory equivalence (TOST) power':>32} | {'naming difference power':>24}")
for n in [40, 60, 80, 100, 150, 200, 300]:
    eq = np.mean([tost_p(mean_abs_dev(n), mean_abs_dev(n), BOUND) < 0.05 for _ in range(SIMS)])
    nm = np.mean([stats.ttest_ind(naming_props(n, .15), naming_props(n, .04), equal_var=False, alternative="greater").pvalue < 0.05 for _ in range(SIMS)])
    print(f"{n:>12} | {eq:>32.0%} | {nm:>24.0%}")
print(f"\nSD of person-level mean |dev| under these assumptions: {mean_abs_dev(100000).std():.2f} st")
