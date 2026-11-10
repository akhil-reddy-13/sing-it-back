# Sing It Back: study protocol and analysis plan

**Status:** draft v0.1 (2026-11-10), written to be frozen as a preregistration (e.g. on OSF) once the IRB approves and the reference songs are verified.
**Team:** [Faculty PI], Department of Music, Stanford University; Akhil Reddy (student researcher).
**Code:** this repository. Every session stores the app version, analysis version, `songs.json` version and random seed.

---

## 1. Summary

People rarely have *absolute (perfect) pitch*, the ability to name a note without a reference. But many ordinary listeners sing familiar recordings close to the original key (Levitin, 1994; Halpern, 1989), which suggests that *remembering* pitch is common and *naming* it is rare. Speakers of tone languages such as Mandarin are several times more likely to have absolute pitch (Deutsch et al., 2006, 2009). Yet tone-language speakers showed no advantage when pitch memory was tested without note names (Schellenberg & Trehub, 2008).

This study measures both abilities in the same people, online and at scale. Participants sing songs they know well from memory. A browser-based pitch tracker measures how far their key is from the original recording. They then name isolated piano notes and report their language and music background. The central test is the **dissociation predicted by the Label-Binding model** (Reddy, Music 1A poster, 2026): tone-language experience should predict note *naming*, but not pitch *memory*.

The study also turns a classic, hard-to-reproduce demonstration into a reproducible tool. Levitin's original study used in-lab recordings and hand scoring. Informal versions, such as asking passers-by to sing the current hit, have no fixed stimuli or scoring. Here, the stimuli, instructions, scoring algorithm and analysis are all fixed, versioned and open.

## 2. Research questions and hypotheses

| # | Hypothesis | Test (section 9) | Status |
|---|---|---|---|
| **H1** | Sung keys of familiar recordings cluster around the original key (replicating Levitin, 1994; Frieler et al., 2013). | Participant mean \|deviation\| < 3 st (chance); V-test toward 0 | confirmatory |
| **H1b** | That accuracy is *song-specific*, not a by-product of each person's comfortable vocal range. | Within-person song-shuffle permutation test | confirmatory |
| **H2a** | **Memory:** tone-language and non-tone-language speakers are *equivalent* in singing accuracy. | TOST, bounds ±0.5 st | confirmatory (key test of the model) |
| **H2b** | **Naming:** tone-language speakers name isolated notes more accurately. | One-sided Welch t on proportion correct | confirmatory |
| H3 | Naming accuracy is predicted by early fixed-do training and early lessons, independently of language. | Regression, see section 9.4 | exploratory |
| H4 | Accuracy is better for songs heard mostly as the original (not covers or sped-up versions), and for higher familiarity. | Mixed model terms | exploratory |
| H5 | Speaking pitch relates to the key chosen for "Happy Birthday" (speech-pitch anchor; Deutsch et al., 2004). | Correlation | exploratory |

H2a and H2b together are the model's signature prediction. A *failure* of H2a, where tone speakers are reliably better at memory too, would count against the model's claim that language acts on naming specifically.

## 3. Design

- **Within-subject tasks**, in a fixed order: singing (targets → control → retest) → speech → vocal range → note naming → questionnaire.
- **Quasi-experimental between-subject factor:** language background (self-reported, coded after data collection by a fixed rule; section 8.6). Language cannot be randomly assigned, so H2 is correlational. The analysis controls for music training and song familiarity.
- **Randomized within session:** the order of the song list on the familiarity screen, which known songs are chosen (up to 5), their order, and the note-naming sequence. All randomization comes from a per-session seed stored with the data.

### Why this order

No external tone is played until all singing is finished. Hearing any reference pitch, such as a note in the naming task or a tuning tone, could anchor later singing. "Happy Birthday" (no canonical key) comes after the target songs, so a comfortable key chosen for it can't carry over into them. The retest of the first song comes last in the singing block, about 5 minutes after the first performance.

## 4. Participants

