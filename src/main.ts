import { normalizePath, Notice, Plugin, TAbstractFile, TFile } from 'obsidian';
import { Formatter } from 'Formatter';
import { AttachmentNotesSettingTab, OrphanCleanupModal } from 'Setting';
import { FileExtensionManager } from 'Extension';
import { FileListAdapter } from 'FileList';
import { MetaDataGenerator } from 'Generator';
import * as tests from './tests';

interface AttachmentNotesSettings {
	autoDetection: boolean;
	extensions: string[];
	folder: string;
	filenameFormat: string;
	templatePath: string;
	useTemplater: boolean;
	syncDeletions: boolean;
	syncFileNames: boolean;
	autoCleanupOrphans: boolean;
}

const DEFAULT_SETTINGS: AttachmentNotesSettings = {
	autoDetection: false,
	extensions: [
		'png',
		'jpg',
		'jpeg',
		'gif',
		'bmp',
		'svg',
		'mp3',
		'webm',
		'wav',
		'm4a',
		'ogg',
		'3gp',
		'flac',
		'mp4',
		'webm',
		'ogv',
		'pdf',
	],
	folder: '/',
	filenameFormat: '{{NAME}}_{{EXTENSION}}',
	templatePath: '',
	useTemplater: false,
	syncDeletions: false,
	syncFileNames: false,
	autoCleanupOrphans: false,
};

export default class AttachmentNotesPlugin extends Plugin {
	settings: AttachmentNotesSettings;
	formatter: Formatter;
	metaDataGenerator: MetaDataGenerator;
	fileExtensionManager: FileExtensionManager;
	fileListAdapter: FileListAdapter;
	private pendingNotifications: string[] = [];
	private notificationTimeout: ReturnType<typeof setTimeout> | null = null;
	renameHistory: Map<TFile, number[]> = new Map();

