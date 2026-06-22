import { App, MarkdownPostProcessorContext, TFile, MarkdownView, Editor } from 'obsidian';
import { isHtmlInSection } from './html-serializer';

export interface TableSourceInfo {
	lineStart: number;
	lineEnd: number;
	text: string;
}

/**
 * Get the source line range for a table element via the post-processor context.
 */
export function getTableSourceInfo(
	context: MarkdownPostProcessorContext,
	tableEl: HTMLTableElement,
): TableSourceInfo | null {
	const info = context.getSectionInfo(tableEl);
	if (!info) return null;

	return {
		lineStart: info.lineStart,
		lineEnd: info.lineEnd,
		text: info.text,
	};
}

/**
 * Read the source text of a table from the file.
 */
export function readTableSource(
	app: App,
	context: MarkdownPostProcessorContext,
	tableEl: HTMLTableElement,
): string | null {
	const info = getTableSourceInfo(context, tableEl);
	if (!info) return null;
	return info.text;
}

/**
 * Replace the source text of a table in the file via vault API.
 * Works in reading mode where there is no active editor.
 */
export async function replaceTableSource(
	app: App,
	context: MarkdownPostProcessorContext,
	tableEl: HTMLTableElement,
	newContent: string,
): Promise<boolean> {
	const info = getTableSourceInfo(context, tableEl);
	if (!info) return false;

	const file = app.vault.getAbstractFileByPath(context.sourcePath);
	if (!file || !(file instanceof TFile)) return false;

	const content = await app.vault.read(file);
	const lines = content.split('\n');

	// Replace lines lineStart..lineEnd with newContent
	const newLines = newContent.split('\n');
	lines.splice(info.lineStart, info.lineEnd - info.lineStart + 1, ...newLines);

	await app.vault.modify(file, lines.join('\n'));
	return true;
}

/**
 * Check whether a table's source is HTML (vs Markdown).
 */
export function isTableFromHtmlSource(
	context: MarkdownPostProcessorContext,
	tableEl: HTMLTableElement,
): boolean {
	const info = getTableSourceInfo(context, tableEl);
	if (!info) return false;
	return isHtmlInSection(info.text);
}

/**
 * Find the rendered table's position in the source lines by matching content.
 * Returns line range {start, end} (0-based inclusive) or null.
 */
export function findTableInSource(sourceLines: string[], tableEl: HTMLTableElement): { start: number; end: number } | null {
	// Get first row text from rendered table
	const firstRow = tableEl.querySelector('tr');
	if (!firstRow) return null;
	const firstRowText = Array.from(firstRow.querySelectorAll('td, th'))
		.map(c => c.textContent?.trim() ?? '')
		.join('|');

	// Scan source for matching table start
	for (let i = 0; i < sourceLines.length; i++) {
		const line = sourceLines[i]!.trim();
		if (!line.startsWith('|')) continue;

		// Check if first row content matches
		const srcCells = line.split('|').filter(c => c.trim() !== '').map(c => c.trim()).join('|');
		if (srcCells !== firstRowText) continue;

		// Found potential start — find end
		let end = i;
		for (let j = i + 1; j < sourceLines.length; j++) {
			const l = sourceLines[j]!.trim();
			if (l.startsWith('|')) {
				end = j;
			} else {
				break;
			}
		}
		return { start: i, end };
	}
	return null;
}

/**
 * Replace a table in the active file using the Editor API (for live preview).
 * Uses editor.replaceRange() which properly triggers Obsidian's live preview re-render.
 */
export function replaceTableInEditor(
	editor: Editor,
	tableEl: HTMLTableElement,
	newContent: string,
): boolean {
	const sourceText = editor.getValue();
	const lines = sourceText.split('\n');
	const range = findTableInSource(lines, tableEl);
	if (!range) return false;

	const from = { line: range.start, ch: 0 };
	const to = { line: range.end, ch: lines[range.end]!.length };
	editor.replaceRange(newContent, from, to);
	return true;
}

/**
 * Read table source from the editor (for live preview).
 */
export function readTableSourceFromEditor(
	editor: Editor,
	tableEl: HTMLTableElement,
): string | null {
	const sourceText = editor.getValue();
	const lines = sourceText.split('\n');
	const range = findTableInSource(lines, tableEl);
	if (!range) return null;
	return lines.slice(range.start, range.end + 1).join('\n');
}

/**
 * Check if a table in the editor is HTML source (for live preview).
 */
export function isTableHtmlInEditor(
	editor: Editor,
	tableEl: HTMLTableElement,
): boolean {
	const sourceText = editor.getValue();
	const lines = sourceText.split('\n');
	const range = findTableInSource(lines, tableEl);
	if (!range) return false;
	return isHtmlInSection(lines[range.start]!);
}

// --- Legacy vault-based functions (kept for reading mode) ---

/**
 * Replace a table in the active file source via vault API (legacy, reading mode fallback).
 */
export async function replaceTableInActiveFile(
	app: App,
	tableEl: HTMLTableElement,
	newContent: string,
): Promise<boolean> {
	const view = app.workspace.getActiveViewOfType(MarkdownView);
	if (!view) return false;

	const file = view.file;
	if (!file) return false;

	const content = await app.vault.read(file);
	const lines = content.split('\n');
	const range = findTableInSource(lines, tableEl);
	if (!range) return false;

	const newLines = newContent.split('\n');
	lines.splice(range.start, range.end - range.start + 1, ...newLines);

	await app.vault.modify(file, lines.join('\n'));
	return true;
}

/**
 * Check if a table in the active file is HTML source via vault API (legacy).
 */
export async function isTableHtmlInActiveFile(
	app: App,
	tableEl: HTMLTableElement,
): Promise<boolean> {
	const view = app.workspace.getActiveViewOfType(MarkdownView);
	if (!view) return false;

	const file = view.file;
	if (!file) return false;

	const content = await app.vault.read(file);
	const lines = content.split('\n');
	const range = findTableInSource(lines, tableEl);
	if (!range) return false;

	return isHtmlInSection(lines[range.start]!);
}

/**
 * Read table source from the active file via vault API (legacy).
 */
export async function readTableSourceFromActiveFile(
	app: App,
	tableEl: HTMLTableElement,
): Promise<string | null> {
	const view = app.workspace.getActiveViewOfType(MarkdownView);
	if (!view) return null;

	const file = view.file;
	if (!file) return null;

	const content = await app.vault.read(file);
	const lines = content.split('\n');
	const range = findTableInSource(lines, tableEl);
	if (!range) return null;

	return lines.slice(range.start, range.end + 1).join('\n');
}
