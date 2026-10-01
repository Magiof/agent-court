# Getting started with Agent Court

[한국어](START-HERE.md) · **English**

[← Project overview](../README.en.md)

Agent Court is a personal app that shows the progress of your Claude Code and Codex sessions in a Joseon-era village. Install it on your own computer and keep using your existing accounts and workflow.

## Install and connect

You need Node.js 20 or later and an installed copy of Claude Code or Codex. Installation has been verified on macOS. The installer also supports Linux, but Linux installation has not been tested. Windows is unsupported.

To install from GitHub, run the following in a directory of your choice:

```bash
git clone https://github.com/Magiof/agent-court.git
cd agent-court
npm install --global .
```

If you have downloaded a release archive, you can also install it from the directory where you saved the file:

```bash
npm install --global ./agent-court-0.2.0.tgz
```

To connect both tools:

```bash
agent-court connect both
```

If you only use one tool, replace `both` with `claude` or `codex`.

The connection tool adds the activity recorder while preserving your existing settings. It leaves a backup beside each changed file. Open a new Claude Code session so it can load the connection settings.

In the Codex desktop app, review and trust the new recorder in the app's Hooks settings. If you use the CLI, check it with `/hooks`. The connection tool does not bypass this review. After trusting the recorder, start a new local session. The [official app changelog](https://learn.chatgpt.com/docs/changelog) describes the app's trust review, and the [Codex Hooks guide](https://learn.chatgpt.com/docs/hooks) explains the shared configuration location.

The `agent-court` command manages connections and starts the map. Continue doing your Codex work in your usual CLI or desktop app. The recorder currently supports local work running on the same computer. Work running in the cloud or on another computer is outside the connection scope.

Validation so far: global installation, preservation of existing settings, execution of both recorders, updates to the server and map, and disconnection were checked in a temporary environment. Configuration recognition was also verified in Codex CLI 0.154.0. **Running an actual task in the Codex desktop app and seeing it appear on the map has not yet been verified.**

## Start the map

```bash
agent-court start
```

Open `http://localhost:4545` in your browser and work as usual. Characters move between government offices according to the read, edit, test, approval-waiting, and response-completed events received by the recorder. The session roster distinguishes Claude Code from Codex.

The personal installation is for observing activity. Give work instructions and approve permissions in the Claude Code or Codex interface you already use. To stop the map, press Ctrl+C in the terminal where you started it.

## What is stored

Timestamps, session IDs, working directories, tool names, and activity types are stored on your computer in `~/.agent-court/data/`. If the new records directory does not exist and `~/.claude-farm/data/` already exists, the existing directory is reused automatically. Existing records are not moved or deleted. Check the `Records:` output of the connection command for the actual records directory.

The personal recorder does not newly store prompts, conversation text, raw commands, patch contents, file contents, or tool output. Reusing an existing directory does not change the contents of previously stored records.

The dashboard server listens only on `127.0.0.1`. There is no feature for sending activity records to a shared server. The screen loads fonts from Google Fonts, and the connected Claude Code and Codex tools continue communicating with their own services as before.

Connected recorders keep recording when the server is off. When you restart the map, it restores the last 12 hours of activity. Sessions with no recent activity eventually disappear from the map.

The recorders and map do not make additional model calls. The recorders, server, and browser use CPU and memory, and event records accumulate on disk. Resource use depends on activity frequency and your environment; it has not been separately measured for this release.

## Disconnect

```bash
agent-court disconnect both
```

To disconnect just one tool, replace `both` with `claude` or `codex`. This removes only the recorder added by this app. Other hooks, existing settings, and stored records are preserved. If a definition you already trusted in Codex changes, review it in the app's Hooks settings or with `/hooks` in the CLI.

## When a session does not appear

- Start a simple task in a new session. Work completed before connecting is not imported automatically.
- In Codex, check the app's Hooks settings or the CLI's `/hooks` to confirm that you have trusted the recorder and enabled hooks. You need a version that supports hooks, and the work must run locally. Configuration recognition was verified in Codex CLI 0.154.0.
- In Claude Code, use `/hooks` to confirm that the recorder is registered. See the official [Claude Code Hooks guide](https://code.claude.com/docs/en/hooks).
- If the Node.js installation location or the app's installation directory has changed, run `connect` again to update the paths.
- If another app is using port 4545, start the map with `agent-court start --port 4547` and open `http://localhost:4547`.

To preview the configuration plan before making changes, use `agent-court connect both --dry-run`.
If you need custom configuration locations, specify `--claude-home`, `--codex-home`, or `--data-dir`. If you used a custom records directory when connecting, pass the same `--data-dir` when starting the map.
