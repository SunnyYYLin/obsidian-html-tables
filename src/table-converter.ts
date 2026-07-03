import { App, Editor, MarkdownPostProcessorContext, MarkdownView, Notice } from 'obsidian';
import type { Locale } from './i18n';
import { serializeTableToHtml, parseHtmlToTableData, tableDataToHtml } from './html-serializer';
import { markdownTableToString, parseMarkdownTable } from './parser';
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

/**
 * Convert a table between Markdown and HTML format.
 */
export function convertTableFormat(
	tableEl: HTMLTableElement,
	app: App,
	t: Locale,
	tableContexts: WeakMap<HTMLTableElement, MarkdownPostProcessorContext>,
	editor?: Editor,
): void {
	const context = tableContexts.get(tableEl);
	if (context) {
		if (isTableFromHtmlSource(context, tableEl)) {
			const sourceHtml = readTableSource(app, context, tableEl);
			if (!sourceHtml) return;
			const tableData = parseHtmlToTableData(sourceHtml);
			if (!tableData) return;
			const markdown = markdownTableToString(tableData);
			void replaceTableSource(app, context, tableEl, markdown).then(success => {
				if (success) new Notice(t.tableConvertedToMarkdown);
			});
		} else {
			const html = serializeTableToHtml(tableEl);
			void replaceTableSource(app, context, tableEl, html).then(success => {
				if (success) new Notice(t.tableConvertedToHtml);
			});
		}
		return;
	}

	const activeEditor = editor ?? app.workspace.getActiveViewOfType(MarkdownView)?.editor;
	if (!activeEditor) {
		new Notice('Failed to find active editor');
		return;
	}

	const lines = activeEditor.getValue().split('\n');
	const range = findTableNearEditorSelection(activeEditor) ?? findTableInSource(lines, tableEl);
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
		if (replaceTableRangeInEditor(activeEditor, range, tableDataToHtml(tableData))) {
			new Notice(t.tableConvertedToHtml);
		}
		return;
	}

	const tableData = parseHtmlToTableData(source);
	if (!tableData) {
		new Notice('Failed to parse table');
		return;
	}
	if (replaceTableRangeInEditor(activeEditor, range, markdownTableToString(tableData))) {
		new Notice(t.tableConvertedToMarkdown);
	}
}
