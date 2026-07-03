import {
	App,
	Editor,
	MarkdownPostProcessorContext,
	MarkdownView,
	Menu,
	Notice,
	Component,
} from 'obsidian';
import type { BetterTablesSettings } from './settings';
import type { Locale } from './i18n';
import { TableMenu } from './menu';
import { TableStyler } from './styler';
import { SelectionManager } from './selection';
import {
	replaceTableSource,
	isTableFromHtmlSource,
	replaceTableInEditor,
	isTableHtmlInEditor,
	findTableInSource,
	findTableNearEditorSelection,
} from './source-editor';
import { serializeTableToHtml } from './html-serializer';
import { addColumnResizeHandles, addTableWidthResizeHandle } from './resize';
import { CellEditor } from './cell-editor';

import {
	toggleHeaderRow,
	toggleHeaderColumn,
} from './table-header';
import type { HeaderToggleCallbacks } from './table-header';

import {
	mergeSelectedCells,
	unmergeCells,
} from './table-merger';
import type { MergerCallbacks } from './table-merger';

import { convertTableFormat } from './table-converter';

import {
	addCellSelectionHandlers,
	addEdgeSelectionHandlers,
	getTableFromNativeSelection,
} from './table-interaction';

import {
	registerConversionButtonObserver,
	installConversionButtons,
	installFloatingConversionButton,
	suppressHtmlEmbedSourceEdit,
	installTableMenuDismissHandler,
} from './conversion-button';

import {
	cmdToggleHeaderRow,
	cmdToggleHeaderColumn,
	cmdAddTableCaption,
	applyAlignment,
	getTableOptionsActions,
	getReadingModeActions,
	buildEditorMenu,
} from './table-menu-actions';