- **Eligibility:** age 18+, a device with a microphone, self-reported normal hearing (hearing difficulties are recorded and excluded in the primary analysis).
- **Recruitment:** Stanford courses and mailing lists, student groups (including East Asian and Southeast Asian student associations, to reach tone-language speakers), music department lists, and public sharing. The `?src=` URL parameter is recorded to compare recruitment channels.
- **Target sample:** by simulation (`analysis/simulate_power.py`, conservative assumptions), **150 completers per language group** give about 92% power for the H2a equivalence test and about 95% for H2b. Assuming roughly 25% exclusion, the plan is to recruit until **≥150 valid tone-language and ≥150 valid non-tone-language participants**, or until [end date], whichever comes first. Update the assumptions with pilot data (section 11) before freezing.
- **Compensation:** [none / raffle / course credit, as approved by the IRB].

## 5. Stimuli

### 5.1 Target songs: selection criteria

A target song must:

1. have **one canonical recording** that most people hear over and over (no widely heard covers in other keys, no famous live versions);
2. have a **memorable, sung chorus** that most listeners can produce;
3. be widely known among the target population (pilot familiarity ratings).

The set as a whole should spread its **keys across the octave**. Otherwise accuracy could be confounded with a key that happens to suit most voices. The set should also mix **female and male lead singers**, and include **older and recent** songs.

The current list (in `public/songs.json`) has 17 songs. Their tonics cover 11 of the 12 pitch classes (all but E♭), with a major/minor mix. Adding an E♭ song would complete the set. **All keys in v0.1 are unverified first guesses** and must be checked (5.3).

**Planned extension:** add Mandarin- and Cantonese-language songs that have single canonical recordings, so that familiarity isn't confounded with growing up on Western pop. Analyze them as a song-level covariate.

### 5.2 Control song

"Happy Birthday" has no canonical recording or key. It is used (a) to estimate each person's comfortable singing key and register (range baseline, H1b, H5), and (b) as a scoring check, since everyone knows the melody exactly.

### 5.3 Reference verification procedure (required before data collection)

For each target song, two people work independently, using the original studio recording (streaming master):

1. **Tonic and mode** of the chorus, checked by playing along on a piano or with a tuner app.
2. **Tuning offset:** many recordings aren't at A = 440 Hz. In `verify.html`, play the tonic drone with the recording and adjust *Tuning (cents)* until it beats least. Record it in cents.
3. **Chorus melody:** enter the main vocal line of the chorus in the recording's key as note names with durations (`verify.html` → *Play melody* plays it back to check against the record).
4. **Cross-check:** both people's entries must agree on tonic and on every melody note (durations may differ). Disagreements are settled by listening together.
5. Tick *verified*, download `songs.json`, and commit it. The version string is saved with each session.

Because every session stores raw pitch tracks, a reference corrected later can be applied to all past data by re-running the analysis.

## 6. Procedure (about 12 minutes)

| Step | Screen | Data saved | ~Time |
|---|---|---|---|
| 1 | Welcome, requirements ("don't listen to music until you're done") | – | 0:30 |
| 2 | Consent (IRB text in `public/consent.html`); optional separate consent for keeping audio | consent flags | 1:00 |
| 3 | Microphone check: 3 s room noise, then "testing, one, two, three" | SNR, noise floor, device settings | 0:45 |
| 4 | Familiarity: rate every song 1–5 for the *original recording*; for songs rated 4–5: mostly heard as original / covers & remixes / both; ever performed it | ratings | 1:30 |
| 5 | Sing up to 5 known songs (rated 5 first, then 4), in random order. Instruction: imagine the original recording, then sing along with it; humming is fine; an octave up or down is fine. Max 25 s each. Confidence rating after each. | pitch track (10 ms), scores, confidence, flags | 4:00 |
| 6 | "Happy Birthday" in any key | pitch track | 0:40 |
| 7 | Retest: the first song again | pitch track | 0:40 |
| 8 | Read a fixed English sentence; optionally count 1–10 in another language | speaking pitch track | 0:40 |
| 9 | Vocal-range siren (lowest → highest) | range | 0:20 |
| 10 | Note naming: 24 piano tones (each pitch class twice, octaves 3–5, successive tones ≥ 7 st apart), each followed by a noise-and-random-tone mask. No feedback. Can be skipped by people who don't know note names (recorded). | responses, RTs | 2:30 |
| 11 | Questionnaire: languages (age learned, fluency, current use), where they grew up, lessons (onset, years, instrument), fixed vs movable do, singing habits, AP self-report and family AP, listening hours, age, gender, hearing, mic type, room noise, any music heard during the study | answers | 2:00 |
| 12 | Results and debrief | – | – |

