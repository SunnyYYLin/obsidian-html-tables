import {
	App,
	Editor,
	MarkdownPostProcessorContext,
	MarkdownView,
	Menu,
	MenuItem,
	Modal,
	Notice,
	Component,
	setIcon,
} from 'obsidian';
import type { BetterTablesSettings } from './settings';
import type { Locale } from './i18n';
import { TableMenu, type TableMenuAction } from './menu';
import { TableStyler } from './styler';
import { SelectionManager, getCellPosition } from './selection';
import {
	replaceTableSource,
	readTableSource,
	isTableFromHtmlSource,
	replaceTableInEditor,
	isTableHtmlInEditor,
	findTableInSource,
	findTableNearEditorSelection,
	replaceTableRangeInEditor,
} from './source-editor';
import { serializeTableToHtml, parseHtmlToTableData, tableDataToHtml } from './html-serializer';
import { markdownTableToString, parseMarkdownTable, isMarkdownSeparator } from './parser';
import { addColumnResizeHandles, addTableWidthResizeHandle } from './resize';
import { CellEditor } from './cell-editor';

type MenuItemWithSubmenu = MenuItem & {
	setSubmenu?: () => Menu;
};

/**
 * Minimal interface describing what TableEnhancer needs from the Plugin instance.
 * Using an interface avoids a circular module dependency between main.ts and table-enhancer.ts.
 */
interface PluginHost {
	readonly app: App;
	readonly settings: BetterTablesSettings;
	readonly t: Locale;
	register(cb: () => unknown): void;
	addChild<T extends Component>(component: T): T;
	removeChild<T extends Component>(component: T): T;
}

/**
 * TableEnhancer manages all table enhancement logic:
 * DOM augmentation, cell selection, resize handles, context menus, and source persistence.
 *
 * It is instantiated once per plugin load and receives a PluginHost reference
 * so it can call plugin lifecycle helpers (register, addChild, etc.) without
 * extending Plugin itself.
 */
export class TableEnhancer {
	private tableContexts = new WeakMap<HTMLTableElement, MarkdownPostProcessorContext>();
	private enhancedTables = new WeakSet<HTMLTableElement>();
	private lastRightClickedTable: HTMLTableElement | null = null;
	private lastRightClickedCell: HTMLElement | null = null;
	private contextmenuHandler?: (e: MouseEvent) => void;
	private conversionButtons = new WeakSet<HTMLTableElement>();
	private htmlSourceEditGuards = new WeakSet<HTMLTableElement>();
	private tableMenuDismissGuards = new WeakSet<HTMLTableElement>();
	private cellEditor: CellEditor;

	constructor(private host: PluginHost) {
		this.cellEditor = new CellEditor({
			app: host.app,
			getSettings: () => host.settings,
			addChild: host.addChild.bind(host),
			removeChild: host.removeChild.bind(host),
			getSourcePath: (tableEl) => this.getTableSourcePath(tableEl),
			onPersist: (tableEl) => this.persistTableChanges(tableEl),
		});
	}

	// ---- Lifecycle ----

	initialize(): void {
		// Capture-phase contextmenu listener to record the right-clicked table.
		// Must use addEventListener directly (not registerDomEvent) for capture phase.
		this.contextmenuHandler = (e: MouseEvent) => {
			const target = e.target as HTMLElement;
			this.lastRightClickedTable = target.closest('table') ?? this.getTableFromNativeSelection();
			this.lastRightClickedCell = target.closest('td, th');
			if (this.lastRightClickedTable) {
				SelectionManager.syncFromNativeSelection(this.lastRightClickedTable);
			}
		};
		activeDocument.addEventListener('contextmenu', this.contextmenuHandler, true);
		this.registerConversionButtonObserver();
	}

	cleanup(): void {
		if (this.contextmenuHandler) {
			activeDocument.removeEventListener('contextmenu', this.contextmenuHandler, true);
		}
	}

	// ---- Post-processor entry point ----

	processTables(element: HTMLElement, context: MarkdownPostProcessorContext): void {
		if (!this.host.settings.enableAdvancedTables) return;
		element.querySelectorAll('table').forEach(table => {
			this.enhanceTable(table, context);
		});
	}

