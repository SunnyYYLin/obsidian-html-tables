# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.0.3] - 2026-07-21

### Fixed

- Mouse clicks now correctly position the text cursor inside a cell that is being edited (double-click to edit). Previously, only arrow keys worked.
- Plugin no longer applies any enhancements to tables outside the main note editor area (e.g. tables rendered by third-party plugins such as Claudian in the sidebar). Previously, those tables received resize handles, double-click editing, and context menus, which could corrupt their display.
- HTML table cells containing LaTeX math formulas (e.g. `$\mathbb{E}[...]$`) are no longer blanked out after conversion from Markdown. The plugin now preserves cells already rendered by Obsidian's KaTeX engine and stores the original raw text in `data-better-raw` so formulas survive round-trips.

## [0.0.2] - 2026-07-18

Initial public release with core features:

- Table header row and header column support
- Cell merging (rowspan / colspan)
- Column resizing by drag, double-click auto-fit, and equalize
- Table captions
- Basic formula evaluation (`=expr`)
- Multiline cells (`\n`)
- Horizontal and vertical cell alignment
- Right-click context menu for table operations
- Floating action button on table hover
- Convert between Markdown and HTML table format
- Live preview (CM6) and Reading mode support

[0.0.3]: https://github.com/SunnyYYLin/obsidian-html-tables/compare/0.0.2...0.0.3
[0.0.2]: https://github.com/SunnyYYLin/obsidian-html-tables/releases/tag/0.0.2
