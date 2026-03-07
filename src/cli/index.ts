#!/usr/bin/env node
import { Command } from "commander";
import { createServer } from "../server/index.js";
import { scanSessions, upsertSessions, getSessions, closeDb } from "../core/index.js";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const program = new Command();

program
  .name("clawster")
  .description("Claude Code session dashboard for iTerm2")
  .version("0.1.0");

program
  .command("dev")
  .description("Start the Clawster dashboard server")
  .option("-p, --port <port>", "Port to listen on", "7777")
  .action(async (opts) => {
    const port = parseInt(opts.port, 10);
    await createServer(port);
  });

program
  .command("list")
  .description("List recent Claude Code sessions")
  .option("-n, --limit <count>", "Number of sessions to show", "20")
  .option("-q, --query <search>", "Search sessions")
  .action(async (opts) => {
    // Scan and cache first
    const scanned = await scanSessions();
    upsertSessions(scanned);

    const sessions = getSessions(parseInt(opts.limit, 10));
    if (sessions.length === 0) {
      console.log("No sessions found.");
      closeDb();
      return;
    }

    for (const s of sessions) {
      const date = new Date(s.lastActiveAt).toLocaleDateString();
      const prompt = s.firstPrompt
        ? s.firstPrompt.slice(0, 60).replace(/\n/g, " ")
        : "—";
      const branch = s.gitBranch ? ` (${s.gitBranch})` : "";
      console.log(
        `  ${s.projectName}${branch}  ${date}  ${s.messageCount} msgs`
      );
      console.log(`    ${prompt}`);
      console.log(`    ID: ${s.id}`);
      console.log();
    }

    closeDb();
  });

program
  .command("resume <sessionId>")
  .description("Resume a Claude Code session (copies command to clipboard)")
  .action(async (sessionId: string) => {
    const cmd = `claude -r ${sessionId}`;
    console.log(`Resume command: ${cmd}`);
    console.log("Paste this into your terminal to resume the session.");
    closeDb();
  });

program
  .command("init")
  .description("Initialize Clawster (iTerm2 setup, Python bridge)")
  .action(async () => {
    console.log("Checking prerequisites...");

    // Check Python 3
    try {
      await new Promise<void>((resolve, reject) => {
        execFile("python3", ["--version"], (err, stdout) => {
          if (err) reject(err);
          else {
            console.log(`  Found ${stdout.trim()}`);
            resolve();
          }
        });
      });
    } catch {
      console.error("  Python 3 not found. Install it to enable iTerm2 integration.");
    }

    // Check iTerm2
    const itermPath = "/Applications/iTerm.app";
    if (existsSync(itermPath)) {
      console.log("  Found iTerm2");
    } else {
      console.log("  iTerm2 not found at /Applications/iTerm.app");
    }

    // Check for Python bridge
    const bridgePath = join(homedir(), ".config", "clawster", "clawster_iterm.py");
    if (existsSync(bridgePath)) {
      console.log("  Python bridge already installed");
    } else {
      console.log("  Python bridge will be installed on first use");
    }

    console.log();
    console.log("Run 'clawster dev' to start the dashboard.");

    closeDb();
  });

program
  .command("reindex")
  .description("Re-scan all Claude Code sessions")
  .action(async () => {
    console.log("Scanning sessions...");
    const sessions = await scanSessions();
    upsertSessions(sessions);
    console.log(`Indexed ${sessions.length} sessions.`);
    closeDb();
  });

program.parse();
