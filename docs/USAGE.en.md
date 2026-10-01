# Agent Court user guide

[한국어](USAGE.md) · **English**

Detailed instructions for installation, connections, activity records, and development. If you are new to Agent Court, read [Getting started](START-HERE.en.md) first.

[← Project overview](../README.en.md)

## Supported environments and current status

| Platform / tool | Support and verification status |
| --- | --- |
| macOS | Installation, connection and disconnection, recorder execution, the local server, and the distribution package have been verified |
| Linux | Supported by the installation code; not yet verified in a real usage environment |
| Windows | Not currently supported by the installation tool |
| Claude Code | Records activity through local command hooks; personal connections can be set up separately from existing operational sessions |
| Codex CLI | Confirmed that version 0.154.0 recognizes all 12 connection settings |
| Codex desktop app | Connects through the app's Hooks feature. Actual app work appearing on the map has not yet been directly verified with the current distribution package |
| Cloud tasks / shared team servers | Outside the connection scope of the current personal distribution |

Requires **Node.js 20 or later**. No external npm libraries are needed to run the app.

## Quick start

Clone the repository wherever you prefer, then enter the project folder. If you have already cloned it, start with the connection commands below from your `agent-court` folder.

```bash
git clone https://github.com/Magiof/agent-court.git
cd agent-court
```

Choose the tool you want to connect. Run only one of these three commands.

```bash
npm run connect -- claude
npm run connect -- codex
npm run connect -- both
```

To preview the plan before changing connection settings:

```bash
npm run connect -- both --dry-run
```

Start the map.

```bash
npm run local
```

