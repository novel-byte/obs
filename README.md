# Cinematic Bookshelf

Render your book notes as an animated bookshelf inside Obsidian.

Every note you tag as a book becomes a spine on a shelf: a coloured, slightly
tilted volume with the title, the author, a star rating, a status badge, and a
progress strip showing how far through you are. The spines slide in with a
staggered animation, and the whole scene reacts to your pointer.

Two themes are included — **Cozy**, warm wood tones for reading by daylight,
and **Cybersigilism**, matte black with a neon particle field drifting behind
the shelf.

<!-- screenshot: the shelf with a handful of book spines, Cozy theme -->

## Installing

The plugin is not published to the community plugin directory yet. To try it
locally:

1. Clone this repository.
2. Run `npm install` and `npm run build`. The build writes `main.js`, which is
   the file Obsidian loads.
3. Copy `main.js`, `manifest.json` and `styles.css` into
   `<vault>/.obsidian/plugins/cinematic-bookshelf/`.
4. Enable **Cinematic Bookshelf** under *Settings → Community plugins*.

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
still pick up the occasional one filed elsewhere.

## Note frontmatter

Everything is optional. A note with no frontmatter at all still appears, using
its filename as the title.

```yaml
---
title: "The Pragmatic Programmer"
author: "David Thomas and Andrew Hunt"
status: reading        # reading, completed, or anything you like
rating: 5              # 1 to 5
color: "#8b5a2b"      # any CSS colour; a deterministic one is used if omitted
progress: 45           # 0 to 100
---
```

`color` is worth a note: leave it out and each spine gets a colour derived
from its title, so the same book always gets the same colour. Set it to
override that.

`progress` draws a thin strip up the spine. It is also what tells the plugin
how far through a book you are, so it is the one field worth keeping current.

## Settings

| Setting | Default | What it does |
| --- | --- | --- |
| **Theme** | Cozy | Cozy uses warm wood tones; Cybersigilism uses matte black with neon glow. |
| **Books folder** | `Books` | Path to the folder holding your book notes, relative to the vault root. `Reading/Library` works too. |
| **Book tag** | `book` | Tag identifying a book note, without the `#`. |
| **Enable animations** | on | Turns the entrance and hover animations off. |

Settings live under *Settings → Cinematic Bookshelf*.

## Accessibility

- The plugin respects `prefers-reduced-motion`. When your system asks for
  reduced motion, the entrance and hover animations are skipped and the spines
  appear in place. You can also turn animations off in the settings.
- Every spine is a real focusable control: it can be reached with the keyboard
  and opened with <kbd>Enter</kbd> or <kbd>Space</kbd>.
- The progress strip carries an `aria-label` with the percentage, and the
  status badge one with the status.

## How it works

The bookshelf is an Obsidian `ItemView` that renders into the sidebar. The
scene is [Three.js](https://threejs.org/), used for the perspective grid and
the particle field behind the Cybersigilism theme, and
[anime.js](https://animejs.com/) drives the entrance stagger and the hover
lift.

The spine elements themselves are ordinary DOM nodes rather than 3D meshes.
That keeps the text selectable, the accessibility behaviour intact, and the
rendering cheap, while Three.js handles only the depth behind them.

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
which pulls in `bookshelfView.ts` and `settings.ts`. Three.js and anime.js are
bundled in; `obsidian` is left external, since Obsidian provides it at
runtime.

| File | |
| --- | --- |
| `main.ts` | The plugin: lifecycle, settings, commands, and vault event wiring. |
| `bookshelfView.ts` | The view: the Three.js scene, the spine builder, and the book data pipeline. |
| `settings.ts` | The settings tab and the settings type. |
| `main.js` | The bundled output Obsidian loads. Committed so the plugin can be installed without a build step. |
| `styles.css` | The shelf styling, with the two themes as variable blocks. |
| `esbuild.config.mjs` | The build configuration. |

## Licence

MIT. Three.js and anime.js are bundled under their own licences, which are
reproduced at the end of `main.js`.
