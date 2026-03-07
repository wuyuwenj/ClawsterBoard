#!/usr/bin/env python3
"""
Clawster iTerm2 bridge.
Thin CLI that uses iTerm2's Python API for terminal automation.

Usage:
    python3 clawster_iterm.py open-dashboard [--port PORT]
    python3 clawster_iterm.py resume <session-id> <cwd>
    python3 clawster_iterm.py save-arrangement <name>
"""

import sys
import subprocess


def open_dashboard(port: int = 7777):
    """Open the Clawster dashboard URL in a new iTerm2 tab."""
    script = f'''
    tell application "iTerm2"
        activate
        tell current window
            create tab with default profile
            tell current session
                write text "open http://127.0.0.1:{port}"
            end tell
        end tell
    end tell
    '''
    subprocess.run(["osascript", "-e", script], check=True)
    print(f"Opened dashboard at http://127.0.0.1:{port}")


def resume_session(session_id: str, cwd: str = "~"):
    """Open a new iTerm2 tab, cd to the project dir, and resume a Claude Code session."""
    script = f'''
    tell application "iTerm2"
        activate
        tell current window
            create tab with default profile
            tell current session
                write text "cd {cwd} && claude -r {session_id}"
            end tell
        end tell
    end tell
    '''
    subprocess.run(["osascript", "-e", script], check=True)
    print(f"Resuming session {session_id} in {cwd}")


def save_arrangement(name: str):
    """Save the current iTerm2 window arrangement."""
    script = f'''
    tell application "iTerm2"
        save current window as arrangement "{name}"
    end tell
    '''
    subprocess.run(["osascript", "-e", script], check=True)
    print(f"Saved arrangement: {name}")


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    command = sys.argv[1]

    if command == "open-dashboard":
        port = 7777
        if "--port" in sys.argv:
            idx = sys.argv.index("--port")
            port = int(sys.argv[idx + 1])
        open_dashboard(port)

    elif command == "resume":
        if len(sys.argv) < 3:
            print("Usage: clawster_iterm.py resume <session-id> [cwd]")
            sys.exit(1)
        cwd = sys.argv[3] if len(sys.argv) > 3 else "~"
        resume_session(sys.argv[2], cwd)

    elif command == "save-arrangement":
        if len(sys.argv) < 3:
            print("Usage: clawster_iterm.py save-arrangement <name>")
            sys.exit(1)
        save_arrangement(sys.argv[2])

    else:
        print(f"Unknown command: {command}")
        print(__doc__)
        sys.exit(1)


if __name__ == "__main__":
    main()
