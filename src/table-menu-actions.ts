import { Editor, MarkdownPostProcessorContext, Menu, MenuItem, Notice } from 'obsidian';
import type { Locale } from './i18n';
import type { BetterTablesSettings } from './settings';
import { TableMenu, type TableMenuAction } from './menu';
import { TableStyler } from './styler';
import { SelectionManager, getCellPosition } from './selection';
import {
	isTableFromHtmlSource,
	isTableHtmlInEditor,
} from './source-editor';
import type { CellEditor } from './cell-editor';

type MenuItemWithSubmenu = MenuItem & {
	setSubmenu?: () => Menu;
};

// ----
// Command stubs
// ----

export function cmdToggleHeaderRow(t: Locale): void {
	new Notice(t.useRightClickMenu);
}

export function cmdToggleHeaderColumn(t: Locale): void {
	new Notice(t.useRightClickMenu);
}

export function cmdAddTableCaption(t: Locale): void {
	new Notice(t.useRightClickMenu);
}

// ----
// Submenu helper
// ----

export function addSubmenu(menu: Menu, title: string, build: (submenu: Menu) => void): void {
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

// ----
// Selected column indices
// ----

export function getSelectedColumnIndices(
	tableEl: HTMLTableElement,
	lastRightClickedCell: HTMLElement | null,
): number[] {
	const selected = SelectionManager.getSelected(tableEl);
	const cols = new Set<number>();
	if (selected.length > 0) {
		selected.forEach(cell => {
			const pos = getCellPosition(cell);
			if (pos) cols.add(pos.col);
		});
	} else if (lastRightClickedCell) {
		const pos = getCellPosition(lastRightClickedCell);
		if (pos) cols.add(pos.col);
	}
	return Array.from(cols).sort((a, b) => a - b);
}

// ----
// Alignment
// ----

export function applyAlignment(
	tableEl: HTMLTableElement,
	settings: BetterTablesSettings,
	lastRightClickedCell: HTMLElement | null,
	direction: 'horizontal' | 'vertical',
	value: AlignValue,
): void {
	const selected = SelectionManager.getSelected(tableEl);
	const cells = selected.length > 0
		? selected
		: lastRightClickedCell
			? [lastRightClickedCell]
			: [];
	if (cells.length === 0) return;

	cells.forEach(cell => {
		if (direction === 'horizontal') {
			cell.style.textAlign = value;
		} else {
			cell.style.verticalAlign = value;
		}
	});
}

// ----
// Determine whether a table is currently in HTML format
// ----

export function tableIsHtml(
	tableEl: HTMLTableElement,
	tableContexts: WeakMap<HTMLTableElement, MarkdownPostProcessorContext>,
	editor?: Editor,
): boolean {
	const context = tableContexts.get(tableEl);
	if (context) return isTableFromHtmlSource(context, tableEl);
	if (editor) return isTableHtmlInEditor(editor, tableEl);
	return false;
}

// ----
// Floating button actions (full menu for the convert-button)
// ----

export interface MenuActionDeps {
	tableContexts: WeakMap<HTMLTableElement, MarkdownPostProcessorContext>;
	settings: BetterTablesSettings;
	editor?: Editor;
	onConvert: (tableEl: HTMLTableElement) => void;
	onToggleHeaderRow: (tableEl: HTMLTableElement, editor?: Editor) => void;
	onToggleHeaderColumn: (tableEl: HTMLTableElement, editor?: Editor) => void;
	onAddCaption: (tableEl: HTMLTableElement, editor?: Editor) => void;
	onAutoFit: (tableEl: HTMLTableElement) => void;
	onEqualize: (tableEl: HTMLTableElement) => void;
}

export function getTableOptionsActions(
	tableEl: HTMLTableElement,
	t: Locale,
	deps: MenuActionDeps,
): TableMenuAction[] {
	const actions: TableMenuAction[] = [];

	// 1. Convert format option
	const isHtml = tableIsHtml(tableEl, deps.tableContexts, deps.editor);

	actions.push({
		text: isHtml ? t.convertToMarkdown : t.convertToHtml,
		action: () => deps.onConvert(tableEl),
	});

	actions.push({ separator: true });

	// 2. Table header toggles
	actions.push(
		{ text: t.toggleHeaderRow, action: () => deps.onToggleHeaderRow(tableEl, deps.editor) },
		{ text: t.toggleHeaderColumn, action: () => deps.onToggleHeaderColumn(tableEl, deps.editor) },
	);

	// 3. Caption support
	const hasCaption = tableEl.querySelector('caption') !== null;
	if (!hasCaption) {
		actions.push({
			text: t.addCaption,
			action: () => deps.onAddCaption(tableEl, deps.editor),
		});
	}

	// 4. Column width styling
	actions.push(
		{ separator: true },
		{
			text: t.columnWidth,
			children: [
				{ text: t.autoFitColumns, action: () => deps.onAutoFit(tableEl) },
				{ text: t.equalColumnWidth, action: () => deps.onEqualize(tableEl) },
			],
		},
	);

	return actions;
}

// ----
// Reading mode context menu actions
// ----

export type AlignValue = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';

export interface ReadingModeActionDeps {
	lastRightClickedCell: HTMLElement | null;
	onMerge: (tableEl: HTMLTableElement, editor?: Editor) => void;
	onUnmerge: (tableEl: HTMLTableElement, editor?: Editor) => void;
	onAutoFitSelected: (tableEl: HTMLTableElement, cols: number[]) => void;
	onEqualizeSelected: (tableEl: HTMLTableElement, cols: number[]) => void;
	onAlign: (tableEl: HTMLTableElement, editor: Editor | undefined, dir: 'horizontal' | 'vertical', val: AlignValue) => void;
}

export function getReadingModeActions(
	tableEl: HTMLTableElement,
	t: Locale,
	deps: ReadingModeActionDeps,
): TableMenuAction[] {
	const actions: TableMenuAction[] = [];
	const selected = SelectionManager.getSelected(tableEl);
	const canMerge = selected.length >= 2;
	const canUnmerge = selected.some(cell => cell.hasAttribute('rowspan') || cell.hasAttribute('colspan'));
	const canAlign = selected.length > 0 || deps.lastRightClickedCell !== null;

	if (canMerge) actions.push({ text: t.mergeCells, action: () => deps.onMerge(tableEl) });
	if (canUnmerge) actions.push({ text: t.unmergeCells, action: () => deps.onUnmerge(tableEl) });
	if (actions.length > 0) actions.push({ separator: true });

	const selectedCols = getSelectedColumnIndices(tableEl, deps.lastRightClickedCell);
	actions.push({
		text: t.columnWidth,
		children: [
			{ text: t.autoFitSelectedColumns, action: () => deps.onAutoFitSelected(tableEl, selectedCols) },
			{ text: t.equalSelectedColumnWidth, action: () => deps.onEqualizeSelected(tableEl, selectedCols) },
		],
	});

	if (canAlign) {
		actions.push({
			text: t.alignment,
			children: [
				{ text: t.left, action: () => deps.onAlign(tableEl, undefined, 'horizontal', 'left') },
				{ text: t.center, action: () => deps.onAlign(tableEl, undefined, 'horizontal', 'center') },
				{ text: t.right, action: () => deps.onAlign(tableEl, undefined, 'horizontal', 'right') },
				{ separator: true },
				{ text: t.top, action: () => deps.onAlign(tableEl, undefined, 'vertical', 'top') },
				{ text: t.middle, action: () => deps.onAlign(tableEl, undefined, 'vertical', 'middle') },
				{ text: t.bottom, action: () => deps.onAlign(tableEl, undefined, 'vertical', 'bottom') },
			],
		});
	}

	return actions;
}

// ----
// Editor context menu builder
// ----

export interface EditorMenuDeps {
	canPersistLiveTable(editor: Editor, tableEl: HTMLTableElement): boolean;
	persistTableChanges(tableEl: HTMLTableElement, editor?: Editor): boolean;
	onMerge: (tableEl: HTMLTableElement, editor?: Editor) => void;
	onUnmerge: (tableEl: HTMLTableElement, editor?: Editor) => void;
	onAlign: (tableEl: HTMLTableElement, editor: Editor | undefined, dir: 'horizontal' | 'vertical', val: AlignValue) => void;
}

export function buildEditorMenu(
	menu: Menu,
	tableEl: HTMLTableElement,
	editor: Editor,
	lastRightClickedCell: HTMLElement | null,
	t: Locale,
	deps: EditorMenuDeps,
): void {
	const selected = SelectionManager.getSelected(tableEl);
	const canMerge = selected.length >= 2;
	const canUnmerge = selected.some(cell => cell.hasAttribute('rowspan') || cell.hasAttribute('colspan'));
	const canAlign = selected.length > 0 || lastRightClickedCell !== null;

	menu.addSeparator();
	if (canMerge) {
		menu.addItem((item) =>
			item.setTitle(t.mergeCells)
				.onClick(() => deps.onMerge(tableEl, editor))
		);
	}
	if (canUnmerge) {
		menu.addItem((item) =>
			item.setTitle(t.unmergeCells)
				.onClick(() => deps.onUnmerge(tableEl, editor))
		);
	}

	addSubmenu(menu, t.columnWidth, (submenu) => {
		const selectedCols = getSelectedColumnIndices(tableEl, lastRightClickedCell);
		submenu.addItem((item) =>
			item.setTitle(t.autoFitSelectedColumns)
				.onClick(() => {
					if (!deps.canPersistLiveTable(editor, tableEl)) return;
					TableStyler.autoFitSelectedColumns(tableEl, selectedCols);
					deps.persistTableChanges(tableEl, editor);
				})
		);
		submenu.addItem((item) =>
			item.setTitle(t.equalSelectedColumnWidth)
				.onClick(() => {
					if (!deps.canPersistLiveTable(editor, tableEl)) return;
					TableStyler.equalizeSelectedColumns(tableEl, selectedCols);
					deps.persistTableChanges(tableEl, editor);
				})
		);
	});
	if (canAlign) {
		addSubmenu(menu, t.alignment, (submenu) => {
			submenu.addItem((item) =>
				item.setTitle(t.left)
					.onClick(() => deps.onAlign(tableEl, editor, 'horizontal', 'left'))
			);
			submenu.addItem((item) =>
				item.setTitle(t.center)
					.onClick(() => deps.onAlign(tableEl, editor, 'horizontal', 'center'))
			);
			submenu.addItem((item) =>
				item.setTitle(t.right)
					.onClick(() => deps.onAlign(tableEl, editor, 'horizontal', 'right'))
			);
			submenu.addSeparator();
			submenu.addItem((item) =>
				item.setTitle(t.top)
					.onClick(() => deps.onAlign(tableEl, editor, 'vertical', 'top'))
			);
			submenu.addItem((item) =>
				item.setTitle(t.middle)
					.onClick(() => deps.onAlign(tableEl, editor, 'vertical', 'middle'))
			);
			submenu.addItem((item) =>
				item.setTitle(t.bottom)
					.onClick(() => deps.onAlign(tableEl, editor, 'vertical', 'bottom'))
			);
		});
	}
}
