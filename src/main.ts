import { Plugin, Editor, MarkdownPostProcessorContext, Menu } from 'obsidian';
import {
	BetterTablesSettings,
	DEFAULT_SETTINGS,
	BetterTablesSettingTab,
} from './settings';
import { getLocale, Locale } from './i18n';
import { TableEnhancer } from './table-enhancer';

export default class BetterTablesPlugin extends Plugin {
	settings!: BetterTablesSettings;
	/** Exposed so TableEnhancer can access via the PluginHost interface. */
	t!: Locale;
	private enhancer!: TableEnhancer;

	async onload() {
		await this.loadSettings();

		// Initialize i18n
		this.t = getLocale();

		// Initialize the table enhancer (holds all DOM + state logic)
		this.enhancer = new TableEnhancer(this);
		this.enhancer.initialize();

		// Register markdown post processor for tables (reading mode)
		this.registerMarkdownPostProcessor(
			(element: HTMLElement, context: MarkdownPostProcessorContext) => {
				this.enhancer.processTables(element, context);
			},
		);

		// Inject table actions into the editor's native context menu (live preview)
		this.registerEvent(
			this.app.workspace.on('editor-menu', (menu: Menu, editor: Editor) => {
				if (!this.settings.enableAdvancedTables) return;
				this.enhancer.buildEditorMenu(menu, editor);
			}),
		);

		// Add commands
		this.addCommand({
			id: 'toggle-header-row',
			name: 'Toggle header row',
			editorCallback: (editor: Editor) => this.enhancer.cmdToggleHeaderRow(editor),
		});

		this.addCommand({
			id: 'toggle-header-column',
			name: 'Toggle header column',
			editorCallback: (editor: Editor) => this.enhancer.cmdToggleHeaderColumn(editor),
		});

		this.addCommand({
			id: 'add-table-caption',
			name: 'Add table caption',
			editorCallback: (editor: Editor) => this.enhancer.cmdAddTableCaption(editor),
		});

		// Add settings tab
		this.addSettingTab(new BetterTablesSettingTab(this.app, this));
	}

	onunload() {
		this.enhancer.cleanup();
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			(await this.loadData()) as Partial<BetterTablesSettings>,
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
