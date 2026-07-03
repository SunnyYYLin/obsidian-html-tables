import { Editor, Notice } from 'obsidian';
import type { Locale } from './i18n';
import { SelectionManager, getCellPosition } from './selection';

/**
 * Get all visible cells in a table (excludes merged-cell-hidden).
 */
export function getTableCells(tableEl: HTMLTableElement): HTMLElement[] {
	return Array.from(tableEl.querySelectorAll<HTMLElement>('td, th'))
		.filter(cell => !cell.hasClass('merged-cell-hidden'));
}

export function isWholeTableSelected(tableEl: HTMLTableElement): boolean {
	const cells = getTableCells(tableEl);
	return cells.length > 0 && cells.every(cell => cell.hasClass('cell-selected'));
}

export function isMergedCell(cell: HTMLElement): boolean {
	return cell.hasAttribute('rowspan') || cell.hasAttribute('colspan');
}

/**
 * Find the merged cell that should be unmerged, prioritizing the right-clicked cell.
 */
export function getActionMergedCell(
	tableEl: HTMLTableElement,
	lastRightClickedCell: HTMLElement | null,
): HTMLElement | null {
	const candidates = [
		lastRightClickedCell,
		...SelectionManager.getSelected(tableEl),
	].filter((cell): cell is HTMLElement => cell !== null && cell.closest('table') === tableEl);

	return candidates.find(cell => isMergedCell(cell)) ?? null;
}

function createEmptyMergeCells(
	rowSpan: number,
	colSpan: number,
	tag: string,
): Array<{ row: number; col: number; tag: string; text: string }> {
	const cells: Array<{ row: number; col: number; tag: string; text: string }> = [];
	for (let row = 0; row < rowSpan; row++) {
		for (let col = 0; col < colSpan; col++) {
			if (row === 0 && col === 0) continue;
			cells.push({ row, col, tag, text: '' });
		}
	}
	return cells;
}

export interface MergerCallbacks {
	addCellSelectionHandlers(tableEl: HTMLTableElement): void;
	persistTableChanges(tableEl: HTMLTableElement, editor?: Editor): boolean;
}

/**
 * Merge selected cells into one spanning cell.
 */
export function mergeSelectedCells(
	tableEl: HTMLTableElement,
	t: Locale,
	callbacks: MergerCallbacks,
	editor?: Editor,
): void {
	if (!callbacks.persistTableChanges(tableEl, editor)) return;
	const selected = SelectionManager.getSelected(tableEl);
	if (selected.length < 2) {
		new Notice(t.selectAtLeast2Cells);
		return;
	}

	const positions = selected
		.map(cell => ({ cell, pos: getCellPosition(cell) }))
		.filter(item => item.pos !== null) as Array<{ cell: HTMLElement; pos: { row: number; col: number } }>;

	if (positions.length < 2) return;

	const minRow = Math.min(...positions.map(p => p.pos.row));
	const maxRow = Math.max(...positions.map(p => p.pos.row));
	const minCol = Math.min(...positions.map(p => p.pos.col));
	const maxCol = Math.max(...positions.map(p => p.pos.col));

	const targetItem = positions.find(p => p.pos.row === minRow && p.pos.col === minCol);
	if (!targetItem) return;

	const targetCell = targetItem.cell;
	const rowSpan = maxRow - minRow + 1;
	const colSpan = maxCol - minCol + 1;

	if (rowSpan > 1) {
		targetCell.setAttribute('rowspan', rowSpan.toString());
	}
	if (colSpan > 1) {
		targetCell.setAttribute('colspan', colSpan.toString());
	}

	const rows = tableEl.querySelectorAll('tr');
	for (let r = minRow; r <= maxRow; r++) {
		const row = rows[r];
		if (!row) continue;
		const cells = row.querySelectorAll('td, th');
		for (let c = minCol; c <= maxCol; c++) {
			if (r === minRow && c === minCol) continue;
			const cell = cells[c] as HTMLElement;
			if (cell) {
				cell.addClass('merged-cell-hidden');
				cell.setAttribute('data-merged', 'true');
			}
		}
	}

	SelectionManager.clearTable(tableEl);
	new Notice(t.cellsMerged);
	callbacks.persistTableChanges(tableEl, editor);
}

/**
 * Unmerge a merged cell, restoring hidden cells.
 */
export function unmergeCells(
	tableEl: HTMLTableElement,
	t: Locale,
	callbacks: MergerCallbacks,
	lastRightClickedCell: HTMLElement | null,
	editor?: Editor,
): void {
	if (!callbacks.persistTableChanges(tableEl, editor)) return;
	const mergedCell = getActionMergedCell(tableEl, lastRightClickedCell);

	if (!mergedCell) {
		new Notice(t.cellNotMerged);
		return;
	}

	const rowSpan = parseInt(mergedCell.getAttribute('rowspan') || '1');
	const colSpan = parseInt(mergedCell.getAttribute('colspan') || '1');

	const cellsToRestore = createEmptyMergeCells(rowSpan, colSpan, mergedCell.tagName.toLowerCase());
	mergedCell.removeAttribute('rowspan');
	mergedCell.removeAttribute('colspan');

	const pos = getCellPosition(mergedCell);
	if (!pos) return;

	const rows = tableEl.querySelectorAll('tr');
	for (let r = pos.row; r < pos.row + rowSpan; r++) {
		const row = rows[r];
		if (!row) continue;
		const cells = row.querySelectorAll('td, th');
		for (let c = pos.col; c < pos.col + colSpan; c++) {
			if (r === pos.row && c === pos.col) continue;
			const hiddenCell = cells[c] as HTMLElement;
			if (hiddenCell && hiddenCell.hasClass('merged-cell-hidden')) {
				hiddenCell.removeClass('merged-cell-hidden');
				hiddenCell.removeAttribute('data-merged');
				hiddenCell.removeAttribute('data-better-raw');
				hiddenCell.empty();
			}
		}
	}

	cellsToRestore.forEach(stored => {
		if (stored.row === 0 && stored.col === 0) return;
		const row = rows[pos.row + stored.row];
		if (!row) return;
		const existing = row.querySelectorAll('td, th')[pos.col + stored.col] as HTMLElement | undefined;
		if (existing?.hasClass('merged-cell-hidden')) return;

		const restoredCell = activeDocument.createElement(stored.tag === 'th' ? 'th' : 'td');
		restoredCell.textContent = stored.text;
		const before = row.querySelectorAll('td, th')[pos.col + stored.col] ?? null;
		row.insertBefore(restoredCell, before);
	});
	callbacks.addCellSelectionHandlers(tableEl);

	new Notice(t.cellsUnmerged);
	callbacks.persistTableChanges(tableEl, editor);
}
