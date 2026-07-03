import { SelectionManager } from './selection';
import type { CellEditor } from './cell-editor';

// ----
// Cell click / selection handlers
// ----

export function addCellSelectionHandlers(
	tableEl: HTMLTableElement,
	cellEditor: CellEditor,
): void {
	const cells = tableEl.querySelectorAll('td, th');
	cells.forEach(cell => {
		if ((cell as HTMLElement).hasClass('better-table-cell-ready')) return;
		(cell as HTMLElement).addClass('better-table-cell-ready');
		cell.addEventListener('mousedown', (e: Event) => {
			const mouseEvent = e as MouseEvent;

			if (mouseEvent.button !== 0) return;
			if ((mouseEvent.target as HTMLElement).closest('.column-resize-handle')) return;

			const cellEl = cell as HTMLElement;
			e.preventDefault();

			const lastSelected = SelectionManager.getLastSelected(tableEl);
			if (mouseEvent.shiftKey && lastSelected) {
				SelectionManager.selectRange(tableEl, lastSelected, cellEl);
			} else if (mouseEvent.ctrlKey || mouseEvent.metaKey) {
				SelectionManager.toggle(tableEl, cellEl);
			} else {
				SelectionManager.clearTable(tableEl);
				SelectionManager.select(tableEl, cellEl);
			}

			SelectionManager.setLastSelected(tableEl, cellEl);
			startCellDragSelection(tableEl, cellEl);
		});
		cell.addEventListener('dblclick', (e: Event) => {
			const mouseEvent = e as MouseEvent;
			if (mouseEvent.button !== 0) return;
			e.preventDefault();
			e.stopPropagation();
			cellEditor.editCellText(tableEl, cell as HTMLElement);
		});
	});
}

// ----
// Edge (row / column header) selection handlers
// ----

export function addEdgeSelectionHandlers(tableEl: HTMLTableElement): void {
	if (tableEl.hasClass('better-table-edge-ready')) return;
	tableEl.addClass('better-table-edge-ready');

	tableEl.addEventListener('mousedown', (e: MouseEvent) => {
		if (e.button !== 0) return;
		const target = e.target as HTMLElement;
		if (target.closest('.column-resize-handle, .table-width-resize-handle, .better-table-convert-button')) return;

		const edge = getTableEdgeHit(tableEl, e);
		if (!edge) return;

		e.preventDefault();
		e.stopPropagation();
		if (edge === 'top') {
			const colIndex = getColumnIndexAtPoint(tableEl, e.clientX);
			if (colIndex >= 0) {
				SelectionManager.selectColumnRange(tableEl, colIndex, colIndex);
				startEdgeDragSelection(tableEl, 'top', colIndex);
			}
		} else {
			const rowIndex = getRowIndexAtPoint(tableEl, e.clientY);
			if (rowIndex >= 0) {
				SelectionManager.selectRowRange(tableEl, rowIndex, rowIndex);
				startEdgeDragSelection(tableEl, 'left', rowIndex);
			}
		}
	}, true);

	tableEl.addEventListener('mousemove', (e: MouseEvent) => {
		const edge = getTableEdgeHit(tableEl, e);
		tableEl.toggleClass('better-table-edge-column-hover', edge === 'top');
		tableEl.toggleClass('better-table-edge-row-hover', edge === 'left');
	});

	tableEl.addEventListener('mouseleave', () => {
		tableEl.removeClass('better-table-edge-column-hover');
		tableEl.removeClass('better-table-edge-row-hover');
	});
}

// ----
// Drag selection
// ----

function startEdgeDragSelection(tableEl: HTMLTableElement, edge: 'top' | 'left', startIndex: number): void {
	const onMouseMove = (moveEvent: MouseEvent) => {
		if (edge === 'top') {
			const colIndex = getColumnIndexAtPoint(tableEl, moveEvent.clientX);
			if (colIndex >= 0) SelectionManager.selectColumnRange(tableEl, startIndex, colIndex);
		} else {
			const rowIndex = getRowIndexAtPoint(tableEl, moveEvent.clientY);
			if (rowIndex >= 0) SelectionManager.selectRowRange(tableEl, startIndex, rowIndex);
		}
	};

	const onMouseUp = () => {
		activeDocument.removeEventListener('mousemove', onMouseMove);
		activeDocument.removeEventListener('mouseup', onMouseUp);
	};

	activeDocument.addEventListener('mousemove', onMouseMove);
	activeDocument.addEventListener('mouseup', onMouseUp);
}

