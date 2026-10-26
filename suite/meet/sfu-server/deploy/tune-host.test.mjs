// Exercise host provisioning with fake system commands; never touch the test host's sysctls.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

for (const [current, expected] of [
	['212992', '8388608'],
	['16777216', '16777216'],
]) {
	test(`provisions the buffer ceiling without lowering ${current}`, () => {
		const directory = mkdtempSync(join(tmpdir(), 'meet-udp-test-'));
		try {
			writeFileSync(
				join(directory, 'sysctl'),
				`#!/bin/sh
if [ "$1" = "-n" ]; then
    echo ${current}
else
    test "$1" = "-p" && test "$2" = /etc/sysctl.d/60-meet-sfu.conf
fi
`,
				{ mode: 0o755 },
			);
			writeFileSync(
				join(directory, 'install'),
				`#!/bin/sh
test "$1" = "-m" && test "$2" = "0644" && test "$4" = /etc/sysctl.d/60-meet-sfu.conf || exit 1
cp "$3" "$TEST_CONFIG"
`,
				{ mode: 0o755 },
			);
			const config = join(directory, 'config');
			const result = spawnSync(
				'bash',
				[new URL('./tune-host.sh', import.meta.url).pathname],
				{
					env: {
						...process.env,
						PATH: `${directory}:${process.env.PATH}`,
						TEST_CONFIG: config,
					},
					encoding: 'utf8',
				},
			);
			assert.equal(result.status, 0, result.stderr);
			assert.match(
				readFileSync(config, 'utf8'),
				new RegExp(`^net.core.rmem_max = ${expected}$`, 'm'),
			);
			assert.doesNotMatch(
				readFileSync(config, 'utf8'),
				/rmem_default|netdev_max_backlog/,
			);
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});
}
