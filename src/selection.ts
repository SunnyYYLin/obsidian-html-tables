/**
 * Selection management for table cells.
 * Tracks per-table selected cells using WeakMap to avoid memory leaks.
 */

const selectedMap = new WeakMap<HTMLTableElement, HTMLElement[]>();
const lastSelectedMap = new WeakMap<HTMLTableElement, HTMLElement>();

// --- Cell position utility ---

/**
 * Get the row and column index of a cell within its parent table.
 * Returns null if the cell is not inside a table.
 */
export function getCellPosition(cellEl: HTMLElement): { row: number; col: number } | null {
	const row = cellEl.closest('tr');
	if (!row) return null;
	const table = cellEl.closest<HTMLTableElement>('table');
	if (!table) return null;

	const rows = Array.from(table.querySelectorAll('tr'));
	const rowIndex = rows.indexOf(row);
	if (rowIndex < 0) return null;

	const cells = Array.from(row.querySelectorAll('td, th'));
	const colIndex = cells.indexOf(cellEl);
	if (colIndex < 0) return null;

	return { row: rowIndex, col: colIndex };
}

// --- SelectionManager ---

export const SelectionManager = {
	getSelected(tableEl: HTMLTableElement): HTMLElement[] {
		return selectedMap.get(tableEl) ?? [];
	},

	getLastSelected(tableEl: HTMLTableElement): HTMLElement | undefined {
		return lastSelectedMap.get(tableEl);
	},

	setLastSelected(tableEl: HTMLTableElement, cell: HTMLElement): void {
		lastSelectedMap.set(tableEl, cell);
	},

	select(tableEl: HTMLTableElement, cellEl: HTMLElement): void {
		const list = selectedMap.get(tableEl) ?? [];
		cellEl.addClass('cell-selected');
		if (!list.includes(cellEl)) {
			list.push(cellEl);
		}
		selectedMap.set(tableEl, list);
	},

	toggle(tableEl: HTMLTableElement, cellEl: HTMLElement): void {
		const list = selectedMap.get(tableEl) ?? [];
		const idx = list.indexOf(cellEl);
		if (idx >= 0) {
			cellEl.removeClass('cell-selected');
			list.splice(idx, 1);
		} else {
			cellEl.addClass('cell-selected');
			list.push(cellEl);
		}
		selectedMap.set(tableEl, list);
	},

	clearTable(tableEl: HTMLTableElement): void {
		const list = selectedMap.get(tableEl) ?? [];
		for (const cell of list) {
			cell.removeClass('cell-selected');
		}
		selectedMap.set(tableEl, []);
	},

	selectRange(tableEl: HTMLTableElement, start: HTMLElement, end: HTMLElement): void {
		this.clearTable(tableEl);
		const startPos = getCellPosition(start);
		const endPos = getCellPosition(end);
		if (!startPos || !endPos) return;

		const minRow = Math.min(startPos.row, endPos.row);
		const maxRow = Math.max(startPos.row, endPos.row);
		const minCol = Math.min(startPos.col, endPos.col);
		const maxCol = Math.max(startPos.col, endPos.col);

		const rows = Array.from(tableEl.querySelectorAll('tr'));
		for (let r = minRow; r <= maxRow; r++) {
			const row = rows[r];
			if (!row) continue;
			const cells = Array.from(row.querySelectorAll<HTMLElement>('td, th'));
			for (let c = minCol; c <= maxCol; c++) {
				const cell = cells[c];
				if (cell) this.select(tableEl, cell);
			}
		}
	},

	selectRowRange(tableEl: HTMLTableElement, startIndex: number, endIndex: number): void {
		this.clearTable(tableEl);
		const minRow = Math.min(startIndex, endIndex);
		const maxRow = Math.max(startIndex, endIndex);
		const rows = Array.from(tableEl.querySelectorAll('tr'));
		for (let r = minRow; r <= maxRow; r++) {
			const row = rows[r];
			if (!row) continue;
			const cells = Array.from(row.querySelectorAll<HTMLElement>('td, th'));
			for (const cell of cells) {
				this.select(tableEl, cell);
			}
		}
	},

	selectColumnRange(tableEl: HTMLTableElement, startIndex: number, endIndex: number): void {
		this.clearTable(tableEl);
		const minCol = Math.min(startIndex, endIndex);
		const maxCol = Math.max(startIndex, endIndex);
		const rows = Array.from(tableEl.querySelectorAll('tr'));
		for (const row of rows) {
			const cells = Array.from(row.querySelectorAll<HTMLElement>('td, th'));
			for (let c = minCol; c <= maxCol; c++) {
				const cell = cells[c];
				if (cell) this.select(tableEl, cell);
			}
		}
	},

	/**
	 * Sync selected cells from the browser's native Selection API.
	 * Any td/th nodes inside the selection are marked as selected.
	 */
	syncFromNativeSelection(tableEl: HTMLTableElement): void {
		this.clearTable(tableEl);
		const sel = activeWindow.getSelection();
		if (!sel || sel.rangeCount === 0) return;
		const range = sel.getRangeAt(0);
		const cells = Array.from(tableEl.querySelectorAll<HTMLElement>('td, th'));
		for (const cell of cells) {
			if (range.intersectsNode(cell)) {
				this.select(tableEl, cell);
			}
		}
	},
};
