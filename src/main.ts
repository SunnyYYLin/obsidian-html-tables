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
import { getLocale, Locale } from './i18n';
import { serializeTableToHtml, parseHtmlToTableData } from './html-serializer';
import {
	replaceTableSource, readTableSource, isTableFromHtmlSource,
	replaceTableInEditor, readTableSourceFromEditor, isTableHtmlInEditor,
	findTableInSource,
} from './source-editor';
import { markdownTableToString } from './parser';

export default class BetterTablesPlugin extends Plugin {
	settings!: BetterTablesSettings;
	private renderer!: TableRenderer;
	private selectedCells: HTMLElement[] = [];
	private lastSelectedCell: HTMLElement | null = null;
	private t!: Locale;
	private tableContexts = new WeakMap<HTMLTableElement, MarkdownPostProcessorContext>();
	private enhancedTables = new WeakSet<HTMLTableElement>();
	private lastRightClickedTable: HTMLTableElement | null = null;
	private lastRightClickedCell: HTMLElement | null = null;
	private contextmenuHandler?: (e: MouseEvent) => void;

	async onload() {
		await this.loadSettings();

		// Initialize i18n
		this.t = getLocale();

		// Initialize renderer with settings
		this.renderer = new TableRenderer(settingsToConfig(this.settings));

		// Register markdown post processor for tables (reading mode)
		this.registerMarkdownPostProcessor((element: HTMLElement, context: MarkdownPostProcessorContext) => {
			this.processTables(element, context);
		});

		// Capture-phase listener to record the right-clicked table element.
		// Must use addEventListener directly (not registerDomEvent) for capture phase.
		this.contextmenuHandler = (e: MouseEvent) => {
			const target = e.target as HTMLElement;
			this.lastRightClickedTable = target.closest('table');
			this.lastRightClickedCell = target.closest('td, th');
		};
		activeDocument.addEventListener('contextmenu', this.contextmenuHandler, true);

		// Inject table actions into the editor's native context menu (live preview)
		this.registerEvent(
			this.app.workspace.on('editor-menu', (menu, editor, view) => {
				if (!this.settings.enableAdvancedTables) return;
				const tableEl = this.lastRightClickedTable;
				if (!tableEl) return;
				// Reading-mode tables are handled by their own per-table listener
				if (this.tableContexts.has(tableEl)) return;

				// Enhance table on first right-click
				if (!this.enhancedTables.has(tableEl)) {
					this.enhanceTableLivePreview(tableEl);
				}

				const t = this.t;
				menu.addSeparator();
				menu.addItem((item) =>
					item.setTitle(t.mergeCells)
						.setDisabled(this.selectedCells.length < 2)
						.onClick(() => this.mergeSelectedCells(tableEl, editor))
				);
				menu.addItem((item) =>
					item.setTitle(t.unmergeCells)
						.onClick(() => this.unmergeCells(tableEl, editor))
				);
				menu.addSeparator();
				menu.addItem((item) =>
					item.setTitle(t.toggleHeaderRow)
						.onClick(() => this.toggleHeaderRowInSource(editor, tableEl))
				);
				menu.addItem((item) =>
					item.setTitle(t.toggleHeaderColumn)
						.onClick(() => this.toggleHeaderColumnInSource(editor, tableEl))
				);
				menu.addSeparator();
				menu.addItem((item) =>
					item.setTitle(t.addCaption)
						.onClick(() => this.addCaptionInSource(editor, tableEl))
				);
				menu.addItem((item) =>
					item.setTitle(t.autoFitColumns)
						.onClick(() => {
							TableStyler.autoFitColumns(tableEl);
							this.persistTableChanges(tableEl, editor);
						})
				);
				menu.addItem((item) =>
					item.setTitle(t.equalColumnWidth)
						.onClick(() => {
							TableStyler.equalizeColumns(tableEl);
							this.persistTableChanges(tableEl, editor);
						})
				);
				menu.addSeparator();
				menu.addItem((item) =>
					item.setTitle(t.left)
						.onClick(() => this.applyAlignment(tableEl, editor, 'horizontal', 'left'))
				);
				menu.addItem((item) =>
					item.setTitle(t.center)
						.onClick(() => this.applyAlignment(tableEl, editor, 'horizontal', 'center'))
				);
				menu.addItem((item) =>
					item.setTitle(t.right)
						.onClick(() => this.applyAlignment(tableEl, editor, 'horizontal', 'right'))
				);
				menu.addItem((item) =>
					item.setTitle(t.top)
						.onClick(() => this.applyAlignment(tableEl, editor, 'vertical', 'top'))
				);
				menu.addItem((item) =>
					item.setTitle(t.middle)
						.onClick(() => this.applyAlignment(tableEl, editor, 'vertical', 'middle'))
				);
				menu.addItem((item) =>
					item.setTitle(t.bottom)
						.onClick(() => this.applyAlignment(tableEl, editor, 'vertical', 'bottom'))
				);
				menu.addSeparator();
				menu.addItem((item) =>
					item.setTitle(t.convertToHtml)
						.onClick(() => this.convertTableToHtmlLive(tableEl, editor))
				);
				menu.addItem((item) =>
					item.setTitle(t.convertToMarkdown)
						.onClick(() => this.convertTableToMarkdownLive(tableEl, editor))
				);
			})
		);

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
		if (this.contextmenuHandler) {
			activeDocument.removeEventListener('contextmenu', this.contextmenuHandler, true);
		}
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

	/**
	 * Enhance a table in live preview mode (no MarkdownPostProcessorContext).
	 * Adds resize handles, cell selection, and context menu.
	 */
	private enhanceTableLivePreview(tableEl: HTMLTableElement): void {
		if (this.enhancedTables.has(tableEl)) return;
		this.enhancedTables.add(tableEl);
		tableEl.addClass('better-table');
		this.enhanceRenderedContent(tableEl);
		this.addColumnResizeHandles(tableEl);
		this.addCellSelectionHandlers(tableEl);
	}

	private enhanceTable(tableEl: HTMLTableElement, context: MarkdownPostProcessorContext): void {
		if (this.enhancedTables.has(tableEl)) return;
		// Store context for source editing
		this.tableContexts.set(tableEl, context);
		this.enhancedTables.add(tableEl);

		// Add CSS class for styling
		tableEl.addClass('better-table');

		this.enhanceRenderedContent(tableEl);

		// Add drag handles for column resizing
		this.addColumnResizeHandles(tableEl);

		// Add cell click handlers for selection
		this.addCellSelectionHandlers(tableEl);

		// Add caption support
		if (this.settings.enableCaption) {
			this.addCaptionSupport(tableEl, context);
		}

		tableEl.addEventListener('contextmenu', (e: MouseEvent) => {
			e.preventDefault();
			this.lastRightClickedTable = tableEl;
			this.lastRightClickedCell = (e.target as HTMLElement).closest('td, th');
			TableMenu.show(tableEl, e, this.getReadingModeActions(tableEl));
		});
	}

	private addColumnResizeHandles(tableEl: HTMLTableElement): void {
		const firstRow = tableEl.querySelector('tr');
		const headerCells = Array.from(firstRow?.querySelectorAll<HTMLElement>('th, td') ?? []);
		headerCells.forEach((cell, index) => {
			if (cell.querySelector(':scope > .column-resize-handle')) return;
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
				this.persistTableChanges(tableEl);
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
			if ((cell as HTMLElement).hasClass('better-table-cell-ready')) return;
			(cell as HTMLElement).addClass('better-table-cell-ready');
			cell.addEventListener('mousedown', (e: Event) => {
				const mouseEvent = e as MouseEvent;

				// Only handle left click for selection
				if (mouseEvent.button !== 0) return;

				const cellEl = cell as HTMLElement;

				if (mouseEvent.shiftKey && this.lastSelectedCell) {
					// Range selection with Shift+click
					e.preventDefault();
					this.selectCellRange(tableEl, this.lastSelectedCell, cellEl);
				} else if (mouseEvent.ctrlKey || mouseEvent.metaKey) {
					// Toggle selection with Ctrl/Cmd+click
					e.preventDefault();
					this.toggleCellSelection(cellEl);
				} else {
					// Single selection - clear previous and select new
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

	private enhanceRenderedContent(tableEl: HTMLTableElement): void {
		tableEl.querySelectorAll('td, th').forEach((cell) => {
			const cellEl = cell as HTMLElement;
			const raw = cellEl.getAttribute('data-better-raw') ?? cellEl.textContent ?? '';
			if (this.settings.enableFormula && raw.trim().startsWith('=')) {
				cellEl.setAttribute('data-better-raw', raw);
				const result = this.evaluateFormula(raw);
				cellEl.empty();
				cellEl.textContent = result === null ? raw : result.toString();
				cellEl.toggleClass('formula-result', result !== null);
				cellEl.toggleClass('formula-error', result === null);
				cellEl.addClass('formula-cell');
			} else if (this.settings.enableNewline && raw.includes('\\n')) {
				cellEl.setAttribute('data-better-raw', raw);
				cellEl.empty();
				raw.split('\\n').forEach((line, index) => {
					if (index > 0) cellEl.createEl('br');
					cellEl.appendText(line);
				});
			}
		});
	}

	private evaluateFormula(formula: string): number | null {
		const expr = formula.substring(1).trim();
		if (!/^[\d+\-*/().\s]+$/.test(expr)) return null;
		try {
			return this.parseExpression(expr);
		} catch {
			return null;
		}
	}

	private parseExpression(expr: string): number {
		const tokens = expr.replace(/\s+/g, '').match(/\d+(?:\.\d+)?|[()+\-*/]/g) ?? [];
		let index = 0;
		const parseFactor = (): number => {
			const token = tokens[index++];
			if (token === '(') {
				const value = parseSum();
				if (tokens[index++] !== ')') throw new Error('Unbalanced formula');
				return value;
			}
			if (token === '-') return -parseFactor();
			const value = Number(token);
			if (!Number.isFinite(value)) throw new Error('Invalid formula');
			return value;
		};
		const parseProduct = (): number => {
			let value = parseFactor();
			while (tokens[index] === '*' || tokens[index] === '/') {
				const operator = tokens[index++];
				const next = parseFactor();
				value = operator === '*' ? value * next : value / next;
			}
			return value;
		};
		const parseSum = (): number => {
			let value = parseProduct();
			while (tokens[index] === '+' || tokens[index] === '-') {
				const operator = tokens[index++];
				const next = parseProduct();
				value = operator === '+' ? value + next : value - next;
			}
			return value;
		};
		const result = parseSum();
		if (index !== tokens.length || !Number.isFinite(result)) throw new Error('Invalid formula');
		return result;
	}

	// --- Source-level operations (modify the markdown source via Editor API) ---

	/**
	 * Toggle the header row of a table by modifying the source.
	 * In markdown, the header row is defined by the separator line (| --- | --- |).
	 * If separator exists, remove it (header → data). If not, add it (data → header).
	 */
	private toggleHeaderRowInSource(editor: Editor, tableEl: HTMLTableElement): void {
		const sourceText = editor.getValue();
		const lines = sourceText.split('\n');
		const range = findTableInSource(lines, tableEl);
		if (!range) return;

		const secondLine = lines[range.start + 1]?.trim() ?? '';
		const isSeparator = this.isMarkdownSeparator(secondLine);

		if (isSeparator) {
			// Remove separator line (header → data)
			editor.replaceRange(
				'',
				{ line: range.start + 1, ch: 0 },
				{ line: range.start + 2, ch: 0 }
			);
			new Notice(this.t.headerRowRemoved);
		} else {
			// Add separator line (data → header)
			const numCols = this.countTableColumns(lines, range.start);
			const separator = '| ' + Array(numCols).fill('---').join(' | ') + ' |';
			editor.replaceRange(
				separator + '\n',
				{ line: range.start + 1, ch: 0 },
				{ line: range.start + 1, ch: 0 }
			);
			new Notice(this.t.headerRowAdded);
		}
	}

	/**
	 * Toggle the header column of a table by modifying the source.
	 * In markdown, there's no native header column. We use a visual marker in the source.
	 * Actually, Obsidian doesn't have native header column support in markdown tables.
	 * For now, this modifies the DOM only (visual change) and notifies the user.
	 */
	private toggleHeaderColumnInSource(editor: Editor, tableEl: HTMLTableElement): void {
		this.toggleHeaderColumnInDom(tableEl);
		if (isTableHtmlInEditor(editor, tableEl)) {
			replaceTableInEditor(editor, tableEl, serializeTableToHtml(tableEl));
		} else {
			replaceTableInEditor(editor, tableEl, serializeTableToHtml(tableEl));
			new Notice(this.t.tableConvertedToHtml);
		}
		new Notice(this.t.headerColumnToggled);
	}

	private toggleHeaderColumnInDom(tableEl: HTMLTableElement): void {
		const rows = tableEl.querySelectorAll('tr');
		const firstColumnIsHeader = Array.from(rows).some(row => row.querySelector('td, th')?.tagName === 'TH');
		rows.forEach(row => {
			const firstCell = row.querySelector('td, th');
			if (!firstCell) return;

			const newCell = activeDocument.createElement(firstColumnIsHeader ? 'td' : 'th');
			firstCell.childNodes.forEach(node => newCell.appendChild(node.cloneNode(true)));
			Array.from(firstCell.attributes).forEach(attr => {
				newCell.setAttribute(attr.name, attr.value);
			});
			firstCell.replaceWith(newCell);
		});
	}

	/**
	 * Add a caption before a table by inserting a line in the source.
	 */
	private addCaptionInSource(editor: Editor, tableEl: HTMLTableElement): void {
		// Check if caption already exists
		const existingCaption = tableEl.querySelector('caption');
		if (existingCaption) {
			new Notice(this.t.tableAlreadyHasCaption);
			return;
		}

		const modal = new CaptionModal(this.app, this.t, (caption) => {
			if (!caption) return;

			const sourceText = editor.getValue();
			const lines = sourceText.split('\n');
			const range = findTableInSource(lines, tableEl);
			if (!range) return;

			// Insert caption line before the table
			editor.replaceRange(
				'Table: ' + caption + '\n',
				{ line: range.start, ch: 0 },
				{ line: range.start, ch: 0 }
			);

			new Notice(this.t.captionAdded);
		});
		modal.open();
	}

	/**
	 * Check if a line is a markdown table separator (| --- | --- |).
	 */
	private isMarkdownSeparator(line: string): boolean {
		if (!line.startsWith('|')) return false;
		const cells = line.split('|').filter(c => c.trim() !== '');
		return cells.length > 0 && cells.every(c => /^:?-+:?$/.test(c.trim()));
	}

	/**
	 * Count the number of columns in a markdown table.
	 */
	private countTableColumns(lines: string[], tableStart: number): number {
		const line = lines[tableStart]?.trim() ?? '';
		return line.split('|').filter(c => c.trim() !== '').length;
	}

	// --- Merge/Unmerge (DOM + source via Editor API) ---

	private mergeSelectedCells(tableEl: HTMLTableElement, editor?: Editor): void {
		if (this.selectedCells.length < 2) {
			new Notice(this.t.selectAtLeast2Cells);
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

		new Notice(this.t.cellsMerged);
		this.persistTableChanges(tableEl, editor);
	}

	private unmergeCells(tableEl: HTMLTableElement, editor?: Editor): void {
		// Find a merged cell in the table
		const mergedCell = tableEl.querySelector<HTMLElement>(
			'td[rowspan], td[colspan], th[rowspan], th[colspan]'
		);

		if (!mergedCell) {
			new Notice(this.t.cellNotMerged);
			return;
		}

		const rowSpan = parseInt(mergedCell.getAttribute('rowspan') || '1');
		const colSpan = parseInt(mergedCell.getAttribute('colspan') || '1');

		// Remove spans
		mergedCell.removeAttribute('rowspan');
		mergedCell.removeAttribute('colspan');

		// Show hidden cells in the merge range
		const pos = this.getCellPosition(mergedCell);
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

		new Notice(this.t.cellsUnmerged);
		this.persistTableChanges(tableEl, editor);
	}

	private applyAlignment(
		tableEl: HTMLTableElement,
		editor: Editor | undefined,
		direction: 'horizontal' | 'vertical',
		value: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom',
	): void {
		const cells = this.selectedCells.length > 0
			? this.selectedCells
			: this.lastRightClickedCell
				? [this.lastRightClickedCell]
				: [];
		if (cells.length === 0) return;

		cells.forEach(cell => {
			if (direction === 'horizontal') {
				cell.style.textAlign = value;
			} else {
				cell.style.verticalAlign = value;
			}
		});

		this.persistTableChanges(tableEl, editor);
	}

	private getReadingModeActions(tableEl: HTMLTableElement): Array<{ text: string; action: () => void; disabled?: boolean }> {
		return [
			{ text: this.t.mergeCells, action: () => this.mergeSelectedCells(tableEl), disabled: this.selectedCells.length < 2 },
			{ text: this.t.unmergeCells, action: () => this.unmergeCells(tableEl) },
			{ text: '---', action: () => undefined },
			{ text: this.t.toggleHeaderColumn, action: () => this.toggleHeaderColumnReading(tableEl) },
			{ text: this.t.addCaption, action: () => this.addCaptionReading(tableEl) },
			{ text: '---', action: () => undefined },
			{ text: this.t.autoFitColumns, action: () => {
				TableStyler.autoFitColumns(tableEl);
				this.persistTableChanges(tableEl);
			} },
			{ text: this.t.equalColumnWidth, action: () => {
				TableStyler.equalizeColumns(tableEl);
				this.persistTableChanges(tableEl);
			} },
			{ text: '---', action: () => undefined },
			{ text: this.t.left, action: () => this.applyAlignment(tableEl, undefined, 'horizontal', 'left') },
			{ text: this.t.center, action: () => this.applyAlignment(tableEl, undefined, 'horizontal', 'center') },
			{ text: this.t.right, action: () => this.applyAlignment(tableEl, undefined, 'horizontal', 'right') },
			{ text: this.t.top, action: () => this.applyAlignment(tableEl, undefined, 'vertical', 'top') },
			{ text: this.t.middle, action: () => this.applyAlignment(tableEl, undefined, 'vertical', 'middle') },
			{ text: this.t.bottom, action: () => this.applyAlignment(tableEl, undefined, 'vertical', 'bottom') },
			{ text: '---', action: () => undefined },
			{ text: this.t.convertToHtml, action: () => void this.convertTableToHtml(tableEl) },
			{ text: this.t.convertToMarkdown, action: () => void this.convertTableToMarkdown(tableEl) },
		];
	}

	private toggleHeaderColumnReading(tableEl: HTMLTableElement): void {
		this.toggleHeaderColumnInDom(tableEl);
		this.persistTableChanges(tableEl);
		new Notice(this.t.headerColumnToggled);
	}

	private addCaptionReading(tableEl: HTMLTableElement): void {
		if (tableEl.querySelector('caption')) {
			new Notice(this.t.tableAlreadyHasCaption);
			return;
		}
		const modal = new CaptionModal(this.app, this.t, (caption) => {
			if (!caption) return;
			const captionEl = tableEl.createEl('caption');
			captionEl.textContent = caption;
			this.persistTableChanges(tableEl);
			new Notice(this.t.captionAdded);
		});
		modal.open();
	}

	// --- Conversion (live preview, via Editor API) ---

	private convertTableToHtmlLive(tableEl: HTMLTableElement, editor: Editor): void {
		const html = serializeTableToHtml(tableEl);
		const success = replaceTableInEditor(editor, tableEl, html);

		if (success) {
			new Notice(this.t.tableConvertedToHtml);
		} else {
			new Notice('Failed to find table in source');
		}
	}

	private convertTableToMarkdownLive(tableEl: HTMLTableElement, editor: Editor): void {
		const sourceHtml = readTableSourceFromEditor(editor, tableEl);
		if (!sourceHtml) {
			new Notice('Failed to find table in source');
			return;
		}

		const tableData = parseHtmlToTableData(sourceHtml);
		if (!tableData) {
			new Notice('Failed to parse table');
			return;
		}

		const markdown = markdownTableToString(tableData);
		const success = replaceTableInEditor(editor, tableEl, markdown);

		if (success) {
			new Notice(this.t.tableConvertedToMarkdown);
		} else {
			new Notice('Failed to replace table in source');
		}
	}

	// --- Reading mode (with context) ---

	private async convertTableToHtml(tableEl: HTMLTableElement): Promise<void> {
		const context = this.tableContexts.get(tableEl);
		if (!context) return;

		const html = serializeTableToHtml(tableEl);
		const success = await replaceTableSource(this.app, context, tableEl, html);

		if (success) {
			new Notice(this.t.tableConvertedToHtml);
		}
	}

	private async convertTableToMarkdown(tableEl: HTMLTableElement): Promise<void> {
		const context = this.tableContexts.get(tableEl);
		if (!context) return;

		const sourceHtml = readTableSource(this.app, context, tableEl);
		if (!sourceHtml) return;

		const tableData = parseHtmlToTableData(sourceHtml);
		if (!tableData) return;

		const markdown = markdownTableToString(tableData);
		const success = await replaceTableSource(this.app, context, tableEl, markdown);

		if (success) {
			new Notice(this.t.tableConvertedToMarkdown);
		}
	}

	// --- Persistence ---

	private persistTableChanges(tableEl: HTMLTableElement, editor?: Editor): void {
		const context = this.tableContexts.get(tableEl);
		const html = serializeTableToHtml(tableEl);

		if (context) {
			// Reading mode
			if (!isTableFromHtmlSource(context, tableEl)) {
				new Notice(this.t.tableConvertedToHtml);
			}
			void replaceTableSource(this.app, context, tableEl, html);
		} else if (editor) {
			// Live preview: use Editor API
			if (!isTableHtmlInEditor(editor, tableEl)) {
				new Notice(this.t.tableConvertedToHtml);
			}
			replaceTableInEditor(editor, tableEl, html);
		}
	}

	private isTableHtml(tableEl: HTMLTableElement): boolean {
		const context = this.tableContexts.get(tableEl);
		if (!context) return false;
		return isTableFromHtmlSource(context, tableEl);
	}

	private toggleHeaderRow(editor: Editor): void {
		new Notice(this.t.useRightClickMenu);
	}

	private toggleHeaderColumn(editor: Editor): void {
		new Notice(this.t.useRightClickMenu);
	}

	private addTableCaption(editor: Editor): void {
		new Notice(this.t.useRightClickMenu);
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
}

class CaptionModal extends Modal {
	private onSubmit: (caption: string) => void;
	private input: HTMLInputElement | null = null;
	private t: Locale;

	constructor(app: App, t: Locale, onSubmit: (caption: string) => void) {
		super(app);
		this.t = t;
		this.onSubmit = onSubmit;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.createEl('h2', { text: this.t.enterTableCaption });

		this.input = contentEl.createEl('input', {
			type: 'text',
			placeholder: this.t.tableCaption,
			cls: 'caption-input',
		});

		const buttonContainer = contentEl.createEl('div', {
			cls: 'caption-button-container',
		});

		const cancelButton = buttonContainer.createEl('button', { text: this.t.cancel });
		cancelButton.addEventListener('click', () => this.close());

		const submitButton = buttonContainer.createEl('button', { text: this.t.addCaptionButton });
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
