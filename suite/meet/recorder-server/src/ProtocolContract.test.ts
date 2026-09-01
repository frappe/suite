import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseCommandClaims, validUtcTimestamp } from './AuthManager.js';
import { grantBody, reserveBody, stopBody } from './app.js';
import {
	parseFinalizationResponse,
	parseStatusResponse,
} from './CallbackClient.js';
import {
	parseCapturePrepared,
	parseCaptureStartedAccepted,
	parseRendererLifecycle,
	parseRendererPublicKeyReady,
} from './RendererBridge.js';

type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject;
type JsonObject = { [key: string]: JsonValue };

const contract = JSON.parse(
	readFileSync(
		resolve(process.cwd(), '../recording/contracts/v1.json'),
		'utf8',
	),
) as {
	protocol_version: number;
	accepted_protocol_versions: number[];
	vocabularies: {
		frappe_recording_states: string[];
		renderer_reason_codes: string[];
		[key: string]: string[];
	};
	vectors: {
		timestamps: { accepted: JsonValue[]; rejected: JsonValue[] };
		renderer_lifecycle: {
			accepted: JsonObject[];
			rejected: JsonObject[];
		};
		renderer_public_key_ready: {
			accepted: JsonObject[];
			rejected: JsonObject[];
		};
		renderer_capture_prepared: {
			accepted: JsonObject[];
			rejected: JsonObject[];
		};
		renderer_capture_started_accepted: {
			accepted: JsonObject[];
			rejected: JsonObject[];
		};
		callback_status_responses: {
			accepted: JsonObject[];
			rejected: JsonObject[];
		};
		command_claims: { accepted: JsonObject[]; rejected: JsonObject[] };
		command_requests: {
			accepted: { operation: string; body: JsonObject }[];
			rejected: { operation: string; body: JsonObject }[];
		};
		finite_values: { [key: string]: string[] };
	};
};

const finalizationContract = JSON.parse(
	readFileSync(
		resolve(process.cwd(), '../recording/contracts/finalization-v1.json'),
		'utf8',
	),
) as {
	protocol_version: number;
	vocabularies: { actions: string[]; terminal_results: string[] };
	vectors: {
		status_responses: { accepted: JsonObject[]; rejected: JsonObject[] };
	};
};

const commandBodyParser = (operation: string) => {
	if (operation === 'reserve') return reserveBody;
	if (operation === 'grant') return grantBody;
	if (operation === 'stop') return stopBody;
	throw new Error(`unsupported command operation: ${operation}`);
};

describe('recording protocol contract v1', () => {
	it('accepts only canonical lifecycle timestamps', () => {
		for (const value of contract.vectors.timestamps.accepted)
			expect(validUtcTimestamp(value)).toBe(true);
		for (const value of contract.vectors.timestamps.rejected)
			expect(validUtcTimestamp(value)).toBe(false);
	});

	it('runs shared lifecycle vectors through the production parser', () => {
		for (const value of contract.vectors.renderer_lifecycle.accepted)
			expect(parseRendererLifecycle(value)).toBeDefined();
		for (const value of contract.vectors.renderer_lifecycle.rejected)
			expect(parseRendererLifecycle(value)).toBeUndefined();
	});

	it('runs shared renderer public-key vectors through the production parser', () => {
		for (const value of contract.vectors.renderer_public_key_ready.accepted)
			expect(parseRendererPublicKeyReady(value)).not.toBeNull();
		for (const value of contract.vectors.renderer_public_key_ready.rejected)
			expect(parseRendererPublicKeyReady(value)).toBeNull();
	});

	it('runs shared capture acknowledgement vectors through production parsers', () => {
		for (const value of contract.vectors.renderer_capture_prepared.accepted)
			expect(parseCapturePrepared(value)).toBeDefined();
		for (const value of contract.vectors.renderer_capture_prepared.rejected)
			expect(parseCapturePrepared(value)).toBeUndefined();
		for (const value of contract.vectors.renderer_capture_started_accepted
			.accepted)
			expect(parseCaptureStartedAccepted(value)).toBeDefined();
		for (const value of contract.vectors.renderer_capture_started_accepted
			.rejected)
			expect(parseCaptureStartedAccepted(value)).toBeUndefined();
	});

	it('covers every finite renderer reason code', () => {
		const covered = contract.vectors.renderer_lifecycle.accepted
			.map((value) => value.reason_code)
			.filter((value): value is string => typeof value === 'string');
		expect(new Set(covered)).toEqual(
			new Set(contract.vocabularies.renderer_reason_codes),
		);
		expect(contract.accepted_protocol_versions).toEqual([
			contract.protocol_version,
		]);
	});

	it('runs every finite Frappe state through the callback response parser', () => {
		for (const value of contract.vectors.callback_status_responses.accepted)
			expect(parseStatusResponse(value)).toEqual(value);
		for (const value of contract.vectors.callback_status_responses.rejected)
			expect(() => parseStatusResponse(value)).toThrow();
		expect(
			contract.vectors.callback_status_responses.accepted.map(
				(value) => value.status,
			),
		).toEqual(contract.vocabularies.frappe_recording_states);
	});

	it('runs shared command claims and request vectors through production parsers', () => {
		for (const value of contract.vectors.command_claims.accepted)
			expect(parseCommandClaims(value)).toBeDefined();
		for (const value of contract.vectors.command_claims.rejected)
			expect(() => parseCommandClaims(value)).toThrow();
		for (const value of contract.vectors.command_requests.accepted)
			expect(commandBodyParser(value.operation)(value.body)).toBe(true);
		for (const value of contract.vectors.command_requests.rejected)
			expect(commandBodyParser(value.operation)(value.body)).toBe(false);
		const base = contract.vectors.command_claims.accepted[0];
		for (const operation of contract.vectors.finite_values.command_operations)
			expect(parseCommandClaims({ ...base, operation }).operation).toBe(
				operation,
			);
	});

	it('enumerates every finite vocabulary in executable vectors', () => {
		expect(contract.vectors.finite_values).toEqual(contract.vocabularies);
	});
});

describe('recording finalization contract v1', () => {
	it('runs every shared response vector through the production parser', () => {
		for (const value of finalizationContract.vectors.status_responses.accepted)
			expect(parseFinalizationResponse(value)).toEqual(value);
		for (const value of finalizationContract.vectors.status_responses.rejected)
			expect(() => parseFinalizationResponse(value)).toThrow();
	});

	it('covers every action and terminal result', () => {
		const accepted = finalizationContract.vectors.status_responses.accepted;
		expect(new Set(accepted.map((value) => value.action))).toEqual(
			new Set(finalizationContract.vocabularies.actions),
		);
		expect(
			new Set(
				accepted
					.map((value) => value.terminal_result)
					.filter((value): value is string => typeof value === 'string'),
			),
		).toEqual(new Set(finalizationContract.vocabularies.terminal_results));
		expect(finalizationContract.protocol_version).toBe(1);
	});
});
