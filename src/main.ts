import {
	Plugin,
	MarkdownPostProcessorContext,
	Notice,
	Editor,
	App,
	Modal,
	MarkdownView,
	setIcon,
	MarkdownRenderer,
	Component,
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
import { serializeTableToHtml, parseHtmlToTableData, tableDataToHtml } from './html-serializer';
import {
	replaceTableSource, readTableSource, isTableFromHtmlSource,
	replaceTableInEditor, readTableSourceFromEditor, isTableHtmlInEditor,
	findTableInSource, findTableNearEditorSelection, replaceTableRangeInEditor,
} from './source-editor';
import { markdownTableToString, parseMarkdownTable } from './parser';

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
	private conversionButtons = new WeakSet<HTMLTableElement>();
	private htmlSourceEditGuards = new WeakSet<HTMLTableElement>();
	private renderedCellComponents = new WeakMap<HTMLElement, Component>();

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
			this.lastRightClickedTable = target.closest('table') ?? this.getTableFromNativeSelection();
			this.lastRightClickedCell = target.closest('td, th');
			if (this.lastRightClickedTable) {
				this.syncNativeSelectedCells(this.lastRightClickedTable);
			}
		};
		activeDocument.addEventListener('contextmenu', this.contextmenuHandler, true);
		this.registerConversionButtonObserver();

		// Inject table actions into the editor's native context menu (live preview)
		this.registerEvent(
			this.app.workspace.on('editor-menu', (menu, editor, view) => {
				if (!this.settings.enableAdvancedTables) return;
				const tableEl = this.lastRightClickedTable;
				if (!tableEl) return;
				// Reading-mode tables are handled by their own per-table listener
				if (tableEl && this.tableContexts.has(tableEl)) return;
				const sourceRange = this.findEditableTableRange(editor, tableEl);
				if (!sourceRange || sourceRange.kind !== 'html') return;

				const t = this.t;
				menu.addSeparator();
				menu.addItem((item) =>
					item.setTitle(t.mergeCells)
						.setDisabled(!tableEl || this.selectedCells.length < 2)
						.onClick(() => {
							if (tableEl) this.mergeSelectedCells(tableEl, editor);
						})
				);
				menu.addItem((item) =>
					item.setTitle(t.unmergeCells)
						.setDisabled(!tableEl)
						.onClick(() => {
							if (tableEl) this.unmergeCells(tableEl, editor);
						})
				);
				menu.addSeparator();
				menu.addItem((item) =>
					item.setTitle(t.toggleHeaderRow)
						.onClick(() => this.toggleHeaderRowInSource(editor, tableEl ?? undefined))
				);
				menu.addItem((item) =>
					item.setTitle(t.toggleHeaderColumn)
						.setDisabled(!tableEl)
						.onClick(() => {
							if (tableEl) this.toggleHeaderColumnInSource(editor, tableEl);
						})
				);
				menu.addSeparator();
				menu.addItem((item) =>
					item.setTitle(t.addCaption)
						.onClick(() => this.addCaptionInSource(editor, tableEl ?? undefined))
				);
				menu.addItem((item) =>
					item.setTitle(t.autoFitColumns)
						.setDisabled(!tableEl)
						.onClick(() => {
							if (!tableEl) return;
							if (!this.canPersistLiveTable(editor, tableEl)) return;
							TableStyler.autoFitColumns(tableEl);
							this.persistTableChanges(tableEl, editor);
						})
				);
				menu.addItem((item) =>
					item.setTitle(t.equalColumnWidth)
						.setDisabled(!tableEl)
						.onClick(() => {
							if (!tableEl) return;
							if (!this.canPersistLiveTable(editor, tableEl)) return;
							TableStyler.equalizeColumns(tableEl);
							this.persistTableChanges(tableEl, editor);
						})
				);
				menu.addSeparator();
				menu.addItem((item) =>
					item.setTitle(t.left)
						.setDisabled(!tableEl)
						.onClick(() => {
							if (tableEl) this.applyAlignment(tableEl, editor, 'horizontal', 'left');
						})
				);
				menu.addItem((item) =>
					item.setTitle(t.center)
						.setDisabled(!tableEl)
						.onClick(() => {
							if (tableEl) this.applyAlignment(tableEl, editor, 'horizontal', 'center');
						})
				);
				menu.addItem((item) =>
					item.setTitle(t.right)
						.setDisabled(!tableEl)
						.onClick(() => {
							if (tableEl) this.applyAlignment(tableEl, editor, 'horizontal', 'right');
						})
				);
				menu.addItem((item) =>
					item.setTitle(t.top)
						.setDisabled(!tableEl)
						.onClick(() => {
							if (tableEl) this.applyAlignment(tableEl, editor, 'vertical', 'top');
						})
				);
				menu.addItem((item) =>
					item.setTitle(t.middle)
						.setDisabled(!tableEl)
						.onClick(() => {
							if (tableEl) this.applyAlignment(tableEl, editor, 'vertical', 'middle');
						})
				);
				menu.addItem((item) =>
					item.setTitle(t.bottom)
						.setDisabled(!tableEl)
						.onClick(() => {
							if (tableEl) this.applyAlignment(tableEl, editor, 'vertical', 'bottom');
						})
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

	private registerConversionButtonObserver(): void {
		this.installConversionButtons(activeDocument.body);
		const observer = new MutationObserver((mutations) => {
			for (const mutation of mutations) {
				mutation.addedNodes.forEach((node) => {
					if (node.instanceOf(HTMLElement)) {
						this.installConversionButtons(node);
					}
				});
			}
		});
		observer.observe(activeDocument.body, { childList: true, subtree: true });
		this.register(() => observer.disconnect());
	}

	private installConversionButtons(root: HTMLElement): void {
		if (!this.settings.enableAdvancedTables) return;
		const tables = root.matches('table')
			? [root as HTMLTableElement]
			: Array.from(root.querySelectorAll<HTMLTableElement>('table'));

		tables.forEach((tableEl) => {
			if (this.conversionButtons.has(tableEl)) return;
			this.conversionButtons.add(tableEl);

			const container = tableEl.closest<HTMLElement>('.table-wrapper, .cm-html-embed')
				?? tableEl.parentElement;
			if (!container) return;

			if (container.hasClass('cm-html-embed')) {
				this.enhanceTableLivePreview(tableEl);
				this.suppressHtmlEmbedSourceEdit(tableEl);
			}

			container.addClass('better-table-convert-container');
			this.installFloatingConversionButton(tableEl);
		});
	}

	private installFloatingConversionButton(tableEl: HTMLTableElement): void {
		const button = activeDocument.body.createEl('button', {
			cls: 'better-table-convert-button',
			attr: {
				type: 'button',
				'aria-label': 'Convert table between Markdown and HTML',
				title: 'Convert table between Markdown and HTML',
			},
		});
		setIcon(button, 'repeat-2');

		const updatePosition = () => {
			if (!tableEl.isConnected) {
				button.remove();
				return;
			}
			const rect = tableEl.getBoundingClientRect();
			const isVisible = rect.bottom > 0
				&& rect.top < activeWindow.innerHeight
				&& rect.right > 0
				&& rect.left < activeWindow.innerWidth;
			button.toggleClass('mod-hidden', !isVisible);
			if (!isVisible) return;
			const left = Math.max(4, rect.left - 36);
			const top = Math.max(4, rect.top + 2);
			button.style.setProperty('left', `${left}px`);
			button.style.setProperty('top', `${top}px`);
		};

		updatePosition();
		const resizeObserver = new ResizeObserver(updatePosition);
		resizeObserver.observe(tableEl);

		const onScrollOrResize = () => updatePosition();
		activeWindow.addEventListener('scroll', onScrollOrResize, true);
		activeWindow.addEventListener('resize', onScrollOrResize);

		button.addEventListener('mousedown', (e) => {
			e.preventDefault();
			e.stopPropagation();
		});
		button.addEventListener('click', (e) => {
			e.preventDefault();
			e.stopPropagation();
			this.convertTableFromButton(tableEl);
		});

		this.register(() => {
			resizeObserver.disconnect();
			activeWindow.removeEventListener('scroll', onScrollOrResize, true);
			activeWindow.removeEventListener('resize', onScrollOrResize);
			button.remove();
		});
	}

	private convertTableFromButton(tableEl: HTMLTableElement): void {
		const context = this.tableContexts.get(tableEl);
		if (context) {
			if (isTableFromHtmlSource(context, tableEl)) {
				void this.convertTableToMarkdown(tableEl);
			} else {
				void this.convertTableToHtml(tableEl);
			}
			return;
		}

		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		const editor = view?.editor;
		if (!editor) {
			new Notice('Failed to find active editor');
			return;
		}
		this.toggleTableSourceFormat(editor, tableEl);
	}

	private suppressHtmlEmbedSourceEdit(tableEl: HTMLTableElement): void {
		if (this.htmlSourceEditGuards.has(tableEl)) return;
		this.htmlSourceEditGuards.add(tableEl);

		const stopLeftClick = (e: MouseEvent) => {
			if (e.button === 2) return;
			const target = e.target as HTMLElement;
			if (target.closest('.better-table-convert-button')) return;
			e.preventDefault();
			e.stopPropagation();
		};

		tableEl.addEventListener('mousedown', stopLeftClick);
		tableEl.addEventListener('click', stopLeftClick);
		tableEl.addEventListener('dblclick', stopLeftClick);
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
		this.addCaptionInteractionHandlers(tableEl);
		this.addColumnResizeHandles(tableEl);
		this.addTableWidthResizeHandle(tableEl);
		this.addCellSelectionHandlers(tableEl);
		this.addEdgeSelectionHandlers(tableEl);
	}

	private enhanceTable(tableEl: HTMLTableElement, context: MarkdownPostProcessorContext): void {
		if (this.enhancedTables.has(tableEl)) return;
		// Store context for source editing
		this.tableContexts.set(tableEl, context);
		this.enhancedTables.add(tableEl);

		// Add CSS class for styling
		tableEl.addClass('better-table');

		this.enhanceRenderedContent(tableEl);
		this.addCaptionInteractionHandlers(tableEl);

		// Add drag handles for column resizing
		this.addColumnResizeHandles(tableEl);
		this.addTableWidthResizeHandle(tableEl);

		// Add cell click handlers for selection
		this.addCellSelectionHandlers(tableEl);
		this.addEdgeSelectionHandlers(tableEl);

		// Add caption support
		if (this.settings.enableCaption) {
			this.addCaptionSupport(tableEl, context);
			this.addCaptionInteractionHandlers(tableEl);
		}

		tableEl.addEventListener('contextmenu', (e: MouseEvent) => {
			e.preventDefault();
			this.lastRightClickedTable = tableEl;
			this.lastRightClickedCell = (e.target as HTMLElement).closest('td, th');
			this.syncNativeSelectedCells(tableEl);
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
			this.persistTableChanges(tableEl);
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

	private addTableWidthResizeHandle(tableEl: HTMLTableElement): void {
		const container = tableEl.closest<HTMLElement>('.better-table-convert-container') ?? tableEl.parentElement;
		if (!container || container.querySelector(':scope > .table-width-resize-handle')) return;

		container.addClass('better-table-convert-container');
		const handle = container.createEl('div', {
			cls: 'table-width-resize-handle',
			attr: {
				'aria-hidden': 'true',
			},
		});

		const updateHandlePosition = () => {
			handle.style.setProperty('left', `${tableEl.offsetLeft + tableEl.offsetWidth - 3}px`);
			handle.style.setProperty('top', `${tableEl.offsetTop}px`);
			handle.style.setProperty('height', `${tableEl.offsetHeight}px`);
		};

		updateHandlePosition();
		const resizeObserver = new ResizeObserver(updateHandlePosition);
		resizeObserver.observe(tableEl);
		this.register(() => resizeObserver.disconnect());

		handle.addEventListener('dblclick', (e: MouseEvent) => {
			e.preventDefault();
			e.stopPropagation();
			tableEl.style.removeProperty('width');
			updateHandlePosition();
			this.persistTableChanges(tableEl);
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
				if ((mouseEvent.target as HTMLElement).closest('.column-resize-handle')) return;

				const cellEl = cell as HTMLElement;
				e.preventDefault();

				if (mouseEvent.shiftKey && this.lastSelectedCell) {
					// Range selection with Shift+click
					this.selectCellRange(tableEl, this.lastSelectedCell, cellEl);
				} else if (mouseEvent.ctrlKey || mouseEvent.metaKey) {
					// Toggle selection with Ctrl/Cmd+click
					this.toggleCellSelection(cellEl);
				} else {
					// Single selection - clear previous and select new
					this.clearCellSelection(tableEl);
					this.selectCell(cellEl);
				}

				this.lastSelectedCell = cellEl;
				this.startCellDragSelection(tableEl, cellEl);
			});
			cell.addEventListener('dblclick', (e: Event) => {
				const mouseEvent = e as MouseEvent;
				if (mouseEvent.button !== 0) return;
				e.preventDefault();
				e.stopPropagation();
				this.editCellText(tableEl, cell as HTMLElement);
			});
		});
	}

	private addEdgeSelectionHandlers(tableEl: HTMLTableElement): void {
		if (tableEl.hasClass('better-table-edge-ready')) return;
		tableEl.addClass('better-table-edge-ready');

		tableEl.addEventListener('mousedown', (e: MouseEvent) => {
			if (e.button !== 0) return;
			const target = e.target as HTMLElement;
			if (target.closest('.column-resize-handle, .table-width-resize-handle, .better-table-convert-button')) return;

			const edge = this.getTableEdgeHit(tableEl, e);
			if (!edge) return;

			e.preventDefault();
			e.stopPropagation();
			if (edge === 'top') {
				const colIndex = this.getColumnIndexAtPoint(tableEl, e.clientX);
				if (colIndex >= 0) {
					this.selectColumnRange(tableEl, colIndex, colIndex);
					this.startEdgeDragSelection(tableEl, 'top', colIndex);
				}
			} else {
				const rowIndex = this.getRowIndexAtPoint(tableEl, e.clientY);
				if (rowIndex >= 0) {
					this.selectRowRange(tableEl, rowIndex, rowIndex);
					this.startEdgeDragSelection(tableEl, 'left', rowIndex);
				}
			}
		}, true);

		tableEl.addEventListener('mousemove', (e: MouseEvent) => {
			const edge = this.getTableEdgeHit(tableEl, e);
			tableEl.toggleClass('better-table-edge-column-hover', edge === 'top');
			tableEl.toggleClass('better-table-edge-row-hover', edge === 'left');
		});

		tableEl.addEventListener('mouseleave', () => {
			tableEl.removeClass('better-table-edge-column-hover');
			tableEl.removeClass('better-table-edge-row-hover');
		});
	}

	private startEdgeDragSelection(tableEl: HTMLTableElement, edge: 'top' | 'left', startIndex: number): void {
		const onMouseMove = (moveEvent: MouseEvent) => {
			if (edge === 'top') {
				const colIndex = this.getColumnIndexAtPoint(tableEl, moveEvent.clientX);
				if (colIndex >= 0) this.selectColumnRange(tableEl, startIndex, colIndex);
			} else {
				const rowIndex = this.getRowIndexAtPoint(tableEl, moveEvent.clientY);
				if (rowIndex >= 0) this.selectRowRange(tableEl, startIndex, rowIndex);
			}
		};

		const onMouseUp = () => {
			activeDocument.removeEventListener('mousemove', onMouseMove);
			activeDocument.removeEventListener('mouseup', onMouseUp);
		};

		activeDocument.addEventListener('mousemove', onMouseMove);
		activeDocument.addEventListener('mouseup', onMouseUp);
	}

	private startCellDragSelection(tableEl: HTMLTableElement, startCell: HTMLElement): void {
		let dragging = false;

		const onMouseMove = (moveEvent: MouseEvent) => {
			const targetCell = this.getCellAtPoint(tableEl, moveEvent.clientX, moveEvent.clientY);
			if (!targetCell || targetCell === this.lastSelectedCell) return;
			dragging = true;
			this.selectCellRange(tableEl, startCell, targetCell);
			this.lastSelectedCell = targetCell;
		};

		const onMouseUp = () => {
			if (!dragging) this.lastSelectedCell = startCell;
			activeDocument.removeEventListener('mousemove', onMouseMove);
			activeDocument.removeEventListener('mouseup', onMouseUp);
		};

		activeDocument.addEventListener('mousemove', onMouseMove);
		activeDocument.addEventListener('mouseup', onMouseUp);
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

	private selectRowAtPoint(tableEl: HTMLTableElement, clientY: number): void {
		const rowIndex = this.getRowIndexAtPoint(tableEl, clientY);
		if (rowIndex < 0) return;
		this.selectRowRange(tableEl, rowIndex, rowIndex);
	}

	private selectRowRange(tableEl: HTMLTableElement, startIndex: number, endIndex: number): void {
		const rows = Array.from(tableEl.querySelectorAll<HTMLTableRowElement>('tr'));
		const minIndex = Math.min(startIndex, endIndex);
		const maxIndex = Math.max(startIndex, endIndex);

		this.clearCellSelection(tableEl);
		for (let index = minIndex; index <= maxIndex; index++) {
			rows[index]?.querySelectorAll<HTMLElement>('td, th').forEach(cell => this.selectCell(cell));
		}
		this.lastSelectedCell = this.selectedCells[this.selectedCells.length - 1] ?? null;
	}

	private selectColumnAtPoint(tableEl: HTMLTableElement, clientX: number): void {
		const colIndex = this.getColumnIndexAtPoint(tableEl, clientX);
		if (colIndex < 0) return;
		this.selectColumnRange(tableEl, colIndex, colIndex);
	}

	private selectColumnRange(tableEl: HTMLTableElement, startIndex: number, endIndex: number): void {
		const minIndex = Math.min(startIndex, endIndex);
		const maxIndex = Math.max(startIndex, endIndex);
		this.clearCellSelection(tableEl);
		tableEl.querySelectorAll('tr').forEach(row => {
			for (let index = minIndex; index <= maxIndex; index++) {
				const cell = row.querySelectorAll<HTMLElement>('td, th')[index];
				if (cell) this.selectCell(cell);
			}
		});
		this.lastSelectedCell = this.selectedCells[this.selectedCells.length - 1] ?? null;
	}

	private getRowIndexAtPoint(tableEl: HTMLTableElement, clientY: number): number {
		return Array.from(tableEl.querySelectorAll<HTMLTableRowElement>('tr'))
			.findIndex(rowEl => {
				const rect = rowEl.getBoundingClientRect();
				return clientY >= rect.top && clientY <= rect.bottom;
			});
	}

	private getColumnIndexAtPoint(tableEl: HTMLTableElement, clientX: number): number {
		const firstRow = tableEl.querySelector('tr');
		const cells = Array.from(firstRow?.querySelectorAll<HTMLElement>('td, th') ?? []);
		return cells.findIndex(cell => {
			const rect = cell.getBoundingClientRect();
			return clientX >= rect.left && clientX <= rect.right;
		});
	}

	private getTableEdgeHit(tableEl: HTMLTableElement, e: MouseEvent): 'top' | 'left' | null {
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

	private getCellAtPoint(tableEl: HTMLTableElement, clientX: number, clientY: number): HTMLElement | null {
		const element = activeDocument.elementFromPoint(clientX, clientY);
		const cell = element?.closest<HTMLElement>('td, th') ?? null;
		if (!cell || cell.closest('table') !== tableEl) return null;
		return cell;
	}

	private editCellText(tableEl: HTMLTableElement, cellEl: HTMLElement): void {
		if (cellEl.hasClass('better-table-cell-editing')) return;
		const originalText = cellEl.getAttribute('data-better-raw') ?? cellEl.textContent ?? '';
		cellEl.empty();
		cellEl.textContent = originalText;
		cellEl.addClass('better-table-cell-editing');
		cellEl.setAttribute('contenteditable', 'true');
		cellEl.focus();

		const selection = activeWindow.getSelection();
		const range = activeDocument.createRange();
		range.selectNodeContents(cellEl);
		range.collapse(false);
		selection?.removeAllRanges();
		selection?.addRange(range);

		const finish = (commit: boolean) => {
			cellEl.removeEventListener('blur', onBlur);
			cellEl.removeEventListener('keydown', onKeyDown);
			cellEl.removeClass('better-table-cell-editing');
			cellEl.removeAttribute('contenteditable');
			if (!commit) {
				cellEl.textContent = originalText;
				return;
			}
			const nextText = cellEl.textContent ?? '';
			cellEl.setAttribute('data-better-raw', nextText);
			this.persistTableChanges(tableEl);
			this.renderCellPreview(tableEl, cellEl);
		};

		const onBlur = () => finish(true);
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Enter' && !event.shiftKey) {
				event.preventDefault();
				finish(true);
			} else if (event.key === 'Escape') {
				event.preventDefault();
				finish(false);
			}
		};

		cellEl.addEventListener('blur', onBlur);
		cellEl.addEventListener('keydown', onKeyDown);
	}

	private addCaptionInteractionHandlers(tableEl: HTMLTableElement): void {
		const caption = tableEl.querySelector<HTMLElement>(':scope > caption');
		if (!caption || caption.hasClass('better-table-caption-ready')) return;
		caption.addClass('better-table-caption-ready');
		caption.addEventListener('dblclick', (e: MouseEvent) => {
			if (e.button !== 0) return;
			e.preventDefault();
			e.stopPropagation();
			this.editCaptionText(tableEl, caption);
		});
	}

	private editCaptionText(tableEl: HTMLTableElement, captionEl: HTMLElement): void {
		if (captionEl.hasClass('better-table-caption-editing')) return;
		const originalText = captionEl.textContent ?? '';
		captionEl.addClass('better-table-caption-editing');
		captionEl.setAttribute('contenteditable', 'true');
		captionEl.focus();

		const selection = activeWindow.getSelection();
		const range = activeDocument.createRange();
		range.selectNodeContents(captionEl);
		range.collapse(false);
		selection?.removeAllRanges();
		selection?.addRange(range);

		const finish = (commit: boolean) => {
			captionEl.removeEventListener('blur', onBlur);
			captionEl.removeEventListener('keydown', onKeyDown);
			captionEl.removeClass('better-table-caption-editing');
			captionEl.removeAttribute('contenteditable');
			if (!commit) {
				captionEl.textContent = originalText;
				return;
			}
			this.persistTableChanges(tableEl);
		};

		const onBlur = () => finish(true);
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Enter' && !event.shiftKey) {
				event.preventDefault();
				finish(true);
			} else if (event.key === 'Escape') {
				event.preventDefault();
				finish(false);
			}
		};

		captionEl.addEventListener('blur', onBlur);
		captionEl.addEventListener('keydown', onKeyDown);
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

	private getTableFromNativeSelection(): HTMLTableElement | null {
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

	private syncNativeSelectedCells(tableEl: HTMLTableElement): void {
		const selection = activeWindow.getSelection();
		if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return;

		const selectedCells = Array.from(tableEl.querySelectorAll<HTMLElement>('td, th'))
			.filter(cell => {
				for (let i = 0; i < selection.rangeCount; i++) {
					if (selection.getRangeAt(i).intersectsNode(cell)) return true;
				}
				return false;
			});

		if (selectedCells.length < 2) return;
		this.clearCellSelection(tableEl);
		selectedCells.forEach(cell => this.selectCell(cell));
		this.lastSelectedCell = selectedCells[selectedCells.length - 1] ?? null;
	}

	private enhanceRenderedContent(tableEl: HTMLTableElement): void {
		tableEl.querySelectorAll('td, th').forEach((cell) => {
			this.renderCellPreview(tableEl, cell as HTMLElement);
		});
	}

	private renderCellPreview(tableEl: HTMLTableElement, cellEl: HTMLElement): void {
		if (cellEl.hasClass('better-table-cell-editing')) return;
		const raw = cellEl.getAttribute('data-better-raw') ?? cellEl.textContent ?? '';
		const preservedChildren = Array.from(cellEl.children)
			.filter(child => child.hasClass('column-resize-handle'));
		this.unloadRenderedCell(cellEl);

		cellEl.removeClass('formula-result');
		cellEl.removeClass('formula-error');
		cellEl.removeClass('formula-cell');

		if (this.settings.enableFormula && raw.trim().startsWith('=')) {
			cellEl.setAttribute('data-better-raw', raw);
			const result = this.evaluateFormula(raw);
			cellEl.empty();
			cellEl.textContent = result === null ? raw : result.toString();
			cellEl.toggleClass('formula-result', result !== null);
			cellEl.toggleClass('formula-error', result === null);
			cellEl.addClass('formula-cell');
			preservedChildren.forEach(child => cellEl.appendChild(child));
			return;
		}

		if (this.settings.enableNewline && raw.includes('\\n')) {
			cellEl.setAttribute('data-better-raw', raw);
			cellEl.empty();
			raw.split('\\n').forEach((line, index) => {
				if (index > 0) cellEl.createEl('br');
				cellEl.appendText(line);
			});
			preservedChildren.forEach(child => cellEl.appendChild(child));
			return;
		}

		if (this.shouldRenderMarkdownInCell(raw)) {
			cellEl.setAttribute('data-better-raw', raw);
			cellEl.empty();
			const sourcePath = this.getTableSourcePath(tableEl);
			const component = new Component();
			this.addChild(component);
			this.renderedCellComponents.set(cellEl, component);
			void MarkdownRenderer.render(this.app, raw, cellEl, sourcePath, component)
				.finally(() => {
					preservedChildren.forEach(child => cellEl.appendChild(child));
					cellEl.addClass('better-table-markdown-cell');
				});
		}
	}

	private unloadRenderedCell(cellEl: HTMLElement): void {
		const component = this.renderedCellComponents.get(cellEl);
		if (!component) return;
		component.unload();
		this.removeChild(component);
		this.renderedCellComponents.delete(cellEl);
	}

	private shouldRenderMarkdownInCell(raw: string): boolean {
		const text = raw.trim();
		if (!text) return false;
		return /(```|`[^`]+`|\$\$?[^$]+\$\$?|\\\(|\\\[|\*\*|__|\[[^\]]+\]\(|!\[[^\]]*\]\(|^#{1,6}\s|^\s*[-*+]\s)/m.test(text);
	}

	private getTableSourcePath(tableEl: HTMLTableElement): string {
		const context = this.tableContexts.get(tableEl);
		if (context) return context.sourcePath;
		return this.app.workspace.getActiveFile()?.path ?? '';
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
	private toggleHeaderRowInSource(editor: Editor, tableEl?: HTMLTableElement): void {
		const sourceText = editor.getValue();
		const lines = sourceText.split('\n');
		const range = findTableNearEditorSelection(editor) ?? (tableEl ? findTableInSource(lines, tableEl) : null);
		if (!range) return;
		if (range.kind === 'html') {
			if (!tableEl || !this.canPersistLiveTable(editor, tableEl)) return;
			const added = this.toggleHeaderRowInDom(tableEl);
			this.persistTableChanges(tableEl, editor);
			new Notice(added ? this.t.headerRowAdded : this.t.headerRowRemoved);
			return;
		}

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
		if (!this.canPersistLiveTable(editor, tableEl)) return;
		this.toggleHeaderColumnInDom(tableEl);
		this.persistTableChanges(tableEl, editor);
		new Notice(this.t.headerColumnToggled);
	}

	private toggleHeaderRowInDom(tableEl: HTMLTableElement): boolean {
		const firstRow = tableEl.querySelector('tr');
		if (!firstRow) return false;
		const cells = Array.from(firstRow.querySelectorAll('td, th'));
		const firstRowIsHeader = cells.length > 0 && cells.every(cell => cell.tagName === 'TH');
		const headerColumnEnabled = this.hasHeaderColumn(tableEl);
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

	private toggleHeaderColumnInDom(tableEl: HTMLTableElement): void {
		const rows = Array.from(tableEl.querySelectorAll('tr'));
		const firstColumnIsHeader = this.hasHeaderColumn(tableEl);
		const firstRowIsHeader = this.hasHeaderRow(tableEl);
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

	private hasHeaderRow(tableEl: HTMLTableElement): boolean {
		const firstRowCells = Array.from(tableEl.querySelector('tr')?.querySelectorAll('td, th') ?? []);
		return firstRowCells.length > 0 && firstRowCells.every(cell => cell.tagName === 'TH');
	}

	private hasHeaderColumn(tableEl: HTMLTableElement): boolean {
		const rows = Array.from(tableEl.querySelectorAll('tr'));
		const dataRows = rows.length > 1 ? rows.slice(1) : rows;
		const firstColumnCells = dataRows
			.map(row => row.querySelector('td, th'))
			.filter(cell => cell !== null);
		return firstColumnCells.length > 0 && firstColumnCells.every(cell => cell.tagName === 'TH');
	}

	/**
	 * Add a caption before a table by inserting a line in the source.
	 */
	private addCaptionInSource(editor: Editor, tableEl?: HTMLTableElement): void {
		// Check if caption already exists
		const existingCaption = tableEl?.querySelector('caption');
		if (existingCaption) {
			new Notice(this.t.tableAlreadyHasCaption);
			return;
		}

		const modal = new CaptionModal(this.app, this.t, (caption) => {
			if (!caption) return;

			const sourceText = editor.getValue();
			const lines = sourceText.split('\n');
			const range = findTableNearEditorSelection(editor) ?? (tableEl ? findTableInSource(lines, tableEl) : null);
			if (!range) return;
			if (range.kind === 'html' && tableEl) {
				const captionEl = tableEl.createEl('caption');
				captionEl.textContent = caption;
				this.addCaptionInteractionHandlers(tableEl);
				this.persistTableChanges(tableEl, editor);
				new Notice(this.t.captionAdded);
				return;
			}

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

	private findEditableTableRange(editor: Editor, tableEl: HTMLTableElement): ReturnType<typeof findTableInSource> {
		const lines = editor.getValue().split('\n');
		return findTableNearEditorSelection(editor) ?? findTableInSource(lines, tableEl);
	}

	private canPersistLiveTable(editor: Editor | undefined, tableEl: HTMLTableElement): boolean {
		if (!editor) return true;
		const range = this.findEditableTableRange(editor, tableEl);
		if (!range) {
			new Notice('Failed to find table in source');
			return false;
		}
		return true;
	}

	// --- Merge/Unmerge (DOM + source via Editor API) ---

	private mergeSelectedCells(tableEl: HTMLTableElement, editor?: Editor): void {
		if (!this.canPersistLiveTable(editor, tableEl)) return;
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
		if (!this.canPersistLiveTable(editor, tableEl)) return;
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
		const cellsToRestore = this.createEmptyMergeCells(rowSpan, colSpan, mergedCell.tagName.toLowerCase());
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
		this.addCellSelectionHandlers(tableEl);

		new Notice(this.t.cellsUnmerged);
		this.persistTableChanges(tableEl, editor);
	}

	private createEmptyMergeCells(rowSpan: number, colSpan: number, tag: string): Array<{ row: number; col: number; tag: string; text: string }> {
		const cells: Array<{ row: number; col: number; tag: string; text: string }> = [];
		for (let row = 0; row < rowSpan; row++) {
			for (let col = 0; col < colSpan; col++) {
				if (row === 0 && col === 0) continue;
				cells.push({ row, col, tag, text: '' });
			}
		}
		return cells;
	}

	private applyAlignment(
		tableEl: HTMLTableElement,
		editor: Editor | undefined,
		direction: 'horizontal' | 'vertical',
		value: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom',
	): void {
		if (!this.canPersistLiveTable(editor, tableEl)) return;
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
			{ text: this.t.toggleHeaderRow, action: () => this.toggleHeaderRowReading(tableEl) },
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
		];
	}

	private toggleHeaderRowReading(tableEl: HTMLTableElement): void {
		const added = this.toggleHeaderRowInDom(tableEl);
		this.persistTableChanges(tableEl);
		new Notice(added ? this.t.headerRowAdded : this.t.headerRowRemoved);
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
			this.addCaptionInteractionHandlers(tableEl);
			this.persistTableChanges(tableEl);
			new Notice(this.t.captionAdded);
		});
		modal.open();
	}

	// --- Conversion (live preview, via Editor API) ---

	private toggleTableSourceFormat(editor: Editor, tableEl: HTMLTableElement): void {
		const sourceText = editor.getValue();
		const lines = sourceText.split('\n');
		const range = this.findEditableTableRange(editor, tableEl);
		if (!range) {
			new Notice('Failed to find table in source');
			return;
		}

		const source = lines.slice(range.start, range.end + 1).join('\n');
		if (range.kind === 'markdown') {
			const tableData = parseMarkdownTable(source);
			if (!tableData) {
				new Notice('Failed to parse table');
				return;
			}
			if (replaceTableRangeInEditor(editor, range, tableDataToHtml(tableData))) {
				new Notice(this.t.tableConvertedToHtml);
			}
			return;
		}

		const tableData = parseHtmlToTableData(source);
		if (!tableData) {
			new Notice('Failed to parse table');
			return;
		}
		if (replaceTableRangeInEditor(editor, range, markdownTableToString(tableData))) {
			new Notice(this.t.tableConvertedToMarkdown);
		}
	}

	private convertTableToHtmlLive(editor: Editor, tableEl?: HTMLTableElement): void {
		const sourceText = editor.getValue();
		const lines = sourceText.split('\n');
		const range = findTableNearEditorSelection(editor) ?? (tableEl ? findTableInSource(lines, tableEl) : null);
		if (!range) {
			new Notice('Failed to find table in source');
			return;
		}

		const source = lines.slice(range.start, range.end + 1).join('\n');
		const tableData = range.kind === 'markdown' ? parseMarkdownTable(source) : null;
		if (range.kind === 'markdown' && !tableData) {
			new Notice('Failed to parse table');
			return;
		}
		const html = range.kind === 'markdown'
			? tableDataToHtml(tableData!)
			: source;
		const success = replaceTableRangeInEditor(editor, range, html);

		if (success) {
			new Notice(this.t.tableConvertedToHtml);
		} else {
			new Notice('Failed to find table in source');
		}
	}

	private convertTableToMarkdownLive(editor: Editor, tableEl?: HTMLTableElement): void {
		const sourceText = editor.getValue();
		const lines = sourceText.split('\n');
		const range = findTableNearEditorSelection(editor) ?? (tableEl ? findTableInSource(lines, tableEl) : null);
		const sourceHtml = range
			? lines.slice(range.start, range.end + 1).join('\n')
			: tableEl
				? readTableSourceFromEditor(editor, tableEl)
				: null;
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
		const success = range
			? replaceTableRangeInEditor(editor, range, markdown)
			: tableEl
				? replaceTableInEditor(editor, tableEl, markdown)
				: false;

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

	private persistTableChanges(tableEl: HTMLTableElement, editor?: Editor): boolean {
		const context = this.tableContexts.get(tableEl);
		const html = serializeTableToHtml(tableEl);
		const activeEditor = editor ?? this.app.workspace.getActiveViewOfType(MarkdownView)?.editor;

		if (context) {
			// Reading mode
			if (!isTableFromHtmlSource(context, tableEl)) {
				new Notice(this.t.tableConvertedToHtml);
			}
			void replaceTableSource(this.app, context, tableEl, html);
			return true;
		} else if (activeEditor) {
			// Live preview: use Editor API
			const wasHtml = isTableHtmlInEditor(activeEditor, tableEl);
			const success = replaceTableInEditor(activeEditor, tableEl, html);
			if (!success) {
				new Notice('Failed to find table in source');
				return false;
			}
			if (!wasHtml) {
				new Notice(this.t.tableConvertedToHtml);
			}
			return true;
		}
		return false;
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
					this.addCaptionInteractionHandlers(tableEl);
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
