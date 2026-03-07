import { watch, type FSWatcher } from "chokidar";
import { PROJECTS_DIR } from "./scanner.js";

type ChangeCallback = (filePath: string) => void;

let watcher: FSWatcher | null = null;

/**
 * Start watching ~/.claude/projects/ for new or changed session files.
 * Calls onChange with the path of any added/changed .jsonl file.
 */
export function startWatcher(onChange: ChangeCallback): FSWatcher {
  if (watcher) return watcher;

  watcher = watch(`${PROJECTS_DIR}/**/*.jsonl`, {
    ignoreInitial: true,
    persistent: true,
    awaitWriteFinish: {
      stabilityThreshold: 500,
      pollInterval: 100,
    },
  });

  watcher.on("add", onChange);
  watcher.on("change", onChange);

  return watcher;
}

export function stopWatcher(): void {
  if (watcher) {
    watcher.close();
    watcher = null;
  }
}
