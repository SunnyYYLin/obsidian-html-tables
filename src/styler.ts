export class TableStyler {

	static setColumnWidth(tableEl: HTMLTableElement, colIndex: number, width: number): void {
		const rows = tableEl.querySelectorAll('tr');
		rows.forEach(row => {
			const cells = row.querySelectorAll('td, th');
			if (colIndex < cells.length) {
				(cells[colIndex] as HTMLElement).style.setProperty('width', `${width}px`);
			}
		});
	}

	static autoFitColumn(tableEl: HTMLTableElement, colIndex: number): void {
		const rows = tableEl.querySelectorAll('tr');
		let maxWidth = 0;

		// Calculate the smallest width that keeps every cell in the column on one line.
		rows.forEach(row => {
			const cells = row.querySelectorAll('td, th');
			if (colIndex < cells.length) {
				const cell = cells[colIndex] as HTMLElement;
				const width = TableStyler.getNoWrapCellWidth(cell);
				if (width > maxWidth) {
					maxWidth = width;
				}
			}
		});

		// Apply the max width
		if (maxWidth > 0) {
			TableStyler.setColumnWidth(tableEl, colIndex, maxWidth);
		}
	}

	static autoFitColumns(tableEl: HTMLTableElement): void {
		const rows = tableEl.querySelectorAll('tr');
		const firstRow = rows[0];
		const colCount = firstRow?.querySelectorAll('td, th').length || 0;

		// Calculate the smallest widths that keep text in each column on one line.
		const maxWidths = new Array<number>(colCount).fill(0);
		rows.forEach(row => {
			const cells = row.querySelectorAll('td, th');
			cells.forEach((cell, index) => {
				const width = TableStyler.getNoWrapCellWidth(cell as HTMLElement);
				const maxWidth = maxWidths[index];
				if (maxWidth !== undefined && width > maxWidth) {
					maxWidths[index] = width;
				}
			});
		});

		// Apply widths
		rows.forEach(row => {
			const cells = row.querySelectorAll('td, th');
			cells.forEach((cell, index) => {
				const maxWidth = maxWidths[index];
				if (maxWidth !== undefined) {
					(cell as HTMLElement).style.setProperty('width', `${maxWidth}px`);
				}
			});
		});
	}

	static equalizeColumns(tableEl: HTMLTableElement): void {
		const rows = tableEl.querySelectorAll('tr');
		const colCount = rows[0]?.querySelectorAll('td, th').length || 0;
		const tableWidth = tableEl.offsetWidth;
		const equalWidth = tableWidth / colCount;

		rows.forEach(row => {
			const cells = row.querySelectorAll('td, th');
			cells.forEach(cell => {
				(cell as HTMLElement).style.setProperty('width', `${equalWidth}px`);
			});
		});
	}

	private static getNoWrapCellWidth(cell: HTMLElement): number {
		const styles = activeWindow.getComputedStyle(cell);
		const canvas = activeDocument.createElement('canvas');
		const context = canvas.getContext('2d');
		if (!context) return Math.max(50, cell.scrollWidth);
		context.font = styles.font;
		const text = cell.textContent?.trim() ?? '';
		const padding = parseFloat(styles.paddingLeft)
			+ parseFloat(styles.paddingRight)
			+ parseFloat(styles.borderLeftWidth)
			+ parseFloat(styles.borderRightWidth);
		const letterSpacing = parseFloat(styles.letterSpacing);
		const spacing = Number.isFinite(letterSpacing) ? Math.max(0, text.length - 1) * letterSpacing : 0;
		const width = Math.ceil(context.measureText(text).width + spacing + padding + 2);
		return Math.max(50, width);
	}
}
