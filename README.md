# Floating Top Bar

A GNOME Shell extension that floats the top bar. It leaves a gap around the bar, rounds the corners, makes the bar a little narrower, and can draw a soft shadow. The size of each of those is in the extension settings.

The clock stays centered, and the bar stays on the primary monitor. This is the normal top bar, not a separate dock.

Tested on GNOME Shell 51.

## Settings

Open **Floating Top Bar** in the Extensions app, or run:

```bash
gnome-extensions prefs floating-top-bar@juanton.local
```

| Setting | Default | Effect |
|---|---|---|
| Top margin | 10 px | Gap between the top of the screen and the bar |
| Side margin | 48 px | How much narrower the bar is |
| Bottom margin | 8 px | Gap between the bar and maximized windows |
| Corner radius | 14 px | Rounded corner size |
| Shadow | On | Soft shadow under the bar |

**Reset** restores those defaults. Changes apply immediately.

If [Blur my Shell](https://github.com/aunetx/blur-my-shell) is installed and has a pipeline named `pipeline_top_bar`, the corner radius is copied onto that pipeline’s corner effect. Other pipelines, including the dock, are left alone.

## Install

```bash
git clone https://github.com/juanton69/floating-top-bar.git \
  ~/.local/share/gnome-shell/extensions/floating-top-bar@juanton.local
glib-compile-schemas ~/.local/share/gnome-shell/extensions/floating-top-bar@juanton.local/schemas
gnome-extensions enable floating-top-bar@juanton.local
```

Log out and back in once. GNOME Shell 51 loads a new extension directory at login.

The bar style is applied again after GNOME finishes startup, so it survives login when Blur my Shell or User Themes restyle the panel.

## License

GPL-3.0-or-later. See [LICENSE](LICENSE).
