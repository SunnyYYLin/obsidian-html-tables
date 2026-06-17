import {
	Plugin,
	MarkdownPostProcessorContext,
	Notice,
	Editor,
	App,
	Modal,
} from 'obsidian';
import {
	BetterTablesSettings,
	DEFAULT_SETTINGS,
	BetterTablesSettingTab,
	settingsToConfig,
} from './settings';
import { TableRenderer } from './renderer';
import { TableStyler } from './styler';
import { TableMenu } from './menu';

export default class BetterTablesPlugin extends Plugin {
	settings!: BetterTablesSettings;
	private renderer!: TableRenderer;
	private selectedCells: HTMLElement[] = [];
	private lastSelectedCell: HTMLElement | null = null;

	async onload() {
		await this.loadSettings();

		// Initialize renderer with settings
		this.renderer = new TableRenderer(settingsToConfig(this.settings));

		// Register markdown post processor for tables
		this.registerMarkdownPostProcessor((element: HTMLElement, context: MarkdownPostProcessorContext) => {
			this.processTables(element, context);
		});

		// Add commands
		this.addCommand({
			id: 'toggle-header-row',
			name: 'Toggle header row',
			editorCallback: (editor: Editor) => this.toggleHeaderRow(editor),
		});

		this.addCommand({
			id: 'toggle-header-column',
			name: 'Toggle header column',
			editorCallback: (editor: Editor) => this.toggleHeaderColumn(editor),
		});

		this.addCommand({
			id: 'add-table-caption',
			name: 'Add table caption',
			editorCallback: (editor: Editor) => this.addTableCaption(editor),
		});

		// Add settings tab
		this.addSettingTab(new BetterTablesSettingTab(this.app, this));
	}

	onunload() {
		// Cleanup
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			(await this.loadData()) as Partial<BetterTablesSettings>,
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
		// Update renderer with new settings
		this.renderer = new TableRenderer(settingsToConfig(this.settings));
	}

	private processTables(element: HTMLElement, context: MarkdownPostProcessorContext): void {
		if (!this.settings.enableAdvancedTables) return;

		// Find all tables in the element
		const tables = element.querySelectorAll('table');
		tables.forEach(table => {
			this.enhanceTable(table, context);
		});
	}

	private enhanceTable(tableEl: HTMLTableElement, context: MarkdownPostProcessorContext): void {
		// Add CSS class for styling
		tableEl.addClass('better-table');

		// Add drag handles for column resizing
		this.addColumnResizeHandles(tableEl);

		// Add context menu for table operations
		this.addTableContextMenu(tableEl);

		// Add cell click handlers for selection
		this.addCellSelectionHandlers(tableEl);

		// Add caption support
		if (this.settings.enableCaption) {
			this.addCaptionSupport(tableEl, context);
		}
	}

	private addColumnResizeHandles(tableEl: HTMLTableElement): void {
		const headerCells = tableEl.querySelectorAll('th');
		headerCells.forEach((cell, index) => {
			if (index < headerCells.length - 1) {
				const handle = cell.createEl('div', {
					cls: 'column-resize-handle',
				});
				this.makeResizable(handle, cell, index, tableEl);
			}
		});
	}

	private makeResizable(handle: HTMLElement, cell: HTMLElement, colIndex: number, tableEl: HTMLTableElement): void {
		let startX: number;
		let startWidth: number;
		let isResizing = false;

		// Double-click to auto-fit column
		handle.addEventListener('dblclick', (e: MouseEvent) => {
			e.preventDefault();
			TableStyler.autoFitColumn(tableEl, colIndex);
		});

		handle.addEventListener('mousedown', (e: MouseEvent) => {
			e.preventDefault();
			isResizing = true;
			startX = e.clientX;
			startWidth = cell.offsetWidth;

			// Add resizing class to table
			tableEl.addClass('resizing');

			const onMouseMove = (e: MouseEvent) => {
				if (!isResizing) return;
				
				const width = Math.max(50, startWidth + (e.clientX - startX));
				TableStyler.setColumnWidth(tableEl, colIndex, width);
			};

			const onMouseUp = () => {
				isResizing = false;
				tableEl.removeClass('resizing');
				activeDocument.removeEventListener('mousemove', onMouseMove);
				activeDocument.removeEventListener('mouseup', onMouseUp);
			};

			activeDocument.addEventListener('mousemove', onMouseMove);
			activeDocument.addEventListener('mouseup', onMouseUp);
		});
	}

	private addCellSelectionHandlers(tableEl: HTMLTableElement): void {
		const cells = tableEl.querySelectorAll('td, th');
		cells.forEach(cell => {
			cell.addEventListener('click', (e: Event) => {
				const mouseEvent = e as MouseEvent;
				const cellEl = cell as HTMLElement;
				
				if (mouseEvent.shiftKey && this.lastSelectedCell) {
					// Range selection with Shift+click
					this.selectCellRange(tableEl, this.lastSelectedCell, cellEl);
				} else if (mouseEvent.ctrlKey || mouseEvent.metaKey) {
					// Toggle selection with Ctrl/Cmd+click
					this.toggleCellSelection(cellEl);
				} else {
					// Single selection
					this.clearCellSelection(tableEl);
					this.selectCell(cellEl);
				}
				
				this.lastSelectedCell = cellEl;
			});
		});
	}

