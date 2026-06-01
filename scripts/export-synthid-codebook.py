"""Export compact JSON for Node SynthID detector (top consensus bins per profile)."""
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "reverse-synthid-gui" / "src" / "extraction"))
from synthid_bypass_v4 import SpectralCodebookV4  # noqa: E402

TOP_K = 192
CONSENSUS_FLOOR = 0.45


def main():
    if len(sys.argv) < 3:
        print("Usage: export-synthid-codebook.py <codebook.npz> <out.json>")
        sys.exit(1)
    npz_path, out_path = sys.argv[1], sys.argv[2]
    cb = SpectralCodebookV4()
    cb.load(npz_path)

    profiles = []
    for (model, h, w), prof in cb.profiles.items():
        cons = prof.consensus_coherence.copy()
        phase = prof.consensus_phase
        cons[0, 0, :] = 0.0
        bins = []
        for ch in range(3):
            flat = cons[:, :, ch].ravel()
            if flat.max() < CONSENSUS_FLOOR:
                continue
            idx = np.argsort(flat)[-TOP_K:]
            rows, cols = np.unravel_index(idx, cons[:, :, ch].shape)
            for y, x in zip(rows, cols):
                c = float(cons[y, x, ch])
                if c < CONSENSUS_FLOOR:
                    continue
                bins.append({
                    "y": int(y),
                    "x": int(x),
                    "ch": int(ch),
                    "cons": round(c, 4),
                    "phase": round(float(phase[y, x, ch]), 6),
                })
        profiles.append({"model": model, "h": int(h), "w": int(w), "bins": bins})

    out = {"version": 1, "topK": TOP_K, "profiles": profiles}
    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    Path(out_path).write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")
    print(f"Exported {len(profiles)} profiles")


if __name__ == "__main__":
    main()