	private getSelectedColumnIndices(tableEl: HTMLTableElement): number[] {
		const selected = SelectionManager.getSelected(tableEl);
		const cols = new Set<number>();
		if (selected.length > 0) {
			selected.forEach(cell => {
				const pos = getCellPosition(cell);
				if (pos) cols.add(pos.col);
			});
		} else if (this.lastRightClickedCell) {
			const pos = getCellPosition(this.lastRightClickedCell);
			if (pos) cols.add(pos.col);
		}
		return Array.from(cols).sort((a, b) => a - b);
	}

	buildEditorMenu(menu: Menu, editor: Editor): void {
		const tableEl = this.lastRightClickedTable;
		if (!tableEl) return;
		// Reading-mode tables are handled by their own per-table listener
		if (tableEl && this.tableContexts.has(tableEl)) return;
		const sourceRange = this.findEditableTableRange(editor, tableEl);
		if (!sourceRange || sourceRange.kind !== 'html') return;

		const t = this.host.t;
		const selected = SelectionManager.getSelected(tableEl);
		const canMerge = selected.length >= 2;
		const canUnmerge = this.getActionMergedCell(tableEl) !== null;
		const canAlign = selected.length > 0 || this.lastRightClickedCell !== null;

		menu.addSeparator();
		if (canMerge) {
			menu.addItem((item) =>
				item.setTitle(t.mergeCells)
					.onClick(() => this.mergeSelectedCells(tableEl, editor))
			);
		}
		if (canUnmerge) {
			menu.addItem((item) =>
				item.setTitle(t.unmergeCells)
					.onClick(() => this.unmergeCells(tableEl, editor))
			);
		}

		this.addSubmenu(menu, t.columnWidth, (submenu) => {
			const selectedCols = this.getSelectedColumnIndices(tableEl);
			submenu.addItem((item) =>
				item.setTitle(t.autoFitSelectedColumns)
					.onClick(() => {
						if (!this.canPersistLiveTable(editor, tableEl)) return;
						TableStyler.autoFitSelectedColumns(tableEl, selectedCols);
						this.persistTableChanges(tableEl, editor);
					})
			);
			submenu.addItem((item) =>
				item.setTitle(t.equalSelectedColumnWidth)
					.onClick(() => {
						if (!this.canPersistLiveTable(editor, tableEl)) return;
						TableStyler.equalizeSelectedColumns(tableEl, selectedCols);
						this.persistTableChanges(tableEl, editor);
					})
			);
		});
		if (canAlign) {
			this.addSubmenu(menu, t.alignment, (submenu) => {
				submenu.addItem((item) =>
					item.setTitle(t.left)
						.onClick(() => this.applyAlignment(tableEl, editor, 'horizontal', 'left'))
				);
				submenu.addItem((item) =>
					item.setTitle(t.center)
						.onClick(() => this.applyAlignment(tableEl, editor, 'horizontal', 'center'))
				);
				submenu.addItem((item) =>
					item.setTitle(t.right)
						.onClick(() => this.applyAlignment(tableEl, editor, 'horizontal', 'right'))
				);
				submenu.addSeparator();
				submenu.addItem((item) =>
					item.setTitle(t.top)
						.onClick(() => this.applyAlignment(tableEl, editor, 'vertical', 'top'))
				);
				submenu.addItem((item) =>
					item.setTitle(t.middle)
						.onClick(() => this.applyAlignment(tableEl, editor, 'vertical', 'middle'))
				);
				submenu.addItem((item) =>
					item.setTitle(t.bottom)
						.onClick(() => this.applyAlignment(tableEl, editor, 'vertical', 'bottom'))
				);
			});
		}
	}

	// ---- Command stubs (direct user commands just point to right-click menu) ----

	cmdToggleHeaderRow(_editor: Editor): void {
		new Notice(this.host.t.useRightClickMenu);
	}

	cmdToggleHeaderColumn(_editor: Editor): void {
		new Notice(this.host.t.useRightClickMenu);
	}

	cmdAddTableCaption(_editor: Editor): void {
		new Notice(this.host.t.useRightClickMenu);
	}

