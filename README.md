## Attachment Notes

Detects new attachments in the vault and create markdown files with metadata.

By using metadata files, you can take advantage of the rich functionality provied by Obsidian such as

- full text search,
- tags and aliases,
- internal links, and so on.

For example, if you add tags to the metadata of an image file, then you can indirectly access the image file by tag-searching (and following an internal link in the metadata).

[![Image from Gyazo](https://i.gyazo.com/6c46d863e4c31d0815bcf027fdb48f92.gif)](https://gyazo.com/6c46d863e4c31d0815bcf027fdb48f92)

### Quick start

1. Install and enable this plugin.
2. Go to the setting tab of Attachment Notes and enable auto detection.
3. Add a static file like `sample.pdf` to your vault.

Then you will find a meta data file `INFO_sample_PDF.md` in the root directory.
You can customize the new file location and the templates for names and contents of metadata files.

### Format syntax

You can use the following syntax to format the names and contents of metadata files.

#### Date

| Syntax               | Description                       |
| -------------------- | --------------------------------- |
| `{{CDATE:<FORMAT>}}` | Creation time of the static file. |
| `{{NOW:<FORMAT>}}`   | Current time.                     |

- Replace `<FORMAT>` by a [Moment.js format](https://momentjs.com/docs/#/displaying/format/).

#### Link

| Syntax      | Description                         |
| ----------- | ----------------------------------- |
| `{{LINK}}`  | Internal link like `[[image.png]]`  |
| `{{EMBED}}` | Embedded link like `![[image.png]]` |

#### Path

| Syntax          | Description                                   |
| --------------- | --------------------------------------------- |
| `{{PATH}}`      | Path of a static file.                        |
| `{{FULLNAME}}`  | Name of a static file.                        |
| `{{NAME}}`      | Name of a static file with extension removed. |
| `{{EXTENSION}}` | Extension of a static file.                   |

- You can choose between uppercase and lowercase letters by adding suffixes `:UP` and `:LOW`, respectively. For example, `{{NAME:UP}}`.

### Templater plugin support

You can also use [Templater plugin](https://github.com/SilentVoid13/Templater) to format your meta data files.
Just install Templater plugin and set `Use Templater` in the setting tab of Attachment Notes.

### Limitations

The plugin tracks attachment-metadata pairs by file path. If an attachment or metadata file is moved or renamed while the plugin is disabled (or by an external tool outside Obsidian), the pairing will break. The files will still exist, but the plugin will no longer recognize them as a pair.

To preserve pairings, always move or rename attachment and metadata files through Obsidian while the plugin is enabled.
