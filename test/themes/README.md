# Local themes for the preview harnesses

Drop a community theme's `theme.css` in this folder as `<name>.css`, then load a
harness with `?theme=<name>`:

```text
test/chips-preview.html?theme=bookcloth
test/reminder-preview.html?theme=bookcloth&light
```

The harness inserts it between Obsidian's default variables and the plugin's own
stylesheet, which is the order Obsidian loads them in — so what you see is what
that theme will do to the chips.

`npm run check:contrast` picks up every `*.css` here automatically and measures
each chip variant against WCAG AA in both modes, so checking the plugin against
a theme is a matter of copying one file in.

## Why nothing is committed here

`*.css` in this folder is gitignored. A theme is a separate project with its own
repository and release cycle; vendoring a copy would add a six-figure blob to
this repo that silently goes stale. The screenshots in the README were generated
this way and are committed, so nothing is lost by keeping the source out.
