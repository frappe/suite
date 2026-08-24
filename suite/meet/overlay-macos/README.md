# Suite Meet Overlay for macOS

Suite Meet Overlay shows viewer annotations on the presenter desktop.

The app has no Dock icon, menu bar item, settings window, or controls. Suite Meet starts the app when the presenter shares a screen. The app exits when the screen share stops or the SFU connection closes.

Only the presenter installs the app. Viewers annotate from the Suite Meet web app.

## Requirements

- macOS 13 or later
- Apple Command Line Tools
- A running Suite Meet SFU with annotation overlay support

## Install a local build

Run this command from the overlay directory:

```sh
./scripts/install-local.sh
```

The script builds an ad hoc signed app. It installs the app in `/Applications` and registers the `frappe-meet-overlay` URL scheme.

## Test the app

1. Restart the Suite Meet SFU.
2. Reload the Suite Meet page.
3. Join one meeting from two browser sessions.
4. Start a full-screen share from the presenter session.
5. Approve the browser request to open Suite Meet Overlay.
6. Draw on the shared screen from the viewer session.
7. Confirm that the drawing appears on the presenter desktop.
8. Stop the screen share.
9. Confirm that the app process exits.

The app selects the display whose pixel size best matches the captured track. It uses the main display when capture metadata is unavailable.

## Make a release package

Run this command:

```sh
./scripts/package-release.sh 0.1.0
```

The script creates a ZIP archive and a Homebrew Cask in `dist/`. Upload the ZIP to the matching GitHub release before publishing the Cask.

Users can then install the published package:

```sh
brew install --cask suite-meet-overlay
```

## Security

The browser never sends the participant JWT to the app. The SFU gives the presenter a one-time overlay grant. The grant expires after 60 seconds and only subscribes to one screen producer.

The overlay window ignores mouse input. The app marks the window as non-shareable to prevent duplicate annotations in the captured video.
