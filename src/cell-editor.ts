/**
 * In-place cell and caption editing, plus Markdown/formula preview rendering.
 * Extracted from TableEnhancer to isolate the "what goes inside a cell" concerns.
 */
import { App, Component, MarkdownRenderer } from 'obsidian';
import type { BetterTablesSettings } from './settings';
import { evaluateFormula } from './formula';

/** Dependencies injected from TableEnhancer (avoids direct plugin coupling). */
export interface CellEditorDeps {
	readonly app: App;
	readonly getSettings: () => BetterTablesSettings;
	readonly addChild: <T extends Component>(c: T) => T;
	readonly removeChild: <T extends Component>(c: T) => T;
	readonly getSourcePath: (tableEl: HTMLTableElement) => string;
	readonly onPersist: (tableEl: HTMLTableElement) => void;
}

/**
 * Manages per-cell Component lifecycle (for Markdown rendering) and
 * provides editing + preview helpers.
 *
 * One instance per plugin load; WeakMap keys ensure no memory leaks.
 */
export class CellEditor {
	private renderedComponents = new WeakMap<HTMLElement, Component>();

	constructor(private deps: CellEditorDeps) {}

	// ---- Caption wiring ----

	/** Attach double-click handler to a table's <caption> (idempotent). */
	addCaptionInteractionHandlers(tableEl: HTMLTableElement): void {
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

	// ---- In-place editing ----

	/** Enter inline-edit mode for a cell (double-click). */
	editCellText(tableEl: HTMLTableElement, cellEl: HTMLElement): void {
		if (cellEl.hasClass('better-table-cell-editing')) return;
		const originalText = (cellEl.getAttribute('data-better-raw') ?? cellEl.textContent ?? '').trim();
		cellEl.empty();
		if (originalText) cellEl.textContent = originalText;
		cellEl.addClass('better-table-cell-editing');
		cellEl.setAttribute('contenteditable', 'true');
		cellEl.focus();

		placeCursorAtEnd(cellEl);

		const finish = (commit: boolean) => {
			cellEl.removeEventListener('blur', onBlur);
			cellEl.removeEventListener('keydown', onKeyDown);
			cellEl.removeClass('better-table-cell-editing');
			cellEl.removeAttribute('contenteditable');
			if (!commit) {
				cellEl.textContent = originalText;
				return;
			}
			const nextText = cellEl.textContent?.trim() ?? '';
			if (nextText) {
				cellEl.setAttribute('data-better-raw', nextText);
			} else {
				cellEl.removeAttribute('data-better-raw');
				cellEl.empty();
			}
			this.deps.onPersist(tableEl);
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

	/** Enter inline-edit mode for a caption element. */
	editCaptionText(tableEl: HTMLTableElement, captionEl: HTMLElement): void {
		if (captionEl.hasClass('better-table-caption-editing')) return;
		const originalText = captionEl.textContent ?? '';
		captionEl.addClass('better-table-caption-editing');
		captionEl.setAttribute('contenteditable', 'true');
		captionEl.focus();

		placeCursorAtEnd(captionEl);

		const finish = (commit: boolean) => {
			captionEl.removeEventListener('blur', onBlur);
			captionEl.removeEventListener('keydown', onKeyDown);
			captionEl.removeClass('better-table-caption-editing');
			captionEl.removeAttribute('contenteditable');
			if (!commit) {
				captionEl.textContent = originalText;
				return;
			}
			this.deps.onPersist(tableEl);
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

	// ---- Cell preview / Markdown rendering ----

	/** Re-render all cells in a table (called once on initial enhancement). */
	enhanceRenderedContent(tableEl: HTMLTableElement): void {
		tableEl.querySelectorAll('td, th').forEach((cell) => {
			this.renderCellPreview(tableEl, cell as HTMLElement);
		});
	}

	/** Render a single cell's preview (formula, newline, Markdown, or plain text). */
	renderCellPreview(tableEl: HTMLTableElement, cellEl: HTMLElement): void {
		if (cellEl.hasClass('better-table-cell-editing')) return;

		const raw = (cellEl.getAttribute('data-better-raw') ?? cellEl.textContent ?? '').trim();
		// Preserve resize handles that are children of the cell
		const preserved = Array.from(cellEl.children).filter(c =>
			c.hasClass('column-resize-handle'),
		);

		this.unloadRenderedCell(cellEl);
		cellEl.removeClass('formula-result', 'formula-error', 'formula-cell');

		if (!raw) {
			cellEl.removeAttribute('data-better-raw');
			cellEl.empty();
			preserved.forEach(c => cellEl.appendChild(c));
			return;
		}

		const settings = this.deps.getSettings();

		if (settings.enableFormula && raw.startsWith('=')) {
			cellEl.setAttribute('data-better-raw', raw);
			const result = evaluateFormula(raw);
			cellEl.empty();
			cellEl.textContent = result === null ? raw : result.toString();
			cellEl.toggleClass('formula-result', result !== null);
			cellEl.toggleClass('formula-error', result === null);
			cellEl.addClass('formula-cell');
			preserved.forEach(c => cellEl.appendChild(c));
			return;
		}

		if (settings.enableNewline && raw.includes('\\n')) {
			cellEl.setAttribute('data-better-raw', raw);
			cellEl.empty();
			raw.split('\\n').forEach((line, index) => {
				if (index > 0) cellEl.createEl('br');
				cellEl.appendText(line);
			});
			preserved.forEach(c => cellEl.appendChild(c));
			return;
		}

		if (this.shouldRenderMarkdown(raw)) {
			cellEl.setAttribute('data-better-raw', raw);
			cellEl.empty();
			const sourcePath = this.deps.getSourcePath(tableEl);
			const component = new Component();
			this.deps.addChild(component);
			this.renderedComponents.set(cellEl, component);
			void MarkdownRenderer.render(this.deps.app, raw, cellEl, sourcePath, component).finally(() => {
				preserved.forEach(c => cellEl.appendChild(c));
				cellEl.addClass('better-table-markdown-cell');
			});
		}
	}

	/** Unload the Markdown Component attached to a cell, if any. */
	unloadRenderedCell(cellEl: HTMLElement): void {
		const component = this.renderedComponents.get(cellEl);
		if (!component) return;
		component.unload();
		this.deps.removeChild(component);
		this.renderedComponents.delete(cellEl);
	}

	// ---- Private helpers ----

	private shouldRenderMarkdown(raw: string): boolean {
		return /(```|`[^`]+`|\$\$?[^$]+\$\$?|\\\(|\\\[|\*\*|__|(?<!\])\[(?!\^)[^\]]+\]\(|!\[[^\]]*\]\(|^#{1,6}\s|^\s*[-*+]\s)/m.test(
			raw.trim(),
		);
	}
}

// ---- DOM helper ----

function placeCursorAtEnd(el: HTMLElement): void {
	const selection = activeWindow.getSelection();
	const range = activeDocument.createRange();
	range.selectNodeContents(el);
	range.collapse(false);
	selection?.removeAllRanges();
	selection?.addRange(range);
}
