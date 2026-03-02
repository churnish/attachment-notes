export async function retry<T>(
	callback: () => T | undefined,
	timeoutMilliSecond: number,
	trials: number,
	check: (_value: T) => boolean = (_: T) => true
): Promise<T | undefined> {
	if (!Number.isInteger(trials)) {
		throw new Error(`arg trials: ${trials} is not an integer
		`);
	}
	const result = await Promise.race([
		delay(timeoutMilliSecond),
		(async (): Promise<T | undefined> => {
			for (let i = 0; i < trials; i++) {
				const t = callback();
				if (t !== undefined && check(t)) {
					return t;
				}
				await delay(1);
			}
			return undefined;
		})(),
	]);

	if (result === undefined) {
		return undefined;
	}
	return result as T;
}

async function delay(milliSecond: number): Promise<undefined> {
	await new Promise((resolve) => setTimeout(resolve, milliSecond));
	return undefined;
}

// Core Obsidian restrictions (all platforms)
// Note: *"<>? are only unsafe on Windows/Android - users can use them if they want
const INVALID_FILE_NAME_CHARS = new Set<string>([
	'[',
	']',
	'#',
	'^',
	'|',
	'\\',
	'/',
	':',
]);

export function validFileName(fileName: string): {
	valid: boolean;
	reason?: string;
} {
	if (fileName.startsWith('.')) {
		return { valid: false, reason: 'File name must not start with a dot' };
	}

	for (const char of fileName) {
		if (INVALID_FILE_NAME_CHARS.has(char)) {
			return { valid: false, reason: `"${char}" must not be included` };
		}
	}

	return { valid: true };
}
