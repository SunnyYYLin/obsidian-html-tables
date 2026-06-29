/**
 * Selection management for table cells.
 * Tracks per-table selected cells using WeakMap to avoid memory leaks.
 */

const selectedMap = new WeakMap<HTMLTableElement, HTMLElement[]>();
const lastSelectedMap = new WeakMap<HTMLTableElement, HTMLElement>();

// --- Virtual Grid Matrix Builder for spanning support ---

interface CellCoordinate {
	rowStart: number;
	colStart: number;
	rowEnd: number;
	colEnd: number;
}

interface TableGridInfo {
	matrix: Array<Array<HTMLElement | null>>;
	cellCoords: Map<HTMLElement, CellCoordinate>;
}

function buildTableGrid(tableEl: HTMLTableElement): TableGridInfo {
	const rows = Array.from(tableEl.querySelectorAll('tr'));
	const matrix: Array<Array<HTMLElement | null>> = [];
	const cellCoords = new Map<HTMLElement, CellCoordinate>();

	rows.forEach((row, r) => {
		if (!matrix[r]) matrix[r] = [];
		const cells = Array.from(row.querySelectorAll(':scope > td, :scope > th'));
		let c = 0;

		cells.forEach((cellEl) => {
			const htmlCell = cellEl as HTMLTableCellElement;
			if (htmlCell.hasClass('merged-cell-hidden')) return;

			const rowspan = parseInt(htmlCell.getAttribute('rowspan') || '1', 10);
			const colspan = parseInt(htmlCell.getAttribute('colspan') || '1', 10);

			while (matrix[r]![c] !== undefined) {
				c++;
			}

			const coords = {
				rowStart: r,
				colStart: c,
				rowEnd: r + rowspan - 1,
				colEnd: c + colspan - 1,
			};
			cellCoords.set(htmlCell, coords);

			for (let dr = 0; dr < rowspan; dr++) {
				const nr = r + dr;
				if (!matrix[nr]) matrix[nr] = [];
				for (let dc = 0; dc < colspan; dc++) {
					const nc = c + dc;
					matrix[nr][nc] = htmlCell;
				}
			}
			c += colspan;
		});
	});

	return { matrix, cellCoords };
}

// --- Cell position utility ---

/**
 * Get the row and column index of a cell within its parent table.
 * Returns null if the cell is not inside a table.
 */
