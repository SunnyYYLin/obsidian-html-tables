import { App, Editor, MarkdownPostProcessorContext, Notice } from 'obsidian';
import type { Locale } from './i18n';
import { findTableNearEditorSelection, findTableInSource } from './source-editor';
import { CaptionModal } from './caption-modal';
import type { CellEditor } from './cell-editor';

/**
 * Check if a <p> sibling before the table contains a bracket caption like [My Caption]
 * and convert it into a <caption> element.
 */
export function addCaptionSupport(
	tableEl: HTMLTableElement,
	context: MarkdownPostProcessorContext,
	cellEditor: CellEditor,
): void {
	const parent = tableEl.parentElement;
	if (parent) {
		const prevSibling = tableEl.previousElementSibling;
		if (prevSibling && prevSibling.tagName === 'P') {
			const text = prevSibling.textContent?.trim();
			const bracketCaption = text?.match(/^\[(.+)]$/)?.[1]?.trim();
			if (bracketCaption) {
				const captionEl = tableEl.createEl('caption');
				captionEl.textContent = bracketCaption;
				cellEditor.addCaptionInteractionHandlers(tableEl);
				prevSibling.remove();
			}
		}
	}
}

export interface CaptionCallbacks {
	persistTableChanges(tableEl: HTMLTableElement, editor?: Editor): boolean;
}

/**
 * Open a modal to add a caption to a table. Tries source editing for markdown
 * tables first; falls back to DOM manipulation.
 */
export function addCaption(
	tableEl: HTMLTableElement | undefined,
	editor: Editor | undefined,
	app: App,
	t: Locale,
	cellEditor: CellEditor,
	callbacks: CaptionCallbacks,
): void {
	const existingCaption = tableEl?.querySelector('caption');
	if (existingCaption) {
		new Notice(t.tableAlreadyHasCaption);
		return;
	}

	const modal = new CaptionModal(app, t, (caption) => {
		if (!caption) return;

		if (editor) {
			const sourceText = editor.getValue();
			const lines = sourceText.split('\n');
			const range = findTableNearEditorSelection(editor) ?? (tableEl ? findTableInSource(lines, tableEl) : null);
			if (range && range.kind === 'markdown') {
				editor.replaceRange(
					`[${caption}]\n\n`,
					{ line: range.start, ch: 0 },
					{ line: range.start, ch: 0 }
				);
				new Notice(t.captionAdded);
				return;
			}
		}

		if (tableEl) {
			const captionEl = tableEl.createEl('caption');
			captionEl.textContent = caption;
			cellEditor.addCaptionInteractionHandlers(tableEl);
			callbacks.persistTableChanges(tableEl, editor);
			new Notice(t.captionAdded);
		}
	});
	modal.open();
}
