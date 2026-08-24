import { describe, expect, it } from 'vitest';
import { AnnotationOverlayGrantManager } from '../AnnotationOverlayGrantManager';

describe('AnnotationOverlayGrantManager', () => {
	it('issues a presenter-bound, one-time overlay grant', () => {
		const manager = new AnnotationOverlayGrantManager('secret');
		const issued = manager.issue({
			meetingId: 'meeting-1',
			site: 'site-a',
			presenterId: 'presenter-1',
			producerId: 'producer-1',
		});

		expect(manager.verifyAndConsume(issued.grant)).toMatchObject({
			scope: 'annotation-overlay',
			meeting_id: 'meeting-1',
			site: 'site-a',
			presenter_id: 'presenter-1',
			producer_id: 'producer-1',
		});
		expect(() => manager.verifyAndConsume(issued.grant)).toThrow(
			'Overlay grant was already used',
		);
	});

	it('rejects grants signed by another SFU', () => {
		const issuer = new AnnotationOverlayGrantManager('secret-a');
		const verifier = new AnnotationOverlayGrantManager('secret-b');
		const { grant } = issuer.issue({
			meetingId: 'meeting-1',
			presenterId: 'presenter-1',
			producerId: 'producer-1',
		});

		expect(() => verifier.verifyAndConsume(grant)).toThrow();
	});
});
