import AttachmentNotesPlugin from 'main';
import {
	PluginSettingTab,
	App,
	Notice,
	Modal,
	ButtonComponent,
	SettingGroup,
	setIcon,
	TFile,
	Setting,
} from 'obsidian';
import { FolderSuggest } from 'suggesters/FolderSuggester';
import { FileSuggest } from 'suggesters/FileSuggester';
import { validFileName } from 'Util';

export class AttachmentNotesSettingTab extends PluginSettingTab {
	plugin: AttachmentNotesPlugin;

	constructor(app: App, plugin: AttachmentNotesPlugin) {
		super(app, plugin);
		this.plugin = plugin;
		this.icon = 'lucide-paperclip';
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		// Group 1: General settings (no heading)
		const settingsGroup = new SettingGroup(containerEl)
			.addSetting((s) => {
				s.setName('Enable auto detection')
					.setDesc(
						'Detects new attachments and create metadata automatically.'
					)
					.addToggle((component) => {
						component
							.setValue(this.plugin.settings.autoDetection)
							.onChange((value: boolean) => {
								this.plugin.settings.autoDetection = value;
								void this.plugin.saveSettings();
							});
					});
			})
			.addSetting((s) => {
				s.setName('Sync deletions')
					.setDesc(
						'When enabled, deleting an attachment or its metadata file will delete the other.'
					)
					.addToggle((component) => {
						component
							.setValue(this.plugin.settings.syncDeletions)
							.onChange((value: boolean) => {
								this.plugin.settings.syncDeletions = value;
								void this.plugin.saveSettings();
							});
					});
			})
			.addSetting((s) => {
				s.setName('Sync file names')
					.setDesc(
						'When enabled, renaming an attachment or its metadata file will rename the other to match.'
					)
					.addToggle((component) => {
						component
							.setValue(this.plugin.settings.syncFileNames)
							.onChange((value: boolean) => {
								this.plugin.settings.syncFileNames = value;
								void this.plugin.saveSettings().then(() => {
									this.display();
								});
							});
					});
			});

		// File name format - only show when sync file names is OFF
		if (!this.plugin.settings.syncFileNames) {
			settingsGroup.addSetting((s) => {
				s.setName('File name format').addText((component) => {
					component
						.setValue(this.plugin.settings.filenameFormat)
						.onChange((input) => {
							const newFormat = input.trim().replace(/\.md$/, '');
							if (newFormat === '') {
								new Notice(
									'File name format must not be blank'
								);
								return;
							}

							const sampleFileName = this.plugin.formatter.format(
								newFormat,
								'folder/sample.png',
								Date.now()
							);

							this.displaySampleFileNameDesc(
								s.descEl,
								sampleFileName
							);

							const { valid } = validFileName(sampleFileName);
							if (!valid) {
								return;
							}

							this.plugin.settings.filenameFormat = newFormat;
							void this.plugin.saveSettings();
						});

					const sampleFileName = this.plugin.formatter.format(
						this.plugin.settings.filenameFormat,
						'folder/sample.png',
						Date.now()
					);
					this.displaySampleFileNameDesc(s.descEl, sampleFileName);
				});
			});
		}

		settingsGroup
			.addSetting((s) => {
				s.setName('New file location')
					.setDesc('New metadata file will be placed here')
					.addSearch((component) => {
						new FolderSuggest(this.app, component.inputEl);
						component
							.setPlaceholder('Example: folder1/folder2')
							.setValue(this.plugin.settings.folder)
							.onChange((newFolder) => {
								this.plugin.settings.folder = newFolder;
								void this.plugin.saveSettings();
							});
					});
			})
			.addSetting((s) => {
				s.setName('Template file location').addSearch((component) => {
					new FileSuggest(this.app, component.inputEl);
					component
						.setPlaceholder('Example: folder1/note')
						.setValue(this.plugin.settings.templatePath)
						.onChange((newTemplateFile) => {
							this.plugin.settings.templatePath = newTemplateFile;
							void this.plugin.saveSettings();
						});
				});

				// Create sub-items container as sibling after this setting
				const subItems = createDiv('setting-sub-items');
				s.settingEl.after(subItems);

				new Setting(subItems)
					.setName('Use Templater')
					.addToggle((component) => {
						component
							.setValue(this.plugin.settings.useTemplater)
							.onChange((value) => {
								this.plugin.settings.useTemplater = value;
								void this.plugin.saveSettings();
							});
					});
			})
			.addSetting((s) => {
				s.setName('Auto-cleanup orphaned metadata')
					.setDesc(
						'Automatically delete orphaned metadata files (older than 7 days) when Obsidian starts. An orphaned file has no corresponding attachment.'
					)
					.addToggle((component) => {
						component
							.setValue(this.plugin.settings.autoCleanupOrphans)
							.onChange((value: boolean) => {
								this.plugin.settings.autoCleanupOrphans = value;
								void this.plugin.saveSettings();
							});
					});
			})
			.addSetting((s) => {
				s.setName('Forget all attachments')
					.setDesc(
						'Attachment Notes remembers attachments for which it has created metadata. If it forgets, then it recognizes all attachments as newly created files and tries to create their metadata again.'
					)
					.addButton((component) => {
						component
							.setButtonText('Forget')
							.setWarning()
							.onClick(() => {
								new ForgetAllModal(
									this.app,
									this.plugin
								).open();
							});
					});
			});

		// Group 2: Extension settings (with heading)
		const extensionGroup = new SettingGroup(containerEl);
		extensionGroup.setHeading('Extensions to watch');

		let extensionToBeAdded: string;
		extensionGroup.addSetting((s) => {
			s.addText((text) =>
				text.setPlaceholder('Example: pdf').onChange((value) => {
					extensionToBeAdded = value.trim().replace(/^\./, '');
				})
			).addButton((cb) => {
				cb.setButtonText('Add').onClick(() => {
					if (extensionToBeAdded === 'md') {
						new Notice('extension "md" is prohibited');
						return;
					}
					if (
						this.plugin.fileExtensionManager.has(extensionToBeAdded)
					) {
						new Notice(
							`${extensionToBeAdded} is already registered`
						);
						return;
					}
					this.plugin.fileExtensionManager.add(extensionToBeAdded);
					this.plugin.settings.extensions.push(extensionToBeAdded);
					void this.plugin.saveSettings().then(() => {
						this.display();
					});
				});
			});
		});

		this.plugin.settings.extensions.forEach((ext) => {
			extensionGroup.addSetting((s) => {
				s.setName(ext).addExtraButton((cb) => {
					cb.setIcon('cross').onClick(() => {
						this.plugin.fileExtensionManager.delete(ext);
						this.plugin.settings.extensions =
							this.plugin.fileExtensionManager.toArray();
						void this.plugin.saveSettings().then(() => {
							this.display();
						});
					});
				});
			});
		});

		// Feedback button
		const feedbackContainer = containerEl.createEl('div', {
			cls: 'attachment-notes-feedback-container',
		});

		const button = feedbackContainer.createEl('button', {
			cls: 'mod-cta attachment-notes-feedback-button',
		});

		button.addEventListener('click', () => {
			window.open(
				'https://github.com/greetclammy/attachment-notes/issues',
				'_blank'
			);
		});

		const iconDiv = button.createEl('div');
		setIcon(iconDiv, 'message-square-reply');
		button.appendText('Leave feedback');
	}

