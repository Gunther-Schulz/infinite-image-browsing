
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

# Console output is opt-in above - and propagation was quietly undoing that.
# Records climb to the ROOT logger unless this is switched off, and whichever
# dependency in a host application calls logging.basicConfig() puts a handler
# there. Every path this logger walks then lands on the host's stdout, prompt
# text and all.
#
# The console lines are identifiable as propagated rather than ours by their
# FORMAT: "INFO:scripts.iib.logger:..." is logging.BASIC_FORMAT
# ("%(levelname)s:%(name)s:%(message)s"), which only basicConfig's handler
# writes. Both handlers above use the "asctime - name - levelname - message"
# formatter, so a line in the other shape never came from either of them.
#
# Turning propagation off leaves both handlers untouched: the file still gets
# everything, and APP_ENV=dev still gets the console.
logger.propagate = False
