export interface TableMenuAction {
	text: string;
	action?: () => void;
	disabled?: boolean;
	children?: TableMenuAction[];
}

export class TableMenu {
	static show(tableEl: HTMLTableElement, e: MouseEvent, actions: TableMenuAction[]): void {
		activeDocument.querySelectorAll('.table-context-menu').forEach(menu => menu.remove());

		// Create a simple context menu
		const menu = activeDocument.createElement('div');
		menu.addClass('table-context-menu');
		menu.addClass('table-context-menu-position');
		menu.style.setProperty('--menu-x', `${e.clientX}px`);
		menu.style.setProperty('--menu-y', `${e.clientY}px`);

		this.renderActions(menu, actions, () => menu.remove());

		activeDocument.body.appendChild(menu);

		// Close menu when clicking elsewhere
		const closeMenu = (event: MouseEvent) => {
			if ((event.target as HTMLElement).closest('.table-context-menu')) return;
			menu.remove();
			activeDocument.removeEventListener('click', closeMenu);
			activeDocument.removeEventListener('mousedown', closeMenu, true);
		};
		window.setTimeout(() => {
			activeDocument.addEventListener('click', closeMenu);
			activeDocument.addEventListener('mousedown', closeMenu, true);
		}, 0);
	}

	private static renderActions(container: HTMLElement, actions: TableMenuAction[], close: () => void): void {
		actions.forEach(item => {
			if (item.text === '---') {
				// Add separator
				container.createEl('div', {
					cls: 'table-context-menu-separator',
				});
				return;
			}

			const menuItem = container.createEl('div', {
				cls: `table-context-menu-item${item.disabled ? ' disabled' : ''}`,
				text: item.text,
			});

			if (item.children && item.children.length > 0) {
				menuItem.addClass('has-submenu');
				const submenu = menuItem.createEl('div', {
					cls: 'table-context-submenu',
				});
				this.renderActions(submenu, item.children, close);
				return;
			}

			if (!item.disabled && item.action) {
				menuItem.addEventListener('click', () => {
					item.action?.();
					close();
				});
			}
		});
	}
}
