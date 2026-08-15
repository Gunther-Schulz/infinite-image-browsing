"""Read generation metadata out of a video container's own tags.

Video generators embed their settings in the container rather than in an image
header, because there is no image header to put them in. WanGP writes a JSON
object into the MP4 `comment` tag holding the whole generation config.

Until now the only video metadata IIB could read was a `<video>.txt` sidecar
written alongside the file, so a video carrying perfectly good metadata inside
itself showed an empty info panel.

This reads the container instead. It is deliberately not tied to one generator:
any container tag whose value parses as a JSON object with a `prompt` key is
accepted, so other video tools that do the same thing work without further
changes. pyav is already a dependency here (video covers use it), so nothing
new is pulled in.
"""

import json
from typing import Optional

from scripts.iib.logger import logger
from scripts.iib.parsers.model import ImageGenerationInfo, ImageGenerationParams
from scripts.iib.tool import parse_prompt

# Tags worth looking in, most likely first. `comment` is where WanGP writes;
# the others are common places for a tool to leave a blob.
CANDIDATE_TAGS = ("comment", "description", "synopsis", "title")

# Keys promoted into `meta`, which is the panel's key/value table. Everything
# else stays available in `extra`, so nothing is discarded - this only decides
# what is worth showing first out of forty-odd fields.
INTERESTING_KEYS = (
    "seed", "resolution", "video_length", "num_inference_steps",
    "guidance_scale", "guidance2_scale", "guidance_phases", "switch_threshold",
    "model_type", "base_model_type", "model_filename", "type",
    "video_quality", "generation_time", "creation_date", "settings_version",
    "activated_loras", "loras_multipliers", "negative_prompt", "alt_prompt",
    "sliding_window_size", "sliding_window_overlap", "temporal_upsampling",
    "spatial_upsampling", "film_grain_intensity", "repeat_generation",
)


def read_container_tags(file_path: str) -> dict:
    """Container-level metadata, or an empty dict if it cannot be read.

    Never raises: a malformed or unreadable file must leave the indexer walking
    the rest of the directory, exactly as a missing sidecar does today.
    """
    try:
        import av
    except ImportError:
        return {}

    try:
        with av.open(file_path, metadata_errors="ignore") as container:
            return dict(container.metadata or {})
    except Exception as e:
        logger.debug("Could not read container tags from %s: %s", file_path, e)
        return {}


def _find_generation_json(tags: dict) -> Optional[dict]:
    """The first tag value that is a JSON object carrying a prompt.

    Requiring `prompt` is what keeps this from claiming unrelated JSON that a
    muxer or editor happened to leave in a comment field.
    """
    for name in CANDIDATE_TAGS:
        raw = tags.get(name)
        if not raw or not isinstance(raw, str):
            continue
        raw = raw.strip()
        if not raw.startswith("{"):
            continue
        try:
            data = json.loads(raw)
        except (ValueError, TypeError):
            continue
        if isinstance(data, dict) and "prompt" in data:
            return data
    return None


def test(file_path: str) -> bool:
    """Whether this file carries generation metadata in its container."""
    return _find_generation_json(read_container_tags(file_path)) is not None


def parse(file_path: str) -> Optional[ImageGenerationInfo]:
    """Generation info from the container, or None if there is none to read."""
    data = _find_generation_json(read_container_tags(file_path))
    if data is None:
        return None

    meta = {}
    for key in INTERESTING_KEYS:
        value = data.get(key)
        # Skip absent, empty and zero-ish values: a table of forty "0" rows
        # buries the handful of fields the operator is actually looking for.
        if value in (None, "", [], {}):
            continue
        if isinstance(value, (list, dict)):
            value = json.dumps(value, ensure_ascii=False)
        meta[key] = value

    # The size tag the indexer builds looks for these two names specifically
    # (update_image_data.py), so a "832x448" resolution string is split out
    # rather than left only as text.
    resolution = data.get("resolution")
    if isinstance(resolution, str) and "x" in resolution:
        width, _, height = resolution.partition("x")
        if width.strip().isdigit() and height.strip().isdigit():
            meta["final_width"] = int(width)
            meta["final_height"] = int(height)

    prompt = data.get("prompt") or ""
    pos_prompt = parse_prompt(prompt)["pos_prompt"] if prompt else []

    # raw_info is what the panel shows verbatim, so it is the whole payload
    # pretty-printed - nothing the generator recorded is hidden from the reader.
    raw_info = json.dumps(data, indent=2, ensure_ascii=False)

    extra = dict(data)
    extra["Source Identifier"] = "Video Container Tags"

    return ImageGenerationInfo(
        raw_info,
        ImageGenerationParams(meta=meta, pos_prompt=pos_prompt, extra=extra),
    )
