import { decodeGroupState } from "ts-mls";
import { getGroupMembers } from "ts-mls/clientState.js";
import { describe, expect, it } from "vitest";
import { TsMlsEpochProtocolProvider } from "../EpochProtocolProvider";

describe("TsMlsEpochProtocolProvider", () => {
	const signingPubKey =
		"MCowBQYDK2VwAyEAh+OJTqK5xh0L0d3CjGqC7qh0IqR2rQXv5hOv7yvVNnQ=";

	it("creates a genesis epoch and exports a stable 32-byte meeting secret", async () => {
		const provider = new TsMlsEpochProtocolProvider();

		const genesis = await provider.createGenesisEpoch({
			groupId: "meeting-vscl-sabe-ykvp",
			userId: "alice@example.com",
			deviceId: "alice-laptop",
			senderId: 7,
			signingPubKey,
		});

		expect(genesis.epochNumber).toBe(1);
		expect(genesis.encodedState.byteLength).toBeGreaterThan(0);
		expect(genesis.meetingSecret.byteLength).toBe(32);

		const credential = getGroupMembers(genesis.state)[0]?.credential;
		expect(credential?.credentialType).toBe("basic");
		if (credential?.credentialType === "basic") {
			expect(JSON.parse(new TextDecoder().decode(credential.identity))).toEqual(
				expect.objectContaining({ signingPubKey }),
			);
		}

		const reExportedSecret = await provider.exportMeetingSecret(genesis.state);
		expect([...reExportedSecret]).toEqual([...genesis.meetingSecret]);

		const decoded = decodeGroupState(genesis.encodedState, 0)?.[0];
		expect(decoded?.groupContext.epoch).toBe(genesis.state.groupContext.epoch);
	});

	it("adds a member and lets the joiner export the same epoch meeting secret", async () => {
		const provider = new TsMlsEpochProtocolProvider();
		const alice = await provider.createGenesisEpoch({
			groupId: "meeting-vscl-sabe-ykvp",
			userId: "alice@example.com",
			deviceId: "alice-laptop",
			senderId: 7,
			signingPubKey,
		});
		const bobKeyPackage = await provider.generateKeyPackage({
			groupId: "meeting-vscl-sabe-ykvp",
			userId: "bob@example.com",
			deviceId: "bob-phone",
			senderId: 9,
			signingPubKey,
		});

		const addBob = await provider.addMember(
			alice.state,
			bobKeyPackage.publicPackage,
		);
		const bob = await provider.joinFromWelcome(
			addBob.welcome,
			bobKeyPackage.publicPackage,
			bobKeyPackage.privatePackage,
			addBob.state.ratchetTree,
		);

		expect(addBob.epochNumber).toBe(2);
		expect(bob.epochNumber).toBe(2);
		expect([...bob.meetingSecret]).toEqual([...addBob.meetingSecret]);
		expect([...bob.meetingSecret]).not.toEqual([...alice.meetingSecret]);
	});

	it("adds multiple members in one commit and lets each joiner export the same meeting secret", async () => {
		const provider = new TsMlsEpochProtocolProvider();
		const genesis = await provider.createGenesisEpoch({
			groupId: "meeting-vscl-sabe-ykvp",
			userId: "alice@example.com",
			deviceId: "alice-laptop",
			senderId: 7,
			signingPubKey,
		});
		const bobKeyPackage = await provider.generateKeyPackage({
			groupId: "meeting-vscl-sabe-ykvp",
			userId: "bob@example.com",
			deviceId: "bob-phone",
			senderId: 9,
			signingPubKey,
		});
		const carolKeyPackage = await provider.generateKeyPackage({
			groupId: "meeting-vscl-sabe-ykvp",
			userId: "carol@example.com",
			deviceId: "carol-laptop",
			senderId: 11,
			signingPubKey,
		});

		const addBoth = await provider.addMultipleMembers(genesis.state, [
			bobKeyPackage.publicPackage,
			carolKeyPackage.publicPackage,
		]);

		const bob = await provider.joinFromWelcome(
			addBoth.welcome,
			bobKeyPackage.publicPackage,
			bobKeyPackage.privatePackage,
			addBoth.epoch.state.ratchetTree,
		);
		const carol = await provider.joinFromWelcome(
			addBoth.welcome,
			carolKeyPackage.publicPackage,
			carolKeyPackage.privatePackage,
			addBoth.epoch.state.ratchetTree,
		);

		expect(addBoth.epoch.epochNumber).toBe(2);
		expect(bob.epochNumber).toBe(2);
		expect(carol.epochNumber).toBe(2);
		expect([...bob.meetingSecret]).toEqual([...addBoth.epoch.meetingSecret]);
		expect([...carol.meetingSecret]).toEqual([...addBoth.epoch.meetingSecret]);
		expect([...bob.meetingSecret]).toEqual([...carol.meetingSecret]);
	});

	it("lets existing members process add-member commits for later joiners", async () => {
		const provider = new TsMlsEpochProtocolProvider();
		const alice = await provider.createGenesisEpoch({
			groupId: "meeting-vscl-sabe-ykvp",
			userId: "alice@example.com",
			deviceId: "alice-laptop",
			senderId: 7,
			signingPubKey,
		});
		const bobKeyPackage = await provider.generateKeyPackage({
			groupId: "meeting-vscl-sabe-ykvp",
			userId: "bob@example.com",
			deviceId: "bob-phone",
			senderId: 9,
			signingPubKey,
		});
		const addBob = await provider.addMember(
			alice.state,
			bobKeyPackage.publicPackage,
		);
		const bob = await provider.joinFromWelcome(
			addBob.welcome,
			bobKeyPackage.publicPackage,
			bobKeyPackage.privatePackage,
			addBob.state.ratchetTree,
		);
		const carolKeyPackage = await provider.generateKeyPackage({
			groupId: "meeting-vscl-sabe-ykvp",
			userId: "carol@example.com",
			deviceId: "carol-laptop",
			senderId: 11,
			signingPubKey,
		});

		const addCarol = await provider.addMember(
			addBob.state,
			carolKeyPackage.publicPackage,
		);
		const bobAfterCarol = await provider.processCommit(bob.state, addCarol.commit);

		expect(addCarol.epochNumber).toBe(3);
		expect(bobAfterCarol.epochNumber).toBe(3);
		expect([...bobAfterCarol.meetingSecret]).toEqual([
			...addCarol.meetingSecret,
		]);
	});

	it("creates a genesis epoch with members and welcomes them all in one commit", async () => {
		const provider = new TsMlsEpochProtocolProvider();
		const bobMember = {
			groupId: "meeting-vscl-sabe-ykvp",
			userId: "bob@example.com",
			deviceId: "bob-phone",
			senderId: 9,
			signingPubKey,
		};
		const carolMember = {
			groupId: "meeting-vscl-sabe-ykvp",
			userId: "carol@example.com",
			deviceId: "carol-laptop",
			senderId: 11,
			signingPubKey,
		};
		const bobKeyPackage = await provider.generateKeyPackage(bobMember);
		const carolKeyPackage = await provider.generateKeyPackage(carolMember);

		const result = await provider.createGenesisEpochWithMembers(
			{
				groupId: "meeting-vscl-sabe-ykvp",
				userId: "alice@example.com",
				deviceId: "alice-laptop",
				senderId: 7,
				signingPubKey,
			},
			[
				{ member: bobMember, keyPackage: bobKeyPackage },
				{ member: carolMember, keyPackage: carolKeyPackage },
			],
		);

		const bob = await provider.joinFromWelcome(
			result.welcome,
			bobKeyPackage.publicPackage,
			bobKeyPackage.privatePackage,
			result.state.ratchetTree,
		);
		const carol = await provider.joinFromWelcome(
			result.welcome,
			carolKeyPackage.publicPackage,
			carolKeyPackage.privatePackage,
			result.state.ratchetTree,
		);

		expect(result.epochNumber).toBe(2);
		expect(bob.epochNumber).toBe(2);
		expect(carol.epochNumber).toBe(2);
		expect([...bob.meetingSecret]).toEqual([...result.meetingSecret]);
		expect([...carol.meetingSecret]).toEqual([...result.meetingSecret]);
		expect([...bob.meetingSecret]).toEqual([...carol.meetingSecret]);
		expect(getGroupMembers(result.state)).toHaveLength(3);
	});

	it("removes a member and rotates the meeting secret to a new value", async () => {
		const provider = new TsMlsEpochProtocolProvider();
		const alice = await provider.createGenesisEpoch({
			groupId: "meeting-vscl-sabe-ykvp",
			userId: "alice@example.com",
			deviceId: "alice-laptop",
			senderId: 7,
			signingPubKey,
		});
		const bobKeyPackage = await provider.generateKeyPackage({
			groupId: "meeting-vscl-sabe-ykvp",
			userId: "bob@example.com",
			deviceId: "bob-phone",
			senderId: 9,
			signingPubKey,
		});
		const addBob = await provider.addMember(
			alice.state,
			bobKeyPackage.publicPackage,
		);
		expect(getGroupMembers(addBob.state)).toHaveLength(2);

		const removeBob = await provider.removeMember(addBob.state, 1);
		expect(removeBob.epoch.epochNumber).toBe(3);
		expect(getGroupMembers(removeBob.epoch.state)).toHaveLength(1);
		expect([...removeBob.epoch.meetingSecret]).not.toEqual([
			...alice.meetingSecret,
		]);
		expect([...removeBob.epoch.meetingSecret]).not.toEqual([
			...addBob.meetingSecret,
		]);
	});
});
