# Beu MultiTool

A Windows desktop utility for batch text-file operations — find duplicates, split files, strip passwords from `user:pass` lists, randomize lines, and more.
![Main Screen](https://beu.evaded.tax/i/rnsvpqsac6o2d.png)
> **Windows-only.** Not built or tested for macOS / Linux.

## Features

| Tool | What it does |
|---|---|
| **Find Duplicates** | Surface lines that appear more than once — one file, or across two (toggle in-tool) |
| **Find Non-Duplicates** | Surface lines that appear exactly once — one file, or across two (toggle in-tool) |
| **Remove Passwords** | Strip `:password` from each line of a `user:pass` list |
| **Split by Number** | Split a file into `N` evenly-sized parts (use N=2 to halve) |
| **Randomize List** | Shuffle lines into random order |

All output lands in a single `output/` folder with timestamped filenames, configurable from the **Settings** tab.

## UX niceties

- **Drag-and-drop** anywhere — drop a file onto a tool card on the **Tools** page to open that tool with the file pre-loaded, or drop directly into the input panel
- **Ctrl + Enter** runs the current tool
- **Esc** or **Mouse 4** goes back; **Mouse 5** goes forward
- **Results** tab lists every saved output file, auto-refreshes when files change, and has reveal-in-explorer + clear-all
- Frameless dark UI, single fixed window (Ctrl+`+/-/0` zoom is disabled)

## Install

Two builds are produced for every release:

| File | What it is |
|---|---|
| `BeuMultiTool-Setup-x.y.z.exe` | NSIS installer with shortcuts. Output defaults to `Documents\BeuMultiTool\output`. |
| `BeuMultiTool.exe` | Portable single-file. Just double-click. Output lands next to the `.exe`. |

Either way you can change the output folder from **Settings**.

## Build from source

Requires **Node 22+** and **npm** on Windows.

```powershell
npm install
npm run dev          # development with hot module reload
npm run build        # bundle main + preload + renderer into out/
npm run build:win    # produce release\BeuMultiTool.exe
npm run icon         # regenerate icon.ico from resources/icon.svg
```

The build is targeted at `win` only — there are no macOS or Linux build scripts.

## Tech stack

- **Electron** — frameless desktop window
- **electron-vite** — Vite-driven bundling for main / preload / renderer
- **React + TypeScript** — renderer
- **Tailwind CSS** — styling
- **electron-builder** — produces the portable `.exe`

## Project layout

```
src/main/         Electron main process — window, IPC, file watcher
src/preload/      Type-safe bridge exposed to the renderer as window.api
src/renderer/     React app — sidebar, pages, components
resources/        Icons (icon.svg is the source of truth)
scripts/          Build helpers (icon generator)
```

## CI / Release

GitHub Actions builds the portable `.exe` on tag push. Workflow lives at `.github/workflows/release.yml` and runs only on `windows-latest` — there are no cross-platform jobs.

To cut a release:

```powershell
git tag v2.2.0
git push origin v2.2.0
```

The workflow runs `npm ci && npm run build:win` and attaches `release\BeuMultiTool.exe` to the GitHub release.
