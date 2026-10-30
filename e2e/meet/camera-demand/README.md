# Shared Meet media fixture

`client.js`, `index.html` and `tiles.js` supply the isolated publishers and receiver
used by `../network/run.mjs`. Run that entry point; this directory is not a
standalone camera-subscription audit in this branch.

The fixture creates four camera publishers, an optional synthetic screen and one
oscillator audio source, then connects the production Meet receiver. It exposes
publisher inventory and sampled RTP/decode counters for independent assertions.
The default presentation tiles are stubs. Network video mode substitutes real
participant tiles and production sender code with checked fixture patches.
It does not run Frappe authentication or a full app session.

Install root/frontend/e2e/SFU dependencies and Playwright Chromium first.
If the packaged mediasoup worker is incompatible with the host, build it from the
installed mediasoup package directory using
`MEDIASOUP_OUT_DIR=/tmp/meet-camera-worker node npm-scripts.mjs worker:build`,
with the package's Python/build prerequisites installed. Set
`MEDIASOUP_WORKER_BIN=/tmp/meet-camera-worker/Release/mediasoup-worker` when
running the network harness. See its README for ports, profiles and limits.
