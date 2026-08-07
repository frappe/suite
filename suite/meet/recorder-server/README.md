# Meet recorder server

## Chromium integration test

Build the recorder browser assets, then run the recorder-server tests:

```sh
yarn --cwd frontend build:recorder
CHROMIUM_EXECUTABLE=/usr/bin/chromium RECORDER_CHROMIUM_NO_SANDBOX=1 yarn --cwd suite/meet/recorder-server test
```

The executable and no-sandbox setting above match the recorder Docker image. Locally,
the test also detects conventional Chrome/Chromium installation paths and skips only
when no executable is available. This test intentionally uses an empty producer sync;
it verifies signaling and receive-transport construction, not media consumption or
artifact generation against a real mediasoup router.