import { addCaptionSupport, addCaption } from './table-caption';
import type { CaptionCallbacks } from './table-caption';

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

	private headerCallbacks: HeaderToggleCallbacks;
	private mergerCallbacks: MergerCallbacks;
	private captionCallbacks: CaptionCallbacks;

	constructor(private host: PluginHost) {
		this.cellEditor = new CellEditor({
			app: host.app,
			getSettings: () => host.settings,
			addChild: host.addChild.bind(host),
			removeChild: host.removeChild.bind(host),
			getSourcePath: (tableEl) => this.getTableSourcePath(tableEl),
			onPersist: (tableEl) => this.persistTableChanges(tableEl),
		});

		this.headerCallbacks = {
			canPersistLiveTable: (editor, tableEl) => this.canPersistLiveTable(editor, tableEl),
			persistTableChanges: (tableEl, editor) => this.persistTableChanges(tableEl, editor),
		};

		this.mergerCallbacks = {
			addCellSelectionHandlers: (tableEl) => addCellSelectionHandlers(tableEl, this.cellEditor),
			persistTableChanges: (tableEl, editor) => this.persistTableChanges(tableEl, editor),
		};

		this.captionCallbacks = {
			persistTableChanges: (tableEl, editor) => this.persistTableChanges(tableEl, editor),
		};
	}

	// ---- Lifecycle ----

	initialize(): void {
		this.contextmenuHandler = (e: MouseEvent) => {
			const target = e.target as HTMLElement;
			this.lastRightClickedTable = target.closest('table') ?? getTableFromNativeSelection();
			this.lastRightClickedCell = target.closest('td, th');
			if (this.lastRightClickedTable) {
				SelectionManager.syncFromNativeSelection(this.lastRightClickedTable);
			}
		};
		activeDocument.addEventListener('contextmenu', this.contextmenuHandler, true);

		registerConversionButtonObserver(
			(root) => this.installConversionButtonsOn(root),
			(cb) => this.host.register(cb),
		);
		this.installConversionButtonsOn(activeDocument.body);
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

	// ---- Conversion button installation ----

	private installConversionButtonsOn(root: HTMLElement): void {
		const fresh = installConversionButtons(
			root,
			this.conversionButtons,
			this.host.settings.enableAdvancedTables,
		);
		for (const tableEl of fresh) {
			const container = tableEl.closest<HTMLElement>('.table-wrapper, .cm-html-embed')
				?? tableEl.parentElement;
			if (!container) continue;

			if (container.hasClass('cm-html-embed')) {
				this.enhanceTableLivePreview(tableEl);
				suppressHtmlEmbedSourceEdit(tableEl, this.htmlSourceEditGuards);
			}

			container.addClass('better-table-convert-container');
			installTableMenuDismissHandler(tableEl, this.tableMenuDismissGuards);
			installFloatingConversionButton(
				tableEl,
				this.host.t,
				(t) => this.getTableOptionsActions(t),
				(cb) => this.host.register(cb),
			);
		}
	}

	// ---- Editor context menu (live preview) ----

	buildEditorMenu(menu: Menu, editor: Editor): void {
		const tableEl = this.lastRightClickedTable;
		if (!tableEl) return;
		if (this.tableContexts.has(tableEl)) return;
		if (!isTableHtmlInEditor(editor, tableEl)) return;

		buildEditorMenu(menu, tableEl, editor, this.lastRightClickedCell, this.host.t, {
			canPersistLiveTable: (ed, tEl) => this.canPersistLiveTable(ed, tEl),
			persistTableChanges: (tEl, ed) => this.persistTableChanges(tEl, ed),
			onMerge: (tEl, ed) => this.mergeSelectedCells(tEl, ed),
			onUnmerge: (tEl, ed) => this.unmergeCells(tEl, ed),
			onAlign: (tEl, ed, dir, val) => this.applyAlignment(tEl, ed, dir, val),
		});
	}

	// ---- Command stubs ----

	cmdToggleHeaderRow(_editor: Editor): void { cmdToggleHeaderRow(this.host.t); }
	cmdToggleHeaderColumn(_editor: Editor): void { cmdToggleHeaderColumn(this.host.t); }
	cmdAddTableCaption(_editor: Editor): void { cmdAddTableCaption(this.host.t); }

	// ---- Table options actions (floating button) ----

	private getTableOptionsActions(tableEl: HTMLTableElement) {
		return getTableOptionsActions(tableEl, this.host.t, {
			tableContexts: this.tableContexts,
			settings: this.host.settings,
			editor: this.host.app.workspace.getActiveViewOfType(MarkdownView)?.editor ?? undefined,
			onConvert: (t) => convertTableFormat(t, this.host.app, this.host.t, this.tableContexts),
			onToggleHeaderRow: (t, ed) => this.toggleHeaderRow(t, ed),
			onToggleHeaderColumn: (t, ed) => this.toggleHeaderColumn(t, ed),
			onAddCaption: (t, ed) => this.addCaption(t, ed),
			onAutoFit: () => { /* submenu handler below */ },
			onEqualize: () => { /* submenu handler below */ },
		});
	}

	// ---- Reading mode context menu actions ----

	private getReadingModeActions(tableEl: HTMLTableElement) {
		return getReadingModeActions(tableEl, this.host.t, {
			lastRightClickedCell: this.lastRightClickedCell,
			onMerge: (t, ed) => this.mergeSelectedCells(t, ed),
			onUnmerge: (t, ed) => this.unmergeCells(t, ed),
			onAutoFitSelected: (t, cols) => {
				TableStyler.autoFitSelectedColumns(t, cols);
				this.persistTableChanges(t);
			},
			onEqualizeSelected: (t, cols) => {
				TableStyler.equalizeSelectedColumns(t, cols);
				this.persistTableChanges(t);
			},
			onAlign: (t, ed, dir, val) => this.applyAlignment(t, ed, dir, val),
		});
	}

	// ---- Table enhancement ----

	private enhanceTableLivePreview(tableEl: HTMLTableElement): void {
		if (this.enhancedTables.has(tableEl)) return;
		this.enhancedTables.add(tableEl);
		tableEl.addClass('better-table');
		this.cellEditor.enhanceRenderedContent(tableEl);
		this.cellEditor.addCaptionInteractionHandlers(tableEl);
		addColumnResizeHandles(tableEl, (t) => this.persistTableChanges(t));
		addTableWidthResizeHandle(tableEl, (cb) => this.host.register(cb), (t) => this.persistTableChanges(t));
		addCellSelectionHandlers(tableEl, this.cellEditor);
		addEdgeSelectionHandlers(tableEl);
	}

	private enhanceTable(tableEl: HTMLTableElement, context: MarkdownPostProcessorContext): void {
		if (this.enhancedTables.has(tableEl)) return;
		this.tableContexts.set(tableEl, context);
		this.enhancedTables.add(tableEl);

		tableEl.addClass('better-table');
		this.cellEditor.enhanceRenderedContent(tableEl);
		this.cellEditor.addCaptionInteractionHandlers(tableEl);

		addColumnResizeHandles(tableEl, (t) => this.persistTableChanges(t));
		addTableWidthResizeHandle(tableEl, (cb) => this.host.register(cb), (t) => this.persistTableChanges(t));

		addCellSelectionHandlers(tableEl, this.cellEditor);
		addEdgeSelectionHandlers(tableEl);

		if (this.host.settings.enableCaption) {
			addCaptionSupport(tableEl, context, this.cellEditor);
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

	// ---- Source path helper ----

	private getTableSourcePath(tableEl: HTMLTableElement): string {
		const context = this.tableContexts.get(tableEl);
		if (context) return context.sourcePath;
		return this.host.app.workspace.getActiveFile()?.path ?? '';
	}

	// ---- Header row / column ----

	toggleHeaderRow(tableEl?: HTMLTableElement, editor?: Editor): void {
		toggleHeaderRow(tableEl, editor, this.host.t, this.headerCallbacks);
	}

	toggleHeaderColumn(tableEl: HTMLTableElement, editor?: Editor): void {
		toggleHeaderColumn(tableEl, editor, this.host.t, this.headerCallbacks);
	}

	// ---- Caption ----

	addCaption(tableEl?: HTMLTableElement, editor?: Editor): void {
		addCaption(tableEl, editor, this.host.app, this.host.t, this.cellEditor, this.captionCallbacks);
	}

	// ---- Merge / unmerge ----

	mergeSelectedCells(tableEl: HTMLTableElement, editor?: Editor): void {
		mergeSelectedCells(tableEl, this.host.t, this.mergerCallbacks, editor);
	}

	unmergeCells(tableEl: HTMLTableElement, editor?: Editor): void {
		unmergeCells(tableEl, this.host.t, this.mergerCallbacks, this.lastRightClickedCell, editor);
	}

	// ---- Format conversion ----

	convertTableFormat(tableEl: HTMLTableElement, editor?: Editor): void {
		convertTableFormat(tableEl, this.host.app, this.host.t, this.tableContexts, editor);
	}

	// ---- Alignment ----

	applyAlignment(
		tableEl: HTMLTableElement,
		editor: Editor | undefined,
		direction: 'horizontal' | 'vertical',
		value: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom',
	): void {
		if (editor && !this.canPersistLiveTable(editor, tableEl)) return;
		applyAlignment(tableEl, this.host.settings, this.lastRightClickedCell, direction, value);
		this.persistTableChanges(tableEl, editor);
	}

	// ---- Source helpers ----

	private findEditableTableRange(
		editor: Editor,
		tableEl: HTMLTableElement,
	): ReturnType<typeof findTableInSource> {
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

	// ---- Persistence ----

	persistTableChanges(tableEl: HTMLTableElement, editor?: Editor): boolean {
		const context = this.tableContexts.get(tableEl);
		const html = serializeTableToHtml(tableEl);
		const activeEditor = editor ?? this.host.app.workspace.getActiveViewOfType(MarkdownView)?.editor;

		if (context) {
			if (!isTableFromHtmlSource(context, tableEl)) {
				new Notice(this.host.t.tableConvertedToHtml);
			}
			void replaceTableSource(this.host.app, context, tableEl, html);
			return true;
		} else if (activeEditor) {
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
}
