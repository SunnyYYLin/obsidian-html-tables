import { App, Modal } from 'obsidian';
import type { Locale } from './i18n';

export class CaptionModal extends Modal {
	private onSubmit: (caption: string) => void;
	private input: HTMLInputElement | null = null;
	private t: Locale;

	constructor(app: App, t: Locale, onSubmit: (caption: string) => void) {
		super(app);
		this.t = t;
		this.onSubmit = onSubmit;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.createEl('h2', { text: this.t.enterTableCaption });

		this.input = contentEl.createEl('input', {
			type: 'text',
			placeholder: this.t.tableCaption,
			cls: 'caption-input',
		});

		const buttonContainer = contentEl.createEl('div', {
			cls: 'caption-button-container',
		});

		const cancelButton = buttonContainer.createEl('button', { text: this.t.cancel });
		cancelButton.addEventListener('click', () => this.close());

		const submitButton = buttonContainer.createEl('button', { text: this.t.addCaptionButton });
		submitButton.addClass('mod-cta');
		submitButton.addEventListener('click', () => {
			if (this.input) {
				this.onSubmit(this.input.value);
			}
			this.close();
		});

		// Focus input
		this.input.focus();
		this.input.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') {
				if (this.input) {
					this.onSubmit(this.input.value);
				}
				this.close();
			}
		});
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
