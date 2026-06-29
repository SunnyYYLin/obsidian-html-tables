export interface TableData {
	rows: string[][];
	hasHeaderRow: boolean;
	hasHeaderColumn: boolean;
	caption?: string;
}

export interface CellPosition {
	row: number;
	col: number;
}

export interface CellMerge {
	start: CellPosition;
	end: CellPosition;
}