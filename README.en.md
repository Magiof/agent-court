<p align="center">
  <a href="README.md">한국어</a> · <strong>English</strong>
</p>

<p align="center">
  <img src="docs/assets/agent-court-banner.svg" alt="Agent Court · 에이전트 조정" width="100%">
</p>

<h3 align="center">Agents, heed the royal command.</h3>

<p align="center">
  The daily work of Claude Code and Codex, brought to a Joseon court.<br>
  A personal local dashboard that shows what your coding agents are doing on a pixel-art map.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-0.2.0-a8282b?style=flat-square" alt="Version 0.2.0">
  <img src="https://img.shields.io/badge/Node.js-20%2B-4d665c?style=flat-square" alt="Node.js 20 or later">
  <img src="https://img.shields.io/badge/runtime_dependencies-0-b8892d?style=flat-square" alt="No external runtime npm dependencies">
  <img src="https://img.shields.io/badge/runs-locally-3a2414?style=flat-square" alt="Runs on your computer">
</p>

<p align="center">
  <a href="#quick-start">Quick start</a> ·
  <a href="docs/START-HERE.en.md">Setup guide</a> ·
  <a href="docs/USAGE.en.md">Detailed usage</a> ·
  <a href="https://github.com/Magiof/agent-court/issues">Report an issue</a>
</p>

![Agent Court showing fictional Claude Code and Codex sessions together](docs/assets/agent-court-demo.jpg)

<p align="center"><sub>Actual app screen, captured with fictional demo sessions. The interface shown is in Korean.</sub></p>

## See your agents at work

Agents head to **Kyujanggak, the royal library (규장각)** to read documents, the **Ministry of Works (공조)** to edit code, and the **examination hall (과거장)** to run tests. Officials follow designated paths, and subagents appear as dokkaebi, Korean goblins. `Court` refers to the royal court (조정, 朝廷) where they gather to work.

| What you see at court | What you can do |
| --- | --- |
| **An animated pixel-art village** | Watch characters move between government offices according to their work, and zoom in or out to explore the map. |
| **Your agent roster** | View Claude Code and Codex together, give sessions names and court roles, or hide them. |
| **Work and pending approvals** | Check recent activity, tests, pending permission requests, and completed responses. |
| **Daily court stats and a live chronicle** | Follow real-time prompt, tool, edit, test, approval, and recent-activity counts. |
| **Attention alerts** | Use on-screen alerts, sounds, and browser notifications to catch pending approvals. |
| **Your existing workflow** | Connect or disconnect each tool. Existing settings are preserved; an existing settings file is backed up when it is actually changed. |

The personal version is for **observing work**. Send instructions and approve permissions in the Claude Code or Codex interface you normally use.

## Quick start

You need **Node.js 20 or later** and an installed copy of Claude Code or Codex to connect. Run these commands in a location of your choice.

```bash
git clone https://github.com/Magiof/agent-court.git
cd agent-court
npm run connect -- both
npm run local
```

