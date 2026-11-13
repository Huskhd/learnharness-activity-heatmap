# Activity heatmap for LearnHarness

A community plugin for [LearnHarness](https://github.com/amosblomqvist/learnharness) that shows which days you studied, how much, and how consistent you have been.

- **Year grid:** one square per day, darker for more activity. Click a day to see its sessions and jump to them.
- **Streaks and totals:** current streak, longest streak, active days, actions and your best day.
- **About you:** facts that update as you study, such as focused time, words written in your own explanations, questions answered with the next milestone, and when you tend to study.
- **Rhythm charts:** activity by weekday and by hour of day.
- **Options:** filter by Teaching or Practice sessions, and choose one of five colours.

An "action" is a message you sent, a question you answered, or a practice submission.

<!-- Add a screenshot here: ![Activity heatmap](screenshot.png) -->

## Requirements

- LearnHarness 0.6.0 or newer (desktop app).
- Nothing else. The plugin is plain JavaScript, so there is no build step and you do not need Node.js or Git.

## Install

1. **Download the plugin.** Go to the [Releases page](https://github.com/Huskhd/learnharness-activity-heatmap/releases) and download `activity-heatmap-1.0.0.zip`.
2. **Find your plugins folder.** In LearnHarness, open **Settings → Community plugins** and copy the plugins directory path shown there. The usual locations are:

   | System | Plugins folder |
   | --- | --- |
   | Windows | `%APPDATA%\LearnHarness\data\plugins` |
   | macOS | `~/Library/Application Support/LearnHarness/data/plugins` |
   | Linux | `~/.config/LearnHarness/data/plugins` |

3. **Extract the zip into that folder.** You should end up with a folder named exactly `activity-heatmap` that contains a `dist` folder:

   ```text
   plugins/
     activity-heatmap/
       dist/
         manifest.json
         main.js
         backend.cjs
         styles.css
   ```

   The folder must be called `activity-heatmap`. If your unzip tool added an extra layer (for example `activity-heatmap-1.0.0/activity-heatmap/`), move the inner `activity-heatmap` folder up into `plugins`.
4. **Refresh the list.** Back in **Settings → Community plugins**, click **Refresh**. "Activity heatmap" appears in the list, switched off.
5. **Enable it.** Turn the plugin on.
6. **Restart LearnHarness.** Close the app completely and open it again.
7. **Open it.** Click **Activity heatmap** in the left sidebar. There is also a button on the graph screen.

If you cloned or downloaded the repository instead of the release zip, copy its `dist` folder to `plugins/activity-heatmap/dist/` and continue from step 4.

## Update

1. Download the new release zip.
2. Replace the `dist` folder inside `plugins/activity-heatmap/` with the new one. Leave the `data` folder next to it alone; it holds your colour and filter choice.
3. Restart LearnHarness.

## Uninstall

1. Turn the plugin off in **Settings → Community plugins**.
2. Close LearnHarness and delete the `plugins/activity-heatmap` folder.

Your sessions and knowledge graph are not affected.

## Troubleshooting

- **The plugin is not in the list.** Check that `manifest.json` is at `plugins/activity-heatmap/dist/manifest.json`, with no extra folder in between, then click Refresh.
- **It is listed with a version error.** Update LearnHarness to 0.6.0 or newer.
- **Enabled, but nothing in the sidebar.** Restart LearnHarness; plugin code only loads at launch.
- **The page says "No activity yet".** Answer a question or send a message in any session, then open the page again.

## Privacy and security

LearnHarness plugins are trusted local code: they run inside the app with the same access to your computer as the app itself. Only install plugins you trust. This one is four short, unminified files, so you can read them before installing.

What this plugin does:

- **Reads** your saved sessions and the size of your knowledge graph, on your own machine.
- **Never changes** your sessions, graph or settings.
- **Writes one file:** `plugins/activity-heatmap/data/prefs.json`, holding your colour and filter choice.
- **Makes no network requests.** Nothing leaves your computer, and there is no analytics or tracking.
- **Counts words, never copies them.** The text of your answers stays in LearnHarness; the page only receives timestamps and counts.

## How the numbers are worked out

- **Streak:** consecutive calendar days with at least one action, in your local time zone. A streak stays alive until a full day passes with no activity.
- **Focused time:** the time between consecutive actions, ignoring gaps longer than 15 minutes. It is an estimate.
- **Square colour:** each day is shaded relative to your busiest day.

## License

[MIT](LICENSE)

This is an independent community plugin. It is not part of, or endorsed by, the LearnHarness project.
