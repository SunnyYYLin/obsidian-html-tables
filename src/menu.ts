export interface TableMenuAction {
	text: string;
	action?: () => void;
	disabled?: boolean;
	children?: TableMenuAction[];
}

export class TableMenu {
	static closeAll(): void {
		activeDocument.querySelectorAll('.table-context-menu').forEach(menu => menu.remove());
	}

	static show(tableEl: HTMLTableElement, e: MouseEvent, actions: TableMenuAction[]): void {
		this.closeAll();

		// Create a simple context menu
		const menu = activeDocument.createElement('div');
		menu.addClass('table-context-menu');
		menu.addClass('table-context-menu-position');
		menu.style.setProperty('--menu-x', `${e.clientX}px`);
		menu.style.setProperty('--menu-y', `${e.clientY}px`);

		// Close menu when interacting elsewhere. Targets can be text nodes inside cells,
		// so avoid assuming HTMLElement.closest() is available.
		const isInsideMenu = (target: EventTarget | null): boolean => {
			return target instanceof Node && menu.contains(target);
		};
		const removeMenu = () => {
			menu.remove();
			activeDocument.removeEventListener('click', closeMenu, true);
			activeDocument.removeEventListener('mousedown', closeMenu, true);
			activeDocument.removeEventListener('pointerdown', closeMenu, true);
			activeDocument.removeEventListener('contextmenu', closeMenu, true);
		};
		const closeMenu = (event: MouseEvent | PointerEvent) => {
			if (isInsideMenu(event.target)) return;
			removeMenu();
		};

		this.renderActions(menu, actions, removeMenu);
		activeDocument.body.appendChild(menu);

		window.setTimeout(() => {
			activeDocument.addEventListener('click', closeMenu, true);
			activeDocument.addEventListener('mousedown', closeMenu, true);
			activeDocument.addEventListener('pointerdown', closeMenu, true);
			activeDocument.addEventListener('contextmenu', closeMenu, true);
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
