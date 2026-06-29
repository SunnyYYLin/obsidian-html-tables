/**
 * Column and table-width drag-resize handles.
 * Extracted from TableEnhancer to keep resize logic separate from orchestration.
 */
import { TableStyler } from './styler';

/**
 * Adds a drag handle between each pair of adjacent header cells for column resize.
 * The handle appears as a thin vertical bar at the cell's right edge.
 */
export function addColumnResizeHandles(
	tableEl: HTMLTableElement,
	onPersist: (tableEl: HTMLTableElement) => void,
): void {
	const firstRow = tableEl.querySelector('tr');
	const headerCells = Array.from(firstRow?.querySelectorAll<HTMLElement>('th, td') ?? []);
	headerCells.forEach((cell, index) => {
		if (cell.querySelector(':scope > .column-resize-handle')) return;
		// No handle on the last column (nothing to resize rightward)
		if (index < headerCells.length - 1) {
			const handle = cell.createEl('div', { cls: 'column-resize-handle' });
			makeColumnResizable(handle, cell, index, tableEl, onPersist);
		}
	});
}

function makeColumnResizable(
	handle: HTMLElement,
	cell: HTMLElement,
	colIndex: number,
	tableEl: HTMLTableElement,
	onPersist: (tableEl: HTMLTableElement) => void,
): void {
	let startX: number;
	let startWidth: number;
	let isResizing = false;

	// Double-click: auto-fit column width
	handle.addEventListener('dblclick', (e: MouseEvent) => {
		e.preventDefault();
		TableStyler.autoFitColumn(tableEl, colIndex);
		onPersist(tableEl);
	});

	handle.addEventListener('mousedown', (e: MouseEvent) => {
		e.preventDefault();
		isResizing = true;
		startX = e.clientX;
		startWidth = cell.offsetWidth;
		tableEl.addClass('resizing');

		const onMouseMove = (moveEvent: MouseEvent) => {
			if (!isResizing) return;
			const width = Math.max(50, startWidth + (moveEvent.clientX - startX));
			TableStyler.setColumnWidth(tableEl, colIndex, width);
		};

		const onMouseUp = () => {
			isResizing = false;
			tableEl.removeClass('resizing');
			onPersist(tableEl);
			activeDocument.removeEventListener('mousemove', onMouseMove);
			activeDocument.removeEventListener('mouseup', onMouseUp);
		};

		activeDocument.addEventListener('mousemove', onMouseMove);
		activeDocument.addEventListener('mouseup', onMouseUp);
	});
}

/**
 * Adds a right-edge drag handle to control the overall table width.
 * Double-clicking the handle resets to auto width.
 *
 * @param registerCleanup - Receives a cleanup callback; use `plugin.register()` or equivalent.
 */
export function addTableWidthResizeHandle(
	tableEl: HTMLTableElement,
	registerCleanup: (cb: () => unknown) => void,
	onPersist: (tableEl: HTMLTableElement) => void,
): void {
	const container =
		tableEl.closest<HTMLElement>('.better-table-convert-container') ?? tableEl.parentElement;
	if (!container || container.querySelector(':scope > .table-width-resize-handle')) return;

	container.addClass('better-table-convert-container');
	const handle = container.createEl('div', {
		cls: 'table-width-resize-handle',
		attr: { 'aria-hidden': 'true' },
	});

	const updateHandlePosition = () => {
		handle.style.setProperty('left', `${tableEl.offsetLeft + tableEl.offsetWidth - 3}px`);
		handle.style.setProperty('top', `${tableEl.offsetTop}px`);
		handle.style.setProperty('height', `${tableEl.offsetHeight}px`);
	};

	updateHandlePosition();
	const resizeObserver = new ResizeObserver(updateHandlePosition);
	resizeObserver.observe(tableEl);
	registerCleanup(() => resizeObserver.disconnect());

	// Double-click: reset table width
	handle.addEventListener('dblclick', (e: MouseEvent) => {
		e.preventDefault();
		e.stopPropagation();
		tableEl.style.removeProperty('width');
		updateHandlePosition();
		onPersist(tableEl);
	});

	handle.addEventListener('mousedown', (e: MouseEvent) => {
		if (e.button !== 0) return;
		e.preventDefault();
		e.stopPropagation();

		const startX = e.clientX;
		const startWidth = tableEl.offsetWidth;
		tableEl.addClass('resizing');

		const onMouseMove = (moveEvent: MouseEvent) => {
			const width = Math.max(160, startWidth + (moveEvent.clientX - startX));
			tableEl.style.setProperty('width', `${width}px`);
			updateHandlePosition();
		};

		const onMouseUp = () => {
			tableEl.removeClass('resizing');
			onPersist(tableEl);
			activeDocument.removeEventListener('mousemove', onMouseMove);
			activeDocument.removeEventListener('mouseup', onMouseUp);
		};

		activeDocument.addEventListener('mousemove', onMouseMove);
		activeDocument.addEventListener('mouseup', onMouseUp);
	});
}