Open [http://localhost:4545](http://localhost:4545) in your browser and work as usual. Activity from new sessions appears in the roster and on the map. Press **Ctrl+C** in the terminal running the server to stop the map server.

If port 4545 is already in use:

```bash
npm run local -- --port 4547
```

Then open [http://localhost:4547](http://localhost:4547).

## Finish connecting in Claude Code and Codex

### Claude Code

After connecting, start a new session so it loads the settings. You can check that the recorder is registered in `/hooks`. Existing permission, model, and other hook settings are preserved.

### Codex desktop app

You can continue working in the desktop app. In the app's **Hooks settings**, review and trust the added recorder, then start a new local session. The initial installation command adds the connection settings; subsequent work stays in the app.

### Codex CLI

Review and trust the new recorder in `/hooks`, then start a new session.

The connection tool does not automatically approve or skip the trust review. You may need to review it again if the settings or recorder definition change. The app's trust review feature is described in the [official app changelog](https://learn.chatgpt.com/docs/changelog), and shared settings and the scope of local tasks are covered in the [Codex Hooks guide](https://learn.chatgpt.com/docs/hooks). For Claude Code, see the [official Hooks guide](https://code.claude.com/docs/en/hooks).

## Install on another computer

Share the distribution file `agent-court-0.2.0.tgz`. The receiving computer also needs Node.js 20 or later and the tool you want to connect.

```bash
npm install --global ./agent-court-0.2.0.tgz
agent-court connect both
agent-court start
```

If you use only one tool, replace `both` with `claude` or `codex`. Complete the trust review and start a new session on that computer as described above.

You can create the distribution file locally with the following commands. This does not publish it to the npm registry.

```bash
mkdir -p output/release
npm pack --pack-destination output/release
```

For a separate guide for first-time users, see [Getting started](START-HERE.en.md).

## Disconnect

From the project folder:

```bash
npm run disconnect -- claude
npm run disconnect -- codex
npm run disconnect -- both
```

If you installed the distribution package:

```bash
agent-court disconnect both
```

This removes only the recorders added by Agent Court. Existing settings, other hooks, and saved activity records are retained. Connected recorders keep recording when the server is stopped, so disconnect them if you also want to stop recording.

## Commands and settings locations

| Command / option | Purpose |
| --- | --- |
| `agent-court connect claude\|codex\|both` | Add an observation recorder to the selected tools |
| `agent-court disconnect claude\|codex\|both` | Remove only Agent Court's recorders |
| `agent-court start` | Start the local map server |
| `agent-court help` | Show complete usage information |
| `--dry-run` | Display the connection or disconnection plan without changing files |
| `--claude-home /path` | Set the Claude Code settings folder |
| `--codex-home /path` | Set the Codex settings folder |
| `--data-dir /path` | Set the folder for activity records |
| `start --port 4547` | Set the server port |

The default connection settings files are `~/.claude/settings.json` for Claude Code and `~/.codex/hooks.json` for Codex. Custom settings folders and the associated environment variables are also supported.

Activity records are stored in **`~/.agent-court/data/`** by default. If the older `~/.claude-farm/data/` folder exists and the new records folder does not, the existing folder is reused. Files are not automatically moved or copied. When you specify `--data-dir`, that folder is used; specify the same path when connecting and starting the server.

If the Node.js installation or project folder moves, run `connect` again to update the recorder's executable paths.

## Recorded data and usage

The personal recorder stores timestamps, session IDs, working folders, tool names, and activity types. **It does not store prompts, conversation text, raw commands, patches, file contents, or tool output.** Records stay on your own computer.

Displaying the map makes no additional model or API calls and does not automatically add conversations. It uses your computer's CPU, memory, and storage. Work performed in Claude Code or Codex is counted according to the respective service's usage rules.

The dashboard listens only on `127.0.0.1` and does not send records to a shared team server. Display fonts are loaded from Google Fonts. Claude Code and Codex continue their usual communication with their own services.

Connected recorders keep recording while the server is off. When you restart it, it restores the most recent 12 hours of activity. Sessions with no activity for a long time disappear from the map.

## Court offices and activity types

The Korean names below match the labels in the interface.

| Court office | Activity shown |
| --- | --- |
| Royal Secretariat — 승정원 | Receiving instructions, organizing tasks, and summoning or coordinating subagents |
| Royal Library — 규장각 | Reading and searching documents, browsing the web, and querying external tools |
| Ministry of Works — 공조 | Writing or editing code and running general commands |
| Examination Grounds — 과거장 | Tests, type checks, and linting |
| Inspectorate — 사헌부 | Reviewing changes and Git status |
| Throne Hall — 어전 | Waiting for permission approval or a user response |
| Tavern — 주막 | Waiting after a response is complete |

Statuses are derived by classifying tool calls. The classification does not perfectly interpret every tool's meaning; tools with unknown names may appear under a default activity type.

## Troubleshooting

- **A session is missing:** Start work in a new session after connecting. Work completed before connecting is not imported.
- **Codex is missing:** Check that you have trusted the recorder and enabled the hooks in the app's Hooks settings or the CLI's `/hooks`. The connection currently applies to local tasks.
- **Records exist but the map is empty:** Check that the connection and server use the same records folder.
- **The port is in use:** Start the server on another port, such as `--port 4547`.
- **Node.js or the project folder moved:** Run `connect` again. You may need to review the changed recorder again in Codex.
- **The settings JSON is invalid:** The installer stops without overwriting the file. Repair the settings, then connect again.

## Development and validation

Only Node.js is needed to run the app. Development checks for PNG assets also need Python 3 and Pillow. Set them up initially as follows:

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements-dev.txt
```

```bash
npm test
npm run test:assets
```

These checks cover settings preservation, backups, repeated connections and disconnections, path quoting, compatibility with earlier connections, activity distinctions between both tools, pixel character rendering, and road movement.

To temporarily install a distribution package and check its installation commands, generated recorders, and server updates:

```bash
node scripts/validate-personal-package.mjs output/release/agent-court-0.2.0.tgz
```

This validation does not start AI work using a real account. Actual task integration with the Codex desktop app needs a separate check.

To preview the interface with simulated sessions:

```bash
FARM_NO_AGENTS=1 npm run demo
```

The demo opens at [http://localhost:4546](http://localhost:4546). Simulated records are saved in the project's `data-demo/` folder.

## Project structure

```text
agent-court/
├── bin/agent-court.mjs         # Connect, disconnect, and start commands
├── lib/install.mjs            # Settings preservation and recorder installation
├── hooks/farm-hook.mjs         # Observation recorder for Claude Code and Codex
├── server.mjs                 # Local records → status → browser
├── public/                    # Interface, map, and character assets
├── docs/START-HERE.md          # Guide for first-time users
├── tests/                     # Automated checks
├── scripts/                   # Demo and distribution validation
└── requirements-dev.txt       # Dependencies for development PNG checks
```

The Git repository's default branch is `main`, and its remote repository is [Magiof/agent-court](https://github.com/Magiof/agent-court). `.gitignore` excludes local records, tokens, secret files, and generated output. The distribution package includes selected runtime files, assets, and user guides.

## Existing records and development mode

The development command `npm start` reads the project's `data/` folder. The personal command `npm run local` reads the user's records folder. Keep the different records folders in mind when choosing how to start the app.

The existing Claude-only web order receiver (`hooks/farm-listen.mjs`) and media presentation tool (`bin/farm-show.mjs`) remain in the development folder but are not included in the personal distribution. Personal connections are observation-only, and recorders with older connection markers can also be updated or disconnected.

## Assets

The current scenery and seven character types were generated for this project using OpenAI ImageGen. Unused older images, fonts, and reference packs have been removed. See the [asset notices](../THIRD-PARTY-NOTICES.en.md) for details about the current assets and external fonts.