Participants see no feedback about their accuracy until step 12. They can re-record a song (up to 3 attempts), and the last attempt is analyzed. A take with under 3 s of detected singing prompts a retry.

## 7. Apparatus

- Any recent Chrome, Edge, Firefox or Safari, on a laptop or phone. Microphone opened with echo cancellation, noise suppression and automatic gain control **turned off**.
- All pitch analysis runs in the browser on 16 kHz audio (deterministic resampler), so only measurements need to be uploaded. Device sample rate and microphone settings are stored.
- Hosting: static site plus serverless functions (Vercel); append-only event log in Postgres. Raw audio is stored only with separate consent and when `COLLECT_AUDIO=true`.

## 8. Measures and scoring

All scoring code is in `public/js/pitch.js` (browser), with a matching Python port in `analysis/pitchlib.py`. Parity is checked by `tests/test_parity.py`. Analysis version 1.0.0.

### 8.1 Pitch tracking

YIN (de Cheveigné & Kawahara, 2002): 40 ms window, 10 ms hop, 65–1050 Hz, threshold 0.15, parabolic interpolation. A frame counts as voiced if aperiodicity ≤ 0.25 and its energy is above a gate. The gate is 2.5 × the room-noise level, capped at 30% of the take's own 95th-percentile energy, so a bad noise measurement can't erase a real performance. The track is then median-filtered (5 frames), and voiced runs shorter than 50 ms are dropped.

### 8.2 Primary outcome: key deviation

**Deviation** = the transposition (in semitones) between the sung melody and the reference melody, folded into [−6, +6). Octave choice is ignored, because men often sing female songs an octave down. The octave actually used is stored separately.

- **Template method (primary, requires a verified melody):** the sung contour (median of each 50 ms) is aligned to the reference chorus by subsequence dynamic time warping. The template is repeated, so people who start mid-chorus or repeat it can still be aligned. The alignment uses an octave-free, capped (2 st) pitch distance and is computed at every transposition (0.25 st grid, then refined to 0.02 st). The best transposition is the deviation. *Ambiguity* = best cost ÷ best cost at least 1.5 st away (near 1 means unclear).
- **Key-profile method (fallback, used only while a melody is missing):** the sung pitch-class distribution is correlated with the Krumhansl–Kessler profile for the song's mode at every tonic in 0.1 st steps. This is less reliable (fifth-related keys can be confused) and is not used for confirmatory tests.
- **First-note method (secondary, Levitin-style):** the first note held steadily for at least 150 ms (within ±0.6 st), compared with the chorus's first note.

**Absolute deviation** |dev| (0–6 st) is the main per-trial accuracy measure. Chance (a uniformly random key) gives mean |dev| = 3 st, P(|dev| ≤ 1) = 1/6 and P(|dev| ≤ 2) = 1/3.

### 8.3 Validation of the scorer

`npm test` includes synthetic singers with vibrato, scoops, per-note intonation error, noise, partial performances, a repeated chorus, octave-down singing and recording tuning offsets. The scorer must recover the planted transposition within 0.2 st. `tests/e2e.mjs` drives the full study in headless Chrome with a synthetic singer as the microphone. Before launch, also run the human checks in section 11.

### 8.4 Note naming

The outcome is the proportion of the 24 tones named exactly (octave ignored), plus the proportion within ±1 semitone. An "AP-level" flag marks ≥ 85% exact (the Deutsch et al., 2006 criterion). Per-note errors are stored, which allows the white-key / G♯ "vocabulary" analysis on the poster (exploratory).

### 8.5 Other measures

Median speaking pitch (English sentence; other language optional), vocal range (5th–95th percentile of the siren), the Happy Birthday key and register, confidence and familiarity ratings, and listening source.