	displaySampleFileNameDesc(
		descEl: HTMLElement,
		sampleFileName: string
	): void {
		descEl.empty();
		descEl.appendChild(
			createFragment((fragment) => {
				fragment.appendText('For syntax, refer to ');
				fragment.createEl('a', {
					href: 'https://github.com/greetclammy/attachment-notes#format-syntax',
					text: 'format reference',
				});
				fragment.createEl('br');
				fragment.appendText('Your current syntax looks like this: ');
				fragment.createEl('b', {
					text: sampleFileName,
				});

				const { valid, reason } = validFileName(sampleFileName);
				if (!valid && reason) {
					fragment.createEl('br');
					const msgEl = fragment.createEl('span');
					msgEl.appendText(reason);
					msgEl.addClass('attachment-notes-text-error');
				}
			})
		);
	}
}

class ForgetAllModal extends Modal {
	plugin: AttachmentNotesPlugin;

	constructor(app: App, plugin: AttachmentNotesPlugin) {
		super(app);
		this.plugin = plugin;
	}

	override onOpen() {
		const { contentEl, titleEl } = this;
		titleEl.setText('Forget all');
		contentEl
			.createEl('p', {
				text: 'Are you sure? You cannot undo this action.',
			})
			.addClass('mod-warning');

		const buttonContainerEl = contentEl.createEl('div');
		buttonContainerEl.addClass('modal-button-container');

		new ButtonComponent(buttonContainerEl)
			.setButtonText('Forget')
			.setWarning()
			.onClick(async () => {
				this.plugin.fileListAdapter.deleteAll();
				await this.plugin.fileListAdapter.save();
				new Notice('Attachment Notes forgets all!');
				this.close();
			});

		new ButtonComponent(buttonContainerEl)
			.setButtonText('Cancel')
			.onClick(() => {
				this.close();
			});
	}

	override onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

export class OrphanCleanupModal extends Modal {
	orphans: TFile[];
	onConfirm: () => Promise<void>;

	constructor(app: App, orphans: TFile[], onConfirm: () => Promise<void>) {
		super(app);
		this.orphans = orphans;
		this.onConfirm = onConfirm;
	}

	override onOpen() {
		const { contentEl, titleEl } = this;
		titleEl.setText('Clean up orphaned metadata files');

		contentEl.createEl('p', {
			text: `Found ${this.orphans.length} metadata file${
				this.orphans.length === 1 ? '' : 's'
			} with no corresponding attachment.`,
		});

		// Show first 10 orphans
		const list = contentEl.createEl('ul', { cls: 'orphan-list' });
		this.orphans.slice(0, 10).forEach((f) => {
			list.createEl('li', { text: f.path });
		});

		if (this.orphans.length > 10) {
			contentEl.createEl('p', {
				text: `... and ${this.orphans.length - 10} more`,
				cls: 'mod-muted',
			});
		}

		const buttonContainer = contentEl.createEl('div', {
			cls: 'modal-button-container',
		});

		new ButtonComponent(buttonContainer)
			.setButtonText('Delete all')
			.setWarning()
			.onClick(async () => {
				await this.onConfirm();
				this.close();
			});

		new ButtonComponent(buttonContainer)
			.setButtonText('Cancel')
			.onClick(() => this.close());
	}

	override onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
