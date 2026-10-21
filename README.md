# Cinematic Bookshelf

Render your book notes as an animated bookshelf inside Obsidian.

Every note you tag as a book becomes a spine on a shelf: a coloured, slightly
tilted volume with the title, the author, a star rating, a status badge, and a
fill level showing how far through you are. The spines slide in with a
staggered animation, and the whole scene reacts to your pointer.

The shelf is drawn in frosted glass: each spine is a translucent pane with a
light-catching edge, floating over a soft gradient. Books further apart are
more transparent and more blurred, so the shelf has real depth.

Two themes are included — **Cozy**, warm wood tones for reading by daylight,
and **Cybersigilism**, matte black with a neon particle field drifting behind
the glass.

<!-- screenshot: the shelf with a handful of book spines, Cozy theme -->

## Installing

The plugin is not published to the community plugin directory yet. To try it
locally:

1. Clone this repository.
2. Run `npm install` and `npm run build`. The build writes `main.js`, which is
   the file Obsidian loads.
3. Copy `main.js`, `manifest.json` and `styles.css` into
   `<vault>/.obsidian/plugins/cinematic-bookshelf/`.
4. Enable **Cinematic Bookshelf** under *Settings > Community plugins*.

Rebuild after any change with `npm run dev`, which watches the source and
rebuilds on save.

## Using it

Once enabled, the bookshelf opens in the right sidebar. The ribbon icon, or the
**Open Cinematic Bookshelf** command in the command palette, brings it back if
you close it.

A note becomes a book when it is either:

- inside the folder named in the **Books folder** setting, or
- tagged with the tag in the **Book tag** setting — anywhere in the vault, as
  an inline `#book` or in the note's frontmatter.

Both rules are applied together, so you can keep most books in one folder and
still pick up the occasional one filed elsewhere. Clearing the folder setting
leaves the tag as the only rule.

### The shelf controls

The header carries the controls:

- **Search** filters by title, author or series as you type. <kbd>Esc</kbd>
  clears it.
- **Filter chips** narrow the shelf to all books, the ones you are reading,
  the ones you have finished, or the ones you have not rated.
- **Sort** reorders the shelf by title, author, rating, progress or the date
  the note was added.

## Note frontmatter

Everything is optional. A note with no frontmatter at all still appears, using
its filename as the title.

```yaml
---
title: "The Pragmatic Programmer"
author: "David Thomas and Andrew Hunt"
status: reading        # reading, completed, paused, abandoned, or your own
rating: 5              # 1 to 5
color: "#8b5a2b"      # any CSS colour; a deterministic one is used if omitted
progress: 45           # 0 to 100
series: "The Expanse"  # books sharing a series are grouped on their own row
position: 2            # the book's place in the series
---
```

`color` is worth a note: leave it out and each spine gets a colour derived
from its title, so the same book always gets the same colour. Set it to
override that. Any CSS colour works — hex, `rgb()`, `hsl()` or a named
colour.

`progress` fills the spine from the bottom, so it is the one field worth
keeping current.

`series` and `position` group a multi-book series into its own row, ordered
by position. Set `series` on each book and `position` to its number in the
series.

## Settings

| Setting | Default | What it does |
| --- | --- | --- |
| **Theme** | Cozy | Cozy uses warm wood tones; Cybersigilism uses matte black with neon glow. |
| **Books folder** | `Books` | Path to the folder holding your book notes, relative to the vault root. `Reading/Library` works too. Leave empty to use the tag alone. |
| **Book tag** | `book` | Tag identifying a book note, without the `#`. |
| **Sort by** | Title | The order the books appear in. |
| **Show** | All books | Which books are on the shelf. |
| **Group by series** | on | Give books sharing a `series` their own row. |
| **Track reading** | on | Log sessions from the shelf, and show streaks, per-book activity and the weekly heatmap. |
| **Days of activity per book** | 30 | How many days the dots down a spine cover. |
| **Weeks in the heatmap** | 52 | How many weeks the heatmap above the shelf covers. 52 is a year. |
| **Frosted glass** | on | Draw the spines as frosted panels. Turn off for a solid shelf. |
| **Follow the Obsidian theme** | on | Take the base colours from Obsidian's own theme. |
| **Enable animations** | on | Turns the entrance and hover animations off. |
| **Statuses** | reading, completed, paused, abandoned | The statuses a note can carry, and the colour each is drawn in. Add your own, or remove ones you do not use. |

Settings live under *Settings > Cinematic Bookshelf*.