### 8.6 Language coding (fixed before analysis; `analysis/language_codes.csv`)

- **Tone-language speaker (primary):** at least one lexical tone language (e.g. Mandarin, Cantonese, Hokkien, Vietnamese, Thai, Punjabi, Yoruba) learned by **age 6** and spoken **fluently or natively** (fluency ≥ 4 of 5).
- **Non-tone-language speaker:** no tone language at any fluency above "a little", and no pitch-accent language (Japanese, Swedish, Norwegian, Serbo-Croatian) learned early and fluently.
- **Other:** everyone else (late or partial tone-language learners, early pitch-accent speakers). Excluded from H2. Analyzed in exploratory models with tone-language fluency as a continuous predictor, following Deutsch et al. (2009).

## 9. Analysis plan

Run with `python3 analysis/analyze.py --mode irb`. The script writes `report.md`, `trials.csv` and `participants.csv`. Only sessions run under the approved protocol (`STUDY_MODE=irb`) are included in confirmatory analyses.

### 9.1 Exclusions (decided in advance)

**Trial level:**

- less than 3 s of detected singing;
- participant flagged "didn't really know this part", "heard music" or "interrupted";
- the song's reference isn't verified;
- template ambiguity > 0.9;
- unscorable.

Only songs rated 4–5 for familiarity are presented, by design.

**Participant level:**

- self-reported hearing difficulties;
- heard music during the study;
- no valid target trial (for H1/H2a);
- skipped naming (for H2b only).

A sensitivity analysis repeats the main tests with each exclusion relaxed.

### 9.2 H1 and H1b

- **H1:** a one-sided one-sample t-test of participant-level mean |dev| against 3.0 (Wilcoxon as a robustness check). Also reported: the proportion of trials within ±1 and ±2 st, with participant-cluster bootstrap 95% CIs, and a V-test of deviation angles toward 0.
- **H1b:** for each participant with ≥ 2 valid target songs, the sung tonic is compared with the true references versus the references shuffled among that person's own songs (5,000 permutations). The statistic is the mean of person-level mean |dev|. If people simply sang every song in a comfortable key, true and shuffled references would fit equally well.

### 9.3 H2a and H2b

- **H2a (equivalence):** two one-sided Welch tests (TOST) on participant mean |dev|, tone vs non-tone, with bounds of **±0.5 st** (a quarter-tone). Typical errors are 1–2 st, so a group difference smaller than this would not matter for the theory. Equivalence is claimed if p < .05; the 90% CI is reported. *Supporting model:* a linear mixed model of |dev| with fixed effects for language group, any lessons, familiarity (5 vs 4) and song, plus a random intercept for participant.
- **H2b:** a one-sided Welch t-test on proportion of notes named exactly, tone > non-tone, plus the share of people at the 85% criterion. *Supporting model:* binomial GLMM on trial-level correctness (`correct ~ tone + lessons_before_7 + fixed_do + (1 | participant) + (1 | note)`). *(Not yet in `analyze.py`; add before freezing.)*
- H2a and H2b test separate claims, each at α = .05. The model's prediction is that **both** hold.

### 9.4 Exploratory

- Fixed vs movable do, and lesson onset age, predicting naming (H3).
- Listening source, familiarity and performing history predicting |dev| (H4).
- Speech pitch vs Happy Birthday key (H5).
- Test–retest reliability (circular correlation, first vs retest).
- Confidence–accuracy relation.
- The first-note method vs the template method.
- Naming error patterns (white vs black keys; G♯→A).
- Laptop vs phone microphones.

### 9.5 Missing data

Analyses use all available valid data. Skipped questionnaire items are left missing, never imputed for confirmatory tests.

## 10. Ethics and data

- **IRB.** The study runs under [PI]'s protocol [number]. `COLLECT_DATA` stays `false` (demo mode, nothing saved) until approval. **Data collected before approval, including class-project pilots, should not be used in the publication.** Confirm with the IRB whether pilot data may be kept at all.
- **Consent** is shown in full before any recording. Audio retention has its own separate, unticked checkbox, and is disabled server-side unless `COLLECT_AUDIO=true`.
- **What is stored:**
  - pitch measurements every 10 ms (not audio);
  - answers;
  - browser user agent, language and time zone, screen size;
  - country, from the hosting edge.

  No names, emails or IP addresses are stored. Free-text fields are capped and should be reviewed for identifying information before sharing data.
