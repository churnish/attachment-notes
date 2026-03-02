import AttachmentNotesPlugin from 'main';
import {
	App,
	normalizePath,
	TAbstractFile,
	TFile,
	Notice,
	Plugin,
} from 'obsidian';
import { UncoveredApp } from 'Uncover';
import { retry } from 'Util';

const TEMPLATER_PLUGIN_NAME = 'templater-obsidian';
const DEFAULT_TEMPLATE_CONTENT = `---
file created: {{CDATE:YYYY-MM-DDTHH:mm}}
file format: {{EXTENSION:LOW}}
link: "[[{{PATH}}]]"
---
![[{{PATH}}]]
`;

const RETRY_NUMBER = 1000;
const TIMEOUT_MILLISECOND = 1000;

export class MetaDataGenerator {
	private app: App;
	private plugin: AttachmentNotesPlugin;

	constructor(app: App, plugin: AttachmentNotesPlugin) {
		this.app = app;
		this.plugin = plugin;
	}

	shouldCreateMetaDataFile(file: TAbstractFile): boolean {
		if (!(file instanceof TFile)) {
			return false;
		}

		const matchedExtension =
			this.plugin.fileExtensionManager.getExtensionMatchedBest(file.name);
		if (!matchedExtension) {
			return false;
		}

		if (this.plugin.fileListAdapter.has(file)) {
			return false;
		}

		return true;
	}

	async create(file: TFile): Promise<string> {
		const metaDataFileName = this.uniquefyMetaDataFileName(
			this.generateMetaDataFileName(file),
			this.plugin.settings.folder
		);
		const metaDataFilePath = normalizePath(
			`${this.plugin.settings.folder}/${metaDataFileName}`
		);

		await this.createMetaDataFile(metaDataFilePath, file);
		return metaDataFilePath;
	}

	private generateMetaDataFileName(file: TFile): string {
		// When syncFileNames is ON, use simple format; otherwise use custom format
		const format = this.plugin.settings.syncFileNames
			? '{{NAME}}.{{EXTENSION}}'
			: this.plugin.settings.filenameFormat;
		const metaDataFileName = `${this.plugin.formatter.format(
			format,
			file.path,
			file.stat.ctime
		)}.md`;
		return metaDataFileName;
	}

	private uniquefyMetaDataFileName(
		metaDataFileName: string,
		folder: string
	): string {
		let candidateFileName = metaDataFileName;
		let candidatePath = normalizePath(`${folder}/${candidateFileName}`);

		// If the base name doesn't exist, return it
		if (!this.app.vault.getAbstractFileByPath(candidatePath)) {
			return metaDataFileName;
		}

		// Otherwise, try appending numbers until we find an available name
		const baseName = metaDataFileName.replace(/\.md$/, '');
		let counter = 1;

		while (this.app.vault.getAbstractFileByPath(candidatePath)) {
			candidateFileName = `${baseName} ${counter}.md`;
			candidatePath = normalizePath(`${folder}/${candidateFileName}`);
			counter++;
		}

		return candidateFileName;
	}

	private async createMetaDataFile(
		metaDataFilePath: string,
		binaryFile: TFile
	): Promise<void> {
		const templateContent = await this.fetchTemplateContent();

		// process by Templater
		const templaterPlugin = await this.getTemplaterPlugin();
		if (!(this.plugin.settings.useTemplater && templaterPlugin)) {
			await this.app.vault.create(
				metaDataFilePath,
				this.plugin.formatter.format(
					templateContent,
					binaryFile.path,
					binaryFile.stat.ctime
				)
			);
		} else {
			const targetFile = await this.app.vault.create(
				metaDataFilePath,
				''
			);

			try {
				const content = await (
					templaterPlugin as unknown as {
						templater: {
							parse_template: (
								config: {
									target_file: TFile;
									run_mode: number;
								},
								template: string
							) => Promise<string>;
						};
					}
				).templater.parse_template(
					{ target_file: targetFile, run_mode: 4 },
					this.plugin.formatter.format(
						templateContent,
						binaryFile.path,
						binaryFile.stat.ctime
					)
				);
				await this.app.vault.modify(targetFile, content);
			} catch (err: unknown) {
				new Notice(
					'ERROR in Attachment Notes Plugin: failed to connect to Templater. Your Templater version may not be supported'
				);
				console.log(err);
			}
		}
	}

	private async fetchTemplateContent(): Promise<string> {
		if (this.plugin.settings.templatePath === '') {
			return DEFAULT_TEMPLATE_CONTENT;
		}

		const templateFile = await retry(
			() => {
				return this.app.vault.getAbstractFileByPath(
					this.plugin.settings.templatePath
				);
			},
			TIMEOUT_MILLISECOND,
			RETRY_NUMBER,
			(abstractFile) => abstractFile !== null
		);

		if (!(templateFile instanceof TFile)) {
			const msg = `Template file ${this.plugin.settings.templatePath} is invalid`;
			console.log(msg);
			new Notice(msg);
			return DEFAULT_TEMPLATE_CONTENT;
		}
		return await this.app.vault.read(templateFile);
	}

	private async getTemplaterPlugin(): Promise<Plugin | undefined> {
		const app = this.app as UncoveredApp;
		return await retry(
			() => {
				return app.plugins.plugins[TEMPLATER_PLUGIN_NAME];
			},
			TIMEOUT_MILLISECOND,
			RETRY_NUMBER
		);
	}
}
