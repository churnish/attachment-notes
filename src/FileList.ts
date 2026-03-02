import AttachmentNotesPlugin from 'main';
import { App, TFile } from 'obsidian';

interface SerializedRelationships {
	pairs: Array<{ binary: string; metadata: string }>;
}

export class FileListAdapter {
	private app: App;
	private plugin: AttachmentNotesPlugin;
	private registeredBinaryFiles: Map<TFile, TFile>;
	private saveTimeout: ReturnType<typeof setTimeout> | null = null;

	constructor(app: App, plugin: AttachmentNotesPlugin) {
		this.app = app;
		this.plugin = plugin;
		this.registeredBinaryFiles = new Map<TFile, TFile>();
	}

	async load(): Promise<FileListAdapter> {
		await this.loadBinaryFiles();
		return this;
	}

	async save() {
		if (this.saveTimeout) {
			clearTimeout(this.saveTimeout);
			this.saveTimeout = null;
		}
		await this.saveBinaryFiles();
	}

	private queueSave() {
		if (this.saveTimeout) {
			clearTimeout(this.saveTimeout);
		}
		this.saveTimeout = setTimeout(() => {
			this.saveTimeout = null;
			void this.saveBinaryFiles();
		}, 500);
	}

	add(binaryFile: TFile, metadataFile: TFile): void {
		this.registeredBinaryFiles.set(binaryFile, metadataFile);
	}

	delete(binaryFile: TFile): TFile | undefined {
		const metadataFile = this.registeredBinaryFiles.get(binaryFile);
		this.registeredBinaryFiles.delete(binaryFile);
		return metadataFile;
	}

	has(binaryFile: TFile): boolean {
		if (!this.registeredBinaryFiles.has(binaryFile)) {
			return false;
		}
		if (!this.validatePair(binaryFile)) {
			return false;
		}
		return true;
	}

	get(binaryFile: TFile): TFile | undefined {
		const metadataFile = this.registeredBinaryFiles.get(binaryFile);
		if (!metadataFile) {
			return undefined;
		}
		if (!this.validatePair(binaryFile)) {
			return undefined;
		}
		return metadataFile;
	}

	getByMetadata(metadataFile: TFile): TFile | undefined {
		for (const [binary, metadata] of this.registeredBinaryFiles.entries()) {
			if (metadata === metadataFile) {
				if (!this.validatePair(binary)) {
					return undefined;
				}
				return binary;
			}
		}
		return undefined;
	}

	getAllPairs(): Map<TFile, TFile> {
		return new Map(this.registeredBinaryFiles);
	}

	deleteAll(): void {
		this.registeredBinaryFiles = new Map<TFile, TFile>();
	}

	findOrphans(metadataFolder: string, minAgeDays?: number): TFile[] {
		// Get all markdown files in the metadata folder
		const normalizedFolder = metadataFolder === '/' ? '' : metadataFolder;
		const allMetadataFiles = this.app.vault
			.getMarkdownFiles()
			.filter(
				(f) =>
					normalizedFolder === '' ||
					f.path.startsWith(normalizedFolder + '/') ||
					f.parent?.path === normalizedFolder
			);

		// Get set of tracked metadata paths
		const trackedMetadata = new Set(
			Array.from(this.registeredBinaryFiles.values()).map((m) => m.path)
		);

		// Find orphans (metadata not tracked)
		let orphans = allMetadataFiles.filter(
			(f) => !trackedMetadata.has(f.path)
		);

		// Apply age filter if specified
		if (minAgeDays !== undefined) {
			const minAgeMs = minAgeDays * 24 * 60 * 60 * 1000;
			const now = Date.now();
			orphans = orphans.filter((f) => now - f.stat.ctime > minAgeMs);
		}

		return orphans;
	}

	private validatePair(binaryFile: TFile): boolean {
		const metadataFile = this.registeredBinaryFiles.get(binaryFile);
		if (!metadataFile) {
			return false;
		}

		const existingFiles = this.app.vault.getFiles();
		const binaryExists = existingFiles.includes(binaryFile);
		const metadataExists = existingFiles.includes(metadataFile);

		if (!binaryExists || !metadataExists) {
			this.registeredBinaryFiles.delete(binaryFile);
			this.queueSave();
			return false;
		}

		return true;
	}

	private async loadBinaryFiles() {
		const data =
			(await this.plugin.loadData()) as SerializedRelationships | null;

		if (!data || !data.pairs) {
			this.registeredBinaryFiles = new Map<TFile, TFile>();
			return;
		}

		this.registeredBinaryFiles = new Map<TFile, TFile>();

		for (const pair of data.pairs) {
			const binaryFile = this.app.vault.getAbstractFileByPath(
				pair.binary
			);
			const metadataFile = this.app.vault.getAbstractFileByPath(
				pair.metadata
			);

			if (binaryFile instanceof TFile && metadataFile instanceof TFile) {
				this.registeredBinaryFiles.set(binaryFile, metadataFile);
			}
		}
	}

	private async saveBinaryFiles() {
		// Load existing data to preserve settings
		const existingData =
			((await this.plugin.loadData()) as Record<string, unknown>) || {};

		const pairs = Array.from(this.registeredBinaryFiles.entries()).map(
			([binaryFile, metadataFile]) => ({
				binary: binaryFile.path,
				metadata: metadataFile.path,
			})
		);

		// Merge pairs with existing data (preserving settings)
		const mergedData = {
			...existingData,
			pairs,
		};

		await this.plugin.saveData(mergedData);
	}
}
