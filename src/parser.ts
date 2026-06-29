import { TableData } from './types';

export function parseMarkdownTable(content: string): TableData | null {
	const lines = content.trim().split('\n');
	if (lines.length < 2) return null;

	const rows: string[][] = [];
	let hasHeaderRow = false;
	let hasHeaderColumn = false;
	let caption: string | undefined;

	// Check for caption ([caption] format)
	let startIndex = 0;
	const firstLine = lines[0];
	const parsedCaption = firstLine ? parseCaptionLine(firstLine) : null;
	if (parsedCaption !== null) {
		caption = parsedCaption;
		startIndex = 1;
		
		// Skip empty lines after caption
		while (startIndex < lines.length && lines[startIndex]?.trim() === '') {
			startIndex++;
		}
	}

	// Parse header row
	const headerLine = lines[startIndex];
	if (!headerLine) return null;
	
	const headerCells = parseTableRow(headerLine);
	if (headerCells.length === 0) return null;

	rows.push(headerCells);

	// Check for separator row
	const separatorIndex = startIndex + 1;
	const separatorLine = lines[separatorIndex];
	if (lines.length > separatorIndex && separatorLine && isMarkdownSeparator(separatorLine)) {
		hasHeaderRow = true;
		// Check if separator indicates header column
		if (separatorLine.includes(':')) {
			hasHeaderColumn = true;
		}
	}

	// Parse data rows
	const dataStartIndex = hasHeaderRow ? separatorIndex + 1 : separatorIndex;
	for (let i = dataStartIndex; i < lines.length; i++) {
		const line = lines[i];
		if (line) {
			const cells = parseTableRow(line);
			if (cells.length > 0) {
				rows.push(cells);
			}
		}
	}

	return {
		rows,
		hasHeaderRow,
		hasHeaderColumn,
		caption,
	};
}

function parseTableRow(line: string): string[] {
	const trimmed = line.trim();
	if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) {
		return [];
	}

	const cells = trimmed.slice(1, -1).split('|').map(cell => cell.trim());
	return cells;
}

export function isMarkdownSeparator(line: string): boolean {
	const trimmed = line.trim();
	if (!trimmed.startsWith('|')) return false;
	const cells = trimmed.split('|').filter(c => c.trim() !== '');
	return cells.length > 0 && cells.every(c => /^:?-+:?$/.test(c.trim()));
}

function parseCaptionLine(line: string): string | null {
	const trimmed = line.trim();
	const bracketMatch = trimmed.match(/^\[(.+)]$/);
	if (bracketMatch) return bracketMatch[1]!.trim();
	return null;
}

export function markdownTableToString(table: TableData): string {
	const lines: string[] = [];

	// Add caption if present
	if (table.caption) {
		lines.push(`[${table.caption}]`);
		lines.push('');
	}

	// Add header row
	const firstRow = table.rows[0];
	if (firstRow) {
		lines.push(formatMarkdownTableRow(firstRow));
	}

	// Add separator row
	if (table.hasHeaderRow && firstRow) {
		const separator = firstRow.map(() => {
			if (table.hasHeaderColumn) {
				return ':---:';
			}
			return '---';
		});
		lines.push(formatMarkdownTableRow(separator));
	}

	// Add data rows
	const startIndex = table.hasHeaderRow ? 1 : 0;
	for (let i = startIndex; i < table.rows.length; i++) {
		const row = table.rows[i];
		if (row) {
			lines.push(formatMarkdownTableRow(row));
		}
	}

	return lines.join('\n');
}

function formatMarkdownTableRow(row: string[]): string {
	return `|${row.map(formatMarkdownTableCell).join('|')}|`;
}

function formatMarkdownTableCell(cell: string): string {
	const trimmed = cell.trim();
	return trimmed === '' ? '' : ` ${trimmed} `;
}
