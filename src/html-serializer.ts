import { TableData } from './types';

/**
 * Serialize a rendered HTMLTableElement to a clean HTML string.
 * Strips plugin-injected artifacts (resize handles, selection classes, cache attributes, hidden merge cells).
 */
export function serializeTableToHtml(tableEl: HTMLTableElement): string {
	const cleanTable = activeDocument.createElement('table');
	copyTableAttributes(tableEl, cleanTable);
	const caption = tableEl.querySelector(':scope > caption');
	if (caption?.textContent?.trim()) {
		const cleanCaption = cleanTable.createEl('caption');
		cleanCaption.textContent = caption.textContent.trim();
	}

	const sectionSelector = ':scope > thead, :scope > tbody, :scope > tfoot';
	const sections = Array.from(tableEl.querySelectorAll<HTMLElement>(sectionSelector));
	if (sections.length > 0) {
		sections.forEach(section => {
			const cleanSection = activeDocument.createElement(section.tagName.toLowerCase());
			cleanTable.appendChild(cleanSection);
			copyRows(section, cleanSection);
			if (!cleanSection.hasChildNodes()) cleanSection.remove();
		});
	} else {
		copyRows(tableEl, cleanTable);
	}

	return prettyPrintHtml(cleanTable.outerHTML);
}

function copyTableAttributes(source: HTMLTableElement, target: HTMLTableElement): void {
	const width = source.style.width || '';
	const styles: string[] = [];
	if (width) styles.push(`width: ${width}`);
	if (styles.length > 0) target.setAttribute('style', styles.join('; '));
}

/**
 * Parse an HTML string into a TableData object.
 * Discards rowspan/colspan — only used for "Convert to Markdown".
 */
export function parseHtmlToTableData(html: string): TableData | null {
	const parser = new DOMParser();
	const doc = parser.parseFromString(html, 'text/html');
	const table = doc.querySelector('table');
	if (!table) return null;

	// Extract caption
	const captionEl = table.querySelector('caption');
	const caption = captionEl?.textContent?.trim() || undefined;

	// Extract rows
	const trEls = table.querySelectorAll('tr');
	if (trEls.length === 0) return null;

	const rows: string[][] = [];
	let hasHeaderRow = false;
	let hasHeaderColumn = false;

	const rowSpanPlaceholders = new Map<number, number>();

	trEls.forEach((tr, rowIndex) => {
		const row: string[] = [];
		let colIndex = 0;

		const fillSpannedColumns = () => {
			while ((rowSpanPlaceholders.get(colIndex) ?? 0) > 0) {
				row[colIndex] = '';
				rowSpanPlaceholders.set(colIndex, (rowSpanPlaceholders.get(colIndex) ?? 0) - 1);
				colIndex++;
			}
		};

		Array.from(tr.querySelectorAll('td, th')).forEach((cell) => {
			fillSpannedColumns();

			const rowSpan = Math.max(1, parseInt(cell.getAttribute('rowspan') || '1'));
			const colSpan = Math.max(1, parseInt(cell.getAttribute('colspan') || '1'));

			row[colIndex] = cell.textContent?.trim() ?? '';
			if (cell.tagName === 'TH') {
				if (rowIndex === 0) hasHeaderRow = true;
				if (colIndex === 0) hasHeaderColumn = true;
			}

			for (let offset = 1; offset < colSpan; offset++) {
				row[colIndex + offset] = '';
			}

			if (rowSpan > 1) {
				for (let offset = 0; offset < colSpan; offset++) {
					rowSpanPlaceholders.set(colIndex + offset, rowSpan - 1);
				}
			}

			colIndex += colSpan;
		});

		fillSpannedColumns();
		if (row.length > 0) rows.push(row);
	});

	if (rows.length === 0) return null;
	const maxColumns = Math.max(...rows.map(row => row.length));
	rows.forEach(row => {
		while (row.length < maxColumns) row.push('');
	});

	return { rows, hasHeaderRow, hasHeaderColumn, caption };
}

export function tableDataToHtml(table: TableData): string {
	const tableEl = activeDocument.createElement('table');

	if (table.caption) {
		const captionEl = tableEl.createEl('caption');
		captionEl.textContent = table.caption;
	}

	const tbody = tableEl.createEl('tbody');
	table.rows.forEach((row, rowIndex) => {
		const tr = tbody.createEl('tr');
		row.forEach((cell, colIndex) => {
			const isHeader = (table.hasHeaderRow && rowIndex === 0) || (table.hasHeaderColumn && colIndex === 0);
			const cellEl = tr.createEl(isHeader ? 'th' : 'td');
			cellEl.textContent = cell;
		});
	});

	return prettyPrintHtml(tableEl.outerHTML);
}

