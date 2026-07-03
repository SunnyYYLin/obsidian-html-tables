import { Editor, Notice } from 'obsidian';
import type { Locale } from './i18n';
import { findTableNearEditorSelection, findTableInSource } from './source-editor';
import { isMarkdownSeparator } from './parser';

/**
 * Count the number of columns in a markdown table row.
 */
export function countTableColumns(lines: string[], tableStart: number): number {
	const line = lines[tableStart]?.trim() ?? '';
	return line.split('|').filter(c => c.trim() !== '').length;
}

/**
 * Check if the first row of a table is a header (all <TH> cells).
 */
export function hasHeaderRow(tableEl: HTMLTableElement): boolean {
	const firstRowCells = Array.from(tableEl.querySelector('tr')?.querySelectorAll('td, th') ?? []);
	return firstRowCells.length > 0 && firstRowCells.every(cell => cell.tagName === 'TH');
}

/**
 * Check if the first column of a table is a header (all <TH> cells in non-first rows).
 */
export function hasHeaderColumn(tableEl: HTMLTableElement): boolean {
	const rows = Array.from(tableEl.querySelectorAll('tr'));
	const dataRows = rows.length > 1 ? rows.slice(1) : rows;
	const firstColumnCells = dataRows
		.map(row => row.querySelector('td, th'))
		.filter(cell => cell !== null);
	return firstColumnCells.length > 0 && firstColumnCells.every(cell => cell.tagName === 'TH');
}

/**
 * Toggle the first row between header (<TH>) and data (<TD>) cells.
 * Returns true if a header was added.
 */
export function toggleHeaderRowInDom(tableEl: HTMLTableElement): boolean {
	const firstRow = tableEl.querySelector('tr');
	if (!firstRow) return false;
	const cells = Array.from(firstRow.querySelectorAll('td, th'));
	const firstRowIsHeader = cells.length > 0 && cells.every(cell => cell.tagName === 'TH');
	const headerColumnEnabled = hasHeaderColumn(tableEl);
	cells.forEach(cell => {
		const index = cells.indexOf(cell);
		const shouldBeHeader = !firstRowIsHeader || (headerColumnEnabled && index === 0);
		const newCell = activeDocument.createElement(shouldBeHeader ? 'th' : 'td');
		cell.childNodes.forEach(node => newCell.appendChild(node.cloneNode(true)));
		Array.from(cell.attributes).forEach(attr => {
			newCell.setAttribute(attr.name, attr.value);
		});
		cell.replaceWith(newCell);
	});
	return !firstRowIsHeader;
}

/**
 * Toggle the first column between header (<TH>) and data (<TD>) cells.
 */
export function toggleHeaderColumnInDom(tableEl: HTMLTableElement): void {
	const rows = Array.from(tableEl.querySelectorAll('tr'));
	const firstColumnIsHeader = hasHeaderColumn(tableEl);
	const firstRowIsHeader = hasHeaderRow(tableEl);
	rows.forEach((row, rowIndex) => {
		const firstCell = row.querySelector('td, th');
		if (!firstCell) return;

		const shouldBeHeader = !firstColumnIsHeader || (firstRowIsHeader && rowIndex === 0);
		const newCell = activeDocument.createElement(shouldBeHeader ? 'th' : 'td');
		firstCell.childNodes.forEach(node => newCell.appendChild(node.cloneNode(true)));
		Array.from(firstCell.attributes).forEach(attr => {
			newCell.setAttribute(attr.name, attr.value);
		});
		firstCell.replaceWith(newCell);
	});
}

export interface HeaderToggleCallbacks {
	canPersistLiveTable(editor: Editor | undefined, tableEl: HTMLTableElement): boolean;
	persistTableChanges(tableEl: HTMLTableElement, editor?: Editor): boolean;
}

/**
 * Toggle header row — tries source editing first, falls back to DOM manipulation.
 */
export function toggleHeaderRow(
	tableEl: HTMLTableElement | undefined,
	editor: Editor | undefined,
	t: Locale,
	callbacks: HeaderToggleCallbacks,
): void {
	if (editor) {
		const sourceText = editor.getValue();
		const lines = sourceText.split('\n');
		const range = findTableNearEditorSelection(editor) ?? (tableEl ? findTableInSource(lines, tableEl) : null);
		if (range && range.kind === 'markdown') {
			const secondLine = lines[range.start + 1]?.trim() ?? '';
			const isSeparator = isMarkdownSeparator(secondLine);

			if (isSeparator) {
				editor.replaceRange(
					'',
					{ line: range.start + 1, ch: 0 },
					{ line: range.start + 2, ch: 0 }
				);
				new Notice(t.headerRowRemoved);
			} else {
				const numCols = countTableColumns(lines, range.start);
				const separator = '| ' + Array(numCols).fill('---').join(' | ') + ' |';
				editor.replaceRange(
					separator + '\n',
					{ line: range.start + 1, ch: 0 },
					{ line: range.start + 1, ch: 0 }
				);
				new Notice(t.headerRowAdded);
			}
			return;
		}
	}

	if (!tableEl) return;
	if (editor && !callbacks.canPersistLiveTable(editor, tableEl)) return;
	const added = toggleHeaderRowInDom(tableEl);
	callbacks.persistTableChanges(tableEl, editor);
	new Notice(added ? t.headerRowAdded : t.headerRowRemoved);
}

/**
 * Toggle header column via DOM manipulation.
 */
export function toggleHeaderColumn(
	tableEl: HTMLTableElement,
	editor: Editor | undefined,
	t: Locale,
	callbacks: HeaderToggleCallbacks,
): void {
	if (editor && !callbacks.canPersistLiveTable(editor, tableEl)) return;
	toggleHeaderColumnInDom(tableEl);
	callbacks.persistTableChanges(tableEl, editor);
	new Notice(t.headerColumnToggled);
}