export function getCellPosition(cellEl: HTMLElement): { row: number; col: number } | null {
	const table = cellEl.closest<HTMLTableElement>('table');
	if (!table) return null;
	const gridInfo = buildTableGrid(table);
	const coords = gridInfo.cellCoords.get(cellEl);
	if (!coords) return null;
	return { row: coords.rowStart, col: coords.colStart };
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

	getTableGrid(tableEl: HTMLTableElement): TableGridInfo {
		return buildTableGrid(tableEl);
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
		const gridInfo = this.getTableGrid(tableEl);
		const { matrix, cellCoords } = gridInfo;

		const coordsStart = cellCoords.get(start);
		const coordsEnd = cellCoords.get(end);
		if (!coordsStart || !coordsEnd) return;

		let minRow = Math.min(coordsStart.rowStart, coordsEnd.rowStart);
		let maxRow = Math.max(coordsStart.rowEnd, coordsEnd.rowEnd);
		let minCol = Math.min(coordsStart.colStart, coordsEnd.colStart);
		let maxCol = Math.max(coordsStart.colEnd, coordsEnd.colEnd);

		let expanded = true;
		while (expanded) {
			expanded = false;
			for (let r = minRow; r <= maxRow; r++) {
				for (let c = minCol; c <= maxCol; c++) {
					const cell = matrix[r]?.[c];
					if (cell) {
						const coords = cellCoords.get(cell)!;
						if (coords.rowStart < minRow) {
							minRow = coords.rowStart;
							expanded = true;
						}
						if (coords.rowEnd > maxRow) {
							maxRow = coords.rowEnd;
							expanded = true;
						}
						if (coords.colStart < minCol) {
							minCol = coords.colStart;
							expanded = true;
						}
						if (coords.colEnd > maxCol) {
							maxCol = coords.colEnd;
							expanded = true;
						}
					}
				}
			}
		}

		const cellsToSelect = new Set<HTMLElement>();
		for (let r = minRow; r <= maxRow; r++) {
			for (let c = minCol; c <= maxCol; c++) {
				const cell = matrix[r]?.[c];
				if (cell) {
					cellsToSelect.add(cell);
				}
			}
		}

		cellsToSelect.forEach(cell => this.select(tableEl, cell));
	},

	selectRowRange(tableEl: HTMLTableElement, startIndex: number, endIndex: number): void {
		this.clearTable(tableEl);
		const gridInfo = this.getTableGrid(tableEl);
		const { matrix, cellCoords } = gridInfo;

		let minRow = Math.min(startIndex, endIndex);
		let maxRow = Math.max(startIndex, endIndex);
		let minCol = 0;
		let maxCol = (matrix[0]?.length || 1) - 1;

		let expanded = true;
		while (expanded) {
			expanded = false;
			for (let r = minRow; r <= maxRow; r++) {
				for (let c = minCol; c <= maxCol; c++) {
					const cell = matrix[r]?.[c];
					if (cell) {
						const coords = cellCoords.get(cell)!;
						if (coords.rowStart < minRow) {
							minRow = coords.rowStart;
							expanded = true;
						}
						if (coords.rowEnd > maxRow) {
							maxRow = coords.rowEnd;
							expanded = true;
						}
					}
				}
			}
		}

		const cellsToSelect = new Set<HTMLElement>();
		for (let r = minRow; r <= maxRow; r++) {
			for (let c = minCol; c <= maxCol; c++) {
				const cell = matrix[r]?.[c];
				if (cell) {
					cellsToSelect.add(cell);
				}
			}
		}
		cellsToSelect.forEach(cell => this.select(tableEl, cell));
	},

	selectColumnRange(tableEl: HTMLTableElement, startIndex: number, endIndex: number): void {
		this.clearTable(tableEl);
		const gridInfo = this.getTableGrid(tableEl);
		const { matrix, cellCoords } = gridInfo;

		let minRow = 0;
		let maxRow = matrix.length - 1;
		let minCol = Math.min(startIndex, endIndex);
		let maxCol = Math.max(startIndex, endIndex);

		let expanded = true;
		while (expanded) {
			expanded = false;
			for (let r = minRow; r <= maxRow; r++) {
				for (let c = minCol; c <= maxCol; c++) {
					const cell = matrix[r]?.[c];
					if (cell) {
						const coords = cellCoords.get(cell)!;
						if (coords.colStart < minCol) {
							minCol = coords.colStart;
							expanded = true;
						}
						if (coords.colEnd > maxCol) {
							maxCol = coords.colEnd;
							expanded = true;
						}
					}
				}
			}
		}

		const cellsToSelect = new Set<HTMLElement>();
		for (let r = minRow; r <= maxRow; r++) {
			for (let c = minCol; c <= maxCol; c++) {
				const cell = matrix[r]?.[c];
				if (cell) {
					cellsToSelect.add(cell);
				}
			}
		}
		cellsToSelect.forEach(cell => this.select(tableEl, cell));
	},

	/**
	 * Sync selected cells from the browser's native Selection API.
	 * Any td/th nodes inside the selection are marked as selected.
	 */
	syncFromNativeSelection(tableEl: HTMLTableElement): void {
		const sel = activeWindow.getSelection();
		if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;

		const selectedCells = Array.from(tableEl.querySelectorAll<HTMLElement>('td, th'))
			.filter(cell => {
				for (let i = 0; i < sel.rangeCount; i++) {
					if (sel.getRangeAt(i).intersectsNode(cell)) return true;
				}
				return false;
			});

		if (selectedCells.length < 2) return;
		this.clearTable(tableEl);
		selectedCells.forEach(cell => this.select(tableEl, cell));
		this.setLastSelected(tableEl, selectedCells[selectedCells.length - 1]!);
	},
};
