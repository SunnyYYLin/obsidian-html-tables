import { TableData } from './types';

/**
 * Serialize a rendered HTMLTableElement to a clean HTML string.
 * Strips plugin-injected artifacts (resize handles, selection classes, cache attributes, hidden merge cells).
 */
export function serializeTableToHtml(tableEl: HTMLTableElement): string {
	const clone = tableEl.cloneNode(true) as HTMLTableElement;

	clone.querySelectorAll('th, td').forEach(cell => {
		const htmlCell = cell as HTMLElement;
		const raw = htmlCell.getAttribute('data-better-raw');
		if (raw !== null) {
			htmlCell.empty();
			htmlCell.textContent = raw;
		}
		htmlCell.removeAttribute('data-better-raw');
	});

	// Remove resize handle divs
	clone.querySelectorAll('.column-resize-handle').forEach(el => el.remove());

	// Remove hidden merged cells (in proper HTML, spanned positions have no cell)
	clone.querySelectorAll('.merged-cell-hidden').forEach(el => el.remove());

	// Strip plugin-specific classes
	clone.classList.remove('better-table', 'resizing');
	clone.querySelectorAll('.cell-selected').forEach(el => el.classList.remove('cell-selected'));

	// Strip plugin-specific attributes
	clone.removeAttribute('data-table-cache-key');
	clone.querySelectorAll('[data-table-cache-key]').forEach(el => el.removeAttribute('data-table-cache-key'));
	clone.querySelectorAll('[data-merged]').forEach(el => el.removeAttribute('data-merged'));

	// Keep user-facing width/alignment styles, but remove empty style attributes.
	clone.querySelectorAll('th, td').forEach(cell => {
		const htmlCell = cell as HTMLElement;
		if (!htmlCell.getAttribute('style') || htmlCell.getAttribute('style') === '') {
			htmlCell.removeAttribute('style');
		}
	});

	// Remove empty class attributes
	if (!clone.getAttribute('class') || clone.getAttribute('class') === '') {
		clone.removeAttribute('class');
	}
	clone.querySelectorAll('[class=""]').forEach(el => el.removeAttribute('class'));

	return prettyPrintHtml(clone.outerHTML);
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

	trEls.forEach((tr, rowIndex) => {
		const cells = tr.querySelectorAll('td, th');
		const row: string[] = [];
		cells.forEach((cell, colIndex) => {
			row.push(cell.textContent?.trim() ?? '');
			if (cell.tagName === 'TH') {
				if (rowIndex === 0) hasHeaderRow = true;
				if (colIndex === 0) hasHeaderColumn = true;
			}
		});
		if (row.length > 0) rows.push(row);
	});

	if (rows.length === 0) return null;

	return { rows, hasHeaderRow, hasHeaderColumn, caption };
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
