from pathlib import Path
import sys


API_ROOT = Path(__file__).resolve().parents[1]
if str(API_ROOT) not in sys.path:
    sys.path.insert(0, str(API_ROOT))

from app.services.vmd_writer import build_mature_female_idle_motion, write_vmd_file


def main() -> int:
    output = API_ROOT / "data" / "generated" / "mature_female_idle_120f.vmd"
    write_vmd_file(output, build_mature_female_idle_motion())
    print(output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