Open [localhost:4545](http://localhost:4545) in your browser and work as usual. There are no external runtime npm dependencies, so a separate `npm install` is not needed.

- If you use only one tool, replace `both` with `claude` or `codex`.
- For Claude Code, start a new session after connecting. You can check the registration in `/hooks`.
- For Codex, review and trust the recorder in the app's **Hooks settings** or the CLI's `/hooks`, then start a new local session.
- `npm run local` runs a foreground server. Closing that terminal takes the site down; press **Ctrl+C** there to stop it deliberately.

See the [setup guide](docs/START-HERE.en.md) and [detailed usage guide](docs/USAGE.en.md) for changing the port, installing globally, and disconnecting.

Common management commands:

```bash
npm run connect -- both --dry-run       # Preview the connection plan without changes
npm run disconnect -- both              # Remove only the recorders added by Agent Court
npm run local -- --port 4547            # Run on another port
npm run local -- --data-dir /path/data  # Use a custom record directory
```

There is currently no `--host` option.

<details>
<summary><strong>Want to explore the screen before connecting?</strong></summary>

Run the fictional-session demo from the project directory. You can explore the interface without connecting tools or running actual AI tasks.

```bash
FARM_NO_AGENTS=1 npm run demo
```

Open [localhost:4546](http://localhost:4546). Fictional activity records are stored in the project's `data-demo/` directory.

</details>

## Support status

| Environment / tool | Current status |
| --- | --- |
| **macOS** | Supported in code; installation, connection, disconnection, recording, server, and distribution package manually validated |
| **Linux** | Supported by the installation code; not validated in a real usage environment |
| **Windows** | Currently unsupported |
| **Claude Code** | Records activity through local command hooks |
| **Codex CLI** | Connects against the Codex Hooks schema; manually confirmed in version 0.154.0 |
| **Codex desktop app** | Uses Hooks to connect; actual app activity appearing on the map has not been verified |
| **Remote access / Cloudflare Tunnel** | Outside the supported scope; the server binds only to `127.0.0.1` and assumes local use |

Agent Court observes local work running on the same computer. Cloud tasks and a shared team server are outside the current connection scope.

## If the site does not open

From the project directory on the computer where Agent Court is installed, start the server again and keep its terminal open.

```bash
npm run local
curl http://127.0.0.1:4545/api/state
```

- The terminal should print `Agent Court: http://localhost:4545`, and `curl` should return JSON.
- `Connection refused` means the server is not running. Start it again with `npm run local`.
- If port 4545 is occupied, run `npm run local -- --port 4547` and open [localhost:4547](http://localhost:4547).
- If the screen opens but no sessions appear, start work in a **new local session** of Claude Code or Codex after connecting, and make sure the recorder and server use the same `--data-dir`.

The current source binds the server to `127.0.0.1` and assumes an unauthenticated local dashboard. Connecting a Named Tunnel in your Cloudflare account is not enough by itself; all of the following must be true for the read-only view at a public hostname to load.

1. The Agent Court origin server must remain running.
2. `cloudflared` must run on the same computer and in a network context that can reach `http://127.0.0.1:4545`.
3. With containers, `127.0.0.1` inside the tunnel container may not be the Agent Court container, so use an origin address reachable between the containers.

Publishing through Cloudflare is currently outside the supported scope. The state API has no separate login protection, and mutations such as renaming, assigning court roles, or hiding sessions accept only a localhost Origin, so some controls may fail with `403` at a public hostname. If external access is unavoidable, put **an authentication layer such as Cloudflare Access in front of it** and understand that this crosses the project's current local-only security boundary.

## Local activity records

The personal observe-only recorder installed by `agent-court connect` stores timestamps, session IDs, working directories, tool names, and activity types locally. **It does not newly store prompts, conversation text, raw commands, patches, file contents, or tool output.** Older non-observe-only receiver and web-order paths retained in the source tree can store message bodies and attachments, but they are not included in the personal distribution.

There are **no additional model or API calls for the map**. The recorder, server, and browser use computer resources. Work performed by your original agent is counted according to that service's usage rules.

The default record directory is `~/.agent-court/data/`, and the server runs on `127.0.0.1`. On restart, the screen restores the most recent 12 hours; when the event log exceeds 30 MB, it is trimmed to the most recent two days. See [recorded data and usage](docs/USAGE.en.md#recorded-data-and-usage) for details, including compatibility with existing records and the Google Fonts connection.

## Learn more

| Guide | Covers |
| --- | --- |
| [Getting started](docs/START-HERE.en.md) | Installation, connection, startup, disconnection, and sessions missing from the screen |
| [Detailed usage](docs/USAGE.en.md) | All commands, record locations, work assigned to each office, compatibility, and troubleshooting |
| [Development and validation](docs/USAGE.en.md#development-and-validation) | Preparing the test environment, PNG validation, and distribution package validation |
| [Asset notices](THIRD-PARTY-NOTICES.en.md) | Sources of the map, character images, and external fonts |

The scenery and seven character types were generated with OpenAI ImageGen for this project.
