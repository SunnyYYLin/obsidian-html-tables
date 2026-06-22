import { App, MarkdownPostProcessorContext, TFile, MarkdownView, Editor } from 'obsidian';
import { getTableCellText, isHtmlInSection } from './html-serializer';

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
	const lineStart = getCaptionStart(lines, info.lineStart);

	// Replace lines lineStart..lineEnd with newContent
	const newLines = newContent.split('\n');
	lines.splice(lineStart, info.lineEnd - lineStart + 1, ...newLines);

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

export interface TableBlock {
	start: number; // first line of table (inclusive)
	end: number;   // last line of table (inclusive)
	kind: 'markdown' | 'html';
}

/**
 * Find all table blocks in source lines.
 * A table block is a contiguous sequence of lines starting with '|'.
 * Also includes a following separator line if present.
 */
export function findAllTableBlocks(lines: string[]): TableBlock[] {
	const blocks: TableBlock[] = [];
	let i = 0;
	while (i < lines.length) {
		const line = lines[i]!.trim();
		if (line.startsWith('|')) {
			const start = getCaptionStart(lines, i);
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

function getCaptionStart(lines: string[], tableStart: number): number {
	const previousLine = tableStart - 1;
	if (previousLine >= 0 && isCaptionLine(lines[previousLine]!)) {
		return previousLine;
	}

	const lineBeforeBlank = tableStart - 2;
	if (
		previousLine >= 0 &&
		lines[previousLine]!.trim() === '' &&
		lineBeforeBlank >= 0 &&
		isCaptionLine(lines[lineBeforeBlank]!)
	) {
		return lineBeforeBlank;
	}

	return tableStart;
}

function isCaptionLine(line: string): boolean {
	const trimmed = line.trim();
	return /^\[.+]$/.test(trimmed);
}

export function findTableAtLine(sourceLines: string[], line: number): TableBlock | null {
	const blocks = findAllTableBlocks(sourceLines);
	return blocks.find(block => line >= block.start && line <= block.end) ?? null;
}

export function findTableNearEditorSelection(editor: Editor): TableBlock | null {
	const lines = editor.getValue().split('\n');
	const from = editor.getCursor('from');
	const to = editor.getCursor('to');
	const startLine = Math.min(from.line, to.line);
	const endLine = Math.max(from.line, to.line);

	for (let line = startLine; line <= endLine; line++) {
		const block = findTableAtLine(lines, line);
		if (block) return block;
	}

	const cursorBlock = findTableAtLine(lines, editor.getCursor().line);
	if (cursorBlock) return cursorBlock;

	return null;
}

/**
 * Find the source position of a specific table element by matching its position
 * among all tables in the DOM (the Nth table in the DOM = the Nth table block in source).
 */
export function findTableInSource(sourceLines: string[], tableEl: HTMLTableElement): TableBlock | null {
	// Find all table blocks in source
	const blocks = findAllTableBlocks(sourceLines);
	if (blocks.length === 0) return null;

	const contentMatch = findTableByContent(sourceLines, tableEl, blocks);
	if (contentMatch) return contentMatch;

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
	const tableSignature = getDomTableSignature(tableEl);
	if (tableSignature.length === 0) return null;

	const matches: Array<{ block: TableBlock; score: number }> = [];
	for (const block of blocks) {
		const source = sourceLines.slice(block.start, block.end + 1).join('\n');
		const sourceSignature = block.kind === 'html'
			? getHtmlTableSignature(source)
			: getMarkdownTableSignature(sourceLines, block);
		const score = getSignatureMatchScore(sourceSignature, tableSignature);
		if (score > 0) {
			matches.push({ block, score });
		}
	}
	if (matches.length === 0) return null;

	const bestScore = Math.max(...matches.map(match => match.score));
	const bestMatches = matches.filter(match => match.score === bestScore);
	return bestMatches.length === 1 ? bestMatches[0]!.block : null;
}

function getDomTableSignature(tableEl: HTMLTableElement): string[] {
	return Array.from(tableEl.querySelectorAll('tr'))
		.map(row => Array.from(row.querySelectorAll('td, th'))
			.map(c => getTableCellText(c as HTMLTableCellElement))
			.join('|'))
		.filter(row => row.length > 0);
}

function getHtmlTableSignature(html: string): string[] {
	const parser = new DOMParser();
	const doc = parser.parseFromString(html, 'text/html');
	return Array.from(doc.querySelectorAll('tr'))
		.map(row => Array.from(row.querySelectorAll('td, th'))
			.map(c => c.textContent?.trim() ?? '')
			.join('|'))
		.filter(row => row.length > 0);
}

function getMarkdownTableSignature(sourceLines: string[], block: TableBlock): string[] {
	return sourceLines.slice(block.start, block.end + 1)
		.filter(line => line.trim().startsWith('|') && !isMarkdownSeparator(line.trim()))
		.map(line => line.trim().split('|').filter(c => c.trim() !== '').map(c => c.trim()).join('|'))
		.filter(row => row.length > 0);
}

function getSignatureMatchScore(sourceSignature: string[], tableSignature: string[]): number {
	if (sourceSignature.length === 0 || tableSignature.length === 0) return 0;
	if (sourceSignature[0] !== tableSignature[0]) return 0;

	let score = 1;
	const comparableRows = Math.min(sourceSignature.length, tableSignature.length);
	for (let index = 1; index < comparableRows; index++) {
		if (sourceSignature[index] !== tableSignature[index]) break;
		score++;
	}

	return score;
}

function isMarkdownSeparator(line: string): boolean {
	if (!line.startsWith('|')) return false;
	const cells = line.split('|').filter(c => c.trim() !== '');
	return cells.length > 0 && cells.every(c => /^:?-+:?$/.test(c.trim()));
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
	const range = findTableNearEditorSelection(editor) ?? findTableInSource(lines, tableEl);
	if (!range) return false;

	return replaceTableRangeInEditor(editor, range, newContent);
}

export function replaceTableRangeInEditor(
	editor: Editor,
	range: TableBlock,
	newContent: string,
): boolean {
	const lines = editor.getValue().split('\n');
	const anchor = editor.getCursor('anchor');
	const head = editor.getCursor('head');
	const from = { line: range.start, ch: 0 };
	const to = { line: range.end, ch: lines[range.end]!.length };
	const oldLineCount = range.end - range.start + 1;
	const newLineCount = newContent.split('\n').length;
	editor.replaceRange(newContent, from, to);
	const maxLine = editor.getValue().split('\n').length - 1;
	const restoredAnchor = restorePosition(anchor, range, oldLineCount, newLineCount, maxLine);
	const restoredHead = restorePosition(head, range, oldLineCount, newLineCount, maxLine);
	editor.setSelection(restoredAnchor, restoredHead);
	editor.scrollIntoView({ from: restoredHead, to: restoredHead }, false);
	return true;
}

function restorePosition(
	position: { line: number; ch: number },
	range: TableBlock,
	oldLineCount: number,
	newLineCount: number,
	maxLine: number,
): { line: number; ch: number } {
	const lineDelta = newLineCount - oldLineCount;
	if (position.line > range.end) {
		return {
			line: clampLine(position.line + lineDelta, maxLine),
			ch: position.ch,
		};
	}
	if (position.line >= range.start) {
		const offset = Math.min(position.line - range.start, newLineCount - 1);
		return {
			line: clampLine(range.start + offset, maxLine),
			ch: position.ch,
		};
	}
	return {
		line: clampLine(position.line, maxLine),
		ch: position.ch,
	};
}

function clampLine(line: number, maxLine: number): number {
	return Math.max(0, Math.min(line, maxLine));
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
	const range = findTableNearEditorSelection(editor) ?? findTableInSource(lines, tableEl);
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
	const range = findTableNearEditorSelection(editor) ?? findTableInSource(lines, tableEl);
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