- **Withdrawal:** participants get a session ID at the end. Deleting a session takes one SQL statement (see `db/schema.sql`).
- **Sharing:** de-identified `trials.csv`, `participants.csv` and pitch tracks will be posted with the paper. Audio (if any) will be shared only as the consent allows.

## 11. Before launch: validation checklist

1. Verify all target references (section 5.3) and commit `songs.json`.
2. **Human scorer check:** 5–10 lab members each sing every song twice, once as close to the original as they can and once deliberately transposed by a known amount (e.g. sing along with a pitch-shifted track, then reproduce it). The scorer must recover the known shifts within 0.5 st on ≥ 90% of takes.
3. **Device check:** repeat a subset on a MacBook built-in mic, an iPhone, AirPods and a cheap headset.
4. **Pilot** (n ≈ 20–30, under the approved protocol, analyzed separately). Check familiarity rates per song, task duration and drop-off, the exclusion rate, and the SD of mean |dev|. Feed the SD into `simulate_power.py` and update N.
5. Freeze: tag the git commit, record the `songs.json` version, and post this document to OSF.

## 12. Known limitations

- **Self-selected online sample.** People who like singing may be over-represented. The questionnaire records singing habits, and recruitment channels are tracked.
- **Familiarity differs by culture.** The current list is Western pop, so tone-language speakers raised abroad may know fewer songs. Only well-known songs are used per person, and the planned C-pop / Canto-pop extension addresses this directly.
- **Octave-free scoring** can't tell a man singing an octave down from a near-miss in register. That's intentional, and the octave is stored.
- **Imperfect home recordings** (noise, low-quality mics) add measurement noise, though not bias toward the original key. SNR and mic type are recorded.
- **The naming task** uses synthesized piano tones. Timbre affects absolute-pitch accuracy (Athos et al., 2007), so results are specific to this timbre.

## References

- Athos, E. A., et al. (2007). Dichotomy and perceptual distortions in absolute pitch ability. *PNAS, 104*(37), 14795–14800.
- de Cheveigné, A., & Kawahara, H. (2002). YIN, a fundamental frequency estimator for speech and music. *JASA, 111*(4), 1917–1930.
- Deutsch, D., Henthorn, T., & Dolson, M. (2004). Absolute pitch, speech, and tone language. *Music Perception, 21*(3), 339–356.
- Deutsch, D., Henthorn, T., Marvin, E., & Xu, H. (2006). Absolute pitch among American and Chinese conservatory students. *JASA, 119*(2), 719–722.
- Deutsch, D., Dooley, K., Henthorn, T., & Head, B. (2009). Absolute pitch among students in an American music conservatory: Association with tone language fluency. *JASA, 125*(4), 2398–2403.
- Frieler, K., Fischinger, T., Schlemmer, K., Lothwesen, K., Jakubowski, K., & Müllensiefen, D. (2013). Absolute memory for pitch: A comparative replication of Levitin's 1994 study in six European labs. *Musicae Scientiae, 17*(3), 334–349.
- Halpern, A. R. (1989). Memory for the absolute pitch of familiar songs. *Memory & Cognition, 17*(5), 572–581.
- Krumhansl, C. L., & Kessler, E. J. (1982). Tracing the dynamic changes in perceived tonal organization in a spatial representation of musical keys. *Psychological Review, 89*(4), 334–368.
- Levitin, D. J. (1994). Absolute memory for musical pitch: Evidence from the production of learned melodies. *Perception & Psychophysics, 56*(4), 414–423.
- Schellenberg, E. G., & Trehub, S. E. (2003). Good pitch memory is widespread. *Psychological Science, 14*(3), 262–266.
- Schellenberg, E. G., & Trehub, S. E. (2008). Is there an Asian advantage for pitch memory? *Music Perception, 25*(3), 241–252.
