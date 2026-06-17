import { getLanguage } from 'obsidian';

export interface Locale {
	// Context menu
	mergeCells: string;
	unmergeCells: string;
	toggleHeaderRow: string;
	toggleHeaderColumn: string;
	addCaption: string;
	autoFitColumns: string;
	equalColumnWidth: string;

	// Notices
	selectAtLeast2Cells: string;
	clickMergedCellToUnmerge: string;
	cellNotMerged: string;
	cellsMerged: string;
	cellsUnmerged: string;
	headerRowAdded: string;
	headerRowRemoved: string;
	headerColumnToggled: string;
	tableAlreadyHasCaption: string;
	captionAdded: string;
	useRightClickMenu: string;

	// Caption modal
	enterTableCaption: string;
	tableCaption: string;
	cancel: string;
	addCaptionButton: string;

	// Settings
	featuresHeading: string;
	enableAdvancedTables: string;
	enableAdvancedTablesDesc: string;
	enableHeaderRow: string;
	enableHeaderRowDesc: string;
	enableHeaderColumn: string;
	enableHeaderColumnDesc: string;
	enableCellMerging: string;
	enableCellMergingDesc: string;
	enableFormula: string;
	enableFormulaDesc: string;
	enableNewline: string;
	enableNewlineDesc: string;
	enableCaption: string;
	enableCaptionDesc: string;
	defaultHorizontalAlignment: string;
	defaultHorizontalAlignmentDesc: string;
	defaultVerticalAlignment: string;
	defaultVerticalAlignmentDesc: string;

	// Alignment options
	left: string;
	center: string;
	right: string;
	top: string;
	middle: string;
	bottom: string;
}

export const locales: Record<string, Locale> = {
	en: {
		// Context menu
		mergeCells: 'Merge cells',
		unmergeCells: 'Unmerge cells',
		toggleHeaderRow: 'Toggle header row',
		toggleHeaderColumn: 'Toggle header column',
		addCaption: 'Add caption',
		autoFitColumns: 'Auto-fit columns',
		equalColumnWidth: 'Equal column width',

		// Notices
		selectAtLeast2Cells: 'Select at least 2 cells to merge',
		clickMergedCellToUnmerge: 'Click on a merged cell to unmerge',
		cellNotMerged: 'Cell is not merged',
		cellsMerged: 'Cells merged',
		cellsUnmerged: 'Cells unmerged',
		headerRowAdded: 'Header row added',
		headerRowRemoved: 'Header row removed',
		headerColumnToggled: 'Header column toggled',
		tableAlreadyHasCaption: 'Table already has a caption',
		captionAdded: 'Caption added',
		useRightClickMenu: 'Use right-click menu on table',

		// Caption modal
		enterTableCaption: 'Enter table caption',
		tableCaption: 'Table caption',
		cancel: 'Cancel',
		addCaptionButton: 'Add caption',

		// Settings
		featuresHeading: 'Features',
		enableAdvancedTables: 'Enable advanced tables',
		enableAdvancedTablesDesc: 'Enable advanced table features in preview mode',
		enableHeaderRow: 'Enable header row',
		enableHeaderRowDesc: 'Automatically format the first row as a header',
		enableHeaderColumn: 'Enable header column',
		enableHeaderColumnDesc: 'Automatically format the first column as a header',
		enableCellMerging: 'Enable cell merging',
		enableCellMergingDesc: 'Allow merging cells in tables',
		enableFormula: 'Enable formula support',
		enableFormulaDesc: 'Support formulas in table cells (starting with =)',
		enableNewline: 'Enable newline in cells',
		enableNewlineDesc: 'Support newlines in table cells using \\n',
		enableCaption: 'Enable table caption',
		enableCaptionDesc: 'Support table captions above the table',
		defaultHorizontalAlignment: 'Default horizontal alignment',
		defaultHorizontalAlignmentDesc: 'Default horizontal alignment for table cells',
		defaultVerticalAlignment: 'Default vertical alignment',
		defaultVerticalAlignmentDesc: 'Default vertical alignment for table cells',

		// Alignment options
		left: 'Left',
		center: 'Center',
		right: 'Right',
		top: 'Top',
		middle: 'Middle',
		bottom: 'Bottom',
	},

	zh: {
		// Context menu
		mergeCells: '合并单元格',
		unmergeCells: '取消合并',
		toggleHeaderRow: '切换标题行',
		toggleHeaderColumn: '切换标题列',
		addCaption: '添加表标题',
		autoFitColumns: '自适应列宽',
		equalColumnWidth: '均分列宽',

		// Notices
		selectAtLeast2Cells: '请先选择至少2个单元格',
		clickMergedCellToUnmerge: '请点击已合并的单元格以取消合并',
		cellNotMerged: '该单元格未合并',
		cellsMerged: '单元格已合并',
		cellsUnmerged: '已取消合并',
		headerRowAdded: '已添加标题行',
		headerRowRemoved: '已移除标题行',
		headerColumnToggled: '已切换标题列',
		tableAlreadyHasCaption: '表格已有标题',
		captionAdded: '已添加标题',
		useRightClickMenu: '请在表格上使用右键菜单',

		// Caption modal
		enterTableCaption: '输入表标题',
		tableCaption: '表标题',
		cancel: '取消',
		addCaptionButton: '添加标题',

		// Settings
		featuresHeading: '功能',
		enableAdvancedTables: '启用高级表格',
		enableAdvancedTablesDesc: '在预览模式下启用高级表格功能',
		enableHeaderRow: '启用标题行',
		enableHeaderRowDesc: '自动将第一行格式化为标题行',
		enableHeaderColumn: '启用标题列',
		enableHeaderColumnDesc: '自动将第一列格式化为标题列',
		enableCellMerging: '启用单元格合并',
		enableCellMergingDesc: '允许合并表格中的单元格',
		enableFormula: '启用公式支持',
		enableFormulaDesc: '支持表格单元格中的公式（以 = 开头）',
		enableNewline: '启用单元格换行',
		enableNewlineDesc: '支持在单元格中使用 \\n 换行',
		enableCaption: '启用表标题',
		enableCaptionDesc: '支持在表格上方显示标题',
		defaultHorizontalAlignment: '默认水平对齐',
		defaultHorizontalAlignmentDesc: '表格单元格的默认水平对齐方式',
		defaultVerticalAlignment: '默认垂直对齐',
		defaultVerticalAlignmentDesc: '表格单元格的默认垂直对齐方式',

		// Alignment options
		left: '左对齐',
		center: '居中',
		right: '右对齐',
		top: '顶部',
		middle: '居中',
		bottom: '底部',
	},
};

export function getLocale(lang?: string): Locale {
	// Auto-detect language if not specified
	if (!lang) {
		const appLang = getLanguage();
		lang = appLang.startsWith('zh') ? 'zh' : 'en';
	}
	return locales[lang] || locales.en!;
}
