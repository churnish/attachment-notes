import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import obsidianmd from 'eslint-plugin-obsidianmd';

export default tseslint.config(
	{
		ignores: ['**', '!src/**'],
	},
	eslint.configs.recommended,
	...tseslint.configs.recommendedTypeChecked,
	{
		languageOptions: {
			parserOptions: {
				projectService: true,
				tsconfigRootDir: import.meta.dirname,
			},
		},
	},
	{
		plugins: {
			obsidianmd,
		},
		rules: {
			'obsidianmd/no-sample-code': 'error',
			'obsidianmd/detach-leaves': 'error',
			'obsidianmd/no-tfile-tfolder-cast': 'error',
			'obsidianmd/prefer-file-manager-trash-file': 'warn',
			'obsidianmd/platform': 'error',
			'@typescript-eslint/no-unused-vars': [
				'warn',
				{ args: 'none', varsIgnorePattern: '^_' },
			],
			'@typescript-eslint/ban-ts-comment': 'off',
		},
	}
);
