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

// --- Table block detection in source ---

interface TableBlock {
	start: number; // first line of table (inclusive)
	end: number;   // last line of table (inclusive)
	kind: 'markdown' | 'html';
}

/**
 * Find all table blocks in source lines.
 * A table block is a contiguous sequence of lines starting with '|'.
 * Also includes a following separator line if present.
 */
function findAllTableBlocks(lines: string[]): TableBlock[] {
	const blocks: TableBlock[] = [];
	let i = 0;
	while (i < lines.length) {
		const line = lines[i]!.trim();
		if (line.startsWith('|')) {
			const start = i;
			let end = i;
			while (end + 1 < lines.length && lines[end + 1]!.trim().startsWith('|')) {
				end++;
			}
			blocks.push({ start, end, kind: 'markdown' });
			i = end + 1;
		} else if (/^<table[\s>]/i.test(line)) {
			const start = i;
			let end = i;
			while (end + 1 < lines.length && !/<\/table>/i.test(lines[end]!)) {
				end++;
			}
			blocks.push({ start, end, kind: 'html' });
			i = end + 1;
		} else {
			i++;
		}
	}
	return blocks;
}

/**
 * Find the source position of a specific table element by matching its position
 * among all tables in the DOM (the Nth table in the DOM = the Nth table block in source).
 */
export function findTableInSource(sourceLines: string[], tableEl: HTMLTableElement): TableBlock | null {
	// Find all table blocks in source
	const blocks = findAllTableBlocks(sourceLines);
	if (blocks.length === 0) return null;

	// Find the index of this table among all tables in the document
	const allTables = Array.from(activeDocument.querySelectorAll('table'));
	const tableIndex = allTables.indexOf(tableEl);

	if (tableIndex < 0) {
		// Fallback: try content matching
		return findTableByContent(sourceLines, tableEl, blocks);
	}

	// Count how many tables before this one in the same container
	// to handle nested tables and multiple editors
	const container = tableEl.closest('.markdown-preview-view, .markdown-source-view, .cm-editor')
		?? tableEl.closest('.view-content')
		?? activeDocument.body;
	const tablesInContainer = Array.from(container.querySelectorAll('table'));
	const localIndex = tablesInContainer.indexOf(tableEl);

	if (localIndex >= 0 && localIndex < blocks.length) {
		return blocks[localIndex]!;
	}

	// Fallback: use global index
	if (tableIndex < blocks.length) {
		return blocks[tableIndex]!;
	}

	// Last fallback: content matching
	return findTableByContent(sourceLines, tableEl, blocks);
}

/**
 * Fallback: find table by matching first row content.
 */
function findTableByContent(sourceLines: string[], tableEl: HTMLTableElement, blocks: TableBlock[]): TableBlock | null {
	const firstRow = tableEl.querySelector('tr');
	if (!firstRow) return null;
	const firstRowText = Array.from(firstRow.querySelectorAll('td, th'))
		.map(c => c.textContent?.trim() ?? '')
		.join('|');

	for (const block of blocks) {
		const source = sourceLines.slice(block.start, block.end + 1).join('\n');
		const srcCells = block.kind === 'html'
			? getFirstHtmlRowText(source)
			: sourceLines[block.start]!.trim().split('|').filter(c => c.trim() !== '').map(c => c.trim()).join('|');
		if (srcCells === firstRowText) {
			return block;
		}
	}
	return null;
}

function getFirstHtmlRowText(html: string): string {
	const parser = new DOMParser();
	const doc = parser.parseFromString(html, 'text/html');
	const firstRow = doc.querySelector('tr');
	if (!firstRow) return '';
	return Array.from(firstRow.querySelectorAll('td, th'))
		.map(c => c.textContent?.trim() ?? '')
		.join('|');
}

/**
 * Replace a table in the active file using the Editor API (for live preview).
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
	return range.kind === 'html' || isHtmlInSection(lines.slice(range.start, range.end + 1).join('\n'));
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
