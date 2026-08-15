
from scripts.iib.tool import is_dev,cwd

import logging
import os
logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)

console_handler = logging.StreamHandler()
console_handler.setLevel(logging.INFO)

# The log records the paths it walks, and a generated file's NAME frequently
# carries the prompt that produced it - video tools in particular write
# "<date>_seed<n>_<the whole prompt>.mp4". So this file accumulates prompt text,
# and writing it into the working directory puts that text inside a git checkout
# by default. Measured on one installation: 1366 lines of output paths, prompt
# fragments included.
#
# IIB_LOG_PATH follows IIB_DB_PATH and IIB_CACHE_DIR: same shape, so a
# deployment that already redirects its state can redirect this too. Unset
# behaves exactly as before.
_log_path = os.getenv("IIB_LOG_PATH") or f"{cwd}/log.log"
_log_dir = os.path.dirname(_log_path)
if _log_dir:
    os.makedirs(_log_dir, exist_ok=True)

file_handler = logging.FileHandler(_log_path)
file_handler.setLevel(logging.DEBUG)

formatter = logging.Formatter("%(asctime)s - %(name)s - %(levelname)s - %(message)s")
console_handler.setFormatter(formatter)
file_handler.setFormatter(formatter)

logger.addHandler(file_handler)
if is_dev:
    logger.addHandler(console_handler)
