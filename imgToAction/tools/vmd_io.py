from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
import struct
from typing import Any


def _encode_fixed_text(value: str, length: int) -> bytes:
    data = value.encode("cp932", errors="replace")[:length]
    return data + (b"\x00" * (length - len(data)))


def _decode_fixed_text(data: bytes) -> str:
    return data.split(b"\x00", 1)[0].decode("cp932", errors="replace")


def _default_interpolation() -> bytes:
    data = bytearray(64)
    for offset in range(4):
        data[offset] = 20
        data[offset + 4] = 20
        data[offset + 8] = 107
        data[offset + 12] = 107
    return bytes(data)


@dataclass(frozen=True)
class BoneFrame:
    bone: str
    frame: int
    position: tuple[float, float, float]
    rotation: tuple[float, float, float, float]
    interpolation: bytes = field(default_factory=_default_interpolation)


def _validate_interpolation(interpolation: bytes, bone: str, frame: int) -> bytes:
    if len(interpolation) != 64:
        raise ValueError(
            f"VMD interpolation for bone {bone!r} frame {frame} must be 64 bytes, "
            f"got {len(interpolation)}"
        )
    return interpolation


def write_vmd(path: Path, frames: list[BoneFrame], model_name: str = "Eula") -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("wb") as stream:
        stream.write(_encode_fixed_text("Vocaloid Motion Data 0002", 30))
        stream.write(_encode_fixed_text(model_name, 20))
        stream.write(struct.pack("<I", len(frames)))
        for frame in frames:
            stream.write(_encode_fixed_text(frame.bone, 15))
            stream.write(struct.pack("<I", int(frame.frame)))
            stream.write(struct.pack("<3f", *frame.position))
            stream.write(struct.pack("<4f", *frame.rotation))
            stream.write(_validate_interpolation(frame.interpolation, frame.bone, frame.frame))
        stream.write(struct.pack("<I", 0))
        stream.write(struct.pack("<I", 0))
        stream.write(struct.pack("<I", 0))
        stream.write(struct.pack("<I", 0))
        stream.write(struct.pack("<I", 0))


def read_vmd_bone_frames(path: Path) -> list[BoneFrame]:
    data = path.read_bytes()
    if len(data) < 54:
        raise ValueError(f"VMD file is too short: {path}")
    bone_frame_count = struct.unpack_from("<I", data, 50)[0]
    offset = 54
    frames: list[BoneFrame] = []
    for index in range(bone_frame_count):
        if offset + 111 > len(data):
            raise ValueError(f"VMD bone frame table is truncated at frame {index}: {path}")
        bone_name = _decode_fixed_text(data[offset : offset + 15])
        frame = struct.unpack_from("<I", data, offset + 15)[0]
        position = struct.unpack_from("<3f", data, offset + 19)
        rotation = struct.unpack_from("<4f", data, offset + 31)
        interpolation = data[offset + 47 : offset + 111]
        frames.append(
            BoneFrame(
                bone_name,
                int(frame),
                (float(position[0]), float(position[1]), float(position[2])),
                (float(rotation[0]), float(rotation[1]), float(rotation[2]), float(rotation[3])),
                interpolation,
            )
        )
        offset += 111
    return frames


def read_vmd_summary(path: Path) -> dict[str, Any]:
    data = path.read_bytes()
    if len(data) < 54:
        raise ValueError(f"VMD file is too short: {path}")
    header = _decode_fixed_text(data[:30])
    model_name = _decode_fixed_text(data[30:50])
    bone_frame_count = struct.unpack_from("<I", data, 50)[0]
    offset = 54
    bone_names: list[str] = []
    max_frame = 0
    for index in range(bone_frame_count):
        if offset + 111 > len(data):
            raise ValueError(f"VMD bone frame table is truncated at frame {index}: {path}")
        bone_name = _decode_fixed_text(data[offset : offset + 15])
        frame = struct.unpack_from("<I", data, offset + 15)[0]
        if bone_name not in bone_names:
            bone_names.append(bone_name)
        max_frame = max(max_frame, int(frame))
        offset += 111
    return {
        "path": str(path),
        "header": header,
        "model_name": model_name,
        "bone_frame_count": bone_frame_count,
        "max_frame": max_frame,
        "bone_names": bone_names,
    }