function copyRows(source: Element, target: HTMLElement): void {
	const rows = Array.from(source.querySelectorAll<HTMLTableRowElement>(':scope > tr'));
	rows.forEach(row => {
		const cleanRow = target.createEl('tr');
		Array.from(row.children).forEach(child => {
			if (!child.instanceOf(HTMLTableCellElement)) return;
			if (child.hasClass('merged-cell-hidden') || child.getAttribute('data-merged') === 'true') return;

			const cleanCell = activeDocument.createElement(child.tagName.toLowerCase());
			copyCellAttributes(child, cleanCell);
			cleanCell.textContent = getTableCellText(child);
			cleanRow.appendChild(cleanCell);
		});
		if (!cleanRow.hasChildNodes()) cleanRow.remove();
	});
}

function copyCellAttributes(source: HTMLTableCellElement, target: HTMLElement): void {
	const rowspan = source.getAttribute('rowspan');
	const colspan = source.getAttribute('colspan');
	if (rowspan && rowspan !== '1') target.setAttribute('rowspan', rowspan);
	if (colspan && colspan !== '1') target.setAttribute('colspan', colspan);

	const textAlign = source.style.textAlign || source.getAttribute('align') || '';
	const verticalAlign = source.style.verticalAlign || '';
	const width = source.style.width || '';
	const styles: string[] = [];
	if (textAlign) styles.push(`text-align: ${textAlign}`);
	if (verticalAlign) styles.push(`vertical-align: ${verticalAlign}`);
	if (width) styles.push(`width: ${width}`);
	if (styles.length > 0) target.setAttribute('style', styles.join('; '));
}

export function getTableCellText(cell: HTMLTableCellElement): string {
	const raw = cell.getAttribute('data-better-raw');
	if (raw !== null) return raw;

	const wrappers = Array.from(cell.querySelectorAll<HTMLElement>(':scope > .table-cell-wrapper'))
		.filter(wrapper =>
			wrapper.getAttribute('data-ignore-swipe') !== 'true' &&
			wrapper.style.display !== 'none' &&
			!wrapper.querySelector('.cm-editor')
		);
	const wrapper = wrappers[0];
	if (wrapper) return wrapper.textContent?.trim() ?? '';

	const clone = cell.cloneNode(true) as HTMLElement;
	clone.querySelectorAll(
		'.column-resize-handle, .table-col-drag-handle, .table-row-drag-handle, [data-ignore-swipe="true"], .cm-editor'
	).forEach(el => el.remove());
	return clone.textContent?.trim() ?? '';
}

/**
 * Check if section text represents an HTML table (vs Markdown table).
 */
export function isHtmlInSection(sectionText: string): boolean {
	return sectionText.trim().toLowerCase().startsWith('<table');
}

/**
 * Pretty-print HTML with 2-space indentation.
 */
function prettyPrintHtml(html: string): string {
	let result = '';
	let indent = 0;
	const tab = '  ';

	// Split on tags while keeping them
	const tokens = html.replace(/>\s*</g, '>\n<').split('\n');

	for (const token of tokens) {
		const trimmed = token.trim();
		if (!trimmed) continue;

		// Closing tag
		if (trimmed.startsWith('</')) {
			indent = Math.max(0, indent - 1);
			result += tab.repeat(indent) + trimmed + '\n';
		}
		// Self-closing tag
		else if (trimmed.endsWith('/>')) {
			result += tab.repeat(indent) + trimmed + '\n';
		}
		// Complete inline element, e.g. <td>value</td>. Do not change nesting.
		else if (isInlineCompleteElement(trimmed)) {
			result += tab.repeat(indent) + trimmed + '\n';
		}
		// Opening tag (but not void elements like <br>, <img>, etc.)
		else if (trimmed.startsWith('<') && !trimmed.startsWith('</') && !isVoidElement(trimmed)) {
			result += tab.repeat(indent) + trimmed + '\n';
			indent++;
		}
		// Text content or void element
		else {
			result += tab.repeat(indent) + trimmed + '\n';
		}
	}

	return result.trimEnd();
}

function isVoidElement(tag: string): boolean {
	const voidTags = ['<br', '<hr', '<img', '<input', '<meta', '<link'];
	return voidTags.some(v => tag.toLowerCase().startsWith(v));
}

function isInlineCompleteElement(token: string): boolean {
	const match = token.match(/^<([a-z][\w:-]*)(?:\s[^>]*)?>.*<\/\1>$/i);
	return match !== null;
}
