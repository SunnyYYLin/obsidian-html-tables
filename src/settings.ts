import { App, PluginSettingTab, Setting } from 'obsidian';
import MyPlugin from './main';
import { TableConfig } from './types';
import { getLocale, Locale } from './i18n';

export interface BetterTablesSettings {
	enableAdvancedTables: boolean;
	enableHeaderRow: boolean;
	enableHeaderColumn: boolean;
	enableCellMerging: boolean;
	enableFormula: boolean;
	enableNewline: boolean;
	enableCaption: boolean;
	defaultHorizontalAlignment: 'left' | 'center' | 'right';
	defaultVerticalAlignment: 'top' | 'middle' | 'bottom';
}

export const DEFAULT_SETTINGS: BetterTablesSettings = {
	enableAdvancedTables: true,
	enableHeaderRow: true,
	enableHeaderColumn: true,
	enableCellMerging: true,
	enableFormula: true,
	enableNewline: true,
	enableCaption: true,
	defaultHorizontalAlignment: 'left',
	defaultVerticalAlignment: 'middle',
};

export function settingsToConfig(settings: BetterTablesSettings): TableConfig {
	return {
		enableMerging: settings.enableCellMerging,
		enableFormula: settings.enableFormula,
		enableNewline: settings.enableNewline,
		enableCaption: settings.enableCaption,
		defaultAlignment: {
			horizontal: settings.defaultHorizontalAlignment,
			vertical: settings.defaultVerticalAlignment,
		},
	};
}

export class BetterTablesSettingTab extends PluginSettingTab {
	plugin: MyPlugin;
	private t: Locale;

	constructor(app: App, plugin: MyPlugin) {
		super(app, plugin);
		this.plugin = plugin;
		this.t = getLocale();
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl).setName(this.t.featuresHeading).setHeading();

		new Setting(containerEl)
			.setName(this.t.enableAdvancedTables)
			.setDesc(this.t.enableAdvancedTablesDesc)
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.enableAdvancedTables)
				.onChange(async (value) => {
					this.plugin.settings.enableAdvancedTables = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName(this.t.enableHeaderRow)
			.setDesc(this.t.enableHeaderRowDesc)
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.enableHeaderRow)
				.onChange(async (value) => {
					this.plugin.settings.enableHeaderRow = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName(this.t.enableHeaderColumn)
			.setDesc(this.t.enableHeaderColumnDesc)
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.enableHeaderColumn)
				.onChange(async (value) => {
					this.plugin.settings.enableHeaderColumn = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName(this.t.enableCellMerging)
			.setDesc(this.t.enableCellMergingDesc)
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.enableCellMerging)
				.onChange(async (value) => {
					this.plugin.settings.enableCellMerging = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName(this.t.enableFormula)
			.setDesc(this.t.enableFormulaDesc)
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.enableFormula)
				.onChange(async (value) => {
					this.plugin.settings.enableFormula = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName(this.t.enableNewline)
			.setDesc(this.t.enableNewlineDesc)
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.enableNewline)
				.onChange(async (value) => {
					this.plugin.settings.enableNewline = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName(this.t.enableCaption)
			.setDesc(this.t.enableCaptionDesc)
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.enableCaption)
				.onChange(async (value) => {
					this.plugin.settings.enableCaption = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName(this.t.defaultHorizontalAlignment)
			.setDesc(this.t.defaultHorizontalAlignmentDesc)
			.addDropdown(dropdown => dropdown
				.addOption('left', this.t.left)
				.addOption('center', this.t.center)
				.addOption('right', this.t.right)
				.setValue(this.plugin.settings.defaultHorizontalAlignment)
				.onChange(async (value) => {
					this.plugin.settings.defaultHorizontalAlignment = value as 'left' | 'center' | 'right';
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName(this.t.defaultVerticalAlignment)
			.setDesc(this.t.defaultVerticalAlignmentDesc)
			.addDropdown(dropdown => dropdown
				.addOption('top', this.t.top)
				.addOption('middle', this.t.middle)
				.addOption('bottom', this.t.bottom)
				.setValue(this.plugin.settings.defaultVerticalAlignment)
				.onChange(async (value) => {
					this.plugin.settings.defaultVerticalAlignment = value as 'top' | 'middle' | 'bottom';
					await this.plugin.saveSettings();
				}));
	}
}
