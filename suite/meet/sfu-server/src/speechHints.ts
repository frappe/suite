import vocabulary from '../../speech-vocabulary.json';

export interface SpeechScope {
	vocabulary_version: string;
	title: string;
}
export const LEGACY_VOCABULARY_VERSION = 'frappe-v1';
export function parseSpeechScope(value: unknown): SpeechScope {
	if (
		!value ||
		typeof value !== 'object' ||
		!('vocabulary_version' in value) ||
		typeof value.vocabulary_version !== 'string' ||
		!Object.keys(vocabulary.versions).includes(value.vocabulary_version) ||
		!('title' in value) ||
		typeof value.title !== 'string' ||
		value.title.length > 160 ||
		/[\p{C}]/u.test(value.title) ||
		value.title.includes('<|') ||
		value.title.includes('|>')
	)
		throw new Error('invalid_speech_context');
	return { vocabulary_version: value.vocabulary_version, title: value.title };
}
export function participantHintNames(values: string[]): string[] {
	const result: string[] = [];
	const seen = new Set<string>();
	for (const raw of values) {
		const name = raw.normalize('NFKC').trim();
		const key = name.toLocaleLowerCase('en-US');
		if (
			!name ||
			name.length > 80 ||
			/[\p{C}]/u.test(name) ||
			name.includes('<|') ||
			name.includes('|>') ||
			seen.has(key)
		)
			continue;
		result.push(name);
		seen.add(key);
		if (result.length === 100) break;
	}
	return result;
}