	private selectCell(cellEl: HTMLElement): void {
		if (!cellEl.hasClass('cell-selected')) {
			cellEl.addClass('cell-selected');
			this.selectedCells.push(cellEl);
		}
	}

	private toggleCellSelection(cellEl: HTMLElement): void {
		if (cellEl.hasClass('cell-selected')) {
			cellEl.removeClass('cell-selected');
			this.selectedCells = this.selectedCells.filter(c => c !== cellEl);
		} else {
			cellEl.addClass('cell-selected');
			this.selectedCells.push(cellEl);
		}
	}

	private clearCellSelection(tableEl: HTMLTableElement): void {
		const selected = tableEl.querySelectorAll('.cell-selected');
		selected.forEach(cell => cell.removeClass('cell-selected'));
		this.selectedCells = [];
	}

	private selectCellRange(tableEl: HTMLTableElement, start: HTMLElement, end: HTMLElement): void {
		this.clearCellSelection(tableEl);
		
		const startRect = this.getCellPosition(start);
		const endRect = this.getCellPosition(end);
		
		if (!startRect || !endRect) return;
		
		const minRow = Math.min(startRect.row, endRect.row);
		const maxRow = Math.max(startRect.row, endRect.row);
		const minCol = Math.min(startRect.col, endRect.col);
		const maxCol = Math.max(startRect.col, endRect.col);
		
		const rows = tableEl.querySelectorAll('tr');
		for (let r = minRow; r <= maxRow; r++) {
			const row = rows[r];
			if (!row) continue;
			const cells = row.querySelectorAll('td, th');
			for (let c = minCol; c <= maxCol; c++) {
				const cell = cells[c] as HTMLElement;
				if (cell) {
					this.selectCell(cell);
				}
			}
		}
	}

	private getCellPosition(cellEl: HTMLElement): { row: number; col: number } | null {
		const row = cellEl.closest('tr');
		if (!row) return null;
		
		const table = row.closest('table');
		if (!table) return null;
		
		const rows = Array.from(table.querySelectorAll('tr'));
		const rowIndex = rows.indexOf(row);
		
		const cells = Array.from(row.querySelectorAll('td, th'));
		const colIndex = cells.indexOf(cellEl);
		
		return { row: rowIndex, col: colIndex };
	}

	private addTableContextMenu(tableEl: HTMLTableElement): void {
		tableEl.addEventListener('contextmenu', (e: MouseEvent) => {
			e.preventDefault();
			this.showTableMenu(tableEl, e);
		});
	}

	private showTableMenu(tableEl: HTMLTableElement, e: MouseEvent): void {
		const actions = [
			{ 
				text: 'Merge Cells', 
				action: () => this.mergeSelectedCells(tableEl),
				disabled: this.selectedCells.length < 2
			},
			{ 
				text: 'Unmerge Cells', 
				action: () => this.unmergeCells(tableEl, e),
			},
			{ text: '---', action: () => {} },
			{ text: 'Toggle Header Row', action: () => this.toggleHeaderRowFromTable(tableEl) },
			{ text: 'Toggle Header Column', action: () => this.toggleHeaderColumnFromTable(tableEl) },
			{ text: '---', action: () => {} },
			{ text: 'Add Caption', action: () => this.addTableCaptionFromTable(tableEl) },
			{ text: 'Auto-fit Columns', action: () => TableStyler.autoFitColumns(tableEl) },
			{ text: 'Equal Column Width', action: () => TableStyler.equalizeColumns(tableEl) },
		];

		TableMenu.show(tableEl, e, actions);
	}

	private mergeSelectedCells(tableEl: HTMLTableElement): void {
		if (this.selectedCells.length < 2) {
			new Notice('Select at least 2 cells to merge');
			return;
		}

		// Get positions of all selected cells
		const positions = this.selectedCells
			.map(cell => ({ cell, pos: this.getCellPosition(cell) }))
			.filter(item => item.pos !== null) as Array<{ cell: HTMLElement; pos: { row: number; col: number } }>;

		if (positions.length < 2) return;

		// Calculate merge bounds
		const minRow = Math.min(...positions.map(p => p.pos.row));
		const maxRow = Math.max(...positions.map(p => p.pos.row));
		const minCol = Math.min(...positions.map(p => p.pos.col));
		const maxCol = Math.max(...positions.map(p => p.pos.col));

		// Find the target cell (top-left)
		const targetItem = positions.find(p => p.pos.row === minRow && p.pos.col === minCol);
		if (!targetItem) return;

		const targetCell = targetItem.cell;

		// Calculate spans
		const rowSpan = maxRow - minRow + 1;
		const colSpan = maxCol - minCol + 1;

		// Apply merge
		if (rowSpan > 1) {
			targetCell.setAttribute('rowspan', rowSpan.toString());
		}
		if (colSpan > 1) {
			targetCell.setAttribute('colspan', colSpan.toString());
		}

		// Hide other cells in the merge range
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

		// Clear selection
		this.clearCellSelection(tableEl);
		
		new Notice('Cells merged');
	}

