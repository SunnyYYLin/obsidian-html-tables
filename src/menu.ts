export class TableMenu {
	static show(tableEl: HTMLTableElement, e: MouseEvent, actions: Array<{ text: string; action: () => void; disabled?: boolean }>): void {
		activeDocument.querySelectorAll('.table-context-menu').forEach(menu => menu.remove());

		// Create a simple context menu
		const menu = activeDocument.createElement('div');
		menu.addClass('table-context-menu');
		menu.addClass('table-context-menu-position');
		menu.style.setProperty('--menu-x', `${e.clientX}px`);
		menu.style.setProperty('--menu-y', `${e.clientY}px`);

		actions.forEach(item => {
			if (item.text === '---') {
				// Add separator
				menu.createEl('div', {
					cls: 'table-context-menu-separator',
				});
				return;
			}

			const menuItem = menu.createEl('div', {
				cls: `table-context-menu-item${item.disabled ? ' disabled' : ''}`,
				text: item.text,
			});
			
			if (!item.disabled) {
				menuItem.addEventListener('click', () => {
					item.action();
					menu.remove();
				});
			}
		});

		activeDocument.body.appendChild(menu);

		// Close menu when clicking elsewhere
		const closeMenu = () => {
			menu.remove();
			activeDocument.removeEventListener('click', closeMenu);
		};
		window.setTimeout(() => {
			activeDocument.addEventListener('click', closeMenu);
		}, 0);
	}
}