function startCellDragSelection(tableEl: HTMLTableElement, startCell: HTMLElement): void {
	let dragging = false;

	const onMouseMove = (moveEvent: MouseEvent) => {
		const targetCell = getCellAtPoint(tableEl, moveEvent.clientX, moveEvent.clientY);
		if (!targetCell || targetCell === SelectionManager.getLastSelected(tableEl)) return;
		dragging = true;
		SelectionManager.selectRange(tableEl, startCell, targetCell);
		SelectionManager.setLastSelected(tableEl, targetCell);
	};

	const onMouseUp = () => {
		if (!dragging) SelectionManager.setLastSelected(tableEl, startCell);
		activeDocument.removeEventListener('mousemove', onMouseMove);
		activeDocument.removeEventListener('mouseup', onMouseUp);
	};

	activeDocument.addEventListener('mousemove', onMouseMove);
	activeDocument.addEventListener('mouseup', onMouseUp);
}

// ----
// Point-to-index helpers
// ----

export function getRowIndexAtPoint(tableEl: HTMLTableElement, clientY: number): number {
	return Array.from(tableEl.querySelectorAll<HTMLTableRowElement>('tr'))
		.findIndex(rowEl => {
			const rect = rowEl.getBoundingClientRect();
			return clientY >= rect.top && clientY <= rect.bottom;
		});
}

export function getColumnIndexAtPoint(tableEl: HTMLTableElement, clientX: number): number {
	const gridInfo = SelectionManager.getTableGrid(tableEl);
	const { matrix, cellCoords } = gridInfo;
	const colCount = matrix[0]?.length || 0;

	for (let c = 0; c < colCount; c++) {
		for (let r = 0; r < matrix.length; r++) {
			const cell = matrix[r]?.[c];
			if (cell) {
				const coords = cellCoords.get(cell)!;
				const rect = cell.getBoundingClientRect();
				const colWidth = rect.width / (coords.colEnd - coords.colStart + 1);
				const colLeft = rect.left + colWidth * (c - coords.colStart);
				const colRight = colLeft + colWidth;
				if (clientX >= colLeft && clientX <= colRight) {
					return c;
				}
				break;
			}
		}
	}
	return -1;
}

export function getTableEdgeHit(tableEl: HTMLTableElement, e: MouseEvent): 'top' | 'left' | null {
	const rect = tableEl.getBoundingClientRect();
	const firstRowRect = tableEl.querySelector('tr')?.getBoundingClientRect();
	const tableBodyTop = firstRowRect?.top ?? rect.top;
	const edgeSize = 8;
	const onTopEdge = e.clientY >= tableBodyTop && e.clientY <= tableBodyTop + edgeSize;
	const onLeftEdge = e.clientX >= rect.left
		&& e.clientX <= rect.left + edgeSize
		&& e.clientY >= tableBodyTop
		&& e.clientY <= rect.bottom;
	if (onTopEdge) return 'top';
	if (onLeftEdge) return 'left';
	return null;
}

export function getCellAtPoint(tableEl: HTMLTableElement, clientX: number, clientY: number): HTMLElement | null {
	const element = activeDocument.elementFromPoint(clientX, clientY);
	const cell = element?.closest<HTMLElement>('td, th') ?? null;
	if (!cell || cell.closest('table') !== tableEl) return null;
	return cell;
}

// ----
// Native selection helper
// ----

export function getTableFromNativeSelection(): HTMLTableElement | null {
	const selection = activeWindow.getSelection();
	if (!selection || selection.rangeCount === 0) return null;

	for (let i = 0; i < selection.rangeCount; i++) {
		const range = selection.getRangeAt(i);
		const container = range.commonAncestorContainer;
		const element = container.nodeType === Node.ELEMENT_NODE
			? container as Element
			: container.parentElement;
		const table = element?.closest('table');
		if (table) return table;
	}

	return null;
}
