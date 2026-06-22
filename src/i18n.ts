import { getLanguage } from 'obsidian';

export interface Locale {
	mergeCells: string;
	unmergeCells: string;
	toggleHeaderRow: string;
	toggleHeaderColumn: string;
	addCaption: string;
	columnWidth: string;
	alignment: string;
	autoFitColumns: string;
	equalColumnWidth: string;
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
	enterTableCaption: string;
	tableCaption: string;
	cancel: string;
	addCaptionButton: string;
	convertToHtml: string;
	convertToMarkdown: string;
	tableConvertedToHtml: string;
	tableConvertedToMarkdown: string;
	convertToHtmlForPersistence: string;
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
	left: string;
	center: string;
	right: string;
	top: string;
	middle: string;
	bottom: string;
}

export const locales: Record<string, Locale> = {
	en: {
		mergeCells: 'Merge cells',
		unmergeCells: 'Unmerge cells',
		toggleHeaderRow: 'Toggle header row',
		toggleHeaderColumn: 'Toggle header column',
		addCaption: 'Add caption',
		columnWidth: 'Column width',
		alignment: 'Align',
		autoFitColumns: 'Auto-fit columns',
		equalColumnWidth: 'Equal column width',
		selectAtLeast2Cells: 'Select at least 2 cells to merge',
		clickMergedCellToUnmerge: 'Select a merged cell to unmerge',
		cellNotMerged: 'Cell is not merged',
		cellsMerged: 'Cells merged',
		cellsUnmerged: 'Cells unmerged',
		headerRowAdded: 'Header row added',
		headerRowRemoved: 'Header row removed',
		headerColumnToggled: 'Header column toggled',
		tableAlreadyHasCaption: 'Table already has a caption',
		captionAdded: 'Caption added',
		useRightClickMenu: 'Use the table right-click menu',
		enterTableCaption: 'Enter table caption',
		tableCaption: 'Table caption',
		cancel: 'Cancel',
		addCaptionButton: 'Add caption',
		convertToHtml: 'Convert to HTML',
		convertToMarkdown: 'Convert to Markdown',
		tableConvertedToHtml: 'Table converted to HTML',
		tableConvertedToMarkdown: 'Table converted to Markdown; advanced formatting was removed',
		convertToHtmlForPersistence: 'Convert to HTML to save advanced changes',
		featuresHeading: 'Features',
		enableAdvancedTables: 'Enable advanced tables',
		enableAdvancedTablesDesc: 'Enable advanced table features in preview mode',
		enableHeaderRow: 'Enable header row',
		enableHeaderRowDesc: 'Allow toggling the first row as a header',
		enableHeaderColumn: 'Enable header column',
		enableHeaderColumnDesc: 'Allow toggling the first column as a header',
		enableCellMerging: 'Enable cell merging',
		enableCellMergingDesc: 'Allow merging cells in tables',
		enableFormula: 'Enable formulas',
		enableFormulaDesc: 'Evaluate simple formulas in table cells that start with =',
		enableNewline: 'Enable newlines in cells',
		enableNewlineDesc: 'Render \\n as line breaks inside table cells',
		enableCaption: 'Enable table captions',
		enableCaptionDesc: 'Support captions centered above tables',
		defaultHorizontalAlignment: 'Default horizontal alignment',
		defaultHorizontalAlignmentDesc: 'Default horizontal alignment for table cells',
		defaultVerticalAlignment: 'Default vertical alignment',
		defaultVerticalAlignmentDesc: 'Default vertical alignment for table cells',
		left: 'Left',
		center: 'Center',
		right: 'Right',
		top: 'Top',
		middle: 'Middle',
		bottom: 'Bottom',
	},
	zh: {
		mergeCells: '合并单元格',
		unmergeCells: '取消合并',
		toggleHeaderRow: '切换标题行',
		toggleHeaderColumn: '切换标题列',
		addCaption: '添加表标题',
		columnWidth: '列宽',
		alignment: '对齐',
		autoFitColumns: '自适应列宽',
		equalColumnWidth: '均分列宽',
		selectAtLeast2Cells: '请先选择至少 2 个单元格',
		clickMergedCellToUnmerge: '请选择已合并的单元格以取消合并',
		cellNotMerged: '该单元格未合并',
		cellsMerged: '单元格已合并',
		cellsUnmerged: '已取消合并',
		headerRowAdded: '已添加标题行',
		headerRowRemoved: '已移除标题行',
		headerColumnToggled: '已切换标题列',
		tableAlreadyHasCaption: '表格已有标题',
		captionAdded: '已添加表标题',
		useRightClickMenu: '请在表格上使用右键菜单',
		enterTableCaption: '输入表标题',
		tableCaption: '表标题',
		cancel: '取消',
		addCaptionButton: '添加标题',
		convertToHtml: '转换为 HTML',
		convertToMarkdown: '转换为 Markdown',
		tableConvertedToHtml: '表格已转换为 HTML',
		tableConvertedToMarkdown: '表格已转换为 Markdown；高级格式已移除',
		convertToHtmlForPersistence: '请转换为 HTML 以保存高级修改',
		featuresHeading: '功能',
		enableAdvancedTables: '启用高级表格',
		enableAdvancedTablesDesc: '在预览模式启用高级表格功能',
		enableHeaderRow: '启用标题行',
		enableHeaderRowDesc: '允许将第一行切换为标题行',
		enableHeaderColumn: '启用标题列',
		enableHeaderColumnDesc: '允许将第一列切换为标题列',
		enableCellMerging: '启用单元格合并',
		enableCellMergingDesc: '允许合并表格中的单元格',
		enableFormula: '启用公式',
		enableFormulaDesc: '计算以 = 开头的简单表格公式',
		enableNewline: '启用单元格换行',
		enableNewlineDesc: '将单元格中的 \\n 渲染为换行',
		enableCaption: '启用表标题',
		enableCaptionDesc: '支持在表格正上方居中显示标题',
		defaultHorizontalAlignment: '默认横向对齐',
		defaultHorizontalAlignmentDesc: '表格单元格的默认横向对齐方式',
		defaultVerticalAlignment: '默认纵向对齐',
		defaultVerticalAlignmentDesc: '表格单元格的默认纵向对齐方式',
		left: '左对齐',
		center: '居中',
		right: '右对齐',
		top: '顶部',
		middle: '垂直居中',
		bottom: '底部',
	},
};

export function getLocale(lang?: string): Locale {
	if (!lang) {
		const appLang = getLanguage();
		lang = appLang.startsWith('zh') ? 'zh' : 'en';
	}
	return locales[lang] ?? locales.en!;
}