	// ---- Conversion button setup ----

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
		this.host.register(() => observer.disconnect());
	}

	private installConversionButtons(root: HTMLElement): void {
		if (!this.host.settings.enableAdvancedTables) return;
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
			this.installTableMenuDismissHandler(tableEl);
			this.installFloatingConversionButton(tableEl);
		});
	}

	private installFloatingConversionButton(tableEl: HTMLTableElement): void {
		const button = activeDocument.body.createEl('button', {
			cls: 'better-table-convert-button mod-hidden',
			attr: {
				type: 'button',
				'aria-label': this.host.t.tableOptions,
				title: this.host.t.tableOptions,
			},
		});
		setIcon(button, 'table');

		let isHovering = false;
		let hideTimer: number | null = null;
		const setButtonActive = (active: boolean) => {
			if (hideTimer !== null) {
				window.clearTimeout(hideTimer);
				hideTimer = null;
			}
			isHovering = active;
			button.toggleClass('mod-active', active);
			updatePosition();
		};

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
			button.toggleClass('mod-hidden', !isVisible || !isHovering);
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

		const showButton = () => setButtonActive(true);
		const hideButton = () => {
			if (hideTimer !== null) window.clearTimeout(hideTimer);
			hideTimer = window.setTimeout(() => setButtonActive(false), 120);
		};
		tableEl.addEventListener('mouseenter', showButton);
		tableEl.addEventListener('mouseleave', hideButton);
		button.addEventListener('mouseenter', showButton);
		button.addEventListener('mouseleave', hideButton);

		button.addEventListener('mousedown', (e) => {
			e.preventDefault();
			e.stopPropagation();
		});
		button.addEventListener('click', (e) => {
			e.preventDefault();
			e.stopPropagation();
			TableMenu.show(tableEl, e, this.getTableOptionsActions(tableEl));
		});

		this.host.register(() => {
			resizeObserver.disconnect();
			activeWindow.removeEventListener('scroll', onScrollOrResize, true);
			activeWindow.removeEventListener('resize', onScrollOrResize);
			tableEl.removeEventListener('mouseenter', showButton);
			tableEl.removeEventListener('mouseleave', hideButton);
			button.removeEventListener('mouseenter', showButton);
			button.removeEventListener('mouseleave', hideButton);
			if (hideTimer !== null) window.clearTimeout(hideTimer);
			button.remove();
		});
	}

	private getTableOptionsActions(tableEl: HTMLTableElement): TableMenuAction[] {
		const actions: TableMenuAction[] = [];
		const t = this.host.t;

		// 1. Convert format option
		const context = this.tableContexts.get(tableEl);
		let isHtml = false;
		if (context) {
			isHtml = isTableFromHtmlSource(context, tableEl);
		} else {
			const view = this.host.app.workspace.getActiveViewOfType(MarkdownView);
			const editor = view?.editor;
			if (editor) {
				isHtml = isTableHtmlInEditor(editor, tableEl);
			}
		}

		actions.push({
			text: isHtml ? t.convertToMarkdown : t.convertToHtml,
			action: () => this.convertTableFormat(tableEl),
		});

		actions.push({ separator: true });

		// 2. Table header toggles (editor-aware)
		const view = this.host.app.workspace.getActiveViewOfType(MarkdownView);
		const editor = view?.editor ?? undefined;

		actions.push(
			{ text: t.toggleHeaderRow, action: () => this.toggleHeaderRow(tableEl, editor) },
			{ text: t.toggleHeaderColumn, action: () => this.toggleHeaderColumn(tableEl, editor) },
		);

		// 3. Caption support
		const hasCaption = tableEl.querySelector('caption') !== null;
		if (!hasCaption) {
			actions.push({
				text: t.addCaption,
				action: () => this.addCaption(tableEl, editor),
			});
		}

		// 4. Column width styling
		actions.push(
			{ separator: true },
			{
				text: t.columnWidth,
				children: [
					{
						text: t.autoFitColumns,
						action: () => {
							TableStyler.autoFitColumns(tableEl);
							this.persistTableChanges(tableEl, editor);
						},
					},
					{
						text: t.equalColumnWidth,
						action: () => {
							TableStyler.equalizeColumns(tableEl);
							this.persistTableChanges(tableEl, editor);
						},
					},
				],
			},
		);

		return actions;
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

	private installTableMenuDismissHandler(tableEl: HTMLTableElement): void {
		if (this.tableMenuDismissGuards.has(tableEl)) return;
		this.tableMenuDismissGuards.add(tableEl);

		const closeOnTablePointer = (e: MouseEvent | PointerEvent) => {
			if (e.button !== 0) return;
			const target = e.target;
			if (target instanceof Node && activeDocument.querySelector('.table-context-menu')?.contains(target)) return;
			TableMenu.closeAll();
		};

		tableEl.addEventListener('pointerdown', closeOnTablePointer, true);
		tableEl.addEventListener('mousedown', closeOnTablePointer, true);
	}

	// ---- Table enhancement ----

	/**
	 * Enhance a table in live preview mode (no MarkdownPostProcessorContext).
	 * Adds resize handles, cell selection, and context menu.
	 */
	private enhanceTableLivePreview(tableEl: HTMLTableElement): void {
		if (this.enhancedTables.has(tableEl)) return;
		this.enhancedTables.add(tableEl);
		tableEl.addClass('better-table');
		this.cellEditor.enhanceRenderedContent(tableEl);
		this.cellEditor.addCaptionInteractionHandlers(tableEl);
		addColumnResizeHandles(tableEl, (t) => this.persistTableChanges(t));
		addTableWidthResizeHandle(tableEl, (cb) => this.host.register(cb), (t) => this.persistTableChanges(t));
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

		this.cellEditor.enhanceRenderedContent(tableEl);
		this.cellEditor.addCaptionInteractionHandlers(tableEl);

		// Add drag handles for column resizing
		addColumnResizeHandles(tableEl, (t) => this.persistTableChanges(t));
		addTableWidthResizeHandle(tableEl, (cb) => this.host.register(cb), (t) => this.persistTableChanges(t));

		// Add cell click handlers for selection
		this.addCellSelectionHandlers(tableEl);
		this.addEdgeSelectionHandlers(tableEl);

		// Add caption support
		if (this.host.settings.enableCaption) {
			this.addCaptionSupport(tableEl, context);
			this.cellEditor.addCaptionInteractionHandlers(tableEl);
		}

		tableEl.addEventListener('contextmenu', (e: MouseEvent) => {
			e.preventDefault();
			this.lastRightClickedTable = tableEl;
			this.lastRightClickedCell = (e.target as HTMLElement).closest('td, th');
			SelectionManager.syncFromNativeSelection(tableEl);
			TableMenu.show(tableEl, e, this.getReadingModeActions(tableEl));
		});
	}

	// ---- Source path helper (used by CellEditor via callback) ----

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

				const lastSelected = SelectionManager.getLastSelected(tableEl);
				if (mouseEvent.shiftKey && lastSelected) {
					// Range selection with Shift+click
					SelectionManager.selectRange(tableEl, lastSelected, cellEl);
				} else if (mouseEvent.ctrlKey || mouseEvent.metaKey) {
					// Toggle selection with Ctrl/Cmd+click
					SelectionManager.toggle(tableEl, cellEl);
				} else {
					// Single selection - clear previous and select new
					SelectionManager.clearTable(tableEl);
					SelectionManager.select(tableEl, cellEl);
				}

				SelectionManager.setLastSelected(tableEl, cellEl);
				this.startCellDragSelection(tableEl, cellEl);
			});
			cell.addEventListener('dblclick', (e: Event) => {
				const mouseEvent = e as MouseEvent;
				if (mouseEvent.button !== 0) return;
				e.preventDefault();
				e.stopPropagation();
				this.cellEditor.editCellText(tableEl, cell as HTMLElement);
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
					SelectionManager.selectColumnRange(tableEl, colIndex, colIndex);
					this.startEdgeDragSelection(tableEl, 'top', colIndex);
				}
			} else {
				const rowIndex = this.getRowIndexAtPoint(tableEl, e.clientY);
				if (rowIndex >= 0) {
					SelectionManager.selectRowRange(tableEl, rowIndex, rowIndex);
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
				if (colIndex >= 0) SelectionManager.selectColumnRange(tableEl, startIndex, colIndex);
			} else {
				const rowIndex = this.getRowIndexAtPoint(tableEl, moveEvent.clientY);
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

	private startCellDragSelection(tableEl: HTMLTableElement, startCell: HTMLElement): void {
		let dragging = false;

		const onMouseMove = (moveEvent: MouseEvent) => {
			const targetCell = this.getCellAtPoint(tableEl, moveEvent.clientX, moveEvent.clientY);
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

	// ---- Point-to-index helpers ----

	private getRowIndexAtPoint(tableEl: HTMLTableElement, clientY: number): number {
		return Array.from(tableEl.querySelectorAll<HTMLTableRowElement>('tr'))
			.findIndex(rowEl => {
				const rect = rowEl.getBoundingClientRect();
				return clientY >= rect.top && clientY <= rect.bottom;
			});
	}

	private getColumnIndexAtPoint(tableEl: HTMLTableElement, clientX: number): number {
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


	private getTableSourcePath(tableEl: HTMLTableElement): string {
		const context = this.tableContexts.get(tableEl);
		if (context) return context.sourcePath;
		return this.host.app.workspace.getActiveFile()?.path ?? '';
	}


	// ---- Header row / column ----

	toggleHeaderRow(tableEl?: HTMLTableElement, editor?: Editor): void {
		if (editor) {
			const sourceText = editor.getValue();
			const lines = sourceText.split('\n');
			const range = findTableNearEditorSelection(editor) ?? (tableEl ? findTableInSource(lines, tableEl) : null);
			if (range && range.kind === 'markdown') {
				const secondLine = lines[range.start + 1]?.trim() ?? '';
				const isSeparator = isMarkdownSeparator(secondLine);

				if (isSeparator) {
					// Remove separator line (header → data)
					editor.replaceRange(
						'',
						{ line: range.start + 1, ch: 0 },
						{ line: range.start + 2, ch: 0 }
					);
					new Notice(this.host.t.headerRowRemoved);
				} else {
					// Add separator line (data → header)
					const numCols = this.countTableColumns(lines, range.start);
					const separator = '| ' + Array(numCols).fill('---').join(' | ') + ' |';
					editor.replaceRange(
						separator + '\n',
						{ line: range.start + 1, ch: 0 },
						{ line: range.start + 1, ch: 0 }
					);
					new Notice(this.host.t.headerRowAdded);
				}
				return;
			}
		}

		if (!tableEl) return;
		if (editor && !this.canPersistLiveTable(editor, tableEl)) return;
		const added = this.toggleHeaderRowInDom(tableEl);
		this.persistTableChanges(tableEl, editor);
		new Notice(added ? this.host.t.headerRowAdded : this.host.t.headerRowRemoved);
	}

	toggleHeaderColumn(tableEl: HTMLTableElement, editor?: Editor): void {
		if (editor && !this.canPersistLiveTable(editor, tableEl)) return;
		this.toggleHeaderColumnInDom(tableEl);
		this.persistTableChanges(tableEl, editor);
		new Notice(this.host.t.headerColumnToggled);
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

	// ---- Caption ----

	addCaption(tableEl?: HTMLTableElement, editor?: Editor): void {
		// Check if caption already exists
		const existingCaption = tableEl?.querySelector('caption');
		if (existingCaption) {
			new Notice(this.host.t.tableAlreadyHasCaption);
			return;
		}

		const modal = new CaptionModal(this.host.app, this.host.t, (caption) => {
			if (!caption) return;

			if (editor) {
				const sourceText = editor.getValue();
				const lines = sourceText.split('\n');
				const range = findTableNearEditorSelection(editor) ?? (tableEl ? findTableInSource(lines, tableEl) : null);
				if (range && range.kind === 'markdown') {
					// Insert caption line before the table
					editor.replaceRange(
						`[${caption}]\n\n`,
						{ line: range.start, ch: 0 },
						{ line: range.start, ch: 0 }
					);
					new Notice(this.host.t.captionAdded);
					return;
				}
			}

			if (tableEl) {
				const captionEl = tableEl.createEl('caption');
				captionEl.textContent = caption;
				this.cellEditor.addCaptionInteractionHandlers(tableEl);
				this.persistTableChanges(tableEl, editor);
				new Notice(this.host.t.captionAdded);
			}
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
				const bracketCaption = text?.match(/^\[(.+)]$/)?.[1]?.trim();
				if (bracketCaption) {
					const captionEl = tableEl.createEl('caption');
					captionEl.textContent = bracketCaption;
					this.cellEditor.addCaptionInteractionHandlers(tableEl);
					prevSibling.remove();
				}
			}
		}
	}



	private countTableColumns(lines: string[], tableStart: number): number {
		const line = lines[tableStart]?.trim() ?? '';
		return line.split('|').filter(c => c.trim() !== '').length;
	}

	// ---- Source range helpers ----

	private findEditableTableRange(editor: Editor, tableEl: HTMLTableElement): ReturnType<typeof findTableInSource> {
		const lines = editor.getValue().split('\n');
		return findTableNearEditorSelection(editor) ?? findTableInSource(lines, tableEl);
	}

	canPersistLiveTable(editor: Editor | undefined, tableEl: HTMLTableElement): boolean {
		if (!editor) return true;
		const range = this.findEditableTableRange(editor, tableEl);
		if (!range) {
			new Notice('Failed to find table in source');
			return false;
		}
		return true;
	}

	// ---- Cell / table helpers ----

	private getTableCells(tableEl: HTMLTableElement): HTMLElement[] {
		return Array.from(tableEl.querySelectorAll<HTMLElement>('td, th'))
			.filter(cell => !cell.hasClass('merged-cell-hidden'));
	}

	private isWholeTableSelected(tableEl: HTMLTableElement): boolean {
		const cells = this.getTableCells(tableEl);
		return cells.length > 0 && cells.every(cell => cell.hasClass('cell-selected'));
	}

	private getActionMergedCell(tableEl: HTMLTableElement): HTMLElement | null {
		const candidates = [
			this.lastRightClickedCell,
			...SelectionManager.getSelected(tableEl),
		].filter((cell): cell is HTMLElement => cell !== null && cell.closest('table') === tableEl);

		return candidates.find(cell => this.isMergedCell(cell)) ?? null;
	}

	private isMergedCell(cell: HTMLElement): boolean {
		return cell.hasAttribute('rowspan') || cell.hasAttribute('colspan');
	}

	// ---- Merge / unmerge ----

	mergeSelectedCells(tableEl: HTMLTableElement, editor?: Editor): void {
		if (!this.canPersistLiveTable(editor, tableEl)) return;
		const selected = SelectionManager.getSelected(tableEl);
		if (selected.length < 2) {
			new Notice(this.host.t.selectAtLeast2Cells);
			return;
		}

		// Get positions of all selected cells
		const positions = selected
			.map(cell => ({ cell, pos: getCellPosition(cell) }))
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
		SelectionManager.clearTable(tableEl);

		new Notice(this.host.t.cellsMerged);
		this.persistTableChanges(tableEl, editor);
	}

	unmergeCells(tableEl: HTMLTableElement, editor?: Editor): void {
		if (!this.canPersistLiveTable(editor, tableEl)) return;
		const mergedCell = this.getActionMergedCell(tableEl);

		if (!mergedCell) {
			new Notice(this.host.t.cellNotMerged);
			return;
		}

		const rowSpan = parseInt(mergedCell.getAttribute('rowspan') || '1');
		const colSpan = parseInt(mergedCell.getAttribute('colspan') || '1');

		// Remove spans
		const cellsToRestore = this.createEmptyMergeCells(rowSpan, colSpan, mergedCell.tagName.toLowerCase());
		mergedCell.removeAttribute('rowspan');
		mergedCell.removeAttribute('colspan');

		// Show hidden cells in the merge range
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
		this.addCellSelectionHandlers(tableEl);

		new Notice(this.host.t.cellsUnmerged);
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

	// ---- Alignment ----

	applyAlignment(
		tableEl: HTMLTableElement,
		editor: Editor | undefined,
		direction: 'horizontal' | 'vertical',
		value: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom',
	): void {
		if (!this.canPersistLiveTable(editor, tableEl)) return;
		const selected = SelectionManager.getSelected(tableEl);
		const cells = selected.length > 0
			? selected
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

	// ---- Reading mode context menu actions ----

	private getReadingModeActions(tableEl: HTMLTableElement): TableMenuAction[] {
		const actions: TableMenuAction[] = [];
		const t = this.host.t;
		const selected = SelectionManager.getSelected(tableEl);
		const canMerge = selected.length >= 2;
		const canUnmerge = this.getActionMergedCell(tableEl) !== null;
		const canAlign = selected.length > 0 || this.lastRightClickedCell !== null;

		if (canMerge) actions.push({ text: t.mergeCells, action: () => this.mergeSelectedCells(tableEl) });
		if (canUnmerge) actions.push({ text: t.unmergeCells, action: () => this.unmergeCells(tableEl) });
		if (actions.length > 0) actions.push({ separator: true });

		const selectedCols = this.getSelectedColumnIndices(tableEl);
		actions.push(
			{
				text: t.columnWidth,
				children: [
					{ text: t.autoFitSelectedColumns, action: () => {
						TableStyler.autoFitSelectedColumns(tableEl, selectedCols);
						this.persistTableChanges(tableEl);
					} },
					{ text: t.equalSelectedColumnWidth, action: () => {
						TableStyler.equalizeSelectedColumns(tableEl, selectedCols);
						this.persistTableChanges(tableEl);
					} },
				],
			},
		);

		if (canAlign) {
			actions.push(
				{
					text: t.alignment,
					children: [
						{ text: t.left, action: () => this.applyAlignment(tableEl, undefined, 'horizontal', 'left') },
						{ text: t.center, action: () => this.applyAlignment(tableEl, undefined, 'horizontal', 'center') },
						{ text: t.right, action: () => this.applyAlignment(tableEl, undefined, 'horizontal', 'right') },
						{ separator: true },
						{ text: t.top, action: () => this.applyAlignment(tableEl, undefined, 'vertical', 'top') },
						{ text: t.middle, action: () => this.applyAlignment(tableEl, undefined, 'vertical', 'middle') },
						{ text: t.bottom, action: () => this.applyAlignment(tableEl, undefined, 'vertical', 'bottom') },
					],
				},
			);
		}

		return actions;
	}



	// ---- Format conversion ----

	convertTableFormat(tableEl: HTMLTableElement, editor?: Editor): void {
		const context = this.tableContexts.get(tableEl);
		if (context) {
			if (isTableFromHtmlSource(context, tableEl)) {
				const sourceHtml = readTableSource(this.host.app, context, tableEl);
				if (!sourceHtml) return;
				const tableData = parseHtmlToTableData(sourceHtml);
				if (!tableData) return;
				const markdown = markdownTableToString(tableData);
				void replaceTableSource(this.host.app, context, tableEl, markdown).then(success => {
					if (success) new Notice(this.host.t.tableConvertedToMarkdown);
				});
			} else {
				const html = serializeTableToHtml(tableEl);
				void replaceTableSource(this.host.app, context, tableEl, html).then(success => {
					if (success) new Notice(this.host.t.tableConvertedToHtml);
				});
			}
			return;
		}

		const activeEditor = editor ?? this.host.app.workspace.getActiveViewOfType(MarkdownView)?.editor;
		if (!activeEditor) {
			new Notice('Failed to find active editor');
			return;
		}

		const range = this.findEditableTableRange(activeEditor, tableEl);
		if (!range) {
			new Notice('Failed to find table in source');
			return;
		}

		const lines = activeEditor.getValue().split('\n');
		const source = lines.slice(range.start, range.end + 1).join('\n');
		if (range.kind === 'markdown') {
			const tableData = parseMarkdownTable(source);
			if (!tableData) {
				new Notice('Failed to parse table');
				return;
			}
			if (replaceTableRangeInEditor(activeEditor, range, tableDataToHtml(tableData))) {
				new Notice(this.host.t.tableConvertedToHtml);
			}
			return;
		}

		const tableData = parseHtmlToTableData(source);
		if (!tableData) {
			new Notice('Failed to parse table');
			return;
		}
		if (replaceTableRangeInEditor(activeEditor, range, markdownTableToString(tableData))) {
			new Notice(this.host.t.tableConvertedToMarkdown);
		}
	}

	// ---- Persistence ----

	persistTableChanges(tableEl: HTMLTableElement, editor?: Editor): boolean {
		const context = this.tableContexts.get(tableEl);
		const html = serializeTableToHtml(tableEl);
		const activeEditor = editor ?? this.host.app.workspace.getActiveViewOfType(MarkdownView)?.editor;

		if (context) {
			// Reading mode
			if (!isTableFromHtmlSource(context, tableEl)) {
				new Notice(this.host.t.tableConvertedToHtml);
			}
			void replaceTableSource(this.host.app, context, tableEl, html);
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
				new Notice(this.host.t.tableConvertedToHtml);
			}
			return true;
		}
		return false;
	}

	// ---- Submenu helper ----

	private addSubmenu(menu: Menu, title: string, build: (submenu: Menu) => void): void {
		menu.addItem((item) => {
			item.setTitle(title);
			const submenu = (item as MenuItemWithSubmenu).setSubmenu?.();
			if (!submenu) {
				item.setDisabled(true);
				return;
			}
			build(submenu);
		});
	}

	// ---- Native selection helper ----

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
}

// ---- Caption Modal ----

export class CaptionModal extends Modal {
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
