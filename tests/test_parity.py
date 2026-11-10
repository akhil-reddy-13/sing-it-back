"""JS and Python scorers must agree on the same stored tracks.  Run: python3 -m pytest tests/ (or python3 tests/test_parity.py)"""
import json, pathlib, sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "analysis"))
import pitchlib as P

FIX = pathlib.Path(__file__).with_name("fixtures") / "parity.json"


def test_parity():
    cases = json.loads(FIX.read_text())
    for c in cases:
        py = P.score_trial(c["track"], c["song"])
        js = c["js"]
        assert abs(py["voiced_sec"] - js["voiced_sec"]) < 0.02, (py["voiced_sec"], js["voiced_sec"])
        assert py["primary"]["method"] == js["primary"]["method"]
        assert abs(P.wrap12(py["primary"]["deviation"] - js["primary"]["deviation"])) < 0.03, (py["primary"], js["primary"])
        if js.get("anchor") and "deviation" in js["anchor"]:
            assert abs(py["anchor"]["deviation"] - js["anchor"]["deviation"]) < 0.03
        if js.get("key"):
            assert abs(P.wrap12(py["key"]["deviation"] - js["key"]["deviation"])) < 0.05


if __name__ == "__main__":
    test_parity(); print("parity OK")