## Tracking what you read

The shelf is also a reading tracker. Click a spine and a **log bar** appears
over the shelf, where you record the session.

**Logging a session.** Enter the minutes read, pick a status, set a rating,
and press **Log**. The date defaults to today but can be set to a past day, so
a session from a paper book read last Tuesday can be logged afterwards.

**Quick log.** Right-click a spine for a menu offering 15, 30 or 60 minutes,
*Mark finished*, and *Open note* — all without opening the note.

**What gets written where.** The status, rating and last-read date go into the
note's own frontmatter, so they travel with the note:

```yaml
---
title: "The Pragmatic Programmer"
status: reading
rating: 5
lastRead: 2026-10-20
---
```

The sessions themselves are kept in the plugin's own data file, so they never
clutter your notes. Obsidian backs that file up along with the vault.

**What the shelf then shows.**

- **A summary strip above the shelf** — the current streak in days, the
  minutes read this week, how many books are finished, and a **52-week
  heatmap** in the shape of a contribution graph.
- **Heat dots down each spine** — one per day you read that book, over the
  last 30 days, shaded by how long each session was.
- **A streak marker** on a spine you have read on consecutive days.

### Exporting

*Settings > Cinematic Bookshelf > Export the reading log* writes every logged
session to a JSON file in the vault, with per-book totals. Another tool can
pick up your reading history from it.

## Accessibility

- The plugin respects `prefers-reduced-motion`. When your system asks for
  reduced motion, the entrance and hover animations are skipped and the spines
  appear in place. You can also turn animations off in the settings.
- The plugin also respects `prefers-reduced-transparency`, replacing the
  frosted panels with solid ones so the text stays legible.
- Every spine is a real focusable control: it can be reached with the keyboard
  and opened with <kbd>Enter</kbd> or <kbd>Space</kbd>.
- Opening a book splits it into a new pane rather than replacing the shelf, so
  the shelf stays in view.
- The progress fill carries an `aria-label` with the percentage, the status
  badge one with the status, the rating one with the score, and the heatmap
  one describing the whole year.
- The summary heatmap is a single image with a label, so a screen reader
  hears "Reading activity over the last 52 weeks, 3 day streak" rather than
  364 empty cells.

## How it works

The bookshelf is an Obsidian `ItemView` that renders into the sidebar. The
scene is [Three.js](https://threejs.org/), used for the perspective grid and
the particle field behind the Cybersigilism theme, and
[anime.js](https://animejs.com/) drives the entrance stagger and the hover
lift.

The spine elements themselves are ordinary DOM nodes rather than 3D meshes.
That keeps the text selectable, the accessibility behaviour intact, and the
rendering cheap, while Three.js handles only the depth behind them. The
frosted effect is CSS `backdrop-filter`, applied to a few layers rather than
to every spine, because blurring many elements is expensive.

Colours are parsed into HSL so that a colour given in a note can be given in
any CSS notation, and the darker and lighter variants the spine gradient uses
are derived from that.

The view listens for vault create, delete and rename events, and for metadata
cache changes, and re-renders with a 500ms debounce so that moving a file
between folders updates the shelf without thrashing.

## Building from source

```sh
npm install
npm run dev      # watch and rebuild
npm run build    # single production build
npm run typecheck
```

The build uses [esbuild](https://esbuild.github.io/) and bundles `main.ts`,
which pulls in `bookshelfView.ts`, `settings.ts`, `colour.ts` and `log.ts`. Three.js and
anime.js are bundled in; `obsidian` is left external, since Obsidian provides
it at runtime.

| File | |
| --- | --- |
| `main.ts` | The plugin: lifecycle, settings, commands, and vault event wiring. |
| `bookshelfView.ts` | The view: the Three.js scene, the spine builder, the toolbar, and the book data pipeline. |
| `settings.ts` | The settings tab, the settings type, and the status list. |
| `colour.ts` | Colour parsing and the deterministic hash used for spine heights and colours. |
| `log.ts` | The reading log: sessions, streaks, heatmaps and the export. |
| `main.js` | The bundled output Obsidian loads. Committed so the plugin can be installed without a build step. |
| `styles.css` | The shelf styling, with the two themes as variable blocks. |
| `esbuild.config.mjs` | The build configuration. |
| `test-log.ts` | Tests for the reading log. Run with `node --test test-log.ts`. |

## Licence

MIT. Three.js and anime.js are bundled under their own licences, which are
reproduced at the end of `main.js`.