	private unmergeCells(tableEl: HTMLTableElement, e: MouseEvent): void {
		// Find the cell under cursor
		const target = e.target as HTMLElement;
		const cell = target.closest('td, th') as HTMLElement;
		
		if (!cell) {
			new Notice('Click on a merged cell to unmerge');
			return;
		}

		// Check if cell has rowspan or colspan
		const rowSpan = parseInt(cell.getAttribute('rowspan') || '1');
		const colSpan = parseInt(cell.getAttribute('colspan') || '1');

		if (rowSpan === 1 && colSpan === 1) {
			new Notice('Cell is not merged');
			return;
		}

		// Remove spans
		cell.removeAttribute('rowspan');
		cell.removeAttribute('colspan');

		// Show hidden cells in the merge range
		const pos = this.getCellPosition(cell);
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
				}
			}
		}

		new Notice('Cells unmerged');
	}

	private toggleHeaderRowFromTable(tableEl: HTMLTableElement): void {
		const firstRow = tableEl.querySelector('tr');
		if (!firstRow) return;

		const cells = firstRow.querySelectorAll('td, th');
		const isHeader = cells[0]?.tagName === 'TH';

		cells.forEach(cell => {
			const newCell = activeDocument.createElement(isHeader ? 'td' : 'th');
			newCell.textContent = cell.textContent;
			// Copy attributes
			Array.from(cell.attributes).forEach(attr => {
				newCell.setAttribute(attr.name, attr.value);
			});
			cell.replaceWith(newCell);
		});

		new Notice(isHeader ? 'Header row removed' : 'Header row added');
	}

	private toggleHeaderColumnFromTable(tableEl: HTMLTableElement): void {
		const rows = tableEl.querySelectorAll('tr');
		rows.forEach(row => {
			const firstCell = row.querySelector('td, th');
			if (!firstCell) return;

			const isHeader = firstCell.tagName === 'TH';
			const newCell = activeDocument.createElement(isHeader ? 'td' : 'th');
			newCell.textContent = firstCell.textContent;
			// Copy attributes
			Array.from(firstCell.attributes).forEach(attr => {
				newCell.setAttribute(attr.name, attr.value);
			});
			firstCell.replaceWith(newCell);
		});

		new Notice('Header column toggled');
	}

	private addTableCaptionFromTable(tableEl: HTMLTableElement): void {
		// Check if caption already exists
		const existingCaption = tableEl.querySelector('caption');
		if (existingCaption) {
			new Notice('Table already has a caption');
			return;
		}

		// Show modal for caption input
		const modal = new CaptionModal(this.app, (caption) => {
			if (!caption) return;
			const captionEl = tableEl.createEl('caption');
			captionEl.textContent = caption;
			new Notice('Caption added');
		});
		modal.open();
	}

	private addCaptionSupport(tableEl: HTMLTableElement, context: MarkdownPostProcessorContext): void {
		// Check if there's a caption element before the table
		const parent = tableEl.parentElement;
		if (parent) {
			const prevSibling = tableEl.previousElementSibling;
			if (prevSibling && prevSibling.tagName === 'P') {
				const text = prevSibling.textContent?.trim();
				if (text && text.startsWith('Table:')) {
					const caption = text.substring(6).trim();
					const captionEl = tableEl.createEl('caption');
					captionEl.textContent = caption;
					prevSibling.remove();
				}
			}
		}
	}

	private toggleHeaderRow(editor: Editor): void {
		// This would need to find the table at cursor position
		// For now, just show a notice
		new Notice('Use right-click menu on table to toggle header row');
	}

	private toggleHeaderColumn(editor: Editor): void {
		// This would need to find the table at cursor position
		// For now, just show a notice
		new Notice('Use right-click menu on table to toggle header column');
	}

	private addTableCaption(editor: Editor): void {
		// This would need to find the table at cursor position
		// For now, just show a notice
		new Notice('Use right-click menu on table to add caption');
	}
}

class CaptionModal extends Modal {
	private onSubmit: (caption: string) => void;
	private input: HTMLInputElement | null = null;

	constructor(app: App, onSubmit: (caption: string) => void) {
		super(app);
		this.onSubmit = onSubmit;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.createEl('h2', { text: 'Enter table caption' });

		this.input = contentEl.createEl('input', {
			type: 'text',
			placeholder: 'Table caption',
			cls: 'caption-input',
		});

		const buttonContainer = contentEl.createEl('div', {
			cls: 'caption-button-container',
		});

		const cancelButton = buttonContainer.createEl('button', { text: 'Cancel' });
		cancelButton.addEventListener('click', () => this.close());

		const submitButton = buttonContainer.createEl('button', { text: 'Add caption' });
		submitButton.addClass('mod-cta');
		submitButton.addEventListener('click', () => {
			if (this.input) {
				this.onSubmit(this.input.value);
			}
			this.close();
		});

		// Focus input
		this.input.focus();
		this.input.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') {
				if (this.input) {
					this.onSubmit(this.input.value);
				}
				this.close();
			}
		});
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