	override async onload() {
		await this.loadSettings();

		this.formatter = new Formatter(this.app, this);
		this.fileExtensionManager = new FileExtensionManager(this);
		this.fileListAdapter = await new FileListAdapter(this.app, this).load();
		this.metaDataGenerator = new MetaDataGenerator(this.app, this);

		// Expose tests for console access
		(
			window as unknown as { attachmentNotesTests: object }
		).attachmentNotesTests = {
			all: () => void tests.testRenameLoop(this),
			cooldownAttachment: () => void tests.testCooldownAttachment(this),
			circuitBreakerAttachment: () =>
				void tests.testCircuitBreakerAttachment(this),
			cooldownMetadata: () => void tests.testCooldownMetadata(this),
			circuitBreakerMetadata: () =>
				void tests.testCircuitBreakerMetadata(this),
		};

		// Register create event after layout ready to avoid duplicate creation on vault load
		this.app.workspace.onLayoutReady(() => {
			this.registerEvent(
				this.app.vault.on('create', async (file: TAbstractFile) => {
					if (!this.settings.autoDetection) return;
					if (!(file instanceof TFile)) return;
					if (!this.metaDataGenerator.shouldCreateMetaDataFile(file))
						return;

					const metadataPath =
						await this.metaDataGenerator.create(file);
					const metadataFile =
						this.app.vault.getAbstractFileByPath(metadataPath);

					if (metadataFile instanceof TFile) {
						this.queueNotification(file.name);
						this.fileListAdapter.add(file, metadataFile);
						await this.fileListAdapter.save();
					}
				})
			);

			// Automatic orphan cleanup (if enabled)
			if (this.settings.autoCleanupOrphans) {
				void this.cleanupOldOrphans();
			}
		});

		this.registerEvent(
			this.app.vault.on('delete', async (file: TAbstractFile) => {
				if (!(file instanceof TFile)) return;

				const isBinary = this.fileListAdapter.has(file);
				const binaryFile = this.fileListAdapter.getByMetadata(file);
				const isMetadata = binaryFile !== undefined;

				if (isBinary) {
					const metadataFile = this.fileListAdapter.delete(file);
					await this.fileListAdapter.save();

					if (this.settings.syncDeletions && metadataFile) {
						try {
							await this.app.fileManager.trashFile(metadataFile);
						} catch (error) {
							console.error(
								`Failed to delete metadata file: ${String(
									error
								)}`
							);
						}
					}
				} else if (isMetadata && binaryFile) {
					this.fileListAdapter.delete(binaryFile);
					await this.fileListAdapter.save();

					if (this.settings.syncDeletions) {
						try {
							await this.app.fileManager.trashFile(binaryFile);
						} catch (error) {
							console.error(
								`Failed to delete attachment file: ${String(
									error
								)}`
							);
						}
					}
				}
			})
		);

		this.registerEvent(
			this.app.vault.on(
				'rename',
				async (file: TAbstractFile, _oldPath: string) => {
					if (!(file instanceof TFile)) return;
					if (!this.settings.syncFileNames) return;

					// Cooldown and circuit breaker checks
					const now = Date.now();
					const timestamps = this.renameHistory.get(file) || [];

					// Cooldown: skip if last rename within 500ms
					if (timestamps.length && now - timestamps.at(-1)! < 500) {
						return;
					}

					// Circuit breaker: skip if >5 renames in 5 seconds
					const recent = timestamps.filter((t) => now - t < 5000);
					if (recent.length > 5) {
						return;
					}

					const isBinary = this.fileListAdapter.has(file);
					const binaryFile = this.fileListAdapter.getByMetadata(file);
					const isMetadata = binaryFile !== undefined;

					if (isBinary) {
						// Attachment was renamed → rename metadata file
						const metadataFile = this.fileListAdapter.get(file);
						if (!metadataFile) return;

						const newMetadataPath =
							this.generateMetadataPathFromBinary(file);

						// Skip if metadata is already at the target path
						if (metadataFile.path === newMetadataPath) return;

						try {
							await this.app.fileManager.renameFile(
								metadataFile,
								newMetadataPath
							);

							// Record for source (throttle repeated attachment renames)
							recent.push(now);
							this.renameHistory.set(file, recent);

							// Record for target (block cascade from metadata rename event)
							const metaHistory =
								this.renameHistory.get(metadataFile) || [];
							const metaRecent = metaHistory.filter(
								(t) => now - t < 5000
							);
							metaRecent.push(now);
							this.renameHistory.set(metadataFile, metaRecent);
						} catch (error) {
							console.error(
								`Failed to rename metadata file: ${String(
									error
								)}`
							);
						}
					} else if (isMetadata && binaryFile) {
						// Metadata file was renamed → rename attachment
						const newBinaryPath =
							this.generateBinaryPathFromMetadata(
								file,
								binaryFile
							);

						// Skip if binary is already at the target path
						if (binaryFile.path === newBinaryPath) return;

						try {
							await this.app.fileManager.renameFile(
								binaryFile,
								newBinaryPath
							);

							// Record for source (throttle repeated metadata renames)
							recent.push(now);
							this.renameHistory.set(file, recent);

							// Record for target (block cascade from attachment rename event)
							const binHistory =
								this.renameHistory.get(binaryFile) || [];
							const binRecent = binHistory.filter(
								(t) => now - t < 5000
							);
							binRecent.push(now);
							this.renameHistory.set(binaryFile, binRecent);

							// Re-sync metadata name to match binary
							const newBinaryName =
								newBinaryPath.split('/').pop() || '';
							const expectedMetadataName = `${newBinaryName}.md`;
							if (file.name !== expectedMetadataName) {
								const metadataFolder =
									file.parent?.path || this.settings.folder;
								const correctedMetadataPath = normalizePath(
									`${metadataFolder}/${expectedMetadataName}`
								);
								await this.app.fileManager.renameFile(
									file,
									correctedMetadataPath
								);

								// Record the re-sync rename too
								const metaHistory =
									this.renameHistory.get(file) || [];
								const metaRecent = metaHistory.filter(
									(t) => now - t < 5000
								);
								metaRecent.push(now);
								this.renameHistory.set(file, metaRecent);
							}
						} catch (error) {
							console.error(
								`Failed to rename attachment: ${String(error)}`
							);
						}
					}
				}
			)
		);

		// Commands
		this.addCommand({
			id: 'attachment-notes-manual-detection',
			name: "Create notes for attachments that don't have them",
			callback: async () => {
				const promises: Promise<void>[] = [];
				const allFiles = this.app.vault.getFiles();
				for (const file of allFiles) {
					if (
						!this.metaDataGenerator.shouldCreateMetaDataFile(file)
					) {
						continue;
					}

					promises.push(
						this.metaDataGenerator
							.create(file)
							.then((metadataPath) => {
								const metadataFile =
									this.app.vault.getAbstractFileByPath(
										metadataPath
									);
								if (metadataFile instanceof TFile) {
									new Notice(
										`Created attachment note for: ${file.name}`
									);
									this.fileListAdapter.add(
										file,
										metadataFile
									);
								}
							})
					);
				}
				await Promise.all(promises);
				await this.fileListAdapter.save();
			},
		});

		this.addCommand({
			id: 'attachment-notes-cleanup-orphans',
			name: 'Clean up orphaned metadata files',
			callback: () => {
				const orphans = this.fileListAdapter.findOrphans(
					this.settings.folder
				);

				if (orphans.length === 0) {
					new Notice('No orphaned metadata files found');
					return;
				}

				new OrphanCleanupModal(this.app, orphans, async () => {
					let deletedCount = 0;
					for (const orphan of orphans) {
						try {
							await this.app.fileManager.trashFile(orphan);
							deletedCount++;
						} catch (error) {
							console.error(
								`Failed to delete: ${orphan.path}`,
								error
							);
						}
					}
					new Notice(
						`Removed ${deletedCount} orphaned metadata files`
					);
				}).open();
			},
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new AttachmentNotesSettingTab(this.app, this));
	}

	// onunload() {}

	private generateMetadataPathFromBinary(binaryFile: TFile): string {
		// When syncFileNames is ON, use simple {{NAME}}.{{EXTENSION}} format
		const metadataFileName = `${binaryFile.name}.md`;
		return normalizePath(`${this.settings.folder}/${metadataFileName}`);
	}

	private generateBinaryPathFromMetadata(
		metadataFile: TFile,
		binaryFile: TFile
	): string {
		const binaryFolder = binaryFile.parent?.path || '';
		let newBinaryName = metadataFile.name.replace(/\.md$/, '');

		// If the correct extension is missing, append it
		const expectedSuffix = `.${binaryFile.extension}`;
		if (!newBinaryName.endsWith(expectedSuffix)) {
			newBinaryName = `${newBinaryName}${expectedSuffix}`;
		}

		// Deduplicate if target already exists
		let candidatePath = normalizePath(`${binaryFolder}/${newBinaryName}`);
		if (this.app.vault.getAbstractFileByPath(candidatePath)) {
			const baseName = newBinaryName.replace(/\.[^.]+$/, '');
			const ext = binaryFile.extension;
			let counter = 1;
			while (this.app.vault.getAbstractFileByPath(candidatePath)) {
				newBinaryName = `${baseName} ${counter}.${ext}`;
				candidatePath = normalizePath(
					`${binaryFolder}/${newBinaryName}`
				);
				counter++;
			}
		}

		return candidatePath;
	}

	private async cleanupOldOrphans() {
		const orphans = this.fileListAdapter.findOrphans(
			this.settings.folder,
			7 // Only delete orphans older than 7 days
		);

		if (orphans.length === 0) return;

		for (const orphan of orphans) {
			try {
				await this.app.fileManager.trashFile(orphan);
			} catch (error) {
				console.error(
					`Failed to delete orphaned metadata: ${orphan.path}`,
					error
				);
			}
		}
	}

	private queueNotification(filename: string) {
		this.pendingNotifications.push(filename);

		if (this.notificationTimeout) {
			clearTimeout(this.notificationTimeout);
		}

		this.notificationTimeout = setTimeout(() => {
			const count = this.pendingNotifications.length;
			if (count === 1) {
				new Notice(
					`Created attachment note for: ${this.pendingNotifications[0]}`
				);
			} else if (count > 1) {
				new Notice(`Created attachment notes for ${count} files`);
			}
			this.pendingNotifications = [];
			this.notificationTimeout = null;
		}, 500);
	}

	async loadSettings() {
		const data = (await this.loadData()) as Record<string, unknown> | null;
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			data as Partial<AttachmentNotesSettings> | null
		);
	}

	async saveSettings() {
		// Load existing data to preserve pairs
		const existingData =
			((await this.loadData()) as Record<string, unknown>) || {};

		// Merge settings with existing data (preserving pairs)
		const mergedData = {
			...existingData,
			...this.settings,
		};

		await this.saveData(mergedData);
	}
}
